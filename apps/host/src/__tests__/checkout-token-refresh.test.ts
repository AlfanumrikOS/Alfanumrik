import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression — useCheckout must refresh the Supabase token before /verify.
 *
 * Background (2026-05-09 incident):
 *   useCheckout called supabase.auth.getSession() ONCE before opening the
 *   Razorpay popup, then reused the captured access_token from the popup's
 *   handler callback to POST /api/payments/verify. The Razorpay popup can
 *   stay open for 60-120s while the user enters UPI/OTP — long enough for
 *   Supabase to rotate the JWT in the background. The captured token then
 *   becomes invalid and verify returns 401.
 *
 *   Vercel runtime logs proved this for hridaankaushik307@gmail.com:
 *     12:24:44 POST /api/payments/subscribe 200  (token X works)
 *     12:26:09 POST /api/payments/verify    401  (token X rejected ~85s later)
 *
 * Invariant: every path that calls /api/payments/verify from the Razorpay
 * handler MUST re-grab the latest access_token via supabase.auth.getSession()
 * before issuing the fetch. credentials: 'include' should also be set so
 * the cookie auth path is a working fallback.
 *
 * This is a structural test against src/hooks/useCheckout.ts because the
 * token-rotation race is a function of timing inside the Razorpay popup
 * lifecycle and cannot reliably be exercised in vitest.
 */

const HOOK_PATH = join(process.cwd(), 'src/hooks/useCheckout.ts');

describe('useCheckout token refresh before /verify (incident 2026-05-09)', () => {
  const source = readFileSync(HOOK_PATH, 'utf8');

  // Locate every fetch call to /api/payments/verify and grab the surrounding
  // ~600 chars before each call. The fresh-token grab and credentials:include
  // must appear within that preceding window.
  const verifyFetchRegex = /fetch\(['"]\/api\/payments\/verify['"]/g;

  it('every /api/payments/verify call site re-grabs the latest session token', () => {
    const matches = [...source.matchAll(verifyFetchRegex)];
    expect(matches.length, 'no /api/payments/verify call sites found — hook shape changed').toBeGreaterThan(0);

    for (const m of matches) {
      const idx = m.index ?? 0;
      const window = source.slice(Math.max(0, idx - 800), idx);
      expect(
        window,
        `verify call at offset ${idx} missing supabase.auth.getSession() refresh — Razorpay popup token-rotation 401 will return`
      ).toMatch(/supabase\.auth\.getSession\(\)/);
    }
  });

  it("every /api/payments/verify call uses credentials: 'include' as cookie fallback", () => {
    const matches = [...source.matchAll(verifyFetchRegex)];
    expect(matches.length).toBeGreaterThan(0);

    for (const m of matches) {
      const idx = m.index ?? 0;
      // credentials: 'include' should be inside the fetch options (~200 chars after the open paren)
      const window = source.slice(idx, Math.min(source.length, idx + 800));
      expect(
        window,
        `verify call at offset ${idx} missing credentials: 'include' — cookie auth fallback will not engage if the bearer token is stale`
      ).toMatch(/credentials:\s*['"]include['"]/);
    }
  });

  it('useCheckout still has both subscription and order checkout paths', () => {
    // Make sure we're testing both code paths and didn't accidentally delete one.
    expect(source).toMatch(/openSubscriptionCheckout/);
    expect(source).toMatch(/openOrderCheckout/);
  });
});
