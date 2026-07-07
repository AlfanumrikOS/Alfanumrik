import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * DailyRhythmQueue — Phase A Loop A adaptive-remediation lane.
 *
 * Consumes the FROZEN /api/rhythm/today contract: items[] may carry
 *   { kind: 'remediation_review', subjectCode, chapterNumber, interventionId, priority }
 * (flag OFF ⇒ the kind never appears — server-gated, no client flag check).
 *
 * Covers:
 *   1. Remediation card renders with warm EN framing + priority badge
 *   2. Tap target links to the canonical /quiz?subject=&chapter= deep link
 *   3. Hindi copy when isHi=true (P7)
 *   4. No remediation kinds → no card, base queue unchanged (flag-OFF shape)
 *   5. Unknown/future kinds never break rendering (default-safe filters)
 *   6. Malformed card (missing routing fields) is dropped — no dead link
 *   7. Click fires the dashboard_cta_clicked wrapper (PII-free payload)
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
          json: async () => ({ items, composedAtIso: '2026-06-12T03:00:00.000Z' }),
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

const REMEDIATION_CARD: QueueItem = {
  kind: 'remediation_review',
  subjectCode: 'science',
  chapterNumber: 4,
  interventionId: '11111111-1111-1111-1111-111111111111',
  priority: 1,
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

describe('DailyRhythmQueue — remediation lane', () => {
  it('renders the remediation card with warm EN framing and a priority badge', async () => {
    stubFetch([...BASE_ITEMS, REMEDIATION_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    const card = screen.getByTestId('rhythm-remediation-card');
    expect(card.textContent).toContain(
      "Foxy noticed Chapter 4 got tricky — let's strengthen it",
    );
    // Subject + chapter meta line and the CTA verb.
    expect(card.textContent).toContain('science');
    expect(card.textContent).toContain('Ch. 4');
    expect(card.textContent).toContain('Strengthen');
    // Priority badge (severity-ordered server-side; we just display it).
    expect(screen.getByTestId('rhythm-remediation-priority').textContent).toBe('Priority 1');
  });

  it('links to the canonical /quiz?subject=&chapter= practice deep link', async () => {
    stubFetch([...BASE_ITEMS, REMEDIATION_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    const card = screen.getByTestId('rhythm-remediation-card');
    expect(card.getAttribute('href')).toBe('/quiz?subject=science&chapter=4');
    // Accessible name is the full encouraging sentence, not just "open".
    expect(card.getAttribute('aria-label')).toMatch(/Foxy noticed Chapter 4/);
  });

  it('renders natural Hindi framing when isHi=true (P7)', async () => {
    mockIsHi = true;
    stubFetch([...BASE_ITEMS, REMEDIATION_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    const card = screen.getByTestId('rhythm-remediation-card');
    expect(card.textContent).toContain(
      'Foxy ने देखा कि अध्याय 4 थोड़ा मुश्किल लगा — चलो इसे पक्का करें',
    );
    expect(card.textContent).toContain('मज़बूत करो');
    expect(screen.getByTestId('rhythm-remediation-priority').textContent).toBe('प्राथमिकता 1');
  });

  it('renders no card when items[] carries no remediation kind (flag-OFF shape)', async () => {
    stubFetch(BASE_ITEMS);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.queryByTestId('rhythm-remediation-card')).toBeNull();
    // Base rows untouched.
    expect(screen.getByTestId('rhythm-srs-cta')).toBeDefined();
    expect(screen.getByTestId('rhythm-zpd-cta')).toBeDefined();
  });

  it('ignores unknown/future kinds without breaking the queue (default-safe)', async () => {
    stubFetch([
      ...BASE_ITEMS,
      { kind: 'some_future_kind', payload: 'x' },
      REMEDIATION_CARD,
    ]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.getByTestId('rhythm-remediation-card')).toBeDefined();
    expect(screen.getByTestId('rhythm-srs-cta')).toBeDefined();
  });

  it('drops a malformed remediation card (missing routing fields) — never a dead link', async () => {
    stubFetch([
      ...BASE_ITEMS,
      { kind: 'remediation_review', interventionId: 'x', priority: 1 }, // no subject/chapter
    ]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    expect(screen.queryByTestId('rhythm-remediation-card')).toBeNull();
  });

  it('fires the typed dashboard CTA wrapper on tap (no interventionId emitted)', async () => {
    stubFetch([...BASE_ITEMS, REMEDIATION_CARD]);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    fireEvent.click(screen.getByTestId('rhythm-remediation-card'));
    expect(mockTrackCta).toHaveBeenCalledWith({
      section: 'daily_rhythm_queue',
      action: 'remediation_review',
      destination: '/quiz',
    });
  });
});
