import { describe, it, expect, beforeEach, vi } from 'vitest';

// Phase 3-B: seat-cap enforcement on PATCH /api/school-admin/students
// when toggling is_active from false to true. Tests focus on the gate
// itself; the existing route GET path is unchanged.

const { mockAuthorize, mockCapture, rpcState } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCapture: vi.fn().mockResolvedValue(undefined),
  rpcState: {
    scenario: null as SeatScenario | null,
    updateReached: false,
    subscriptionFetched: false,
  },
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: (...a: unknown[]) => mockCapture(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const supabaseChain = { from: vi.fn() };
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseChain,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    rpc: async (fn: string, args: { p_student_id?: string; p_is_active?: boolean }) => {
      if (fn !== 'school_admin_toggle_student_active') {
        throw new Error(`unexpected rpc: ${fn}`);
      }
      const scenario = rpcState.scenario;
      if (!scenario) throw new Error('missing scenario');
      const isActivating = args.p_is_active === true && scenario.studentWasActive !== true;
      if (isActivating) {
        rpcState.subscriptionFetched = true;
        if (scenario.seatsPurchased !== null && scenario.activeCount + 1 > scenario.seatsPurchased) {
          return {
            data: {
              success: false,
              status: 422,
              code: 'seat_cap_violation',
              error: `Cannot activate this student. Your school has used ${scenario.activeCount} of ${scenario.seatsPurchased} seats. Upgrade your subscription to add more.`,
              seats_used: scenario.activeCount,
              seats_purchased: scenario.seatsPurchased,
            },
            error: null,
          };
        }
      }
      rpcState.updateReached = true;
      return {
        data: {
          success: true,
          was_active: scenario.studentWasActive,
          data: {
            id: args.p_student_id,
            name: 'X',
            email: 'x@x',
            grade: '8',
            is_active: args.p_is_active,
          },
        },
        error: null,
      };
    },
  }),
}));

import { PATCH } from '@/app/api/school-admin/students/route';

const SCHOOL_ID = '00000000-0000-0000-0000-0000000000aa';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';
const STUDENT_ID = '00000000-0000-0000-0000-000000000bbb';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/school-admin/students', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface SeatScenario {
  studentWasActive: boolean;
  activeCount: number;
  seatsPurchased: number | null;
}

function setupSupabase(scenario: SeatScenario) {
  rpcState.scenario = scenario;
  rpcState.updateReached = false;
  rpcState.subscriptionFetched = false;
  // The PATCH handler issues these chains against `from('students')`:
  //   A) .select('id, is_active').eq().eq().maybeSingle()   — lookup
  //   B) .select('id', { count: 'exact', head: true }).eq().eq()  — count
  //   C) .update(...).eq().eq().select().select-or-single()  — write
  // We dispatch by the method actually called on the returned builder,
  // not by call order, so deactivation paths (which skip B) work too.
  let subFetchCalled = false;
  let updateChainCalled = false;
  let lookupCalled = false;

  function studentsBuilder() {
    return {
      select: (_: unknown, opts?: { count?: string; head?: boolean }) => {
        // Count chain — opts indicates head:true.
        if (opts?.head) {
          return {
            eq: () => ({
              eq: () => Promise.resolve({ count: scenario.activeCount, error: null }),
            }),
          };
        }
        // Could be: lookup chain (used first), or update().eq().eq().select() (used last).
        // Distinguish by whether updateChainCalled is true at this point.
        if (updateChainCalled) {
          return {
            single: async () => ({
              data: { id: STUDENT_ID, name: 'X', email: 'x@x', grade: '8', is_active: true },
              error: null,
            }),
          };
        }
        // Lookup chain.
        lookupCalled = true;
        return {
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: STUDENT_ID, is_active: scenario.studentWasActive },
                error: null,
              }),
            }),
          }),
        };
      },
      update: () => {
        updateChainCalled = true;
        return {
          eq: () => ({
            eq: () => studentsBuilder(),
          }),
        };
      },
    };
  }

  supabaseChain.from = vi.fn((table: string) => {
    if (table === 'students') return studentsBuilder() as never;
    if (table === 'school_subscriptions') {
      subFetchCalled = true;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                scenario.seatsPurchased === null
                  ? null
                  : { seats_purchased: scenario.seatsPurchased },
              error: null,
            }),
          }),
        }),
      } as never;
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    didFetchSubscription: () => subFetchCalled || rpcState.subscriptionFetched,
    didReachUpdate: () => updateChainCalled || rpcState.updateReached,
    didLookup: () => lookupCalled,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcState.scenario = null;
  rpcState.updateReached = false;
  rpcState.subscriptionFetched = false;
  mockAuthorize.mockResolvedValue({ authorized: true, schoolId: SCHOOL_ID, userId: ADMIN_USER });
});

describe('PATCH /api/school-admin/students — seat-cap', () => {
  it('rejects activation when active+1 would exceed seats_purchased (422)', async () => {
    const probe = setupSupabase({ studentWasActive: false, activeCount: 50, seatsPurchased: 50 });

    const res = await PATCH(makeRequest({ id: STUDENT_ID, is_active: true }) as never);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code?: string; seats_used?: number; seats_purchased?: number };
    expect(json.code).toBe('seat_cap_violation');
    expect(json.seats_used).toBe(50);
    expect(json.seats_purchased).toBe(50);

    expect(mockCapture).toHaveBeenCalledWith(
      'school_seat_cap_hit',
      ADMIN_USER,
      expect.objectContaining({ source: 'student_add', seats_purchased: 50, seats_used: 50 }),
    );
    expect(probe.didReachUpdate()).toBe(false);
  });

  it('allows activation when below cap', async () => {
    const probe = setupSupabase({ studentWasActive: false, activeCount: 49, seatsPurchased: 50 });

    const res = await PATCH(makeRequest({ id: STUDENT_ID, is_active: true }) as never);
    expect(res.status).toBe(200);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(probe.didReachUpdate()).toBe(true);
  });

  it('skips the cap check when deactivating', async () => {
    const probe = setupSupabase({ studentWasActive: true, activeCount: 999, seatsPurchased: 50 });

    const res = await PATCH(makeRequest({ id: STUDENT_ID, is_active: false }) as never);
    expect(res.status).toBe(200);
    expect(mockCapture).not.toHaveBeenCalled();
    // The cap path runs Promise.all([count, sub]); deactivate must skip both.
    expect(probe.didFetchSubscription()).toBe(false);
  });

  it('skips the cap check when re-activating an already active student', async () => {
    const probe = setupSupabase({ studentWasActive: true, activeCount: 999, seatsPurchased: 50 });

    const res = await PATCH(makeRequest({ id: STUDENT_ID, is_active: true }) as never);
    expect(res.status).toBe(200);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(probe.didFetchSubscription()).toBe(false);
  });

  it('allows activation when no school_subscriptions row exists (seats_purchased = null)', async () => {
    setupSupabase({ studentWasActive: false, activeCount: 100, seatsPurchased: null });

    const res = await PATCH(makeRequest({ id: STUDENT_ID, is_active: true }) as never);
    expect(res.status).toBe(200);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
