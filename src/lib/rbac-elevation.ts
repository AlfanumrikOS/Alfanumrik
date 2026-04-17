/**
 * ALFANUMRIK RBAC — Role Elevation Manager
 *
 * Manages time-bound role elevations. Supports grant, revoke, and listing
 * of active elevations with full audit trail and cache invalidation.
 *
 * Usage:
 *   import { grantElevation, revokeElevation, getActiveElevations } from '@/lib/rbac-elevation';
 *
 *   const result = await grantElevation({
 *     userId: 'teacher-uuid',
 *     elevatedRoleId: 'admin-role-uuid',
 *     grantedBy: 'super-admin-uuid',
 *     reason: 'Temporary admin access for school event setup',
 *     durationHours: 24,
 *   });
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { invalidateForSecurityEvent } from '@/lib/rbac';

// ─── Types ──────────────────────────────────────────────────

export interface ElevationGrant {
  userId: string;
  schoolId?: string | null;
  elevatedRoleId: string;
  originalRoles?: Array<{ name: string; id: string }>;
  grantedBy: string;
  reason: string;
  durationHours: number;
}

export interface ElevationResult {
  success: boolean;
  elevationId?: string;
  error?: string;
}

export interface ActiveElevation {
  id: string;
  userId: string;
  schoolId: string | null;
  elevatedRoleId: string;
  originalRoles: unknown;
  grantedBy: string;
  reason: string;
  startsAt: string;
  expiresAt: string;
  status: string;
}

// ─── Constants ──────────────────────────────────────────────

const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 168; // 7 days

// ─── Grant Elevation ────────────────────────────────────────

/**
 * Grant a time-bound role elevation to a user.
 *
 * Validates:
 * - Reason is non-empty
 * - Duration is between 1-168 hours
 *
 * Side effects:
 * - Inserts into role_elevations
 * - Invalidates permission cache for the user
 * - Writes audit event (fire-and-forget)
 */
export async function grantElevation(grant: ElevationGrant): Promise<ElevationResult> {
  // Validate reason
  if (!grant.reason || grant.reason.trim().length === 0) {
    return { success: false, error: 'Reason is required for role elevation' };
  }

  // Validate duration
  if (grant.durationHours < MIN_DURATION_HOURS || grant.durationHours > MAX_DURATION_HOURS) {
    return {
      success: false,
      error: `Duration must be between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS} hours`,
    };
  }

  try {
    const supabase = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + grant.durationHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('role_elevations')
      .insert({
        user_id: grant.userId,
        school_id: grant.schoolId ?? null,
        elevated_role_id: grant.elevatedRoleId,
        original_roles: grant.originalRoles ?? [],
        granted_by: grant.grantedBy,
        reason: grant.reason.trim(),
        expires_at: expiresAt,
        max_duration_hours: grant.durationHours,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) {
      logger.error('rbac_elevation_grant_failed', {
        error: new Error(error.message),
        route: 'rbac-elevation',
      });
      return { success: false, error: error.message };
    }

    // Invalidate permission cache for the elevated user
    await invalidateForSecurityEvent([grant.userId], 'role_elevation_granted');

    // Fire-and-forget audit event
    try {
      const { writeAuditEvent } = await import('@/lib/audit-pipeline');
      await writeAuditEvent({
        eventType: 'role_change',
        actorUserId: grant.grantedBy,
        effectiveUserId: grant.userId,
        schoolId: grant.schoolId ?? null,
        action: 'elevate',
        result: 'granted',
        resourceType: 'role_elevation',
        resourceId: data.id,
        metadata: {
          elevatedRoleId: grant.elevatedRoleId,
          reason: grant.reason.trim(),
          durationHours: grant.durationHours,
          expiresAt,
        },
      });
    } catch {
      // Audit write failed — not critical
    }

    return { success: true, elevationId: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_elevation_grant_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-elevation',
    });
    return { success: false, error: message };
  }
}

// ─── Revoke Elevation ───────────────────────────────────────

/**
 * Revoke an active role elevation immediately.
 *
 * Side effects:
 * - Updates role_elevations status to 'revoked'
 * - Invalidates permission cache for the affected user
 * - Writes audit event (fire-and-forget)
 */
export async function revokeElevation(
  elevationId: string,
  revokedBy: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch the elevation to get the user_id for cache invalidation
    const { data: elevation, error: fetchError } = await supabase
      .from('role_elevations')
      .select('id, user_id, status')
      .eq('id', elevationId)
      .single();

    if (fetchError || !elevation) {
      return { success: false, error: 'Elevation not found' };
    }

    if (elevation.status !== 'active') {
      return { success: false, error: `Elevation is already ${elevation.status}` };
    }

    // Update to revoked
    const { error: updateError } = await supabase
      .from('role_elevations')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: revokedBy,
      })
      .eq('id', elevationId)
      .eq('status', 'active');

    if (updateError) {
      logger.error('rbac_elevation_revoke_failed', {
        error: new Error(updateError.message),
        route: 'rbac-elevation',
      });
      return { success: false, error: updateError.message };
    }

    // Instant cache invalidation
    await invalidateForSecurityEvent([elevation.user_id], 'role_elevation_revoked');

    // Fire-and-forget audit event
    try {
      const { writeAuditEvent } = await import('@/lib/audit-pipeline');
      await writeAuditEvent({
        eventType: 'role_change',
        actorUserId: revokedBy,
        effectiveUserId: elevation.user_id,
        action: 'revoke',
        result: 'granted',
        resourceType: 'role_elevation',
        resourceId: elevationId,
        metadata: { reason: 'manual_revocation' },
      });
    } catch {
      // Audit write failed — not critical
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_elevation_revoke_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-elevation',
    });
    return { success: false, error: message };
  }
}

// ─── List Active Elevations ─────────────────────────────────

/**
 * Get all active (non-expired, non-revoked) elevations for a user,
 * optionally filtered by school.
 */
export async function getActiveElevations(
  userId: string,
  schoolId?: string,
): Promise<ActiveElevation[]> {
  try {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('role_elevations')
      .select('id, user_id, school_id, elevated_role_id, original_roles, granted_by, reason, starts_at, expires_at, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString());

    if (schoolId) {
      query = query.eq('school_id', schoolId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('rbac_elevation_list_failed', {
        error: new Error(error.message),
        route: 'rbac-elevation',
      });
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      schoolId: row.school_id,
      elevatedRoleId: row.elevated_role_id,
      originalRoles: row.original_roles,
      grantedBy: row.granted_by,
      reason: row.reason,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      status: row.status,
    }));
  } catch (err) {
    logger.error('rbac_elevation_list_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'rbac-elevation',
    });
    return [];
  }
}
