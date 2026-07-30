/**
 * WhatsApp Daily 6 — flag wiring (webhook + drain) and static-source pins.
 *
 * Binding spec: docs/superpowers/specs/2026-07-30-whatsapp-daily6-behavioral-spec.md
 *
 * Builder-handoff pins implemented here:
 *   (iii-static) daily6.ts NEVER invokes record_adaptive_response via .rpc()
 *          (the double-XP path REJECTED by spec correction 2); bkt_update IS
 *          the mastery writer. Runtime twin lives in daily6-processor.test.ts.
 *   (iv)   caller-literal BYTE-EQUALITY: the two literals in daily6.ts's
 *          callerFor() are byte-identical to the security_internal_callers
 *          seed rows in migration 20260801100600 (REG-118-style static pin).
 *   (v)    ff_whatsapp_daily6 OFF → the webhook persists d6/menu rows and
 *          LEAVES them status='pending' (no processor, no status update);
 *          the drain preserves the Phase-2 no_processor_phase2 bounce.
 *
 * Both routes import the daily6 module, which is mocked here so wiring can be
 * asserted without the processor's own dependency tree (the processor itself
 * is covered by daily6-processor.test.ts; the mocked intent set is pinned
 * against the real export there).
 *
 * House pattern: supabaseAdmin lazy Proxy, flags + logger mocked, Twilio
 * signatures via node:crypto, next/server after() captured. Owner: testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Module-boundary mocks ──────────────────────────────────────────────────

// Capture after() callbacks instead of relying on a live Next request scope.
const afterCallbacks: Array<() => Promise<void> | void> = [];
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => Promise<void> | void) => {
      afterCallbacks.push(fn);
    },
  };
});

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
const flagThrows = new Set<string>();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (name: string) => {
    if (flagThrows.has(name)) throw new Error('flag backend down');
    return flagValues[name] ?? false;
  }),
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

const recordCronJobHealthMock = vi.fn(async () => true);
vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: (...args: unknown[]) => recordCronJobHealthMock(...args),
}));

const processLinkBindingMock = vi.fn(async () => ({ outcome: 'bound' as const }));
vi.mock('@/app/api/whatsapp/_lib/link-binding', () => ({
  processLinkBinding: (...args: unknown[]) => processLinkBindingMock(...args),
}));

// The mocked intent set below MUST mirror the real DAILY6_PROCESSABLE_INTENTS —
// pinned against the real export in daily6-processor.test.ts.
const runDaily6FromWebhookMock = vi.fn(async () => {});
const processDaily6EventMock = vi.fn(async () => 'done' as const);
vi.mock('@/app/api/whatsapp/_lib/daily6', () => ({
  DAILY6_PROCESSABLE_INTENTS: new Set(['d6_start', 'd6_answer', 'subject_pick', 'menu']),
  runDaily6EventFromWebhook: (...args: unknown[]) => runDaily6FromWebhookMock(...args),
  processDaily6Event: (...args: unknown[]) => processDaily6EventMock(...args),
}));

import { POST as webhookPOST } from '@/app/api/whatsapp/webhook/route';
import { GET as drainGET } from '@/app/api/cron/whatsapp-drain/route';
import { NextRequest } from 'next/server';
import { hashPhone } from '@alfanumrik/lib/whatsapp/phone';

// ─── Webhook request helpers (house pattern from webhook-route.test.ts) ─────

const AUTH_TOKEN = 'twilio_auth_token_for_tests';
const PUBLIC_URL = 'https://alfanumrik.com/api/whatsapp/webhook';
const PEPPER = 'test-phone-pepper';
const PHONE = '+919876543210';
const PHONE_HASH = hashPhone(PHONE, PEPPER);
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const CRON_SECRET = 'drain-secret-for-tests';

function twilioSign(url: string, params: Record<string, string>, token: string): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

function d6Params(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MessageSid: 'SM_d6_001',
    From: `whatsapp:${PHONE}`,
    To: 'whatsapp:+911234567890',
    Body: 'Daily 6',
    ButtonPayload: 'd6:start',
    NumMedia: '0',
    WaId: '919876543210',
    ...overrides,
  };
}

function makeWebhookRequest(params: Record<string, string>): NextRequest {
  const body = new URLSearchParams(params).toString();
  return new NextRequest('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': twilioSign(PUBLIC_URL, params, AUTH_TOKEN),
    },
    body,
  });
}

function makeDrainRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/whatsapp-drain', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

// ─── DB state — webhook shape ───────────────────────────────────────────────

type FilterCall = [string, ...unknown[]];

const wst = {
  inboundUpserts: [] as Array<{ row: Record<string, any>; opts: Record<string, unknown> }>,
  inboundStatusUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
  seenUpserts: [] as Array<Record<string, unknown>>,
  windowInserts: [] as Array<Record<string, unknown>>,
};

function buildWebhookAdmin() {
  return {
    from(table: string) {
      switch (table) {
        case 'whatsapp_inbound_events':
          return {
            upsert: (row: Record<string, any>, opts: Record<string, unknown>) => {
              wst.inboundUpserts.push({ row, opts });
              return { select: () => Promise.resolve({ data: [{ id: 'evt-row-1' }], error: null }) };
            },
            update: (update: Record<string, unknown>) => {
              const rec = { update, filters: [] as FilterCall[] };
              wst.inboundStatusUpdates.push(rec);
              const c: any = {
                eq: (...a: unknown[]) => {
                  rec.filters.push(['eq', ...a]);
                  return c;
                },
                then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej),
              };
              return c;
            },
          };
        case 'whatsapp_seen_message_ids':
          return {
            upsert: (row: Record<string, unknown>) => {
              wst.seenUpserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        case 'whatsapp_conversation_windows':
          return {
            select: () => {
              const c: any = {
                eq: () => c,
                maybeSingle: async () => ({ data: null, error: null }),
              };
              return c;
            },
            insert: (row: Record<string, unknown>) => {
              wst.windowInserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        default:
          throw new Error(`unexpected from(${table}) in webhook wiring tests`);
      }
    },
  };
}

// ─── DB state — drain shape ─────────────────────────────────────────────────

const dst = {
  pendingRows: [] as Array<Record<string, unknown>>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  statusUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
};

function drainRow(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    intent: 'd6_start',
    attempts: 0,
    phone_hash: PHONE_HASH,
    payload: { body: 'Daily 6', intent_args: {} },
    created_at: '2026-07-30T03:00:00.000Z',
    ...over,
  };
}

function buildDrainAdmin() {
  return {
    from(table: string) {
      if (table !== 'whatsapp_inbound_events') {
        throw new Error(`unexpected from(${table}) in drain wiring tests`);
      }
      return {
        select: () => {
          const c: any = {
            eq: () => c,
            lt: () => c,
            order: () => c,
            limit: () => c,
            then: (res: any, rej: any) =>
              Promise.resolve({ data: dst.pendingRows, error: null }).then(res, rej),
          };
          return c;
        },
        update: (update: Record<string, unknown>) => {
          const rec = { update, filters: [] as FilterCall[] };
          dst.statusUpdates.push(rec);
          const c: any = {
            eq: (...a: unknown[]) => {
              rec.filters.push(['eq', ...a]);
              return c;
            },
            then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej),
          };
          return c;
        },
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      dst.rpcCalls.push({ name, args });
      return { data: true, error: null }; // claim always succeeds
    },
  };
}

function drainStatusFor(id: string) {
  return dst.statusUpdates.filter((u) =>
    u.filters.some((f) => f[0] === 'eq' && f[1] === 'id' && f[2] === id),
  );
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.WHATSAPP_WEBHOOK_PUBLIC_URL = PUBLIC_URL;
  process.env.WHATSAPP_PHONE_PEPPER = PEPPER;
  process.env.CRON_SECRET = CRON_SECRET;

  wst.inboundUpserts.length = 0;
  wst.inboundStatusUpdates.length = 0;
  wst.seenUpserts.length = 0;
  wst.windowInserts.length = 0;
  dst.pendingRows = [];
  dst.rpcCalls.length = 0;
  dst.statusUpdates.length = 0;

  loggerCalls.length = 0;
  afterCallbacks.length = 0;
  runDaily6FromWebhookMock.mockClear();
  processDaily6EventMock.mockClear();
  processDaily6EventMock.mockResolvedValue('done');
  recordCronJobHealthMock.mockClear();
  processLinkBindingMock.mockClear();

  for (const k of Object.keys(flagValues)) delete flagValues[k];
  flagThrows.clear();
  flagValues.ff_whatsapp_inbound_webhook = true;
  flagValues.ff_whatsapp_bot_v1 = true;
  flagValues.ff_whatsapp_daily6 = false; // Phase-3 default posture: OFF
});

// ─────────────────────────────────────────────────────────────────────────────
// (v) Webhook wiring — ff_whatsapp_daily6
// ─────────────────────────────────────────────────────────────────────────────

describe('webhook — ff_whatsapp_daily6 gating (pin v)', () => {
  beforeEach(() => {
    mockAdminImpl = buildWebhookAdmin();
  });

  it('flag OFF → the d6 event row is persisted and LEFT pending: no processor, no status update, 200 TwiML', async () => {
    const res = await webhookPOST(makeWebhookRequest(d6Params()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);

    expect(wst.inboundUpserts).toHaveLength(1);
    expect(wst.inboundUpserts[0].row.status).toBe('pending');
    expect(wst.inboundUpserts[0].row.intent).toBe('d6_start');

    expect(wst.inboundStatusUpdates).toHaveLength(0); // stays pending
    expect(afterCallbacks).toHaveLength(0);
    expect(runDaily6FromWebhookMock).not.toHaveBeenCalled();
  });

  it('flag OFF applies to every d6-family intent (menu opcode too)', async () => {
    await webhookPOST(
      makeWebhookRequest(d6Params({ MessageSid: 'SM_menu_001', ButtonPayload: 'menu', Body: 'Menu' })),
    );
    expect(wst.inboundUpserts[0].row.intent).toBe('menu');
    expect(afterCallbacks).toHaveLength(0);
    expect(runDaily6FromWebhookMock).not.toHaveBeenCalled();
  });

  it('flag ON → the processor is scheduled via after() with the persisted row id and webhook source', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    const res = await webhookPOST(makeWebhookRequest(d6Params()));
    expect(res.status).toBe(200);

    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(runDaily6FromWebhookMock).toHaveBeenCalledTimes(1);
    expect(runDaily6FromWebhookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-row-1',
        intent: 'd6_start',
        args: {},
        phoneHash: PHONE_HASH,
        source: 'webhook',
      }),
    );
    const evt = (runDaily6FromWebhookMock.mock.calls[0] as any[])[0];
    expect(typeof evt.receivedAtMs).toBe('number');
    // The route itself never settles the row — the processor does.
    expect(wst.inboundStatusUpdates).toHaveLength(0);
  });

  it('flag ON: a d6:a:<qIdx>:<optIdx> reply carries BOTH the served question position and the displayed option index (dev-5)', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    await webhookPOST(
      makeWebhookRequest(
        d6Params({ MessageSid: 'SM_ans_001', ButtonPayload: 'd6:a:0:2', Body: 'C' }),
      ),
    );
    await afterCallbacks[0]();
    expect(runDaily6FromWebhookMock).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'd6_answer', args: { qIdx: '0', optIdx: '2' } }),
    );
  });

  it('flag-read FAILURE → fail-safe OFF: row left pending, no processor', async () => {
    flagThrows.add('ff_whatsapp_daily6');
    const res = await webhookPOST(makeWebhookRequest(d6Params()));
    expect(res.status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
    expect(runDaily6FromWebhookMock).not.toHaveBeenCalled();
    expect(wst.inboundStatusUpdates).toHaveLength(0);
  });

  it('non-d6 intents are never scheduled even with the flag ON', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    const params = d6Params({ MessageSid: 'SM_txt_001', Body: 'what is photosynthesis' });
    delete (params as Record<string, string | undefined>).ButtonPayload;
    await webhookPOST(makeWebhookRequest(params));
    expect(afterCallbacks).toHaveLength(0);
    expect(runDaily6FromWebhookMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (v) Drain wiring — ff_whatsapp_daily6
// ─────────────────────────────────────────────────────────────────────────────

describe('drain — ff_whatsapp_daily6 gating (pin v)', () => {
  beforeEach(() => {
    mockAdminImpl = buildDrainAdmin();
  });

  it('flag OFF preserves the Phase-2 bounce: below the ceiling → pending with incremented attempts, processor NOT called', async () => {
    dst.pendingRows = [drainRow({ attempts: 0 })];
    const res = await drainGET(makeDrainRequest());
    expect(res.status).toBe(200);
    expect(processDaily6EventMock).not.toHaveBeenCalled();
    expect(drainStatusFor('evt-1')[0].update).toEqual({ status: 'pending', attempts: 1 });
  });

  it('flag OFF at the attempt ceiling → failed with last_error=no_processor_phase2 (exact Phase-2 posture)', async () => {
    dst.pendingRows = [drainRow({ attempts: 2 })];
    await drainGET(makeDrainRequest());
    expect(processDaily6EventMock).not.toHaveBeenCalled();
    const upd = drainStatusFor('evt-1')[0].update;
    expect(upd.status).toBe('failed');
    expect(upd.last_error).toBe('no_processor_phase2');
    expect(upd.attempts).toBe(3);
  });

  it('flag-read FAILURE reads as OFF (fail-safe): the bounce is preserved', async () => {
    flagThrows.add('ff_whatsapp_daily6');
    dst.pendingRows = [drainRow({ attempts: 0 })];
    await drainGET(makeDrainRequest());
    expect(processDaily6EventMock).not.toHaveBeenCalled();
    expect(drainStatusFor('evt-1')[0].update).toEqual({ status: 'pending', attempts: 1 });
  });

  it('flag ON routes through the shared processor with source=drain and receivedAtMs from created_at', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    dst.pendingRows = [
      drainRow({
        intent: 'd6_answer',
        payload: { body: 'B', intent_args: { qIdx: '0', optIdx: '1' } },
      }),
    ];
    const res = await drainGET(makeDrainRequest());
    const body = await res.json();

    expect(processDaily6EventMock).toHaveBeenCalledTimes(1);
    expect(processDaily6EventMock).toHaveBeenCalledWith({
      id: 'evt-1',
      intent: 'd6_answer',
      args: { qIdx: '0', optIdx: '1' },
      phoneHash: PHONE_HASH,
      receivedAtMs: Date.parse('2026-07-30T03:00:00.000Z'),
      source: 'drain',
    });
    expect(drainStatusFor('evt-1')[0].update.status).toBe('done');
    expect(body.data).toEqual({ claimed: 1, processed: 1, failed: 0 });
  });

  it('flag ON, outcome retry below the ceiling → bounced back to pending', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    processDaily6EventMock.mockResolvedValue('retry');
    dst.pendingRows = [drainRow({ attempts: 0 })];
    await drainGET(makeDrainRequest());
    expect(drainStatusFor('evt-1')[0].update).toEqual({ status: 'pending', attempts: 1 });
  });

  it('flag ON, outcome retry AT the ceiling → failed with last_error=daily6_processing_error', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    processDaily6EventMock.mockResolvedValue('retry');
    dst.pendingRows = [drainRow({ attempts: 2 })];
    await drainGET(makeDrainRequest());
    const upd = drainStatusFor('evt-1')[0].update;
    expect(upd.status).toBe('failed');
    expect(upd.last_error).toBe('daily6_processing_error');
  });

  it('flag ON, outcome failed → terminal daily6_terminal even on the first attempt', async () => {
    flagValues.ff_whatsapp_daily6 = true;
    processDaily6EventMock.mockResolvedValue('failed');
    dst.pendingRows = [drainRow({ attempts: 0 })];
    const res = await drainGET(makeDrainRequest());
    const body = await res.json();
    const upd = drainStatusFor('evt-1')[0].update;
    expect(upd.status).toBe('failed');
    expect(upd.last_error).toBe('daily6_terminal');
    expect(body.data).toEqual({ claimed: 1, processed: 0, failed: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static-source pins (iii static, iv)
// ─────────────────────────────────────────────────────────────────────────────

describe('static-source pins — daily6.ts vs migration 20260801100600', () => {
  // apps/host/src/__tests__/whatsapp → ../../ = apps/host/src; repo root is 5 up.
  const daily6Src = readFileSync(
    resolve(__dirname, '..', '..', 'app', 'api', 'whatsapp', '_lib', 'daily6.ts'),
    'utf8',
  );
  const migrationSql = readFileSync(
    resolve(
      __dirname,
      '..', '..', '..', '..', '..',
      'supabase',
      'migrations',
      '20260801100600_whatsapp_register_internal_callers.sql',
    ),
    'utf8',
  );

  it('(iv) callerFor() maps webhook→whatsapp-webhook-route and drain→whatsapp-drain-cron', () => {
    const m = /source === 'webhook' \? '([^']+)' : '([^']+)'/.exec(daily6Src);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('whatsapp-webhook-route');
    expect(m![2]).toBe('whatsapp-drain-cron');
  });

  it('(iv) BYTE-EQUALITY: both caller literals exist as seed rows in migration 20260801100600', () => {
    const seeded = [...migrationSql.matchAll(/\('([a-z0-9-]+)',\s*'Next\.js/g)].map((m) => m[1]);
    expect(seeded).toContain('whatsapp-webhook-route');
    expect(seeded).toContain('whatsapp-drain-cron');

    // The exact literals daily6.ts sends must equal the seeded names byte-for-byte.
    const callerMatch = /source === 'webhook' \? '([^']+)' : '([^']+)'/.exec(daily6Src)!;
    for (const literal of [callerMatch[1], callerMatch[2]]) {
      expect(seeded.includes(literal)).toBe(true);
    }
  });

  it('(iii static) daily6.ts NEVER calls record_adaptive_response — bkt_update is the only mastery writer', () => {
    // The name may appear in comments (documenting the rejection); an actual
    // RPC invocation must not exist.
    expect(daily6Src).not.toMatch(/\.rpc\(\s*['"`]record_adaptive_response/);
    expect(daily6Src).toMatch(/\.rpc\('bkt_update'/);
  });

  it('(iii static) the bkt_update call site passes the four spec args (student, node, correctness, time_ms)', () => {
    const site = /\.rpc\('bkt_update',\s*\{([\s\S]{0,300}?)\}\)/.exec(daily6Src);
    expect(site).not.toBeNull();
    const args = site![1];
    expect(args).toContain('p_student_id');
    expect(args).toContain('p_node_code');
    expect(args).toContain('p_is_correct');
    expect(args).toContain('p_response_time_ms');
  });

  it('daily6.ts owns exactly the four Phase-3 intents (keeps the wiring mock honest)', () => {
    const block = /DAILY6_PROCESSABLE_INTENTS[\s\S]{0,200}?\]\)/.exec(daily6Src);
    expect(block).not.toBeNull();
    for (const intent of ['d6_start', 'd6_answer', 'subject_pick', 'menu']) {
      expect(block![0]).toContain(`'${intent}'`);
    }
  });
});
