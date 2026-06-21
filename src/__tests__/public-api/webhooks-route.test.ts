/**
 * Track A.6 — Outbound webhook subscription management route tests.
 * (`src/app/api/school-admin/webhooks/route.ts` — POST / GET / DELETE)
 * ============================================================================
 * Covers (per the testing brief, item 5):
 *   - POST returns the raw signing secret EXACTLY ONCE and stores only secret_hash
 *     (assert the persisted insert row carries NO raw secret; the returned secret
 *     is `whsec_…` and its SHA-256 equals the stored secret_hash).
 *   - create rejects http / private (SSRF) target_url → 400, nothing inserted.
 *   - GET never returns secret_hash.
 *   - own-school scoping: body school_id is ignored; insert/update/delete are
 *     scoped to auth.schoolId.
 *   - permission gate: public_api.manage; 403 short-circuits before any DB I/O.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAuthorize, mockLogSchoolAudit, inserts, updates, selectColumns } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ patch: Record<string, unknown>; eqs: Array<{ col: string; val: unknown }> }>,
  selectColumns: [] as string[],
}));

vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@/lib/audit', () => ({ logSchoolAudit: (...a: unknown[]) => mockLogSchoolAudit(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// Rows the GET list returns (set per test).
let listRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'webhook_subscriptions') throw new Error(`unexpected table: ${table}`);
      const builder: Record<string, unknown> = {};
      // GET: .select(cols).eq('school_id',…).order(…)  → thenable
      builder.select = (cols: string) => {
        selectColumns.push(cols);
        return builder;
      };
      builder.eq = () => builder;
      builder.order = () =>
        Promise.resolve({ data: listRows, error: null });
      // POST: .insert(row).select(cols).single()
      builder.insert = (row: Record<string, unknown>) => {
        inserts.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'sub-new',
                target_url: row.target_url,
                event_types: row.event_types,
                is_active: row.is_active,
                description: row.description ?? null,
                created_at: '2026-06-21T00:00:00Z',
              },
              error: null,
            }),
          }),
        };
      };
      // DELETE: .update(patch).eq('id',…).eq('school_id',…).select().single()
      builder.update = (patch: Record<string, unknown>) => {
        const rec = { patch, eqs: [] as Array<{ col: string; val: unknown }> };
        updates.push(rec);
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, val: unknown) => {
          rec.eqs.push({ col, val });
          return chain;
        };
        chain.select = () => ({
          single: async () => ({ data: { id: 'sub-1', is_active: false }, error: null }),
        });
        return chain;
      };
      return builder;
    },
  }),
}));

import { POST, GET, DELETE } from '@/app/api/school-admin/webhooks/route';

const SCHOOL_A = 'school-A';
const SCHOOL_B = 'school-B';
const ADMIN = 'admin-1';

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function authedAs(schoolId = SCHOOL_A) {
  mockAuthorize.mockResolvedValue({ authorized: true, schoolId, userId: ADMIN, schoolAdminId: 'r' });
}
function denied(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    schoolId: null,
    userId: null,
    errorResponse: new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status }),
  });
}
function postReq(body: unknown) {
  return new Request('http://localhost/api/school-admin/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function delReq(body: unknown) {
  return new Request('http://localhost/api/school-admin/webhooks', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  selectColumns.length = 0;
  listRows = [];
});

describe('webhooks POST — secret handling (P13: hash-only persistence)', () => {
  it('returns the raw secret ONCE and persists ONLY a secret_hash (SHA-256 of the raw)', async () => {
    authedAs();
    const res = await POST(
      postReq({ target_url: 'https://hooks.partner.io/x', event_types: ['student.enrolled'] }) as never,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { secret: string } };

    // Raw secret returned to the caller exactly once.
    expect(json.data.secret).toMatch(/^whsec_[0-9a-f]{64}$/);

    // The persisted insert row stores secret_hash, NOT the raw secret.
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row).toHaveProperty('secret_hash');
    expect(row).not.toHaveProperty('secret');
    expect(String(row.secret_hash)).not.toContain(json.data.secret);
    // The stored hash is exactly SHA-256(raw secret).
    expect(row.secret_hash).toBe(await sha256Hex(json.data.secret));
  });

  it('the persisted row never contains the raw secret string anywhere', async () => {
    authedAs();
    const res = await POST(
      postReq({ target_url: 'https://hooks.partner.io/x', event_types: ['student.enrolled'] }) as never,
    );
    const json = (await res.json()) as { data: { secret: string } };
    expect(JSON.stringify(inserts)).not.toContain(json.data.secret);
  });

  it('audit metadata carries the host + event_types only — never the raw secret or hash', async () => {
    authedAs();
    const res = await POST(
      postReq({ target_url: 'https://hooks.partner.io/x', event_types: ['student.enrolled'] }) as never,
    );
    const json = (await res.json()) as { data: { secret: string } };
    const auditBlob = JSON.stringify(mockLogSchoolAudit.mock.calls);
    expect(auditBlob).not.toContain(json.data.secret);
    expect(auditBlob).not.toMatch(/secret_hash/i);
    expect(auditBlob).toMatch(/student\.enrolled/);
  });
});

describe('webhooks POST — SSRF / scheme validation at create', () => {
  it('rejects an http target_url → 400, nothing persisted', async () => {
    authedAs();
    const res = await POST(postReq({ target_url: 'http://hooks.partner.io/x', event_types: ['student.enrolled'] }) as never);
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('rejects a private/loopback target_url → 400', async () => {
    authedAs();
    for (const target of ['https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/x']) {
      inserts.length = 0;
      const res = await POST(postReq({ target_url: target, event_types: ['student.enrolled'] }) as never);
      expect(res.status, target).toBe(400);
      expect(inserts).toHaveLength(0);
    }
  });

  it('rejects an unknown event_type → 400', async () => {
    authedAs();
    const res = await POST(postReq({ target_url: 'https://ok.example.com/x', event_types: ['not.a.real.event'] }) as never);
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});

describe('webhooks POST — own-school scoping (body school_id ignored)', () => {
  it('persists school_id from auth, never from the body', async () => {
    authedAs(SCHOOL_A);
    await POST(
      postReq({ school_id: SCHOOL_B, target_url: 'https://ok.example.com/x', event_types: ['student.enrolled'] }) as never,
    );
    expect(inserts[0].school_id).toBe(SCHOOL_A);
    expect(inserts[0].school_id).not.toBe(SCHOOL_B);
  });
});

describe('webhooks GET — never returns secret_hash', () => {
  it('does not select or return secret_hash', async () => {
    authedAs();
    listRows = [
      { id: 'sub-1', target_url: 'https://ok.example.com/x', event_types: ['student.enrolled'], is_active: true, description: null, created_at: 't', updated_at: 't' },
    ];
    const res = await GET(new Request('http://localhost/api/school-admin/webhooks') as never);
    const json = (await res.json()) as { data: { subscriptions: Array<Record<string, unknown>> } };
    // The select column list must not request secret_hash.
    expect(selectColumns.join(',')).not.toMatch(/secret_hash/i);
    // And the returned payload carries no hash.
    expect(JSON.stringify(json)).not.toMatch(/secret_hash/i);
    expect(json.data.subscriptions[0]).not.toHaveProperty('secret_hash');
  });
});

describe('webhooks DELETE — own-school tenant isolation (soft delete)', () => {
  it('scopes the deactivation to auth.schoolId', async () => {
    authedAs(SCHOOL_A);
    const res = await DELETE(delReq({ id: 'sub-1' }) as never);
    expect(res.status).toBe(200);
    const rec = updates[0];
    expect(rec.patch).toMatchObject({ is_active: false });
    expect(rec.eqs.some((e) => e.col === 'school_id' && e.val === SCHOOL_A)).toBe(true);
    expect(rec.eqs.some((e) => e.col === 'school_id' && e.val === SCHOOL_B)).toBe(false);
  });
});

describe('webhooks — permission gate (public_api.manage)', () => {
  it('POST requests the public_api.manage permission', async () => {
    authedAs();
    await POST(postReq({ target_url: 'https://ok.example.com/x', event_types: ['student.enrolled'] }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'public_api.manage');
  });

  it.each([
    ['POST', () => POST(postReq({ target_url: 'https://ok.example.com/x', event_types: ['student.enrolled'] }) as never)],
    ['GET', () => GET(new Request('http://localhost/api/school-admin/webhooks') as never)],
    ['DELETE', () => DELETE(delReq({ id: 'sub-1' }) as never)],
  ])('%s returns 403 and does no DB I/O when not authorized', async (_m, call) => {
    denied(403);
    const res = await call();
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
