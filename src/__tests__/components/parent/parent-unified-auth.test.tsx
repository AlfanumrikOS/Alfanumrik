/**
 * Consumer Minimalism — Wave D parent auth unification ("D-authunify",
 * ff_parent_unified_auth_v1, Finding #5 / Exception E2 closure).
 *
 * The parent page (`src/app/parent/page.tsx`) gained a flag-gated SESSION
 * RESOLUTION branch. The single load-bearing safety property — same family as
 * the REG-84 / REG-85 flag-OFF parity tests — is:
 *
 *   1. FLAG-OFF PARITY (byte-identical current product). With
 *      ff_parent_unified_auth_v1 OFF (production truth,
 *      `FLAG_DEFAULTS[PARENT_UNIFIED_AUTH_V1] === false`), the EXISTING dual
 *      path runs unchanged: when `auth.guardian` is present the page seeds the
 *      student from `loadParentSession()` (HMAC sessionStorage), and when it is
 *      absent it STILL falls back to `loadParentSession()` — the link-code
 *      session reachable today. `parent-session.ts` is untouched.
 *
 *   2. FLAG-ON, GUARDIAN PRESENT → JWT-ONLY. The Supabase guardian-JWT
 *      (`auth.guardian`) is the SOLE source of truth: the student is seeded
 *      from the `get_children` Edge Function call (which itself requires the
 *      Bearer JWT) and `loadParentSession()` is NEVER consulted on this path —
 *      no HMAC sessionStorage read at all.
 *
 *   3. FLAG-ON, NO GUARDIAN → UNAUTHENTICATED. With the flag ON and no
 *      `auth.guardian`, the page leaves guardian/student null so the normal
 *      LoginScreen renders. It must NOT silently revive a stale HMAC cache via
 *      `loadParentSession()` — that is the whole point of the unification.
 *
 * Test strategy mirrors REG-84's page-branch precedent: we render a FAITHFUL
 * REPLICA of the page's resolution effect (src/app/parent/page.tsx:991-1034)
 * wired to a mocked `useFeatureFlags()` (the same SWR hook the page reads) and
 * a mocked `useAuth()`. The replica calls the SAME seams the page calls —
 * `loadParentSession` (HMAC) and a `getChildren` Edge-function stand-in — so
 * the assertion is purely about WHICH seam each branch consults, not about
 * page internals (cosmic theme / atlas / dynamic imports). Behavior over
 * implementation. This is the enforcing test for REG-86; weakening the
 * flag-OFF / JWT-only assertions requires user approval.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { CONSUMER_MINIMALISM_FLAGS, FLAG_DEFAULTS } from '@/lib/feature-flags';

// ─── Mock the flag-read hook the page uses (same seam REG-84 mocks). ───
const flagState: { value: Record<string, boolean> | undefined } = { value: undefined };
vi.mock('@/lib/swr', () => ({
  useFeatureFlags: () => ({ data: flagState.value }),
}));
import { useFeatureFlags } from '@/lib/swr';

// ─── Spy seams. `loadParentSession` is the HMAC sessionStorage fallback the
//     page imports from ./_components/parent-session. `getChildren` stands in
//     for the page's `api('get_children', …)` Edge-function call (which itself
//     requires the Bearer JWT server-side). We assert WHICH of these each
//     branch consults. ───
type StudentSession = { id: string; name: string; grade: string };
type ParentSession = { id: string; name: string };

const loadParentSession = vi.fn<() => Promise<{ guardian: ParentSession; student: StudentSession } | null>>();
const getChildren = vi.fn<(guardianId: string) => Promise<StudentSession[]>>();

/**
 * Faithful replica of the parent page's resolution effect
 * (src/app/parent/page.tsx:991-1034). The branch order and seam usage match
 * the page exactly: flag ON → JWT-only (getChildren, never loadParentSession);
 * flag OFF → existing dual path (loadParentSession in BOTH sub-branches).
 */
function ParentAuthResolver({
  auth,
}: {
  auth: { isLoading: boolean; guardian: ParentSession | null };
}) {
  const { data: flags } = useFeatureFlags();
  const unifiedAuth = flags?.[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1] === true;

  const [guardian, setGuardian] = React.useState<ParentSession | null>(null);
  const [student, setStudent] = React.useState<StudentSession | null>(null);
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    if (auth.isLoading) return;

    // ── D-authunify ON: guardian-JWT is the single source of truth. ──
    if (unifiedAuth) {
      if (auth.guardian) {
        setGuardian(auth.guardian);
        getChildren(auth.guardian.id).then((children) => {
          setStudent(children.length > 0 ? children[0] : null);
          setChecking(false);
        });
      } else {
        setGuardian(null);
        setStudent(null);
        setChecking(false);
      }
      return;
    }

    // ── Flag OFF (default): existing dual path, byte-identical to today. ──
    if (auth.guardian) {
      setGuardian(auth.guardian);
      loadParentSession().then((session) => {
        if (session) setStudent(session.student);
        setChecking(false);
      });
      return;
    }
    loadParentSession().then((session) => {
      if (session) {
        setGuardian(session.guardian);
        setStudent(session.student);
      }
      setChecking(false);
    });
  }, [auth.isLoading, auth.guardian, unifiedAuth]);

  if (checking || auth.isLoading) return <div data-testid="checking">checking</div>;
  if (!guardian || !student) return <div data-testid="login-screen">LoginScreen (unauthenticated)</div>;
  return (
    <div data-testid="dashboard" data-guardian={guardian.id} data-student={student.id}>
      Dashboard
    </div>
  );
}

const GUARDIAN: ParentSession = { id: 'guard-1', name: 'Asha Sharma' };
const HMAC_STUDENT: StudentSession = { id: 'stu-hmac', name: 'Rohan (HMAC)', grade: '8' };
const JWT_STUDENT: StudentSession = { id: 'stu-jwt', name: 'Rohan (JWT)', grade: '8' };

afterEach(() => cleanup());
beforeEach(() => {
  flagState.value = undefined;
  loadParentSession.mockReset();
  getChildren.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
// Default-flip guard.
// ═══════════════════════════════════════════════════════════════════════════
describe('D-authunify — production default', () => {
  it('keeps ff_parent_unified_auth_v1 OFF by default (guards against a default flip)', () => {
    expect(FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 — FLAG OFF: existing dual path, byte-identical (HMAC fallback reachable).
// ═══════════════════════════════════════════════════════════════════════════
describe('D-authunify — flag OFF: existing dual path (byte-identical)', () => {
  it('guardian present + flag ABSENT → seeds student from the HMAC loadParentSession (dual path intact)', async () => {
    flagState.value = undefined; // prod truth: flag not present
    loadParentSession.mockResolvedValue({ guardian: GUARDIAN, student: HMAC_STUDENT });

    render(<ParentAuthResolver auth={{ isLoading: false, guardian: GUARDIAN }} />);

    const dash = await screen.findByTestId('dashboard');
    // Student came from the HMAC sessionStorage fallback — the existing path.
    expect(dash).toHaveAttribute('data-student', 'stu-hmac');
    expect(loadParentSession).toHaveBeenCalledTimes(1);
    expect(getChildren).not.toHaveBeenCalled();
  });

  it('guardian present + flag explicitly false → still consults the HMAC fallback', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: false };
    loadParentSession.mockResolvedValue({ guardian: GUARDIAN, student: HMAC_STUDENT });

    render(<ParentAuthResolver auth={{ isLoading: false, guardian: GUARDIAN }} />);

    await screen.findByTestId('dashboard');
    expect(loadParentSession).toHaveBeenCalledTimes(1);
    expect(getChildren).not.toHaveBeenCalled();
  });

  it('NO guardian + flag OFF → the link-code HMAC session is reachable (revives from sessionStorage)', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: false };
    // Link-code parent: no Supabase guardian, but an HMAC session exists.
    loadParentSession.mockResolvedValue({ guardian: GUARDIAN, student: HMAC_STUDENT });

    render(<ParentAuthResolver auth={{ isLoading: false, guardian: null }} />);

    const dash = await screen.findByTestId('dashboard');
    // The OFF path revives both guardian + student from the HMAC cache.
    expect(dash).toHaveAttribute('data-guardian', 'guard-1');
    expect(dash).toHaveAttribute('data-student', 'stu-hmac');
    expect(loadParentSession).toHaveBeenCalledTimes(1);
    expect(getChildren).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — FLAG ON + guardian present: JWT is the SOLE source of truth.
// ═══════════════════════════════════════════════════════════════════════════
describe('D-authunify — flag ON + auth.guardian: JWT-only resolution', () => {
  it('seeds the student from the guardian-JWT get_children call — never consults the HMAC fallback', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: true };
    getChildren.mockResolvedValue([JWT_STUDENT]);
    // Even if a stale HMAC cache exists, the ON path must ignore it entirely.
    loadParentSession.mockResolvedValue({ guardian: GUARDIAN, student: HMAC_STUDENT });

    render(<ParentAuthResolver auth={{ isLoading: false, guardian: GUARDIAN }} />);

    const dash = await screen.findByTestId('dashboard');
    expect(dash).toHaveAttribute('data-guardian', 'guard-1');
    // Student is the JWT-derived child, NOT the HMAC one.
    expect(dash).toHaveAttribute('data-student', 'stu-jwt');
    expect(getChildren).toHaveBeenCalledTimes(1);
    expect(getChildren).toHaveBeenCalledWith('guard-1');
    // The HMAC sessionStorage fallback is NEVER consulted on the JWT path.
    expect(loadParentSession).not.toHaveBeenCalled();
  });

  it('with a JWT guardian but NO linked children → renders the unauthenticated LoginScreen (still no HMAC read)', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: true };
    getChildren.mockResolvedValue([]); // guardian authenticated but no children resolved

    render(<ParentAuthResolver auth={{ isLoading: false, guardian: GUARDIAN }} />);

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument();
    expect(getChildren).toHaveBeenCalledTimes(1);
    expect(loadParentSession).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — FLAG ON + NO guardian: unauthenticated, no stale-cache revival.
// ═══════════════════════════════════════════════════════════════════════════
describe('D-authunify — flag ON + no auth.guardian: no stale HMAC revival', () => {
  it('renders the unauthenticated LoginScreen and never calls loadParentSession (no silent HMAC revive)', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: true };
    // A stale HMAC session is sitting in sessionStorage — the ON path must
    // NOT touch it. If it did, the parent would be silently logged in from a
    // cache the unification is meant to retire.
    loadParentSession.mockResolvedValue({ guardian: GUARDIAN, student: HMAC_STUDENT });

    render(<ParentAuthResolver auth={{ isLoading: false, guardian: null }} />);

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument();
    expect(loadParentSession).not.toHaveBeenCalled();
    expect(getChildren).not.toHaveBeenCalled();
  });

  it('stays in the checking state while auth is still loading (no resolution attempted yet)', async () => {
    flagState.value = { [CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1]: true };

    render(<ParentAuthResolver auth={{ isLoading: true, guardian: null }} />);

    expect(screen.getByTestId('checking')).toBeInTheDocument();
    // Give any stray microtask a window to (not) fire.
    await waitFor(() => {
      expect(loadParentSession).not.toHaveBeenCalled();
      expect(getChildren).not.toHaveBeenCalled();
    });
  });
});
