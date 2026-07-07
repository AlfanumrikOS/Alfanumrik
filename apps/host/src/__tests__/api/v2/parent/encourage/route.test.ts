/**
 * POST /api/v2/parent/encourage — Wave D "D-encourage" contract tests.
 *
 * Pins:
 *   1. authorizeRequest gate fires with the `child.encourage` permission and
 *      returns the auth errorResponse verbatim when not authorized.
 *   2. 403 when the caller has no guardian profile.
 *   3. 403 when the guardian is NOT linked to the requested student
 *      (cross-guardian isolation).
 *   4. 400 when a message_key is PRESENT but unknown (forged / typo key).
 *   5. Default key applied when message_key is absent (no 400).
 *   6. 429 when a cheer was already sent within the last 6 hours.
 *   7. 200 happy path: send_notification called with the correct args
 *      (recipient_type='student', type='parent_cheer', preset-derived title/body,
 *      PII-free data jsonb) AND a parent_cheers row inserted with the
 *      returned notification_id.
 *   8. 502 when send_notification fails (no cheer row written).
 *
 * Mocking follows the established parent-route pattern
 * (src/__tests__/api/parent-child-export.test.ts): authorizeRequest + logAudit
 * are stubbed via @alfanumrik/lib/rbac; the domain helpers are stubbed; supabaseAdmin is
 * replaced with a tiny in-memory chain that supports the exact calls the route
 * makes (.from(...).select(...).eq(...).gt(...).limit(...).maybeSingle(),
 * .from(...).insert(...), and .rpc(...)).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock holders ──────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockGetGuardian: vi.fn(),
  mockIsLinked: vi.fn(),
  mockLogAudit: vi.fn(),
  mockRpc: vi.fn(),
  mockCheerInsert: vi.fn(),
  mockState: {} as {
    recentCheer?: Record<string, unknown> | null;
    recentCheerError?: { message: string } | null;
    studentLanguage?: string | null;
  },
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  logAudit: (...a: unknown[]) => holders.mockLogAudit(...a),
}));

vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));

vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  isGuardianLinkedToStudent: (...a: unknown[]) => holders.mockIsLinked(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  // The route makes three distinct table interactions:
  //   parent_cheers  → SELECT (rate-limit check) and INSERT (record)
  //   students       → SELECT preferred_language
  // plus an .rpc('send_notification', ...) call.
  const buildSelectChain = (table: string) => {
    const chain = {
      eq() {
        return chain;
      },
      gt() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        if (table === 'parent_cheers') {
          if (holders.mockState.recentCheerError) {
            return Promise.resolve({ data: null, error: holders.mockState.recentCheerError });
          }
          return Promise.resolve({ data: holders.mockState.recentCheer ?? null, error: null });
        }
        if (table === 'students') {
          return Promise.resolve({
            data:
              holders.mockState.studentLanguage !== undefined
                ? { preferred_language: holders.mockState.studentLanguage }
                : { preferred_language: 'en' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (t: string) => ({
        select: () => buildSelectChain(t),
        insert: (...a: unknown[]) => holders.mockCheerInsert(...a),
      }),
      rpc: (...a: unknown[]) => holders.mockRpc(...a),
    },
  };
});

// ── Fixture IDs (valid RFC4122 v4) ────────────────────────────────────
const GUARDIAN_AUTH_X = '11111111-1111-4111-a111-111111111111';
const GUARDIAN_ID_X = '22222222-2222-4222-a222-222222222222';
const STUDENT_X = '33333333-3333-4333-a333-333333333333';
const NOTIFICATION_ID = '66666666-6666-4666-a666-666666666666';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v2/parent/encourage', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt.x', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authAsParent(authUserId: string = GUARDIAN_AUTH_X) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: authUserId,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.encourage'],
  });
}

function asGuardian(guardianId: string = GUARDIAN_ID_X, authUserId: string = GUARDIAN_AUTH_X) {
  holders.mockGetGuardian.mockResolvedValue({
    ok: true,
    data: { id: guardianId, authUserId, name: 'Test Parent', email: 'p@x.com', phone: null },
  });
}

function linked(value = true) {
  holders.mockIsLinked.mockResolvedValue({ ok: true, data: value });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.mockState.recentCheer = null;
  holders.mockState.recentCheerError = null;
  holders.mockState.studentLanguage = 'en';
  // Defaults for the happy path.
  holders.mockRpc.mockResolvedValue({ data: NOTIFICATION_ID, error: null });
  holders.mockCheerInsert.mockResolvedValue({ data: null, error: null });
});

// ── 1. Auth gate ──────────────────────────────────────────────────────
describe('POST /api/v2/parent/encourage — auth gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      studentId: null,
      roles: ['student'],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const res = await POST(makeRequest({ student_id: STUDENT_X }));
    expect(res.status).toBe(403);
    // Domain helpers must never run when authZ fails.
    expect(holders.mockGetGuardian).not.toHaveBeenCalled();
    expect(holders.mockRpc).not.toHaveBeenCalled();
  });

  it('asks authorizeRequest for the child.encourage permission', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    await POST(makeRequest({ student_id: STUDENT_X, message_key: 'keep_going' }));
    expect(holders.mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.encourage');
  });

  it('returns 400 when student_id is not a valid UUID', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    const res = await POST(makeRequest({ student_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });
});

// ── 2. Ownership ──────────────────────────────────────────────────────
describe('POST /api/v2/parent/encourage — ownership', () => {
  it('returns 403 when the caller has no guardian profile', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    holders.mockGetGuardian.mockResolvedValue({ ok: true, data: null });
    const res = await POST(makeRequest({ student_id: STUDENT_X }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/parent/i);
    expect(holders.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the guardian is not linked to the student', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(false);
    const res = await POST(makeRequest({ student_id: STUDENT_X }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not linked/i);
    // No cheer sent for an unlinked child.
    expect(holders.mockRpc).not.toHaveBeenCalled();
    expect(holders.mockCheerInsert).not.toHaveBeenCalled();
  });
});

// ── 3. message_key validation ─────────────────────────────────────────
describe('POST /api/v2/parent/encourage — message_key handling', () => {
  it('returns 400 for a present-but-unknown message_key', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    const res = await POST(
      makeRequest({ student_id: STUDENT_X, message_key: 'definitely_not_a_real_key' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown message_key/i);
    expect(holders.mockRpc).not.toHaveBeenCalled();
  });

  it('applies the DEFAULT key when message_key is absent (no 400)', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    const res = await POST(makeRequest({ student_id: STUDENT_X }));
    expect(res.status).toBe(200);
    expect(holders.mockRpc).toHaveBeenCalledTimes(1);
    const [, args] = holders.mockRpc.mock.calls[0];
    // DEFAULT_MESSAGE_KEY = 'great_work' → cheerType 'generic'.
    expect((args as { p_data: { message_key: string } }).p_data.message_key).toBe('great_work');
    // The recorded cheer row carries the resolved default key.
    const insertArg = holders.mockCheerInsert.mock.calls[0][0] as { message_key: string };
    expect(insertArg.message_key).toBe('great_work');
  });
});

// ── 4. Rate limit ─────────────────────────────────────────────────────
describe('POST /api/v2/parent/encourage — rate limit', () => {
  it('returns 429 when a cheer was sent within the last 6 hours', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    holders.mockState.recentCheer = { id: 'recent-cheer-1' };
    const res = await POST(makeRequest({ student_id: STUDENT_X, message_key: 'so_proud' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.success).toBe(false);
    // Bilingual rate-limit copy.
    expect(body.error).toBeTruthy();
    // A rate-limited request sends no notification and writes no cheer row.
    expect(holders.mockRpc).not.toHaveBeenCalled();
    expect(holders.mockCheerInsert).not.toHaveBeenCalled();
  });
});

// ── 5. Happy path ─────────────────────────────────────────────────────
describe('POST /api/v2/parent/encourage — happy path', () => {
  it('sends a notification with correct args and records the cheer (200)', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    const res = await POST(makeRequest({ student_id: STUDENT_X, message_key: 'streak_star' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    // send_notification called with the expected shape.
    expect(holders.mockRpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = holders.mockRpc.mock.calls[0];
    expect(rpcName).toBe('send_notification');
    const a = args as {
      p_recipient_id: string;
      p_recipient_type: string;
      p_type: string;
      p_title: string;
      p_body: string;
      p_data: Record<string, unknown>;
      p_channel: string;
    };
    expect(a.p_recipient_id).toBe(STUDENT_X);
    expect(a.p_recipient_type).toBe('student');
    expect(a.p_type).toBe('parent_cheer');
    expect(a.p_channel).toBe('in_app');
    // English title (default student language) for the streak preset.
    expect(a.p_title).toMatch(/streak/i);
    expect(typeof a.p_body).toBe('string');
    // data jsonb carries only UUIDs / enums / preset keys — no PII.
    expect(a.p_data.guardian_id).toBe(GUARDIAN_ID_X);
    expect(a.p_data.cheer_type).toBe('streak');
    expect(a.p_data.message_key).toBe('streak_star');
    const dataStr = JSON.stringify(a.p_data);
    expect(dataStr).not.toMatch(/p@x\.com/); // no guardian email
    expect(dataStr).not.toMatch(/Test Parent/); // no guardian name

    // parent_cheers row inserted with the RPC-returned notification_id.
    expect(holders.mockCheerInsert).toHaveBeenCalledTimes(1);
    const insertArg = holders.mockCheerInsert.mock.calls[0][0] as {
      guardian_id: string;
      student_id: string;
      cheer_type: string;
      message_key: string;
      notification_id: string;
    };
    expect(insertArg.guardian_id).toBe(GUARDIAN_ID_X);
    expect(insertArg.student_id).toBe(STUDENT_X);
    expect(insertArg.cheer_type).toBe('streak');
    expect(insertArg.message_key).toBe('streak_star');
    expect(insertArg.notification_id).toBe(NOTIFICATION_ID);

    // Audit row written, PII-free.
    expect(holders.mockLogAudit).toHaveBeenCalledTimes(1);
    const auditEntry = holders.mockLogAudit.mock.calls[0][1] as {
      action: string;
      status?: string;
      details: Record<string, unknown>;
    };
    expect(auditEntry.action).toBe('parent.child_encouraged');
    expect(auditEntry.status).toBe('success');
    expect(auditEntry.details.message_key).toBe('streak_star');
  });

  it('renders the Hindi title when the child prefers Hindi', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    holders.mockState.studentLanguage = 'hi';
    const res = await POST(makeRequest({ student_id: STUDENT_X, message_key: 'great_work' }));
    expect(res.status).toBe(200);
    const [, args] = holders.mockRpc.mock.calls[0];
    const a = args as { p_title: string; p_data: { title_hi: string } };
    // Primary title rendered in Hindi; both languages still present in data.
    expect(a.p_title).toBe(a.p_data.title_hi);
  });
});

// ── 6. Notification failure ───────────────────────────────────────────
describe('POST /api/v2/parent/encourage — notification failure', () => {
  it('returns 502 and does NOT write a cheer row when send_notification fails', async () => {
    const { POST } = await import('@/app/api/v2/parent/encourage/route');
    authAsParent();
    asGuardian();
    linked(true);
    holders.mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc boom' } });
    const res = await POST(makeRequest({ student_id: STUDENT_X, message_key: 'keep_going' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    // No error message leaks the underlying DB/RPC detail.
    expect(body.error).not.toMatch(/rpc boom/);
    expect(holders.mockCheerInsert).not.toHaveBeenCalled();
  });
});
