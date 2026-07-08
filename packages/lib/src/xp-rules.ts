/**
 * ALFANUMRIK — XP Economy Rules (DEPRECATED SHIM)
 *
 * @deprecated Import from `@alfanumrik/lib/xp-config` instead. This module is now a
 *   thin re-export shim kept for backward compatibility while existing
 *   callers migrate.
 *
 * Why this shim exists (D2-B, Wave 2 — 2026-05-05):
 *   The previous version of `xp-rules.ts` carried `@deprecated` JSDoc tags on
 *   every export, which produced ~17 lint warnings on every consuming file
 *   and signaled to new contributors that the XP economy itself was
 *   deprecated. It is not. Only the *file path* is deprecated. The XP
 *   economy (P2 invariant) is alive and the live source is now
 *   `src/lib/xp-config.ts`.
 *
 *   `xp-rules.ts` MUST remain on disk: SQL migrations, runbooks, and the
 *   mobile app comment all reference this filename. Removing it would also
 *   break ~12 production import sites that have not yet been repointed.
 *
 *   When all callers have been repointed to `@alfanumrik/lib/xp-config`, this shim
 *   may be deleted. Until then, `export * from './xp-config'` is the only
 *   correct content for this file. Do not add new symbols here — add them
 *   to `xp-config.ts`.
 */

export * from './xp-config';
