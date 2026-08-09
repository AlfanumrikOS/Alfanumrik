/**
 * /learn/[subject]/[chapter] — content-fetch failure surfaces a RETRYABLE error
 * card, never a permanent skeleton (render unit).
 *
 * P0 fix (2026-06-16)
 *   load() was rewritten with try/catch/finally so `loading` ALWAYS clears, even
 *   when a query rejects on a flaky Indian-4G network. Previously a rejected
 *   await left the student stuck on <LoadingFoxy /> forever. On failure the page
 *   now flips a distinct `loadError` state and renders a retryable bilingual
 *   error card ("Couldn't load this chapter" + a Retry button) — which is
 *   DISTINCT from the empty "Ask Foxy to teach you this chapter" state (that
 *   means "loaded OK, no concepts").
 *
 *   This test mounts the REAL page with `getChapterQuestions` (one of the
 *   Promise.all members inside load()) REJECTING, then asserts:
 *     - the page does NOT stay on the skeleton (loading was cleared via finally),
 *     - the error card with a Retry button renders,
 *     - the error card is NOT the empty "Ask Foxy" state.
 *
 *   The page pulls in a large hook/effect graph, so every heavy seam is mocked
 *   to the lightest stub that still lets load()'s try/catch/finally run. The real
 *   render branches (skeleton / error / empty) are exercised through the host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// ── Route params: subject=math, chapter=1 ─────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ subject: 'math', chapter: '1' }),
  useSearchParams: () => new URLSearchParams(),
}));

// ── Auth: a signed-in student so load() runs (it early-returns without one) ────
const student = { id: 'stu-1', grade: 'Grade 8', board: 'CBSE' };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ student, isLoggedIn: true, isLoading: false, isHi: false }),
}));

// ── Allowed subjects: math present + unlocked so the plan-gate effect is inert ─
vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    subjects: [{ code: 'math', name: 'Mathematics', icon: '∑', color: '#7C3AED', isLocked: false }],
    unlocked: [{ code: 'math', name: 'Mathematics', icon: '∑', color: '#7C3AED', isLocked: false }],
  }),
}));

vi.mock('@alfanumrik/lib/useChapterReadiness', () => ({ useChapterReadiness: () => ({ readiness: null }) }));

// ── The data layer. getChapterQuestions REJECTS → Promise.all in load() rejects
//    → catch sets loadError, finally clears loading. The other members resolve so
//    the rejection is unambiguously the trigger under test. `vi.hoisted` so the
//    spy exists when the hoisted vi.mock factory below references it. ────────────
const { failingQuestions, chapterTopics } = vi.hoisted(() => ({
  failingQuestions: vi.fn().mockRejectedValue(new Error('network down (4G stall)')),
  // Configurable per test — the second half of the frontend-honesty sweep made
  // getChapterTopics/getChapterQuestions return ServiceResult, so a FAILED read
  // is now `{ ok: false, error }` rather than a resolved [].
  chapterTopics: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));
vi.mock('@alfanumrik/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  ['select', 'eq'].forEach((m) => { builder[m] = vi.fn().mockReturnValue(builder); });
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: null });
  return {
    // getChapterTopics/getChapterQuestions return ServiceResult now; the page
    // unwraps them. A successful-but-empty read is `{ ok: true, data: [] }`.
    getChapterTopics: chapterTopics,
    getChapterQuestions: failingQuestions,
    getTopicDiagrams: vi.fn().mockResolvedValue([]),
    recordLearningEvent: vi.fn().mockResolvedValue(undefined),
    updateChapterProgress: vi.fn().mockResolvedValue(undefined),
    getFeatureFlags: vi.fn().mockResolvedValue({}),
    supabase: { from: vi.fn(() => builder) },
  };
});

vi.mock('@alfanumrik/lib/chapter-reader/get-concepts-from-table', () => ({
  getChapterTopicsFromConcepts: vi.fn().mockResolvedValue([]),
  isUsableChapterDeck: vi.fn().mockReturnValue(false),
}));

vi.mock('@alfanumrik/lib/learn/pedagogy-content-rules', () => ({
  resolvePedagogyRule: () => ({ productiveFailure: false, workedExampleFirst: false }),
}));

// Telemetry + confetti are fire-and-forget side effects — stub to no-ops.
vi.mock('@alfanumrik/lib/posthog/client', () => ({ track: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('@/app/learn/[subject]/[chapter]/actions', () => ({ loadChapterContent: vi.fn().mockResolvedValue(null) }));

// next/dynamic'd children (ChapterReadView / ChapterReadinessCard) → no-op.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

// AppShell renders its header + children plainly so the error copy is on screen.
vi.mock('@alfanumrik/ui/responsive', () => ({
  AppShell: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, header, children),
}));

import ChapterConceptPage from '@/app/learn/[subject]/[chapter]/page';

beforeEach(() => {
  failingQuestions.mockClear();
  failingQuestions.mockRejectedValue(new Error('network down (4G stall)'));
  chapterTopics.mockClear();
  chapterTopics.mockResolvedValue({ ok: true, data: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('learn chapter page — content fetch failure → retryable error card', () => {
  it('renders the error card with a Retry button (not the permanent skeleton)', async () => {
    render(React.createElement(ChapterConceptPage));

    // The error copy appears once load() rejects and finally clears `loading`.
    await waitFor(() =>
      expect(screen.getByText("Couldn't load this chapter")).toBeDefined(),
    );

    // A Retry affordance is present (re-invokes load()).
    expect(screen.getByText(/Retry/)).toBeDefined();

    // The data layer actually rejected — proves the error path, not a vacuous pass.
    expect(failingQuestions).toHaveBeenCalled();
  });

  it('shows the error card, NOT the empty "Ask Foxy" state (distinct states)', async () => {
    render(React.createElement(ChapterConceptPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load this chapter")).toBeDefined(),
    );

    // The empty-state copy ("Ask Foxy to teach you this chapter") must NOT show —
    // a fetch failure is not "loaded OK with no concepts".
    expect(screen.queryByText('Ask Foxy to teach you this chapter')).toBeNull();
    expect(screen.queryByText('No concepts found for this chapter yet')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Frontend-honesty sweep, second half (2026-08-09).

   Until now getChapterTopics swallowed its RAG error and resolved [], so a
   broken retrieval rendered "No concepts found for this chapter yet" — a claim
   about the NCERT corpus produced by a 500. Only a rejection from one of the
   OTHER Promise.all members could reach the error card (which is what the two
   tests above exercise). getChapterTopics now returns ServiceResult and the
   page unwraps it, so a failed content read lands on the error card too.

   Both directions, because the empty state is a real product state: a chapter
   genuinely awaiting ingestion must still get "Ask Foxy to teach you this
   chapter", not an error.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('learn chapter page — a failed TOPICS read is not an empty chapter', () => {
  it('getChapterTopics failure → error card, and NOT "No concepts found for this chapter yet"', async () => {
    chapterTopics.mockResolvedValue({
      ok: false,
      error: 'getChapterTopics: rag retrieval failed',
      code: 'DB_ERROR',
    });
    // Questions succeed here so the topics read is unambiguously the trigger.
    failingQuestions.mockResolvedValue({ ok: true, data: [] });

    render(React.createElement(ChapterConceptPage));

    await waitFor(() =>
      expect(screen.getByText("Couldn't load this chapter")).toBeDefined(),
    );
    expect(screen.queryByText('No concepts found for this chapter yet')).toBeNull();
    expect(screen.queryByText('Ask Foxy to teach you this chapter')).toBeNull();
  });

  it('a genuinely un-ingested chapter still gets the empty state, NOT an error card', async () => {
    chapterTopics.mockResolvedValue({ ok: true, data: [] });
    failingQuestions.mockResolvedValue({ ok: true, data: [] });

    render(React.createElement(ChapterConceptPage));

    await waitFor(() =>
      expect(screen.getByText('No concepts found for this chapter yet')).toBeDefined(),
    );
    expect(screen.queryByText("Couldn't load this chapter")).toBeNull();
  });
});
