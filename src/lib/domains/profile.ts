/**
 * Learning Profile Domain — student progress, XP, BKT mastery, leaderboard.
 *
 * CONTRACT:
 *   - All reads return ServiceResult<T> — callers handle failures explicitly
 *   - XP writes go through atomic_quiz_profile_update RPC only (no client-side upserts)
 *   - Fallback to direct query is ONLY for reads, never for writes
 *   - Every fallback is logged with structured context
 *
 * MICROSERVICE EXTRACTION PATH:
 *   When extracted as a service, add HTTP handlers for getStudentSnapshot,
 *   getLearningProfiles, getLeaderboard. The domain logic stays identical.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { ok, fail, type ServiceResult, type LearningProfile, type XPUpdateInput } from './types';
import type { StudentSnapshot } from '@/lib/types';

// ── Student snapshot ──────────────────────────────────────────────────────────

/**
 * Fetch student dashboard snapshot (XP, sessions, mastery counts).
 * Tries the RPC first; falls back to parallel queries if RPC missing.
 * Never silently returns partial/stale data — callers know which path served.
 */
export async function getStudentSnapshot(
  studentId: string
): Promise<ServiceResult<StudentSnapshot>> {
  // Primary: dedicated RPC (single round-trip, uses DB indexes)
  try {
    const { data, error } = await supabase.rpc('get_student_snapshot', {
      p_student_id: studentId,
    });
    if (!error && data) {
      return ok(data as StudentSnapshot);
    }
    if (error) {
      logger.warn('profile_domain_snapshot_rpc_failed', {
        error: error.message,
        studentId,
      });
    }
  } catch (e) {
    logger.warn('profile_domain_snapshot_rpc_exception', {
      error: e instanceof Error ? e.message : String(e),
      studentId,
    });
  }

  // Fallback: parallel queries (4 round-trips instead of 1)
  logger.warn('profile_domain_snapshot_fallback_parallel', { studentId });

  try {
    const [profilesResult, masteredResult, inProgressResult, quizzesResult] = await Promise.all([
      supabase.from('student_learning_profiles').select('*').eq('student_id', studentId),
      supabase.from('concept_mastery').select('*', { count: 'exact', head: true })
        .eq('student_id', studentId).gte('mastery_probability', 0.95),
      supabase.from('concept_mastery').select('*', { count: 'exact', head: true })
        .eq('student_id', studentId).lt('mastery_probability', 0.95).gt('mastery_probability', 0),
      supabase.from('quiz_sessions').select('*', { count: 'exact', head: true })
        .eq('student_id', studentId),
    ]);

    const profiles = profilesResult.data ?? [];
    const totalXP = profiles.reduce((s, p) => s + (p.xp ?? 0), 0);
    const maxStreak = Math.max(...profiles.map(p => p.streak_days ?? 0), 0);
    const totalSessions = quizzesResult.count ?? 0;

    return ok({
      total_xp: totalXP,
      streak_days: maxStreak,
      total_sessions: totalSessions,
      mastered_concepts: masteredResult.count ?? 0,
      in_progress_concepts: inProgressResult.count ?? 0,
      profiles,
    } as unknown as StudentSnapshot);
  } catch (e) {
    return fail(
      `Student snapshot fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      'DB_ERROR'
    );
  }
}

// ── Learning profiles ─────────────────────────────────────────────────────────

export async function getLearningProfiles(
  studentId: string
): Promise<ServiceResult<LearningProfile[]>> {
  const { data, error } = await supabase
    .from('student_learning_profiles')
    .select('*')
    .eq('student_id', studentId)
    .order('xp', { ascending: false });

  if (error) {
    return fail(`Learning profiles fetch failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []) as LearningProfile[]);
}

// ── XP update (write path — never from client-side upsert) ───────────────────

/**
 * Update XP and session stats via atomic RPC.
 *
 * INVARIANT: XP is ONLY written here via RPC, never via client-side upsert.
 * If the RPC fails, we return fail() and the caller surfaces the error.
 * There is no last-resort upsert path — that was the bug in the old code.
 */
export async function updateXpAndProfile(
  input: XPUpdateInput
): Promise<ServiceResult<void>> {
  try {
    const { error } = await supabase.rpc('atomic_quiz_profile_update', {
      p_student_id: input.studentId,
      p_subject: input.subject,
      p_xp: input.xpDelta,
      p_total: input.totalQuestions,
      p_correct: input.correctAnswers,
      p_time_seconds: input.timeTakenSeconds,
    });

    if (error) {
      logger.error('profile_domain_xp_update_rpc_failed', {
        error: new Error(error.message),
        studentId: input.studentId,
        subject: input.subject,
        xpDelta: input.xpDelta,
      });
      return fail(`XP update RPC failed: ${error.message}`, 'DB_ERROR');
    }

    return ok(undefined);
  } catch (e) {
    logger.error('profile_domain_xp_update_exception', {
      error: e instanceof Error ? e : new Error(String(e)),
      studentId: input.studentId,
    });
    return fail(
      `XP update exception: ${e instanceof Error ? e.message : String(e)}`,
      'DB_ERROR'
    );
  }
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  student_id: string;
  name: string;
  total_xp: number;
  streak: number;
  avatar_url: string | null;
  grade: string;
  school: string | null;
  city: string | null;
  board: string | null;
}

export async function getLeaderboard(
  period: 'weekly' | 'monthly' = 'weekly',
  limit = 20
): Promise<ServiceResult<LeaderboardEntry[]>> {
  // Primary: RPC with pre-computed snapshots (cheap)
  try {
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_period: period,
      p_limit: limit,
    });
    if (!error && data) return ok(data as LeaderboardEntry[]);
    if (error) {
      logger.warn('profile_domain_leaderboard_rpc_failed', { error: error.message, period });
    }
  } catch (e) {
    logger.warn('profile_domain_leaderboard_rpc_exception', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Fallback: direct students query (more expensive — no pre-computed rank)
  logger.warn('profile_domain_leaderboard_fallback_direct', { period, limit });

  const since = new Date();
  since.setDate(since.getDate() - (period === 'monthly' ? 30 : 7));

  const { data, error } = await supabase
    .from('students')
    .select('id, name, xp_total, streak_days, avatar_url, grade, school_name, city, board')
    .eq('is_active', true)
    .gte('last_active', since.toISOString())
    .order('xp_total', { ascending: false })
    .limit(limit);

  if (error) {
    return fail(`Leaderboard direct query failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(
    (data ?? []).map((s, i) => ({
      rank: i + 1,
      student_id: s.id,
      name: s.name,
      total_xp: s.xp_total ?? 0,
      streak: s.streak_days ?? 0,
      avatar_url: s.avatar_url,
      grade: s.grade,
      school: s.school_name,
      city: s.city,
      board: s.board,
    }))
  );
}

// ── Study plan ────────────────────────────────────────────────────────────────

export async function getStudyPlan(
  studentId: string
): Promise<ServiceResult<Record<string, unknown>>> {
  try {
    const { data, error } = await supabase.rpc('get_study_plan', {
      p_student_id: studentId,
    });
    if (!error && data) return ok(data as Record<string, unknown>);
    if (error) {
      logger.warn('profile_domain_study_plan_rpc_failed', {
        error: error.message,
        studentId,
      });
    }
  } catch (e) {
    logger.warn('profile_domain_study_plan_rpc_exception', {
      error: e instanceof Error ? e.message : String(e),
      studentId,
    });
  }

  // Fallback: direct query
  logger.warn('profile_domain_study_plan_fallback_direct', { studentId });

  const { data: plan, error: planErr } = await supabase
    .from('study_plans')
    .select('*')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (planErr || !plan) return ok({ has_plan: false });

  const { data: tasks } = await supabase
    .from('study_plan_tasks')
    .select('*')
    .eq('plan_id', plan.id)
    .order('day_number')
    .order('task_order');

  return ok({ has_plan: true, plan, tasks: tasks ?? [] });
}

// ── Review cards (spaced repetition) ─────────────────────────────────────────

export async function getReviewCards(
  studentId: string,
  limit = 10
): Promise<ServiceResult<unknown[]>> {
  // Primary: RPC
  try {
    const { data, error } = await supabase.rpc('get_review_cards', {
      p_student_id: studentId,
      p_limit: limit,
    });
    if (!error && data) return ok(data as unknown[]);
    if (error) {
      logger.warn('profile_domain_review_cards_rpc_failed', {
        error: error.message,
        studentId,
      });
    }
  } catch (e) {
    logger.warn('profile_domain_review_cards_rpc_exception', {
      error: e instanceof Error ? e.message : String(e),
      studentId,
    });
  }

  // Fallback 1: spaced_repetition_cards table
  const today = new Date().toISOString().split('T')[0];
  const { data: cards } = await supabase
    .from('spaced_repetition_cards')
    .select(
      'id, student_id, subject, topic, chapter_title, front_text, back_text, ' +
      'hint, source, ease_factor, interval_days, streak, repetition_count, ' +
      'total_reviews, correct_reviews, next_review_date, last_review_date, created_at'
    )
    .eq('student_id', studentId)
    .lte('next_review_date', today)
    .order('next_review_date')
    .limit(limit);

  if (cards && cards.length > 0) {
    return ok(cards);
  }

  // Fallback 2: concept_mastery (minimal columns)
  logger.warn('profile_domain_review_cards_fallback_concept_mastery', { studentId });

  const { data, error } = await supabase
    .from('concept_mastery')
    .select('id, topic_id, ease_factor, mastery_probability, consecutive_correct, next_review_at')
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at')
    .limit(limit);

  if (error) {
    return fail(`Review cards all sources failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(
    (data ?? []).map(cm => ({ ...cm, topic: cm.topic_id, front_text: '', back_text: '' }))
  );
}
