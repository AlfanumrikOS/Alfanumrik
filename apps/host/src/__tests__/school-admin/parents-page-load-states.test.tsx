/**
 * SchoolAdminParentsPage — admin-record load resilience + empty state (render unit).
 *
 * WHY THIS EXISTS
 *   fetchAdminRecord was refactored to try/catch/finally so loadingAdmin ALWAYS
 *   clears — even on the redirect branch — preventing an infinite full-page
 *   skeleton. Three distinct outcomes are now pinned:
 *     (a) school_admins query ERROR → inline, retryable error card; loading clears;
 *         the admin is NOT bounced to /login (they can retry).
 *     (b) NO record (genuine "not a school admin") → redirect to /login AND
 *         loading clears (finally runs even on the early return).
 *     (c) record OK + parents list EMPTY → the friendly empty state renders; an
 *         empty list is NOT treated as an error.
 *
 *   Seams: AuthContext (authed), supabase (school_admins), supabase-client (the
 *   token read behind authedFetch — see the mock's comment; it is load-bearing,
 *   not redundant), next/navigation (router.replace spy), global fetch (parents
 *   API). The real @alfanumrik/ui/ui primitives render (they are
 *   dependency-light), so the page's own copy is assertable on screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const SCHOOL_ID = '11111111-1111-4111-a111-111111111111';

// ── Auth: signed in, English ──────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: 'admin-user-1',
    isLoading: false,
    isHi: false,
    setLanguage: vi.fn(),
  }),
}));

// ── Router spy ────────────────────────────────────────────────────────────────
// IMPORTANT: useRouter MUST return a STABLE object. fetchAdminRecord is a
// useCallback that lists `router` in its deps; a fresh object each render would
// change its identity every render and re-fire the admin-record effect in an
// infinite loop (loadingAdmin would never settle).
const routerReplace = vi.fn();
const routerPush = vi.fn();
const stableRouter = { replace: routerReplace, push: routerPush };
vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
}));

// ── Supabase: school_admins maybeSingle() result is controllable per test ─────
const adminResult: { value: { data: unknown; error: unknown } } = {
  value: { data: { school_id: SCHOOL_ID, name: 'Principal Sharma' }, error: null },
};

vi.mock('@alfanumrik/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  ['select', 'eq'].forEach((m) => { builder[m] = vi.fn().mockReturnValue(builder); });
  builder.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(adminResult.value));
  return {
    supabase: {
      from: vi.fn(() => builder),
      // NOTE: this `auth.getSession` is NOT the one the parent-links request
      // uses — see the supabase-client mock immediately below for why. It is
      // kept only so this mock stays a faithful shape-match for the real module.
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }),
      },
    },
  };
});

// ── Supabase CLIENT: the seam authedFetch actually uses ───────────────────────
//
// ⚠️  DO NOT DELETE THIS MOCK. It looks redundant next to the mock above. It is
// not: it is the difference between a deterministic test and an intermittent CI
// failure, and the reason is genuinely non-obvious.
//
// The page imports `supabase` from '@alfanumrik/lib/supabase' (mocked above) for
// its school_admins read. But it loads parent links through authedFetch(), and
// authedFetch → getAccessToken() imports `supabase` from a DIFFERENT specifier:
// '@alfanumrik/lib/supabase-client' (packages/lib/src/authed-fetch.ts:25).
// vi.mock is keyed by specifier, and supabase.ts merely RE-EXPORTS from
// supabase-client.ts — so mocking supabase.ts does NOT mock supabase-client.ts.
//
// Without this mock, authedFetch awaited a REAL @supabase/supabase-js client.
// Measured, not assumed: the mocked getSession above recorded 0 calls while
// '@alfanumrik/lib/supabase-client' resolved to a live `SupabaseClient`. Every
// parent-links load therefore ran the real GoTrue state machine — process lock,
// initializePromise, storage recovery — against the placeholder URL. That path
// does resolve, but in a NON-DETERMINISTIC number of async ticks, and that tick
// count is exactly what decides whether the settled empty state has repainted by
// the time the assertions in (c) run. It was the engine of a flake that was
// green 20/20 in isolation and intermittently red only under a loaded 4-way
// sharded CI run (PR #1605).
//
// Mocking the real seam also restores the hermeticity contract that
// `src/__tests__/setup.ts` exists to enforce: the unit lane builds no live
// backend clients.
vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }),
    },
  },
}));

import SchoolAdminParentsPage from '@/app/school-admin/parents/page';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routerReplace.mockClear();
  // Default: parents API returns an empty links list (success, no error).
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { links: [] } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  // Reset admin result to the happy default; per-test overrides below.
  adminResult.value = { data: { school_id: SCHOOL_ID, name: 'Principal Sharma' }, error: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parents page — (a) admin-record query error', () => {
  it('clears loading and shows a retryable error card instead of spinning forever', async () => {
    adminResult.value = { data: null, error: { message: 'db down' } };

    render(React.createElement(SchoolAdminParentsPage));

    // The inline error copy from the page renders…
    await waitFor(() =>
      expect(
        screen.getByText('We couldn’t load your school admin account. Please try again.'),
      ).toBeDefined(),
    );
    // …with a Retry affordance…
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    // …and the admin is NOT redirected (they can retry in place).
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe('parents page — (b) no school-admin record', () => {
  it('redirects to /login and clears loading (finally runs on the early return)', async () => {
    adminResult.value = { data: null, error: null };

    render(React.createElement(SchoolAdminParentsPage));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/login'));
    // No error card on a genuine "not a school admin" — it's a redirect, not a failure.
    expect(
      screen.queryByText('We couldn’t load your school admin account. Please try again.'),
    ).toBeNull();
  });
});

describe('parents page — (c) empty parents list is NOT an error', () => {
  it('renders the friendly empty state, not an error card', async () => {
    // adminResult + fetch defaults: valid admin, empty links.
    render(React.createElement(SchoolAdminParentsPage));

    // ⚠️  ASSERT THE SETTLED STATE, IN ONE SNAPSHOT. Do not split these back into
    // `await waitFor(heading)` followed by a bare synchronous `getByText(...)`.
    //
    // The page renders this empty state TWICE, and only the second one is real:
    //
    //   1. TRANSIENTLY — in the single commit where `schoolId` has landed
    //      (loadingAdmin false) but the `[schoolId]` effect that calls
    //      fetchParentLinks has not run yet. At that instant `loadingLinks` is
    //      still false and `parentLinks` is still [], so the
    //      `!loadingLinks && !linksError && parentLinks.length === 0` guard is
    //      TRUE and the empty state paints — before the request even fires.
    //   2. FOR REAL — after the request resolves with zero links.
    //
    //   Between the two, `setLoadingLinks(true)` swaps the empty state out for
    //   five ParentRowSkeletons. A `waitFor` on the heading alone can latch onto
    //   render (1); a synchronous assertion on the next line then executes inside
    //   the skeleton window and fails with a DOM full of `animate-pulse`. That is
    //   the observed CI failure, reproduced deterministically by delaying the
    //   links request by one macrotask.
    //
    //   Requiring the request to have been ISSUED before accepting the empty
    //   state excludes render (1) by construction, so what is pinned here is the
    //   post-request state — strictly more than the original assertion proved.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/school-admin/parents', expect.anything());
      expect(screen.getByText('No parents linked yet')).toBeDefined();
      // The empty state's guidance copy is present…
      expect(screen.getByText(/Parents can join via your school invite code/)).toBeDefined();
    });

    // …and the admin-record error card is NOT shown for an empty (successful) list.
    expect(
      screen.queryByText('We couldn’t load your school admin account. Please try again.'),
    ).toBeNull();
  });
});
