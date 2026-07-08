import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * GUARD #8 (hook half) — useFoxyChat.recordLearningAction + quiz_me forces the
 * non-streaming (blocking JSON) branch.
 *
 *   1. recordLearningAction POSTs to /api/foxy/learning-action with the right
 *      body (messageId + actionType + optional ids), Bearer auth, credentials.
 *   2. recordLearningAction is best-effort: returns false on a non-ok response
 *      and never throws on a network error.
 *   3. A quiz_me coachDirective forces the blocking JSON path — the /api/foxy
 *      POST does NOT carry stream:true (so the oracle-gated MCQ JSON is never
 *      lost to an SSE stream).
 */

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
        error: null,
      })),
    },
  },
}));

import { useFoxyChat } from '@/app/foxy/_hooks/useFoxyChat';

function jsonOk(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    body: null,
  } as unknown as Response;
}

const MESSAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('alfanumrik_foxy_stream'); } catch { /* ignore */ }
  }
});

describe('GUARD #8 — recordLearningAction telemetry POST', () => {
  it('POSTs the right body to /api/foxy/learning-action and returns true on ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ success: true, data: { recorded: true } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useFoxyChat());
    let ok = false;
    await act(async () => {
      ok = await result.current.recordLearningAction({
        messageId: MESSAGE_ID,
        actionType: 'got_it',
        sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        subjectCode: 'science',
        chapterNumber: 4,
      });
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/foxy/learning-action');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    const body = JSON.parse(init.body as string);
    expect(body.messageId).toBe(MESSAGE_ID);
    expect(body.actionType).toBe('got_it');
    expect(body.sessionId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(body.subjectCode).toBe('science');
    expect(body.chapterNumber).toBe(4);
  });

  it('omits optional fields that are not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ success: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() => useFoxyChat());
    await act(async () => {
      await result.current.recordLearningAction({ messageId: MESSAGE_ID, actionType: 'quiz_me' });
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ messageId: MESSAGE_ID, actionType: 'quiz_me' });
  });

  it('returns false on a non-ok response (best-effort, never blocks the UI)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const { result } = renderHook(() => useFoxyChat());
    let ok = true;
    await act(async () => {
      ok = await result.current.recordLearningAction({ messageId: MESSAGE_ID, actionType: 'save' });
    });
    expect(ok).toBe(false);
  });

  it('returns false on a network error (never throws)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const { result } = renderHook(() => useFoxyChat());
    let ok = true;
    await act(async () => {
      ok = await result.current.recordLearningAction({ messageId: MESSAGE_ID, actionType: 'save' });
    });
    expect(ok).toBe(false);
  });

  it('returns false immediately when messageId is missing (no fetch)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() => useFoxyChat());
    let ok = true;
    await act(async () => {
      // @ts-expect-error — exercising the defensive guard with a missing id
      ok = await result.current.recordLearningAction({ actionType: 'got_it' });
    });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GUARD #8 — quiz_me coachDirective forces the blocking JSON branch', () => {
  it('a quiz_me sendMessage POSTs to /api/foxy WITHOUT stream:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ response: 'Q?', sessionId: 'sess-1', groundingStatus: 'grounded', messageId: 'msg-1' }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useFoxyChat());
    await act(async () => {
      await result.current.sendMessage(
        { message: 'Quiz me', grade: '9', subject: 'science', language: 'en', mode: 'practice', coachDirective: 'quiz_me' },
      );
    });

    // The /api/foxy call (not the learning-action call) must be the JSON branch.
    const foxyCall = fetchMock.mock.calls.find((c) => c[0] === '/api/foxy');
    expect(foxyCall, 'expected a POST to /api/foxy').toBeTruthy();
    const body = JSON.parse((foxyCall![1] as RequestInit).body as string);
    expect(body.coachDirective).toBe('quiz_me');
    // Blocking branch: stream is never set to true (SSE would lose the MCQ JSON).
    expect(body.stream).not.toBe(true);
  });

  it('a normal (non-quiz_me) streaming send DOES carry stream:true (positive control)', async () => {
    // Force streaming on.
    if (typeof window !== 'undefined') window.localStorage.setItem('alfanumrik_foxy_stream', '1');
    const fetchMock = vi.fn().mockResolvedValue(
      // Return JSON so callFoxyTutorStream's content-type check falls through cleanly.
      jsonOk({ response: 'hi', sessionId: 'sess-1', groundingStatus: 'grounded', messageId: 'msg-1' }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useFoxyChat());
    await act(async () => {
      await result.current.sendMessage({ message: 'Hi', grade: '9', subject: 'science', language: 'en', mode: 'learn' });
    });

    const foxyCall = fetchMock.mock.calls.find((c) => c[0] === '/api/foxy');
    expect(foxyCall).toBeTruthy();
    const body = JSON.parse((foxyCall![1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    if (typeof window !== 'undefined') window.localStorage.removeItem('alfanumrik_foxy_stream');
  });
});
