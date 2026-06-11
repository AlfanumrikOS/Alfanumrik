import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/practice/history — Practice Center history + lightweight analytics
 * for the authenticated student. Read-only aggregation over quiz_sessions and
 * question_responses. No RPC, no schema, no writes.
 *
 * Auth/scoping mirrors the sibling /api/dashboard/reviews-due and
 * /api/revision/overview routes exactly:
 *   - same permission (progress.view_own, requireStudentId)
 *   - studentId is taken ONLY from the session (never from query/body)
 *   - supabaseAdmin (service role) query is ALWAYS filtered by that studentId
 *   - same null-guard + error shape, same private 5-min cache
 *
 * P1: score_percent / correct / total are read straight from the stored
 *     quiz_sessions row — never recomputed.
 * P5: grades are strings (not used as a filter here; per-student scoping
 *     handles relevance). P13: log only counts, never subjects, titles, IDs.
 *
 * Response shape:
 *   {
 *     sessions: [{ id, subject, topicTitle, scorePercent, totalQuestions,
 *                  correctAnswers, difficultyLevel, completedAt }],
 *     stats: { totalSessions, last7Days, avgScore, dueReviewCount },
 *     errorPatterns: [{ type, count }],
 *     bloomDistribution: [{ bloomLevel, attempted, correct }],
 *   }
 */

const SESSION_LIMIT = 30;

interface QuizSessionRow {
  id: string;
  subject: string | null;
  topic_title: string | null;
  total_questions: number | null;
  correct_answers: number | null;
  score_percent: number | null;
  difficulty_level: number | null;
  completed_at: string | null;
}

interface QuestionResponseRow {
  is_correct: boolean | null;
  bloom_level_attempted: string | null;
  error_type: string | null;
}

interface SessionOut {
  id: string;
  subject: string;
  topicTitle: string | null;
  scorePercent: number;
  totalQuestions: number;
  correctAnswers: number;
  difficultyLevel: number | null;
  completedAt: string | null;
}

export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const studentId = auth.studentId;
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'No student context available' },
        { status: 400 }
      );
    }

    // ── Sessions: last 30 completed, newest first. Stored values only (P1). ──
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from('quiz_sessions')
      .select(
        'id, subject, topic_title, total_questions, correct_answers, score_percent, difficulty_level, completed_at'
      )
      .eq('student_id', studentId)
      .eq('is_completed', true)
      .order('completed_at', { ascending: false })
      .limit(SESSION_LIMIT);

    if (sessionError) {
      logger.error('practice_history_sessions_query_failed', {
        error: new Error(sessionError.message),
        route: '/api/practice/history',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load practice history' },
        { status: 500 }
      );
    }

    const sessionRows = (sessionData ?? []) as QuizSessionRow[];

    const sessions: SessionOut[] = sessionRows.map((row) => ({
      id: row.id,
      subject: row.subject ?? 'unknown',
      topicTitle: row.topic_title ?? null,
      scorePercent: row.score_percent ?? 0,
      totalQuestions: row.total_questions ?? 0,
      correctAnswers: row.correct_answers ?? 0,
      difficultyLevel: row.difficulty_level ?? null,
      completedAt: row.completed_at ?? null,
    }));

    // ── stats ──
    const totalSessions = sessions.length;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86_400_000;
    const last7Days = sessions.filter((s) => {
      if (!s.completedAt) return false;
      const t = Date.parse(s.completedAt);
      return !Number.isNaN(t) && t >= sevenDaysAgo;
    }).length;

    const avgScore =
      totalSessions > 0
        ? Math.round(
            sessions.reduce((sum, s) => sum + s.scorePercent, 0) / totalSessions
          )
        : 0;

    // dueReviewCount: same query family as /api/dashboard/reviews-due.
    const today = new Date().toISOString().slice(0, 10);
    let dueReviewCount = 0;
    {
      const { data: dueData, error: dueError } = await supabaseAdmin
        .from('concept_mastery')
        .select('next_review_date', { count: 'exact', head: false })
        .eq('student_id', studentId)
        .lte('next_review_date', today)
        .lt('mastery_probability', 0.95);

      if (dueError) {
        // Non-fatal: history is still useful without the due count.
        logger.warn('practice_history_due_count_failed', {
          route: '/api/practice/history',
        });
      } else {
        dueReviewCount = (dueData ?? []).length;
      }
    }

    // ── errorPatterns + bloomDistribution: aggregate question_responses over
    //    the returned (last-30) sessions. Capped work via an IN filter on the
    //    session IDs we already loaded. If columns are absent or the query
    //    fails, return [] rather than failing the whole route. ──
    const errorPatterns: { type: string; count: number }[] = [];
    const bloomDistribution: { bloomLevel: string; attempted: number; correct: number }[] = [];

    if (sessionRows.length > 0) {
      const sessionIds = sessionRows.map((r) => r.id);
      const { data: respData, error: respError } = await supabaseAdmin
        .from('question_responses')
        .select('is_correct, bloom_level_attempted, error_type')
        .in('quiz_session_id', sessionIds);

      if (respError) {
        // Heavy / missing columns — degrade to empty analytics, not a 500.
        logger.warn('practice_history_responses_unavailable', {
          route: '/api/practice/history',
        });
      } else {
        const responses = (respData ?? []) as QuestionResponseRow[];

        const errorCounts = new Map<string, number>();
        const bloomAgg = new Map<string, { attempted: number; correct: number }>();

        for (const r of responses) {
          if (r.error_type) {
            errorCounts.set(r.error_type, (errorCounts.get(r.error_type) ?? 0) + 1);
          }
          if (r.bloom_level_attempted) {
            const agg = bloomAgg.get(r.bloom_level_attempted) ?? { attempted: 0, correct: 0 };
            agg.attempted += 1;
            if (r.is_correct === true) agg.correct += 1;
            bloomAgg.set(r.bloom_level_attempted, agg);
          }
        }

        for (const [type, count] of errorCounts.entries()) {
          errorPatterns.push({ type, count });
        }
        errorPatterns.sort((a, b) => b.count - a.count);

        for (const [bloomLevel, agg] of bloomAgg.entries()) {
          bloomDistribution.push({
            bloomLevel,
            attempted: agg.attempted,
            correct: agg.correct,
          });
        }
        bloomDistribution.sort((a, b) => b.attempted - a.attempted);
      }
    }

    // P13: log only counts. Never log subjects, titles, IDs, or scores.
    logger.info('practice_history_served', {
      route: '/api/practice/history',
      totalSessions,
      last7Days,
      dueReviewCount,
      errorPatternCount: errorPatterns.length,
      bloomLevelCount: bloomDistribution.length,
    });

    return NextResponse.json(
      {
        sessions,
        stats: {
          totalSessions,
          last7Days,
          avgScore,
          dueReviewCount,
        },
        errorPatterns,
        bloomDistribution,
      },
      {
        headers: {
          // Private cache: per-student data, must not be shared. 5-min TTL
          // matches the sibling /api/dashboard/reviews-due route.
          'Cache-Control': 'private, max-age=300',
        },
      }
    );
  } catch (err) {
    logger.error('practice_history_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/practice/history',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
