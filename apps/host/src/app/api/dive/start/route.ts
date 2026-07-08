/**
 * Pedagogy v2 — Wave 2 Task 5 (backend glue)
 * POST /api/dive/start
 *
 * Resolves the student's chosen picker option into the concrete dive topic +
 * subjects the /dive surface needs to launch the Foxy explorer chat and seed
 * the artifact composer. Does NOT write anything — the dive is only persisted
 * when the artifact is saved via POST /api/dive/artifact.
 *
 * Request body (one of):
 *   { pickerOption: 'phenomenon', phenomenonSlug: string }
 *   { pickerOption: 'weak_topic',  weakTopicId: string }
 *   { pickerOption: 'own_topic',   ownTopic: string }
 *
 * Response shape (matches the /dive page's ResolvedDive minus pickerOption):
 *   { diveTopic: string, diveSubjects: string[], phenomenonSlug: string | null }
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive — 404 when off (matches
 * /api/dive/history + /api/dive/state). Malformed payload → 400.
 *
 * weak_topic is resolved against the SAME source the picker was populated from
 * (get_due_reviews — a SECURITY DEFINER RPC scoped by p_student_id), so the id
 * is guaranteed resolvable for a legitimate picker submit. On RPC error / no
 * match we degrade to a generic non-empty label rather than 500 — the dive must
 * always be able to start.
 *
 * RLS: user-bound supabase client. phenomena is authenticated-readable;
 * get_due_reviews is SECURITY DEFINER scoped by p_student_id. No service-role.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

export const dynamic = 'force-dynamic';

const OWN_TOPIC_MAX_LEN = 200;
const WEAK_TOPIC_RPC_LIMIT = 50;
/** Generic non-empty label used when a weak_topic id can't be resolved. */
const WEAK_TOPIC_FALLBACK_LABEL = 'Review topic';

interface ResolvedDive {
  diveTopic: string;
  diveSubjects: string[];
  phenomenonSlug: string | null;
}

type StartBody =
  | { pickerOption: 'phenomenon'; phenomenonSlug: string }
  | { pickerOption: 'weak_topic'; weakTopicId: string }
  | { pickerOption: 'own_topic'; ownTopic: string };

function parseBody(raw: unknown): StartBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.pickerOption === 'phenomenon') {
    if (typeof b.phenomenonSlug === 'string' && b.phenomenonSlug.trim().length > 0) {
      return { pickerOption: 'phenomenon', phenomenonSlug: b.phenomenonSlug.trim() };
    }
    return null;
  }
  if (b.pickerOption === 'weak_topic') {
    if (typeof b.weakTopicId === 'string' && b.weakTopicId.trim().length > 0) {
      return { pickerOption: 'weak_topic', weakTopicId: b.weakTopicId.trim() };
    }
    return null;
  }
  if (b.pickerOption === 'own_topic') {
    if (typeof b.ownTopic === 'string' && b.ownTopic.trim().length > 0) {
      return { pickerOption: 'own_topic', ownTopic: b.ownTopic.trim().slice(0, OWN_TOPIC_MAX_LEN) };
    }
    return null;
  }
  return null;
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
  const body = parseBody(rawBody);
  if (!body) {
    return NextResponse.json({ error: 'invalid_picker_payload' }, { status: 400 });
  }

  // ── own_topic: the topic is exactly what the student typed. Subjects are
  //    intentionally empty (the /dive surface renders "open exploration").
  if (body.pickerOption === 'own_topic') {
    const resolved: ResolvedDive = {
      diveTopic: body.ownTopic,
      diveSubjects: [],
      phenomenonSlug: null,
    };
    return NextResponse.json(resolved);
  }

  // ── phenomenon: resolve title + subjects from the curated catalog.
  //    Not found (inactive or unknown slug) → 404.
  if (body.pickerOption === 'phenomenon') {
    const { data: phenomenonRow, error: phenomenonErr } = await supabase
      .from('phenomena')
      .select('slug, title_en, subjects')
      .eq('slug', body.phenomenonSlug)
      .eq('is_active', true)
      .maybeSingle();
    if (phenomenonErr) {
      logger.warn('dive/start: phenomenon fetch failed', { userId, error: phenomenonErr.message });
      return NextResponse.json({ error: 'phenomenon_not_found' }, { status: 404 });
    }
    if (!phenomenonRow) {
      return NextResponse.json({ error: 'phenomenon_not_found' }, { status: 404 });
    }
    const p = phenomenonRow as { slug: string; title_en: string; subjects: string[] | null };
    const resolved: ResolvedDive = {
      diveTopic: p.title_en,
      diveSubjects: p.subjects ?? [],
      phenomenonSlug: p.slug,
    };
    return NextResponse.json(resolved);
  }

  // ── weak_topic: resolve against the same get_due_reviews source the picker
  //    was populated from. Find the row whose topic_id matches the chosen id.
  //    Any error / no match degrades to a generic label — NEVER 500, so a
  //    legitimately-picked weak topic always launches the dive.
  let diveTopic = WEAK_TOPIC_FALLBACK_LABEL;
  let diveSubjects: string[] = [];
  {
    // Resolve the surrogate students.id (random uuid; distinct from the auth
    // uid). get_due_reviews keys on the surrogate — same convention as every
    // other student-scoped table/RPC (see /api/dive/state + src/lib/supabase.ts).
    // A missing student row degrades the resolution to the generic fallback
    // label rather than 500 — the dive must always be able to start.
    let studentDbId: string | null = null;
    {
      const { data: studentRow, error: studentErr } = await supabase
        .from('students')
        .select('id')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (studentErr) {
        logger.warn('dive/start: students fetch failed (degrading)', {
          userId, error: studentErr.message,
        });
      }
      if (studentRow) studentDbId = (studentRow as { id: string }).id ?? null;
    }
    const { data: dueRows, error: dueErr } = studentDbId
      ? await supabase.rpc('get_due_reviews', {
          p_student_id: studentDbId,
          p_subject_code: null,
          p_limit: WEAK_TOPIC_RPC_LIMIT,
        })
      : { data: null, error: null };
    if (dueErr) {
      logger.warn('dive/start: get_due_reviews RPC failed (degrading)', {
        userId, error: dueErr.message,
      });
    }
    const match = ((dueRows ?? []) as Record<string, unknown>[]).find(
      (r) => String(r.topic_id ?? '') === body.weakTopicId,
    );
    if (match) {
      const title = typeof match.title === 'string' ? match.title.trim() : '';
      diveTopic = title.length > 0 ? title : body.weakTopicId;
      // Best-effort subject: prefer subject_code, fall back to subject.
      const subjectCode =
        typeof match.subject_code === 'string' && match.subject_code.length > 0
          ? match.subject_code
          : typeof match.subject === 'string' && match.subject.length > 0
            ? match.subject
            : null;
      diveSubjects = subjectCode ? [subjectCode] : [];
    } else {
      // No match (RPC errored, or the topic aged out of the due window). Use the
      // raw id as a non-empty label so the dive can still proceed.
      diveTopic = body.weakTopicId;
    }
  }

  const resolved: ResolvedDive = { diveTopic, diveSubjects, phenomenonSlug: null };
  return NextResponse.json(resolved);
}
