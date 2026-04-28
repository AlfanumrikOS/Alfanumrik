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
 *  Exported so the unit test can assert query field selection. */
export const QUERY_SHAPES = {
  rag_content_chunks: { table: 'rag_content_chunks', select: 'subject, grade', filter: { is_active: true } },
  question_bank: { table: 'question_bank', select: 'subject, grade', filter: { is_active: true } },
} as const;

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
  totalRagChunks: number;
  totalQuestions: number;
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const JSON_OUTPUT = args.includes('--json');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Build the gap report from raw rows. Exported for unit testing. */
export function buildGapReport(
  ragRows: Array<{ subject?: string | null; grade?: string | null }>,
  questionRows: Array<{ subject?: string | null; grade?: string | null }>,
): GapReport {
  const ragCounts = new Map<string, number>();
  for (const r of ragRows) {
    if (!r.subject || !r.grade) continue;
    const key = `${r.subject}|${r.grade}`;
    ragCounts.set(key, (ragCounts.get(key) || 0) + 1);
  }

  const qCounts = new Map<string, number>();
  for (const r of questionRows) {
    if (!r.subject || !r.grade) continue;
    const key = `${r.subject.toLowerCase()}|${r.grade}`;
    qCounts.set(key, (qCounts.get(key) || 0) + 1);
  }

  const rows: GapRow[] = [];
  let totalGaps = 0;
  let catastrophicGaps = 0;

  for (const t of TARGET_SUBJECTS) {
    for (const g of t.grades) {
      const ragKey = `${t.subject}|Grade ${g}`;
      const qKey = `${t.subject.toLowerCase()}|Grade ${g}`;
      const ragCount = ragCounts.get(ragKey) || 0;
      const qCount = qCounts.get(qKey) || 0;
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
  };
}

/**
 * Fetch raw rag_content_chunks + question_bank rows. In --dry-run mode this
 * is skipped entirely so the script can be exercised in CI without a live DB.
 */
async function fetchRows(supabase: SupabaseClient): Promise<{
  ragRows: Array<{ subject: string | null; grade: string | null }>;
  questionRows: Array<{ subject: string | null; grade: string | null }>;
}> {
  const { data: ragData } = await supabase
    .from(QUERY_SHAPES.rag_content_chunks.table)
    .select(QUERY_SHAPES.rag_content_chunks.select)
    .eq('is_active', true);

  const { data: qData } = await supabase
    .from(QUERY_SHAPES.question_bank.table)
    .select(QUERY_SHAPES.question_bank.select)
    .eq('is_active', true);

  return {
    ragRows: (ragData || []) as Array<{ subject: string | null; grade: string | null }>,
    questionRows: (qData || []) as Array<{ subject: string | null; grade: string | null }>,
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
  console.log(`Total RAG chunks: ${report.totalRagChunks}`);
  console.log(`Total questions: ${report.totalQuestions}\n`);
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

  const { ragRows, questionRows } = await fetchRows(supabase);
  const report = buildGapReport(ragRows, questionRows);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\nALFANUMRIK CONTENT GAP REPORT\n');
    printText(report);
  }

  // Exit code policy:
  //   0 = healthy
  //   1 = catastrophic (any chapter at 0 chunks AND 0 questions) — fails CI
  //   2 = below P3 floor (warn, but not fail)
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
