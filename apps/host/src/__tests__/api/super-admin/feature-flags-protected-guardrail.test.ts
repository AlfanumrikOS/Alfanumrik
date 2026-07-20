/**
 * Feature-flags route — protected-flag typed-confirmation guardrail
 * (REG-285 — 2026-07-20 console bulk-enable incident pin).
 *
 * Incident: an operator console bulk-enable re-armed 49 of the 52
 * CEO-approved forced-OFF flags at rollout 100 (restored by migration
 * 20260720130000). This suite pins the guardrail that makes that class of
 * incident impossible from the console API:
 *
 *   PATCH — making a protected flag MORE enabled (enabled=true OR
 *     rollout_percentage>0) without body.confirm === the exact flag_name →
 *     409 { code:'FLAG_PROTECTED', tier, reason, confirm_required } BEFORE
 *     any DB write or audit row. Correct confirm → write proceeds and the
 *     audit row carries protected_confirmed:true. Disabling stays
 *     confirm-free (kill switches must stay fast) EXCEPT the
 *     special_do_not_touch / p11_payment tiers (payment safety devices).
 *   DELETE — deleting a protected flag requires the same confirm (409
 *     before the DELETE write; prevents delete→recreate-unprotected).
 *   POST — re-creating a flag under a protected NAME requires the confirm,
 *     checked BEFORE any DB I/O (closes the delete-recreate bypass), and
 *     the ff_python_ prefix rule fires at the route boundary too.
 *   Unprotected flags are entirely unaffected in every direction.
 *
 * Mocking style mirrors the sibling feature-flags-rollout-promotion suite:
 * authorizeAdmin / logAdminAudit stubbed at the module seam, global fetch
 * stubbed so the PostgREST calls are observable. Zod is NOT mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/admin-auth')>('@alfanumrik/lib/admin-auth');
  return {
    ...actual,
    authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
    logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  };
});

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  invalidateFlagCache: vi.fn(),
}));

const logOpsEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => logOpsEvent(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FLAG_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: 'admin-row-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

// Representative protected names, one per relevant tier.
const CONSTITUTION_FLAG = 'ff_school_pulse_v1'; // constitution_pinned
const STAGED_FLAG = 'ff_tutor_v1'; // staged_rollout
const SPECIAL_FLAG = 'ff_atomic_subscription_activation'; // special_do_not_touch
const P11_FLAG = 'ff_competitive_exams_v1'; // p11_payment
const UNPROTECTED_FLAG = 'ff_demo_v1';

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/feature-flags', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }),
  );
  authorizeAdmin.mockResolvedValue(AUTH_OK);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const prevStateFor = (
  flagName: string,
  { enabled = false, rollout = 0 }: { enabled?: boolean; rollout?: number } = {},
) =>
  new Response(
    JSON.stringify([{ flag_name: flagName, is_enabled: enabled, rollout_percentage: rollout }]),
    { status: 200 },
  );

/** PATCH runner. fetch #0 = previous-state read; #1 (if reached) = the write. */
async function runPatch(
  flagName: string,
  updates: Record<string, unknown>,
  confirm?: string,
  prev: Response | null = null,
) {
  fetchSpy
    .mockResolvedValueOnce(prev ?? prevStateFor(flagName))
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: FLAG_ID, flag_name: flagName }]), { status: 200 }),
    );
  const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');
  const body: Record<string, unknown> = { id: FLAG_ID, updates };
  if (confirm !== undefined) body.confirm = confirm;
  const res = await PATCH(req('PATCH', body));
  const writeCall = fetchSpy.mock.calls[1] as [unknown, RequestInit] | undefined;
  return { res, writeCall };
}

async function expectFlagProtected409(
  res: Response,
  flagName: string,
  tier: string,
): Promise<void> {
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.code).toBe('FLAG_PROTECTED');
  expect(body.tier).toBe(tier);
  expect(body.confirm_required).toBe(flagName);
  expect(body.reason).toMatch(/\S/);
}

// ─── PATCH: enable direction requires confirm ─────────────────────────

describe('PATCH protected-flag guardrail — enable requires typed confirm', () => {
  it('enable protected without confirm → 409 FLAG_PROTECTED, ZERO DB writes, ZERO audit, ZERO ops events', async () => {
    const { res, writeCall } = await runPatch(CONSTITUTION_FLAG, { enabled: true });
    await expectFlagProtected409(res, CONSTITUTION_FLAG, 'constitution_pinned');
    // The only fetch is the read-only previous-state lookup — no PATCH write.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(writeCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(logOpsEvent).not.toHaveBeenCalled();
  });

  it('enable with confirm === flag_name → write proceeds and audit carries protected_confirmed:true', async () => {
    const { res, writeCall } = await runPatch(CONSTITUTION_FLAG, { enabled: true }, CONSTITUTION_FLAG);
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    expect(writeCall![1].method).toBe('PATCH');
    expect(JSON.parse(String(writeCall![1].body)).is_enabled).toBe(true);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
    expect(details.flag_name).toBe(CONSTITUTION_FLAG);
  });

  it('enable with a WRONG confirm → 409, no write, no audit', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      'ff_school_pulse_v2', // near-miss typo must NOT pass
    );
    await expectFlagProtected409(res, CONSTITUTION_FLAG, 'constitution_pinned');
    expect(writeCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rollout_percentage > 0 alone (no enabled key) on a protected flag without confirm → 409', async () => {
    const { res, writeCall } = await runPatch(STAGED_FLAG, { rollout_percentage: 10 });
    await expectFlagProtected409(res, STAGED_FLAG, 'staged_rollout');
    expect(writeCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rollout_percentage 0 alone (disable direction) on a staged_rollout flag → confirm-free, write proceeds', async () => {
    const { res, writeCall } = await runPatch(STAGED_FLAG, { rollout_percentage: 0 });
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
  });
});

// ─── PATCH: disable direction — confirm-free EXCEPT payment-safety tiers ──

describe('PATCH protected-flag guardrail — disable direction', () => {
  it('disabling a staged_rollout-tier flag needs NO confirm (kill switches stay fast)', async () => {
    const { res, writeCall } = await runPatch(
      STAGED_FLAG,
      { enabled: false },
      undefined,
      prevStateFor(STAGED_FLAG, { enabled: true, rollout: 100 }),
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    expect(JSON.parse(String(writeCall![1].body)).is_enabled).toBe(false);
    // Confirm-free disable is not a "protected confirmed" write.
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect('protected_confirmed' in details).toBe(false);
  });

  it('disabling a constitution_pinned flag also needs NO confirm', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: false },
      undefined,
      prevStateFor(CONSTITUTION_FLAG, { enabled: true, rollout: 100 }),
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
  });

  it('disabling ff_atomic_subscription_activation (special_do_not_touch — P11 kill-switch) WITHOUT confirm → 409', async () => {
    const { res, writeCall } = await runPatch(
      SPECIAL_FLAG,
      { enabled: false },
      undefined,
      prevStateFor(SPECIAL_FLAG, { enabled: true, rollout: 0 }),
    );
    await expectFlagProtected409(res, SPECIAL_FLAG, 'special_do_not_touch');
    expect(writeCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('disabling ff_atomic_subscription_activation WITH confirm → write proceeds + protected_confirmed:true', async () => {
    const { res, writeCall } = await runPatch(
      SPECIAL_FLAG,
      { enabled: false },
      SPECIAL_FLAG,
      prevStateFor(SPECIAL_FLAG, { enabled: true, rollout: 0 }),
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
  });

  it('disabling a p11_payment-tier flag WITHOUT confirm → 409', async () => {
    const { res, writeCall } = await runPatch(
      P11_FLAG,
      { enabled: false },
      undefined,
      prevStateFor(P11_FLAG, { enabled: true, rollout: 100 }),
    );
    await expectFlagProtected409(res, P11_FLAG, 'p11_payment');
    expect(writeCall).toBeUndefined();
  });
});

// ─── PATCH: unprotected flags entirely unaffected ─────────────────────

describe('PATCH protected-flag guardrail — unprotected flags unaffected', () => {
  it('enabling an unprotected flag needs no confirm and never gets protected_confirmed', async () => {
    const { res, writeCall } = await runPatch(UNPROTECTED_FLAG, { enabled: true });
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect('protected_confirmed' in details).toBe(false);
  });

  it('disabling an unprotected flag needs no confirm', async () => {
    const { res, writeCall } = await runPatch(
      UNPROTECTED_FLAG,
      { enabled: false },
      undefined,
      prevStateFor(UNPROTECTED_FLAG, { enabled: true, rollout: 100 }),
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
  });

  it('description-only update on a PROTECTED flag needs no confirm (not more-enabled, not a gated disable)', async () => {
    const { res, writeCall } = await runPatch(CONSTITUTION_FLAG, { description: 'copy tweak' });
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
  });

  it('KNOWN SEAM (documented in-route): previous-state read failure hides the flag name, so the gate cannot fire — the nightly posture canary is the drift backstop', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      undefined,
      new Response('error', { status: 500 }),
    );
    expect(res.status).toBe(200); // proceeds — this is the accepted seam
    expect(writeCall).toBeDefined();
  });
});

// ─── DELETE guardrail ─────────────────────────────────────────────────

describe('DELETE protected-flag guardrail', () => {
  /** fetch #0 = read-only flag_name lookup; #1 (if reached) = the DELETE. */
  async function runDelete(flagName: string | null, confirm?: string) {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(flagName ? [{ flag_name: flagName }] : []), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: FLAG_ID, flag_name: flagName }]), { status: 200 }),
      );
    const { DELETE } = await import('@/app/api/super-admin/feature-flags/route');
    const body: Record<string, unknown> = { id: FLAG_ID };
    if (confirm !== undefined) body.confirm = confirm;
    const res = await DELETE(req('DELETE', body));
    const deleteCall = fetchSpy.mock.calls[1] as [unknown, RequestInit] | undefined;
    return { res, deleteCall };
  }

  it('deleting a protected flag without confirm → 409 BEFORE the DELETE write, no audit', async () => {
    const { res, deleteCall } = await runDelete(CONSTITUTION_FLAG);
    await expectFlagProtected409(res, CONSTITUTION_FLAG, 'constitution_pinned');
    // Only the read-only name lookup happened.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(deleteCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('deleting a protected flag with confirm === flag_name → DELETE fires + audit protected_confirmed:true', async () => {
    const { res, deleteCall } = await runDelete(CONSTITUTION_FLAG, CONSTITUTION_FLAG);
    expect(res.status).toBe(200);
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1].method).toBe('DELETE');
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
  });

  it('deleting an unprotected flag needs no confirm', async () => {
    const { res, deleteCall } = await runDelete(UNPROTECTED_FLAG);
    expect(res.status).toBe(200);
    expect(deleteCall).toBeDefined();
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect('protected_confirmed' in details).toBe(false);
  });
});

// ─── POST guardrail (delete-recreate bypass closed) ───────────────────

describe('POST protected-flag guardrail — protected NAME requires confirm before ANY I/O', () => {
  async function runPost(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/super-admin/feature-flags/route');
    return POST(req('POST', body));
  }

  it('creating under a protected name without confirm → 409 with ZERO fetches (before even the uniqueness check)', async () => {
    const res = await runPost({ name: 'ff_adaptive_remediation_v1', enabled: false });
    await expectFlagProtected409(res, 'ff_adaptive_remediation_v1', 'constitution_pinned');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('creating under a protected name with a WRONG confirm → 409, zero I/O', async () => {
    const res = await runPost({
      name: 'ff_adaptive_remediation_v1',
      enabled: false,
      confirm: 'ff_adaptive_remediation_v2',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('FLAG_PROTECTED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creating under a protected name with confirm → 201 + audit protected_confirmed:true', async () => {
    const res = await runPost({
      name: 'ff_adaptive_remediation_v1',
      enabled: false,
      confirm: 'ff_adaptive_remediation_v1',
    });
    expect(res.status).toBe(201);
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
  });

  it('the ff_python_ PREFIX rule fires at the POST boundary for an un-enumerated name', async () => {
    const res = await runPost({ name: 'ff_python_shiny_new_service_v1', enabled: false });
    await expectFlagProtected409(res, 'ff_python_shiny_new_service_v1', 'special_do_not_touch');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creating an unprotected name needs no confirm (guardrail is invisible to normal flags)', async () => {
    const res = await runPost({ name: UNPROTECTED_FLAG, enabled: false });
    expect(res.status).toBe(201);
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect('protected_confirmed' in details).toBe(false);
  });
});
