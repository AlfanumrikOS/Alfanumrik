/**
 * ALFANUMRIK — Question Bank Quality Audit
 *
 * Read-only audit of every question in the question_bank table.
 * Replicates the runtime validateQuestions() filters from src/lib/supabase.ts
 * and adds additional quality signals (duplicates, similarity, generics, coverage).
 *
 * Run:
 *   npx tsx scripts/audit-question-quality.ts
 *   npx tsx scripts/audit-question-quality.ts --grade 10
 *   npx tsx scripts/audit-question-quality.ts --json           # machine-readable output
 *   npx tsx scripts/audit-question-quality.ts --fix-report     # include question IDs for bulk fixes
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

// ─── Configuration ──────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: Missing required env vars.');
  console.error('  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── CLI args ───────────────────────────────────────────────

const args = process.argv.slice(2);
const gradeFilter = args.includes('--grade')
  ? args[args.indexOf('--grade') + 1]
  : null;
const jsonOutput = args.includes('--json');
const fixReport = args.includes('--fix-report');

// ─── Constants ──────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

const VALID_SUBJECTS_6_10 = ['math', 'science', 'english', 'hindi', 'social_studies'];
const VALID_SUBJECTS_11_12 = [
  'physics', 'chemistry', 'biology', 'math', 'english', 'economics',
  'accountancy', 'business_studies', 'political_science', 'history_sr',
  'geography', 'computer_science', 'coding',
];

const VALID_BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

const DIFFICULTY_LABELS: Record<number, string> = { 1: 'easy', 2: 'medium', 3: 'hard' };

const MIN_QUESTIONS_PER_TOPIC = 5;
const PAGE_SIZE = 1000;

// ─── Types ──────────────────────────────────────────────────

interface QuestionRow {
  id: string;
  subject: string;
  grade: string;
  chapter_number: number | null;
  chapter_title: string | null;
  topic: string | null;
  question_text: string;
  question_hi: string | null;
  question_type: string | null;
  options: string[] | string;
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  is_active: boolean;
  source: string | null;
  board_year: number | null;
  topic_id: string | null;
  content_status: string | null;
}

type FailReason =
  | 'empty_question_text'
  | 'question_too_short'
  | 'template_marker'
  | 'garbage_meta_question'
  | 'garbage_options'
  | 'not_four_options'
  | 'invalid_answer_index'
  | 'fewer_than_3_distinct_options'
  | 'bad_explanation'
  | 'missing_explanation'
  | 'short_explanation'
  | 'terse_explanation'
  | 'duplicate_text'
  | 'invalid_grade'
  | 'invalid_subject_for_grade'
  | 'invalid_bloom_level'
  | 'invalid_difficulty'
  | 'too_generic'
  | 'similar_options'
  | 'missing_hindi'
  | 'options_not_array';

interface FailedQuestion {
  id: string;
  reasons: FailReason[];
  grade: string;
  subject: string;
}

// ─── Fetch all questions (paginated) ────────────────────────

async function fetchAllQuestions(): Promise<QuestionRow[]> {
  const all: QuestionRow[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('question_bank')
      .select('id, subject, grade, chapter_number, chapter_title, topic, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level, is_active, source, board_year, topic_id, content_status')
      .range(from, from + PAGE_SIZE - 1);

    if (gradeFilter) {
      // Handle both "10" and "Grade 10" formats
      query = query.or(`grade.eq.${gradeFilter},grade.eq.Grade ${gradeFilter}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`ERROR fetching questions (offset ${from}):`, error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      all.push(...(data as QuestionRow[]));
      from += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }

  return all;
}

// ─── Normalize grade string ─────────────────────────────────

function normalizeGrade(raw: string): string {
  // Convert "Grade 10" → "10", "Class 8" → "8", or pass through "10"
  const m = raw.match(/(\d+)/);
  return m ? m[1] : raw;
}

// ─── Validation (mirrors src/lib/supabase.ts validateQuestions) ─

function getValidSubjects(grade: string): string[] {
  const g = parseInt(grade, 10);
  if (g >= 11) return VALID_SUBJECTS_11_12;
  return VALID_SUBJECTS_6_10;
}

/**
 * Simple Levenshtein distance for short strings.
 */
function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lb; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[la][lb];
}

/**
 * Check if any pair of options is suspiciously similar (Levenshtein < 3).
 * Only applies to options of reasonable length (>5 chars) to avoid false positives
 * on short legitimate options like "2", "3", "4", "5".
 */
function hasSimilarOptions(opts: string[]): boolean {
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      const a = opts[i].trim().toLowerCase();
      const b = opts[j].trim().toLowerCase();
      // Only check similarity for longer options; short ones (numbers, single words) are fine
      if (a.length > 5 && b.length > 5 && levenshtein(a, b) < 3) {
        return true;
      }
    }
  }
  return false;
}

const GENERIC_PATTERNS = [
  /^what is .{3,30}\?$/i,
  /^define .{3,30}\.?$/i,
  /^what do you mean by .{3,30}\?$/i,
];

function isTooGeneric(text: string): boolean {
  const trimmed = text.trim();
  return GENERIC_PATTERNS.some(p => p.test(trimmed));
}

function auditQuestion(q: QuestionRow): FailReason[] {
  const reasons: FailReason[] = [];

  // --- Mirrors validateQuestions() from src/lib/supabase.ts ---

  // 1. Empty or missing question text
  if (!q.question_text || typeof q.question_text !== 'string') {
    reasons.push('empty_question_text');
    return reasons; // Cannot check further
  }

  // 2. Question too short (runtime uses 15, we also flag < 30 as quality concern)
  if (q.question_text.length < 15) {
    reasons.push('question_too_short');
  }

  // 3. Template markers
  const text = q.question_text.toLowerCase();
  if (text.includes('{{') || text.includes('[blank]') || text.includes('[topic]') ||
      text.includes('todo') || text.includes('fixme')) {
    reasons.push('template_marker');
  }

  // 4. Options parsing
  let opts: string[];
  if (Array.isArray(q.options)) {
    opts = q.options;
  } else if (typeof q.options === 'string') {
    try {
      const parsed = JSON.parse(q.options);
      opts = Array.isArray(parsed) ? parsed : [];
    } catch {
      opts = [];
      reasons.push('options_not_array');
    }
  } else {
    opts = [];
    reasons.push('options_not_array');
  }

  // 5. Must have exactly 4 options
  if (opts.length !== 4) {
    reasons.push('not_four_options');
  }

  // 6. Valid answer index
  if (q.correct_answer_index < 0 || q.correct_answer_index > 3) {
    reasons.push('invalid_answer_index');
  }

  // 7. Garbage meta-questions (runtime patterns)
  if (text.includes('unrelated topic')) reasons.push('garbage_meta_question');
  if (text.startsWith('a student studying') && text.includes('should focus on')) reasons.push('garbage_meta_question');
  if (text.startsWith('which of the following best describes the main topic')) reasons.push('garbage_meta_question');
  if (text.startsWith('why is') && text.includes('important for grade')) reasons.push('garbage_meta_question');
  if (text.startsWith('the chapter') && text.includes('most closely related to which area')) reasons.push('garbage_meta_question');
  if (text.startsWith('what is the primary purpose of studying')) reasons.push('garbage_meta_question');

  // 8. Garbage options
  if (opts.length > 0) {
    const optTexts = opts.map((o: string) => (o || '').toLowerCase().trim());

    const garbageOptionPatterns = [
      'unrelated topic', 'physical education', 'art and craft',
      'music theory', 'it is not important', 'no board exam',
    ];
    if (optTexts.some(o => garbageOptionPatterns.some(p => o.includes(p)))) {
      reasons.push('garbage_options');
    }

    // 9. Fewer than 3 distinct options
    if (new Set(optTexts).size < 3) {
      reasons.push('fewer_than_3_distinct_options');
    }

    // 10. Similar options (Levenshtein < 3)
    if (opts.length === 4 && hasSimilarOptions(opts)) {
      reasons.push('similar_options');
    }
  }

  // 11. Explanation checks
  if (q.explanation) {
    const expl = q.explanation.toLowerCase();

    const badExplPatterns = [
      'does not match any option',
      'suggesting a possible error',
      'assuming a typo',
      'not listed',
      'however, the correct',
      'this is incorrect',
      'none of the options',
      'there seems to be',
      'closest plausible',
    ];
    if (badExplPatterns.some(p => expl.includes(p))) {
      reasons.push('bad_explanation');
    }

    if (q.explanation.length < 20) {
      reasons.push('short_explanation');
    }

    const explWords = expl.split(/\s+/);
    if (explWords.length < 8) {
      reasons.push('terse_explanation');
    }
  } else {
    reasons.push('missing_explanation');
  }

  // --- Additional quality checks beyond runtime validation ---

  // 12. Grade format
  const normGrade = normalizeGrade(q.grade);
  if (!VALID_GRADES.includes(normGrade)) {
    reasons.push('invalid_grade');
  }

  // 13. Subject valid for grade
  if (VALID_GRADES.includes(normGrade)) {
    const validSubjects = getValidSubjects(normGrade);
    if (!validSubjects.includes(q.subject)) {
      reasons.push('invalid_subject_for_grade');
    }
  }

  // 14. Bloom's level
  if (q.bloom_level && !VALID_BLOOM_LEVELS.includes(q.bloom_level)) {
    reasons.push('invalid_bloom_level');
  }

  // 15. Difficulty range (1-3 expected)
  if (q.difficulty !== null && (q.difficulty < 1 || q.difficulty > 3)) {
    reasons.push('invalid_difficulty');
  }

  // 16. Too generic question
  if (isTooGeneric(q.question_text)) {
    reasons.push('too_generic');
  }

  // 17. Missing Hindi translation
  if (!q.question_hi) {
    reasons.push('missing_hindi');
  }

  return reasons;
}

// ─── Duplicate detection ────────────────────────────────────

function findDuplicates(questions: QuestionRow[]): Map<string, string[]> {
  const textToIds = new Map<string, string[]>();
  for (const q of questions) {
    if (!q.question_text) continue;
    const key = q.question_text.trim().toLowerCase();
    const existing = textToIds.get(key);
    if (existing) {
      existing.push(q.id);
    } else {
      textToIds.set(key, [q.id]);
    }
  }

  // Return only entries with duplicates
  const dupes = new Map<string, string[]>();
  for (const [key, ids] of textToIds) {
    if (ids.length > 1) {
      dupes.set(key, ids);
    }
  }
  return dupes;
}

// ─── Report generation ──────────────────────────────────────

interface AuditReport {
  total: number;
  active: number;
  inactive: number;
  passAll: number;
  passRate: number;
  failureBreakdown: Record<string, number>;
  topFailureReasons: [string, number][];
  missingHindi: number;
  duplicateTexts: number;
  duplicateQuestions: number;
  tooGeneric: number;
  similarOptions: number;
  coverageByGrade: Record<string, { total: number; valid: number; subjects: Set<string>; chapters: Set<string> }>;
  thinCoverage: { grade: string; subject: string; chapter: string; validCount: number }[];
  difficultyDistribution: Record<string, number>;
  bloomDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
  failedQuestions: FailedQuestion[];
}

function generateReport(questions: QuestionRow[]): AuditReport {
  const failures: FailedQuestion[] = [];
  const failureBreakdown: Record<string, number> = {};
  const coverageByGrade: Record<string, { total: number; valid: number; subjects: Set<string>; chapters: Set<string> }> = {};
  const difficultyCount: Record<string, number> = { easy: 0, medium: 0, hard: 0, unknown: 0 };
  const bloomCount: Record<string, number> = {};
  const sourceCount: Record<string, number> = {};

  // Track valid questions per grade/subject/chapter for thin coverage
  const topicValid: Record<string, number> = {};

  let passCount = 0;
  let activeCount = 0;
  let inactiveCount = 0;

  // First find duplicates
  const duplicates = findDuplicates(questions);
  const duplicateIds = new Set<string>();
  for (const ids of duplicates.values()) {
    // Mark all but the first as duplicate
    for (let i = 1; i < ids.length; i++) {
      duplicateIds.add(ids[i]);
    }
  }

  for (const q of questions) {
    if (q.is_active) activeCount++;
    else inactiveCount++;

    const normGrade = normalizeGrade(q.grade);
    const reasons = auditQuestion(q);

    // Add duplicate reason
    if (duplicateIds.has(q.id)) {
      reasons.push('duplicate_text');
    }

    const isValid = reasons.length === 0;

    // Coverage tracking
    if (!coverageByGrade[normGrade]) {
      coverageByGrade[normGrade] = { total: 0, valid: 0, subjects: new Set(), chapters: new Set() };
    }
    coverageByGrade[normGrade].total++;
    coverageByGrade[normGrade].subjects.add(q.subject);
    if (q.chapter_title || q.chapter_number) {
      coverageByGrade[normGrade].chapters.add(`${q.subject}|Ch ${q.chapter_number || '?'}`);
    }

    // Topic key for thin coverage
    const topicKey = `${normGrade}|${q.subject}|Ch ${q.chapter_number || '?'}`;

    if (isValid) {
      passCount++;
      if (!topicValid[topicKey]) topicValid[topicKey] = 0;
      topicValid[topicKey]++;
      coverageByGrade[normGrade].valid++;
    } else {
      // Still count in topic even if invalid, but track separately
      if (!topicValid[topicKey]) topicValid[topicKey] = 0;
    }

    // Tally failures
    if (!isValid) {
      failures.push({
        id: q.id,
        reasons,
        grade: normGrade,
        subject: q.subject,
      });
      for (const r of reasons) {
        failureBreakdown[r] = (failureBreakdown[r] || 0) + 1;
      }
    }

    // Difficulty
    const diffLabel = DIFFICULTY_LABELS[q.difficulty ?? 0] || 'unknown';
    difficultyCount[diffLabel]++;

    // Bloom's
    const bloom = q.bloom_level || 'unset';
    bloomCount[bloom] = (bloomCount[bloom] || 0) + 1;

    // Source
    const src = q.source || 'unspecified';
    sourceCount[src] = (sourceCount[src] || 0) + 1;
  }

  // Thin coverage: topics with fewer than MIN_QUESTIONS_PER_TOPIC valid questions
  const thinCoverage: { grade: string; subject: string; chapter: string; validCount: number }[] = [];
  for (const [key, count] of Object.entries(topicValid)) {
    if (count < MIN_QUESTIONS_PER_TOPIC) {
      const [grade, subject, chapter] = key.split('|');
      thinCoverage.push({ grade, subject, chapter, validCount: count });
    }
  }
  thinCoverage.sort((a, b) => a.validCount - b.validCount);

  // Sort failure reasons by count
  const topFailureReasons = Object.entries(failureBreakdown)
    .sort((a, b) => b[1] - a[1]);

  // Count specific quality issues
  const missingHindi = failureBreakdown['missing_hindi'] || 0;
  const tooGeneric = failureBreakdown['too_generic'] || 0;
  const similarOptions = failureBreakdown['similar_options'] || 0;

  let duplicateQuestions = 0;
  for (const ids of duplicates.values()) {
    duplicateQuestions += ids.length - 1; // count extras
  }

  return {
    total: questions.length,
    active: activeCount,
    inactive: inactiveCount,
    passAll: passCount,
    passRate: questions.length > 0 ? Math.round((passCount / questions.length) * 100) : 0,
    failureBreakdown,
    topFailureReasons,
    missingHindi,
    duplicateTexts: duplicates.size,
    duplicateQuestions,
    tooGeneric,
    similarOptions,
    coverageByGrade,
    thinCoverage,
    difficultyDistribution: difficultyCount,
    bloomDistribution: bloomCount,
    sourceDistribution: sourceCount,
    failedQuestions: failures,
  };
}

// ─── Output formatters ──────────────────────────────────────

function pct(count: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((count / total) * 100)}%`;
}

function printTextReport(report: AuditReport): void {
  const hr = '='.repeat(60);
  const hr2 = '-'.repeat(60);

  console.log('');
  console.log(hr);
  console.log('  QUESTION BANK QUALITY AUDIT');
  console.log(`  ${new Date().toISOString().slice(0, 10)}`);
  if (gradeFilter) console.log(`  Filtered: Grade ${gradeFilter} only`);
  console.log(hr);
  console.log('');

  // ── Summary
  console.log(`Total questions:    ${report.total}`);
  console.log(`Active questions:   ${report.active}`);
  console.log(`Inactive:           ${report.inactive}`);
  console.log('');

  // ── Quality Breakdown
  console.log('QUALITY BREAKDOWN');
  console.log(hr2);
  console.log(`  Pass all checks:     ${report.passAll} (${pct(report.passAll, report.total)})`);
  console.log(`  Fail validation:     ${report.total - report.passAll} (${pct(report.total - report.passAll, report.total)})`);
  console.log(`  Missing Hindi:       ${report.missingHindi}`);
  console.log(`  Duplicate text:      ${report.duplicateQuestions} questions across ${report.duplicateTexts} unique texts`);
  console.log(`  Too generic:         ${report.tooGeneric}`);
  console.log(`  Similar options:     ${report.similarOptions}`);
  console.log('');

  // ── Top failure reasons
  if (report.topFailureReasons.length > 0) {
    console.log('TOP FAILURE REASONS');
    console.log(hr2);
    const REASON_LABELS: Record<string, string> = {
      empty_question_text: 'Empty question text',
      question_too_short: 'Question shorter than 15 chars',
      template_marker: 'Contains template markers ({{, [BLANK], TODO)',
      garbage_meta_question: 'AI-generated meta question (not subject-specific)',
      garbage_options: 'Garbage options (unrelated topic, physical education, etc.)',
      not_four_options: 'Does not have exactly 4 options',
      invalid_answer_index: 'Correct answer index not 0-3',
      fewer_than_3_distinct_options: 'Fewer than 3 distinct options',
      bad_explanation: 'Explanation contradicts itself or flags an error',
      missing_explanation: 'No explanation provided',
      short_explanation: 'Explanation shorter than 20 chars',
      terse_explanation: 'Explanation has fewer than 8 words',
      duplicate_text: 'Exact duplicate of another question',
      invalid_grade: 'Grade not in valid range (6-12)',
      invalid_subject_for_grade: 'Subject not valid for this grade',
      invalid_bloom_level: 'Bloom\'s level not a valid taxonomy level',
      invalid_difficulty: 'Difficulty outside 1-3 range',
      too_generic: 'Too generic (e.g., "What is X?")',
      similar_options: 'Two or more options nearly identical (Levenshtein < 3)',
      options_not_array: 'Options field is not a parseable array',
      missing_hindi: 'No Hindi translation',
    };

    for (const [reason, count] of report.topFailureReasons) {
      if (reason === 'missing_hindi') continue; // shown separately, informational
      const label = REASON_LABELS[reason] || reason;
      console.log(`  ${String(count).padStart(5)}  ${label}`);
    }
    console.log('');
  }

  // ── Coverage by Grade
  console.log('COVERAGE BY GRADE');
  console.log(hr2);
  for (const grade of VALID_GRADES) {
    const data = report.coverageByGrade[grade];
    if (!data) {
      console.log(`  Grade ${grade.padStart(2)}: 0 questions`);
    } else {
      console.log(`  Grade ${grade.padStart(2)}: ${data.total} questions (${data.valid} valid, ${data.subjects.size} subjects, ${data.chapters.size} chapter-subject combos)`);
    }
  }
  // Show any non-standard grade values
  for (const grade of Object.keys(report.coverageByGrade)) {
    if (!VALID_GRADES.includes(grade)) {
      const data = report.coverageByGrade[grade];
      console.log(`  Grade "${grade}" (non-standard): ${data.total} questions`);
    }
  }
  console.log('');

  // ── Thin Coverage
  if (report.thinCoverage.length > 0) {
    console.log(`THIN COVERAGE (< ${MIN_QUESTIONS_PER_TOPIC} valid questions per chapter)`);
    console.log(hr2);
    const shown = report.thinCoverage.slice(0, 30);
    for (const t of shown) {
      console.log(`  Grade ${t.grade.padStart(2)} / ${t.subject.padEnd(18)} / ${t.chapter}: ${t.validCount} valid questions`);
    }
    if (report.thinCoverage.length > 30) {
      console.log(`  ... and ${report.thinCoverage.length - 30} more topics with thin coverage`);
    }
    console.log('');
  }

  // ── Difficulty Distribution
  console.log('DIFFICULTY DISTRIBUTION');
  console.log(hr2);
  const totalKnownDiff = (report.difficultyDistribution['easy'] || 0)
    + (report.difficultyDistribution['medium'] || 0)
    + (report.difficultyDistribution['hard'] || 0);
  console.log(`  Easy:    ${report.difficultyDistribution['easy'] || 0} (${pct(report.difficultyDistribution['easy'] || 0, totalKnownDiff)}) — target: 30%`);
  console.log(`  Medium:  ${report.difficultyDistribution['medium'] || 0} (${pct(report.difficultyDistribution['medium'] || 0, totalKnownDiff)}) — target: 50%`);
  console.log(`  Hard:    ${report.difficultyDistribution['hard'] || 0} (${pct(report.difficultyDistribution['hard'] || 0, totalKnownDiff)}) — target: 20%`);
  if (report.difficultyDistribution['unknown']) {
    console.log(`  Unknown: ${report.difficultyDistribution['unknown']} (missing or out-of-range difficulty)`);
  }
  console.log('');

  // ── Bloom's Distribution
  console.log("BLOOM'S TAXONOMY DISTRIBUTION");
  console.log(hr2);
  for (const level of VALID_BLOOM_LEVELS) {
    const count = report.bloomDistribution[level] || 0;
    console.log(`  ${level.padEnd(12)}: ${count} (${pct(count, report.total)})`);
  }
  if (report.bloomDistribution['unset']) {
    console.log(`  ${'unset'.padEnd(12)}: ${report.bloomDistribution['unset']} (no bloom_level assigned)`);
  }
  // Any invalid bloom values
  for (const [level, count] of Object.entries(report.bloomDistribution)) {
    if (!VALID_BLOOM_LEVELS.includes(level) && level !== 'unset') {
      console.log(`  ${level.padEnd(12)}: ${count} (INVALID bloom level)`);
    }
  }
  console.log('');

  // ── Source Distribution
  console.log('SOURCE DISTRIBUTION');
  console.log(hr2);
  for (const [src, count] of Object.entries(report.sourceDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(16)}: ${count} (${pct(count, report.total)})`);
  }
  console.log('');

  // ── Verdict
  console.log(hr);
  console.log('  VERDICT');
  console.log(hr);
  const criticalFails = (report.failureBreakdown['garbage_meta_question'] || 0)
    + (report.failureBreakdown['garbage_options'] || 0)
    + (report.failureBreakdown['not_four_options'] || 0)
    + (report.failureBreakdown['invalid_answer_index'] || 0)
    + (report.failureBreakdown['bad_explanation'] || 0)
    + (report.failureBreakdown['template_marker'] || 0)
    + (report.failureBreakdown['options_not_array'] || 0);

  console.log(`  Valid for serving:     ${report.passAll} / ${report.total} (${pct(report.passAll, report.total)})`);
  console.log(`  Critical defects:      ${criticalFails} (would cause wrong answers or confusion)`);
  console.log(`  Hindi coverage:        ${pct(report.total - report.missingHindi, report.total)} translated`);
  console.log(`  Thin-coverage topics:  ${report.thinCoverage.length} (need more questions)`);
  console.log('');

  if (report.passRate >= 90) {
    console.log('  STATUS: GOOD — question bank is in healthy shape.');
  } else if (report.passRate >= 70) {
    console.log('  STATUS: NEEDS ATTENTION — significant quality issues to address.');
  } else {
    console.log('  STATUS: CRITICAL — majority of questions have quality problems.');
  }
  console.log('');

  // ── Fix report (optional)
  if (fixReport && report.failedQuestions.length > 0) {
    console.log('FIX REPORT (question IDs grouped by primary failure reason)');
    console.log(hr2);
    const byReason: Record<string, string[]> = {};
    for (const fq of report.failedQuestions) {
      const primary = fq.reasons[0];
      if (primary === 'missing_hindi') continue; // informational, not actionable for deletion
      if (!byReason[primary]) byReason[primary] = [];
      byReason[primary].push(fq.id);
    }
    for (const [reason, ids] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${reason} (${ids.length} questions):`);
      // Show first 10 IDs, then count
      const shown = ids.slice(0, 10);
      for (const id of shown) {
        console.log(`    ${id}`);
      }
      if (ids.length > 10) {
        console.log(`    ... and ${ids.length - 10} more`);
      }
    }
    console.log('');
  }
}

function printJsonReport(report: AuditReport): void {
  // Convert Sets to arrays for JSON serialization
  const coverageByGrade: Record<string, { total: number; valid: number; subjects: string[]; chapters: string[] }> = {};
  for (const [grade, data] of Object.entries(report.coverageByGrade)) {
    coverageByGrade[grade] = {
      total: data.total,
      valid: data.valid,
      subjects: Array.from(data.subjects),
      chapters: Array.from(data.chapters),
    };
  }

  const output = {
    timestamp: new Date().toISOString(),
    gradeFilter: gradeFilter || 'all',
    summary: {
      total: report.total,
      active: report.active,
      inactive: report.inactive,
      passAll: report.passAll,
      passRate: report.passRate,
      criticalDefects: (report.failureBreakdown['garbage_meta_question'] || 0)
        + (report.failureBreakdown['garbage_options'] || 0)
        + (report.failureBreakdown['not_four_options'] || 0)
        + (report.failureBreakdown['invalid_answer_index'] || 0)
        + (report.failureBreakdown['bad_explanation'] || 0)
        + (report.failureBreakdown['template_marker'] || 0),
    },
    failureBreakdown: report.failureBreakdown,
    coverageByGrade,
    thinCoverage: report.thinCoverage,
    difficultyDistribution: report.difficultyDistribution,
    bloomDistribution: report.bloomDistribution,
    sourceDistribution: report.sourceDistribution,
    duplicateTexts: report.duplicateTexts,
    duplicateQuestions: report.duplicateQuestions,
    ...(fixReport ? { failedQuestionIds: report.failedQuestions.map(f => ({ id: f.id, reasons: f.reasons })) } : {}),
  };

  console.log(JSON.stringify(output, null, 2));
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  if (!jsonOutput) {
    console.log('Fetching questions from question_bank...');
  }

  const questions = await fetchAllQuestions();

  if (questions.length === 0) {
    console.error('No questions found in question_bank.');
    process.exit(0);
  }

  if (!jsonOutput) {
    console.log(`Fetched ${questions.length} questions. Running audit...`);
  }

  const report = generateReport(questions);

  if (jsonOutput) {
    printJsonReport(report);
  } else {
    printTextReport(report);
  }

  // Exit with non-zero if pass rate is below threshold (useful in CI)
  if (report.passRate < 50) {
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
