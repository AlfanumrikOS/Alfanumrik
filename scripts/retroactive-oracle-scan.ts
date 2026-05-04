/**
 * ALFANUMRIK — Phase 6.17 retroactive quiz-oracle scan (DRY-RUN by default).
 *
 * The `ff_quiz_oracle_enabled` flag flipped TRUE in production via migration
 * `20260504100000_enable_quiz_oracle_in_prod.sql`. From that timestamp
 * forward, every freshly-generated MCQ runs through the deterministic +
 * LLM-grader oracle before it lands in `question_bank`. Rows inserted
 * BEFORE that timestamp were never audited, so this script scans the
 * pre-existing rows and produces a quarantine recommendation report.
 *
 * Behaviour:
 *   - DRY-RUN by default. The script writes a Markdown report to disk and
 *     does NOT update the database.
 *   - `--no-dry-run` is accepted but the script will prompt for an explicit
 *     confirmation phrase from stdin before issuing any UPDATE. (As of
 *     Phase 6.17 the UPDATE path itself is intentionally NOT WIRED — the
 *     founder reviews the report first; a follow-up phase will land the
 *     update path.)
 *
 * Run:
 *   npm run retroactive-scan -- --limit 50 --budget 100
 *   npm run retroactive-scan -- --subject science --grade 8 --limit 200
 *   npm run retroactive-scan -- --out tmp/scan.md --limit 100
 *
 * Required env vars:
 *   SUPABASE_URL                 (or NEXT_PUBLIC_SUPABASE_URL — fallback)
 *   SUPABASE_SERVICE_ROLE_KEY    (admin client; bypasses RLS for the scan)
 *   ANTHROPIC_API_KEY            (LLM-grader)
 *
 * Exit codes:
 *   0 — scan completed cleanly (DRY-RUN report written)
 *   1 — Claude budget exhausted before reaching `--limit`
 *   2 — infrastructure failure (DB connect, missing env, write failure)
 *
 * Cost ceiling:
 *   Hard cap = `--budget` (default 200) Claude calls. We DO NOT call Claude
 *   for rows that fail deterministic checks (cost guard). For 100 questions
 *   the wall-clock is ~3-5 min (deterministic ~1 ms, Claude call ~2 s).
 *
 * Privacy (P13):
 *   The Markdown report contains question_ids, subjects, topics, grades,
 *   and verdict categories ONLY. It does NOT include question text,
 *   correct_answer_index, or the full LLM grader reasoning — even in admin
 *   reports we minimise disclosure.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {
  runDeterministicChecks,
  type CandidateQuestion,
  type OracleRejectionCategory,
} from '../src/lib/oracle/deterministic-checks';

// ─── Configuration ───────────────────────────────────────────────────────────

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
 * Phase 1.1 migration timestamp — the cutover after which every new row was
 * audited by the oracle. Rows inserted BEFORE this UTC instant are the
 * Phase 6.17 audit population.
 */
const PRE_REG54_BOUNDARY_ISO = '2026-05-04T10:00:00Z';

const ORACLE_VERSION_TAG = 'v2';

/** Single-call timeout for the LLM grader. Mirrors the Edge-function value. */
const ORACLE_LLM_GRADER_TIMEOUT_MS = 12_000;

/** PostHog-side oracle taxonomy — keep in lockstep with regression-catalog. */
type LlmVerdict = 'CONSISTENT' | 'AMBIGUOUS' | 'REJECT_LLM';
type ScanVerdict =
  | 'CONSISTENT'
  | 'AMBIGUOUS'
  | 'REJECT_LLM'
  | 'REJECT_DETERMINISTIC'
  | 'SKIP_GRADER_UNAVAILABLE';

// ─── CLI parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  limit: number;
  subject: string | null;
  grade: string | null;
  budget: number;
  dryRun: boolean;
  outPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    if (i === -1 || i + 1 >= args.length) return null;
    return args[i + 1];
  };

  const limitRaw = get('--limit');
  const budgetRaw = get('--budget');
  const subjectRaw = get('--subject');
  const gradeRaw = get('--grade');
  const outRaw = get('--out');

  const limit = limitRaw === null ? 100 : parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    fail(`--limit must be a positive integer, got "${limitRaw}"`, 2);
  }

  const budget = budgetRaw === null ? 200 : parseInt(budgetRaw, 10);
  if (!Number.isFinite(budget) || budget < 0) {
    fail(`--budget must be a non-negative integer, got "${budgetRaw}"`, 2);
  }

  // P5: grades are strings "6".."12". Reject integer-shaped CLI input that
  // somehow slipped through, and reject anything outside the canonical set.
  const validGrade = /^([6-9]|1[0-2])$/;
  if (gradeRaw !== null && !validGrade.test(gradeRaw)) {
    fail(
      `--grade must be a string "6".."12" (P5), got "${gradeRaw}"`,
      2,
    );
  }

  // dry-run default = TRUE; --no-dry-run flips it.
  const dryRun = !args.includes('--no-dry-run');

  const isoDate = new Date().toISOString().slice(0, 10);
  const outPath =
    outRaw ??
    path.join('tmp', `retroactive-scan-${isoDate}.md`);

  return {
    limit,
    subject: subjectRaw,
    grade: gradeRaw,
    budget,
    dryRun,
    outPath,
  };
}

function fail(msg: string, code: 1 | 2): never {
  process.stderr.write(`[retroactive-oracle-scan] ERROR: ${msg}\n`);
  process.exit(code);
}

// ─── Env check ───────────────────────────────────────────────────────────────

function getSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    fail(
      'missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and/or ' +
        'SUPABASE_SERVICE_ROLE_KEY env vars',
      2,
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// ─── DB row shape ────────────────────────────────────────────────────────────

interface QuestionBankRow {
  id: string;
  subject: string;
  grade: string;
  topic: string | null;
  topic_id: string | null;
  chapter_number: number | null;
  question_text: string;
  options: unknown;
  correct_answer_index: number;
  explanation: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  is_active: boolean;
  created_at: string;
}

const SELECT_COLS =
  'id, subject, grade, topic, topic_id, chapter_number, question_text, options, ' +
  'correct_answer_index, explanation, difficulty, bloom_level, is_active, created_at';

// ─── Difficulty mapping ──────────────────────────────────────────────────────

/**
 * `question_bank.difficulty` is a 1..5 integer. The oracle expects the
 * string enum easy|medium|hard. Mapping mirrors the convention used in
 * `src/lib/ai/prompts/quiz-gen.ts` (`difficulty <= 2 ? easy : <= 3 ? medium
 * : hard`). Anything outside 1..5 maps to `undefined` so the oracle's
 * "skip when undefined" branch fires (we don't want to spuriously fail
 * legacy rows with difficulty=0 / null).
 */
function mapDifficulty(d: number | null): string | undefined {
  if (d === null || d === undefined || !Number.isFinite(d)) return undefined;
  if (d <= 2) return 'easy';
  if (d <= 3) return 'medium';
  if (d <= 5) return 'hard';
  return undefined;
}

/** Coerce DB `options` (JSONB) into a plain string array, or null on shape failure. */
function coerceOptions(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function rowToCandidate(row: QuestionBankRow): CandidateQuestion {
  const options = coerceOptions(row.options) ?? [];
  return {
    question_text: row.question_text ?? '',
    options,
    correct_answer_index: row.correct_answer_index,
    explanation: row.explanation ?? '',
    difficulty: mapDifficulty(row.difficulty),
    bloom_level: row.bloom_level ?? undefined,
    grade: row.grade,
    // We deliberately do NOT pass subject through. The oracle's CBSE
    // allowlist is narrower than the live `question_bank` taxonomy (which
    // includes `history_sr`, `computer_science`, `coding` etc.), and
    // tripping `invalid_subject` on legacy rows would mask the real
    // hallucination signal. The audit is about correctness, not taxonomy.
  };
}

// ─── Claude LLM grader ───────────────────────────────────────────────────────

const QUIZ_ORACLE_GRADER_SYSTEM_PROMPT = `You are a strict, factual content auditor for a CBSE K-12 EdTech platform.
Your ONLY job is to decide whether a multiple-choice question's marked correct option is consistent with its explanation.

Decision rule:
- Read the explanation as the authority on what the correct answer should be.
- Compare it to the option at the marked correct_answer_index.
- If the explanation logically and unambiguously supports that option → "consistent".
- If the explanation supports a DIFFERENT option → "mismatch" (and identify which option in suggested_correct_index).
- If the explanation is too vague, contradicts itself, or could justify multiple options → "ambiguous".

Output STRICT JSON only — no prose, no markdown fences:
{"verdict": "consistent" | "mismatch" | "ambiguous", "reasoning": "<one sentence>", "suggested_correct_index": 0 | 1 | 2 | 3}

Rules:
- "reasoning" must be ONE short sentence, max 200 characters.
- "suggested_correct_index" is OPTIONAL. Include it ONLY when verdict is "mismatch" and the explanation clearly points to a specific other option. Omit otherwise.
- Do NOT explain your decision in prose outside the JSON. Do NOT include any text before or after the JSON object.
- Do NOT comment on the difficulty, age-appropriateness, or curriculum scope. That is a different audit.
- Do NOT correct the explanation. Audit it as-is.`;

function buildGraderUserPrompt(c: CandidateQuestion): string {
  const optionsBlock = c.options
    .map((opt, i) => {
      const marker = i === c.correct_answer_index ? ' (MARKED CORRECT)' : '';
      return `  ${i}: ${opt}${marker}`;
    })
    .join('\n');
  return `Question:
${c.question_text}

Options:
${optionsBlock}

Marked correct_answer_index: ${c.correct_answer_index}

Explanation:
${c.explanation}

Audit: does the explanation support the marked correct option?`;
}

interface GraderResult {
  verdict: 'consistent' | 'mismatch' | 'ambiguous';
  reasoning: string;
}

function parseGraderResponse(raw: string): GraderResult | null {
  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const v = o.verdict;
  if (v !== 'consistent' && v !== 'mismatch' && v !== 'ambiguous') {
    return null;
  }
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';
  return { verdict: v, reasoning };
}

async function callClaudeGrader(
  candidate: CandidateQuestion,
): Promise<{ ok: true; result: GraderResult } | { ok: false; error: string }> {
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set' };
  }
  const userPrompt = buildGraderUserPrompt(candidate);
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ORACLE_LLM_GRADER_TIMEOUT_MS,
  );
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        temperature: 0.0, // factual audit — deterministic as we can get it
        system: QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Claude API ${res.status}: ${body.slice(0, 160)}`,
      };
    }
    const data = (await res.json()) as {
      content?: Array<{ text?: string }>;
    };
    const text = data?.content?.[0]?.text || '';
    const parsed = parseGraderResponse(text);
    if (!parsed) {
      return {
        ok: false,
        error: `parse failure on grader response: ${text.slice(0, 120)}`,
      };
    }
    return { ok: true, result: parsed };
  } catch (err) {
    const msg =
      err instanceof DOMException && err.name === 'AbortError'
        ? `timeout (${ORACLE_LLM_GRADER_TIMEOUT_MS} ms)`
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Per-row scan ────────────────────────────────────────────────────────────

interface ScanRecord {
  question_id: string;
  subject: string;
  topic: string | null;
  grade: string;
  deterministic_verdict: 'PASS' | OracleRejectionCategory;
  llm_verdict: LlmVerdict | null;
  llm_reason: string | null;
  scan_verdict: ScanVerdict;
}

async function scanRow(
  row: QuestionBankRow,
  state: { claudeCalls: number; budget: number },
): Promise<{ record: ScanRecord; calledClaude: boolean }> {
  const candidate = rowToCandidate(row);
  const detResult = runDeterministicChecks(candidate);

  // Deterministic FAIL → record verdict REJECT_DETERMINISTIC and skip
  // Claude (cost guard).
  if (detResult !== null) {
    return {
      record: {
        question_id: row.id,
        subject: row.subject,
        topic: row.topic,
        grade: row.grade,
        deterministic_verdict: detResult.category,
        llm_verdict: null,
        llm_reason: null,
        scan_verdict: 'REJECT_DETERMINISTIC',
      },
      calledClaude: false,
    };
  }

  // Deterministic PASS → enforce budget, then LLM-grade.
  if (state.claudeCalls >= state.budget) {
    return {
      record: {
        question_id: row.id,
        subject: row.subject,
        topic: row.topic,
        grade: row.grade,
        deterministic_verdict: 'PASS',
        llm_verdict: null,
        llm_reason: null,
        scan_verdict: 'SKIP_GRADER_UNAVAILABLE',
      },
      calledClaude: false,
    };
  }

  const graded = await callClaudeGrader(candidate);
  state.claudeCalls += 1;

  if (!graded.ok) {
    return {
      record: {
        question_id: row.id,
        subject: row.subject,
        topic: row.topic,
        grade: row.grade,
        deterministic_verdict: 'PASS',
        llm_verdict: null,
        llm_reason: graded.error.slice(0, 200),
        scan_verdict: 'SKIP_GRADER_UNAVAILABLE',
      },
      calledClaude: true,
    };
  }

  const llmVerdict: LlmVerdict =
    graded.result.verdict === 'consistent'
      ? 'CONSISTENT'
      : graded.result.verdict === 'ambiguous'
        ? 'AMBIGUOUS'
        : 'REJECT_LLM';

  return {
    record: {
      question_id: row.id,
      subject: row.subject,
      topic: row.topic,
      grade: row.grade,
      deterministic_verdict: 'PASS',
      llm_verdict: llmVerdict,
      // Truncated to 200 chars per the Phase 6.17 spec; even though we DO
      // need the reason to triage the report, we never let an unbounded
      // model string leak into the on-disk artifact.
      llm_reason: graded.result.reasoning.slice(0, 200),
      scan_verdict: llmVerdict,
    },
    calledClaude: true,
  };
}

// ─── Usage-count join ────────────────────────────────────────────────────────

/**
 * Best-effort: count `quiz_responses` rows referencing each quarantined
 * question_id. If the table or the join shape is unavailable, return zeros
 * (the report still lists the quarantine candidates — usage count is just a
 * sort key for "most urgent to fix"). We deliberately use a single
 * aggregated query for all quarantined IDs to keep the call count low.
 */
async function fetchUsageCounts(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = 0;
  if (ids.length === 0) return counts;
  // We try `quiz_responses(question_id)` first since that's the canonical
  // table. If it doesn't exist we silently fall back to "no usage data".
  try {
    const { data, error } = await supabase
      .from('quiz_responses')
      .select('question_id')
      .in('question_id', ids);
    if (error || !data) return counts;
    for (const r of data as Array<{ question_id: string | null }>) {
      const qid = r.question_id;
      if (qid && qid in counts) counts[qid] += 1;
    }
  } catch {
    // Swallow — usage counts are advisory.
  }
  return counts;
}

// ─── Markdown report ─────────────────────────────────────────────────────────

function escapePipe(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\|/g, '\\|').slice(0, 80);
}

interface ReportArgs {
  cli: CliArgs;
  records: ScanRecord[];
  usage: Record<string, number>;
  claudeCalls: number;
  budgetExhausted: boolean;
  scanStartedAt: string;
  scanFinishedAt: string;
}

function buildReport(args: ReportArgs): string {
  const { cli, records, usage, claudeCalls, budgetExhausted } = args;

  const tally: Record<ScanVerdict, number> = {
    CONSISTENT: 0,
    AMBIGUOUS: 0,
    REJECT_LLM: 0,
    REJECT_DETERMINISTIC: 0,
    SKIP_GRADER_UNAVAILABLE: 0,
  };
  for (const r of records) tally[r.scan_verdict] += 1;

  const quarantine = records
    .filter(
      (r) =>
        r.scan_verdict === 'REJECT_DETERMINISTIC' ||
        r.scan_verdict === 'AMBIGUOUS' ||
        r.scan_verdict === 'REJECT_LLM',
    )
    .map((r) => ({ ...r, usage: usage[r.question_id] ?? 0 }))
    .sort((a, b) => b.usage - a.usage);

  const top10 = quarantine.slice(0, 10);

  // SQL preview — PER-VERDICT statements so the founder can quarantine in
  // tranches (the deterministic rejections are higher confidence than the
  // ambiguous LLM rejections).
  const detIds = quarantine
    .filter((r) => r.scan_verdict === 'REJECT_DETERMINISTIC')
    .map((r) => r.question_id);
  const llmIds = quarantine
    .filter((r) => r.scan_verdict === 'REJECT_LLM')
    .map((r) => r.question_id);
  const ambIds = quarantine
    .filter((r) => r.scan_verdict === 'AMBIGUOUS')
    .map((r) => r.question_id);

  const sqlBlock = (verdict: string, ids: string[]): string => {
    if (ids.length === 0) return `-- (no rows for ${verdict})`;
    const idList = ids.map((id) => `'${id}'`).join(',\n  ');
    return [
      `UPDATE question_bank`,
      `SET is_active = false,`,
      `    oracle_verdict = '${verdict}',`,
      `    oracle_verdict_version = '${ORACLE_VERSION_TAG}',`,
      `    oracle_verdict_at = NOW()`,
      `WHERE id IN (`,
      `  ${idList}`,
      `);`,
    ].join('\n');
  };

  const header = [
    `# Phase 6.17 retroactive oracle scan report`,
    ``,
    `- **Mode:** ${cli.dryRun ? 'DRY-RUN (no DB writes)' : 'LIVE (UPDATE path requires confirmation prompt)'}`,
    `- **Scan started:** ${args.scanStartedAt}`,
    `- **Scan finished:** ${args.scanFinishedAt}`,
    `- **Filters:** limit=${cli.limit}` +
      (cli.subject ? `, subject=${cli.subject}` : '') +
      (cli.grade ? `, grade=${cli.grade}` : '') +
      `, pre-REG-54 boundary=${PRE_REG54_BOUNDARY_ISO}`,
    `- **Output:** \`${cli.outPath}\``,
    `- **Privacy:** P13 — this report contains question_ids, subjects, topics, grades, and verdict categories ONLY. No question text, no correct_answer_index, no full LLM-grader reasoning.`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Rows scanned | ${records.length} |`,
    `| CONSISTENT (oracle approves) | ${tally.CONSISTENT} |`,
    `| AMBIGUOUS (LLM unsure) | ${tally.AMBIGUOUS} |`,
    `| REJECT_LLM (LLM disagrees) | ${tally.REJECT_LLM} |`,
    `| REJECT_DETERMINISTIC | ${tally.REJECT_DETERMINISTIC} |`,
    `| SKIP_GRADER_UNAVAILABLE | ${tally.SKIP_GRADER_UNAVAILABLE} |`,
    `| Claude calls used | ${claudeCalls} |`,
    `| Budget configured | ${cli.budget} |`,
    `| Budget remaining | ${Math.max(0, cli.budget - claudeCalls)} |`,
    `| Budget exhausted | ${budgetExhausted ? 'YES (re-run with larger --budget)' : 'no'} |`,
    `| Quarantine candidates | ${quarantine.length} |`,
    ``,
  ].join('\n');

  const top10Block =
    top10.length === 0
      ? `## Top-10 most-served quarantine candidates\n\n_(no quarantine candidates — nothing to triage)_\n`
      : [
          `## Top-10 most-served quarantine candidates`,
          ``,
          `These are the most urgent to fix — high usage means a wrong answer`,
          `here corrupts many students' scores.`,
          ``,
          `| # | question_id | subject | topic | grade | verdict | usage |`,
          `|---|---|---|---|---|---|---|`,
          ...top10.map(
            (r, i) =>
              `| ${i + 1} | \`${r.question_id}\` | ${escapePipe(r.subject)} | ${escapePipe(r.topic)} | ${escapePipe(r.grade)} | ${r.scan_verdict} | ${r.usage} |`,
          ),
          ``,
        ].join('\n');

  const fullTableBlock =
    quarantine.length === 0
      ? `## Quarantine recommendation table\n\n_(empty)_\n`
      : [
          `## Quarantine recommendation table`,
          ``,
          `Sorted by usage count (descending). One row per question.`,
          ``,
          `| question_id | subject | topic | grade | scan_verdict | det_verdict | llm_verdict | usage |`,
          `|---|---|---|---|---|---|---|---|`,
          ...quarantine.map(
            (r) =>
              `| \`${r.question_id}\` | ${escapePipe(r.subject)} | ${escapePipe(r.topic)} | ${escapePipe(r.grade)} | ${r.scan_verdict} | ${r.deterministic_verdict} | ${r.llm_verdict ?? '—'} | ${r.usage} |`,
          ),
          ``,
        ].join('\n');

  const sqlPreview = [
    `## SQL preview (executed only when --no-dry-run is confirmed)`,
    ``,
    `> The Phase 6.17 script does NOT execute these statements. They are`,
    `> printed for the founder to review and run manually (or for a`,
    `> follow-up script that lands the UPDATE path).`,
    ``,
    `### Deterministic rejections (highest confidence — quarantine first)`,
    ``,
    '```sql',
    sqlBlock('REJECT_DETERMINISTIC', detIds),
    '```',
    ``,
    `### LLM rejections (high confidence — quarantine second)`,
    ``,
    '```sql',
    sqlBlock('REJECT_LLM', llmIds),
    '```',
    ``,
    `### LLM ambiguous (review before quarantining)`,
    ``,
    '```sql',
    sqlBlock('AMBIGUOUS', ambIds),
    '```',
    ``,
  ].join('\n');

  const note = [
    `## Notes for the founder`,
    ``,
    `1. **Schema gap.** As of ${new Date().toISOString().slice(0, 10)} the`,
    `   \`question_bank\` table does NOT yet have \`oracle_verdict\`,`,
    `   \`oracle_verdict_version\`, or \`oracle_verdict_at\` columns. The SQL`,
    `   preview above assumes those columns will be added by a follow-up`,
    `   migration BEFORE the UPDATE path is run. Until then \`is_active = false\``,
    `   alone is the practical quarantine signal.`,
    `2. **Cost.** This scan made ${claudeCalls} Claude calls.`,
    `3. **Scope.** The scan covered rows created BEFORE`,
    `   \`${PRE_REG54_BOUNDARY_ISO}\` (the Phase 1.1 cutover). Anything newer`,
    `   was already audited by the live oracle.`,
    `4. **Re-running.** To audit more rows, re-run with a larger \`--limit\``,
    `   AND \`--budget\`. This script is idempotent — it does not mutate state`,
    `   in DRY-RUN mode.`,
    ``,
  ].join('\n');

  return `${header}\n${fullTableBlock}\n${top10Block}\n${sqlPreview}\n${note}`;
}

// ─── Confirmation prompt for --no-dry-run ────────────────────────────────────

async function confirmLiveRun(): Promise<boolean> {
  // The Phase 6.17 task explicitly says: "if --no-dry-run is passed, prompt
  // for explicit confirmation (read line from stdin) before doing any
  // UPDATE". As of Phase 6.17 the UPDATE path is intentionally NOT WIRED,
  // so even on confirmation this script will refuse and print an
  // instructive message — that's the safe default.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer: string = await new Promise((resolve) => {
    rl.question(
      'Type the phrase "I HAVE REVIEWED THE REPORT" to confirm live UPDATE (or anything else to abort): ',
      (a) => {
        rl.close();
        resolve(a);
      },
    );
  });
  return answer.trim() === 'I HAVE REVIEWED THE REPORT';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);
  const supabase = getSupabaseClient();

  const scanStartedAt = new Date().toISOString();

  // Build the query. We only want active rows created BEFORE the cutover,
  // newest-first (most likely to still be served). The verdict-not-graded
  // filter is intentionally OMITTED for now: the columns don't exist yet
  // (see report note 1), so the boundary timestamp + is_active is the
  // practical "ungraded" filter.
  let query = supabase
    .from('question_bank')
    .select(SELECT_COLS)
    .eq('is_active', true)
    .lt('created_at', PRE_REG54_BOUNDARY_ISO)
    .order('created_at', { ascending: false })
    .limit(cli.limit);

  if (cli.subject) query = query.eq('subject', cli.subject);
  if (cli.grade) query = query.eq('grade', cli.grade);

  const { data, error } = await query;
  if (error) {
    fail(`fetch failed: ${error.message}`, 2);
  }
  // The supabase-js generic-typed select returns `GenericStringError[]` when
  // its row-type inference can't bind to a concrete table type; we know the
  // shape (we wrote the `select()` projection ourselves), so cast through
  // `unknown` to skip the false structural-compatibility complaint.
  const rows = ((data ?? []) as unknown) as QuestionBankRow[];

  if (rows.length === 0) {
    process.stdout.write(
      '[retroactive-oracle-scan] no rows matched the filter — nothing to do\n',
    );
    // Still emit an empty report so ops has an artifact.
  }

  // Scan loop.
  const state = { claudeCalls: 0, budget: cli.budget };
  const records: ScanRecord[] = [];
  let budgetExhausted = false;

  for (const row of rows) {
    const { record, calledClaude } = await scanRow(row, state);
    records.push(record);
    if (
      calledClaude === false &&
      record.scan_verdict === 'SKIP_GRADER_UNAVAILABLE' &&
      record.llm_reason === null
    ) {
      // We hit budget exhaustion — the scanRow short-circuited before
      // calling Claude. Stop emitting further skip-records; the report
      // already shows the partial scan.
      budgetExhausted = true;
      break;
    }
    if (state.claudeCalls % 10 === 0 && state.claudeCalls > 0) {
      process.stdout.write(
        `[retroactive-oracle-scan] progress: ${records.length}/${rows.length} rows scanned, ${state.claudeCalls}/${cli.budget} Claude calls used\n`,
      );
    }
  }

  // Usage counts for quarantine ordering.
  const quarantineIds = records
    .filter(
      (r) =>
        r.scan_verdict === 'REJECT_DETERMINISTIC' ||
        r.scan_verdict === 'AMBIGUOUS' ||
        r.scan_verdict === 'REJECT_LLM',
    )
    .map((r) => r.question_id);
  const usage = await fetchUsageCounts(supabase, quarantineIds);

  const scanFinishedAt = new Date().toISOString();

  // Build + write report.
  const report = buildReport({
    cli,
    records,
    usage,
    claudeCalls: state.claudeCalls,
    budgetExhausted,
    scanStartedAt,
    scanFinishedAt,
  });

  // Ensure tmp/ exists if that's the default target.
  const outDir = path.dirname(cli.outPath);
  if (outDir && outDir !== '.') {
    fs.mkdirSync(outDir, { recursive: true });
  }
  try {
    fs.writeFileSync(cli.outPath, report, 'utf8');
  } catch (e) {
    fail(
      `failed to write report to ${cli.outPath}: ${e instanceof Error ? e.message : String(e)}`,
      2,
    );
  }
  process.stdout.write(
    `[retroactive-oracle-scan] report written to ${cli.outPath}\n`,
  );

  // Live-run path: refuse for now, even on confirmation.
  if (!cli.dryRun) {
    process.stdout.write(
      '[retroactive-oracle-scan] --no-dry-run was passed; the UPDATE path is intentionally NOT wired in Phase 6.17.\n' +
        'Review the report, then run the SQL preview manually (or wait for the Phase 6.18 update script).\n',
    );
    const confirmed = await confirmLiveRun();
    if (confirmed) {
      process.stdout.write(
        '[retroactive-oracle-scan] confirmation accepted but UPDATE path is not wired — exiting without DB changes.\n',
      );
    } else {
      process.stdout.write(
        '[retroactive-oracle-scan] confirmation NOT given — exiting (DRY-RUN behaviour).\n',
      );
    }
  }

  if (budgetExhausted) {
    process.stdout.write(
      `[retroactive-oracle-scan] budget exhausted (${state.claudeCalls}/${cli.budget}) before reaching --limit (${cli.limit}). Re-run with --budget ${cli.budget * 2} for full coverage.\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  fail(
    `unhandled error: ${err instanceof Error ? err.stack || err.message : String(err)}`,
    2,
  );
});
