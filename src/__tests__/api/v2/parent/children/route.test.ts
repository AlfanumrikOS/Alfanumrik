/**
 * GET /api/v2/parent/children — Wave 2.4 contract tests.
 *
 * Pins:
 *   1. authorizeRequest gate fires with `child.view_progress` and returns the
 *      auth errorResponse verbatim when not authorized (401/403).
 *   2. 403 when the caller has no guardian profile.
 *   3. 200 happy path: reuses listChildrenForGuardian and projects to the
 *      contract shape — name + grade(P5 string) only, NO email/phone (P13).
 *   4. Envelope shape is the /v2 `{ success, data }` wrapper with schemaVersion.
 *   5. The response data round-trips through the registered Zod schema
 *      (contract conformance).
 *   6. 500 (no raw error text) when the domain read fails.
 *
 * Mocking follows the encourage-route pattern: authorizeRequest + the domain
 * helpers are stubbed; no real DB is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParentChildrenResponse } from '@/lib/api/v2/contract';
import { z } from 'zod';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockGetGuardian: vi.fn(),
  mockListChildren: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));

vi.mock('@/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));

vi.mock('@/lib/domains/relationship', () => ({
  listChildrenForGuardian: (...a: unknown[]) => holders.mockListChildren(...a),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const GUARDIAN_AUTH = '11111111-1111-4111-a111-111111111111';
const GUARDIAN_ID = '22222222-2222-4222-a222-222222222222';
const STUDENT_A = '33333333-3333-4333-a333-333333333333';
const STUDENT_B = '44444444-4444-4444-a444-444444444444';

const successEnvelope = z.object({ success: z.literal(true), data: ParentChildrenResponse });

function makeRequest(): Request {
  return new Request('http://localhost/api/v2/parent/children', {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt.x' },
  });
}

function authAsParent(userId: string = GUARDIAN_AUTH) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.view_progress'],
  });
}

function asGuardian(id: string = GUARDIAN_ID) {
  holders.mockGetGuardian.mockResolvedValue({
    ok: true,
    data: { id, authUserId: GUARDIAN_AUTH, name: 'Test Parent', email: 'p@x.com', phone: '+919999999999' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v2/parent/children — auth gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
    expect(holders.mockGetGuardian).not.toHaveBeenCalled();
    expect(holders.mockListChildren).not.toHaveBeenCalled();
  });

  it('asks authorizeRequest for the child.view_progress permission', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    authAsParent();
    asGuardian();
    holders.mockListChildren.mockResolvedValue({ ok: true, data: [] });
    await GET(makeRequest() as never);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.view_progress');
  });
});

describe('GET /api/v2/parent/children — ownership', () => {
  it('returns 403 when the caller has no guardian profile', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    authAsParent();
    holders.mockGetGuardian.mockResolvedValue({ ok: true, data: null });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/parent/i);
    expect(holders.mockListChildren).not.toHaveBeenCalled();
  });
});

describe('GET /api/v2/parent/children — happy path', () => {
  it('returns the linked children in the /v2 envelope, name+grade only (P13)', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    authAsParent();
    asGuardian();
    holders.mockListChildren.mockResolvedValue({
      ok: true,
      data: [
        { studentId: STUDENT_A, name: 'Asha', grade: '9', schoolId: 's1', linkId: 'l1', linkStatus: 'approved', linkedAt: null },
        { studentId: STUDENT_B, name: 'Ravi', grade: '7', schoolId: null, linkId: 'l2', linkStatus: 'active', linkedAt: null },
      ],
    });

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Envelope + schemaVersion.
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.children).toHaveLength(2);

    // P5: grade is a string.
    expect(body.data.children[0]).toEqual({ student_id: STUDENT_A, name: 'Asha', grade: '9' });
    expect(typeof body.data.children[0].grade).toBe('string');

    // P13: no PII leaked — the whole payload carries no email/phone/schoolId.
    const str = JSON.stringify(body.data);
    expect(str).not.toMatch(/p@x\.com/);
    expect(str).not.toMatch(/\+919999999999/);
    expect(str).not.toMatch(/schoolId|school_id/);

    // Reused the relationship-domain read with the JWT-resolved auth user.
    expect(holders.mockListChildren).toHaveBeenCalledWith(GUARDIAN_AUTH);
  });

  it('returns an empty children array when the guardian has no links', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    authAsParent();
    asGuardian();
    holders.mockListChildren.mockResolvedValue({ ok: true, data: [] });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.children).toEqual([]);
  });

  it('response data round-trips through the registered Zod schema', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    authAsParent();
    asGuardian();
    holders.mockListChildren.mockResolvedValue({
      ok: true,
      data: [
        { studentId: STUDENT_A, name: 'Asha', grade: '9', schoolId: null, linkId: 'l1', linkStatus: 'approved', linkedAt: null },
        { studentId: STUDENT_B, name: null, grade: null, schoolId: null, linkId: 'l2', linkStatus: 'active', linkedAt: null },
      ],
    });
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    const parsed = successEnvelope.safeParse(body);
    if (!parsed.success) {
      throw new Error(`conformance failed: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.success).toBe(true);
  });
});

describe('GET /api/v2/parent/children — failure', () => {
  it('returns 500 with no raw error text when the domain read fails', async () => {
    const { GET } = await import('@/app/api/v2/parent/children/route');
    authAsParent();
    asGuardian();
    holders.mockListChildren.mockResolvedValue({ ok: false, error: 'DB exploded: secret detail', code: 'DB_ERROR' });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).not.toMatch(/DB exploded/);
    expect(body.error).not.toMatch(/secret detail/);
  });
});
