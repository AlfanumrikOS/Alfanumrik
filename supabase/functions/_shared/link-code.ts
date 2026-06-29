/**
 * Parent/guardian link-code validation — Deno/Edge twin of the
 * `isValidLinkCode` helper in `src/lib/sanitize.ts`.
 *
 * The supabase/ ↔ src/ tree boundary cannot be crossed at deploy time (only
 * `supabase/functions/**` is shipped to the Edge runtime), so this is an
 * intentional duplicate. The two copies MUST be kept in sync.
 *
 * Codes are server-generated and are always a subset of [A-Z0-9]:
 *   - students.link_code   = upper(substr(md5(...),1,6))            → 6 uppercase hex chars
 *   - students.invite_code = upper(encode(gen_random_bytes(4),hex)) → 8 uppercase hex chars
 *
 * This guard is applied BEFORE the value is interpolated into any PostgREST
 * `.or()` filter, so a crafted code containing PostgREST control characters
 * (comma, `.`, `(`, `)`, `*`, `:`, quotes, whitespace, `.eq.`) can never reach
 * the query and alter it (PP-2 filter-injection guard). The 4–12 width covers
 * both the 6- and 8-char formats with margin while admitting no PostgREST
 * metacharacter.
 *
 * Pass the value AFTER `.trim().toUpperCase()` normalization.
 */
export const LINK_CODE_RE = /^[A-Z0-9]{4,12}$/

export function isValidLinkCode(code: string): boolean {
  return LINK_CODE_RE.test(code)
}
