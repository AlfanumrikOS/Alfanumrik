/**
 * Pedagogy v2 — Wave 2 Task 5a
 * GET /api/dive/state
 *
 * Returns the authenticated student's weekly Curiosity Dive state for the
 * current ISO week: whether the dive is open or already completed, the weekly
 * streak, the persona-aware default picker, which picker options to show, and
 * the data each picker needs (curated phenomena + the student's weakest
 * topics).
 *
 * Backend glue for the /dive surface (`src/app/dive/page.tsx`) and the
 * dashboard rhythm queue lite consumer
 * (`src/components/dashboard/sections/DailyRhythmQueue.tsx`).
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive — when off, returns 404 so the
 * surface is fully hidden (mirrors /api/dive/history + /api/synthesis/state).
 *
 * RLS: uses the user-bound supabase client. `dive_artifacts` SELECT is
 * restricted to the row's own student by RLS; `phenomena` is readable by all
 * authenticated users; `get_due_reviews` is a SECURITY DEFINER RPC scoped by
 * p_student_id (same pattern as /api/rhythm/today). No service-role bypass.
 *
 * NEVER 500s on missing/ambiguous data — every optional data source degrades
 * to a safe minimal-but-valid value (empty arrays, own_topic always shown).
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.2
 * Plan: docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-2-weekly-dive.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import {
  isoWeekOf,
  planWeeklyDive,
  type DivePickerOption,
} from '@/lib/learn/weekly-dive-orchestrator';
import { computeWeeklyStreakFromHistory } from '@/lib/learn/weekly-streak';
import { logger } from '@/lib/logger';
import { cacheFetchAsync, CACHE_TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';

interface PickerPhenomenon {
  id: string;
  slug: string;
  title_en: string;
  title_hi: string;
  summary_en: string;
  summary_hi: string;
  subjects: string[];
}

interface PickerWeakTopic {
  topicId: string;
  title: string;
  titleHi: string | null;
  masteryProbability: number;
}

interface DiveStateResponse {
  state: 'open' | 'completed';
  currentIsoWeek: string;
  lastCompletedIsoWeek: string | null;
  weeklyStreakCount: number;
  defaultPicker: DivePickerOption;
  showPhenomenonOption: boolean;
  showWeakTopicOption: boolean;
  showOwnTopicOption: boolean;
  eligiblePhenomena: PickerPhenomenon[];
  weakTopics: PickerWeakTopic[];
}

const PHENOMENA_LIMIT = 24;
const WEAK_TOPIC_LIMIT = 8;

/**
 * Best-effort grade-band match: phenomena.grade_band is 'min-max' (e.g.
 * '6-12'). Returns true when the student's grade falls inside the band, or
 * when either side is unparseable (fail-open so a mislabeled band never hides
 * an otherwise-valid phenomenon). Grades are strings per P5.
 */
function gradeInBand(studentGrade: string, band: string): boolean {
  const grade = parseInt(studentGrade, 10);
  if (!Number.isFinite(grade)) return true; // no usable grade → don't filter out
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(band ?? '');
  if (!m) return true; // unparseable band → fail open
  const min = parseInt(m[1], 10);
  const max = parseInt(m[2], 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
  return grade >= min && grade <= max;
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

  const currentIsoWeek = isoWeekOf(new Date());

  // Phase 5 perf: this read-only state assembly issues several Supabase reads
  // (student row, dive_artifacts, phenomena, get_due_reviews RPC) and fires on
  // dashboard mount alongside the other per-student aggregate calls. Collapse
  // repeat reads within a 30s window with a SERVER-SIDE cache keyed by userId +
  // ISO week (the dive is scoped to the current week, so the week belongs in the
  // key). The key includes userId so students NEVER collide (P13: per-student
  // data must never be shared). This is a server cache, NOT a CDN/`s-maxage`
  // header — Vercel's edge does not vary by auth, so a public cache would leak
  // one student's dive state to another. This handler has no writes (all reads
  // + one read RPC), so it is safe to cache.
  const body = await cacheFetchAsync<DiveStateResponse>(
    `dive:state:${userId}:${currentIsoWeek}`,
    CACHE_TTL.USER,
    () => buildDiveState(supabase, userId, currentIsoWeek),
  );

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
  });
}

/**
 * Assembles the weekly dive state for a student. All reads/read-RPCs — no
 * writes — and never throws (every optional source degrades to a safe default),
 * so the result is safe to memoize in the per-student server cache above.
 */
async function buildDiveState(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  currentIsoWeek: string,
): Promise<DiveStateResponse> {
  // ── Student row (persona + grade). Missing profile degrades gracefully:
  //    persona null → orchestrator fallback default; grade '' → phenomena
  //    grade-band filter fails open. We do NOT 404/500 on a missing row;
  //    the picker still works via own_topic.
  let persona: string | null = null;
  let studentGrade = '';
  // Surrogate students.id (random uuid; distinct from the auth uid). ALL
  // student-scoped child tables (dive_artifacts) and RPCs (get_due_reviews)
  // key on this surrogate, NOT the auth uid. Resolved via auth_user_id.
  let studentDbId: string | null = null;
  {
    const { data: studentRow, error: studentErr } = await supabase
      .from('students')
      .select('id, grade, academic_goal')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (studentErr) {
      logger.warn('dive/state: students fetch failed (degrading)', {
        userId, error: studentErr.message,
      });
    }
    if (studentRow) {
      studentDbId = (studentRow as { id: string }).id ?? null;
      persona = (studentRow as { academic_goal: string | null }).academic_goal ?? null;
      studentGrade = String((studentRow as { grade: string | null }).grade ?? '');
    }
  }

  // ── Dive history → state, lastCompletedIsoWeek, weeklyStreakCount.
  //    Keyed on the surrogate studentDbId. Missing student row (studentDbId
  //    null) degrades to an open dive with a zero streak — we never query with
  //    a null id. On error we likewise degrade rather than 500.
  let state: 'open' | 'completed' = 'open';
  let lastCompletedIsoWeek: string | null = null;
  let weeklyStreakCount = 0;
  if (studentDbId) {
    const { data: artifactRows, error: artifactErr } = await supabase
      .from('dive_artifacts')
      .select('iso_week')
      .eq('student_id', studentDbId)
      .order('iso_week', { ascending: false })
      .limit(120);
    if (artifactErr) {
      logger.warn('dive/state: dive_artifacts fetch failed (degrading)', {
        userId, error: artifactErr.message,
      });
    }
    const weeks = (artifactRows ?? [])
      .map((r) => String((r as { iso_week: string }).iso_week ?? ''))
      .filter((w) => w.length > 0);
    if (weeks.includes(currentIsoWeek)) state = 'completed';
    lastCompletedIsoWeek = weeks.length > 0 ? weeks[0] : null;
    weeklyStreakCount = computeWeeklyStreakFromHistory(weeks);
  }

  // ── Eligible phenomena (active + grade-band match). Empty array on error
  //    so the phenomenon option simply hides.
  const eligiblePhenomena: PickerPhenomenon[] = [];
  {
    const { data: phenomenaRows, error: phenomenaErr } = await supabase
      .from('phenomena')
      .select('id, slug, title_en, title_hi, summary_en, summary_hi, subjects, grade_band')
      .eq('is_active', true)
      .order('title_en', { ascending: true })
      .limit(PHENOMENA_LIMIT);
    if (phenomenaErr) {
      logger.warn('dive/state: phenomena fetch failed (degrading)', {
        userId, error: phenomenaErr.message,
      });
    }
    for (const row of phenomenaRows ?? []) {
      const p = row as {
        id: string;
        slug: string;
        title_en: string;
        title_hi: string;
        summary_en: string;
        summary_hi: string;
        subjects: string[] | null;
        grade_band: string;
      };
      if (!gradeInBand(studentGrade, p.grade_band)) continue;
      eligiblePhenomena.push({
        id: p.id,
        slug: p.slug,
        title_en: p.title_en,
        title_hi: p.title_hi,
        summary_en: p.summary_en,
        summary_hi: p.summary_hi,
        subjects: p.subjects ?? [],
      });
    }
  }

  // ── Weak topics (lowest-mastery due-for-review topics). get_due_reviews is
  //    SECURITY DEFINER, returns (topic_id, title, title_hi, mastery_probability,
  //    ...) ordered by mastery_probability ASC. Empty array on error/none.
  const weakTopics: PickerWeakTopic[] = [];
  if (studentDbId) {
    const { data: dueRows, error: dueErr } = await supabase.rpc('get_due_reviews', {
      p_student_id: studentDbId,
      p_subject_code: null,
      p_limit: WEAK_TOPIC_LIMIT,
    });
    if (dueErr) {
      logger.warn('dive/state: get_due_reviews RPC failed (degrading)', {
        userId, error: dueErr.message,
      });
    }
    for (const r of (dueRows ?? []) as Record<string, unknown>[]) {
      const topicId = String(r.topic_id ?? '');
      if (!topicId) continue;
      const title = typeof r.title === 'string' && r.title.length > 0 ? r.title : 'Topic';
      const titleHi = typeof r.title_hi === 'string' && r.title_hi.length > 0 ? r.title_hi : null;
      const mastery = typeof r.mastery_probability === 'number' ? r.mastery_probability : 0;
      weakTopics.push({ topicId, title, titleHi, masteryProbability: mastery });
    }
  }

  // ── Plan: persona-aware default picker + show flags, downgraded to a
  //    visible option when the persona default has no data.
  const plan = planWeeklyDive({
    persona,
    studentGrade,
    nowIso: new Date().toISOString(),
    lastCompletedIsoWeek: state === 'completed' ? currentIsoWeek : null,
    weakTopicCount: weakTopics.length,
    eligiblePhenomenaCount: eligiblePhenomena.length,
  });

  const body: DiveStateResponse = {
    state,
    currentIsoWeek,
    lastCompletedIsoWeek,
    weeklyStreakCount,
    defaultPicker: plan.defaultPicker,
    showPhenomenonOption: plan.showPhenomenonOption,
    showWeakTopicOption: plan.showWeakTopicOption,
    showOwnTopicOption: plan.showOwnTopicOption,
    eligiblePhenomena,
    weakTopics,
  };

  return body;
}
