/**
 * ALFANUMRIK — Certification Tenant Teardown Wrapper
 *
 * Operator-facing CLI wrapper around the `purge_certification_tenant(p_school_id)`
 * SQL function (`supabase/migrations/20260702180000_certification_tenant_teardown.sql`).
 *
 * WHY THIS EXISTS
 * ================
 * `purge_certification_tenant` is a correctly-guarded, correctly-ordered, idempotent
 * SECURITY DEFINER function — but before this file, there was no wrapper script or
 * admin-API route that called it. The only way to invoke it was raw SQL via direct
 * service-role database access (Supabase SQL editor or a `psql` session). That gap
 * was flagged in
 * `docs/audit/2026-07-02-certification/evidence/wave-2-environment-readiness/03-post-remediation-reverification.md`
 * §3d ("Operational read"). This script closes it with a thin, auditable, fail-closed
 * CLI wrapper — it does not change the database function's behavior in any way.
 *
 * Sibling script: `scripts/seed-certification-accounts.ts` (creates the tenant this
 * script tears down). Convention reference:
 * `docs/runbooks/certification-traffic-traceability.md`.
 * Operational procedure: `docs/runbooks/certification-rollback-procedure.md`.
 *
 * FAIL-CLOSED GUARDS (in order of execution)
 * ============================================
 *   1. `<school_id>` argument is required and must be a syntactically valid UUID.
 *      A malformed or missing id refuses before any network/DB access.
 *   2. Both required Supabase credential env vars must be set — the public project
 *      URL and the service-role key (required even for `--dry-run` — the dry run
 *      performs the real `is_demo` lookup so its output reflects reality; it only
 *      skips the RPC call itself).
 *   3. The project ref embedded in `NEXT_PUBLIC_SUPABASE_URL` must be extractable
 *      AND must NOT equal the known production project ref
 *      (`shktyoxqhundlvkiwguu` — the same literal used as the negative-assertion
 *      target in `.github/workflows/staging-flag-set.yml` and
 *      `.github/workflows/staging-adaptive-drill.yml`). If the ref cannot be parsed
 *      at all, this script refuses rather than guessing — it cannot positively
 *      confirm the target is not production, so it fails closed.
 *   4. CLIENT-SIDE, BELT-AND-SUSPENDERS: before calling the RPC, this script
 *      independently looks up the target `schools` row and refuses to proceed
 *      unless `is_demo IS TRUE` — the exact same predicate the SQL function itself
 *      enforces (`IF v_school.is_demo IS NOT TRUE THEN RAISE EXCEPTION ...`). This
 *      script does NOT rely solely on the database function's own guard; a caller
 *      who accidentally targets a real school is refused here, client-side, before
 *      any RPC round-trip. (If the row does not exist at all — e.g. already torn
 *      down, or a school_id that never existed — that's the RPC's own idempotent
 *      `already_absent: true` no-op territory, so this script lets that case
 *      through to the RPC rather than treating "not found" as a refusal.)
 *
 * `--dry-run` performs guards 1-4 and the real `is_demo` lookup, then prints what it
 * would do and STOPS — it never calls the RPC.
 *
 * PREPARATION-ONLY NOTICE
 * ==========================
 * This script is written but has not been executed against any target this session
 * (see `docs/audit/2026-07-02-certification/release-candidate/RC-2026-07-02-baseline.md`
 * — CERT-17 is an open release blocker; certification traffic against staging is
 * paused pending human verification). Do not run this script against any live target
 * until that blocker clears and an operator has deliberately decided to tear down a
 * specific certification tenant.
 *
 * Run:
 *   npx tsx scripts/teardown-certification-tenant.ts <school_id>
 *   npx tsx scripts/teardown-certification-tenant.ts <school_id> --dry-run
 *   npx tsx scripts/teardown-certification-tenant.ts --school-id=<school_id> --dry-run
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes: 0 on success (including a clean dry-run or an idempotent
 * `already_absent: true` result). Non-zero on any failure — malformed input,
 * missing env, production-ref match, non-demo school, RPC error.
 *
 * NOTE: this script only tears down the SCHOOL-SCOPED tenant (student / teacher /
 * school_admin rows + the school itself + its non-cascading child tables), exactly
 * matching `purge_certification_tenant`'s own documented scope. It does NOT cover
 * standalone (non-school-scoped) certification accounts — parent, super_admin,
 * content_author, support_staff. See the "Standalone accounts" section of
 * `docs/runbooks/certification-rollback-procedure.md` for those.
 */

import { createClient } from '@supabase/supabase-js';

// ─── Known production project ref (fail-closed negative-assertion target) ───
// Same literal used by .github/workflows/staging-flag-set.yml and
// .github/workflows/staging-adaptive-drill.yml. This script must NEVER be
// pointed at it.
export const KNOWN_PROD_PROJECT_REF = 'shktyoxqhundlvkiwguu';

// ─── Pure helpers (no I/O — directly unit-testable) ────────────────────────

/**
 * Extracts the Supabase project ref (the subdomain label) out of a
 * `https://<ref>.supabase.co` URL. Returns null for anything that doesn't
 * match that exact shape — deliberately strict, since a failed parse must
 * fail the caller closed (guard 3), not silently proceed.
 */
export function extractProjectRef(supabaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    return null;
  }
  const labels = parsed.hostname.split('.');
  if (labels.length < 3) return null;
  const [ref, ...rest] = labels;
  if (!ref || rest.join('.') !== 'supabase.co') return null;
  // Explicit lowercase call for auditability parity with the sibling
  // extractProjectRef in scripts/seed-certification-accounts.ts, rather than
  // relying solely on the WHATWG URL API's implicit hostname lowercasing
  // (correct today, but this removes any dependency on an unstated
  // cross-runtime guarantee). See quality review Finding Q-1.
  return ref.toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Syntactic UUID check only — no DB round-trip. */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface ParsedArgs {
  schoolId: string | null;
  dryRun: boolean;
}

/** Accepts the school id either as the first positional arg or `--school-id=<uuid>`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const dryRun = argv.includes('--dry-run');
  const flagArg = argv.find((a) => a.startsWith('--school-id='))?.split('=')[1] ?? null;
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  return { schoolId: flagArg ?? positional, dryRun };
}

// ─── Minimal DB-client surface (kept narrow so it's trivially fakeable in tests,
//     mirrors the pattern in scripts/seed-certification-accounts.ts) ─────────

export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
}

export interface SchoolRow {
  id: string;
  is_demo: boolean | null;
  name: string | null;
}

/** Looks up the target `schools` row by id. Returns null if it does not exist. */
export async function lookupSchool(sb: SupabaseLike, schoolId: string): Promise<SchoolRow | null> {
  const { data, error } = await sb.from('schools').select('id, is_demo, name').eq('id', schoolId).maybeSingle();
  if (error) {
    throw new Error(`schools lookup failed for ${schoolId}: ${error.message}`);
  }
  if (!data) return null;
  return {
    id: String(data.id),
    is_demo: (data.is_demo as boolean | null) ?? null,
    name: (data.name as string | null) ?? null,
  };
}

export interface TeardownOutcome {
  schoolId: string;
  dryRun: boolean;
  schoolFound: boolean;
  isDemo: boolean | null;
  schoolName: string | null;
  proceeded: boolean;
  rpcResult: Record<string, unknown> | null;
}

/**
 * Guard 4 (client-side belt-and-suspenders) + the RPC call itself (or, for
 * `dryRun`, everything up to but not including that call).
 *
 * Refuses (throws) if the school row exists and `is_demo` is not `true` —
 * mirrors `purge_certification_tenant`'s own `IS NOT TRUE` predicate (which
 * also catches NULL, not just explicit `false`). A school id with no row at
 * all is NOT refused here — that's the RPC's own idempotent no-op territory,
 * so it is allowed to reach the RPC (or, in dry-run mode, is reported as
 * "not found, would be a no-op").
 */
export async function runTeardown(
  sb: SupabaseLike,
  schoolId: string,
  dryRun: boolean,
): Promise<TeardownOutcome> {
  const school = await lookupSchool(sb, schoolId);

  if (school && school.is_demo !== true) {
    throw new Error(
      `Refusing to tear down school ${schoolId} ("${school.name ?? 'unknown'}") — is_demo is not true. ` +
        'This wrapper independently re-confirms is_demo BEFORE calling purge_certification_tenant and will ' +
        'NEVER call the RPC against a school that is not explicitly flagged is_demo = true, even though the ' +
        'database function itself carries the same guard. If this school SHOULD be a certification/demo ' +
        'tenant, fix its is_demo flag first — do not bypass this check.',
    );
  }

  if (dryRun) {
    return {
      schoolId,
      dryRun: true,
      schoolFound: school != null,
      isDemo: school?.is_demo ?? null,
      schoolName: school?.name ?? null,
      proceeded: false,
      rpcResult: null,
    };
  }

  const { data, error } = await sb.rpc('purge_certification_tenant', { p_school_id: schoolId });
  if (error) {
    throw new Error(
      `purge_certification_tenant RPC failed for ${schoolId}: ${error.message}` +
        (error.code ? ` (code ${error.code})` : ''),
    );
  }

  return {
    schoolId,
    dryRun: false,
    schoolFound: school != null,
    isDemo: school?.is_demo ?? null,
    schoolName: school?.name ?? null,
    proceeded: true,
    rpcResult: (data as Record<string, unknown>) ?? null,
  };
}

// ─── CLI entry point ────────────────────────────────────────────────────

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.error(
    [
      'Usage: npx tsx scripts/teardown-certification-tenant.ts <school_id> [--dry-run]',
      '',
      '  <school_id>          UUID of the certification tenant\'s schools.id row (required).',
      '  --school-id=<uuid>   Equivalent to the positional <school_id>.',
      '  --dry-run            Perform every check but stop BEFORE calling purge_certification_tenant.',
      '',
      'Requires (both, even for --dry-run):',
      '  NEXT_PUBLIC_SUPABASE_URL',
      '  SUPABASE_SERVICE_ROLE_KEY',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { schoolId, dryRun } = parseArgs(argv);

  if (!schoolId) {
    printUsage();
    throw new Error('Missing required <school_id> argument.');
  }
  if (!isValidUuid(schoolId)) {
    throw new Error(
      `"${schoolId}" is not a valid UUID. Refusing to proceed — a malformed id is never a valid teardown target.`,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Both Supabase credential env vars are required (NEXT_PUBLIC_SUPABASE_URL, plus the service-role ' +
        'key env var — even for --dry-run: the dry run still performs the real is_demo lookup so its ' +
        'output reflects reality; it only skips the RPC call itself).',
    );
  }

  const projectRef = extractProjectRef(url);
  if (!projectRef) {
    throw new Error(
      `Could not parse a Supabase project ref out of NEXT_PUBLIC_SUPABASE_URL ("${url}"). Refusing to ` +
        'proceed — this wrapper cannot positively confirm the target is not production, so it fails closed.',
    );
  }
  // eslint-disable-next-line no-console
  console.log(`Configured target project ref: ${projectRef}`);
  // eslint-disable-next-line no-console
  console.log(`Known prod ref (forbidden):     ${KNOWN_PROD_PROJECT_REF}`);
  if (projectRef === KNOWN_PROD_PROJECT_REF) {
    throw new Error(
      'Refusing to run: NEXT_PUBLIC_SUPABASE_URL resolves to the KNOWN PRODUCTION project ref ' +
        `(${KNOWN_PROD_PROJECT_REF}). This script must never be pointed at production. FAIL-CLOSED.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('Target ref is NOT prod. Proceeding.\n');

  const sb = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseLike;

  const outcome = await runTeardown(sb, schoolId, dryRun);

  if (outcome.dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] school_id:   ${outcome.schoolId}`);
    // eslint-disable-next-line no-console
    console.log(`[dry-run] found:       ${outcome.schoolFound}`);
    // eslint-disable-next-line no-console
    console.log(`[dry-run] name:        ${outcome.schoolName ?? '(n/a)'}`);
    // eslint-disable-next-line no-console
    console.log(`[dry-run] is_demo:     ${outcome.isDemo}`);
    if (outcome.schoolFound) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] Would call:  SELECT purge_certification_tenant('${outcome.schoolId}');`);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[dry-run] School row not found — a real run would reach the RPC's idempotent no-op path ` +
          `("already_absent": true), not an error.`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('[dry-run] Stopping here. No RPC call was made, no rows were touched.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('purge_certification_tenant result:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(outcome.rpcResult, null, 2));
}

// `require.main === module` is the CJS standard; tsx transpiles to CJS.
// Wrapped in try/catch to stay inert under ESM-only runners (mirrors the
// existing convention in scripts/seed-certification-accounts.ts,
// scripts/audit-tenant-isolation.ts, and scripts/pre-rollout-checklist.ts).
const invokedDirectly = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require.main === module;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
