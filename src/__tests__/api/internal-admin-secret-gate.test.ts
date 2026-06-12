/**
 * Internal-admin secret-gate route coverage
 * (2026-06-12 — Phase 4 route-coverage: internal-admin secret cluster).
 *
 * Every route under `src/app/api/internal/admin/**` is gated by
 * `requireAdminSecret(request)` (from `@/lib/admin-auth`) as the FIRST line of
 * every handler. That gate validates the `x-admin-secret` request header in
 * constant time against `process.env.SUPER_ADMIN_SECRET` and returns a 401
 * `NextResponse` (or 503 when the secret env var is unset) BEFORE any
 * service-role DB work runs.
 *
 * This file PINS that contract so a future edit can't silently drop the gate on
 * any of the high-value mutation/read handlers. We cover a representative subset
 * across the distinct route shapes, prioritizing mutation routes
 * (POST/PATCH/DELETE) over pure reads:
 *
 *   bulk-action      POST            — bulk suspend/restore/plan mutation
 *   users            GET + PATCH     — list + single-table field update
 *   users/[id]       PATCH           — dynamic-segment action route (suspend etc.)
 *   content          POST + DELETE   — content create + (soft) delete
 *   feature-flags    POST            — flag create
 *   schools          POST            — school create
 *   support          PATCH           — ticket update
 *   stats            GET             — read route (gate parity check)
 *   command-center   GET             — read route (gate parity check)
 *
 * SEAM CHOICE
 *   `requireAdminSecret` is a pure synchronous header/env check — we do NOT mock
 *   it. Instead we drive the REAL gate by toggling the `x-admin-secret` header
 *   and `SUPER_ADMIN_SECRET` env var, which is exactly what production does.
 *   We mock ONLY the service-role data seam (`@/lib/supabase-admin` →
 *   `getSupabaseAdmin`) and record whether `.from()` / `.rpc()` was ever
 *   touched. The "short-circuits before any DB work" assertion is therefore
 *   real: if the gate were removed, the handler would reach the mocked client
 *   and `dbAccess.touched` would flip true on the deny path.
 *
 * Per route this file asserts:
 *   (a) NO `x-admin-secret` header → 401 AND the DB seam is never touched.
 *   (b) WRONG `x-admin-secret` header → 401 AND the DB seam is never touched.
 *   (c) SUPER_ADMIN_SECRET unset entirely → 503 AND the DB seam is never touched
 *       (representative check on one mutation route).
 *   (d) VALID header → the handler proceeds PAST the gate (it does NOT return
 *       401/503; it reaches the DB seam). This proves the deny assertions aren't
 *       vacuous.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Service-role data seam. Every internal-admin handler reaches this only
//    AFTER the secret gate passes. The chainable `from()` mock returns a thenable
//    query builder that resolves to an empty-but-valid result so authorized paths
//    don't throw; `dbAccess.touched` flips the moment `.from()`/`.rpc()` is hit. ──
const dbAccess = vi.hoisted(() => ({ touched: false }));

vi.mock('@/lib/supabase-admin', () => {
  function makeChain(): Record<string, unknown> {
    const result = { data: [], count: 0, error: null };
    const chain: Record<string, unknown> = {};
    const passthrough = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'in', 'is', 'gte', 'lte', 'like', 'ilike',
      'order', 'range', 'limit',
    ];
    for (const m of passthrough) chain[m] = () => chain;
    chain.single = () => Promise.resolve({ data: { id: 'stub-id' }, error: null });
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    // Make the chain itself awaitable (routes that `await q` without a terminal).
    chain.then = (resolve: (v: typeof result) => unknown) => resolve(result);
    return chain;
  }
  const client = {
    from: () => {
      dbAccess.touched = true;
      return makeChain();
    },
    rpc: () => {
      dbAccess.touched = true;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { getSupabaseAdmin: () => client, supabaseAdmin: client };
});

// ── Quiet infra. logAdminAction is fire-and-forget and irrelevant here. ──
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Route handlers under contract. ──
import { POST as bulkAction } from '@/app/api/internal/admin/bulk-action/route';
import { GET as usersGet, PATCH as usersPatch } from '@/app/api/internal/admin/users/route';
import { PATCH as userIdPatch } from '@/app/api/internal/admin/users/[id]/route';
import { POST as contentPost, DELETE as contentDelete } from '@/app/api/internal/admin/content/route';
import { POST as flagsPost } from '@/app/api/internal/admin/feature-flags/route';
import { POST as schoolsPost } from '@/app/api/internal/admin/schools/route';
import { PATCH as supportPatch } from '@/app/api/internal/admin/support/route';
import { GET as statsGet } from '@/app/api/internal/admin/stats/route';
import { GET as commandCenterGet } from '@/app/api/internal/admin/command-center/route';

const SECRET = 'test-super-admin-secret';
const UUID = '11111111-1111-4111-8111-111111111111';

type Headers = Record<string, string>;

function req(path: string, opts: { method?: string; headers?: Headers; body?: unknown } = {}): NextRequest {
  const { method = 'GET', headers = {}, body } = opts;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost${path}`, init as never);
}

const NO_SECRET: Headers = {};
const WRONG_SECRET: Headers = { 'x-admin-secret': 'definitely-not-the-secret' };
const VALID_SECRET: Headers = { 'x-admin-secret': SECRET };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  dbAccess.touched = false;
  process.env = { ...ORIGINAL_ENV, SUPER_ADMIN_SECRET: SECRET };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// Each entry: a representative invocation of a handler with the given headers.
// `body`/`query`/`ctx` are pre-baked so the handler reaches (or would reach,
// absent the gate) the DB seam on the authorized path.
type Case = {
  name: string;
  call: (headers: Headers) => Promise<Response>;
  isMutation: boolean;
};

const ctxId = (id: string) => ({ params: Promise.resolve({ id }) });

const cases: Case[] = [
  {
    name: 'POST /api/internal/admin/bulk-action',
    isMutation: true,
    call: (h) => bulkAction(req('/api/internal/admin/bulk-action', {
      method: 'POST', headers: h, body: { action: 'suspend', ids: [UUID] },
    }) as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/users',
    isMutation: false,
    call: (h) => usersGet(req('/api/internal/admin/users?role=student', { headers: h }) as never) as Promise<Response>,
  },
  {
    name: 'PATCH /api/internal/admin/users',
    isMutation: true,
    call: (h) => usersPatch(req('/api/internal/admin/users', {
      method: 'PATCH', headers: h, body: { table: 'students', user_id: UUID, updates: { is_active: false } },
    }) as never) as Promise<Response>,
  },
  {
    name: 'PATCH /api/internal/admin/users/[id]',
    isMutation: true,
    call: (h) => userIdPatch(
      req(`/api/internal/admin/users/${UUID}`, { method: 'PATCH', headers: h, body: { action: 'suspend' } }) as never,
      ctxId(UUID) as never,
    ) as Promise<Response>,
  },
  {
    name: 'POST /api/internal/admin/content',
    isMutation: true,
    call: (h) => contentPost(req('/api/internal/admin/content', {
      method: 'POST', headers: h,
      body: { resource: 'question', subject: 'math', grade: '6', chapter_number: 1, question_text: 'q', question_type: 'mcq' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'DELETE /api/internal/admin/content',
    isMutation: true,
    call: (h) => contentDelete(req(`/api/internal/admin/content?resource=question&id=${UUID}`, {
      method: 'DELETE', headers: h,
    }) as never) as Promise<Response>,
  },
  {
    name: 'POST /api/internal/admin/feature-flags',
    isMutation: true,
    call: (h) => flagsPost(req('/api/internal/admin/feature-flags', {
      method: 'POST', headers: h, body: { name: 'ff_test' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'POST /api/internal/admin/schools',
    isMutation: true,
    call: (h) => schoolsPost(req('/api/internal/admin/schools', {
      method: 'POST', headers: h, body: { name: 'Test School' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'PATCH /api/internal/admin/support',
    isMutation: true,
    call: (h) => supportPatch(req('/api/internal/admin/support', {
      method: 'PATCH', headers: h, body: { id: UUID, status: 'resolved' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/stats',
    isMutation: false,
    call: (h) => statsGet(req('/api/internal/admin/stats', { headers: h }) as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/command-center',
    isMutation: false,
    call: (h) => commandCenterGet(req('/api/internal/admin/command-center', { headers: h }) as never) as Promise<Response>,
  },
];

describe('internal-admin secret gate — deny without a valid x-admin-secret', () => {
  for (const c of cases) {
    describe(c.name, () => {
      it('rejects with 401 when the x-admin-secret header is MISSING and never touches the DB', async () => {
        const res = await c.call(NO_SECRET);
        expect(res.status).toBe(401);
        expect(dbAccess.touched).toBe(false);
      });

      it('rejects with 401 when the x-admin-secret header is WRONG and never touches the DB', async () => {
        const res = await c.call(WRONG_SECRET);
        expect(res.status).toBe(401);
        expect(dbAccess.touched).toBe(false);
      });
    });
  }
});

describe('internal-admin secret gate — allow with a valid x-admin-secret', () => {
  for (const c of cases) {
    it(`${c.name} proceeds PAST the gate to the DB seam when the secret matches`, async () => {
      const res = await c.call(VALID_SECRET);
      // Authorized: the gate did NOT short-circuit. The handler ran its body and
      // reached the service-role client. We assert NOT-401/503 (the gate codes)
      // plus the DB seam was actually touched — proving the deny assertions above
      // are non-vacuous.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
      expect(dbAccess.touched).toBe(true);
    });
  }
});

describe('internal-admin secret gate — 503 when SUPER_ADMIN_SECRET is unconfigured', () => {
  // Representative mutation route: if the secret env var is absent, the gate
  // fails closed with 503 (NOT 401, NOT a fall-through to the DB).
  it('POST /api/internal/admin/bulk-action returns 503 and never touches the DB', async () => {
    delete process.env.SUPER_ADMIN_SECRET;
    const res = await bulkAction(req('/api/internal/admin/bulk-action', {
      method: 'POST', headers: VALID_SECRET, body: { action: 'suspend', ids: [UUID] },
    }) as never) as Response;
    expect(res.status).toBe(503);
    expect(dbAccess.touched).toBe(false);
  });

  it('PATCH /api/internal/admin/users returns 503 and never touches the DB', async () => {
    delete process.env.SUPER_ADMIN_SECRET;
    const res = await usersPatch(req('/api/internal/admin/users', {
      method: 'PATCH', headers: VALID_SECRET,
      body: { table: 'students', user_id: UUID, updates: { is_active: false } },
    }) as never) as Response;
    expect(res.status).toBe(503);
    expect(dbAccess.touched).toBe(false);
  });
});
