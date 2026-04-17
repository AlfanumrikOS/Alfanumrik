import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { supabaseAdminHeaders, supabaseAdminUrl } from '@/lib/admin-auth';
import { validateDelegation } from '@/lib/rbac-authority';
import { requestApproval, approveRequest, rejectRequest } from '@/lib/rbac-approvals';
import { grantElevation, revokeElevation } from '@/lib/rbac-elevation';
import { createDelegationToken, revokeDelegationToken } from '@/lib/rbac-delegation';
import { logAudit } from '@/lib/rbac';

// ─── GET Handler ────────────────────────────────────────────
// All queries are scoped to the school admin's school_id.

export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage');
  if (!auth.authorized) return auth.errorResponse;
  if (!auth.schoolId || !auth.userId) {
    return NextResponse.json({ error: 'Missing school context' }, { status: 400 });
  }
  const schoolId: string = auth.schoolId;
  const userId: string = auth.userId;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'dashboard_stats';

  try {
    // ── Elevations ──────────────────────────────────────────
    if (action === 'elevations') {
      let q = `select=*&order=created_at.desc&limit=50&school_id=eq.${encodeURIComponent(schoolId)}`;
      const status = params.get('status');
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;

      const res = await fetch(supabaseAdminUrl('role_elevations', q), {
        headers: supabaseAdminHeaders(),
      });
      const data = res.ok ? await res.json() : [];
      return NextResponse.json({ success: true, data });
    }

    // ── Delegations ─────────────────────────────────────────
    if (action === 'delegations') {
      // Exclude token_hash from the response — security requirement
      let q = `select=id,granter_user_id,grantee_user_id,school_id,permissions,status,use_count,max_uses,expires_at,created_at&order=created_at.desc&limit=50&school_id=eq.${encodeURIComponent(schoolId)}`;
      const status = params.get('status');
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;

      const res = await fetch(supabaseAdminUrl('delegation_tokens', q), {
        headers: supabaseAdminHeaders(),
      });
      const data = res.ok ? await res.json() : [];
      return NextResponse.json({ success: true, data });
    }

    // ── Approvals ───────────────────────────────────────────
    if (action === 'approvals') {
      let q = `select=*&order=created_at.desc&limit=50&school_id=eq.${encodeURIComponent(schoolId)}`;
      const status = params.get('status');
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;

      const res = await fetch(supabaseAdminUrl('delegation_approvals', q), {
        headers: supabaseAdminHeaders(),
      });
      const data = res.ok ? await res.json() : [];
      return NextResponse.json({ success: true, data });
    }

    // ── Dashboard Stats ─────────────────────────────────────
    if (action === 'dashboard_stats') {
      const schoolFilter = `school_id=eq.${encodeURIComponent(schoolId)}`;

      const [elevRes, delRes, approvalRes] = await Promise.all([
        fetch(supabaseAdminUrl('role_elevations', `select=id&status=eq.active&${schoolFilter}`), {
          headers: supabaseAdminHeaders('count=exact'),
        }),
        fetch(supabaseAdminUrl('delegation_tokens', `select=id&status=eq.active&${schoolFilter}`), {
          headers: supabaseAdminHeaders('count=exact'),
        }),
        fetch(supabaseAdminUrl('delegation_approvals', `select=id&status=eq.pending&${schoolFilter}`), {
          headers: supabaseAdminHeaders('count=exact'),
        }),
      ]);

      const parseCount = (res: Response): number => {
        const range = res.headers.get('content-range');
        if (range) {
          const total = range.split('/')[1];
          return total ? parseInt(total, 10) || 0 : 0;
        }
        return 0;
      };

      return NextResponse.json({
        success: true,
        data: {
          activeElevations: parseCount(elevRes),
          activeDelegationTokens: parseCount(delRes),
          pendingApprovals: parseCount(approvalRes),
        },
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ─── POST Handler ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage');
  if (!auth.authorized) return auth.errorResponse;
  if (!auth.schoolId || !auth.userId) {
    return NextResponse.json({ error: 'Missing school context' }, { status: 400 });
  }
  const schoolId: string = auth.schoolId;
  const userId: string = auth.userId;

  try {
    const body = await request.json();
    const { action } = body;

    // ── Grant Elevation ───────────────────────────────────────
    if (action === 'grant_elevation') {
      const { userId, elevatedRoleId, reason, durationHours } = body;
      if (!userId || !elevatedRoleId || !reason || !durationHours) {
        return NextResponse.json(
          { success: false, error: 'userId, elevatedRoleId, reason, and durationHours are required' },
          { status: 400 },
        );
      }

      // Validate delegation authority
      const validation = await validateDelegation({
        granterId: userId,
        action: 'elevate',
        schoolId: schoolId,
        targetRoleId: elevatedRoleId,
        durationHours,
        reason,
      });

      if (!validation.allowed) {
        return NextResponse.json(
          { success: false, error: 'Not authorized for this elevation', violations: validation.violations },
          { status: 403 },
        );
      }

      // If approval is required, create an approval request instead
      if (validation.requiresApproval) {
        const approvalResult = await requestApproval({
          schoolId: schoolId,
          requestedBy: userId,
          action: 'elevate',
          targetUserId: userId,
          targetRoleId: elevatedRoleId,
          payload: { reason, durationHours },
        });

        if (!approvalResult.success) {
          return NextResponse.json(
            { success: false, error: approvalResult.error || 'Failed to create approval request' },
            { status: 500 },
          );
        }

        return NextResponse.json(
          { success: true, requiresApproval: true, approvalId: approvalResult.approvalId },
          { status: 202 },
        );
      }

      // Grant elevation directly
      const result = await grantElevation({
        userId,
        elevatedRoleId,
        grantedBy: userId,
        reason,
        durationHours,
        schoolId: schoolId,
      });

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      await logAudit(userId, {
        action: 'grant_elevation',
        resourceType: 'role_elevation',
        resourceId: result.elevationId || '',
        details: { userId, roleId: elevatedRoleId, schoolId: schoolId },
        status: 'success',
      });

      return NextResponse.json({ success: true, elevationId: result.elevationId }, { status: 201 });
    }

    // ── Create Delegation ─────────────────────────────────────
    if (action === 'create_delegation') {
      const { permissions, expiresInDays, granteeUserId, maxUses, resourceScope } = body;
      if (!permissions || !Array.isArray(permissions) || permissions.length === 0 || !expiresInDays) {
        return NextResponse.json(
          { success: false, error: 'permissions (non-empty array) and expiresInDays are required' },
          { status: 400 },
        );
      }

      // Validate delegation authority
      const validation = await validateDelegation({
        granterId: userId,
        action: 'delegate',
        schoolId: schoolId,
        permissions,
      });

      if (!validation.allowed) {
        return NextResponse.json(
          { success: false, error: 'Not authorized for this delegation', violations: validation.violations },
          { status: 403 },
        );
      }

      const result = await createDelegationToken({
        granterUserId: userId,
        schoolId: schoolId,
        permissions,
        expiryDays: expiresInDays,
        granteeUserId: granteeUserId || null,
        maxUses: maxUses || null,
        resourceScope: resourceScope || null,
      });

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      await logAudit(userId, {
        action: 'create_delegation',
        resourceType: 'delegation_token',
        resourceId: result.tokenId || '',
        details: { permissions, schoolId: schoolId },
        status: 'success',
      });

      // Return the raw token ONCE -- it cannot be retrieved later
      return NextResponse.json(
        { success: true, token: result.token, tokenId: result.tokenId },
        { status: 201 },
      );
    }

    // ── Revoke Elevation ──────────────────────────────────────
    if (action === 'revoke_elevation') {
      const { elevationId } = body;
      if (!elevationId) {
        return NextResponse.json(
          { success: false, error: 'elevationId is required' },
          { status: 400 },
        );
      }

      const result = await revokeElevation(elevationId, userId);

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      await logAudit(userId, {
        action: 'revoke_elevation',
        resourceType: 'role_elevation',
        resourceId: elevationId,
        details: { schoolId: schoolId },
        status: 'success',
      });

      return NextResponse.json({ success: true });
    }

    // ── Revoke Delegation ─────────────────────────────────────
    if (action === 'revoke_delegation') {
      const { tokenId } = body;
      if (!tokenId) {
        return NextResponse.json(
          { success: false, error: 'tokenId is required' },
          { status: 400 },
        );
      }

      const result = await revokeDelegationToken(tokenId, userId);

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      await logAudit(userId, {
        action: 'revoke_delegation',
        resourceType: 'delegation_token',
        resourceId: tokenId,
        details: { schoolId: schoolId },
        status: 'success',
      });

      return NextResponse.json({ success: true });
    }

    // ── Approve Request ───────────────────────────────────────
    if (action === 'approve_request') {
      const { approvalId, reason } = body;
      if (!approvalId) {
        return NextResponse.json(
          { success: false, error: 'approvalId is required' },
          { status: 400 },
        );
      }

      const result = await approveRequest(approvalId, userId, reason);

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      await logAudit(userId, {
        action: 'approve_delegation_request',
        resourceType: 'delegation_approval',
        resourceId: approvalId,
        details: { schoolId: schoolId, reason: reason || null },
        status: 'success',
      });

      return NextResponse.json({ success: true, approval: result.approval });
    }

    // ── Reject Request ────────────────────────────────────────
    if (action === 'reject_request') {
      const { approvalId, reason } = body;
      if (!approvalId || !reason) {
        return NextResponse.json(
          { success: false, error: 'approvalId and reason are required' },
          { status: 400 },
        );
      }

      const result = await rejectRequest(approvalId, userId, reason);

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      await logAudit(userId, {
        action: 'reject_delegation_request',
        resourceType: 'delegation_approval',
        resourceId: approvalId,
        details: { schoolId: schoolId, reason },
        status: 'success',
      });

      return NextResponse.json({ success: true, approval: result.approval });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
