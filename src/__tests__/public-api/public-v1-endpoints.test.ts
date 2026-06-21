/**
 * Track A.6 — Public API v1 endpoint contract tests.
 * ============================================================================
 * Covers (per the testing brief):
 *   1. TENANT ISOLATION (CRITICAL) — every endpoint derives schoolId from the KEY
 *      record (auth.schoolId), NEVER from a path/query/body school_id. A key for
 *      school A returns ONLY school A rows even when the request carries
 *      ?school_id=school-B. We assert every query is `.eq('school_id','school-A')`.
 *   2. SCOPE GATING — a key WITHOUT the route's scope → 403; valid scope → 200;
 *      401 on missing/invalid/expired key; 429 carries X-RateLimit-* headers.
 *   3. P13 — /students payload has NO email/phone; /reports returns aggregates
 *      only (no per-student id/name/email). Serialized response excludes PII keys.
 *
 * The auth helper is exercised through its REAL implementation (we mock only the
 * Supabase admin client + the rate limiter it calls), so the tenant-from-key and
 * scope-gate logic is the code under test — not a stub.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRateLimit, keyTable, dataTables } = vi.hoisted(() => ({
  mockRateLimit: vi.fn(),
  // Mutable per-test: the school_api_keys row returned by the key lookup.
  keyTable: { row: null as Record<string, unknown> | null, error: null as { message: string } | null },
  // Captured query intent for the data tables (students/classes/etc).
  dataTables: {
    eqCalls: [] as Array<{ table: string; col: string; val: unknown }>,
    rows: {} as Record<string, unknown[]>,
  },
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Supabase admin mock ──────────────────────────────────────────────────────
// A chainable thenable builder. For school_api_keys it resolves the key row;
// for data tables it records every .eq() (so we can assert school_id scoping) and
// resolves the seeded rows. `.range()` / `.limit()` are terminal-ish but the whole
// builder is also awaitable (Supabase builders are thenables).
function makeBuilder(table: string) {
  const state = { count: dataTables.rows[table]?.length ?? 0 };
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  const result = () =>
    Promise.resolve({ data: dataTables.rows[table] ?? [], error: null, count: state.count });

  builder.select = passthrough;
  builder.order = passthrough;
  builder.is = passthrough;
  builder.in = passthrough;
  builder.limit = () => result();
  builder.range = () => result();
  builder.contains = passthrough;
  builder.eq = (col: string, val: unknown) => {
    dataTables.eqCalls.push({ table, col, val });
    return builder;
  };
  builder.maybeSingle = () => result();
  builder.single = () => result();
  // Make the builder awaitable (thenable) so a query that ends without range/limit
  // (e.g. the marketplace listings .order()) still resolves.
  builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    result().then(onF, onR);
  return builder;
}

function keyBuilder() {
  // school_api_keys lookup: .select().eq('key_hash',…).eq('is_active',true).maybeSingle()
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.maybeSingle = () => Promise.resolve({ data: keyTable.row, error: keyTable.error });
  // last_used_at touch: .update().eq().then(...)
  b.update = () => ({ eq: () => ({ then: (ok: () => void) => ok() }) });
  return b;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => (table === 'school_api_keys' ? keyBuilder() : makeBuilder(table)),
  }),
}));

import { GET as getStudents } from '@/app/api/public/v1/students/route';
import { GET as getClasses } from '@/app/api/public/v1/classes/route';
import { GET as getReports } from '@/app/api/public/v1/reports/route';
import { GET as getMarketplace } from '@/app/api/public/v1/marketplace/listings/route';

const SCHOOL_A = 'school-A';
const SCHOOL_B = 'school-B';
const KEY_ID = 'key-aaa';

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Seed the key lookup to return a school-A key with the given scopes. */
function keyFor(scopes: string[], opts?: { expired?: boolean; schoolId?: string }) {
  keyTable.row = {
    id: KEY_ID,
    school_id: opts?.schoolId ?? SCHOOL_A,
    permissions: scopes,
    expires_at: opts?.expired ? new Date(Date.now() - 1000).toISOString() : null,
    is_active: true,
  };
  keyTable.error = null;
}

function noKey() {
  keyTable.row = null;
  keyTable.error = null;
}

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'GET', headers });
}

// A request that names a DIFFERENT school in the query string — must be IGNORED.
function reqWithSchoolParam(base: string, withKey = true) {
  const url = `${base}?school_id=${SCHOOL_B}&page=1&limit=10`;
  return req(url, withKey ? { Authorization: 'Bearer rawkey' } : {});
}

beforeEach(() => {
  vi.clearAllMocks();
  dataTables.eqCalls.length = 0;
  dataTables.rows = {};
  keyTable.row = null;
  keyTable.error = null;
  // Default: under the limit.
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 99, resetAt: 1234567890 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. TENANT ISOLATION (CRITICAL)
// ─────────────────────────────────────────────────────────────────────────────
describe('public/v1 tenant isolation (CRITICAL) — schoolId from the KEY, never the request', () => {
  it('students: a school-A key ignores ?school_id=school-B and scopes to school-A', async () => {
    keyFor(['students.read']);
    dataTables.rows.students = [
      { id: 's1', name: 'A One', grade: '8', is_active: true, created_at: 't' },
    ];
    const res = await getStudents(reqWithSchoolParam('http://localhost/api/public/v1/students') as never);
    expect(res.status).toBe(200);

    const studentEqs = dataTables.eqCalls.filter((c) => c.table === 'students' && c.col === 'school_id');
    expect(studentEqs.length).toBeGreaterThan(0);
    // EVERY school_id scope is school-A (from the key) — never school-B (from the query).
    expect(studentEqs.every((c) => c.val === SCHOOL_A)).toBe(true);
    expect(dataTables.eqCalls.some((c) => c.val === SCHOOL_B)).toBe(false);
  });

  it('classes: scopes to school-A even with ?school_id=school-B', async () => {
    keyFor(['classes.read']);
    dataTables.rows.classes = [];
    await getClasses(reqWithSchoolParam('http://localhost/api/public/v1/classes') as never);
    const eqs = dataTables.eqCalls.filter((c) => c.table === 'classes' && c.col === 'school_id');
    expect(eqs.length).toBeGreaterThan(0);
    expect(eqs.every((c) => c.val === SCHOOL_A)).toBe(true);
    expect(dataTables.eqCalls.some((c) => c.val === SCHOOL_B)).toBe(false);
  });

  it('reports (grade view): aggregate read is scoped to school-A only', async () => {
    keyFor(['reports.read']);
    dataTables.rows.students = [
      { grade: '8', xp_total: 100, is_active: true },
      { grade: '8', xp_total: 200, is_active: false },
    ];
    const res = await getReports(reqWithSchoolParam('http://localhost/api/public/v1/reports') as never);
    expect(res.status).toBe(200);
    const eqs = dataTables.eqCalls.filter((c) => c.col === 'school_id');
    expect(eqs.length).toBeGreaterThan(0);
    expect(eqs.every((c) => c.val === SCHOOL_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SCOPE GATING + 401 + 429
// ─────────────────────────────────────────────────────────────────────────────
describe('public/v1 scope gating, 401, 429', () => {
  it('students: key WITHOUT students.read → 403 (no DB read of students)', async () => {
    keyFor(['classes.read']); // wrong scope
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer k' }) as never);
    expect(res.status).toBe(403);
    expect(dataTables.eqCalls.some((c) => c.table === 'students')).toBe(false);
  });

  it('classes: key WITHOUT classes.read → 403', async () => {
    keyFor(['students.read']);
    const res = await getClasses(req('http://localhost/api/public/v1/classes', { Authorization: 'Bearer k' }) as never);
    expect(res.status).toBe(403);
  });

  it('reports: key WITHOUT reports.read → 403', async () => {
    keyFor(['students.read']);
    const res = await getReports(req('http://localhost/api/public/v1/reports', { Authorization: 'Bearer k' }) as never);
    expect(res.status).toBe(403);
  });

  it('valid scope → 200', async () => {
    keyFor(['students.read']);
    dataTables.rows.students = [];
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer k' }) as never);
    expect(res.status).toBe(200);
  });

  it('missing key header → 401', async () => {
    keyFor(['students.read']);
    const res = await getStudents(req('http://localhost/api/public/v1/students') as never);
    expect(res.status).toBe(401);
  });

  it('unknown key (no row) → 401', async () => {
    noKey();
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer bad' }) as never);
    expect(res.status).toBe(401);
  });

  it('expired key → 401', async () => {
    keyFor(['students.read'], { expired: true });
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer k' }) as never);
    expect(res.status).toBe(401);
  });

  it('over rate limit → 429 with X-RateLimit-* headers', async () => {
    keyFor(['students.read']);
    mockRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1234567890 });
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer k' }) as never);
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('success response also carries X-RateLimit-* headers', async () => {
    keyFor(['students.read']);
    dataTables.rows.students = [];
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer k' }) as never);
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
  });

  it('x-api-key header form is accepted (not just Bearer)', async () => {
    keyFor(['students.read']);
    dataTables.rows.students = [];
    const res = await getStudents(req('http://localhost/api/public/v1/students', { 'x-api-key': 'rawkey' }) as never);
    expect(res.status).toBe(200);
  });

  it('marketplace listings is scope-agnostic but still requires a valid key', async () => {
    noKey();
    const denied = await getMarketplace(req('http://localhost/api/public/v1/marketplace/listings', { Authorization: 'Bearer bad' }) as never);
    expect(denied.status).toBe(401);

    keyFor([]); // any valid key, no scopes
    dataTables.rows.integration_listings = [{ id: 'l1', slug: 's', name: 'N', description: '', scopes_required: [], metadata: {}, created_at: 't' }];
    const ok = await getMarketplace(req('http://localhost/api/public/v1/marketplace/listings', { Authorization: 'Bearer k' }) as never);
    expect(ok.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. P13 — no PII through the public API
// ─────────────────────────────────────────────────────────────────────────────
describe('public/v1 P13 — no PII in payloads', () => {
  it('students payload exposes id/name/grade only — never email/phone (even if the row carries them)', async () => {
    keyFor(['students.read']);
    // The mock row deliberately carries PII the route must NOT pass through.
    dataTables.rows.students = [
      {
        id: 's1',
        name: 'Priya Nair',
        grade: '8',
        is_active: true,
        created_at: 't',
        email: 'priya.nair@school.edu',
        phone: '9876501234',
      },
    ];
    const res = await getStudents(req('http://localhost/api/public/v1/students', { Authorization: 'Bearer k' }) as never);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    const blob = JSON.stringify(json);
    expect(blob).not.toMatch(/priya\.nair@school\.edu/i);
    expect(blob).not.toMatch(/9876501234/);
    // Structural: the serialized item has no email/phone key.
    const item = json.data[0];
    expect(item).not.toHaveProperty('email');
    expect(item).not.toHaveProperty('phone');
    expect(item).toHaveProperty('id');
    expect(item.grade).toBe('8'); // P5: string grade
  });

  it('reports (grade view) returns aggregates only — no per-student id/name/email', async () => {
    keyFor(['reports.read']);
    dataTables.rows.students = [
      { grade: '8', xp_total: 100, is_active: true },
      { grade: '8', xp_total: 300, is_active: true },
      { grade: '9', xp_total: 50, is_active: false },
    ];
    const res = await getReports(req('http://localhost/api/public/v1/reports', { Authorization: 'Bearer k' }) as never);
    const json = (await res.json()) as {
      data: { view: string; summaries: Array<Record<string, unknown>> };
    };
    const blob = JSON.stringify(json);
    // No per-student identifiers anywhere in the aggregate response.
    expect(blob).not.toMatch(/"id"/);
    expect(blob).not.toMatch(/"name"/);
    expect(blob).not.toMatch(/email|phone/i);
    expect(json.data.view).toBe('grade');
    const g8 = json.data.summaries.find((s) => s.grade === '8');
    expect(g8).toMatchObject({ total_students: 2, active_students: 2, avg_xp: 200 });
  });
});
