/**
 * /api/school-admin/contracts (GET) — XC-3 Phase 3 FIRST SLICE RLS contract.
 *
 * WHY THIS EXISTS
 * ===============
 * Phase 3 migrates this teacher/school-admin READ route off the RLS-BYPASSING
 * service-role client onto the RLS-respecting cookie-session client
 * (`createSupabaseServerClient`). The `school_admin_can_read_own_contracts`
 * SELECT policy on `school_contracts` (migration 20260507150000) is now the
 * authoritative tenant boundary:
 *
 *     school_id IN (SELECT school_id FROM school_admins WHERE auth_user_id = auth.uid())
 *
 * The Phase-3 gate is TENANT-SCOPING CORRECTNESS — both bounds must hold:
 *   • LOWER BOUND — the caller's own school contracts stay visible (no
 *     under-fetch / 200→empty regression);
 *   • UPPER BOUND — a school the caller does NOT administer is INVISIBLE even
 *     if a foreign school_id reaches the query (no cross-tenant PII/commercial
 *     leak — strictly worse than an empty result).
 *
 * These tests emulate the RLS client as "rows the policy exposes to THIS
 * caller" (keyed by the auth.uid()-resolved school), so the upper bound is
 * proven independently of the route's belt-and-suspenders `.eq('school_id', …)`.
 *
 * Seams mocked: @alfanumrik/lib/school-admin-auth (authorizeSchoolAdmin),
 * @alfanumrik/lib/feature-flags (isFeatureEnabled — flag + permission-code selector),
 * @alfanumrik/lib/supabase-server (createSupabaseServerClient — RLS-emulating stub),
 * @alfanumrik/lib/logger.
 *
 * Plan: docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§4 Phase 3).
 * Catalog: REG-221 (P8 / P9 / P13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHOOL_A = '11111111-1111-4111-a111-111111111111';
const SCHOOL_B = '22222222-2222-4222-a222-222222222222';

type Row = Record<string, unknown>;

const holders = vi.hoisted(() => ({
  authorizeSchoolAdmin: vi.fn(),
  // How many times the route built the RLS-scoped client (regression guard).
  serverClientCalls: 0,
  // The full underlying dataset across ALL tenants.
  dbRows: [] as Row[],
  // The school the CURRENT caller's auth.uid() is a school_admin of — i.e. the
  // single tenant the `school_admin_can_read_own_contracts` policy exposes.
  // `null` models a session whose auth.uid() matches no school_admins row
  // (fail-closed: RLS exposes nothing).
  rlsAllowedSchoolId: null as string | null,
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => holders.authorizeSchoolAdmin(...a),
}));

// isFeatureEnabled drives BOTH the ff_school_contracts_v1 gate and the
// schoolAdminPermissionCode selector. true → route proceeds past both.
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async () => true),
  SCHOOL_ADMIN_RBAC_FLAGS: { V1: 'ff_school_admin_rbac' },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// RLS-emulating thenable query builder. It exposes ONLY the rows the policy
// would surface to the current caller (dbRows ∩ rlsAllowedSchoolId), then
// applies the route's own `.eq(...)` narrowing on top. This makes the stub a
// faithful model of "RLS first, route filter second". Reads holders lazily so
// each test sets the dataset BEFORE calling GET.
vi.mock('@alfanumrik/lib/supabase-server', () => {
  function chainFor(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const rlsVisible = (): Row[] =>
      table === 'school_contracts'
        ? holders.dbRows.filter(
            (r) =>
              holders.rlsAllowedSchoolId !== null && r.school_id === holders.rlsAllowedSchoolId,
          )
        : [];
    const result = () => {
      const rows = rlsVisible().filter((r) => eqs.every(([k, v]) => r[k] === v));
      return { data: rows, error: null, count: rows.length };
    };
    const chain: Record<string, unknown> = {
      select() { return chain; },
      eq(col: string, val: unknown) { eqs.push([col, val]); return chain; },
      order() { return chain; },
      range() { return chain; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(onF, onR);
      },
    };
    return chain;
  }
  return {
    createSupabaseServerClient: async () => {
      holders.serverClientCalls += 1;
      return { from: (t: string) => chainFor(t) };
    },
  };
});

import { GET } from '@/app/api/school-admin/contracts/route';

function req(search = ''): Parameters<typeof GET>[0] {
  return new Request(
    `https://app.test/api/school-admin/contracts${search}`,
  ) as unknown as Parameters<typeof GET>[0];
}

function contract(school_id: string, contract_number: string): Row {
  return {
    id: `c-${contract_number}`,
    contract_number,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    billing_cycle: 'annual',
    seats_purchased: 100,
    value_inr: 500000,
    pdf_url: null,
    signed_at: '2026-01-02T00:00:00Z',
    status: 'active',
    previous_contract_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    school_id,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.serverClientCalls = 0;
  holders.dbRows = [];
  holders.rlsAllowedSchoolId = null;
});

describe('XC-3 Phase 3 — /api/school-admin/contracts RLS migration', () => {
  // ── (a) LOWER BOUND: in-scope caller sees ONLY their own school's rows ──
  it('in-scope school admin sees exactly their school contracts (200, byte-identical envelope)', async () => {
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: true,
      userId: 'auth-a',
      schoolId: SCHOOL_A,
      schoolAdminId: 'sa-a',
      schoolAdminRole: 'principal',
    });
    // DB holds BOTH tenants' contracts; RLS exposes only SCHOOL_A's to this caller.
    holders.dbRows = [
      contract(SCHOOL_A, 'A-1'),
      contract(SCHOOL_A, 'A-2'),
      contract(SCHOOL_B, 'B-1'),
    ];
    holders.rlsAllowedSchoolId = SCHOOL_A;

    const res = (await GET(req()))!;
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.page).toBe(1);
    expect(body.data.limit).toBe(25);
    const numbers = body.data.rows.map((r: Row) => r.contract_number).sort();
    expect(numbers).toEqual(['A-1', 'A-2']);
    // UPPER BOUND corollary: SCHOOL_B never appears.
    expect(body.data.rows.some((r: Row) => r.school_id === SCHOOL_B)).toBe(false);
  });

  // ── (b) UPPER BOUND: cross-tenant request is denied by RLS → empty, no leak ──
  it('cross-tenant request returns empty (RLS denies a foreign school_id — no payload leak)', async () => {
    // App layer is (hypothetically) tricked into resolving SCHOOL_B, but the
    // cookie session's auth.uid() is only a school_admin of SCHOOL_A, so RLS
    // exposes nothing for SCHOOL_B. This proves the DB is an INDEPENDENT bound.
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: true,
      userId: 'auth-a',
      schoolId: SCHOOL_B, // route will .eq('school_id', SCHOOL_B)
      schoolAdminId: 'sa-a',
      schoolAdminRole: 'principal',
    });
    holders.dbRows = [contract(SCHOOL_B, 'B-1'), contract(SCHOOL_B, 'B-2')];
    holders.rlsAllowedSchoolId = SCHOOL_A; // RLS admits only SCHOOL_A for this caller

    const res = (await GET(req()))!;
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.rows).toEqual([]);
    expect(body.data.total).toBe(0);
    // Hard assertion: NOT ONE SCHOOL_B row leaked through.
    expect(JSON.stringify(body)).not.toContain('B-1');
    expect(JSON.stringify(body)).not.toContain('B-2');
  });

  // ── Fail-closed: an unauthenticated/denied caller never touches the DB ──
  it('returns the authz errorResponse verbatim when not authorized (no DB read)', async () => {
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: false,
      userId: null,
      schoolId: null,
      schoolAdminId: null,
      schoolAdminRole: null,
      errorResponse: new Response(
        JSON.stringify({ success: false, error: 'Not a school administrator' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const res = (await GET(req()))!;
    expect(res.status).toBe(403);
    expect(holders.serverClientCalls).toBe(0);
  });

  // ── (c) Regression guard: the route uses the RLS client, not supabase-admin ──
  it('uses the RLS-scoped server client (createSupabaseServerClient was invoked)', async () => {
    holders.authorizeSchoolAdmin.mockResolvedValue({
      authorized: true,
      userId: 'auth-a',
      schoolId: SCHOOL_A,
      schoolAdminId: 'sa-a',
      schoolAdminRole: 'principal',
    });
    holders.dbRows = [contract(SCHOOL_A, 'A-1')];
    holders.rlsAllowedSchoolId = SCHOOL_A;

    await GET(req());
    expect(holders.serverClientCalls).toBeGreaterThan(0);
  });

  it('route source imports the RLS client and NOT supabase-admin', () => {
    const candidates = [
      resolve(process.cwd(), 'src/app/api/school-admin/contracts/route.ts'),
      resolve(process.cwd(), '..', 'src/app/api/school-admin/contracts/route.ts'),
    ];
    const path = candidates.find((p) => existsSync(p));
    expect(path).toBeDefined();
    const src = readFileSync(path!, 'utf8');
    expect(src).toMatch(/from\s+['"]@\/lib\/supabase-server['"]/);
    expect(src).not.toMatch(/supabase-admin/);
  });
});
