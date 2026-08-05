/**
 * /api/cron/foxy-quality-sample — thoughtful_question XP award path
 * (Foxy North-Star Phase 3).
 *
 * Pins:
 *   - question_depth_score is persisted on the foxy_quality_scores insert
 *     (null-safe when the judge doesn't emit it yet)
 *   - award fires ONLY when question_depth_score >= 75
 *   - award happens AFTER a successful insert (dup insert → no award)
 *   - amount/cap from XP_RULES (mocked — P2), source 'thoughtful_question',
 *     reference `thoughtful_<messageId>`, category 'curiosity'
 *   - an award failure (resolves null) never breaks the scoring loop
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/cron-auth', () => ({
  verifyCronAuth: vi.fn(() => ({ ok: true })),
  unauthorizedResponse: vi.fn(() => new Response('unauthorized', { status: 401 })),
}));

vi.mock('@alfanumrik/lib/cron-job-health', () => ({
  recordCronJobHealth: vi.fn(async () => undefined),
}));

const scoreMock = vi.fn();
vi.mock('@alfanumrik/lib/foxy/quality-eval', () => ({
  RUBRIC_VERSION: 'v-test',
  scoreFoxyAnswer: (...args: unknown[]) => scoreMock(...(args as [])),
}));

vi.mock('@alfanumrik/lib/xp-config', () => ({
  XP_RULES: {
    thoughtful_question_xp: 5,
    thoughtful_question_daily_cap: 5,
  },
}));

const awardMock = vi.fn(async () => 5);
vi.mock('@alfanumrik/lib/xp-award', () => ({
  awardXpCapped: (...args: unknown[]) => awardMock(...(args as [])),
}));

// ── supabaseAdmin mock — state-driven per-table chains ─────────────────────

const MSG_ID = '00000000-0000-0000-0000-0000000000a1';
const SESSION_ID = '00000000-0000-0000-0000-0000000000b2';
const STUDENT_ID = '00000000-0000-0000-0000-0000000000c3';

const insertMock = vi.fn();

const state: {
  candidates: unknown[];
  userRows: unknown[];
  insertResult: { error: { message: string } | null };
} = { candidates: [], userRows: [], insertResult: { error: null } };

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'foxy_chat_messages') {
        return {
          select: vi.fn(() => ({
            // assistant-candidates path: .eq('role','assistant').gte().order().limit()
            eq: vi.fn(() => ({
              gte: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: state.candidates, error: null })),
                })),
              })),
            })),
            // preceding-user-turns path: .in(session_ids).eq('role','user').order()
            in: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(async () => ({ data: state.userRows, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === 'foxy_quality_scores') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
          insert: vi.fn((row: unknown) => {
            insertMock(row);
            return Promise.resolve(state.insertResult);
          }),
        };
      }
      if (table === 'foxy_sessions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: [{ id: SESSION_ID, grade: '9', subject: 'math' }],
              error: null,
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

import { POST } from '@/app/api/cron/foxy-quality-sample/route';

const BASE_RESULT = {
  accuracyScore: 90,
  scaffoldFidelityScore: 80,
  ageAppropriatenessScore: 95,
  cbseScopeScore: 88,
  overallScore: 88,
  judgeModel: 'judge-1',
  rubricVersion: 'v-test',
  rawJudgeResponse: '{}',
  notes: null,
};

function mkReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/foxy-quality-sample?n=5', {
    method: 'POST',
    headers: { Authorization: 'Bearer test' },
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  insertMock.mockClear();
  awardMock.mockClear();
  awardMock.mockResolvedValue(5);
  scoreMock.mockReset();
  state.insertResult = { error: null };
  state.candidates = [{
    id: MSG_ID,
    session_id: SESSION_ID,
    student_id: STUDENT_ID,
    content: 'answer body',
    sources: [],
    coach_mode_used: 'socratic',
    created_at: '2026-08-05T10:00:00.000Z',
  }];
  state.userRows = [{
    session_id: SESSION_ID,
    content: 'why does the moon change shape?',
    created_at: '2026-08-05T09:59:00.000Z',
  }];
});

describe('foxy-quality-sample → thoughtful_question XP', () => {
  it('depth >= 75 → persists question_depth_score and awards with thoughtful_ ref', async () => {
    scoreMock.mockResolvedValue({ ...BASE_RESULT, questionDepthScore: 82 });
    const res = await POST(mkReq());
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock.mock.calls[0][0]).toMatchObject({ question_depth_score: 82 });
    expect(awardMock).toHaveBeenCalledOnce();
    const [, opts] = awardMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(opts).toMatchObject({
      studentId: STUDENT_ID,
      source: 'thoughtful_question',
      amount: 5,          // XP_RULES.thoughtful_question_xp (mocked) — no route literal
      dailyCap: 5,        // XP_RULES.thoughtful_question_daily_cap
      dailyCategory: 'curiosity',
      referenceId: `thoughtful_${MSG_ID}`,
      metadata: { questionDepthScore: 82 },
    });
  });

  it('depth below 75 → row inserted, NO award', async () => {
    scoreMock.mockResolvedValue({ ...BASE_RESULT, questionDepthScore: 60 });
    await POST(mkReq());
    expect(insertMock).toHaveBeenCalledOnce();
    expect(awardMock).not.toHaveBeenCalled();
  });

  it('judge without questionDepthScore → null column, NO award (defensive)', async () => {
    scoreMock.mockResolvedValue({ ...BASE_RESULT });
    await POST(mkReq());
    expect(insertMock.mock.calls[0][0]).toMatchObject({ question_depth_score: null });
    expect(awardMock).not.toHaveBeenCalled();
  });

  it('duplicate insert (idempotency race) → NO award', async () => {
    scoreMock.mockResolvedValue({ ...BASE_RESULT, questionDepthScore: 90 });
    state.insertResult = { error: { message: 'duplicate key value violates unique constraint' } };
    const res = await POST(mkReq());
    expect(res.status).toBe(200);
    expect(awardMock).not.toHaveBeenCalled();
  });

  it('award returning null (RPC failure) does not fail the run', async () => {
    scoreMock.mockResolvedValue({ ...BASE_RESULT, questionDepthScore: 90 });
    awardMock.mockResolvedValue(null);
    const res = await POST(mkReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.scored).toBe(1);
  });
});
