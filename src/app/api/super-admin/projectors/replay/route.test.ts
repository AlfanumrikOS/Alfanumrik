/**
 * /api/super-admin/projectors/replay — POST contract tests.
 *
 * Pins:
 *   - authorizeAdmin gate (returns the helper's response on 401).
 *   - Body validation: subscriberName + studentId both required, non-empty.
 *   - Happy path: dispatcher.replayForStudent → 200 with { replayed, errors }.
 *   - 422 refusal: { refused: 'not_student_scoped' } → { error: 'not_student_scoped' }.
 *   - 404 unknown subscriber: thrown "unknown subscriber: <name>" → { error: 'unknown_subscriber' }.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted spies (vi.mock factories are hoisted; vars inside must be too) ──
const { mockReplayForStudent, authorizeAdmin } = vi.hoisted(() => ({
  mockReplayForStudent: vi.fn(),
  authorizeAdmin: vi.fn(),
}));

// ── Dispatcher mock (preserves the real module so route imports survive) ────
vi.mock('@/lib/state/subscribers/dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/state/subscribers/dispatcher')>(
    '@/lib/state/subscribers/dispatcher',
  );
  return {
    ...actual,
    standardDispatcher: {
      ...actual.standardDispatcher,
      replayForStudent: mockReplayForStudent,
    },
  };
});

// ── Auth mock ───────────────────────────────────────────────────────────────
vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
}));

// ── Logger silencer ─────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Supabase admin (route passes it as ctx.sb) ──────────────────────────────
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {},
  getSupabaseAdmin: () => ({}),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    adminId: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    adminLevel: 'super',
  });
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/projectors/replay', {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/super-admin/projectors/replay', () => {
  it('returns 401 when not admin (passes helper response through)', async () => {
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ subscriberName: 'mastery-state-writer', studentId: 's-1' }));
    expect(res.status).toBe(401);
    expect(mockReplayForStudent).not.toHaveBeenCalled();
  });

  it('returns 400 on missing body fields', async () => {
    const res = await POST(makeRequest({ subscriberName: 'mastery-state-writer' }));
    expect(res.status).toBe(400);
    expect(mockReplayForStudent).not.toHaveBeenCalled();
  });

  it('returns 200 with { replayed, errors } on happy path', async () => {
    mockReplayForStudent.mockResolvedValueOnce({ replayed: 5, errors: [] });

    const res = await POST(makeRequest({
      subscriberName: 'mastery-state-writer',
      studentId: 'student-123',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ replayed: 5, errors: [] });
    expect(mockReplayForStudent).toHaveBeenCalledTimes(1);
    expect(mockReplayForStudent).toHaveBeenCalledWith(
      'mastery-state-writer',
      'student-123',
      expect.objectContaining({
        sb: expect.anything(),
        dryRun: false,
        now: expect.any(Function),
        log: expect.any(Function),
      }),
    );
  });

  it('returns 422 with { error: "not_student_scoped" } on dispatcher refusal', async () => {
    mockReplayForStudent.mockResolvedValueOnce({ refused: 'not_student_scoped' });

    const res = await POST(makeRequest({
      subscriberName: 'some-non-student-sub',
      studentId: 'student-123',
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_student_scoped' });
  });

  it('returns 404 with { error: "unknown_subscriber" } when dispatcher throws unknown subscriber', async () => {
    mockReplayForStudent.mockRejectedValueOnce(new Error('unknown subscriber: nope'));

    const res = await POST(makeRequest({
      subscriberName: 'nope',
      studentId: 'student-123',
    }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'unknown_subscriber' });
  });
});
