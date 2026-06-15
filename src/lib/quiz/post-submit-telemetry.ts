/**
 * src/lib/quiz/post-submit-telemetry.ts — post-submit learning telemetry for the
 * server-authoritative quiz submit path (SPEC-1..5).
 *
 * SERVER-ONLY. Uses the service-role Supabase client (`admin`) passed by the
 * caller for every read/write. Fire-and-forget by design — every public entry
 * point is wrapped so it NEVER throws into the submit response and NEVER blocks
 * it. The whole feature is gated behind `ff_quiz_telemetry_v1` (default OFF /
 * unseeded → dormant), evaluated by the caller before any of this runs.
 *
 * ─── DUAL-ID CONTRACT (critical) ─────────────────────────────────────────────
 *   WRITES → learning_events.student_id, intervention_alerts.student_id MUST use
 *            auth.uid() (auth.users.id). Passed as `authUserId`.
 *   READS  → concept_mastery, adaptive_mastery are keyed by students.id. Passed
 *            as `studentId`.
 *   These are NEVER conflated. See log-event.ts + the two create-table
 *   migrations (20260615122657 / 20260615122658) — both FK student_id to
 *   auth.users(id); concept_mastery/adaptive_mastery FK student_id to students(id).
 *
 * ─── ORDERING ────────────────────────────────────────────────────────────────
 *   SPEC-2 needs a pre/post mastery comparison, so the topic_id resolution +
 *   pre-mastery read MUST happen BEFORE the submit RPC. The caller invokes
 *   `prepareQuizTelemetry()` before the RPC and threads the returned snapshot
 *   into `runQuizPostSubmitTelemetry()` (called after a fresh, successful grade).
 *
 * ─── P13 ─────────────────────────────────────────────────────────────────────
 *   Payloads carry IDs + numeric metrics + enums only — never question/answer
 *   text, never PII.
 *
 * ─── P5 ──────────────────────────────────────────────────────────────────────
 *   Grade is always coerced to a string in event context.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logLearningEvent, generateCorrelationId } from '@/lib/monitoring/log-event';

/** Mastery-achieved threshold (assessment-approved, SPEC-2). */
const MASTERY_THRESHOLD = 0.8;

/** Consecutive-wrong intervention threshold (SPEC-3). */
const CONSECUTIVE_WRONG_THRESHOLD = 3;

/**
 * Snapshot captured BEFORE the submit RPC (SPEC-2 pre-read). Threaded by the
 * route into `runQuizPostSubmitTelemetry()` after the RPC returns a fresh grade.
 *
 * - `topicIdByQuestionId`: question_id → curriculum_topics.id (OQ-2 Option B
 *   batch read of question_bank). null when a question has no topic_id.
 * - `preMasteryByTopicId`: topic_id → pre-submit concept_mastery.mastery_level
 *   read as a FLOAT (parseFloat, NaN→0.0). One entry per UNIQUE topic_id.
 * - `correlationId`: one per submission, stamped on every emitted event.
 */
export interface QuizTelemetryPre {
  topicIdByQuestionId: Record<string, string | null>;
  preMasteryByTopicId: Record<string, number>;
  correlationId: string;
}

/** Facts the post-submit telemetry reads about the submission. */
export interface QuizTelemetryInput {
  /** students.id — used for concept_mastery / adaptive_mastery READS only. */
  studentId: string;
  /** Quiz session id (from RPC result, falling back to the request session). */
  sessionId: string;
  subject?: string;
  /** Grade as a STRING (P5). Coerced again defensively before emit. */
  grade?: string;
  chapter?: number | null;
  /** Per-question request timing (SECONDS). Matched to RPC questions by id. */
  responses: Array<{ question_id: string; time_taken_seconds?: number | null }>;
  /** RPC per-question grades: { question_id, is_correct }. */
  gradedQuestions: Array<{ question_id?: string; is_correct?: boolean }>;
}

/** Cast guard: parse a possibly-text mastery value as a float; NaN → 0.0. */
function toMasteryFloat(value: unknown): number {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0.0;
}

/**
 * PRE-RPC step (SPEC-1 topic resolution + SPEC-2 pre-mastery read).
 *
 * Best-effort: never throws. On any failure returns a safe empty snapshot
 * (telemetry then degrades to no-op for the affected facts). MUST be called
 * before the submit RPC so the pre-mastery read reflects the pre-submission
 * state.
 *
 * @param admin      service-role Supabase client
 * @param studentId  students.id (concept_mastery READ key)
 * @param questionIds question ids from the request responses[]
 */
export async function prepareQuizTelemetry(
  admin: SupabaseClient,
  studentId: string,
  questionIds: string[],
): Promise<QuizTelemetryPre> {
  const correlationId = generateCorrelationId();
  const empty: QuizTelemetryPre = {
    topicIdByQuestionId: {},
    preMasteryByTopicId: {},
    correlationId,
  };

  try {
    const uniqueQuestionIds = Array.from(new Set(questionIds.filter(Boolean)));
    if (uniqueQuestionIds.length === 0) return empty;

    // OQ-2 Option B: batch question_id → topic_id resolution.
    const topicIdByQuestionId: Record<string, string | null> = {};
    const { data: qbRows } = await admin
      .from('question_bank')
      .select('id, topic_id')
      .in('id', uniqueQuestionIds);

    for (const row of (qbRows ?? []) as Array<{ id: string; topic_id: string | null }>) {
      topicIdByQuestionId[row.id] = row.topic_id ?? null;
    }

    // Unique topic_ids touched by this quiz (SPEC-2: one pre-read per topic).
    const uniqueTopicIds = Array.from(
      new Set(
        Object.values(topicIdByQuestionId).filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        ),
      ),
    );

    const preMasteryByTopicId: Record<string, number> = {};
    if (uniqueTopicIds.length > 0) {
      // READ keyed by students.id + topic_id. mastery_level is read as FLOAT
      // (the quiz updater writes mastery_level::TEXT; parseFloat, NaN→0.0).
      const { data: cmRows } = await admin
        .from('concept_mastery')
        .select('topic_id, mastery_level')
        .eq('student_id', studentId)
        .in('topic_id', uniqueTopicIds);

      for (const row of (cmRows ?? []) as Array<{
        topic_id: string;
        mastery_level: unknown;
      }>) {
        preMasteryByTopicId[row.topic_id] = toMasteryFloat(row.mastery_level);
      }
      // Topics with no concept_mastery row yet → pre-mastery 0.0 (not started).
      for (const t of uniqueTopicIds) {
        if (!(t in preMasteryByTopicId)) preMasteryByTopicId[t] = 0.0;
      }
    }

    return { topicIdByQuestionId, preMasteryByTopicId, correlationId };
  } catch {
    // Never let a pre-read failure break submit. Degrade to empty snapshot.
    return empty;
  }
}

/**
 * POST-RPC step (SPEC-1 per-answer events, SPEC-2 mastery-achieved events,
 * SPEC-3 consecutive-wrong intervention). Fire-and-forget — never throws,
 * never blocks the response.
 *
 * The caller MUST only invoke this on a FRESH grade (skip on duplicate /
 * idempotent_replay / error — SPEC-5). The route already short-circuits the
 * whole telemetry block in those cases.
 *
 * @param admin      service-role Supabase client (concept/adaptive READS,
 *                   intervention_alerts check-before-insert WRITE)
 * @param authUserId auth.uid() — learning_events / intervention_alerts WRITE key
 * @param input      submission facts (studentId is the concept/adaptive READ key)
 * @param pre        the pre-RPC snapshot from prepareQuizTelemetry()
 */
export function runQuizPostSubmitTelemetry(
  admin: SupabaseClient,
  authUserId: string,
  input: QuizTelemetryInput,
  pre: QuizTelemetryPre,
): void {
  void (async () => {
    const gradeStr = input.grade !== undefined && input.grade !== null
      ? String(input.grade) // P5: grade stays a string
      : null;
    const baseContext = {
      grade: gradeStr,
      subject: input.subject ?? null,
      chapter: input.chapter ?? null,
      correlation_id: pre.correlationId,
    };

    // Map question_id → request time_taken_seconds (SECONDS → ms).
    const timeSecByQuestionId = new Map<string, number | null | undefined>();
    for (const r of input.responses) {
      timeSecByQuestionId.set(r.question_id, r.time_taken_seconds);
    }

    // Map question_id → graded outcome from the RPC result.
    const gradedByQuestionId = new Map<string, boolean>();
    for (const g of input.gradedQuestions) {
      if (g && typeof g.question_id === 'string') {
        gradedByQuestionId.set(g.question_id, g.is_correct === true);
      }
    }

    // ── SPEC-1: one quiz_attempt learning event per graded question ──────────
    for (const g of input.gradedQuestions) {
      if (!g || typeof g.question_id !== 'string') continue;
      const questionId = g.question_id;
      const isCorrect = g.is_correct === true;
      const topicId = pre.topicIdByQuestionId[questionId] ?? null;

      const timeSec = timeSecByQuestionId.get(questionId);
      const timeMs =
        typeof timeSec === 'number' && Number.isFinite(timeSec)
          ? Math.round(timeSec * 1000)
          : null;

      await logLearningEvent({
        student_id: authUserId, // WRITE → auth.uid()
        session_id: input.sessionId,
        event_type: 'quiz_attempt',
        topic_id: topicId,
        question_id: questionId,
        verb: 'answered',
        object_type: 'question',
        result: {
          is_correct: isCorrect,
          time_ms: timeMs,
          attempt_number: 1,
        },
        context: baseContext,
      });
    }

    // ── SPEC-2: mastery-achieved events (pre < 0.8 AND post >= 0.8) ──────────
    // One post-read per UNIQUE topic_id (mirrors the pre-read dedup).
    const uniqueTopicIds = Array.from(
      new Set(
        Object.values(pre.topicIdByQuestionId).filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        ),
      ),
    );

    if (uniqueTopicIds.length > 0) {
      let postByTopicId: Record<string, number> = {};
      try {
        const { data: cmPost } = await admin
          .from('concept_mastery')
          .select('topic_id, mastery_level')
          .eq('student_id', input.studentId) // READ → students.id
          .in('topic_id', uniqueTopicIds);
        for (const row of (cmPost ?? []) as Array<{
          topic_id: string;
          mastery_level: unknown;
        }>) {
          postByTopicId[row.topic_id] = toMasteryFloat(row.mastery_level);
        }
      } catch {
        postByTopicId = {};
      }

      for (const topicId of uniqueTopicIds) {
        const preMastery = pre.preMasteryByTopicId[topicId] ?? 0.0;
        const postMastery = postByTopicId[topicId] ?? 0.0;
        const masteryAchieved =
          preMastery < MASTERY_THRESHOLD && postMastery >= MASTERY_THRESHOLD;
        if (!masteryAchieved) continue;

        await logLearningEvent({
          student_id: authUserId, // WRITE → auth.uid()
          session_id: input.sessionId,
          event_type: 'mastery_updated',
          topic_id: topicId,
          question_id: null,
          verb: 'achieved',
          object_type: 'topic',
          result: {
            pre_mastery: preMastery,
            post_mastery: postMastery,
            threshold: MASTERY_THRESHOLD,
          },
          context: baseContext,
        });
      }
    }

    // ── SPEC-3: consecutive-wrong intervention ──────────────────────────────
    // OQ-5: adaptive_mastery is keyed by node_code (text), NOT topic_id. The
    // baseline schema has NO reliable mapping from learning_graph.node_code →
    // curriculum_topics.id (learning_graph carries no topic_id; curriculum_topics
    // carries no node_code; question_bank carries topic_id but no node_code).
    // Per the spec, we DO NOT guess topic attribution from adaptive_mastery —
    // a mis-attributed intervention_alerts.topic_id is worse than none. SPEC-3 is
    // therefore implemented DEFENSIVELY: the adaptive_mastery.consecutive_wrong
    // path is skipped and no alert is inserted from it.
    //
    // TODO(backend/architect): establish a reliable node_code ↔ curriculum_topics.id
    //   mapping (e.g. add learning_graph.topic_id, or a node_code→topic_id bridge
    //   table) and then read adaptive_mastery.consecutive_wrong (keyed by
    //   students.id) for the quiz's nodes, inserting a check-before-insert
    //   intervention_alerts row when consecutive_wrong >= CONSECUTIVE_WRONG_THRESHOLD.
    //   triggerFoxy would be true if any topic crosses the threshold (SPEC-4 —
    //   not required synchronously this pass).
    //
    // The check-before-insert WRITE shape (kept here for the follow-up) is:
    //   - look up an OPEN intervention_alerts row (student_id=authUserId, topic_id,
    //     alert_type='consecutive_wrong', resolved_at IS NULL); insert only if none:
    //     { student_id: authUserId, topic_id, alert_type:'consecutive_wrong',
    //       severity:'act', trigger_data:{ count, threshold: CONSECUTIVE_WRONG_THRESHOLD } }
    // Reference CONSECUTIVE_WRONG_THRESHOLD so the constant is not flagged unused.
    void CONSECUTIVE_WRONG_THRESHOLD;
  })().catch(() => {
    // Last-ditch swallow — telemetry must never break the submit flow.
  });
}
