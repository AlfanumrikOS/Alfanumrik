import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimFailedBatchMock = vi.fn();
vi.mock('@/lib/qb-fixer/claim', () => ({
  claimFailedBatch: (...a: unknown[]) => claimFailedBatchMock(...a),
}));
const runFixFailedMock = vi.fn();
vi.mock('@/lib/ai/agents/agents/fix-failed-questions', () => ({
  runFixFailedQuestions: (...a: unknown[]) => runFixFailedMock(...a),
}));
const logOpsEventMock = vi.fn();
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: (...a: unknown[]) => logOpsEventMock(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const fromMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));

import { POST } from '@/app/api/internal/cron/fix-failed-questions/route';

beforeEach(() => {
  claimFailedBatchMock.mockReset();
  runFixFailedMock.mockReset();
  logOpsEventMock.mockReset();
  fromMock.mockReset();
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        gte: async () => ({ data: [], error: null, count: 0 }),
      }),
    }),
  }));
  process.env.CRON_SECRET = 'test-secret';
});

function makeRequest(secret: string | null) {
  return new Request('http://localhost/api/internal/cron/fix-failed-questions', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('POST /api/internal/cron/fix-failed-questions', () => {
  it('rejects missing secret with 401', async () => {
    const res = await POST(makeRequest(null) as never);
    expect(res.status).toBe(401);
  });

  it('rejects wrong secret with 401', async () => {
    const res = await POST(makeRequest('wrong') as never);
    expect(res.status).toBe(401);
  });

  it('returns 200 with claimed=0 when backlog empty', async () => {
    claimFailedBatchMock.mockResolvedValueOnce([]);
    const res = await POST(makeRequest('test-secret') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ claimed: 0, verified: 0 });
  });

  it('runs the agent once per claimed row and aggregates outcomes', async () => {
    claimFailedBatchMock.mockResolvedValueOnce([
      { id: 'q1' }, { id: 'q2' }, { id: 'q3' },
    ]);
    runFixFailedMock
      .mockResolvedValueOnce({ status: 'success', finalText: 'verified', runId: 'r1', stepCount: 4, tokensInput: 100, tokensOutput: 50 })
      .mockResolvedValueOnce({ status: 'success', finalText: 'marked unfixable', runId: 'r2', stepCount: 2, tokensInput: 50, tokensOutput: 30 })
      .mockRejectedValueOnce(new Error('agent crashed'));

    const res = await POST(makeRequest('test-secret') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBe(3);
    expect(body.errors).toBe(1);
    expect(logOpsEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'qb_fixer', message: 'sweep_complete' }),
    );
  });
});
