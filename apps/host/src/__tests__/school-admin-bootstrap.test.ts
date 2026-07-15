/**
 * ensureSchoolAdminOnboarding() — Phase 3b unified institution_admin onboarding.
 *
 * Pins the three guarantees of the single school-admin onboarding helper
 * (packages/lib/src/identity/school-admin-bootstrap.ts) that both the self-serve
 * email flow (complete-signup.ts) and the trial/bulk provisioning path share:
 *
 *   1. RPC-FIRST success — the idempotent bootstrap_user_profile RPC creates
 *      schools + school_admins(role='principal') + onboarding_state through the
 *      shared funnel, and the helper then PATCHES city/state/principal_name onto
 *      the school row (the columns the RPC signature cannot carry).
 *   2. ADMIN-CLIENT FALLBACK — when the RPC is unavailable, the helper creates
 *      the rows directly with the canonical role 'principal', writes city/state,
 *      and upserts onboarding_state. School signup is never blocked (P15).
 *   3. FAIL-SOFT (P15) — a failed onboarding_state write does NOT throw or block
 *      signup; the helper still returns ok=true with onboardingStateWritten=false.
 *
 * Mock strategy: mock ONLY the Supabase admin client seam
 * (@alfanumrik/lib/supabase-admin::getSupabaseAdmin) — the business logic under
 * test (RPC-vs-fallback branching, normalization, patch, upsert) runs for real.
 * A per-table fake admin client captures every write so we assert on OUTPUTS
 * (what got written / returned), not internal state. Each test builds its own
 * fake — no shared mutable state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Admin-client seam ────────────────────────────────────────────────
// getSupabaseAdmin() is read at CALL time inside ensureSchoolAdminOnboarding,
// so a per-test `currentAdmin` swap is picked up by the once-imported module.
let currentAdmin: unknown;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => currentAdmin,
}));

import { ensureSchoolAdminOnboarding } from '@alfanumrik/lib/identity/school-admin-bootstrap';

// ── Fake admin client ─────────────────────────────────────────────────

interface Captured {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  schoolInserts: Array<Record<string, unknown>>;
  adminInserts: Array<Record<string, unknown>>;
  schoolUpdates: Array<Record<string, unknown>>;
  onboardingUpserts: Array<{ row: Record<string, unknown>; opts: unknown }>;
  existingChecks: number;
  schoolIdLookups: number;
}

interface Result {
  data: unknown;
  error: unknown;
}

interface AdminScenario {
  /** RPC response ({ data, error }). Default: success returning profile_id 'sa-rpc-1'. */
  rpcResult?: Result;
  /** If true, admin.rpc(...) throws (transport blew up) instead of resolving. */
  rpcThrows?: boolean;
  /** Fallback existing-admin reuse check result (school_admins by auth_user_id). */
  existingSchoolAdminId?: string | null;
  /** Fallback schools.insert(...).select('id').single() result. */
  schoolInsertResult?: Result;
  /** Fallback school_admins.insert(...).select('id').single() result. */
  adminInsertResult?: Result;
  /** resolveSchoolIdForAdmin: school_admins.select('school_id').eq('id',...) result. */
  schoolIdForAdmin?: string | null;
  /** patchSchoolDetails: schools.update(...).eq('id',...) result. */
  updateResult?: Result;
  /** writeSchoolAdminOnboardingState: onboarding_state.upsert(...) result. */
  upsertResult?: Result;
}

function makeAdmin(scenario: AdminScenario) {
  const captured: Captured = {
    rpcCalls: [],
    schoolInserts: [],
    adminInserts: [],
    schoolUpdates: [],
    onboardingUpserts: [],
    existingChecks: 0,
    schoolIdLookups: 0,
  };

  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      captured.rpcCalls.push({ name, args });
      if (scenario.rpcThrows) throw new Error('rpc transport blew up');
      return (
        scenario.rpcResult ?? {
          data: { status: 'success', profile_id: 'sa-rpc-1' },
          error: null,
        }
      );
    }),
    from: (table: string) => ({
      select: (cols: string) => {
        const terminal = (): Result => {
          if (table === 'school_admins' && cols === 'school_id') {
            captured.schoolIdLookups += 1;
            return {
              data:
                scenario.schoolIdForAdmin != null
                  ? { school_id: scenario.schoolIdForAdmin }
                  : null,
              error: null,
            };
          }
          if (table === 'school_admins' && cols === 'id') {
            captured.existingChecks += 1;
            return {
              data: scenario.existingSchoolAdminId
                ? { id: scenario.existingSchoolAdminId }
                : null,
              error: null,
            };
          }
          return { data: null, error: null };
        };
        // .eq() supports BOTH a direct terminal (resolveSchoolIdForAdmin:
        // .eq().maybeSingle()) AND the fallback reuse chain
        // (.eq().order().limit().maybeSingle()).
        const eqBuilder = {
          maybeSingle: async () => terminal(),
          single: async () => terminal(),
          order: () => ({
            limit: () => ({
              maybeSingle: async () => terminal(),
            }),
          }),
        };
        return { eq: () => eqBuilder };
      },
      insert: (row: Record<string, unknown>) => {
        if (table === 'schools') captured.schoolInserts.push(row);
        else if (table === 'school_admins') captured.adminInserts.push(row);
        return {
          select: () => ({
            single: async (): Promise<Result> => {
              if (table === 'schools')
                return (
                  scenario.schoolInsertResult ?? {
                    data: { id: 'school-fb-1' },
                    error: null,
                  }
                );
              if (table === 'school_admins')
                return (
                  scenario.adminInsertResult ?? {
                    data: { id: 'sa-fb-1' },
                    error: null,
                  }
                );
              return { data: null, error: null };
            },
          }),
        };
      },
      update: (row: Record<string, unknown>) => {
        if (table === 'schools') captured.schoolUpdates.push(row);
        return {
          eq: async (): Promise<Result> =>
            scenario.updateResult ?? { data: null, error: null },
        };
      },
      upsert: (row: Record<string, unknown>, opts: unknown) => {
        if (table === 'onboarding_state')
          captured.onboardingUpserts.push({ row, opts });
        return Promise.resolve(
          scenario.upsertResult ?? { data: null, error: null }
        );
      },
    }),
  };

  return { admin, captured };
}

const BASE_PARAMS = {
  authUserId: 'auth-sa-1',
  name: 'Priya Menon',
  email: 'principal@dps.example.com',
  schoolName: 'Delhi Public School',
  city: 'Jaipur',
  state: 'Rajasthan',
  board: 'CBSE',
  principalName: 'Priya Menon',
  phone: '+919876500000',
};

beforeEach(() => {
  // Keep expected fail-soft console.error/warn noise out of the reporter.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. RPC-first success + city/state patch ─────────────────────────────

describe('ensureSchoolAdminOnboarding — RPC-first success', () => {
  it('creates via bootstrap_user_profile RPC then patches city/state, no direct-insert fallback', async () => {
    const { admin, captured } = makeAdmin({
      rpcResult: {
        data: { status: 'success', profile_id: 'sa-rpc-1' },
        error: null,
      },
      schoolIdForAdmin: 'school-rpc-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(BASE_PARAMS);

    // RPC was the primary creation path, with the institution_admin role +
    // normalized school_name/board threaded through.
    expect(captured.rpcCalls).toHaveLength(1);
    expect(captured.rpcCalls[0].name).toBe('bootstrap_user_profile');
    expect(captured.rpcCalls[0].args.p_role).toBe('institution_admin');
    expect(captured.rpcCalls[0].args.p_school_name).toBe('Delhi Public School');
    expect(captured.rpcCalls[0].args.p_board).toBe('CBSE');

    // Idempotency: the direct-insert fallback did NOT run (RPC yielded an id).
    expect(captured.schoolInserts).toHaveLength(0);
    expect(captured.adminInserts).toHaveLength(0);

    // city/state (+ principal_name) patched onto the RPC-created school row.
    expect(captured.schoolUpdates).toHaveLength(1);
    expect(captured.schoolUpdates[0]).toMatchObject({
      city: 'Jaipur',
      state: 'Rajasthan',
      principal_name: 'Priya Menon',
    });

    // onboarding_state written on the canonical funnel path.
    expect(captured.onboardingUpserts).toHaveLength(1);
    expect(captured.onboardingUpserts[0].row).toMatchObject({
      auth_user_id: 'auth-sa-1',
      intended_role: 'institution_admin',
      step: 'completed',
      profile_id: 'sa-rpc-1',
    });

    expect(result).toEqual({
      ok: true,
      schoolId: 'school-rpc-1',
      schoolAdminId: 'sa-rpc-1',
      onboardingStateWritten: true,
    });
  });
});

// ── 2. Admin-client fallback when the RPC is unavailable ────────────────

describe('ensureSchoolAdminOnboarding — admin-client fallback', () => {
  it('creates schools + school_admins(role=principal) directly when the RPC is unavailable', async () => {
    const { admin, captured } = makeAdmin({
      // RPC unavailable (e.g. function missing) → schoolAdminId stays null →
      // the direct-insert fallback runs.
      rpcResult: {
        data: null,
        error: { message: 'function bootstrap_user_profile(...) does not exist' },
      },
      existingSchoolAdminId: null, // no prior membership → fresh insert
      schoolInsertResult: { data: { id: 'school-fb-1' }, error: null },
      adminInsertResult: { data: { id: 'sa-fb-1' }, error: null },
      schoolIdForAdmin: 'school-fb-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(BASE_PARAMS);

    // The RPC was attempted first (primary path), then fell back.
    expect(captured.rpcCalls).toHaveLength(1);

    // schools row created with name/board/city/state written directly.
    expect(captured.schoolInserts).toHaveLength(1);
    expect(captured.schoolInserts[0]).toMatchObject({
      name: 'Delhi Public School',
      board: 'CBSE',
      city: 'Jaipur',
      state: 'Rajasthan',
    });

    // school_admins row created with the CANONICAL role 'principal'.
    expect(captured.adminInserts).toHaveLength(1);
    expect(captured.adminInserts[0]).toMatchObject({
      auth_user_id: 'auth-sa-1',
      school_id: 'school-fb-1',
      role: 'principal',
      email: 'principal@dps.example.com',
    });

    // onboarding_state upserted pointing at the fallback-created admin row.
    expect(captured.onboardingUpserts).toHaveLength(1);
    expect(captured.onboardingUpserts[0].row).toMatchObject({
      intended_role: 'institution_admin',
      step: 'completed',
      profile_id: 'sa-fb-1',
    });

    expect(result).toEqual({
      ok: true,
      schoolId: 'school-fb-1',
      schoolAdminId: 'sa-fb-1',
      onboardingStateWritten: true,
    });
  });

  it('reuses the earliest existing school_admins membership instead of inserting a duplicate', async () => {
    const { admin, captured } = makeAdmin({
      rpcResult: { data: null, error: { message: 'rpc unavailable' } },
      existingSchoolAdminId: 'sa-existing-1', // idempotent reuse
      schoolIdForAdmin: 'school-existing-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(BASE_PARAMS);

    // Reuse-before-insert: no new schools/school_admins rows created.
    expect(captured.existingChecks).toBe(1);
    expect(captured.schoolInserts).toHaveLength(0);
    expect(captured.adminInserts).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.schoolAdminId).toBe('sa-existing-1');
  });

  it('falls back to direct insert when the RPC transport throws', async () => {
    const { admin, captured } = makeAdmin({
      rpcThrows: true,
      existingSchoolAdminId: null,
      schoolInsertResult: { data: { id: 'school-fb-2' }, error: null },
      adminInsertResult: { data: { id: 'sa-fb-2' }, error: null },
      schoolIdForAdmin: 'school-fb-2',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(BASE_PARAMS);

    expect(captured.adminInserts).toHaveLength(1);
    expect(captured.adminInserts[0].role).toBe('principal');
    expect(result.ok).toBe(true);
    expect(result.schoolAdminId).toBe('sa-fb-2');
  });
});

// ── 3. Fail-soft (P15): onboarding_state write failure must not block signup ──

describe('ensureSchoolAdminOnboarding — fail-soft (P15)', () => {
  it('does not throw and still returns ok=true when the onboarding_state write fails', async () => {
    const { admin, captured } = makeAdmin({
      rpcResult: {
        data: { status: 'success', profile_id: 'sa-rpc-9' },
        error: null,
      },
      schoolIdForAdmin: 'school-rpc-9',
      // The onboarding_state upsert fails (e.g. CHECK constraint) — must be
      // non-fatal: the school + admin rows already exist, signup completes.
      upsertResult: { data: null, error: { message: 'check constraint violated' } },
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(BASE_PARAMS);

    // The write was attempted...
    expect(captured.onboardingUpserts).toHaveLength(1);
    // ...but its failure did NOT block signup: ok stays true, only the
    // onboardingStateWritten flag reflects the failure.
    expect(result.ok).toBe(true);
    expect(result.schoolAdminId).toBe('sa-rpc-9');
    expect(result.onboardingStateWritten).toBe(false);
  });

  it('returns a not-ok result (never throws) when NO school_admins row can be established', async () => {
    const { admin } = makeAdmin({
      // RPC yields nothing AND both fallback inserts fail → no admin row.
      rpcResult: { data: null, error: { message: 'rpc unavailable' } },
      existingSchoolAdminId: null,
      schoolInsertResult: { data: null, error: { message: 'schools insert failed' } },
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(BASE_PARAMS);

    // Absolute backstop (P15): the helper returns a structured not-ok result
    // rather than throwing into the auth flow.
    expect(result).toEqual({
      ok: false,
      schoolId: null,
      schoolAdminId: null,
      onboardingStateWritten: false,
    });
  });
});
