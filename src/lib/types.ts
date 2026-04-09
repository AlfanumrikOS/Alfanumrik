/* ─── Alfanumrik Type Definitions ─────────────────────────── */
/* Equivalent to Khan Academy's genqlient type-safe schema     */

export interface Student {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  grade: string;
  board: string | null;
  preferred_language: string;
  preferred_subject: string | null;
  onboarding_completed: boolean | null;
  is_active: boolean | null;
  school_name: string | null;
  city: string | null;
  state: string | null;
  xp_total: number | null;
  streak_days: number | null;
  last_active: string | null;
  subscription_plan: string | null;
  subscription_expiry: string | null;
  learning_style: string | null;
  academic_goal: string | null;
  interests: string[] | null;
  weak_subjects: string[] | null;
  strong_subjects: string[] | null;
  selected_subjects: string[] | null;
  daily_study_hours: number | null;
  account_status: string;
  parent_name: string | null;
  parent_phone: string | null;
  target_exam: string | null;
  name_change_count: number | null;
  last_grade_change: string | null;
  last_device_hash: string | null;
  device_change_count: number | null;
  is_demo: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  icon: string;
  color: string;
  is_active: boolean;
  display_order: number;
}

export interface StudentLearningProfile {
  id: string;
  student_id: string;
  subject: string;
  current_level: string | null;
  xp: number;
  level: number;
  streak_days: number;
  longest_streak: number;
  total_sessions: number;
  total_questions_asked: number;
  total_questions_answered_correctly: number;
  total_time_minutes: number;
  last_session_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CurriculumTopic {
  id: string;
  subject_id: string;
  title: string;
  title_hi: string | null;
  description: string | null;
  grade: string;
  board: string | null;
  chapter_number: number | null;
  difficulty_level: number;
  estimated_minutes: number | null;
  tags: string[] | null;
  is_active: boolean;
  display_order: number;
  learning_objectives: string[] | null;
  bloom_focus: string | null;
  ncert_page_range: string | null;
  topic_type: string | null;
}

export interface CmeAction {
  type: 'remediate' | 'revise' | 're_teach' | 'teach' | 'practice' | 'challenge' | 'exam_prep';
  concept_id: string | null;
  title: string;
  reason: string;
  difficulty: number;
}

export interface FeatureFlag {
  id: string;
  flag_name: string;
  is_enabled: boolean;
  rollout_percentage: number;
  target_grades: string[] | null;
  description: string | null;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  xp_reward: number;
  condition_type: string;
  condition_value: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface StudentSnapshot {
  total_xp: number;
  current_streak: number;
  topics_mastered: number;
  topics_in_progress: number;
  quizzes_taken: number;
  avg_score: number;
}

export interface QuizSession {
  id: string;
  student_id: string;
  subject: string;
  topic_id: string | null;
  total_questions: number;
  correct_answers: number;
  score_percent: number;
  xp_earned: number;
  completed_at: string | null;
}

/* ── Quiz ── */
export interface QuizResponse {
  question_id: string;
  selected_option: string | number;
  is_correct: boolean;
  time_spent?: number;
}

/**
 * DB row shape for the `questions` table.
 * hint and hint_hi were added in migration 20260409000001_add_hint_to_questions.sql.
 * hint_hi carries the Hindi translation of the hint (P7 bilingual requirement).
 */
export interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint?: string | null;
  hint_hi?: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
  subject: string | null;
  grade: string | null;
  topic_id: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/* ── Mastery ── */
export interface TopicMastery {
  id: string;
  student_id: string;
  topic_id: string;
  topic_tag: string;
  chapter_number: number;
  mastery_level: number;
  last_attempted: string;
  updated_at: string;
}

/* ── Leaderboard ── */
export interface LeaderboardEntry {
  rank: number;
  student_id: string;
  student_name: string;
  name?: string;
  total_xp: number;
  xp?: number;
  streak: number;
  accuracy?: number;
  avatar_url?: string;
  top_title?: string;
  grade?: string;
  school?: string;
  city?: string;
  board?: string;
  quizzes_taken?: number;
  topics_mastered?: number;
  titles?: { title_name: string; icon: string }[];
}

export interface Competition {
  id: string;
  title: string;
  title_hi?: string;
  description?: string;
  description_hi?: string;
  competition_type: string;
  status: 'live' | 'upcoming' | 'completed';
  start_date: string;
  end_date: string;
  participant_count: number;
  is_featured?: boolean;
  is_joined?: boolean;
  accent_color?: string;
  banner_emoji?: string;
  bonus_xp_1?: number;
  bonus_xp_2?: number;
  bonus_xp_3?: number;
  my_rank?: number;
}

export interface FameEntry {
  id: string;
  student_id: string;
  student_name: string;
  title: string;
  icon: string;
  earned_at: string;
}

export interface StudentTitle {
  id: string;
  student_id: string;
  title_name: string;
  icon: string;
  earned_at: string;
  is_active: boolean;
}

/* ── Dashboard ── */
export interface DailyActivity {
  label: string;
  quizzes: number;
  xp: number;
  active: boolean;
}

/* ── Teacher ── */
export interface HeatmapCell {
  p_know: number;
  level: string;
  attempts: number;
}

export interface HeatmapRow {
  student_name: string;
  avg_mastery: number;
  cells: HeatmapCell[];
}

export interface HeatmapData {
  student_count: number;
  concept_count: number;
  concepts: { id: string; title: string; chapter: number }[];
  matrix: HeatmapRow[];
}

export interface RiskAlert {
  id: string;
  student_id: string;
  student_name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommended_action?: string;
}

/* ── Parent ── */
export interface ParentGuardian {
  id: string;
  name: string;
  auth_user_id?: string;
}

export interface StudentChild {
  id: string;
  name: string;
  grade: string;
}

export interface ActivityBurst {
  id: string;
  subject: string;
  duration_minutes: number;
  questions_completed: number;
  xp_earned: number;
  timestamp: string;
}

/* ── Reports ── */
export interface SubjectReport {
  name: string;
  mastery_percent: number;
  chapters_covered: number;
  quiz_attempts: number;
  avg_score: number;
}

export interface ConceptNode {
  id: string;
  title: string;
  mastery_level: number;
  attempts: number;
  last_attempted: string;
}

export interface QuizRecord {
  id: string;
  subject: string;
  score_percent: number;
  total_questions: number;
  correct_answers: number;
  completed_at: string;
  time_spent_seconds: number;
}

/* ── HPC ── */
export interface SubjectPerformance {
  concepts_attempted: number;
  concepts_total: number;
  avg_mastery_pct: number;
  chapters_covered: number;
  chapters_total: number;
}

/* ── Alfanumrik 2.0: Cognitive Engine Types ── */

export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export type QuizMode = 'cognitive' | 'board' | 'practice';

export interface BloomProgression {
  id: string;
  student_id: string;
  topic_id: string;
  bloom_level: BloomLevel;
  attempts: number;
  correct: number;
  mastery: number;
  last_attempted: string | null;
}

export interface CognitiveSessionMetrics {
  id: string;
  student_id: string;
  quiz_session_id: string | null;
  questions_in_zpd: number | null;
  questions_too_easy: number | null;
  questions_too_hard: number | null;
  zpd_accuracy_rate: number | null;
  response_time_trend: string | null;
  accuracy_trend: string | null;
  fatigue_detected: boolean;
  difficulty_adjustments: number | null;
  interleaved_questions: number | null;
  blocked_questions: number | null;
  avg_response_time_seconds: number | null;
  flow_state_probability: number | null;
  session_start: string | null;
  session_end: string | null;
  created_at: string;
}

export interface LearningVelocity {
  id: string;
  student_id: string;
  concept_id: string | null;
  subject: string;
  weekly_mastery_rate: number | null;
  acceleration: number | null;
  predicted_mastery_date: string | null;
  velocity_history: Record<string, unknown> | null;
  last_calculated_at: string | null;
}

export interface KnowledgeGap {
  id: string;
  student_id: string;
  target_concept_name: string;
  missing_prerequisite_name: string;
  detection_method: string;
  confidence_score: number | null;
  status: string;
  detected_at: string | null;
  // Computed fields for UI compatibility
  topic_title?: string;
  severity?: string;
  description?: string;
  description_hi?: string;
}

export interface CBSEBoardPaper {
  id: string;
  year: number;
  subject: string;
  set_code: string | null;
  paper_section: string | null;
  total_marks: number;
  board: string;
  grade: string;
  is_active: boolean;
}

export interface QuestionResponse {
  id: string;
  student_id: string;
  question_id: string;
  session_id: string | null;
  selected_option: number;
  is_correct: boolean;
  time_spent: number;
  bloom_level: string | null;
  difficulty: number | null;
  source: string;
  board_year: number | null;
  reflection_shown: boolean;
  reflection_type: string | null;
}

export interface BoardExamScore {
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string;
  message: string;
  messageHi: string;
}

/* ── Alfanumrik 3.0: RBAC Types ── */

export type RoleName = 'student' | 'parent' | 'teacher' | 'tutor' | 'admin' | 'super_admin';

export type OwnershipType = 'own' | 'linked' | 'assigned' | 'any';

export interface Role {
  id: string;
  name: RoleName;
  display_name: string;
  display_name_hi: string | null;
  description: string | null;
  hierarchy_level: number;
  is_system_role: boolean;
  is_active: boolean;
}

export interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
  description: string | null;
  is_active: boolean;
}

export interface UserRole {
  id: string;
  auth_user_id: string;
  role_id: string;
  is_active: boolean;
  assigned_at: string;
  expires_at: string | null;
}

export interface AuditLog {
  id: string;
  auth_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  status: 'success' | 'failure' | 'denied';
  created_at: string;
}

export interface AdminUser {
  id: string;
  auth_user_id: string;
  name: string;
  email: string | null;
  admin_level: 'super_admin' | 'admin' | 'moderator';
  is_active: boolean;
}

export interface ResourceAccessRule {
  id: string;
  role_id: string;
  resource_type: string;
  ownership_check: OwnershipType;
  field_restrictions: string[];
  max_records_per_request: number;
}

/* ── Challenge Mode ── */

export type ChallengeStatus = 'pending' | 'active' | 'completed' | 'expired';

export interface QuizChallenge {
  id: string;
  challenger_id: string;
  opponent_id: string | null;
  subject: string;
  grade: string;
  question_count: number;
  difficulty: number | null;
  status: ChallengeStatus;
  challenger_score: number | null;
  challenger_time: number | null;
  opponent_score: number | null;
  opponent_time: number | null;
  winner_id: string | null;
  share_code: string | null;
  question_ids: string[];
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  // Joined fields (from RPC or view)
  challenger_name?: string;
  opponent_name?: string;
}
