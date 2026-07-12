import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const migrationsRoot = resolve(REPO_ROOT, 'supabase', 'migrations');
const additiveMigration = readFileSync(
  resolve(migrationsRoot, '20260711230713_v3_school_admin_students_selected_scope.sql'),
  'utf8',
);
const executableAdditiveSql = additiveMigration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const legacyMigrations = [
  '20260710050000_xc3_school_admin_students_list_rpc.sql',
  '20260710070000_xc3_school_admin_student_toggle_rpc.sql',
  '20260710090000_xc3_school_admin_student_attach_rpc.sql',
  '20260710100000_xc3_school_admin_student_create_preflight_rpc.sql',
  '20260710110000_xc3_school_admin_student_create_class_preflight_rpc.sql',
].map((file) => readFileSync(resolve(migrationsRoot, file), 'utf8')).join('\n');
const ciWorkflow = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const currentSchemaFixture = readFileSync(
  resolve(REPO_ROOT, '.github', 'fixtures', 'selected-school-rpc-current-schema.sql'),
  'utf8',
);

function textBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing source markers: ${startMarker} -> ${endMarker}`);
  }
  return source.slice(start, end);
}

function sqlBetween(startMarker: string, endMarker: string): string {
  const start = additiveMigration.indexOf(startMarker);
  const end = additiveMigration.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing migration markers: ${startMarker} -> ${endMarker}`);
  }
  return additiveMigration.slice(start, end);
}

const scopedToggleSql = sqlBetween(
  'CREATE OR REPLACE FUNCTION public.school_admin_toggle_student_active(',
  'CREATE OR REPLACE FUNCTION public.school_admin_attach_created_student(',
);
const scopedPreflightSql = sqlBetween(
  'CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight(',
  'REVOKE ALL ON FUNCTION public.school_admin_list_students(',
);
const selectedSchoolIntegrationJob = textBetween(
  ciWorkflow,
  '  selected-school-rpc-integration:',
  '\n  quality:',
);
const ciGateJob = textBetween(ciWorkflow, '  ci-gate:', '\n  health-check:');

describe('One Experience V3 selected-school RPC predeploy migration', () => {
  it('applies the additive function DDL and grants in one transaction', () => {
    expect(executableAdditiveSql).toMatch(
      /BEGIN;\s*CREATE OR REPLACE FUNCTION public\.school_admin_has_selected_permission/i,
    );
    expect(executableAdditiveSql.trimEnd()).toMatch(/COMMIT;$/i);
  });

  it('adds all selected-school overloads with fail-closed membership checks', () => {
    for (const signature of [
      'school_admin_list_students(\n  p_school_id uuid',
      'school_admin_toggle_student_active(\n  p_school_id uuid',
      'school_admin_attach_created_student(\n  p_school_id uuid',
      'school_admin_student_create_preflight(\n  p_school_id uuid',
    ]) {
      expect(additiveMigration).toContain(signature);
    }

    expect(additiveMigration.match(/sa\.school_id = p_school_id/g)?.length).toBeGreaterThanOrEqual(4);
    expect(
      additiveMigration.match(
        /school_admin_has_selected_permission\(p_school_id, 'institution\.manage_students'\)/g,
      )?.length,
    ).toBe(4);
    expect(additiveMigration).toContain("to_regprocedure('public.get_user_permissions(uuid,uuid)')");
    expect(additiveMigration).toContain("to_regprocedure('public.get_user_permissions(uuid)')");
    expect(additiveMigration).toContain(
      "sa.role IN ('principal', 'vice_principal', 'academic_coordinator', 'institution_admin')",
    );
    expect(additiveMigration).toContain(
      'REVOKE ALL ON FUNCTION public.school_admin_has_selected_permission(uuid, text) FROM PUBLIC, anon, authenticated, service_role',
    );
  });

  it('grants only the new scoped overloads to authenticated callers', () => {
    for (const signature of [
      'school_admin_list_students(uuid, integer, integer, text, text)',
      'school_admin_toggle_student_active(uuid, uuid, boolean)',
      'school_admin_attach_created_student(uuid, uuid, text, uuid)',
      'school_admin_student_create_preflight(uuid, text, integer, uuid)',
    ]) {
      expect(executableAdditiveSql).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon`,
      );
      expect(executableAdditiveSql).toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`,
      );
    }
  });

  it('takes the shared seat lock before any student row lock, count, or update', () => {
    const advisoryLock = scopedToggleSql.indexOf(
      "hashtextextended('school_seat:' || p_school_id::text, 0)",
    );
    const studentRowLock = scopedToggleSql.indexOf('SELECT s.id, s.is_active');
    const seatCount = scopedToggleSql.indexOf('SELECT COUNT(*) INTO v_active_count');
    const studentUpdate = scopedToggleSql.indexOf('UPDATE public.students');

    expect(advisoryLock).toBeGreaterThan(-1);
    expect(studentRowLock).toBeGreaterThan(advisoryLock);
    expect(scopedToggleSql.slice(studentRowLock, seatCount)).toContain('FOR UPDATE');
    expect(seatCount).toBeGreaterThan(studentRowLock);
    expect(studentUpdate).toBeGreaterThan(seatCount);
    expect(
      scopedToggleSql.match(
        /hashtextextended\('school_seat:' \|\| p_school_id::text, 0\)/g,
      ),
    ).toHaveLength(1);
  });

  it('selects the same deterministic subscription row in toggle and preflight', () => {
    const subscriptionOrder =
      /FROM public\.school_subscriptions ss\s+WHERE ss\.school_id = p_school_id\s+ORDER BY CASE WHEN ss\.status IN \('active', 'trial'\) THEN 0 ELSE 1 END,\s+ss\.created_at DESC NULLS LAST\s+LIMIT 1;/;

    expect(scopedToggleSql).toMatch(subscriptionOrder);
    expect(scopedPreflightSql).toMatch(subscriptionOrder);
  });

  it('does not replace, revoke, grant or comment any legacy signature', () => {
    expect(additiveMigration).toContain('This migration is intentionally additive');
    expect(additiveMigration).toContain('Legacy wrapper hardening is a later migration');

    for (const legacySignature of [
      'school_admin_list_students(integer, integer, text, text)',
      'school_admin_toggle_student_active(uuid, boolean)',
      'school_admin_attach_created_student(uuid, text, uuid)',
      'school_admin_student_create_preflight(text, integer, uuid)',
      'school_admin_student_create_preflight(text, integer)',
    ]) {
      expect(executableAdditiveSql).not.toContain(legacySignature);
      expect(legacyMigrations).toContain(legacySignature);
    }

    expect(executableAdditiveSql).not.toContain('Explicit school scope required');
    expect(executableAdditiveSql).not.toContain('v_school_ids');
  });

  it('applies only the exact selected-school migration to the PG17 fixture', () => {
    const fixtureApply = selectedSchoolIntegrationJob.indexOf(
      'psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$fixture"',
    );
    const migrationApply = selectedSchoolIntegrationJob.indexOf(
      'psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$migration"',
    );

    expect(selectedSchoolIntegrationJob).toContain(
      'name: Selected-School RPC Migration Integration (local PG17)',
    );
    expect(selectedSchoolIntegrationJob).toContain(
      'migration="$GITHUB_WORKSPACE/supabase/migrations/20260711230713_v3_school_admin_students_selected_scope.sql"',
    );
    expect(selectedSchoolIntegrationJob).toContain(
      'fixture="$GITHUB_WORKSPACE/.github/fixtures/selected-school-rpc-current-schema.sql"',
    );
    expect(fixtureApply).toBeGreaterThan(-1);
    expect(migrationApply).toBeGreaterThan(fixtureApply);
    expect(
      selectedSchoolIntegrationJob.match(
        /psql "\$db_url" -X -v ON_ERROR_STOP=1 -f "\$migration"/g,
      ),
    ).toHaveLength(1);
    expect(selectedSchoolIntegrationJob).toContain("SHOW server_version_num");
    expect(selectedSchoolIntegrationJob).toContain('^17[0-9]{4}$');
    expect(selectedSchoolIntegrationJob).not.toContain('supabase db reset');
    expect(selectedSchoolIntegrationJob).not.toContain('00000000000000_baseline_from_prod.sql');
    expect(selectedSchoolIntegrationJob).not.toContain('cp "$source_dir"/*.sql');
  });

  it('keeps the targeted integration local, credential-free, and always cleaned up', () => {
    for (const emptyCredential of [
      "NEXT_PUBLIC_SUPABASE_URL: ''",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY: ''",
      "SUPABASE_SERVICE_ROLE_KEY: ''",
      "SUPABASE_ACCESS_TOKEN: ''",
      "SUPABASE_DB_PASSWORD: ''",
    ]) {
      expect(selectedSchoolIntegrationJob).toContain(emptyCredential);
    }

    expect(selectedSchoolIntegrationJob).toContain(
      '@(127\\.0\\.0\\.1|localhost)',
    );
    expect(selectedSchoolIntegrationJob).toContain(
      "if: ${{ always() && steps.selected_rpc_changes.outputs.changed == 'true' }}",
    );
    expect(selectedSchoolIntegrationJob).not.toContain('supabase link');
    expect(selectedSchoolIntegrationJob).not.toContain('supabase db push');
  });

  it('builds only the current-schema dependencies and legacy RPC contracts', () => {
    expect(currentSchemaFixture).toContain("to_regclass('auth.users')");
    expect(currentSchemaFixture).toContain("to_regprocedure('auth.uid()')");

    for (const table of [
      'schools',
      'school_admins',
      'students',
      'classes',
      'class_students',
      'school_subscriptions',
      'roles',
      'permissions',
      'role_permissions',
      'user_roles',
    ]) {
      expect(currentSchemaFixture).toContain(`CREATE TABLE public.${table} (`);
      expect(currentSchemaFixture).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
      );
    }

    expect(currentSchemaFixture).toContain(
      'CREATE OR REPLACE FUNCTION public.get_user_permissions(',
    );
    expect(currentSchemaFixture).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_user_permissions\(\s+p_user_id uuid\s+\)/,
    );
    expect(currentSchemaFixture).toContain(
      'REVOKE ALL ON FUNCTION public.get_user_permissions(uuid)',
    );
    expect(currentSchemaFixture).not.toContain('get_user_permissions(uuid, uuid)');
    expect(currentSchemaFixture).not.toMatch(
      /get_user_permissions\(\s+p_user_id uuid,\s+p_school_id uuid/,
    );
    for (const legacySignature of [
      'school_admin_list_students(integer, integer, text, text)',
      'school_admin_toggle_student_active(uuid, boolean)',
      'school_admin_attach_created_student(uuid, text, uuid)',
      'school_admin_student_create_preflight(text, integer, uuid)',
      'school_admin_student_create_preflight(text, integer)',
    ]) {
      expect(currentSchemaFixture).toContain(
        `GRANT EXECUTE ON FUNCTION public.${legacySignature}`,
      );
    }
  });

  it('keeps catalog, authorization, isolation, and no-mutation checks required', () => {
    for (const assertion of [
      'Catalog and privilege contract.',
      'selected-school roster leaked or omitted rows',
      'non-member school selection did not fail closed',
      'cross-school toggle mutated the student',
      'cross-school attach created a class membership',
      'membership without permission did not fail closed',
    ]) {
      expect(selectedSchoolIntegrationJob).toContain(assertion);
    }

    expect(ciGateJob).toContain('- selected-school-rpc-integration');
    expect(ciGateJob).toContain("'selected-school-rpc-integration'");
    expect(ciGateJob).not.toContain('migration-reproducibility');
  });
});
