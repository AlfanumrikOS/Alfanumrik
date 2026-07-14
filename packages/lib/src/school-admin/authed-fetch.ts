/**
 * authed-fetch.ts (school-admin path) — thin re-export.
 *
 * The Bearer-token forwarding helper was promoted to the neutral path
 * `@alfanumrik/lib/authed-fetch` so non-school-admin client fetchers (e.g. the
 * student dashboard's BoardScoreWidget / ReviewsDueCard) can import it without
 * reaching into a `school-admin/` folder. This module preserves the historical
 * import path so every existing school-admin importer keeps working unchanged.
 *
 * Prefer `@alfanumrik/lib/authed-fetch` for new callers.
 */

export { authedFetch, getAccessToken } from '@alfanumrik/lib/authed-fetch';
