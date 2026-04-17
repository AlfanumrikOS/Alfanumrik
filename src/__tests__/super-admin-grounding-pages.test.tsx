/**
 * Smoke tests for the 4 sister super-admin grounding pages (Task 3.17).
 *
 *   - /super-admin/grounding/coverage
 *   - /super-admin/grounding/verification-queue
 *   - /super-admin/grounding/traces
 *   - /super-admin/grounding/ai-issues
 *
 * Smoke-level only: each page renders without error when given a happy-path
 * API response via mocked apiFetch. Exhaustive interaction tests live in the
 * E2E suite (Task 3.20).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();

const adminMockValue = {
  accessToken: 'test-token',
  adminName: 'tester',
  supabase: {},
  headers: () => ({}),
  apiFetch: apiFetchMock,
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

vi.mock('@/app/super-admin/_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => adminMockValue,
}));

// Relative path used from pages two levels deep.
vi.mock('../../_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => adminMockValue,
}));

import GroundingCoveragePage from '@/app/super-admin/grounding/coverage/page';
import GroundingVerificationQueuePage from '@/app/super-admin/grounding/verification-queue/page';
import GroundingTracesPage from '@/app/super-admin/grounding/traces/page';
import GroundingAiIssuesPage from '@/app/super-admin/grounding/ai-issues/page';

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('GroundingCoveragePage (Task 3.17a)', () => {
  it('renders the page with summary + table', async () => {
    apiFetchMock.mockResolvedValue(
      okResponse({
        success: true,
        data: {
          gaps: [
            {
              board: 'CBSE',
              grade: '10',
              subject_code: 'science',
              subject_display: 'Science',
              chapter_number: 1,
              chapter_title: 'Chemical Reactions',
              rag_status: 'chunks_ready',
              chunk_count: 42,
              verified_question_count: 0,
              severity: 'high',
              request_count: 17,
              potential_affected_students: 120,
              last_verified_at: null,
            },
          ],
          summary: { total_gaps: 1, critical: 0, high: 1, medium: 0 },
          filters: { grade: null, subject: null },
        },
      }),
    );

    render(<GroundingCoveragePage />);
    expect(await screen.findByTestId('grounding-coverage-page')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('grounding-coverage-table')).toBeInTheDocument();
    });
    expect(screen.getByText('Chemical Reactions')).toBeInTheDocument();
  });
});

describe('GroundingVerificationQueuePage (Task 3.17b)', () => {
  it('renders counts + pair table + failed sample', async () => {
    apiFetchMock.mockResolvedValue(
      okResponse({
        success: true,
        data: {
          counts: { legacy_unverified: 100, pending: 5, verified: 950, failed: 3 },
          byPair: [
            { grade: '10', subject: 'science', legacy_unverified: 2, pending: 1, verified: 97, failed: 0, verified_ratio: 0.97 },
            { grade: '10', subject: 'math', legacy_unverified: 50, pending: 0, verified: 50, failed: 0, verified_ratio: 0.5 },
          ],
          failedSample: [
            {
              id: 'q1',
              grade: '10',
              subject: 'science',
              chapter_number: 1,
              chapter_title: 'Chem',
              question_text: 'A failing question text that should appear',
              correct_answer_index: 0,
              verifier_failure_reason: 'no_matching_chunk',
              verifier_trace_id: null,
              verified_at: '2026-04-17T00:00:00Z',
            },
          ],
          throughputLast24h: {
            verified_per_hour: 10,
            failed_per_hour: 1,
            verified_total: 240,
            failed_total: 24,
          },
          generated_at: '2026-04-17T12:00:00Z',
        },
      }),
    );

    render(<GroundingVerificationQueuePage />);
    expect(await screen.findByTestId('grounding-verification-queue-page')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('queue-counts-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('queue-bypair-table')).toBeInTheDocument();
    expect(screen.getByTestId('queue-failed-sample')).toBeInTheDocument();
    expect(screen.getByText(/A failing question text/)).toBeInTheDocument();
  });
});

describe('GroundingTracesPage (Task 3.17c)', () => {
  it('renders the search form and empty-state table on first mount', async () => {
    // Traces page does NOT fetch on mount — only on submit. So no API call.
    render(<GroundingTracesPage />);
    expect(await screen.findByTestId('grounding-traces-page')).toBeInTheDocument();
    expect(screen.getByTestId('traces-search-form')).toBeInTheDocument();
    expect(screen.getByTestId('traces-results-table')).toBeInTheDocument();
    expect(screen.getByText(/No traces/i)).toBeInTheDocument();
    // No initial API call expected
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('GroundingAiIssuesPage (Task 3.17d)', () => {
  it('renders the issue table with a pending issue', async () => {
    apiFetchMock.mockResolvedValue(
      okResponse({
        success: true,
        data: {
          issues: [
            {
              id: 'i1',
              student_id: '11111111-2222-3333-4444-555555555555',
              foxy_message_id: null,
              question_bank_id: null,
              trace_id: null,
              reason_category: 'wrong_answer',
              student_comment: 'The answer says X but should be Y',
              admin_notes: null,
              admin_resolution: null,
              resolved_by: null,
              resolved_at: null,
              created_at: '2026-04-17T12:00:00Z',
              trace: null,
              foxy_message: null,
            },
          ],
          count: 1,
          status: 'pending',
          limit: 50,
        },
      }),
    );

    render(<GroundingAiIssuesPage />);
    expect(await screen.findByTestId('grounding-ai-issues-page')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('ai-issues-table')).toBeInTheDocument();
    });
    expect(screen.getByText(/wrong_answer/)).toBeInTheDocument();
  });
});