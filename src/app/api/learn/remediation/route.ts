/**
 * Pedagogy v2 — Wave 1
 * GET /api/learn/remediation?questionId=...&distractorIndex=...
 *
 * Returns the curated remediation row from wrong_answer_remediations for
 * a (question, distractor) pair when ff_distractor_micro_explainer_v1 is on.
 * Returns null body (HTTP 200) when the flag is off OR no row exists for the
 * pair — the client renders nothing, falling back to legacy generic feedback.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@/lib/feature-flags';
import { lookupRemediation } from '@/lib/learn/wrong-answer-remediation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const questionId = searchParams.get('questionId');
  const distractorRaw = searchParams.get('distractorIndex');

  if (!questionId || distractorRaw === null) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const distractorIndex = parseInt(distractorRaw, 10);
  if (!Number.isInteger(distractorIndex) || distractorIndex < 0 || distractorIndex > 3) {
    return NextResponse.json({ error: 'invalid_distractor_index' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.DISTRACTOR_MICRO_EXPLAINER_V1, {
    userId: user.id,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json(null, { status: 200 });
  }

  const remediation = await lookupRemediation(supabase, questionId, distractorIndex);
  return NextResponse.json(remediation, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
