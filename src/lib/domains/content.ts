/**
 * Content Domain (B6) — read-only projections of curriculum + question bank.
 *
 * CONTRACT:
 *   - Every helper here is read-only. B6 owns writes to `question_bank`,
 *     `cbse_syllabus`, `ncert_content`, and `chapter_concepts`, but the
 *     write paths live in dedicated ingestion Edge Functions and the
 *     super-admin CMS. This module is the read side — used by API
 *     routes and other domains that need typed access without each
 *     caller learning the column shape.
 *   - Every helper uses `supabaseAdmin` (service role). The ESLint
 *     `no-restricted-imports` rule on `@/lib/supabase-admin` keeps these
 *     out of client components; `src/lib/domains/**` is in the allow-list.
 *   - Every helper returns ServiceResult<T> — no throws, no silent nulls.
 *   - Single-row lookups return `ServiceResult<T | null>`. Reserve
 *     `NOT_FOUND` for routes that want 404 semantics.
 *   - List queries return `ServiceResult<T[]>`. An empty array is `ok`.
 *   - Never `select('*')`. Map snake_case columns to the camelCase
 *     domain type once, here, so callers don't depend on database column
 *     names.
 *   - Grade is always coerced to string at the projection boundary
 *     (product invariant P5). Even though the underlying columns are
 *     already TEXT, the defensive `String(...)` matches the identity
 *     domain pattern and protects against any future column-type drift.
 *
 * P6 NOTE (question quality):
 *   Question rows projected here include all fields needed for P6
 *   validation (questionText, options, correctAnswerIndex, explanation,
 *   difficulty, bloomLevel) so the caller can enforce P6 at serve time.
 *   This module does NOT itself reject malformed rows — that is the
 *   responsibility of the quiz orchestration code that hands questions
 *   to the student.
 *
 * EMBEDDINGS BOUNDARY:
 *   `rag_content_chunks` is intentionally NOT exposed by this module.
 *   Per `docs/architecture/DATA_OWNERSHIP_MATRIX.md`, embeddings are
 *   accessed only via Edge Functions (e.g. `match_rag_chunks` RPC, the
 *   `quiz-rag-retrieve` and Foxy retrieval paths). Surfacing chunks
 *   through Next.js routes would bypass the existing `is_in_scope`,
 *   board, and verification filters.
 *
 * MISSING TABLES:
 *   `ncert_content` is referenced in DATA_OWNERSHIP_MATRIX but the
 *   physical table is not yet provisioned in this branch. We still
 *   declare the helper so the service contract is locked. If the
 *   underlying table is missing at query time, Postgres returns code
 *   `42P01`; we map this to a single warn log and a `DB_ERROR`
 *   ServiceResult so callers can degrade gracefully without crashing.
 *   Mirrors the precedent set by Phase 0i (analytics) and 0j (ops).
 *
 * SCOPE GUARD (Phase 0d):
 *   - Module-only. Do NOT migrate routes in this phase.
 *   - Do NOT touch Edge Functions, RLS policies, migrations, RBAC.
 *   - Do NOT expose direct outbox writes — writes go through the
 *     `enqueue_event` RPC owned by the architect's outbox migration.
 *
 * MICROSERVICE EXTRACTION PATH:
 *   B6 is a candidate for early extraction because the read API is
 *   purely projective. Wrap each function in an HTTP handler, add
 *   service-to-service auth, and downstream contexts call it via HTTP
 *   instead of direct DB.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type Question,
  type Chapter,
  type NcertContent,
  type ChapterConcept,
} from './types';

// ── Postgres "relation does not exist" detection ──────────────────────────────
//
// Mirrors `analytics.ts` and `ops.ts`. When a referenced table is not yet
// provisioned, Postgres returns SQLSTATE 42P01. Treat as a soft-failure
// DB_ERROR and warn once; never throw.

interface PgErrorLike {
  code?: string;
  message: string;
}

function isMissingRelation(err: PgErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42P01') return true;
  // supabase-js sometimes only surfaces the message text.
  return /relation .* does not exist/i.test(err.message ?? '');
}

// ── List bounds ───────────────────────────────────────────────────────────────

const QUESTIONS_DEFAULT_LIMIT = 50;
const QUESTIONS_MAX_LIMIT = 200;
const CHAPTERS_MAX_LIMIT = 500;
const NCERT_MAX_LIMIT = 500;
const CONCEPTS_MAX_LIMIT = 500;

// ── question_bank ─────────────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  subject: string | null;
  grade: string | number | null;
  chapter_id: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  topic: string | null;
  question_text: string;
  question_hi: string | null;
  question_type: string | null;
  options: unknown;
  correct_answer_index: number | null;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  hint_hi: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  is_active: boolean | null;
  source: string | null;
  is_ncert: boolean | null;
  verified_against_ncert: boolean | null;
  verification_state: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const QUESTION_COLUMNS =
  'id, subject, grade, chapter_id, chapter_number, chapter_title, topic, ' +
  'question_text, question_hi, question_type, options, correct_answer_index, ' +
  'explanation, explanation_hi, hint, hint_hi, difficulty, bloom_level, ' +
  'is_active, source, is_ncert, verified_against_ncert, verification_state, ' +
  'created_at, updated_at';

function coerceOptions(raw: unknown): string[] {
  // The options column is JSONB. Most rows store an array of strings, but
  // legacy rows can store array-of-objects ({ text, isCorrect }) or a JSON
  // string. We project to a string[] so callers don't need to defend.
  if (Array.isArray(raw)) {
    return raw.map((o) => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object' && 'text' in o) {
        const t = (o as { text?: unknown }).text;
        return typeof t === 'string' ? t : '';
      }
      return '';
    });
  }
  if (typeof raw === 'string') {
    try {
      return coerceOptions(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    subject: row.subject,
    // P5: grades are strings everywhere. Coerce defensively.
    grade: row.grade == null ? null : String(row.grade),
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number,
    chapterTitle: row.chapter_title,
    topic: row.topic,
    questionText: row.question_text,
    questionHi: row.question_hi,
    questionType: row.question_type,
    options: coerceOptions(row.options),
    correctAnswerIndex: row.correct_answer_index ?? 0,
    explanation: row.explanation,
    explanationHi: row.explanation_hi,
    hint: row.hint,
    hintHi: row.hint_hi,
    difficulty: row.difficulty ?? 2,
    bloomLevel: row.bloom_level,
    isActive: row.is_active,
    source: row.source,
    isNcert: row.is_ncert,
    verifiedAgainstNcert: row.verified_against_ncert,
    verificationState: row.verification_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch a single question from the question_bank by id.
 *
 * Returns `ok(null)` when the id does not resolve. Callers that need 404
 * semantics should check for `data === null` explicitly.
 *
 * Does NOT enforce ownership — `question_bank` rows are not student-scoped.
 * RLS on the table already restricts non-service callers to active rows.
 */
export async function getQuestion(
  questionId: string
): Promise<ServiceResult<Question | null>> {
  if (!questionId) return fail('questionId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('question_bank')
    .select(QUESTION_COLUMNS)
    .eq('id', questionId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('content_question_bank_table_missing', {
        message: error.message,
      });
      return fail('question_bank table is not provisioned', 'DB_ERROR');
    }
    logger.error('content_get_question_failed', {
      error: new Error(error.message),
      questionId,
    });
    return fail(`question_bank lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapQuestion(data as unknown as QuestionRow) : null);
}

/**
 * List questions matching the supplied filters.
 *
 * - At least one filter is recommended; without filters this returns the
 *   first `limit` rows by created_at desc, which is rarely useful in
 *   production but harmless for diagnostics.
 * - `limit` is clamped to [1, 200] with a default of 50.
 * - Grades are passed as strings (P5).
 * - The chapterId filter targets the `chapter_id` UUID FK (canonical
 *   chapters table). Callers that only have a chapter_number should use
 *   the (grade, subject) filter set instead.
 */
export async function listQuestions(
  opts: {
    grade?: string;
    subject?: string;
    chapterId?: string;
    bloomLevel?: string;
    difficulty?: string;
    limit?: number;
  } = {}
): Promise<ServiceResult<Question[]>> {
  const limit = Math.max(
    1,
    Math.min(opts.limit ?? QUESTIONS_DEFAULT_LIMIT, QUESTIONS_MAX_LIMIT)
  );

  let query = supabaseAdmin
    .from('question_bank')
    .select(QUESTION_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.grade) query = query.eq('grade', String(opts.grade));
  if (opts.subject) query = query.eq('subject', opts.subject);
  if (opts.chapterId) query = query.eq('chapter_id', opts.chapterId);
  if (opts.bloomLevel) query = query.eq('bloom_level', opts.bloomLevel);
  if (opts.difficulty) {
    // difficulty is INTEGER in DB; accept numeric-string from callers.
    const n = Number(opts.difficulty);
    if (!Number.isFinite(n)) {
      return fail('difficulty must be numeric', 'INVALID_INPUT');
    }
    query = query.eq('difficulty', n);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('content_question_bank_table_missing', {
        message: error.message,
      });
      return fail('question_bank table is not provisioned', 'DB_ERROR');
    }
    logger.error('content_list_questions_failed', {
      error: new Error(error.message),
      grade: opts.grade ?? null,
      subject: opts.subject ?? null,
      chapterId: opts.chapterId ?? null,
    });
    return fail(`question_bank lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(
    (data ?? []).map((r) => mapQuestion(r as unknown as QuestionRow))
  );
}

// ── cbse_syllabus (chapters surface) ─────────────────────────────────────────

type ChapterRow = {
  id: string;
  board: string | null;
  grade: string | number | null;
  subject_code: string | null;
  subject_display: string | null;
  subject_display_hi: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  chapter_title_hi: string | null;
  chunk_count: number | null;
  verified_question_count: number | null;
  rag_status: string | null;
  last_verified_at: string | null;
  is_in_scope: boolean | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const CHAPTER_COLUMNS =
  'id, board, grade, subject_code, subject_display, subject_display_hi, ' +
  'chapter_number, chapter_title, chapter_title_hi, chunk_count, ' +
  'verified_question_count, rag_status, last_verified_at, is_in_scope, ' +
  'notes, created_at, updated_at';

function mapChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    board: row.board,
    // P5: grades are strings everywhere.
    grade: row.grade == null ? null : String(row.grade),
    subjectCode: row.subject_code,
    subjectDisplay: row.subject_display,
    subjectDisplayHi: row.subject_display_hi,
    chapterNumber: row.chapter_number,
    chapterTitle: row.chapter_title,
    chapterTitleHi: row.chapter_title_hi,
    chunkCount: row.chunk_count ?? 0,
    verifiedQuestionCount: row.verified_question_count ?? 0,
    ragStatus: row.rag_status,
    lastVerifiedAt: row.last_verified_at,
    isInScope: row.is_in_scope,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch a single chapter (cbse_syllabus row) by id.
 *
 * Returns `ok(null)` when the id does not resolve. Callers needing 404
 * semantics should check for `data === null` explicitly.
 */
export async function getChapter(
  chapterId: string
): Promise<ServiceResult<Chapter | null>> {
  if (!chapterId) return fail('chapterId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('cbse_syllabus')
    .select(CHAPTER_COLUMNS)
    .eq('id', chapterId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('content_cbse_syllabus_table_missing', {
        message: error.message,
      });
      return fail('cbse_syllabus table is not provisioned', 'DB_ERROR');
    }
    logger.error('content_get_chapter_failed', {
      error: new Error(error.message),
      chapterId,
    });
    return fail(`cbse_syllabus lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapChapter(data as unknown as ChapterRow) : null);
}

/**
 * List chapters for a grade, optionally filtered by subject_code.
 *
 * - `grade` is required (P5 string). Without grade scoping this query
 *   would page the entire syllabus, which the caller almost certainly
 *   does not want.
 * - Returns rows ordered by (subject_code, chapter_number).
 * - `is_in_scope` is NOT filtered here — callers that need only in-scope
 *   chapters should filter on `chapter.isInScope === true` themselves.
 *   Surfacing the full set (including out-of-scope rows) keeps this a
 *   pure read API; downstream UIs and admin tools may need the full set.
 */
export async function listChapters(opts: {
  grade: string;
  subject?: string;
}): Promise<ServiceResult<Chapter[]>> {
  if (!opts || !opts.grade) {
    return fail('grade is required', 'INVALID_INPUT');
  }
  const grade = String(opts.grade);

  let query = supabaseAdmin
    .from('cbse_syllabus')
    .select(CHAPTER_COLUMNS)
    .eq('grade', grade)
    .order('subject_code', { ascending: true })
    .order('chapter_number', { ascending: true })
    .limit(CHAPTERS_MAX_LIMIT);

  if (opts.subject) {
    query = query.eq('subject_code', opts.subject);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('content_cbse_syllabus_table_missing', {
        message: error.message,
      });
      return fail('cbse_syllabus table is not provisioned', 'DB_ERROR');
    }
    logger.error('content_list_chapters_failed', {
      error: new Error(error.message),
      grade,
      subject: opts.subject ?? null,
    });
    return fail(`cbse_syllabus lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(
    (data ?? []).map((r) => mapChapter(r as unknown as ChapterRow))
  );
}

// ── ncert_content (planned table) ────────────────────────────────────────────
//
// Per DATA_OWNERSHIP_MATRIX, `ncert_content` is owned by B6. The physical
// table is not yet provisioned in this branch — the contract is locked
// here so callers can begin depending on the typed shape, and the
// soft-fail path keeps the build green until the migration lands.

type NcertContentRow = {
  id: string;
  grade: string | number | null;
  subject: string | null;
  chapter: string | null;
  chapter_number: number | null;
  section: string | null;
  content_type: string | null;
  content_text: string | null;
  content_hi: string | null;
  page_number: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

const NCERT_CONTENT_COLUMNS =
  'id, grade, subject, chapter, chapter_number, section, content_type, ' +
  'content_text, content_hi, page_number, metadata, created_at, updated_at';

function mapNcertContent(row: NcertContentRow): NcertContent {
  return {
    id: row.id,
    // P5: grades are strings everywhere.
    grade: row.grade == null ? null : String(row.grade),
    subject: row.subject,
    chapter: row.chapter,
    chapterNumber: row.chapter_number,
    section: row.section,
    contentType: row.content_type,
    contentText: row.content_text,
    contentHi: row.content_hi,
    pageNumber: row.page_number,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List NCERT content rows for a grade+subject (and optional chapter).
 *
 * - `grade` and `subject` are required: this table is large enough that
 *   unscoped listing is never appropriate.
 * - `chapter` filter accepts either a chapter title or chapter slug; we
 *   pass it straight to `eq('chapter', ...)`. Numeric chapter filtering
 *   should use the structural `chapter_number` column on the chapter
 *   table, not this helper.
 *
 * If the `ncert_content` table is not yet provisioned, returns a
 * soft-failure DB_ERROR (warning logged once) — mirrors the analytics
 * domain pattern for planned-but-missing tables.
 */
export async function getNcertContent(opts: {
  grade: string;
  subject: string;
  chapter?: string;
}): Promise<ServiceResult<NcertContent[]>> {
  if (!opts || !opts.grade) {
    return fail('grade is required', 'INVALID_INPUT');
  }
  if (!opts.subject) {
    return fail('subject is required', 'INVALID_INPUT');
  }

  const grade = String(opts.grade);

  let query = supabaseAdmin
    .from('ncert_content')
    .select(NCERT_CONTENT_COLUMNS)
    .eq('grade', grade)
    .eq('subject', opts.subject)
    .order('chapter_number', { ascending: true })
    .order('page_number', { ascending: true })
    .limit(NCERT_MAX_LIMIT);

  if (opts.chapter) {
    query = query.eq('chapter', opts.chapter);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('content_ncert_content_table_missing', {
        message: error.message,
      });
      return fail('ncert_content table is not provisioned', 'DB_ERROR');
    }
    logger.error('content_get_ncert_content_failed', {
      error: new Error(error.message),
      grade,
      subject: opts.subject,
      chapter: opts.chapter ?? null,
    });
    return fail(`ncert_content lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(
    (data ?? []).map((r) => mapNcertContent(r as unknown as NcertContentRow))
  );
}

// ── chapter_concepts ─────────────────────────────────────────────────────────

type ChapterConceptRow = {
  id: string;
  chapter_id: string | null;
  grade: string | number | null;
  subject: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  concept_number: number | null;
  title: string | null;
  title_hi: string | null;
  slug: string | null;
  learning_objective: string | null;
  learning_objective_hi: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  key_formula: string | null;
  example_title: string | null;
  example_content: string | null;
  example_content_hi: string | null;
  common_mistakes: unknown;
  exam_tips: unknown;
  diagram_refs: unknown;
  diagram_description: string | null;
  practice_question: string | null;
  practice_options: unknown;
  practice_correct_index: number | null;
  practice_explanation: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  estimated_minutes: number | null;
  is_active: boolean | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const CHAPTER_CONCEPT_COLUMNS =
  'id, chapter_id, grade, subject, chapter_number, chapter_title, ' +
  'concept_number, title, title_hi, slug, learning_objective, ' +
  'learning_objective_hi, explanation, explanation_hi, key_formula, ' +
  'example_title, example_content, example_content_hi, common_mistakes, ' +
  'exam_tips, diagram_refs, diagram_description, practice_question, ' +
  'practice_options, practice_correct_index, practice_explanation, ' +
  'difficulty, bloom_level, estimated_minutes, is_active, source, ' +
  'created_at, updated_at';

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

function mapChapterConcept(row: ChapterConceptRow): ChapterConcept {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    // P5: grades are strings everywhere.
    grade: row.grade == null ? null : String(row.grade),
    subject: row.subject,
    chapterNumber: row.chapter_number,
    chapterTitle: row.chapter_title,
    conceptNumber: row.concept_number ?? 0,
    title: row.title,
    titleHi: row.title_hi,
    slug: row.slug,
    learningObjective: row.learning_objective,
    learningObjectiveHi: row.learning_objective_hi,
    explanation: row.explanation,
    explanationHi: row.explanation_hi,
    keyFormula: row.key_formula,
    exampleTitle: row.example_title,
    exampleContent: row.example_content,
    exampleContentHi: row.example_content_hi,
    commonMistakes: asStringArray(row.common_mistakes),
    examTips: asStringArray(row.exam_tips),
    diagramRefs: asStringArray(row.diagram_refs),
    diagramDescription: row.diagram_description,
    practiceQuestion: row.practice_question,
    practiceOptions: asStringArray(row.practice_options),
    practiceCorrectIndex: row.practice_correct_index,
    practiceExplanation: row.practice_explanation,
    difficulty: row.difficulty ?? 2,
    bloomLevel: row.bloom_level,
    estimatedMinutes: row.estimated_minutes ?? 0,
    isActive: row.is_active,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List concepts for a chapter, ordered by concept_number.
 *
 * - `chapterId` is required and matches `chapter_concepts.chapter_id`,
 *   the canonical FK to `chapters(id)` (added in
 *   20260415000014_chapters_canonical_master.sql). Callers that only
 *   know (grade, subject, chapter_number) should resolve to a chapter_id
 *   first via the chapters/cbse_syllabus tables.
 * - Inactive concepts are returned. Callers that want only published
 *   concepts should filter on `concept.isActive === true`.
 */
export async function listChapterConcepts(
  chapterId: string
): Promise<ServiceResult<ChapterConcept[]>> {
  if (!chapterId) return fail('chapterId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('chapter_concepts')
    .select(CHAPTER_CONCEPT_COLUMNS)
    .eq('chapter_id', chapterId)
    .order('concept_number', { ascending: true })
    .limit(CONCEPTS_MAX_LIMIT);

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('content_chapter_concepts_table_missing', {
        message: error.message,
      });
      return fail('chapter_concepts table is not provisioned', 'DB_ERROR');
    }
    logger.error('content_list_chapter_concepts_failed', {
      error: new Error(error.message),
      chapterId,
    });
    return fail(
      `chapter_concepts lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    (data ?? []).map((r) =>
      mapChapterConcept(r as unknown as ChapterConceptRow)
    )
  );
}
