/**
 * claimAdminToken() — Phase 1 Track A admin-claim helper.
 *
 * Pins the idempotency + non-leak contract of the claim flow described in
 * `src/lib/school-provisioning.ts`:
 *
 *   - fresh, unconsumed, unexpired token → activates the school_admins link
 *     (accepted_at stamped + is_active=true) AND consumes the token (consumed_at
 *     written, only where consumed_at IS NULL).
 *   - a SECOND call with the now-consumed token → returns `already_claimed`
 *     (a success) WITHOUT re-running the activate UPDATE (no re-activation of a
 *     stranger, no double-stamp).
 *   - expired (not-yet-consumed) token → `expired`.
 *   - unknown token hash → `invalid_token`.
 *   - too-short raw token → `invalid_token` (rejected before any DB read).
 *   - P13: the helper looks the token up by its SHA-256 HASH, never by the raw
 *     value; the raw token, the password, and the principal email are never
 *     passed to the logger.
 *
 * Pure unit test — the Supabase admin client + GoTrue admin API are mocked with a
 * small in-memory fake (mirrors the table-dispatch mock style in
 * src/__tests__/api/super-admin/bulk-onboard.test.ts and
 * api/school-admin-students-seat-cap.test.ts). No live DB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import { claimAdminToken, hashClaimToken } from '@alfanumrik/lib/school-provisioning';

// ── Logger spy so we can assert no PII ever reaches it (P13) ──────────────
const loggerCalls: { level: string; event: string; meta: unknown }[] = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (event: string, meta: unknown) => loggerCalls.push({ level: 'info', event, meta }),
    warn: (event: string, meta: unknown) => loggerCalls.push({ level: 'warn', event, meta }),
    error: (event: string, meta: unknown) => loggerCalls.push({ level: 'error', event, meta }),
    debug: (event: string, meta: unknown) => loggerCalls.push({ level: 'debug', event, meta }),
  },
}));

// ── In-memory fake admin client ──────────────────────────────────────────
// Captures the exact (column,value) the helper looks tokens up by, so we can
// assert it queried by HASH, never by the raw token (P13).

const RAW_TOKEN = 'a'.repeat(24) + 'ZyXwVu'; // >= 16 chars, deterministic
const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');
const SCHOOL_ID = '00000000-0000-0000-0000-0000000000aa';
const SCHOOL_ADMIN_ID = '00000000-0000-0000-0000-0000000000bb';
const AUTH_USER_ID = '00000000-0000-0000-0000-0000000000cc';

interface FakeToken {
  id: string;
  school_id: string;
  school_admin_id: string;
  expires_at: string;
  consumed_at: string | null;
}

interface FakeState {
  token: FakeToken | null;
  /** the column the helper filtered claim tokens on (P13 assertion). */
  tokenLookupColumn: string | null;
  tokenLookupValue: string | null;
  link: { id: string; auth_user_id: string; is_active: boolean } | null;
  activateUpdates: Array<Record<string, unknown>>;
  consumeUpdates: number;
  passwordSets: Array<{ userId: string; password: string }>;
  /** When true, the GoTrue password update returns an error (best-effort fail). */
  passwordUpdateFails: boolean;
}

let state: FakeState;

function makeAdmin() {
  return {
    auth: {
      admin: {
        updateUserById: async (userId: string, attrs: { password?: string }) => {
          if (attrs.password) state.passwordSets.push({ userId, password: attrs.password });
          if (state.passwordUpdateFails) {
            return { data: { user: null }, error: { message: 'gotrue update failed' } };
          }
          return { data: { user: { id: userId } }, error: null };
        },
      },
    },
    from(table: string) {
      if (table === 'school_admin_claim_tokens') {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              state.tokenLookupColumn = col;
              state.tokenLookupValue = val;
              return {
                // The fake row only resolves when the helper queried by the
                // correct SHA-256 hash — proving it never looks up by raw token.
                maybeSingle: async () => ({
                  data: state.token && val === TOKEN_HASH ? state.token : null,
                  error: null,
                }),
              };
            },
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              is: async () => {
                state.consumeUpdates++;
                if (state.token) state.token.consumed_at = patch.consumed_at as string;
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === 'school_admins') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.link, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              state.activateUpdates.push(patch);
              if (state.link) state.link.is_active = true;
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function freshToken(overrides: Partial<FakeToken> = {}): FakeToken {
  return {
    id: 'tok-1',
    school_id: SCHOOL_ID,
    school_admin_id: SCHOOL_ADMIN_ID,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    consumed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  loggerCalls.length = 0;
  state = {
    token: freshToken(),
    tokenLookupColumn: null,
    tokenLookupValue: null,
    link: { id: SCHOOL_ADMIN_ID, auth_user_id: AUTH_USER_ID, is_active: false },
    activateUpdates: [],
    consumeUpdates: 0,
    passwordSets: [],
    passwordUpdateFails: false,
  };
});

describe('claimAdminToken — fresh token activation', () => {
  it('activates the link (accepted_at + is_active) and consumes the token', async () => {
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, null);

    expect(res.status).toBe('claimed');
    if (res.status !== 'claimed') return;
    expect(res.school_id).toBe(SCHOOL_ID);
    expect(res.school_admin_id).toBe(SCHOOL_ADMIN_ID);
    expect(res.auth_user_id).toBe(AUTH_USER_ID);

    // The activate UPDATE stamped accepted_at and set is_active true.
    expect(state.activateUpdates.length).toBe(1);
    expect(state.activateUpdates[0]).toMatchObject({ is_active: true });
    expect(state.activateUpdates[0].accepted_at).toBeTruthy();

    // The token was consumed exactly once.
    expect(state.consumeUpdates).toBe(1);
  });

  it('P13: looks the token up by its SHA-256 HASH, never the raw token', async () => {
    await claimAdminToken(makeAdmin(), RAW_TOKEN, null);
    expect(state.tokenLookupColumn).toBe('token_hash');
    expect(state.tokenLookupValue).toBe(hashClaimToken(RAW_TOKEN));
    expect(state.tokenLookupValue).not.toBe(RAW_TOKEN);
  });

  it('best-effort password set is applied when a valid password is supplied', async () => {
    await claimAdminToken(makeAdmin(), RAW_TOKEN, 'super-secret-pw');
    expect(state.passwordSets.length).toBe(1);
    expect(state.passwordSets[0].userId).toBe(AUTH_USER_ID);
  });

  it('does not attempt a password set when none is supplied', async () => {
    await claimAdminToken(makeAdmin(), RAW_TOKEN, null);
    expect(state.passwordSets.length).toBe(0);
  });
});

describe('claimAdminToken — password_set accuracy (DELTA, P15 best-effort)', () => {
  it('reports password_set:true when the GoTrue update genuinely succeeds', async () => {
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, 'super-secret-pw');
    expect(res.status).toBe('claimed');
    if (res.status !== 'claimed') return;
    expect(res.password_set).toBe(true);
    // The link is activated regardless.
    expect(state.activateUpdates.length).toBe(1);
  });

  it('reports password_set:false when the GoTrue update FAILS — link STILL activates', async () => {
    state.passwordUpdateFails = true;
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, 'super-secret-pw');
    expect(res.status).toBe('claimed');
    if (res.status !== 'claimed') return;
    // The genuine GoTrue failure is threaded through — NOT silently reported true.
    expect(res.password_set).toBe(false);
    // P15: a password-set failure must NOT block activation.
    expect(state.activateUpdates.length).toBe(1);
    expect(state.activateUpdates[0]).toMatchObject({ is_active: true });
    // The token was still consumed (the claim completed).
    expect(state.consumeUpdates).toBe(1);
  });

  it('reports password_set:false when no password was supplied (nothing to set)', async () => {
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, null);
    expect(res.status).toBe('claimed');
    if (res.status !== 'claimed') return;
    expect(res.password_set).toBe(false);
    expect(state.passwordSets.length).toBe(0);
  });

  it('a too-short password is not sent to GoTrue and reports password_set:false', async () => {
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, 'short');
    expect(res.status).toBe('claimed');
    if (res.status !== 'claimed') return;
    expect(res.password_set).toBe(false);
    expect(state.passwordSets.length).toBe(0);
    // Activation still happened.
    expect(state.activateUpdates.length).toBe(1);
  });
});

describe('claimAdminToken — idempotency (already-consumed token)', () => {
  it('returns already_claimed WITHOUT re-activating the link or re-consuming', async () => {
    // Pre-consume the token + leave the link already active (as a first claim would).
    state.token = freshToken({ consumed_at: new Date().toISOString() });
    state.link = { id: SCHOOL_ADMIN_ID, auth_user_id: AUTH_USER_ID, is_active: true };

    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, null);

    expect(res.status).toBe('already_claimed');
    if (res.status !== 'already_claimed') return;
    expect(res.school_id).toBe(SCHOOL_ID);
    expect(res.school_admin_id).toBe(SCHOOL_ADMIN_ID);
    expect(res.auth_user_id).toBe(AUTH_USER_ID);

    // CRITICAL: the activation UPDATE never ran a second time (no re-activation of
    // a stranger, no double accepted_at stamp), and the consume UPDATE didn't fire.
    expect(state.activateUpdates.length).toBe(0);
    expect(state.consumeUpdates).toBe(0);
  });

  it('a replayed consumed token never sets a password (no stranger re-activation)', async () => {
    state.token = freshToken({ consumed_at: new Date().toISOString() });
    state.link = { id: SCHOOL_ADMIN_ID, auth_user_id: AUTH_USER_ID, is_active: true };
    await claimAdminToken(makeAdmin(), RAW_TOKEN, 'attacker-supplied-pw');
    expect(state.passwordSets.length).toBe(0);
  });
});

describe('claimAdminToken — rejection paths', () => {
  it('rejects an expired (not-yet-consumed) token as expired', async () => {
    state.token = freshToken({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, null);
    expect(res.status).toBe('expired');
    expect(state.activateUpdates.length).toBe(0);
    expect(state.consumeUpdates).toBe(0);
  });

  it('rejects an unknown token (no matching hash) as invalid_token', async () => {
    state.token = null; // no token row resolves for the hash
    const res = await claimAdminToken(makeAdmin(), RAW_TOKEN, null);
    expect(res.status).toBe('invalid_token');
    expect(state.activateUpdates.length).toBe(0);
  });

  it('rejects a too-short raw token before any DB read (invalid_token)', async () => {
    const res = await claimAdminToken(makeAdmin(), 'short', null);
    expect(res.status).toBe('invalid_token');
    // Never queried the token table.
    expect(state.tokenLookupColumn).toBeNull();
  });

  it('rejects an empty raw token (invalid_token)', async () => {
    const res = await claimAdminToken(makeAdmin(), '', null);
    expect(res.status).toBe('invalid_token');
    expect(state.tokenLookupColumn).toBeNull();
  });
});

describe('claimAdminToken — P13 no-PII logging', () => {
  it('never passes the raw token, password, or any email to the logger', async () => {
    await claimAdminToken(makeAdmin(), RAW_TOKEN, 'a-very-secret-password');
    const serialized = JSON.stringify(loggerCalls);
    expect(serialized).not.toContain(RAW_TOKEN);
    expect(serialized).not.toContain('a-very-secret-password');
    expect(serialized).not.toContain(TOKEN_HASH);
    // Sanity: the helper has no email argument at all — but assert structurally too.
    expect(serialized).not.toMatch(/@[a-z]+\.[a-z]+/i);
  });
});
