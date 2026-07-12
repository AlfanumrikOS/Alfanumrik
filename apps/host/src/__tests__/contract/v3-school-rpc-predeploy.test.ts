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
      'REVOKE ALL ON FUNCTION public.school_admin_has_selected_permission(uuid, text) FROM PUBLIC, anon, authenticated',
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
});
