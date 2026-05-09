/**
 * Pedagogy v2 — Wave 2 Task 5a
 * POST /api/dive/start
 *
 * Validates the student's picker choice and resolves it to dive parameters
 * (topic, subjects, phenomenon slug). Stateless — no session row is
 * created here; Foxy's existing chat_sessions handle conversation state
 * via the /api/foxy explorer-mode invocation that the client makes after
 * this. The artifact-save endpoint (POST /api/dive/artifact) is the
 * commit point for the dive.
 *
 * Body:
 *   {
 *     pickerOption: 'phenomenon' | 'weak_topic' | 'own_topic',
 *     phenomenonSlug?: string,   // required when pickerOption='phenomenon'
 *     weakTopicId?: string,      // required when pickerOption='weak_topic'
 *     ownTopic?: string          // required when pickerOption='own_topic'
 *   }
 *
 * Returns:
 *   {
 *     diveTopic: string,
 *     diveSubjects: string[],
 *     phenomenonSlug: string | null
 *   }
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive. Returns 404 when off.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type PickerOption = 'phenomenon' | 'weak_topic' | 'own_topic';

interface RequestBody {
  pickerOption?: PickerOption;
  phenomenonSlug?: string;
  weakTopicId?: string;
  ownTopic?: string;
}

const VALID_PICKER_OPTIONS = new Set<PickerOption>(['phenomenon', 'weak_topic', 'own_topic']);
const OWN_TOPIC_MAX_LENGTH = 200;

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

  if (!body.pickerOption || !VALID_PICKER_OPTIONS.has(body.pickerOption)) {
    return NextResponse.json({ error: 'invalid_picker_option' }, { status: 400 });
  }

  // Resolve picker → dive parameters.
  if (body.pickerOption === 'phenomenon') {
    if (!body.phenomenonSlug) {
      return NextResponse.json({ error: 'phenomenon_slug_required' }, { status: 400 });
    }
    const { data: phen, error: phenErr } = await supabase
      .from('phenomena')
      .select('slug, title_en, subjects, is_active')
      .eq('slug', body.phenomenonSlug)
      .maybeSingle();
    if (phenErr) {
      logger.warn('dive/start: phenomenon lookup failed', { userId, slug: body.phenomenonSlug, error: phenErr.message });
      return NextResponse.json({ error: 'phenomenon_lookup_failed' }, { status: 500 });
    }
    if (!phen || !phen.is_active) {
      return NextResponse.json({ error: 'phenomenon_not_found' }, { status: 404 });
    }
    return NextResponse.json({
      diveTopic: phen.title_en,
      diveSubjects: (phen.subjects as string[]) ?? [],
      phenomenonSlug: phen.slug,
    });
  }

  if (body.pickerOption === 'weak_topic') {
    if (!body.weakTopicId) {
      return NextResponse.json({ error: 'weak_topic_id_required' }, { status: 400 });
    }
    const { data: topic, error: topicErr } = await supabase
      .from('curriculum_topics')
      .select('id, title, subject_id')
      .eq('id', body.weakTopicId)
      .maybeSingle();
    if (topicErr) {
      logger.warn('dive/start: topic lookup failed', { userId, topicId: body.weakTopicId, error: topicErr.message });
      return NextResponse.json({ error: 'topic_lookup_failed' }, { status: 500 });
    }
    if (!topic) {
      return NextResponse.json({ error: 'topic_not_found' }, { status: 404 });
    }
    // Resolve subject_id → subject code.
    const { data: subj } = await supabase
      .from('subjects')
      .select('code')
      .eq('id', topic.subject_id)
      .maybeSingle();
    return NextResponse.json({
      diveTopic: topic.title,
      diveSubjects: subj?.code ? [subj.code] : [],
      phenomenonSlug: null,
    });
  }

  // own_topic
  if (!body.ownTopic || typeof body.ownTopic !== 'string') {
    return NextResponse.json({ error: 'own_topic_required' }, { status: 400 });
  }
  const trimmed = body.ownTopic.trim();
  if (trimmed.length === 0) {
    return NextResponse.json({ error: 'own_topic_empty' }, { status: 400 });
  }
  if (trimmed.length > OWN_TOPIC_MAX_LENGTH) {
    return NextResponse.json({ error: 'own_topic_too_long' }, { status: 400 });
  }
  return NextResponse.json({
    diveTopic: trimmed,
    diveSubjects: [],
    phenomenonSlug: null,
  });
}
