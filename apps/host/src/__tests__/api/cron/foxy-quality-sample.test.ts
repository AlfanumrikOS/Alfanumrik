/**
 * POST /api/cron/foxy-quality-sample — B'-1 Phase 2.
 *
 * Covers: cron-secret auth, missing-API-key, empty-window, single-row happy
 * path, judge-null counted as failed, already-scored-skip via the existing-
 * scores anti-join, and duplicate-insert (race) treated as skip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CRON_SECRET = 'cron-secret-fixture';
const ANTHROPIC_KEY = 'sk-test-fixture';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── scoreFoxyAnswer mock ──
const _scoreFn = vi.fn();
vi.mock('@alfanumrik/lib/foxy/quality-eval', () => ({
  scoreFoxyAnswer: (...args: unknown[]) => _scoreFn(...args),
  RUBRIC_VERSION: 'v1',
}));

// ── supabaseAdmin mock ──
type Stub = { data: unknown; error: unknown };
let _candidates: Stub = { data: [], error: null };
let _existing: Stub = { data: [], error: null };
let _sessions: Stub = { data: [], error: null };
let _userMessages: Stub = { data: [], error: null };
let _insertResult: Stub = { data: null, error: null };
const _insertCalls: unknown[] = [];

function setCandidates(s: Stub) { _candidates = s; }
function setExisting(s: Stub) { _existing = s; }
function setSessions(s: Stub) { _sessions = s; }
function setUserMessages(s: Stub) { _userMessages = s; }
function setInsertResult(s: Stub) { _insertResult = s; }

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    // The route calls `from('foxy_chat_messages').select(...).eq('role', 'assistant')...`
    // and `from('foxy_chat_messages').select(...).in('session_id', ids).eq('role', 'user')...`.
    // We dispatch on whether `.eq('role', 'assistant')` is in the chain.
    from: vi.fn((table: string) => {
      if (table === 'foxy_quality_scores') {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          insert: vi.fn((row: unknown) => {
            _insertCalls.push(row);
            return Promise.resolve(_insertResult);
          }),
          // Treat the terminal lookup `.in('message_id', ...)` as the resolution.
          then: (cb: (r: Stub) => unknown) => cb(_existing),
        };
        return builder;
      }
      if (table === 'foxy_sessions') {
        const builder = {
          select: vi.fn().mockReturnThis(),
          in: vi.fn(() => Promise.resolve(_sessions)),
        };
        return builder;
      }
      if (table === 'foxy_chat_messages') {
        // We need to differentiate the candidate fetch (eq('role', 'assistant'))
        // from the user-prefetch (eq('role', 'user') + in('session_id', ...)).
        let isUserFetch = false;
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn((col: string, val: unknown) => {
          if (col === 'role' && val === 'user') isUserFetch = true;
          return builder;
        });
        builder.in = vi.fn(() => builder);
        builder.gte = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        builder.limit = vi.fn(() => Promise.resolve(_candidates));
        // The user-prefetch chain ends with .order(...). If `.order()` is the
        // terminal call (not followed by .limit()), resolve with userMessages.
        // The PromiseLike behaviour kicks in via thenable on the builder.
        builder.then = (cb: (r: Stub) => unknown) =>
          cb(isUserFetch ? _userMessages : _candidates);
        return builder;
      }
      throw new Error(`unexpected from(${table})`);
    }),
  },
}));

function makeReq(headers: Record<string, string> = {}, query = ''): Request {
  return new Request(`http://localhost/api/cron/foxy-quality-sample${query}`, {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
  _candidates = { data: [], error: null };
  _existing = { data: [], error: null };
  _sessions = { data: [], error: null };
  _userMessages = { data: [], error: null };
  _insertResult = { data: null, error: null };
  _insertCalls.length = 0;
  _scoreFn.mockReset();
});

describe('POST /api/cron/foxy-quality-sample', () => {
  it('returns 401 when no secret', async () => {
    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is wrong', async () => {
    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': 'nope' }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 503 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    expect(res.status).toBe(503);
  });

  it('returns success with 0 scored when no candidate messages exist', async () => {
    setCandidates({ data: [], error: null });
    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.scored).toBe(0);
    expect(body.sampled).toBe(0);
    expect(_scoreFn).not.toHaveBeenCalled();
  });

  it('happy path: scores a single message and inserts result', async () => {
    setCandidates({
      data: [
        {
          id: 'msg-1',
          session_id: 'sess-1',
          student_id: 'stu-1',
          content: 'Photosynthesis is...',
          sources: [{ chapter: 'Life Processes', page_number: 95, content_preview: 'Plants make food via photosynthesis...' }],
          coach_mode_used: 'answer',
          created_at: '2026-05-08T12:00:00Z',
        },
      ],
      error: null,
    });
    setExisting({ data: [], error: null });
    setSessions({
      data: [{ id: 'sess-1', grade: '9', subject: 'science' }],
      error: null,
    });
    setUserMessages({
      data: [{ id: 'usr-1', session_id: 'sess-1', content: 'What is photosynthesis?', created_at: '2026-05-08T11:59:00Z' }],
      error: null,
    });
    _scoreFn.mockResolvedValue({
      accuracyScore: 90,
      scaffoldFidelityScore: 80,
      ageAppropriatenessScore: 95,
      cbseScopeScore: 100,
      overallScore: 89,
      judgeModel: 'claude-sonnet-4-20250514',
      rubricVersion: 'v1',
      rawJudgeResponse: { accuracy: 90, scaffold_fidelity: 80, age_appropriateness: 95, cbse_scope: 100 },
      notes: 'good answer',
    });

    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scored).toBe(1);
    expect(body.failed).toBe(0);
    expect(_insertCalls).toHaveLength(1);
    const inserted = _insertCalls[0] as Record<string, unknown>;
    expect(inserted.message_id).toBe('msg-1');
    expect(inserted.overall_score).toBe(89);
    expect(inserted.judge_model).toBe('claude-sonnet-4-20250514');
    expect(inserted.rubric_version).toBe('v1');

    // scoreFoxyAnswer received the right shape
    const scoreInput = (_scoreFn.mock.calls[0] as unknown[])[0] as { question: string; coachMode: string };
    expect(scoreInput.question).toBe('What is photosynthesis?');
    expect(scoreInput.coachMode).toBe('answer');
  });

  it('counts judge null as failed; no insert', async () => {
    setCandidates({
      data: [
        {
          id: 'msg-1',
          session_id: 'sess-1',
          student_id: 'stu-1',
          content: 'text',
          sources: [],
          coach_mode_used: 'socratic',
          created_at: '2026-05-08T12:00:00Z',
        },
      ],
      error: null,
    });
    setSessions({ data: [{ id: 'sess-1', grade: '9', subject: 'science' }], error: null });
    setUserMessages({
      data: [{ session_id: 'sess-1', content: 'q?', created_at: '2026-05-08T11:00:00Z' }],
      error: null,
    });
    _scoreFn.mockResolvedValue(null); // judge gave up

    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(body.failed).toBe(1);
    expect(_insertCalls).toHaveLength(0);
  });

  it('skips messages already scored for this rubric_version (anti-join)', async () => {
    setCandidates({
      data: [
        { id: 'already-scored', session_id: 'sess-1', student_id: 'stu-1', content: 'a', sources: [], coach_mode_used: null, created_at: '2026-05-08T12:00:00Z' },
      ],
      error: null,
    });
    setExisting({ data: [{ message_id: 'already-scored' }], error: null });

    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(body.skipped).toBe(1);
    expect(_scoreFn).not.toHaveBeenCalled();
  });

  it('treats UNIQUE-violation insert as a silent skip (race-safe)', async () => {
    setCandidates({
      data: [
        { id: 'msg-1', session_id: 'sess-1', student_id: 'stu-1', content: 'a', sources: [], coach_mode_used: 'socratic', created_at: '2026-05-08T12:00:00Z' },
      ],
      error: null,
    });
    setSessions({ data: [{ id: 'sess-1', grade: '9', subject: 'science' }], error: null });
    setUserMessages({
      data: [{ session_id: 'sess-1', content: 'q?', created_at: '2026-05-08T11:00:00Z' }],
      error: null,
    });
    _scoreFn.mockResolvedValue({
      accuracyScore: 90, scaffoldFidelityScore: 80, ageAppropriatenessScore: 95, cbseScopeScore: 100,
      overallScore: 89, judgeModel: 'claude-sonnet-4-20250514', rubricVersion: 'v1',
      rawJudgeResponse: {}, notes: null,
    });
    setInsertResult({ data: null, error: { message: 'duplicate key value violates unique constraint' } });

    const { POST } = await import('@/app/api/cron/foxy-quality-sample/route');
    const res = await POST(makeReq({ 'x-cron-secret': CRON_SECRET }) as never);
    const body = await res.json();
    // Insert collided → counted as neither scored nor failed; route logs warn.
    expect(body.scored).toBe(0);
    expect(body.failed).toBe(0);
  });
});
