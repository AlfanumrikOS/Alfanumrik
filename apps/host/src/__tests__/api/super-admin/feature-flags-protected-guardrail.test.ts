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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROTECTED_FLAGS, EXPECTED_OFF_FLAGS } from '@alfanumrik/lib/flags/protected-flags';

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

/**
 * PATCH runner. fetch order for an UNGATED update: #0 = previous-state read,
 * #1 (if reached) = the write (raw PATCH). For a GATED-and-CONFIRMED
 * protected update (Phase 0, 2026-07-22), an extra burst-guard count-check
 * call (HEAD to admin_audit_log) lands between the previous-state read and
 * the write, and the write itself becomes a POST to the
 * admin_flip_feature_flag RPC instead of a raw PATCH — pass
 * `expectGatedRpc: true` so this helper queues the count-check response
 * (reporting 0 prior mutations, so the burst gate itself never fires here —
 * that gate is pinned separately below) and shapes the write response as the
 * RPC's single-object jsonb return instead of the raw-PATCH array-of-rows
 * return. `writeCall` is found by matching HTTP method (PATCH or POST),
 * never by a fixed call index, so it is correct in both shapes.
 */
async function runPatch(
  flagName: string,
  updates: Record<string, unknown>,
  confirm?: string,
  prev: Response | null = null,
  opts: { expectGatedRpc?: boolean; burstCountResponse?: Response; bulkConfirm?: string } = {},
) {
  fetchSpy.mockResolvedValueOnce(prev ?? prevStateFor(flagName));
  if (opts.expectGatedRpc) {
    fetchSpy.mockResolvedValueOnce(
      opts.burstCountResponse ?? new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: FLAG_ID, flag_name: flagName }), { status: 200 }),
    );
  } else {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: FLAG_ID, flag_name: flagName }]), { status: 200 }),
    );
  }
  const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');
  const body: Record<string, unknown> = { id: FLAG_ID, updates };
  if (confirm !== undefined) body.confirm = confirm;
  if (opts.bulkConfirm !== undefined) body.bulk_confirm = opts.bulkConfirm;
  const res = await PATCH(req('PATCH', body));
  const writeCall = fetchSpy.mock.calls.find(([, init]) => {
    const method = (init as RequestInit | undefined)?.method;
    return method === 'PATCH' || method === 'POST';
  }) as [string, RequestInit] | undefined;
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

  it('enable with confirm === flag_name → write proceeds via the admin_flip_feature_flag RPC and audit carries protected_confirmed:true + tier', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      CONSTITUTION_FLAG,
      null,
      { expectGatedRpc: true },
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    // Phase 0 (2026-07-22): a GATED-and-CONFIRMED protected mutation now
    // writes via a POST to the admin_flip_feature_flag RPC, not a raw PATCH.
    expect(writeCall![1].method).toBe('POST');
    const rpcBody = JSON.parse(String(writeCall![1].body));
    expect(String(writeCall![0])).toContain('/rpc/admin_flip_feature_flag');
    expect(rpcBody.p_flag_name).toBe(CONSTITUTION_FLAG);
    expect(rpcBody.p_confirm).toBe(CONSTITUTION_FLAG);
    expect(rpcBody.p_updates.is_enabled).toBe(true);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
    expect(details.flag_name).toBe(CONSTITUTION_FLAG);
    expect(details.tier).toBe('constitution_pinned');
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

// ─── PATCH: rename-bypass guard (backend review, Phase 0 follow-up 2026-07-22) ──
//
// Renaming a protected flag is a BYPASS vector (protection is keyed strictly
// by flag_name), so it is blocked OUTRIGHT — not merely gated behind confirm
// like the enable-direction case above. This is checked BEFORE the
// makingMoreEnabled/disableGated computation, so combining a rename with an
// enable in the SAME request must still surface FLAG_RENAME_BLOCKED (not the
// generic FLAG_PROTECTED enable-confirm prompt), and a typed confirm cannot
// unlock it either.

describe('PATCH protected-flag guardrail — rename-bypass guard', () => {
  it('renaming a protected flag while ALSO enabling it in the same request → 409 FLAG_RENAME_BLOCKED, zero DB writes, zero audit', async () => {
    const { res, writeCall } = await runPatch(CONSTITUTION_FLAG, {
      name: 'ff_school_pulse_v2',
      enabled: true,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('FLAG_RENAME_BLOCKED');
    expect(body.tier).toBe('constitution_pinned');
    expect(body.error).toMatch(/cannot be renamed/);
    // Only the read-only previous-state lookup happened — no write, no audit.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(writeCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(logOpsEvent).not.toHaveBeenCalled();
  });

  it('a typed confirm matching the flag name does NOT unlock a combined rename+enable — still 409 FLAG_RENAME_BLOCKED', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { name: 'ff_school_pulse_v2', enabled: true },
      CONSTITUTION_FLAG, // confirm === the exact current flag_name
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('FLAG_RENAME_BLOCKED');
    expect(writeCall).toBeUndefined();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('renaming a protected flag with NO other field changed is also blocked (rename alone is the bypass vector)', async () => {
    const { res, writeCall } = await runPatch(STAGED_FLAG, { name: 'ff_tutor_v2' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('FLAG_RENAME_BLOCKED');
    expect(writeCall).toBeUndefined();
  });

  it('renaming an UNPROTECTED flag is unaffected by this guard (no FLAG_RENAME_BLOCKED)', async () => {
    const { res, writeCall } = await runPatch(UNPROTECTED_FLAG, { name: 'ff_demo_v2' });
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

  it('disabling ff_atomic_subscription_activation WITH confirm → write proceeds via the RPC + protected_confirmed:true + tier', async () => {
    const { res, writeCall } = await runPatch(
      SPECIAL_FLAG,
      { enabled: false },
      SPECIAL_FLAG,
      prevStateFor(SPECIAL_FLAG, { enabled: true, rollout: 0 }),
      { expectGatedRpc: true },
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    expect(writeCall![1].method).toBe('POST');
    const rpcBody = JSON.parse(String(writeCall![1].body));
    expect(rpcBody.p_flag_name).toBe(SPECIAL_FLAG);
    expect(rpcBody.p_updates.is_enabled).toBe(false);
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
    expect(details.tier).toBe('special_do_not_touch');
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

// ─── PATCH: velocity / burst guard (Phase 0, 2026-07-22) ──────────────
//
// >3 CONFIRMED protected-flag mutations by the SAME admin within the
// trailing 10-minute window require a SECOND confirmation
// (bulk_confirm === "BULK-<ordinal>-<flag_name>") before the 4th+ mutation
// proceeds — this is the guard that would have tripped after the 3rd flag
// in the 2026-07-20 incident (49 flags flipped in one bulk action).

describe('PATCH protected-flag guardrail — velocity/burst guard', () => {
  /** content-range total=3 → priorCount=3 → this mutation is ordinal 4 (blocked without bulk_confirm). */
  const THREE_PRIOR = new Response(null, { status: 200, headers: { 'content-range': '0-2/3' } });

  it('4th confirmed protected mutation in the window WITHOUT bulk_confirm → 409 FLAG_BULK_CONFIRM_REQUIRED, no write, distinct burst audit action', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      CONSTITUTION_FLAG,
      null,
      { expectGatedRpc: true, burstCountResponse: THREE_PRIOR },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('FLAG_BULK_CONFIRM_REQUIRED');
    expect(body.bulk_confirm_required).toBe(`BULK-4-${CONSTITUTION_FLAG}`);
    expect(writeCall).toBeUndefined(); // the burst gate refused BEFORE the RPC write
    // Distinct audit action for the burst ATTEMPT itself (durable even when refused).
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    expect(logAdminAudit.mock.calls[0][1]).toBe('feature_flag.bulk_mutation_burst');
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.attempted_ordinal).toBe(4);
    expect(details.recent_mutation_count).toBe(3);
  });

  it('4th confirmed protected mutation WITH the correct bulk_confirm token → write proceeds', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      CONSTITUTION_FLAG,
      null,
      { expectGatedRpc: true, burstCountResponse: THREE_PRIOR, bulkConfirm: `BULK-4-${CONSTITUTION_FLAG}` },
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
    // Only the eventual 'feature_flag.updated' audit fires; the burst gate did not refuse.
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    expect(logAdminAudit.mock.calls[0][1]).toBe('feature_flag.updated');
  });

  it('4th confirmed protected mutation WITH a WRONG bulk_confirm token → 409, no write', async () => {
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      CONSTITUTION_FLAG,
      null,
      { expectGatedRpc: true, burstCountResponse: THREE_PRIOR, bulkConfirm: 'BULK-4-wrong-flag-name' },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('FLAG_BULK_CONFIRM_REQUIRED');
    expect(writeCall).toBeUndefined();
  });

  it('the 1st-3rd confirmed protected mutation in the window (ordinal <= 3) needs NO bulk_confirm', async () => {
    // Default burst-check response (content-range 0-0/0) reports 0 prior
    // mutations — ordinal 1, well under the threshold.
    const { res, writeCall } = await runPatch(
      CONSTITUTION_FLAG,
      { enabled: true },
      CONSTITUTION_FLAG,
      null,
      { expectGatedRpc: true },
    );
    expect(res.status).toBe(200);
    expect(writeCall).toBeDefined();
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
  /**
   * fetch order for an UNGATED delete (no protection, or refused before
   * confirm): #0 = read-only flag_name lookup; #1 (if reached) = the DELETE.
   * For a CONFIRMED protected delete (Phase 0, 2026-07-22), an extra
   * burst-guard count-check call (HEAD to admin_audit_log) lands between the
   * lookup and the DELETE — pass `expectBurstCheck: true` so this helper
   * queues that response. `deleteCall` is found by matching HTTP method
   * (DELETE), never by a fixed call index.
   */
  async function runDelete(
    flagName: string | null,
    confirm?: string,
    opts: { expectBurstCheck?: boolean } = {},
  ) {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(flagName ? [{ flag_name: flagName }] : []), { status: 200 }),
    );
    if (opts.expectBurstCheck) {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } }));
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: FLAG_ID, flag_name: flagName }]), { status: 200 }),
    );
    const { DELETE } = await import('@/app/api/super-admin/feature-flags/route');
    const body: Record<string, unknown> = { id: FLAG_ID };
    if (confirm !== undefined) body.confirm = confirm;
    const res = await DELETE(req('DELETE', body));
    const deleteCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE') as
      | [string, RequestInit]
      | undefined;
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

  it('deleting a protected flag with confirm === flag_name → DELETE fires + audit protected_confirmed:true + tier', async () => {
    const { res, deleteCall } = await runDelete(CONSTITUTION_FLAG, CONSTITUTION_FLAG, { expectBurstCheck: true });
    expect(res.status).toBe(200);
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1].method).toBe('DELETE');
    const details = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(details.protected_confirmed).toBe(true);
    expect(details.tier).toBe('constitution_pinned');
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

// ─── DB/TS registry parity (Phase 0 flag-governance hardening, 2026-07-22) ──
//
// packages/lib/src/flags/protected-flags.ts (PROTECTED_FLAGS/EXPECTED_OFF_FLAGS)
// is now mirrored 1:1 into public.protected_feature_flags (migration
// 20260722090000_protected_feature_flags_registry.sql), which the DB-layer
// BEFORE UPDATE trigger (migration 20260722090100) reads to block a direct-
// Postgres mutation of a protected flag. If the two registries ever drift —
// someone adds a flag to the TS registry but forgets the migration, or vice
// versa — the DB guard silently stops covering (or starts wrongly covering) a
// flag. This suite reads BOTH sources statically (no live DB required — same
// pattern as portal-rbac-remediation-migration-canaries.test.ts /
// v3-school-rpc-predeploy.test.ts) and pins that they can never silently
// disagree.
//
// If this suite fails after adding/removing a PROTECTED_FLAGS entry: add a
// companion migration updating protected_feature_flags in the SAME PR, don't
// weaken this test.
describe('protected_feature_flags DB/TS registry parity', () => {
  const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
  const SEED_MIGRATION_PATH = resolve(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260722090000_protected_feature_flags_registry.sql',
  );

  function parseSeededRows(): Map<string, string> {
    const raw = readFileSync(SEED_MIGRATION_PATH, 'utf8');
    const startMarker = 'INSERT INTO public.protected_feature_flags (flag_name, tier, reason) VALUES';
    const startIdx = raw.indexOf(startMarker);
    expect(startIdx, 'seed INSERT statement not found in migration').toBeGreaterThan(-1);
    const endIdx = raw.indexOf('ON CONFLICT (flag_name)', startIdx);
    expect(endIdx, 'ON CONFLICT clause not found after seed INSERT').toBeGreaterThan(startIdx);
    const block = raw.slice(startIdx, endIdx);

    const rowRe = /\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*,/g;
    const rows = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(block))) {
      rows.set(m[1], m[2]);
    }
    return rows;
  }

  it('the seed migration parses to at least one row (sanity check on the parser itself)', () => {
    const rows = parseSeededRows();
    expect(rows.size).toBeGreaterThan(0);
  });

  it('every PROTECTED_FLAGS key is seeded in protected_feature_flags with the matching tier', () => {
    const rows = parseSeededRows();
    const missing: string[] = [];
    const tierMismatches: string[] = [];
    for (const [flagName, protection] of Object.entries(PROTECTED_FLAGS)) {
      const seededTier = rows.get(flagName);
      if (seededTier === undefined) {
        missing.push(flagName);
        continue;
      }
      if (seededTier !== protection.tier) {
        tierMismatches.push(`${flagName}: TS=${protection.tier} DB=${seededTier}`);
      }
    }
    expect(missing, `PROTECTED_FLAGS keys missing from the DB seed migration: ${missing.join(', ')}`).toEqual([]);
    expect(tierMismatches, `tier mismatches between TS and DB: ${tierMismatches.join('; ')}`).toEqual([]);
  });

  it('every row seeded in protected_feature_flags exists in PROTECTED_FLAGS (no orphan DB rows)', () => {
    const rows = parseSeededRows();
    const orphans: string[] = [];
    for (const flagName of rows.keys()) {
      if (!(flagName in PROTECTED_FLAGS)) orphans.push(flagName);
    }
    expect(orphans, `DB-seeded flags with no PROTECTED_FLAGS entry: ${orphans.join(', ')}`).toEqual([]);
  });

  it('the DB seed row count exactly equals the number of PROTECTED_FLAGS keys (no duplicates, no gaps)', () => {
    const rows = parseSeededRows();
    expect(rows.size).toBe(Object.keys(PROTECTED_FLAGS).length);
  });

  it('EXPECTED_OFF_FLAGS is a subset of PROTECTED_FLAGS keys (every canary-watched flag is also console-protected)', () => {
    const notProtected = EXPECTED_OFF_FLAGS.filter((name) => !(name in PROTECTED_FLAGS));
    expect(notProtected, `EXPECTED_OFF_FLAGS entries missing from PROTECTED_FLAGS: ${notProtected.join(', ')}`).toEqual([]);
  });

  it('the two Pedagogy v2 flags added 2026-07-22 are present in both the TS registry and the DB seed with tier constitution_pinned', () => {
    const rows = parseSeededRows();
    for (const flagName of ['ff_productive_failure_v1', 'ff_pedagogy_v2_monthly_synthesis']) {
      expect(PROTECTED_FLAGS[flagName]?.tier, `${flagName} missing/wrong tier in PROTECTED_FLAGS`).toBe('constitution_pinned');
      expect(rows.get(flagName), `${flagName} missing/wrong tier in DB seed`).toBe('constitution_pinned');
      expect(EXPECTED_OFF_FLAGS.includes(flagName), `${flagName} missing from EXPECTED_OFF_FLAGS`).toBe(true);
    }
  });
});
