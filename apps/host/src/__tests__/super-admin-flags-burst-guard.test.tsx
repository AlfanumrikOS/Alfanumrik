/**
 * Super-admin Feature Flags console — Phase 0 burst-guard UI (2026-07-22).
 *
 * The API's velocity/burst guard (apps/host/src/app/api/super-admin/feature-flags/route.ts)
 * returns 409 { code: 'FLAG_BULK_CONFIRM_REQUIRED', bulk_confirm_required, recent_mutation_count }
 * once an admin's 4th+ CONFIRMED protected-flag mutation lands inside a
 * trailing 10-minute window. This suite pins the console's reaction: after
 * the per-flag type-to-confirm step succeeds server-side but the burst guard
 * blocks it, the UI must render a second bilingual step asking for the exact
 * `bulk_confirm` token and resubmit with BOTH `confirm` and `bulk_confirm` on
 * the next attempt.
 *
 * Strategy: mock AdminShell (bypass supabase auth) and AuthContext (control
 * isHi), following the pattern in super-admin-grounding-health-page.test.tsx.
 * No `@testing-library/user-event` in this repo's deps — use `fireEvent` +
 * `act`, matching the convention in teacher/command-center.test.tsx etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';

const apiFetchMock = vi.fn();

vi.mock('../app/super-admin/_components/AdminShell', () => ({
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

let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ isHi: mockIsHi }),
}));

import FlagsPage from '../app/super-admin/flags/page';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// `ff_school_pulse_v1` is a real constitution_pinned entry in protected-flags.ts.
const PROTECTED_FLAG = {
  id: 'flag-1',
  name: 'ff_school_pulse_v1',
  enabled: false,
  rollout_percentage: 0,
  target_institutions: [],
  target_roles: [],
  target_environments: [],
  description: 'School Pulse',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};

const LIST_BODY = { data: [PROTECTED_FLAG], total: 1 };

describe('Super-admin Flags console — Phase 0 burst guard', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    mockIsHi = false;
  });

  it('renders the bulk_confirm step after a burst-guard 409, and resubmits confirm + bulk_confirm together', async () => {
    // 1. Initial list fetch.
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, LIST_BODY));

    render(<FlagsPage />);

    await screen.findByText('ff_school_pulse_v1');

    // 2. Click ON to enable the protected flag -> opens the type-to-confirm step.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
    });
    const nameInput = await screen.findByPlaceholderText('ff_school_pulse_v1');

    // 3. Type the flag name and submit -> server accepts confirm but the
    //    burst guard blocks it (this admin already made 3+ mutations).
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'You have made 3 confirmed protected-flag mutation(s) in the last 10 minutes...',
        code: 'FLAG_BULK_CONFIRM_REQUIRED',
        bulk_confirm_required: 'BULK-4-ff_school_pulse_v1',
        recent_mutation_count: 3,
      }),
    );

    fireEvent.change(nameInput, { target: { value: 'ff_school_pulse_v1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    // 4. The burst-guard step should now render with the exact token as the
    //    placeholder, and the explanatory copy should include the count.
    const burstStep = await screen.findByTestId('burst-guard-step');
    expect(burstStep).toHaveTextContent(/several protected-flag changes recently/i);
    expect(burstStep).toHaveTextContent(/3 confirmed protected-flag change/i);

    const bulkInput = screen.getByTestId('bulk-confirm-input') as HTMLInputElement;
    expect(bulkInput.placeholder).toBe('BULK-4-ff_school_pulse_v1');

    // 5. Submit the bulk_confirm token -> the resubmitted PATCH must carry
    //    BOTH confirm (the flag name) and bulk_confirm (the token).
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, data: [{ ...PROTECTED_FLAG, enabled: true }] }));
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ ...PROTECTED_FLAG, enabled: true }], total: 1 }));

    fireEvent.change(bulkInput, { target: { value: 'BULK-4-ff_school_pulse_v1' } });
    // Two "Confirm" buttons are on screen at this point (step 1 + step 2) —
    // scope to the burst step's Confirm button.
    const { getByRole } = within(burstStep);
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Confirm' }));
    });

    await waitFor(() => {
      const patchCall = apiFetchMock.mock.calls.find(
        call => call[1]?.method === 'PATCH' && JSON.parse(call[1].body as string).bulk_confirm,
      );
      expect(patchCall).toBeTruthy();
      const parsedBody = JSON.parse((patchCall as [string, RequestInit])[1].body as string);
      expect(parsedBody.confirm).toBe('ff_school_pulse_v1');
      expect(parsedBody.bulk_confirm).toBe('BULK-4-ff_school_pulse_v1');
      expect(parsedBody.updates).toEqual({ enabled: true });
    });

    // 6. The modal closes on success.
    await waitFor(() => expect(screen.queryByTestId('burst-guard-step')).not.toBeInTheDocument());
  });

  it('renders the burst-guard copy in Hindi when isHi is true', async () => {
    mockIsHi = true;
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, LIST_BODY));

    render(<FlagsPage />);
    await screen.findByText('ff_school_pulse_v1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
    });
    const nameInput = await screen.findByPlaceholderText('ff_school_pulse_v1');

    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'burst',
        code: 'FLAG_BULK_CONFIRM_REQUIRED',
        bulk_confirm_required: 'BULK-4-ff_school_pulse_v1',
        recent_mutation_count: 3,
      }),
    );
    fireEvent.change(nameInput, { target: { value: 'ff_school_pulse_v1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /पुष्टि करें/ }));
    });

    const burstStep = await screen.findByTestId('burst-guard-step');
    expect(burstStep).toHaveTextContent(/हाल ही में कई सुरक्षित-फ़्लैग बदलाव/);
  });
});
