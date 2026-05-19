// supabase/functions/bulk-jee-neet-curated-import/validate.ts
//
// Pure validation helpers for the bulk-jee-neet-curated-import Edge Function
// (the CURATED ingestion path — admin POSTs fully-formed questions; no AI
// calls). The AI-augmented sibling lives in bulk-jee-neet-import/.
// No I/O, no Supabase calls — all functions are deterministic so they can
// be unit-tested under `deno test` without any external dependencies.
//
// Constitution alignment:
//   - P5 (grade is a string "6".."12")
//   - P6 (4 distinct non-empty options, 0..3 correct index, non-empty
//          explanation, valid difficulty, valid bloom_level)
//   - P9 (curated path; no AI / no Claude calls so P12 doesn't apply)
//   - PR-1 migration 20260520000004 widened chk_source_type to accept the
//          new family of sources this importer emits.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaperInput {
  paper_code: string;
  exam_family: string;
  exam_session?: string;
  paper_pattern: string;
  exam_year: number;
  exam_month?: number;
  shift?: string;
  subject_scope: string[];
  total_questions?: number;
  total_marks?: number;
  duration_minutes?: number;
  marking_scheme?: { correct: number; wrong: number; unanswered?: number };
  source_url?: string;
  source_attribution?: string;
  notes?: string;
}

export interface QuestionInput {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  hint?: string;
  subject: string;
  grade: string;
  chapter_title?: string;
  chapter_number?: number;
  chapter_id?: string;
  topic_id?: string;
  difficulty?: number;
  bloom_level?: string;
  question_number?: string;
  marks_correct?: number;
  marks_wrong?: number;
  paper_pattern?: string;
  paper_section?: string;
  tags?: string[];
  concept_code?: string;
  cognitive_load?: 'low' | 'medium' | 'high';
  common_mistakes?: Array<{ wrong: string; why: string }>;
  solution_steps?: Array<{ step: number; text: string }>;
}

export interface ImportRequestBody {
  paper: PaperInput;
  questions: QuestionInput[];
}

// ─── Rejection categories (mirror OracleRejectionCategory style) ────────────

export type ImportRejectionCategory =
  | 'p6_text_empty_or_placeholder'
  | 'p6_text_too_short'
  | 'p6_options_not_4'
  | 'p6_options_not_distinct'
  | 'p6_options_empty'
  | 'p6_correct_index_out_of_range'
  | 'p6_explanation_empty'
  | 'p6_invalid_difficulty'
  | 'p6_invalid_bloom'
  | 'p5_invalid_grade'
  | 'invalid_subject_for_family'
  | 'invalid_paper_pattern'
  | 'invalid_marks';

export interface QuestionRejection {
  index: number;
  code: ImportRejectionCategory;
  reason: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

export const VALID_BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
];

export const ALLOWED_EXAM_FAMILIES = [
  'jee_main',
  'jee_advanced',
  'neet',
  'olympiad_phy',
  'olympiad_chem',
  'olympiad_math',
  'olympiad_bio',
  'olympiad_astro',
  'olympiad_info',
  'cbse_board',
  'kvpy',
  'nsep',
  'nsec',
  'nsejs',
  'nstse',
  'nso',
  'imo',
  'ntse',
] as const;

export type ExamFamily = (typeof ALLOWED_EXAM_FAMILIES)[number];

export const ALLOWED_PAPER_PATTERNS = [
  'mcq_single',
  'mcq_multi',
  'integer',
  'numerical',
  'matching',
  'comprehension',
  'assertion_reason',
  'subjective_proof',
] as const;

export type PaperPattern = (typeof ALLOWED_PAPER_PATTERNS)[number];

// Superset used by cbse_board and the generalist national-level exams that
// span the full school curriculum (kvpy, nso, ntse, etc.). Research can
// refine per-family later — see runbook follow-up.
const CBSE_SUPERSET = [
  'physics',
  'chemistry',
  'biology',
  'math',
  'mathematics',
  'science',
  'english',
  'hindi',
  'social_studies',
  'economics',
  'accountancy',
  'business_studies',
  'political_science',
  'history',
  'geography',
];

export const ALLOWED_SUBJECTS_BY_EXAM_FAMILY: Record<ExamFamily, string[]> = {
  jee_main: ['physics', 'chemistry', 'math', 'mathematics'],
  jee_advanced: ['physics', 'chemistry', 'math', 'mathematics'],
  neet: ['physics', 'chemistry', 'biology'],
  olympiad_phy: ['physics'],
  olympiad_chem: ['chemistry'],
  olympiad_math: ['math', 'mathematics'],
  olympiad_bio: ['biology'],
  olympiad_astro: ['physics', 'math', 'mathematics'],
  olympiad_info: ['computer_science', 'math', 'mathematics'],
  cbse_board: CBSE_SUPERSET,
  kvpy: CBSE_SUPERSET,
  nsep: CBSE_SUPERSET,
  nsec: CBSE_SUPERSET,
  nsejs: CBSE_SUPERSET,
  nstse: CBSE_SUPERSET,
  nso: CBSE_SUPERSET,
  imo: CBSE_SUPERSET,
  ntse: CBSE_SUPERSET,
};

export const PAPER_CODE_RE = /^[a-z0-9_]{1,100}$/;

export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 200;

export const MIN_EXAM_YEAR = 1990;
export const MAX_EXAM_YEAR = 2100;

export const MAX_TEXT_FIELD = 200;
export const MIN_QUESTION_TEXT_LENGTH = 10; // matches chk_question_not_empty

// ─── Source-type auto-mapping ────────────────────────────────────────────────

/**
 * Map an exam_family to the question_bank.source_type literal that the
 * widened CHECK constraint (chk_source_type, PR-1 migration) accepts.
 */
export function mapSourceType(examFamily: string): string {
  if (examFamily === 'jee_main' || examFamily === 'jee_advanced') return 'jee_archive';
  if (examFamily === 'neet') return 'neet_archive';
  if (examFamily.startsWith('olympiad_')) return 'olympiad';
  if (examFamily === 'cbse_board') return 'board_paper';
  return 'pyq';
}

// ─── Paper-level validator ────────────────────────────────────────────────────

export interface PaperValidationOk {
  ok: true;
  paper: PaperInput;
  warnings: string[];
}

export interface PaperValidationErr {
  ok: false;
  field: string;
  message: string;
}

export type PaperValidationResult = PaperValidationOk | PaperValidationErr;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validatePaper(
  raw: unknown,
  questionsLength: number,
): PaperValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, field: 'paper', message: 'paper must be an object' };
  }
  const p = raw as Record<string, unknown>;
  const warnings: string[] = [];

  // paper_code
  if (typeof p.paper_code !== 'string') {
    return { ok: false, field: 'paper.paper_code', message: 'must be a string' };
  }
  if (!PAPER_CODE_RE.test(p.paper_code)) {
    return {
      ok: false,
      field: 'paper.paper_code',
      message:
        'must match /^[a-z0-9_]{1,100}$/ (lowercase letters, digits, underscore, max 100 chars)',
    };
  }

  // exam_family
  if (
    typeof p.exam_family !== 'string' ||
    !ALLOWED_EXAM_FAMILIES.includes(p.exam_family as ExamFamily)
  ) {
    return {
      ok: false,
      field: 'paper.exam_family',
      message: `must be one of: ${ALLOWED_EXAM_FAMILIES.join(', ')}`,
    };
  }

  // paper_pattern
  if (
    typeof p.paper_pattern !== 'string' ||
    !ALLOWED_PAPER_PATTERNS.includes(p.paper_pattern as PaperPattern)
  ) {
    return {
      ok: false,
      field: 'paper.paper_pattern',
      message: `must be one of: ${ALLOWED_PAPER_PATTERNS.join(', ')}`,
    };
  }

  // exam_year
  if (
    typeof p.exam_year !== 'number' ||
    !Number.isInteger(p.exam_year) ||
    p.exam_year < MIN_EXAM_YEAR ||
    p.exam_year > MAX_EXAM_YEAR
  ) {
    return {
      ok: false,
      field: 'paper.exam_year',
      message: `must be an integer in [${MIN_EXAM_YEAR}, ${MAX_EXAM_YEAR}]`,
    };
  }

  // exam_month (optional)
  if (p.exam_month !== undefined && p.exam_month !== null) {
    if (
      typeof p.exam_month !== 'number' ||
      !Number.isInteger(p.exam_month) ||
      p.exam_month < 1 ||
      p.exam_month > 12
    ) {
      return {
        ok: false,
        field: 'paper.exam_month',
        message: 'must be an integer in [1, 12]',
      };
    }
  }

  // subject_scope
  if (!Array.isArray(p.subject_scope) || p.subject_scope.length === 0) {
    return {
      ok: false,
      field: 'paper.subject_scope',
      message: 'must be a non-empty string array',
    };
  }
  if (!p.subject_scope.every((s) => typeof s === 'string' && s.trim().length > 0)) {
    return {
      ok: false,
      field: 'paper.subject_scope',
      message: 'every item must be a non-empty string',
    };
  }

  // total_questions / total_marks / duration_minutes — optional, > 0 when present
  for (const key of ['total_questions', 'total_marks', 'duration_minutes'] as const) {
    if (p[key] !== undefined && p[key] !== null) {
      if (typeof p[key] !== 'number' || !Number.isInteger(p[key] as number) || (p[key] as number) <= 0) {
        return {
          ok: false,
          field: `paper.${key}`,
          message: 'must be a positive integer',
        };
      }
    }
  }

  if (
    typeof p.total_questions === 'number' &&
    p.total_questions !== questionsLength
  ) {
    warnings.push(
      `paper.total_questions (${p.total_questions}) does not match questions.length (${questionsLength})`,
    );
  }

  // marking_scheme — optional, but if present validate shape
  if (p.marking_scheme !== undefined && p.marking_scheme !== null) {
    if (!isPlainObject(p.marking_scheme)) {
      return {
        ok: false,
        field: 'paper.marking_scheme',
        message: 'must be an object with { correct, wrong, unanswered? }',
      };
    }
    const ms = p.marking_scheme as Record<string, unknown>;
    if (!isFiniteNumber(ms.correct)) {
      return {
        ok: false,
        field: 'paper.marking_scheme.correct',
        message: 'must be a finite number',
      };
    }
    if (!isFiniteNumber(ms.wrong)) {
      return {
        ok: false,
        field: 'paper.marking_scheme.wrong',
        message: 'must be a finite number',
      };
    }
  }

  // optional string passthroughs
  for (const key of [
    'exam_session',
    'shift',
    'source_url',
    'source_attribution',
    'notes',
  ] as const) {
    if (p[key] !== undefined && p[key] !== null && typeof p[key] !== 'string') {
      return {
        ok: false,
        field: `paper.${key}`,
        message: 'must be a string when present',
      };
    }
  }

  // Cast through unknown — we've validated every property above.
  return { ok: true, paper: p as unknown as PaperInput, warnings };
}

// ─── Per-question validator ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateQuestion(
  raw: unknown,
  index: number,
  paper: PaperInput,
): { ok: true; q: QuestionInput } | { ok: false; rejection: QuestionRejection } {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_text_empty_or_placeholder',
        reason: 'question item is not an object',
      },
    };
  }
  const q = raw as Record<string, unknown>;

  // question_text
  if (typeof q.question_text !== 'string') {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_text_empty_or_placeholder',
        reason: 'question_text must be a string',
      },
    };
  }
  const text = q.question_text.trim();
  if (!text || text.includes('{{') || text.includes('[BLANK]')) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_text_empty_or_placeholder',
        reason: 'question_text is empty or contains template placeholders',
      },
    };
  }
  if (text.length <= MIN_QUESTION_TEXT_LENGTH) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_text_too_short',
        reason: `question_text must be longer than ${MIN_QUESTION_TEXT_LENGTH} chars (got ${text.length})`,
      },
    };
  }

  // options: exactly 4, non-empty, distinct (case-insensitive)
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_options_not_4',
        reason: 'options must be an array of exactly 4 strings',
      },
    };
  }
  const opts = q.options as unknown[];
  if (!opts.every((o) => typeof o === 'string' && (o as string).trim().length > 0)) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_options_empty',
        reason: 'every option must be a non-empty string',
      },
    };
  }
  const normalized = (opts as string[]).map((o) => o.trim().toLowerCase());
  if (new Set(normalized).size !== 4) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_options_not_distinct',
        reason: 'all 4 options must be distinct (case-insensitive)',
      },
    };
  }

  // correct_answer_index
  if (
    typeof q.correct_answer_index !== 'number' ||
    !Number.isInteger(q.correct_answer_index) ||
    q.correct_answer_index < 0 ||
    q.correct_answer_index > 3
  ) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_correct_index_out_of_range',
        reason: 'correct_answer_index must be an integer in {0,1,2,3}',
      },
    };
  }

  // explanation
  if (
    typeof q.explanation !== 'string' ||
    !q.explanation.trim()
  ) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p6_explanation_empty',
        reason: 'explanation must be a non-empty string',
      },
    };
  }

  // grade — P5
  if (typeof q.grade !== 'string' || !VALID_GRADES.includes(q.grade)) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'p5_invalid_grade',
        reason: 'grade must be a string "6" through "12"',
      },
    };
  }

  // subject — must be valid for the paper's exam_family
  const subj = typeof q.subject === 'string' ? q.subject.toLowerCase().trim() : '';
  const allowedSubjects =
    ALLOWED_SUBJECTS_BY_EXAM_FAMILY[paper.exam_family as ExamFamily] || [];
  if (!subj || !allowedSubjects.includes(subj)) {
    return {
      ok: false,
      rejection: {
        index,
        code: 'invalid_subject_for_family',
        reason: `subject "${q.subject ?? ''}" is not allowed for exam_family "${
          paper.exam_family
        }". Allowed: ${allowedSubjects.join(', ')}`,
      },
    };
  }

  // difficulty — optional, default 3
  let difficulty = 3;
  if (q.difficulty !== undefined && q.difficulty !== null) {
    if (
      typeof q.difficulty !== 'number' ||
      !Number.isInteger(q.difficulty) ||
      q.difficulty < 1 ||
      q.difficulty > 5
    ) {
      return {
        ok: false,
        rejection: {
          index,
          code: 'p6_invalid_difficulty',
          reason: 'difficulty must be an integer in [1, 5]',
        },
      };
    }
    difficulty = q.difficulty;
  }

  // bloom_level — optional, default 'apply'
  let bloomLevel = 'apply';
  if (q.bloom_level !== undefined && q.bloom_level !== null) {
    if (typeof q.bloom_level !== 'string') {
      return {
        ok: false,
        rejection: {
          index,
          code: 'p6_invalid_bloom',
          reason: 'bloom_level must be a string',
        },
      };
    }
    const lower = q.bloom_level.toLowerCase();
    if (!VALID_BLOOM_LEVELS.includes(lower)) {
      return {
        ok: false,
        rejection: {
          index,
          code: 'p6_invalid_bloom',
          reason: `bloom_level must be one of: ${VALID_BLOOM_LEVELS.join(', ')}`,
        },
      };
    }
    bloomLevel = lower;
  }

  // paper_pattern — optional per-question, inherit from paper if absent
  let paperPattern: string = paper.paper_pattern;
  if (q.paper_pattern !== undefined && q.paper_pattern !== null) {
    if (
      typeof q.paper_pattern !== 'string' ||
      !ALLOWED_PAPER_PATTERNS.includes(q.paper_pattern as PaperPattern)
    ) {
      return {
        ok: false,
        rejection: {
          index,
          code: 'invalid_paper_pattern',
          reason: `paper_pattern must be one of: ${ALLOWED_PAPER_PATTERNS.join(', ')}`,
        },
      };
    }
    paperPattern = q.paper_pattern;
  }

  // marks_correct / marks_wrong — optional, finite, range [-10, 10]
  let marksCorrect: number | undefined;
  if (q.marks_correct !== undefined && q.marks_correct !== null) {
    if (!isFiniteNumber(q.marks_correct) || q.marks_correct < -10 || q.marks_correct > 10) {
      return {
        ok: false,
        rejection: {
          index,
          code: 'invalid_marks',
          reason: 'marks_correct must be a finite number in [-10, 10]',
        },
      };
    }
    marksCorrect = q.marks_correct;
  } else if (paper.marking_scheme && isFiniteNumber(paper.marking_scheme.correct)) {
    marksCorrect = paper.marking_scheme.correct;
  }

  let marksWrong: number | undefined;
  if (q.marks_wrong !== undefined && q.marks_wrong !== null) {
    if (!isFiniteNumber(q.marks_wrong) || q.marks_wrong < -10 || q.marks_wrong > 10) {
      return {
        ok: false,
        rejection: {
          index,
          code: 'invalid_marks',
          reason: 'marks_wrong must be a finite number in [-10, 10]',
        },
      };
    }
    marksWrong = q.marks_wrong;
  } else if (paper.marking_scheme && isFiniteNumber(paper.marking_scheme.wrong)) {
    marksWrong = paper.marking_scheme.wrong;
  }

  // chapter_id / topic_id — UUID format when present
  for (const key of ['chapter_id', 'topic_id'] as const) {
    if (q[key] !== undefined && q[key] !== null) {
      if (typeof q[key] !== 'string' || !UUID_RE.test(q[key] as string)) {
        return {
          ok: false,
          rejection: {
            index,
            code: 'p6_text_empty_or_placeholder',
            reason: `${key} must be a UUID string when present`,
          },
        };
      }
    }
  }

  // cognitive_load — optional enum
  if (q.cognitive_load !== undefined && q.cognitive_load !== null) {
    if (
      typeof q.cognitive_load !== 'string' ||
      !['low', 'medium', 'high'].includes(q.cognitive_load)
    ) {
      return {
        ok: false,
        rejection: {
          index,
          code: 'p6_text_empty_or_placeholder',
          reason: 'cognitive_load must be one of: low, medium, high',
        },
      };
    }
  }

  const normalizedQ: QuestionInput = {
    question_text: text,
    options: (opts as string[]).map((o) => o.trim()),
    correct_answer_index: q.correct_answer_index,
    explanation: (q.explanation as string).trim(),
    hint: typeof q.hint === 'string' ? q.hint.trim() : undefined,
    subject: subj,
    grade: q.grade,
    chapter_title:
      typeof q.chapter_title === 'string' ? q.chapter_title.trim() : undefined,
    chapter_number:
      typeof q.chapter_number === 'number' && Number.isInteger(q.chapter_number)
        ? q.chapter_number
        : undefined,
    chapter_id: typeof q.chapter_id === 'string' ? q.chapter_id : undefined,
    topic_id: typeof q.topic_id === 'string' ? q.topic_id : undefined,
    difficulty,
    bloom_level: bloomLevel,
    question_number:
      typeof q.question_number === 'string' ? q.question_number.trim() : undefined,
    marks_correct: marksCorrect,
    marks_wrong: marksWrong,
    paper_pattern: paperPattern,
    paper_section:
      typeof q.paper_section === 'string' ? q.paper_section.trim() : undefined,
    tags:
      Array.isArray(q.tags) &&
      q.tags.every((t) => typeof t === 'string')
        ? (q.tags as string[])
        : undefined,
    concept_code:
      typeof q.concept_code === 'string' ? q.concept_code.trim() : undefined,
    cognitive_load: q.cognitive_load as 'low' | 'medium' | 'high' | undefined,
    common_mistakes: Array.isArray(q.common_mistakes)
      ? (q.common_mistakes as Array<{ wrong: string; why: string }>)
      : undefined,
    solution_steps: Array.isArray(q.solution_steps)
      ? (q.solution_steps as Array<{ step: number; text: string }>)
      : undefined,
  };

  return { ok: true, q: normalizedQ };
}

// ─── Batch-size validator ────────────────────────────────────────────────────

export function validateBatchSize(
  questions: unknown,
): { ok: true; n: number } | { ok: false; message: string } {
  if (!Array.isArray(questions)) {
    return { ok: false, message: 'questions must be an array' };
  }
  if (questions.length < MIN_BATCH_SIZE) {
    return { ok: false, message: `questions array must contain at least ${MIN_BATCH_SIZE} item(s)` };
  }
  if (questions.length > MAX_BATCH_SIZE) {
    return {
      ok: false,
      message: `questions array exceeds maximum batch size of ${MAX_BATCH_SIZE} (got ${questions.length})`,
    };
  }
  return { ok: true, n: questions.length };
}
