/**
 * POST /api/foxy/voice — Text-to-Speech synthesis for Foxy messages.
 *
 * Calls the Python Cloud Run `/v1/voice/synthesize` endpoint (existing
 * Azure TTS backend). The Python service returns a base64-encoded audio
 * payload; this route decodes it and streams back audio/mpeg.
 *
 * Auth gated via `foxy.chat` permission.
 * P12 rule 4: metered against the student's daily `foxy_chat` quota (same
 * shared helper + `check_and_record_usage` RPC as /api/foxy) — no distinct
 * voice/TTS category exists in the quota authority (`get_plan_limit` knows
 * only foxy_chat/quiz/notes; any other string lands in its generous ai_total
 * ELSE arm, the exact over-promise hazard /api/usage/daily's feature
 * whitelist documents), so TTS debits the shared Foxy bucket. Guard order
 * mirrors /api/foxy: auth → ai_usage_global kill switch → validate → quota →
 * paid inference, with a best-effort refund when the upstream call fails.
 * P13: Does not persist the text — fire-and-forget to Cloud Run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { callPythonMol } from '@alfanumrik/lib/ai/clients/python-mol';
import { checkAndIncrementQuota, refundQuota } from '../_lib/quota';
import { errorJson } from '../_lib/constants';

const MAX_TEXT_LENGTH = 5000;

export async function POST(request: NextRequest) {
  // Auth gate. requireStudentId forces the students-row lookup so the quota
  // gate below can meter the caller — same option the main /api/foxy route
  // and /api/foxy/remediation use.
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const studentId = auth.studentId;
  if (!studentId) {
    // P12 rule 4 fail-closed: a caller that cannot be metered (no student
    // profile) cannot spend paid inference. Same envelope as the auth gate.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Global AI kill switch (ai_usage_global) — same switch and same envelope
  // as /api/foxy (guard order: auth → kill switch → validate → quota →
  // inference). Flip OFF in the super-admin console to halt ALL paid AI
  // calls, TTS included, without redeploying.
  if (!(await isFeatureEnabled('ai_usage_global'))) {
    logger.warn('foxy-voice: ai_usage_global kill switch active');
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: 'Foxy is temporarily unavailable. Please try again in a minute.',
        error_hi: 'Foxy abhi available nahi hai. Kripya thodi der baad try karein.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
    );
  }

  let body: { messageId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { messageId, text } = body;
  if (!messageId || typeof messageId !== 'string') {
    return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  }
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text exceeds ${MAX_TEXT_LENGTH} chars` },
      { status: 400 }
    );
  }

  // Daily-quota gate (P12 rule 4) — atomically check-and-increment the
  // student's daily `foxy_chat` usage BEFORE the paid TTS call. Placed after
  // input validation so 400 misfires never consume a unit (mirrors
  // /api/foxy's validate-then-quota order). 429 envelope is byte-identical
  // to /api/foxy's quota-exhaustion response (P7 bilingual).
  const quota = await checkAndIncrementQuota(studentId);
  if (!quota.allowed) {
    return errorJson(
      'Daily Foxy chat limit reached. Upgrade your plan or try again tomorrow.',
      'Aaj ke Foxy chats khatam ho gaye. Kal dobara try karein ya plan upgrade karein.',
      429,
      { quotaRemaining: 0 },
    );
  }

  // Extract auth token from request header for forwarding
  const authHeader = request.headers.get('Authorization');
  const authToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  try {
    // Call Python Cloud Run TTS service via the standard python-mol client.
    // The service returns a JSON response with a base64-encoded audio field.
    const responseText = await callPythonMol({
      endpointPath: '/v1/voice/synthesize',
      authToken,
      body: {
        text: text.slice(0, MAX_TEXT_LENGTH),
        language: 'hi-IN',
        voice: 'hi-IN-SwaraNeural',
      },
      timeoutMs: 15000, // TTS can be slow — 15s timeout
    });

    if (!responseText) {
      logger.warn('TTS synthesis returned null (service unavailable)', {
        messageId,
      });
      // Refund — the student got no audio for the unit consumed above.
      // Same refund-on-upstream-failure semantics as /api/foxy; best-effort,
      // never throws.
      await refundQuota(studentId, 'foxy_chat');
      return NextResponse.json(
        { error: 'Voice synthesis unavailable' },
        { status: 503 }
      );
    }

    // Parse the response — expect { audio_base64: string, format: string }
    let parsed: { audio_base64?: string; format?: string };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      logger.warn('TTS response not valid JSON', { messageId });
      await refundQuota(studentId, 'foxy_chat');
      return NextResponse.json(
        { error: 'Voice synthesis returned invalid response' },
        { status: 502 }
      );
    }

    if (!parsed.audio_base64) {
      logger.warn('TTS response missing audio_base64', { messageId });
      await refundQuota(studentId, 'foxy_chat');
      return NextResponse.json(
        { error: 'Voice synthesis returned no audio' },
        { status: 502 }
      );
    }

    // Decode base64 to binary
    const audioBytes = Buffer.from(parsed.audio_base64, 'base64');

    return new NextResponse(audioBytes, {
      status: 200,
      headers: {
        'Content-Type': parsed.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(audioBytes.length),
      },
    });
  } catch (error) {
    logger.error('TTS synthesis error', {
      messageId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    await refundQuota(studentId, 'foxy_chat');
    return NextResponse.json(
      { error: 'Voice synthesis failed' },
      { status: 500 }
    );
  }
}
