/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break password reset / invite-set-password for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Verify against the installed @supabase/auth-js `_getSessionFromURL` source
 *    (node_modules/@supabase/auth-js/src/GoTrueClient.ts) before changing field
 *    names — do not guess.
 *
 * Shared helper for /auth/callback and /auth/confirm.
 *
 * Both routes redirect password-reset ('recovery') and admin-invite ('invite')
 * sessions to /auth/reset by encoding the just-verified server-side session as a
 * URL fragment (`#access_token=...&...`). The client-side Supabase browser SDK
 * (`detectSessionInUrl`, used by apps/host/src/app/auth/reset/page.tsx) parses
 * that fragment via `_getSessionFromURL()` in @supabase/auth-js to hydrate a
 * client session — the server-side cookie session is invisible to the browser
 * client, which reads from localStorage.
 *
 * BUG (fixed here, RCA 2026-07-20): all 6 call sites (2 in auth/callback/route.ts,
 * 4 in auth/confirm/route.ts) built this hash WITHOUT `expires_in`. Read directly
 * from the installed @supabase/auth-js@2.108.2 source
 * (src/GoTrueClient.ts `_getSessionFromURL`):
 *
 *   const { provider_token, provider_refresh_token, access_token, refresh_token,
 *           expires_in, expires_at, token_type } = params
 *   if (!access_token || !expires_in || !refresh_token || !token_type) {
 *     throw new AuthImplicitGrantRedirectError('No session defined in URL')
 *   }
 *
 * `expires_in` is REQUIRED — its absence throws inside the SDK's hash parser,
 * so `detectSessionInUrl` silently fails, no client session is ever created,
 * and /auth/reset's 8s polling loop times out to "Invalid or Expired Link" —
 * even though the token was already correctly verified server-side and is now
 * spent (single-use). `expires_at` is optional in the SDK (it falls back to
 * `now + expires_in` if absent) but is included here too since the server
 * already knows the precise value and it avoids a few seconds of clock drift.
 * Hash keys are parsed verbatim via `new URLSearchParams(hash)` in
 * `parseParametersFromURL` (src/lib/helpers.ts) — no key renaming — so the
 * names below must match exactly what `_getSessionFromURL` destructures.
 */

import type { Session } from '@supabase/supabase-js';

/** The two flows that hand off a live session to /auth/reset via URL hash. */
export type RecoverySessionHashType = 'recovery' | 'invite';

/**
 * Builds the URL hash fragment (without the leading `#`) that
 * @supabase/auth-js's implicit-grant hash parser needs to hydrate a client-side
 * session from a server-verified session. Include ALL of `access_token`,
 * `refresh_token`, `expires_in`, `expires_at`, and `token_type` — omitting
 * `expires_in` makes the SDK throw and silently fail to detect the session
 * (see module doc above).
 */
export function buildRecoverySessionHash(
  session: Session,
  type: RecoverySessionHashType
): string {
  const hashParams = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    expires_at: String(session.expires_at),
    token_type: 'bearer',
    type,
  });
  return hashParams.toString();
}
