/**
 * Super-admin Grounding Health page (Task 3.16) — render + polling tests.
 *
 * Strategy: mock the AdminShell so we don't touch supabase. The shell is
 * a thin wrapper that yields `apiFetch` — we provide our own via the
 * mocked context. The real page component is exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// ── Mock AdminShell to bypass supabase auth + render children immediately ──
const apiFetchMock = vi.fn();
vi.mock('@/app/super-admin/_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => ({
    accessToken: 'test-token',
    adminName: 'tester',
    supabase: {},
    headers: () => ({}),
    apiFetch: apiFetchMock,
  }),
}));

// Adjust the relative-import path inside the page so the mock above resolves.
vi.mock('../../_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => ({
    accessToken: 'test-token',
    adminName: 'tester',
    supabase: {},
    headers: () => ({}),
    apiFetch: apiFetchMock,
  }),
}));

import GroundingHealthPage from '@/app/super-admin/grounding/health/page';

const OK_BODY = {
  success: true,
  data: {
    callsPerMin: {
      foxy: 12,
      'ncert-solver': 3,
      'quiz-generator': 1,
      'concept-engine': 0,
      diagnostic: 0,
    },
    groundedRate: {
      foxy: 0.95,
      'ncert-solver': 0.9,
      'quiz-generator': 0.8,
      'concept-engine': 0.5,
      diagnostic: 1.0,
    },
    abstainBreakdown: {
      chapter_not_ready: 5,
      no_chunks_retrieved: 2,
      low_similarity: 1,
      no_supporting_chunks: 0,
      scope_mismatch: 0,
      upstream_error: 1,
      circuit_open: 0,
    },
    latency: { p50: 450, p95: 1200, p99: 2100 },
    circuitStates: { voyage: 'closed', claude: 'closed', retrieval: 'closed' },
    voyageErrorRate: 0.005,
    claudeErrorRate: 0.02,
    generated_at: '2026-04-17T12:00:00Z',
  },
};

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

describe('GroundingHealthPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders tiles for each caller after successful fetch', async () => {
    apiFetchMock.mockResolvedValue(okResponse(OK_BODY));

    render(<GroundingHealthPage />);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/super-admin/grounding/health'));

    // Header
    expect(await screen.findByText('Grounding Health')).toBeInTheDocument();

    // Calls per min section
    const callsSection = await screen.findByTestId('calls-per-min-section');
    expect(callsSection).toBeInTheDocument();

    // Grounded rate section
    expect(await screen.findByTestId('grounded-rate-section')).toBeInTheDocument();

    // Abstain breakdown bar (has non-zero data so bar segments should render)
    expect(await screen.findByTestId('abstain-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('abstain-bar-chapter_not_ready')).toBeInTheDocument();

    // Latency + circuits + error rates
    expect(screen.getByTestId('latency-section')).toBeInTheDocument();
    expect(screen.getByTestId('circuit-states-section')).toBeInTheDocument();
    expect(screen.getByTestId('error-rates-section')).toBeInTheDocument();

    // Spot-check a circuit tile renders the correct label
    expect(screen.getByTestId('circuit-tile-voyage')).toHaveTextContent(/closed/i);
  });

  it('shows error state when API returns 500', async () => {
    apiFetchMock.mockResolvedValue(errResponse(500, { error: 'Boom' }));

    render(<GroundingHealthPage />);

    const errorBox = await screen.findByTestId('grounding-health-error');
    expect(errorBox).toHaveTextContent(/Boom/);
  });

  it('polls every 30s (fires a second request after interval)', async () => {
    // Switch to fake timers for controlled interval advancement
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiFetchMock.mockResolvedValue(okResponse(OK_BODY));

    render(<GroundingHealthPage />);
    // The page now fetches TWO endpoints per cycle: the grounding-health
    // route AND the oracle-health route (added with REG-54 telemetry
    // panel). Both are kicked off on mount and again on every 30s tick.
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/super-admin/grounding/health'),
    );
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/super-admin/ai/oracle-health'),
    );
    const initialCount = apiFetchMock.mock.calls.length;

    // Advance 30s and let React flush — second poll fires (both endpoints).
    await act(async () => {
      vi.advanceTimersByTime(30_001);
    });
    await waitFor(() =>
      expect(apiFetchMock.mock.calls.length).toBeGreaterThanOrEqual(initialCount + 2),
    );
  });

  it('shows empty state for abstain bar when no abstains', async () => {
    const zeroBody = {
      ...OK_BODY,
      data: {
        ...OK_BODY.data,
        abstainBreakdown: {
          chapter_not_ready: 0,
          no_chunks_retrieved: 0,
          low_similarity: 0,
          no_supporting_chunks: 0,
          scope_mismatch: 0,
          upstream_error: 0,
          circuit_open: 0,
        },
      },
    };
    apiFetchMock.mockResolvedValue(okResponse(zeroBody));

    render(<GroundingHealthPage />);

    await waitFor(() => {
      const container = screen.getByTestId('abstain-breakdown');
      expect(container).toHaveTextContent(/No abstains/);
    });
  });
});