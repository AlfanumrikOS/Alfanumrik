import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

type DualWriteAction = 'create' | 'update';

export type DualWriteInput = {
  auth_user_id: string;
  role: string;
  name: string;
  email: string;
  grade?: string;
  board?: string;
  school_name?: string;
  subjects_taught?: string[];
  grades_taught?: string[];
  phone?: string | null;
  link_code?: string | null;
};

export type DualWriteResult = {
  success: boolean;
  monolithResult: any;
  shadowResult: any | null;
  consistency_checked: boolean;
  consistent: boolean | null;
  errors: Array<{ system: 'monolith' | 'shadow'; message: string }>;
};

/**
 * Dual-write shim for Phase-2 migration.
 *
 * Today, the identity Edge Function is read-heavy (profile/sessions/permissions),
 * while bootstrap is still monolith-owned. This helper preserves the call shape
 * expected by `src/app/api/auth/bootstrap/route.ts` and keeps behavior safe:
 * it always writes via monolith RPC and reports shadow as not-yet-implemented.
 */
export async function dualWriteUserProfile(
  action: DualWriteAction,
  input: DualWriteInput
): Promise<DualWriteResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return {
      success: false,
      monolithResult: null,
      shadowResult: null,
      consistency_checked: false,
      consistent: null,
      errors: [{ system: 'monolith', message: 'Supabase env not configured' }],
    };
  }

  if (action !== 'create') {
    return {
      success: false,
      monolithResult: null,
      shadowResult: null,
      consistency_checked: false,
      consistent: null,
      errors: [{ system: 'monolith', message: `Unsupported action: ${action}` }],
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('bootstrap_user_profile', {
    p_auth_user_id: input.auth_user_id,
    p_role: input.role,
    p_name: input.name,
    p_email: input.email,
    p_grade: input.role === 'student' ? (input.grade ?? null) : null,
    p_board: input.role === 'student' ? (input.board ?? 'CBSE') : null,
    p_school_name: input.role === 'teacher' ? (input.school_name ?? '') : null,
    p_subjects_taught: input.role === 'teacher' ? (input.subjects_taught ?? []) : null,
    p_grades_taught: input.role === 'teacher' ? (input.grades_taught ?? []) : null,
    p_phone: input.role === 'parent' ? (input.phone ?? null) : null,
    p_link_code: input.role === 'parent' ? (input.link_code ?? null) : null,
  });

  if (error) {
    logger.error('identity_dual_write_monolith_rpc_failed', {
      error: new Error(error.message),
      authUserId: input.auth_user_id,
      role: input.role,
    });
    return {
      success: false,
      monolithResult: null,
      shadowResult: null,
      consistency_checked: false,
      consistent: null,
      errors: [{ system: 'monolith', message: error.message }],
    };
  }

  return {
    success: true,
    monolithResult: data,
    shadowResult: null,
    consistency_checked: false,
    consistent: null,
    errors: [],
  };
}

