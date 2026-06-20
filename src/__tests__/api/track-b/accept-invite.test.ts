/**
 * Track B, Feature 1 — POST /api/parent/accept-invite
 *
 * Contract under test:
 *   1. A valid link_code redeemed by a signed-in guardian ACTIVATES the
 *      guardian↔student link via the idempotent link_guardian_via_invite_code
 *      RPC, retires the NULL-guardian pending placeholder, and returns 200.
 *   2. Re-accept (already linked) → 200 (RPC ON CONFLICT converges) — no error.
 *   3. Invalid / unknown / expired code → generic 409 error with NO existence
 *      leak (the same generic message regardless of why).
 *   4. Auth required — no Supabase session → 401.
 *   5. No guardian profile → 403.
 *   6. P13 — the link_code never appears in clear in any logger call (truncated
 *      only); no guardian/student PII logged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock — capture every call for the P13 scan ────────────────────────
const loggerCalls: unknown[][] = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => loggerCalls.push(['info', ...a]),
    warn: (...a: unknown[]) => loggerCalls.push(['warn', ...a]),
    error: (...a: unknown[]) => loggerCalls.push(['error', ...a]),
  },
}));

// ── createSupabaseServerClient — controls the cookie session ─────────────────
const { mockAuthGetUser } = vi.hoisted(() => ({ mockAuthGetUser: vi.fn() }));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: (...a: unknown[]) => mockAuthGetUser(...a) },
  }),
}));

// ── supabase-admin — guardians lookup + RPC + students/links state ───────────
const G_AUTH = '00000000-aaaa-4000-8000-000000000001';
const G_ID = '11111111-1111-4111-8111-111111111111';
const S_ID = '22222222-2222-4222-8222-222222222222';
const VALID_CODE = 'ABCD1234';

let guardians: Array<{ id: string; auth_user_id: string }>;
let studentsRows: Array<{ id: string; name: string | null; invite_code: string; is_active: boolean }>;
let links: Array<{ id: string; student_id: string; guardian_id: string | null; status: string }>;
let rpcImpl: (params: Record<string, unknown>) => { data: unknown; error: unknown };
const rpcSpy = vi.fn();
let placeholderUpdated = false;

function freshStore() {
  guardians = [{ id: G_ID, auth_user_id: G_AUTH }];
  studentsRows = [{ id: S_ID, name: 'Asha', invite_code: VALID_CODE, is_active: true }];
  links = [
    // The NULL-guardian pending placeholder created by the invite flow.
    { id: 'pending-1', student_id: S_ID, guardian_id: null, status: 'pending' },
  ];
  placeholderUpdated = false;
  rpcImpl = () => ({ data: { success: true, link_id: 'link-9' }, error: null });
}

function builder(table: 'guardians' | 'students' | 'guardian_student_links') {
  const preds: Array<(r: Record<string, unknown>) => boolean> = [];
  let pendingPatch: Record<string, unknown> | null = null;

  const rows = (): Record<string, unknown>[] => {
    if (table === 'guardians') return guardians as unknown as Record<string, unknown>[];
    if (table === 'students') return studentsRows as unknown as Record<string, unknown>[];
    return links as unknown as Record<string, unknown>[];
  };

  function settle() {
    if (pendingPatch) {
      const matched = rows().filter((r) => preds.every((p) => p(r)));
      for (const m of matched) Object.assign(m, pendingPatch);
      if (table === 'guardian_student_links' && matched.length > 0) placeholderUpdated = true;
      return { data: matched[0] ?? null, error: null };
    }
    const matched = rows().filter((r) => preds.every((p) => p(r)));
    return { data: matched, error: null };
  }

  const chain: Record<string, unknown> = {
    select: () => chain,
    update: (v: Record<string, unknown>) => {
      pendingPatch = v;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      preds.push((r) => r[col] === val);
      return chain;
    },
    is: (col: string, val: unknown) => {
      preds.push((r) => (val === null ? r[col] === null : r[col] === val));
      return chain;
    },
    or: (expr: string) => {
      // e.g. "invite_code.eq.ABCD1234,link_code.eq.ABCD1234"
      const wanted = expr.split(',').map((c) => c.split('.eq.')[1]);
      preds.push((r) => wanted.includes(r.invite_code as string) || wanted.includes(r.link_code as string));
      return chain;
    },
    maybeSingle: () => {
      const s = settle();
      const d = Array.isArray(s.data) ? s.data[0] ?? null : s.data;
      return Promise.resolve({ data: d, error: s.error });
    },
    // The placeholder-cleanup update is awaited directly (no maybeSingle).
    then: (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(onF, onR),
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => {
  const client = {
    from: (table: string) => builder(table as 'guardians' | 'students' | 'guardian_student_links'),
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcSpy(name, params);
      return Promise.resolve(rpcImpl(params));
    },
  };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

// ── Import route under test ──────────────────────────────────────────────────
import { POST } from '@/app/api/parent/accept-invite/route';

function authedAs(authUserId: string | null) {
  mockAuthGetUser.mockResolvedValue({
    data: { user: authUserId ? { id: authUserId } : null },
    error: null,
  });
}

function makePost(body: unknown) {
  return new Request('http://localhost/api/parent/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function allLogText(): string {
  return JSON.stringify(loggerCalls, (_k, v) => (v instanceof Error ? v.message : v));
}

beforeEach(() => {
  vi.clearAllMocks();
  loggerCalls.length = 0;
  freshStore();
});

describe('POST /api/parent/accept-invite', () => {
  it('valid link_code activates the guardian↔student link and retires the pending placeholder (200)', async () => {
    authedAs(G_AUTH);
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.linked).toBe(true);
    expect(json.data.studentName).toBe('Asha');

    // RPC was called with the uppercased code + guardian auth id.
    expect(rpcSpy).toHaveBeenCalledWith('link_guardian_via_invite_code', {
      p_guardian_auth_id: G_AUTH,
      p_invite_code: VALID_CODE,
    });

    // The NULL-guardian pending placeholder was flipped to approved.
    expect(placeholderUpdated).toBe(true);
    expect(links[0].status).toBe('approved');
  });

  it('re-accept (already linked) still returns 200 — the RPC ON CONFLICT path converges', async () => {
    authedAs(G_AUTH);
    // RPC reports success on re-accept (ON CONFLICT → approved).
    rpcImpl = () => ({ data: { success: true, link_id: 'link-9' }, error: null });

    await POST(makePost({ link_code: VALID_CODE }) as never);
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.linked).toBe(true);
  });

  it('invalid/unknown/expired code → generic 409, no existence leak', async () => {
    authedAs(G_AUTH);
    // RPC domain-rejects (invalid/expired/self-link) → success !== true.
    rpcImpl = () => ({ data: { success: false, error: 'invalid_or_expired' }, error: null });

    const res = await POST(makePost({ link_code: 'ZZZZ9999' }) as never);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    // Generic message — does not reveal whether the code exists for some other
    // guardian/student. (We don't assert exact copy, only that it 409s uniformly.)
    expect(typeof json.error).toBe('string');
  });

  it('returns 401 when there is no Supabase session', async () => {
    authedAs(null);
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(401);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no guardian profile', async () => {
    authedAs(G_AUTH);
    guardians = []; // no guardian row for this auth user
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(403);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when link_code is missing/blank', async () => {
    authedAs(G_AUTH);
    const res = await POST(makePost({ link_code: '   ' }) as never);
    expect(res.status).toBe(400);
  });

  // ── P13 — link_code never logged in clear ──────────────────────────────────
  it('P13: the full link_code never appears in clear in any logger call (truncated only)', async () => {
    authedAs(G_AUTH);
    await POST(makePost({ link_code: VALID_CODE }) as never);

    const text = allLogText();
    // The success log fires (codeTruncated only).
    expect(text).toContain('accept_invite_linked');
    // The full code must never appear; the truncated form (ABCD****) may.
    expect(text).not.toContain(VALID_CODE);
    expect(text).toContain('ABCD****');
  });
});
