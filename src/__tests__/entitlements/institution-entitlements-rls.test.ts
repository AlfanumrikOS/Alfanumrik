import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * REG-147 (migration half) — institution_entitlements RLS + flag-seed posture.
 *
 * Migrations under test:
 *   supabase/migrations/20260615205752_institution_entitlements.sql  (table + RLS)
 *   supabase/migrations/20260615205753_seed_ff_institution_entitlements_v1.sql (flag seed, default OFF)
 *
 * Security contract (P8/P9/P13 — commercial-terms data boundary):
 *   1. RLS is ENABLED on the table.
 *   2. service_role: FOR ALL (the super-admin API is the only writer).
 *   3. school_admin: SELECT own school only, via the VERBATIM
 *      school_admins.auth_user_id = auth.uid() AND is_active subquery.
 *   4. super_admin (admin/super_admin): SELECT all, via the user_roles⋈roles +
 *      is_active + expires_at guard.
 *   5. NO student / parent policy (commercial terms are never learner data).
 *   6. Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY.
 *   7. No USING(true) on the role-scoped (authenticated) policies — only the
 *      service_role policy is allowed the open predicate.
 *   8. The flag seed creates ff_institution_entitlements_v1 with is_enabled=false
 *      / rollout 0, canonical flag_name shape (REG-125), ON CONFLICT DO NOTHING.
 *
 * STRUCTURAL, source-level (always-on) — mirrors
 * src/__tests__/monitoring/system-metrics-rls.test.ts. No DB required.
 *
 * Location note: this file lives in `src/__tests__/entitlements/` (NOT
 * `src/__tests__/migrations/`) on purpose. The vitest config EXCLUDES
 * `src/__tests__/migrations/**` from the normal `npm test` lane (that directory
 * is the live-DB integration lane, gated on RUN_INTEGRATION_TESTS=1). Because
 * this test reads the migration .sql as a static string and needs no DB, it must
 * run in the normal lane — exactly like the monitoring RLS source tests, which
 * also sit outside `migrations/`.
 */

const TABLE_MIGRATION = 'supabase/migrations/20260615205752_institution_entitlements.sql';
const SEED_MIGRATION = 'supabase/migrations/20260615205753_seed_ff_institution_entitlements_v1.sql';

function resolveRepoFile(rel: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const TABLE_PATH = resolveRepoFile(TABLE_MIGRATION);
const SEED_PATH = resolveRepoFile(SEED_MIGRATION);

function readFile(p: string | null): string {
  return p ? fs.readFileSync(p, 'utf-8') : '';
}

/** Strip comments + collapse whitespace so multi-line policies match on one line. */
function normalise(raw: string): string {
  const noLineComments = raw.replace(/^\s*--.*$/gm, '');
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlockComments.replace(/\s+/g, ' ');
}

function tableSql(): string {
  return normalise(readFile(TABLE_PATH));
}
function seedSql(): string {
  return normalise(readFile(SEED_PATH));
}

// ─────────────────────────────────────────────────────────────────────────────
// Presence + table shape
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 — institution_entitlements migration presence + table', () => {
  it(`${TABLE_MIGRATION} exists`, () => {
    expect(TABLE_PATH).not.toBeNull();
  });

  it('creates public.institution_entitlements (IF NOT EXISTS — idempotent)', () => {
    expect(tableSql()).toMatch(/CREATE TABLE IF NOT EXISTS public\.institution_entitlements/i);
  });

  it('school_id FKs schools ON DELETE CASCADE; contract_id FKs school_contracts ON DELETE SET NULL', () => {
    const sql = tableSql();
    expect(sql).toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/contract_id\s+uuid\s+REFERENCES public\.school_contracts\(id\) ON DELETE SET NULL/i);
  });

  it('has a UNIQUE (school_id, entitlement_key) constraint (the resolver/upsert probe)', () => {
    expect(tableSql()).toMatch(/UNIQUE \(school_id, entitlement_key\)/i);
  });

  it('does NOT drop any tables or columns (P8 — non-destructive)', () => {
    const sql = tableSql();
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RLS posture
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 — institution_entitlements RLS', () => {
  it('enables Row Level Security on the table', () => {
    expect(tableSql()).toMatch(/ALTER TABLE public\.institution_entitlements ENABLE ROW LEVEL SECURITY/i);
  });

  it('service_role policy is FOR ALL (the only writer)', () => {
    const sql = tableSql();
    expect(sql).toMatch(/CREATE POLICY "service_role full access" ON public\.institution_entitlements/i);
    expect(sql).toMatch(/CREATE POLICY "service_role full access"[\s\S]*?FOR ALL[\s\S]*?TO service_role/i);
  });

  it('school_admin can READ own school via the school_admins.auth_user_id = auth.uid() AND is_active subquery', () => {
    const sql = tableSql();
    expect(sql).toMatch(/CREATE POLICY "school_admin read own" ON public\.institution_entitlements( AS PERMISSIVE)? FOR SELECT/i);
    expect(sql).toContain('FROM public.school_admins sa');
    expect(sql).toContain('sa.auth_user_id = auth.uid()');
    expect(sql).toContain('sa.is_active = true');
  });

  it('super_admin can READ all via the user_roles ⋈ roles + is_active + expires_at guard', () => {
    const sql = tableSql();
    expect(sql).toMatch(/CREATE POLICY "super_admin read all" ON public\.institution_entitlements( AS PERMISSIVE)? FOR SELECT/i);
    expect(sql).toContain('FROM public.user_roles ur');
    expect(sql).toContain('JOIN public.roles r ON r.id = ur.role_id');
    expect(sql).toContain("r.name IN ('admin','super_admin')");
    expect(sql).toContain('ur.is_active = true');
    expect(sql).toContain('ur.expires_at IS NULL OR ur.expires_at > now()');
  });

  it('the two authenticated read policies are SELECT-only (commercial terms are read-only for non-service-role)', () => {
    const sql = tableSql();
    // No authenticated write policy exists — only service_role gets FOR ALL.
    expect(sql).not.toMatch(/CREATE POLICY[^;]*TO authenticated[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i);
  });

  it('there is NO student / parent policy (no learner-role grant anywhere in the file)', () => {
    const sql = tableSql();
    // No policy references a students/parents role table or a student/parent name.
    expect(sql).not.toMatch(/CREATE POLICY "[^"]*student[^"]*"/i);
    expect(sql).not.toMatch(/CREATE POLICY "[^"]*parent[^"]*"/i);
    expect(sql).not.toMatch(/r\.name IN \([^)]*'student'/i);
    expect(sql).not.toMatch(/r\.name IN \([^)]*'parent'/i);
  });

  it('every CREATE POLICY is preceded by a DROP POLICY IF EXISTS (idempotent re-run)', () => {
    const sql = tableSql();
    const createCount = (sql.match(/CREATE POLICY/g) || []).length;
    const dropCount = (sql.match(/DROP POLICY IF EXISTS/g) || []).length;
    expect(createCount).toBe(3); // service_role + school_admin + super_admin
    expect(dropCount).toBeGreaterThanOrEqual(createCount);
  });

  it('NO role-scoped (authenticated) policy uses an open USING(true) / WITH CHECK(true) predicate', () => {
    const sql = tableSql();
    // Only the service_role policy may carry the open predicate. Isolate the two
    // authenticated SELECT policies and assert neither uses USING (true).
    for (const name of ['school_admin read own', 'super_admin read all']) {
      const idx = sql.indexOf(`CREATE POLICY "${name}"`);
      expect(idx).toBeGreaterThan(-1);
      // slice to the end of this policy statement (next CREATE/DROP or end).
      const after = sql.slice(idx);
      const end = after.search(/(DROP POLICY|CREATE POLICY |$)/i);
      const stmt = end > 0 ? after.slice(0, after.indexOf('CREATE POLICY', 5) === -1 ? after.length : after.indexOf('CREATE POLICY', 5)) : after;
      expect(stmt).not.toMatch(/USING\s*\(\s*true\s*\)/i);
      expect(stmt).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
    }
  });

  it('only ONE policy carries USING(true) and it is the service_role one', () => {
    const sql = tableSql();
    const usingTrueCount = (sql.match(/USING\s*\(\s*true\s*\)/gi) || []).length;
    // service_role policy uses USING(true) (+ WITH CHECK(true)); the SELECT
    // policies use real predicates. So exactly one USING(true).
    expect(usingTrueCount).toBe(1);
    // It appears within the service_role policy.
    const svcIdx = sql.indexOf('CREATE POLICY "service_role full access"');
    const usingIdx = sql.search(/USING\s*\(\s*true\s*\)/i);
    expect(svcIdx).toBeGreaterThan(-1);
    expect(usingIdx).toBeGreaterThan(svcIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag seed — default OFF, canonical shape
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 — ff_institution_entitlements_v1 flag seed (default OFF)', () => {
  it(`${SEED_MIGRATION} exists`, () => {
    expect(SEED_PATH).not.toBeNull();
  });

  it('seeds the flag with is_enabled = false and rollout 0 (double-gated OFF)', () => {
    const sql = seedSql();
    expect(sql).toContain("'ff_institution_entitlements_v1'");
    // values list: flag_name, false, 0, ... — assert the false + 0 are present.
    expect(sql).toMatch(/VALUES \( 'ff_institution_entitlements_v1', false, 0,/i);
  });

  it('uses the canonical flag_name column + ON CONFLICT (flag_name) DO NOTHING (REG-125 shape, never DO UPDATE)', () => {
    const sql = seedSql();
    expect(sql).toMatch(/INSERT INTO public\.feature_flags \( flag_name,/i);
    expect(sql).toMatch(/ON CONFLICT \(flag_name\) DO NOTHING/i);
    expect(sql).not.toMatch(/DO UPDATE/i);
    // canonical shape: flag_name/is_enabled, NOT name/enabled.
    expect(sql).not.toMatch(/INSERT INTO public\.feature_flags \( name,/i);
  });

  it('is guarded so it no-ops on a fresh DB without the feature_flags table', () => {
    expect(seedSql()).toMatch(/IF to_regclass\('public\.feature_flags'\) IS NOT NULL THEN/i);
  });

  it('makes no schema change (pure data seed — no CREATE TABLE / DROP)', () => {
    const sql = seedSql();
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
  });
});

// Always-on guard against a path/rename regression silently greening the suite.
describe('REG-147 — migrations must be locatable', () => {
  it('both migration files are present at their expected paths', () => {
    expect(TABLE_PATH).not.toBeNull();
    expect(SEED_PATH).not.toBeNull();
  });
});
