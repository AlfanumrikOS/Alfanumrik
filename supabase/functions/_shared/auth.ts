/**
 * Shared auth helpers for Edge Functions.
 *
 * `constantTimeEqual` is the only correct way to compare a request-supplied
 * secret against an environment-stored secret. A naive `a !== b` short-
 * circuits at the first differing byte, which leaks length and per-byte
 * information through response timing — enough for an off-path attacker
 * with millisecond-precision timing to recover the secret byte-by-byte
 * over ~thousands of requests.
 *
 * Use for: SUPABASE_SERVICE_ROLE_KEY bearer-token checks on server-to-server
 * Edge Functions, CRON_SECRET header checks, and any other shared-secret
 * comparison.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Constant-time check for `Authorization: Bearer <expected>` headers used
 * by server-to-server Edge Functions. Returns true only if the header is
 * exactly `Bearer ` followed by a value that matches `expected`.
 */
export function checkBearerToken(authHeader: string | null, expected: string): boolean {
  if (!expected) return false
  const h = authHeader ?? ''
  if (!h.startsWith('Bearer ')) return false
  return constantTimeEqual(h.slice('Bearer '.length), expected)
}
