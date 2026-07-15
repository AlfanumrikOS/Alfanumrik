import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 4 — JWT/RLS tenant-isolation hardening (P8 + P13).
 *
 * Unit coverage for setSchoolClaim(): the helper that writes
 * `app_metadata.school_id` (the ONLY claim get_jwt_school_id() reads for the
 * school-staff RLS SELECT policies). Verifies:
 *   (a) MERGE — existing app_metadata keys survive; only school_id is added/replaced.
 *   (b) IDEMPOTENT — re-setting the same school_id skips the write entirely.
 *   (c) FAIL-SOFT — every failure path returns a structured result and NEVER throws.
 *   (d) P13 — no email / token is ever logged, even on a logging failure path.
 *
 * The service-role admin client (getSupabaseAdmin) is mocked at the MODULE seam
 * so no real GoTrue/env/network is touched (mock the Supabase client, not the
 * business logic under test).
 */

const { getUserById, updateUserById } = vi.hoisted(() => ({
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById, updateUserById } },
  }),
}));

import { setSchoolClaim } from './school-claim';

const AUTH_USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const SCHOOL_A = 'bbbbbbbb-1111-4111-8111-111111111111';
const SCHOOL_B = 'cccccccc-2222-4222-8222-222222222222';

/** Shape returned by admin.auth.admin.getUserById(). */
function fetched(
  app_metadata: Record<string, unknown>,
  extraUserFields: Record<string, unknown> = {}
) {
  return {
    data: { user: { id: AUTH_USER, app_metadata, ...extraUserFields } },
    error: null,
  };
}

beforeEach(() => {
  getUserById.mockReset();
  updateUserById.mockReset();
  updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
});

describe('setSchoolClaim — MERGE (never clobber)', () => {
  it('preserves an existing app_metadata key (provider) while adding school_id', async () => {
    getUserById.mockResolvedValue(
      fetched({ provider: 'email', providers: ['email'], role: 'principal' })
    );

    const res = await setSchoolClaim(AUTH_USER, SCHOOL_A);

    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById).toHaveBeenCalledWith(AUTH_USER, {
      app_metadata: {
        provider: 'email',
        providers: ['email'],
        role: 'principal',
        school_id: SCHOOL_A,
      },
    });
    expect(res).toEqual({ ok: true, changed: true, reason: 'set' });
  });

  it('replaces ONLY school_id when a different one exists — other keys untouched', async () => {
    getUserById.mockResolvedValue(fetched({ provider: 'email', school_id: SCHOOL_B }));

    const res = await setSchoolClaim(AUTH_USER, SCHOOL_A);

    expect(updateUserById).toHaveBeenCalledWith(AUTH_USER, {
      app_metadata: { provider: 'email', school_id: SCHOOL_A },
    });
    expect(res).toEqual({ ok: true, changed: true, reason: 'set' });
  });

  it('handles a null/absent app_metadata (writes just school_id)', async () => {
    getUserById.mockResolvedValue(fetched(null as unknown as Record<string, unknown>));

    const res = await setSchoolClaim(AUTH_USER, SCHOOL_A);

    expect(updateUserById).toHaveBeenCalledWith(AUTH_USER, {
      app_metadata: { school_id: SCHOOL_A },
    });
    expect(res.reason).toBe('set');
  });
});

describe('setSchoolClaim — idempotent no-op', () => {
  it('skips the update call when school_id already equals the target', async () => {
    getUserById.mockResolvedValue(fetched({ provider: 'email', school_id: SCHOOL_A }));

    const res = await setSchoolClaim(AUTH_USER, SCHOOL_A);

    expect(updateUserById).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, changed: false, reason: 'noop_already_set' });
  });
});

describe('setSchoolClaim — fail-soft (never throws)', () => {
  it('invalid input (missing authUserId) → structured result, never fetches', async () => {
    const res = await setSchoolClaim('', SCHOOL_A);
    expect(res).toEqual({ ok: false, changed: false, reason: 'invalid_input' });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('invalid input (missing schoolId) → structured result, never fetches', async () => {
    const res = await setSchoolClaim(AUTH_USER, '');
    expect(res).toEqual({ ok: false, changed: false, reason: 'invalid_input' });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('user-not-found → structured result, no update, no throw', async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: null });

    await expect(setSchoolClaim(AUTH_USER, SCHOOL_A)).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'user_not_found',
    });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('fetch failure → fetch_failed, no update, no throw', async () => {
    getUserById.mockResolvedValue({ data: null, error: { message: 'gotrue unavailable' } });

    await expect(setSchoolClaim(AUTH_USER, SCHOOL_A)).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'fetch_failed',
    });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('update failure → update_failed, no throw', async () => {
    getUserById.mockResolvedValue(fetched({ provider: 'email' }));
    updateUserById.mockResolvedValue({ data: null, error: { message: 'write rejected' } });

    await expect(setSchoolClaim(AUTH_USER, SCHOOL_A)).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'update_failed',
    });
  });

  it('thrown error inside the admin call is caught → threw (never rejects)', async () => {
    getUserById.mockRejectedValue(new Error('socket hang up'));

    await expect(setSchoolClaim(AUTH_USER, SCHOOL_A)).resolves.toEqual({
      ok: false,
      changed: false,
      reason: 'threw',
    });
  });
});

describe('setSchoolClaim — P13 (no PII in logs)', () => {
  it('never logs email or token even when a failure path logs', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const EMAIL = 'principal.secret@example.com';
    const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-access-token';

    // A user carrying PII + a token-shaped field is fetched, then the write fails
    // (a logging codepath). The claim helper must log opaque uuids only.
    getUserById.mockResolvedValue(
      fetched({ provider: 'email', access_token: TOKEN }, { email: EMAIL })
    );
    updateUserById.mockResolvedValue({ data: null, error: { message: 'write rejected' } });

    await setSchoolClaim(AUTH_USER, SCHOOL_A);

    expect(errSpy).toHaveBeenCalled(); // prove a logging path actually ran
    const logged = errSpy.mock.calls.flat().map((v) => String(v)).join(' | ');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(TOKEN);

    errSpy.mockRestore();
  });

  it('does not log at all on the happy MERGE path', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserById.mockResolvedValue(fetched({ provider: 'email' }));

    await setSchoolClaim(AUTH_USER, SCHOOL_A);

    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
