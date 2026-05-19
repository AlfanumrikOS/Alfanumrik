// bulk-jee-neet-import/validation.ts
//
// Pure (Deno-free) validation + parsing helpers for the bulk-jee-neet-import
// Edge Function. Kept Deno-free so Vitest can exercise them from the
// project-wide `src/__tests__/` tree without pulling in `Deno.env` or
// `https://esm.sh` imports.
//
// Imported by:
//   - supabase/functions/bulk-jee-neet-import/index.ts (runtime handler)
//   - supabase/functions/bulk-jee-neet-import/__tests__/index.test.ts (vitest)
//
// Owner: ai-engineer. Reviewer: assessment (CBSE / PYQ correctness).

/** Valid source_type values added by PR-1's schema-widening migration. */
export const VALID_PYQ_SOURCE_TYPES = [
  'jee_archive',
  'neet_archive',
  'olympiad',
] as const;
export type PyqSourceType = (typeof VALID_PYQ_SOURCE_TYPES)[number];

/**
 * Valid question paper-pattern enum (PR-1 column `paper_pattern` on
 * question_bank). 'mcq_4' is the legacy 4-option multiple choice (used by
 * everything pre-PR-1). 'mcq_5' / 'integer' / 'matrix_match' / 'numerical'
 * are the JEE/NEET shapes PR-1 unlocks. Olympiad questions usually fall
 * under 'integer' or 'numerical'.
 */
export const VALID_PAPER_PATTERNS = [
  'mcq_4',
  'mcq_5',
  'integer',
  'matrix_match',
  'numerical',
  'subjective',
] as const;
export type PaperPattern = (typeof VALID_PAPER_PATTERNS)[number];

/** P5 grade format: strings "6" through "12". */
export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export type Grade = (typeof VALID_GRADES)[number];

/** Subject allowlist for PYQ ingestion (JEE/NEET stream). */
export const VALID_PYQ_SUBJECTS = new Set([
  'math',
  'physics',
  'chemistry',
  'biology',
  // Olympiad-only — opt-in additions, schema CHECK doesn't yet permit:
  // 'computer_science',
  // 'astronomy',
]);

// ── Input shape ──────────────────────────────────────────────────────────────

export interface PyqQuestion {
  /** Stable per-paper number (e.g. "Q15", "12", "PHY-7"). Used for the
   *  idempotency key (exam_session, exam_year, question_number). */
  question_number: string;
  paper_pattern: PaperPattern;
  question_text: string;
  /** 4 or 5 options for MCQ-type; empty/omitted for integer/numerical. */
  options?: string[];
  /** 0-based index into `options[]`, required for MCQ patterns. */
  correct_answer_index?: number;
  /** Free-text answer (integer/numerical/matrix patterns). */
  correct_answer_text?: string;
  marks_correct: number;
  marks_wrong: number;
  /** Seconds. Maps to `time_estimate_seconds`. */
  time_estimate_seconds: number;
}

export interface PyqPaper {
  /** Exam session label, e.g. "JEE_MAIN_JAN_SHIFT1", "NEET_UG", "INMO". */
  exam_session: string;
  /** Calendar year, 2000..2100. */
  exam_year: number;
  /** CBSE subject code (lowercase). See VALID_PYQ_SUBJECTS. */
  subject: string;
  /** P5: grade is a string. JEE/NEET batches use "11" or "12". */
  grade: string;
  questions: PyqQuestion[];
}

export interface BulkImportInput {
  papers: PyqPaper[];
  /** When true: validate + simulate, but skip DB writes. */
  dry_run: boolean;
  source_type: PyqSourceType;
}

export interface FieldError {
  path: string;
  message: string;
}

export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  errors: FieldError[];
}

// ── Top-level body parser ────────────────────────────────────────────────────

export function parseBulkImportBody(body: unknown): ParseResult<BulkImportInput> {
  const errors: FieldError[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: [{ path: '$', message: 'body must be a JSON object' }] };
  }
  const b = body as Record<string, unknown>;

  // source_type — required
  const sourceType = b.source_type;
  if (typeof sourceType !== 'string' || !isValidSourceType(sourceType)) {
    errors.push({
      path: '$.source_type',
      message: `source_type must be one of: ${VALID_PYQ_SOURCE_TYPES.join(', ')}`,
    });
  }

  // dry_run — required boolean (no default; explicit is safer for bulk ops)
  const dryRun = b.dry_run;
  if (typeof dryRun !== 'boolean') {
    errors.push({
      path: '$.dry_run',
      message: 'dry_run must be a boolean (no default — explicit is required for bulk ingestion)',
    });
  }

  // papers — array
  if (!Array.isArray(b.papers)) {
    errors.push({ path: '$.papers', message: 'papers must be an array' });
    return { ok: false, errors };
  }
  if ((b.papers as unknown[]).length === 0) {
    errors.push({ path: '$.papers', message: 'papers must contain at least 1 paper' });
  }

  if (errors.length > 0) return { ok: false, errors };

  // Per-paper validation (collect all errors so the operator gets a full report)
  const papers: PyqPaper[] = [];
  for (let i = 0; i < (b.papers as unknown[]).length; i++) {
    const parsed = parsePaper((b.papers as unknown[])[i], `$.papers[${i}]`);
    errors.push(...parsed.errors);
    if (parsed.ok && parsed.value) papers.push(parsed.value);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      papers,
      dry_run: dryRun as boolean,
      source_type: sourceType as PyqSourceType,
    },
    errors: [],
  };
}

function isValidSourceType(v: string): v is PyqSourceType {
  return (VALID_PYQ_SOURCE_TYPES as readonly string[]).includes(v);
}

function isValidPaperPattern(v: unknown): v is PaperPattern {
  return typeof v === 'string' && (VALID_PAPER_PATTERNS as readonly string[]).includes(v);
}

function isValidGrade(v: unknown): v is Grade {
  return typeof v === 'string' && (VALID_GRADES as readonly string[]).includes(v);
}

export function parsePaper(raw: unknown, path: string): ParseResult<PyqPaper> {
  const errors: FieldError[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ path, message: 'paper must be an object' }] };
  }
  const p = raw as Record<string, unknown>;

  // exam_session — non-empty string, 80 chars max (for index)
  if (typeof p.exam_session !== 'string' || !p.exam_session.trim()) {
    errors.push({ path: `${path}.exam_session`, message: 'exam_session must be a non-empty string' });
  } else if (p.exam_session.length > 80) {
    errors.push({ path: `${path}.exam_session`, message: 'exam_session must be ≤ 80 chars' });
  }

  // exam_year — integer 2000..2100
  if (typeof p.exam_year !== 'number' || !Number.isInteger(p.exam_year) || p.exam_year < 2000 || p.exam_year > 2100) {
    errors.push({ path: `${path}.exam_year`, message: 'exam_year must be an integer 2000..2100' });
  }

  // subject — known CBSE subject for JEE/NEET stream
  if (typeof p.subject !== 'string' || !VALID_PYQ_SUBJECTS.has(p.subject.toLowerCase().trim())) {
    errors.push({
      path: `${path}.subject`,
      message: `subject must be one of: ${Array.from(VALID_PYQ_SUBJECTS).join(', ')}`,
    });
  }

  // grade — P5 string "6".."12"
  if (!isValidGrade(p.grade)) {
    errors.push({ path: `${path}.grade`, message: 'grade must be a string "6".."12" (P5)' });
  }

  // questions — non-empty array
  if (!Array.isArray(p.questions)) {
    errors.push({ path: `${path}.questions`, message: 'questions must be an array' });
    return { ok: false, errors };
  }
  if ((p.questions as unknown[]).length === 0) {
    errors.push({ path: `${path}.questions`, message: 'questions must contain at least 1 question' });
  }

  // Detect duplicate question_number within paper (idempotency key relies
  // on uniqueness — duplicate would silently drop one on insert).
  const seenNumbers = new Set<string>();

  const questions: PyqQuestion[] = [];
  for (let i = 0; i < (p.questions as unknown[]).length; i++) {
    const qparsed = parseQuestion((p.questions as unknown[])[i], `${path}.questions[${i}]`);
    errors.push(...qparsed.errors);
    if (qparsed.ok && qparsed.value) {
      const qn = qparsed.value.question_number;
      if (seenNumbers.has(qn)) {
        errors.push({
          path: `${path}.questions[${i}].question_number`,
          message: `duplicate question_number "${qn}" within paper — idempotency key requires uniqueness`,
        });
      } else {
        seenNumbers.add(qn);
        questions.push(qparsed.value);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      exam_session: (p.exam_session as string).trim(),
      exam_year: p.exam_year as number,
      subject: (p.subject as string).toLowerCase().trim(),
      grade: p.grade as string,
      questions,
    },
    errors: [],
  };
}

export function parseQuestion(raw: unknown, path: string): ParseResult<PyqQuestion> {
  const errors: FieldError[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ path, message: 'question must be an object' }] };
  }
  const q = raw as Record<string, unknown>;

  // question_number
  if (typeof q.question_number !== 'string' && typeof q.question_number !== 'number') {
    errors.push({ path: `${path}.question_number`, message: 'question_number must be string or number' });
  }
  const questionNumber = String(q.question_number ?? '').trim();
  if (!questionNumber) {
    errors.push({ path: `${path}.question_number`, message: 'question_number is required' });
  } else if (questionNumber.length > 32) {
    errors.push({ path: `${path}.question_number`, message: 'question_number must be ≤ 32 chars' });
  }

  // paper_pattern
  if (!isValidPaperPattern(q.paper_pattern)) {
    errors.push({
      path: `${path}.paper_pattern`,
      message: `paper_pattern must be one of: ${VALID_PAPER_PATTERNS.join(', ')}`,
    });
  }
  const paperPattern = q.paper_pattern as PaperPattern;

  // question_text — non-empty, no placeholder (P6 alignment)
  if (typeof q.question_text !== 'string' || !q.question_text.trim()) {
    errors.push({ path: `${path}.question_text`, message: 'question_text is required (P6)' });
  } else if (q.question_text.includes('{{') || /\[BLANK\]/i.test(q.question_text)) {
    errors.push({ path: `${path}.question_text`, message: 'question_text contains {{ or [BLANK] placeholder (P6)' });
  } else if (q.question_text.trim().length < 11) {
    // chk_question_not_empty: length(question_text) > 10
    errors.push({ path: `${path}.question_text`, message: 'question_text must be > 10 chars (DB CHECK chk_question_not_empty)' });
  }

  // marks_correct
  if (typeof q.marks_correct !== 'number' || !Number.isFinite(q.marks_correct) || q.marks_correct <= 0) {
    errors.push({ path: `${path}.marks_correct`, message: 'marks_correct must be a positive number' });
  }
  // marks_wrong — can be 0 or negative (penalty). Reject NaN / non-number.
  if (typeof q.marks_wrong !== 'number' || !Number.isFinite(q.marks_wrong)) {
    errors.push({ path: `${path}.marks_wrong`, message: 'marks_wrong must be a finite number (0, negative penalty, or 0 for olympiad)' });
  }

  // time_estimate_seconds
  if (
    typeof q.time_estimate_seconds !== 'number' ||
    !Number.isInteger(q.time_estimate_seconds) ||
    q.time_estimate_seconds < 5 ||
    q.time_estimate_seconds > 3600
  ) {
    errors.push({
      path: `${path}.time_estimate_seconds`,
      message: 'time_estimate_seconds must be an integer in [5, 3600]',
    });
  }

  // Pattern-specific option / answer validation
  if (paperPattern === 'mcq_4' || paperPattern === 'mcq_5') {
    const expectedOptionsCount = paperPattern === 'mcq_4' ? 4 : 5;
    if (!Array.isArray(q.options) || q.options.length !== expectedOptionsCount) {
      errors.push({
        path: `${path}.options`,
        message: `paper_pattern=${paperPattern} requires exactly ${expectedOptionsCount} options`,
      });
    } else {
      const opts = (q.options as unknown[]).map((o, i) => {
        if (typeof o !== 'string' || !o.trim()) {
          errors.push({ path: `${path}.options[${i}]`, message: 'option must be a non-empty string' });
          return '';
        }
        return o.trim();
      });
      const distinct = new Set(opts.map((o) => o.toLowerCase()));
      if (opts.every((o) => o) && distinct.size !== expectedOptionsCount) {
        errors.push({
          path: `${path}.options`,
          message: 'options must all be distinct (case-insensitive)',
        });
      }
    }
    const idx = q.correct_answer_index;
    const maxIdx = expectedOptionsCount - 1;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > maxIdx) {
      errors.push({
        path: `${path}.correct_answer_index`,
        message: `correct_answer_index must be an integer 0..${maxIdx} for paper_pattern=${paperPattern}`,
      });
    }
  } else {
    // integer / numerical / matrix_match / subjective — need correct_answer_text
    if (typeof q.correct_answer_text !== 'string' || !q.correct_answer_text.trim()) {
      errors.push({
        path: `${path}.correct_answer_text`,
        message: `paper_pattern=${paperPattern} requires non-empty correct_answer_text`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Narrow types now that validation passed.
  const value: PyqQuestion = {
    question_number: questionNumber,
    paper_pattern: paperPattern,
    question_text: (q.question_text as string).trim(),
    marks_correct: q.marks_correct as number,
    marks_wrong: q.marks_wrong as number,
    time_estimate_seconds: q.time_estimate_seconds as number,
  };
  if (Array.isArray(q.options)) {
    value.options = (q.options as string[]).map((o) => o.trim());
  }
  if (typeof q.correct_answer_index === 'number') {
    value.correct_answer_index = q.correct_answer_index;
  }
  if (typeof q.correct_answer_text === 'string') {
    value.correct_answer_text = (q.correct_answer_text as string).trim();
  }

  return { ok: true, value, errors: [] };
}

// ── Claude response parsing ──────────────────────────────────────────────────

/**
 * Strip markdown JSON fences and parse a JSON object out of an LLM response.
 * Returns null on parse failure or when the parsed value isn't a plain object.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  // Find first '{' and last '}'.
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Concept / difficulty / explanation parsers ───────────────────────────────

export interface ConceptClassification {
  /** Lowercase canonical concept code (e.g. "kinematics_motion_in_a_line"). */
  concept_code: string;
  /** Free-text chapter title the classifier picked. The runtime resolves
   *  this to a `curriculum_topics.id` UUID via a fuzzy lookup. */
  chapter_title: string;
  /** Optional integer chapter number when the classifier extracted one. */
  chapter_number: number | null;
}

export function parseConceptResponse(raw: string): ConceptClassification | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const conceptCode = obj.concept_code;
  const chapterTitle = obj.chapter_title;
  if (typeof conceptCode !== 'string' || !conceptCode.trim()) return null;
  if (typeof chapterTitle !== 'string' || !chapterTitle.trim()) return null;
  const chapterNumberRaw = obj.chapter_number;
  const chapterNumber =
    typeof chapterNumberRaw === 'number' && Number.isInteger(chapterNumberRaw) && chapterNumberRaw > 0
      ? chapterNumberRaw
      : null;
  return {
    concept_code: conceptCode.trim().toLowerCase().replace(/\s+/g, '_'),
    chapter_title: chapterTitle.trim(),
    chapter_number: chapterNumber,
  };
}

export interface DifficultyEstimate {
  /** Integer 1..5 — matches question_bank.difficulty column. */
  difficulty: number;
  /** Bloom level enum — matches question_bank.bloom_level. */
  bloom_level: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
}

const VALID_BLOOM_LEVELS = new Set([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);

export function parseDifficultyResponse(raw: string): DifficultyEstimate | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const diff = obj.difficulty;
  const bloom = obj.bloom_level;
  if (typeof diff !== 'number' || !Number.isInteger(diff) || diff < 1 || diff > 5) return null;
  if (typeof bloom !== 'string' || !VALID_BLOOM_LEVELS.has(bloom.toLowerCase())) return null;
  return {
    difficulty: diff,
    bloom_level: bloom.toLowerCase() as DifficultyEstimate['bloom_level'],
  };
}

export interface ExplanationResult {
  explanation: string;
  hint?: string;
}

export function parseExplanationResponse(raw: string): ExplanationResult | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const exp = obj.explanation;
  if (typeof exp !== 'string' || !exp.trim()) return null;
  const hint = typeof obj.hint === 'string' ? obj.hint.trim() : undefined;
  return {
    explanation: exp.trim(),
    ...(hint ? { hint } : {}),
  };
}

// ── Idempotency key ──────────────────────────────────────────────────────────

/**
 * Build the natural idempotency key. The Edge Function feeds this into
 *   INSERT ... ON CONFLICT (exam_session, exam_year, question_number) DO NOTHING
 * so the same PYQ row never lands twice even if the bulk batch is retried
 * after partial failure.
 */
export function buildIdempotencyKey(
  paper: Pick<PyqPaper, 'exam_session' | 'exam_year'>,
  question: Pick<PyqQuestion, 'question_number'>,
): string {
  return `${paper.exam_session}::${paper.exam_year}::${question.question_number}`;
}

// ── Exam relevance mapping ──────────────────────────────────────────────────

/**
 * Map source_type → exam_relevance array for rag_content_chunks.exam_relevance.
 * Used so Foxy retrieval can filter context by exam stream the student is
 * preparing for.
 */
export function examRelevanceForSource(source: PyqSourceType): string[] {
  switch (source) {
    case 'jee_archive':
      return ['JEE'];
    case 'neet_archive':
      return ['NEET'];
    case 'olympiad':
      return ['OLYMPIAD'];
  }
}

// ── Per-paper summary types ──────────────────────────────────────────────────

export interface QuestionOutcome {
  question_number: string;
  status: 'accepted' | 'rejected' | 'duplicate' | 'error';
  /** When status !== 'accepted'. */
  reason?: string;
  /** Oracle rejection category if oracle fired. */
  oracle_category?: string;
}

export interface PaperSummary {
  exam_session: string;
  exam_year: number;
  subject: string;
  grade: string;
  total: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  errors: number;
  outcomes: QuestionOutcome[];
}

export interface BatchReport {
  dry_run: boolean;
  source_type: PyqSourceType;
  papers: PaperSummary[];
  /** Total Claude calls fanned out (classify + difficulty + explanation,
   *  plus any oracle LLM-grader calls). For cost auditing. */
  llm_calls_total: number;
  elapsed_ms: number;
}
