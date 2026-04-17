/**
 * POST /api/support/ai-issue — student flags a problematic AI answer.
 *
 * Verifies:
 *   - 401 when unauthenticated
 *   - 403 when authenticated but no student profile
 *   - 400 on invalid reasonCategory
 *   - 400 on malformed JSON
 *   - 200 + { success:true, id } on successful insert (happy path)
 *   - 500 on DB insert failure (logs without PII leakage)
 *   - Server ignores client-provided studentId (always uses auth.studentId)
 *   - UUID fields (traceId/messageId/questionBankId) pass through; invalid
 *     shapes are coerced to null so the DB FK stays clean.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Shared thenable chain proxy (same pattern as api-routes.test.ts) ────────
function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then')        return p.then.bind(p);
      if (prop === 'catch')       return p.catch.bind(p);
      if (prop === 'finally')     return p.finally.bind(p);
      if (prop === 'single')      return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

// ─── RBAC mock ──────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: vi.fn(),
}));

// ─── supabaseAdmin mock ─────────────────────────────────────────────────────
// Capture the last INSERT payload so we can assert the server-derived
// student_id and ignored client fields.
let _insertCaptured: Record<string, unknown> | null = null;
let _insertResult: unknown = { data: { id: 'new-report-id' }, error: null };

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (_table: string) => {
      const built = {
        insert: (row: Record<string, unknown>) => {
          _insertCaptured = row;
          return chain(_insertResult);
        },
      };
      return built as unknown as ReturnType<typeof chain>;
    },
  },
}));

// ─── Logger mock ────────────────────────────────────────────────────────────
const _loggedErrors: unknown[] = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: (...args: unknown[]) => { _loggedErrors.push(args); },
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/support/ai-issue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function authorizedAs(studentId: string | null, userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId,
    roles: ['student'],
    permissions: ['foxy.chat'],
    errorResponse: null,
  });
}

function unauthorized() {
  const response = new Response(
    JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: response,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _insertCaptured = null;
  _insertResult = { data: { id: 'new-report-id' }, error: null };
  _loggedErrors.length = 0;
  unauthorized();
});

// =============================================================================
describe('POST /api/support/ai-issue', () => {
  async function call(body: unknown) {
    const { POST } = await import('@/app/api/support/ai-issue/route');
    return POST(makeRequest(body));
  }

  describe('auth', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await call({ reasonCategory: 'wrong_answer' });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toMatchObject({ error: expect.stringMatching(/unauthorized/i) });
    });

    it('returns 403 when authenticated but no student profile', async () => {
      authorizedAs(null);
      const res = await call({ reasonCategory: 'wrong_answer' });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toMatchObject({ code: 'STUDENT_REQUIRED' });
    });

    it('requires the foxy.chat permission', async () => {
      authorizedAs('stu-1');
      await call({ reasonCategory: 'wrong_answer' });
      expect(_authorizeImpl).toHaveBeenCalledWith(expect.anything(), 'foxy.chat');
    });
  });

  describe('input validation', () => {
    beforeEach(() => authorizedAs('stu-1'));

    it('returns 400 on malformed JSON', async () => {
      const { POST } = await import('@/app/api/support/ai-issue/route');
      const req = new NextRequest('http://localhost/api/support/ai-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
        body: 'not-json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_BODY');
    });

    it('returns 400 when reasonCategory is missing', async () => {
      const res = await call({});
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_REASON');
    });

    it('returns 400 when reasonCategory is not one of the 5 allowed values', async () => {
      const res = await call({ reasonCategory: 'bogus' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_REASON');
    });

    it.each([
      'wrong_answer',
      'off_topic',
      'inappropriate',
      'unclear',
      'other',
    ])('accepts reasonCategory = %s', async (reason) => {
      const res = await call({ reasonCategory: reason });
      expect(res.status).toBe(200);
    });
  });

  describe('happy path', () => {
    beforeEach(() => authorizedAs('stu-42'));

    it('returns 200 + { success:true, id } on successful insert', async () => {
      const res = await call({
        reasonCategory: 'wrong_answer',
        comment: 'The formula was wrong',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, id: 'new-report-id' });
    });

    it('writes student_id from auth, NOT from client payload (anti-IDOR)', async () => {
      await call({
        reasonCategory: 'wrong_answer',
        student_id: 'stu-evil',      // client attempt — must be ignored
        studentId:  'stu-evil-2',
      });
      expect(_insertCaptured).toMatchObject({
        student_id: 'stu-42',
        reason_category: 'wrong_answer',
      });
    });

    it('stores valid UUIDs for trace/message/question fields', async () => {
      const traceUuid = '11111111-2222-3333-4444-555555555555';
      const msgUuid   = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const qbUuid    = '12345678-1234-1234-1234-123456789012';
      await call({
        reasonCategory: 'off_topic',
        traceId: traceUuid,
        messageId: msgUuid,
        questionBankId: qbUuid,
      });
      expect(_insertCaptured).toMatchObject({
        trace_id: traceUuid,
        foxy_message_id: msgUuid,
        question_bank_id: qbUuid,
      });
    });

    it('coerces non-UUID trace/message values to null (prevents FK errors)', async () => {
      await call({
        reasonCategory: 'other',
        traceId: 'not-a-uuid',
        messageId: 42,
        questionBankId: { nested: 'obj' },
      });
      expect(_insertCaptured).toMatchObject({
        trace_id: null,
        foxy_message_id: null,
        question_bank_id: null,
      });
    });

    it('truncates comment over 500 chars', async () => {
      await call({
        reasonCategory: 'unclear',
        comment: 'x'.repeat(800),
      });
      const row = _insertCaptured as Record<string, unknown>;
      expect(String(row.student_comment).length).toBe(500);
    });

    it('stores null student_comment when comment is empty after trim', async () => {
      await call({
        reasonCategory: 'other',
        comment: '   ',
      });
      expect(_insertCaptured).toMatchObject({ student_comment: null });
    });
  });

  describe('DB failure', () => {
    beforeEach(() => authorizedAs('stu-1'));

    it('returns 500 when insert fails', async () => {
      _insertResult = { data: null, error: { message: 'unique_violation' } };
      const res = await call({ reasonCategory: 'wrong_answer' });
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe('INSERT_FAILED');
    });

    it('logs the error (structured, no raw comment)', async () => {
      _insertResult = { data: null, error: { message: 'db_down' } };
      await call({ reasonCategory: 'wrong_answer', comment: 'sensitive text' });
      expect(_loggedErrors.length).toBeGreaterThan(0);
      const [, ctx] = _loggedErrors[0] as unknown[];
      const ctxString = JSON.stringify(ctx);
      expect(ctxString).not.toContain('sensitive text');
    });
  });
});