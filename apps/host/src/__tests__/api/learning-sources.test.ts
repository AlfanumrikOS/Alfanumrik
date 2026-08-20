/**
 * Route-level pins for `GET /api/learning-sources` —
 * `apps/host/src/app/api/learning-sources/route.ts` (P0-1 hotfix,
 * 2026-08-20 comprehensive code review, `docs/audits/2026-08-20-comprehensive-code-review.md`).
 *
 * No test file existed for this route before this one (confirmed by grep —
 * `find apps/host/src/__tests__/api -iname '*learning-source*'` returned
 * nothing prior to this file).
 *
 * This route is the SOLE enforcement point for the `learning-sources`
 * storage bucket, which carries zero `storage.objects` RLS policies by
 * design (see `supabase/migrations/20260816000001_learning_sources_bucket.sql`).
 * It enforces three things this file pins:
 *   1. RBAC — `learning_source.view` permission via `authorizeRequest()`.
 *   2. Path-parameter validation (P5 grade-string exactness, traversal /
 *      charset guards on board and filename).
 *   3. Anti-enumeration — a restricted/pending rights_status must be
 *      byte-identical to a genuinely-missing row (same 404 body/status), so
 *      a caller cannot distinguish "exists but restricted" from "never
 *      existed" by probing response shape.
 *   4. P13 — the signed-URL-failure warn log must never carry the raw
 *      storage path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock ────────────────────────────────────────────────────────────────
let _authImpl: () => Promise<{ authorized: boolean; errorResponse?: Response }> = async () => ({
  authorized: true,
});
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authImpl(),
}));

// ── logger mock ──────────────────────────────────────────────────────────────
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => loggerWarn(...a), error: (...a: unknown[]) => loggerError(...a), debug: vi.fn() },
}));

// ── supabaseAdmin mock ───────────────────────────────────────────────────────
// `.from('rag_content_documents').select(...).eq(...).eq(...).maybeSingle()`
// for the rights lookup, and `.storage.from('learning-sources').createSignedUrl()`
// for the signed URL mint.
let _docRowResponse: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let _signedUrlResponse: { data: { signedUrl: string } | null; error: { message: string } | null } = {
  data: { signedUrl: 'https://storage.example/signed?token=abc' },
  error: null,
};
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(() => Promise.resolve(_docRowResponse));
      return chain;
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(() => Promise.resolve(_signedUrlResponse)),
      })),
    },
  },
}));

const VALID_PARAMS = {
  board: 'cbse',
  grade: '6',
  subject_code: 'math',
  sha256: '0123456789abcdef',
  filename: 'source.pdf',
};
const EXPECTED_PATH = 'cbse/6/math/0123456789abcdef/source.pdf';

function getRequest(overrides: Partial<Record<keyof typeof VALID_PARAMS, string>> = {}): Request {
  const url = new URL('http://localhost/api/learning-sources');
  const merged: Record<string, string> = { ...VALID_PARAMS, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return new Request(url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _authImpl = async () => ({ authorized: true });
  _docRowResponse = { data: null, error: null };
  _signedUrlResponse = { data: { signedUrl: 'https://storage.example/signed?token=abc' }, error: null };

  const mod = await import('@/app/api/learning-sources/route');
  GET = mod.GET;
});

describe('GET /api/learning-sources — RBAC', () => {
  it('returns the auth error response verbatim (401) when authorizeRequest denies for no session', async () => {
    _authImpl = async () => ({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }), {
        status: 401,
      }),
    });

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns the auth error response verbatim (403) when the caller lacks learning_source.view', async () => {
    _authImpl = async () => ({
      authorized: false,
      errorResponse: new Response(
        JSON.stringify({ error: 'Access denied to resource', code: 'RESOURCE_ACCESS_DENIED' }),
        { status: 403 },
      ),
    });

    const res = await GET(getRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('RESOURCE_ACCESS_DENIED');
  });

  it('never reaches the rights/storage lookup when auth denies', async () => {
    _authImpl = async () => ({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const { supabaseAdmin } = await import('@alfanumrik/lib/supabase-admin');

    await GET(getRequest());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((supabaseAdmin as any).from).not.toHaveBeenCalled();
  });
});

describe('GET /api/learning-sources — grade validation (P5: exact string match, never parseInt)', () => {
  it.each(['6/../../secret', '13', 'six', '0', '', '6.0', ' 6'])(
    'rejects grade=%j with 400',
    async (grade) => {
      const res = await GET(getRequest({ grade }));
      expect(res.status).toBe(400);
    },
  );

  it.each(['6', '7', '8', '9', '10', '11', '12'])('accepts the valid grade %s (does not 400 on grade)', async (grade) => {
    const res = await GET(getRequest({ grade }));
    // Not required to be 200 (rights lookup below may still 404), but must
    // not be rejected AS a grade-format error.
    expect(res.status).not.toBe(400);
  });
});

describe('GET /api/learning-sources — board validation (charset guard)', () => {
  it.each(['cb/se', 'cb..se', '', '../etc', 'cbse1', 'c'])('rejects board=%j with 400', async (board) => {
    const res = await GET(getRequest({ board }));
    expect(res.status).toBe(400);
  });

  it('accepts a plain alphabetic board', async () => {
    const res = await GET(getRequest({ board: 'cbse' }));
    expect(res.status).not.toBe(400);
  });
});

describe('GET /api/learning-sources — rights check and anti-enumeration', () => {
  it('returns 404 when the rag_content_documents join finds no matching row', async () => {
    _docRowResponse = { data: null, error: null };

    const res = await GET(getRequest());

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Resource not found in learning-sources bucket' });
  });

  it.each(['restricted', 'permission_pending'])(
    'returns a 404 BYTE-IDENTICAL to the missing-row case when rights_status is %s (anti-enumeration)',
    async (rightsStatus) => {
      _docRowResponse = {
        data: { rag_content_sources: { rights_status: rightsStatus } },
        error: null,
      };
      const restrictedRes = await GET(getRequest());
      const restrictedBody = await restrictedRes.json();

      _docRowResponse = { data: null, error: null };
      const missingRes = await GET(getRequest());
      const missingBody = await missingRes.json();

      expect(restrictedRes.status).toBe(missingRes.status);
      expect(restrictedRes.status).toBe(404);
      expect(restrictedBody).toEqual(missingBody);
    },
  );

  it.each(['public_domain', 'ncert_open', 'licensed'])(
    'returns 200 with a signed URL when rights_status is %s',
    async (rightsStatus) => {
      _docRowResponse = {
        data: { rag_content_sources: { rights_status: rightsStatus } },
        error: null,
      };

      const res = await GET(getRequest());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signed_url).toBe('https://storage.example/signed?token=abc');
      expect(body.expires_in_seconds).toBe(300);
      expect(body.path).toBe(EXPECTED_PATH);
    },
  );
});

describe('GET /api/learning-sources — P13: no raw storage path in the failure log', () => {
  it('the logger.warn call on signed-URL-creation failure does not include the raw storage path', async () => {
    _docRowResponse = {
      data: { rag_content_sources: { rights_status: 'public_domain' } },
      error: null,
    };
    _signedUrlResponse = { data: null, error: { message: 'some storage failure' } };

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(loggerWarn.mock.calls[0]);
    expect(loggedPayload).not.toContain(EXPECTED_PATH);
    expect(loggedPayload).not.toContain('source.pdf');
  });

  it('a "not found" signed-URL error still 404s without leaking the path', async () => {
    _docRowResponse = {
      data: { rag_content_sources: { rights_status: 'public_domain' } },
      error: null,
    };
    _signedUrlResponse = { data: null, error: { message: 'Object not found' } };

    const res = await GET(getRequest());

    expect(res.status).toBe(404);
    const loggedPayload = JSON.stringify(loggerWarn.mock.calls[0] ?? []);
    expect(loggedPayload).not.toContain(EXPECTED_PATH);
  });
});
