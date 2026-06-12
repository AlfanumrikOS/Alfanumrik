/**
 * Education Intelligence Cloud — route-level auth coverage
 * (2026-06-11 — EIC intelligence-route auth gap closure).
 *
 * The audit found these 5 EIC read routes had NO route-level auth test. Each is
 * a GET gated by `authorizeAdmin(request, 'support')` and reads exclusively
 * through the shared helpers in src/lib/super-admin/intelligence.ts
 * (`safeSelect` / `fetchSchoolMeta`), which in turn hit Postgres via raw
 * `fetch()` against `supabaseAdminUrl` with `supabaseAdminHeaders`.
 *
 *   src/app/api/super-admin/intelligence/overview/route.ts
 *   src/app/api/super-admin/intelligence/revenue/route.ts
 *   src/app/api/super-admin/intelligence/geography/route.ts
 *   src/app/api/super-admin/intelligence/schools/route.ts
 *   src/app/api/super-admin/intelligence/school/[id]/route.ts
 *
 * SEAM CHOICE
 *   We mock `@/lib/admin-auth` (authorizeAdmin gate + the supabaseAdminUrl /
 *   supabaseAdminHeaders used by the intelligence lib) and spy on global
 *   `fetch`. We deliberately do NOT mock src/lib/super-admin/intelligence.ts —
 *   the REAL `safeSelect`, `fetchSchoolMeta`, `isUuid`, `dedupLatest` and the
 *   numeric coercers run, so the data seam we assert on (global fetch) is the
 *   genuine DB boundary the route would hit in production. This makes the
 *   "short-circuits before any query" assertion real rather than vacuous.
 *
 * Per route this file asserts:
 *   (a) authorizeAdmin is called with the 'support' level.
 *   (b) On denial → the route returns the gate's 403 response AND fetch (the
 *       data seam) is NEVER called (auth short-circuits before any query).
 *   (c) school/[id] only: a non-UUID id → 400 BEFORE any query.
 *   (d) Authorized path → 200, and fetch WAS called (the auth assertion isn't
 *       vacuous because the handler body actually ran a query).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─── Module mocks (hoisted before route import) ───────────────────────

const authorizeAdmin = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  // The intelligence lib builds its PostgREST URL/headers from these. We point
  // them at a stub host so any fetch that DOES fire is observable via the spy
  // (and never touches a real network).
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: () => ({ apikey: 'stub', Authorization: 'Bearer stub' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────

const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: 'admin-row-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
});

function getReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: gate denies (auth-path tests rely on this; authorized tests opt in).
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
  // Default canned DB response: empty array. The intelligence routes are built
  // to degrade gracefully to empty/null payloads (HTTP 200) on empty data, so
  // an empty array is a valid "authorized but no rollup rows yet" fixture.
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('[]', { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
//  overview
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/intelligence/overview', () => {
  it('gates on authorizeAdmin at the support level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/overview/route');
    await GET(getReq('/api/super-admin/intelligence/overview'));
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'support');
  });

  it('on denial → returns the 403 and never queries the data seam', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/intelligence/overview/route');
    const res = await GET(getReq('/api/super-admin/intelligence/overview'));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authorized → 200 and the data seam WAS called', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/overview/route');
    const res = await GET(getReq('/api/super-admin/intelligence/overview'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  revenue
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/intelligence/revenue', () => {
  it('gates on authorizeAdmin at the support level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/revenue/route');
    await GET(getReq('/api/super-admin/intelligence/revenue'));
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'support');
  });

  it('on denial → returns the 403 and never queries the data seam', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/intelligence/revenue/route');
    const res = await GET(getReq('/api/super-admin/intelligence/revenue'));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authorized → 200 and the data seam WAS called', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/revenue/route');
    const res = await GET(getReq('/api/super-admin/intelligence/revenue'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  geography
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/intelligence/geography', () => {
  it('gates on authorizeAdmin at the support level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/geography/route');
    await GET(getReq('/api/super-admin/intelligence/geography?level=state'));
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'support');
  });

  it('on denial → returns the 403 and never queries the data seam', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/intelligence/geography/route');
    const res = await GET(getReq('/api/super-admin/intelligence/geography?level=state'));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authorized → 200 and the data seam WAS called', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // First call (latest snapshot_date lookup) must return a row so the route
    // proceeds to the second query — otherwise it early-returns { rows: [] }
    // (still 200) after a single fetch. Either way fetch fired; we seed a date
    // to exercise the full path.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ snapshot_date: '2026-06-10' }]), { status: 200 }),
      )
      .mockResolvedValue(new Response('[]', { status: 200 }));
    const { GET } = await import('@/app/api/super-admin/intelligence/geography/route');
    const res = await GET(getReq('/api/super-admin/intelligence/geography?level=state'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  schools
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/intelligence/schools', () => {
  it('gates on authorizeAdmin at the support level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/schools/route');
    await GET(getReq('/api/super-admin/intelligence/schools'));
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'support');
  });

  it('on denial → returns the 403 and never queries the data seam', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/intelligence/schools/route');
    const res = await GET(getReq('/api/super-admin/intelligence/schools'));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authorized → 200 and the data seam WAS called', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/schools/route');
    const res = await GET(getReq('/api/super-admin/intelligence/schools'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  school/[id]
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/intelligence/school/[id]', () => {
  it('gates on authorizeAdmin at the support level', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/school/[id]/route');
    await GET(getReq(`/api/super-admin/intelligence/school/${UUID}`), ctx(UUID));
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'support');
  });

  it('on denial → returns the 403 and never queries the data seam (gate before id check)', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/intelligence/school/[id]/route');
    const res = await GET(getReq(`/api/super-admin/intelligence/school/${UUID}`), ctx(UUID));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authorized + non-UUID id → 400 BEFORE any query', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/school/[id]/route');
    const res = await GET(
      getReq('/api/super-admin/intelligence/school/not-a-uuid'),
      ctx('not-a-uuid'),
    );
    expect(res.status).toBe(400);
    // UUID validation must short-circuit before the data seam fires.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authorized + valid UUID → 200 and the data seam WAS called', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/intelligence/school/[id]/route');
    const res = await GET(getReq(`/api/super-admin/intelligence/school/${UUID}`), ctx(UUID));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
