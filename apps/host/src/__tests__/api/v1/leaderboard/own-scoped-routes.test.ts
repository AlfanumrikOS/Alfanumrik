/**
 * /api/v1/leaderboard/{titles,streaks,my-class} — the three routes created to
 * replace STRUCTURALLY IMPOSSIBLE browser reads. Shipped with zero coverage.
 *
 * ── THE CLASS OF DEFECT THESE ROUTES CLOSE ──────────────────────────────────
 * The /leaderboard page read cross-student tables from the BROWSER with the anon
 * key. All of them are own-row-only (or service-role-only) under RLS, so each
 * read returned at most ONE row — the caller's — and the page rendered that as a
 * peer board:
 *   student_titles     → service-role-only, no student SELECT policy at all, so
 *                        "My Titles" was permanently empty for everyone.
 *   challenge_streaks  → own-row-only, so "Top Streaks" was a board of one.
 *   students.class_id  → a column that does not exist, so every enrolled student
 *                        was told "You're not in a class yet."
 * The reads did not error. They succeeded and returned almost nothing, and the
 * UI presented that as a fact about the world.
 *
 * Two of the replacements use the SERVICE-ROLE client, which bypasses RLS. That
 * makes the server-side scoping and the field whitelist the ONLY things standing
 * between a caller and every other child's data — so those are what this file
 * asserts, hardest of all on `/streaks`, the one route that legitimately returns
 * PEER rows.
 *
 * P13: synthetic ids and names only.
 * P5: grades assert as STRINGS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PEER_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PEER_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/* ── auth ───────────────────────────────────────────────────────────────── */
const { auth } = vi.hoisted(() => ({ auth: { current: null as unknown } }));
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: async () => auth.current }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/* ── service-role double (titles + streaks) ─────────────────────────────── */
interface Pred { m: string; args: unknown[] }
interface Rec { table: string; columns: string; preds: Pred[] }

const { admin } = vi.hoisted(() => ({
  admin: {
    tables: {} as Record<string, { data: unknown; error: unknown }>,
    queries: [] as Rec[],
  },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const CHAIN = ['eq', 'neq', 'is', 'in', 'gte', 'lte', 'order', 'limit', 'or', 'not'];

  /**
   * Filter-aware: `eq` / `in` / `gte` are APPLIED, not merely recorded. The
   * streaks route issues two reads against `challenge_streaks` — the board
   * (gte threshold) and the caller's own row (eq student_id) — and a fake that
   * returned the whole table to both would hand the caller a PEER's row as
   * their own `me`, which is the exact confusion this route exists to prevent.
   * Predicates are still recorded so the tests can assert WHICH filters the
   * route issued (the server-side scoping is the security boundary).
   */
  function apply(rows: Array<Record<string, unknown>>, preds: Pred[]) {
    return rows.filter((r) =>
      preds.every((p) => {
        const [col, value] = p.args as [string, unknown];
        if (p.m === 'eq') return r[col] === undefined || r[col] === value;
        if (p.m === 'in') return (value as unknown[]).includes(r[col]);
        if (p.m === 'gte') return Number(r[col]) >= Number(value);
        if (p.m === 'is') return r[col] === undefined || r[col] === value;
        return true;
      }),
    );
  }

  function builder(table: string, columns: string) {
    const rec: Rec = { table, columns, preds: [] };
    admin.queries.push(rec);
    const res = () => {
      const raw = admin.tables[table] ?? { data: [], error: null };
      if (raw.error || !Array.isArray(raw.data)) return raw;
      return { data: apply(raw.data as Array<Record<string, unknown>>, rec.preds), error: null };
    };
    const api: Record<string, unknown> = {
      maybeSingle: async () => {
        const r = res();
        return { data: (r.data as unknown[])?.[0] ?? null, error: r.error };
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(res()).then(ok, bad),
    };
    for (const m of CHAIN) {
      api[m] = (...args: unknown[]) => { rec.preds.push({ m, args }); return api; };
    }
    return api;
  }
  const client = { from: (t: string) => ({ select: (c = '*') => builder(t, c) }) };
  return { getSupabaseAdmin: () => client, supabaseAdmin: client };
});

/* ── RLS-scoped route client + flags (my-class) ─────────────────────────── */
const { routeDb } = vi.hoisted(() => ({
  routeDb: {
    enrolment: { data: null as unknown, error: null as unknown },
    rpc: { data: [] as unknown, error: null as unknown },
    rpcCalls: [] as Array<{ name: string; params: unknown }>,
    flagOn: true,
  },
}));

vi.mock('@alfanumrik/lib/supabase-route', () => ({
  createSupabaseRouteClient: async () => ({
    from: () => ({
      select: () => {
        const api: Record<string, unknown> = {
          maybeSingle: async () => routeDb.enrolment,
        };
        for (const m of ['eq', 'order', 'limit', 'is']) api[m] = () => api;
        return api;
      },
    }),
    rpc: async (name: string, params: unknown) => {
      routeDb.rpcCalls.push({ name, params });
      return routeDb.rpc;
    },
  }),
}));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: async () => routeDb.flagOn,
}));

/* ── invocation helpers ─────────────────────────────────────────────────── */
async function get(mod: string, url: string): Promise<Response> {
  const { GET } = await import(mod);
  return GET(new Request(url) as never);
}
const titles = (q = '') => get('../../../../app/api/v1/leaderboard/titles/route', `http://localhost/api/v1/leaderboard/titles${q}`);
const streaks = (q = '') => get('../../../../app/api/v1/leaderboard/streaks/route', `http://localhost/api/v1/leaderboard/streaks${q}`);
const myClass = (q = '') => get('../../../../app/api/v1/leaderboard/my-class/route', `http://localhost/api/v1/leaderboard/my-class${q}`);

const DENY = (status: number) => ({
  authorized: false, userId: null, studentId: null, roles: [], permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'denied' }), { status }),
});

/** The FIRST query issued against `table` — for challenge_streaks that is the
 *  board read; the caller's own-row read comes afterwards. */
function query(table: string): Rec {
  const q = admin.queries.find((x) => x.table === table);
  expect(q, `no query issued against ${table}`).toBeDefined();
  return q!;
}
function args(rec: Rec, m: string): unknown[][] {
  return rec.preds.filter((p) => p.m === m).map((p) => p.args);
}

beforeEach(() => {
  auth.current = {
    authorized: true, userId: AUTH_USER_ID, studentId: ME,
    roles: ['student'], permissions: ['leaderboard.view', 'progress.view_own'],
  };
  admin.tables = {};
  admin.queries = [];
  routeDb.enrolment = { data: null, error: null };
  routeDb.rpc = { data: [], error: null };
  routeDb.rpcCalls = [];
  routeDb.flagOn = true;
});

// ════════════════════════════════════════════════════════════════════════════
// /titles — own data, service-role read, scoped server-side
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/leaderboard/titles', () => {
  const ROW = {
    id: 't-1', title: 'Quiz Master', title_hi: 'क्विज़ मास्टर', icon: '🏆',
    tier: 'gold', source: 'competition', earned_at: '2026-07-01T00:00:00Z',
    // Columns the route must NOT project even if the row carries them.
    student_id: ME, source_id: 'comp-9',
  };

  it('401 when unauthorized', async () => {
    auth.current = DENY(401);
    expect((await titles()).status).toBe(401);
  });

  it('scopes the read to the SESSION student id', async () => {
    admin.tables.student_titles = { data: [ROW], error: null };
    await titles();
    expect(args(query('student_titles'), 'eq')).toContainEqual(['student_id', ME]);
  });

  it('IGNORES a client-supplied ?student_id (P13)', async () => {
    admin.tables.student_titles = { data: [ROW], error: null };
    await titles(`?student_id=${PEER_1}`);
    const eqs = args(query('student_titles'), 'eq');
    expect(eqs).toContainEqual(['student_id', ME]);
    expect(eqs.flat()).not.toContain(PEER_1);
  });

  it('projects only the whitelisted fields', async () => {
    admin.tables.student_titles = { data: [ROW], error: null };
    const body = await (await titles()).json();
    expect(Object.keys(body.data.titles[0]).sort()).toEqual(
      ['earned_at', 'icon', 'id', 'source', 'tier', 'title', 'title_hi'],
    );
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('comp-9');
    expect(wire).not.toContain(ME);
  });

  it('a FAILED read is a 500 — never an empty list the UI reads as "no titles"', async () => {
    admin.tables.student_titles = { data: null, error: { message: 'boom' } };
    const res = await titles();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('a genuinely empty list is a 200 with titles:[] — the two are distinguishable', async () => {
    admin.tables.student_titles = { data: [], error: null };
    const res = await titles();
    expect(res.status).toBe(200);
    expect((await res.json()).data.titles).toEqual([]);
  });

  it('a caller with no student row gets an empty list, not another caller rows', async () => {
    auth.current = { ...(auth.current as object), studentId: null };
    admin.tables.student_titles = { data: [ROW], error: null };
    const body = await (await titles()).json();
    expect(body.data.titles).toEqual([]);
    // No read at all — a missing anchor must never widen the query.
    expect(admin.queries.some((q) => q.table === 'student_titles')).toBe(false);
  });

  it('is cached PRIVATE only (the response is caller-specific)', async () => {
    admin.tables.student_titles = { data: [], error: null };
    const cc = (await titles()).headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('public');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /streaks — THE peer-field whitelist route (P13)
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/leaderboard/streaks — peer field whitelist', () => {
  function seed() {
    admin.tables.challenge_streaks = {
      data: [
        { student_id: PEER_1, current_streak: 40, best_streak: 90, badges: ['bronze_7', 'silver_30'] },
        { student_id: ME, current_streak: 5, best_streak: 21, badges: ['bronze_7'] },
        { student_id: PEER_2, current_streak: 4, best_streak: 4, badges: [] },
      ],
      error: null,
    };
    admin.tables.students = {
      data: [
        { id: PEER_1, name: 'Aarav', grade: 8, email: 'aarav@example.test', phone: '900000000' },
        { id: ME, name: 'Test Student', grade: '8' },
        { id: PEER_2, name: 'Chirag', grade: '7' },
      ],
      error: null,
    };
  }

  beforeEach(seed);

  it('401 when unauthorized', async () => {
    auth.current = DENY(401);
    expect((await streaks()).status).toBe(401);
  });

  it('peers carry EXACTLY the whitelisted fields and nothing else', async () => {
    const body = await (await streaks()).json();
    for (const item of body.data.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['badges', 'current_streak', 'grade', 'name', 'rank', 'student_id'],
      );
    }
  });

  it('a peer best_streak is NEVER exposed — only the caller own is', async () => {
    const body = await (await streaks()).json();
    for (const item of body.data.items) {
      expect(item.best_streak).toBeUndefined();
    }
    // 90 is PEER_1's historical maximum; it must not appear anywhere on the wire.
    expect(JSON.stringify(body.data.items)).not.toContain('90');
    // The caller's own row DOES carry it — own data is own data.
    expect(body.data.me.best_streak).toBe(21);
  });

  it('never leaks email / phone / avatar / school / city for peers', async () => {
    const wire = JSON.stringify(await (await streaks()).json());
    for (const forbidden of ['aarav@example.test', '900000000', 'email', 'phone', 'avatar_url', 'school', 'city']) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it('peer badges are only those already IMPLIED by the exposed streak', async () => {
    const body = await (await streaks()).json();
    const peer = body.data.items.find((i: { student_id: string }) => i.student_id === PEER_1);
    // current_streak 40 ⇒ bronze_7 (7d) and silver_30 (30d) are both derivable.
    expect(peer.badges).toEqual(expect.arrayContaining(['bronze_7']));
    // Nothing above the exposed streak may survive.
    expect(peer.badges).not.toContain('gold_100');
  });

  it('drops unknown badge ids (fail closed)', async () => {
    admin.tables.challenge_streaks = {
      data: [{ student_id: PEER_1, current_streak: 40, best_streak: 40, badges: ['bronze_7', 'secret_internal_flag'] }],
      error: null,
    };
    admin.tables.students = { data: [{ id: PEER_1, name: 'Aarav', grade: '8' }], error: null };
    const body = await (await streaks()).json();
    expect(body.data.items[0].badges).not.toContain('secret_internal_flag');
  });

  it('applies the visibility threshold server-side (not client-side)', async () => {
    await streaks();
    expect(args(query('challenge_streaks'), 'gte')).toContainEqual(['current_streak', 3]);
  });

  it('emits grade as a STRING even when the row holds an integer (P5)', async () => {
    const body = await (await streaks()).json();
    const peer = body.data.items.find((i: { student_id: string }) => i.student_id === PEER_1);
    expect(peer.grade).toBe('8');
    expect(typeof peer.grade).toBe('string');
  });

  it('excludes inactive / deleted students from the board', async () => {
    await streaks();
    const q = query('students');
    expect(args(q, 'eq')).toContainEqual(['is_active', true]);
    expect(args(q, 'is')).toContainEqual(['deleted_at', null]);
  });

  it('reads student meta for the streak ids ONLY — never a full-table scan', async () => {
    await streaks();
    const ins = args(query('students'), 'in');
    expect(ins).toHaveLength(1);
    expect(ins[0][0]).toBe('id');
    expect(ins[0][1]).toEqual(expect.arrayContaining([PEER_1, ME]));
  });

  it('a FAILED read is a 500 — never an empty board', async () => {
    admin.tables.challenge_streaks = { data: null, error: { message: 'boom' } };
    const res = await streaks();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('a genuinely empty board is a 200 with items:[]', async () => {
    admin.tables.challenge_streaks = { data: [], error: null };
    const res = await streaks();
    expect(res.status).toBe(200);
    expect((await res.json()).data.items).toEqual([]);
  });

  it('the caller own row is present even when they are below the threshold', async () => {
    admin.tables.challenge_streaks = {
      data: [{ student_id: ME, current_streak: 1, best_streak: 12, badges: [] }],
      error: null,
    };
    admin.tables.students = { data: [{ id: ME, name: 'Test Student', grade: '8' }], error: null };
    const body = await (await streaks()).json();
    expect(body.data.me.current_streak).toBe(1);
    expect(body.data.me.on_board).toBe(false);
    expect(body.data.me.rank).toBeNull();
  });

  it('is cached PRIVATE only (it carries a caller-specific `me`)', async () => {
    const cc = (await streaks()).headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('public');
  });

  it('clamps ?limit and ignores a client ?student_id', async () => {
    const body = await (await streaks(`?limit=9999&student_id=${PEER_1}`)).json();
    expect(body.data.items.length).toBeLessThanOrEqual(50);
    expect(body.data.me.student_id).toBe(ME);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /my-class — THREE outcomes must stay three (off / not-enrolled / empty / 5xx)
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/leaderboard/my-class', () => {
  it('401 when unauthorized', async () => {
    auth.current = DENY(401);
    expect((await myClass()).status).toBe(401);
  });

  it('404 when the feature flag is OFF (a deliberate product state)', async () => {
    routeDb.flagOn = false;
    const res = await myClass();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('enrolled:false when the caller has no class_students row', async () => {
    routeDb.enrolment = { data: null, error: null };
    const res = await myClass();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enrolled).toBe(false);
    expect(body.data.class_id).toBeNull();
    expect(body.data.items).toEqual([]);
  });

  it('enrolled:true with items:[] when the class board is genuinely empty', async () => {
    routeDb.enrolment = { data: { class_id: 'class-1' }, error: null };
    routeDb.rpc = { data: [], error: null };
    const body = await (await myClass()).json();
    expect(body.data.enrolled).toBe(true);
    expect(body.data.class_id).toBe('class-1');
    expect(body.data.items).toEqual([]);
  });

  it('the three outcomes are mutually distinguishable on the wire', async () => {
    routeDb.flagOn = false;
    const off = await myClass();

    routeDb.flagOn = true;
    routeDb.enrolment = { data: null, error: null };
    const notEnrolled = await myClass();

    routeDb.enrolment = { data: { class_id: 'class-1' }, error: null };
    routeDb.rpc = { data: [], error: null };
    const empty = await myClass();

    expect(off.status).toBe(404);
    expect(notEnrolled.status).toBe(200);
    expect(empty.status).toBe(200);
    const a = await notEnrolled.json();
    const b = await empty.json();
    expect(a.data.enrolled).not.toBe(b.data.enrolled);
  });

  it('a failed ENROLMENT read is a 5xx — never "not in a class"', async () => {
    routeDb.enrolment = { data: null, error: { message: 'boom' } };
    const res = await myClass();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('a failed RPC is a 5xx — never an empty class board', async () => {
    routeDb.enrolment = { data: { class_id: 'class-1' }, error: null };
    routeDb.rpc = { data: null, error: { message: 'boom' } };
    const res = await myClass();
    expect(res.status).toBe(500);
  });

  it('resolves membership from class_students, never from students.class_id', async () => {
    routeDb.enrolment = { data: { class_id: 'class-1' }, error: null };
    routeDb.rpc = { data: [], error: null };
    await myClass();
    expect(routeDb.rpcCalls[0].name).toBe('get_class_leaderboard');
    expect(routeDb.rpcCalls[0].params).toMatchObject({ p_class_id: 'class-1' });
  });

  it('emits the class item whitelist with a STRING grade (P5, P13)', async () => {
    routeDb.enrolment = { data: { class_id: 'class-1' }, error: null };
    routeDb.rpc = {
      data: [
        {
          rank: 1, student_id: PEER_1, name: 'Aarav', grade: 8, avatar_url: null,
          xp_total: 900, xp_this_period: 300, quizzes: 6,
          email: 'aarav@example.test', school: 'DPS',
        },
      ],
      error: null,
    };
    const body = await (await myClass()).json();
    expect(Object.keys(body.data.items[0]).sort()).toEqual(
      ['avatar_url', 'grade', 'name', 'quizzes', 'rank', 'student_id', 'xp_this_period', 'xp_total'],
    );
    expect(body.data.items[0].grade).toBe('8');
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('aarav@example.test');
    expect(wire).not.toContain('DPS');
  });

  it('is cached PRIVATE only (the board depends on WHICH class the caller is in)', async () => {
    routeDb.enrolment = { data: null, error: null };
    const cc = (await myClass()).headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('public');
  });
});
