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
