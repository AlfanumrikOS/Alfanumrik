/**
 * useFoxyChat — hook unit tests.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 3.3: write tests for the extracted hook
 *
 * The hook owns: messages state, chatSessionId state, loading flag,
 * the monotonic nextMessageId counter, and the sendMessage orchestration
 * across the SSE-streaming and JSON-fallback branches. We assert the
 * narrow public-API surface (initial state, message append shape,
 * error swallow) — the deep streaming protocol is exercised by the
 * existing integration tests under src/__tests__/foxy/.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// supabase auth.getSession() must not throw — the hook calls it before
// every fetch to derive the bearer token. Stub a stable session so
// neither branch of the streaming code crashes.
vi.mock('@/lib/supabase', () => ({
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

const basePayload = {
  message: 'Hi Foxy',
  grade: '9',
  subject: 'science',
  language: 'en',
  mode: 'learn',
};

beforeEach(() => {
  // Default: server returns a clean JSON response (i.e. content-type
  // does NOT include text/event-stream so the streaming branch falls
  // through to the JSON path inside callFoxyTutorStream).
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      response: 'Hello there!',
      sessionId: 'sess-1',
      groundingStatus: 'grounded',
      groundedFromChunks: true,
      citationsCount: 2,
      messageId: 'msg-1',
    }),
    body: null,
  }) as unknown as typeof fetch;
  // Some code paths in the hook check window.localStorage indirectly via
  // shouldUseStreaming(). JSDOM provides a real localStorage; clear any
  // residue so our default = streaming-on.
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('alfanumrik_foxy_stream'); } catch { /* ignore */ }
  }
});

describe('useFoxyChat', () => {
  it('starts with empty messages, null sessionId, and loading=false', () => {
    const { result } = renderHook(() => useFoxyChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.chatSessionId).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.xpGained).toBe(0);
    expect(typeof result.current.nextMessageId).toBe('function');
    expect(typeof result.current.sendMessage).toBe('function');
  });

  it('appends a student message immediately when sendMessage is called with text', async () => {
    const { result } = renderHook(() => useFoxyChat());

    await act(async () => {
      // Force-disable streaming by setting the localStorage opt-out so we hit
      // the deterministic JSON path. (Avoids racing the stream-vs-json branch
      // detection in JSDOM where the fetch mock sometimes resolves before
      // shouldUseStreaming() reads localStorage.)
      window.localStorage.setItem('alfanumrik_foxy_stream', '0');
      await result.current.sendMessage(basePayload);
    });

    // After the round-trip we should see at least the student message + a
    // tutor reply pushed by the JSON branch.
    const studentMsgs = result.current.messages.filter((m) => m.role === 'student');
    expect(studentMsgs.length).toBeGreaterThanOrEqual(1);
    expect(studentMsgs[0].content).toBe('Hi Foxy');
  });

  it('captures errors via onComplete callback when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const { result } = renderHook(() => useFoxyChat());
    const onComplete = vi.fn();

    await act(async () => {
      // Force JSON branch
      window.localStorage.setItem('alfanumrik_foxy_stream', '0');
      await result.current.sendMessage(basePayload, { onComplete });
    });

    // The hook's catch-block adds a friendly fallback tutor message and
    // still resolves cleanly — the error is swallowed but onComplete fires.
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
    expect(result.current.loading).toBe(false);
    // Should have at least the student message + the fallback tutor reply.
    const tutorMsgs = result.current.messages.filter((m) => m.role === 'tutor');
    expect(tutorMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects empty messages without an image (no state change)', async () => {
    const { result } = renderHook(() => useFoxyChat());

    await act(async () => {
      await result.current.sendMessage({ ...basePayload, message: '   ' });
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('clearMessages resets messages, sessionId, and xpGained', () => {
    const { result } = renderHook(() => useFoxyChat());
    act(() => {
      result.current.setMessages([
        { id: 1, role: 'student', content: 'x', timestamp: new Date().toISOString() },
      ]);
      result.current.setChatSessionId('sess-X');
      result.current.setXpGained(50);
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.chatSessionId).toBe('sess-X');
    expect(result.current.xpGained).toBe(50);

    act(() => {
      result.current.clearMessages();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.chatSessionId).toBeNull();
    expect(result.current.xpGained).toBe(0);
  });
});
