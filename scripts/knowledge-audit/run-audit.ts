#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * scripts/knowledge-audit/run-audit.ts
 *
 * Wave 1 Task 1.2 — chunk-pass knowledge-audit engine (I/O orchestrator).
 *
 * Per chapter: reads rag_content_chunks (via the established
 * `get_chapter_rag_content` RPC) + known concept metadata (chapter_concepts),
 * runs the LLM chunk pass (22 chunk_pass dimensions), executes the
 * question_bank (5 dims) and generated-content (4 dims) scans, and upserts
 * chapter_asset_inventory rows on (syllabus_id, dimension) — 31 rows/chapter.
 *
 * MODEL / PROVIDER: this OFFLINE audit script follows the house offline-script
 * convention established (user-approved) in scripts/generate-chapter-concepts.ts
 * and scripts/bulk-mcq-driver.ts: OpenAI Chat Completions, gpt-4o-mini,
 * temperature 0.3, JSON mode (response_format json_object), retry/backoff,
 * 90s timeout. It does NOT touch any student-facing AI surface.
 *
 * P13: evidence stores chunk IDs only — NEVER chunk text. suspected_missing
 * stores short labels only. No PII exists anywhere in this pipeline.
 *
 * USAGE:
 *   npx tsx scripts/knowledge-audit/run-audit.ts --grade 6 --subject science --chapter 4
 *   npx tsx scripts/knowledge-audit/run-audit.ts --grade 6 --subject science            (all chapters of subject)
 *   npx tsx scripts/knowledge-audit/run-audit.ts --all --board cbse --limit 10
 *   npx tsx scripts/knowledge-audit/run-audit.ts --grade 6 --subject science --chapter 4 --dry-run
 *   npx tsx scripts/knowledge-audit/run-audit.ts --grade 6 --subject science --chapter 4 --pilot-check
 *
 * COST GUARD: --limit caps chapters per run (defaults to 5 when --all is used
 * without an explicit --limit); every chapter logs an estimated-token line and
 * a running per-run chapter counter.
 *
 * ENV (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                   OPENAI_API_KEY.
 *
 * Owner: ai-engineer. Reviewers: assessment (dimension semantics / counting
 * rules), architect (DB posture).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_DIMENSIONS,
  GENERATED_CONTENT_SCAN_DIMENSIONS,
  QUESTION_BANK_SCAN_DIMENSIONS,
  type AuditChunk,
  type Dimension,
  type InventoryRow,
} from './dimensions';
import { buildAuditSystemPrompt, buildAuditUserMessage, estimateTokens } from './prompt';
import { parseAuditResponse } from './parse-response';
import {
  buildChunkPassRows,
  buildGeneratedContentFilterSpec,
  buildQuestionBankFilterSpec,
  type ChapterRef,
  type ScanSpec,
} from './coverage';
import {
  compareAgainstGroundTruth,
  findGroundTruthChapter,
  formatAgreementMatrix,
  normalizeGroundTruthFixture,
  type GroundTruthFixture,
} from './pilot-check';

// ─── Config (house offline-script conventions) ───────────────────────────────

const MODEL = 'gpt-4o-mini';
const API_BASE_URL = 'https://api.openai.com/v1';
const MAX_OUTPUT_TOKENS = 6000; // counts JSON is small; generous headroom
const DEFAULT_ALL_LIMIT = 5; // cost guard: --all without --limit caps at 5 chapters

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';

const PG_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const FIXTURE_PATH = join('scripts', 'knowledge-audit', 'fixtures', 'pilot-ground-truth-v1.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface Args {
  grade: string | null;
  subject: string | null;
  chapter: number | null;
  all: boolean;
  board: string;
  dryRun: boolean;
  limit: number | null;
  pilotCheck: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    grade: null, subject: null, chapter: null, all: false,
    board: 'cbse', dryRun: false, limit: null, pilotCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grade') args.grade = argv[++i];
    else if (a === '--subject') args.subject = argv[++i];
    else if (a === '--chapter') args.chapter = parseInt(argv[++i], 10);
    else if (a === '--all') args.all = true;
    else if (a === '--board') args.board = (argv[++i] ?? '').toLowerCase();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--pilot-check') args.pilotCheck = true;
  }
  const singleMode = Boolean(args.grade && args.subject);
  if (!singleMode && !args.all) {
    console.error('Usage: npx tsx scripts/knowledge-audit/run-audit.ts --grade 6 --subject science [--chapter N] | --all --board cbse [--dry-run] [--limit N] [--pilot-check]');
    process.exit(2);
  }
  if (args.all && args.board !== 'cbse') {
    console.error(`--board ${args.board} is not supported — the syllabus SSoT (cbse_syllabus) is CBSE-only.`);
    process.exit(2);
  }
  if (args.all && args.limit == null) {
    args.limit = DEFAULT_ALL_LIMIT;
    console.error(`cost guard: --all without --limit — capping at ${DEFAULT_ALL_LIMIT} chapters (pass --limit N to raise)`);
  }
  return args;
}

// ─── PostgREST helpers (service role) ────────────────────────────────────────

async function rest(path: string, init?: RequestInit): Promise<{ status: number; body: string; headers: Headers }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...PG_HEADERS, ...(init?.headers ?? {}) },
  });
  return { status: r.status, body: await r.text(), headers: r.headers };
}

async function rpc(name: string, args: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const r = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
  return { status: r.status, body: r.body };
}

interface SyllabusChapter {
  id: string;
  grade: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
  chunk_count: number;
}

async function enumerateChapters(args: Args): Promise<SyllabusChapter[]> {
  const select = 'select=id,grade,subject_code,chapter_number,chapter_title,chunk_count';
  let path: string;
  if (args.all) {
    path = `cbse_syllabus?is_in_scope=is.true&chunk_count=gt.0&${select}&order=grade,subject_code,chapter_number`;
  } else {
    path =
      `cbse_syllabus?grade=eq.${args.grade}&subject_code=eq.${args.subject}&is_in_scope=is.true&${select}` +
      (args.chapter != null ? `&chapter_number=eq.${args.chapter}` : '') +
      '&order=chapter_number';
  }
  const r = await rest(path);
  if (r.status !== 200) throw new Error(`cbse_syllabus query failed ${r.status}: ${r.body.slice(0, 200)}`);
  let rows = JSON.parse(r.body) as SyllabusChapter[];
  rows = rows.filter((x) => x.chunk_count > 0);
  if (args.limit != null && rows.length > args.limit) {
    console.error(`cost guard: ${rows.length} chapters enumerated — limiting to first ${args.limit}`);
    rows = rows.slice(0, args.limit);
  }
  return rows;
}

async function getChapterChunks(ch: SyllabusChapter): Promise<AuditChunk[]> {
  const r = await rpc('get_chapter_rag_content', {
    p_grade: ch.grade, // P5: string grade
    p_subject: ch.subject_code,
    p_chapter_number: ch.chapter_number,
  });
  if (r.status !== 200) throw new Error(`get_chapter_rag_content failed ${r.status}: ${r.body.slice(0, 200)}`);
  const rows = JSON.parse(r.body) as Array<{ chunk_id: string; chunk_text: string; content_type: string | null }>;
  return rows.map((x) => ({ chunk_id: x.chunk_id, chunk_text: x.chunk_text, content_type: x.content_type }));
}

async function getKnownConcepts(ch: SyllabusChapter): Promise<string[]> {
  const r = await rest(
    `chapter_concepts?grade=eq.${ch.grade}&subject=eq.${ch.subject_code}&chapter_number=eq.${ch.chapter_number}&is_active=is.true&select=title&order=concept_number`,
  );
  if (r.status !== 200) return [];
  return (JSON.parse(r.body) as Array<{ title: string }>).map((x) => x.title).filter(Boolean);
}

// ─── OpenAI call (house pattern: retry/backoff, JSON mode, 90s timeout) ──────

async function callModel(systemPrompt: string, userMessage: string): Promise<{ ok: true; text: string; inputTokens: number; outputTokens: number } | { ok: false; error: string }> {
  let lastError = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(`${API_BASE_URL}/chat/completions`, {
        signal: controller.signal,
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.3, // factual counting — never above 0.7 (P12 posture)
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        lastError = `HTTP ${res.status}: ${b.slice(0, 300)}`;
        if (res.status === 401 || res.status === 403) return { ok: false, error: lastError };
        await sleep(2000 * Math.pow(2, attempt));
        continue;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) {
        lastError = 'empty completion';
        await sleep(1500);
        continue;
      }
      if (data.choices?.[0]?.finish_reason === 'length') {
        lastError = 'output truncated at max_tokens';
        await sleep(1500);
        continue;
      }
      return {
        ok: true,
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return { ok: false, error: lastError };
}

// ─── Scan-spec executor (question_bank + generated-content scans) ────────────

function filterToQuery(f: { column: string; op: string; value: unknown; valueFrom?: string; columns?: [string, string] }, captured: Map<string, string[]>): string | null {
  if (f.op === 'eq') return `${f.column}=eq.${encodeURIComponent(String(f.value))}`;
  if (f.op === 'ilike') return `${f.column}=ilike.${encodeURIComponent(String(f.value))}`;
  if (f.op === 'in') {
    const vals = f.valueFrom ? captured.get(f.valueFrom) ?? [] : (f.value as string[]);
    if (vals.length === 0) return null; // empty IN — caller short-circuits to 0
    return `${f.column}=in.(${vals.map((v) => encodeURIComponent(v)).join(',')})`;
  }
  if (f.op === 'either_in') {
    const vals = (f.valueFrom ? captured.get(f.valueFrom) : (f.value as string[])) ?? [];
    if (vals.length === 0 || !f.columns) return null;
    const list = vals.slice(0, 200).join(','); // keep URL sane
    return `or=(${f.columns[0]}.in.(${list}),${f.columns[1]}.in.(${list}))`;
  }
  return null;
}

/** Execute a ScanSpec: returns found count + up to 5 evidence ids. */
async function executeScanSpec(spec: ScanSpec): Promise<{ found: number; evidence: string[]; note: string | null }> {
  if (spec.steps.length === 0) return { found: 0, evidence: [], note: spec.note ?? null };
  const captured = new Map<string, string[]>();
  let found = 0;
  let evidence: string[] = [];
  for (const step of spec.steps) {
    const parts: string[] = [];
    let emptyIn = false;
    for (const f of step.filters) {
      const q = filterToQuery(f, captured);
      if (q === null && (f.op === 'in' || f.op === 'either_in')) { emptyIn = true; break; }
      if (q) parts.push(q);
    }
    if (emptyIn) return { found: 0, evidence: [], note: `${spec.note ?? ''} upstream projection empty`.trim() };
    const isLast = step === spec.steps[spec.steps.length - 1];
    const limit = step.captureIdsAs ? 500 : 5;
    const r = await rest(`${step.table}?${parts.join('&')}&select=${step.select}&limit=${limit}`, {
      headers: { Prefer: 'count=exact' },
    });
    if (r.status !== 200 && r.status !== 206) {
      return { found: 0, evidence: [], note: `scan failed on ${step.table} (HTTP ${r.status}) — recorded 0` };
    }
    const rows = JSON.parse(r.body) as Array<{ id: string }>;
    const contentRange = r.headers.get('content-range'); // e.g. "0-4/123"
    const total = contentRange?.includes('/') ? parseInt(contentRange.split('/')[1], 10) : rows.length;
    if (step.captureIdsAs) captured.set(step.captureIdsAs, rows.map((x) => x.id));
    if (isLast) {
      found = Number.isFinite(total) ? total : rows.length;
      evidence = rows.slice(0, 5).map((x) => x.id);
    }
  }
  return { found, evidence, note: spec.note ?? null };
}

// ─── Upsert ──────────────────────────────────────────────────────────────────

async function upsertRows(rows: InventoryRow[]): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    syllabus_id: r.syllabus_id,
    dimension: r.dimension,
    expected_count: r.expected_count,
    found_count: r.found_count,
    coverage_pct: r.coverage_pct,
    evidence: r.evidence, // chunk/question IDs ONLY (P13)
    audit_method: r.audit_method,
    suspected_missing: r.suspected_missing,
    audited_at: now,
  }));
  const r = await rest('chapter_asset_inventory?on_conflict=syllabus_id,dimension', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  });
  if (r.status >= 200 && r.status < 300) return { ok: true };
  return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 300)}` };
}

// ─── Per-chapter pipeline ────────────────────────────────────────────────────

interface ChapterOutcome {
  chapter: SyllabusChapter;
  status: 'audited' | 'skipped_no_chunks' | 'failed';
  rowsWritten: number;
  reasons: string[];
  inputTokens: number;
  outputTokens: number;
}

async function auditChapter(args: Args, ch: SyllabusChapter, fixture: GroundTruthFixture | null): Promise<ChapterOutcome> {
  const out: ChapterOutcome = { chapter: ch, status: 'failed', rowsWritten: 0, reasons: [], inputTokens: 0, outputTokens: 0 };

  const chunks = await getChapterChunks(ch);
  if (chunks.length === 0) {
    out.status = 'skipped_no_chunks';
    out.reasons.push('no rag chunks');
    return out;
  }
  const knownConcepts = await getKnownConcepts(ch);

  const systemPrompt = buildAuditSystemPrompt({
    grade: ch.grade,
    subject: ch.subject_code,
    chapterNumber: ch.chapter_number,
    chapterTitle: ch.chapter_title,
  });
  const userMessage = buildAuditUserMessage(chunks, knownConcepts);
  console.error(`    est. input tokens ~${estimateTokens(systemPrompt, userMessage)} (${chunks.length} chunks, ${knownConcepts.length} known concepts)`);

  // LLM chunk pass (one extra full retry on parse failure)
  const chunkIds = chunks.map((c) => c.chunk_id);
  let parsed: ReturnType<typeof parseAuditResponse> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const gen = await callModel(systemPrompt, userMessage);
    if (!gen.ok) {
      out.reasons.push(`model call failed: ${gen.error}`);
      return out;
    }
    out.inputTokens += gen.inputTokens;
    out.outputTokens += gen.outputTokens;
    parsed = parseAuditResponse(gen.text, chunkIds);
    if (parsed.ok) break;
    console.error(`    parse failed (attempt ${attempt + 1}/2): ${parsed.error}`);
    await sleep(1500);
  }
  if (!parsed || !parsed.ok) {
    out.reasons.push('unparseable model response after retries');
    return out;
  }

  // Assemble all 31 rows
  const ref: ChapterRef = { grade: ch.grade, subject: ch.subject_code, chapterNumber: ch.chapter_number };
  const rows: InventoryRow[] = buildChunkPassRows({ syllabusId: ch.id, parsed, chunks });

  for (const dim of QUESTION_BANK_SCAN_DIMENSIONS) {
    const res = await executeScanSpec(buildQuestionBankFilterSpec(dim, ref));
    rows.push({
      syllabus_id: ch.id, dimension: dim, expected_count: null, found_count: res.found,
      coverage_pct: null, evidence: res.evidence, audit_method: 'question_bank_scan',
      suspected_missing: res.note ? [res.note] : [],
    });
  }
  for (const dim of GENERATED_CONTENT_SCAN_DIMENSIONS) {
    const res = await executeScanSpec(buildGeneratedContentFilterSpec(dim, ref));
    rows.push({
      syllabus_id: ch.id, dimension: dim, expected_count: null, found_count: res.found,
      coverage_pct: null, evidence: res.evidence, audit_method: 'generated_content_scan',
      suspected_missing: res.note ? [res.note] : [],
    });
  }

  if (rows.length !== ALL_DIMENSIONS.length) {
    out.reasons.push(`internal: assembled ${rows.length} rows, expected ${ALL_DIMENSIONS.length}`);
    return out;
  }

  // Pilot check (agreement matrix vs ground truth) — reporting only
  if (args.pilotCheck) {
    if (!fixture) {
      console.error(`    pilot-check: fixture ${FIXTURE_PATH} not found — pilot run PENDING`);
    } else {
      const truth = findGroundTruthChapter(fixture, ref);
      if (!truth) {
        console.error('    pilot-check: no ground-truth entry for this chapter — skipped');
      } else {
        const engineCounts = Object.fromEntries(rows.map((r) => [r.dimension, r.found_count])) as Partial<Record<Dimension, number>>;
        console.error(formatAgreementMatrix(compareAgainstGroundTruth(engineCounts, truth)));
      }
    }
  }

  if (args.dryRun) {
    out.status = 'audited';
    out.rowsWritten = 0;
    out.reasons.push('DRY RUN — not written');
    console.error(JSON.stringify(rows.map((r) => ({ dim: r.dimension, found: r.found_count, expected: r.expected_count, cov: r.coverage_pct, method: r.audit_method })), null, 2));
    return out;
  }

  const ins = await upsertRows(rows);
  if (!ins.ok) {
    out.reasons.push(`upsert failed: ${ins.error}`);
    return out;
  }
  out.status = 'audited';
  out.rowsWritten = rows.length;
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
  if (!OPENAI_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(2); }

  let fixture: GroundTruthFixture | null = null;
  if (args.pilotCheck && existsSync(FIXTURE_PATH)) {
    try {
      fixture = normalizeGroundTruthFixture(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
      if (!fixture) console.error('pilot-check: fixture present but structurally unusable — pilot run PENDING');
    } catch (e) {
      console.error(`pilot-check: fixture unreadable (${e instanceof Error ? e.message : String(e)}) — pilot run PENDING`);
    }
  }

  const chapters = await enumerateChapters(args);
  console.error(`\n=== Knowledge audit (chunk pass) — model ${MODEL} — ${chapters.length} chapter(s)${args.dryRun ? ' | DRY RUN' : ''} ===\n`);

  const outcomes: ChapterOutcome[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let counter = 0;

  for (const ch of chapters) {
    counter++;
    process.stderr.write(`  [${counter}/${chapters.length}] grade ${ch.grade} ${ch.subject_code} ch${ch.chapter_number} "${ch.chapter_title}"\n`);
    let res: ChapterOutcome;
    try {
      res = await auditChapter(args, ch, fixture);
    } catch (e) {
      res = { chapter: ch, status: 'failed', rowsWritten: 0, reasons: [`exception: ${e instanceof Error ? e.message : String(e)}`], inputTokens: 0, outputTokens: 0 };
    }
    outcomes.push(res);
    totalIn += res.inputTokens;
    totalOut += res.outputTokens;
    console.error(`    → ${res.status}${res.rowsWritten ? ` (${res.rowsWritten} rows)` : ''}${res.reasons.length ? ` — ${res.reasons[0]}` : ''}`);
    await sleep(800); // rate-limit friendliness
  }

  const audited = outcomes.filter((o) => o.status === 'audited');
  const failed = outcomes.filter((o) => o.status === 'failed');
  console.error('\n===================== SUMMARY =====================');
  console.error(`Chapters: ${outcomes.length} | audited: ${audited.length} | skipped(no chunks): ${outcomes.filter((o) => o.status === 'skipped_no_chunks').length} | failed: ${failed.length}`);
  console.error(`Rows written: ${outcomes.reduce((a, o) => a + o.rowsWritten, 0)}`);
  console.error(`Tokens: input=${totalIn} output=${totalOut} (~$${((totalIn / 1e6) * 0.15 + (totalOut / 1e6) * 0.6).toFixed(4)} at ${MODEL} rates)`);
  for (const f of failed) console.error(`  FAILED: grade ${f.chapter.grade} ${f.chapter.subject_code} ch${f.chapter.chapter_number}: ${f.reasons[0]}`);
  console.error('===================================================\n');
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
