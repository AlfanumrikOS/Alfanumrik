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

/**
 * DIRECTIVE ECHO — a learning-action re-send renders a COMPACT intent pill
 * (marker + bilingual label) instead of re-echoing the full prior question (the
 * "question renders twice" bug). Crucially, the server call is unchanged: the
 * /api/foxy POST still carries the FULL question so Foxy re-teaches correctly.
 */
describe('directive echo — re-send shows a compact pill, server still gets the full question', () => {
  it('appends a student bubble with the compact EN label + `directive` marker, NOT the full question', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ response: 'Simpler!', sessionId: 'sess-1', groundingStatus: 'grounded', messageId: 'msg-1' }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const FULL_Q = 'What is photosynthesis and why does it matter?';
    const { result } = renderHook(() => useFoxyChat());
    await act(async () => {
      await result.current.sendMessage({
        message: FULL_Q,
        // Mirrors the page wrapper: augmentedMessage carries the full question.
        augmentedMessage: FULL_Q,
        grade: '9',
        subject: 'science',
        language: 'en',
        mode: 'learn',
        coachDirective: 'simplify',
      });
    });

    // DISPLAY: the student bubble is the compact pill, NOT the re-echoed question.
    const studentBubble = result.current.messages.find((m) => m.role === 'student');
    expect(studentBubble, 'expected a student bubble').toBeTruthy();
    expect(studentBubble!.directive).toBe('simplify');
    expect(studentBubble!.content).toBe('🔁 Explain simpler');
    expect(studentBubble!.content).not.toContain('photosynthesis');
    // The literal "question renders twice" bug: exactly ONE student bubble is
    // appended (the pill) — never the pill PLUS a re-echoed full-question bubble.
    const studentBubbles = result.current.messages.filter((m) => m.role === 'student');
    expect(studentBubbles).toHaveLength(1);
    expect(studentBubbles.some((m) => (m.content ?? '').includes('photosynthesis'))).toBe(false);

    // SERVER: the /api/foxy POST still carries the FULL question + the directive.
    const foxyCall = fetchMock.mock.calls.find((c) => c[0] === '/api/foxy');
    expect(foxyCall, 'expected a POST to /api/foxy').toBeTruthy();
    const body = JSON.parse((foxyCall![1] as RequestInit).body as string);
    expect(body.message).toBe(FULL_Q);
    expect(body.coachDirective).toBe('simplify');
  });

  it('localizes the pill to Hindi (P7) while the server still gets the full question', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ response: 'उदाहरण', sessionId: 'sess-1', groundingStatus: 'grounded', messageId: 'msg-1' }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const FULL_Q = "Explain Newton's first law";
    const { result } = renderHook(() => useFoxyChat());
    await act(async () => {
      await result.current.sendMessage({
        message: FULL_Q,
        augmentedMessage: FULL_Q,
        grade: '9',
        subject: 'science',
        language: 'hi',
        mode: 'learn',
        coachDirective: 'example',
      });
    });

    const studentBubble = result.current.messages.find((m) => m.role === 'student');
    expect(studentBubble!.directive).toBe('example');
    expect(studentBubble!.content).toBe('📝 उदाहरण दिखाओ');

    const foxyCall = fetchMock.mock.calls.find((c) => c[0] === '/api/foxy');
    const body = JSON.parse((foxyCall![1] as RequestInit).body as string);
    expect(body.message).toBe(FULL_Q);
    expect(body.coachDirective).toBe('example');
  });

  it('a normal (non-directive) send is UNCHANGED — real user text, no directive marker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ response: 'hi', sessionId: 'sess-1', groundingStatus: 'grounded', messageId: 'msg-1' }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const TYPED = 'Why is the sky blue?';
    const { result } = renderHook(() => useFoxyChat());
    await act(async () => {
      await result.current.sendMessage({ message: TYPED, grade: '9', subject: 'science', language: 'en', mode: 'learn' });
    });

    const studentBubble = result.current.messages.find((m) => m.role === 'student');
    expect(studentBubble!.content).toBe(TYPED);
    expect(studentBubble!.directive).toBeUndefined();
  });
});
