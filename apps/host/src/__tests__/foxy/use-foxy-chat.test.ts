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

import { useFoxyChat, readStoredThreadId } from '@/app/foxy/_hooks/useFoxyChat';

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

/* ══════════════════════════════════════════════════════════════
   ff_foxy_durable_thread_v1 — CLIENT owns a durable conversation id.
   Fixes the "context breaks / re-type your question" bug: a rapid 2nd
   send (before the server session frame returns) or a reload must reuse
   the SAME id. All new behavior is gated by the durableThreadEnabled
   option; with it OFF the hook is byte-identical to today.
   ══════════════════════════════════════════════════════════════ */

/** Reset the URL + the durable-thread localStorage key between cases. */
function resetDurableThreadState() {
  try { window.localStorage.removeItem('foxy_thread'); } catch { /* ignore */ }
  try { window.history.replaceState(null, '', '/foxy'); } catch { /* ignore */ }
}

/** Record every fetch request body so we can assert the wire `session_id`.
 *  Echoes the sent session_id back as the server's sessionId (realistic:
 *  the durable server upserts under the client id). */
function installBodyRecordingFetch(): any[] {
  const bodies: any[] = [];
  global.fetch = vi.fn().mockImplementation((_url: string, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ response: 'Hi there!', sessionId: body.session_id ?? body.sessionId ?? null }),
      body: null,
    });
  }) as unknown as typeof fetch;
  return bodies;
}

describe('useFoxyChat — durable thread (ff_foxy_durable_thread_v1)', () => {
  beforeEach(() => {
    resetDurableThreadState();
  });

  it('OFF (default): a send never writes foxy_thread or the ?c= URL param', async () => {
    window.localStorage.setItem('alfanumrik_foxy_stream', '0'); // deterministic JSON branch
    const bodies = installBodyRecordingFetch();
    const { result } = renderHook(() => useFoxyChat()); // no options → durable OFF

    await act(async () => {
      await result.current.sendMessage(basePayload);
    });

    expect(window.localStorage.getItem('foxy_thread')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('c')).toBeNull();
    // Legacy wire shape unchanged: first send carries a null session id.
    expect(bodies[0].sessionId).toBeNull();
  });

  it('ON: two rapid sends share ONE client-minted conversation id (the race fix)', async () => {
    const bodies = installBodyRecordingFetch();
    const { result } = renderHook(() => useFoxyChat({ durableThreadEnabled: true }));

    await act(async () => {
      // Fire the 2nd send BEFORE awaiting the 1st — mirrors typing fast while a
      // long answer streams. Both must read the same synchronously-minted ref.
      const p1 = result.current.sendMessage(basePayload);
      const p2 = result.current.sendMessage(basePayload);
      await Promise.all([p1, p2]);
    });

    const ids = bodies.map((b) => b.session_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();          // a real client-minted uuid, not null
    expect(ids[1]).toBe(ids[0]);          // same id → no second/empty session
    expect(new Set(ids).size).toBe(1);
    // Persisted to BOTH stores so a reload restores the same thread.
    expect(window.localStorage.getItem('foxy_thread')).toBe(ids[0]);
    expect(new URL(window.location.href).searchParams.get('c')).toBe(ids[0]);
  });

  it('ON: after adopting a restored id, the next send reuses it (reload continuity)', async () => {
    const bodies = installBodyRecordingFetch();
    const { result } = renderHook(() => useFoxyChat({ durableThreadEnabled: true }));

    act(() => { result.current.adoptConversationId('restored-thread-123'); });
    await act(async () => { await result.current.sendMessage(basePayload); });

    expect(bodies[0].session_id).toBe('restored-thread-123');
  });

  it('readStoredThreadId prefers ?c= over localStorage, then falls back to localStorage', () => {
    window.localStorage.setItem('foxy_thread', 'ls-id');
    window.history.replaceState(null, '', '/foxy?c=url-id');
    expect(readStoredThreadId()).toBe('url-id');

    window.history.replaceState(null, '', '/foxy');
    expect(readStoredThreadId()).toBe('ls-id');

    window.localStorage.removeItem('foxy_thread');
    expect(readStoredThreadId()).toBeNull();
  });

  it('ON: adoptConversationId mirrors id to state + URL + localStorage', () => {
    const { result } = renderHook(() => useFoxyChat({ durableThreadEnabled: true }));
    act(() => { result.current.adoptConversationId('thread-xyz'); });

    expect(result.current.chatSessionId).toBe('thread-xyz');
    expect(window.localStorage.getItem('foxy_thread')).toBe('thread-xyz');
    expect(new URL(window.location.href).searchParams.get('c')).toBe('thread-xyz');
  });

  it('ON: startNewConversation mints a fresh id distinct from the previous one', () => {
    const { result } = renderHook(() => useFoxyChat({ durableThreadEnabled: true }));
    act(() => { result.current.adoptConversationId('old-id'); });
    act(() => { result.current.startNewConversation(); });

    const fresh = result.current.chatSessionId;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe('old-id');
    expect(window.localStorage.getItem('foxy_thread')).toBe(fresh);
    expect(new URL(window.location.href).searchParams.get('c')).toBe(fresh);
  });

  it('OFF: startNewConversation clears the id and touches no storage (byte-identical)', () => {
    const { result } = renderHook(() => useFoxyChat()); // durable OFF
    act(() => { result.current.setChatSessionId('sess-legacy'); });
    act(() => { result.current.startNewConversation(); });

    expect(result.current.chatSessionId).toBeNull();
    expect(window.localStorage.getItem('foxy_thread')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('c')).toBeNull();
  });
});
