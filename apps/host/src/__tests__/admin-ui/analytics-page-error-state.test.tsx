/**
 * Super-admin /analytics — page-level error+retry mount test (Slice-1 coverage gap).
 *
 * The Slice-1 primitive (AdminErrorState) is unit-tested in AdminErrorState.test.tsx,
 * but the frontend flagged that no test mounts a REAL super-admin page and proves the
 * page's own fetch-failure branch reaches the primitive with a working retry. This
 * closes that gap for the analytics page — the archetype for the 5 patched pages
 * (analytics / diagnostics / learning / command-center / flags), which all share the
 * same try/catch → throw-on-!res.ok → <AdminErrorState onRetry={fetchAll}> shape.
 *
 * Only two module-boundary seams are mocked — the AdminShell session/context host
 * (so `useAdmin().apiFetch` is a controllable network seam) and the AuthContext
 * bilingual flag. The REAL AnalyticsContent, its real fetch effect, and the real
 * error/skeleton render branches run through the mounted default export. No business
 * logic is mocked; this mirrors the existing learn-chapter-load-error.test.tsx pattern.
 *
 * Asserts:
 *   1. a failed fetch (!res.ok) renders the AdminErrorState alert (not a blank/zeroed
 *      page, not a permanent skeleton), and
 *   2. clicking Retry re-invokes apiFetch (the recovery path the silent-null bug lacked).
 *
 * Owning agent: testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// ── The controllable network seam. apiFetch always resolves to a non-ok Response
//    so the page's `if (!sRes.ok || !vRes.ok) throw` branch fires. `vi.hoisted` so
//    the spy exists when the hoisted vi.mock factory below references it. ──────────
const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(async () => ({ ok: false }) as unknown as Response),
}));

// ── AdminShell host: pass children through and hand the page our controlled
//    apiFetch via useAdmin(). This replaces the real session gate (no token /
//    Supabase client needed) at a clean module boundary. ─────────────────────────
vi.mock('@/app/super-admin/_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => ({ apiFetch }),
}));

// ── Auth: English (isHi=false) so we assert the English default heading. ─────────
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

import AnalyticsPage from '@/app/super-admin/analytics/page';

describe('super-admin /analytics — page-level fetch-failure → retryable AdminErrorState', () => {
  beforeEach(() => {
    apiFetch.mockClear();
  });
  afterEach(() => cleanup());

  it('renders the AdminErrorState alert when the stats/analytics fetch fails (not a blank page)', async () => {
    render(<AnalyticsPage />);

    // The real error branch resolves the alert (skeleton → alert), and the
    // page fired both backbone fetches.
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Couldn.t load data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('re-invokes the fetch when Retry is clicked (the recovery path the silent-null bug lacked)', async () => {
    render(<AnalyticsPage />);
    await screen.findByRole('alert');
    expect(apiFetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // onRetry === the page's fetchAll → both endpoints hit again.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4));
    // Still an alert (fetch keeps failing) — the branch is re-entrant, not a dead end.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
