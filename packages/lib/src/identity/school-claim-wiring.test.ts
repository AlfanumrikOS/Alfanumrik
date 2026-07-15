import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Phase 4 — JWT/RLS tenant-isolation hardening (P8 + P13).
 *
 * Unit coverage for the STAFF-only claim wiring:
 *   setSchoolClaimForSingleSchoolAdmin() + dispatchSingleSchoolAdminClaim().
 *
 * Verifies the single-school guard (the scalar app_metadata.school_id must NEVER
 * be stamped onto a multi-school admin, and is keyed strictly on `school_admins`
 * so a student/teacher-only user is structurally never claimed), fail-soft /
 * never-throw behavior, and — at the source level — that the 4 staff link points
 * dispatch the claim while the student + teacher bulk-import routes do NOT.
 *
 * The service-role admin client used INTERNALLY by setSchoolClaim() is mocked at
 * the module seam; the membership-lookup `admin` client is a passed-in fake.
 */

const { getUserById, updateUserById } = vi.hoisted(() => ({
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById, updateUserById } },
  }),
}));

import {
  setSchoolClaimForSingleSchoolAdmin,
  dispatchSingleSchoolAdminClaim,
} from './school-claim-wiring';

const AUTH_USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const SCHOOL_A = 'bbbbbbbb-1111-4111-8111-111111111111';
const SCHOOL_B = 'cccccccc-2222-4222-8222-222222222222';

/**
 * Fake admin client for the school_admins membership lookup. Records every table
 * touched so tests can assert the query is keyed strictly on `school_admins`.
 * Chain shape mirrors the real call: .from().select().eq().eq() → thenable.
 */
function makeAdmin(opts: {
  rows?: Array<{ school_id?: string }> | null;
  error?: { message: string } | null;
  reject?: boolean;
}) {
  const tables: string[] = [];
  const admin = {
    from(table: string) {
      tables.push(table);
      return {
        select: () => ({
          eq: () => ({
            eq: () =>
              opts.reject
                ? Promise.reject(new Error('lookup rejected'))
                : Promise.resolve({ data: opts.rows ?? [], error: opts.error ?? null }),
          }),
        }),
      };
    },
  };
  return { admin: admin as never, tables };
}

beforeEach(() => {
  getUserById.mockReset();
  updateUserById.mockReset();
  updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
  getUserById.mockResolvedValue({
    data: { user: { id: AUTH_USER, app_metadata: { provider: 'email' } } },
    error: null,
  });
});

describe('setSchoolClaimForSingleSchoolAdmin — single-school guard', () => {
  it('single active membership equal to expected → stamps the claim (reason set)', async () => {
    const { admin, tables } = makeAdmin({ rows: [{ school_id: SCHOOL_A }] });

    const res = await setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, SCHOOL_A);

    expect(res).toEqual({ ok: true, reason: 'set' });
    expect(updateUserById).toHaveBeenCalledWith(AUTH_USER, {
      app_metadata: { provider: 'email', school_id: SCHOOL_A },
    });
    // keyed strictly on school_admins — never students / teachers
    expect(tables).toEqual(['school_admins']);
  });

  it('multiple active memberships → skipped_multi_school, no claim written', async () => {
    const { admin } = makeAdmin({ rows: [{ school_id: SCHOOL_A }, { school_id: SCHOOL_B }] });

    const res = await setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, SCHOOL_A);

    expect(res).toEqual({ ok: false, reason: 'skipped_multi_school' });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('single membership for a DIFFERENT school → skipped_multi_school (never a misleading claim)', async () => {
    const { admin } = makeAdmin({ rows: [{ school_id: SCHOOL_B }] });

    const res = await setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, SCHOOL_A);

    expect(res.reason).toBe('skipped_multi_school');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('zero memberships (student/teacher-only user) → skipped, never claimed', async () => {
    const { admin, tables } = makeAdmin({ rows: [] });

    const res = await setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, SCHOOL_A);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('skipped_multi_school');
    expect(updateUserById).not.toHaveBeenCalled();
    // proves the guard keys on school_admins: a user with no school_admins rows
    // (e.g. a student or teacher-only user) resolves to zero and is skipped.
    expect(tables).toEqual(['school_admins']);
  });
});

describe('setSchoolClaimForSingleSchoolAdmin — fail-soft (never throws)', () => {
  it('membership lookup error → skipped_lookup_failed (service-role safety net remains)', async () => {
    const { admin } = makeAdmin({ error: { message: 'db error' } });

    const res = await setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, SCHOOL_A);

    expect(res).toEqual({ ok: false, reason: 'skipped_lookup_failed' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('admin client REJECTS the query → skipped_threw, resolves (never rejects)', async () => {
    const { admin } = makeAdmin({ reject: true });

    await expect(
      setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, SCHOOL_A)
    ).resolves.toEqual({ ok: false, reason: 'skipped_threw' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('missing authUserId / expectedSchoolId → skipped_invalid_input, no DB touch', async () => {
    const { admin, tables } = makeAdmin({ rows: [{ school_id: SCHOOL_A }] });

    expect(await setSchoolClaimForSingleSchoolAdmin(admin, '', SCHOOL_A)).toEqual({
      ok: false,
      reason: 'skipped_invalid_input',
    });
    expect(await setSchoolClaimForSingleSchoolAdmin(admin, AUTH_USER, '')).toEqual({
      ok: false,
      reason: 'skipped_invalid_input',
    });
    expect(tables).toEqual([]);
  });
});

describe('dispatchSingleSchoolAdminClaim — fire-and-forget', () => {
  it('returns void synchronously and eventually stamps for a single-school admin', async () => {
    getUserById.mockResolvedValue({
      data: { user: { id: AUTH_USER, app_metadata: {} } },
      error: null,
    });
    const { admin } = makeAdmin({ rows: [{ school_id: SCHOOL_A }] });

    const ret = dispatchSingleSchoolAdminClaim(admin, AUTH_USER, SCHOOL_A);

    expect(ret).toBeUndefined();
    await vi.waitFor(() =>
      expect(updateUserById).toHaveBeenCalledWith(AUTH_USER, {
        app_metadata: { school_id: SCHOOL_A },
      })
    );
  });

  it('never throws when the underlying lookup rejects', async () => {
    const { admin } = makeAdmin({ reject: true });

    expect(() => dispatchSingleSchoolAdminClaim(admin, AUTH_USER, SCHOOL_A)).not.toThrow();
    // let the fire-and-forget promise settle — must not surface as an unhandled rejection
    await new Promise((r) => setTimeout(r, 0));
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

/**
 * Source-level wiring canary. Confirms the 4 STAFF link points dispatch the
 * claim and the two bulk-import routes (teachers, students) deliberately do NOT.
 * Guards against a silent removal of the wiring (the behavior tests above cannot
 * see the call sites themselves).
 */
describe('claim wiring — call-site presence (source canary)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url)); // packages/lib/src/identity
  const REPO_ROOT = resolve(HERE, '../../../../'); // → repo root

  const read = (p: string) => readFileSync(p, 'utf8');
  const callCount = (text: string) =>
    (text.match(/dispatchSingleSchoolAdminClaim\s*\(/g) ?? []).length;

  it('ensureSchoolAdminOnboarding (school-admin-bootstrap) dispatches the claim', () => {
    const src = read(resolve(HERE, 'school-admin-bootstrap.ts'));
    expect(src).toContain('function ensureSchoolAdminOnboarding');
    expect(callCount(src)).toBeGreaterThanOrEqual(1);
  });

  it('establishPrincipalAdmin + claimAdminToken (school-provisioning) both dispatch the claim', () => {
    const src = read(resolve(HERE, '../school-provisioning.ts'));
    expect(src).toContain('function establishPrincipalAdmin');
    expect(src).toContain('function claimAdminToken');
    expect(callCount(src)).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/school-admin/staff dispatches the claim', () => {
    const src = read(
      resolve(REPO_ROOT, 'apps/host/src/app/api/school-admin/staff/route.ts')
    );
    expect(callCount(src)).toBeGreaterThanOrEqual(1);
  });

  it('teacher bulk-import does NOT dispatch the claim (documented deferral — no auth user at import)', () => {
    const src = read(
      resolve(REPO_ROOT, 'apps/host/src/app/api/school-admin/teachers/bulk-import/route.ts')
    );
    expect(callCount(src)).toBe(0);
    expect(src).toContain('INTENTIONALLY DEFERRED');
  });

  it('student bulk-import does NOT dispatch the claim (students are never claimed)', () => {
    const src = read(
      resolve(REPO_ROOT, 'apps/host/src/app/api/school-admin/students/bulk-import/route.ts')
    );
    expect(callCount(src)).toBe(0);
  });
});
