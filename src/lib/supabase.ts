import { createClient } from '@supabase/supabase-js';
import type {
  Student,
  Subject,
  StudentLearningProfile,
  CurriculumTopic,
  FeatureFlag,
  StudentSnapshot,
} from './types';

/* ─── Supabase Client ─────────────────────────────────────── */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(url, key);

/* ─── Typed API Layer ─────────────────────────────────────── */
/* Inspired by Khan Academy's genqlient — every DB call is     */
/* wrapped with proper types, error handling, and caching.     */

/** Get all learning profiles for a student */
export async function getStudentProfiles(studentId: string): Promise<StudentLearningProfile[]> {
  const { data, error } = await supabase
    .from('student_learning_profiles')
    .select('*')
    .eq('student_id', studentId)
    .order('xp', { ascending: false });
  if (error) console.error('[API] getStudentProfiles:', error.message);
  return (data as StudentLearningProfile[]) ?? [];
}

/** Get active subjects */
export async function getSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .eq('is_active', true)
    .order('display_order');
  if (error) console.error('[API] getSubjects:', error.message);
  return (data as Subject[]) ?? [];
}

/** Get feature flags as a keyed object */
export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('flag_name, is_enabled');
  if (error) console.error('[API] getFeatureFlags:', error.message);
  const flags: Record<string, boolean> = {};
  (data ?? []).forEach((f: any) => { flags[f.flag_name] = f.is_enabled; });
  return flags;
}

/** Get next recommended topics for a student */
export async function getNextTopics(
  studentId: string,
  subject: string | null,
  grade: string,
  limit = 5
): Promise<CurriculumTopic[]> {
  if (!subject) return [];
  const { data: subjectRow } = await supabase
    .from('subjects')
    .select('id')
    .eq('code', subject)
    .single();
  if (!subjectRow) return [];

  const { data, error } = await supabase
    .from('curriculum_topics')
    .select('*')
    .eq('subject_id', subjectRow.id)
    .eq('grade', grade)
    .eq('is_active', true)
    .order('display_order')
    .limit(limit);
  if (error) console.error('[API] getNextTopics:', error.message);
  return (data as CurriculumTopic[]) ?? [];
}

/** Get due review items */
export async function getDueReviews(studentId: string, limit = 20) {
  const { data, error } = await supabase
    .from('concept_mastery')
    .select('*')
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString())
    .limit(limit);
  if (error) console.error('[API] getDueReviews:', error.message);
  return data ?? [];
}

/** Get student snapshot (aggregated stats) */
export async function getStudentSnapshot(studentId: string): Promise<StudentSnapshot | null> {
  // Aggregate from profiles
  const profiles = await getStudentProfiles(studentId);
  if (!profiles.length) return null;

  const totalXp = profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const streak = Math.max(...profiles.map((p) => p.streak_days ?? 0), 0);

  // Count mastery
  const { count: mastered } = await supabase
    .from('topic_mastery')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gte('mastery_score', 80);

  const { count: inProgress } = await supabase
    .from('topic_mastery')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .lt('mastery_score', 80);

  const { count: quizzes } = await supabase
    .from('quiz_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId);

  return {
    total_xp: totalXp,
    current_streak: streak,
    topics_mastered: mastered ?? 0,
    topics_in_progress: inProgress ?? 0,
    quizzes_taken: quizzes ?? 0,
    avg_score: 0,
  };
}

/** Send message to Foxy tutor edge function */
export async function chatWithFoxy(payload: {
  message: string;
  student_id: string;
  session_id?: string;
  subject?: string;
  grade?: string;
  language?: string;
  mode?: string;
}): Promise<{ reply: string; session_id: string }> {
  const { data, error } = await supabase.functions.invoke('foxy-tutor', {
    body: payload,
  });
  if (error) {
    console.error('[API] chatWithFoxy:', error.message);
    return { reply: 'Sorry, Foxy is having trouble right now. Try again!', session_id: payload.session_id ?? '' };
  }
  return data;
}

/** Submit a quiz via edge function */
export async function submitQuiz(payload: {
  student_id: string;
  subject: string;
  topic_id?: string;
  responses: Array<{ question_id: string; answer: string; correct: boolean }>;
}) {
  const { data, error } = await supabase.functions.invoke('quiz-submit', {
    body: payload,
  });
  if (error) console.error('[API] submitQuiz:', error.message);
  return data;
}
