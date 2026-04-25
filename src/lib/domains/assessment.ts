/**
 * Assessment Domain (B9) — read-only typed APIs.
 *
 * CONTRACT:
 *   - Server-only via supabaseAdmin (service-role). The ESLint
 *     `no-restricted-imports` rule on `@/lib/supabase-admin` allow-lists
 *     `src/lib/domains/**` and blocks all client/component callers.
 *   - All functions return ServiceResult<T>. Soft-fail with DB_ERROR (and a
 *     single logger.warn) on Postgres 42P01 (relation does not exist) so
 *     planned-but-unprovisioned tables degrade gracefully.
 *   - No writes here. The B9 write path (mastery updates, gap detection)
 *     stays inside cme-engine and atomic_quiz_profile_update — those are
 *     P1/P4 sacred and intentionally NOT wrapped by this module.
 *   - P5 invariant: any grade column is coerced to string at the projection
 *     boundary. Callers never see numeric grades.
 *
 * Phase 0f scope (per docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md):
 *   - concept_mastery     (read)
 *   - topic_mastery       (read)
 *   - knowledge_gaps      (read)
 *   - diagnostic_sessions (read, including grade coercion)
 *   - learning_graph_nodes (read; table not yet provisioned — soft-fail)
 *   - cme_error_log       (read)
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type ConceptMastery,
  type TopicMastery,
  type KnowledgeGap,
  type DiagnosticSession,
  type LearningGraphNode,
  type CmeError,
} from './types';

// ── Shared helpers ────────────────────────────────────────────────────────────

const PG_RELATION_DOES_NOT_EXIST = '42P01';

function isMissingRelation(err: { code?: string | null } | null): boolean {
  return !!err && err.code === PG_RELATION_DOES_NOT_EXIST;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── concept_mastery ───────────────────────────────────────────────────────────

type ConceptMasteryRow = {
  id: string;
  student_id: string;
  topic_id: string;
  mastery_probability: number | null;
  mastery_level: string | null;
  attempts: number | null;
  correct_attempts: number | null;
  hints_used: number | null;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  mastered_at: string | null;
  next_review_at: string | null;
  review_interval_days: number | null;
  ease_factor: number | null;
  consecutive_correct: number | null;
  p_know: number | null;
  p_learn: number | null;
  p_guess: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const CONCEPT_MASTERY_COLUMNS =
  'id, student_id, topic_id, mastery_probability, mastery_level, attempts, ' +
  'correct_attempts, hints_used, first_attempted_at, last_attempted_at, ' +
  'mastered_at, next_review_at, review_interval_days, ease_factor, ' +
  'consecutive_correct, p_know, p_learn, p_guess, created_at, updated_at';

function mapConceptMastery(row: ConceptMasteryRow): ConceptMastery {
  return {
    id: row.id,
    studentId: row.student_id,
    topicId: row.topic_id,
    masteryProbability: row.mastery_probability ?? 0,
    masteryLevel: row.mastery_level,
    attempts: row.attempts ?? 0,
    correctAttempts: row.correct_attempts ?? 0,
    hintsUsed: row.hints_used ?? 0,
    firstAttemptedAt: row.first_attempted_at,
    lastAttemptedAt: row.last_attempted_at,
    masteredAt: row.mastered_at,
    nextReviewAt: row.next_review_at,
    reviewIntervalDays: row.review_interval_days,
    easeFactor: row.ease_factor ?? 2.5,
    consecutiveCorrect: row.consecutive_correct ?? 0,
    pKnow: row.p_know,
    pLearn: row.p_learn,
    pGuess: row.p_guess,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Read concept_mastery rows for a student. Optionally narrow to a single
 * topic. Returns an empty array when the student has no mastery data yet
 * (not an error).
 */
export async function getConceptMastery(opts: {
  studentId: string;
  conceptId?: string;
}): Promise<ServiceResult<ConceptMastery[]>> {
  if (!opts?.studentId) {
    return fail('studentId is required', 'INVALID_INPUT');
  }

  let query = supabaseAdmin
    .from('concept_mastery')
    .select(CONCEPT_MASTERY_COLUMNS)
    .eq('student_id', opts.studentId);

  if (opts.conceptId) {
    query = query.eq('topic_id', opts.conceptId);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_concept_mastery_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_concept_mastery_failed', {
        error: new Error(error.message),
        studentId: opts.studentId,
      });
    }
    return fail(`concept_mastery lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapConceptMastery(r as unknown as ConceptMasteryRow)));
}

// ── topic_mastery ─────────────────────────────────────────────────────────────

type TopicMasteryRow = {
  id: string;
  student_id: string;
  subject: string;
  topic: string;
  mastery_level: number | null;
  total_attempts: number | null;
  correct_attempts: number | null;
  last_attempted: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const TOPIC_MASTERY_COLUMNS =
  'id, student_id, subject, topic, mastery_level, total_attempts, ' +
  'correct_attempts, last_attempted, created_at, updated_at';

function mapTopicMastery(row: TopicMasteryRow): TopicMastery {
  return {
    id: row.id,
    studentId: row.student_id,
    subject: row.subject,
    topic: row.topic,
    masteryLevel: row.mastery_level ?? 0,
    totalAttempts: row.total_attempts ?? 0,
    correctAttempts: row.correct_attempts ?? 0,
    lastAttempted: row.last_attempted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Read topic_mastery rows for a student. Optionally narrow to a subject.
 */
export async function getTopicMastery(opts: {
  studentId: string;
  subject?: string;
}): Promise<ServiceResult<TopicMastery[]>> {
  if (!opts?.studentId) {
    return fail('studentId is required', 'INVALID_INPUT');
  }

  let query = supabaseAdmin
    .from('topic_mastery')
    .select(TOPIC_MASTERY_COLUMNS)
    .eq('student_id', opts.studentId);

  if (opts.subject) {
    query = query.eq('subject', opts.subject);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_topic_mastery_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_topic_mastery_failed', {
        error: new Error(error.message),
        studentId: opts.studentId,
      });
    }
    return fail(`topic_mastery lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapTopicMastery(r as unknown as TopicMasteryRow)));
}

// ── knowledge_gaps ────────────────────────────────────────────────────────────

type KnowledgeGapRow = {
  id: string;
  student_id: string;
  topic_id: string;
  prerequisite_topic_id: string | null;
  gap_type: string | null;
  severity: string | null;
  description: string | null;
  description_hi: string | null;
  recommended_action: string | null;
  recommended_action_hi: string | null;
  is_resolved: boolean | null;
  detected_at: string | null;
  resolved_at: string | null;
};

const KNOWLEDGE_GAPS_COLUMNS =
  'id, student_id, topic_id, prerequisite_topic_id, gap_type, severity, ' +
  'description, description_hi, recommended_action, recommended_action_hi, ' +
  'is_resolved, detected_at, resolved_at';

function mapKnowledgeGap(row: KnowledgeGapRow): KnowledgeGap {
  return {
    id: row.id,
    studentId: row.student_id,
    topicId: row.topic_id,
    prerequisiteTopicId: row.prerequisite_topic_id,
    gapType: row.gap_type,
    severity: row.severity,
    description: row.description,
    descriptionHi: row.description_hi,
    recommendedAction: row.recommended_action,
    recommendedActionHi: row.recommended_action_hi,
    isResolved: row.is_resolved ?? false,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * List knowledge gaps for a student. Defaults to unresolved gaps (the
 * common case for the recommendation surface). Pass includeResolved: true
 * to read the historical record.
 */
export async function listKnowledgeGaps(opts: {
  studentId: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  includeResolved?: boolean;
}): Promise<ServiceResult<KnowledgeGap[]>> {
  if (!opts?.studentId) {
    return fail('studentId is required', 'INVALID_INPUT');
  }

  let query = supabaseAdmin
    .from('knowledge_gaps')
    .select(KNOWLEDGE_GAPS_COLUMNS)
    .eq('student_id', opts.studentId);

  if (!opts.includeResolved) {
    query = query.eq('is_resolved', false);
  }

  if (opts.severity) {
    query = query.eq('severity', opts.severity);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_knowledge_gaps_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_knowledge_gaps_failed', {
        error: new Error(error.message),
        studentId: opts.studentId,
      });
    }
    return fail(`knowledge_gaps lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapKnowledgeGap(r as unknown as KnowledgeGapRow)));
}

// ── diagnostic_sessions ───────────────────────────────────────────────────────

type DiagnosticSessionRow = {
  id: string;
  student_id: string;
  grade: string | number | null;
  subject: string | null;
  status: string | null;
  total_questions: number | null;
  correct_answers: number | null;
  estimated_theta: number | null;
  topics_assessed: unknown;
  weak_topics: unknown;
  strong_topics: unknown;
  recommended_difficulty: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const DIAGNOSTIC_SESSION_COLUMNS =
  'id, student_id, grade, subject, status, total_questions, correct_answers, ' +
  'estimated_theta, topics_assessed, weak_topics, strong_topics, ' +
  'recommended_difficulty, started_at, completed_at, created_at, updated_at';

function asJsonbArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function mapDiagnosticSession(row: DiagnosticSessionRow): DiagnosticSession {
  return {
    id: row.id,
    studentId: row.student_id,
    // P5: grades are strings everywhere.
    grade: row.grade == null ? null : String(row.grade),
    subject: row.subject,
    status: row.status,
    totalQuestions: row.total_questions ?? 0,
    correctAnswers: row.correct_answers ?? 0,
    estimatedTheta: row.estimated_theta,
    topicsAssessed: asJsonbArray(row.topics_assessed),
    weakTopics: asJsonbArray(row.weak_topics),
    strongTopics: asJsonbArray(row.strong_topics),
    recommendedDifficulty: row.recommended_difficulty,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Look up a single diagnostic session by id. Returns null (not an error)
 * when the id does not resolve.
 */
export async function getDiagnosticSession(
  sessionId: string
): Promise<ServiceResult<DiagnosticSession | null>> {
  if (!sessionId) {
    return fail('sessionId is required', 'INVALID_INPUT');
  }

  const { data, error } = await supabaseAdmin
    .from('diagnostic_sessions')
    .select(DIAGNOSTIC_SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_diagnostic_sessions_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_diagnostic_session_failed', {
        error: new Error(error.message),
        sessionId,
      });
    }
    return fail(`diagnostic_session lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapDiagnosticSession(data as unknown as DiagnosticSessionRow) : null);
}

/**
 * List recent diagnostic sessions for a student, newest first. Default
 * limit 10, clamp 1..50.
 */
export async function listDiagnosticSessions(opts: {
  studentId: string;
  limit?: number;
}): Promise<ServiceResult<DiagnosticSession[]>> {
  if (!opts?.studentId) {
    return fail('studentId is required', 'INVALID_INPUT');
  }
  const limit = clamp(opts.limit ?? 10, 1, 50);

  const { data, error } = await supabaseAdmin
    .from('diagnostic_sessions')
    .select(DIAGNOSTIC_SESSION_COLUMNS)
    .eq('student_id', opts.studentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_diagnostic_sessions_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_diagnostic_sessions_failed', {
        error: new Error(error.message),
        studentId: opts.studentId,
      });
    }
    return fail(`diagnostic_sessions lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(
    (data ?? []).map((r) => mapDiagnosticSession(r as unknown as DiagnosticSessionRow))
  );
}

// ── learning_graph_nodes ──────────────────────────────────────────────────────
//
// Table not provisioned in any migration on this branch. Helper is declared
// to lock the service contract; soft-fails with DB_ERROR (single warn log)
// until the table is shipped. Same precedent as analytics.student_analytics.

type LearningGraphNodeRow = {
  id: string;
  subject: string | null;
  grade: string | number | null;
  topic: string | null;
  prerequisites: unknown;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
};

const LEARNING_GRAPH_NODE_COLUMNS =
  'id, subject, grade, topic, prerequisites, metadata, created_at, updated_at';

function mapLearningGraphNode(row: LearningGraphNodeRow): LearningGraphNode {
  return {
    id: row.id,
    subject: row.subject,
    grade: row.grade == null ? null : String(row.grade), // P5
    topic: row.topic,
    prerequisites: asJsonbArray(row.prerequisites),
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List learning graph nodes filtered by subject + grade. The backing table
 * is planned but not yet provisioned in this branch — calls will return
 * DB_ERROR until the migration lands. Callers should degrade gracefully.
 */
export async function listLearningGraphNodes(opts: {
  subject: string;
  grade: string;
}): Promise<ServiceResult<LearningGraphNode[]>> {
  if (!opts?.subject) return fail('subject is required', 'INVALID_INPUT');
  if (!opts?.grade) return fail('grade is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('learning_graph_nodes')
    .select(LEARNING_GRAPH_NODE_COLUMNS)
    .eq('subject', opts.subject)
    .eq('grade', opts.grade);

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_learning_graph_nodes_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_learning_graph_nodes_failed', {
        error: new Error(error.message),
        subject: opts.subject,
        grade: opts.grade,
      });
    }
    return fail(
      `learning_graph_nodes lookup failed: ${error.message}`,
      'DB_ERROR'
    );
  }

  return ok(
    (data ?? []).map((r) => mapLearningGraphNode(r as unknown as LearningGraphNodeRow))
  );
}

// ── cme_error_log ─────────────────────────────────────────────────────────────

type CmeErrorRow = {
  id: string;
  student_id: string;
  concept_id: string;
  question_id: string | null;
  error_type: string | null;
  student_answer: string | null;
  correct_answer: string | null;
  response_time_ms: number | null;
  created_at: string | null;
};

const CME_ERROR_COLUMNS =
  'id, student_id, concept_id, question_id, error_type, student_answer, ' +
  'correct_answer, response_time_ms, created_at';

function mapCmeError(row: CmeErrorRow): CmeError {
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    questionId: row.question_id,
    errorType: row.error_type,
    studentAnswer: row.student_answer,
    correctAnswer: row.correct_answer,
    responseTimeMs: row.response_time_ms,
    createdAt: row.created_at,
  };
}

/**
 * List CME error log entries. Optionally narrow to a student. Newest first,
 * default limit 50, clamp 1..200.
 *
 * Used by super-admin / observability surfaces to inspect recent error
 * patterns; not exposed to student or parent roles.
 */
export async function listCmeErrors(opts: {
  studentId?: string;
  limit?: number;
}): Promise<ServiceResult<CmeError[]>> {
  const limit = clamp(opts?.limit ?? 50, 1, 200);

  let query = supabaseAdmin
    .from('cme_error_log')
    .select(CME_ERROR_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts?.studentId) {
    query = query.eq('student_id', opts.studentId);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('assessment_cme_error_log_table_missing', {
        error: error.message,
      });
    } else {
      logger.error('assessment_cme_error_log_failed', {
        error: new Error(error.message),
        studentId: opts?.studentId,
      });
    }
    return fail(`cme_error_log lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapCmeError(r as unknown as CmeErrorRow)));
}
