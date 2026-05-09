// ─── Types ────────────────────────────────────────────────────

export type Tab =
  | 'command'
  | 'users'
  | 'content'
  | 'schools'
  | 'revenue'
  | 'ai'
  | 'flags'
  | 'support'
  | 'logs'
  | 'reports';

export interface CommandData {
  totals: Record<string, number>;
  activity: Record<string, number>;
  ai: { calls_last_1h: number; calls_last_24h: number };
  revenue: { today_inr: number; last_7d_inr: number; last_30d_inr: number };
  support: { open_tickets: number };
  sparkline: Array<{ date: string; quizzes: number }>;
}

export interface Student {
  id: string;
  name: string;
  email: string;
  grade: string;
  board: string;
  subscription_plan: string;
  xp_total: number;
  streak_days: number;
  is_active: boolean;
  account_status: string;
  created_at: string;
  [key: string]: unknown;
}

export interface SupportTicket {
  id: string;
  student_id: string;
  subject: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  is_enabled: boolean;
  rollout_percentage: number;
  target_grades: string[] | null;
  target_roles: string[] | null;
  updated_at: string;
}

export interface LogEntry {
  id: string;
  auth_user_id?: string;
  admin_id?: string;
  action: string;
  resource_type?: string;
  entity_type?: string;
  status?: string;
  created_at: string;
  details?: Record<string, unknown>;
}

export interface Topic {
  id: string;
  subject?: { code: string; name: string };
  grade: string;
  chapter_number: number;
  title: string;
  display_order: number;
  is_active: boolean;
  difficulty_level: string;
  estimated_minutes: number;
}

export interface Question {
  id: string;
  subject: string;
  grade: string;
  chapter_number: number;
  question_text: string;
  question_type: string;
  difficulty: string;
  bloom_level: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}
