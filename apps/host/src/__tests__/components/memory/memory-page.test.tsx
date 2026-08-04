/**
 * /memory — "What Foxy remembers about me" (Foxy North-Star Phase 1).
 *
 * Covers:
 *   1. Data state: GET /api/learner/memory renders the three layer cards,
 *      using the growth-mindset mastery-band vocabulary ("Building it") for
 *      developing topics — never "weak" framing.
 *   2. Empty state: all-empty payload → friendly empty card.
 *   3. erasurePending → full-screen "being forgotten" state.
 *   4. Erase confirm flow: Erase → confirm dialog → DELETE called with the
 *      canonical wire enum ('preferences'|'long_memory'|'twin'|'cognitive'):
 *      { scope: { layer: 'cognitive', subject } }; the UI's camelCase
 *      longMemory key maps to wire 'long_memory'; preferences layer omits
 *      the subject (global).
 *   5. Error state renders a Retry affordance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  erasurePending: false,
};

const EMPTY_PAYLOAD = {
  cognitive: { weakTopics: [], strongTopics: [], revisionDue: [], recentErrors: [] },
  longMemory: { summary: null, highConcepts: [], lowConcepts: [], topMisconceptions: [] },
  preferences: { learningStyle: null, preferredExplanationDepth: null },
  twin: null,
  erasurePending: false,
};

type FetchCall = { url: string; init?: RequestInit };
let fetchCalls: FetchCall[] = [];

function installFetch(getPayload: () => unknown, opts?: { failGet?: boolean }) {
  fetchCalls = [];
  global.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (init?.method === 'DELETE') {
      return {
        ok: true,
        json: async () => ({ accepted: true }),
      } as Response;
    }
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
    // "My preferences" also appears as the erase-panel layer button, so pin
    // the layer-card heading specifically.
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

  it('renders the full-screen "being forgotten" state when erasurePending is true', async () => {
    installFetch(() => ({ ...EMPTY_PAYLOAD, erasurePending: true }));
    render(<MemoryPage />);
    expect(await screen.findByTestId('erasure-pending-state')).toBeTruthy();
    expect(screen.getByText('Foxy is forgetting…')).toBeTruthy();
    // No erase panel / layer cards behind the full-screen state.
    expect(screen.queryByText('What Foxy knows about my learning')).toBeNull();
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

describe('/memory erase confirm flow', () => {
  it('DELETEs with { scope: { layer: "cognitive", subject } } after confirmation', async () => {
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);
    await screen.findByText('What Foxy knows about my learning');

    // Open the confirm dialog for the cognitive layer ("Learning memory").
    fireEvent.click(screen.getByRole('button', { name: /Learning memory/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm erase' });
    // The 30-day purge explanation is present (scoped purge worker has landed).
    expect(within(dialog).getByText(/purged from our systems within 30 days/)).toBeTruthy();
    // Assessment-mandated cognitive reset warning (erase is all-subjects).
    expect(
      within(dialog).getByText(
        'Foxy will start learning about you again from zero: your revision schedule and recommended question difficulty will reset. Your XP, streak, and quiz history are NOT deleted.'
      )
    ).toBeTruthy();
    // The cognitive dialog carries NO subject parenthetical — the erase is
    // student-wide, not subject-scoped (v1 purge ignores scope.subject).
    expect(dialog.textContent).not.toContain('(Science)');
    // Fail-closed guard copy — present on every layer's dialog.
    expect(
      within(dialog).getByText("While the erase is in progress, all of Foxy's memory stays blank.")
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByTestId('erase-confirm-button'));

    await waitFor(() => {
      const del = fetchCalls.find((c) => c.init?.method === 'DELETE');
      expect(del).toBeTruthy();
      expect(JSON.parse(String(del!.init!.body))).toEqual({
        scope: { layer: 'cognitive', subject: 'science' },
      });
    });
  });

  it('maps the UI longMemory layer to the snake_case wire value long_memory', async () => {
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);
    await screen.findByText('What Foxy knows about my learning');

    const erasePanel = screen.getByRole('region', { name: 'Erase memory' });
    fireEvent.click(within(erasePanel).getByRole('button', { name: /Monthly summary/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm erase' });
    // Fail-closed guard copy appears on ALL layers' dialogs, not just cognitive.
    expect(
      within(dialog).getByText("While the erase is in progress, all of Foxy's memory stays blank.")
    ).toBeTruthy();
    // v1 purge is layer-wide; subject narrowing not yet honored server-side —
    // the longMemory dialog must NOT imply subject-only via a parenthetical.
    expect(dialog.textContent).not.toContain('(Science)');
    fireEvent.click(within(dialog).getByTestId('erase-confirm-button'));

    await waitFor(() => {
      const del = fetchCalls.find((c) => c.init?.method === 'DELETE');
      expect(del).toBeTruthy();
      expect(JSON.parse(String(del!.init!.body))).toEqual({
        scope: { layer: 'long_memory', subject: 'science' },
      });
    });
  });

  it('omits the subject for the global preferences layer', async () => {
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);
    await screen.findByText('What Foxy knows about my learning');

    const erasePanel = screen.getByRole('region', { name: 'Erase memory' });
    fireEvent.click(within(erasePanel).getByRole('button', { name: /My preferences/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm erase' });
    fireEvent.click(within(dialog).getByTestId('erase-confirm-button'));

    await waitFor(() => {
      const del = fetchCalls.find((c) => c.init?.method === 'DELETE');
      expect(del).toBeTruthy();
      expect(JSON.parse(String(del!.init!.body))).toEqual({
        scope: { layer: 'preferences' },
      });
    });
  });

  it('renders the exact Hindi cognitive warning + in-progress guard copy when isHi (P7)', async () => {
    mockIsHi = true;
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);
    await screen.findByText(/फॉक्सी क्या याद रखता है/);

    const erasePanel = screen.getByRole('region', { name: 'मेमोरी मिटाएँ' });
    fireEvent.click(within(erasePanel).getByRole('button', { name: /सीखने की मेमोरी/ }));
    const dialog = await screen.findByRole('dialog', { name: 'मिटाने की पुष्टि करें' });

    expect(
      within(dialog).getByText(
        'फॉक्सी तुम्हें फिर से शुरुआत से जानेगा: तुम्हारा दोहराने का शेड्यूल और सवालों की कठिनाई फिर से सेट होगी। तुम्हारे XP, स्ट्रीक और क्विज़ इतिहास नहीं मिटेंगे।'
      )
    ).toBeTruthy();
    expect(
      within(dialog).getByText('जब तक मिटाना पूरा नहीं होता, फॉक्सी की पूरी याददाश्त खाली रहेगी।')
    ).toBeTruthy();
    // No subject parenthetical on the cognitive dialog in Hindi either.
    expect(dialog.textContent).not.toContain('(विज्ञान)');
  });

  it('does not DELETE when the dialog is cancelled', async () => {
    installFetch(() => FULL_PAYLOAD);
    render(<MemoryPage />);
    await screen.findByText('What Foxy knows about my learning');

    fireEvent.click(screen.getByRole('button', { name: /Learning memory/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm erase' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(fetchCalls.some((c) => c.init?.method === 'DELETE')).toBe(false);
  });
});
