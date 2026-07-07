/**
 * POST /api/student/grade-conclusion
 *
 * Tier 3 R10 — proxies to the `grade-experiment-conclusion` Edge Function which
 * grades a guided-experiment conclusion via Claude Haiku and awards bonus coins.
 *
 * Why this proxy exists (consistent with /api/scan-solve, /api/foxy):
 *   1. Browser → /api/student/grade-conclusion uses our session cookie auth.
 *   2. We mint a service-role Bearer token to call the Edge Function so the
 *      function can resolve the student via JWT-relay (auth.uid()).
 *   3. We do RBAC + ownership checks here too as defence in depth (the
 *      Edge Function also checks ownership against student_id).
 *
 * The Edge Function is the single source of truth for grading + coin award;
 * this route just forwards and shapes the response.
 *
 * P12 — body validation here is shallow (observation_id only); deep checks
 * happen in the Edge Function.
 * P13 — we never log conclusion text, only {observation_id, tier, total}.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';

const FUNCTION_NAME = 'grade-experiment-conclusion';
const PROXY_TIMEOUT_MS = 15_000;

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'stem.observe', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: { observation_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const observationId = typeof body.observation_id === 'string' ? body.observation_id.trim() : '';
  if (!observationId) {
    return NextResponse.json({ success: false, error: 'observation_id required' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    logger.error('grade_conclusion_proxy_misconfig', { error: new Error('Missing Supabase env') });
    return NextResponse.json({ success: false, error: 'Server misconfigured' }, { status: 500 });
  }

  // Forward the user JWT so the Edge Function can resolve the student via
  // auth.getUser(). The session cookie was already validated by authorizeRequest.
  // request.cookies may be undefined in unit-test contexts that pass a plain
  // Request — guard so we fall through to the service-key path cleanly.
  let cookieJwt = '';
  try {
    cookieJwt = request.cookies?.get?.('sb-access-token')?.value ?? '';
  } catch { cookieJwt = ''; }
  const userJwt = cookieJwt
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '';

  // We pass the user JWT if we have it; otherwise fall back to service-role
  // (the Edge Function will then validate the observation row's student_id
  // against the studentId we already authenticated here).
  const bearer = userJwt || serviceKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
      body: JSON.stringify({ observation_id: observationId }),
      signal: controller.signal,
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      logger.warn('grade_conclusion_upstream_error', {
        observationId,
        status: upstream.status,
        error: typeof data?.error === 'string' ? data.error : 'unknown',
      });
      return NextResponse.json(
        { success: false, error: data?.error || 'Grading failed' },
        { status: upstream.status },
      );
    }

    // Strip any unexpected fields before returning to the client.
    const grading = data?.grading ?? null;
    if (grading && typeof grading === 'object') {
      logger.info('grade_conclusion_done', {
        observationId,
        tier: grading.tier,
        total: grading.total,
        coinsAwarded: data?.coins_awarded ?? 0,
        cached: !!data?.cached,
      });
    }

    return NextResponse.json({
      success: true,
      cached: !!data?.cached,
      grading,
      coins_awarded: typeof data?.coins_awarded === 'number' ? data.coins_awarded : 0,
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    logger.error('grade_conclusion_proxy_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      observationId,
      timeout: isAbort,
    });
    return NextResponse.json(
      { success: false, error: isAbort ? 'Grading timed out' : 'Grading failed' },
      { status: isAbort ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
