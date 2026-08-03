/**
 * Internal-admin AUTHORIZATION-gate route coverage (P9 — RBAC enforcement).
 *
 * HISTORY (P2-1 PR-3, 2026-08-03)
 *   This file used to pin the RETIRED `x-admin-secret` shared-secret gate
 *   (`requireAdminSecret` from `@alfanumrik/lib/admin-auth`). All 13 handlers
 *   under `src/app/api/internal/admin/**` were swapped to the session/RBAC gate
 *   `authorizeRequest(request, '<permission>')`. The LOAD-BEARING security
 *   property under test is unchanged: an unauthenticated or under-permissioned
 *   caller MUST be denied BEFORE the handler reaches the service-role
 *   (RLS-BYPASSING) Supabase client. Only the MECHANISM changed — a
 *   constant-time secret compare became an RBAC permission check — so the
 *   assertions here are RE-AIMED at the new model, not weakened. (The file name
 *   is intentionally kept: it is referenced by
 *   `admin-route-auth-gate-sweep.test.ts` and the `.claude/regression`
 *   catalog as THE behavioral gate test for the internal-admin cluster.)
 *
 * COVERAGE
 *   A representative subset across the distinct route shapes, prioritizing
 *   mutation handlers (POST/PATCH/DELETE) over pure reads, and covering every
 *   distinct permission code the cluster gates on:
 *
 *     bulk-action     POST    user.manage           (mutation)
 *     users           GET     user.manage           (read)
 *     users           PATCH   user.manage           (mutation)
 *     users/[id]      PATCH   user.manage           (mutation)
 *     content         POST    content.manage        (mutation)
 *     content         DELETE  content.manage        (mutation)
 *     feature-flags   POST    system.config         (mutation)
 *     schools         POST    system.config         (mutation)
 *     support         GET     support.view_tickets  (read)
 *     support         PATCH   support.manage_tickets(mutation)
 *     stats           GET     analytics.global      (read)
 *     command-center  GET     analytics.global      (read)
 *     logs            GET     system.audit          (read)
 *     revenue         GET     finance.view_revenue  (read)
 *
 *   (`reports` is deliberately excluded from this uniform-seam sweep: its data
 *   seam is a raw `fetch()` to the Supabase REST API, not the mocked
 *   `getSupabaseAdmin` client, so it cannot share the `.from()`-touch probe.
 *   Its gate presence/ordering is covered statically by
 *   `admin-route-auth-gate-sweep.test.ts`.)
 *
 * SEAM CHOICE
 *   - `authorizeRequest` (`@alfanumrik/lib/rbac`) is MOCKED — the same convention
 *     as the green `permission-gate-orphan-repoint.test.ts`. `permit()` makes it
 *     resolve an authorized super_admin; `deny401()` / `deny403()` make it
 *     resolve the exact unauthorized shapes (AUTH_REQUIRED / PERMISSION_DENIED)
 *     the real gate returns and the route propagates verbatim.
 *   - The service-role data seam (`@alfanumrik/lib/supabase-admin` →
 *     `getSupabaseAdmin`) is mocked with a chainable client that flips
 *     `dbAccess.touched` the instant `.from()` / `.rpc()` is hit. Because every
 *     handler calls `getSupabaseAdmin()` only AFTER its gate, a DENIED request
 *     can never flip `touched` — that is the deny-before-service-role-touch
 *     proof, and it is real (not vacuous): the authorized cases below flip it to
 *     true, proving the probe works.
 *
 * PER ROUTE THIS FILE ASSERTS
 *   (a) `authorizeRequest` is invoked with the route's DECLARED permission code
 *       (pins the gate to the RIGHT permission, not merely "some gate").
 *   (b) NO session (unauthenticated) → the 401 propagates AND the service-role
 *       seam is never touched.
 *   (c) authenticated but UNDER-PERMISSIONED (a non-super_admin lacking the
 *       code) → the 403 propagates AND the service-role seam is never touched.
 *   (d) an authorized super_admin → the handler proceeds PAST the gate and DOES
 *       touch the seam (proving (b)/(c) are non-vacuous).
 *
 * RETIRED 503 CASE
 *   The old suite also asserted 503 when `SUPER_ADMIN_SECRET` was unset
 *   (fail-closed on missing secret config). That behavior belonged to
 *   `requireAdminSecret` and has no analog in the RBAC model — its fail-closed
 *   intent is fully subsumed by (b)/(c): no session / no permission → deny
 *   before any DB touch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC gate seam. Every internal-admin handler now gates on
//    authorizeRequest(request, '<permission>') as its FIRST statement and
//    returns auth.errorResponse BEFORE calling getSupabaseAdmin(). We mock it so
//    a test can put the caller on the allow OR deny side deterministically. ──
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

// ── Service-role data seam. Every internal-admin handler reaches this only
//    AFTER the gate passes. The chainable `from()` mock returns a thenable
//    query builder that resolves to an empty-but-valid result so authorized
//    paths don't throw; `dbAccess.touched` flips the moment `.from()`/`.rpc()`
//    is hit. ──
const dbAccess = vi.hoisted(() => ({ touched: false }));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
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

// ── Quiet infra. logAdminAction is fire-and-forget and irrelevant here; it
//    routes through the mocked service-role client above. logger is silenced. ──
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Route handlers under contract. ──
import { POST as bulkAction } from '@/app/api/internal/admin/bulk-action/route';
import { GET as usersGet, PATCH as usersPatch } from '@/app/api/internal/admin/users/route';
import { PATCH as userIdPatch } from '@/app/api/internal/admin/users/[id]/route';
import { POST as contentPost, DELETE as contentDelete } from '@/app/api/internal/admin/content/route';
import { POST as flagsPost } from '@/app/api/internal/admin/feature-flags/route';
import { POST as schoolsPost } from '@/app/api/internal/admin/schools/route';
import { GET as supportGet, PATCH as supportPatch } from '@/app/api/internal/admin/support/route';
import { GET as statsGet } from '@/app/api/internal/admin/stats/route';
import { GET as commandCenterGet } from '@/app/api/internal/admin/command-center/route';
import { GET as logsGet } from '@/app/api/internal/admin/logs/route';
import { GET as revenueGet } from '@/app/api/internal/admin/revenue/route';

const UUID = '11111111-1111-4111-8111-111111111111';

type Headers = Record<string, string>;

function req(path: string, opts: { method?: string; headers?: Headers; body?: unknown } = {}): NextRequest {
  const { method = 'GET', headers = {}, body } = opts;
  const init: RequestInit = {
    method,
    // A Bearer header is present for realism; it is IGNORED — authorizeRequest
    // is mocked, so allow/deny is driven by permit()/deny*() below, not by any
    // real token verification.
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost${path}`, init as never);
}

/** Caller HOLDS the required permission → authorizeRequest resolves authorized (super_admin). */
function permit() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    studentId: null,
    roles: ['super_admin'],
    permissions: [],
    errorResponse: null,
  });
}

/** No session at all → authorizeRequest returns its 401 AUTH_REQUIRED response. */
function deny401() {
  const errorResponse = new Response(
    JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse,
  });
}

/** Authenticated but lacking the required permission → 403 PERMISSION_DENIED. */
function deny403() {
  const errorResponse = new Response(
    JSON.stringify({ error: 'Forbidden', code: 'PERMISSION_DENIED' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: 'teacher-1',
    studentId: null,
    roles: ['teacher'],
    permissions: [],
    errorResponse,
  });
}

/** The permission code passed to authorizeRequest by the handler under test. */
function gateArg(): string {
  return (_authorizeImpl.mock.calls[0] as unknown[])[1] as string;
}

const ctxId = (id: string) => ({ params: Promise.resolve({ id }) });

// Each entry: a representative invocation of a handler, plus the exact
// permission code that handler MUST hand to authorizeRequest. `body`/query/ctx
// are pre-baked so the authorized path reaches the service-role seam.
type Case = {
  name: string;
  permission: string;
  isMutation: boolean;
  call: () => Promise<Response>;
};

const cases: Case[] = [
  {
    name: 'POST /api/internal/admin/bulk-action',
    permission: 'user.manage',
    isMutation: true,
    call: () => bulkAction(req('/api/internal/admin/bulk-action', {
      method: 'POST', body: { action: 'suspend', ids: [UUID] },
    }) as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/users',
    permission: 'user.manage',
    isMutation: false,
    call: () => usersGet(req('/api/internal/admin/users?role=student') as never) as Promise<Response>,
  },
  {
    name: 'PATCH /api/internal/admin/users',
    permission: 'user.manage',
    isMutation: true,
    call: () => usersPatch(req('/api/internal/admin/users', {
      method: 'PATCH', body: { table: 'students', user_id: UUID, updates: { is_active: false } },
    }) as never) as Promise<Response>,
  },
  {
    name: 'PATCH /api/internal/admin/users/[id]',
    permission: 'user.manage',
    isMutation: true,
    call: () => userIdPatch(
      req(`/api/internal/admin/users/${UUID}`, { method: 'PATCH', body: { action: 'suspend' } }) as never,
      ctxId(UUID) as never,
    ) as Promise<Response>,
  },
  {
    name: 'POST /api/internal/admin/content',
    permission: 'content.manage',
    isMutation: true,
    call: () => contentPost(req('/api/internal/admin/content', {
      method: 'POST',
      body: { resource: 'question', subject: 'math', grade: '6', chapter_number: 1, question_text: 'q', question_type: 'mcq' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'DELETE /api/internal/admin/content',
    permission: 'content.manage',
    isMutation: true,
    call: () => contentDelete(req(`/api/internal/admin/content?resource=question&id=${UUID}`, {
      method: 'DELETE',
    }) as never) as Promise<Response>,
  },
  {
    name: 'POST /api/internal/admin/feature-flags',
    permission: 'system.config',
    isMutation: true,
    call: () => flagsPost(req('/api/internal/admin/feature-flags', {
      method: 'POST', body: { name: 'ff_test' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'POST /api/internal/admin/schools',
    permission: 'system.config',
    isMutation: true,
    call: () => schoolsPost(req('/api/internal/admin/schools', {
      method: 'POST', body: { name: 'Test School' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/support',
    permission: 'support.view_tickets',
    isMutation: false,
    call: () => supportGet(req('/api/internal/admin/support?status=open') as never) as Promise<Response>,
  },
  {
    name: 'PATCH /api/internal/admin/support',
    permission: 'support.manage_tickets',
    isMutation: true,
    call: () => supportPatch(req('/api/internal/admin/support', {
      method: 'PATCH', body: { id: UUID, status: 'resolved' },
    }) as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/stats',
    permission: 'analytics.global',
    isMutation: false,
    call: () => statsGet(req('/api/internal/admin/stats') as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/command-center',
    permission: 'analytics.global',
    isMutation: false,
    call: () => commandCenterGet(req('/api/internal/admin/command-center') as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/logs',
    permission: 'system.audit',
    isMutation: false,
    call: () => logsGet(req('/api/internal/admin/logs') as never) as Promise<Response>,
  },
  {
    name: 'GET /api/internal/admin/revenue',
    permission: 'finance.view_revenue',
    isMutation: false,
    call: () => revenueGet(req('/api/internal/admin/revenue') as never) as Promise<Response>,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  dbAccess.touched = false;
});

describe('internal-admin authorization gate — pins each route to its declared permission', () => {
  for (const c of cases) {
    it(`${c.name} gates on '${c.permission}'`, async () => {
      permit();
      await c.call();
      // authorizeRequest(request, '<permission>', options?) — code is arg index 1.
      expect(gateArg()).toBe(c.permission);
    });
  }
});

describe('internal-admin authorization gate — deny reaches the caller BEFORE the service-role client', () => {
  for (const c of cases) {
    describe(c.name, () => {
      it('unauthenticated (no session) → 401 propagates and the service-role seam is never touched', async () => {
        deny401();
        const res = await c.call();
        expect(res.status).toBe(401);
        expect(dbAccess.touched).toBe(false);
      });

      it('authenticated but under-permissioned → 403 propagates and the service-role seam is never touched', async () => {
        deny403();
        const res = await c.call();
        expect(res.status).toBe(403);
        expect(dbAccess.touched).toBe(false);
      });
    });
  }
});

describe('internal-admin authorization gate — an authorized super_admin reaches the handler', () => {
  for (const c of cases) {
    it(`${c.name} proceeds PAST the gate to the service-role client`, async () => {
      permit();
      const res = await c.call();
      // Authorized: the gate did NOT short-circuit. The handler ran its body and
      // reached the service-role client. We assert NOT-401/403 (the gate codes)
      // plus that the DB seam was actually touched — proving the deny assertions
      // above are non-vacuous.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(dbAccess.touched).toBe(true);
    });
  }
});
