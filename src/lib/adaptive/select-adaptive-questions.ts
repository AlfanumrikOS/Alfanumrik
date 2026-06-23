// src/lib/adaptive/select-adaptive-questions.ts
//
// Phase 2 — LIVE adaptive question selection (candidate provider).
//
// This is the application-TypeScript lift of the (dead, off-path)
// selectAdaptiveQuestions logic in supabase/functions/quiz-generator/index.ts.
// The edge-function version is commented-out inside a /* */ block and never
// runs in production; the live quiz path (quiz/page.tsx → quiz-assembler →
// getQuizQuestionsV2) currently reads NO mastery/IRT signal at all.
//
// What this module does (composition, in order):
//   1. WEAK-TOPIC TARGETING — read the student's concept_mastery rows
//      (joined to curriculum_topics so we can resolve chapter_number +
//      concept_tag), keep only sub-mastered topics, and order them
//      DUE-FOR-REVIEW first, then LOWEST-MASTERY first.
//   2. BLOOM CEILING — for each weak topic, cap the allowed Bloom levels by
//      mastery via masteryToMaxBloomLevel (scaffolded progression: a student
//      who is weak on a topic is not handed create-level items).
//   3. IRT-PROXY RANKING — score every candidate question with
//      computeSelectionScore(irt_theta, item) from src/lib/irt/fisher-info.ts.
//      When the item is uncalibrated (irt_calibration_n < 30) this falls back
//      to the irt_difficulty proxy distance to theta; when no theta is known
//      it degrades gracefully (theta defaults to 0 = average ability).
//
// IMPORTANT — this is a CANDIDATE PROVIDER, not a hard filter. It returns
// weak-topic-targeted candidate rows; the caller (getQuizQuestionsV2) layers
// these IN FRONT of the existing fallback ladder, which still tops the result
// up to the exact requested count and re-applies the P6 quality gate. This
// module never shrinks a quiz below the requested count and never bypasses
// the count/P6 guarantees enforced downstream by assembleQuiz.
//
// Invariants honoured here:
//   - P5: grade is a string "6".."12" — passed through verbatim, never coerced.
//   - P6: only active, non-deleted, MCQ-shaped questions are returned as
//     candidates (the caller's validateQuestion still runs as the final gate).
//   - No model/provider concerns — this is SELECTION, not generation.
//
// Owning agent: ai-engineer. Assessment reviews retrieval/selection correctness.

import { computeSelectionScore, type IrtItemParams } from '@/lib/irt/fisher-info';

// ── Bloom helpers (lifted verbatim from the dead edge-fn logic) ──────────────

/** Bloom's taxonomy, lowest-order → highest-order. */
const BLOOM_LEVELS_ORDERED = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;

/**
 * Map a mastery_level (0..1) to a MAXIMUM allowed Bloom level (ceiling).
 * Students with low mastery are capped at lower-order Bloom levels to enforce
 * scaffolded progression:
 *   mastery < 0.3  → only 'remember', 'understand'
 *   mastery < 0.5  → up to 'apply'
 *   mastery < 0.7  → up to 'analyze'
 *   mastery < 0.85 → up to 'evaluate'
 *   else           → all levels allowed ('create')
 */
export function masteryToMaxBloomLevel(mastery: number): string {
  if (mastery < 0.3) return 'understand';
  if (mastery < 0.5) return 'apply';
  if (mastery < 0.7) return 'analyze';
  if (mastery < 0.85) return 'evaluate';
  return 'create';
}

/** Return all Bloom levels from 'remember' up to and including the given maxLevel. */
export function getBloomLevelsUpTo(maxLevel: string): string[] {
  const idx = (BLOOM_LEVELS_ORDERED as readonly string[]).indexOf(maxLevel);
  if (idx < 0) return [...BLOOM_LEVELS_ORDERED];
  return BLOOM_LEVELS_ORDERED.slice(0, idx + 1);
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal structural type for the Supabase client this module needs. We avoid
 * importing the concrete SupabaseClient type so the module stays testable with
 * a hand-rolled fake; only the chained query-builder surface we actually use is
 * described here.
 */
export interface AdaptiveQueryBuilder {
  select: (cols: string) => AdaptiveQueryBuilder;
  eq: (col: string, val: unknown) => AdaptiveQueryBuilder;
  lt: (col: string, val: unknown) => AdaptiveQueryBuilder;
  in: (col: string, vals: unknown[]) => AdaptiveQueryBuilder;
  not: (col: string, op: string, val: unknown) => AdaptiveQueryBuilder;
  order: (col: string, opts: { ascending: boolean }) => AdaptiveQueryBuilder;
  limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface AdaptiveClient {
  from: (table: string) => AdaptiveQueryBuilder;
}

export interface SelectAdaptiveQuestionsParams {
  studentId: string;
  subject: string; // subject CODE (question_bank.subject is the text code)
  grade: string; // P5: "6".."12"
  count: number;
  /** IRT ability estimate (student_learning_profiles.irt_theta). null → 0 (avg). */
  irtTheta?: number | null;
  /** Question IDs already chosen this session — never re-surface these. */
  excludeIds?: string[];
}

export interface SelectAdaptiveQuestionsResult {
  /** Weak-topic-targeted candidate rows, IRT-proxy ranked (best first). */
  questions: any[];
  /** Number of distinct weak topics the candidates were drawn from. */
  weakTopicsTargeted: number;
}

interface ConceptMasteryJoinRow {
  topic_id: string;
  /**
   * Canonical numeric posterior (0-1) from concept_mastery.mastery_probability.
   * NOT concept_mastery.mastery_level — that is now a TEXT band label, never a number.
   */
  mastery_probability: number;
  next_review_at: string | null;
  // PostgREST returns the embedded relation as an object (one-to-one via !inner)
  // or, depending on FK cardinality inference, as an array. Handle both.
  curriculum_topics:
    | { subject_id: string; chapter_number: number | null; concept_tag: string | null }
    | { subject_id: string; chapter_number: number | null; concept_tag: string | null }[]
    | null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function normaliseTopicJoin(
  row: ConceptMasteryJoinRow,
): { chapter_number: number | null; concept_tag: string | null } {
  const ct = row.curriculum_topics;
  const obj = Array.isArray(ct) ? ct[0] : ct;
  return {
    chapter_number: obj?.chapter_number ?? null,
    concept_tag: obj?.concept_tag ?? null,
  };
}

function toIrtItemParams(q: any): IrtItemParams {
  return {
    irt_a: typeof q.irt_a === 'number' ? q.irt_a : null,
    irt_b: typeof q.irt_b === 'number' ? q.irt_b : null,
    irt_calibration_n: typeof q.irt_calibration_n === 'number' ? q.irt_calibration_n : 0,
    irt_difficulty: typeof q.irt_difficulty === 'number' ? q.irt_difficulty : null,
  };
}

/**
 * Lightweight P6-shape guard applied to candidate rows before they leave this
 * provider. This is intentionally a SUBSET of the caller's full validateQuestion
 * (which still runs downstream) — its only job is to avoid surfacing obviously
 * unusable rows as "weak-topic candidates". The authoritative P6 gate remains
 * validateQuestion in quiz-assembler.ts.
 */
function isUsableCandidate(q: any): boolean {
  if (!q || typeof q.id !== 'string') return false;
  if (!q.question_text || typeof q.question_text !== 'string') return false;
  const qType = (q.question_type ?? 'mcq').toLowerCase();
  if (qType !== 'mcq') return true; // non-MCQ shapes validated downstream
  const opts = Array.isArray(q.options)
    ? q.options
    : typeof q.options === 'string'
      ? safeParseOptions(q.options)
      : [];
  if (opts.length !== 4) return false;
  if (typeof q.correct_answer_index !== 'number' || q.correct_answer_index < 0 || q.correct_answer_index > 3)
    return false;
  return true;
}

function safeParseOptions(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Main selector ─────────────────────────────────────────────────────────────

/**
 * Select weak-topic-targeted candidate questions for a student.
 *
 * Returns up to `count` candidate rows (and how many distinct weak topics they
 * were drawn from). The caller is responsible for topping up to the exact
 * requested count via its existing fallback ladder and for the final P6 gate.
 *
 * Never throws on data-layer errors: on any failure it returns an empty
 * candidate set so the caller falls straight through to the unchanged ladder
 * (fail-safe — the live quiz can never regress because of this provider).
 */
export async function selectAdaptiveQuestions(
  client: AdaptiveClient,
  params: SelectAdaptiveQuestionsParams,
): Promise<SelectAdaptiveQuestionsResult> {
  const { studentId, subject, grade, count } = params;
  const theta = params.irtTheta ?? 0; // 0 = average ability when uncalibrated
  const excludeIds = new Set<string>(params.excludeIds ?? []);
  const now = new Date().toISOString();

  if (count <= 0) return { questions: [], weakTopicsTargeted: 0 };

  // 0. Resolve the subject CODE → subject UUID. curriculum_topics keys on
  //    subject_id (UUID), not the text code — mirrors the resolution pattern
  //    used elsewhere in supabase.ts. No subject row → no adaptive targeting
  //    possible; fall straight through to the caller's ladder.
  let subjectId: string | null = null;
  try {
    const { data, error } = await client
      .from('subjects')
      .select('id')
      .eq('code', subject)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
      return { questions: [], weakTopicsTargeted: 0 };
    }
    subjectId = (data as { id: string }).id;
  } catch {
    return { questions: [], weakTopicsTargeted: 0 };
  }

  // 1. WEAK-TOPIC TARGETING — read sub-mastered topics for this subject.
  //    Join curriculum_topics so we can resolve chapter_number + concept_tag
  //    (question_bank has no topic_id column; it is matched via chapter_number
  //    and optionally concept_tag).
  let masteryRows: ConceptMasteryJoinRow[] = [];
  try {
    const { data, error } = await client
      .from('concept_mastery')
      .select(
        'topic_id, mastery_probability, next_review_at, curriculum_topics!inner(subject_id, chapter_number, concept_tag)',
      )
      .eq('student_id', studentId)
      .eq('curriculum_topics.subject_id', subjectId)
      .lt('mastery_probability', 0.95)
      .order('mastery_probability', { ascending: true })
      .limit(20);
    if (error || !Array.isArray(data)) {
      return { questions: [], weakTopicsTargeted: 0 };
    }
    masteryRows = data as unknown as ConceptMasteryJoinRow[];
  } catch {
    return { questions: [], weakTopicsTargeted: 0 };
  }

  if (masteryRows.length === 0) {
    return { questions: [], weakTopicsTargeted: 0 };
  }

  // Prioritise: due-for-review first, then lowest mastery first.
  const prioritised = [...masteryRows].sort((a, b) => {
    const aDue = a.next_review_at && a.next_review_at <= now ? 1 : 0;
    const bDue = b.next_review_at && b.next_review_at <= now ? 1 : 0;
    if (bDue !== aDue) return bDue - aDue;
    return a.mastery_probability - b.mastery_probability;
  });

  // Allocate slots per weak topic, then pull a candidate pool per topic.
  const slotsPerTopic = Math.max(1, Math.floor(count / Math.max(prioritised.length, 1)));
  const targetTopics = prioritised.slice(0, Math.ceil(count / slotsPerTopic));

  const picked: any[] = [];
  const usedIds = new Set<string>(excludeIds);
  let weakTopicsTargeted = 0;

  for (const topic of targetTopics) {
    if (picked.length >= count) break;

    const { chapter_number: chapterNum, concept_tag: conceptTag } = normaliseTopicJoin(topic);
    // 2. BLOOM CEILING — cap by mastery (scaffolded progression).
    const allowedBlooms = getBloomLevelsUpTo(masteryToMaxBloomLevel(topic.mastery_probability));
    const need = Math.min(slotsPerTopic, count - picked.length);

    // Candidate pool for this topic. P6: active, MCQ-shaped, valid-only is
    // re-confirmed downstream; here we filter to active + grade + subject and
    // the Bloom ceiling. Overfetch (need * 4) so the IRT-proxy ranking below
    // has a real choice rather than ranking a degenerate 1-item pool.
    let qb = client
      .from('question_bank')
      .select(
        'id, question_text, question_hi, question_type, options, correct_answer_index, ' +
          'explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number, ' +
          'concept_tag, subject, irt_a, irt_b, irt_calibration_n, irt_difficulty',
      )
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true)
      .in('bloom_level', allowedBlooms);

    if (chapterNum != null) qb = qb.eq('chapter_number', chapterNum);
    if (conceptTag) qb = qb.eq('concept_tag', conceptTag);

    let rows: any[] = [];
    try {
      const { data, error } = await qb.limit(Math.max(need * 4, 8));
      if (!error && Array.isArray(data)) rows = data;
    } catch {
      rows = [];
    }

    // Fallback within the topic: relax concept_tag (keep chapter + Bloom ceiling)
    // when the concept-tagged pool is too thin to fill `need`.
    if (rows.length < need && conceptTag && chapterNum != null) {
      try {
        const { data, error } = await client
          .from('question_bank')
          .select(
            'id, question_text, question_hi, question_type, options, correct_answer_index, ' +
              'explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number, ' +
              'concept_tag, subject, irt_a, irt_b, irt_calibration_n, irt_difficulty',
          )
          .eq('subject', subject)
          .eq('grade', grade)
          .eq('is_active', true)
          .eq('chapter_number', chapterNum)
          .in('bloom_level', allowedBlooms)
          .limit(Math.max(need * 4, 8));
        if (!error && Array.isArray(data)) rows = data;
      } catch {
        /* keep prior rows */
      }
    }

    // 3. IRT-PROXY RANKING — rank this topic's candidates by selection score at
    //    the student's theta (best first), then take `need` after exclusion and
    //    P6-shape guard.
    const ranked = rows
      .filter((q) => q && typeof q.id === 'string' && !usedIds.has(q.id) && isUsableCandidate(q))
      .map((q) => ({ q, score: computeSelectionScore(theta, toIrtItemParams(q)).score }))
      .sort((a, b) => b.score - a.score);

    let pickedThisTopic = 0;
    for (const { q } of ranked) {
      if (picked.length >= count) break;
      if (pickedThisTopic >= need) break; // soft per-topic cap → spread across weak topics
      if (usedIds.has(q.id)) continue;
      picked.push(q);
      usedIds.add(q.id);
      pickedThisTopic++;
    }
    if (pickedThisTopic > 0) weakTopicsTargeted++;
  }

  return { questions: picked.slice(0, count), weakTopicsTargeted };
}
