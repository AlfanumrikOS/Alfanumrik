/**
 * `force_link_guardian` action coverage — `PATCH /api/internal/admin/users/[id]`
 * (`apps/host/src/app/api/internal/admin/users/[id]/route.ts`), P0-3 hotfix
 * from `docs/audits/2026-08-20-comprehensive-code-review.md`.
 *
 * No test file exercised this action before this one (confirmed by grep —
 * `grep -rln force_link_guardian apps/host/src apps/host/src/__tests__`
 * matched only the route source, never a test). The sweep in
 * `internal-admin-secret-gate.test.ts` invokes this same PATCH handler but
 * only with `action: 'suspend'` — it never reaches the `force_link_guardian`
 * branch, so this is genuinely new coverage, not an extension of an existing
 * passing case.
 *
 * WHAT THE FIX WAS (P0-3): before this hotfix, the audit-log call for this
 * action logged the raw `guardian_email` the caller supplied. Because
 * `audit_logs` is a broader-access forensic surface than the student-data
 * tables it describes, that put a parent's email address into a place PII
 * does not belong (P13; mirrors the REG-68 AlfaBot audit-log PII boundary
 * pattern already pinned elsewhere in this suite). The fix logs the
 * *resolved* `guardian_id` (a UUID) instead of the raw email used to look it
 * up.
 *
 * SEAM CHOICE: `@alfanumrik/lib/admin-auth`'s `logAdminAction` is mocked
 * directly (not exercised through a mocked Supabase `audit_logs` insert).
 * This pins the CALL-SITE CONTRACT — exactly what payload this route hands
 * to the audit trail — which is what the fix actually changed. It also
 * avoids coupling this test to `logAdminAuditByUserId`'s unrelated internal
 * DB-write shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC mock — always authorized; this file is not the RBAC-gate sweep. ──
const authorizeRequestMock = vi.fn(async () => ({
  authorized: true,
  userId: 'admin-1',
  studentId: null,
  roles: ['super_admin'],
  permissions: [],
  errorResponse: null,
}));
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => authorizeRequestMock(...args),
}));

// ── admin-auth mock — captures exactly what the route hands to the audit trail. ──
const logAdminActionMock = vi.fn(async () => undefined);
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAction: (...args: unknown[]) => logAdminActionMock(...args),
}));

// ── supabase-admin mock — controls the `guardians` lookup and the
//    `guardian_student_links` upsert this action performs. ──
let _guardianLookup: { data: { id: string } | null; error: unknown } = {
  data: { id: 'guardian-uuid-1' },
  error: null,
};
const upsertMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table === 'guardians') {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(() => Promise.resolve(_guardianLookup));
        return chain;
      }
      if (table === 'guardian_student_links') {
        return { upsert: upsertMock };
      }
      // Unexpected table touch — fail loudly rather than silently stubbing.
      throw new Error(`unexpected table in force_link_guardian test: ${table}`);
    }),
  }),
}));

const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const GUARDIAN_EMAIL = 'parent@example.com';

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/internal/admin/users/${STUDENT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as never);
}

const ctx = { params: Promise.resolve({ id: STUDENT_ID }) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PATCH: any;

beforeEach(async () => {
  vi.clearAllMocks();
  authorizeRequestMock.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    studentId: null,
    roles: ['super_admin'],
    permissions: [],
    errorResponse: null,
  });
  _guardianLookup = { data: { id: 'guardian-uuid-1' }, error: null };
  upsertMock.mockResolvedValue({ data: null, error: null } as never);

  const mod = await import('@/app/api/internal/admin/users/[id]/route');
  PATCH = mod.PATCH;
});

describe("PATCH /api/internal/admin/users/[id] action=force_link_guardian — audit-log PII boundary (P0-3/P13)", () => {
  it('logs guardian_id (a UUID), never guardian_email, when the guardian is found and linked', async () => {
    const res = await PATCH(patchRequest({ action: 'force_link_guardian', guardian_email: GUARDIAN_EMAIL }), ctx as never);

    expect(res.status).toBe(200);
    expect(logAdminActionMock).toHaveBeenCalledTimes(1);

    const call = logAdminActionMock.mock.calls[0][0] as {
      action: string;
      entity_type: string;
      entity_id: string;
      details?: Record<string, unknown>;
    };

    expect(call.action).toBe('force_link_guardian');
    expect(call.entity_type).toBe('student');
    expect(call.entity_id).toBe(STUDENT_ID);

    // The load-bearing assertion: details carries ONLY the resolved guardian
    // UUID, nothing else — no email, no other PII-shaped key snuck in.
    expect(call.details).toEqual({ guardian_id: 'guardian-uuid-1' });
  });

  it('never includes guardian_email or any other PII-shaped key in the audit details payload', async () => {
    await PATCH(patchRequest({ action: 'force_link_guardian', guardian_email: GUARDIAN_EMAIL }), ctx as never);

    const call = logAdminActionMock.mock.calls[0][0] as { details?: Record<string, unknown> };
    const details = call.details ?? {};

    expect(details).not.toHaveProperty('guardian_email');
    expect(details).not.toHaveProperty('email');
    expect(details).not.toHaveProperty('phone');
    expect(details).not.toHaveProperty('name');

    // Defense-in-depth: no key name looks PII-shaped, and the raw email
    // string never appears anywhere in the serialized payload.
    for (const key of Object.keys(details)) {
      expect(key).not.toMatch(/name|email|phone/i);
    }
    expect(JSON.stringify(details)).not.toContain(GUARDIAN_EMAIL);
  });

  it('the guardian lookup uses the caller-supplied email, but the RESOLVED id is what gets upserted and logged', async () => {
    _guardianLookup = { data: { id: 'guardian-uuid-resolved' }, error: null };

    await PATCH(patchRequest({ action: 'force_link_guardian', guardian_email: GUARDIAN_EMAIL }), ctx as never);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        guardian_id: 'guardian-uuid-resolved',
        student_id: STUDENT_ID,
        status: 'approved',
      }),
      expect.objectContaining({ onConflict: 'guardian_id,student_id' }),
    );

    const call = logAdminActionMock.mock.calls[0][0] as { details?: Record<string, unknown> };
    expect(call.details).toEqual({ guardian_id: 'guardian-uuid-resolved' });
  });

  it('returns 400 and never calls logAdminAction when guardian_email is missing', async () => {
    const res = await PATCH(patchRequest({ action: 'force_link_guardian' }), ctx as never);

    expect(res.status).toBe(400);
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('returns 404 and never calls logAdminAction (nor upserts) when no guardian matches the email', async () => {
    _guardianLookup = { data: null, error: null };

    const res = await PATCH(patchRequest({ action: 'force_link_guardian', guardian_email: GUARDIAN_EMAIL }), ctx as never);

    expect(res.status).toBe(404);
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('the HTTP response body never echoes the guardian_email either', async () => {
    const res = await PATCH(patchRequest({ action: 'force_link_guardian', guardian_email: GUARDIAN_EMAIL }), ctx as never);
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain(GUARDIAN_EMAIL);
    expect(body).toEqual({ success: true, action: 'guardian_linked' });
  });
});
