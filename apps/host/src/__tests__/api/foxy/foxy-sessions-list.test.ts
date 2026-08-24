/**
 * GET /api/foxy/sessions — the Foxy chat-history LIST contract.
 *
 * ── Why this suite exists ────────────────────────────────────────────────
 * CEO defect #1: "students chat history shall be recorded and displayed to
 * student." The READ half was broken in a specific, invisible way: the rail
 * fetched `foxy_sessions` + `foxy_chat_messages` client-side over PostgREST
 * and DISCARDED the query error, so a failed fetch rendered pixel-identically
 * to an empty account. Confirmed live 2026-08-08 against a student with 1,359
 * real sessions. There was also no list endpoint at ALL — `GET /api/foxy`
 * requires a `sessionId` and returns exactly one thread.
 *
 * The properties below are the ones that, if they regress, put the defect
 * back:
 *
 *   1. A DB error is a 500 with `success: false` — NEVER a 200 with an empty
 *      list. This is the whole reason the endpoint exists; a "graceful"
 *      empty-on-error fallback here would recreate the original bug on the
 *      server side, where the client can no longer even see it.
 *   2. Unauthenticated requests are rejected before any query runs.
 *   3. Every query is scoped to the CALLER's student_id, so one student can
 *      never receive another's sessions even if RLS regresses.
 *   4. No message body crosses the wire (P13) — titles/subjects/counts only.
 *   5. Zero-message sessions are filtered OUT, but user-only sessions are
 *      kept: `foxy_chat_messages` took zero writes for 21 days before the
 *      write path was repaired, so a `>= 2` floor would keep hiding history.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const STUDENT_ID ='11111111-1111-1111-1111-111111111111';
const OTHER_STUDENT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// ─── auth ────────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(studentId: string = STUDENT_ID) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: USER_ID,
    studentId,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
}
function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    errorResponse: new Response(JSON.stringify({ success: false, error: 'AUTH_REQUIRED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

const loggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => loggerError(...a) },
}));

// ─── recording Supabase server client (RLS-respecting client, per P8) ────────
interface QueryRecord {
  table: string;
  filters: Array<{ op: string; args: unknown[] }>;
  columns: string;
}
let queries: QueryRecord[] = [];

type Result = { data: unknown; error: unknown };
let sessionsResult: Result;
let countResult: Result;
let firstUserResult: Result;

/**
 * @param anonymous models a client that reaches PostgREST with NO identity.
 *   RLS then denies every SELECT, which PostgREST reports as an empty result
 *   set and NOT as an error — the silent shape that made this defect invisible.
 */
function makeChain(record: QueryRecord, anonymous = false) {
  const chain: any = {
    then(resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) {
      if (anonymous) return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      let result: Result;
      if (record.table === 'foxy_sessions') result = sessionsResult;
      else if (record.filters.some((f) => f.op === 'eq' && f.args[0] === 'role')) {
        result = firstUserResult;
      } else result = countResult;
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  for (const op of ['eq', 'in', 'lt', 'gte', 'order', 'limit', 'neq', 'not']) {
    chain[op] = (...args: unknown[]) => {
      record.filters.push({ op, args });
      return chain;
    };
  }
  return chain;
}

function makeRecordingClient(anonymous = false) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const record: QueryRecord = { table, filters: [], columns };
          queries.push(record);
          return makeChain(record, anonymous);
        },
      };
    },
  };
}

/* ── THE SEAM UNDER TEST — do NOT mock `@alfanumrik/lib/supabase-route` ───────
 * This suite used to mock BOTH `authorizeRequest` AND `createSupabaseServerClient`,
 * which is precisely why it stayed green while the feature was dead in
 * production: it mocked away the very seam that was broken. The route resolved
 * its data client from COOKIES, but the browser Supabase client keeps the
 * session in localStorage (plain `createClient`, no `sb-*` cookie for
 * password-login students), so PostgREST saw no user, `auth.uid()` was NULL,
 * RLS denied all three SELECTs and the route answered a cheerful
 * `200 { success: true, sessions: [] }` — the original empty-rail defect with an
 * extra network hop.
 *
 * So the two CLIENT FACTORIES below are mocked, but the resolver that chooses
 * between them (`createSupabaseRouteClient`) runs FOR REAL. That is what lets
 * the Bearer-path test observe which factory the route actually reached.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * The cookie-only factory. Correct for cookie callers, WRONG for Bearer ones.
 *
 * When the in-flight request carried a Bearer and NO cookie, this double
 * returns an ANONYMOUS client: that is what production does — no auth cookie
 * to read ⇒ PostgREST sees no user ⇒ `auth.uid()` NULL ⇒ RLS denies ⇒ empty
 * result set, `error: null`. Without modelling that, the double would hand a
 * cookie-wired route the same rows a correctly-wired one gets and the suite
 * would stay green on broken code — the exact blindness being fixed here.
 */
let requestHadBearer = false;
const cookieClientFactory = vi.fn(async () => makeRecordingClient(requestHadBearer));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: () => cookieClientFactory(),
}));

/** The Bearer factory (`createClient` inside the real supabase-route helper). */
const bearerClientFactory = vi.fn(
  (_url: string, _key: string, _opts?: any) => makeRecordingClient(),
);
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts?: any) =>
    bearerClientFactory(url, key, opts),
}));

// ─── subject under test ──────────────────────────────────────────────────────
import { GET } from '../../../app/api/foxy/sessions/route';

function request(query = '', headers?: Record<string, string>): any {
  // A Bearer caller sends NO Supabase auth cookie (the browser session lives in
  // localStorage), so the cookie client would be anonymous for this request.
  requestHadBearer = Boolean(headers?.Authorization);
  return new Request(`http://localhost/api/foxy/sessions${query}`, {
    headers,
  }) as any;
}

const BEARER = 'header.payload.signature';
function bearerRequest(query = ''): any {
  return request(query, { Authorization: `Bearer ${BEARER}` });
}

const OK = { data: [], error: null };

beforeEach(() => {
  queries = [];
  loggerError.mockReset();
  _authorizeImpl.mockReset();
  cookieClientFactory.mockClear();
  bearerClientFactory.mockClear();
  requestHadBearer = false;
  setAuthorized();
  sessionsResult = OK;
  countResult = OK;
  firstUserResult = OK;
});

/* ───────────────────────────────────────────────────────────────────────────
 * 1. THE DEFECT: an error is an error, never an empty list.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('GET /api/foxy/sessions — a failed query never reads as "no chats"', () => {
  it('returns 500 with success:false when the sessions query errors', async () => {
    sessionsResult = { data: null, error: { code: '42501', message: 'permission denied' } };

    const res = await GET(request());
    const body = await res.json();

    expect(
      res.status,
      'A DB failure must NOT be a 200. A 200 with an empty array is exactly the ' +
        'defect this endpoint was built to remove — the client cannot tell it ' +
        'apart from a genuinely empty account.',
    ).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SESSION_LIST_FAILED');
    // Never a sessions array on the failure path — an empty one would let a
    // lenient client render the empty state anyway.
    expect(body.data).toBeUndefined();
  });

  it('returns 500 when the message-count query errors, even though sessions loaded', async () => {
    sessionsResult = {
      data: [{ id: 's1', subject: 'science', chapter: null, last_active_at: '2026-08-20T10:00:00Z' }],
      error: null,
    };
    countResult = { data: null, error: { code: '500', message: 'boom' } };

    const res = await GET(request());
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('distinguishes a genuinely empty account with a 200 and an empty array', async () => {
    // The control direction. Without it the assertions above would also pass
    // against an endpoint that 500s unconditionally.
    sessionsResult = { data: [], error: null };

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.sessions).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
  });

  it('logs the failure with codes only — no ids, no titles, no message text (P13)', async () => {
    sessionsResult = { data: null, error: { code: '42501', message: 'permission denied' } };
    await GET(request());

    expect(loggerError).toHaveBeenCalled();
    const [, meta] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(meta).sort()).toEqual(['errorCode', 'query', 'route']);
    const serialized = JSON.stringify(loggerError.mock.calls);
    expect(serialized).not.toContain(STUDENT_ID);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 2. Auth + cross-student isolation.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('GET /api/foxy/sessions — auth and student scoping', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    setUnauthorized();

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(queries, 'no query may run for an unauthenticated caller').toEqual([]);
  });

  it('rejects an authorized caller carrying no studentId', async () => {
    _authorizeImpl.mockResolvedValue({
      authorized: true,
      userId: USER_ID,
      studentId: null,
      roles: ['student'],
      permissions: ['foxy.chat'],
    });

    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(queries).toEqual([]);
  });

  it('scopes EVERY query to the caller student_id — never another student', async () => {
    sessionsResult = {
      data: [{ id: 's1', subject: 'math', chapter: null, last_active_at: '2026-08-20T10:00:00Z' }],
      error: null,
    };
    countResult = { data: [{ session_id: 's1' }], error: null };

    await GET(request());

    expect(queries.length).toBeGreaterThanOrEqual(3);
    for (const q of queries) {
      const studentFilter = q.filters.find((f) => f.op === 'eq' && f.args[0] === 'student_id');
      expect(
        studentFilter,
        `query on ${q.table} carries no student_id filter — it would rely on RLS alone`,
      ).toBeDefined();
      expect(studentFilter!.args[1]).toBe(STUDENT_ID);
      expect(studentFilter!.args[1]).not.toBe(OTHER_STUDENT_ID);
    }
  });

  it('follows the caller when a DIFFERENT student is authenticated', async () => {
    setAuthorized(OTHER_STUDENT_ID);
    await GET(request());
    for (const q of queries) {
      const f = q.filters.find((x) => x.op === 'eq' && x.args[0] === 'student_id');
      expect(f!.args[1]).toBe(OTHER_STUDENT_ID);
    }
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 3. The payload shape: history without message bodies (P13).
 * ─────────────────────────────────────────────────────────────────────────── */
describe('GET /api/foxy/sessions — payload contract', () => {
  const SESSIONS = [
    { id: 's1', subject: 'science', chapter: 'Light', last_active_at: '2026-08-20T10:00:00Z' },
    { id: 's2', subject: 'math', chapter: null, last_active_at: '2026-08-19T10:00:00Z' },
    { id: 's3', subject: 'hindi', chapter: null, last_active_at: '2026-08-18T10:00:00Z' },
  ];

  beforeEach(() => {
    sessionsResult = { data: SESSIONS, error: null };
    countResult = {
      // s1 → 2 turns, s2 → 1 (user-only), s3 → 0 (absent entirely).
      data: [{ session_id: 's1' }, { session_id: 's1' }, { session_id: 's2' }],
      error: null,
    };
    firstUserResult = {
      data: [
        { session_id: 's1', content: 'Explain: how does a convex lens work?', created_at: '1' },
        { session_id: 's1', content: 'and a concave one?', created_at: '2' },
        { session_id: 's2', content: 'what is a prime number', created_at: '1' },
      ],
      error: null,
    };
  });

  it('drops zero-message sessions but KEEPS user-only ones', async () => {
    const body = await (await GET(request())).json();
    const ids = body.data.sessions.map((s: any) => s.id);

    expect(ids, 's3 has no messages and is unopenable chrome').not.toContain('s3');
    expect(
      ids,
      's2 has only a user turn. foxy_chat_messages took zero writes for 21 days, ' +
        'so a messageCount >= 2 floor would keep hiding real history.',
    ).toContain('s2');
    expect(ids).toEqual(['s1', 's2']);
  });

  it('derives the title from the student OWN first prompt, oldest turn first', async () => {
    const body = await (await GET(request())).json();
    const s1 = body.data.sessions.find((s: any) => s.id === 's1');
    // "Explain: " is stripped by the shared deriveConversationTitle.
    expect(s1.title).toBe('how does a convex lens work?');
    // The SECOND user turn must not win.
    expect(s1.title).not.toContain('concave');
  });

  it('returns title:null (not an English fallback) when a thread has no user turn', async () => {
    firstUserResult = { data: [], error: null };
    const body = await (await GET(request())).json();
    for (const s of body.data.sessions) {
      expect(
        s.title,
        'the server must not pick a language — the client owns the bilingual ' +
          'subject-name fallback (P7)',
      ).toBeNull();
    }
  });

  it('never returns a message body, sources, or any assistant content (P13)', async () => {
    const body = await (await GET(request())).json();
    const allowed = ['id', 'title', 'subject', 'chapter', 'updatedAt', 'messageCount'];
    for (const s of body.data.sessions) {
      expect(Object.keys(s).sort()).toEqual([...allowed].sort());
    }
    const serialized = JSON.stringify(body);
    for (const forbidden of ['sources', 'lastMessage', 'content', 'structured']) {
      expect(serialized, `payload leaks '${forbidden}'`).not.toContain(`"${forbidden}"`);
    }
  });

  it('never selects assistant message CONTENT out of the database at all', async () => {
    await GET(request());
    const countQuery = queries.find(
      (q) => q.table === 'foxy_chat_messages' && !q.filters.some((f) => f.args[0] === 'role'),
    );
    expect(
      countQuery!.columns,
      'the count query must select ids only — pulling every body across the ' +
        'network to compute a length is both slow and a needless PII surface',
    ).toBe('session_id');

    const titleQuery = queries.find((q) =>
      q.filters.some((f) => f.op === 'eq' && f.args[0] === 'role' && f.args[1] === 'user'),
    );
    expect(titleQuery, 'titles must come from USER turns only').toBeDefined();
  });

  it('reports the real message count per session', async () => {
    const body = await (await GET(request())).json();
    const byId = Object.fromEntries(body.data.sessions.map((s: any) => [s.id, s.messageCount]));
    expect(byId).toEqual({ s1: 2, s2: 1 });
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 4. Paging.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('GET /api/foxy/sessions — limit and cursor', () => {
  it('clamps limit to 1..50 and defaults to 30', async () => {
    const limitOf = async (q: string) => {
      queries = [];
      await GET(request(q));
      const l = queries[0].filters.find((f) => f.op === 'limit');
      return l!.args[0];
    };
    expect(await limitOf('')).toBe(30);
    expect(await limitOf('?limit=5')).toBe(5);
    expect(await limitOf('?limit=999')).toBe(50);
    expect(await limitOf('?limit=0')).toBe(1);
    expect(await limitOf('?limit=banana')).toBe(30);
  });

  it('applies a cursor as a strict last_active_at upper bound', async () => {
    await GET(request('?cursor=2026-08-19T00:00:00.000Z'));
    const lt = queries[0].filters.find((f) => f.op === 'lt');
    expect(lt!.args).toEqual(['last_active_at', '2026-08-19T00:00:00.000Z']);
  });

  it('rejects an unparseable cursor instead of silently restarting from the top', async () => {
    const res = await GET(request('?cursor=not-a-date'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BAD_CURSOR');
    expect(queries, 'a bad cursor must not reach the database').toEqual([]);
  });

  it('derives nextCursor from the last SCANNED session, not the last RETURNED one', async () => {
    // A full page whose LAST row is a zero-message session that gets filtered
    // out. Deriving the cursor from the returned rows would rewind paging and
    // loop the "load more" button on the same page forever.
    sessionsResult = {
      data: [
        { id: 's1', subject: 'math', chapter: null, last_active_at: '2026-08-20T10:00:00Z' },
        { id: 'empty', subject: 'math', chapter: null, last_active_at: '2026-08-19T10:00:00Z' },
      ],
      error: null,
    };
    countResult = { data: [{ session_id: 's1' }], error: null };

    const body = await (await GET(request('?limit=2'))).json();
    expect(body.data.sessions.map((s: any) => s.id)).toEqual(['s1']);
    expect(body.data.nextCursor).toBe('2026-08-19T10:00:00Z');
  });

  it('reports nextCursor:null on a partial page (end of history)', async () => {
    sessionsResult = {
      data: [{ id: 's1', subject: 'math', chapter: null, last_active_at: '2026-08-20T10:00:00Z' }],
      error: null,
    };
    countResult = { data: [{ session_id: 's1' }], error: null };

    const body = await (await GET(request('?limit=30'))).json();
    expect(body.data.nextCursor).toBeNull();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 5. THE SEAM: the data client is resolved FROM THE REQUEST, not from cookies.
 *
 * BLOCKER found in final quality review, 2026-08-24. The route shipped using
 * the cookie-only `createSupabaseServerClient()`. The web client authenticates
 * with `Authorization: Bearer <jwt>` (the browser Supabase session lives in
 * localStorage — `packages/lib/src/supabase-client.ts` uses plain
 * `createClient`, so password-login students have no `sb-*` cookie at all;
 * `apps/host/src/app/api/auth/bootstrap/route.ts:80` says so in the repo's own
 * words). A Bearer request therefore reached PostgREST as anonymous:
 * `auth.uid()` NULL → `get_my_student_id()` NULL → every RLS SELECT denied →
 * all three queries empty → HTTP 200 `{ success: true, sessions: [] }`.
 *
 * That is the SILENT shape of the failure and the reason none of the four
 * suites above caught it: the route was 200-OK, `success: true`, correctly
 * `student_id`-scoped, P13-clean, and completely empty. Identical precedent
 * already recorded at `apps/host/src/app/api/synthesis/state/route.ts:64-67`.
 *
 * These tests do NOT mock `createSupabaseRouteClient` — mocking the resolver
 * would reproduce exactly the blindness being fixed. Only the two leaf client
 * FACTORIES are mocked, so the assertions observe which one the route reached.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('GET /api/foxy/sessions — resolves its data client from the REQUEST', () => {
  beforeEach(() => {
    sessionsResult = {
      data: [{ id: 's1', subject: 'science', chapter: null, last_active_at: '2026-08-20T10:00:00Z' }],
      error: null,
    };
    countResult = { data: [{ session_id: 's1' }], error: null };
  });

  it('forwards a Bearer credential to PostgREST instead of falling back to cookies', async () => {
    await GET(bearerRequest());

    expect(
      bearerClientFactory,
      'the route must build its client from the request Authorization header. ' +
        'A cookie-only client makes a Bearer caller anonymous to PostgREST, RLS ' +
        'denies every SELECT, and the route answers 200 with an empty history — ' +
        'the original defect, silently, with an extra network hop.',
    ).toHaveBeenCalled();

    const [, , opts] = bearerClientFactory.mock.calls[0] as [string, string, any];
    expect(
      opts?.global?.headers?.Authorization,
      "the caller's own JWT must reach PostgREST so auth.uid() resolves and RLS " +
        'scopes the read to that student',
    ).toBe(`Bearer ${BEARER}`);

    expect(
      cookieClientFactory,
      'the cookie client must NOT be used when a Bearer credential is present',
    ).not.toHaveBeenCalled();
  });

  it('returns the real history to a Bearer caller — not a spurious empty list', async () => {
    // The end-to-end statement of the defect, in the shape the CEO saw it:
    // real rows in the database, a Bearer request, and a POPULATED rail.
    // Under the cookie-only client the double goes anonymous (as production
    // does), RLS denies, and this comes back 200 + `success: true` + an empty
    // array — a green-looking response carrying the original bug.
    const res = await GET(bearerRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(
      body.data.sessions.map((s: any) => s.id),
      'a Bearer-authenticated student with real sessions must receive them — ' +
        'an empty list here IS the defect, just wearing a 200',
    ).toEqual(['s1']);
  });

  it('still honours the cookie path when NO Bearer is present (mobile + web both work)', async () => {
    // The control direction: the fix must not swap one exclusive credential for
    // another. `createSupabaseRouteClient` falls back to the cookie client.
    const body = await (await GET(request())).json();

    expect(cookieClientFactory).toHaveBeenCalled();
    expect(bearerClientFactory).not.toHaveBeenCalled();
    expect(body.data.sessions.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('never builds an RLS-bypassing client — the anon key only (P8)', async () => {
    await GET(bearerRequest());

    const [url, key] = bearerClientFactory.mock.calls[0] as [string, string];
    expect(url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(key).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(
      key,
      'the service-role key would bypass RLS entirely; this route reads student ' +
        'chat history and must stay under RLS',
    ).not.toBe(process.env.SUPABASE_SERVICE_ROLE_KEY);
  });

  it('keeps every query student_id-scoped on the Bearer path too', async () => {
    await GET(bearerRequest());

    expect(queries.length).toBeGreaterThanOrEqual(3);
    for (const q of queries) {
      const f = q.filters.find((x) => x.op === 'eq' && x.args[0] === 'student_id');
      expect(f, `query on ${q.table} carries no student_id filter`).toBeDefined();
      expect(f!.args[1]).toBe(STUDENT_ID);
    }
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 6. The CLIENT half of the same blocker: `fetchAllConversations` must send a
 *    credential the server can read.
 *
 * `fetchAllConversations` shipped as a bare `fetch('/api/foxy/sessions', {
 * credentials: 'include' })`. There is no `sb-*` cookie to include, so
 * `authorizeRequest` found neither a Bearer nor a cookie session → 401 → the
 * fetcher threw → `conversationsError` latched → the new "Couldn't load your
 * chats" panel rendered PERMANENTLY for every password-login student. That is
 * strictly worse than the reported defect: an error rail instead of an empty
 * one.
 *
 * This is a source-level contract canary rather than a render test on purpose:
 * `fetchAllConversations` is a module-private function inside a ~2,000-line
 * client page, and the property that matters is textual and exact — WHICH fetch
 * primitive the call site uses. Three sibling fetchers were repointed at
 * `authedFetch` in this same wave for this identical reason
 * (`packages/ui/src/review/os/useRevisionOverview.ts`,
 * `packages/ui/src/dashboard/ReviewsDueCard.tsx`,
 * `packages/ui/src/dashboard/os/BoardScoreWidget.tsx`).
 * ─────────────────────────────────────────────────────────────────────────── */
describe('fetchAllConversations sends an Authorization header (foxy/page.tsx)', () => {
  // House idiom for source canaries in this suite: resolve against the vitest
  // root (`apps/host`) — see adaptive-layer-health.test.ts:720.
  const pageSource = readFileSync(path.resolve('src/app/foxy/page.tsx'), 'utf-8');

  /** The body of `fetchAllConversations`, up to the next top-level function. */
  const fnBody = (() => {
    const start = pageSource.indexOf('async function fetchAllConversations');
    expect(start, 'fetchAllConversations not found — was it renamed?').toBeGreaterThan(-1);
    const rest = pageSource.slice(start + 1);
    const end = rest.search(/\n(?:async )?function /);
    return end === -1 ? rest : rest.slice(0, end);
  })();

  /** Same body with comments stripped — prose about `fetch()` is not a call. */
  const fnCode = fnBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('calls authedFetch, never the bare global fetch', () => {
    expect(
      fnCode,
      'authedFetch reads the access token from the live Supabase session and ' +
        'forwards it as `Authorization: Bearer <token>` — the credential ' +
        "authorizeRequest actually authenticates on. A bare fetch() sends nothing " +
        'the server can read and 401s on every load.',
    ).toContain("authedFetch('/api/foxy/sessions");

    expect(
      /(?<![\w.])fetch\(/.test(fnCode.replace(/authedFetch\(/g, 'AUTHED(')),
      'fetchAllConversations must not call the bare global fetch()',
    ).toBe(false);
  });

  it('does not lean on cookie credentials as its only credential', () => {
    // The exact shape of the shipped bug. There is no sb-* cookie to include:
    // apps/host/src/app/api/auth/bootstrap/route.ts:80 — "Password-login users
    // have no sb-* [cookies]".
    expect(fnCode).not.toContain("credentials: 'include'");
  });

  it('imports authedFetch from the shared helper module', () => {
    expect(pageSource).toMatch(
      /import\s*\{[^}]*\bauthedFetch\b[^}]*\}\s*from\s*'@alfanumrik\/lib\/authed-fetch'/,
    );
  });
});

