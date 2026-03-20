═══════════════════════════════════════════════════════════
 SAVE AS: supabase.ts
 PATH:    src/lib/supabase.ts
 ACTION:  CREATE new file (create folder src/lib/ if needed)
═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* ── RPC helpers ── */

export async function getDashboardData(studentId: string) {
  const { data, error } = await supabase.rpc('get_dashboard_data', { p_student_id: studentId });
  if (error) throw error;
  return data;
}

export async function getQuizQuestions(subject: string, grade: string, count = 10) {
  const { data, error } = await supabase.rpc('get_quiz_questions', {
    p_subject: subject,
    p_grade: grade,
    p_count: count,
  });
  if (error) throw error;
  return data;
}

export async function submitQuizResults(
  studentId: string,
  subject: string,
  grade: string,
  topic: string,
  chapter: number,
  responses: any[],
  time: number,
) {
  const { data, error } = await supabase.rpc('submit_quiz_results', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
    p_topic: topic,
    p_chapter: chapter,
    p_responses: responses,
    p_time: time,
  });
  if (error) throw error;
  return data;
}

export async function getLeaderboard(period = 'weekly', limit = 20) {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit });
  if (error) throw error;
  return data;
}

export async function getStudyPlan(studentId: string) {
  const { data, error } = await supabase.rpc('get_study_plan', { p_student_id: studentId });
  if (error) throw error;
  return data;
}

export async function getReviewCards(studentId: string, limit = 10) {
  const { data, error } = await supabase.rpc('get_review_cards', { p_student_id: studentId, p_limit: limit });
  if (error) throw error;
  return data;
}

/* ── Foxy tutor edge function ── */

export async function sendToFoxy(messages: any[], studentContext: any) {
  const res = await fetch(`${supabaseUrl}/functions/v1/foxy-tutor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ messages, studentContext }),
  });
  if (!res.ok) throw new Error(`Foxy error: ${res.status}`);
  return res.json();
}
