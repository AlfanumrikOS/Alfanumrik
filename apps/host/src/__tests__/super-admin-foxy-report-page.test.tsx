/**
 * Super-admin Foxy Learning Report page (Phase 3.1 UI) — render tests.
 *
 * Strategy (mirrors super-admin-grounding-health-page.test.tsx): mock AdminShell
 * so we bypass supabase auth and render children immediately; the page fetches
 * via the mocked `apiFetch`. useParams is mocked to supply the studentId. SWR is
 * isolated per-test with a fresh cache provider.
 *
 * Covers: happy-path six-section render, dark-ledger degradation ("No signal
 * yet" placeholders), error state, and bilingual (isHi) labels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

// ── Mock AdminShell (both alias + relative paths the page could resolve) ──
const apiFetchMock = vi.fn();
const adminCtx = {
  accessToken: 'test-token',
  adminName: 'tester',
  supabase: {},
  headers: () => ({}),
  apiFetch: apiFetchMock,
};
vi.mock('@/app/super-admin/_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => adminCtx,
}));
vi.mock('../../_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => adminCtx,
}));

// ── Mock AuthContext so isHi is controllable per-test ──
let isHiValue = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: isHiValue }),
}));

// ── Mock useParams to supply the route studentId ──
vi.mock('next/navigation', () => ({
  useParams: () => ({ studentId: '11111111-2222-3333-4444-555555555555' }),
}));

import FoxyReportPage from '@/app/super-admin/foxy-report/[studentId]/page';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
function errResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FoxyReportPage />
    </SWRConfig>,
  );
}

const LIVE_REPORT = {
  studentId: '11111111-2222-3333-4444-555555555555',
  grade: '8',
  generatedAt: '2026-07-15T10:00:00Z',
  ledgerAvailable: false,
  engagement: {
    sessionCount: 4,
    turnCount: 37,
    lastActiveAt: '2026-07-14T09:30:00Z',
    subjects: ['Science', 'Mathematics'],
    chapters: ['Light', 'Fractions'],
    modes: ['learn', 'practice'],
  },
  evidentialPractice: { served: 10, answered: 8, correct: 6, accuracyPct: 75 },
  masteryMovement: {
    conceptsPracticed: 2,
    concepts: [
      {
        conceptId: 'aaaaaaaa-0000-0000-0000-000000000001',
        conceptName: 'Refraction of light',
        masteryMean: 0.82,
        band: 'high',
        recentDelta: 0.05,
        attempts: 3,
      },
      {
        conceptId: 'aaaaaaaa-0000-0000-0000-000000000002',
        conceptName: 'Adding fractions',
        masteryMean: 0.35,
        band: 'low',
        recentDelta: -0.02,
        attempts: 2,
      },
    ],
  },
  misconceptions: {
    total: 1,
    open: 1,
    items: [
      {
        code: 'MC_FRAC_ADD_DENOM',
        label: 'Adds denominators when adding fractions',
        labelHi: 'भिन्न जोड़ते समय हर जोड़ देना',
        source: 'detected',
        concept: 'fractions',
        occurrences: 2,
        resolved: false,
        lastSeenAt: '2026-07-13T08:00:00Z',
      },
    ],
  },
  lessonProgress: {
    active: true,
    lessonStep: 'guided_practice',
    objectiveConceptId: 'aaaaaaaa-0000-0000-0000-000000000001',
    objectiveConceptName: 'Refraction of light',
    sessionId: 'bbbbbbbb-0000-0000-0000-000000000009',
  },
  struggleSignals: { available: false, signals: [] },
};

describe('FoxyReportPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    isHiValue = false;
  });

  it('renders the six sections and key metrics after a successful fetch', async () => {
    apiFetchMock.mockResolvedValue(okResponse({ success: true, data: LIVE_REPORT }));

    renderPage();

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/super-admin/foxy-report/11111111-2222-3333-4444-555555555555',
      ),
    );

    expect(await screen.findByText('Foxy Learning Report')).toBeInTheDocument();
    expect(await screen.findByTestId('section-engagement')).toBeInTheDocument();
    expect(screen.getByTestId('section-evidential')).toBeInTheDocument();
    expect(screen.getByTestId('section-mastery')).toBeInTheDocument();
    expect(screen.getByTestId('section-misconceptions')).toBeInTheDocument();
    expect(screen.getByTestId('section-lesson')).toBeInTheDocument();
    expect(screen.getByTestId('section-struggle')).toBeInTheDocument();

    // Live data spot-checks. "Refraction of light" appears in both the mastery
    // list and the lesson objective, so assert at-least-one.
    expect(screen.getByText('75%')).toBeInTheDocument(); // accuracy
    expect(screen.getAllByText('Refraction of light').length).toBeGreaterThan(0);
    expect(screen.getByText('Strong')).toBeInTheDocument(); // MASTERY_BAND_LABELS high
    expect(screen.getByText('Getting started')).toBeInTheDocument(); // MASTERY_BAND_LABELS low
    // Misconception uses DTO label (EN)
    expect(screen.getByText('Adds denominators when adding fractions')).toBeInTheDocument();
  });

  it('degrades dark-ledger + empty sections to a "No signal yet" placeholder', async () => {
    apiFetchMock.mockResolvedValue(okResponse({ success: true, data: LIVE_REPORT }));

    renderPage();

    // Dark-ledger banner renders (ledgerAvailable=false)
    expect(await screen.findByTestId('foxy-report-dark-ledger')).toBeInTheDocument();
    // Struggle signals section shows the placeholder, not an empty void
    const struggle = await screen.findByTestId('struggle-no-signal');
    expect(struggle).toHaveTextContent('No signal yet');
    // Live sections still render alongside the degraded one
    expect(screen.getAllByText('Refraction of light').length).toBeGreaterThan(0);
  });

  it('renders bilingual labels + placeholder when isHi is true', async () => {
    isHiValue = true;
    apiFetchMock.mockResolvedValue(okResponse({ success: true, data: LIVE_REPORT }));

    renderPage();

    expect(await screen.findByText('Foxy लर्निंग रिपोर्ट')).toBeInTheDocument();
    // Misconception uses DTO labelHi
    expect(screen.getByText('भिन्न जोड़ते समय हर जोड़ देना')).toBeInTheDocument();
    // Struggle placeholder in Hindi
    expect(await screen.findByTestId('struggle-no-signal')).toHaveTextContent('आंकड़े अभी नहीं');
  });

  it('shows the error state when the API returns 500', async () => {
    apiFetchMock.mockResolvedValue(errResponse(500, { success: false, error: 'Boom' }));

    renderPage();

    const errorBox = await screen.findByTestId('foxy-report-error');
    expect(errorBox).toHaveTextContent('Boom');
  });
});
