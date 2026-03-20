// ============================================================
// Alfanumrik — Unified Types (matched to dxipobqngyfpqbbznojz schema)
// ============================================================

export type Language = 'en' | 'hi' | 'hinglish' | 'ta' | 'te' | 'bn';
export type Board = 'CBSE' | 'ICSE' | 'State Board' | 'IB' | 'Cambridge' | 'IGCSE' | 'Other';
export type MasteryLevel = 'not_started' | 'developing' | 'familiar' | 'proficient' | 'mastered';
export type SessionMode = 'learn' | 'practice' | 'doubt' | 'quiz' | 'review';
export type PersonaId = 'friendly_primary' | 'concept_master' | 'exam_coach' | 'jee_neet_coach' | 'olympiad_mentor';

export interface Student {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string | null;
  grade: string;
  board: string;
  preferred_language: Language;
  preferred_subject: string;
  school_name: string | null;
  city: string | null;
  onboarding_completed: boolean;
  created_at: string;
}

export interface LearningProfile {
  id: string;
  student_id: string;
  subject: string;
  xp: number;
  level: number;
  streak_days: number;
  longest_streak: number;
  total_sessions: number;
  total_time_minutes: number;
  last_session_at: string | null;
}

export interface LearningSnapshot {
  total_xp: number;
  total_sessions: number;
  total_questions_asked: number;
  topics_mastered: number;
  topics_in_progress: number;
  current_streak: number;
  active_misconceptions: number;
  pending_reviews: number;
  quizzes_taken: number;
  avg_quiz_score: number;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  icon: string;
  color: string;
  is_active: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'student' | 'foxy' | 'system';
  content: string;
  timestamp: number;
}

export interface TutorPersona {
  persona_id: PersonaId;
  display_name: string;
  description: string;
}

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_text_vernacular?: string;
  question_type: 'mcq' | 'short' | 'long';
  options?: Array<{ id: string; text: string; text_vernacular?: string }>;
  correct_answer: string;
  explanation?: string;
  bloom_level?: string;
  difficulty?: number;
  topic_id?: string;
}

export interface Achievement {
  id: string;
  code: string;
  title: string;
  title_vernacular?: string;
  description: string;
  icon: string;
  xp_reward: number;
  category: string;
}

export interface StudyPlanTask {
  id: string;
  plan_id: string;
  student_id: string;
  day_number: number;
  scheduled_date: string;
  task_order: number;
  task_type: string;
  subject: string;
  title: string;
  description: string;
  estimated_minutes: number;
  is_completed: boolean;
  xp_reward: number;
}

export interface ConceptNode {
  id: string;
  subject: string;
  grade: string;
  chapter: string;
  topic: string;
  title: string;
  titleHi?: string;
  bloomLevel: string;
  prerequisites: string[];
  difficulty: number;
  discrimination: number;
  cbseCompetency?: string;
}

export interface Question {
  id: string;
  conceptId: string;
  type: 'mcq' | 'short' | 'long';
  bloomLevel: string;
  difficulty: number;
  questionText: string;
  questionTextHi?: string;
  options?: Array<{ id: string; text: string; isCorrect: boolean }>;
  correctAnswer: string;
  explanation?: string;
  explanationHi?: string;
  hint?: string;
  misconceptionTag?: string;
}

export interface Simulation {
  id: string;
  subject: string;
  grade: string;
  title: string;
  titleHi: string;
  description: string;
  url: string;
}

export interface Badge {
  id: string;
  title: string;
  titleHi: string;
  description: string;
  icon: string;
  xpReward: number;
}

export interface SubscriptionPlan {
  id: string;
  plan_code: string;
  name: string;
  tagline: string;
  price_monthly: number;
  price_yearly: number;
}

export const GRADES = ['6','7','8','9','10','11','12'];
export const BOARDS: Board[] = ['CBSE','ICSE','State Board','IB','Cambridge','IGCSE','Other'];
export const LANGUAGES: Array<{ code: Language; label: string; labelNative: string }> = [
  { code: 'en',       label: 'English',   labelNative: 'English' },
  { code: 'hi',       label: 'Hindi',     labelNative: 'हिन्दी' },
  { code: 'hinglish', label: 'Hinglish',  labelNative: 'Hinglish' },
  { code: 'ta',       label: 'Tamil',     labelNative: 'தமிழ்' },
  { code: 'te',       label: 'Telugu',    labelNative: 'తెలుగు' },
  { code: 'bn',       label: 'Bengali',   labelNative: 'বাংলা' },
];
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
