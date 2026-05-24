/**
 * Pedagogy v2 — Wave 2 Task 5b (backend glue)
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
 *     title: string,            // non-empty
 *     keyConcepts: unknown[],
 *     workedExample?: string,   // optional
 *     studentVoice: string,     // non-empty
 *   }
 *
 * Response:
 *   200 { artifactId: string, weeklyStreakCount: number, isoWeek: string }
 *   409 { error: 'already_saved_this_week' }   (UNIQUE student_id+iso_week)
 *   400 { error: '<validation_code>' }
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive — 404 when off (mirrors
 * /api/dive/state + /api/dive/history). The streak count is recomputed from
 * the durable dive_artifacts history using the SAME algorithm as
 * /api/dive/state, so the value returned here matches what the page reads back
 * on its next state fetch.
 *
 * RLS: uses the user-bound supabase client. dive_artifacts INSERT/SELECT is
 * restricted to the caller's own rows by RLS. student_id is written as the
 * SURROGATE students.id (random uuid; distinct from the auth uid), resolved
 * via auth_user_id — the established convention shared with /api/dive/state
 * and /api/dive/history (all key students / dive_artifacts off the surrogate,
 * NOT the auth uid). This is what the RLS policy `student_id IN (SELECT id
 * FROM students WHERE auth_user_id = auth.uid())` requires, so an artifact
 * saved here is found by /api/dive/state's surrogate-keyed read. No
 * service-role bypass.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.2
 * Plan: docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-2-weekly-dive.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { isoWeekOf, type DivePickerOption } from '@/lib/learn/weekly-dive-orchestrator';
import { computeWeeklyStreakFromHistory } from '@/lib/learn/weekly-streak';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const KEY_CONCEPTS_MAX = 12;
const PICKER_OPTIONS: DivePickerOption[] = ['phenomenon', 'weak_topic', 'own_topic'];

function isPickerOption(value: unknown): value is DivePickerOption {
  return typeof value === 'string' && (PICKER_OPTIONS as string[]).includes(value);
}

interface ParsedArtifact {
  pickerOption: DivePickerOption;
  diveTopic: string;
  diveSubjects: string[];
  phenomenonSlug: string | null;
  title: string;
  keyConcepts: string[];
  workedExample: string | null;
  studentVoice: string;
}

/** Validate the composer payload. Returns the parsed artifact or an error code (400). */
function parseArtifact(raw: unknown): { ok: true; value: ParsedArtifact } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_body' };
  const b = raw as Record<string, unknown>;

  if (!isPickerOption(b.pickerOption)) {
    return { ok: false, error: 'invalid_picker_option' };
  }
  const pickerOption = b.pickerOption;

  const diveTopic = typeof b.diveTopic === 'string' ? b.diveTopic.trim().slice(0, TITLE_MAX) : '';

  const diveSubjects = Array.isArray(b.diveSubjects)
    ? b.diveSubjects
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : [];

  // phenomenon_slug is only meaningful for phenomenon dives.
  const rawSlug =
    typeof b.phenomenonSlug === 'string' && b.phenomenonSlug.trim().length > 0
      ? b.phenomenonSlug.trim()
      : null;
  const phenomenonSlug = pickerOption === 'phenomenon' ? rawSlug : null;

  const title = typeof b.title === 'string' ? b.title.trim().slice(0, TITLE_MAX) : '';
  if (title.length === 0) return { ok: false, error: 'missing_title' };

  const keyConcepts = (Array.isArray(b.keyConcepts) ? b.keyConcepts : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, KEY_CONCEPTS_MAX);

  const workedExample =
    typeof b.workedExample === 'string' && b.workedExample.trim().length > 0
      ? b.workedExample.trim().slice(0, TEXT_MAX)
      : null;

  const studentVoice = typeof b.studentVoice === 'string' ? b.studentVoice.trim().slice(0, TEXT_MAX) : '';
  if (studentVoice.length === 0) return { ok: false, error: 'missing_student_voice' };

  return {
    ok: true,
    value: { pickerOption, diveTopic, diveSubjects, phenomenonSlug, title, keyConcepts, workedExample, studentVoice },
  };
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

  // Resolve the surrogate students.id (random uuid; distinct from the auth
  // uid). dive_artifacts.student_id references this surrogate — the RLS
  // policy is `student_id IN (SELECT id FROM students WHERE auth_user_id =
  // auth.uid())`, so writing the auth uid would be rejected by WITH CHECK and
  // would never be found by /api/dive/state's surrogate-keyed read. Same
  // resolution pattern as /api/dive/state + src/lib/supabase.ts.
  let studentDbId: string | null = null;
  {
    const { data: studentRow, error: studentErr } = await supabase
      .from('students')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (studentErr) {
      logger.warn('dive/artifact: students fetch failed', { userId, error: studentErr.message });
    }
    if (studentRow) studentDbId = (studentRow as { id: string }).id ?? null;
  }
  if (!studentDbId) {
    // No student profile → nothing to attach the artifact to. The RLS insert
    // would fail anyway. Surface a clean error rather than a raw 500.
    return NextResponse.json({ error: 'student_profile_not_found' }, { status: 404 });
  }

  const isoWeek = isoWeekOf(new Date());

  // Insert the artifact. student_id is the surrogate students.id (resolved
  // above) — the id /api/dive/state reads dive_artifacts by. RLS
  // (dive_artifacts_self_insert) confirms ownership. The UNIQUE(student_id,
  // iso_week) constraint enforces one artifact per ISO week; a duplicate
  // surfaces as Postgres error 23505 → 409.
  const { data: inserted, error: insertErr } = await supabase
    .from('dive_artifacts')
    .insert({
      student_id: studentDbId,
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

  // ── Recompute the weekly streak from the durable dive_artifacts history,
  //    reusing the SAME algorithm as /api/dive/state (deterministic +
  //    idempotent). On a read error we degrade to 1 — this row was just saved,
  //    so the streak is at least 1 — rather than failing the request.
  let weeklyStreakCount = 1;
  {
    const { data: weekRows, error: weekErr } = await supabase
      .from('dive_artifacts')
      .select('iso_week')
      .eq('student_id', studentDbId)
      .order('iso_week', { ascending: false })
      .limit(120);
    if (weekErr) {
      logger.warn('dive/artifact: streak history fetch failed (degrading)', {
        userId, error: weekErr.message,
      });
    } else {
      const weeks = (weekRows ?? [])
        .map((r) => String((r as { iso_week: string }).iso_week ?? ''))
        .filter((w) => w.length > 0);
      weeklyStreakCount = computeWeeklyStreakFromHistory(weeks);
    }
  }

  return NextResponse.json({ artifactId, weeklyStreakCount, isoWeek });
}
