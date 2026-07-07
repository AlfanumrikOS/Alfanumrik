/**
 * GET /api/super-admin/mol-shadow tests (C4.2b-iii / 2026-05-19).
 *
 * Pins the contract for the MOL shadow-routing observability route:
 *
 *   - Auth gate: super_admin.access — denied → 401, no DB call.
 *   - Empty data: returns zero counts gracefully when no shadow rows exist
 *     and the flags row is absent (cold-start state, canary not flipped).
 *   - Happy path: aggregates flags, daily rollups, cost delta per task type,
 *     per-dimension quality means (citation_accuracy excludes null rows),
 *     winner distribution, latency rollups from the health view, fallback
 *     rate per task type, sample coverage, and the latest graded pairs.
 *   - P13 redaction: the response shape NEVER contains question_text,
 *     baseline_response_text, or shadow_response_text. The route does
 *     not even select those columns.
 *   - Audit: a single audit_logs row is written per successful GET with
 *     action='mol_shadow_dashboard_viewed'.
 *
 * Mocking pattern mirrors the other super-admin route tests in this dir —
 * a chainable Supabase mock that branches by table/view name and yields
 * per-table results set up in beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (hoisted before route import) ──────────────────────────────────

const mockAuthorizeRequest = vi.fn();
const mockLogAudit = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorizeRequest(...args),
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Per-table result buckets, set up in beforeEach.
const supabaseResults: Record<string, { data: unknown; error: unknown }> = {
  feature_flags: { data: [], error: null },
  mol_request_logs: { data: [], error: null },
  mol_request_health_24h: { data: [], error: null },
};

function setResult(table: string, data: unknown, error: unknown = null) {
  supabaseResults[table] = { data, error };
}

function makeChainable(table: string) {
  // Chainable that awaits to the per-table result. All filter calls return
  // the chain itself; `.then` resolves the Promise to the canned result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  // audit_logs is write-only here — INSERT chains return immediately.
  chain.insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve: (r: unknown) => unknown) => {
    const result = supabaseResults[table] ?? { data: [], error: null };
    return Promise.resolve(result).then(resolve);
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeChainable(table)),
  },
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => makeChainable(table)),
  }),
}));

// ─── Auth fixtures ────────────────────────────────────────────────────────

const ADMIN_UID = '11111111-1111-1111-1111-111111111111';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED_401 = () => ({
  authorized: false as const,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
});

const AUTH_DENIED_403 = () => ({
  authorized: false as const,
  userId: '22222222-2222-2222-2222-222222222222',
  studentId: null,
  roles: ['student'],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  }),
});

function buildRequest(): Request {
  return new Request('http://localhost/api/super-admin/mol-shadow', {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setResult('feature_flags', []);
  setResult('mol_request_logs', []);
  setResult('mol_request_health_24h', []);
});

// ─── 1. Auth ──────────────────────────────────────────────────────────────

describe('GET /api/super-admin/mol-shadow: auth', () => {
  it('returns 401 when authorizeRequest denies with 401', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(401);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is authenticated but not super-admin', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_403());
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(403);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('asks authorizeRequest for the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    await GET(buildRequest() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'super_admin.access',
    );
  });
});

// ─── 2. Empty-data shape ──────────────────────────────────────────────────

describe('GET /api/super-admin/mol-shadow: empty / cold-start', () => {
  it('200 with zeroed counts when no rows exist anywhere', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(body.data.daily).toEqual({
      shadow_cost_inr: 0,
      shadow_cost_cap_inr: 10000,
      grader_cost_inr: 0,
      grader_cost_cap_inr: 5000,
      shadow_rows_24h: 0,
      graded_pairs_24h: 0,
    });
    expect(body.data.flags.shadow).toEqual({
      enabled: false,
      kill_switch: false,
      rollout_pct: 0,
      task_types: [],
    });
    expect(body.data.flags.text_capture).toEqual({ enabled: false });
    expect(body.data.cost_delta).toEqual([]);
    expect(body.data.latency).toEqual([]);
    expect(body.data.fallback).toEqual([]);
    expect(body.data.sample_coverage).toEqual([]);
    expect(body.data.recent).toEqual([]);
    expect(body.data.quality.n_graded_7d).toBe(0);
    expect(body.data.quality.overall_mean).toBeNull();
    expect(body.data.quality.winner_distribution).toEqual({
      baseline: 0,
      shadow: 0,
      tie: 0,
    });
    // Per-dimension means must be null when no graded rows exist.
    for (const v of Object.values(body.data.quality.per_dimension_avg)) {
      expect(v).toBeNull();
    }

    // Audit row written exactly once.
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      ADMIN_UID,
      expect.objectContaining({
        action: 'mol_shadow_dashboard_viewed',
        resourceType: 'mol_shadow',
        status: 'success',
      }),
    );
  });

  it('thresholds are surfaced for the UI to colour cells', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.thresholds).toEqual({
      latency_warn_delta_ms: 200,
      fallback_warn_pct: 2.0,
      coverage_warn_pct: 80,
    });
  });
});

// ─── 3. Flags & cost rollups ──────────────────────────────────────────────

describe('GET /api/super-admin/mol-shadow: flags + cost rollups', () => {
  it('projects the shadow flag envelope from feature_flags.metadata', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('feature_flags', [
      {
        flag_name: 'ff_grounded_answer_mol_shadow_v1',
        is_enabled: true,
        metadata: {
          enabled: true,
          kill_switch: false,
          rollout_pct: 25,
          task_types: ['explanation', 'doubt_solving'],
        },
      },
      {
        flag_name: 'ff_mol_shadow_text_capture_v1',
        is_enabled: true,
        metadata: { enabled: true },
      },
    ]);

    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.data.flags.shadow).toEqual({
      enabled: true,
      kill_switch: false,
      rollout_pct: 25,
      task_types: ['explanation', 'doubt_solving'],
    });
    expect(body.data.flags.text_capture).toEqual({ enabled: true });
  });

  it('honours kill_switch=true in metadata', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('feature_flags', [
      {
        flag_name: 'ff_grounded_answer_mol_shadow_v1',
        is_enabled: true,
        metadata: { enabled: true, kill_switch: true, rollout_pct: 100 },
      },
    ]);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.flags.shadow.kill_switch).toBe(true);
  });

  it('falls back to is_enabled when metadata.enabled is missing', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('feature_flags', [
      {
        flag_name: 'ff_grounded_answer_mol_shadow_v1',
        is_enabled: true,
        metadata: { rollout_pct: 10 },
      },
    ]);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.flags.shadow.enabled).toBe(true);
    expect(body.data.flags.shadow.rollout_pct).toBe(10);
  });

  it('sums today shadow + grader costs separately and bounds 24h volume', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const nowIso = new Date().toISOString();
    setResult('mol_request_logs', [
      // 2 shadow rows today (explanation) — counts toward shadow_cost_today.
      makeLogRow({
        request_id: 's1',
        shadow_role: 'shadow',
        task_type: 'explanation',
        inr_cost: 1.2345,
        created_at: nowIso,
      }),
      makeLogRow({
        request_id: 's2',
        shadow_role: 'shadow',
        task_type: 'explanation',
        inr_cost: 0.5,
        created_at: nowIso,
      }),
      // Grader-overhead row (cron's Sonnet spend).
      makeLogRow({
        request_id: 'g1',
        shadow_role: 'shadow',
        task_type: 'grader_overhead',
        inr_cost: 10.0,
        created_at: nowIso,
      }),
      // Baseline rows do NOT count toward the shadow rollups.
      makeLogRow({
        request_id: 'b1',
        shadow_role: 'baseline',
        task_type: 'explanation',
        inr_cost: 99.0,
        created_at: nowIso,
      }),
    ]);

    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.data.daily.shadow_cost_inr).toBeCloseTo(1.7345, 4);
    expect(body.data.daily.grader_cost_inr).toBeCloseTo(10.0, 4);
    // shadow_rows_24h counts ALL shadow rows (including grader overhead).
    expect(body.data.daily.shadow_rows_24h).toBe(3);
  });
});

// ─── 4. Cost delta, quality, latency, fallback, coverage, recent ──────────

describe('GET /api/super-admin/mol-shadow: aggregations', () => {
  it('builds cost_delta from paired baseline ↔ shadow rows', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const ts = new Date().toISOString();
    setResult('mol_request_logs', [
      makeLogRow({
        request_id: 'b1',
        shadow_role: 'baseline',
        task_type: 'explanation',
        inr_cost: 1.0,
        created_at: ts,
      }),
      makeLogRow({
        request_id: 's1',
        shadow_role: 'shadow',
        shadow_of_request_id: 'b1',
        task_type: 'explanation',
        inr_cost: 0.4,
        created_at: ts,
      }),
      makeLogRow({
        request_id: 'b2',
        shadow_role: 'baseline',
        task_type: 'explanation',
        inr_cost: 2.0,
        created_at: ts,
      }),
      makeLogRow({
        request_id: 's2',
        shadow_role: 'shadow',
        shadow_of_request_id: 'b2',
        task_type: 'explanation',
        inr_cost: 0.8,
        created_at: ts,
      }),
    ]);

    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.cost_delta).toHaveLength(1);
    const row = body.data.cost_delta[0];
    expect(row.task_type).toBe('explanation');
    expect(row.n_pairs).toBe(2);
    expect(row.baseline_inr_avg).toBeCloseTo(1.5, 4);
    expect(row.shadow_inr_avg).toBeCloseTo(0.6, 4);
    expect(row.delta_inr).toBeCloseTo(-0.9, 4);
    expect(row.delta_pct).toBeCloseTo(-60, 1);
  });

  it('quality means: averages per dimension and excludes null citation_accuracy', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const ts = new Date().toISOString();
    setResult('mol_request_logs', [
      makeLogRow({
        request_id: 'b1',
        shadow_role: 'baseline',
        task_type: 'doubt_solving',
        inr_cost: 1.0,
        created_at: ts,
      }),
      makeLogRow({
        request_id: 's1',
        shadow_role: 'shadow',
        shadow_of_request_id: 'b1',
        task_type: 'doubt_solving',
        inr_cost: 0.5,
        created_at: ts,
        shadow_grader_score: 0.8,
        shadow_grader_payload: {
          shadow: {
            accuracy: 0.9,
            cbse_scope: 0.8,
            age_appropriateness: 0.7,
            scaffold_fidelity: 0.6,
            helpfulness: 0.8,
            citation_accuracy: 0.5,
          },
          winner: 'shadow',
        },
      }),
      makeLogRow({
        request_id: 'b2',
        shadow_role: 'baseline',
        task_type: 'doubt_solving',
        inr_cost: 1.0,
        created_at: ts,
      }),
      makeLogRow({
        request_id: 's2',
        shadow_role: 'shadow',
        shadow_of_request_id: 'b2',
        task_type: 'doubt_solving',
        inr_cost: 0.5,
        created_at: ts,
        shadow_grader_score: 0.6,
        shadow_grader_payload: {
          shadow: {
            accuracy: 0.7,
            cbse_scope: 0.6,
            age_appropriateness: 0.5,
            scaffold_fidelity: 0.4,
            helpfulness: 0.6,
            // citation_accuracy null — should drop from the mean.
            citation_accuracy: null,
          },
          winner: 'baseline',
        },
      }),
    ]);

    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.quality.n_graded_7d).toBe(2);
    expect(body.data.quality.overall_mean).toBeCloseTo(0.7, 4);
    expect(body.data.quality.per_dimension_avg.accuracy).toBeCloseTo(0.8, 4);
    expect(body.data.quality.per_dimension_avg.cbse_scope).toBeCloseTo(0.7, 4);
    expect(body.data.quality.per_dimension_avg.age_appropriateness).toBeCloseTo(0.6, 4);
    expect(body.data.quality.per_dimension_avg.scaffold_fidelity).toBeCloseTo(0.5, 4);
    expect(body.data.quality.per_dimension_avg.helpfulness).toBeCloseTo(0.7, 4);
    // Only one non-null citation row → mean = 0.5 (the non-null one).
    expect(body.data.quality.per_dimension_avg.citation_accuracy).toBeCloseTo(0.5, 4);
    expect(body.data.quality.winner_distribution).toEqual({
      baseline: 1,
      shadow: 1,
      tie: 0,
    });
  });

  it('latency rollups: weighted average across hourly buckets', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('mol_request_health_24h', [
      {
        hour: '2026-05-19T01:00:00Z',
        provider: 'anthropic',
        task_type: 'explanation',
        shadow_role: 'baseline',
        n_requests: 10,
        n_failures: 0,
        p50_latency_ms: 500,
        p95_latency_ms: 1000,
        inr_cost_sum: 1.0,
      },
      {
        hour: '2026-05-19T02:00:00Z',
        provider: 'anthropic',
        task_type: 'explanation',
        shadow_role: 'baseline',
        n_requests: 30,
        n_failures: 1,
        p50_latency_ms: 700,
        p95_latency_ms: 1400,
        inr_cost_sum: 3.0,
      },
      {
        hour: '2026-05-19T01:00:00Z',
        provider: 'openai',
        task_type: 'explanation',
        shadow_role: 'shadow',
        n_requests: 10,
        n_failures: 0,
        p50_latency_ms: 600,
        p95_latency_ms: 1300,
        inr_cost_sum: 0.5,
      },
    ]);

    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    const baseline = body.data.latency.find(
      (r: { provider: string; shadow_role: string | null }) =>
        r.provider === 'anthropic' && r.shadow_role === 'baseline',
    );
    expect(baseline).toBeDefined();
    expect(baseline.n_requests).toBe(40);
    // p50 = (500*10 + 700*30) / 40 = 650
    expect(baseline.p50_ms).toBe(650);
    // p95 = (1000*10 + 1400*30) / 40 = 1300
    expect(baseline.p95_ms).toBe(1300);
  });

  it('fallback rate: failures over total per task type', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('mol_request_health_24h', [
      {
        hour: '2026-05-19T01:00:00Z',
        provider: 'anthropic',
        task_type: 'explanation',
        shadow_role: 'baseline',
        n_requests: 100,
        n_failures: 5,
        p50_latency_ms: 500,
        p95_latency_ms: 1000,
        inr_cost_sum: 1.0,
      },
      {
        hour: '2026-05-19T01:00:00Z',
        provider: 'openai',
        task_type: 'explanation',
        shadow_role: 'shadow',
        n_requests: 100,
        n_failures: 1,
        p50_latency_ms: 600,
        p95_latency_ms: 1100,
        inr_cost_sum: 0.5,
      },
    ]);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.fallback).toHaveLength(1);
    expect(body.data.fallback[0].task_type).toBe('explanation');
    expect(body.data.fallback[0].n_requests).toBe(200);
    expect(body.data.fallback[0].n_failures).toBe(6);
    expect(body.data.fallback[0].failure_rate_pct).toBe(3); // 6/200 = 3%
  });

  it('sample_coverage: graded / ungraded / skipped buckets per task type', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const ts = new Date().toISOString();
    setResult('mol_request_logs', [
      // 2 graded, 1 ungraded, 1 skipped_no_text on explanation.
      makeLogRow({
        request_id: 's1',
        shadow_role: 'shadow',
        task_type: 'explanation',
        inr_cost: 0.5,
        created_at: ts,
        shadow_grader_score: 0.7,
      }),
      makeLogRow({
        request_id: 's2',
        shadow_role: 'shadow',
        task_type: 'explanation',
        inr_cost: 0.5,
        created_at: ts,
        shadow_grader_score: 0.8,
      }),
      makeLogRow({
        request_id: 's3',
        shadow_role: 'shadow',
        task_type: 'explanation',
        inr_cost: 0.5,
        created_at: ts,
      }),
      makeLogRow({
        request_id: 's4',
        shadow_role: 'shadow',
        task_type: 'explanation',
        inr_cost: 0.5,
        created_at: ts,
        shadow_grader_payload: { skipped: 'no_text' },
      }),
    ]);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    const cov = body.data.sample_coverage.find(
      (r: { task_type: string }) => r.task_type === 'explanation',
    );
    expect(cov).toBeDefined();
    expect(cov.graded).toBe(2);
    expect(cov.ungraded).toBe(1);
    expect(cov.skipped_no_text).toBe(1);
    expect(cov.total).toBe(4);
    expect(cov.graded_pct).toBe(50);
  });

  it('recent: newest-first, capped, includes Δ latency and Δ cost', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const t1 = '2026-05-19T01:00:00.000Z';
    const t2 = '2026-05-19T02:00:00.000Z';
    setResult('mol_request_logs', [
      makeLogRow({
        request_id: 'b1',
        shadow_role: 'baseline',
        task_type: 'doubt_solving',
        inr_cost: 1.0,
        latency_ms: 500,
        created_at: t1,
      }),
      makeLogRow({
        request_id: 's1',
        shadow_role: 'shadow',
        shadow_of_request_id: 'b1',
        task_type: 'doubt_solving',
        inr_cost: 0.4,
        latency_ms: 700,
        created_at: t1,
        shadow_grader_score: 0.85,
        shadow_grader_payload: { winner: 'shadow' },
        shadow_graded_at: t2,
      }),
    ]);

    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.recent).toHaveLength(1);
    const r = body.data.recent[0];
    expect(r.shadow_request_id).toBe('s1');
    expect(r.baseline_request_id).toBe('b1');
    expect(r.shadow_grader_score).toBeCloseTo(0.85, 4);
    expect(r.winner).toBe('shadow');
    expect(r.latency_delta_ms).toBe(200); // 700 - 500
    expect(r.cost_delta_inr).toBeCloseTo(-0.6, 4); // 0.4 - 1.0
    expect(r.graded_at).toBe(t2);
  });
});

// ─── 5. P13 — no text fields ever appear in the response ─────────────────

describe('GET /api/super-admin/mol-shadow: P13 redaction', () => {
  it('response shape contains no question/answer text fields', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('mol_request_logs', [
      makeLogRow({
        request_id: 'b1',
        shadow_role: 'baseline',
        task_type: 'doubt_solving',
        inr_cost: 1.0,
        created_at: new Date().toISOString(),
      }),
      makeLogRow({
        request_id: 's1',
        shadow_role: 'shadow',
        shadow_of_request_id: 'b1',
        task_type: 'doubt_solving',
        inr_cost: 0.5,
        created_at: new Date().toISOString(),
        shadow_grader_score: 0.9,
        shadow_grader_payload: {
          shadow: {
            accuracy: 0.9,
            cbse_scope: 0.8,
            age_appropriateness: 0.7,
            scaffold_fidelity: 0.8,
            helpfulness: 0.85,
            citation_accuracy: 0.9,
          },
          winner: 'shadow',
        },
      }),
    ]);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    // Forbidden keys per P13.
    expect(serialized).not.toContain('question_text');
    expect(serialized).not.toContain('baseline_response_text');
    expect(serialized).not.toContain('shadow_response_text');
    expect(serialized).not.toContain('baseline_system_prompt');
    expect(serialized).not.toContain('shadow_system_prompt');
  });

  it('does not SELECT against mol_shadow_text_buffer', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { supabaseAdmin } = await import('@alfanumrik/lib/supabase-admin');
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    await GET(buildRequest() as never);
    const calls = (supabaseAdmin.from as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(calls).not.toContain('mol_shadow_text_buffer');
  });
});

// ─── 6. Audit row ─────────────────────────────────────────────────────────

describe('GET /api/super-admin/mol-shadow: audit', () => {
  it('writes exactly one audit_logs row on successful GET', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    await GET(buildRequest() as never);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    const [actor, entry] = mockLogAudit.mock.calls[0];
    expect(actor).toBe(ADMIN_UID);
    expect(entry.action).toBe('mol_shadow_dashboard_viewed');
    expect(entry.resourceType).toBe('mol_shadow');
    expect(entry.status).toBe('success');
    expect(entry.details).toEqual(
      expect.objectContaining({
        generated_at: expect.any(String),
        shadow_rows_24h: expect.any(Number),
        graded_pairs_24h: expect.any(Number),
      }),
    );
  });
});

// ─── 7. Error handling ────────────────────────────────────────────────────

describe('GET /api/super-admin/mol-shadow: errors', () => {
  it('returns 500 when mol_request_logs read errors', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('mol_request_logs', null, { message: 'connection refused' });
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('DB_ERROR');
    // No audit on the failure path.
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('returns 500 when feature_flags read errors', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult('feature_flags', null, { message: 'permission denied' });
    const { GET } = await import('@/app/api/super-admin/mol-shadow/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(500);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

interface LogRowOpts {
  request_id: string;
  shadow_role: 'baseline' | 'shadow';
  task_type: string;
  inr_cost: number;
  created_at: string;
  shadow_of_request_id?: string;
  shadow_grader_score?: number;
  shadow_grader_payload?: Record<string, unknown>;
  shadow_graded_at?: string;
  provider?: string;
  latency_ms?: number;
  failure_chain?: string | null;
}

function makeLogRow(opts: LogRowOpts) {
  return {
    request_id: opts.request_id,
    task_type: opts.task_type,
    shadow_role: opts.shadow_role,
    shadow_of_request_id: opts.shadow_of_request_id ?? null,
    shadow_grader_score: opts.shadow_grader_score ?? null,
    shadow_grader_payload: opts.shadow_grader_payload ?? null,
    shadow_graded_at: opts.shadow_graded_at ?? null,
    provider: opts.provider ?? (opts.shadow_role === 'baseline' ? 'anthropic' : 'openai'),
    latency_ms: opts.latency_ms ?? 500,
    inr_cost: opts.inr_cost,
    failure_chain: opts.failure_chain ?? null,
    created_at: opts.created_at,
  };
}
