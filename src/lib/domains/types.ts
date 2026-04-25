/**
 * Shared domain types — service contracts across all Alfanumrik domains.
 *
 * Every domain function returns ServiceResult<T>. Callers must check ok
 * before accessing data. This eliminates silent failures and makes the
 * contract explicit at the call site.
 *
 * When a domain is later extracted as a microservice, these types become
 * the HTTP request/response schema. No rewrite needed — just wrap in a handler.
 */

// ── Result monad ───────────────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code: ServiceErrorCode };

export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'EXTERNAL_FAILURE'   // downstream RPC/edge function failed
  | 'DB_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  error: string,
  code: ServiceErrorCode = 'INTERNAL'
): ServiceResult<T> {
  return { ok: false, error, code };
}

// ── Quiz domain ────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  hint_hi?: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
  subject?: string;
  grade?: string;
}

export interface QuizSessionResult {
  session_id: string;
  total: number;
  correct: number;
  score_percent: number;
  xp_earned: number;
}

export interface QuizSubmissionInput {
  studentId: string;
  subject: string;
  grade: string;
  topic: string;
  chapter: number;
  responses: QuizResponse[];
  timeTakenSeconds: number;
}

export interface QuizResponse {
  question_id: string;
  selected_index: number;
  is_correct: boolean;
  time_taken_seconds?: number;
}

// ── Learning Profile domain ────────────────────────────────────────────────────

export interface LearningProfile {
  student_id: string;
  subject: string;
  xp: number;
  level: number;
  streak_days: number;
  total_sessions: number;
  total_questions_asked: number;
  total_questions_answered_correctly: number;
  irt_theta: number | null;
  mastery_probability: number | null;
  last_session_at: string | null;
}

export interface XPUpdateInput {
  studentId: string;
  subject: string;
  xpDelta: number;
  totalQuestions: number;
  correctAnswers: number;
  timeTakenSeconds: number;
}

// ── Content domain ─────────────────────────────────────────────────────────────

export interface QuizQuestionFetchInput {
  subject: string;
  grade: string;
  count: number;
  difficultyMode: 'easy' | 'medium' | 'hard' | 'mixed' | 'progressive';
  chapterNumber: number | null;
  questionTypes: string[];
  studentId: string;
  irtTheta: number | null;
}

export interface QuizQuestionSource {
  source: 'edge_fn' | 'rpc_rag' | 'rpc_v2' | 'direct_query';
  questions: QuizQuestion[];
  count: number;
}

// ── Identity domain ────────────────────────────────────────────────────────────

export interface StudentIdentity {
  studentId: string;
  authUserId: string;
  grade: string;
  name: string;
}

/**
 * Student profile exposed by the identity domain. Intentionally a narrow
 * projection — callers that need more columns should add them explicitly
 * to avoid select('*') and over-fetching.
 *
 * Grade is always a string (product invariant P5).
 */
export interface Student {
  id: string;
  authUserId: string | null;
  name: string | null;
  email: string | null;
  grade: string | null;
  schoolId: string | null;
  isActive: boolean | null;
}

export interface Teacher {
  id: string;
  authUserId: string | null;
  name: string | null;
  email: string | null;
  schoolId: string | null;
  schoolName: string | null;
}

export interface Guardian {
  id: string;
  authUserId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

// ── Assessment domain (Phase 0f, B9) ──────────────────────────────────────────
//
// Read-only projections over concept_mastery, topic_mastery, knowledge_gaps,
// diagnostic_sessions, learning_graph_nodes, cme_error_log. Writes stay in
// cme-engine and atomic_quiz_profile_update — those are P1/P4 sacred.

export interface ConceptMastery {
  id: string;
  studentId: string;
  topicId: string;
  masteryProbability: number;
  masteryLevel: string | null;
  attempts: number;
  correctAttempts: number;
  hintsUsed: number;
  firstAttemptedAt: string | null;
  lastAttemptedAt: string | null;
  masteredAt: string | null;
  nextReviewAt: string | null;
  reviewIntervalDays: number | null;
  easeFactor: number;
  consecutiveCorrect: number;
  pKnow: number | null;
  pLearn: number | null;
  pGuess: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TopicMastery {
  id: string;
  studentId: string;
  subject: string;
  topic: string;
  masteryLevel: number;
  totalAttempts: number;
  correctAttempts: number;
  lastAttempted: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface KnowledgeGap {
  id: string;
  studentId: string;
  topicId: string;
  prerequisiteTopicId: string | null;
  gapType: string | null;
  severity: string | null;
  description: string | null;
  descriptionHi: string | null;
  recommendedAction: string | null;
  recommendedActionHi: string | null;
  isResolved: boolean;
  detectedAt: string | null;
  resolvedAt: string | null;
}

export interface DiagnosticSession {
  id: string;
  studentId: string;
  /** P5: grade is always a string, never an integer. */
  grade: string | null;
  subject: string | null;
  status: string | null;
  totalQuestions: number;
  correctAnswers: number;
  estimatedTheta: number | null;
  topicsAssessed: unknown[];
  weakTopics: unknown[];
  strongTopics: unknown[];
  recommendedDifficulty: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LearningGraphNode {
  id: string;
  subject: string | null;
  /** P5: grade is always a string. */
  grade: string | null;
  topic: string | null;
  prerequisites: unknown[];
  metadata: unknown;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CmeError {
  id: string;
  studentId: string;
  conceptId: string;
  questionId: string | null;
  errorType: string | null;
  studentAnswer: string | null;
  correctAnswer: string | null;
  responseTimeMs: number | null;
  createdAt: string | null;
}

// ── Content domain (Phase 0d, B6) ─────────────────────────────────────────────
//
// Read-only projections of question_bank, cbse_syllabus, ncert_content
// (planned), and chapter_concepts. Grade is always a string (P5).
// Question rows include all fields needed for P6 validation by callers.

export interface Question {
  id: string;
  subject: string | null;
  grade: string | null;
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  topic: string | null;
  questionText: string;
  questionHi: string | null;
  questionType: string | null;
  options: string[];
  correctAnswerIndex: number;
  explanation: string | null;
  explanationHi: string | null;
  hint: string | null;
  hintHi: string | null;
  difficulty: number;
  bloomLevel: string | null;
  isActive: boolean | null;
  source: string | null;
  isNcert: boolean | null;
  verifiedAgainstNcert: boolean | null;
  verificationState: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Chapter {
  id: string;
  board: string | null;
  grade: string | null;
  subjectCode: string | null;
  subjectDisplay: string | null;
  subjectDisplayHi: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  chapterTitleHi: string | null;
  chunkCount: number;
  verifiedQuestionCount: number;
  ragStatus: string | null;
  lastVerifiedAt: string | null;
  isInScope: boolean | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NcertContent {
  id: string;
  grade: string | null;
  subject: string | null;
  chapter: string | null;
  chapterNumber: number | null;
  section: string | null;
  contentType: string | null;
  contentText: string | null;
  contentHi: string | null;
  pageNumber: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ChapterConcept {
  id: string;
  chapterId: string | null;
  grade: string | null;
  subject: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  conceptNumber: number;
  title: string | null;
  titleHi: string | null;
  slug: string | null;
  learningObjective: string | null;
  learningObjectiveHi: string | null;
  explanation: string | null;
  explanationHi: string | null;
  keyFormula: string | null;
  exampleTitle: string | null;
  exampleContent: string | null;
  exampleContentHi: string | null;
  commonMistakes: string[];
  examTips: string[];
  diagramRefs: string[];
  diagramDescription: string | null;
  practiceQuestion: string | null;
  practiceOptions: string[];
  practiceCorrectIndex: number | null;
  practiceExplanation: string | null;
  difficulty: number;
  bloomLevel: string | null;
  estimatedMinutes: number;
  isActive: boolean | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Practice domain (Phase 0e, B8) ────────────────────────────────────────────

export interface ReviewCard {
  id: string;
  studentId: string;
  cardType: string | null;
  subject: string | null;
  grade: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  topic: string | null;
  frontText: string;
  backText: string;
  hint: string | null;
  source: string | null;
  sourceId: string | null;
  easeFactor: number;
  intervalDays: number;
  repetitionCount: number;
  nextReviewDate: string | null;
  lastReviewDate: string | null;
  lastQuality: number | null;
  totalReviews: number;
  correctReviews: number;
  streak: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReviewDue {
  total: number;
  bySubject: Record<string, number>;
}

export interface ConceptMasterySlice {
  topicId: string;
  masteryProbability: number | null;
  consecutiveCorrect: number | null;
  nextReviewAt: string | null;
  updatedAt: string | null;
}

// ── Notifications domain (Phase 0h, B11) ──────────────────────────────────────

export type NotificationRecipientType =
  | 'student'
  | 'guardian'
  | 'teacher'
  | 'school'
  | 'super_admin';

export interface Notification {
  id: string;
  recipientType: NotificationRecipientType;
  recipientId: string;
  notificationType: string | null;
  title: string;
  body: string | null;
  bodyHi: string | null;
  icon: string | null;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  email?: boolean;
  whatsapp?: boolean;
  push?: boolean;
  daily_report?: boolean;
  weekly_report?: boolean;
  dailyReportEnabled?: boolean;
  weeklyReportEnabled?: boolean;
  alertScoreThreshold?: number | null;
  preferredLanguage?: string | null;
}
