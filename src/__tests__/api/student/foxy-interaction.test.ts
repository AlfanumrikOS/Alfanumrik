/**
 * POST /api/student/foxy-interaction — save_flashcard schema conformance.
 *
 * Wave 0 Task 0.7a: production `spaced_repetition_cards` had 0 rows because
 * this route inserted phantom columns (`question`, `answer`, `difficulty`)
 * that don't exist in the table, and omitted the NOT-NULL `grade`,
 * `front_text`, `back_text` columns. Every insert failed silently.
 *
 * These tests pin the insert payload to the REAL schema (baseline migration
 * 00000000000000_baseline_from_prod.sql ~line 13552) via an exact key
 * allowlist, and pin the silent-failure elimination (explicit error response
 * + logger.warn with the Postgres error code, no card text in logs — P13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/foxy-interaction/route';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({
    authorized: true,
    userId: 'user-uuid-1',
    studentId: 'student-uuid-1',
  })),
}));

// Logger mock — keeps the test isolated from @sentry/nextjs (same pattern as
// src/__tests__/api/learner/cards/create.test.ts).
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Subject guard passes by default.
vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn(async () => ({ ok: true })),
}));

const insertMock = vi.fn();

const studentLookup: {
  result: { data: { grade: string | null } | null; error: { code?: string; message: string } | null };
} = { result: { data: { grade: '9' }, error: null } };

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
      // spaced_repetition_cards / ai_response_reports insert path — the route
      // awaits `.insert(row)` directly and reads `{ error }`.
      return {
        insert: (row: unknown) => Promise.resolve(insertMock(row)),
      };
    }),
    rpc: vi.fn(async () => ({ error: null })),
  },
}));

function mkReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/student/foxy-interaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Exact allowlist of columns the route is permitted to write. Every key here
 * exists in the production table; `question`, `answer` and `difficulty` do NOT
 * and must never reappear.
 */
const ALLOWED_COLUMNS = [
  'student_id',
  'subject',
  'grade',
  'topic',
  'front_text',
  'back_text',
  'source',
].sort();

describe('POST /api/student/foxy-interaction — save_flashcard', () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockReturnValue({ error: null });
    studentLookup.result = { data: { grade: '9' }, error: null };
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it('inserts only real schema columns (exact allowlist, no phantom question/answer/difficulty)', async () => {
    const res = await POST(mkReq({
      action: 'save_flashcard',
      subject: 'science',
      topic: 'Photosynthesis',
      question: 'What do plants need for photosynthesis?',
      answer: 'Sunlight, water and carbon dioxide',
    }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;

    // Exact key set — nothing outside the real schema.
    expect(Object.keys(row).sort()).toEqual(ALLOWED_COLUMNS);
    expect(row).not.toHaveProperty('question');
    expect(row).not.toHaveProperty('answer');
    expect(row).not.toHaveProperty('difficulty');

    // NOT-NULL columns are populated.
    expect(row.student_id).toBe('student-uuid-1');
    expect(row.subject).toBe('science');
    expect(row.grade).toBe('9');
    expect(typeof row.grade).toBe('string'); // P5
    // P5 shape pin: string "6".."12" — toMatch throws on non-strings, so this
    // also re-proves grade can never regress to a number.
    expect(row.grade).toMatch(/^([6-9]|1[0-2])$/);
    expect(row.front_text).toBe('What do plants need for photosynthesis?');
    expect(row.back_text).toBe('Sunlight, water and carbon dioxide');
    expect(row.source).toBe('foxy_chat');
  });

  it('falls back to a generated front_text when no question is provided', async () => {
    const res = await POST(mkReq({
      action: 'save_flashcard',
      subject: 'science',
      topic: 'Photosynthesis',
      answer: 'Sunlight, water and carbon dioxide',
    }));
    expect(res.status).toBe(200);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof row.front_text).toBe('string');
    expect((row.front_text as string).length).toBeGreaterThan(0);
  });

  it('returns 400 with a clear error when the student profile has no grade', async () => {
    studentLookup.result = { data: { grade: null }, error: null };
    const res = await POST(mkReq({
      action: 'save_flashcard',
      subject: 'science',
      question: 'q',
      answer: 'a',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns an explicit 500 and logs a warning with the pg error code when the insert fails', async () => {
    insertMock.mockReturnValueOnce({
      error: { code: '23502', message: 'null value in column "grade" violates not-null constraint' },
    });
    const res = await POST(mkReq({
      action: 'save_flashcard',
      subject: 'science',
      question: 'Secret card text that must not be logged',
      answer: 'a',
    }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    const [, meta] = vi.mocked(logger.warn).mock.calls[0];
    expect(meta).toMatchObject({ code: '23502' });
    // P13 key-level pin: the logged object carries ONLY pg error code +
    // constraint message + routing context (studentId is a UUID, subject a
    // code) — never front_text/back_text/question/answer keys.
    expect(Object.keys(meta as Record<string, unknown>).sort()).toEqual(
      ['code', 'message', 'studentId', 'subject'],
    );
    // P13: no card text in logs.
    expect(JSON.stringify(meta)).not.toContain('Secret card text');
  });

  it('returns 409 duplicate_card on the unique (student_id, topic, card_type) index violation', async () => {
    insertMock.mockReturnValueOnce({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_src_u"' },
    });
    const res = await POST(mkReq({
      action: 'save_flashcard',
      subject: 'science',
      topic: 'Photosynthesis',
      question: 'q',
      answer: 'a',
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
