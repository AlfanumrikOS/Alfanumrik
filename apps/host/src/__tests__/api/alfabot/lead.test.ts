/**
 * /api/alfabot/lead — POST handler tests.
 *
 * Pins the contract:
 *   - feature flag off → 404
 *   - missing consent → 400
 *   - school audience without school_name → 400
 *   - successful flow inserts 1 row, fires webhook, stamps webhook_delivered_at
 *   - audit_logs.details contains NO email / phone / name
 *
 * P13: lead PII must never appear in audit metadata.
 *
 * Owner: backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.ALFABOT_IP_SALT = 'test-salt';
  process.env.ALFABOT_LEAD_CAPTURE_WEBHOOK_URL = 'http://webhook.test/hook';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ─── Mocks ──────────────────────────────────────────────────────────────────

let _mockedAnonCookie: string | null = null;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'alf_anon_id' && _mockedAnonCookie
        ? { name, value: _mockedAnonCookie }
        : undefined,
    set: vi.fn(),
  }),
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
    debug: vi.fn(),
  },
}));

const _logAudit = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  logAudit: (...args: unknown[]) => _logAudit(...args),
}));

// In-memory state for the supabase mock.
const state = {
  sessions: new Map<
    string,
    { id: string; anon_id: string; audience: string }
  >(),
  insertedLeads: [] as Array<Record<string, unknown>>,
  webhookStampUpdates: [] as Array<{ id: string; ts: string }>,
  nextLeadId: 'lead-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};

function resetState() {
  state.sessions.clear();
  state.insertedLeads.length = 0;
  state.webhookStampUpdates.length = 0;
  state.nextLeadId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
}

function makeChain(table: string): Record<string, unknown> {
  const ctx: { filters: Array<{ col: string; val: unknown }>; updateVals?: Record<string, unknown> } = {
    filters: [],
  };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    ctx.filters.push({ col, val });
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.update = (vals: Record<string, unknown>) => {
    ctx.updateVals = vals;
    return chain;
  };
  chain.insert = (row: Record<string, unknown>) => {
    if (table === 'alfabot_leads') {
      state.insertedLeads.push(row);
    }
    return {
      select: () => ({
        single: async () => {
          if (table === 'alfabot_leads') {
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
    // When this is an update chain on alfabot_leads, stamp webhook_delivered_at.
    if (
      table === 'alfabot_leads' &&
      ctx.updateVals &&
      typeof ctx.updateVals.webhook_delivered_at === 'string'
    ) {
      const idFilter = ctx.filters.find((f) => f.col === 'id');
      if (idFilter) {
        state.webhookStampUpdates.push({
          id: idFilter.val as string,
          ts: ctx.updateVals.webhook_delivered_at as string,
        });
      }
    }
    if (table === 'alfabot_sessions') {
      const idFilter = ctx.filters.find((f) => f.col === 'id');
      if (idFilter) {
        const s = state.sessions.get(idFilter.val as string);
        return { data: s ?? null, error: null };
      }
    }
    return { data: null, error: null };
  };
  chain.maybeSingle = async () => terminal();
  chain.single = async () => terminal();
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
  ) => Promise.resolve(terminal()).then(resolve);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
  },
}));

// ─── fetch mock (webhook) ───────────────────────────────────────────────────
const _webhookFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', _webhookFetch);
  _webhookFetch.mockResolvedValue(new Response('ok', { status: 200 }));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(opts: {
  body: Record<string, unknown>;
  anonCookie?: string | null;
}): NextRequest {
  _mockedAnonCookie = opts.anonCookie ?? null;
  const req = new NextRequest('http://localhost/api/alfabot/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body),
  });
  return req;
}

const VALID_SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  // Default: lead capture flag ON.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ff_alfabot_lead_capture_v1') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  // Pre-seed a session belonging to the test anon.
  state.sessions.set(VALID_SESSION_ID, {
    id: VALID_SESSION_ID,
    anon_id: 'anon-lead-test',
    audience: 'parent',
  });
  // Reset shared in-memory rate limit state from the route module.
  const mod = await import('@/app/api/alfabot/route');
  mod._testing.resetMemoryStore();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('/api/alfabot/lead POST', () => {
  it('returns 404 when ff_alfabot_lead_capture_v1 is disabled', async () => {
    _isFeatureEnabled.mockImplementation(() => Promise.resolve(false));
    const { POST } = await import('@/app/api/alfabot/lead/route');
    const res = await POST(
      makeRequest({
        body: {
          sessionId: VALID_SESSION_ID,
          email: 'parent@example.com',
          consent: true,
          consentText: 'I agree to DPDPA terms.',
        },
        anonCookie: 'anon-lead-test',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when consent is missing', async () => {
    const { POST } = await import('@/app/api/alfabot/lead/route');
    const res = await POST(
      makeRequest({
        body: {
          sessionId: VALID_SESSION_ID,
          email: 'parent@example.com',
          // consent intentionally absent
          consentText: 'I agree.',
        },
        anonCookie: 'anon-lead-test',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_input');
    expect(body.detail).toBe('consent_required');
  });

  it("returns 400 when school audience but school_name is missing", async () => {
    state.sessions.set(VALID_SESSION_ID, {
      id: VALID_SESSION_ID,
      anon_id: 'anon-lead-test',
      audience: 'school',
    });
    const { POST } = await import('@/app/api/alfabot/lead/route');
    const res = await POST(
      makeRequest({
        body: {
          sessionId: VALID_SESSION_ID,
          email: 'principal@school.edu',
          consent: true,
          consentText: 'I agree.',
          // school_name absent
        },
        anonCookie: 'anon-lead-test',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.detail).toBe('school_name_required');
  });

  it('happy path: writes 1 lead row, fires webhook, stamps webhook_delivered_at', async () => {
    const { POST } = await import('@/app/api/alfabot/lead/route');
    const res = await POST(
      makeRequest({
        body: {
          sessionId: VALID_SESSION_ID,
          email: 'parent@example.com',
          phone: '+91-9876543210',
          name: 'Parent Name',
          consent: true,
          consentText: 'I consent to be contacted under DPDPA.',
        },
        anonCookie: 'anon-lead-test',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.leadId).toBe('string');

    expect(state.insertedLeads).toHaveLength(1);
    expect(state.insertedLeads[0].email).toBe('parent@example.com');
    expect(state.insertedLeads[0].phone).toBe('+91-9876543210');
    expect(state.insertedLeads[0].audience).toBe('parent');
    expect(state.insertedLeads[0].consent_at).toBeTruthy();

    // Webhook was called.
    expect(_webhookFetch).toHaveBeenCalled();
    const webhookCall = _webhookFetch.mock.calls[0];
    expect(webhookCall[0]).toBe('http://webhook.test/hook');
    // P13: webhook payload contains NO email / phone / name.
    const webhookBody = JSON.parse(webhookCall[1].body as string);
    expect(JSON.stringify(webhookBody)).not.toContain('parent@example.com');
    expect(JSON.stringify(webhookBody)).not.toContain('9876543210');
    expect(JSON.stringify(webhookBody)).not.toContain('Parent Name');

    // webhook_delivered_at was stamped.
    expect(state.webhookStampUpdates).toHaveLength(1);
    expect(state.webhookStampUpdates[0].id).toBe(state.nextLeadId);
  });

  it('audit log contains no email or phone (P13)', async () => {
    const { POST } = await import('@/app/api/alfabot/lead/route');
    await POST(
      makeRequest({
        body: {
          sessionId: VALID_SESSION_ID,
          email: 'parent@example.com',
          phone: '+91-9876543210',
          name: 'Sensitive Name',
          consent: true,
          consentText: 'I agree to DPDPA terms.',
        },
        anonCookie: 'anon-lead-test',
      }),
    );
    const captureLog = _logAudit.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).action === 'alfabot.lead_captured',
    );
    expect(captureLog).toBeTruthy();
    const details = (captureLog![1] as { details: Record<string, unknown> }).details;
    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain('parent@example.com');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('Sensitive Name');
    // But it MUST carry the non-PII metadata.
    expect(details.anonId).toBe('anon-lead-test');
    expect(details.sessionId).toBe(VALID_SESSION_ID);
    expect(details.audience).toBe('parent');
  });
});
