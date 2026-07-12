import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const routePath = path.join(repoRoot, 'apps/host/src/app/api/school-admin/students/route.ts');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710050000_xc3_school_admin_students_list_rpc.sql',
);
const toggleMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710070000_xc3_school_admin_student_toggle_rpc.sql',
);
const attachMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710090000_xc3_school_admin_student_attach_rpc.sql',
);
const preflightMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710100000_xc3_school_admin_student_create_preflight_rpc.sql',
);
const classPreflightMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710110000_xc3_school_admin_student_create_class_preflight_rpc.sql',
);
const selectedScopeMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260711230713_v3_school_admin_students_selected_scope.sql',
);

describe('XC-3 school-admin students roster read migration', () => {
  it('does not import the broad service-role DB client directly in the route', () => {
    const source = readFileSync(routePath, 'utf8');

    expect(source).toContain("from '@alfanumrik/lib/school-admin/student-auth-admin'");
    expect(source).not.toContain("from '@alfanumrik/lib/supabase-admin'");
    expect(source).not.toContain('getSupabaseAdmin()');
    expect(source).not.toContain('ReturnType<typeof getSupabaseAdmin>');
  });

  it('routes GET roster reads through a request-scoped authenticated RPC', () => {
    const source = readFileSync(routePath, 'utf8');
    const getBody = source.slice(
      source.indexOf('export async function GET'),
      source.indexOf('export async function PATCH'),
    );

    expect(getBody).toContain('createRlsScopedClient(request)');
    expect(getBody).toContain("rpc('school_admin_list_students'");
    expect(getBody).toContain('p_school_id: schoolId');
    expect(getBody).not.toContain(".from('students')");
  });

  it('routes PATCH active toggles through a request-scoped authenticated RPC', () => {
    const source = readFileSync(routePath, 'utf8');
    const patchBody = source.slice(
      source.indexOf('export async function PATCH'),
      source.indexOf('// ─── Helpers'),
    );

    expect(patchBody).toContain('createRlsScopedClient(request)');
    expect(patchBody).toContain('.rpc(');
    expect(patchBody).toContain("'school_admin_toggle_student_active'");
    expect(patchBody).toContain('p_school_id: schoolId');
    expect(patchBody).not.toContain(".from('students')");
    expect(patchBody).not.toContain(".from('school_subscriptions')");
  });

  it('defines a SECURITY DEFINER helper bound to auth.uid() school-admin membership', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.school_admin_list_students');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('school_admins');
    expect(sql).toContain('schools');
    expect(sql).toContain('students');
    expect(sql).toContain('LIMIT v_limit');
    expect(sql).toContain('OFFSET v_offset');
    expect(sql).toContain('jsonb_build_object');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.school_admin_list_students');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.school_admin_list_students');
    expect(sql).toContain('TO authenticated');
  });

  it('defines a SECURITY DEFINER active-toggle helper with seat-cap enforcement', () => {
    const sql = readFileSync(toggleMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.school_admin_toggle_student_active');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('school_admins');
    expect(sql).toContain('school_subscriptions');
    expect(sql).toContain('seats_purchased');
    expect(sql).toContain('seat_cap_violation');
    expect(sql).toContain('UPDATE public.students');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.school_admin_toggle_student_active');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.school_admin_toggle_student_active');
    expect(sql).toContain('TO authenticated');
  });

  it('routes post-auth student school/class attachment through a request-scoped RPC', () => {
    const source = readFileSync(routePath, 'utf8');
    const createOneStudentBody = source.slice(
      source.indexOf('async function createOneStudent'),
      source.indexOf('/**\n * Parse a CSV body'),
    );

    expect(createOneStudentBody).toContain("rpc('school_admin_attach_created_student'");
    expect(createOneStudentBody).toContain('p_school_id: schoolId');
    expect(createOneStudentBody).not.toContain(".from('class_students').insert");
    expect(createOneStudentBody).not.toContain('.update(updates)');
  });

  it('routes POST duplicate and legacy seat preflight checks through a request-scoped RPC', () => {
    const source = readFileSync(routePath, 'utf8');
    const postBody = source.slice(source.indexOf('export async function POST'));

    expect(postBody).toContain("rpc('school_admin_student_create_preflight'");
    expect(postBody).toContain('p_school_id: schoolId');
    expect(postBody).toContain('p_class_id: classId');
    expect(postBody).not.toContain('readSeatStatus(');
    expect(postBody).not.toContain(".from('school_subscriptions')");
    expect(postBody).not.toContain(".select('id', { count: 'exact', head: true })");
  });

  it('adds selected-school overloads without replacing legacy RPC signatures', () => {
    const sql = readFileSync(selectedScopeMigrationPath, 'utf8');
    const executableSql = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    for (const signature of [
      'school_admin_list_students(\n  p_school_id uuid',
      'school_admin_toggle_student_active(\n  p_school_id uuid',
      'school_admin_attach_created_student(\n  p_school_id uuid',
      'school_admin_student_create_preflight(\n  p_school_id uuid',
    ]) {
      expect(sql).toContain(signature);
    }
    expect(sql.match(/sa\.school_id = p_school_id/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql.match(/school_admin_has_selected_permission\(p_school_id, 'institution\.manage_students'\)/g)?.length).toBe(4);
    expect(sql).toContain("to_regprocedure('public.get_user_permissions(uuid,uuid)')");
    expect(sql).toContain("to_regprocedure('public.get_user_permissions(uuid)')");
    expect(sql).toContain("sa.role IN ('principal', 'vice_principal', 'academic_coordinator', 'institution_admin')");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.school_admin_has_selected_permission(uuid, text) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('school_admin_list_students(uuid, integer, integer, text, text)');
    expect(sql).toContain('school_admin_toggle_student_active(uuid, uuid, boolean)');
    expect(sql).toContain('school_admin_attach_created_student(uuid, uuid, text, uuid)');
    expect(sql).toContain('school_admin_student_create_preflight(uuid, text, integer, uuid)');
    expect(sql).toContain('This migration is intentionally additive');
    expect(sql).toContain('Legacy wrapper hardening is a later migration');

    for (const legacySignature of [
      'school_admin_list_students(integer, integer, text, text)',
      'school_admin_toggle_student_active(uuid, boolean)',
      'school_admin_attach_created_student(uuid, text, uuid)',
      'school_admin_student_create_preflight(text, integer, uuid)',
      'school_admin_student_create_preflight(text, integer)',
    ]) {
      expect(executableSql).not.toContain(legacySignature);
    }
    expect(executableSql).not.toContain('Explicit school scope required');
    expect(executableSql).not.toContain('v_school_ids');
  });

  it('does not perform route-level service-role class ownership prechecks during single create', () => {
    const source = readFileSync(routePath, 'utf8');
    const handleSingleBody = source.slice(
      source.indexOf('async function handleSingle'),
      source.indexOf('async function handleBulkJson'),
    );

    expect(handleSingleBody).not.toContain(".from('classes')");
    expect(handleSingleBody).not.toContain(".select('id, school_id')");
    expect(handleSingleBody).not.toContain('cls.school_id !== schoolId');
  });

  it('defines a SECURITY DEFINER attach helper bound to auth.uid() school-admin membership', () => {
    const sql = readFileSync(attachMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.school_admin_attach_created_student');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('school_admins');
    expect(sql).toContain('UPDATE public.students');
    expect(sql).toContain('auth_user_id = p_student_auth_user_id');
    expect(sql).toContain('public.class_students');
    expect(sql).toContain('p_class_id');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.school_admin_attach_created_student');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.school_admin_attach_created_student');
    expect(sql).toContain('TO authenticated');
  });

  it('defines a SECURITY DEFINER create preflight helper for email dedupe and legacy seat checks', () => {
    const sql = readFileSync(preflightMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('school_admins');
    expect(sql).toContain('students');
    expect(sql).toContain('school_subscriptions');
    expect(sql).toContain('seats_purchased');
    expect(sql).toContain('emailExists');
    expect(sql).toContain('seatCapViolation');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight');
    expect(sql).toContain('TO authenticated');
  });

  it('defines a follow-up create preflight helper that rejects cross-school class_id before Auth Admin create', () => {
    const sql = readFileSync(classPreflightMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight');
    expect(sql).toContain('p_class_id uuid DEFAULT NULL');
    expect(sql).toContain('public.classes');
    expect(sql).toContain('v_class_school_id IS DISTINCT FROM v_school_id');
    expect(sql).toContain('class_id does not belong to your school');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid)');
    expect(sql).toContain('TO authenticated');
  });
});
