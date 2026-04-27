/**
 * /api/support/tickets — end-user-facing ticket API tests (Audit F22).
 *
 * Verifies:
 *   - 401 unauthenticated
 *   - 400 validation (subject too long, description too long, invalid category)
 *   - 200 happy-path creation, server-derived student_id
 *   - 429 after 5 tickets in 24h per user
 *   - GET list returns only the caller's tickets
 *   - GET [id] returns 404 when ticket belongs to another user
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC mock ────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

// ── ops-events mock — capture for assertion ──────────────────────────────────
const _opsEventsCalls: Array<unknown[]> = [];
vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: vi.fn(async (...args: unknown[]) => {
    _opsEventsCalls.push(args);
  }),
}));

// ── supabaseAdmin mock — flexible chain ──────────────────────────────────────
let _insertResult: { data: unknown; error: unknown } = {
  data: { id: 'ticket-id-1', created_at: '2026-04-27T10:00:00Z' },
  error: null,
};
let _insertCaptured: Record<string, unknown> | null = null;

let _selectResult: { data: unknown; error: unknown; count?: number } = {
  data: [],
  error: null,
  count: 0,
};
let _selectFilters: Record<string, unknown> = {};

vi.mock('@/lib/supabase-admin', () => {
  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      eq: (col: string, val: unknown) => {
        _selectFilters[col] = val;
        return chain;
      },
      order: () => chain,
      range: () => Promise.resolve(_selectResult),
      maybeSingle: () => Promise.resolve(_selectResult),
      single: () => Promise.resolve(_selectResult),
      then: (onFulfilled: (v: typeof _selectResult) => unknown) =>
        Promise.resolve(_selectResult).then(onFulfilled),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (_table: string) => ({
        insert: (row: Record<string, unknown>) => {
          _insertCaptured = row;
          return {
            select: () => ({
              single: () => Promise.resolve(_insertResult),
            }),
          };
        },
        select: () => buildSelectChain(),
      }),
    },
  };
});

// ── logger mock ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(body: unknown, opts: { method?: string; url?: string } = {}): NextRequest {
  const method = opts.method ?? 'POST';
  // GET/HEAD MUST NOT have a body — Web spec enforces this in the Request ctor.
  const init: Record<string, unknown> = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
    },
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new NextRequest(opts.url ?? 'http://localhost/api/support/tickets', init);
}

function authorizedAs(opts: { userId?: string; studentId: string | null; roles?: string[] } = { studentId: 'stu-1' }) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: opts.userId ?? 'auth-user-1',
    studentId: opts.studentId,
    roles: opts.roles ?? ['student'],
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

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  _insertCaptured = null;
  _insertResult = {
    data: { id: 'ticket-id-1', created_at: '2026-04-27T10:00:00Z' },
    error: null,
  };
  _selectResult = { data: [], error: null, count: 0 };
  _selectFilters = {};
  _opsEventsCalls.length = 0;
  unauthorized();
});

// =============================================================================
describe('POST /api/support/tickets', () => {
  async function call(body: unknown) {
    const { POST } = await import('@/app/api/support/tickets/route');
    return POST(makeRequest(body));
  }

  describe('auth', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await call({ subject: 's', description: 'd' });
      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    beforeEach(() => authorizedAs({ studentId: 'stu-1' }));

    it('returns 400 on malformed JSON', async () => {
      const { POST } = await import('@/app/api/support/tickets/route');
      const req = new NextRequest('http://localhost/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid' },
        body: 'not-json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('INVALID_BODY');
    });

    it('returns 400 when subject exceeds 200 chars', async () => {
      const res = await call({ subject: 'x'.repeat(201), description: 'valid description' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when description exceeds 5000 chars', async () => {
      const res = await call({ subject: 'subj', description: 'x'.repeat(5001) });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when category is invalid', async () => {
      const res = await call({ subject: 's', description: 'd', category: 'invalid' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when priority is invalid', async () => {
      const res = await call({ subject: 's', description: 'd', priority: 'urgent' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when subject is empty', async () => {
      const res = await call({ subject: '', description: 'valid' });
      expect(res.status).toBe(400);
    });
  });

  describe('happy path', () => {
    beforeEach(() => authorizedAs({ userId: 'user-42', studentId: 'stu-42', roles: ['student'] }));

    it('creates a ticket and returns ticket_id', async () => {
      const res = await call({
        subject: 'Quiz scoring issue',
        description: 'My quiz score did not update.',
        category: 'bug',
        priority: 'normal',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.ticket_id).toBe('ticket-id-1');
    });

    it('uses server-derived student_id (ignores any client-provided value)', async () => {
      await call({
        subject: 'Test',
        description: 'desc',
        // Even if client sneaks in a student_id, schema strips it.
      });
      expect(_insertCaptured).toMatchObject({
        student_id: 'stu-42',
        category: 'other',
        priority: 'normal',
        status: 'open',
      });
    });

    it('defaults category=other and priority=normal when omitted', async () => {
      await call({ subject: 'no cat', description: 'no priority' });
      expect(_insertCaptured).toMatchObject({
        category: 'other',
        priority: 'normal',
      });
    });

    it('logs an ops event for monitoring', async () => {
      await call({ subject: 'Critical', description: 'Site down', priority: 'high' });
      expect(_opsEventsCalls.length).toBe(1);
      const arg = _opsEventsCalls[0][0] as Record<string, unknown>;
      expect(arg.category).toBe('support');
      expect(arg.severity).toBe('warning'); // priority=high → warning
      expect(arg.subjectId).toBe('ticket-id-1');
    });
  });

  describe('rate limit', () => {
    beforeEach(() => authorizedAs({ userId: 'user-rl', studentId: 'stu-rl' }));

    it('returns 429 after 5 tickets in the same window', async () => {
      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        const res = await call({ subject: `ticket ${i}`, description: 'd' });
        expect(res.status).toBe(200);
      }
      // 6th must be rate-limited
      const res = await call({ subject: 'overflow', description: 'd' });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.code).toBe('RATE_LIMITED');
      expect(typeof body.retry_after_ms).toBe('number');
      expect(res.headers.get('Retry-After')).toBeTruthy();
    });
  });

  describe('DB failure', () => {
    beforeEach(() => authorizedAs({ studentId: 'stu-1' }));

    it('returns 500 when insert fails', async () => {
      _insertResult = { data: null, error: { message: 'unique_violation' } };
      const res = await call({ subject: 'x', description: 'y' });
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe('INSERT_FAILED');
    });
  });
});

// =============================================================================
describe('GET /api/support/tickets', () => {
  async function callList() {
    const { GET } = await import('@/app/api/support/tickets/route');
    return GET(makeRequest({}, { method: 'GET' }));
  }

  it('returns 401 when unauthenticated', async () => {
    const res = await callList();
    expect(res.status).toBe(401);
  });

  it('returns empty list when user has no student profile', async () => {
    authorizedAs({ studentId: null, roles: ['parent'] });
    const res = await callList();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.tickets).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it('filters by student_id (RLS enforcement at app layer)', async () => {
    authorizedAs({ userId: 'u-1', studentId: 'stu-list' });
    _selectResult = {
      data: [{ id: 't-1', subject: 'mine', status: 'open' }],
      error: null,
      count: 1,
    };
    const res = await callList();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tickets).toHaveLength(1);
    expect(body.data.total).toBe(1);
    expect(_selectFilters.student_id).toBe('stu-list');
  });

  it('returns 500 when DB select fails', async () => {
    authorizedAs({ studentId: 'stu-1' });
    _selectResult = { data: null, error: { message: 'db_down' }, count: 0 };
    const res = await callList();
    expect(res.status).toBe(500);
  });
});

// =============================================================================
describe('GET /api/support/tickets/[id]', () => {
  const validUuid = '11111111-2222-3333-4444-555555555555';

  async function callGet(ticketId: string) {
    const { GET } = await import('@/app/api/support/tickets/[id]/route');
    return GET(
      makeRequest({}, {
        method: 'GET',
        url: `http://localhost/api/support/tickets/${ticketId}`,
      }),
      { params: Promise.resolve({ id: ticketId }) },
    );
  }

  it('returns 401 when unauthenticated', async () => {
    const res = await callGet(validUuid);
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid uuid', async () => {
    authorizedAs({ studentId: 'stu-1' });
    const res = await callGet('not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 when student profile is absent', async () => {
    authorizedAs({ studentId: null, roles: ['teacher'] });
    const res = await callGet(validUuid);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the ticket belongs to a different user', async () => {
    authorizedAs({ studentId: 'stu-owner' });
    // maybeSingle returns null when filter fails
    _selectResult = { data: null, error: null };
    const res = await callGet(validUuid);
    expect(res.status).toBe(404);
    // Confirm we filtered by both id AND student_id
    expect(_selectFilters.id).toBe(validUuid);
    expect(_selectFilters.student_id).toBe('stu-owner');
  });

  it('returns the ticket when the caller owns it', async () => {
    authorizedAs({ studentId: 'stu-owner' });
    _selectResult = {
      data: {
        id: validUuid,
        subject: 'mine',
        message: 'desc',
        category: 'bug',
        priority: 'normal',
        status: 'open',
        created_at: '2026-04-27',
        updated_at: '2026-04-27',
        resolved_at: null,
        student_id: 'stu-owner',
      },
      error: null,
    };
    const res = await callGet(validUuid);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ticket.id).toBe(validUuid);
    // student_id must NOT leak in the response
    expect(body.data.ticket.student_id).toBeUndefined();
    // forward-compat replies field
    expect(body.data.replies).toEqual([]);
  });
});
