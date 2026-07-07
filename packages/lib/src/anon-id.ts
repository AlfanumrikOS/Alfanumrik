/**
 * Anonymous-visitor identity helper.
 *
 * Reason: src/lib/feature-flags.ts → hashForRollout() requires a userId.
 * For logged-in users the supabase user.id is used. For anonymous visitors
 * (the welcome / marketing landing page), we need a stable per-visitor id
 * so that rollout_percentage > 0 actually splits anon traffic deterministically
 * instead of treating every anon visitor as enabled (the existing fallback).
 *
 * The cookie is:
 *  - name: alf_anon_id
 *  - value: a UUID v4 string
 *  - expires: 365 days
 *  - httpOnly: false (clients/analytics can read for downstream attribution)
 *  - sameSite: 'lax'
 *  - secure: only outside development
 *
 * IMPORTANT: This is NOT a security identifier. It is a stable bucket key
 * for feature-flag sampling. Do not use it for auth, RBAC, or PII linkage.
 */

export const ANON_ID_COOKIE = 'alf_anon_id';
export const ANON_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 365 days

/**
 * Generate a UUID v4. Uses crypto.randomUUID() in Node 19+ / modern runtimes;
 * falls back to a manual RFC4122 implementation if not available.
 */
export function generateAnonId(): string {
  // crypto is a global in Edge runtime and Node 19+
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: RFC4122 v4 from random bytes
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-` +
    `${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}

/**
 * Build the Set-Cookie attributes string for the anon-id cookie.
 * Returned format is the value half of `Set-Cookie: alf_anon_id=<id>; <attrs>`.
 */
export function anonIdCookieAttributes(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    'Path=/',
    `Max-Age=${ANON_ID_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}
