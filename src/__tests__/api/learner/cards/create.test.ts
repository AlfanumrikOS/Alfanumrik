import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/learner/cards/create/route';
import { NextRequest } from 'next/server';

// Mock the auth helper and admin client. The route is fully covered by these
// two mocks — no real Supabase call is made.
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({
    authorized: true,
    userId: 'user-uuid-1',
    studentId: 'student-uuid-1',
  })),
}));

// Logger mock — keep test isolated from @sentry/nextjs (which the real
// logger imports). Mirrors the pattern used in dashboard-reviews-due.test.ts.
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const insertMock = vi.fn();

// The route performs two operations on `spaced_repetition_cards`:
//   1) a daily-cap count: .select('id', {count, head}).eq().eq().gte()
//   2) the insert:        .insert(row).select('id').single()
//
// We expose the cap-count chain as a passthrough returning `{ count: 0 }`
// (always under the 20/day cap in tests), and route the insert through the
// `insertMock` so individual tests can assert what was written.
const capCountChain = {
  select: vi.fn(() => capCountChain),
  eq: vi.fn(() => capCountChain),
  gte: vi.fn(() => Promise.resolve({ count: 0, error: null })),
};

// After insert(row) the route chains .select('id').single() — wrap insertMock's
// result into that shape.
const insertChain = (insertResult: { data: unknown; error: unknown }) => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(insertResult)),
  })),
});

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      // Cap-count path
      select: capCountChain.select,
      // Insert path (always returns the chain shape the route expects)
      insert: (...args: unknown[]) => {
        // Record the row argument so tests can assert on it.
        const [row] = args;
        const result = insertMock(row);
        return insertChain(result);
      },
    })),
  },
}));

function mkReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/learner/cards/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/learner/cards/create', () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockReturnValue({ data: { id: 'card-uuid-1' }, error: null });
    // Re-arm the cap-count chain (some tests may consume it).
    capCountChain.select.mockClear();
    capCountChain.eq.mockClear();
    capCountChain.gte.mockClear();
    capCountChain.gte.mockResolvedValue({ count: 0, error: null });
  });

  it('rejects body missing subjectCode', async () => {
    const res = await POST(mkReq({ frontText: 'q', backText: 'a' }));
    expect(res.status).toBe(400);
  });

  it('rejects frontText longer than 200 chars', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'x'.repeat(201),
      backText: 'a',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects backText longer than 200 chars', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'x'.repeat(201),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects hint longer than 100 chars', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'a',
      hint: 'x'.repeat(101),
    }));
    expect(res.status).toBe(400);
  });

  it('inserts a card with source=student_created and SM-2 defaults', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'What is force?',
      backText: 'Mass times acceleration',
    }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0];
    expect(row.student_id).toBe('student-uuid-1');
    expect(row.subject).toBe('physics');
    expect(row.front_text).toBe('What is force?');
    expect(row.back_text).toBe('Mass times acceleration');
    expect(row.source).toBe('student_created');
    expect(row.ease_factor).toBe(2.5);
    expect(row.interval_days).toBe(1);
    expect(row.repetition_count).toBe(0);
    expect(row.streak).toBe(0);
  });

  it('returns 500 when the insert errors', async () => {
    insertMock.mockReturnValueOnce({ data: null, error: { message: 'db down' } });
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'a',
    }));
    expect(res.status).toBe(500);
  });
});
