/**
 * Phase 3C Wave A / A2 — module route guard (`assertModuleEnabledForSchool` +
 * `assertModuleEnabled`).
 *
 * The guard maps a route's module key to a disabled→404 decision while
 * FAILING OPEN on every uncertainty (so a tenant is never locked out by a
 * lookup failure). The enablement decision is delegated entirely to the registry
 * resolver `isModuleEnabled`; the guard owns only the request→school→module
 * wiring and the disabled→404 mapping.
 *
 * We mock the two seams the guard depends on:
 *   - `@alfanumrik/lib/modules/registry`  → control `isModuleEnabled` per test (keep the
 *     rest of the module REAL via importActual so `ModuleKey` typing is intact).
 *   - `@alfanumrik/lib/domains/tenant`    → control `getSchoolById` (school lookup) per test.
 *   - `@alfanumrik/lib/logger`            → spy so we can assert the warn payload carries
 *     NO PII (module key only) on the error branch.
 *
 * CONTRACT under test (route-guard.ts header):
 *   explicit isModuleEnabled===false → { allowed:false } + 404 MODULE_DISABLED.
 *   isModuleEnabled===true           → { allowed:true }.
 *   FAIL-OPEN → { allowed:true }: null/undefined schoolId (NO school lookup),
 *     getSchoolById ok(null), getSchoolById fail(...), getSchoolById throws,
 *     isModuleEnabled throws.
 *   Never 500/403 — a disabled module is 404; a resolution FAILURE is allow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Seam mocks (declared via vi.hoisted so they exist before the SUT imports). ──
const reg = vi.hoisted(() => ({ isModuleEnabled: vi.fn() }));
const tenant = vi.hoisted(() => ({ getSchoolById: vi.fn() }));
const log = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/modules/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/modules/registry')>();
  return {
    ...actual,
    isModuleEnabled: (...a: unknown[]) => reg.isModuleEnabled(...a),
  };
});

vi.mock('@alfanumrik/lib/domains/tenant', () => ({
  getSchoolById: (...a: unknown[]) => tenant.getSchoolById(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({ logger: log.logger }));

import {
  assertModuleEnabledForSchool,
  assertModuleEnabled,
  type ModuleGateResult,
} from '@alfanumrik/lib/modules/route-guard';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

/** A school row as `getSchoolById` would return it on success. */
function okSchool(tenantType = 'school') {
  return { ok: true as const, data: { id: SCHOOL_ID, tenantType } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Safe default: school resolves, module enabled. Each test overrides as needed.
  tenant.getSchoolById.mockResolvedValue(okSchool());
  reg.isModuleEnabled.mockResolvedValue(true);
});

/** Read the 404 body off a blocked gate result. */
async function blockedBody(result: ModuleGateResult) {
  expect(result.allowed).toBe(false);
  if (result.allowed) throw new Error('expected a blocked gate result');
  return { status: result.response.status, body: await result.response.json() };
}

// ═════════════════════════════════════════════════════════════════════════════
// assertModuleEnabledForSchool — the school-admin entry point.
// ═════════════════════════════════════════════════════════════════════════════
describe('assertModuleEnabledForSchool — explicit DISABLED → 404 MODULE_DISABLED', () => {
  it('returns { allowed:false } with a 404 carrying code:MODULE_DISABLED + the module key', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(false);

    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'testing_engine');

    const { status, body } = await blockedBody(result);
    expect(status).toBe(404);
    expect(body.code).toBe('MODULE_DISABLED');
    expect(body.module).toBe('testing_engine');
    expect(body.success).toBe(false);
  });

  it('echoes the SPECIFIC module key on the 404 (lms, not a hardcoded value)', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(false);
    const { body } = await blockedBody(await assertModuleEnabledForSchool(SCHOOL_ID, 'lms'));
    expect(body.module).toBe('lms');
  });

  it('uses 404 — never 403 or 500 — for a disabled module (looks not-present, not denied)', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(false);
    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'analytics');
    const { status } = await blockedBody(result);
    expect(status).toBe(404);
    expect(status).not.toBe(403);
    expect(status).not.toBe(500);
  });

  it('resolves the tenant_type from the school and passes it to isModuleEnabled', async () => {
    tenant.getSchoolById.mockResolvedValueOnce(okSchool('coaching'));
    reg.isModuleEnabled.mockResolvedValueOnce(true);
    await assertModuleEnabledForSchool(SCHOOL_ID, 'crm');
    expect(reg.isModuleEnabled).toHaveBeenCalledWith(SCHOOL_ID, 'coaching', 'crm');
  });
});

describe('assertModuleEnabledForSchool — ALLOWED', () => {
  it('returns { allowed:true } (no response) when isModuleEnabled is true', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(true);
    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'testing_engine');
    expect(result).toEqual({ allowed: true });
  });
});

describe('assertModuleEnabledForSchool — FAIL-OPEN (never lock a tenant out)', () => {
  it('null schoolId → allowed, and NO school lookup is attempted (short-circuit)', async () => {
    const result = await assertModuleEnabledForSchool(null, 'testing_engine');
    expect(result).toEqual({ allowed: true });
    expect(tenant.getSchoolById).not.toHaveBeenCalled();
    expect(reg.isModuleEnabled).not.toHaveBeenCalled();
  });

  it('undefined schoolId → allowed, and NO school lookup is attempted (short-circuit)', async () => {
    const result = await assertModuleEnabledForSchool(undefined, 'lms');
    expect(result).toEqual({ allowed: true });
    expect(tenant.getSchoolById).not.toHaveBeenCalled();
    expect(reg.isModuleEnabled).not.toHaveBeenCalled();
  });

  it('empty-string schoolId → allowed, and NO school lookup is attempted', async () => {
    const result = await assertModuleEnabledForSchool('', 'analytics');
    expect(result).toEqual({ allowed: true });
    expect(tenant.getSchoolById).not.toHaveBeenCalled();
  });

  it('getSchoolById returns ok(null) (missing school row) → allowed', async () => {
    tenant.getSchoolById.mockResolvedValueOnce({ ok: true, data: null });
    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'testing_engine');
    expect(result).toEqual({ allowed: true });
    // No enablement decision is even attempted when the tenant_type is unknown.
    expect(reg.isModuleEnabled).not.toHaveBeenCalled();
  });

  it('getSchoolById returns a failure result (DB error) → allowed', async () => {
    tenant.getSchoolById.mockResolvedValueOnce({ ok: false, error: 'boom', code: 'DB_ERROR' });
    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'lms');
    expect(result).toEqual({ allowed: true });
    expect(reg.isModuleEnabled).not.toHaveBeenCalled();
  });

  it('getSchoolById throws → caught → allowed', async () => {
    tenant.getSchoolById.mockRejectedValueOnce(new Error('connection reset'));
    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'analytics');
    expect(result).toEqual({ allowed: true });
  });

  it('isModuleEnabled throws → caught → allowed', async () => {
    reg.isModuleEnabled.mockRejectedValueOnce(new Error('resolver exploded'));
    const result = await assertModuleEnabledForSchool(SCHOOL_ID, 'communication');
    expect(result).toEqual({ allowed: true });
  });
});

describe('assertModuleEnabledForSchool — error-branch logging is PII-free (P13)', () => {
  it('logs warn with ONLY the module key + route tag on a thrown error (no school_id, no PII)', async () => {
    tenant.getSchoolById.mockRejectedValueOnce(new Error('db down for school owner jane@example.com'));

    await assertModuleEnabledForSchool(SCHOOL_ID, 'testing_engine');

    expect(log.logger.warn).toHaveBeenCalledTimes(1);
    const [event, meta] = log.logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('module_route_guard_resolve_failed');

    // The structured payload carries the module key + a route tag + the Error
    // object only. It must NOT carry the school_id or any caller PII.
    expect(meta.module).toBe('testing_engine');
    const metaKeys = Object.keys(meta);
    expect(metaKeys).not.toContain('schoolId');
    expect(metaKeys).not.toContain('school_id');
    expect(metaKeys).not.toContain('email');
    expect(metaKeys).not.toContain('userId');

    // Defensive: the school UUID must not leak via any field name we didn't
    // anticipate. (The Error message is allowed — it is the thrown error, not a
    // value the guard chose to log — but the guard must not add the school_id.)
    expect(meta.schoolId).toBeUndefined();
  });

  it('does NOT emit a warn on the happy path (no noise when allowed)', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(true);
    await assertModuleEnabledForSchool(SCHOOL_ID, 'lms');
    expect(log.logger.warn).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// assertModuleEnabled — the tenant-context (header-driven) entry point.
// ═════════════════════════════════════════════════════════════════════════════
function reqWithSchoolHeader(schoolId?: string): Request {
  const headers = new Headers();
  if (schoolId) headers.set('x-school-id', schoolId);
  return new Request('http://localhost/some/route', { method: 'GET', headers });
}

describe('assertModuleEnabled — resolves school from the x-school-id header', () => {
  it('disabled module for the header school → 404 MODULE_DISABLED', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(false);
    const result = await assertModuleEnabled(reqWithSchoolHeader(SCHOOL_ID), 'ai_tutor');
    const { status, body } = await blockedBody(result);
    expect(status).toBe(404);
    expect(body.code).toBe('MODULE_DISABLED');
    expect(body.module).toBe('ai_tutor');
  });

  it('enabled module for the header school → allowed', async () => {
    reg.isModuleEnabled.mockResolvedValueOnce(true);
    const result = await assertModuleEnabled(reqWithSchoolHeader(SCHOOL_ID), 'ai_tutor');
    expect(result).toEqual({ allowed: true });
  });

  it('no x-school-id header (B2C) → fail-open allowed, no school lookup', async () => {
    const result = await assertModuleEnabled(reqWithSchoolHeader(undefined), 'ai_tutor');
    expect(result).toEqual({ allowed: true });
    expect(tenant.getSchoolById).not.toHaveBeenCalled();
  });

  it('school lookup failure on the header path → fail-open allowed', async () => {
    tenant.getSchoolById.mockResolvedValueOnce({ ok: false, error: 'boom', code: 'DB_ERROR' });
    const result = await assertModuleEnabled(reqWithSchoolHeader(SCHOOL_ID), 'ai_tutor');
    expect(result).toEqual({ allowed: true });
  });
});
