/**
 * ALFANUMRIK RBAC — Shared Type Definitions
 *
 * Canonical types for the RBAC system. Imported by rbac.ts (which re-exports
 * them for backward compatibility) and by any module that needs RBAC types
 * without pulling in the full authorization runtime.
 */

// ─── Role Names ─────────────────────────────────────────────

export type RoleName =
  | 'student' | 'parent' | 'teacher' | 'tutor'
  | 'admin' | 'super_admin'
  | 'institution_admin' | 'content_manager' | 'reviewer' | 'support' | 'finance';

// ─── Ownership ──────────────────────────────────────────────

export type OwnershipType = 'own' | 'linked' | 'assigned' | 'any';

// ─── Core Interfaces ────────────────────────────────────────

export interface RoleInfo {
  name: RoleName;
  display_name: string;
  hierarchy_level: number;
  school_id?: string | null;
}

export interface UserPermissions {
  roles: RoleInfo[];
  permissions: string[];
  schoolId?: string | null;
}

export interface ResolutionContext {
  schoolId?: string;
  resourceType?: string;
  resourceId?: string;
  delegationToken?: string;
  impersonationSession?: string;
  oauthAppId?: string;
  ipAddress?: string;
}

export interface ResolutionTrace {
  userId: string;
  permission: string;
  granted: boolean;
  resolvedVia: 'direct' | 'delegation' | 'elevation' | 'impersonation' | 'oauth' | 'super_admin_bypass' | 'plan_gated';
  schoolId: string | null;
  checkedPolicies: string[];
  reason: string;
  durationMs: number;
  timestamp: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  userId: string | null;
  studentId: string | null;
  roles: RoleName[];
  permissions: string[];
  schoolId?: string | null;
  trace?: ResolutionTrace;
  errorResponse?: Response;
  reason?: string;
}

export interface ResourceAccessCheck {
  resourceType: string;
  resourceId?: string;
  ownerId?: string;
  ownershipType: OwnershipType;
}
