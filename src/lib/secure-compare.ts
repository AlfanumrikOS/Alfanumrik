/**
 * Constant-time string comparison for shared secrets.
 *
 * Naive `===` / `!==` short-circuits at the first differing byte and leaks
 * the secret through response timing. An off-path attacker with millisecond-
 * precision timing can recover the secret byte by byte.
 *
 * Use for: admin secrets (`x-admin-secret`, `?secret=`), bearer tokens,
 * cron secrets, session cookie tokens, and any other shared-secret compare.
 *
 * Edge-compatible: pure JS, no Node `crypto` import. Deno-compatible too.
 *
 * Note: leaks length (returns false fast on length mismatch). For our threat
 * model that's fine — the secret length is fixed and not itself the secret.
 */
export function secureEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
