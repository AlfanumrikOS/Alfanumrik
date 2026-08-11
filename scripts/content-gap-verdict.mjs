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
 * PostgREST paginates. scripts/check-content-gaps.ts issues a bare .select()
 * with no .range() loop, so if the project's `db-max-rows` is set, the row set
 * is silently truncated at a round number and every count under-reports. A
 * truncated read must never be allowed to look like a content catastrophe.
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

// ── Detector-sanity checks (run BEFORE believing a catastrophe) ─────────────

/**
 * Rows were fetched from rag_content_chunks, yet not one of them landed in any
 * (subject, grade) bucket. That is a key-mapping bug, not an empty corpus.
 * Known cause: the script keys on snake_case subject codes ('math') while
 * rag_content_chunks.subject stores display names ('Mathematics').
 */
const ragKeyMismatch = totalRagChunks > 0 && rows.every((r) => Number(r.ragCount || 0) === 0);

/** Same shape, question_bank side. */
const questionKeyMismatch = totalQuestions > 0 && rows.every((r) => Number(r.questionCount || 0) === 0);

const truncated = SUSPECT_PAGE_CAPS.has(totalRagChunks) || SUSPECT_PAGE_CAPS.has(totalQuestions);

const detectorFault = ragKeyMismatch || questionKeyMismatch;

// ── Classify ────────────────────────────────────────────────────────────────
let verdict;
if (detectorFault) verdict = 'DETECTOR_FAULT';
else if (catastrophicGaps > 0) verdict = 'CATASTROPHIC';
else if (totalGaps > 0) verdict = 'BELOW_FLOOR';
else verdict = 'HEALTHY';

// Escalation is allowed ONLY for a trustworthy catastrophic reading, and only
// when the operator has explicitly opted in via the CONTENT_GAP_MODE variable.
const escalate = verdict === 'CATASTROPHIC' && !truncated && MODE === 'escalate';

const HEADLINE = {
  DETECTOR_FAULT: 'DETECTOR FAULT — report is not trustworthy',
  CATASTROPHIC: 'CATASTROPHIC CONTENT GAP',
  BELOW_FLOOR: 'below readiness floor (advisory)',
  HEALTHY: 'healthy',
};

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
  `| Rows read from question_bank | ${totalQuestions} |`,
  `| Pairs below floor | ${totalGaps} / ${rows.length} |`,
  `| Catastrophic pairs (0 chunks AND 0 questions) | **${catastrophicGaps}** |`,
  `| check-content-gaps exit code | \`${SCRIPT_EXIT || 'unknown'}\` |`,
  '',
];

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
    'Known cause: `scripts/check-content-gaps.ts` keys on snake_case subject',
    "codes (`'math'`, `'social_studies'`) while production",
    "`rag_content_chunks.subject` stores display names (`'Mathematics'`,",
    "`'Social Studies'`). The SQL RPCs in the baseline migration map between the",
    'two before comparing; this script does not.',
    '',
    '**Escalation is suppressed** for this verdict so a mapping bug can never',
    'masquerade as an empty question bank. Fix the normaliser, then re-run.',
    '',
    'Triage: `docs/runbooks/content-gap-detection.md`.',
    '',
  );
}

if (truncated) {
  lines.push(
    '## Possible truncated read',
    '',
    `Row counts (\`${totalRagChunks}\` / \`${totalQuestions}\`) sit exactly on a`,
    'PostgREST page boundary. `check-content-gaps.ts` issues a bare `.select()`',
    'with no `.range()` pagination loop, so counts may be silently truncated and',
    'under-report coverage. **Escalation is suppressed** for this run.',
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
