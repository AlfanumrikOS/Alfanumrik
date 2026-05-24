/**
 * voice-python-client.test.ts — Cloud Run STT/TTS fetch wrapper tests.
 *
 * Mocks global fetch to exercise every error-path branch the Voice 2
 * fallback safety net depends on. The browser Web Speech path in
 * src/lib/voice.ts catches each of these errors and falls through to
 * the browser API — if any branch silently returns success instead of
 * throwing, the fallback never fires and a Cloud Run outage breaks
 * voice for every gated student.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mimeToExtension,
  PythonVoiceError,
  PYTHON_AI_BASE_URL,
  synthesizePython,
  transcribePython,
} from '@/lib/voice-python-client';

// ── helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function audioResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  // Wrap the Uint8Array in a Blob so the Response constructor accepts it
  // under the strict BodyInit DOM lib typings. The cast to BlobPart[] is
  // necessary because lib.dom requires ArrayBuffer (not ArrayBufferLike).
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/mpeg' });
  return new Response(blob, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      ...headers,
    },
  });
}

function makeBlob(bytes = new Uint8Array([1, 2, 3, 4])): Blob {
  return new Blob([bytes], { type: 'audio/webm' });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── transcribePython ───────────────────────────────────────────────────────

describe('transcribePython', () => {
  it('returns the typed envelope on a 200 response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        transcript: 'hello world',
        detected_language: 'en',
        duration_seconds: 1.2,
        audio_format: 'webm',
        cost_inr: 0.04,
        request_id: 'req-123',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await transcribePython(makeBlob(), { jwt: 'student-jwt' });

    expect(result).toEqual({
      transcript: 'hello world',
      detected_language: 'en',
      duration_seconds: 1.2,
      audio_format: 'webm',
      cost_inr: 0.04,
      request_id: 'req-123',
    });

    // Confirm we POSTed multipart with the JWT Authorization header.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${PYTHON_AI_BASE_URL}/v1/voice/transcribe`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer student-jwt');
    // Body is FormData — we don't assert internals; just confirm presence.
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('forwards a Hinglish language hint as form data', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        transcript: 'haan',
        detected_language: 'hinglish',
        duration_seconds: 0.5,
        audio_format: 'webm',
        cost_inr: 0.01,
        request_id: 'req-456',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await transcribePython(makeBlob(), { jwt: 'jwt', languageHint: 'hinglish' });

    const [, init] = fetchSpy.mock.calls[0];
    const body = (init as RequestInit).body as FormData;
    expect(body.get('language_hint')).toBe('hinglish');
  });

  it('throws PythonVoiceError with status 401 on unauthorized', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: { error: 'AUTH_FAILED', detail: 'invalid token', request_id: 'r-1' },
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    await expect(transcribePython(makeBlob(), { jwt: 'bad' })).rejects.toMatchObject({
      name: 'PythonVoiceError',
      status: 401,
      code: 'AUTH_FAILED',
      requestId: 'r-1',
    });
  });

  it('throws PythonVoiceError with status 413 on payload too large', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: { error: 'PAYLOAD_TOO_LARGE', detail: 'too big', request_id: 'r-2' },
          }),
          { status: 413, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const err = (await transcribePython(makeBlob(), { jwt: 'jwt' }).catch((e) => e)) as PythonVoiceError;
    expect(err).toBeInstanceOf(PythonVoiceError);
    expect(err.status).toBe(413);
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('throws PythonVoiceError with status 503 when service is misconfigured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: { error: 'CONFIG_ERROR', detail: 'whisper key missing', request_id: 'r-3' },
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(transcribePython(makeBlob(), { jwt: 'jwt' })).rejects.toMatchObject({
      status: 503,
      code: 'CONFIG_ERROR',
    });
  });

  it('throws PythonVoiceError with status 0 on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(transcribePython(makeBlob(), { jwt: 'jwt' })).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('throws PythonVoiceError with status 401 immediately when JWT is empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(transcribePython(makeBlob(), { jwt: '' })).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_FAILED',
    });
    // No fetch should have happened — fail-fast guard.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws AbortError when an external AbortSignal fires', async () => {
    // Use a real AbortController so the .aborted state is honoured.
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal as AbortSignal;
            // Reject immediately if already aborted (the case in this test)
            // OR reject on the abort event.
            if (signal.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    // Abort the external signal AFTER we kick off the call, so the abort
    // listener actually fires (rather than the call short-circuiting before
    // the mock fetch runs).
    const promise = transcribePython(makeBlob(), { jwt: 'jwt', signal: controller.signal });
    controller.abort();

    const err = (await promise.catch((e) => e)) as PythonVoiceError;

    expect(err).toBeInstanceOf(PythonVoiceError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('ABORTED');
  });

  it('treats malformed JSON response as PARSE_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(transcribePython(makeBlob(), { jwt: 'jwt' })).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    });
  });
});

// ── synthesizePython ───────────────────────────────────────────────────────

describe('synthesizePython', () => {
  it('returns audio blob + header metadata on a 200 response', async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        audioResponse(bytes, {
          'x-voice-used': 'en-IN-NeerjaNeural',
          'x-cost-inr': '0.02',
          'x-request-id': 'tts-req-1',
        }),
      ),
    );

    const result = await synthesizePython(
      { text: 'Hello', language: 'en', gender: 'female' },
      { jwt: 'jwt' },
    );

    expect(result.audio.size).toBeGreaterThan(0);
    expect(result.voiceUsed).toBe('en-IN-NeerjaNeural');
    expect(result.costInr).toBe(0.02);
    expect(result.requestId).toBe('tts-req-1');
  });

  it('throws PythonVoiceError with status 413 BEFORE fetch when text exceeds 2000 chars', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const longText = 'a'.repeat(2001);
    await expect(synthesizePython({ text: longText, language: 'en' }, { jwt: 'jwt' })).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws EMPTY_TEXT when text is whitespace', async () => {
    await expect(synthesizePython({ text: '   ', language: 'en' }, { jwt: 'jwt' })).rejects.toMatchObject({
      status: 400,
      code: 'EMPTY_TEXT',
    });
  });

  it('throws AUTH_FAILED with no fetch when JWT is empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(synthesizePython({ text: 'hi', language: 'en' }, { jwt: '' })).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_FAILED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws PythonVoiceError with status 503 on service misconfig', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: { error: 'CONFIG_ERROR', detail: 'azure key missing', request_id: 'tts-r-3' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(synthesizePython({ text: 'hi', language: 'en' }, { jwt: 'jwt' })).rejects.toMatchObject({
      status: 503,
      code: 'CONFIG_ERROR',
    });
  });

  it('throws EMPTY_AUDIO on a 200 with zero-byte body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(), {
          status: 200,
          headers: {
            'content-type': 'audio/mpeg',
            'x-voice-used': 'en-IN-NeerjaNeural',
          },
        }),
      ),
    );

    await expect(synthesizePython({ text: 'hi', language: 'en' }, { jwt: 'jwt' })).rejects.toMatchObject({
      status: 502,
      code: 'EMPTY_AUDIO',
    });
  });

  it('throws PythonVoiceError with status 0 on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(synthesizePython({ text: 'hi', language: 'en' }, { jwt: 'jwt' })).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('defaults gender to female when omitted', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(audioResponse(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchSpy);

    await synthesizePython({ text: 'hi', language: 'en' }, { jwt: 'jwt' });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.gender).toBe('female');
  });

  it('passes through male gender when set', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(audioResponse(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchSpy);

    await synthesizePython(
      { text: 'hi', language: 'en', gender: 'male' },
      { jwt: 'jwt' },
    );

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.gender).toBe('male');
  });
});

// ── mimeToExtension ────────────────────────────────────────────────────────

describe('mimeToExtension', () => {
  it('maps common MediaRecorder MIME types to Whisper-supported extensions', () => {
    expect(mimeToExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(mimeToExtension('audio/webm')).toBe('webm');
    expect(mimeToExtension('audio/mp4')).toBe('m4a');
    expect(mimeToExtension('audio/m4a')).toBe('m4a');
    expect(mimeToExtension('audio/mpeg')).toBe('mp3');
    expect(mimeToExtension('audio/wav')).toBe('wav');
    expect(mimeToExtension('audio/ogg')).toBe('ogg');
    expect(mimeToExtension('audio/flac')).toBe('flac');
  });

  it('falls back to webm for unknown / empty types', () => {
    expect(mimeToExtension('')).toBe('webm');
    expect(mimeToExtension('application/octet-stream')).toBe('webm');
  });
});
