/**
 * ALFANUMRIK — Content Gap Checker
 *
 * Checks RAG content and question bank coverage across all subjects/grades.
 * Run: npx tsx scripts/check-content-gaps.ts
 *      npx tsx scripts/check-content-gaps.ts --json   # machine-readable
 *      npx tsx scripts/check-content-gaps.ts --dry-run  # validate query
 *                                                       shapes without
 *                                                       executing them
 *
 * Phase 3.3 (Truthful Measurement) additions:
 *   - The CI nightly workflow (.github/workflows/content-quality-nightly.yml)
 *     runs this in --json mode and uploads the report.
 *   - Exit code 1 = catastrophic gap (chapter has 0 chunks AND 0 questions)
 *     — this fails the nightly CI red gate.
 *   - Exit code 2 = below P3 readiness floor (warn but pass).
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 2026-08-11 — TWO DETECTOR DEFECTS FIXED. READ BEFORE CHANGING THE KEYS.
 *
 * (1) COLUMN CHOICE — the detector must count what retrieval can actually see.
 *
 *     `rag_content_chunks` stores grade and subject TWICE, in two notations:
 *
 *       | column        | example         | read by                         |
 *       |---------------|-----------------|---------------------------------|
 *       | grade         | 'Grade 10'      | legacy match_rag_chunks         |
 *       | grade_short   | '10'            | match_rag_chunks_ncert (LIVE)   |
 *       | subject       | 'Mathematics'   | legacy match_rag_chunks         |
 *       | subject_code  | 'math'          | match_rag_chunks_ncert (LIVE)   |
 *
 *     The production retrieval path — Foxy (`/api/foxy`), `grounded-answer`
 *     and `quiz-generator` — all go through `match_rag_chunks_ncert`, whose
 *     body filters `c.subject_code = p_subject_code AND c.grade_short =
 *     p_grade` (verified in 00000000000000_baseline_from_prod.sql, and in its
 *     own COMMENT: "snake_case subject_code, P5 grade_short"). Only
 *     `/api/concept-engine` still calls the legacy `match_rag_chunks`.
 *
 *     This script therefore reads the CANONICAL pair (`subject_code`,
 *     `grade_short`). It deliberately does NOT translate 'math' ->
 *     'Mathematics' to chase the legacy columns: a chunk that is present in
 *     the legacy columns but has a NULL `subject_code` is INVISIBLE to the
 *     live retriever, so counting it as present would make this detector lie
 *     in the optimistic direction — the one direction that matters.
 *
 *     NULL-ATTRIBUTION IS ITS OWN SIGNAL. The corpus was built by a legacy
 *     ingestion tool no longer in the codebase (scripts/ncert-ingestion/
 *     CLAUDE.md), so some rows may carry NULL `subject_code`/`grade_short`.
 *     Those rows are counted in `ragUnattributed` and EXCLUDED from every
 *     per-pair bucket, because that is exactly what the retriever does. A
 *     high `ragUnattributed` is a backfill task, not a content-generation
 *     task, and is usually the most actionable number in this report.
 *
 *     `question_bank` has no second notation: `subject` is FK'd to
 *     `subjects.code` (snake_case) and `grade` carries the P5 CHECK
 *     `chk_question_bank_grade_p5` = '6'..'12' — a BARE grade string. The
 *     previous version of this script bucketed it as `"<subject>|Grade <n>"`,
 *     which could never match a single row. That was a second, independent
 *     all-zeros defect on the question_bank side that had not been noticed.
 *
 * (2) PAGINATION — counts must not be silently truncated.
 *
 *     PostgREST caps a bare `.select()` at the project's `db-max-rows`
 *     (commonly 1000). The corpus is ~16,000 chunks, so truncation was the
 *     EXPECTED state, not a hypothetical. Truncation under-reports, which
 *     inflates gaps; and `scripts/content-gap-verdict.mjs` suppresses
 *     escalation whenever a total lands on a suspect page cap — so while
 *     truncation was happening, a GENUINE catastrophic gap was also
 *     permanently suppressed. `fetchAllRows()` below takes an authoritative
 *     server-side `count: 'exact'` first, then pages with `.range()` until it
 *     has that many rows, and reports `paginationComplete` so the verdict
 *     script can stop guessing from round numbers.
 *
 * THRESHOLDS BELOW ARE ASSESSMENT-OWNED CONTENT POLICY AND WERE NOT TOUCHED.
 * This file remains strictly read-only: SELECT only, no RPC, no writes.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Configuration ──────────────────────────────────────────
// Floors are aligned to P3 quiz/RAG readiness thresholds described in
// CLAUDE.md. Subject codes must match question_bank.subject column (lowercase
// codes from SUBJECT_META). Grades are strings per P5.
//
// `minChunks`: P3 RAG-readiness floor for the (subject, grade) pair.
// `minQuestions`: P3 quiz-readiness floor for the (subject, grade) pair.
export const TARGET_SUBJECTS: ReadonlyArray<{
  subject: string;
  grades: ReadonlyArray<string>;
  minChunks: number;
  minQuestions: number;
}> = [
  { subject: 'math', grades: ['6','7','8','9','10','11','12'], minChunks: 100, minQuestions: 100 },
  { subject: 'science', grades: ['6','7','8','9','10'], minChunks: 100, minQuestions: 100 },
  { subject: 'physics', grades: ['11','12'], minChunks: 100, minQuestions: 50 },
  { subject: 'chemistry', grades: ['11','12'], minChunks: 100, minQuestions: 50 },
  { subject: 'biology', grades: ['11','12'], minChunks: 50, minQuestions: 50 },
  { subject: 'english', grades: ['6','7','8','9','10'], minChunks: 20, minQuestions: 30 },
  { subject: 'hindi', grades: ['6','7','8','9','10'], minChunks: 20, minQuestions: 30 },
  { subject: 'social_studies', grades: ['6','7','8','9','10'], minChunks: 20, minQuestions: 30 },
  { subject: 'economics', grades: ['11','12'], minChunks: 20, minQuestions: 30 },
  { subject: 'accountancy', grades: ['11','12'], minChunks: 20, minQuestions: 30 },
  { subject: 'business_studies', grades: ['11','12'], minChunks: 20, minQuestions: 30 },
  { subject: 'political_science', grades: ['11','12'], minChunks: 20, minQuestions: 20 },
  { subject: 'computer_science', grades: ['11','12'], minChunks: 20, minQuestions: 20 },
];

/** Minimal data shape this script reads from rag_content_chunks + question_bank.
 *  Exported so the unit test can assert query field selection.
 *
 *  P13: only non-PII taxonomy columns are ever selected. No student data, no
 *  free text, no ids leave the database. */
export const QUERY_SHAPES = {
  rag_content_chunks: {
    table: 'rag_content_chunks',
    // CANONICAL pair. This is what match_rag_chunks_ncert filters on, i.e.
    // what the live retriever can actually see. Do NOT switch this back to
    // the legacy `subject, grade` display-name pair — see the header.
    select: 'subject_code, grade_short',
    filter: { is_active: true },
  },
  question_bank: {
    // `subject` is FK -> subjects.code (snake_case); `grade` is a bare P5
    // grade string ('6'..'12') enforced by chk_question_bank_grade_p5.
    table: 'question_bank',
    select: 'subject, grade',
    filter: { is_active: true },
  },
} as const;

/** Raw row shapes, mirroring QUERY_SHAPES. */
export interface RagChunkRow {
  subject_code?: string | null;
  grade_short?: string | null;
}
export interface QuestionRow {
  subject?: string | null;
  grade?: string | null;
}

export interface GapRow {
  subject: string;
  grade: string;
  ragCount: number;
  questionCount: number;
  ragOk: boolean;
  questionOk: boolean;
  /** "Catastrophic" = chapter has 0 chunks AND 0 questions (P3 floor breach). */
  catastrophic: boolean;
}

export interface GapReport {
  rows: GapRow[];
  totalGaps: number;
  catastrophicGaps: number;
  /** Rows READ from each table (attributed + unattributed). */
  totalRagChunks: number;
  totalQuestions: number;
  /**
   * Rows carrying BOTH canonical columns — the only rows the live retriever
   * (match_rag_chunks_ncert) can return. `attributed + unattributed == total`.
   */
  ragAttributed: number;
  questionAttributed: number;
  /**
   * Rows with a NULL/blank canonical column. These are invisible to retrieval
   * and are deliberately NOT counted into any (subject, grade) bucket. A
   * non-zero value here is a backfill signal, not a content-generation signal.
   */
  ragUnattributed: number;
  questionUnattributed: number;
  /**
   * False when a paged read could not be completed (row count never reached
   * the server-side exact count). A false value means EVERY count below
   * under-reports and no gap conclusion may be drawn from this run.
   * Undefined only for reports produced before pagination existed.
   */
  paginationComplete?: boolean;
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const JSON_OUTPUT = args.includes('--json');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Normalise a taxonomy value to the canonical snake_case comparison form.
 * Trims, lowercases and collapses spaces/hyphens to underscores so that
 * 'Social Studies', 'social-studies' and 'social_studies' all agree. This is
 * defensive only — the canonical columns should already be snake_case.
 */
function normSubject(v: string): string {
  return v.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Normalise a grade to the bare P5 string. Accepts '10', 'Grade 10', 'grade10'
 * and returns '10'. Returns '' when no digits are present, which callers treat
 * as unattributed. Never returns a number — grades are strings (P5).
 */
function normGrade(v: string): string {
  const digits = v.replace(/[^0-9]/g, '');
  return digits;
}

/** Build the gap report from raw rows. Exported for unit testing. */
export function buildGapReport(
  ragRows: ReadonlyArray<RagChunkRow>,
  questionRows: ReadonlyArray<QuestionRow>,
  opts: { paginationComplete?: boolean } = {},
): GapReport {
  // ── rag_content_chunks: bucket on the CANONICAL (subject_code, grade_short)
  // pair. Rows missing either canonical column are unattributed: invisible to
  // match_rag_chunks_ncert, therefore not counted as coverage.
  const ragCounts = new Map<string, number>();
  let ragUnattributed = 0;
  for (const r of ragRows) {
    const subject = r.subject_code ? normSubject(r.subject_code) : '';
    const grade = r.grade_short ? normGrade(r.grade_short) : '';
    if (!subject || !grade) {
      ragUnattributed++;
      continue;
    }
    const key = `${subject}|${grade}`;
    ragCounts.set(key, (ragCounts.get(key) || 0) + 1);
  }

  // ── question_bank: `subject` is already a subjects.code, `grade` is already
  // a bare P5 grade string. Normalised anyway for case/format resilience.
  const qCounts = new Map<string, number>();
  let questionUnattributed = 0;
  for (const r of questionRows) {
    const subject = r.subject ? normSubject(r.subject) : '';
    const grade = r.grade ? normGrade(r.grade) : '';
    if (!subject || !grade) {
      questionUnattributed++;
      continue;
    }
    const key = `${subject}|${grade}`;
    qCounts.set(key, (qCounts.get(key) || 0) + 1);
  }

  const rows: GapRow[] = [];
  let totalGaps = 0;
  let catastrophicGaps = 0;

  for (const t of TARGET_SUBJECTS) {
    for (const g of t.grades) {
      // Both sides now share one key shape: '<snake_case_subject>|<bare grade>'.
      const key = `${normSubject(t.subject)}|${g}`;
      const ragCount = ragCounts.get(key) || 0;
      const qCount = qCounts.get(key) || 0;
      const ragOk = ragCount >= t.minChunks;
      const questionOk = qCount >= t.minQuestions;
      const catastrophic = ragCount === 0 && qCount === 0;
      if (!ragOk || !questionOk) totalGaps++;
      if (catastrophic) catastrophicGaps++;
      rows.push({ subject: t.subject, grade: g, ragCount, questionCount: qCount, ragOk, questionOk, catastrophic });
    }
  }

  return {
    rows,
    totalGaps,
    catastrophicGaps,
    totalRagChunks: ragRows.length,
    totalQuestions: questionRows.length,
    ragAttributed: ragRows.length - ragUnattributed,
    questionAttributed: questionRows.length - questionUnattributed,
    ragUnattributed,
    questionUnattributed,
    ...(opts.paginationComplete === undefined ? {} : { paginationComplete: opts.paginationComplete }),
  };
}

/** Rows requested per `.range()` page. */
export const PAGE_SIZE = 1000;

/**
 * Hard stop on the page loop so a pathological server response (e.g. a range
 * that always returns the same slice) can never spin forever inside a nightly.
 * 2,000 pages x 1,000 rows = 2,000,000 rows, ~100x the current corpus.
 */
export const MAX_PAGES = 2000;

/**
 * Page an entire table through PostgREST.
 *
 * WHY NOT A BARE `.select()`: PostgREST truncates at the project's
 * `db-max-rows` (commonly 1000). With ~16,000 chunks, truncation was the
 * normal case, and a truncated read under-reports every count.
 *
 * WHY NOT ASSUME PAGE_SIZE: if `db-max-rows` is SMALLER than PAGE_SIZE, a
 * naive "short page means end of table" loop stops early and confidently
 * reports a complete read that is not. So we take an authoritative
 * server-side `count: 'exact'` first and advance by the OBSERVED batch length
 * until we hold that many rows. `complete` is only true when we do.
 *
 * Read-only: SELECT with a filter, no RPC, no writes.
 *
 * Exported so the unit suite can drive it against a stub client — pagination
 * correctness is the whole point and must not be verified only in production.
 */
export async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
): Promise<{ rows: T[]; complete: boolean; expected: number }> {
  const { count, error: countError } = await supabase
    .from(table)
    .select(select, { count: 'exact', head: true })
    .eq('is_active', true);

  if (countError) {
    throw new Error(`${table}: exact count failed — ${countError.message}`);
  }
  const expected = count ?? 0;

  const rows: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (rows.length >= expected) break;
    const { data, error } = await supabase
      .from(table)
      .select(select)
      // MUST match the filter used for the exact count above. If the page
      // query is unfiltered while the count is filtered, the loop reads
      // inactive rows into the buckets and terminates on the wrong total —
      // inflating coverage, which is the one direction that hurts.
      .eq('is_active', true)
      // Stable ordering is REQUIRED for correct paging. Without it PostgREST
      // may return overlapping/omitted slices across pages.
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${table}: page ${page} (from=${from}) failed — ${error.message}`);
    }
    const batch = (data || []) as T[];
    // A zero-length page before reaching `expected` means the server will not
    // give us the rest (e.g. a filter/visibility difference). Stop and let
    // `complete` report false rather than silently under-counting.
    if (batch.length === 0) break;
    rows.push(...batch);
    from += batch.length;
  }

  return { rows, complete: rows.length >= expected, expected };
}

/**
 * Fetch raw rag_content_chunks + question_bank rows. In --dry-run mode this
 * is skipped entirely so the script can be exercised in CI without a live DB.
 */
async function fetchRows(supabase: SupabaseClient): Promise<{
  ragRows: RagChunkRow[];
  questionRows: QuestionRow[];
  paginationComplete: boolean;
  expectedRagRows: number;
  expectedQuestionRows: number;
}> {
  const rag = await fetchAllRows<RagChunkRow>(
    supabase,
    QUERY_SHAPES.rag_content_chunks.table,
    QUERY_SHAPES.rag_content_chunks.select,
  );
  const questions = await fetchAllRows<QuestionRow>(
    supabase,
    QUERY_SHAPES.question_bank.table,
    QUERY_SHAPES.question_bank.select,
  );

  return {
    ragRows: rag.rows,
    questionRows: questions.rows,
    paginationComplete: rag.complete && questions.complete,
    expectedRagRows: rag.expected,
    expectedQuestionRows: questions.expected,
  };
}

function printText(report: GapReport): void {
  console.log('Subject          | Grade | RAG Chunks | Questions | RAG Status    | Q Status');
  console.log('-----------------|-------|------------|-----------|---------------|----------');
  for (const r of report.rows) {
    const ragStatus = r.ragOk ? 'OK' : r.ragCount > 0 ? 'LOW' : 'MISSING';
    const qStatus = r.questionOk ? 'OK' : r.questionCount > 0 ? 'LOW' : 'MISSING';
    const subj = r.subject.padEnd(16);
    const grade = r.grade.padEnd(5);
    console.log(`${subj} | ${grade} | ${String(r.ragCount).padStart(10)} | ${String(r.questionCount).padStart(9)} | ${ragStatus.padEnd(13)} | ${qStatus}`);
  }
  console.log(`\nTotal gaps: ${report.totalGaps}`);
  console.log(`Catastrophic gaps (0 chunks AND 0 questions): ${report.catastrophicGaps}`);
  console.log(`Total RAG chunks read: ${report.totalRagChunks}`);
  console.log(
    `  retrievable (subject_code + grade_short present): ${report.ragAttributed}`,
  );
  console.log(
    `  UNATTRIBUTED (NULL canonical column — invisible to retrieval): ${report.ragUnattributed}`,
  );
  console.log(`Total questions read: ${report.totalQuestions}`);
  console.log(`  bucketable (subject + grade present): ${report.questionAttributed}`);
  console.log(`  UNATTRIBUTED: ${report.questionUnattributed}`);
  console.log(
    `Pagination complete: ${report.paginationComplete === false ? 'NO — counts under-report, do not act on them' : 'yes'}\n`,
  );
}

async function main(): Promise<void> {
  if (DRY_RUN) {
    // Validate query shapes without hitting the network. Useful for
    // smoke-testing the script in CI without DB credentials.
    const fakeReport = buildGapReport([], []);
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ dryRun: true, queryShapes: QUERY_SHAPES, sampleReport: fakeReport }, null, 2));
    } else {
      console.log('check-content-gaps: --dry-run OK');
      console.log('Query shapes:', JSON.stringify(QUERY_SHAPES, null, 2));
      console.log(`Target pairs: ${TARGET_SUBJECTS.reduce((n, t) => n + t.grades.length, 0)}`);
    }
    process.exit(0);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { ragRows, questionRows, paginationComplete, expectedRagRows, expectedQuestionRows } =
    await fetchRows(supabase);
  const report = buildGapReport(ragRows, questionRows, { paginationComplete });

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ ...report, expectedRagRows, expectedQuestionRows }, null, 2));
  } else {
    console.log('\nALFANUMRIK CONTENT GAP REPORT\n');
    printText(report);
  }

  // Exit code policy:
  //   0 = healthy
  //   1 = catastrophic (any chapter at 0 chunks AND 0 questions) — fails CI
  //   2 = below P3 floor (warn, but not fail)
  //
  // An incomplete paged read under-reports every count, which INFLATES gaps.
  // Do not emit a catastrophic exit code off numbers we know are short —
  // report it as a floor-level warning and let the verdict script surface the
  // truncation explicitly.
  if (!paginationComplete) {
    console.error(
      `Paged read incomplete (rag ${ragRows.length}/${expectedRagRows}, questions ${questionRows.length}/${expectedQuestionRows}). Counts under-report; not emitting a catastrophic exit code.`,
    );
    process.exit(2);
  }
  if (report.catastrophicGaps > 0) {
    process.exit(1);
  }
  if (report.totalGaps > 0) {
    process.exit(2);
  }
  process.exit(0);
}

// Detect if this file is the entry-point. When imported by tests we do NOT
// auto-run main(). Vitest sets process.env.VITEST so we guard on that.
const isCli =
  !process.env.VITEST &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].includes('check-content-gaps');

if (isCli) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
