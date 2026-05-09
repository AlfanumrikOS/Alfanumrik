/**
 * Pedagogy v2 — Wave 2 Task 5a
 * POST /api/dive/artifact
 *
 * Saves the finalized artifact for the current ISO week and updates the
 * student's weekly streak token. The dive_artifacts UNIQUE (student_id,
 * iso_week) constraint enforces "one artifact per student per week" —
 * a duplicate POST in the same week returns 409 Conflict and the streak
 * is NOT re-incremented (the streak module is also idempotent on same-week
 * double completion; both layers are belt-and-suspenders).
 *
 * Body:
 *   {
 *     pickerOption: 'phenomenon' | 'weak_topic' | 'own_topic',
 *     diveTopic: string,                  // produced by /api/dive/start
 *     diveSubjects: string[],             // produced by /api/dive/start
 *     phenomenonSlug?: string | null,     // present iff pickerOption='phenomenon'
 *     title: string,
 *     keyConcepts: string[],
 *     workedExample?: string,
 *     studentVoice: string                // the "what I figured out" section
 *   }
 *
 * Returns:
 *   { artifactId: string, weeklyStreakCount: number, isoWeek: string }
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive. Returns 404 when off.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { isoWeekOf } from '@/lib/learn/weekly-dive-orchestrator';
import { applyWeeklyCompletion } from '@/lib/learn/weekly-streak';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type PickerOption = 'phenomenon' | 'weak_topic' | 'own_topic';

interface RequestBody {
  pickerOption?: PickerOption;
  diveTopic?: string;
  diveSubjects?: string[];
  phenomenonSlug?: string | null;
  title?: string;
  keyConcepts?: string[];
  workedExample?: string;
  studentVoice?: string;
}

const VALID_PICKER_OPTIONS = new Set<PickerOption>(['phenomenon', 'weak_topic', 'own_topic']);
const TITLE_MAX = 200;
const TOPIC_MAX = 200;
const KEY_CONCEPTS_MAX = 12;
const KEY_CONCEPT_MAX = 200;
const WORKED_EXAMPLE_MAX = 4000;
const STUDENT_VOICE_MAX = 4000;
const STUDENT_VOICE_MIN = 20; // a meaningful artifact has at least a sentence of student voice.

function parseStringArray(v: unknown, maxItems: number, maxLen: number): string[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length > maxItems) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed.length === 0 || trimmed.length > maxLen) return null;
    out.push(trimmed);
  }
  return out;
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

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  if (!body.pickerOption || !VALID_PICKER_OPTIONS.has(body.pickerOption)) {
    return NextResponse.json({ error: 'invalid_picker_option' }, { status: 400 });
  }
  const diveTopic = (body.diveTopic ?? '').trim();
  if (!diveTopic || diveTopic.length > TOPIC_MAX) {
    return NextResponse.json({ error: 'invalid_dive_topic' }, { status: 400 });
  }
  const diveSubjects = parseStringArray(body.diveSubjects, 8, 50);
  if (diveSubjects === null) {
    return NextResponse.json({ error: 'invalid_dive_subjects' }, { status: 400 });
  }
  const title = (body.title ?? '').trim();
  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
  }
  const keyConcepts = parseStringArray(body.keyConcepts, KEY_CONCEPTS_MAX, KEY_CONCEPT_MAX);
  if (keyConcepts === null || keyConcepts.length === 0) {
    return NextResponse.json({ error: 'invalid_key_concepts' }, { status: 400 });
  }
  const workedExample = body.workedExample !== undefined
    ? (typeof body.workedExample !== 'string' ? null : body.workedExample.trim())
    : null;
  if (workedExample !== null && workedExample.length > WORKED_EXAMPLE_MAX) {
    return NextResponse.json({ error: 'worked_example_too_long' }, { status: 400 });
  }
  const studentVoice = (body.studentVoice ?? '').trim();
  if (studentVoice.length < STUDENT_VOICE_MIN || studentVoice.length > STUDENT_VOICE_MAX) {
    return NextResponse.json({ error: 'invalid_student_voice' }, { status: 400 });
  }
  const phenomenonSlug = body.pickerOption === 'phenomenon'
    ? (typeof body.phenomenonSlug === 'string' ? body.phenomenonSlug : null)
    : null;

  // ─── Insert dive_artifacts ───────────────────────────────────────────────
  const isoWeek = isoWeekOf(new Date());
  const { data: insertedRow, error: insertErr } = await supabase
    .from('dive_artifacts')
    .insert({
      student_id: userId,
      iso_week: isoWeek,
      picker_option: body.pickerOption,
      dive_topic: diveTopic,
      dive_subjects: diveSubjects,
      phenomenon_slug: phenomenonSlug,
      title,
      key_concepts: keyConcepts,
      worked_example: workedExample,
      student_voice: studentVoice,
    })
    .select('id')
    .single();

  if (insertErr) {
    // Postgres unique_violation = '23505'. Surface as 409 Conflict and skip
    // the streak update so a re-submit doesn't double-increment.
    if ((insertErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'already_completed_this_week' }, { status: 409 });
    }
    logger.warn('dive/artifact: insert failed', { userId, isoWeek, error: insertErr.message });
    return NextResponse.json({ error: 'artifact_insert_failed' }, { status: 500 });
  }

  // ─── Update weekly streak ────────────────────────────────────────────────
  // The artifact is the source of truth for "did the student complete a dive
  // this week". The streak counter is denormalized for fast reads and visual
  // CTAs. If this update fails, the artifact is still saved (the student's
  // work is preserved) and a future request will re-derive correctness from
  // the artifacts. Hence: log on failure but do NOT 500 the user.
  const { data: studentBefore } = await supabase
    .from('students')
    .select('weekly_streak_count, weekly_streak_last_iso_week')
    .eq('id', userId)
    .maybeSingle();

  const newStreakState = applyWeeklyCompletion(
    {
      count: studentBefore?.weekly_streak_count ?? 0,
      lastIsoWeek: studentBefore?.weekly_streak_last_iso_week ?? null,
    },
    isoWeek,
  );

  const { error: streakErr } = await supabase
    .from('students')
    .update({
      weekly_streak_count: newStreakState.count,
      weekly_streak_last_iso_week: newStreakState.lastIsoWeek,
    })
    .eq('id', userId);

  if (streakErr) {
    logger.warn('dive/artifact: streak update failed (artifact saved successfully)', {
      userId, isoWeek, error: streakErr.message,
    });
    // Continue — the artifact is the source of truth.
  }

  return NextResponse.json({
    artifactId: insertedRow.id,
    weeklyStreakCount: newStreakState.count,
    isoWeek,
  });
}
