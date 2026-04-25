/**
 * Returns true ONLY when the env contains real, non-placeholder Supabase
 * credentials. Used by `describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip`
 * so integration tests skip cleanly in CI (which sets placeholder values to
 * satisfy `validateServerEnv()` boot-time checks).
 *
 * Why placeholder detection: `.github/workflows/ci.yml` sets
 *   NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder
 *   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ci-placeholder-service-role
 * so that `src/lib/env.ts` doesn't throw at module load. Migration tests that
 * actually hit the Supabase REST API (`supabaseAdmin.from('cbse_syllabus')…`)
 * would then fail with `getaddrinfo ENOTFOUND placeholder.supabase.co`.
 *
 * Detecting the placeholder pattern lets those describe blocks evaluate to
 * `describe.skip(...)` so the suite passes deterministically. When CI is
 * later wired with a real staging Supabase instance, change the env vars and
 * the same tests run for real — no other code change required.
 *
 * P0-D launch fix: this hardening is what lets us flip `npm test` from
 * `continue-on-error: true` to a hard CI gate.
 */
export function hasSupabaseIntegrationEnv(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) return false;

  // Reject the well-known CI placeholder strings. Match defensively: anything
  // containing 'placeholder' (case-insensitive) is treated as a CI dummy.
  const looksLikePlaceholder =
    /placeholder/i.test(url) ||
    /placeholder/i.test(anonKey) ||
    /placeholder/i.test(serviceKey);

  return !looksLikePlaceholder;
}
