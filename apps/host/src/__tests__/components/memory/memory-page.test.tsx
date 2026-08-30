/**
 * /memory — "What Foxy remembers about me" (Foxy North-Star Phase 1).
 *
 * Covers:
 *   1. Data state: GET /api/learner/memory renders the three layer cards,
 *      using the growth-mindset mastery-band vocabulary ("Building it") for
 *      developing topics — never "weak" framing.
 *   2. Empty state: all-empty payload → friendly empty card.
 *   3. Error state renders a Retry affordance.
 *
 * (The erase confirm flow and the erasurePending full-screen state were
 * removed 2026-08-30 along with the DPDP erasure subsystem they were built
 * on — see supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────────
let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    student: { id: 'stu-1', name: 'Asha' },
    isLoggedIn: true,
    isLoading: false,
    isHi: mockIsHi,
  }),
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    subjects: [],
    unlocked: [
      { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '⚛', color: '#10B981', isLocked: false },
      { code: 'math', name: 'Math', nameHi: 'गणित', icon: '➗', color: '#7C3AED', isLocked: false },
    ],
    locked: [],
    isLoading: false,
    error: null,
    refresh: () => {},
  }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import MemoryPage from '@/app/(student)/memory/page';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const FULL_PAYLOAD = {
  cognitive: {
    weakTopics: ['Light — Refraction'],
    strongTopics: ['Electricity'],
    revisionDue: ['Acids and Bases'],
    recentErrors: ['Mixed up concave and convex mirrors'],
  },
  longMemory: {
    summary: 'This month you practiced 42 questions in Science.',
    highConcepts: ['Ohm’s Law'],
    lowConcepts: ['Total internal reflection'],
    topMisconceptions: ['Current is used up in a circuit'],
  },
  preferences: { learningStyle: 'visual', preferredExplanationDepth: 'detailed' },
  twin: null,
};

const EMPTY_PAYLOAD = {
  cognitive: { weakTopics: [], strongTopics: [], revisionDue: [], recentErrors: [] },
  longMemory: { summary: null, highConcepts: [], lowConcepts: [], topMisconceptions: [] },
  preferences: { learningStyle: null, preferredExplanationDepth: null },
  twin: null,
};

type FetchCall = { url: string; init?: RequestInit };
let fetchCalls: FetchCall[] = [];

function installFetch(getPayload: () => unknown, opts?: { failGet?: boolean }) {
  fetchCalls = [];
  global.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (opts?.failGet) {
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response;
    }
    return { ok: true, json: async () => getPayload() } as Response;
  }) as any;
}

beforeEach(() => {
  mockIsHi = false;
  vi.clearAllMocks();
});

describe('/memory page states', () => {
  it('renders the three memory layers with mastery-band vocabulary (no "weak" framing)', async () => {
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);

    expect(await screen.findByText('What Foxy knows about my learning')).toBeTruthy();
    expect(screen.getByText("Foxy's monthly summary")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'My preferences' })).toBeTruthy();

    // Growth-mindset band labels — "Building it" for developing topics.
    expect(screen.getAllByText('Building it').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Strong').length).toBeGreaterThan(0);
    expect(screen.getByText('Light — Refraction')).toBeTruthy();
    // The word "weak" never appears on this student surface.
    expect(document.body.textContent?.toLowerCase()).not.toContain('weak');

    // GET carried the subject query param.
    expect(fetchCalls[0].url).toContain('/api/learner/memory?subject=science');
  });

  it('renders the empty state when Foxy has no memory yet', async () => {
    installFetch(() => EMPTY_PAYLOAD);
    render(<MemoryPage />);
    expect(await screen.findByTestId('memory-empty-state')).toBeTruthy();
    expect(screen.getByText('Foxy is still getting to know you')).toBeTruthy();
  });

  it('renders an error state with Retry when the GET fails', async () => {
    installFetch(() => FULL_PAYLOAD, { failGet: true });
    render(<MemoryPage />);
    expect(await screen.findByText('boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('renders Hindi header copy when isHi (P7)', async () => {
    mockIsHi = true;
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);
    expect(await screen.findByText(/फॉक्सी क्या याद रखता है/)).toBeTruthy();
  });
});
