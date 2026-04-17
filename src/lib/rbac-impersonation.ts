/**
 * ALFANUMRIK RBAC — Impersonation Session Manager
 *
 * Manages admin view-as-user sessions with strict time and action limits.
 * All impersonation sessions are read-only by default and capped at 50 actions.
 *
 * Usage:
 *   import { startImpersonation, validateImpersonation, endImpersonation } from '@/lib/rbac-impersonation';
 *
 *   const session = await startImpersonation({
 *     adminUserId: 'admin-uuid',
 *     targetUserId: 'student-uuid',
 *     reason: 'Investigating reported display issue',
 *     durationMinutes: 15,
 *   });
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Types ──────────────────────────────────────────────────

export interface ImpersonationInput {
  adminUserId: string;
  targetUserId: string;
  schoolId?: string | null;
  reason: string;
  durationMinutes?: number;
  permissions?: string[];
}

export interface ImpersonationStartResult {
  success: boolean;
  sessionId?: string;
  expiresAt?: string;
  error?: string;
}

export interface ImpersonationValidation {
  valid: boolean;
  readOnly: boolean;
  adminUserId?: string;
  targetUserId?: string;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 60;
const MAX_ACTION_COUNT = 50;

// ─── Start Impersonation ────────────────────────────────────

/**
 * Start an impersonation session for an admin to view as a target user.
 *
 * Validates:
 * - Reason is non-empty
 * - Duration is between 1-60 minutes
 * - Admin and target are different users
 *
 * Side effects:
 * - Inserts into impersonation_sessions
 * - Writes audit event (fire-and-forget)
 */
export async function startImpersonation(
  input: ImpersonationInput,
): Promise<ImpersonationStartResult> {
  // Validate reason
  if (!input.reason || input.reason.trim().length === 0) {
    return { success: false, error: 'Reason is required for impersonation' };
  }

  // Validate admin != target
  if (input.adminUserId === input.targetUserId) {
    return { success: false, error: 'Cannot impersonate yourself' };
  }

  // Validate duration
  const duration = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  if (duration < 1 || duration > MAX_DURATION_MINUTES) {
    return {
      success: false,
      error: `Duration must be between 1 and ${MAX_DURATION_MINUTES} minutes`,
    };
  }

  try {
    const supabase = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
    const permissions = input.permissions ?? ['read'];

    const { data, error } = await supabase
      .from('impersonation_sessions')
      .insert({
        admin_user_id: input.adminUserId,
        target_user_id: input.targetUserId,
        school_id: input.schoolId ?? null,
        reason: input.reason.trim(),
        permissions_granted: permissions,
        expires_at: expiresAt,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) {
      logger.error('rbac_impersonation_start_failed', {
        error: new Error(error.message),
        route: 'rbac-impersonation',
      });
      return { success: false, error: error.message };
    }

    // Fire-and-forget audit event
    try {
      const { writeAuditEvent } = await import('@/lib/audit-pipeline');
      await writeAuditEvent({
        eventType: 'impersonation_start',
        actorUserId: input.adminUserId,
        effectiveUserId: input.targetUserId,
        schoolId: input.schoolId ?? null,
        action: 'impersonate',
        result: 'granted',
        resourceType: 'impersonation_session',
        resourceId: data.id,
        metadata: {
          reason: input.reason.trim(),
          durationMinutes: duration,
          permissions,
        },
      });
    } catch {
      // Audit write failed — not critical
    }

    return { success: true, sessionId: data.id, expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_impersonation_start_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-impersonation',
    });
    return { success: false, error: message };
  }
}

// ─── Validate Impersonation ─────────────────────────────────

/**
 * Validate an active impersonation session and increment its action count.
 *
 * Checks:
 * - Session exists and is active
 * - Session has not expired
 * - Action count is under the limit (50)
 *
 * Returns readOnly: true always (impersonation is view-only).
 */
export async function validateImpersonation(
  sessionId: string,
): Promise<ImpersonationValidation> {
  try {
    const supabase = getSupabaseAdmin();

    const { data: session, error: fetchError } = await supabase
      .from('impersonation_sessions')
      .select('id, admin_user_id, target_user_id, expires_at, action_count, status')
      .eq('id', sessionId)
      .single();

    if (fetchError || !session) {
      return { valid: false, readOnly: true, error: 'Session not found' };
    }

    // Check status
    if (session.status !== 'active') {
      return { valid: false, readOnly: true, error: `Session is ${session.status}` };
    }

    // Check expiry
    if (new Date(session.expires_at) <= new Date()) {
      // Auto-expire the session
      await supabase
        .from('impersonation_sessions')
        .update({
          status: 'expired',
          ended_at: new Date().toISOString(),
          ended_reason: 'expired',
        })
        .eq('id', sessionId);

      return { valid: false, readOnly: true, error: 'Session has expired' };
    }

    // Check action count
    if (session.action_count >= MAX_ACTION_COUNT) {
      // Auto-terminate due to action limit
      await supabase
        .from('impersonation_sessions')
        .update({
          status: 'terminated',
          ended_at: new Date().toISOString(),
          ended_reason: 'anomaly_auto_terminate',
        })
        .eq('id', sessionId);

      return { valid: false, readOnly: true, error: 'Action limit exceeded' };
    }

    // Increment action count
    await supabase
      .from('impersonation_sessions')
      .update({ action_count: session.action_count + 1 })
      .eq('id', sessionId);

    return {
      valid: true,
      readOnly: true,
      adminUserId: session.admin_user_id,
      targetUserId: session.target_user_id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_impersonation_validate_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-impersonation',
    });
    return { valid: false, readOnly: true, error: message };
  }
}

// ─── End Impersonation ──────────────────────────────────────

/**
 * End an active impersonation session manually.
 *
 * Side effects:
 * - Updates session status to 'ended'
 * - Writes audit event (fire-and-forget)
 */
export async function endImpersonation(
  sessionId: string,
  reason: 'manual' | 'expired' | 'anomaly_auto_terminate' = 'manual',
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch session to verify it exists and is active
    const { data: session, error: fetchError } = await supabase
      .from('impersonation_sessions')
      .select('id, admin_user_id, target_user_id, status, action_count')
      .eq('id', sessionId)
      .single();

    if (fetchError || !session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.status !== 'active') {
      return { success: false, error: `Session is already ${session.status}` };
    }

    // End the session
    const { error: updateError } = await supabase
      .from('impersonation_sessions')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        ended_reason: reason,
      })
      .eq('id', sessionId)
      .eq('status', 'active');

    if (updateError) {
      logger.error('rbac_impersonation_end_failed', {
        error: new Error(updateError.message),
        route: 'rbac-impersonation',
      });
      return { success: false, error: updateError.message };
    }

    // Fire-and-forget audit event
    try {
      const { writeAuditEvent } = await import('@/lib/audit-pipeline');
      await writeAuditEvent({
        eventType: 'impersonation_end',
        actorUserId: session.admin_user_id,
        effectiveUserId: session.target_user_id,
        action: 'revoke',
        result: 'granted',
        resourceType: 'impersonation_session',
        resourceId: sessionId,
        metadata: {
          reason,
          actionCount: session.action_count,
        },
      });
    } catch {
      // Audit write failed — not critical
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_impersonation_end_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-impersonation',
    });
    return { success: false, error: message };
  }
}
