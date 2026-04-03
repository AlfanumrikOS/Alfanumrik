import { describe, it, expect } from 'vitest';

/**
 * Admin Panel Regression Tests
 *
 * Catalog ID covered:
 *   - admin_secret_required
 *
 * The x-admin-secret check lives in middleware.ts (Layer 2.1). It is an
 * inline guard — not exported from admin-auth.ts — so we replicate the exact
 * branching logic here as a pure function and test every branch.
 *
 * The guard logic (from middleware.ts):
 *
 *   const headerSecret = request.headers.get('x-admin-secret');
 *   const querySecret  = request.nextUrl.searchParams.get('secret');
 *   const providedSecret = headerSecret || querySecret;
 *
 *   if (!secretKey || !providedSecret || !timingSafeEqual(providedSecret, secretKey)) {
 *     return 401;
 *   }
 *
 * timingSafeEqual (also from middleware.ts) is a constant-time string
 * comparison that avoids leaking length via timing. If lengths differ it
 * forces a full comparison against itself before returning false.
 */

// ─── timingSafeEqual — mirrors middleware.ts exactly (post-fix) ──────────────
// The original middleware.ts implementation had a bug where `b = a` made all
// XOR comparisons zero, causing different-length strings to incorrectly match.
// Both this copy and middleware.ts have been corrected.

function timingSafeEqual(a: string, b: string): boolean {
  // Pre-flag mismatch when lengths differ so result is always false in that case.
  // Still iterate the full length to prevent timing leaks on length differences.
  let mismatch = a.length === b.length ? 0 : 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

// ─── Admin secret gate — mirrors middleware.ts Layer 2.1 ─────────────────────

type AdminGateResult = 'authorized' | 'rejected';

/**
 * Pure-function replica of the admin secret gate from middleware.ts.
 *
 * @param secretKey   Value of process.env.SUPER_ADMIN_SECRET (or null if unset)
 * @param headerSecret  Value of x-admin-secret request header (or null if absent)
 * @param querySecret   Value of ?secret= query param (or null if absent)
 */
function checkAdminSecretGate(
  secretKey: string | null,
  headerSecret: string | null,
  querySecret: string | null
): AdminGateResult {
  const providedSecret = headerSecret || querySecret;
  if (!secretKey || !providedSecret || !timingSafeEqual(providedSecret, secretKey)) {
    return 'rejected';
  }
  return 'authorized';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('admin_secret_required', () => {
  const CORRECT_SECRET = 'super-secret-admin-key-for-tests';

  it('rejects request with missing x-admin-secret header', () => {
    // No header, no query param — should be rejected.
    expect(checkAdminSecretGate(CORRECT_SECRET, null, null)).toBe('rejected');
  });

  it('rejects request with wrong x-admin-secret value', () => {
    expect(checkAdminSecretGate(CORRECT_SECRET, CORRECT_SECRET.slice(0, -1) + 'X', null)).toBe('rejected');
    // Completely different string of same length as CORRECT_SECRET (32 chars)
    expect(checkAdminSecretGate(CORRECT_SECRET, 'A'.repeat(CORRECT_SECRET.length), null)).toBe('rejected');
  });

  it('accepts request with correct x-admin-secret value', () => {
    expect(checkAdminSecretGate(CORRECT_SECRET, CORRECT_SECRET, null)).toBe('authorized');
  });

  it('accepts correct secret supplied via query param (page access)', () => {
    // Page routes use ?secret= because browsers cannot set custom headers for
    // navigation requests. The middleware falls back to querySecret.
    expect(checkAdminSecretGate(CORRECT_SECRET, null, CORRECT_SECRET)).toBe('authorized');
  });

  it('header takes precedence over query param when both are provided', () => {
    // Header wins — if the header value is correct, authorize even if query is wrong.
    expect(checkAdminSecretGate(CORRECT_SECRET, CORRECT_SECRET, 'wrong')).toBe('authorized');
    // Header wrong (same-length), query correct — header wins (|| short-circuits), so rejected.
    const wrongSameLength = CORRECT_SECRET.slice(0, -1) + 'X';
    expect(checkAdminSecretGate(CORRECT_SECRET, wrongSameLength, CORRECT_SECRET)).toBe('rejected');
  });

  it('comparison is case-sensitive', () => {
    const upper = CORRECT_SECRET.toUpperCase();
    expect(checkAdminSecretGate(CORRECT_SECRET, upper, null)).toBe('rejected');

    const mixed = CORRECT_SECRET[0].toUpperCase() + CORRECT_SECRET.slice(1);
    expect(checkAdminSecretGate(CORRECT_SECRET, mixed, null)).toBe('rejected');
  });

  it('rejects when SUPER_ADMIN_SECRET env var is not configured (secretKey is null)', () => {
    // Even with the correct-looking header, a missing server secret rejects all.
    expect(checkAdminSecretGate(null, CORRECT_SECRET, null)).toBe('rejected');
    expect(checkAdminSecretGate(null, null, null)).toBe('rejected');
  });

  it('rejects an empty string secret even if env var is set', () => {
    // An empty providedSecret is falsy — the guard treats it as missing.
    expect(checkAdminSecretGate(CORRECT_SECRET, '', null)).toBe('rejected');
    expect(checkAdminSecretGate(CORRECT_SECRET, null, '')).toBe('rejected');
  });
});

// ─── timingSafeEqual unit tests ───────────────────────────────────────────────

describe('timingSafeEqual (admin secret comparison)', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('returns false for strings that differ in content', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ABC')).toBe(false);
  });

  it('returns false for strings that differ in length', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
    expect(timingSafeEqual('a', '')).toBe(false);
  });

  it('is not fooled by same-length strings with one differing character', () => {
    expect(timingSafeEqual('password1', 'password2')).toBe(false);
  });
});
