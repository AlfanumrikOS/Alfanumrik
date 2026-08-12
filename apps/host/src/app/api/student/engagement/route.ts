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

    // Parallel queries for engagement data
    const [
      studentRes,
      masteryRes,
      quizzesRes,
    ] = await Promise.all([
      supabase
        .from('students')
        .select('total_xp, streak_current, streak_best, last_active_date')
        .eq('id', studentId)
        .single(),
      supabase
        .from('concept_mastery')
        .select('subject_code, mastery_mean')
        .eq('student_id', studentId),
      supabase
        .from('quiz_responses')
        .select('created_at, subject, score_percent, total_questions')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const student = studentRes.data;
    const totalXp = student?.total_xp ?? 0;
    const level = calculateLevel(totalXp);
    const levelName = LEVEL_NAMES[level] ?? LEVEL_NAMES[1] ?? 'Learner';
    const xpInfo = xpToNextLevel(totalXp);

    // Aggregate per-subject mastery
    const masteryBySubject = new Map<string, { sum: number; count: number; mastered: number }>();
    for (const row of masteryRes.data ?? []) {
      const existing = masteryBySubject.get(row.subject_code) ?? { sum: 0, count: 0, mastered: 0 };
      existing.sum += row.mastery_mean ?? 0;
      existing.count += 1;
      if ((row.mastery_mean ?? 0) >= 80) existing.mastered += 1;
      masteryBySubject.set(row.subject_code, existing);
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
        current: student?.streak_current ?? 0,
        best: student?.streak_best ?? 0,
        lastActiveDate: student?.last_active_date ?? null,
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
