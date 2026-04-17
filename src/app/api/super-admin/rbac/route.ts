import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { grantElevation, revokeElevation } from '@/lib/rbac-elevation';
import { startImpersonation, endImpersonation } from '@/lib/rbac-impersonation';
import { createDelegationToken, revokeDelegationToken } from '@/lib/rbac-delegation';

// ─── GET Handler ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'dashboard_stats';

  try {
    // ── Elevations ──────────────────────────────────────────
    if (action === 'elevations') {
      let q = 'select=*&order=created_at.desc&limit=50';
      const status = params.get('status');
      const userId = params.get('user_id');
      const schoolId = params.get('school_id');
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;
      if (userId) q += `&user_id=eq.${encodeURIComponent(userId)}`;
      if (schoolId) q += `&school_id=eq.${encodeURIComponent(schoolId)}`;

      const res = await fetch(supabaseAdminUrl('role_elevations', q), { headers: supabaseAdminHeaders() });
      const data = res.ok ? await res.json() : [];
      return NextResponse.json({ data });
    }

    // ── Impersonation Sessions ──────────────────────────────
    if (action === 'impersonation_sessions') {
      let q = 'select=*&order=started_at.desc&limit=50';
      const status = params.get('status');
      const adminUserId = params.get('admin_user_id');
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;
      if (adminUserId) q += `&admin_user_id=eq.${encodeURIComponent(adminUserId)}`;

      const res = await fetch(supabaseAdminUrl('impersonation_sessions', q), { headers: supabaseAdminHeaders() });
      const data = res.ok ? await res.json() : [];
      return NextResponse.json({ data });
    }

    // ── Delegation Tokens ───────────────────────────────────
    if (action === 'delegation_tokens') {
      let q = 'select=id,granter_user_id,grantee_user_id,school_id,permissions,status,use_count,max_uses,expires_at,created_at&order=created_at.desc&limit=50';
      const status = params.get('status');
      const schoolId = params.get('school_id');
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;
      if (schoolId) q += `&school_id=eq.${encodeURIComponent(schoolId)}`;

      const res = await fetch(supabaseAdminUrl('delegation_tokens', q), { headers: supabaseAdminHeaders() });
      const data = res.ok ? await res.json() : [];
      return NextResponse.json({ data });
    }

    // ── Dashboard Stats ─────────────────────────────────────
    if (action === 'dashboard_stats') {
      const [elevRes, impRes, delRes] = await Promise.all([
        fetch(supabaseAdminUrl('role_elevations', 'select=id&status=eq.active'), { headers: supabaseAdminHeaders('count=exact') }),
        fetch(supabaseAdminUrl('impersonation_sessions', 'select=id&status=eq.active'), { headers: supabaseAdminHeaders('count=exact') }),
        fetch(supabaseAdminUrl('delegation_tokens', 'select=id&status=eq.active'), { headers: supabaseAdminHeaders('count=exact') }),
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
        data: {
          activeElevations: parseCount(elevRes),
          activeSessions: parseCount(impRes),
          activeTokens: parseCount(delRes),
        },
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ─── POST Handler ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { action } = body;

    // ── Grant Elevation ───────────────────────────────────────
    if (action === 'grant_elevation') {
      const { userId, elevatedRoleId, reason, durationHours, schoolId } = body;
      if (!userId || !elevatedRoleId || !reason || !durationHours) {
        return NextResponse.json({ error: 'userId, elevatedRoleId, reason, and durationHours are required' }, { status: 400 });
      }

      const result = await grantElevation({
        userId,
        elevatedRoleId,
        grantedBy: auth.userId,
        reason,
        durationHours,
        schoolId: schoolId || null,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(auth, 'grant_elevation', 'role_elevation', result.elevationId || '', { userId, roleId: elevatedRoleId });
      return NextResponse.json({ success: true, elevationId: result.elevationId }, { status: 201 });
    }

    // ── Start Impersonation ───────────────────────────────────
    if (action === 'start_impersonation') {
      const { targetUserId, reason, maxMinutes, schoolId } = body;
      if (!targetUserId || !reason) {
        return NextResponse.json({ error: 'targetUserId and reason are required' }, { status: 400 });
      }

      const result = await startImpersonation({
        adminUserId: auth.userId,
        targetUserId,
        reason,
        durationMinutes: maxMinutes,
        schoolId: schoolId || null,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(auth, 'start_impersonation', 'impersonation_session', result.sessionId || '', { targetUserId });
      return NextResponse.json({ success: true, sessionId: result.sessionId, expiresAt: result.expiresAt }, { status: 201 });
    }

    // ── Create Delegation Token ───────────────────────────────
    if (action === 'create_delegation') {
      const { granterUserId, schoolId, permissions, expiresInDays, granteeUserId, maxUses, resourceScope } = body;
      if (!granterUserId || !schoolId || !permissions || !expiresInDays) {
        return NextResponse.json({ error: 'granterUserId, schoolId, permissions, and expiresInDays are required' }, { status: 400 });
      }

      const result = await createDelegationToken({
        granterUserId,
        schoolId,
        permissions,
        expiryDays: expiresInDays,
        granteeUserId: granteeUserId || null,
        maxUses: maxUses || null,
        resourceScope: resourceScope || null,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(auth, 'create_delegation', 'delegation_token', result.tokenId || '', { granterUserId, schoolId, permissions });
      // Return the raw token ONCE — it cannot be retrieved later
      return NextResponse.json({ success: true, token: result.token, tokenId: result.tokenId }, { status: 201 });
    }

    // ── Revoke Elevation ──────────────────────────────────────
    if (action === 'revoke_elevation') {
      const { elevationId } = body;
      if (!elevationId) {
        return NextResponse.json({ error: 'elevationId is required' }, { status: 400 });
      }

      const result = await revokeElevation(elevationId, auth.userId);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(auth, 'revoke_elevation', 'role_elevation', elevationId, {});
      return NextResponse.json({ success: true });
    }

    // ── End Impersonation ─────────────────────────────────────
    if (action === 'end_impersonation') {
      const { sessionId } = body;
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      }

      const result = await endImpersonation(sessionId, 'manual');

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(auth, 'end_impersonation', 'impersonation_session', sessionId, {});
      return NextResponse.json({ success: true });
    }

    // ── Revoke Delegation Token ───────────────────────────────
    if (action === 'revoke_delegation') {
      const { tokenId } = body;
      if (!tokenId) {
        return NextResponse.json({ error: 'tokenId is required' }, { status: 400 });
      }

      const result = await revokeDelegationToken(tokenId, auth.userId);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(auth, 'revoke_delegation', 'delegation_token', tokenId, {});
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
