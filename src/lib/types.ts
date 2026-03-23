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
  severity: 'high' | 'medium' | 'low';
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

/* ── Alfanumrik 2.0 Types ── */

export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export type QuestionSource = 'curated' | 'cbse_board' | 'generated';

export type CBSEQuestionType = 'mcq' | 'assertion_reasoning' | 'case_based' | 'short_answer' | 'long_answer';

export interface BoardPaper {
  id: string;
  year: number;
  set_code: string | null;
  subject: string;
  paper_section: string | null;
  total_marks: number | null;
}

export interface BloomProgression {
  id: string;
  student_id: string;
  topic_id: string;
  bloom_level: BloomLevel;
  correct_at_level: number;
  total_at_level: number;
  mastered_at: string | null;
}

export interface CognitiveSessionMetrics {
  id: string;
  student_id: string;
  session_id: string;
  questions_answered: number;
  correct_streak: number;
  wrong_streak: number;
  avg_time_per_question: number;
  session_duration_minutes: number;
  recent_accuracy: number;
  difficulty_adjustments: number;
  fatigue_detected: boolean;
}

export interface LearningVelocity {
  id: string;
  student_id: string;
  topic_id: string;
  velocity: number;
  predicted_days_to_target: number | null;
  data_points: { date: string; mastery: number }[];
  calculated_at: string;
}

export interface KnowledgeGap {
  id: string;
  student_id: string;
  topic_id: string;
  missing_prerequisites: string[];
  severity: 'critical' | 'moderate' | 'minor';
  resolved: boolean;
  detected_at: string;
}

export interface QuestionResponse {
  id: string;
  student_id: string;
  question_id: string;
  session_id: string;
  bloom_level: BloomLevel;
  is_correct: boolean;
  time_spent_seconds: number;
  selected_option: string;
  reflection_shown: boolean;
}

export interface EnhancedQuestion {
  id: string;
  question_text: string;
  question_text_hi?: string;
  options: string[];
  correct_option: number;
  explanation?: string;
  explanation_hi?: string;
  subject: string;
  topic_id: string;
  difficulty: number;
  bloom_level: BloomLevel;
  source: QuestionSource;
  board_year?: number;
  marks?: number;
  cbse_question_type?: CBSEQuestionType;
  paper_section?: string;
}
