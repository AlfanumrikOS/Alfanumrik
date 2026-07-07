/**
 * POST /api/super-admin/institutions/[id]/admins — Track A super-admin
 * create/repair of a school admin.
 *
 * Pins src/app/api/super-admin/institutions/[id]/admins/route.ts:
 *
 *   - P9: guarded by authorizeAdmin(request, 'super_admin'); a non-super-admin is
 *     rejected with the helper's own response and NEVER reaches establishPrincipalAdmin.
 *   - validates the school id (uuid) and the body email; rejects a missing school (404).
 *   - on success, delegates to establishPrincipalAdmin and returns the minted raw
 *     claim_token in the HTTP body (for the operator to relay over TLS).
 *   - idempotent repair: re-running reuses the link (delegated to the helper).
 *   - P13: the audit entry carries METADATA ONLY — no email, name, password, or
 *     raw claim token.
 *
 * DELTA (claim-token DELIVERY): the repair path now also DISPATCHES the principal
 * claim email (looking up the school's admin invite code) and returns
 * `email_dispatched`. We assert the email is dispatched with a buildClaimUrl()
 * derived claim_url, that `email_dispatched: true` is returned, and that the raw
 * claim token NEVER appears in any logger/audit assertion path (P13 — it rides
 * only in the email body + the TLS response).
 *
 * Mock style mirrors src/__tests__/api/super-admin/bulk-onboard.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();
const establishPrincipalAdmin = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...a: unknown[]) => authorizeAdmin(...a),
  logAdminAudit: (...a: unknown[]) => logAdminAudit(...a),
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// schools lookup — toggled per-test via schoolExists.
let schoolExists = true;
// school_invite_codes lookup — toggled per-test via inviteCodeExists (the DELTA
// email-dispatch branch reads the school's admin invite code to render the email).
let inviteCodeExists = true;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'school_invite_codes') {
        // chain: .select().eq().eq().order().limit().maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data: inviteCodeExists
              ? { code: 'ADMIN123', expires_at: new Date(Date.now() + 90 * 86400_000).toISOString() }
              : null,
            error: null,
          }),
        };
        return chain;
      }
      // schools lookup: .select().eq().is().maybeSingle()
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({
                // The route now selects `name` for the claim email greeting.
                data: schoolExists
                  ? { id: 'school-1', name: 'Delhi Public School', is_active: true }
                  : null,
                error: null,
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

// DELTA: the repair route now dispatches the claim email. buildClaimUrl is the
// REAL implementation (its URL-encoding is load-bearing); deliverEmail is captured.
const deliverEmail = vi.fn().mockResolvedValue({ sent: true });
vi.mock('@alfanumrik/lib/email-delivery', () => ({
  deliverEmail: (...a: unknown[]) => deliverEmail(...a),
}));

vi.mock('@alfanumrik/lib/school-provisioning', () => ({
  establishPrincipalAdmin: (...a: unknown[]) => establishPrincipalAdmin(...a),
  validateEmail: (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
  // Real builder — produces the canonical claim URL embedding the raw token.
  buildClaimUrl: (raw: string) => `https://alfanumrik.com/school-admin/claim?token=${encodeURIComponent(raw)}`,
}));

const loggerCalls: string[] = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
    warn: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
    error: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
    debug: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
  },
}));

import { POST } from '@/app/api/super-admin/institutions/[id]/admins/route';

const SCHOOL_ID = '00000000-0000-0000-0000-0000000000aa';
const PRINCIPAL_EMAIL = 'principal@delhipublic.example.in';
const PRINCIPAL_NAME = 'Anita Verma';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/institutions/${SCHOOL_ID}/admins`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = (id = SCHOOL_ID) => ({ params: Promise.resolve({ id }) });

function authOk() {
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'super-1',
    adminId: 'admin-1',
    email: 'ops@alfanumrik.com',
    adminLevel: 'super',
  });
}

beforeEach(() => {
  loggerCalls.length = 0;
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  establishPrincipalAdmin.mockReset();
  deliverEmail.mockClear();
  schoolExists = true;
  inviteCodeExists = true;
  authOk();
  logAdminAudit.mockResolvedValue(undefined);
  establishPrincipalAdmin.mockResolvedValue({
    linked: true,
    authUserId: 'auth-1',
    schoolAdminId: 'sa-1',
    claimToken: 'raw-claim-token-xyz',
  });
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/super-admin/institutions/[id]/admins — P9 auth gate', () => {
  it('rejects a non-super-admin with the auth helper response (403) and never links', async () => {
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const res = await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params());
    expect(res.status).toBe(403);
    expect(establishPrincipalAdmin).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('passes the super_admin level to authorizeAdmin', async () => {
    await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params());
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });
});

describe('POST /api/super-admin/institutions/[id]/admins — validation', () => {
  it('rejects an invalid school id (400)', async () => {
    const res = await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(establishPrincipalAdmin).not.toHaveBeenCalled();
  });

  it('rejects a missing/invalid email (400)', async () => {
    const res = await POST(makeRequest({ email: 'nope' }), params());
    expect(res.status).toBe(400);
    expect(establishPrincipalAdmin).not.toHaveBeenCalled();
  });

  it('returns 404 when the school does not exist', async () => {
    schoolExists = false;
    const res = await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params());
    expect(res.status).toBe(404);
    expect(establishPrincipalAdmin).not.toHaveBeenCalled();
  });
});

describe('POST /api/super-admin/institutions/[id]/admins — create/repair success', () => {
  it('delegates to establishPrincipalAdmin and returns the minted claim token', async () => {
    const res = await POST(
      makeRequest({ email: PRINCIPAL_EMAIL, name: PRINCIPAL_NAME }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.school_id).toBe(SCHOOL_ID);
    expect(body.data.school_admin_id).toBe('sa-1');
    expect(body.data.claim_token).toBe('raw-claim-token-xyz');
    // DELTA: the claim email was dispatched (invite code present).
    expect(body.data.email_dispatched).toBe(true);

    // invitedBy attribution = the acting super admin's user id.
    const call = establishPrincipalAdmin.mock.calls[0];
    expect(call[1]).toBe(SCHOOL_ID);
    expect(call[2]).toBe(PRINCIPAL_EMAIL);
    expect(call[4]).toBe('super-1');
  });

  it('returns 500 when the link could not be established', async () => {
    establishPrincipalAdmin.mockResolvedValueOnce({
      linked: false,
      authUserId: null,
      schoolAdminId: null,
      claimToken: null,
    });
    const res = await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/super-admin/institutions/[id]/admins — claim email DELIVERY (DELTA)', () => {
  it('dispatches the principal claim email with a buildClaimUrl()-derived claim_url and returns email_dispatched:true', async () => {
    const res = await POST(
      makeRequest({ email: PRINCIPAL_EMAIL, name: PRINCIPAL_NAME }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email_dispatched).toBe(true);

    // The email was dispatched exactly once, to the principal, with the
    // school-trial-provisioned template and a claim_url embedding the raw token.
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    const payload = deliverEmail.mock.calls[0][0] as {
      template: string;
      to: string;
      params: { claim_url?: string; invite_code?: string; school_name?: string };
    };
    expect(payload.template).toBe('school-trial-provisioned');
    expect(payload.to).toBe(PRINCIPAL_EMAIL);
    expect(payload.params.invite_code).toBe('ADMIN123');
    expect(payload.params.school_name).toBe('Delhi Public School');
    // The claim_url is the canonical app host + URL-encoded raw token.
    expect(payload.params.claim_url).toBe(
      'https://alfanumrik.com/school-admin/claim?token=raw-claim-token-xyz',
    );
  });

  it('returns email_dispatched:false when no admin invite code exists to render (no email sent)', async () => {
    inviteCodeExists = false;
    const res = await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email_dispatched).toBe(false);
    expect(deliverEmail).not.toHaveBeenCalled();
    // The raw token is still returned in the TLS body as a manual-relay fallback.
    expect(body.data.claim_token).toBe('raw-claim-token-xyz');
  });

  it('does NOT dispatch an email when no claim token was minted', async () => {
    establishPrincipalAdmin.mockResolvedValueOnce({
      linked: true,
      authUserId: 'auth-1',
      schoolAdminId: 'sa-1',
      claimToken: null,
    });
    const res = await POST(makeRequest({ email: PRINCIPAL_EMAIL }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email_dispatched).toBe(false);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('P13: the raw claim token never appears in any logger line', async () => {
    await POST(makeRequest({ email: PRINCIPAL_EMAIL, name: PRINCIPAL_NAME }), params());
    const all = loggerCalls.join('\n');
    expect(all).not.toContain('raw-claim-token-xyz');
    // The dispatched claim_url (which embeds the raw token) is never logged either.
    expect(all).not.toContain('school-admin/claim?token=');
  });
});

describe('POST /api/super-admin/institutions/[id]/admins — P13 audit metadata only', () => {
  it('writes a school_admin.provisioned audit row with NO email / name / token', async () => {
    await POST(
      makeRequest({ email: PRINCIPAL_EMAIL, name: PRINCIPAL_NAME }),
      params(),
    );
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [, action, entityType, entityId, details] = logAdminAudit.mock.calls[0];
    expect(action).toBe('school_admin.provisioned');
    expect(entityType).toBe('school');
    expect(entityId).toBe(SCHOOL_ID);

    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain(PRINCIPAL_EMAIL);
    expect(serialized).not.toContain(PRINCIPAL_NAME);
    expect(serialized).not.toContain('raw-claim-token-xyz');
    // metadata-only shape: booleans + ids, no PII keys.
    expect(details).toMatchObject({
      role: 'principal',
      auth_user_linked: true,
      claim_token_issued: true,
    });
  });
});
