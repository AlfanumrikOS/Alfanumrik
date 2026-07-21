import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static content-pin test for migration 20260721000000. This does NOT require
// a live database connection - it pins the exact SQL text of the migration
// so a future edit cannot silently reintroduce the cross-tenant leak or
// silently drop one of the legitimate read paths this migration deliberately
// preserves. See .claude/regression/10-rbac-rls.md REG-290 for the full
// narrative and apps/host/src/__tests__/security/tenant-isolation-role-scoped-apis.test.ts
// for the established static-pin pattern this test follows.

const root = process.cwd();
const migrationsDir = join(root, '..', '..', 'supabase', 'migrations');

function findMigration(): string {
  const files = readdirSync(migrationsDir);
  const match = files.find((f) =>
    f.includes('close_teachers_classes_cross_tenant_rls_leak')
  );
  if (!match) {
    throw new Error(
      'Expected migration closing the teachers/classes cross-tenant RLS leak was not found in supabase/migrations/'
    );
  }
  return readFileSync(join(migrationsDir, match), 'utf8');
}

// Strip `-- comment` lines so assertions about the ACTIVE DDL are not
// confused by the header comment's legitimate documentation of the OLD
// (leaky) predicate it is explaining and removing.
function activeDdlOnly(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('teachers/classes cross-tenant RLS leak fix (migration 20260721000000)', () => {
  const sql = findMigration();
  const ddl = activeDdlOnly(sql);

  it('drops the over-permissive teachers_select_merged policy', () => {
    expect(ddl).toContain('DROP POLICY IF EXISTS "teachers_select_merged" ON public.teachers');
  });

  it('drops the over-permissive "Anyone can read active classes" policy', () => {
    expect(ddl).toContain('DROP POLICY IF EXISTS "Anyone can read active classes" ON public.classes');
  });

  it('does NOT reintroduce an auth.role() = \'authenticated\' style unrestricted predicate in the active DDL', () => {
    // The header comment legitimately quotes the OLD leaky predicate as
    // documentation; activeDdlOnly() strips comment lines so this assertion
    // only inspects real, executable SQL.
    expect(ddl).not.toMatch(/auth\.role\(\)\s*=\s*'authenticated'/);
  });

  it('adds a replacement own-row SELECT policy on teachers so the one legitimate path this migration removes (self-read) is preserved', () => {
    expect(ddl).toContain('CREATE POLICY "teachers_select_own"');
    expect(ddl).toContain('ON public.teachers FOR SELECT TO authenticated');
    expect(ddl).toContain('USING (auth_user_id = auth.uid())');
  });

  it('does NOT touch the school-admin-lookup or JWT-staff-scoped SELECT policies on either table', () => {
    // These pre-existing policies (baseline "School admins can view school
    // teachers/classes" + 20260715110000's get_jwt_school_id()-scoped
    // policies) already cover the admin/staff read paths and must be left
    // alone by this migration - it should only DROP the two leaky policies
    // and ADD teachers_select_own.
    expect(ddl).not.toContain('DROP POLICY IF EXISTS "School admins can view school teachers"');
    expect(ddl).not.toContain('DROP POLICY IF EXISTS "School admins can view school classes"');
    expect(ddl).not.toContain('DROP POLICY IF EXISTS "School staff can view own school teachers"');
    expect(ddl).not.toContain('DROP POLICY IF EXISTS "School staff can view own school classes"');
  });

  it('does not drop or alter any INSERT/UPDATE/DELETE policy, and keeps RLS enabled on both tables', () => {
    expect(ddl).toContain('ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY');
    expect(ddl).toContain('ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY');
    expect(ddl).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
    expect(ddl).not.toMatch(/DROP TABLE/i);
    expect(ddl).not.toMatch(/DROP COLUMN/i);
    expect(ddl).not.toContain('teachers_insert_own');
    expect(ddl).not.toContain('teachers_update_own');
  });

  it('is idempotent (every CREATE POLICY is preceded by a matching DROP POLICY IF EXISTS)', () => {
    const createMatches = [...ddl.matchAll(/CREATE POLICY "([^"]+)"/g)].map((m) => m[1]);
    expect(createMatches.length).toBeGreaterThan(0);
    for (const name of createMatches) {
      expect(ddl).toContain(`DROP POLICY IF EXISTS "${name}"`);
    }
  });
});

describe('pre-existing legitimate read-path policies this fix relies on (baseline + prior migrations, unmodified)', () => {
  const baseline = readFileSync(join(migrationsDir, '00000000000000_baseline_from_prod.sql'), 'utf8');

  it('classes: students can still read their own enrolled classes via class_students join', () => {
    expect(baseline).toContain('CREATE POLICY "Students can view their enrolled classes" ON "public"."classes"');
  });

  it('classes: teachers can still read their own assigned classes via class_teachers join', () => {
    expect(baseline).toContain('CREATE POLICY "Teachers can view their classes" ON "public"."classes"');
  });

  it('classes: school admins can still read classes in their own school', () => {
    expect(baseline).toContain('CREATE POLICY "School admins can view school classes" ON "public"."classes"');
  });

  it('teachers: school admins can still read teachers in their own school', () => {
    expect(baseline).toContain('CREATE POLICY "School admins can view school teachers" ON "public"."teachers"');
  });
});
