/**
 * GET /api/v2/exam-schedule — the three-tier exam schedule for the
 * authenticated student.
 *
 * Tiers, in precedence order (DECISIONS.md §4):
 *   school  — authoritative window. Read only where the school surface already
 *             persists student-visible dated rows; absent → tier omitted and
 *             the UI degrades to two tiers, which it handles.
 *   teacher — dated assignments WITH chapter scope. The valuable tier: scope is
 *             what narrows the revision plan. NOT bound in this pass — see the
 *             fast-follow note below; it contributes nothing today and the
 *             response is still valid without it.
 *   student — student_exam_entries, student-owned, never overrides the above.
 *
 * Thin handler: auth → flag → read → project. No scoring, no mastery math, no
 * curriculum text. Chapter mastery bands come from resolveExamReadinessBand()
 * (packages/lib/src/exams/mastery-band.ts) — a pure relabel of the SAME
 * concept_mastery.mastery_level rollup the Progress surface reads. This route
 * does NOT define its own band thresholds; a route-local mapping was reviewed
 * and rejected (see that module's header for the six competing schemes it
 * would otherwise have duplicated).
 *
 * WRITE PATH: there is no create/edit/delete route for student_exam_entries
 * yet. This GET is the only Wave-B exam-schedule route shipping in this pass;
 * a write endpoint (to back an "Add a date" / "Edit" UI action) is an
 * explicitly deferred fast-follow, not implemented here.
 *
 * P13: no PII in logs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { resolveExamReadinessBand, type ExamReadinessBand } from '@alfanumrik/lib/exams/mastery-band';
import { getTopicTitlesByIds } from '@/lib/curriculum/cached-taxonomy';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_exam_schedule_v1';

interface EntryTopic {
  id: string;
  label: string;
  band: ExamReadinessBand;
}

interface Entry {
  id: string;
  source: 'school' | 'teacher' | 'student';
  title: string;
  startsOn: string;
  endsOn: string;
  setBy?: string;
  setByInitials?: string;
  chapters?: EntryTopic[];
  editable?: boolean;
}

export const GET = withRoute(async (request: NextRequest) => {
  const auth = await authorizeRequest(request, 'study_plan.view', { requireStudentId: true });
  if (!auth.authorized || !auth.userId) return auth.errorResponse as unknown as NextResponse;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: auth.userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return v2Error('Not found', 404, 'NOT_FOUND');

  try {
    const supabase = await createSupabaseServerClient();
    const entries: Entry[] = [];

    // ── Tier 3: student-added. RLS restricts this to the caller's own rows. ──
    const { data: own, error: ownErr } = await supabase
      .from('student_exam_entries')
      .select('id, title, starts_on, ends_on, student_exam_entry_topics(topic_id)')
      .order('starts_on', { ascending: true });

    if (ownErr) {
      logger.warn('v2_exam_schedule_student_tier_failed', { route: '/api/v2/exam-schedule' });
    }

    // Resolve mastery bands for every referenced topic in one read, from the
    // canonical concept_mastery rollup. mastery_level is the engine-computed
    // categorical band; resolveExamReadinessBand() relabels it (falling back
    // to mastery_probability only defensively — see that module).
    const topicIds = new Set<string>();
    for (const row of own ?? []) {
      for (const t of (row.student_exam_entry_topics ?? []) as Array<{ topic_id: string }>) {
        topicIds.add(t.topic_id);
      }
    }

    const bandByTopic = new Map<string, ExamReadinessBand>();
    const labelByTopic = new Map<string, string>();
    if (topicIds.size > 0) {
      const ids = Array.from(topicIds);
      const [{ data: mastery }, topics] = await Promise.all([
        supabase
          .from('concept_mastery')
          .select('topic_id, mastery_probability, mastery_level')
          .in('topic_id', ids),
        // Shared cached taxonomy reader (ADR-007 / Hard Rule 6) — NOT an
        // inline curriculum_topics query. is_active-agnostic on purpose: see
        // getTopicTitlesByIds()'s header.
        getTopicTitlesByIds(ids),
      ]);
      for (const m of (mastery ?? []) as Array<{
        topic_id: string;
        mastery_probability: number | null;
        mastery_level: string | null;
      }>) {
        bandByTopic.set(m.topic_id, resolveExamReadinessBand(m));
      }
      for (const t of topics) {
        labelByTopic.set(t.id, t.title ?? '');
      }
    }

    for (const row of (own ?? []) as Array<{
      id: string;
      title: string;
      starts_on: string;
      ends_on: string;
      student_exam_entry_topics: Array<{ topic_id: string }> | null;
    }>) {
      const chapters = (row.student_exam_entry_topics ?? [])
        .map((t) => ({
          id: t.topic_id,
          label: labelByTopic.get(t.topic_id) ?? '',
          band: bandByTopic.get(t.topic_id) ?? ('new' as ExamReadinessBand),
        }))
        .filter((c) => c.label.length > 0);

      entries.push({
        id: row.id,
        source: 'student',
        title: row.title,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        chapters: chapters.length > 0 ? chapters : undefined,
        editable: true,
      });
    }

    // ── Tier 2: teacher-set. Bound to the existing assignment surface once its
    //    dated + chapter-scoped shape is confirmed (DECISIONS.md §5). Until
    //    that binding lands this tier contributes nothing and the response is
    //    still valid — the client renders whatever tiers it receives.
    //    (Fast-follow, deliberately out of scope for this pass.)

    entries.sort((a, b) => a.startsOn.localeCompare(b.startsOn));

    return v2Success({ schemaVersion: 1 as const, entries });
  } catch (err) {
    logger.error('v2_exam_schedule_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/exam-schedule',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
});
