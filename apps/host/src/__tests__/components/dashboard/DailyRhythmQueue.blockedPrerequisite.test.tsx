import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * DailyRhythmQueue — Loop D blocked-prerequisite lane (Digital Twin +
 * Knowledge Graph Slice 1, ff_digital_twin_v1).
 *
 * Sibling to DailyRhythmQueue.remediation.test.tsx (Loop A). Consumes the
 * SAME /api/rhythm/today contract shape, extended with:
 *   { kind: 'blocked_prerequisite', subjectCode, chapterNumber (DEPENDENT
 *     chapter), prerequisiteChapterNumber (upstream chapter to strengthen),
 *     interventionId }
 *
 * Frontend-readiness-only: ff_digital_twin_v1 is still OFF, so
 * /api/rhythm/today never actually emits this kind today. This suite tests
 * the COMPONENT's handling if such a card were present — not that it is
 * currently being served.
 *
 * Assessment sign-off (2026-07-21): the card copy uses the same
 * collaborative "Foxy noticed ... let's" voice as the Loop A remediation
 * card (read from the current component source, not any earlier draft):
 *   EN: "Foxy noticed Chapter {dependentCh} will click faster once
 *        Chapter {prereqCh} is solid"
 *   HI: "Foxy ने देखा कि अध्याय {prereqCh} पक्का होते ही अध्याय
 *        {dependentCh} आसान हो जाएगा"
 * The deep link and the meta line both route to the PREREQUISITE chapter
 * (the thing the student should actually go strengthen), not the dependent
 * one — pinned explicitly below since it's easy to get backwards.
 *
 * Covers:
 *   1. Card renders with the EN "Foxy noticed..." framing
 *   2. Tap target links to /quiz?subject=&chapter=<PREREQUISITE chapter>
 *   3. Hindi copy when isHi=true (P7)
 *   4. No blocked_prerequisite kinds → no card, base queue unchanged
 *      (current reality: the flag is OFF and the API never emits this kind)
 *   5. Unknown/future kinds never break rendering (default-safe filters)
 *   6. Malformed card (missing subject/chapter/prerequisiteChapterNumber)
 *      is dropped — never a dead link
 *   7. Click fires the dashboard_cta_clicked wrapper (PII-free payload —
 *      interventionId never emitted)
 */

// ── AuthContext mock ─────────────────────────────────────────────────────────
let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi }),
}));

// ── next/link mock (renders a plain anchor) ──────────────────────────────────
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => React.createElement('a', { href, ...rest }, children),
}));

// ── PostHog CTA wrapper mock ─────────────────────────────────────────────────
const mockTrackCta = vi.fn();
vi.mock('@alfanumrik/lib/posthog/dashboard-cta', () => ({
  trackDashboardCta: (...args: unknown[]) => mockTrackCta(...args),
}));

// ── fetch mock (URL-routed: rhythm queue + the body's dive/synthesis pings) ──
type QueueItem = Record<string, unknown>;

function stubFetch(items: QueueItem[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/rhythm/today')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items, composedAtIso: '2026-07-21T03:00:00.000Z' }),
        } as Response;
      }
      // /api/dive/state and /api/synthesis/state — flag off (404 ⇒ no CTA rows).
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }),
  );
}

const BASE_ITEMS: QueueItem[] = [
  { kind: 'srs_review', questionId: 'q-1' },
  { kind: 'srs_review', questionId: 'q-2' },
  { kind: 'zpd_problem', questionId: 'q-3' },
  { kind: 'reflection', promptText: 'What clicked today?', promptTextHi: 'आज क्या समझ आया?' },
];

const BLOCKED_PREREQ_CARD: QueueItem = {
  kind: 'blocked_prerequisite',
  subjectCode: 'math',
  chapterNumber: 7, // dependent (advanced) chapter
  prerequisiteChapterNumber: 4, // upstream chapter that needs strengthening
  interventionId: '22222222-2222-2222-2222-222222222222',
};

async function renderQueue() {
  const { default: DailyRhythmQueue } = await import(
    '@alfanumrik/ui/dashboard/sections/DailyRhythmQueue'
  );
  return render(React.createElement(DailyRhythmQueue));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockIsHi = false;
});

describe('DailyRhythmQueue — Loop D blocked-prerequisite lane', () => {
  it('renders the card with the "Foxy noticed..." EN framing', async () => {
    stubFetch([...BASE_ITEMS, BLOCKED_PREREQ_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    const card = screen.getByTestId('rhythm-blocked-prerequisite-card');
    expect(card.textContent).toContain(
      "Foxy noticed Chapter 7 will click faster once Chapter 4 is solid",
    );
    // Meta line shows the PREREQUISITE chapter (Ch. 4), not the dependent one.
    expect(card.textContent).toContain('math');
    expect(card.textContent).toContain('Ch. 4');
    expect(card.textContent).not.toContain('Ch. 7');
    expect(card.textContent).toContain('Strengthen');
  });

  it('links to /quiz?subject=&chapter=<PREREQUISITE chapter> — practice the foundation, not the blocked chapter', async () => {
    stubFetch([...BASE_ITEMS, BLOCKED_PREREQ_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    const card = screen.getByTestId('rhythm-blocked-prerequisite-card');
    expect(card.getAttribute('href')).toBe('/quiz?subject=math&chapter=4');
    expect(card.getAttribute('aria-label')).toMatch(/Foxy noticed Chapter 7/);
    expect(card.getAttribute('aria-label')).toMatch(/start practice/);
  });

  it('renders natural Hindi framing when isHi=true (P7)', async () => {
    mockIsHi = true;
    stubFetch([...BASE_ITEMS, BLOCKED_PREREQ_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    const card = screen.getByTestId('rhythm-blocked-prerequisite-card');
    expect(card.textContent).toContain(
      'Foxy ने देखा कि अध्याय 4 पक्का होते ही अध्याय 7 आसान हो जाएगा',
    );
    expect(card.textContent).toContain('मज़बूत करो');
    expect(card.textContent).toContain('अध्याय 4');
  });

  it('renders no card when items[] carries no blocked_prerequisite kind (current reality: ff_digital_twin_v1 is OFF, /api/rhythm/today never emits this kind)', async () => {
    stubFetch(BASE_ITEMS);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.queryByTestId('rhythm-blocked-prerequisite-card')).toBeNull();
    // Base rows untouched.
    expect(screen.getByTestId('rhythm-srs-cta')).toBeDefined();
    expect(screen.getByTestId('rhythm-zpd-cta')).toBeDefined();
  });

  it('ignores unknown/future kinds without breaking the queue (default-safe)', async () => {
    stubFetch([
      ...BASE_ITEMS,
      { kind: 'some_future_kind', payload: 'x' },
      BLOCKED_PREREQ_CARD,
    ]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.getByTestId('rhythm-blocked-prerequisite-card')).toBeDefined();
    expect(screen.getByTestId('rhythm-srs-cta')).toBeDefined();
  });

  it('drops a malformed blocked_prerequisite card (missing prerequisiteChapterNumber) — never a dead link', async () => {
    stubFetch([
      ...BASE_ITEMS,
      { kind: 'blocked_prerequisite', subjectCode: 'math', chapterNumber: 7, interventionId: 'x' }, // no prerequisiteChapterNumber
    ]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.queryByTestId('rhythm-blocked-prerequisite-card')).toBeNull();
  });

  it('drops a malformed blocked_prerequisite card (missing subjectCode/chapterNumber) — never a dead link', async () => {
    stubFetch([
      ...BASE_ITEMS,
      { kind: 'blocked_prerequisite', prerequisiteChapterNumber: 4, interventionId: 'x' }, // no subject/chapter
    ]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.queryByTestId('rhythm-blocked-prerequisite-card')).toBeNull();
  });

  it('fires the typed dashboard CTA wrapper on tap (no interventionId emitted — PII-free payload)', async () => {
    stubFetch([...BASE_ITEMS, BLOCKED_PREREQ_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    fireEvent.click(screen.getByTestId('rhythm-blocked-prerequisite-card'));
    expect(mockTrackCta).toHaveBeenCalledWith({
      section: 'daily_rhythm_queue',
      action: 'blocked_prerequisite',
      destination: '/quiz',
    });
    // Never sent subjectCode/chapterNumber/prerequisiteChapterNumber/interventionId.
    const payload = mockTrackCta.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['section', 'action', 'destination']);
  });
});
