/**
 * /api/parent/consent — Phase D.1 contract tests.
 *
 * Pins:
 *   - POST happy path: inserts row, publishes parent.consent_granted,
 *     writes audit_logs row, returns 200 + { consentId }.
 *   - POST without curriculum_access scope → 400.
 *   - POST cross-guardian (caller not linked to studentId) → 403.
 *   - POST when no Supabase session → 401.
 *   - POST when guardian profile missing → 403.
 *   - DELETE happy path: flips revoked_at, publishes revoke event,
 *     writes audit row.
 *   - DELETE without an active row → 404.
 *   - DELETE cross-guardian → 403.
 *   - GET returns caller's active consents.
 *   - GET when unauthenticated → 401.
 *
 * Logger silenced. publishEvent + auditLog mocked to spy-only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger silencer ────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── createSupabaseServerClient mock — controls auth.getUser ────────────
const { mockAuthGetUser } = vi.hoisted(() => ({ mockAuthGetUser: vi.fn() }));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: (...a: unknown[]) => mockAuthGetUser(...a) },
  }),
}));

// ── publishEvent + auditLog spies ──────────────────────────────────────
const { mockPublish, mockAudit } = vi.hoisted(() => ({
  mockPublish: vi.fn().mockResolvedValue({ published: true }),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
vi.mock('@alfanumrik/lib/audit', () => ({
  auditLog: (...args: unknown[]) => mockAudit(...args),
}));

// ── supabase-admin mock — multi-table state machine ────────────────────
//
// Tables modelled:
//   guardians:                { id, auth_user_id }
//   guardian_student_links:   { id, guardian_id, student_id, status }
//   parental_consent:         { id, guardian_id, student_id, consent_version,
//                                granted_at, revoked_at, consent_payload,
//                                ip_address, user_agent }
//
// All three tables operate via the same lightweight chainable builder.

// v4 UUIDs — position 14 must be '4', position 19 must be [89ab].
// The route uses isValidUUID (src/lib/sanitize.ts:31) which is strict v4.
const G1_AUTH = '00000000-aaaa-4000-8000-000000000001';
const G2_AUTH = '00000000-aaaa-4000-8000-000000000002';
const G1_ID   = '11111111-1111-4111-8111-111111111111';
const G2_ID   = '22222222-2222-4222-8222-222222222222';
const S1_ID   = '33333333-3333-4333-8333-333333333333';
const S2_ID   = '44444444-4444-4444-8444-444444444444';

interface Tables {
  guardians: Array<{ id: string; auth_user_id: string }>;
  guardian_student_links: Array<{
    id: string;
    guardian_id: string;
    student_id: string;
    status: string;
  }>;
  parental_consent: Array<{
    id: string;
    guardian_id: string;
    student_id: string;
    consent_version: string;
    granted_at: string;
    revoked_at: string | null;
    consent_payload: Record<string, unknown>;
    ip_address: string | null;
    user_agent: string | null;
  }>;
}

let tables: Tables;
let nextConsentId = 1;

function freshTables(): Tables {
  return {
    guardians: [
      { id: G1_ID, auth_user_id: G1_AUTH },
      { id: G2_ID, auth_user_id: G2_AUTH },
    ],
    guardian_student_links: [
      { id: 'link-1', guardian_id: G1_ID, student_id: S1_ID, status: 'active' },
      { id: 'link-2', guardian_id: G2_ID, student_id: S2_ID, status: 'active' },
    ],
    parental_consent: [],
  };
}

function makeBuilder(tableName: keyof Tables) {
  type Pred = (r: Record<string, unknown>) => boolean;
  const filters: Pred[] = [];
  let pendingPatch: Record<string, unknown> | null = null;
  let pendingInsert: Record<string, unknown> | null = null;
  let limitN: number | null = null;
  let selectCols: string | null = null;
  // .in('status', ['active','approved'])
  const inFilters: Pred[] = [];

  const data = () => tables[tableName] as unknown as Record<string, unknown>[];

  const resolve = (): { data: unknown; error: unknown } => {
    if (pendingInsert) {
      // Unique constraint on (guardian_id, student_id, revoked_at) for consent.
      if (tableName === 'parental_consent') {
        const dup = (tables.parental_consent as Tables['parental_consent']).find(
          (r) =>
            r.guardian_id === pendingInsert!.guardian_id &&
            r.student_id === pendingInsert!.student_id &&
            r.revoked_at === ((pendingInsert!.revoked_at as string | null) ?? null),
        );
        if (dup) return { data: null, error: { code: '23505', message: 'unique_violation' } };
        const row = {
          id: `c-${nextConsentId++}`,
          granted_at: new Date().toISOString(),
          revoked_at: null,
          consent_payload: {},
          ip_address: null,
          user_agent: null,
          ...pendingInsert,
        };
        tables.parental_consent.push(row as Tables['parental_consent'][number]);
        return { data: { id: row.id }, error: null };
      }
      return { data: null, error: null };
    }
    if (pendingPatch) {
      const matched = data().filter((r) => filters.every((p) => p(r)) && inFilters.every((p) => p(r)));
      for (const m of matched) Object.assign(m, pendingPatch);
      return { data: matched[0] ?? null, error: null };
    }
    let result = data().filter((r) => filters.every((p) => p(r)) && inFilters.every((p) => p(r)));
    if (limitN !== null) result = result.slice(0, limitN);
    if (selectCols && selectCols !== '*') {
      const cols = selectCols.split(',').map((s) => s.trim());
      result = result.map((row) => {
        const out: Record<string, unknown> = {};
        for (const c of cols) out[c] = row[c];
        return out;
      });
    }
    return { data: result, error: null };
  };

  const chain = {
    select(cols?: string) {
      selectCols = cols ?? null;
      return chain;
    },
    insert(values: Record<string, unknown>) {
      pendingInsert = values;
      return chain;
    },
    update(patch: Record<string, unknown>) {
      pendingPatch = patch;
      return chain;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return chain;
    },
    is(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return chain;
    },
    in(col: string, vals: unknown[]) {
      inFilters.push((r) => vals.includes(r[col]));
      return chain;
    },
    limit(n: number) {
      limitN = n;
      return chain;
    },
    async single() {
      const r = resolve();
      if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error };
      return r;
    },
    async maybeSingle() {
      const r = resolve();
      if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error };
      return r;
    },
    then(...args: Parameters<Promise<unknown>['then']>) {
      return Promise.resolve(resolve()).then(...args);
    },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from(tbl: string) {
      if (tbl === 'guardians' || tbl === 'guardian_student_links' || tbl === 'parental_consent') {
        return makeBuilder(tbl as keyof Tables);
      }
      throw new Error(`unexpected table: ${tbl}`);
    },
  },
}));

// ── Import the route under test ─────────────────────────────────────────
import { POST, DELETE, GET } from '@/app/api/parent/consent/route';

// ── Helpers ────────────────────────────────────────────────────────────
function authedAs(authUserId: string | null) {
  if (authUserId === null) {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });
  } else {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: authUserId } },
      error: null,
    });
  }
}

function makePost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/parent/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function makeDelete(body: unknown): Request {
  return new Request('http://localhost/api/parent/consent', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function makeGet(): Request {
  return new Request('http://localhost/api/parent/consent', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  tables = freshTables();
  nextConsentId = 1;
  mockPublish.mockResolvedValue({ published: true });
  mockAudit.mockResolvedValue(undefined);
});

// ── POST ───────────────────────────────────────────────────────────────
describe('POST /api/parent/consent', () => {
  it('happy path: inserts row, publishes event, writes audit', async () => {
    authedAs(G1_AUTH);
    const res = await POST(
      makePost({
        studentId: S1_ID,
        scopes: { curriculum_access: true, performance_data_sharing_with_teacher: true },
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.consentId).toMatch(/^c-/);

    expect(tables.parental_consent).toHaveLength(1);
    expect(tables.parental_consent[0].guardian_id).toBe(G1_ID);
    expect(tables.parental_consent[0].student_id).toBe(S1_ID);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [, event] = mockPublish.mock.calls[0];
    expect((event as { kind: string }).kind).toBe('parent.consent_granted');

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const auditArgs = mockAudit.mock.calls[0][0] as { action: string; actor_id: string };
    expect(auditArgs.action).toBe('parent.consent.granted');
    expect(auditArgs.actor_id).toBe(G1_AUTH);
  });

  it('returns 400 when curriculum_access scope is missing', async () => {
    authedAs(G1_AUTH);
    const res = await POST(
      makePost({ studentId: S1_ID, scopes: { marketing_emails: true } }) as never,
    );
    expect(res.status).toBe(400);
    expect(tables.parental_consent).toHaveLength(0);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns 403 when guardian is not linked to studentId', async () => {
    authedAs(G1_AUTH);
    // G1 is linked to S1, NOT to S2. Attempting consent for S2 must 403.
    const res = await POST(
      makePost({ studentId: S2_ID, scopes: { curriculum_access: true } }) as never,
    );
    expect(res.status).toBe(403);
    expect(tables.parental_consent).toHaveLength(0);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns 401 when no Supabase session', async () => {
    authedAs(null);
    const res = await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when guardian profile is missing', async () => {
    // An auth user with no guardians row.
    authedAs('99999999-9999-9999-9999-999999999999');
    const res = await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never,
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid UUID studentId', async () => {
    authedAs(G1_AUTH);
    const res = await POST(
      makePost({ studentId: 'not-a-uuid', scopes: { curriculum_access: true } }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 409 on unique-active conflict (already consented)', async () => {
    authedAs(G1_AUTH);
    await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never,
    );
    const res = await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never,
    );
    expect(res.status).toBe(409);
  });

  it('strips unknown scope keys silently (defense-in-depth)', async () => {
    authedAs(G1_AUTH);
    const res = await POST(
      makePost({
        studentId: S1_ID,
        scopes: { curriculum_access: true, hacker_scope: true },
      }) as never,
    );
    expect(res.status).toBe(200);
    const stored = tables.parental_consent[0].consent_payload as { scopes: Record<string, boolean> };
    expect(stored.scopes.hacker_scope).toBeUndefined();
    expect(stored.scopes.curriculum_access).toBe(true);
  });
});

// ── DELETE ─────────────────────────────────────────────────────────────
describe('DELETE /api/parent/consent', () => {
  it('happy path: revokes, publishes event, writes audit', async () => {
    authedAs(G1_AUTH);
    // First grant.
    await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never,
    );
    mockPublish.mockClear();
    mockAudit.mockClear();

    const res = await DELETE(makeDelete({ studentId: S1_ID }) as never);
    expect(res.status).toBe(200);
    expect(tables.parental_consent[0].revoked_at).not.toBeNull();

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [, event] = mockPublish.mock.calls[0];
    expect((event as { kind: string }).kind).toBe('parent.consent_revoked');

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const auditArgs = mockAudit.mock.calls[0][0] as { action: string };
    expect(auditArgs.action).toBe('parent.consent.revoked');
  });

  it('returns 404 when there is no active row to revoke', async () => {
    authedAs(G1_AUTH);
    const res = await DELETE(makeDelete({ studentId: S1_ID }) as never);
    expect(res.status).toBe(404);
  });

  it('returns 403 when guardian is not linked to studentId', async () => {
    authedAs(G1_AUTH);
    const res = await DELETE(makeDelete({ studentId: S2_ID }) as never);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no Supabase session', async () => {
    authedAs(null);
    const res = await DELETE(makeDelete({ studentId: S1_ID }) as never);
    expect(res.status).toBe(401);
  });
});

// ── GET ────────────────────────────────────────────────────────────────
describe('GET /api/parent/consent', () => {
  it('returns the caller\'s active consents and current version', async () => {
    authedAs(G1_AUTH);
    await POST(
      makePost({ studentId: S1_ID, scopes: { curriculum_access: true } }) as never,
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].studentId).toBe(S1_ID);
    expect(typeof json.currentVersion).toBe('string');
    expect(json.currentVersion.length).toBeGreaterThan(0);
  });

  it('returns 401 when unauthenticated', async () => {
    authedAs(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns an empty list when caller has no consents', async () => {
    authedAs(G1_AUTH);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
  });
});
