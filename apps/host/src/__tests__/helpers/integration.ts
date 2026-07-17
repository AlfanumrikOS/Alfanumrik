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

/**
 * The shape of the per-test context object Vitest passes to a test body
 * (`it('...', (ctx) => {...})`). We only need `.skip()` from it. Declared
 * locally so callers don't have to import Vitest's `TestContext` type.
 */
export interface SkippableTestContext {
  skip: (note?: string) => void;
}

/**
 * Gracefully SKIP a live-DB integration test when a required SEED-DATA row is
 * absent on the target database — instead of HARD-FAILING with an assertion.
 *
 * WHY THIS EXISTS
 * ---------------
 * The integration lane (`RUN_INTEGRATION_TESTS=1`) runs against a live but
 * SEED-LESS CI Supabase DB. The migration `*-e2e.test.ts` files need fixtures
 * that DB doesn't have (an existing student / foxy_session / chapter_concepts /
 * concept_mastery row, active curriculum_topics, question_bank rows, …). They
 * already self-skip when integration CREDS are absent (`hasSupabaseIntegrationEnv`);
 * they must ALSO skip when the required SUBSTRATE is absent — turning the lane
 * from always-red into green/skip while keeping FULL assertions when the data
 * IS present.
 *
 * CONTRACT
 * --------
 * - When `present` is falsy (no row / empty array / null), this calls
 *   `ctx.skip(...)`, which Vitest records as a SKIP (not a pass, not a fail) and
 *   aborts the rest of the test body. The `label` is surfaced in the report so
 *   the missing-substrate gap stays VISIBLE.
 * - When `present` is truthy, this is a no-op and the test runs its full
 *   assertions unchanged.
 *
 * This NEVER weakens an assertion that runs when data is present — it only
 * converts "precondition missing -> FAIL" into "precondition missing -> SKIP".
 *
 * @example
 *   it('...', (ctx) => {
 *     skipIfNoSubstrate(ctx, available, 'no foxy_session / chapter_concepts to reuse');
 *     // …full assertions, only reached when the substrate exists…
 *   });
 */
export function skipIfNoSubstrate(
  ctx: SkippableTestContext,
  present: unknown,
  label: string,
): void {
  const missing =
    present == null ||
    present === false ||
    (Array.isArray(present) && present.length === 0);
  if (missing) {
    ctx.skip(`[integration] substrate not present on this DB — ${label}`);
  }
}

/** Minimal structural shape of the Supabase client bits the RPC probe needs. */
interface RpcProbeClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
}

/**
 * True ONLY when a PostgREST/Postgres error means the FUNCTION ITSELF could not
 * be resolved — i.e. it is not deployed to this database yet.
 *
 * DELIBERATELY NARROWER THAN `isMissingObjectError()` (the repo's canonical
 * detector at `src/app/api/school-admin/ai-assistant/route.ts:128`) — DO NOT
 * "harmonise" the two. That one is a fail-soft PRODUCTION degradation guard, so
 * it casts a wide net on purpose: it also returns true for `42P01`
 * (undefined_TABLE) and for ANY message containing "does not exist".
 *
 * That width is CORRECT for a route that wants to degrade quietly, and CATASTROPHIC
 * for a test gate. A capability probe that swallows real failures is worse than the
 * deadlock it fixes. Concretely, if migration `20260717120000` were only HALF applied
 * — RPC created, `curriculum_version_watermark` missing — the RPC would raise
 * `relation "curriculum_version_watermark" does not exist` (42P01). The broad
 * detector would read that as "function absent" and SKIP the suite, silently
 * greening the exact delete-safety hole the suite exists to catch.
 *
 * So this classifier admits ONLY unambiguous function-RESOLUTION failures:
 *   - `PGRST202` — PostgREST could not find the function in its schema cache.
 *   - `42883` (undefined_function) AND the message names the probed function —
 *     the name check matters because a DEPLOYED function whose BODY calls some
 *     other missing function ALSO raises 42883, and that is a real break, not an
 *     absence.
 * EVERY other error (42P01, permission, runtime, argument) means the function IS
 * there and something is genuinely wrong ⇒ the caller must NOT skip, and the
 * suite must run and FAIL.
 */
export function isMissingRpcError(
  err: { code?: string; message?: string } | null | undefined,
  fnName: string,
): boolean {
  if (!err) return false;
  if (err.code === 'PGRST202') return true;
  if (err.code === '42883' && (err.message || '').includes(fnName)) return true;
  return false;
}

/**
 * CAPABILITY PROBE — is `fnName` actually deployed on the DB this lane points at?
 *
 * WHY THIS EXISTS (the chicken-and-egg it breaks)
 * ----------------------------------------------
 * `hasSupabaseIntegrationEnv()` only proves CREDS exist. It cannot tell whether the
 * object under test exists. When a PR introduces BOTH a migration and the suite that
 * pins it, CI has creds, so the suite runs against a staging DB where the migration
 * has NOT been applied yet — the RPC 404s, the suite goes red, and the PR can't merge;
 * but the migration only reaches staging BY merging. Deadlock. A creds probe is not
 * enough; presence must be probed too.
 *
 * MECHANISM: PostgREST does not expose `pg_catalog.pg_proc` via `.from(...)`, and
 * `information_schema` is not reliably exposed either (see the fallback note in
 * `migrations/jee_neet_schema_unblock.test.ts:209`). RPC resolution is the only
 * function-existence channel the JS client has — the same channel
 * `schema/fresh-db-quiz-functions.test.ts` (REG-144) uses for its pg_proc probe.
 *
 * CONTRACT — the whole point is that this arms itself, and never hides a real bug:
 *   - resolves            ⇒ TRUE  (deployed; caller runs FULL assertions)
 *   - missing-RPC error   ⇒ FALSE (not deployed here; caller SKIPs loudly)
 *   - ANY other error     ⇒ TRUE  (deployed but misbehaving — caller MUST run and FAIL)
 * Once the migration is applied, the probe returns true and the suite arms itself
 * automatically with NO code change.
 *
 * `probeArgs` must be BENIGN and READ-ONLY — this runs before any fixture exists.
 */
export async function rpcIsDeployed(
  client: RpcProbeClient,
  fnName: string,
  probeArgs: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await client.rpc(fnName, probeArgs);
  if (isMissingRpcError(error, fnName)) return false;
  return true;
}

/**
 * SKIP a live-DB test loudly because the RPC under test is not deployed to this
 * environment yet — as opposed to `skipIfNoSubstrate`, which covers missing SEED
 * DATA on a DB whose SCHEMA is current. Same fail-visible posture: Vitest records
 * a SKIP (never a pass), and the note names the migration that arms it.
 *
 * NEVER weakens an assertion: when `deployed` is true this is a no-op and the test
 * body runs unchanged.
 */
export function skipIfRpcNotDeployed(
  ctx: SkippableTestContext,
  deployed: boolean,
  fnName: string,
  migration: string,
): void {
  if (!deployed) {
    ctx.skip(
      `[integration] RPC ${fnName}() is NOT deployed to this database — migration ` +
        `${migration} has not been applied to this environment yet. This is NOT a pass: ` +
        `the suite arms itself automatically once that migration is applied.`,
    );
  }
}
