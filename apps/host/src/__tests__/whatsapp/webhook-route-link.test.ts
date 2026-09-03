/**
 * /api/whatsapp/webhook — Phase 2 LINK-inline path (sibling of
 * webhook-route.test.ts, which owns the Phase-1 posture).
 *
 * Pins:
 *   - `LINK <otp>` with ff_whatsapp_bot_v1 ON is processed INLINE via the
 *     shared binding core, with the webhook-only raw phone
 *     ({ code, phoneHash, phoneE164, source:'whatsapp/webhook' })
 *   - the inbound event row is marked status='done' on EVERY binding outcome
 *     (LINK events are terminally handled inline — the drain cron must never
 *     re-run a consumed/invalid code)
 *   - TwiML replies are bilingual (P7: English + Devanagari) for every outcome
 *   - P13: the success TwiML names NOTHING sensitive — no profile name, no
 *     phone digits, no OTP echo; logs carry outcome + redacted phone only
 *   - binder throw → still 200 (always-200 posture) with the error copy, and
 *     the event row is STILL marked done
 *   - ff_whatsapp_bot_v1 OFF → the binder is never invoked (event 'ignored')
 *   - duplicate MessageSid → the binder is never invoked
 *
 * The binding core itself is pinned in link-binding.test.ts — here it is
 * mocked so each outcome can be forced.
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

const processLinkBindingMock = vi.fn();
vi.mock('@/app/api/whatsapp/_lib/link-binding', () => ({
  processLinkBinding: (...args: unknown[]) => processLinkBindingMock(...args),
}));

import { POST } from '@/app/api/whatsapp/webhook/route';
import { hashPhone } from '@alfanumrik/lib/whatsapp/phone';

// ─── Constants + request builder (house pattern) ────────────────────────────

const AUTH_TOKEN = 'twilio_auth_token_for_tests';
const PUBLIC_URL = 'https://alfanumrik.com/api/whatsapp/webhook';
const PEPPER = 'test-phone-pepper';
const PHONE = '+919876543210';
const PHONE_HASH = hashPhone(PHONE, PEPPER);
// NOT a substring of the phone digits (P13 assertions depend on this).
const OTP = '111222';

const OUTCOMES = [
  'bound',
  'invalid',
  'ambiguous',
  'locked',
  'limit',
  'phone_unavailable',
  'rate_limited',
  'error',
] as const;

function twilioSign(url: string, params: Record<string, string>, token: string): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

function linkParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MessageSid: 'SM_link_001',
    From: `whatsapp:${PHONE}`,
    To: 'whatsapp:+911234567890',
    Body: `LINK ${OTP}`,
    NumMedia: '0',
    WaId: '919876543210',
    ...overrides,
  };
}

function makeRequest(params: Record<string, string>): NextRequest {
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

// ─── Minimal DB state (only what the LINK flow touches) ─────────────────────

type FilterCall = [string, ...unknown[]];

const dbState = {
  inboundUpsertResult: () => ({ data: [{ id: 'evt-row-1' }], error: null as unknown }),
  inboundStatusUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
};

function buildMockAdmin() {
  return {
    from(table: string) {
      switch (table) {
        case 'whatsapp_inbound_events':
          return {
            upsert: () => ({ select: () => Promise.resolve(dbState.inboundUpsertResult()) }),
            update: (update: Record<string, unknown>) => {
              const rec = { update, filters: [] as FilterCall[] };
              dbState.inboundStatusUpdates.push(rec);
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
          return { upsert: () => Promise.resolve({ error: null }) };
        case 'whatsapp_conversation_windows':
          return {
            select: () => {
              const c: any = { eq: () => c, maybeSingle: async () => ({ data: null, error: null }) };
              return c;
            },
            insert: () => Promise.resolve({ error: null }),
          };
        default:
          throw new Error(`unexpected from(${table})`);
      }
    },
  };
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.WHATSAPP_WEBHOOK_PUBLIC_URL = PUBLIC_URL;
  process.env.WHATSAPP_PHONE_PEPPER = PEPPER;
  dbState.inboundUpsertResult = () => ({ data: [{ id: 'evt-row-1' }], error: null });
  dbState.inboundStatusUpdates.length = 0;
  loggerCalls.length = 0;
  processLinkBindingMock.mockReset();
  processLinkBindingMock.mockResolvedValue({ outcome: 'bound' });
  mockAdminImpl = buildMockAdmin();
  for (const k of Object.keys(flagValues)) delete flagValues[k];
  // Phase 2 posture: webhook live AND bot ON.
  flagValues.ff_whatsapp_inbound_webhook = true;
  flagValues.ff_whatsapp_bot_v1 = true;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('LINK inline processing (bot flag ON)', () => {
  it('invokes the shared binding core once with the webhook-side contract', async () => {
    const res = await POST(makeRequest(linkParams()));
    expect(res.status).toBe(200);
    expect(processLinkBindingMock).toHaveBeenCalledTimes(1);
    expect(processLinkBindingMock).toHaveBeenCalledWith({
      code: OTP,
      phoneHash: PHONE_HASH,
      phoneE164: PHONE, // the ONE legitimate raw-phone write site (P13)
      source: 'whatsapp/webhook',
    });
  });

  it('replies 200 text/xml with a <Message> (not the empty ack)', async () => {
    const res = await POST(makeRequest(linkParams()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/xml');
    const xml = await res.text();
    expect(xml).toContain('<Message>');
  });

  it.each(OUTCOMES)(
    'outcome %s → event row is marked done (terminal inline handling)',
    async (outcome) => {
      processLinkBindingMock.mockResolvedValue({ outcome });
      const res = await POST(makeRequest(linkParams()));
      expect(res.status).toBe(200);

      expect(dbState.inboundStatusUpdates).toHaveLength(1);
      const upd = dbState.inboundStatusUpdates[0];
      expect(upd.update.status).toBe('done');
      expect(typeof upd.update.processed_at).toBe('string');
      expect(upd.filters).toContainEqual(['eq', 'id', 'evt-row-1']);
    },
  );

  it.each(OUTCOMES)('outcome %s → reply is bilingual (P7)', async (outcome) => {
    processLinkBindingMock.mockResolvedValue({ outcome });
    const res = await POST(makeRequest(linkParams()));
    const xml = await res.text();
    expect(xml).toContain('<Message>');
    // Devanagari (Hindi) present…
    expect(xml).toMatch(/[ऀ-ॿ]/);
    // …alongside Latin-script English.
    expect(xml).toMatch(/[A-Za-z]{3,}/);
  });

  it('success reply invites MENU and contains NO PII: no name, no phone, no OTP (P13)', async () => {
    processLinkBindingMock.mockResolvedValue({ outcome: 'bound' });
    const res = await POST(makeRequest(linkParams({ ProfileName: 'Rahul Sharma' })));
    const xml = await res.text();
    expect(xml).toContain('MENU');
    expect(xml).not.toContain('Rahul');
    expect(xml).not.toContain('Sharma');
    expect(xml).not.toContain('9876543210');
    expect(xml).not.toContain(OTP);
  });

  it('P13: logs carry outcome + redacted phone only — never the OTP or raw phone', async () => {
    await POST(makeRequest(linkParams()));
    const logged = JSON.stringify(loggerCalls);
    expect(logged).not.toContain(OTP);
    expect(logged).not.toContain('987654'); // raw-phone digit run (redacted keeps +91…3210)
    const infoLine = loggerCalls.find((l) => l.msg.includes('link intent processed'));
    expect(infoLine).toBeTruthy();
    expect((infoLine!.meta as Record<string, unknown>).outcome).toBe('bound');
  });

  it('binder THROW → still 200 with the bilingual error copy, event STILL marked done', async () => {
    processLinkBindingMock.mockRejectedValue(new Error('binder exploded'));
    const res = await POST(makeRequest(linkParams()));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<Message>');
    expect(xml).toMatch(/[ऀ-ॿ]/);
    expect(dbState.inboundStatusUpdates).toHaveLength(1);
    expect(dbState.inboundStatusUpdates[0].update.status).toBe('done');
  });

  it('event-insert failure (no row id) → binder still runs, reply still 200, no done-update', async () => {
    dbState.inboundUpsertResult = () => ({ data: null, error: { message: 'insert down' } });
    const res = await POST(makeRequest(linkParams()));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<Message>');
    expect(processLinkBindingMock).toHaveBeenCalledTimes(1);
    expect(dbState.inboundStatusUpdates).toHaveLength(0);
  });
});

describe('LINK gating', () => {
  it('ff_whatsapp_bot_v1 OFF → binder NEVER invoked; event marked ignored', async () => {
    flagValues.ff_whatsapp_bot_v1 = false;
    const res = await POST(makeRequest(linkParams()));
    expect(res.status).toBe(200);
    expect(processLinkBindingMock).not.toHaveBeenCalled();
    expect(dbState.inboundStatusUpdates).toHaveLength(1);
    expect(dbState.inboundStatusUpdates[0].update).toEqual({ status: 'ignored' });
  });

  it('duplicate MessageSid (Twilio retry) → binder NEVER invoked', async () => {
    dbState.inboundUpsertResult = () => ({ data: [], error: null });
    const res = await POST(makeRequest(linkParams()));
    expect(res.status).toBe(200);
    expect(processLinkBindingMock).not.toHaveBeenCalled();
  });

  it('a non-LINK body with the bot flag ON does not touch the binder', async () => {
    const res = await POST(makeRequest(linkParams({ Body: 'what is photosynthesis' })));
    expect(res.status).toBe(200);
    expect(processLinkBindingMock).not.toHaveBeenCalled();
  });
});
