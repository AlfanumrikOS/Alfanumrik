/**
 * Digital Twin -> Foxy prompt END-TO-END WIRING test (Master Action Plan
 * Phase 4, Item 4.4).
 *
 * REG-175 already pins buildTwinContext/renderTwinPromptSection in ISOLATION
 * (packages/lib/src/learn/__tests__/build-twin-context.test.ts, or similar unit
 * coverage) and foxy-teaching-director-wiring.test.ts asserts the ROUTE
 * appends "some twin section" using a HARDCODED FAKE constant
 * (`TWIN_SECTION = '\n\n## LONGITUDINAL LEARNING SIGNALS\ndecay: high'`) —
 * neither test proves the REAL rendered twin section, built from a REAL
 * `learner_twin_snapshots` row via the REAL buildTwinContext/
 * renderTwinPromptSection, actually reaches the REAL outbound payload sent to
 * Claude (callGroundedAnswer).
 *
 * This file closes that gap: it POSTs the REAL `/api/foxy` route with
 * `ff_digital_twin_v1` forced ON, a seeded `learner_twin_snapshots` row (+
 * `learner_twin_memory` highlights) served by a stubbed supabaseAdmin, mocks
 * ONLY the Claude-call boundary (`callGroundedAnswer`), and asserts that the
 * text `renderTwinPromptSection(buildTwinContext(...))` — computed via the
 * REAL, un-mocked functions from `@alfanumrik/lib/learn/build-twin-context`,
 * fed the SAME fixture row the stub serves — is byte-for-byte present inside
 * `groundedRequest.generation.template_variables.cognitive_context_section`,
 * the actual outbound payload handed to the Claude-calling boundary.
 *
 * Harness mirrors `route-characterization.test.ts` (same collaborator-
 * boundary mock set: rbac, feature-flags, foxy/math-flag, subjects, logger,
 * recent-lab-context, foxy-router, math/solve-*, grounded-client, ai,
 * supabase-admin) — no new mocking primitive, so this test rides the same
 * proven harness rather than inventing a second one.
 *
 * Owner: ai-engineer. P14 reviewers: assessment (twin signal correctness),
 * testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  buildTwinContext,
  renderTwinPromptSection,
  type TwinSnapshotInput,
  type TwinMemoryHighlightInput,
} from '@alfanumrik/lib/learn/build-twin-context';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC + audit capture ────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── feature flags — ff_digital_twin_v1 forced ON for this file ─────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── the two Foxy math flag resolvers — off (not exercised by this test) ─────
const _isCurriculumGuardEnabled = vi.fn();
const _isMathPipelineEnabled = vi.fn();
vi.mock('@alfanumrik/lib/foxy/math-flag', () => ({
  isCurriculumGuardEnabled: (...args: unknown[]) => _isCurriculumGuardEnabled(...args),
  isMathPipelineEnabled: (...args: unknown[]) => _isMathPipelineEnabled(...args),
}));

vi.mock('@alfanumrik/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
const _loggerWarn = vi.fn();
const _loggerInfo = vi.fn();
const _loggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: _loggerInfo, warn: _loggerWarn, error: _loggerError, debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

// ─── math collaborators — should never fire on this teaching-turn test ──────
const _classifyMathSolve = vi.fn();
vi.mock('@alfanumrik/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  classifyMathSolve: (...args: unknown[]) => _classifyMathSolve(...args),
}));
vi.mock('@alfanumrik/lib/ai/math/solve-math', () => ({ solveMath: vi.fn() }));
vi.mock('@alfanumrik/lib/math-python-client', () => ({ verifyMath: vi.fn() }));
vi.mock('@alfanumrik/lib/ai/math/solve-pipeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runMathSolvePipeline: vi.fn() };
});

// ─── grounded path — the Claude-call boundary. Captures the REAL outbound
//     payload so we can assert the REAL twin section landed in it. ───────────
const _callGroundedAnswer = vi.fn();
const _callGroundedAnswerStream = vi.fn();
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    _callGroundedAnswer(...args);
    return Promise.resolve(_groundedReturn);
  },
  callGroundedAnswerStream: (...args: unknown[]) => {
    _callGroundedAnswerStream(...args);
    return Promise.resolve({ ok: false, reason: 'not-used' });
  },
}));

// ─── legacy routeIntent path — must NOT fire (ff_grounded_ai_foxy is ON) ─────
const _classifyIntent = vi.fn();
const _routeIntent = vi.fn();
vi.mock('@alfanumrik/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: (...args: unknown[]) => {
      _classifyIntent(...args);
      return Promise.resolve({ intent: 'explain' });
    },
    routeIntent: (...args: unknown[]) => {
      _routeIntent(...args);
      return Promise.resolve({
        response: 'LEGACY_ANSWER',
        intent: 'explain',
        sources: [],
        tokensUsed: 11,
        model: 'gpt-4o-mini',
        latencyMs: 0,
        traceId: 'legacy-trace-1',
      });
    },
  };
});

// ─── Fixture: the REAL learner_twin_snapshots + learner_twin_memory rows ────
// Values are DELIBERATELY chosen to clear BLOCKED_PREREQUISITE_RULES floors
// (mastery_floor 0.4, decay_floor 0.5 — packages/lib/src/learn/adaptive-loops-
// rules.ts) so buildTwinContext produces a NON-empty TwinContext (weak topic +
// decayed topic + error tendency + misconception cluster + percentile +
// highlight), giving renderTwinPromptSection real signal to render.
const TWIN_STUDENT_ID = 'student-uuid-1';

const SNAPSHOT_ROW: TwinSnapshotInput = {
  snapshot_date: '2026-07-20',
  mastery_by_topic: { 'topic-fractions-uuid': 0.22 }, // below mastery_floor 0.4
  decay_state: { 'topic-decimals-uuid': 0.31 }, // below decay_floor 0.5
  dominant_error_types: ['conceptual'],
  misconception_cluster_ids: ['misconception-cluster-uuid-1'],
  cohort_percentile: 34,
};

const MEMORY_ROWS: TwinMemoryHighlightInput[] = [
  { summary_code: 'misconception_repeated', concept_topic_id: 'topic-fractions-uuid', misconception_id: null },
];

// Independently derive the EXPECTED rendered section via the REAL, un-mocked
// build-twin-context functions — this is what the test asserts actually
// reached the outbound Claude payload, not a hand-typed string.
const EXPECTED_TWIN_CONTEXT = buildTwinContext(SNAPSHOT_ROW, MEMORY_ROWS);
const EXPECTED_TWIN_SECTION = renderTwinPromptSection(EXPECTED_TWIN_CONTEXT);

// ─── supabaseAdmin — students row + twin tables + RPC ────────────────────────
let _studentRow: Record<string, unknown> | null = null;
const _fromTables: string[] = [];

function makeChain(table: string) {
  _fromTables.push(table);
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    if (table === 'student_daily_usage') return { data: { usage_count: 5 }, error: null };
    // The two Digital Twin tables — served with the REAL fixture rows so the
    // route's ACTUAL loadTwinContextForFoxy -> buildTwinContext pipeline runs
    // against real data, not a stub shortcut.
    if (table === 'learner_twin_snapshots') return { data: SNAPSHOT_ROW, error: null };
    if (table === 'learner_twin_memory') return { data: MEMORY_ROWS, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    eq: () => ({
      eq: () => ({
        eq: () => ({
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject),
        }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject),
      }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    }),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: [
            { id: 'msg-user', role: 'user' },
            { id: 'msg-assistant', role: 'assistant' },
          ],
          error: null,
        }).then(resolve, reject),
    }),
  });
  chain.insert = () => recordWrite();
  chain.update = () => recordWrite();
  chain.upsert = () => recordWrite();
  chain.delete = () => recordWrite();
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let _quotaRow: { allowed: boolean; used_count: number } = { allowed: true, used_count: 1 };
let _planLimit = 10;
type RpcResult = {
  data: { allowed: boolean; used_count: number }[] | number | null;
  error: { message: string } | null;
};
const rpcImpl = vi.fn((name: string, args: Record<string, unknown>): Promise<RpcResult> => {
  _rpcCalls.push({ name, args });
  if (name === 'check_and_record_usage') {
    return Promise.resolve({ data: [_quotaRow], error: null });
  }
  if (name === 'get_plan_limit') {
    return Promise.resolve({ data: _planLimit, error: null });
  }
  return Promise.resolve({ data: [{ allowed: true, used_count: 1 }], error: null });
});

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...(args as [string, Record<string, unknown>])),
  },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

async function postFoxy(body: Record<string, unknown>): Promise<{ res: Response; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  const parsed = (await res.json()) as Record<string, unknown>;
  return { res, body: parsed };
}

function requestBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { message: 'Explain fractions', subject: 'maths', grade: '8', mode: 'learn', ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  _fromTables.length = 0;
  _rpcCalls.length = 0;
  _quotaRow = { allowed: true, used_count: 1 };
  _planLimit = 10;
  _studentRow = {
    subscription_plan: 'free',
    account_status: 'active',
    academic_goal: null,
    name: null,
    grade: '8',
    onboarding_completed: true,
  };
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: TWIN_STUDENT_ID,
    schoolId: null,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  // ff_digital_twin_v1 forced ON for this file; everything else default-off
  // except the two flags every teaching turn needs to reach the grounded path.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_digital_twin_v1') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  _isCurriculumGuardEnabled.mockResolvedValue(false);
  _isMathPipelineEnabled.mockResolvedValue(false);
  _classifyMathSolve.mockResolvedValue({ isMathSolve: false });
  _groundedReturn = {
    grounded: true,
    answer: 'Fractions represent parts of a whole.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-twin-1',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 40, latency_ms: 90 },
  };
});

describe('Digital Twin -> Foxy prompt end-to-end wiring (Item 4.4)', () => {
  it('sanity: the fixture actually produces a NON-empty twin context with real signal', () => {
    // Guards against a silently-degenerate fixture (e.g. thresholds drifting)
    // making this test pass for the wrong reason (empty section always "not
    // found" would be a false negative if we asserted absence instead).
    expect(EXPECTED_TWIN_CONTEXT.isEmpty).toBe(false);
    expect(EXPECTED_TWIN_CONTEXT.weakTopics.length).toBeGreaterThan(0);
    expect(EXPECTED_TWIN_CONTEXT.decayedTopics.length).toBeGreaterThan(0);
    expect(EXPECTED_TWIN_SECTION).toContain('LONGITUDINAL LEARNING SIGNALS');
  });

  it('ff_digital_twin_v1 ON + real snapshot row -> the REAL rendered twin section reaches the REAL outbound Claude payload', async () => {
    const { res, body } = await postFoxy(requestBody());

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Grounded (not legacy) path actually ran — the boundary we're inspecting.
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(_routeIntent).not.toHaveBeenCalled();

    const [outboundRequest] = _callGroundedAnswer.mock.calls[0] as [
      { generation?: { template_variables?: Record<string, unknown> } },
    ];
    const cognitiveContextSection = String(
      outboundRequest?.generation?.template_variables?.cognitive_context_section ?? '',
    );

    // The REAL rendered section (built by the REAL buildTwinContext +
    // renderTwinPromptSection from the SAME fixture the DB stub served) must
    // be byte-for-byte present in the outbound payload actually handed to
    // the Claude-calling boundary — proving the full wiring chain: DB row ->
    // loadTwinContextForFoxy -> buildTwinContext -> renderTwinPromptSection
    // -> cognitive_context_section -> groundedRequest -> callGroundedAnswer.
    expect(cognitiveContextSection).toContain(EXPECTED_TWIN_SECTION);

    // And the specific real signals from the fixture are genuinely present
    // (not merely a coincidental substring match against an empty string).
    expect(cognitiveContextSection).toContain('topic(s) show low retention');
    expect(cognitiveContextSection).toContain('topic(s) remain weak');
    expect(cognitiveContextSection).toContain('conceptual');
    expect(cognitiveContextSection).toContain('misconception cluster(s)');
    expect(cognitiveContextSection).toContain('Cohort percentile: 34');

    // Never disclosed to the student in the actual response text.
    expect(String(body.response ?? '')).not.toContain('Cohort percentile');
  });

  it('ff_digital_twin_v1 OFF -> no DB read of learner_twin_snapshots, no twin section in the outbound payload (byte-identical fallback)', async () => {
    _isFeatureEnabled.mockImplementation((flag: string) => {
      if (flag === 'ai_usage_global') return Promise.resolve(true);
      if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
      if (flag === 'ff_digital_twin_v1') return Promise.resolve(false);
      return Promise.resolve(false);
    });

    const { res } = await postFoxy(requestBody());
    expect(res.status).toBe(200);
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);

    expect(_fromTables).not.toContain('learner_twin_snapshots');
    expect(_fromTables).not.toContain('learner_twin_memory');

    const [outboundRequest] = _callGroundedAnswer.mock.calls[0] as [
      { generation?: { template_variables?: Record<string, unknown> } },
    ];
    const cognitiveContextSection = String(
      outboundRequest?.generation?.template_variables?.cognitive_context_section ?? '',
    );
    expect(cognitiveContextSection).not.toContain('LONGITUDINAL LEARNING SIGNALS');
  });
});
