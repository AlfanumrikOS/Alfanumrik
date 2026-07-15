/**
 * normalize-slug.ts — canonical school-slug normaliser (leaf module).
 *
 * Produces a lowercase, hyphen-delimited, alphanumeric string safe for use as a
 * URL path segment / subdomain label AND a DB `slug` / `code` column.
 *
 * WHY A LEAF MODULE (Phase 6): the canonical normaliser previously lived inside
 * `school-provisioning.ts`, but that module also imports the critical auth path
 * `identity/school-admin-bootstrap.ts` (for writeSchoolAdminOnboardingState).
 * The self-serve onboarding path now needs the same normaliser, so extracting it
 * here lets `school-admin-bootstrap.ts` reuse it WITHOUT (a) duplicating the
 * logic, (b) pulling the heavier provisioning module (crypto / email / logger)
 * into the auth path, or (c) creating an import cycle. `school-provisioning.ts`
 * re-exports it so its public API (`@alfanumrik/lib/school-provisioning`
 * → normalizeSlug) is unchanged.
 *
 * Examples:
 *   normalizeSlug("St. Xavier's High School")  → "st-xaviers-high-school"
 *   normalizeSlug("  ABC   School ")           → "abc-school"
 *   normalizeSlug("School #1 (Bengaluru)")     → "school-1-bengaluru"
 */
export function normalizeSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
