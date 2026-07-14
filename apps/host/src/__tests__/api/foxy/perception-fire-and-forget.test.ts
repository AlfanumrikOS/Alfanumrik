import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Foxy Perception (Phase 1C) — route fire-and-forget wiring.
 *
 * Invariants pinned here:
 *   1. Flag ON  → after the reply is built, the route calls classifyTurn AND (on
 *      a non-null result) publishes a `learner.turn_classified` event.
 *   2. Flag OFF → classifyTurn is NEVER called and no turn_classified event is
 *      published (byte-identical to today; the turn still returns a clean 200).
 *   3. A classifier failure (classifyTurn returns null) does NOT affect the
 *      turn — the response is still a clean 200 and no turn_classified event is
 *      published.
 *   4. Fire-and-forget: the perception step never blocks the reply; the response
 *      resolves regardless of the (backgrounded) classify + publish work.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: vi.fn(),
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

vi.mock('@alfanumrik/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

// ─── perception collaborator (the sensor) — spied ────────────────────────────
const _classifyTurn = vi.fn();
vi.mock('@alfanumrik/lib/foxy/perception', () => ({
  classifyTurn: (...args: unknown[]) => _classifyTurn(...args),
}));

// ─── the bus writer — spied (we assert on the published event kind) ──────────
const _publishEvent = vi.fn().mockResolvedValue({ published: true });
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...args: unknown[]) => _publishEvent(...args),
}));

// ─── grounded path SUCCEEDS ──────────────────────────────────────────────────
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: () => Promise.resolve(_groundedReturn),
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));
vi.mock('@alfanumrik/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: vi.fn().mockResolvedValue({ intent: 'noop' }),
    routeIntent: vi.fn().mockResolvedValue({ response: 'legacy', intent: 'explain', sources: [], tokensUsed: 0, model: 'none', latencyMs: 0 }),
  };
});

// ─── supabaseAdmin — permissive pass-through ─────────────────────────────────
function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return { data: { subscription_plan: 'free', account_status: 'active', academic_goal: null, name: null, school_id: null }, error: null };
    }
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is', 'update']) {
    chain[m] = () => chain;
  }
  chain.insert = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'assistant-msg-1', role: 'assistant' }], error: null }).then(resolve, reject),
    }),
  });
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}
const rpcImpl = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table), rpc: (...args: unknown[]) => rpcImpl(...args) },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer student-jwt' },
    body: JSON.stringify(body),
  });
}

function setFlags(perceptionOn: boolean) {
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_perception_v1') return Promise.resolve(perceptionOn);
    return Promise.resolve(false);
  });
}

const GOOD_CLASSIFICATION = {
  topicId: '11111111-1111-1111-1111-111111111111',
  chapterNumber: 3,
  bloomLevel: 'apply' as const,
  misconceptionCode: 'sign_error',
  struggleSignal: 'none' as const,
  intent: 'ask_concept',
};

beforeEach(() => {
  vi.clearAllMocks();
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: null,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  rpcImpl.mockResolvedValue({ data: [{ allowed: true, current_count: 1 }], error: null });
  _publishEvent.mockResolvedValue({ published: true });
  _groundedReturn = {
    grounded: true,
    answer: 'Photosynthesis is how plants make food using sunlight.',
    citations: [],
    confidence: 0.92,
    groundedFromChunks: true,
    trace_id: 'trace-perception',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 30, latency_ms: 80 },
  };
});

async function postFoxy(body: Record<string, unknown>): Promise<{ res: Response | null; body: Record<string, unknown> | null }> {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  return { res, body: parsed };
}

/** Let the fire-and-forget perception IIFE (flag read → classify → publish) drain. */
async function drainBackground(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

function turnClassifiedCalls() {
  return _publishEvent.mock.calls.filter(
    (c) => (c[1] as { kind?: string } | undefined)?.kind === 'learner.turn_classified',
  );
}

describe('Foxy perception — flag ON', () => {
  it('returns a clean 200 (the reply is never blocked by perception)', async () => {
    setFlags(true);
    _classifyTurn.mockResolvedValue(GOOD_CLASSIFICATION);
    const { res, body } = await postFoxy({ message: 'What is photosynthesis?', subject: 'Science', grade: '7', chapter: 'Chapter 3' });
    expect(res!.status).toBe(200);
    expect(body!.success).toBe(true);
  });

  it('calls classifyTurn and publishes a learner.turn_classified event with the derived payload', async () => {
    setFlags(true);
    _classifyTurn.mockResolvedValue(GOOD_CLASSIFICATION);
    await postFoxy({ message: 'What is photosynthesis?', subject: 'Science', grade: '7', chapter: 'Chapter 3' });
    await drainBackground();

    expect(_classifyTurn).toHaveBeenCalledTimes(1);
    const classifyArg = _classifyTurn.mock.calls[0][0] as Record<string, unknown>;
    expect(classifyArg.subject).toBe('Science');
    expect(classifyArg.grade).toBe('7');
    // The student message is forwarded to the (internal) classifier as evidence.
    expect(classifyArg.studentMessage).toBe('What is photosynthesis?');

    const published = turnClassifiedCalls();
    expect(published).toHaveLength(1);
    const event = published[0][1] as { payload: Record<string, unknown> };
    expect(event.payload.messageId).toBe('assistant-msg-1');
    expect(event.payload.subjectCode).toBe('science');
    expect(event.payload.grade).toBe('7');
    expect(event.payload.bloomLevel).toBe('apply');
    expect(event.payload.misconceptionCode).toBe('sign_error');
    expect(event.payload.topicId).toBe('11111111-1111-1111-1111-111111111111');
    expect(event.payload.intent).toBe('ask_concept');
    // P13: the payload never carries the student's message text.
    expect(JSON.stringify(event.payload)).not.toContain('photosynthesis');
  });

  it('a null classification (classifier failure) does NOT affect the turn and publishes nothing', async () => {
    setFlags(true);
    _classifyTurn.mockResolvedValue(null); // service dark / down / bad output
    const { res, body } = await postFoxy({ message: 'What is photosynthesis?', subject: 'Science', grade: '7', chapter: 'Chapter 3' });
    await drainBackground();

    expect(res!.status).toBe(200);
    expect(body!.success).toBe(true);
    expect(_classifyTurn).toHaveBeenCalledTimes(1);
    expect(turnClassifiedCalls()).toHaveLength(0);
  });

  it('a THROWING classifier does NOT affect the turn (still a clean 200)', async () => {
    setFlags(true);
    _classifyTurn.mockRejectedValue(new Error('python exploded'));
    const { res, body } = await postFoxy({ message: 'What is photosynthesis?', subject: 'Science', grade: '7', chapter: 'Chapter 3' });
    await drainBackground();
    expect(res!.status).toBe(200);
    expect(body!.success).toBe(true);
    expect(turnClassifiedCalls()).toHaveLength(0);
  });
});

describe('Foxy perception — flag OFF (byte-identical to today)', () => {
  it('never calls classifyTurn and never publishes turn_classified', async () => {
    setFlags(false);
    _classifyTurn.mockResolvedValue(GOOD_CLASSIFICATION);
    const { res, body } = await postFoxy({ message: 'What is photosynthesis?', subject: 'Science', grade: '7', chapter: 'Chapter 3' });
    await drainBackground();

    expect(res!.status).toBe(200);
    expect(body!.success).toBe(true);
    expect(_classifyTurn).not.toHaveBeenCalled();
    expect(turnClassifiedCalls()).toHaveLength(0);
  });
});
