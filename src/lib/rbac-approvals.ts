/**
 * ALFANUMRIK -- Approval Workflow Manager
 *
 * Manages the lifecycle of delegation approval requests:
 *   - Create pending approval requests (with 72h expiry)
 *   - Approve / reject requests with audit trail
 *   - List pending approvals for a school
 *
 * Writes audit events via the tamper-evident audit pipeline.
 *
 * Usage:
 *   import { requestApproval, approveRequest, rejectRequest, listPendingApprovals } from '@/lib/rbac-approvals';
 *
 *   const { success, approvalId } = await requestApproval({
 *     schoolId, requestedBy: userId, action: 'assign_role',
 *     targetUserId, targetRoleId, payload: { reason: '...' },
 *   });
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { writeAuditEvent } from '@/lib/audit-pipeline';

// ─── Types ───────────────────────────────────────────────────

export interface ApprovalRequestInput {
  schoolId: string;
  requestedBy: string;
  action: string;
  targetUserId?: string;
  targetRoleId?: string;
  payload?: Record<string, unknown>;
}

export interface ApprovalRow {
  id: string;
  school_id: string;
  requested_by: string;
  action: string;
  target_user_id: string | null;
  target_role_id: string | null;
  payload: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  expires_at: string;
  created_at: string;
}

export interface ApprovalResult {
  success: boolean;
  approvalId?: string;
  approval?: ApprovalRow;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────

const APPROVAL_EXPIRY_HOURS = 72;

// ─── Request Approval ────────────────────────────────────────

/**
 * Create a new pending approval request.
 * Expires after 72 hours. Writes an audit event.
 */
export async function requestApproval(
  input: ApprovalRequestInput,
): Promise<ApprovalResult> {
  try {
    const supabase = getSupabaseAdmin();
    const expiresAt = new Date(
      Date.now() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await supabase
      .from('delegation_approvals')
      .insert({
        school_id: input.schoolId,
        requested_by: input.requestedBy,
        action: input.action,
        target_user_id: input.targetUserId ?? null,
        target_role_id: input.targetRoleId ?? null,
        payload: input.payload ?? null,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      logger.error('rbac_approval_request_failed', {
        error: new Error(error.message),
        route: 'rbac-approvals',
      });
      return { success: false, error: error.message };
    }

    // Fire-and-forget audit event
    await writeAuditEvent({
      eventType: 'delegation_grant',
      actorUserId: input.requestedBy,
      action: 'write',
      result: 'granted',
      resourceType: 'delegation_approval',
      resourceId: data.id,
      schoolId: input.schoolId,
      metadata: {
        approvalAction: input.action,
        targetUserId: input.targetUserId ?? null,
        targetRoleId: input.targetRoleId ?? null,
      },
    });

    return { success: true, approvalId: data.id };
  } catch (err) {
    logger.error('rbac_approval_request_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'rbac-approvals',
    });
    return { success: false, error: 'Failed to create approval request' };
  }
}

// ─── Approve Request ─────────────────────────────────────────

/**
 * Approve a pending approval request.
 * Verifies the request is still pending and not expired.
 */
export async function approveRequest(
  approvalId: string,
  decidedBy: string,
  reason?: string,
): Promise<ApprovalResult> {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch the approval row
    const { data: approval, error: fetchError } = await supabase
      .from('delegation_approvals')
      .select('*')
      .eq('id', approvalId)
      .single();

    if (fetchError || !approval) {
      return { success: false, error: 'Approval request not found' };
    }

    if (approval.status !== 'pending') {
      return { success: false, error: `Approval is already ${approval.status}` };
    }

    if (new Date(approval.expires_at) < new Date()) {
      return { success: false, error: 'Approval request has expired' };
    }

    // Update to approved
    const decidedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('delegation_approvals')
      .update({
        status: 'approved',
        decided_by: decidedBy,
        decided_at: decidedAt,
        decision_reason: reason ?? null,
      })
      .eq('id', approvalId)
      .select()
      .single();

    if (updateError) {
      logger.error('rbac_approval_approve_failed', {
        error: new Error(updateError.message),
        route: 'rbac-approvals',
      });
      return { success: false, error: updateError.message };
    }

    // Audit event
    await writeAuditEvent({
      eventType: 'delegation_grant',
      actorUserId: decidedBy,
      action: 'grant',
      result: 'granted',
      resourceType: 'delegation_approval',
      resourceId: approvalId,
      schoolId: approval.school_id,
      metadata: {
        decision: 'approved',
        originalRequestedBy: approval.requested_by,
        reason: reason ?? null,
      },
    });

    return { success: true, approval: updated as ApprovalRow };
  } catch (err) {
    logger.error('rbac_approval_approve_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'rbac-approvals',
    });
    return { success: false, error: 'Failed to approve request' };
  }
}

// ─── Reject Request ──────────────────────────────────────────

/**
 * Reject a pending approval request. Reason is required for rejections.
 */
export async function rejectRequest(
  approvalId: string,
  decidedBy: string,
  reason: string,
): Promise<ApprovalResult> {
  if (!reason || reason.trim().length === 0) {
    return { success: false, error: 'Reason is required for rejections' };
  }

  try {
    const supabase = getSupabaseAdmin();

    // Fetch the approval row
    const { data: approval, error: fetchError } = await supabase
      .from('delegation_approvals')
      .select('*')
      .eq('id', approvalId)
      .single();

    if (fetchError || !approval) {
      return { success: false, error: 'Approval request not found' };
    }

    if (approval.status !== 'pending') {
      return { success: false, error: `Approval is already ${approval.status}` };
    }

    // Update to rejected
    const decidedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('delegation_approvals')
      .update({
        status: 'rejected',
        decided_by: decidedBy,
        decided_at: decidedAt,
        decision_reason: reason,
      })
      .eq('id', approvalId)
      .select()
      .single();

    if (updateError) {
      logger.error('rbac_approval_reject_failed', {
        error: new Error(updateError.message),
        route: 'rbac-approvals',
      });
      return { success: false, error: updateError.message };
    }

    // Audit event
    await writeAuditEvent({
      eventType: 'delegation_revoke',
      actorUserId: decidedBy,
      action: 'revoke',
      result: 'denied',
      resourceType: 'delegation_approval',
      resourceId: approvalId,
      schoolId: approval.school_id,
      metadata: {
        decision: 'rejected',
        originalRequestedBy: approval.requested_by,
        reason,
      },
    });

    return { success: true, approval: updated as ApprovalRow };
  } catch (err) {
    logger.error('rbac_approval_reject_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'rbac-approvals',
    });
    return { success: false, error: 'Failed to reject request' };
  }
}

// ─── List Pending Approvals ──────────────────────────────────

/**
 * List all non-expired pending approvals for a school.
 */
export async function listPendingApprovals(
  schoolId: string,
): Promise<{ success: boolean; approvals: ApprovalRow[]; error?: string }> {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('delegation_approvals')
      .select('*')
      .eq('school_id', schoolId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('rbac_approval_list_failed', {
        error: new Error(error.message),
        route: 'rbac-approvals',
      });
      return { success: false, approvals: [], error: error.message };
    }

    return { success: true, approvals: (data ?? []) as ApprovalRow[] };
  } catch (err) {
    logger.error('rbac_approval_list_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'rbac-approvals',
    });
    return { success: false, approvals: [], error: 'Failed to list approvals' };
  }
}
