/**
 * Phase B.2 — email delivery on trial provisioning + invite-code creation.
 *
 * Pins:
 *   - POST /api/schools/trial → after invite-code persists, fires the
 *     send-transactional-email Edge Function exactly once with
 *     template=school-trial-provisioned.
 *   - Email-send failure does NOT fail the trial response (graceful
 *     degradation).
 *   - Idempotency: a follow-up request with the same code short-circuits
 *     via ops_events lookup; no second email send.
 *   - Hindi template selected when Accept-Language: hi.
 *   - POST /api/school-admin/invite-codes with recipient_email fires the
 *     school-invite-code-issued template.
 *   - POST /api/school-admin/invite-codes WITHOUT recipient_email does NOT
 *     fire any email (preserves legacy hand-off behaviour).
 *   - Invite codes never appear in full inside log lines (truncated form).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Logger spy ────────────────────────────────────────────────────────
const loggerSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: loggerSpy }));

// ── Rate limit: always allow ──────────────────────────────────────────
vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, resetAt: 0 }),
}));

// ── Supabase admin client mock ─────────────────────────────────────────
// We simulate per-table state and capture ops_events inserts (which the
// email-delivery helper writes for idempotency tracking).
interface MockSchool { id: string; code: string; slug: string; name: string }
const opsEventsInserts: Array<Record<string, unknown>> = [];
const opsEventsRows: Array<Record<string, unknown>> = [];

function makeAdminClient(opts: {
  existingSchool?: boolean;
  insertSchoolFails?: boolean;
  inviteInsertFails?: boolean;
} = {}) {
  const school: MockSchool = {
    id: 'school-1',
    code: 'demo-school',
    slug: 'demo-school',
    name: 'Demo School',
  };

  return {
    from(table: string) {
      if (table === 'schools') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: opts.existingSchool ? { id: 'existing' } : null,
                error: null,
              }),
              single: () => Promise.resolve({ data: school, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: () => Promise.resolve(
                opts.insertSchoolFails
                  ? { data: null, error: { message: 'insert failed' } }
                  : { data: { ...school, ...row }, error: null }
              ),
            }),
          }),
        };
      }
      if (table === 'school_subscriptions') {
        return {
          insert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === 'school_invite_codes') {
        return {
          // Dual-purpose: `await admin.from(...).insert(...)` (trial route,
          // discards the returned row) AND `await admin.from(...).insert(...)
          // .select(...).single()` (invite-codes route, reads back the row).
          // The returned object is both thenable AND chainable.
          insert: (row: Record<string, unknown>) => {
            const error = opts.inviteInsertFails
              ? { message: 'invite insert failed' }
              : null;
            const insertedRow = opts.inviteInsertFails
              ? null
              : {
                  id: 'invite-1',
                  code: (row.code as string | undefined) ?? 'TEST-CODE',
                  role: row.role,
                  max_uses: row.max_uses,
                  used_count: 0,
                  expires_at: row.expires_at,
                  is_active: true,
                  created_at: new Date().toISOString(),
                };
            return {
              select: () => ({
                single: () => Promise.resolve({ data: insertedRow, error }),
              }),
              // Thenable so plain `await admin.from(...).insert(...)` works.
              // The trial route only reads `error`, so we don't surface `data`.
              then(
                onfulfilled: (v: { error: unknown }) => unknown,
                onrejected?: (reason: unknown) => unknown,
              ) {
                return Promise.resolve({ error }).then(onfulfilled, onrejected);
              },
            };
          },
        };
      }
      if (table === 'ops_events') {
        return {
          select: () => ({
            eq: function chainEq() { return this; },
            limit: () => Promise.resolve({
              data: opsEventsRows.slice(),
              error: null,
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            opsEventsInserts.push(row);
            // Mirror inserts back into the "already-sent" lookup table so
            // idempotency works inside a single test run.
            opsEventsRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      // Default no-op chain so unexpected tables don't crash
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }), single: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ error: null }),
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdminPlaceholder>;
}

// Placeholder type alias — actual return type doesn't matter for the test
// because we cast the mock in our `from()` shim.
function getSupabaseAdminPlaceholder() { return null as never; }

const adminClientRef = { current: makeAdminClient() };
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClientRef.current,
}));

// ── school-admin auth (for the invite-codes route) ────────────────────
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn().mockResolvedValue({
    authorized: true,
    schoolId: 'school-1',
    schoolAdminId: 'admin-1',
    userId: 'user-1',
  }),
}));

vi.mock('@/lib/audit', () => ({
  logSchoolAudit: vi.fn(),
}));

// ── Fetch spy (the email-delivery helper invokes the Edge Function) ──
const fetchSpy = vi.fn();

// ── Env vars required by the email-delivery helper ───────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  global.fetch = fetchSpy as unknown as typeof fetch;
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ sent: true, id: 'mg-id-1' }), { status: 200 })
  );
  opsEventsInserts.length = 0;
  opsEventsRows.length = 0;
  adminClientRef.current = makeAdminClient();
  Object.values(loggerSpy).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  vi.clearAllMocks();
});

function trialRequest(overrides: Record<string, unknown> = {}, headers: HeadersInit = {}): NextRequest {
  return new NextRequest('http://localhost/api/schools/trial', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      school_name: 'Demo School',
      principal_name: 'Pradeep Sharma',
      principal_email: 'principal@demo.edu',
      board: 'CBSE',
      city: 'Delhi',
      state: 'DL',
      phone: '+91...',
      ...overrides,
    }),
  });
}

function inviteRequest(body: Record<string, unknown>, headers: HeadersInit = {}): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/invite-codes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Wait for fire-and-forget dispatch to settle (deliverEmail is voided). */
async function flushAsync() {
  // Yield to the microtask + macrotask queues so the floating Promise inside
  // `void deliverEmail(...)` runs before we assert on fetchSpy.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ──────────────────────────────────────────────────────────────────────
// /api/schools/trial
// ──────────────────────────────────────────────────────────────────────

describe('POST /api/schools/trial — email delivery', () => {
  it('invokes send-transactional-email exactly once when the invite code persists', async () => {
    const { POST } = await import('@/app/api/schools/trial/route');
    const res = await POST(trialRequest());
    await flushAsync();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const edgeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/send-transactional-email')
    );
    expect(edgeCalls.length).toBe(1);

    const [, init] = edgeCalls[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    const payload = JSON.parse(init.body as string);
    expect(payload.template).toBe('school-trial-provisioned');
    expect(payload.to).toBe('principal@demo.edu');
    expect(payload.locale).toBe('en');
    expect(payload.params.school_name).toBe('Demo School');
    expect(payload.params.invite_code).toMatch(/^[A-Z0-9]{8}$/);
    expect(payload.params.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.params.subdomain_url).toMatch(/\.alfanumrik\.com$/);
  });

  it('returns 200 even when the email Edge Function returns an error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ sent: false, error: 'mailgun_error' }), { status: 200 })
    );
    const { POST } = await import('@/app/api/schools/trial/route');
    const res = await POST(trialRequest());
    await flushAsync();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Trial-create response carries the invite code so the operator can hand
    // it off manually if the email failed.
    expect(body.data.invite_code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('returns 200 even when the Edge Function fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network'));
    const { POST } = await import('@/app/api/schools/trial/route');
    const res = await POST(trialRequest());
    await flushAsync();

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('idempotency: a duplicate code does NOT trigger a second email', async () => {
    const { POST } = await import('@/app/api/schools/trial/route');

    // First call — succeeds and records the send.
    await POST(trialRequest());
    await flushAsync();
    expect(fetchSpy.mock.calls.length).toBe(1);

    // Pre-seed the next trial to reuse the same invite code by overriding
    // Math.random to produce a deterministic-ish code; but the simpler way
    // is to assert through the helper directly.
    const { deliverEmail } = await import('@/lib/email-delivery');
    const reusedCode = (JSON.parse(fetchSpy.mock.calls[0][1].body as string)).params.invite_code;

    fetchSpy.mockClear();
    const result = await deliverEmail({
      template: 'school-trial-provisioned',
      to: 'principal@demo.edu',
      params: {
        school_name: 'Demo School',
        invite_code: reusedCode,
        expires_at: new Date().toISOString(),
      },
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe('already_sent');
    // CRITICAL: no second outbound fetch to Mailgun-via-Edge.
    expect(fetchSpy.mock.calls.length).toBe(0);
  });

  it('selects the Hindi locale when Accept-Language header is "hi"', async () => {
    const { POST } = await import('@/app/api/schools/trial/route');
    await POST(trialRequest({}, { 'accept-language': 'hi,en;q=0.9' }));
    await flushAsync();

    const edgeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/send-transactional-email')
    );
    expect(edgeCalls.length).toBe(1);
    const payload = JSON.parse(edgeCalls[0][1].body as string);
    expect(payload.locale).toBe('hi');
  });

  it('never logs the full invite code at INFO', async () => {
    const { POST } = await import('@/app/api/schools/trial/route');
    await POST(trialRequest());
    await flushAsync();

    const allInfoLogs = loggerSpy.info.mock.calls.flat();
    for (const arg of allInfoLogs) {
      if (typeof arg === 'string') continue;
      const stringified = JSON.stringify(arg ?? {});
      // The 8-char trial code shape — ensure no log line contains a raw
      // 8-character alphanumeric matching the generator alphabet.
      const matches = stringified.match(/"invite[Cc]ode"\s*:\s*"([A-Z0-9]{8})"/);
      expect(matches, `INFO log contained full invite code: ${stringified}`).toBeNull();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// /api/school-admin/invite-codes
// ──────────────────────────────────────────────────────────────────────

describe('POST /api/school-admin/invite-codes — email delivery', () => {
  it('sends invite email when recipient_email is provided', async () => {
    const { POST } = await import('@/app/api/school-admin/invite-codes/route');
    const res = await POST(inviteRequest({
      role: 'teacher',
      recipient_email: 'teacher@demo.edu',
      recipient_name: 'Anita',
    }));
    await flushAsync();

    expect(res.status).toBe(201);
    const edgeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/send-transactional-email')
    );
    expect(edgeCalls.length).toBe(1);
    const payload = JSON.parse(edgeCalls[0][1].body as string);
    expect(payload.template).toBe('school-invite-code-issued');
    expect(payload.to).toBe('teacher@demo.edu');
    expect(payload.params.recipient_name).toBe('Anita');
    expect(payload.params.school_name).toBeTruthy();
  });

  it('does NOT send email when recipient_email is omitted (legacy hand-off)', async () => {
    const { POST } = await import('@/app/api/school-admin/invite-codes/route');
    const res = await POST(inviteRequest({ role: 'student' }));
    await flushAsync();

    expect(res.status).toBe(201);
    const edgeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/send-transactional-email')
    );
    expect(edgeCalls.length).toBe(0);
  });

  it('rejects malformed recipient_email with 400 and does not send email', async () => {
    const { POST } = await import('@/app/api/school-admin/invite-codes/route');
    const res = await POST(inviteRequest({
      role: 'teacher',
      recipient_email: 'not-an-email',
    }));

    expect(res.status).toBe(400);
    await flushAsync();
    const edgeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/functions/v1/send-transactional-email')
    );
    expect(edgeCalls.length).toBe(0);
  });
});
