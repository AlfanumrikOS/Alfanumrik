/**
 * /api/alfabot/inquiry — POST handler tests.
 *
 * Pins the contract for the Submit-your-query path:
 *   - valid body → 200 + { ok: true, messageId }
 *   - missing email / invalid email → 400
 *   - question too short / too long → 400
 *   - missing anon-id cookie → minted automatically
 *   - 4th inquiry in 24h → 429 (shared lead bucket)
 *   - denylist hit → 403
 *   - Edge Function failure → 502 with { error: 'mail_send_failed' }
 *   - audit log contains anonId + sessionId + audience='inquiry' + messageId
 *     but NOT email / name / question content (P13)
 *   - alfabot_leads row written with role_or_designation='inquiry'
 *
 * Owner: backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Env stubs ──────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.ALFABOT_IP_SALT = 'test-salt';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ─── next/headers mock ──────────────────────────────────────────────────────
let _mockedAnonCookie: string | null = null;
const _cookieSetMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'alf_anon_id' && _mockedAnonCookie
        ? { name, value: _mockedAnonCookie }
        : undefined,
    set: (...args: unknown[]) => _cookieSetMock(...args),
  }),
}));

// ─── logger / rbac / feature-flags mocks ───────────────────────────────────
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
    debug: vi.fn(),
  },
}));

const _logAudit = vi.fn();
vi.mock('@/lib/rbac', () => ({
  logAudit: (...args: unknown[]) => _logAudit(...args),
}));

// feature-flags isn't called by the inquiry route, but other modules in
// `@/app/api/alfabot/route` may probe it during module load. Stub it safely.
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

// ─── supabaseAdmin mock ─────────────────────────────────────────────────────
//
// We model two tables:
//   - alfabot_denylist  : returns null by default (no denials). Tests can
//                         flip `denylistAnonIds` to add a deny entry.
//   - alfabot_leads     : capture insert rows in `state.insertedLeads`;
//                         single() returns a generated id.

const state = {
  denylistAnonIds: new Set<string>(),
  insertedLeads: [] as Array<Record<string, unknown>>,
  nextLeadId: 'lead-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  // Allow tests to force a lead insert failure (path resilience).
  leadInsertShouldFail: false,
};

function resetState() {
  state.denylistAnonIds.clear();
  state.insertedLeads.length = 0;
  state.nextLeadId = 'lead-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  state.leadInsertShouldFail = false;
}

function makeChain(table: string): Record<string, unknown> {
  const ctx: { filters: Array<{ col: string; val: unknown }> } = { filters: [] };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    ctx.filters.push({ col, val });
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.insert = (row: Record<string, unknown>) => {
    if (table === 'alfabot_leads') {
      state.insertedLeads.push(row);
    }
    return {
      select: () => ({
        single: async () => {
          if (table === 'alfabot_leads') {
            if (state.leadInsertShouldFail) {
              return { data: null, error: { message: 'simulated_db_failure' } };
            }
            return { data: { id: state.nextLeadId }, error: null };
          }
          return { data: null, error: null };
        },
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
  };

  const terminal = (): { data: unknown; error: unknown } => {
    if (table === 'alfabot_denylist') {
      const idFilter = ctx.filters.find((f) => f.col === 'anon_id');
      if (idFilter && state.denylistAnonIds.has(idFilter.val as string)) {
        return { data: { anon_id: idFilter.val }, error: null };
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  chain.maybeSingle = async () => terminal();
  chain.single = async () => terminal();
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(terminal()).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
  },
}));

// ─── fetch mock (Edge Function) ────────────────────────────────────────────
//
// We use `mockImplementation` (not `mockResolvedValue`) because Response
// bodies can only be read once — each call needs a fresh Response instance.
const _edgeFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', _edgeFetch);
  // Default: Edge Function returns success. Fresh Response per call.
  _edgeFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, messageId: 'mailgun-message-id-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(opts: {
  body: Record<string, unknown> | string;
  anonCookie?: string | null;
}): NextRequest {
  _mockedAnonCookie = opts.anonCookie ?? null;
  const body =
    typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  return new NextRequest('http://localhost/api/alfabot/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

const VALID_BODY = {
  name: 'Asha Sharma',
  email: 'asha@example.com',
  question: 'Hi! I have a question about the Pro plan and how Foxy handles physics.',
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  // Reset the chat route's in-memory rate limit state (shared lead bucket).
  const chatMod = await import('@/app/api/alfabot/route');
  chatMod._testing.resetMemoryStore();
  // Reset the inquiry route's denylist cache.
  const inquiryMod = await import('@/app/api/alfabot/inquiry/route');
  inquiryMod._testing.resetDenylistCache();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('/api/alfabot/inquiry POST', () => {
  it('happy path: valid body → 200 + { ok: true, messageId }', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({ body: VALID_BODY, anonCookie: 'anon-inq-test' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.messageId).toBe('mailgun-message-id-123');

    // Edge Function was called with the right URL + auth.
    expect(_edgeFetch).toHaveBeenCalledOnce();
    const call = _edgeFetch.mock.calls[0];
    expect(call[0]).toBe('http://test.local/functions/v1/alfabot-send-inquiry');
    expect((call[1] as RequestInit).method).toBe('POST');
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-service-key');
    const sentBody = JSON.parse(String((call[1] as RequestInit).body));
    expect(sentBody.email).toBe('asha@example.com');
    expect(sentBody.name).toBe('Asha Sharma');
    expect(sentBody.anonId).toBe('anon-inq-test');
  });

  it('returns 400 when email is missing', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({
        body: { name: 'X', question: 'A valid question with enough text.' },
        anonCookie: 'anon-inq-test',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_input');
    expect(body.detail).toBe('email_required');
  });

  it('returns 400 when email format is invalid', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({
        body: { ...VALID_BODY, email: 'not-an-email' },
        anonCookie: 'anon-inq-test',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.detail).toBe('email_invalid');
  });

  it('returns 400 when question is too short (< 10 chars)', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({
        body: { ...VALID_BODY, question: 'short' },
        anonCookie: 'anon-inq-test',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.detail).toBe('question_too_short');
  });

  it('returns 400 when question is too long (> 2000 chars)', async () => {
    const longQuestion = 'a'.repeat(2001);
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({
        body: { ...VALID_BODY, question: longQuestion },
        anonCookie: 'anon-inq-test',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.detail).toBe('question_too_long');
  });

  it('mints an anon-id cookie when none is provided', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(makeRequest({ body: VALID_BODY, anonCookie: null }));
    expect(res.status).toBe(200);
    // The route sets the cookie on the NextResponse — we can read it back.
    const setCookieHeader = res.cookies.get('alf_anon_id');
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader?.value).toBeTruthy();
    // It must be a UUID-shaped string.
    expect(setCookieHeader?.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('returns 429 on the 4th inquiry from the same anon in 24h', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    // 3 successful inquiries (the daily bucket limit).
    for (let i = 0; i < 3; i++) {
      const res = await POST(
        makeRequest({ body: VALID_BODY, anonCookie: 'anon-rl-test' }),
      );
      expect(res.status).toBe(200);
    }
    // 4th must hit the bucket.
    const res = await POST(
      makeRequest({ body: VALID_BODY, anonCookie: 'anon-rl-test' }),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('inquiry_day');
  });

  it('returns 403 when the anon-id is denylisted', async () => {
    state.denylistAnonIds.add('anon-banned');
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({ body: VALID_BODY, anonCookie: 'anon-banned' }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('denied');
  });

  it('returns 502 with { error: mail_send_failed } when the Edge Function fails', async () => {
    _edgeFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'mailgun_500' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({ body: VALID_BODY, anonCookie: 'anon-mail-fail' }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('mail_send_failed');
  });

  it('audit log contains metadata but NOT email / name / question content (P13)', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    await POST(makeRequest({ body: VALID_BODY, anonCookie: 'anon-audit-test' }));
    const submitLog = _logAudit.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>).action === 'alfabot.inquiry_submitted',
    );
    expect(submitLog).toBeTruthy();
    const details = (submitLog![1] as { details: Record<string, unknown> }).details;
    expect(details.anonId).toBe('anon-audit-test');
    expect(details.sessionId).toBeNull();
    expect(details.audience).toBe('inquiry');
    expect(details.mailgunMessageId).toBe('mailgun-message-id-123');
    // PII MUST NOT be present anywhere in the audit row.
    const serialized = JSON.stringify(submitLog);
    expect(serialized).not.toContain('asha@example.com');
    expect(serialized).not.toContain('Asha Sharma');
    expect(serialized).not.toContain('Pro plan and how Foxy');
  });

  it('writes a lead row with audience=inquiry and role_or_designation=inquiry', async () => {
    const { POST } = await import('@/app/api/alfabot/inquiry/route');
    const res = await POST(
      makeRequest({ body: VALID_BODY, anonCookie: 'anon-lead-row-test' }),
    );
    expect(res.status).toBe(200);
    expect(state.insertedLeads).toHaveLength(1);
    const row = state.insertedLeads[0];
    expect(row.audience).toBe('inquiry');
    expect(row.role_or_designation).toBe('inquiry');
    expect(row.email).toBe('asha@example.com');
    expect(row.name).toBe('Asha Sharma');
    expect(row.session_id).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.school_name).toBeNull();
    expect(typeof row.consent_at).toBe('string');
    expect(row.consent_text).toBe(
      'Submitted via AlfaBot Send Query form on /welcome.',
    );
  });
});
