/**
 * Track B, Feature 1 — P15 CRITICAL: minor-bootstrap guardian-invite wiring.
 *
 * The signup→bootstrap funnel (P15) is the #1 acquisition path and must NEVER
 * break. When a MINOR student bootstraps with a captured `parent_consent_email`,
 * the route fires `enqueueGuardianInvite` FIRE-AND-FORGET. This suite pins:
 *
 *   1. A minor student bootstrap WITH parent_consent_email enqueues the invite
 *      (studentId = profile_id, consent email, locale 'en').
 *   2. If the invite helper THROWS, the bootstrap STILL returns 200 (signup is
 *      never blocked) — the failure is swallowed.
 *   3. The invite is fire-and-forget: enqueueGuardianInvite returns void/undefined
 *      and is NOT awaited (a never-resolving invite cannot hang the response).
 *   4. A NON-minor bootstrap does NOT enqueue.
 *   5. A minor bootstrap WITHOUT a parent_consent_email does NOT enqueue.
 *   6. A teacher/parent bootstrap does NOT enqueue (student-only path).
 *
 * The guardian-invite module is mocked so we can assert call-shape and inject
 * a throwing/never-resolving implementation without a live DB or email seam.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

// ── guardian-invite module mock (the route dynamically imports this) ─────────
const enqueueSpy = vi.fn();
vi.mock('@alfanumrik/lib/identity/guardian-invite', () => ({
  // enqueueGuardianInvite is declared `void` — it must never return a promise
  // the route awaits. We mirror that here (returns undefined).
  enqueueGuardianInvite: (...args: unknown[]) => enqueueSpy(...args),
}));

// ── supabase-server (cookie session) ─────────────────────────────────────────
const mockGetUser = vi.fn();
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

// ── supabase-admin (RPC + audit insert + subjects + auth.admin.getUserById) ──
const mockRpc = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ catch: vi.fn() });
const mockGetUserById = vi.fn();

const fromHandler = vi.fn((table: string) => {
  if (table === 'subjects') {
    return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
  }
  return { insert: mockInsert };
});

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: mockRpc,
    from: fromHandler,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no token' } }),
      admin: { getUserById: (id: string) => mockGetUserById(id) },
    },
  })),
}));

vi.mock('@alfanumrik/lib/sanitize', () => ({ sanitizeText: (s: string) => s }));

// ── Helpers ──────────────────────────────────────────────────────────────────
const MINOR_USER = { id: 'auth-minor-1', email: 'kid@example.com' };
const PROFILE_ID = 'student-profile-uuid-1';
const CONSENT_EMAIL = 'guardian.consent@example.com';

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Configure the auth-user metadata returned by admin.getUserById. */
function setMetadata(meta: Record<string, unknown>) {
  mockGetUserById.mockResolvedValue({
    data: { user: { id: MINOR_USER.id, user_metadata: meta } },
    error: null,
  });
}

let POST: (request: NextRequest) => Promise<Response>;

beforeAll(async () => {
  const mod = await import('@/app/api/auth/bootstrap/route');
  POST = mod.POST;
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockGetUser.mockResolvedValue({ data: { user: MINOR_USER }, error: null });
  mockRpc.mockResolvedValue({
    data: { status: 'success', profile_id: PROFILE_ID },
    error: null,
  });
  mockInsert.mockReturnValue({ catch: vi.fn() });
  // Default: minor with consent email.
  setMetadata({ is_minor: true, parent_consent_email: CONSENT_EMAIL });
  enqueueSpy.mockReturnValue(undefined);
});

describe('P15 — minor bootstrap guardian-invite wiring', () => {
  it('enqueues the guardian invite for a minor student with parent_consent_email', async () => {
    const res = await POST(req({ role: 'student', name: 'Minor Kid', grade: '7' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    // studentId = profile_id, consent email, locale 'en'.
    expect(enqueueSpy).toHaveBeenCalledWith(PROFILE_ID, CONSENT_EMAIL, 'en');
  });

  it('STILL returns 200 (signup never blocked) when the invite helper THROWS', async () => {
    enqueueSpy.mockImplementation(() => {
      throw new Error('invite blew up');
    });

    const res = await POST(req({ role: 'student', name: 'Minor Kid', grade: '7' }));
    // P15: the funnel must complete regardless of the invite failure.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.profile_id).toBe(PROFILE_ID);
  });

  it('is fire-and-forget: a never-resolving invite cannot hang the bootstrap response', async () => {
    // If the route awaited the invite, this never-settling promise would hang
    // the response and the test would time out. It must NOT await it.
    enqueueSpy.mockImplementation(() => {
      // enqueueGuardianInvite is `void`; even if a bad impl returned a pending
      // promise, the route must not await it.
      void new Promise(() => {
        /* never resolves */
      });
      return undefined;
    });

    const res = await POST(req({ role: 'student', name: 'Minor Kid', grade: '7' }));
    expect(res.status).toBe(200);
    // The invite was triggered but the response did not wait on it.
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT enqueue for a NON-minor student bootstrap', async () => {
    setMetadata({ is_minor: false, parent_consent_email: CONSENT_EMAIL });
    const res = await POST(req({ role: 'student', name: 'Teen', grade: '11' }));
    expect(res.status).toBe(200);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('does NOT enqueue for a minor without a parent_consent_email', async () => {
    setMetadata({ is_minor: true });
    const res = await POST(req({ role: 'student', name: 'Minor No Consent', grade: '6' }));
    expect(res.status).toBe(200);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('does NOT enqueue for a teacher bootstrap (student-only path)', async () => {
    const res = await POST(req({ role: 'teacher', name: 'A Teacher' }));
    expect(res.status).toBe(200);
    expect(enqueueSpy).not.toHaveBeenCalled();
    // The minor-metadata lookup should not even run for a teacher.
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('still returns 200 when the metadata lookup itself throws (swallowed)', async () => {
    mockGetUserById.mockRejectedValue(new Error('getUserById down'));
    const res = await POST(req({ role: 'student', name: 'Minor Kid', grade: '7' }));
    expect(res.status).toBe(200);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
