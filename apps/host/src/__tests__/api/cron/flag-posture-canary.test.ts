/**
 * /api/cron/flag-posture-canary — nightly flag-posture drift canary tests
 * (REG-286 — 2026-07-20 console bulk-enable incident backstop).
 *
 * Pinned here:
 *
 *   1. FAIL-CLOSED CRON_SECRET auth gate (REG-118/REG-127 posture): missing
 *      secret, wrong secret, or unset env → 401 with ZERO DB I/O. Carrier
 *      precedence is first-PRESENT-wins (Bearer > x-cron-secret > ?token=).
 *
 *   2. DRIFT MATRIX against the CEO-approved posture
 *      (packages/lib/src/flags/protected-flags.ts). NOTE (2026-07-22 Phase 0
 *      flag-governance hardening): EXPECTED_OFF_FLAGS grew 53 → 55 with two
 *      constitution-pinned Pedagogy v2 flags (ff_productive_failure_v1,
 *      ff_pedagogy_v2_monthly_synthesis) added to the protected-flags
 *      registry; the watched set below is derived from EXPECTED_OFF_FLAGS
 *      directly, so this suite's length pin tracks that growth (54 → 56):
 *        - any EXPECTED_OFF flag with is_enabled=true OR rollout>0 → drift;
 *        - ff_atomic_subscription_activation disabled OR missing → drift
 *          (P11 kill-switch must exist and be enabled);
 *        - MoL shadow flags with metadata->>'enabled' = 'true' → drift even
 *          when their columns read OFF (metadata envelope is the real
 *          control surface);
 *        - absence of an EXPECTED_OFF row is NOT drift (unseeded envs);
 *        - clean state → { drift: [], count: 0 } and NO ops event / audit.
 *
 *   3. On drift: ONE ops_events row (severity 'error') + ONE audit_logs row
 *      (action feature_flag.posture_drift_detected, actor_role 'system',
 *      status 'failure').
 *
 *   4. P13 payload posture: the response and every drift entry carry flag
 *      names + state ONLY — a fixed key whitelist, no operator identity, no
 *      PII-shaped keys. DB failure → generic 500 'internal_error'.
 *
 *   5. Job-health heartbeat (ops review condition 1): recordCronJobHealth
 *      writes ops.cron.flag_posture_canary.last_success_at on BOTH the clean
 *      path and the drift path (drift detection IS a successful run); only
 *      genuine 500s and auth denials skip it. The helper is mocked here —
 *      the real one inserts into ops_events, which must not pollute the
 *      recording chain's feature_flags-only pins.
 *
 * The supabase-admin seam is a recording thenable chain (house pattern from
 * api/cron/adaptive-remediation.test.ts). EXPECTED_OFF_FLAGS is NOT mocked —
 * the route must watch the real 53-name list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { EXPECTED_OFF_FLAGS } from '@alfanumrik/lib/flags/protected-flags';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const logOpsEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => logOpsEventMock(...a),
}));

const auditLogMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/audit', () => ({
  auditLog: (...a: unknown[]) => auditLogMock(...a),
}));

const recordCronJobHealthMock = vi.fn().mockResolvedValue(true);
vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: (...a: unknown[]) => recordCronJobHealthMock(...a),
}));

// Recording thenable chain for supabaseAdmin.from('feature_flags').select().in()
interface Call {
  table: string;
  ops: Array<{ op: string; args: unknown[] }>;
}
const fromCalls: Call[] = [];
let dbResult: { data: unknown; error: unknown } = { data: [], error: null };

function makeChain(call: Call) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'eq', 'limit', 'order']) {
    chain[m] = (...args: unknown[]) => {
      call.ops.push({ op: m, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(() => dbResult)
      .then(resolve, reject);
  return chain;
}

const adminClient = {
  from: (table: string) => {
    const call: Call = { table, ops: [] };
    fromCalls.push(call);
    return makeChain(call);
  },
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = 'flag-posture-canary-secret-fixture';
const ATOMIC = 'ff_atomic_subscription_activation';

interface Row {
  flag_name: string;
  is_enabled: boolean;
  rollout_percentage: number | null;
  metadata: Record<string, unknown> | null;
}

const row = (
  flag_name: string,
  is_enabled: boolean,
  rollout_percentage: number | null = 0,
  metadata: Record<string, unknown> | null = null,
): Row => ({ flag_name, is_enabled, rollout_percentage, metadata });

/** The healthy baseline: P11 kill-switch present and enabled, nothing else on. */
const CLEAN_ROWS: Row[] = [row(ATOMIC, true, 0)];

function req(
  headers: Record<string, string> = {},
  url = 'http://localhost/api/cron/flag-posture-canary',
): NextRequest {
  return new NextRequest(url, { method: 'GET', headers });
}

async function loadRoute() {
  return import('@/app/api/cron/flag-posture-canary/route');
}

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  dbResult = { data: CLEAN_ROWS, error: null };
  process.env.CRON_SECRET = SECRET;
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Auth gate — fail-closed, deny BEFORE any DB I/O
// ════════════════════════════════════════════════════════════════════════════

describe('flag-posture-canary — auth gate (fail-closed before I/O)', () => {
  it('no secret carrier at all → 401 and ZERO DB reads, zero ops/audit', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(fromCalls).toHaveLength(0);
    expect(logOpsEventMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('wrong secret (x-cron-secret) → 401, zero DB reads', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it('CRON_SECRET env unset → 401 even with a matching header (fail-closed on misconfig)', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it('accepts Authorization: Bearer (the Vercel-cron carrier)', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
  });

  it('accepts x-cron-secret and ?token= carriers', async () => {
    const { GET } = await loadRoute();
    expect((await GET(req({ 'x-cron-secret': SECRET }))).status).toBe(200);
    expect(
      (await GET(req({}, `http://localhost/api/cron/flag-posture-canary?token=${SECRET}`))).status,
    ).toBe(200);
  });

  it('carrier precedence is first-PRESENT-wins: a wrong Bearer is NOT rescued by a correct x-cron-secret', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ authorization: 'Bearer wrong', 'x-cron-secret': SECRET }));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it('POST parity: the manual/ops trigger runs the same gate + canary', async () => {
    const { POST } = await loadRoute();
    const denied = await POST(
      new NextRequest('http://localhost/api/cron/flag-posture-canary', { method: 'POST' }),
    );
    expect(denied.status).toBe(401);
    const ok = await POST(
      new NextRequest('http://localhost/api/cron/flag-posture-canary', {
        method: 'POST',
        headers: { 'x-cron-secret': SECRET },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ drift: [], count: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Query shape — watches the real posture list
// ════════════════════════════════════════════════════════════════════════════

describe('flag-posture-canary — DB query shape', () => {
  it('reads feature_flags once, selecting state columns, .in() over the 56-name watched set (55 EXPECTED_OFF + the P11 kill-switch)', async () => {
    const { GET } = await loadRoute();
    await GET(req({ 'x-cron-secret': SECRET }));

    expect(fromCalls).toHaveLength(1);
    expect(fromCalls[0].table).toBe('feature_flags');
    const select = fromCalls[0].ops.find((o) => o.op === 'select');
    expect(select?.args[0]).toBe('flag_name,is_enabled,rollout_percentage,metadata');

    const inOp = fromCalls[0].ops.find((o) => o.op === 'in');
    expect(inOp?.args[0]).toBe('flag_name');
    const watched = inOp?.args[1] as string[];
    // 55 EXPECTED_OFF (53 + the two 2026-07-22 Pedagogy v2 additions) +
    // ff_atomic_subscription_activation; the two MoL shadow flags are already
    // members of EXPECTED_OFF, so the de-duped set is 56.
    expect(new Set(watched).size).toBe(watched.length);
    expect(watched).toHaveLength(56);
    for (const name of EXPECTED_OFF_FLAGS) expect(watched).toContain(name);
    expect(watched).toContain(ATOMIC);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Drift matrix
// ════════════════════════════════════════════════════════════════════════════

describe('flag-posture-canary — drift detection matrix', () => {
  async function run(rows: Row[]): Promise<{ status: number; body: { drift: Array<Record<string, unknown>>; count: number } }> {
    dbResult = { data: rows, error: null };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    return { status: res.status, body: await res.json() };
  }

  it('an EXPECTED_OFF flag re-armed (enabled at rollout 100 — the incident shape) → drift', async () => {
    const { status, body } = await run([...CLEAN_ROWS, row('ff_school_pulse_v1', true, 100)]);
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.drift[0]).toEqual({
      flag_name: 'ff_school_pulse_v1',
      expected: 'is_enabled=false, rollout_percentage=0',
      is_enabled: true,
      rollout_percentage: 100,
    });
  });

  it('an EXPECTED_OFF flag half-off (is_enabled=false but rollout>0) → still drift (posture is BOTH columns)', async () => {
    const { body } = await run([...CLEAN_ROWS, row('ff_mol_enabled', false, 50)]);
    expect(body.count).toBe(1);
    expect(body.drift[0].flag_name).toBe('ff_mol_enabled');
  });

  it('an EXPECTED_OFF flag off with rollout NULL → NOT drift (NULL coalesces to 0)', async () => {
    const { body } = await run([...CLEAN_ROWS, row('ff_tutor_v1', false, null)]);
    expect(body).toEqual({ drift: [], count: 0 });
  });

  it('an absent EXPECTED_OFF row is NOT drift (unseeded on non-prod environments)', async () => {
    // CLEAN_ROWS contains none of the 53 — only the kill-switch.
    const { body } = await run(CLEAN_ROWS);
    expect(body).toEqual({ drift: [], count: 0 });
  });

  it('ff_atomic_subscription_activation disabled → drift (P11 kill-switch must be enabled)', async () => {
    const { body } = await run([row(ATOMIC, false, 0)]);
    expect(body.count).toBe(1);
    expect(body.drift[0]).toMatchObject({
      flag_name: ATOMIC,
      expected: 'is_enabled=true',
      is_enabled: false,
    });
  });

  it('ff_atomic_subscription_activation MISSING entirely → drift with state:"missing"', async () => {
    const { body } = await run([]);
    expect(body.count).toBe(1);
    expect(body.drift[0]).toEqual({ flag_name: ATOMIC, expected: 'is_enabled=true', state: 'missing' });
  });

  it("MoL shadow flag with metadata enabled:'true' → drift even though its columns read OFF", async () => {
    const { body } = await run([
      ...CLEAN_ROWS,
      row('ff_grounded_answer_mol_shadow_v1', false, 0, { enabled: 'true' }),
    ]);
    expect(body.count).toBe(1);
    expect(body.drift[0]).toEqual({
      flag_name: 'ff_grounded_answer_mol_shadow_v1',
      expected: "metadata->>'enabled' != 'true'",
      metadata_enabled: 'true',
    });
  });

  it('MoL shadow flag with metadata enabled boolean true → drift (jsonb boolean stringifies)', async () => {
    const { body } = await run([
      ...CLEAN_ROWS,
      row('ff_mol_shadow_text_capture_v1', false, 0, { enabled: true }),
    ]);
    expect(body.count).toBe(1);
    expect(body.drift[0].flag_name).toBe('ff_mol_shadow_text_capture_v1');
  });

  it("MoL shadow flag with metadata enabled:'false' or no metadata → NOT drift", async () => {
    const { body } = await run([
      ...CLEAN_ROWS,
      row('ff_grounded_answer_mol_shadow_v1', false, 0, { enabled: 'false' }),
      row('ff_mol_shadow_text_capture_v1', false, 0, null),
    ]);
    expect(body).toEqual({ drift: [], count: 0 });
  });

  it('compound drift: multiple deviations are ALL reported with an accurate count', async () => {
    const { body } = await run([
      row(ATOMIC, false, 0), // kill-switch down
      row('ff_school_pulse_v1', true, 100), // re-armed
      row('ff_adaptive_remediation_v1', true, 100), // re-armed
    ]);
    expect(body.count).toBe(3);
    expect(body.drift.map((d) => d.flag_name).sort()).toEqual(
      ['ff_adaptive_remediation_v1', 'ff_school_pulse_v1', ATOMIC].sort(),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Drift side-effects + clean-run silence
// ════════════════════════════════════════════════════════════════════════════

describe('flag-posture-canary — drift side-effects', () => {
  it('drift → one ops_events row (severity error) + one audit row (system actor, failure status)', async () => {
    dbResult = { data: [...CLEAN_ROWS, row('ff_school_pulse_v1', true, 100)], error: null };
    const { GET } = await loadRoute();
    await GET(req({ 'x-cron-secret': SECRET }));

    expect(logOpsEventMock).toHaveBeenCalledTimes(1);
    expect(logOpsEventMock.mock.calls[0][0]).toMatchObject({
      source: 'cron/flag-posture-canary',
      severity: 'error',
      context: { count: 1 },
    });

    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0][0]).toMatchObject({
      actor_id: null,
      actor_role: 'system',
      action: 'feature_flag.posture_drift_detected',
      target_entity: 'feature_flags',
      status: 'failure',
      metadata: { count: 1 },
    });
  });

  it('clean run → NO ops event, NO audit row', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(await res.json()).toEqual({ drift: [], count: 0 });
    expect(logOpsEventMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. P13 payload posture + failure posture
// ════════════════════════════════════════════════════════════════════════════

describe('flag-posture-canary — payload posture (P13) and failure posture', () => {
  const ALLOWED_DRIFT_KEYS = new Set([
    'flag_name',
    'expected',
    'is_enabled',
    'rollout_percentage',
    'metadata_enabled',
    'state',
  ]);

  it('drift entries carry flag names + state ONLY: every key is on the fixed whitelist, response body is exactly {drift,count}', async () => {
    dbResult = {
      data: [
        row(ATOMIC, false, 0),
        row('ff_school_pulse_v1', true, 100),
        row('ff_grounded_answer_mol_shadow_v1', false, 0, { enabled: 'true' }),
      ],
      error: null,
    };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['count', 'drift']);
    for (const entry of body.drift as Array<Record<string, unknown>>) {
      for (const key of Object.keys(entry)) {
        expect(ALLOWED_DRIFT_KEYS.has(key), `unexpected drift key: ${key}`).toBe(true);
      }
    }
    // No operator identity / PII-shaped keys anywhere in the serialized body.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/email|phone|student|actor|user_id|updated_by/i);
  });

  it('feature_flags read failure → generic 500 internal_error, no ops event, no audit', async () => {
    dbResult = { data: null, error: { message: 'connection refused' } };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(500);
    // Exact-body equality doubles as the "never echo internals" pin — the
    // PostgREST error message cannot appear in a body that IS this object.
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(logOpsEventMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Job-health heartbeat (ops review condition 1)
// ════════════════════════════════════════════════════════════════════════════

describe('flag-posture-canary — cron job-health heartbeat', () => {
  const HEARTBEAT = {
    path: '/api/cron/flag-posture-canary',
    metric: 'ops.cron.flag_posture_canary.last_success_at',
    source: 'cron/flag-posture-canary',
  };

  it('clean run → records the heartbeat once (metric/path/source pinned, count 0)', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(recordCronJobHealthMock).toHaveBeenCalledTimes(1);
    expect(recordCronJobHealthMock.mock.calls[0][0]).toMatchObject({
      ...HEARTBEAT,
      context: { count: 0, drift_detected: false },
    });
    expect(typeof recordCronJobHealthMock.mock.calls[0][0].durationMs).toBe('number');
  });

  it('drift run → STILL records the heartbeat (drift detection IS a successful run)', async () => {
    dbResult = { data: [...CLEAN_ROWS, row('ff_school_pulse_v1', true, 100)], error: null };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(recordCronJobHealthMock).toHaveBeenCalledTimes(1);
    expect(recordCronJobHealthMock.mock.calls[0][0]).toMatchObject({
      ...HEARTBEAT,
      context: { count: 1, drift_detected: true },
    });
  });

  it('feature_flags read failure (genuine 500) → NO heartbeat', async () => {
    dbResult = { data: null, error: { message: 'connection refused' } };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(500);
    expect(recordCronJobHealthMock).not.toHaveBeenCalled();
  });

  it('unauthorized → NO heartbeat (auth denial is not a run)', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(recordCronJobHealthMock).not.toHaveBeenCalled();
  });
});
