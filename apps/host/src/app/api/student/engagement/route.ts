/**
 * GET /api/student/engagement — Aggregated engagement snapshot for the
 * student-facing progress dashboard.
 *
 * Returns: XP/level, streak, per-subject mastery, recent quiz scores.
 * RLS-scoped — only the authenticated student's data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { calculateLevel, xpToNextLevel, LEVEL_NAMES } from '@alfanumrik/lib/xp-config';
import { logger } from '@/lib/logger';

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
  const auth = await authorizeRequest(request, 'student.profile.read');
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
