/**
 * ALFANUMRIK — Certification Traffic Seeding Script
 *
 * Seeds one account per certification "mission role" per the exact
 * traceability convention specified in
 * `docs/runbooks/certification-traffic-traceability.md` (four required
 * signals: email-domain marker, `is_demo = true`, name/`display_name`
 * run-marker, and a `demo_accounts` registry row for every role that
 * constraint allows).
 *
 * MISSION ROLES (7 — origin: 2026-07-02 certification plan)
 * ============================================================
 *   student, teacher, parent, school_admin, super_admin — standard RBAC
 *   roles with a dedicated frontend portal.
 *   content_author, support_staff — REAL RBAC roles (admin_users rows with
 *   admin_level = 'content_manager' / 'support' respectively — see
 *   src/lib/admin-auth.ts ADMIN_LEVELS) but, per this session's Wave 1
 *   findings, NO dedicated frontend portal exists for either. They are
 *   seeded anyway (not skipped) so the certification plan's Stage 2 live
 *   testing can prove that gap against a real seeded account instead of
 *   only asserting it statically from source.
 *
 * KNOWN LIMITATION — flagged, not silently worked around
 * ==========================================================
 * `demo_accounts_role_check` (migration 20260528000001_promote_demo_accounts_v2.sql)
 * only allows role IN ('student','teacher','parent','school_admin','super_admin').
 * `content_author` and `support_staff` are real `admin_users` rows (same base
 * table as `super_admin`, distinguished only by `admin_level`), but there is
 * no CHECK-legal way to register them in `demo_accounts` under an accurate
 * role label. Mislabeling them as role='super_admin' in the registry would be
 * incorrect (they are NOT super admins) and would corrupt any report that
 * trusts `demo_accounts.role`. So this script deliberately does NOT insert a
 * `demo_accounts` row for these two roles — `buildDemoAccountsRow()` returns
 * `null` for them by design (see MISSION_ROLES[].demoAccountRole = null).
 * They remain fully traceable and purgeable via the other three signals
 * (`is_demo = true`, the `@certification.alfanumrik.invalid` email domain,
 * and the `cert-<run_id_short>-<role>-<n>` name marker) — a direct
 * `admin_users`-scoped query is sufficient for teardown/audit of these two
 * roles specifically (see printSummary()'s teardown hint). Recommended
 * follow-up for architect (mirrors the runbook's own "Gaps to flag to
 * architect" pattern): widen `demo_accounts_role_check` to add
 * 'content_manager' and 'support' if certification runs become routine.
 *
 * IDEMPOTENCY
 * ============
 * Every write is find-or-create (select by email first; insert only on a
 * miss), so re-running this script with the SAME --run-id never creates a
 * duplicate auth user, base-table row, or demo_accounts row. Re-running
 * with a DIFFERENT --run-id always creates a fresh, independent set of rows
 * (different email/name markers), so multiple certification runs never
 * collide with each other.
 *
 * USAGE
 * ============================================================
 *   npx tsx scripts/seed-certification-accounts.ts                  # real run, fresh run-id
 *   npx tsx scripts/seed-certification-accounts.ts --run-id=<uuid>  # real run, reuse a run-id (idempotent)
 *   npx tsx scripts/seed-certification-accounts.ts --no-school      # skip the synthetic school + school-scoped rows
 *   npx tsx scripts/seed-certification-accounts.ts --dry-run        # print what WOULD be created; no I/O at all
 *   npx tsx scripts/seed-certification-accounts.ts --dry-run --run-id=<uuid>  # dry-run with a fixed run-id
 *
 * `--dry-run` never touches the network or reads NEXT_PUBLIC_SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY — it only computes and prints the exact
 * email/name/role shapes this run would produce (see `buildAccountShape`/
 * `buildSchoolShape`, both pure). Safe to run with zero env vars configured.
 *
 * Requires (unless --dry-run):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * PRODUCTION-REFERENCE GUARD (fail-closed, safety-critical)
 * ============================================================
 * Before any write, the script extracts the Supabase project ref (subdomain)
 * from NEXT_PUBLIC_SUPABASE_URL and refuses to run — exits non-zero, writes
 * nothing — unless it can POSITIVELY confirm that ref is NOT the known
 * production ref (`PROD_PROJECT_REF` below, same literal value the
 * fail-closed wall in `.github/workflows/staging-adaptive-drill.yml` uses).
 * An unparseable/unrecognized URL shape is ALSO refused — "cannot confirm
 * it's safe" is treated identically to "confirmed unsafe", never as
 * "probably fine". See `assertNotProductionProjectRef()`. This guard cannot
 * be bypassed by any CLI flag, including `--dry-run` is exempt only because
 * it never reads the env vars in the first place — a real run always passes
 * through the guard.
 *
 * Teardown: once a synthetic school is seeded (default), the entire tenant
 * — including every account this script created under it — can be removed
 * in one call via `purge_certification_tenant(p_school_id)`
 * (migration 20260702180000_certification_tenant_teardown.sql). The
 * standalone parent account (never school-scoped) and the two
 * portal-less admin roles (content_author/support_staff, not
 * school-scoped either) are NOT covered by that RPC — see the "Known
 * limitation" note above and the printed teardown hint at the end of a run.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// ─── The four-signal convention (runbook — do not let these drift) ────────

export const CERTIFICATION_EMAIL_DOMAIN = 'certification.alfanumrik.invalid';
export const SCHOOL_NAME_PREFIX = '[CERTIFICATION]';

// ─── Production-reference guard (fail-closed) ──────────────────────────────
//
// Same literal ref the fail-closed wall in
// .github/workflows/staging-adaptive-drill.yml uses as its "PROD_PROJECT_REF"
// negative-assertion target. Duplicated here deliberately (not imported —
// this is a standalone Node script with no shared-constants module and no
// access to GitHub Actions secrets/env at authoring time); if the production
// project is ever migrated, BOTH this constant and the workflow's must be
// updated together.

export const PROD_PROJECT_REF = 'shktyoxqhundlvkiwguu';

/**
 * Extract the Supabase project ref (subdomain) from a Supabase URL, e.g.
 * `https://abcdefghijklmnop.supabase.co` -> `abcdefghijklmnop`. Returns null
 * for any URL that doesn't match the expected shape exactly — deliberately
 * strict (no partial/fuzzy matching) so an unusual or malformed URL can never
 * be silently coerced into "looks fine".
 */
export function extractProjectRef(supabaseUrl: string): string | null {
  const match = supabaseUrl.trim().match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  return match ? match[1].toLowerCase() : null;
}

export interface ProdRefGuardResult {
  ok: boolean;
  projectRef: string | null;
  reason?: string;
}

/**
 * Fail-closed production-reference guard. Mirrors the same-run fail-closed
 * posture in `.github/workflows/staging-adaptive-drill.yml` (compare the
 * resolved ref against the known PROD ref; refuse on a match). Extended here
 * to ALSO refuse when the ref cannot be determined at all — "unable to
 * positively confirm this is not production" is treated identically to
 * "confirmed production", never as "probably safe". Pure function — no I/O,
 * directly unit-testable.
 */
export function assertNotProductionProjectRef(supabaseUrl: string): ProdRefGuardResult {
  const ref = extractProjectRef(supabaseUrl);
  if (!ref) {
    return {
      ok: false,
      projectRef: ref,
      reason:
        `Could not positively confirm the target Supabase project from the configured URL ` +
        `("${supabaseUrl}"). Refusing to run (fail-closed) — this script only accepts a URL of ` +
        `the exact shape https://<project-ref>.supabase.co.`,
    };
  }
  if (ref === PROD_PROJECT_REF) {
    return {
      ok: false,
      projectRef: ref,
      reason:
        `Resolved project ref ("${ref}") matches the known PRODUCTION project ref ` +
        `(${PROD_PROJECT_REF}). Refusing to run (fail-closed). Certification seeding must never ` +
        `write to production — see docs/audit/2026-07-02-certification/release-candidate/` +
        `RC-2026-07-02-baseline.md, "Environment assumptions" item 1.`,
    };
  }
  return { ok: true, projectRef: ref };
}

// ─── Mission roles ──────────────────────────────────────────────────────

export type MissionRole =
  | 'student'
  | 'teacher'
  | 'parent'
  | 'school_admin'
  | 'super_admin'
  | 'content_author'
  | 'support_staff';

export type BaseTable = 'students' | 'teachers' | 'guardians' | 'school_admins' | 'admin_users';

export type DemoAccountRole = 'student' | 'teacher' | 'parent' | 'school_admin' | 'super_admin';

export interface RoleDef {
  role: MissionRole;
  table: BaseTable;
  /** null => this role has no CHECK-legal demo_accounts.role value. See "Known limitation" above. */
  demoAccountRole: DemoAccountRole | null;
  /** Only set for admin_users-backed roles. */
  adminLevel?: string;
  /** Whether this role has a dedicated frontend portal today (Wave 1 finding). */
  hasPortal: boolean;
  /** Whether this role's base row is school-scoped. */
  schoolScoped: boolean;
}

export const MISSION_ROLES: readonly RoleDef[] = [
  { role: 'student', table: 'students', demoAccountRole: 'student', hasPortal: true, schoolScoped: true },
  { role: 'teacher', table: 'teachers', demoAccountRole: 'teacher', hasPortal: true, schoolScoped: true },
  { role: 'parent', table: 'guardians', demoAccountRole: 'parent', hasPortal: true, schoolScoped: false },
  { role: 'school_admin', table: 'school_admins', demoAccountRole: 'school_admin', hasPortal: true, schoolScoped: true },
  { role: 'super_admin', table: 'admin_users', demoAccountRole: 'super_admin', adminLevel: 'super_admin', hasPortal: true, schoolScoped: false },
  { role: 'content_author', table: 'admin_users', demoAccountRole: null, adminLevel: 'content_manager', hasPortal: false, schoolScoped: false },
  { role: 'support_staff', table: 'admin_users', demoAccountRole: null, adminLevel: 'support', hasPortal: false, schoolScoped: false },
];

// ─── Pure shape helpers (no I/O — directly unit-testable) ─────────────────

/** First 8 lowercase hex chars of a UUID (hyphens stripped), per the runbook's `run_id_short`. */
export function runIdShortOf(runId: string): string {
  return runId.replace(/-/g, '').slice(0, 8).toLowerCase();
}

export interface AccountShape {
  role: MissionRole;
  seq: number;
  email: string;
  name: string;
}

/**
 * `cert-<run_id_short>-<role>-<n>[@certification.alfanumrik.invalid]` —
 * byte-for-byte the runbook's convention. `seq` is zero-padded to 3 digits
 * so multiple accounts of the same role in one run never collide.
 */
export function buildAccountShape(runIdShort: string, role: MissionRole, seq = 1): AccountShape {
  const n = String(seq).padStart(3, '0');
  const local = `cert-${runIdShort}-${role}-${n}`;
  return {
    role,
    seq,
    email: `${local}@${CERTIFICATION_EMAIL_DOMAIN}`,
    name: local,
  };
}

export interface SchoolShape {
  name: string;
}

/** `[CERTIFICATION] cert-<run_id_short>-school-<n>` — byte-for-byte the runbook's convention. */
export function buildSchoolShape(runIdShort: string, seq = 1): SchoolShape {
  const n = String(seq).padStart(3, '0');
  return { name: `${SCHOOL_NAME_PREFIX} cert-${runIdShort}-school-${n}` };
}

/**
 * Base-table row for a given role. Every row carries is_demo=true + the
 * name/email markers.
 *
 * SCHEMA-SHAPE CONTRACT (exhaustive pass, 2026-07-02 — do NOT reintroduce a
 * blanket `common` spread that assumes a column exists on every table).
 * Column existence was audited against the authoritative pg_dump baseline
 * `supabase/migrations/00000000000000_baseline_from_prod.sql` PLUS the
 * additive migrations that ran after it. The five base tables do NOT share a
 * uniform column set:
 *
 *   column         students  teachers  guardians  school_admins  admin_users
 *   ------------   --------  --------  ---------  -------------  -----------
 *   auth_user_id      ✓         ✓          ✓            ✓ (NN)        ✓
 *   name              ✓ (NN)    ✓ (NN)     ✓ (NN)       ✓             ✓ (NN)
 *   email             ✓         ✓ (NN)     ✓            ✓             ✓ (NN)
 *   is_demo           ✓         ✓ [m1]     ✓ [m1]       ✓ [m2]        ✓ [m2]
 *   is_active         ✓         ✓          — MISSING    ✓ (NN)        ✓
 *   school_id         ✓         ✓          —            ✓ (NN)        —
 *   admin_level       —         —          —            —            ✓ (NN,def)
 *
 *   [m1] added by 20260515000001 / 20260603150000 (teachers + guardians)
 *   [m2] added by 20260528000001 (admin_users + school_admins + schools)
 *
 * KEY FINDING — `guardians` has NO `is_active` column (never existed in the
 * baseline; no migration ever adds it; explicitly noted in
 * 20260325100000_enforce_unique_auth_user_id.sql: "Guardians ... (no
 * is_active column)"). Spreading a shared object containing `is_active` into
 * the guardians row is exactly the Stage-2 field failure this pass removes
 * ("Could not find the 'is_active' column of 'guardians'"). So `is_active`
 * lives ONLY on the four tables that actually have it, never on guardians.
 *
 * `is_demo` IS universal across all five (verified above) — the parent/guardian
 * demo marker is intact; guardians is fully traceable via is_demo + email
 * domain + name marker.
 *
 * NOT-NULL-without-default columns each table requires, all satisfied here:
 *   students: name, grade                (preferred_language/account_status/
 *                                          is_demo are NN but DEFAULTed)
 *   teachers: name, email
 *   guardians: name                      (email is nullable)
 *   school_admins: auth_user_id, school_id  (role/is_active/is_demo NN+DEFAULT)
 *   admin_users: name, email             (role/admin_level/is_demo NN+DEFAULT)
 *
 * CAVEAT (flagged, not silently patched): school_admins.school_id is NOT NULL
 * with no default. It is satisfied on the default run (a synthetic school is
 * seeded first). Under `--no-school`, rowSchoolId is null for the
 * school-scoped school_admin and its insert WILL fail the NOT NULL — a
 * school_admin cannot exist without a school by design. This is a latent
 * limitation of `--no-school`, not a column-shape bug in this row builder.
 */
export function buildBaseTableRow(
  def: RoleDef,
  shape: AccountShape,
  authUserId: string,
  schoolId: string | null,
): Record<string, unknown> {
  // Columns that exist on EVERY one of the five base tables (verified above).
  const common = {
    auth_user_id: authUserId,
    name: shape.name,
    email: shape.email,
    is_demo: true,
  };
  // `is_active` exists on every base table EXCEPT guardians — so it is added
  // here for the four tables that have it, and deliberately omitted from the
  // guardians row below.
  const commonWithIsActive = { ...common, is_active: true };
  switch (def.table) {
    case 'students':
      return {
        ...commonWithIsActive,
        grade: '10',
        board: 'CBSE',
        school_id: schoolId,
        onboarding_completed: true,
        // Explicitly NULL — do NOT "helpfully" set this to a real subject.
        // The students.preferred_subject column has a DB default of
        // 'Mathematics' AND a foreign key (students_preferred_subject_fkey)
        // into the subjects reference table. That default is only a valid FK
        // target in an environment whose subjects reference data happens to
        // contain a matching row (true on prod, NOT true on the staging
        // project — Stage 2 field-caught this as an FK-violation insert
        // failure). A NULL foreign-key value is always valid regardless of
        // what reference data the target environment seeded, so seeding NULL
        // decouples this script from any environment's subject-seed state.
        // (Note the pre-existing internal inconsistency: several RPCs use
        // COALESCE(preferred_subject, 'math') — convention 'math' — while the
        // column default is 'Mathematics'. Not this script's to reconcile.)
        preferred_subject: null,
      };
    case 'teachers':
      return { ...commonWithIsActive, school_id: schoolId };
    case 'guardians':
      // NO is_active — the guardians table has no such column. Only the
      // universal columns (auth_user_id, name, email, is_demo) apply.
      return { ...common };
    case 'school_admins':
      return { ...commonWithIsActive, school_id: schoolId };
    case 'admin_users':
      return { ...commonWithIsActive, admin_level: def.adminLevel };
    default: {
      const exhaustive: never = def.table;
      throw new Error(`Unhandled base table: ${exhaustive}`);
    }
  }
}

export interface DemoAccountsRow {
  auth_user_id: string;
  role: DemoAccountRole;
  persona: null;
  display_name: string;
  email: string;
  school_id: string | null;
  is_active: true;
  created_by: string | null;
}

/**
 * Exact `demo_accounts` registry-row shape per the runbook's "signal 4".
 * Returns null for roles with no CHECK-legal demo_accounts.role value
 * (content_author / support_staff — see the "Known limitation" module doc).
 */
export function buildDemoAccountsRow(
  def: RoleDef,
  shape: AccountShape,
  authUserId: string,
  schoolId: string | null,
  createdBy: string | null,
): DemoAccountsRow | null {
  if (!def.demoAccountRole) return null;
  return {
    auth_user_id: authUserId,
    role: def.demoAccountRole,
    persona: null,
    display_name: shape.name,
    email: shape.email,
    school_id: schoolId,
    is_active: true,
    created_by: createdBy,
  };
}

// ─── Minimal DB-client surface (kept narrow so it's trivially fakeable in tests) ──

export interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<QueryResult<Record<string, unknown>>>;
      };
    };
    // Generic (not `Record<string, unknown>`) so a concrete row interface
    // like `DemoAccountsRow` (no index signature) is directly assignable
    // without a cast at every call site.
    insert<T extends object>(row: T): {
      select(cols: string): {
        single(): Promise<QueryResult<Record<string, unknown>>>;
      };
    };
  };
  auth: {
    admin: {
      createUser(params: {
        email: string;
        password: string;
        email_confirm: boolean;
        user_metadata?: Record<string, unknown>;
      }): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
      // Used only on the partial-failure recovery path in
      // `findOrCreateAuthUser`: if `createUser` reports the email already
      // exists (an auth user was created by a prior aborted run but its
      // base-table row was never written), we page through `listUsers` to
      // recover that user's id. Paginated in supabase-js v2 (pinned ^2.108.x).
      listUsers(params?: { page?: number; perPage?: number }): Promise<{
        data: { users: Array<{ id: string; email?: string | null }> } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/**
 * Match Supabase's "email already exists" error defensively — the exact
 * wording varies across gotrue/supabase-js versions (e.g. "A user with this
 * email address has already been registered", "User already registered",
 * "email_exists"). We only recover on this specific class of error; any other
 * createUser failure still throws.
 */
export function isEmailAlreadyRegisteredError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('already been registered') ||
    m.includes('already registered') ||
    m.includes('email address has already') ||
    m.includes('email_exists') ||
    m.includes('email exists')
  );
}

/**
 * Page through `auth.admin.listUsers` to find the auth user id for `email`.
 * Returns null if no user matches. Used only to recover from a partial-failure
 * re-run (see `findOrCreateAuthUser`); a certification seed's auth.users set is
 * small, so a bounded page walk is well within budget.
 */
export async function findAuthUserIdByEmail(sb: SupabaseLike, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  const maxPages = 100; // hard bound: up to 20k users — far beyond any seed
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`listUsers failed while recovering ${email}: ${error.message}`);
    }
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? '').trim().toLowerCase() === target);
    if (match) {
      return match.id;
    }
    if (users.length < perPage) {
      break; // last (partial) page reached; email is genuinely not present
    }
  }
  return null;
}

// ─── Idempotent find-or-create primitives ──────────────────────────────────

/**
 * Find an existing base-table row by email; if found, reuse its
 * `auth_user_id`. Otherwise create a fresh Supabase Auth user.
 *
 * The base-table-first lookup is the fast, common idempotency path: it is the
 * row this script's own idempotency depends on, and it avoids a `listUsers`
 * call on the happy re-run.
 *
 * PARTIAL-FAILURE RECOVERY: the base-table lookup alone is NOT sufficient for
 * idempotency. If a prior run created the auth user (below) but aborted BEFORE
 * writing the base-table row (e.g. a downstream insert FK-violated), a re-run
 * finds no base row, falls through to `createUser`, and Supabase rejects the
 * duplicate email — wedging that account permanently. So when `createUser`
 * reports the email already exists, we RECOVER by paging `listUsers` for the
 * pre-existing auth user and return its id with `created: false`. The caller
 * then proceeds to create the missing base-table row, healing the half-created
 * account. (This supersedes the old "we deliberately avoid listUsers" note:
 * listUsers is paginated and reliable in the pinned supabase-js ^2.108.x, and
 * it is only invoked on the rare recovery path, never on the happy path.)
 */
export async function findOrCreateAuthUser(
  sb: SupabaseLike,
  table: BaseTable,
  email: string,
  password: string,
): Promise<{ authUserId: string; created: boolean }> {
  const existing = await sb.from(table).select('auth_user_id').eq('email', email).maybeSingle();
  if (existing.error) {
    throw new Error(`[${table}] auth-user lookup failed for ${email}: ${existing.error.message}`);
  }
  const existingId = existing.data?.auth_user_id;
  if (typeof existingId === 'string' && existingId.length > 0) {
    return { authUserId: existingId, created: false };
  }

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { is_demo: true, is_certification: true },
  });
  if (error) {
    // Partial-failure recovery: the auth user exists from a prior aborted run
    // but no base-table row was ever written. Reuse the existing auth user so
    // the caller can create the missing base row and heal the account.
    if (isEmailAlreadyRegisteredError(error.message)) {
      const recoveredId = await findAuthUserIdByEmail(sb, email);
      if (recoveredId) {
        return { authUserId: recoveredId, created: false };
      }
      throw new Error(
        `createUser reported ${email} already registered, but listUsers found no matching auth user (unrecoverable)`,
      );
    }
    throw new Error(`createUser failed for ${email}: ${error.message}`);
  }
  if (!data.user) {
    throw new Error(`createUser failed for ${email}: no user returned`);
  }
  return { authUserId: data.user.id, created: true };
}

/** Find-or-create a base-table row by email. */
export async function upsertBaseTableRow(
  sb: SupabaseLike,
  table: BaseTable,
  email: string,
  row: Record<string, unknown>,
): Promise<{ id: string; created: boolean }> {
  const existing = await sb.from(table).select('id').eq('email', email).maybeSingle();
  if (existing.error) {
    throw new Error(`[${table}] row lookup failed for ${email}: ${existing.error.message}`);
  }
  const existingId = existing.data?.id;
  if (typeof existingId === 'string' && existingId.length > 0) {
    return { id: existingId, created: false };
  }

  const inserted = await sb.from(table).insert(row).select('id').single();
  if (inserted.error || typeof inserted.data?.id !== 'string') {
    throw new Error(`[${table}] insert failed for ${email}: ${inserted.error?.message ?? 'no id returned'}`);
  }
  return { id: inserted.data.id, created: true };
}

/** Find-or-create a `demo_accounts` registry row by email. */
export async function upsertDemoAccountsRow(
  sb: SupabaseLike,
  row: DemoAccountsRow,
): Promise<{ id: string; created: boolean }> {
  const existing = await sb.from('demo_accounts').select('id').eq('email', row.email).maybeSingle();
  if (existing.error) {
    throw new Error(`demo_accounts lookup failed for ${row.email}: ${existing.error.message}`);
  }
  const existingId = existing.data?.id;
  if (typeof existingId === 'string' && existingId.length > 0) {
    return { id: existingId, created: false };
  }

  const inserted = await sb.from('demo_accounts').insert(row).select('id').single();
  if (inserted.error || typeof inserted.data?.id !== 'string') {
    throw new Error(`demo_accounts insert failed for ${row.email}: ${inserted.error?.message ?? 'no id returned'}`);
  }
  return { id: inserted.data.id, created: true };
}

/** Find-or-create the synthetic certification school by name. */
export async function upsertSchoolRow(
  sb: SupabaseLike,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await sb.from('schools').select('id').eq('name', name).maybeSingle();
  if (existing.error) {
    throw new Error(`schools lookup failed for ${name}: ${existing.error.message}`);
  }
  const existingId = existing.data?.id;
  if (typeof existingId === 'string' && existingId.length > 0) {
    return { id: existingId, created: false };
  }

  const inserted = await sb
    .from('schools')
    .insert({ name, is_demo: true, board: 'CBSE', is_active: true })
    .select('id')
    .single();
  if (inserted.error || typeof inserted.data?.id !== 'string') {
    throw new Error(`schools insert failed for ${name}: ${inserted.error?.message ?? 'no id returned'}`);
  }
  return { id: inserted.data.id, created: true };
}

// ─── Orchestration ──────────────────────────────────────────────────────

export interface SeedOptions {
  runId?: string;
  seedSchool?: boolean;
  createdBy?: string | null;
  password?: string;
}

export interface SeedResultAccount {
  role: MissionRole;
  email: string;
  name: string;
  authUserId: string;
  baseRowId: string;
  baseRowCreated: boolean;
  demoAccountId: string | null;
  demoAccountCreated: boolean;
  hasPortal: boolean;
}

export interface SeedResult {
  runId: string;
  runIdShort: string;
  schoolId: string | null;
  schoolName: string | null;
  accounts: SeedResultAccount[];
}

/**
 * Seed one account per mission role. Idempotent — safe to call twice with
 * the same `opts.runId` (every write is find-or-create; a second call
 * produces `created: false` for every account and zero new rows).
 */
export async function seedCertificationAccounts(
  sb: SupabaseLike,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  const runId = opts.runId ?? randomUUID();
  const runIdShort = runIdShortOf(runId);
  const password = opts.password ?? `Cert!${runIdShort}Aa1`;
  const createdBy = opts.createdBy ?? null;

  let schoolId: string | null = null;
  let schoolName: string | null = null;
  if (opts.seedSchool !== false) {
    const shape = buildSchoolShape(runIdShort);
    const school = await upsertSchoolRow(sb, shape.name);
    schoolId = school.id;
    schoolName = shape.name;
  }

  const accounts: SeedResultAccount[] = [];
  for (const def of MISSION_ROLES) {
    const shape = buildAccountShape(runIdShort, def.role, 1);
    const rowSchoolId = def.schoolScoped ? schoolId : null;

    const { authUserId } = await findOrCreateAuthUser(sb, def.table, shape.email, password);
    const baseRow = buildBaseTableRow(def, shape, authUserId, rowSchoolId);
    const { id: baseRowId, created: baseRowCreated } = await upsertBaseTableRow(
      sb,
      def.table,
      shape.email,
      baseRow,
    );

    let demoAccountId: string | null = null;
    let demoAccountCreated = false;
    const demoRow = buildDemoAccountsRow(def, shape, authUserId, rowSchoolId, createdBy);
    if (demoRow) {
      const res = await upsertDemoAccountsRow(sb, demoRow);
      demoAccountId = res.id;
      demoAccountCreated = res.created;
    }

    accounts.push({
      role: def.role,
      email: shape.email,
      name: shape.name,
      authUserId,
      baseRowId,
      baseRowCreated,
      demoAccountId,
      demoAccountCreated,
      hasPortal: def.hasPortal,
    });
  }

  return { runId, runIdShort, schoolId, schoolName, accounts };
}

// ─── CLI entry point ────────────────────────────────────────────────────

function printSummary(result: SeedResult): void {
  // Log the FULL run id once, per the runbook's requirement #5, so an
  // operator can reconstruct run_id_short for teardown/query without
  // guessing.
  // eslint-disable-next-line no-console
  console.log(`\ncertification_run_id (FULL — save this for teardown): ${result.runId}`);
  // eslint-disable-next-line no-console
  console.log(`run_id_short: ${result.runIdShort}`);
  if (result.schoolId) {
    // eslint-disable-next-line no-console
    console.log(`school: ${result.schoolName} (id=${result.schoolId})`);
  }
  // eslint-disable-next-line no-console
  console.log('\nAccounts:');
  for (const a of result.accounts) {
    const created = a.baseRowCreated ? 'created' : 'reused (idempotent — already existed)';
    const portal = a.hasPortal ? 'has portal' : 'NO PORTAL (Wave 1 finding — Stage 2 must prove this live)';
    // eslint-disable-next-line no-console
    console.log(`  ${a.role.padEnd(15)} ${a.email.padEnd(55)} ${created.padEnd(35)} ${portal}`);
  }
  // eslint-disable-next-line no-console
  console.log('\nTeardown:');
  if (result.schoolId) {
    // eslint-disable-next-line no-console
    console.log(`  School-scoped tenant (student/teacher/school_admin + the school itself):`);
    // eslint-disable-next-line no-console
    console.log(`    SELECT purge_certification_tenant('${result.schoolId}');`);
  }
  // eslint-disable-next-line no-console
  console.log('  Standalone accounts NOT covered by purge_certification_tenant (parent,');
  // eslint-disable-next-line no-console
  console.log('  super_admin, content_author, support_staff — none are school-scoped):');
  // eslint-disable-next-line no-console
  console.log(
    `    DELETE FROM guardians WHERE email LIKE 'cert-${result.runIdShort}-%@${CERTIFICATION_EMAIL_DOMAIN}';`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `    DELETE FROM admin_users WHERE email LIKE 'cert-${result.runIdShort}-%@${CERTIFICATION_EMAIL_DOMAIN}';`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `    DELETE FROM demo_accounts WHERE email LIKE 'cert-${result.runIdShort}-%@${CERTIFICATION_EMAIL_DOMAIN}';`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runIdArg = args.find((a) => a.startsWith('--run-id='))?.split('=')[1];
  const noSchool = args.includes('--no-school');
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    const runId = runIdArg ?? randomUUID();
    const runIdShort = runIdShortOf(runId);
    // eslint-disable-next-line no-console
    console.log(`[dry-run] certification_run_id: ${runId} (short=${runIdShort})`);
    if (!noSchool) {
      const school = buildSchoolShape(runIdShort);
      // eslint-disable-next-line no-console
      console.log(`[dry-run] school: ${school.name}`);
    }
    for (const def of MISSION_ROLES) {
      const shape = buildAccountShape(runIdShort, def.role, 1);
      // eslint-disable-next-line no-console
      console.log(
        `[dry-run]   ${def.role.padEnd(15)} ${shape.email.padEnd(55)} portal=${def.hasPortal}`,
      );
    }
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).',
    );
    process.exit(1);
    return;
  }

  // Fail-closed production-reference guard — see the module doc comment.
  // This can never be skipped or overridden by a flag; every non-dry-run
  // invocation passes through it before any Supabase client is constructed.
  const guard = assertNotProductionProjectRef(url);
  if (!guard.ok) {
    // eslint-disable-next-line no-console
    console.error(`REFUSING TO RUN — production-reference guard failed.\n${guard.reason}`);
    process.exit(1);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Production-reference guard passed. Target project ref: ${guard.projectRef}`);

  const sb = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseLike;
  const result = await seedCertificationAccounts(sb, {
    runId: runIdArg,
    seedSchool: !noSchool,
  });
  printSummary(result);
}

// `require.main === module` is the CJS standard; tsx transpiles to CJS.
// Wrapped in try/catch to stay inert under ESM-only runners (mirrors the
// existing convention in scripts/audit-tenant-isolation.ts and
// scripts/pre-rollout-checklist.ts).
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
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
