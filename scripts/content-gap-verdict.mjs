#!/usr/bin/env node
/**
 * Content-gap verdict renderer for .github/workflows/content-quality-nightly.yml.
 *
 * Reads the --json output of scripts/check-content-gaps.ts, classifies it, writes
 * a markdown report + GitHub step summary, and decides whether the nightly should
 * escalate (go red) or stay report-only.
 *
 * WHY THIS EXISTS AS A SEPARATE FILE
 * ----------------------------------
 * This logic used to be an inline `node -e` blob in the workflow YAML. It is now
 * a real file so it can be read, reviewed and unit-tested, and so a rendering
 * crash produces a normal stack trace instead of a cryptic YAML-quoting failure.
 *
 * IT DOES NOT AND MUST NOT CHANGE THE THRESHOLDS.
 * The per-(subject, grade) floors in scripts/check-content-gaps.ts are
 * assessment-owned content policy. This file only interprets the report the
 * script already produced.
 *
 * Usage:  node scripts/content-gap-verdict.mjs <gaps.json> <gaps.md>
 * Env:    SCRIPT_EXIT        exit code of check-content-gaps.ts (0 | 1 | 2)
 *         CONTENT_GAP_MODE   'report' (default) | 'escalate'
 *         CRED_KIND          'readonly' | 'fallback-elevated'
 * Exit:   0 always for data conditions; non-zero only when the DETECTOR itself
 *         is broken (unreadable report), because a blind detector that looks
 *         green is worse than no detector.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const [, , jsonPath, mdPath] = process.argv;

if (!jsonPath || !mdPath) {
  console.error('Usage: node scripts/content-gap-verdict.mjs <gaps.json> <gaps.md>');
  process.exit(2);
}

const MODE = (process.env.CONTENT_GAP_MODE || 'report').trim().toLowerCase();
const SCRIPT_EXIT = String(process.env.SCRIPT_EXIT ?? '').trim();
const CRED_KIND = (process.env.CRED_KIND || 'unknown').trim();

/**
 * LEGACY round-number heuristic, retained only for reports produced BEFORE
 * check-content-gaps.ts learned to paginate.
 *
 * History: the script used to issue a bare `.select()` with no `.range()`
 * loop, so PostgREST silently truncated the row set at the project's
 * `db-max-rows` and every count under-reported. This set guessed at that from
 * the total landing on a round number.
 *
 * The guess had a nasty second-order cost: because truncation suppresses
 * escalation, ANY genuine catastrophic gap was also permanently suppressed
 * whenever a total happened to sit on a cap. It converted a false-red into a
 * false-green for real gaps.
 *
 * As of 2026-08-11 the script paginates properly and reports
 * `paginationComplete` explicitly, so a legitimate corpus of exactly 10,000
 * rows no longer gets its escalation silently swallowed. The heuristic is
 * only consulted when that field is absent.
 */
const SUSPECT_PAGE_CAPS = new Set([1000, 10000, 100000]);

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  console.log(`[output] ${key}=${value}`);
}

function emit(lines) {
  const text = lines.join('\n') + '\n';
  writeFileSync(mdPath, text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
}

// ── Load the report ─────────────────────────────────────────────────────────
let report = null;
let parseError = null;
try {
  report = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (err) {
  parseError = err;
}

const hasRows = report && Array.isArray(report.rows) && report.rows.length > 0;

// DETECTOR_ERROR: the script did not produce a usable report at all. This is an
// infrastructure fault (bad credential, network, crash) — not a data condition.
// Fail in BOTH modes: a detector that cannot see must never report green.
if (!hasRows) {
  emit([
    '# Content gap nightly — DETECTOR ERROR',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'The content-gap script did not produce a readable JSON report, so **the',
    'question-bank health of this platform is currently UNKNOWN**, not healthy.',
    '',
    '| | |',
    '|---|---|',
    `| check-content-gaps exit code | \`${SCRIPT_EXIT || 'unknown'}\` |`,
    `| Report parse error | \`${parseError ? String(parseError.message) : 'report contained no rows'}\` |`,
    `| Credential kind | \`${CRED_KIND}\` |`,
    '',
    'Triage: `docs/runbooks/content-gap-detection.md`.',
  ]);
  setOutput('verdict', 'DETECTOR_ERROR');
  setOutput('escalate', 'false'); // the step below fails directly; do not double-report
  setOutput('catastrophic_count', '0');
  process.exit(1);
}

const rows = report.rows;
const totalRagChunks = Number(report.totalRagChunks || 0);
const totalQuestions = Number(report.totalQuestions || 0);
const catastrophicGaps = Number(report.catastrophicGaps || 0);
const totalGaps = Number(report.totalGaps || 0);

// Rows carrying both canonical taxonomy columns — the only rows the live
// retriever (match_rag_chunks_ncert) can ever return. Older reports predate
// these fields; fall back to the read total so they still classify.
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const ragAttributed = num(report.ragAttributed, totalRagChunks);
const questionAttributed = num(report.questionAttributed, totalQuestions);
const ragUnattributed = num(report.ragUnattributed, 0);
const questionUnattributed = num(report.questionUnattributed, 0);

// ── Detector-sanity checks (run BEFORE believing a catastrophe) ─────────────

/**
 * Attributed rows were fetched from rag_content_chunks, yet not one of them
 * landed in any (subject, grade) bucket. Rows cannot vanish — that is a
 * key-mapping bug, not an empty corpus.
 *
 * Measured against ATTRIBUTED rows, not rows read: a row with a NULL
 * `subject_code` legitimately belongs in no bucket, and counting it here
 * would misreport a backfill gap as a mapping bug.
 */
const ragKeyMismatch = ragAttributed > 0 && rows.every((r) => Number(r.ragCount || 0) === 0);

/** Same shape, question_bank side. */
const questionKeyMismatch =
  questionAttributed > 0 && rows.every((r) => Number(r.questionCount || 0) === 0);

/**
 * The whole corpus is present but invisible to retrieval: every row read is
 * missing a canonical column. Distinct from a mapping bug (the script is
 * reading the right columns; the DATA has no value in them) and distinct from
 * an empty question bank. It is a backfill task, and it must not be reported
 * as either of the other two.
 */
const unattributedCorpus = totalRagChunks > 0 && ragAttributed === 0;

/**
 * Truncation. Prefer the detector's own explicit attestation; only guess from
 * round numbers when reading a pre-pagination report.
 */
const truncated =
  typeof report.paginationComplete === 'boolean'
    ? report.paginationComplete === false
    : SUSPECT_PAGE_CAPS.has(totalRagChunks) || SUSPECT_PAGE_CAPS.has(totalQuestions);

const detectorFault = ragKeyMismatch || questionKeyMismatch;

// ── Classify ────────────────────────────────────────────────────────────────
let verdict;
if (detectorFault) verdict = 'DETECTOR_FAULT';
else if (unattributedCorpus) verdict = 'UNATTRIBUTED_CORPUS';
else if (catastrophicGaps > 0) verdict = 'CATASTROPHIC';
else if (totalGaps > 0) verdict = 'BELOW_FLOOR';
else verdict = 'HEALTHY';

// Escalation is allowed ONLY for a trustworthy catastrophic reading, and only
// when the operator has explicitly opted in via the CONTENT_GAP_MODE variable.
const escalate = verdict === 'CATASTROPHIC' && !truncated && MODE === 'escalate';

const HEADLINE = {
  DETECTOR_FAULT: 'DETECTOR FAULT — report is not trustworthy',
  UNATTRIBUTED_CORPUS: 'CORPUS PRESENT BUT INVISIBLE TO RETRIEVAL',
  CATASTROPHIC: 'CATASTROPHIC CONTENT GAP',
  BELOW_FLOOR: 'below readiness floor (advisory)',
  HEALTHY: 'healthy',
};

const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

const lines = [
  `# Content gap nightly — ${HEADLINE[verdict]}`,
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '| Metric | Value |',
  '|---|---|',
  `| Verdict | **${verdict}** |`,
  `| Mode | \`${MODE}\` ${MODE === 'report' ? '(report-only — nothing goes red for a data condition)' : '(escalating)'} |`,
  `| Escalating this run | ${escalate ? '**YES — workflow will fail**' : 'no'} |`,
  `| Credential kind | \`${CRED_KIND}\` |`,
  `| Rows read from rag_content_chunks | ${totalRagChunks} |`,
  `| &nbsp;&nbsp;↳ retrievable (\`subject_code\` + \`grade_short\` present) | ${ragAttributed} |`,
  `| &nbsp;&nbsp;↳ **unattributed** (NULL canonical column — invisible to retrieval) | **${ragUnattributed}** (${pct(ragUnattributed, totalRagChunks)}) |`,
  `| Rows read from question_bank | ${totalQuestions} |`,
  `| &nbsp;&nbsp;↳ **unattributed** | **${questionUnattributed}** (${pct(questionUnattributed, totalQuestions)}) |`,
  `| Paged read complete | ${truncated ? '**NO — counts under-report**' : 'yes'} |`,
  `| Pairs below floor | ${totalGaps} / ${rows.length} |`,
  `| Catastrophic pairs (0 chunks AND 0 questions) | **${catastrophicGaps}** |`,
  `| check-content-gaps exit code | \`${SCRIPT_EXIT || 'unknown'}\` |`,
  '',
];

// The single most actionable number in this report: chunks that exist but
// that no student query can ever reach.
if (ragUnattributed > 0 && verdict !== 'UNATTRIBUTED_CORPUS') {
  lines.push(
    '## Unattributed RAG chunks (backfill signal)',
    '',
    `${ragUnattributed} of ${totalRagChunks} active chunks (${pct(ragUnattributed, totalRagChunks)}) are missing`,
    '`subject_code` and/or `grade_short`. The live retriever',
    '(`match_rag_chunks_ncert`) filters on exactly those two columns, so these',
    'chunks are **invisible to Foxy, grounded-answer and quiz-generator** even',
    'though they are `is_active = true` and hold real text.',
    '',
    'They are deliberately **excluded** from the per-pair counts below — counting',
    'them would overstate coverage in the one direction that matters.',
    '',
    'This is a **backfill** task (populate the canonical columns from the legacy',
    '`subject`/`grade` display-name pair), not a content-generation task. It is',
    'usually far cheaper to fix than the gaps it manifests as.',
    '',
  );
}

if (detectorFault) {
  lines.push(
    '## Why this report is not trustworthy',
    '',
    ragKeyMismatch
      ? `- ${totalRagChunks} rows were read from \`rag_content_chunks\`, but **every** (subject, grade) pair bucketed to 0 chunks. Rows cannot vanish — the bucketing key is wrong, not the corpus.`
      : '',
    questionKeyMismatch
      ? `- ${totalQuestions} rows were read from \`question_bank\`, but **every** pair bucketed to 0 questions. Same class of fault.`
      : '',
    '',
    'The historical cause (fixed 2026-08-11) was a column-notation mismatch:',
    "the script keyed on snake_case subject codes (`'math'`) while reading the",
    "legacy `rag_content_chunks.subject` display-name column (`'Mathematics'`),",
    'and bucketed `question_bank` as `"<subject>|Grade <n>"` while that table',
    "stores a bare P5 grade string (`'10'`). The script now reads the canonical",
    '`subject_code`/`grade_short` pair — the same columns',
    '`match_rag_chunks_ncert` filters on — and compares bare grades on both',
    'sides. If this verdict has reappeared, the taxonomy has drifted again:',
    'diff the distinct values in those columns against `TARGET_SUBJECTS`.',
    '',
    '**Escalation is suppressed** for this verdict so a mapping bug can never',
    'masquerade as an empty question bank. Fix the mapping, then re-run.',
    '',
    'Triage: `docs/runbooks/content-gap-detection.md`.',
    '',
  );
}

if (verdict === 'UNATTRIBUTED_CORPUS') {
  lines.push(
    '## Every chunk read is invisible to retrieval',
    '',
    `All ${totalRagChunks} active \`rag_content_chunks\` rows are missing`,
    '`subject_code` and/or `grade_short`. The script is reading the right',
    'columns — the **data** has no values in them.',
    '',
    'Consequence: `match_rag_chunks_ncert` filters on exactly those two columns,',
    'so RAG grounding currently returns nothing for every (subject, grade). This',
    'is a total retrieval blackout, but it is **not** an empty question bank and',
    'must not be reported as one.',
    '',
    'Fix: backfill `subject_code`/`grade_short` from the legacy `subject`/`grade`',
    'display-name columns. **Escalation is suppressed** — this needs a migration',
    'by architect, not a content-generation run.',
    '',
    'Triage: `docs/runbooks/content-gap-detection.md`.',
    '',
  );
}

if (truncated) {
  lines.push(
    '## Truncated read — counts under-report',
    '',
    typeof report.paginationComplete === 'boolean'
      ? [
          'The detector reported `paginationComplete: false` — it could not page',
          'the full row set (rows read did not reach the server-side exact',
          'count). Every count in this report is short.',
        ].join(' ')
      : [
          `Row counts (\`${totalRagChunks}\` / \`${totalQuestions}\`) sit exactly on a`,
          'PostgREST page boundary, and this report predates the',
          '`paginationComplete` field, so truncation cannot be ruled out.',
        ].join(' '),
    '',
    'Truncation under-reports, which **inflates** gaps — it cannot manufacture a',
    'false green on healthy data. **Escalation is suppressed** for this run.',
    '',
    'Note the second-order cost of that suppression: while truncation is',
    'happening, a genuine catastrophic gap is suppressed too. Do not leave this',
    'state standing.',
    '',
  );
}

if (verdict === 'CATASTROPHIC') {
  lines.push(
    '## Catastrophic pairs (0 RAG chunks AND 0 questions)',
    '',
    '| Subject | Grade | Chunks | Questions |',
    '|---|---|---|---|',
    ...rows
      .filter((r) => r.catastrophic)
      .map((r) => `| ${r.subject} | ${r.grade} | ${r.ragCount} | ${r.questionCount} |`),
    '',
    'Every question generator on this platform is manual-only, so this number',
    'cannot recover on its own. Triage: `docs/runbooks/content-gap-detection.md`.',
    '',
  );
}

if (verdict === 'BELOW_FLOOR') {
  const below = rows.filter((r) => !r.ragOk || !r.questionOk);
  lines.push(
    '## Pairs below the readiness floor (advisory — never escalates)',
    '',
    '| Subject | Grade | Chunks | RAG | Questions | Q |',
    '|---|---|---|---|---|---|',
    ...below.map(
      (r) =>
        `| ${r.subject} | ${r.grade} | ${r.ragCount} | ${r.ragOk ? 'OK' : 'LOW'} | ${r.questionCount} | ${r.questionOk ? 'OK' : 'LOW'} |`,
    ),
    '',
  );
}

if (MODE === 'report' && verdict === 'CATASTROPHIC') {
  lines.push(
    '> **Note:** this run found a catastrophic gap but is in `report` mode, so it',
    "> concluded green. Set the repo variable `CONTENT_GAP_MODE` to `escalate` to",
    '> have this open a `pipeline-failure` issue automatically.',
    '',
  );
}

emit(lines);

setOutput('verdict', verdict);
setOutput('escalate', escalate ? 'true' : 'false');
setOutput('catastrophic_count', String(catastrophicGaps));

// Data conditions never fail this step. Escalation is performed by a later,
// explicit workflow step so the artifact upload runs first.
process.exit(0);
