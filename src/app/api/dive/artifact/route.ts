/**
 * Pedagogy v2 — Wave 2 Task 5 (backend glue — shipped 2026-05-24)
 * POST /api/dive/artifact
 *
 * Persists the student-authored weekly Curiosity Dive artifact as a
 * dive_artifacts row (one per student per ISO week) and returns the updated
 * weekly streak so the /dive page can transition to its "completed" state.
 *
 * Request body (matches src/components/dive/ArtifactComposer.tsx):
 *   {
 *     pickerOption: 'phenomenon' | 'weak_topic' | 'own_topic',
 *     diveTopic: string,
 *     diveSubjects: string[],
 *     phenomenonSlug: string | null,
 *     title: string,
 *     keyConcepts: string[],       // 1..12 non-empty lines
 *     workedExample?: string,      // optional
 *     studentVoice: string,        // ≥ 20 chars
 *   }
 *
 * Response:
 *   200 { artifactId: string, weeklyStreakCount: number, isoWeek: string }
 *   409 { error: 'already_saved_this_week' }   (UNIQUE student_id+iso_week)
 *   400 { error: '<validation_code>' }
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive — 404 when off (matches the
 * sibling dive routes). RLS on dive_artifacts (dive_artifacts_self_insert)
 * enforces ownership; we resolve the caller's students.id so the INSERT's
 * student_id satisfies the WITH CHECK. No service-role bypass.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { isoWeekOf } from '@/lib/learn/weekly-dive-orchestrator';
import { applyWeeklyCompletion } from '@/lib/learn/weekly-streak';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const KEY_CONCEPTS_MIN = 1;
const KEY_CONCEPTS_MAX = 12;
const STUDENT_VOICE_MIN = 20;
const PICKER_OPTIONS = ['phenomenon', 'weak_topic', 'own_topic'] as const;

type PickerOption = (typeof PICKER_OPTIONS)[number];

interface ParsedArtifact {
  pickerOption: PickerOption;
  diveTopic: string;
  diveSubjects: string[];
  phenomenonSlug: string | null;
  title: string;
  keyConcepts: string[];
  workedExample: string | null;
  studentVoice: string;
}

/** Validate the composer payload. Returns either a parsed artifact or an error code (400). */
function parseArtifact(raw: unknown): { ok: true; value: ParsedArtifact } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_body' };
  const b = raw as Record<string, unknown>;

  const pickerOption = b.pickerOption;
  if (typeof pickerOption !== 'string' || !PICKER_OPTIONS.includes(pickerOption as PickerOption)) {
    return { ok: false, error: 'invalid_picker_option' };
  }

  const diveTopic = typeof b.diveTopic === 'string' ? b.diveTopic.trim() : '';
  if (diveTopic.length === 0) return { ok: false, error: 'missing_dive_topic' };

  const diveSubjects = Array.isArray(b.diveSubjects)
    ? b.diveSubjects.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];

  const phenomenonSlug =
    typeof b.phenomenonSlug === 'string' && b.phenomenonSlug.trim().length > 0
      ? b.phenomenonSlug.trim()
      : null;
  // Cross-field invariant: phenomenon_slug is only meaningful for phenomenon dives.
  const resolvedSlug = pickerOption === 'phenomenon' ? phenomenonSlug : null;

  const title = typeof b.title === 'string' ? b.title.trim().slice(0, TITLE_MAX) : '';
  if (title.length === 0) return { ok: false, error: 'missing_title' };

  const keyConceptsRaw = Array.isArray(b.keyConcepts) ? b.keyConcepts : [];
  const keyConcepts = keyConceptsRaw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, KEY_CONCEPTS_MAX);
  if (keyConcepts.length < KEY_CONCEPTS_MIN) return { ok: false, error: 'need_at_least_one_key_concept' };

  const workedExample =
    typeof b.workedExample === 'string' && b.workedExample.trim().length > 0
      ? b.workedExample.trim().slice(0, TEXT_MAX)
      : null;

  const studentVoice = typeof b.studentVoice === 'string' ? b.studentVoice.trim().slice(0, TEXT_MAX) : '';
  if (studentVoice.length < STUDENT_VOICE_MIN) return { ok: false, error: 'student_voice_too_short' };

  return {
    ok: true,
    value: {
      pickerOption: pickerOption as PickerOption,
      diveTopic: diveTopic.slice(0, TITLE_MAX),
      diveSubjects,
      phenomenonSlug: resolvedSlug,
      title,
      keyConcepts,
      workedExample,
      studentVoice,
    },
  };
}

/**
 * Compute the consecutive-weeks streak ending at the most-recent completed
 * ISO week, from a descending list of completed weeks. Mirrors the derivation
 * in /api/dive/state so the count returned here matches what the page shows on
 * a subsequent state fetch. Deterministic + idempotent.
 */
function isoWeekToMonday(label: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) return null;
  const isoYear = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (!Number.isFinite(isoYear) || !Number.isFinite(week) || week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const result = new Date(week1Monday);
  result.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return result;
}

function computeWeeklyStreak(completedWeeksDesc: string[]): number {
  if (completedWeeksDesc.length === 0) return 0;
  const seen = new Set<string>();
  const ordered: Date[] = [];
  for (const label of completedWeeksDesc) {
    if (seen.has(label)) continue;
    seen.add(label);
    const monday = isoWeekToMonday(label);
    if (monday) ordered.push(monday);
  }
  if (ordered.length === 0) return 0;
  let streak = 1;
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i - 1].getTime() - ordered[i].getTime();
    if (Math.abs(gap - ONE_WEEK_MS) < 1000) streak += 1;
    else break;
  }
  return streak;
}

export async function POST(request: Request) {
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = parseArtifact(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const artifact = parsed.value;

  // Resolve the caller's students.id (RLS: students_select_merged → self) so
  // the INSERT's student_id satisfies dive_artifacts_self_insert's WITH CHECK.
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, weekly_streak_count, weekly_streak_last_iso_week')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (studentErr || !studentRow) {
    logger.warn('dive/artifact: student profile lookup failed', {
      userId, error: studentErr?.message,
    });
    return NextResponse.json({ error: 'no_student_profile' }, { status: 400 });
  }
  const student = studentRow as {
    id: string;
    weekly_streak_count: number | null;
    weekly_streak_last_iso_week: string | null;
  };

  const isoWeek = isoWeekOf(new Date());

  // Insert the artifact. The UNIQUE(student_id, iso_week) constraint enforces
  // one artifact per ISO week — a duplicate surfaces as a 409 the composer
  // already handles.
  const { data: inserted, error: insertErr } = await supabase
    .from('dive_artifacts')
    .insert({
      student_id: student.id,
      iso_week: isoWeek,
      picker_option: artifact.pickerOption,
      dive_topic: artifact.diveTopic,
      dive_subjects: artifact.diveSubjects,
      phenomenon_slug: artifact.phenomenonSlug,
      title: artifact.title,
      key_concepts: artifact.keyConcepts,
      worked_example: artifact.workedExample,
      student_voice: artifact.studentVoice,
    })
    .select('id')
    .single();

  if (insertErr) {
    // 23505 = unique_violation → already saved this week.
    if (insertErr.code === '23505') {
      return NextResponse.json({ error: 'already_saved_this_week' }, { status: 409 });
    }
    logger.warn('dive/artifact: insert failed', { userId, error: insertErr.message });
    return NextResponse.json({ error: 'artifact_save_failed' }, { status: 500 });
  }

  const artifactId = (inserted as { id: string }).id;

  // ── Weekly streak. Authoritative value is derived from the durable
  //    dive_artifacts history (deterministic + idempotent). We also persist
  //    the students.weekly_streak_* columns best-effort via the tolerant
  //    applyWeeklyCompletion state machine; a failure there never blocks the
  //    save (the history derivation remains correct on the next state read).
  let weeklyStreakCount = 1;
  const { data: weekRows, error: weekErr } = await supabase
    .from('dive_artifacts')
    .select('iso_week')
    .eq('student_id', student.id)
    .order('iso_week', { ascending: false })
    .limit(120);
  if (weekErr) {
    logger.warn('dive/artifact: streak history fetch failed (degrading)', {
      userId, error: weekErr.message,
    });
    // Fall back to the column-based tolerant state machine.
    const next = applyWeeklyCompletion(
      {
        count: Number.isFinite(student.weekly_streak_count as number) ? Number(student.weekly_streak_count) : 0,
        lastIsoWeek: student.weekly_streak_last_iso_week ?? null,
      },
      isoWeek,
    );
    weeklyStreakCount = next.count;
  } else {
    const weeks = (weekRows ?? [])
      .map((r) => String((r as { iso_week: string }).iso_week ?? ''))
      .filter((w) => w.length > 0);
    weeklyStreakCount = computeWeeklyStreak(weeks);
  }

  // Persist the streak columns (best-effort; RLS: students_update_own).
  const { error: updateErr } = await supabase
    .from('students')
    .update({
      weekly_streak_count: weeklyStreakCount,
      weekly_streak_last_iso_week: isoWeek,
    })
    .eq('id', student.id);
  if (updateErr) {
    logger.warn('dive/artifact: streak column update failed (non-fatal)', {
      userId, error: updateErr.message,
    });
  }

  return NextResponse.json({ artifactId, weeklyStreakCount, isoWeek });
}
