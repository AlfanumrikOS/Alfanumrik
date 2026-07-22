/**
 * GET/POST /api/cron/synthesis-delivery-monitor — Phase 8 item 8.4.
 *
 * Covers: fail-closed cron-secret auth (before any DB I/O), the pure rollup
 * math, the >20%/>=5-attempts breach gate (emits ONE critical ops_event), the
 * no-breach path (no ops_event), and the P13 posture (ops_event + JSON body
 * carry counts only — never run/student ids, phone, or summary text).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CRON_SECRET = 'cron-secret-fixture';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const _opsEvent = vi.fn();
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => _opsEvent(...args),
}));

const _cronHealth = vi.fn();
vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: (...args: unknown[]) => _cronHealth(...args),
}));

type Stub = { data: unknown; error: unknown };
let _rows: Stub = { data: [], error: null };
function setRows(s: Stub) { _rows = s; }

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      // terminal .gte('created_at', cutoff) resolves the query
      gte: vi.fn(() => Promise.resolve(_rows)),
    })),
  },
}));

function makeReq(headers: Record<string, string> = {}, query = ''): Request {
  return new Request(`http://localhost/api/cron/synthesis-delivery-monitor${query}`, {
    method: 'POST',
    headers,
  });
}

function statusRows(counts: Record<string, number>): { parent_share_status: string }[] {
  const out: { parent_share_status: string }[] = [];
  for (const [status, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push({ parent_share_status: status });
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  _rows = { data: [], error: null };
  _opsEvent.mockReset();
  _cronHealth.mockReset();
});

describe('POST /api/cron/synthesis-delivery-monitor', () => {
  it('returns 401 when no secret (before any DB I/O)', async () => {
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
    expect(_opsEvent).not.toHaveBeenCalled();
  });

  it('returns 401 when secret is wrong', async () => {
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq({ 'x-cron-secret': 'nope-wrong-length' }) as never);
    expect(res.status).toBe(401);
  });

  it('computes failure_rate and does NOT breach at 20% with 5 attempts', async () => {
    // 1 failed / 5 attempts = 20% — NOT strictly > 20 → no breach.
    setRows({ data: statusRows({ sent: 4, failed: 1 }), error: null });
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.failure_rate_pct).toBe(20);
    expect(body.attempts).toBe(5);
    expect(body.breached).toBe(false);
    expect(_opsEvent).not.toHaveBeenCalled();
    expect(_cronHealth).toHaveBeenCalledTimes(1); // heartbeat still fires
  });

  it('breaches (>20% AND >=5 attempts) and emits ONE critical ops_event', async () => {
    // 3 failed / 6 attempts = 50% > 20, attempts 6 >= 5 → breach.
    setRows({ data: statusRows({ sent: 3, failed: 3, opted_out: 2 }), error: null });
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.breached).toBe(true);
    expect(body.failure_rate_pct).toBe(50);
    expect(_opsEvent).toHaveBeenCalledTimes(1);
    const evt = _opsEvent.mock.calls[0][0] as {
      category: string; source: string; severity: string; context: Record<string, unknown>;
    };
    expect(evt.category).toBe('notifications');
    expect(evt.source).toBe('cron/synthesis-delivery-monitor');
    expect(evt.severity).toBe('critical');
    // P13: context is counts only — no run/student ids, no phone, no PII keys.
    const ctxKeys = Object.keys(evt.context);
    expect(ctxKeys).not.toContain('student_id');
    expect(ctxKeys).not.toContain('run_id');
    const serialized = JSON.stringify(evt);
    expect(serialized).not.toMatch(/phone|email|summary_text|name/i);
  });

  it('does NOT breach below the 5-attempt floor even at 100% failure', async () => {
    setRows({ data: statusRows({ failed: 4 }), error: null }); // 100% but only 4 attempts
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.failure_rate_pct).toBe(100);
    expect(body.breached).toBe(false);
    expect(_opsEvent).not.toHaveBeenCalled();
  });

  it('handles an empty window (no attempts) without breaching', async () => {
    setRows({ data: statusRows({ pending: 3 }), error: null });
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.failure_rate_pct).toBeNull();
    expect(body.breached).toBe(false);
    expect(body.pending).toBe(3);
  });

  it('returns 500 (generic) on DB error, no ops_event, no heartbeat', async () => {
    setRows({ data: null, error: { message: 'boom' } });
    const { POST } = await import('@/app/api/cron/synthesis-delivery-monitor/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('internal_error'); // never leaks the DB message
    expect(_opsEvent).not.toHaveBeenCalled();
    expect(_cronHealth).not.toHaveBeenCalled();
  });
});

describe('computeRollup (pure)', () => {
  it('rounds failure_rate and ignores unknown statuses without crashing', async () => {
    const { computeRollup } = await import('@/app/api/cron/synthesis-delivery-monitor/_lib/compute-rollup');
    const r = computeRollup([
      { parent_share_status: 'sent' },
      { parent_share_status: 'failed' },
      { parent_share_status: 'failed' },
      { parent_share_status: 'weird_future_status' },
    ]);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.attempts).toBe(3);
    expect(r.failure_rate_pct).toBe(67); // round(2/3*100)
  });
});
