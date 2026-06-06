/**
 * GET /api/v2/student/progress — structured progress payload (mobile + web).
 *
 * Thin read. Reuses the SAME data sources the web /progress page reads:
 *   - performance_scores       (overall_score, level_name)
 *   - concept_mastery          (topic_mastery + decay_topics)
 *   - get_knowledge_gaps RPC   (knowledge_gaps)
 *   - learning_velocity        (learning_velocity)
 *
 * RLS-safe: every read is scoped to the JWT-resolved studentId. Runs server-side
 * via the admin client (the route itself enforces ownership through
 * requireStudentId), mirroring /api/v1/performance's server-side aggregation.
 *
 * No scoring / XP math here — pure projection.
 *
 * Auth: progress.view_own (same permission /api/v1/performance uses).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { v2Success, v2Error } from '@/lib/api/v2/envelope';

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const studentId = auth.studentId;
    if (!studentId) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }

    const admin = getSupabaseAdmin();

    // Same sources the /progress page fetches, run in parallel server-side.
    const [perfRes, masteryRes, gapsRes, velocityRes, decayRes] = await Promise.all([
      admin
        .from('performance_scores')
        .select('subject, overall_score, level_name, updated_at')
        .eq('student_id', studentId),
      admin
        .from('concept_mastery')
        .select('topic_id, mastery_probability, consecutive_correct, updated_at')
        .eq('student_id', studentId)
        .order('updated_at', { ascending: false })
        .limit(200),
      admin.rpc('get_knowledge_gaps', { p_student_id: studentId, p_limit: 20 }),
      admin
        .from('learning_velocity')
        .select('subject, weekly_mastery_rate, acceleration, predicted_mastery_date')
        .eq('student_id', studentId)
        .limit(50),
      // decay_topics: low mastery, ordered worst-first (mirrors /progress page).
      admin
        .from('concept_mastery')
        .select('topic_id, mastery_probability, next_review_at')
        .eq('student_id', studentId)
        .lt('mastery_probability', 0.5)
        .order('mastery_probability', { ascending: true })
        .limit(8),
    ]);

    const performance_scores = (perfRes.data ?? []).map((p) => ({
      subject: p.subject,
      overall_score: p.overall_score ?? 0,
      level_name: (p.level_name as string | null) ?? null,
      updated_at: (p.updated_at as string | null) ?? null,
    }));

    const topic_mastery = (masteryRes.data ?? []).map((m) => ({
      topic_id: (m.topic_id as string | null) ?? null,
      mastery_probability: m.mastery_probability ?? 0,
      consecutive_correct: (m.consecutive_correct as number | null) ?? null,
      updated_at: (m.updated_at as string | null) ?? null,
    }));

    const knowledge_gaps = (Array.isArray(gapsRes.data) ? gapsRes.data : []).map(
      (g: Record<string, unknown>) => ({
        subject: (g.subject as string | null) ?? null,
        topic: (g.topic as string | null) ?? null,
        severity: (g.severity as string | null) ?? null,
        mastery_probability:
          typeof g.mastery_probability === 'number' ? g.mastery_probability : null,
      }),
    );

    const learning_velocity = (velocityRes.data ?? []).map((v) => ({
      subject: v.subject,
      weekly_mastery_rate: (v.weekly_mastery_rate as number | null) ?? null,
      acceleration: (v.acceleration as number | null) ?? null,
      predicted_mastery_date: (v.predicted_mastery_date as string | null) ?? null,
    }));

    const decay_topics = (decayRes.data ?? []).map((d) => ({
      topic_id: (d.topic_id as string | null) ?? null,
      subject: null,
      mastery_probability: (d.mastery_probability as number | null) ?? null,
      next_review_at: (d.next_review_at as string | null) ?? null,
    }));

    return v2Success(
      {
        schemaVersion: 1 as const,
        student_id: studentId,
        performance_scores,
        topic_mastery,
        knowledge_gaps,
        learning_velocity,
        decay_topics,
      },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('v2_student_progress_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/student/progress',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
