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
    expect(createOneStudentBody).not.toContain(".from('class_students').insert");
    expect(createOneStudentBody).not.toContain('.update(updates)');
  });

  it('routes POST duplicate and legacy seat preflight checks through a request-scoped RPC', () => {
    const source = readFileSync(routePath, 'utf8');
    const postBody = source.slice(source.indexOf('export async function POST'));

    expect(postBody).toContain("rpc('school_admin_student_create_preflight'");
    expect(postBody).toContain('p_class_id: classId');
    expect(postBody).not.toContain('readSeatStatus(');
    expect(postBody).not.toContain(".from('school_subscriptions')");
    expect(postBody).not.toContain(".select('id', { count: 'exact', head: true })");
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
