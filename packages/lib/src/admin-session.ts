/**
 * Admin session helpers — browser/client only.
 *
 * The internal-admin console and the super-admin surface are SESSION-ONLY
 * (P2-1): the sole credential is the httpOnly sb-* cookie set by
 * POST /api/super-admin/login, carried automatically on same-origin fetches.
 * There is NO shared admin secret and nothing to persist client-side, so the
 * former `alfa_admin_secret` sessionStorage key and its accessors
 * (getAdminSecretFromSession / setAdminSecretInSession / adminHeaders) have
 * been removed. Session teardown is performed server-side via
 * POST /api/super-admin/logout, which expires the sb-* cookies.
 *
 * Server-side auth lives in admin-auth.ts.
 */

/**
 * Client-side admin session teardown seam.
 *
 * The super-admin session lives entirely in an httpOnly sb-* cookie that only
 * the server can clear (POST /api/super-admin/logout), so there is no
 * client-side admin session state to remove — this is intentionally a no-op.
 * It MUST NOT read or write the removed `alfa_admin_secret` sessionStorage key.
 */
export function clearAdminSession(): void {
  // No client-side admin session state to clear (session = httpOnly cookie).
}
