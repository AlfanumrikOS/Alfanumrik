/**
 * Phase G.7 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * Per-email lockout for super-admin login. Sliding 15-minute window:
 *   - 5+ failures in the last 15 min for the same email → locked
 *   - Successful login resets nothing automatically; failed-count expires
 *     by virtue of the window sliding forward
 *   - All attempts (success + failure) are recorded both in admin_login_attempts
 *     (for the lockout check) and in audit_logs (for forensic queries)
 *
 * `@upstash/ratelimit` (already in stack via Vercel KV) provides per-IP
 * rate limiting on top of this for an extra layer that doesn't depend on
 * the Postgres write to succeed.
 */

import { supabaseAdminHeaders, supabaseAdminUrl } from './admin-auth';

const LOCKOUT_WINDOW_MIN = 15;
const LOCKOUT_THRESHOLD = 5;

export interface LockoutCheck {
  locked: boolean;
  attemptsInWindow: number;
  windowMinutes: number;
  retryAfterSeconds?: number;
}

export async function checkLockout(email: string): Promise<LockoutCheck> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60 * 1000).toISOString();
  const url = supabaseAdminUrl(
    'admin_login_attempts',
    `select=attempted_at&email=eq.${encodeURIComponent(email)}&succeeded=eq.false&attempted_at=gte.${since}&order=attempted_at.desc&limit=10`,
  );
  const res = await fetch(url, { method: 'GET', headers: supabaseAdminHeaders() });
  if (!res.ok) {
    // Fail closed on lookup error — better to occasionally lock out a real
    // admin than to leave the door open during a DB outage.
    return { locked: true, attemptsInWindow: -1, windowMinutes: LOCKOUT_WINDOW_MIN };
  }
  const rows = (await res.json()) as Array<{ attempted_at: string }>;
  const failures = rows.length;
  if (failures < LOCKOUT_THRESHOLD) {
    return { locked: false, attemptsInWindow: failures, windowMinutes: LOCKOUT_WINDOW_MIN };
  }
  // Find the oldest failure in window — that's when the lockout starts
  // sliding off.
  const oldest = rows[rows.length - 1].attempted_at;
  const unlockAt = new Date(new Date(oldest).getTime() + LOCKOUT_WINDOW_MIN * 60 * 1000);
  const retryAfterSeconds = Math.max(0, Math.ceil((unlockAt.getTime() - Date.now()) / 1000));
  return { locked: true, attemptsInWindow: failures, windowMinutes: LOCKOUT_WINDOW_MIN, retryAfterSeconds };
}

export async function recordLoginAttempt(opts: {
  email: string;
  ipAddress?: string;
  userAgent?: string;
  succeeded: boolean;
  failureCode?: string;
}): Promise<void> {
  // Don't await — main request hot path should not block on this.
  void fetch(supabaseAdminUrl('admin_login_attempts'), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify({
      email: opts.email,
      ip_address: opts.ipAddress ?? null,
      user_agent: opts.userAgent ?? null,
      succeeded: opts.succeeded,
      failure_code: opts.failureCode ?? null,
    }),
  }).catch(() => {
    // Logging failure here would create circular noise; the audit_logs
    // write in the route covers the forensic gap.
  });
}

export const LOCKOUT_CONSTANTS = {
  WINDOW_MIN: LOCKOUT_WINDOW_MIN,
  THRESHOLD: LOCKOUT_THRESHOLD,
};
