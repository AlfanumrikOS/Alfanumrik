/**
 * link-code-otp.ts — server-only OTP helpers for Phase D.4.
 *
 * Owns the two cryptographic primitives the link-code redemption routes need:
 *
 *   1. `generateOtp()` — a 6-digit numeric string drawn from `crypto.randomInt`.
 *      We use `randomInt` (not `Math.random`) so the value is unpredictable on
 *      every Node runtime. Returned as a string (no leading-zero loss).
 *
 *   2. `hashOtp(otp, salt)` / `verifyOtp(otp, hash, salt)` — sha256 with the
 *      challenge row id as the per-row salt. We do NOT add bcrypt because:
 *        - the OTP is single-use, short-lived (10 minutes), and rate-limited
 *          to 5 attempts before the row locks for an hour. A 6-digit space is
 *          10^6 ≈ 20 bits; bcrypt's iteration cost buys ~14 bits at most. The
 *          5-attempt lockout buys vastly more.
 *        - the project's hard rule for D.4 is "no new dependencies".
 *      We compare in constant time to neutralise timing oracles.
 *
 * Everything here is server-side only — never import from client components.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** Length of the OTP we send to the user, in digits. */
export const OTP_LENGTH = 6;

/** TTL in milliseconds (10 minutes). */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** Max failed verify attempts per challenge before lockout kicks in. */
export const OTP_MAX_ATTEMPTS = 5;

/** Lockout duration once attempts are exhausted, in milliseconds. */
export const OTP_LOCKOUT_MS = 60 * 60 * 1000;

/** IP rate limit on request-otp (per hour). */
export const REQUEST_OTP_IP_LIMIT = 5;
export const REQUEST_OTP_IP_WINDOW_MS = 60 * 60 * 1000;

/** IP rate limit on redeem (per hour). */
export const REDEEM_IP_LIMIT = 10;
export const REDEEM_IP_WINDOW_MS = 60 * 60 * 1000;

/** Resend cooldown — minimum interval between two OTP-request emails per (link, user). */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Generate a 6-digit OTP as a string. Leading zeros are preserved
 * (`'012345'`). Drawn from `crypto.randomInt(0, 1_000_000)` so values are
 * uniformly distributed without modulo-bias.
 */
export function generateOtp(): string {
  const n = randomInt(0, 10 ** OTP_LENGTH);
  return n.toString().padStart(OTP_LENGTH, '0');
}

/**
 * sha256(otp || salt) returned as lowercase hex. `salt` should be the
 * challenge row's primary key (a UUID) — that gives us a unique salt per
 * row without storing one separately.
 */
export function hashOtp(otp: string, salt: string): string {
  return createHash('sha256').update(`${otp}|${salt}`, 'utf8').digest('hex');
}

/**
 * Constant-time verify. Returns true iff `hashOtp(otp, salt) === expectedHash`.
 *
 * We use `crypto.timingSafeEqual` — `expectedHash` is hex, so we feed both
 * sides through `Buffer.from(value, 'hex')` to compare equal-length byte
 * buffers. If anyone hands us a malformed hash (different length than the
 * computed digest) we still return false without leaking the path through
 * an exception.
 */
export function verifyOtp(
  otp: string,
  expectedHash: string,
  salt: string
): boolean {
  const computed = hashOtp(otp, salt);
  if (computed.length !== expectedHash.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Compute the OTP expiry timestamp from a known anchor. Pure for testability.
 */
export function computeOtpExpiry(nowMs: number = Date.now()): Date {
  return new Date(nowMs + OTP_TTL_MS);
}

/**
 * Compute the lockout-until timestamp. Pure for testability.
 */
export function computeLockoutUntil(nowMs: number = Date.now()): Date {
  return new Date(nowMs + OTP_LOCKOUT_MS);
}
