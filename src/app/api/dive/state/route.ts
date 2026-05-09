/**
 * Pedagogy v2 — Wave 2 Task 5a
 * GET /api/dive/state
 *
 * Returns the current ISO week's dive state for the authenticated student
 * plus everything the picker UI needs:
 *   - state ('open' | 'completed') from planWeeklyDive
 *   - currentIsoWeek + lastCompletedIsoWeek + weeklyStreakCount
 *   - defaultPicker + show* booleans (persona-aware via the orchestrator)
 *   - eligiblePhenomena (rows from public.phenomena matching student grade band)
 *   - weakTopics (concept_mastery rows below the mastery threshold)
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive. Returns 404 when off.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.2
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { planWeeklyDive, isoWeekOf } from '@/lib/learn/weekly-dive-orchestrator';
import { resolveGoalProfile, type GoalCode } from '@/lib/goals/goal-profile';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const FALLBACK_PERSONA: GoalCode = 'pass_comfortably';
const WEAK_MASTERY_THRESHOLD = 0.5;
const WEAK_TOPIC_LIMIT = 5;
const PHENOMENON_LIMIT = 5;

/**
 * Returns true when a student's numeric grade falls within a phenomenon's
 * grade-band string (e.g. '6-12', '9-10', '6-8'). Single-grade bands like
 * '10' are also accepted. Returns false for malformed bands so a bad seed
 * doesn't surface broken phenomena to students.
 */
function gradeMatchesBand(studentGradeNum: number, band: string): boolean {
  const range = band.split('-');
  if (range.length === 1) {
    const n = parseInt(range[0], 10);
    return Number.isFinite(n) && n === studentGradeNum;
  }
  if (range.length === 2) {
    const lo = parseInt(range[0], 10);
    const hi = parseInt(range[1], 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    return studentGradeNum >= lo && studentGradeNum <= hi;
  }
  return false;
}

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.WEEKLY_DIVE, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, grade, academic_goal, weekly_streak_count, weekly_streak_last_iso_week')
    .eq('id', userId)
    .maybeSingle();

  if (studentErr) {
    logger.warn('dive/state: students fetch failed', { userId, error: studentErr.message });
    return NextResponse.json({ error: 'student_lookup_failed' }, { status: 500 });
  }
  if (!studentRow) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }

  const goalProfile = resolveGoalProfile(studentRow.academic_goal);
  const persona: GoalCode = goalProfile?.code ?? FALLBACK_PERSONA;
  const studentGrade: string = String(studentRow.grade ?? '');
  const studentGradeNum = parseInt(studentGrade, 10);
  const nowIso = new Date().toISOString();
  const currentIsoWeek = isoWeekOf(new Date(nowIso));

  // Eligible phenomena: matching grade band, active, NOT the trip-wire row.
  const { data: phenomenaRows } = await supabase
    .from('phenomena')
    .select('id, slug, title_en, title_hi, summary_en, summary_hi, subjects, grade_band')
    .eq('is_active', true)
    .neq('slug', 'placeholder-replace-me')
    .limit(50); // load up to 50; filter by grade band in JS for correctness over band syntax variations.
  const eligiblePhenomena = Number.isFinite(studentGradeNum)
    ? (phenomenaRows ?? [])
        .filter((p) => gradeMatchesBand(studentGradeNum, String((p as { grade_band: string }).grade_band)))
        .slice(0, PHENOMENON_LIMIT)
    : [];

  // Weak topics: concept_mastery rows below the mastery threshold for this student.
  // Joined to curriculum_topics for display titles.
  const { data: weakRows } = await supabase
    .from('concept_mastery')
    .select('topic_id, mastery_probability, curriculum_topics:topic_id ( id, title, title_hi )')
    .eq('student_id', userId)
    .lt('mastery_probability', WEAK_MASTERY_THRESHOLD)
    .gt('total_attempts', 0)
    .order('mastery_probability', { ascending: true })
    .limit(WEAK_TOPIC_LIMIT);

  // PostgREST returns embedded relations as arrays by default. Normalize to
  // a single object (or null) since topic_id → curriculum_topics is 1:1.
  const weakTopics = (weakRows ?? []).map((row) => {
    const r = row as unknown as {
      topic_id: string;
      mastery_probability: number;
      curriculum_topics?:
        | { id: string; title: string; title_hi: string | null }
        | { id: string; title: string; title_hi: string | null }[]
        | null;
    };
    const ct = Array.isArray(r.curriculum_topics)
      ? (r.curriculum_topics[0] ?? null)
      : (r.curriculum_topics ?? null);
    return {
      topicId: r.topic_id,
      title: ct?.title ?? 'Topic',
      titleHi: ct?.title_hi ?? null,
      masteryProbability: r.mastery_probability,
    };
  });

  // Compose the picker plan.
  const plan = planWeeklyDive({
    persona,
    studentGrade,
    nowIso,
    lastCompletedIsoWeek: studentRow.weekly_streak_last_iso_week ?? null,
    weakTopicCount: weakTopics.length,
    eligiblePhenomenaCount: eligiblePhenomena.length,
  });

  return NextResponse.json(
    {
      state: plan.state,
      currentIsoWeek,
      lastCompletedIsoWeek: studentRow.weekly_streak_last_iso_week ?? null,
      weeklyStreakCount: studentRow.weekly_streak_count ?? 0,
      defaultPicker: plan.defaultPicker,
      showPhenomenonOption: plan.showPhenomenonOption,
      showWeakTopicOption: plan.showWeakTopicOption,
      showOwnTopicOption: plan.showOwnTopicOption,
      eligiblePhenomena,
      weakTopics,
    },
    { headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } },
  );
}
