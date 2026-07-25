/**
 * useStudyArtifacts — the open/close/regenerate state owner behind the two
 * GenAI study-tool sheets in /foxy.
 *
 * Three behaviours are load-bearing and pinned here:
 *
 *  1. PER-CONTEXT CACHE. A settled result is reused for the SAME
 *     subject+chapter+language key, so re-opening a sheet does not re-spend an
 *     LLM call. A change to ANY of the three key parts re-fetches.
 *  2. STALE-RESPONSE GUARD. A slow first request that resolves AFTER a newer
 *     one must be DROPPED — a student who switches chapter mid-flight can
 *     never be shown the previous chapter's artifact.
 *  3. REGENERATE bypasses the cache (explicit, student-initiated refresh) and
 *     is the retry path for a failed attempt.
 *
 * Everything runs through the injectable `fetchImpl` / `getAccessToken` seams.
 *
 * Owning agent: testing. Under test: frontend (hook).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

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

import { useStudyArtifacts } from '@/app/foxy/_hooks/useStudyArtifacts';
import type { ArtifactContext } from '@/app/foxy/_lib/study-artifacts';

const CTX_A: ArtifactContext = {
  subject: 'science',
  chapterNumber: 3,
  chapterTitle: 'Atoms and Molecules',
  language: 'en',
};
const CTX_B: ArtifactContext = { ...CTX_A, chapterNumber: 4, chapterTitle: 'Structure of the Atom' };
const CTX_A_HI: ArtifactContext = { ...CTX_A, language: 'hi' };
const CTX_OTHER_SUBJECT: ArtifactContext = { ...CTX_A, subject: 'math' };

function diagramData(titleEn: string) {
  return {
    abstained: false,
    mermaidCode: 'flowchart TD\n  A --> B',
    diagramKind: 'flowchart',
    titleEn,
    titleHi: titleEn,
    captionEn: '',
    captionHi: '',
    citations: [],
    meta: {},
  };
}

/** A fetch stub whose responses are resolved MANUALLY, one call at a time. */
function deferredFetch() {
  const calls: Array<{
    url: string;
    init: RequestInit;
    settle: (status: number, body: unknown) => void;
  }> = [];
  const impl = vi.fn((url: string, init: RequestInit) => {
    return new Promise<Response>((resolve) => {
      calls.push({
        url,
        init,
        settle: (status, body) =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
          } as unknown as Response),
      });
    });
  });
  return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

function deps(fetchImpl: typeof fetch) {
  return { fetchImpl, getAccessToken: async () => 'tok' };
}

let fetcher: ReturnType<typeof deferredFetch>;

beforeEach(() => {
  fetcher = deferredFetch();
});

/** Drain the microtask queue (the fetchers await a token before calling fetch). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run a hook action and let its async transport work settle. */
async function step(fn: () => void) {
  await act(async () => {
    fn();
    await flush();
  });
}

async function settle(index: number, status: number, body: unknown) {
  await act(async () => {
    fetcher.calls[index].settle(status, body);
    await flush();
  });
}

// ── 1. Initial state ─────────────────────────────────────────────────────────

describe('Foxy useStudyArtifacts — initial state', () => {
  it('starts closed and idle with no fetch', () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    expect(result.current.openKind).toBeNull();
    expect(result.current.diagram).toEqual({ status: 'idle' });
    expect(result.current.lesson).toEqual({ status: 'idle' });
    expect(fetcher.mock).not.toHaveBeenCalled();
  });
});

// ── 2. Open / fetch / settle ─────────────────────────────────────────────────

describe('Foxy useStudyArtifacts — open and settle', () => {
  it('opens the diagram sheet, goes loading, then ready', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    expect(result.current.openKind).toBe('diagram');
    expect(result.current.diagram.status).toBe('loading');
    expect(fetcher.mock).toHaveBeenCalledTimes(1);
    expect(fetcher.calls[0].url).toBe('/api/content/diagram');

    await settle(0, 200, { success: true, data: diagramData('A') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));
  });

  it('routes the lesson sheet to the GET /api/lesson endpoint', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('lesson', CTX_A));
    expect(result.current.openKind).toBe('lesson');
    expect(fetcher.calls[0].url.startsWith('/api/lesson?')).toBe(true);
    expect(fetcher.calls[0].init.method).toBe('GET');
  });

  it('keeps the two artifacts independent (opening lesson leaves diagram idle)', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('lesson', CTX_A));
    expect(result.current.diagram).toEqual({ status: 'idle' });
  });

  it('close() hides the sheet but keeps the settled result', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: diagramData('A') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));
    await step(() => result.current.close());
    expect(result.current.openKind).toBeNull();
    expect(result.current.diagram.status).toBe('ready');
  });

  it('surfaces an abstain as the calm abstained state, not an error', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, {
      success: true,
      data: { abstained: true, abstain: { messageEn: 'no grounding', messageHi: 'नहीं' } },
    });
    await waitFor(() => expect(result.current.diagram.status).toBe('abstained'));
  });
});

// ── 3. Per subject+chapter+language cache ────────────────────────────────────

describe('Foxy useStudyArtifacts — per subject+chapter+language cache', () => {
  it('does NOT re-fetch when the same context is re-opened', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: diagramData('A') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await step(() => result.current.close());
    await step(() => result.current.open('diagram', CTX_A));

    expect(fetcher.mock).toHaveBeenCalledTimes(1);
    expect(result.current.diagram.status).toBe('ready');
  });

  it('re-fetches when the CHAPTER changes', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: diagramData('A') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await step(() => result.current.open('diagram', CTX_B));
    expect(fetcher.mock).toHaveBeenCalledTimes(2);
    expect(result.current.diagram.status).toBe('loading');
  });

  it('re-fetches when the LANGUAGE changes', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: diagramData('A') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await step(() => result.current.open('diagram', CTX_A_HI));
    expect(fetcher.mock).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when the SUBJECT changes', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: diagramData('A') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await step(() => result.current.open('diagram', CTX_OTHER_SUBJECT));
    expect(fetcher.mock).toHaveBeenCalledTimes(2);
  });

  it('does NOT start a second request while the same context is still loading', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await step(() => result.current.open('diagram', CTX_A));
    await step(() => result.current.open('diagram', CTX_A));
    expect(fetcher.mock).toHaveBeenCalledTimes(1);
  });

  it('caches an ABSTAIN too (a settled result, not a retryable failure)', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: { abstained: true } });
    await waitFor(() => expect(result.current.diagram.status).toBe('abstained'));

    await step(() => result.current.close());
    await step(() => result.current.open('diagram', CTX_A));
    expect(fetcher.mock).toHaveBeenCalledTimes(1);
  });

  it('RE-RUNS a previously failed context on re-open (errors are not cached)', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 500, {});
    await waitFor(() => expect(result.current.diagram.status).toBe('error'));

    await step(() => result.current.close());
    await step(() => result.current.open('diagram', CTX_A));
    expect(fetcher.mock).toHaveBeenCalledTimes(2);
  });
});

// ── 4. Stale-response guard ──────────────────────────────────────────────────

describe('Foxy useStudyArtifacts — stale-response guard', () => {
  it('DROPS a slow first response that resolves after a newer request', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));

    // Student opens chapter 3…
    await step(() => result.current.open('diagram', CTX_A));
    // …then switches to chapter 4 before the first response lands.
    await step(() => result.current.open('diagram', CTX_B));
    expect(fetcher.mock).toHaveBeenCalledTimes(2);

    // The NEWER request lands first.
    await settle(1, 200, { success: true, data: diagramData('CHAPTER_4') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    // Now the STALE first request finally lands — it must be dropped.
    await settle(0, 200, { success: true, data: diagramData('CHAPTER_3') });

    expect(result.current.diagram.status).toBe('ready');
    expect(
      (result.current.diagram as { status: 'ready'; data: { titleEn: string } }).data
        .titleEn,
    ).toBe('CHAPTER_4');
  });

  it('a stale ERROR cannot overwrite a newer READY result', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await step(() => result.current.open('diagram', CTX_B));

    await settle(1, 200, { success: true, data: diagramData('CHAPTER_4') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await settle(0, 500, {});
    expect(result.current.diagram.status).toBe('ready');
  });

  it('a stale response cannot overwrite a REGENERATED result', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await step(() => result.current.regenerate());
    expect(fetcher.mock).toHaveBeenCalledTimes(2);

    await settle(1, 200, { success: true, data: diagramData('FRESH') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await settle(0, 200, { success: true, data: diagramData('STALE') });
    expect(
      (result.current.diagram as { status: 'ready'; data: { titleEn: string } }).data
        .titleEn,
    ).toBe('FRESH');
  });
});

// ── 5. Regenerate ────────────────────────────────────────────────────────────

describe('Foxy useStudyArtifacts — regenerate', () => {
  it('bypasses the cache and issues a fresh request for the same context', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 200, { success: true, data: diagramData('FIRST') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));

    await step(() => result.current.regenerate());
    expect(fetcher.mock).toHaveBeenCalledTimes(2);
    expect(result.current.diagram.status).toBe('loading');

    await settle(1, 200, { success: true, data: diagramData('SECOND') });
    await waitFor(() =>
      expect(
        (result.current.diagram as { status: 'ready'; data: { titleEn: string } }).data
          .titleEn,
      ).toBe('SECOND'),
    );
  });

  it('is the retry path for a failed attempt', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('diagram', CTX_A));
    await settle(0, 500, {});
    await waitFor(() => expect(result.current.diagram.status).toBe('error'));

    await step(() => result.current.regenerate());
    await settle(1, 200, { success: true, data: diagramData('RECOVERED') });
    await waitFor(() => expect(result.current.diagram.status).toBe('ready'));
  });

  it('regenerates the OPEN artifact only', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.open('lesson', CTX_A));
    await settle(0, 200, { success: true, data: { abstained: false, sections: [] } });
    await waitFor(() => expect(result.current.lesson.status).toBe('ready'));

    await step(() => result.current.regenerate());
    expect(fetcher.mock).toHaveBeenCalledTimes(2);
    expect(fetcher.calls[1].url.startsWith('/api/lesson?')).toBe(true);
    expect(result.current.diagram).toEqual({ status: 'idle' });
  });

  it('is a no-op when no sheet is open', async () => {
    const { result } = renderHook(() => useStudyArtifacts(deps(fetcher.impl)));
    await step(() => result.current.regenerate());
    expect(fetcher.mock).not.toHaveBeenCalled();
  });
});
