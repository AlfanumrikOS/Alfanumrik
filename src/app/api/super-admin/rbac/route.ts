import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { grantElevation, revokeElevation } from '@/lib/rbac-elevation';
import { startImpersonation, endImpersonation } from '@/lib/rbac-impersonation';
import { createDelegationToken, revokeDelegationToken } from '@/lib/rbac-delegation';
import { validateBody, zUuid, zReason, zDurationHours, zDaysExpiry } from '@/lib/validation';
import { z } from 'zod';

// Phase G.6 (2026-05-17): Zod schemas for every RBAC mutation. Previously
// these accepted any truthy values with manual `if (!x)` checks, which let
// callers pass non-UUIDs, unbounded duration/expiry, and arbitrary text.

const grantElevationSchema = z.object({
  action: z.literal('grant_elevation'),
  userId: zUuid,
  elevatedRoleId: zUuid,
  reason: zReason,
  durationHours: zDurationHours,
  schoolId: zUuid.nullable().optional(),
});

const startImpersonationSchema = z.object({
  action: z.literal('start_impersonation'),
  targetUserId: zUuid,
  reason: zReason,
  maxMinutes: z.number().int().min(5).max(60).optional(),
  schoolId: zUuid.nullable().optional(),
});

const createDelegationSchema = z.object({
  action: z.literal('create_delegation'),
  granterUserId: zUuid,
  schoolId: zUuid,
  permissions: z.array(z.string().min(1).max(128)).min(1).max(50),
  expiresInDays: zDaysExpiry,
  granteeUserId: zUuid.nullable().optional(),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
  resourceScope: z.record(z.string(), z.unknown()).nullable().optional(),
});

const revokeElevationSchema = z.object({
  action: z.literal('revoke_elevation'),
  elevationId: zUuid,
});

const endImpersonationSchema = z.object({
  action: z.literal('end_impersonation'),
  sessionId: zUuid,
});

const revokeDelegationSchema = z.object({
  action: z.literal('revoke_delegation'),
  tokenId: zUuid,
});

// ─── GET Handler ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Phase G.1: support level can read RBAC dashboard (read-only state).
  const auth = await authorizeAdmin(request, 'support');
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
  // Phase G.1: ALL RBAC mutations (elevations, impersonation, delegation)
  // require super_admin. A `support` admin granting themselves elevation
  // would defeat the level system.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;
  const ipAddress = request.headers.get('x-forwarded-for') || undefined;

  try {
    const body = await request.json();
    const { action } = body || {};

    // ── Grant Elevation ───────────────────────────────────────
    if (action === 'grant_elevation') {
      const validation = validateBody(grantElevationSchema, body);
      if (!validation.success) return validation.error;
      const { userId, elevatedRoleId, reason, durationHours, schoolId } = validation.data;

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

      await logAdminAudit(
        auth, 'grant_elevation', 'role_elevation', result.elevationId || '',
        { userId, roleId: elevatedRoleId, durationHours, reason },
        ipAddress,
        { after: { elevation_id: result.elevationId, status: 'active', granted_for_user: userId, role_id: elevatedRoleId, expires_in_hours: durationHours } },
      );
      return NextResponse.json({ success: true, elevationId: result.elevationId }, { status: 201 });
    }

    // ── Start Impersonation ───────────────────────────────────
    if (action === 'start_impersonation') {
      const validation = validateBody(startImpersonationSchema, body);
      if (!validation.success) return validation.error;
      const { targetUserId, reason, maxMinutes, schoolId } = validation.data;

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

      await logAdminAudit(
        auth, 'start_impersonation', 'impersonation_session', result.sessionId || '',
        { targetUserId, reason, maxMinutes },
        ipAddress,
        { after: { session_id: result.sessionId, target_user_id: targetUserId, expires_at: result.expiresAt } },
      );
      return NextResponse.json({ success: true, sessionId: result.sessionId, expiresAt: result.expiresAt }, { status: 201 });
    }

    // ── Create Delegation Token ───────────────────────────────
    if (action === 'create_delegation') {
      const validation = validateBody(createDelegationSchema, body);
      if (!validation.success) return validation.error;
      const { granterUserId, schoolId, permissions, expiresInDays, granteeUserId, maxUses, resourceScope } = validation.data;

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

      await logAdminAudit(
        auth, 'create_delegation', 'delegation_token', result.tokenId || '',
        { granterUserId, schoolId, permissions, expiresInDays, maxUses: maxUses || null },
        ipAddress,
        { after: { token_id: result.tokenId, granter_user_id: granterUserId, school_id: schoolId, permissions, expires_in_days: expiresInDays } },
      );
      // Return the raw token ONCE — it cannot be retrieved later
      return NextResponse.json({ success: true, token: result.token, tokenId: result.tokenId }, { status: 201 });
    }

    // ── Revoke Elevation ──────────────────────────────────────
    if (action === 'revoke_elevation') {
      const validation = validateBody(revokeElevationSchema, body);
      if (!validation.success) return validation.error;
      const { elevationId } = validation.data;

      const result = await revokeElevation(elevationId, auth.userId);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(
        auth, 'revoke_elevation', 'role_elevation', elevationId, {},
        ipAddress,
        { after: { elevation_id: elevationId, status: 'revoked', revoked_by: auth.userId } },
      );
      return NextResponse.json({ success: true });
    }

    // ── End Impersonation ─────────────────────────────────────
    if (action === 'end_impersonation') {
      const validation = validateBody(endImpersonationSchema, body);
      if (!validation.success) return validation.error;
      const { sessionId } = validation.data;

      const result = await endImpersonation(sessionId, 'manual');

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(
        auth, 'end_impersonation', 'impersonation_session', sessionId, {},
        ipAddress,
        { after: { session_id: sessionId, status: 'ended', reason: 'manual' } },
      );
      return NextResponse.json({ success: true });
    }

    // ── Revoke Delegation Token ───────────────────────────────
    if (action === 'revoke_delegation') {
      const validation = validateBody(revokeDelegationSchema, body);
      if (!validation.success) return validation.error;
      const { tokenId } = validation.data;

      const result = await revokeDelegationToken(tokenId, auth.userId);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await logAdminAudit(
        auth, 'revoke_delegation', 'delegation_token', tokenId, {},
        ipAddress,
        { after: { token_id: tokenId, status: 'revoked', revoked_by: auth.userId } },
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
