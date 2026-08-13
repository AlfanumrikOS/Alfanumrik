/**
 * /api/whatsapp/webhook — POST handler tests (Twilio inbound, Phase 1).
 *
 * Pins the route contract from the WhatsApp bot plan
 * (plan-alfanumrik-whatsapp-bot-mighty-frost.md):
 *   - missing server env (TWILIO_AUTH_TOKEN / WHATSAPP_WEBHOOK_PUBLIC_URL /
 *     WHATSAPP_PHONE_PEPPER) → 503, no DB I/O
 *   - missing/invalid X-Twilio-Signature → 401, no body/phone leakage, no DB I/O
 *   - ALWAYS-200 AFTER VERIFICATION: once the signature verifies, every
 *     downstream failure (DB error, thrown exception) still returns empty
 *     TwiML 200 — WABA quality-rating protection, deliberate divergence from
 *     the Razorpay webhook posture
 *   - ff_whatsapp_inbound_webhook OFF → silent drop, zero DB writes
 *   - STOP/START/HELP regulatory short-circuit works with ff_whatsapp_bot_v1
 *     OFF; START never resurrects opt_in_status='blocked'
 *   - dedupe upsert on provider_message_id (second delivery → 200, single row)
 *   - window-ledger touch: service 24h / free_entry 72h (ReferralSourceId),
 *     only-extend semantics, IST day-counter reset, last_inbound_at advance
 *   - P13: no raw phone / no MediaUrl / no profile_name in the persisted event row
 *
 * House pattern: supabaseAdmin mocked via lazy Proxy (see
 * payments/webhook-route-integration.test.ts), feature flags + logger mocked
 * at module boundary, signatures constructed with node:crypto.
 *
 * Owner: testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

// ─── Module-boundary mocks ──────────────────────────────────────────────────

let mockAdminImpl: any;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: new Proxy({} as any, {
    get(_target, prop) {
      if (!mockAdminImpl) return undefined;
      const value = mockAdminImpl[prop];
      return typeof value === 'function' ? value.bind(mockAdminImpl) : value;
    },
  }),
}));

const flagValues: Record<string, boolean> = {};
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (name: string) => flagValues[name] ?? false),
}));

const loggerCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'error', msg, meta }),
    debug: vi.fn(),
  },
}));

import { POST, GET } from '@/app/api/whatsapp/webhook/route';
import { hashPhone } from '@alfanumrik/lib/whatsapp/phone';

// ─── Test constants ─────────────────────────────────────────────────────────

const AUTH_TOKEN = 'twilio_auth_token_for_tests';
const PUBLIC_URL = 'https://alfanumrik.com/api/whatsapp/webhook';
const PEPPER = 'test-phone-pepper';
const PHONE = '+919876543210';
const PHONE_HASH = hashPhone(PHONE, PEPPER);
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twilioSign(url: string, params: Record<string, string>, token: string): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

function baseParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MessageSid: 'SM_evt_001',
    From: `whatsapp:${PHONE}`,
    To: 'whatsapp:+911234567890',
    Body: 'what is photosynthesis',
    NumMedia: '0',
    WaId: '919876543210',
    ...overrides,
  };
}

function makeRequest(
  params: Record<string, string>,
  opts: { signature?: string | null; search?: string } = {},
): NextRequest {
  const body = new URLSearchParams(params).toString();
  const search = opts.search ?? '';
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  const signature =
    opts.signature === undefined
      ? twilioSign(PUBLIC_URL + search, params, AUTH_TOKEN)
      : opts.signature;
  if (signature !== null) headers['x-twilio-signature'] = signature;
  return new NextRequest(`http://localhost/api/whatsapp/webhook${search}`, {
    method: 'POST',
    headers,
    body,
  });
}

// ─── supabaseAdmin table-state mock ─────────────────────────────────────────

type FilterCall = [string, ...unknown[]];

const dbState = {
  fromCalls: [] as string[],
  identityRows: [{ id: 'ident-1' }, { id: 'ident-2' }] as Array<{ id: string }>,
  identityUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
  consentInserts: [] as Array<Record<string, unknown>>,
  inboundUpserts: [] as Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>,
  inboundUpsertResult: () => ({ data: [{ id: 'evt-row-1' }], error: null as unknown }),
  inboundUpsertThrows: false,
  inboundStatusUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
  seenUpserts: [] as Array<Record<string, unknown>>,
  // touchConversationWindow now delegates to the whatsapp_touch_window RPC
  // (migration 20260815000005 — atomic INSERT ... ON CONFLICT, replacing the
  // prior unlocked read-then-write pair). The route's own responsibility is
  // just "call the RPC with the right args, log+continue on error" — the
  // extend-only / day-rollover business rules now live server-side in the
  // RPC and are that migration's own verification surface, not this file's.
  windowRpcCalls: [] as Array<{ p_phone_hash: unknown; p_identity_id: unknown; p_window_kind: unknown }>,
  windowRpcError: null as { message: string } | null,
};

function resetDbState() {
  dbState.fromCalls.length = 0;
  dbState.identityRows = [{ id: 'ident-1' }, { id: 'ident-2' }];
  dbState.identityUpdates.length = 0;
  dbState.consentInserts.length = 0;
  dbState.inboundUpserts.length = 0;
  dbState.inboundUpsertResult = () => ({ data: [{ id: 'evt-row-1' }], error: null });
  dbState.inboundUpsertThrows = false;
  dbState.inboundStatusUpdates.length = 0;
  dbState.seenUpserts.length = 0;
  dbState.windowRpcCalls.length = 0;
  dbState.windowRpcError = null;
}

function filterChain(
  rec: { filters: FilterCall[] },
  result: { error: unknown } = { error: null },
) {
  const c: any = {
    eq: (...a: unknown[]) => { rec.filters.push(['eq', ...a]); return c; },
    is: (...a: unknown[]) => { rec.filters.push(['is', ...a]); return c; },
    neq: (...a: unknown[]) => { rec.filters.push(['neq', ...a]); return c; },
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return c;
}

function buildMockAdmin() {
  return {
    from(table: string) {
      dbState.fromCalls.push(table);
      switch (table) {
        case 'whatsapp_identities':
          return {
            update: (update: Record<string, unknown>) => {
              const rec = { update, filters: [] as FilterCall[] };
              dbState.identityUpdates.push(rec);
              return filterChain(rec);
            },
            select: () => {
              const c: any = {
                eq: () => c,
                is: () => c,
                then: (res: any, rej: any) =>
                  Promise.resolve({ data: dbState.identityRows, error: null }).then(res, rej),
              };
              return c;
            },
          };
        case 'whatsapp_consent_events':
          return {
            insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
              dbState.consentInserts.push(...(Array.isArray(rows) ? rows : [rows]));
              return Promise.resolve({ error: null });
            },
          };
        case 'whatsapp_inbound_events':
          return {
            upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
              if (dbState.inboundUpsertThrows) throw new Error('simulated upsert crash');
              dbState.inboundUpserts.push({ row, opts });
              return { select: () => Promise.resolve(dbState.inboundUpsertResult()) };
            },
            update: (update: Record<string, unknown>) => {
              const rec = { update, filters: [] as FilterCall[] };
              dbState.inboundStatusUpdates.push(rec);
              return filterChain(rec);
            },
          };
        case 'whatsapp_seen_message_ids':
          return {
            upsert: (row: Record<string, unknown>) => {
              dbState.seenUpserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        default:
          throw new Error(`unexpected from(${table})`);
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'whatsapp_touch_window') {
        dbState.windowRpcCalls.push(args as any);
        return Promise.resolve(
          dbState.windowRpcError
            ? { data: null, error: dbState.windowRpcError }
            : { data: [{}], error: null },
        );
      }
      throw new Error(`unexpected rpc(${name})`);
    },
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.WHATSAPP_WEBHOOK_PUBLIC_URL = PUBLIC_URL;
  process.env.WHATSAPP_PHONE_PEPPER = PEPPER;
  resetDbState();
  loggerCalls.length = 0;
  mockAdminImpl = buildMockAdmin();
  // Default: inbound webhook live, bot kill switch OFF (Phase 1 posture).
  for (const k of Object.keys(flagValues)) delete flagValues[k];
  flagValues.ff_whatsapp_inbound_webhook = true;
  flagValues.ff_whatsapp_bot_v1 = false;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET — healthcheck', () => {
  it('returns 200 plain-text ok (no hub.challenge — Twilio has no handshake)', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('POST — pre-verification posture (mirrors Razorpay)', () => {
  it('returns 503 when TWILIO_AUTH_TOKEN is missing, with no DB I/O', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(503);
    expect(dbState.fromCalls).toEqual([]);
  });

  it('returns 503 when WHATSAPP_WEBHOOK_PUBLIC_URL is missing', async () => {
    delete process.env.WHATSAPP_WEBHOOK_PUBLIC_URL;
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(503);
    expect(dbState.fromCalls).toEqual([]);
  });

  it('returns 503 when WHATSAPP_PHONE_PEPPER is missing', async () => {
    delete process.env.WHATSAPP_PHONE_PEPPER;
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(503);
    expect(dbState.fromCalls).toEqual([]);
  });

  it('returns 401 when the signature header is absent, with no DB I/O', async () => {
    const res = await POST(makeRequest(baseParams(), { signature: null }));
    expect(res.status).toBe(401);
    expect(dbState.fromCalls).toEqual([]);
  });

  it('returns 401 on a tampered signature with no leakage of params or phone', async () => {
    const params = baseParams();
    const badSig = twilioSign(PUBLIC_URL, { ...params, Body: 'tampered' }, AUTH_TOKEN);
    const res = await POST(makeRequest(params, { signature: badSig }));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('photosynthesis');
    expect(JSON.parse(text)).toEqual({ error: 'Invalid signature' });
    // P13: nothing identifying in the log line either.
    const warnLine = loggerCalls.find((l) => l.level === 'warn');
    expect(JSON.stringify(warnLine ?? {})).not.toContain('9876543210');
    expect(dbState.fromCalls).toEqual([]);
  });

  it('returns 401 when signed with a different auth token', async () => {
    const params = baseParams();
    const res = await POST(
      makeRequest(params, { signature: twilioSign(PUBLIC_URL, params, 'wrong_token') }),
    );
    expect(res.status).toBe(401);
  });

  it('incorporates the incoming query string into the verified URL', async () => {
    // Signature over PUBLIC_URL + '?src=qr' validates when the request carries
    // the same query string…
    const params = baseParams();
    const res = await POST(makeRequest(params, { search: '?src=qr' }));
    expect(res.status).toBe(200);
    // …and a bare-URL signature fails against a query-string request.
    const bareSig = twilioSign(PUBLIC_URL, params, AUTH_TOKEN);
    const res2 = await POST(makeRequest(params, { search: '?src=qr', signature: bareSig }));
    expect(res2.status).toBe(401);
  });
});

describe('POST — ff_whatsapp_inbound_webhook drop-gate', () => {
  it('flag OFF → 200 empty TwiML and ZERO DB access (even for STOP)', async () => {
    flagValues.ff_whatsapp_inbound_webhook = false;
    const res = await POST(makeRequest(baseParams({ Body: 'STOP' })));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    expect(dbState.fromCalls).toEqual([]);
  });
});

describe('POST — STOP/START/HELP regulatory short-circuit (works with bot flag OFF)', () => {
  it('STOP updates all live identities to opted_out and appends consent events', async () => {
    const res = await POST(makeRequest(baseParams({ Body: 'STOP' })));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(res.headers.get('content-type')).toContain('text/xml');
    expect(xml).toContain('<Message>');
    expect(xml).toContain('START'); // resume instruction present

    expect(dbState.identityUpdates).toHaveLength(1);
    const upd = dbState.identityUpdates[0];
    expect(upd.update.opt_in_status).toBe('opted_out');
    expect(typeof upd.update.opted_out_at).toBe('string');
    expect(upd.filters).toContainEqual(['eq', 'phone_hash', PHONE_HASH]);
    expect(upd.filters).toContainEqual(['is', 'revoked_at', null]);

    // One consent row per live identity, exact event/source shape.
    expect(dbState.consentInserts).toEqual([
      { identity_id: 'ident-1', event: 'stop_keyword', source: 'whatsapp_keyword' },
      { identity_id: 'ident-2', event: 'stop_keyword', source: 'whatsapp_keyword' },
    ]);
  });

  it('Hindi alias BAND behaves exactly like STOP', async () => {
    const res = await POST(makeRequest(baseParams({ Body: 'band' })));
    expect(res.status).toBe(200);
    expect(dbState.identityUpdates[0]?.update.opt_in_status).toBe('opted_out');
  });

  it('START opts back in but NEVER resurrects a blocked identity (neq guard)', async () => {
    const res = await POST(makeRequest(baseParams({ Body: 'START' })));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<Message>');

    expect(dbState.identityUpdates).toHaveLength(1);
    const upd = dbState.identityUpdates[0];
    expect(upd.update.opt_in_status).toBe('opted_in');
    expect(typeof upd.update.opted_in_at).toBe('string');
    // The terminal-state guard: blocked rows are excluded from the update.
    expect(upd.filters).toContainEqual(['neq', 'opt_in_status', 'blocked']);
    expect(dbState.consentInserts.every((r) => r.event === 'start_keyword')).toBe(true);
    expect(dbState.consentInserts.every((r) => r.source === 'whatsapp_keyword')).toBe(true);
  });

  it('STOP has no neq guard — opt-out applies to every live identity', async () => {
    await POST(makeRequest(baseParams({ Body: 'STOP' })));
    const filterOps = dbState.identityUpdates[0].filters.map((f) => f[0]);
    expect(filterOps).not.toContain('neq');
  });

  it('HELP replies with the command list and performs NO DB writes', async () => {
    const res = await POST(makeRequest(baseParams({ Body: 'HELP' })));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<Message>');
    expect(xml).toContain('MENU');
    expect(xml).toContain('STOP');
    expect(dbState.fromCalls).toEqual([]);
  });

  it('STOP TwiML still returns 200 when every DB write fails (regulatory reply never blocked)', async () => {
    mockAdminImpl = {
      from() {
        throw new Error('db exploded');
      },
    };
    const res = await POST(makeRequest(baseParams({ Body: 'STOP' })));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<Message>');
  });

  it('PINNED ACTUAL: control keywords short-circuit BEFORE dedupe — no inbound event row is written', async () => {
    // Consequence (reported as an implementation observation): a Twilio
    // redelivery of the same STOP MessageSid re-runs the consent inserts.
    await POST(makeRequest(baseParams({ Body: 'STOP' })));
    expect(dbState.inboundUpserts).toHaveLength(0);
    expect(dbState.windowRpcCalls).toHaveLength(0);
  });
});

describe('POST — dedupe + durable persistence', () => {
  it('persists a pending event row keyed on provider_message_id with a sanitized payload (P13)', async () => {
    const params = baseParams({ ProfileName: 'Rahul Sharma' });
    const res = await POST(makeRequest(params));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);

    expect(dbState.inboundUpserts).toHaveLength(1);
    const { row, opts } = dbState.inboundUpserts[0];
    expect(opts).toEqual({ onConflict: 'provider_message_id', ignoreDuplicates: true });
    expect(row.provider).toBe('twilio');
    expect(row.provider_message_id).toBe('SM_evt_001');
    expect(row.phone_hash).toBe(PHONE_HASH);
    expect(row.status).toBe('pending');
    expect(row.message_type).toBe('text');
    expect(row.intent).toBe('doubt_text');
    // P13: raw phone never appears anywhere in the persisted row.
    expect(JSON.stringify(row)).not.toContain('9876543210');
    // P13: WhatsApp profile name (user-chosen display name = PII, often the
    // student's real name) is parsed but must NEVER be persisted
    // (migration contract 20260801100100:171-173).
    expect(row.payload as Record<string, unknown>).not.toHaveProperty('profile_name');
    expect(JSON.stringify(row)).not.toContain('Rahul Sharma');

    // Long-retention dedupe key recorded too.
    expect(dbState.seenUpserts).toEqual([{ provider_message_id: 'SM_evt_001' }]);
  });

  it('never persists MediaUrl0 (bearer-token URL) for media messages', async () => {
    const params = baseParams({
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1',
      MediaContentType0: 'image/jpeg',
      Body: '',
    });
    await POST(makeRequest(params));
    expect(dbState.inboundUpserts).toHaveLength(1);
    const { row } = dbState.inboundUpserts[0];
    expect(row.message_type).toBe('media');
    expect(row.intent).toBe('doubt_image');
    expect(JSON.stringify(row)).not.toContain('api.twilio.com');
    expect((row.payload as Record<string, unknown>).media_content_type0).toBe('image/jpeg');
  });

  it('duplicate MessageSid (Twilio retry) → 200 empty TwiML, no reprocessing', async () => {
    // Conflict: upsert with ignoreDuplicates returns zero rows.
    dbState.inboundUpsertResult = () => ({ data: [], error: null });
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    // Dedupe short-circuits before the seen-ids upsert and the window touch.
    expect(dbState.seenUpserts).toHaveLength(0);
    expect(dbState.windowRpcCalls).toHaveLength(0);
  });

  it('unparseable inbound (missing MessageSid) after a valid signature → 200 empty TwiML, no writes', async () => {
    const params = baseParams();
    delete (params as Record<string, string | undefined>).MessageSid;
    const res = await POST(makeRequest(params));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    expect(dbState.inboundUpserts).toHaveLength(0);
  });
});

describe('POST — ALWAYS-200 after verification (WABA quality-rating invariant)', () => {
  it('event-insert DB error → still 200 empty TwiML, processing continues', async () => {
    dbState.inboundUpsertResult = () => ({ data: null, error: { message: 'db down' } });
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    // Continues past the failure: seen-id + window touch still attempted.
    expect(dbState.seenUpserts).toHaveLength(1);
    expect(dbState.windowRpcCalls).toHaveLength(1);
  });

  it('event-insert THROW → still 200 empty TwiML', async () => {
    dbState.inboundUpsertThrows = true;
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
  });

  it('total DB outage (every from() throws) → still 200 empty TwiML', async () => {
    mockAdminImpl = {
      from() {
        throw new Error('connection refused');
      },
    };
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
  });
});

describe('POST — master kill switch ff_whatsapp_bot_v1', () => {
  it('OFF → event row marked status=ignored, still 200', async () => {
    flagValues.ff_whatsapp_bot_v1 = false;
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(dbState.inboundStatusUpdates).toHaveLength(1);
    expect(dbState.inboundStatusUpdates[0].update).toEqual({ status: 'ignored' });
    expect(dbState.inboundStatusUpdates[0].filters).toContainEqual(['eq', 'id', 'evt-row-1']);
  });

  it('ON → event row stays pending (Phase 1: no further processing yet)', async () => {
    flagValues.ff_whatsapp_bot_v1 = true;
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    expect(dbState.inboundStatusUpdates).toHaveLength(0);
  });
});

describe('POST — conversation-window ledger', () => {
  // touchConversationWindow delegates to the whatsapp_touch_window RPC
  // (migration 20260815000005): a single atomic `INSERT ... ON CONFLICT DO
  // UPDATE` that replaced this route's prior unlocked read-then-write pair
  // (a TOCTOU race that could lose a concurrent whatsapp_record_send's
  // just-recorded counter — see that migration's header). The extend-only /
  // day-rollover / counter-reset BUSINESS RULES now live server-side inside
  // the RPC and are that migration's own verification surface (its header
  // documents 5 manual SQL checks) — this file's remaining responsibility is
  // just "call the RPC with the right args on the right inbound, log+continue
  // on error," which is what these tests pin.

  it('first inbound with no ReferralSourceId touches the window as a service (24h) kind', async () => {
    await POST(makeRequest(baseParams()));

    expect(dbState.windowRpcCalls).toHaveLength(1);
    const call = dbState.windowRpcCalls[0];
    expect(call.p_phone_hash).toBe(PHONE_HASH);
    expect(call.p_window_kind).toBe('service');
    // Not yet resolved at this call site (Phase 1 dedupe/persist runs before
    // identity resolution) — the RPC's own COALESCE never clobbers a later
    // call site that does have it.
    expect(call.p_identity_id).toBeNull();
  });

  it('inbound carrying ReferralSourceId touches the window as a free_entry (72h) kind', async () => {
    await POST(makeRequest(baseParams({ ReferralSourceId: 'wa_me_link' })));

    expect(dbState.windowRpcCalls).toHaveLength(1);
    expect(dbState.windowRpcCalls[0].p_window_kind).toBe('free_entry');
  });

  it('touches the window exactly once per processed inbound (not per DB call in the request)', async () => {
    await POST(makeRequest(baseParams()));
    expect(dbState.windowRpcCalls).toHaveLength(1);
  });

  it('RPC error is logged but the request still returns 200 empty TwiML (always-200 posture)', async () => {
    dbState.windowRpcError = { message: 'row lock timeout' };
    const res = await POST(makeRequest(baseParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    expect(dbState.windowRpcCalls).toHaveLength(1);
    expect(
      loggerCalls.some(
        (c) => c.level === 'error' && c.msg.includes('window ledger touch failed'),
      ),
    ).toBe(true);
  });
});

describe('POST — route-level STOP precedence over interactive payloads (pinned actual)', () => {
  it('a button reply whose Body is STOP takes the regulatory path, not the opcode path', async () => {
    // The route runs classifyControlKeyword(body) BEFORE classifyIntent, so a
    // Body of STOP wins even when ButtonPayload carries a d6 opcode. We author
    // all button texts, so no legitimate button is ever labelled "STOP" —
    // this pins the plan's "STOP precedence over all state" requirement.
    const res = await POST(makeRequest(baseParams({ Body: 'STOP', ButtonPayload: 'd6:a:1' })));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<Message>');
    expect(dbState.identityUpdates[0]?.update.opt_in_status).toBe('opted_out');
    expect(dbState.inboundUpserts).toHaveLength(0);
  });
});
