/**
 * pending-invite.ts — survives a school invite code across the
 * sign-up → email-verification → profile-bootstrap round-trip.
 *
 * WHY this exists (P15 onboarding integrity):
 *   The day-1 B2B path is: a school hands a fresh student/teacher an invite
 *   code → `/join` validates it → the (unauthenticated) joiner is sent to
 *   `/login?school=<slug>&code=<code>` to sign up. The login page previously
 *   read only `?role=` and dropped `?code=`, so after the new account verified
 *   its email it landed in the dashboard with NO school linkage.
 *
 *   `/api/schools/join` can only link a user whose profile row already exists
 *   (it UPDATEs `students`/`teachers` by `auth_user_id`). For a brand-new
 *   signup the profile doesn't exist until AuthContext bootstraps it after the
 *   email-verification round-trip. So the code has to be PERSISTED on the
 *   device (it must survive the redirect to the email client and back) and the
 *   join call has to fire LATER — once a session AND a profile both exist.
 *
 *   This module is the persistence + redemption primitive. AuthContext calls
 *   `redeemPendingInvite()` once roles resolve (profile confirmed). The login
 *   page calls `setPendingInvite()` when it sees `?code=`.
 *
 * Storage choice: localStorage (not sessionStorage). The email-verification
 *   link typically opens a NEW tab/window, which does not inherit
 *   sessionStorage. localStorage is shared across same-origin tabs, so the
 *   code written before clicking "verify" is still present in the tab that
 *   lands on `/auth/callback`. It is cleared the moment redemption resolves
 *   (success, already-linked, or hard-invalid) so it can never re-fire.
 */

import { authHeader } from '@/lib/api/auth-header';

const PENDING_INVITE_KEY = 'alfanumrik_pending_invite_code';

/** Persist an invite code to survive the verification round-trip. No-op on
 *  empty/whitespace input or in a non-browser (SSR) context. */
export function setPendingInvite(code: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const trimmed = (code ?? '').trim().toUpperCase();
  if (trimmed.length < 3) return;
  try {
    window.localStorage.setItem(PENDING_INVITE_KEY, trimmed);
  } catch {
    /* private mode / quota — degrade silently; join just won't auto-fire */
  }
}

/** Read the persisted invite code, or null if none is pending. */
export function getPendingInvite(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(PENDING_INVITE_KEY);
    return v && v.trim().length >= 3 ? v.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Remove the persisted invite code. Safe to call when none exists. */
export function clearPendingInvite(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* ignore */
  }
}

export type RedeemOutcome =
  | 'linked'        // newly linked to the school
  | 'none'          // nothing pending — no-op
  | 'retry'         // transient failure (network / 5xx) — keep the code, try again next load
  | 'cleared';      // consumed and cleared (already-linked, invalid, expired, seat-cap, etc.)

/**
 * Redeem any pending invite code by POSTing it to `/api/schools/join` with the
 * caller's Supabase Bearer token (the app keeps its session in localStorage, so
 * the cookie-only path on the server would otherwise see no user).
 *
 * MUST be called only after a profile row exists for the signed-in user — the
 * join route links by `auth_user_id` and silently no-ops if the row is absent.
 * AuthContext gates this behind `roles.length > 0`.
 *
 * Returns an outcome the caller can use for telemetry. Never throws; on a
 * transient failure it returns 'retry' WITHOUT clearing the code, so the next
 * AuthContext load tries again. Any definitive server verdict (linked,
 * already-linked, invalid, expired, seat-cap) clears the code so it can't loop.
 */
export async function redeemPendingInvite(): Promise<RedeemOutcome> {
  const code = getPendingInvite();
  if (!code) return 'none';

  try {
    const res = await fetch('/api/schools/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeader()),
      },
      credentials: 'same-origin',
      body: JSON.stringify({ code }),
    });

    // Transient: still unauthenticated (token not yet attachable) or a server
    // error. Keep the code and let the next load retry.
    if (res.status === 401 || res.status >= 500) {
      return 'retry';
    }

    let data: { success?: boolean; authenticated?: boolean } = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON body — treat as definitive below */
    }

    // If the server says success but NOT authenticated, the link didn't happen
    // (no session reached the route). Retry on the next load rather than
    // discarding the code.
    if (data.success && data.authenticated === false) {
      return 'retry';
    }

    // Any other definitive response (linked OK, already a member, invalid /
    // expired / seat-cap 4xx) — consume the code so it can never re-fire.
    clearPendingInvite();
    return data.success ? 'linked' : 'cleared';
  } catch {
    // Network failure — keep the code for the next attempt.
    return 'retry';
  }
}
