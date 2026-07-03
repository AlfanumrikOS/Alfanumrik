import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/learner/cards/create/route';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

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

// The route performs three operations:
//   1) students grade lookup: .from('students').select('grade').eq('id', ...).single()
//   2) a daily-cap count:     .select('id', {count, head}).eq().eq().gte()
//   3) the insert:            .insert(row).select('id').single()
//
// We expose the cap-count chain as a passthrough returning `{ count: 0 }`
// (always under the 20/day cap in tests), route the insert through the
// `insertMock` so individual tests can assert what was written, and expose the
// grade lookup as a mutable holder so tests can simulate a missing grade.
const capCountChain = {
  select: vi.fn(() => capCountChain),
  eq: vi.fn(() => capCountChain),
  gte: vi.fn(() => Promise.resolve({ count: 0, error: null })),
};

const studentLookup: {
  result: { data: { grade: string | null } | null; error: { code?: string; message: string } | null };
} = { result: { data: { grade: '8' }, error: null } };

// After insert(row) the route chains .select('id').single() — wrap insertMock's
// result into that shape.
const insertChain = (insertResult: { data: unknown; error: unknown }) => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(insertResult)),
  })),
});

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'students') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(studentLookup.result)),
            })),
          })),
        };
      }
      return {
        // Cap-count path
        select: capCountChain.select,
        // Insert path (always returns the chain shape the route expects)
        insert: (...args: unknown[]) => {
          // Record the row argument so tests can assert on it.
          const [row] = args;
          const result = insertMock(row);
          return insertChain(result);
        },
      };
    }),
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
    // Default: the student profile has a valid string grade.
    studentLookup.result = { data: { grade: '8' }, error: null };
    vi.mocked(logger.warn).mockClear();
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

  it('includes the grade (P5 string) from the student profile in the insert row', async () => {
    studentLookup.result = { data: { grade: '10' }, error: null };
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'What is force?',
      backText: 'Mass times acceleration',
    }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0];
    // NOT-NULL column in spaced_repetition_cards — omitting it made every
    // insert fail silently (Wave 0 Task 0.7a root cause).
    expect(row.grade).toBe('10');
    expect(typeof row.grade).toBe('string');
    // P5 shape pin: a string "6".."12" — the /^([6-9]|1[0-2])$/ shape would
    // fail for the number 10 (toMatch throws on non-strings), so this line
    // also re-proves grade is never a number.
    expect(row.grade).toMatch(/^([6-9]|1[0-2])$/);
  });

  it('sends ONLY real schema columns (exact key allowlist — no phantom columns)', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'What is force?',
      backText: 'Mass times acceleration',
      hint: 'F = ma',
    }));
    expect(res.status).toBe(200);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    // Every key below exists in the production table (baseline migration
    // 00000000000000_baseline_from_prod.sql ~line 13552). Any new/renamed key
    // in the route MUST be schema-verified before this list is updated.
    expect(Object.keys(row).sort()).toEqual([
      'back_text',
      'chapter_title',
      'correct_reviews',
      'created_at',
      'ease_factor',
      'front_text',
      'grade',
      'hint',
      'interval_days',
      'last_review_date',
      'next_review_date',
      'repetition_count',
      'source',
      'streak',
      'student_id',
      'subject',
      'total_reviews',
      'updated_at',
    ]);
    // Phantom columns from the pre-fix era must never reappear.
    expect(row).not.toHaveProperty('question');
    expect(row).not.toHaveProperty('answer');
    expect(row).not.toHaveProperty('difficulty');
  });

  it('returns 400 with a clear error when the student profile has no grade', async () => {
    studentLookup.result = { data: { grade: null }, error: null };
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'a',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('grade_missing');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns 500 and logs a warning (with pg error code) when the insert errors', async () => {
    insertMock.mockReturnValueOnce({
      data: null,
      error: { code: '23502', message: 'null value in column "grade" violates not-null constraint' },
    });
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'a',
    }));
    expect(res.status).toBe(500);
    expect(logger.warn).toHaveBeenCalled();
    const [, meta] = vi.mocked(logger.warn).mock.calls[0];
    expect(meta).toMatchObject({ code: '23502' });
    // P13 key-level pin: the logged object carries ONLY the pg error code +
    // constraint-level message — never front_text/back_text/question keys.
    expect(Object.keys(meta as Record<string, unknown>).sort()).toEqual(['code', 'message']);
    // P13: card text must not leak into logs.
    expect(JSON.stringify(meta)).not.toContain('What is force');
  });
});
