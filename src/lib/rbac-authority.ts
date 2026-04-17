/**
 * ALFANUMRIK -- Authority Validation Engine
 *
 * Validates whether a user (granter) has the delegation authority to perform
 * a specific action (assign_role, revoke_role, elevate, delegate, create_role,
 * modify_role_permissions) within a school context.
 *
 * Reads from the `delegation_authority` table and cross-references the
 * granter's own permissions to determine if the action is allowed, requires
 * approval, and what constraints apply.
 *
 * Usage:
 *   import { validateDelegation } from '@/lib/rbac-authority';
 *
 *   const result = await validateDelegation({
 *     granterId: userId,
 *     action: 'assign_role',
 *     schoolId: schoolId,
 *     targetRoleId: roleId,
 *   });
 *   if (!result.allowed) { // reject with result.violations }
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getUserPermissions } from '@/lib/rbac';
import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────

export type DelegationAction =
  | 'assign_role'
  | 'revoke_role'
  | 'elevate'
  | 'delegate'
  | 'create_role'
  | 'modify_role_permissions';

export interface DelegationRequest {
  granterId: string;
  action: DelegationAction;
  schoolId: string;
  targetUserId?: string;
  targetRoleId?: string;
  permissions?: string[];
  durationHours?: number;
  reason?: string;
}

export interface DelegationValidation {
  allowed: boolean;
  requiresApproval: boolean;
  violations: string[];
  effectiveConstraints: {
    maxHierarchy: number;
    allowedPermissions: string[];
    maxDurationHours: number;
  };
}

// ─── Authority Row Shape (from delegation_authority table) ───

interface AuthorityRow {
  id: string;
  granter_role_id: string;
  action: string;
  target_max_hierarchy: number;
  max_duration_hours: number | null;
  requires_approval: boolean;
  requires_reason: boolean;
  is_active: boolean;
  school_id: string | null;
}

// ─── Core Validation ─────────────────────────────────────────

/**
 * Validate whether a granter has authority to perform a delegation action.
 *
 * Steps:
 * 1. Get granter's permissions and role IDs
 * 2. Query delegation_authority for matching rows
 * 3. Pick the most permissive authority (highest target_max_hierarchy)
 * 4. Check target role hierarchy, permissions, duration, reason constraints
 * 5. Return validation result
 */
export async function validateDelegation(
  req: DelegationRequest,
): Promise<DelegationValidation> {
  const defaultDenied: DelegationValidation = {
    allowed: false,
    requiresApproval: false,
    violations: [],
    effectiveConstraints: {
      maxHierarchy: 0,
      allowedPermissions: [],
      maxDurationHours: 0,
    },
  };

  try {
    // 1. Get granter's permissions and roles
    const granterPerms = await getUserPermissions(req.granterId, req.schoolId);
    const granterRoleIds = granterPerms.roles.map((r) => r.name);

    if (granterRoleIds.length === 0) {
      return {
        ...defaultDenied,
        violations: ['Granter has no active roles'],
      };
    }

    // 2. Query delegation_authority for matching rows
    const supabase = getSupabaseAdmin();
    const { data: authorityRows, error: authorityError } = await supabase
      .from('delegation_authority')
      .select('*')
      .in('granter_role_id', granterRoleIds)
      .eq('action', req.action)
      .eq('is_active', true);

    if (authorityError) {
      logger.error('rbac_authority_query_failed', {
        error: new Error(authorityError.message),
        route: 'rbac-authority',
      });
      return {
        ...defaultDenied,
        violations: ['Authority check failed'],
      };
    }

    // Filter to rows that match the school context (school_id IS NULL OR school_id = req.schoolId)
    const matchingRows = (authorityRows as AuthorityRow[] | null)?.filter(
      (row) => row.school_id === null || row.school_id === req.schoolId,
    ) ?? [];

    if (matchingRows.length === 0) {
      return {
        ...defaultDenied,
        violations: ['No delegation authority for this action'],
      };
    }

    // 3. Take the most permissive matching row (highest target_max_hierarchy)
    const authority = matchingRows.reduce((best, current) =>
      current.target_max_hierarchy > best.target_max_hierarchy ? current : best,
    );

    const violations: string[] = [];

    // 4. Check target role hierarchy
    if (req.targetRoleId) {
      const { data: targetRole, error: roleError } = await supabase
        .from('roles')
        .select('hierarchy_level')
        .eq('id', req.targetRoleId)
        .single();

      if (roleError || !targetRole) {
        logger.error('rbac_authority_role_lookup_failed', {
          error: roleError ? new Error(roleError.message) : new Error('Role not found'),
          route: 'rbac-authority',
        });
        return {
          ...defaultDenied,
          violations: ['Authority check failed'],
        };
      }

      if (targetRole.hierarchy_level > authority.target_max_hierarchy) {
        violations.push(
          `Target role hierarchy (${targetRole.hierarchy_level}) exceeds maximum allowed (${authority.target_max_hierarchy})`,
        );
      }
    }

    // 5. Check permissions are held by granter
    if (req.permissions && req.permissions.length > 0) {
      for (const perm of req.permissions) {
        if (!granterPerms.permissions.includes(perm)) {
          violations.push(`Granter does not hold permission: ${perm}`);
        }
      }
    }

    // 6. Check duration constraint
    if (
      req.durationHours !== undefined &&
      authority.max_duration_hours !== null &&
      req.durationHours > authority.max_duration_hours
    ) {
      violations.push(
        `Requested duration (${req.durationHours}h) exceeds maximum allowed (${authority.max_duration_hours}h)`,
      );
    }

    // 7. Check reason requirement
    if (authority.requires_reason && !req.reason) {
      violations.push('Reason is required for this action');
    }

    // 8. Build effective constraints
    const effectiveConstraints = {
      maxHierarchy: authority.target_max_hierarchy,
      allowedPermissions: granterPerms.permissions,
      maxDurationHours: authority.max_duration_hours ?? 0,
    };

    return {
      allowed: violations.length === 0,
      requiresApproval: authority.requires_approval,
      violations,
      effectiveConstraints,
    };
  } catch (err) {
    logger.error('rbac_authority_validation_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'rbac-authority',
    });
    return {
      ...defaultDenied,
      violations: ['Authority check failed'],
    };
  }
}
