/**
 * Tests for GET /api/v1/leaderboard (the base route) — regression coverage for
 * the P13 field whitelist and the "a failed read is not an empty board" rule.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * A 2026-08-23 re-verification found the P13 fix in this route (narrowing the
 * fallback-rung projection to the same whitelist as the `get_leaderboard` RPC)
 * had been silently reverted by a stale-base merge (commit b00b9c872) and had
 * to be restored (commit 364abd5fc). Nothing in `npm test` caught the revert
 * because no test imported and invoked this route's GET handler directly —
 * `me.test.ts` and `own-scoped-routes.test.ts` cover the sibling routes
 * (`/me`, `/titles`, `/streaks`, `/my-class`), and the frontend-level test only
 * mocks `fetch`, never exercising the server route's actual fallback branch.
 * This file closes that gap so the exact defect class (stale-base merge
 * re-widening the fallback projection) fails `npm test` next time.
 *
 * Covers (per the route's own P13 whitelist comment, verified against source):
 *   rank, student_id, name, grade, total_xp, sessions, streak — and nothing
 *   else — on the fallback-rung success path, even when the underlying
 *   `students` select accidentally returns extra columns (avatar_url, school,
 *   city, board, school_name). And: a fallback-rung DB error is a 500 with a
 *   generic, caller-independent error body (never `data: []`), with
 *   `no-store` pinned across all three cache-control channels so a transient
 *   5xx can never get baked into the `public, s-maxage=60` shared CDN entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/* ── auth ───────────────────────────────────────────────────────────────── */
const { auth } = vi.hoisted(() => ({ auth: { current: null as unknown } }));
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: async () => auth.current }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/* ── supabase-admin double ─────────────────────────────────────────────────
 * Rung 1 is `supabase.rpc('get_leaderboard', ...)`. Rung 2 is
 * `supabase.from('students').select(...).eq().gte().gt().order().limit()`.
 * The route only ever awaits the END of the `students` chain, so a single
 * chainable stub that resolves `{ data, error }` from every link (select,
 * eq, gte, gt, order, limit) is sufficient — filter predicates themselves
 * are not this file's concern (that's a fallback-window question, not a
 * P13/error-shape one). */
const { db } = vi.hoisted(() => ({
  db: {
    rpc: { data: null as unknown, error: { message: 'rpc unavailable' } as unknown },
    students: { data: [] as unknown, error: null as unknown },
  },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function studentsChain() {
    const api: Record<string, unknown> = {
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(db.students).then(ok, bad),
    };
    for (const m of ['select', 'eq', 'gte', 'gt', 'order', 'limit']) {
      api[m] = () => api;
    }
    return api;
  }
  const client = {
    from: (_table: string) => studentsChain(),
    rpc: async (_name: string, _params: unknown) => db.rpc,
  };
  return { getSupabaseAdmin: () => client, supabaseAdmin: client };
});

/* ── invocation helper ──────────────────────────────────────────────────── */
async function get(url = 'http://localhost/api/v1/leaderboard'): Promise<Response> {
  const { GET } = await import('../../../../app/api/v1/leaderboard/route');
  return GET(new Request(url) as never);
}

beforeEach(() => {
  auth.current = {
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['leaderboard.view'],
  };
  // RPC unavailable by default so every test lands on rung 2 (the fallback)
  // unless a test overrides it — that fallback rung is this file's subject.
  db.rpc = { data: null, error: { message: 'rpc unavailable' } };
  db.students = { data: [], error: null };
});

const DENY = (status: number) => ({
  authorized: false,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status }),
});

describe('GET /api/v1/leaderboard', () => {
  it('401 when unauthorized', async () => {
    auth.current = DENY(401);
    expect((await get()).status).toBe(401);
  });

  describe('fallback rung (rung 2) — P13 field whitelist', () => {
    /** A row shaped the way a careless `select('*')` or a re-widened select
     * might actually return: the 5 legitimate fallback columns PLUS every
     * field this route must never expose. */
    const LEAKY_ROW = {
      id: 'student-1',
      name: 'Aarav Sharma',
      xp_total: 500,
      streak_days: 12,
      grade: 8,
      // Must never reach the wire — the historical fallback leak this route's
      // own comment documents having fixed.
      avatar_url: 'https://cdn.example.test/avatars/student-1.png',
      school: 'Delhi Public School',
      city: 'New Delhi',
      board: 'CBSE',
      school_name: 'DPS R.K. Puram',
    };

    it('projects ONLY rank, student_id, name, grade, total_xp, sessions, streak', async () => {
      db.students = { data: [LEAKY_ROW], error: null };
      const res = await get();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(Object.keys(body.data[0]).sort()).toEqual(
        ['grade', 'name', 'rank', 'sessions', 'streak', 'student_id', 'total_xp'],
      );
    });

    it('never leaks avatar_url, school, city, board, or school_name onto the wire', async () => {
      db.students = { data: [LEAKY_ROW], error: null };
      const res = await get();
      const wire = JSON.stringify(await res.json());
      for (const forbidden of [
        'avatar_url',
        'school_name',
        'Delhi Public School',
        'New Delhi',
        'CBSE',
        'DPS R.K. Puram',
        'https://cdn.example.test/avatars/student-1.png',
      ]) {
        expect(wire).not.toContain(forbidden);
      }
      // `school` and `city` as bare substrings would also match `board` inside
      // other unrelated tokens, so assert on the actual leaked values above —
      // this second pass additionally confirms the literal key names are gone.
      const keys = Object.keys(JSON.parse(wire).data[0]);
      expect(keys).not.toContain('school');
      expect(keys).not.toContain('city');
      expect(keys).not.toContain('board');
      expect(keys).not.toContain('school_name');
      expect(keys).not.toContain('avatar_url');
    });

    it('carries the correct values for the whitelisted fields, with grade coerced to a string (P5)', async () => {
      db.students = { data: [LEAKY_ROW], error: null };
      const body = await (await get()).json();
      expect(body.data[0]).toEqual({
        rank: 1,
        student_id: 'student-1',
        name: 'Aarav Sharma',
        grade: '8',
        total_xp: 500,
        sessions: 0, // fallback has no per-period session aggregate — 0 is honest
        streak: 12,
      });
      expect(typeof body.data[0].grade).toBe('string');
    });
  });

  describe('fallback rung (rung 2) — failure is surfaced, never an empty board', () => {
    it('a DB error on the fallback read returns HTTP 500 with a generic error body', async () => {
      db.students = { data: null, error: { message: 'connection terminated unexpectedly' } };
      const res = await get();
      expect(res.status).toBe(500);
      const body = await res.json();
      // Generic, caller/driver-independent token — never the raw Postgres
      // message (which can echo row values), and never `data: []` (a false
      // claim that nobody has earned XP this period).
      expect(body).toEqual({ error: 'leaderboard_read_failed' });
      expect(body.data).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('connection terminated unexpectedly');
    });

    it('pins no-store on all three cache-control channels on the error path', async () => {
      db.students = { data: null, error: { message: 'boom' } };
      const res = await get();
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0, must-revalidate');
      expect(res.headers.get('CDN-Cache-Control')).toBe('no-store');
      expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe('no-store');
    });
  });

  describe('success path cache headers (contrast case)', () => {
    it('the 200 success path is public + s-maxage=60 across all three channels', async () => {
      db.students = { data: [], error: null };
      const res = await get();
      expect(res.status).toBe(200);
      const expected = 'public, s-maxage=60, stale-while-revalidate=120';
      expect(res.headers.get('Cache-Control')).toBe(expected);
      expect(res.headers.get('CDN-Cache-Control')).toBe(expected);
      expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(expected);
    });
  });
});
