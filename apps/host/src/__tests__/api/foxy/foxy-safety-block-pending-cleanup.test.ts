/**
 * /api/foxy — Phase 0.2 safety-block pending-row cleanup (2026-07-15).
 *
 * Pins acceptance criterion #1 of the "stop empty/pending assistant rows from
 * poisoning Foxy's conversation context" task, gated behind
 * ff_foxy_answer_continuation_v1:
 *
 *   When the native-turns path (ff_foxy_native_turns_v1) has pre-inserted a
 *   pending assistant row (content='', pending=true) and the deterministic
 *   output-safety backstop hard-abstains, the route would otherwise return
 *   WITHOUT touching that row — leaving an orphaned empty pending row that
 *   (pre-fix) leaked into cross-session prompt assembly as an empty
 *   `[previous · Foxy]` snippet.
 *
 *   Flag ON  → the pre-inserted assistant row is UPDATEd to the clean, bilingual
 *              SAFE_ABSTAIN_MESSAGE with pending=false BEFORE returning.
 *   Flag OFF → byte-identical to today: NO update runs, the abstain response
 *              shape / status code are unchanged.
 *
 * P13/P15: the abstain response (response:'', groundingStatus:'hard-abstain',
 * status 200) is NEVER altered by this cleanup — only the persisted DB row.
 *
 * Drives the REAL POST handler with the same mock seam the goal-flag route test
 * uses, plus an output-screen mock forced to `unsafe` to reach the branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
// Real (unmocked) — the exact string the route reuses for the cleanup.
import { SAFE_ABSTAIN_MESSAGE } from '@alfanumrik/lib/ai/validation/output-guard';

// ─── env stubs ───────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── Feature-flag mock ───────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Subject-governance mock ─────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Logger spy ──────────────────────────────────────────────────────────────
const loggerWarn = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── grounded-client mock — grounded:true, answer is screened `unsafe` below ──
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: () =>
    Promise.resolve({
      grounded: true,
      answer: 'model output that the deterministic screen will reject',
      citations: [],
      meta: { latency_ms: 25, tokens_used: 12 },
      trace_id: 'trace-safety-1',
      confidence: 0.9,
    }),
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

vi.mock('@alfanumrik/lib/ai', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'should-not-run' }),
  routeIntent: vi.fn().mockRejectedValue(new Error('legacy path should not run')),
}));

// ─── output-screen mock — force the hard-abstain safety branch ───────────────
// The route screens BOTH the denormalized rendering AND the raw answer; making
// screenStudentFacingText return unsafe drives execution into the FOX-1 branch.
vi.mock('@alfanumrik/lib/ai/validation/output-screen', () => ({
  screenStudentFacingText: () => ({ safe: false, categories: ['test_block'] }),
}));

// ─── supabaseAdmin mock (captures foxy_chat_messages UPDATE) ─────────────────
const chatMessageUpdates: Array<{
  patch: Record<string, unknown>;
  wheres: Array<[string, unknown]>;
}> = [];

const _studentRow = {
  subscription_plan: 'free',
  account_status: 'active',
  academic_goal: null,
  grade: '9',
};

function makeChain(table: string): any {
  const chain: any = {};

  const resolveSelect = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    // Terminal (non-.single) awaits: prior-session-context session + message
    // queries, context loaders → empty sets.
    return { data: [], error: null };
  };

  for (const m of ['select', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is', 'eq']) {
    chain[m] = () => chain;
  }

  chain.single = () => {
    if (table === 'foxy_sessions') {
      return Promise.resolve({
        data: {
          id: 'session-uuid-1',
          subject: 'science',
          grade: '9',
          chapter: null,
          mode: 'learn',
          last_active_at: new Date().toISOString(),
          created_at: '2026-07-14T00:00:00Z',
        },
        error: null,
      });
    }
    if (table === 'students') return Promise.resolve({ data: _studentRow, error: null });
    // student_daily_usage (refundQuota) → no row → refund is a no-op.
    return Promise.resolve({ data: null, error: null });
  };
  chain.maybeSingle = () => chain.single();

  chain.insert = (_rows: unknown) => ({
    select: (_cols?: string) => ({
      // foxy_chat_messages pre-insert: `.select('id, role')` awaited → array.
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(
          table === 'foxy_chat_messages'
            ? {
                data: [
                  { id: 'user-row-id', role: 'user' },
                  { id: 'assistant-row-id', role: 'assistant' },
                ],
                error: null,
              }
            : { data: [{ id: 'session-uuid-1' }], error: null },
        ).then(res, rej),
      // foxy_sessions create: `.select('id').single()`.
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
    }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej),
  });

  chain.update = (patch: Record<string, unknown>) => {
    const wheres: Array<[string, unknown]> = [];
    const updChain: any = {};
    updChain.eq = (col: string, val: unknown) => {
      wheres.push([col, val]);
      return updChain;
    };
    updChain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (table === 'foxy_chat_messages') chatMessageUpdates.push({ patch, wheres });
      return Promise.resolve({ error: null }).then(res, rej);
    };
    return updChain;
  };

  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolveSelect()).then(res, rej);
  return chain;
}

const rpcImpl = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...args),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}

// ai_usage_global + ff_grounded_ai_foxy + ff_foxy_native_turns_v1 must be ON so
// we reach the grounded path AND pre-insert a pending assistant row. The
// continuation flag is toggled per test.
function setFlags(values: Record<string, boolean>) {
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag in values) return Promise.resolve(values[flag]);
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_native_turns_v1') return Promise.resolve(true);
    if (flag === 'ff_foxy_streaming') return Promise.resolve(false);
    return Promise.resolve(false);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chatMessageUpdates.length = 0;
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  rpcImpl.mockResolvedValue({ data: [{ allowed: true, current_count: 1 }], error: null });
});

describe('/api/foxy — safety-block pending-row cleanup (ff_foxy_answer_continuation_v1)', () => {
  it('flag ON: UPDATEs the pre-inserted assistant row to SAFE_ABSTAIN_MESSAGE, pending=false', async () => {
    setFlags({ ff_foxy_answer_continuation_v1: true });

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain photosynthesis', subject: 'science', grade: '9' }),
    );

    // Abstain response shape/status are NOT altered by the cleanup.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBe('');
    expect(body.groundingStatus).toBe('hard-abstain');

    // The pre-inserted assistant row was resolved to a clean, non-empty turn.
    expect(chatMessageUpdates).toHaveLength(1);
    const upd = chatMessageUpdates[0];
    expect(upd.patch.content).toBe(SAFE_ABSTAIN_MESSAGE);
    expect(upd.patch.content).not.toBe('');
    expect(upd.patch.pending).toBe(false);
    // …and it targeted the pre-inserted assistant row id.
    expect(upd.wheres).toContainEqual(['id', 'assistant-row-id']);
  });

  it('flag OFF: no UPDATE runs (byte-identical), abstain response unchanged', async () => {
    setFlags({ ff_foxy_answer_continuation_v1: false });

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain photosynthesis', subject: 'science', grade: '9' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBe('');
    expect(body.groundingStatus).toBe('hard-abstain');

    // The pending row is left untouched when the flag is OFF.
    expect(chatMessageUpdates).toHaveLength(0);
  });
});
