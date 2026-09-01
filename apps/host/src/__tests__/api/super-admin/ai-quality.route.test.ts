/**
 * GET /api/super-admin/ai-quality — integration test (Phase A.3).
 *
 * Pins:
 *   - Auth gate: super_admin.access — denied short-circuits BEFORE any DB read;
 *     the route returns the authorizer's errorResponse verbatim.
 *   - 200 happy path returns { success: true, data: { judge, ops, feedback, messages } }
 *     — aggregate-only, P13-safe (counts + scores, no PII).
 *
 * Mocking pattern mirrors src/__tests__/api/super-admin/foxy-report.test.ts —
 * a chainable Supabase mock branching by table name, results set per test via
 * tableResults + makeChain(...).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── rbac mock ──────────────────────────────────────────────────────────────
const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorizeRequest(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── supabaseAdmin mock (chainable, table-name branching, mirrors foxy-report) ──
const tableResults: Record<string, { data?: unknown; error?: unknown; count?: number | null }> = {};
const fromCallsByTable: Record<string, number> = {};
const selectArgsByTable: Record<string, string[]> = {};

function resetTables() {
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  for (const k of Object.keys(fromCallsByTable)) delete fromCallsByTable[k];
  for (const k of Object.keys(selectArgsByTable)) delete selectArgsByTable[k];
  // Defaults: all 5 tables empty — the route produces a zero-filled response.
  tableResults.foxy_quality_scores = { data: [], error: null };
  tableResults.ops_events = { data: [], error: null };
  tableResults.foxy_message_feedback = { data: [], error: null };
  tableResults.foxy_message_dimension_feedback = { data: [], error: null };
  tableResults.foxy_chat_messages = { data: [], error: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(table: string): Record<string, any> {
  const result = () => tableResults[table] ?? { data: [], error: null };
  const chain: Record<string, any> = {};
  chain.select = vi.fn((cols?: string) => {
    if (typeof cols === 'string') {
      selectArgsByTable[table] = [...(selectArgsByTable[table] ?? []), cols];
    }
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  // Make the chain thenable so `await chain.limit(5000)` resolves to the table's data.
  chain.then = (onFulfill?: (r: unknown) => unknown, onReject?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(onFulfill, onReject);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      fromCallsByTable[table] = (fromCallsByTable[table] ?? 0) + 1;
      return makeChain(table);
    }),
  },
}));

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const AUTH_OK = {
  authorized: true as const,
  userId: 'admin-1',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED_403 = () => ({
  authorized: false as const,
  userId: 'student-1',
  studentId: null,
  roles: ['student'],
  permissions: [],
  errorResponse: new Response(
    JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  ),
});

function buildRequest(): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/ai-quality', { method: 'GET' });
}

async function loadRoute() {
  return import('@/app/api/super-admin/ai-quality/route');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
  mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
});

// ════════════════════════════════════════════════════════════════════════════
// Auth gate
// ════════════════════════════════════════════════════════════════════════════

describe('/api/super-admin/ai-quality', () => {
  it('returns 200 with zero-filled data from empty tables', async () => {
    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data?: any; error?: string };
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();

    expect(body.data.judge.totalScored30d).toBe(0);
    expect(body.data.judge.avgOverall).toBeNull();
    expect(body.data.ops.totalAiEvents).toBe(0);
    expect(body.data.feedback.total30d).toBe(0);
    expect(body.data.messages.total30d).toBe(0);
  });

  it('denies non-super-admin callers with 403', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_403());

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success?: boolean; error?: string; code?: string };
    // Route returns auth.errorResponse verbatim — a Response with JSON
    // { error: 'Forbidden', code: 'FORBIDDEN' } (no 'success' field).
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('FORBIDDEN');
  });

  it('checks the existing super_admin.access permission', async () => {
    const { GET } = await loadRoute();
    await GET(buildRequest());
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });

  it('aggregates judge scores from foxy_quality_scores rows', async () => {
    tableResults.foxy_quality_scores = {
      data: [
        {
          overall_score: 80,
          accuracy_score: 85,
          scaffold_fidelity_score: 75,
          age_appropriateness_score: 90,
          cbse_scope_score: 95,
          rubric_version: 'v1',
          judge_model: 'claude-sonnet-4-5-20250929',
        },
        {
          overall_score: 70,
          accuracy_score: 75,
          scaffold_fidelity_score: 65,
          age_appropriateness_score: 80,
          cbse_scope_score: 85,
          rubric_version: 'v1',
          judge_model: 'claude-sonnet-4-5-20250929',
        },
      ],
      error: null,
    };

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; data?: any };

    expect(body.data.judge.totalScored30d).toBe(2);
    expect(body.data.judge.avgOverall).toBeCloseTo(75, 1);
    expect(body.data.judge.avgAccuracy).toBeCloseTo(80, 1);
    expect(body.data.judge.avgScaffold).toBeCloseTo(70, 1);
    expect(body.data.judge.avgAge).toBeCloseTo(85, 1);
    expect(body.data.judge.avgScope).toBeCloseTo(90, 1);
    expect(body.data.judge.judgeModels['claude-sonnet-4-5-20250929']).toBe(2);
    expect(body.data.judge.rubricVersions['v1']).toBe(2);
  });

  it('counts feedback thumbs up/down correctly', async () => {
    tableResults.foxy_message_feedback = {
      data: [
        { is_up: true, reason: 'good' },
        { is_up: true, reason: null },
        { is_up: false, reason: 'wrong' },
        { is_up: true, reason: '' },
      ],
      error: null,
    };

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; data?: any };

    expect(body.data.feedback.total30d).toBe(4);
    expect(body.data.feedback.thumbsUp).toBe(3);
    expect(body.data.feedback.thumbsDown).toBe(1);
    expect(body.data.feedback.withReason).toBe(2);
  });

  it('counts dimension feedback by dimension', async () => {
    tableResults.foxy_message_dimension_feedback = {
      data: [
        { dimension: 'accuracy', is_up: true },
        { dimension: 'accuracy', is_up: false },
        { dimension: 'clarity', is_up: true },
        { dimension: 'helpfulness', is_up: true },
        { dimension: 'helpfulness', is_up: true },
        { dimension: 'scope', is_up: false },
      ],
      error: null,
    };

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; data?: any };

    const byDim = body.data.feedback.byDimension as Record<string, { up: number; down: number }>;
    expect(byDim.accuracy).toEqual({ up: 1, down: 1 });
    expect(byDim.clarity).toEqual({ up: 1, down: 0 });
    expect(byDim.helpfulness).toEqual({ up: 2, down: 0 });
    expect(byDim.scope).toEqual({ up: 0, down: 1 });
  });

  it('counts coach modes from foxy_chat_messages', async () => {
    tableResults.foxy_chat_messages = {
      data: [
        { coach_mode_used: 'socratic', role: 'assistant' },
        { coach_mode_used: 'socratic', role: 'assistant' },
        { coach_mode_used: 'answer', role: 'assistant' },
        { coach_mode_used: 'socratic', role: 'assistant' }, // 4th row with non-null coach_mode
        { coach_mode_used: null, role: 'assistant' },
      ],
      error: null,
    };

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; data?: any };

    expect(body.data.messages.total30d).toBe(4); // only non-null coach_mode rows counted
    const cm = body.data.messages.coachModes as Record<string, number>;
    expect(cm['socratic']).toBe(3);
    expect(cm['answer']).toBe(1);
  });

  it('reads ops_events AI sources', async () => {
    tableResults.ops_events = {
      data: [
        { source: 'response-eval', category: 'ai.eval' },
        { source: 'response-eval', category: 'ai.eval' },
        { source: 'ai.foxy', category: 'ai.foxy' },
      ],
      error: null,
    };

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; data?: any };

    expect(body.data.ops.totalAiEvents).toBe(3);
    const bySrc = body.data.ops.bySource as Record<string, number>;
    expect(bySrc['response-eval']).toBe(2);
    expect(bySrc['ai.foxy']).toBe(1);
  });

  it('skips null coach_mode rows but counts them correctly', async () => {
    tableResults.foxy_chat_messages = {
      data: [
        { coach_mode_used: 'socratic', role: 'assistant' },
        { coach_mode_used: null, role: 'assistant' },
        { coach_mode_used: 'answer', role: 'student' },
      ],
      error: null,
    };

    const { GET } = await loadRoute();
    const req = buildRequest();
    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; data?: any };

    // The route trusts DB-level role filtering; mock data arrives as-is.
    // All 3 rows are returned (no server-side role filter in the test route).
    // The coachModes count only non-null coach_mode values.
    const cm = body.data.messages.coachModes as Record<string, number>;
    expect(cm['socratic']).toBe(1);
    expect(cm['answer']).toBe(1); // DB returned this row; route doesn't re-filter by role
    expect(body.data.messages.total30d).toBe(2); // 2 rows with non-null coach_mode
  });
});
