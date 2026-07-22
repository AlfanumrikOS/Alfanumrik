/**
 * /api/cron/adaptive-loops-monitor — adaptive-loops creation-rate + escalation
 * + heartbeat monitor (Master Action Plan Phase 8, item 8.1).
 *
 * Pinned here:
 *   1. Fail-closed CRON_SECRET auth gate (house posture): missing/wrong secret
 *      or unset env → 401 with ZERO DB I/O, no ops event, no heartbeat.
 *   2. Pure threshold evaluation (evaluateAdaptiveLoopsAlerts): ceiling>0 →
 *      critical, escalation share>50% (over a min sample) → error, heartbeat
 *      >26h or never → critical. Thresholds are the runbook's, not invented.
 *   3. The route emits ONE ops_events row per fired condition with the right
 *      category/source/severity, records its own job-health heartbeat, and
 *      returns an AGGREGATE-ONLY body (no student ids / PII-shaped keys).
 *   4. RPC failure → generic 500, no ops event, no heartbeat.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  evaluateAdaptiveLoopsAlerts,
  type AdaptiveLoopsHealth,
} from '@/app/api/cron/adaptive-loops-monitor/_lib/evaluate-alerts';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const logOpsEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => logOpsEventMock(...a),
}));

const recordCronJobHealthMock = vi.fn().mockResolvedValue(true);
vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: (...a: unknown[]) => recordCronJobHealthMock(...a),
}));

const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const adminClient = {
  rpc: (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(rpcResult);
  },
};
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SECRET = 'adaptive-loops-monitor-secret-fixture';

/** A perfectly healthy snapshot: no ceiling breach, low escalation, fresh cron. */
function healthyFixture(over: Partial<AdaptiveLoopsHealth> = {}): AdaptiveLoopsHealth {
  return {
    window_hours: 24,
    storm_days: 30,
    daily_new_by_signal: {
      mastery_cliff: 5,
      inactivity: 2,
      at_risk_concentration: 1,
      blocked_prerequisite: 0,
    },
    daily_new_total: 8,
    ceiling_violation_count: 0,
    ceiling_violation_students: 0,
    terminal_total: 40,
    escalation_total: 8,
    escalation_share: 0.2,
    last_success_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    hours_since_last_success: 2,
    generated_at: new Date().toISOString(),
    ...over,
  };
}

function req(
  headers: Record<string, string> = {},
  url = 'http://localhost/api/cron/adaptive-loops-monitor',
): NextRequest {
  return new NextRequest(url, { method: 'GET', headers });
}

async function loadRoute() {
  return import('@/app/api/cron/adaptive-loops-monitor/route');
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  rpcResult = { data: healthyFixture(), error: null };
  process.env.CRON_SECRET = SECRET;
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Pure threshold evaluation (runbook-sourced thresholds)
// ════════════════════════════════════════════════════════════════════════════

describe('evaluateAdaptiveLoopsAlerts — pure threshold logic', () => {
  it('healthy snapshot → no alerts', () => {
    expect(evaluateAdaptiveLoopsAlerts(healthyFixture())).toEqual([]);
  });

  it('ceiling_violation_count > 0 → critical ceiling alert (threshold is 0)', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({ ceiling_violation_count: 1, ceiling_violation_students: 1 }),
    );
    const ceiling = alerts.find((a) => a.kind === 'ceiling_violation');
    expect(ceiling).toBeDefined();
    expect(ceiling!.severity).toBe('critical');
    expect(ceiling!.category).toBe('adaptive_ceiling_violation');
    expect(ceiling!.context).toMatchObject({ ceiling_violation_count: 1, ceiling_violation_students: 1 });
  });

  it('escalation share > 50% over a sufficient sample → error storm alert', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({ terminal_total: 20, escalation_total: 11, escalation_share: 0.55 }),
    );
    const storm = alerts.find((a) => a.kind === 'escalation_storm');
    expect(storm).toBeDefined();
    expect(storm!.severity).toBe('error');
    expect(storm!.category).toBe('adaptive_escalation_storm');
  });

  it('escalation share > 50% but sample below the noise floor → NO storm alert', () => {
    // 1-of-1 = 100% but only 1 terminal outcome (< 10 min sample).
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({ terminal_total: 1, escalation_total: 1, escalation_share: 1 }),
    );
    expect(alerts.find((a) => a.kind === 'escalation_storm')).toBeUndefined();
  });

  it('escalation share exactly 50% → NOT a storm (threshold is strictly greater)', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({ terminal_total: 20, escalation_total: 10, escalation_share: 0.5 }),
    );
    expect(alerts.find((a) => a.kind === 'escalation_storm')).toBeUndefined();
  });

  it('heartbeat > 26h stale → critical heartbeat alert', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({
        hours_since_last_success: 30,
        last_success_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
      }),
    );
    const hb = alerts.find((a) => a.kind === 'heartbeat_stale');
    expect(hb).toBeDefined();
    expect(hb!.severity).toBe('critical');
    expect(hb!.category).toBe('adaptive_cron_stale');
  });

  it('heartbeat never recorded (null) → critical heartbeat alert', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({ hours_since_last_success: null, last_success_at: null }),
    );
    expect(alerts.find((a) => a.kind === 'heartbeat_stale')).toBeDefined();
  });

  it('heartbeat exactly 26h → NOT stale (bound is strictly greater)', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(healthyFixture({ hours_since_last_success: 26 }));
    expect(alerts.find((a) => a.kind === 'heartbeat_stale')).toBeUndefined();
  });

  it('all three conditions can fire together', () => {
    const alerts = evaluateAdaptiveLoopsAlerts(
      healthyFixture({
        ceiling_violation_count: 3,
        ceiling_violation_students: 2,
        terminal_total: 30,
        escalation_total: 20,
        escalation_share: 0.6667,
        hours_since_last_success: null,
        last_success_at: null,
      }),
    );
    expect(alerts.map((a) => a.kind).sort()).toEqual(
      ['ceiling_violation', 'escalation_storm', 'heartbeat_stale'].sort(),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Auth gate — fail-closed, deny BEFORE any DB I/O
// ════════════════════════════════════════════════════════════════════════════

describe('adaptive-loops-monitor — auth gate (fail-closed before I/O)', () => {
  it('no secret carrier → 401, ZERO rpc calls, no ops event, no heartbeat', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(rpcCalls).toHaveLength(0);
    expect(logOpsEventMock).not.toHaveBeenCalled();
    expect(recordCronJobHealthMock).not.toHaveBeenCalled();
  });

  it('wrong secret → 401, zero rpc calls', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it('CRON_SECRET env unset → 401 even with a matching header', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it('accepts Bearer, x-cron-secret, and ?token= carriers', async () => {
    const { GET } = await loadRoute();
    expect((await GET(req({ authorization: `Bearer ${SECRET}` }))).status).toBe(200);
    expect((await GET(req({ 'x-cron-secret': SECRET }))).status).toBe(200);
    expect(
      (await GET(req({}, `http://localhost/api/cron/adaptive-loops-monitor?token=${SECRET}`))).status,
    ).toBe(200);
  });

  it('first-present-wins: a wrong Bearer is NOT rescued by a correct x-cron-secret', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ authorization: 'Bearer wrong', 'x-cron-secret': SECRET }));
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Monitor behavior — RPC read, ops-event emission, heartbeat, body shape
// ════════════════════════════════════════════════════════════════════════════

describe('adaptive-loops-monitor — monitor behavior', () => {
  it('healthy run → reads the RPC once, emits NO ops event, records own heartbeat', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('get_adaptive_loops_health');
    expect(rpcCalls[0].args).toEqual({ p_window_hours: 24, p_storm_days: 30 });

    expect(logOpsEventMock).not.toHaveBeenCalled();
    expect(recordCronJobHealthMock).toHaveBeenCalledTimes(1);
    expect(recordCronJobHealthMock.mock.calls[0][0]).toMatchObject({
      path: '/api/cron/adaptive-loops-monitor',
      metric: 'ops.cron.adaptive_loops_monitor.last_success_at',
      source: 'cron/adaptive-loops-monitor',
      context: { alerts_fired: 0 },
    });
  });

  it('ceiling violation → one critical ops_events row, source cron/adaptive-loops-monitor', async () => {
    rpcResult = { data: healthyFixture({ ceiling_violation_count: 2, ceiling_violation_students: 1 }), error: null };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);

    expect(logOpsEventMock).toHaveBeenCalledTimes(1);
    expect(logOpsEventMock.mock.calls[0][0]).toMatchObject({
      category: 'adaptive_ceiling_violation',
      source: 'cron/adaptive-loops-monitor',
      severity: 'critical',
      context: { ceiling_violation_count: 2, ceiling_violation_students: 1 },
    });
    // Heartbeat still recorded — the monitor itself ran successfully.
    expect(recordCronJobHealthMock).toHaveBeenCalledTimes(1);
    expect(recordCronJobHealthMock.mock.calls[0][0].context).toMatchObject({ alerts_fired: 1 });
  });

  it('storm + stale heartbeat → two ops_events rows with the right categories/severities', async () => {
    rpcResult = {
      data: healthyFixture({
        terminal_total: 30,
        escalation_total: 20,
        escalation_share: 0.6667,
        hours_since_last_success: 40,
        last_success_at: new Date(Date.now() - 40 * 3600_000).toISOString(),
      }),
      error: null,
    };
    const { GET } = await loadRoute();
    await GET(req({ 'x-cron-secret': SECRET }));

    expect(logOpsEventMock).toHaveBeenCalledTimes(2);
    const byCategory = Object.fromEntries(
      logOpsEventMock.mock.calls.map((c) => [(c[0] as { category: string }).category, c[0]]),
    );
    expect(byCategory['adaptive_escalation_storm']).toMatchObject({ severity: 'error', source: 'cron/adaptive-loops-monitor' });
    expect(byCategory['adaptive_cron_stale']).toMatchObject({ severity: 'critical', source: 'cron/adaptive-loops-monitor' });
  });

  it('response body is aggregate-only — no student/PII-shaped keys', async () => {
    rpcResult = { data: healthyFixture({ ceiling_violation_count: 4, ceiling_violation_students: 3 }), error: null };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.health.ceiling_violation_count).toBe(4);
    expect(Array.isArray(body.data.alerts_fired)).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/student_id|auth_user_id|email|phone|"name"/i);
  });

  it('RPC error → generic 500, no ops event, no heartbeat', async () => {
    rpcResult = { data: null, error: { message: 'connection refused' } };
    const { GET } = await loadRoute();
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(logOpsEventMock).not.toHaveBeenCalled();
    expect(recordCronJobHealthMock).not.toHaveBeenCalled();
  });

  it('POST parity: same gate + monitor', async () => {
    const { POST } = await loadRoute();
    const denied = await POST(new NextRequest('http://localhost/api/cron/adaptive-loops-monitor', { method: 'POST' }));
    expect(denied.status).toBe(401);
    const ok = await POST(
      new NextRequest('http://localhost/api/cron/adaptive-loops-monitor', {
        method: 'POST',
        headers: { 'x-cron-secret': SECRET },
      }),
    );
    expect(ok.status).toBe(200);
  });
});
