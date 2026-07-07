/**
 * AuthContext P15 null-student hydration — incident fix pin (2026-07-02).
 *
 * THE INCIDENT
 * ============
 * When `get_user_role` resolved a STUDENT role (rd.student present) but the
 * SECONDARY full-row read of `public.students` returned 0 rows, the old code used
 * `.single()` — which REJECTS with PGRST116 on 0 rows. The throw aborted the whole
 * role-resolution branch; because the parallel rescue block is guarded by
 * `if (!rolesResolved)` and rolesResolved was already true, the student was left
 * permanently `null` while `isLoggedIn` stayed true → StudentOSDashboard skeletoned
 * forever. (This was the surface symptom of the RLS-recursion incident: every
 * client read of `students` was failing, so the secondary read came back empty.)
 *
 * THE FIX (src/lib/AuthContext.tsx:349-402)
 * =========================================
 *  1. The secondary read uses `.maybeSingle()` (0 rows ⇒ data:null, no throw).
 *  2. A defensive re-read by `auth_user_id` runs if the by-id read was empty.
 *  3. If BOTH come back null, `student` is hydrated from the RPC's OWN `rd.student`
 *     payload (id/name/grade/onboarding_completed) instead of being left null —
 *     so a logged-in student is NEVER stranded with `student === null`. The grade
 *     is passed through `normalizeGrade` (P5) and `onboarding_completed` is taken
 *     VERBATIM from the RPC (it drives the `/onboarding` redirect).
 *
 * APPROACH (the lightest faithful path — exercises the REAL code)
 * ===============================================================
 * The fix is an inline branch with no extracted helper, so the only faithful pin is
 * to mount the REAL AuthProvider with the supabase client mocked at the module
 * boundary (mirroring `auth-context-bootstrap-bearer.test.tsx`) and assert on the
 * `student` the context actually exposes. We do NOT replicate the branch logic.
 *
 * Owner: testing. Catalog: REG-211. Invariant: P15.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── supabase client mock (module boundary) ──────────────────────────────────
const getSessionMock = vi.fn();
const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const onAuthStateChangeMock = vi.fn((..._args: unknown[]) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
  getStudentSnapshot: vi.fn().mockResolvedValue(null),
}));

// Non-critical side-effect modules — keep the auth path light.
vi.mock('@alfanumrik/lib/swr', () => ({ clearAllCache: vi.fn() }));
vi.mock('@alfanumrik/lib/use-atlas-flag', () => ({ clearAtlasFlagCache: vi.fn() }));
vi.mock('@alfanumrik/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@alfanumrik/lib/posthog/client', () => ({ identify: vi.fn(), reset: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────────────────────────
const AUTH_USER_ID = 'auth-user-p15-1';
const STUDENT_ID = 'student-p15-1';

function makeUser() {
  return { id: AUTH_USER_ID, email: 'kid@example.com', user_metadata: { role: 'student' } };
}

/** RoleData payload carrying a STUDENT role + an rd.student the fallback can use. */
function roleData(overrides?: Partial<Record<string, unknown>>) {
  return {
    roles: ['student'],
    primary_role: 'student',
    student: {
      id: STUDENT_ID,
      name: 'Aanya',
      grade: 'Grade 9', // intentionally legacy-prefixed → normalizeGrade ⇒ '9'
      onboarding_completed: true,
    },
    teacher: null,
    guardian: null,
    ...overrides,
  };
}

/**
 * Chainable students mock. `.eq('id', …)` and `.eq('auth_user_id', …)` resolve to
 * the configured rows. A fresh chain is returned per `.from('students')` call so
 * the two sequential reads don't bleed into each other.
 */
function studentsChain(byId: unknown, byAuthUserId: unknown) {
  let lastCol: string | null = null;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string) => {
    lastCol = col;
    return chain;
  };
  chain.maybeSingle = () => {
    if (lastCol === 'id') return Promise.resolve({ data: byId, error: null });
    if (lastCol === 'auth_user_id') return Promise.resolve({ data: byAuthUserId, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  chain.single = () => Promise.resolve({ data: null, error: null });
  return chain;
}

async function mountWithProbe() {
  const { AuthProvider, useAuth } = await import('@alfanumrik/lib/AuthContext');
  function Probe() {
    const { student, isLoggedIn } = useAuth();
    return (
      <div>
        <span data-testid="loggedIn">{String(isLoggedIn)}</span>
        <span data-testid="student-null">{String(student === null)}</span>
        <span data-testid="student-id">{student?.id ?? ''}</span>
        <span data-testid="student-grade">{student?.grade ?? ''}</span>
        <span data-testid="student-onboarding">
          {student ? String(student.onboarding_completed) : ''}
        </span>
        <span data-testid="student-name">{student?.name ?? ''}</span>
      </div>
    );
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  // Logged-in student session.
  getSessionMock.mockResolvedValue({ data: { session: { user: makeUser() } } });
  getUserMock.mockResolvedValue({ data: { user: makeUser() }, error: null });

  // get_user_role RPC: chainable `.abortSignal()` resolving to the role payload.
  rpcMock.mockImplementation(() => ({
    abortSignal: () => Promise.resolve({ data: roleData(), error: null }),
  }));

  // Default: every students read returns 0 rows (the incident condition).
  fromMock.mockImplementation((table: string) =>
    table === 'students' ? studentsChain(null, null) : studentsChain(null, null),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE FIX — both full-row reads return 0 rows, yet `student` is hydrated from
//    the RPC's rd.student payload (never left null). This is the regression that
//    skeletoned the dashboard forever before the maybeSingle + fallback fix.
// ════════════════════════════════════════════════════════════════════════════
describe('AuthContext P15: student hydrated from rd.student when the profile read is empty', () => {
  it('never leaves a logged-in student with student === null (both reads return 0 rows)', async () => {
    await mountWithProbe();

    await waitFor(
      () => {
        expect(screen.getByTestId('student-id').textContent).toBe(STUDENT_ID);
      },
      { timeout: 8000 },
    );

    // The core invariant: logged in AND student is non-null.
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');
    expect(screen.getByTestId('student-null').textContent).toBe('false');
  });

  it('carries the RPC grade (normalized to bare P5 form) and onboarding_completed verbatim', async () => {
    await mountWithProbe();

    await waitFor(
      () => {
        expect(screen.getByTestId('student-id').textContent).toBe(STUDENT_ID);
      },
      { timeout: 8000 },
    );

    // normalizeGrade('Grade 9') ⇒ '9' (P5: bare string, never prefixed/integer).
    expect(screen.getByTestId('student-grade').textContent).toBe('9');
    // onboarding_completed taken VERBATIM from rd.student (drives the /onboarding redirect).
    expect(screen.getByTestId('student-onboarding').textContent).toBe('true');
    expect(screen.getByTestId('student-name').textContent).toBe('Aanya');
  });

  it('respects onboarding_completed=false from the RPC payload (no hardcoded true)', async () => {
    rpcMock.mockImplementation(() => ({
      abortSignal: () =>
        Promise.resolve({
          data: roleData({
            student: {
              id: STUDENT_ID,
              name: 'Aanya',
              grade: '7',
              onboarding_completed: false,
            },
          }),
          error: null,
        }),
    }));

    await mountWithProbe();

    await waitFor(
      () => {
        expect(screen.getByTestId('student-id').textContent).toBe(STUDENT_ID);
      },
      { timeout: 8000 },
    );

    expect(screen.getByTestId('student-onboarding').textContent).toBe('false');
    expect(screen.getByTestId('student-grade').textContent).toBe('7');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. DEFENSIVE RE-READ — when the by-id read is empty but the auth_user_id re-read
//    succeeds, `student` is hydrated from the FULL row (richer than rd.student),
//    still non-null. Proves the fix's second branch is wired and used.
// ════════════════════════════════════════════════════════════════════════════
describe('AuthContext P15: defensive auth_user_id re-read hydrates the full row', () => {
  it('uses the full row from the auth_user_id re-read when the by-id read is empty', async () => {
    const fullRow = {
      id: STUDENT_ID,
      auth_user_id: AUTH_USER_ID,
      name: 'Aanya Full',
      grade: 'Grade 10', // normalizeGrade ⇒ '10'
      onboarding_completed: true,
      preferred_language: 'hi',
    };
    fromMock.mockImplementation((table: string) =>
      table === 'students' ? studentsChain(null, fullRow) : studentsChain(null, null),
    );

    await mountWithProbe();

    await waitFor(
      () => {
        expect(screen.getByTestId('student-id').textContent).toBe(STUDENT_ID);
      },
      { timeout: 8000 },
    );

    expect(screen.getByTestId('student-null').textContent).toBe('false');
    expect(screen.getByTestId('student-name').textContent).toBe('Aanya Full');
    expect(screen.getByTestId('student-grade').textContent).toBe('10');
  });
});
