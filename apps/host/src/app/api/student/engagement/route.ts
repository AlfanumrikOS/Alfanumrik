/**
 * GET /api/student/engagement — Aggregated engagement snapshot for the
 * student-facing progress dashboard.
 *
 * Returns: XP/level, streak, per-subject mastery, recent quiz scores.
 * RLS-scoped — only the authenticated student's data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { calculateLevel, xpToNextLevel, LEVEL_NAMES } from '@alfanumrik/lib/xp-config';
import { logger } from '@alfanumrik/lib/logger';

export interface EngagementSnapshot {
  xp: {
    total: number;
    level: number;
    levelName: string;
    xpInLevel: number;
    xpToNext: number;
  };
  streak: {
    current: number;
    best: number;
    lastActiveDate: string | null;
  };
  subjectMastery: Array<{
    subject: string;
    averageMastery: number;
    topicsTotal: number;
    topicsMastered: number;
  }>;
  recentQuizzes: Array<{
    date: string;
    subject: string;
    score: number;
    totalQuestions: number;
  }>;
}

export async function GET(request: NextRequest) {
  // Permission: progress.view_own — the student's own learning state.
  //
  // This route previously authorized against 'student.profile.read', a code
  // that existed at exactly one place in the repo: this call site. It was never
  // seeded into the `permissions` table and never named in any role grant, so
  // hasPermission() resolved it for NO role and the super_admin bypass at
  // rbac.ts:779-780 was the only way through — every real student got denied.
  // Repointed to the already-granted semantic twin used by the sibling
  // own-progress reads (/api/practice/history, /api/dashboard/reviews-due,
  // /api/v2/student/progress). Grant proof: 'progress.view_own' is seeded at
  // supabase/migrations/20260612123200_rbac_matrix_conformance.sql:125 and
  // granted to the student role at line 225 of that same migration.
  //
  // Do NOT reintroduce a bespoke code here: new permission codes require user
  // approval, and an ungranted code fails closed and silently.
  const auth = await authorizeRequest(request, 'progress.view_own', {
    requireStudentId: true,
  });
  // Return the REAL auth error, not a hand-rolled 401. A permission denial is a
  // 403; emitting 401 told the client its session was invalid and could drive a
  // spurious logout loop.
  if (!auth.authorized) return auth.errorResponse!;

  // studentId is resolved server-side by authorizeRequest from the JWT
  // (SELECT id FROM students WHERE auth_user_id = <jwt sub>) — never read from
  // query or body, so there is no IDOR surface here.
  const studentId = auth.studentId;
  if (!studentId) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  try {
    const supabase = await createSupabaseServerClient();

    // Parallel queries for engagement data.
    //
    // 2026-08-25 (launch-blocker P0-4): every one of these three selects named
    // columns that do not exist, and each `error` was discarded, so PostgREST
    // returned 42703 three times and the route answered 200 with a fully zeroed
    // snapshot — every student saw 0 XP / Level 1 / 0 streak / no mastery
    // regardless of their real data. Corrected sources:
    //   students          total_xp→xp_total, streak_current→streak_days,
    //                     last_active_date→last_active (streak_best: see below)
    //   concept_mastery   has no subject_code; subject only resolves through
    //                     curriculum_topics→subjects, which is exactly what the
    //                     existing `topic_mastery_rollup` view does. Reused
    //                     rather than re-joining here (same view Foxy reads, so
    //                     both surfaces agree). It is security_invoker=true, so
    //                     RLS on concept_mastery still applies to the caller.
    //                     Its `mastery_percent` is 0-100, which is the scale the
    //                     >= 80 "mastered" threshold below always assumed —
    //                     `mastery_mean` was 0-1, so that test could never pass.
    //   quiz_responses    wrong TABLE — it has no score_percent/total_questions.
    //                     Completed-quiz scores live on `quiz_sessions`.
    const [
      studentRes,
      masteryRes,
      quizzesRes,
    ] = await Promise.all([
      supabase
        .from('students')
        .select('xp_total, streak_days, last_active')
        .eq('id', studentId)
        .single(),
      supabase
        .from('topic_mastery_rollup')
        .select('subject, mastery_percent')
        .eq('student_id', studentId),
      supabase
        .from('quiz_sessions')
        .select('created_at, subject, score_percent, total_questions')
        .eq('student_id', studentId)
        .eq('is_completed', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // supabase-js resolves {data, error} and never throws, so the catch below is
    // unreachable for query failures — every error must be inspected explicitly
    // or it becomes a silent zero. Enforced by alfanumrik/no-unchecked-supabase-error.
    const readErr = studentRes.error ?? masteryRes.error ?? quizzesRes.error;
    if (readErr) {
      logger.error('Engagement snapshot query failed', {
        studentId,
        code: (readErr as { code?: string }).code,
        error: readErr.message,
      });
      return NextResponse.json(
        { error: 'Failed to load engagement data' },
        { status: 500 }
      );
    }

    const student = studentRes.data;
    const totalXp = student?.xp_total ?? 0;
    const level = calculateLevel(totalXp);
    const levelName = LEVEL_NAMES[level] ?? LEVEL_NAMES[1] ?? 'Learner';
    const xpInfo = xpToNextLevel(totalXp);

    // Aggregate per-subject mastery
    const masteryBySubject = new Map<string, { sum: number; count: number; mastered: number }>();
    for (const row of (masteryRes.data ?? []) as Array<{ subject: string | null; mastery_percent: number | null }>) {
      if (!row.subject) continue;
      const existing = masteryBySubject.get(row.subject) ?? { sum: 0, count: 0, mastered: 0 };
      const pct = row.mastery_percent ?? 0;
      existing.sum += pct;
      existing.count += 1;
      if (pct >= 80) existing.mastered += 1;
      masteryBySubject.set(row.subject, existing);
    }

    const subjectMastery = Array.from(masteryBySubject.entries()).map(
      ([subject, data]) => ({
        subject,
        averageMastery: Math.round(data.sum / data.count),
        topicsTotal: data.count,
        topicsMastered: data.mastered,
      })
    );

    const recentQuizzes = (quizzesRes.data ?? []).map((q: {
      created_at: string;
      subject: string;
      score_percent: number;
      total_questions: number;
    }) => ({
      date: q.created_at,
      subject: q.subject,
      score: q.score_percent,
      totalQuestions: q.total_questions,
    }));

    const snapshot: EngagementSnapshot = {
      xp: {
        total: totalXp,
        level,
        levelName,
        xpInLevel: xpInfo.current,
        xpToNext: xpInfo.needed - xpInfo.current,
      },
      streak: {
        current: student?.streak_days ?? 0,
        // No all-time-best daily streak is tracked anywhere in the schema.
        // `student_learning_profiles.longest_streak` is a PER-SUBJECT learning
        // streak (9 of 485 rows populated, max 3) — reporting it here would
        // render "current 45, best 3". Until a real column exists, report the
        // current streak, which is a truthful lower bound on the best and can
        // never contradict it. FOLLOW-UP: add students.longest_streak_days,
        // maintained wherever streak_days is incremented.
        best: student?.streak_days ?? 0,
        lastActiveDate: student?.last_active ?? null,
      },
      subjectMastery,
      recentQuizzes,
    };

    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    logger.error('Engagement snapshot error', {
      studentId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json(
      { error: 'Failed to load engagement data' },
      { status: 500 }
    );
  }
}
