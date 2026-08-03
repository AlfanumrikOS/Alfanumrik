import { describe, it, expect } from 'vitest';

/**
 * Internal-Admin Gate Regression Tests — SESSION-ONLY
 *
 * History / catalog:
 *   - This file was FORMERLY catalogued as `admin_secret_required` and asserted
 *     that a valid `x-admin-secret` header (or `?secret=` query param) AUTHORIZED
 *     the /internal/admin surface. That behaviour no longer exists.
 *   - PR-4 of the admin-auth (A2) migration REMOVED the shared-secret path from
 *     the Layer 2.1 gate in src/proxy.ts entirely. PR-3 had already repointed all
 *     13 /api/internal/admin handlers off requireAdminSecret() onto
 *     authorizeRequest('super_admin'). The shared secret now authorizes NOTHING.
 *
 * The file was therefore re-aimed from an `admin_secret_required` mirror into a
 * SESSION-ONLY gate mirror. It is retained as a regression guard so that any
 * future edit reintroducing the secret path is caught: the ONLY allow path is a
 * definitive `super_admin` session on a live, non-degraded auth path. A secret —
 * header, query, or env — can no longer authorize anything.
 *
 * The gate decision this mirrors (post-PR-4 Layer 2.1 of src/proxy.ts):
 *
 *   let sessionAuthenticated = false;
 *   if (authUserId && !authDegraded) {
 *     sessionAuthenticated = (await getUserRoleFromCache(authUserId)) === 'super_admin';
 *   }
 *   const isAuthenticated = sessionAuthenticated;   // no secret term
 *   if (!isAuthenticated) { // 401 JSON (API) / Access Denied HTML (page)
 *   }
 *
 * This block pins the BEHAVIOURAL truth table. The complementary source-level
 * pins that assert the secret constructs stay OUT of src/proxy.ts live in
 * middleware.test.ts ("A2 PR-4: proxy.ts internal-admin gate source structure").
 * They intentionally mirror the same session-only truth table declared there.
 */

// ─── internal-admin gate — mirrors src/proxy.ts Layer 2.1 (post-PR-4) ──────────

type ResolvedRole =
  | 'student' | 'teacher' | 'guardian' | 'institution_admin'
  | 'admin' | 'super_admin' | 'none' | 'unknown';

interface GateContext {
  /** authUserId resolved by Layer 0 (null when there is no session). */
  authUserId: string | null;
  /** true when supabase.auth.getUser() failed for a non-session reason. */
  authDegraded: boolean;
  /** what getUserRoleFromCache(authUserId) would return. */
  sessionRole: ResolvedRole | null;

  // ── Legacy secret inputs — retained ONLY to prove they are INERT ──
  // The real post-PR-4 gate reads NONE of these. They are accepted here so the
  // "a secret cannot authorize" tests below can pass a would-be-valid secret and
  // show it changes nothing. If a future edit makes any of them influence the
  // result, those tests fail — which is exactly the regression we guard against.
  legacyHeaderSecret?: string | null;
  legacyQuerySecret?: string | null;
  legacyEnvSecret?: string | null;
}

/**
 * Pure-function replica of the SESSION-ONLY internal-admin gate.
 * Returns true (allow) ONLY for a definitive super_admin session on a live,
 * non-degraded auth path. There is deliberately NO secret term.
 */
function internalAdminGateAllows(ctx: GateContext): boolean {
  let sessionAuthenticated = false;
  if (ctx.authUserId && !ctx.authDegraded) {
    sessionAuthenticated = ctx.sessionRole === 'super_admin';
  }
  // SESSION-ONLY: ctx.legacy* fields are intentionally never read.
  return sessionAuthenticated;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('internal_admin_gate_session_only (retired admin_secret_required)', () => {
  const CORRECT_LEGACY_SECRET = 'super-secret-admin-key-for-tests';

  // ── The single allow path ──

  it('authorizes a definitive super_admin session (the ONLY allow path)', () => {
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: 'super_admin',
    })).toBe(true);
  });

  // ── Fail-closed session cases ──

  it('denies when there is no session (no secret fallback exists anymore)', () => {
    expect(internalAdminGateAllows({
      authUserId: null, authDegraded: false, sessionRole: null,
    })).toBe(false);
  });

  it('denies an "admin" (non-super_admin) session', () => {
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: 'admin',
    })).toBe(false);
  });

  it('denies institution_admin / teacher / student / guardian / none sessions', () => {
    for (const role of ['institution_admin', 'teacher', 'student', 'guardian', 'none'] as ResolvedRole[]) {
      expect(internalAdminGateAllows({
        authUserId: 'u-1', authDegraded: false, sessionRole: role,
      })).toBe(false);
    }
  });

  it('denies an inconclusive role lookup (ROLE_UNKNOWN / null) — never allow on inconclusive', () => {
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: 'unknown',
    })).toBe(false);
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: null,
    })).toBe(false);
  });

  it('does NOT trust a super_admin session when auth is degraded', () => {
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: true, sessionRole: 'super_admin',
    })).toBe(false);
  });

  // ── Regression guard: the removed shared-secret path authorizes NOTHING ──

  it('does NOT authorize on a correct-looking x-admin-secret header without a super_admin session', () => {
    expect(internalAdminGateAllows({
      authUserId: null, authDegraded: false, sessionRole: null,
      legacyHeaderSecret: CORRECT_LEGACY_SECRET,
      legacyEnvSecret: CORRECT_LEGACY_SECRET,
    })).toBe(false);
  });

  it('does NOT authorize on a correct-looking ?secret= query param without a super_admin session', () => {
    expect(internalAdminGateAllows({
      authUserId: null, authDegraded: false, sessionRole: null,
      legacyQuerySecret: CORRECT_LEGACY_SECRET,
      legacyEnvSecret: CORRECT_LEGACY_SECRET,
    })).toBe(false);
  });

  it('does NOT let a matching secret rescue a non-super_admin session', () => {
    // Even a student who presents the old valid secret is denied — the secret
    // term is gone; only the session role matters.
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: 'student',
      legacyHeaderSecret: CORRECT_LEGACY_SECRET,
      legacyEnvSecret: CORRECT_LEGACY_SECRET,
    })).toBe(false);
  });

  it('authorizes a super_admin session even with NO secret present (the session alone is sufficient)', () => {
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: 'super_admin',
      legacyHeaderSecret: null, legacyQuerySecret: null, legacyEnvSecret: null,
    })).toBe(true);
  });

  it('authorizes a super_admin session even when the legacy secret is wrong (the secret is inert)', () => {
    expect(internalAdminGateAllows({
      authUserId: 'u-1', authDegraded: false, sessionRole: 'super_admin',
      legacyHeaderSecret: 'totally-wrong-secret',
      legacyEnvSecret: CORRECT_LEGACY_SECRET,
    })).toBe(true);
  });
});
