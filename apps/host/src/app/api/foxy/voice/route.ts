/**
 * POST /api/foxy/voice — Text-to-Speech synthesis for Foxy messages.
 *
 * Calls the Python Cloud Run `/v1/voice/synthesize` endpoint (existing
 * Azure TTS backend). The Python service returns a base64-encoded audio
 * payload; this route decodes it and streams back audio/mpeg.
 *
 * Auth gated via `foxy.chat` permission.
 * P13: Does not persist the text — fire-and-forget to Cloud Run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { callPythonMol } from '@alfanumrik/lib/ai/clients/python-mol';

const MAX_TEXT_LENGTH = 5000;

export async function POST(request: NextRequest) {
  // Auth gate
  const auth = await authorizeRequest(request, 'foxy.chat');
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      return NextResponse.json(
        { error: 'Voice synthesis returned invalid response' },
        { status: 502 }
      );
    }

    if (!parsed.audio_base64) {
      logger.warn('TTS response missing audio_base64', { messageId });
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
    return NextResponse.json(
      { error: 'Voice synthesis failed' },
      { status: 500 }
    );
  }
}
