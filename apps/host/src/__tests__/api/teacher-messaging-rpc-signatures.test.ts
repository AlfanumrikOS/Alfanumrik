/**
 * Static pin — teacher messaging SECURITY DEFINER RPC signatures.
 *
 * The teacher↔parent messaging routes (P2-7b) dropped the RLS-bypassing
 * service-role client and now call three SECURITY DEFINER RPCs defined in
 * migration 20260803130000_teacher_messaging_rpcs.sql. If a signature drifts
 * (param name/type/order, the auth boundary, the roster gate, an error_code,
 * or the authenticated-only grant), the in-memory contract mock in
 * teacher-parent-messaging.test.ts would silently diverge from the real RPC.
 * This file pins the migration text so that divergence fails loudly at the
 * source. Pure file read — no DB, no shared state.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const migration = readFileSync(
  resolve(REPO_ROOT, 'supabase', 'migrations', '20260803130000_teacher_messaging_rpcs.sql'),
  'utf8',
);

/** Slice a function body from its CREATE header to the terminating `$$;`. */
function functionBody(header: string): string {
  const start = migration.indexOf(header);
  expect(start, `missing function header: ${header}`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$$;', start);
  expect(end, `unterminated function body for: ${header}`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('teacher messaging RPC signatures (migration 20260803130000)', () => {
  it('teacher_send_parent_message declares the routed params in order', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.teacher_send_parent_message(');
    expect(body).toMatch(/p_thread_id uuid DEFAULT NULL/);
    expect(body).toMatch(/p_guardian_id uuid DEFAULT NULL/);
    expect(body).toMatch(/p_student_id uuid DEFAULT NULL/);
    expect(body).toMatch(/p_body text DEFAULT NULL/);
    expect(body).toMatch(/p_subject text DEFAULT NULL/);
    // The order the route passes them (route: p_thread_id, p_guardian_id,
    // p_student_id, p_body, p_subject).
    const order = ['p_thread_id', 'p_guardian_id', 'p_student_id', 'p_body', 'p_subject'].map(
      (p) => body.indexOf(p),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('teacher_list_message_threads takes p_limit integer', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.teacher_list_message_threads(');
    expect(body).toMatch(/p_limit integer DEFAULT 50/);
  });

  it('teacher_list_thread_messages takes p_thread_id, p_cursor, p_limit', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.teacher_list_thread_messages(');
    expect(body).toMatch(/p_thread_id uuid/);
    expect(body).toMatch(/p_cursor timestamptz DEFAULT NULL/);
    expect(body).toMatch(/p_limit integer DEFAULT 100/);
  });

  it('every RPC is SECURITY DEFINER with a pinned search_path', () => {
    for (const header of [
      'CREATE OR REPLACE FUNCTION public.teacher_send_parent_message(',
      'CREATE OR REPLACE FUNCTION public.teacher_list_message_threads(',
      'CREATE OR REPLACE FUNCTION public.teacher_list_thread_messages(',
    ]) {
      const body = functionBody(header);
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path = public/);
    }
  });

  it('the send RPC anchors the auth boundary on auth.uid()→teachers.id and gates NEW threads on the active roster join', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.teacher_send_parent_message(');
    // Session identity is resolved from auth.uid(), never a request-supplied id.
    expect(body).toMatch(/FROM public\.teachers t\s+WHERE t\.auth_user_id = v_auth_user_id/);
    // NEW-thread legitimacy join = active class_teachers ⋈ class_enrollments.
    expect(body).toMatch(/FROM public\.class_teachers ct/);
    expect(body).toMatch(/JOIN public\.class_enrollments ce ON ce\.class_id = ct\.class_id/);
    expect(body).toMatch(/ct\.is_active = true/);
    expect(body).toMatch(/ce\.is_active = true/);
  });

  it('the RPCs return the error_codes the routes map to HTTP statuses', () => {
    // Send route: not_teacher/thread_not_owned/not_authorized_for_student → 403;
    // thread_not_found/not_linked → 404; invalid_input → 400.
    for (const code of [
      'not_teacher',
      'thread_not_owned',
      'thread_not_found',
      'not_linked',
      'not_authorized_for_student',
      'invalid_input',
    ]) {
      expect(migration, `expected error_code '${code}' in migration`).toContain(`'${code}'`);
    }
  });

  it('grants EXECUTE only to authenticated (never anon/public)', () => {
    for (const sig of [
      'public.teacher_send_parent_message(uuid, uuid, uuid, text, text)',
      'public.teacher_list_message_threads(integer)',
      'public.teacher_list_thread_messages(uuid, timestamptz, integer)',
    ]) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
    }
  });
});
