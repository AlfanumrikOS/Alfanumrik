/**
 * PP-5 (P8/P13 defense-in-depth pin) — a parent NOT linked to a child gets a
 * deny with NO child payload on every child-data route; a linked parent gets
 * through. Child-data reads run on the service-role client (RLS bypassed), so
 * the app-layer link check is the ONLY boundary on most of these routes
 * (engineering-audit Cycle 7). The audit found the canonical routes already
 * verify the link — this file PINS that so a regression dropping the check
 * fails CI.
 *
 * Two parts:
 *   A. BEHAVIOUR — full unlinked→403 / linked→200 for `report`
 *      (isGuardianLinkedToStudent pattern), the most exposed read lacking a
 *      dedicated boundary test.
 *   B. SOURCE-CONTRACT ENUMERATION — every parent child-data route references a
 *      canonical link-boundary mechanism (canAccessStudent /
 *      isGuardianLinkedToStudent / listChildrenForGuardian / an inline
 *      guardian_student_links 403 check). chat + calendar already have dedicated
 *      behavioural boundary tests (children-chat-boundary, parent-calendar);
 *      this enumeration is the regression guard for the rest.
 *
 * Invariants: P8 (RLS boundary — app check is the live boundary on the
 * service-role path), P13 (no child payload on any deny path).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';
const GUARDIAN_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

const holders = vi.hoisted(() => ({
  authorize: vi.fn(),
  logAudit: vi.fn(),
  guardianByAuth: vi.fn(),
  isLinked: vi.fn(),
  // Whether the service-role read of the cached report was reached.
  reportReadReached: false,
  cachedReport: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.authorize(...a),
  logAudit: (...a: unknown[]) => holders.logAudit(...a),
}));

vi.mock('@/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.guardianByAuth(...a),
}));

vi.mock('@/lib/domains/relationship', () => ({
  isGuardianLinkedToStudent: (...a: unknown[]) => holders.isLinked(...a),
}));

vi.mock('@/lib/supabase-admin', () => {
  const client = {
    from: (_table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          holders.reportReadReached = true;
          return { data: holders.cachedReport, error: null };
        },
      };
      return chain;
    },
  };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST as reportRoute } from '@/app/api/parent/report/route';

function makeReportReq(studentId: string) {
  return new Request('http://localhost/api/parent/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.reportReadReached = false;
  holders.cachedReport = null;
  // Default: authenticated parent with a guardian profile.
  holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['parent'] });
  holders.guardianByAuth.mockResolvedValue({ ok: true, data: { id: GUARDIAN_ID } });
  // Guard against any accidental network call to the edge function.
  global.fetch = vi.fn(async () => {
    throw new Error('fetch must not be reached in these tests');
  }) as unknown as typeof fetch;
});

describe('PP-5 report route — unlinked parent is denied with no child payload', () => {
  it('NOT LINKED → 403, no child data read, no payload (P8/P13)', async () => {
    holders.isLinked.mockResolvedValue({ ok: true, data: false }); // no approved/active link
    const res = await reportRoute(makeReportReq(CHILD_ID) as never);
    expect(res.status).toBe(403);

    // The boundary was keyed by (own guardian id, requested child).
    expect(holders.isLinked).toHaveBeenCalledWith(GUARDIAN_ID, CHILD_ID);
    // The service-role report read was NEVER reached.
    expect(holders.reportReadReached).toBe(false);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(body).not.toHaveProperty('report');
  });

  it('no guardian profile → 403, link check never consulted, no payload', async () => {
    holders.guardianByAuth.mockResolvedValue({ ok: true, data: null });
    const res = await reportRoute(makeReportReq(CHILD_ID) as never);
    expect(res.status).toBe(403);
    expect(holders.isLinked).not.toHaveBeenCalled();
    expect(holders.reportReadReached).toBe(false);
    const body = await res.json();
    expect(body.data).toBeUndefined();
  });

  it('400 on a non-UUID student_id — boundary not consulted, no payload', async () => {
    const res = await reportRoute(makeReportReq('not-a-uuid') as never);
    expect(res.status).toBe(400);
    expect(holders.isLinked).not.toHaveBeenCalled();
    expect(holders.reportReadReached).toBe(false);
  });
});

describe('PP-5 report route — linked parent succeeds', () => {
  it('LINKED → 200 with the child report (cached path)', async () => {
    holders.isLinked.mockResolvedValue({ ok: true, data: true });
    holders.cachedReport = { report: { summary: 'Asha did well this week' }, generated_at: '2026-06-28T00:00:00.000Z' };
    const res = await reportRoute(makeReportReq(CHILD_ID) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.cached).toBe(true);
    expect(body.data.report).toEqual({ summary: 'Asha did well this week' });
    // The boundary passed, so the read WAS reached for the linked caller.
    expect(holders.reportReadReached).toBe(true);
  });
});

// ── Part B: source-contract enumeration across every child-data route ──────
describe('PP-5 enumeration — every parent child-data route references a link boundary', () => {
  const ROUTES = [
    'src/app/api/parent/children/[student_id]/chat/route.ts',
    'src/app/api/parent/children/[student_id]/export/route.ts',
    'src/app/api/parent/children/[student_id]/erasure-status/route.ts',
    'src/app/api/parent/children/[student_id]/request-erasure/route.ts',
    'src/app/api/parent/report/route.ts',
    'src/app/api/parent/billing/route.ts',
    'src/app/api/parent/calendar/route.ts',
    'src/app/api/v2/parent/glance/route.ts',
    'src/app/api/v2/parent/encourage/route.ts',
  ];

  it.each(ROUTES)('%s consults a canonical link-boundary mechanism', (rel) => {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    const usesHelper =
      /canAccessStudent/.test(src) ||
      /isGuardianLinkedToStudent/.test(src) ||
      /listChildrenForGuardian/.test(src) ||
      // Inline guardian_student_links link check that 403s on "not linked".
      (/guardian_student_links/.test(src) && /403/.test(src));
    expect(usesHelper).toBe(true);
  });

  it.each(ROUTES)('%s gates behind authorizeRequest (P9)', (rel) => {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    expect(src).toMatch(/authorizeRequest\(/);
  });
});
