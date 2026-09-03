/**
 * /api/cron/whatsapp-drain — Phase 2 drain worker tests.
 *
 * Pins (plan "Ack-fast / async split" + REG-118/REG-119 cron posture):
 *   1. FAIL-CLOSED CRON_SECRET gate BEFORE any DB I/O — missing env, missing
 *      credential, or wrong secret → 401 with ZERO from()/rpc() calls.
 *      Carrier precedence is FIRST-PRESENT-WINS (Bearer > x-cron-secret): a
 *      wrong higher-precedence carrier is NOT rescued by a correct lower one.
 *      The ?token= query carrier was REMOVED 2026-08-03 (P1 verifyCronAuth
 *      batch) and now 401s even with a correct value.
 *   2. Claims via RPC whatsapp_claim_inbound(p_id); rows where the claim
 *      returns false (or errors) are SKIPPED — no status write, not counted.
 *   3. Non-link intents have no Phase-2 processor: attemptsAfterClaim < 3 →
 *      bounced back to 'pending'; >= 3 → 'failed' with
 *      last_error='no_processor_phase2'.
 *   4. Link intent routes through the shared binding core with
 *      phoneE164=null (P13 — the raw phone is never in the event row) and
 *      source='cron/whatsapp-drain'; deterministic outcomes → 'done',
 *      transient 'error' retries, 'phone_unavailable' is terminal.
 *   5. P13: the response is counts-only { claimed, processed, failed } —
 *      no phones, no payloads; unhandled errors → generic 500 body.
 *
 * Owner: testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

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

const processLinkBindingMock = vi.fn();
vi.mock('@/app/api/whatsapp/_lib/link-binding', () => ({
  processLinkBinding: (...args: unknown[]) => processLinkBindingMock(...args),
}));

import { GET, POST } from '@/app/api/cron/whatsapp-drain/route';

// ─── DB state ───────────────────────────────────────────────────────────────

type FilterCall = [string, ...unknown[]];

const CRON_SECRET = 'drain-secret-for-tests';
const PHONE_HASH = 'f'.repeat(64);

interface EventRowOverrides {
  id?: string;
  intent?: string | null;
  attempts?: number;
  phone_hash?: string;
  payload?: Record<string, unknown> | null;
}

function eventRow(over: EventRowOverrides = {}) {
  return {
    id: 'evt-1',
    intent: 'doubt_text',
    attempts: 0,
    phone_hash: PHONE_HASH,
    payload: { body: 'free text' },
    ...over,
  };
}

const st = {
  fromCalls: [] as string[],
  scanFilters: [] as FilterCall[],
  scanLimit: null as number | null,
  pendingRows: [] as Array<Record<string, unknown>>,
  scanError: null as { message: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  /** Claim result per p_id; unlisted ids claim true. */
  claimResults: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  statusUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
};

function resetState() {
  st.fromCalls.length = 0;
  st.scanFilters.length = 0;
  st.scanLimit = null;
  st.pendingRows = [];
  st.scanError = null;
  st.rpcCalls.length = 0;
  st.claimResults = {};
  st.statusUpdates.length = 0;
}

function buildMockAdmin() {
  return {
    from(table: string) {
      st.fromCalls.push(table);
      if (table !== 'whatsapp_inbound_events') throw new Error(`unexpected from(${table})`);
      return {
        select: () => {
          const c: any = {
            eq: (...a: unknown[]) => {
              st.scanFilters.push(['eq', ...a]);
              return c;
            },
            lt: (...a: unknown[]) => {
              st.scanFilters.push(['lt', ...a]);
              return c;
            },
            order: () => c,
            limit: (n: number) => {
              st.scanLimit = n;
              return c;
            },
            then: (res: any, rej: any) =>
              Promise.resolve({ data: st.pendingRows, error: st.scanError }).then(res, rej),
          };
          return c;
        },
        update: (update: Record<string, unknown>) => {
          const rec = { update, filters: [] as FilterCall[] };
          st.statusUpdates.push(rec);
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
      st.rpcCalls.push({ name, args });
      return st.claimResults[args.p_id as string] ?? { data: true, error: null };
    },
  };
}

function makeRequest(opts: {
  bearer?: string;
  headerSecret?: string;
  token?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.headerSecret !== undefined) headers['x-cron-secret'] = opts.headerSecret;
  const qs = opts.token !== undefined ? `?token=${encodeURIComponent(opts.token)}` : '';
  return new NextRequest(`http://localhost/api/cron/whatsapp-drain${qs}`, { headers });
}

function statusUpdateFor(id: string) {
  return st.statusUpdates.filter((u) =>
    u.filters.some((f) => f[0] === 'eq' && f[1] === 'id' && f[2] === id),
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  resetState();
  loggerCalls.length = 0;
  recordCronJobHealthMock.mockClear();
  processLinkBindingMock.mockReset();
  processLinkBindingMock.mockResolvedValue({ outcome: 'bound' });
  mockAdminImpl = buildMockAdmin();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('fail-closed CRON_SECRET gate (REG-118 posture)', () => {
  it('missing CRON_SECRET env → 401 with ZERO DB I/O', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(res.status).toBe(401);
    expect(st.fromCalls).toEqual([]);
    expect(st.rpcCalls).toEqual([]);
  });

  it('no credential at all → 401 with zero DB I/O', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(st.fromCalls).toEqual([]);
    expect(st.rpcCalls).toEqual([]);
  });

  it('wrong Bearer secret → 401 with zero DB I/O', async () => {
    const res = await GET(makeRequest({ bearer: 'nope' }));
    expect(res.status).toBe(401);
    expect(st.fromCalls).toEqual([]);
  });

  it.each([
    ['Bearer', { bearer: CRON_SECRET }],
    ['x-cron-secret', { headerSecret: CRON_SECRET }],
  ] as const)('correct secret via %s → 200', async (_label, opts) => {
    const res = await GET(makeRequest(opts));
    expect(res.status).toBe(200);
  });

  // P1 batch 2026-08-03 (verifyCronAuth consolidation): the ?token= query
  // carrier was REMOVED — query strings land in access/CDN logs, so a secret
  // there is a secret leaked. Even a CORRECT token must now 401.
  it('correct secret via ?token= → 401 with zero DB I/O (query carrier removed)', async () => {
    const res = await GET(makeRequest({ token: CRON_SECRET }));
    expect(res.status).toBe(401);
    expect(st.fromCalls).toEqual([]);
    expect(st.rpcCalls).toEqual([]);
  });

  it('FIRST-PRESENT-WINS: wrong Bearer is NOT rescued by a correct x-cron-secret', async () => {
    const res = await GET(makeRequest({ bearer: 'wrong', headerSecret: CRON_SECRET }));
    expect(res.status).toBe(401);
    expect(st.fromCalls).toEqual([]);
  });

  it('POST (manual ops trigger) enforces the same gate', async () => {
    const resDenied = await POST(makeRequest({ bearer: 'wrong' }));
    expect(resDenied.status).toBe(401);
    const resOk = await POST(makeRequest({ bearer: CRON_SECRET }));
    expect(resOk.status).toBe(200);
  });
});

describe('claiming via whatsapp_claim_inbound', () => {
  it('scan pins status=pending, staleness cutoff, attempts<3, batch limit 25', async () => {
    await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(st.scanFilters).toContainEqual(['eq', 'status', 'pending']);
    const ltFilters = st.scanFilters.filter((f) => f[0] === 'lt');
    expect(ltFilters.map((f) => f[1])).toEqual(
      expect.arrayContaining(['created_at', 'attempts']),
    );
    expect(ltFilters.find((f) => f[1] === 'attempts')?.[2]).toBe(3);
    expect(st.scanLimit).toBe(25);
  });

  it('invokes the claim RPC once per scanned row with p_id', async () => {
    st.pendingRows = [eventRow({ id: 'evt-1' }), eventRow({ id: 'evt-2' })];
    await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(st.rpcCalls).toEqual([
      { name: 'whatsapp_claim_inbound', args: { p_id: 'evt-1' } },
      { name: 'whatsapp_claim_inbound', args: { p_id: 'evt-2' } },
    ]);
  });

  it('claim=false (another worker holds the row) → skipped: no status write, not counted', async () => {
    st.pendingRows = [eventRow({ id: 'evt-lost' }), eventRow({ id: 'evt-won' })];
    st.claimResults['evt-lost'] = { data: false, error: null };
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();
    expect(body.data.claimed).toBe(1);
    expect(statusUpdateFor('evt-lost')).toHaveLength(0);
    expect(statusUpdateFor('evt-won')).toHaveLength(1);
  });

  it('claim RPC error → row skipped, drain continues with the next row', async () => {
    st.pendingRows = [eventRow({ id: 'evt-err' }), eventRow({ id: 'evt-ok' })];
    st.claimResults['evt-err'] = { data: null, error: { message: 'rpc down' } };
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.claimed).toBe(1);
    expect(statusUpdateFor('evt-err')).toHaveLength(0);
  });
});

describe('non-link intents (no Phase-2 processor)', () => {
  it('attemptsAfterClaim < 3 → bounced back to pending with the incremented count', async () => {
    st.pendingRows = [eventRow({ id: 'evt-1', intent: 'doubt_text', attempts: 0 })];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();

    const updates = statusUpdateFor('evt-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toEqual({ status: 'pending', attempts: 1 });
    expect(body.data).toEqual({ claimed: 1, processed: 0, failed: 0 });
  });

  it('attemptsAfterClaim >= 3 → failed with last_error=no_processor_phase2', async () => {
    st.pendingRows = [eventRow({ id: 'evt-1', intent: 'menu', attempts: 2 })];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();

    const updates = statusUpdateFor('evt-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].update.status).toBe('failed');
    expect(updates[0].update.last_error).toBe('no_processor_phase2');
    expect(updates[0].update.attempts).toBe(3);
    expect(typeof updates[0].update.processed_at).toBe('string');
    expect(body.data).toEqual({ claimed: 1, processed: 0, failed: 1 });
  });

  it('the binding core is never consulted for a non-link intent', async () => {
    st.pendingRows = [eventRow({ intent: 'doubt_text' })];
    await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(processLinkBindingMock).not.toHaveBeenCalled();
  });
});

describe('link intent — shared binding core on the retry path', () => {
  const linkRow = (over: EventRowOverrides = {}) =>
    eventRow({
      intent: 'link',
      payload: { body: 'LINK 111222', intent_args: { otp: '111222' } },
      ...over,
    });

  it('routes through processLinkBinding with phoneE164=null (P13) and the cron source tag', async () => {
    st.pendingRows = [linkRow()];
    await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(processLinkBindingMock).toHaveBeenCalledTimes(1);
    expect(processLinkBindingMock).toHaveBeenCalledWith({
      code: '111222',
      phoneHash: PHONE_HASH,
      phoneE164: null,
      source: 'cron/whatsapp-drain',
    });
  });

  it('missing/malformed intent_args → empty code passed (binder classifies it invalid)', async () => {
    st.pendingRows = [linkRow({ payload: { body: 'LINK x' } })];
    await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(processLinkBindingMock.mock.calls[0][0].code).toBe('');
  });

  it.each(['bound', 'invalid', 'ambiguous', 'locked', 'limit', 'rate_limited'] as const)(
    'deterministic outcome %s → done + processed',
    async (outcome) => {
      processLinkBindingMock.mockResolvedValue({ outcome });
      st.pendingRows = [linkRow({ id: 'evt-1' })];
      const res = await GET(makeRequest({ bearer: CRON_SECRET }));
      const body = await res.json();

      const updates = statusUpdateFor('evt-1');
      expect(updates).toHaveLength(1);
      expect(updates[0].update.status).toBe('done');
      expect(body.data).toEqual({ claimed: 1, processed: 1, failed: 0 });
    },
  );

  it("transient 'error' below the ceiling → back to pending for the next minute", async () => {
    processLinkBindingMock.mockResolvedValue({ outcome: 'error' });
    st.pendingRows = [linkRow({ id: 'evt-1', attempts: 0 })];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();
    expect(statusUpdateFor('evt-1')[0].update).toEqual({ status: 'pending', attempts: 1 });
    expect(body.data).toEqual({ claimed: 1, processed: 0, failed: 0 });
  });

  it("'error' at the attempt ceiling → failed with last_error=link_processing_error", async () => {
    processLinkBindingMock.mockResolvedValue({ outcome: 'error' });
    st.pendingRows = [linkRow({ id: 'evt-1', attempts: 2 })];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();
    const upd = statusUpdateFor('evt-1')[0].update;
    expect(upd.status).toBe('failed');
    expect(upd.last_error).toBe('link_processing_error');
    expect(body.data.failed).toBe(1);
  });

  it("'phone_unavailable' is TERMINAL even on the first attempt (retry cannot help)", async () => {
    processLinkBindingMock.mockResolvedValue({ outcome: 'phone_unavailable' });
    st.pendingRows = [linkRow({ id: 'evt-1', attempts: 0 })];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();
    const upd = statusUpdateFor('evt-1')[0].update;
    expect(upd.status).toBe('failed');
    expect(upd.last_error).toBe('phone_unavailable_cron');
    expect(body.data).toEqual({ claimed: 1, processed: 0, failed: 1 });
  });
});

describe('P13 — counts-only response + generic errors', () => {
  it('response data is EXACTLY { claimed, processed, failed } — no phones, no payloads', async () => {
    st.pendingRows = [
      eventRow({ id: 'evt-1', payload: { body: 'my secret homework question' } }),
    ];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(['claimed', 'failed', 'processed']);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(PHONE_HASH);
    expect(raw).not.toContain('homework');
  });

  it('scan failure → 500 with the generic body, never the DB error message', async () => {
    st.scanError = { message: 'relation whatsapp_inbound_events does not exist' };
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'internal_error' });
  });
});

describe('cron job-health breadcrumb (claimed>0 always; idle heartbeat every 5th UTC minute)', () => {
  // The route decides the idle heartbeat from new Date().getUTCMinutes() % 5,
  // so pin the clock (Date only — no timer APIs are involved).
  function setClock(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recorded when the run claimed work (counts in context) — even OFF the heartbeat minute', async () => {
    setClock('2026-07-30T10:04:00Z'); // minute 4 — not a heartbeat minute
    st.pendingRows = [eventRow({ id: 'evt-1' })];
    await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(recordCronJobHealthMock).toHaveBeenCalledTimes(1);
    const arg = recordCronJobHealthMock.mock.calls[0][0] as Record<string, any>;
    expect(arg.path).toBe('/api/cron/whatsapp-drain');
    expect(arg.context).toEqual({ claimed: 1, processed: 0, failed: 0 });
  });

  it('no-op run ON a heartbeat minute (UTC minute % 5 === 0) → recorded, so the RCA-17 liveness gate (job-registry alertThreshold 15m) stays fresh while the queue is empty', async () => {
    setClock('2026-07-30T10:05:00Z'); // minute 5 — heartbeat minute
    st.pendingRows = [];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(recordCronJobHealthMock).toHaveBeenCalledTimes(1);
    const arg = recordCronJobHealthMock.mock.calls[0][0] as Record<string, any>;
    expect(arg.path).toBe('/api/cron/whatsapp-drain');
    expect(arg.context).toEqual({ claimed: 0, processed: 0, failed: 0 });
  });

  it('no-op run OFF the heartbeat minute → NOT recorded (every-minute cron must not spam ops_events)', async () => {
    setClock('2026-07-30T10:04:00Z'); // minute 4 — not a heartbeat minute
    st.pendingRows = [];
    const res = await GET(makeRequest({ bearer: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(recordCronJobHealthMock).not.toHaveBeenCalled();
  });
});
