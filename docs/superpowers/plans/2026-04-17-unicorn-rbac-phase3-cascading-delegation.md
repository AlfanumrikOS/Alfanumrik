# Unicorn RBAC Phase 3: Cascading Delegation + Approval Workflows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the cascading delegation authority model (who can grant what to whom), approval workflows for high-risk operations, automatic cascading revocation when authority is removed, and an institution admin RBAC management page.

**Architecture:** Two new DB tables (`delegation_authority`, `delegation_approvals`) + a `cascade_authority_revocation()` RPC. A TypeScript validation engine (`rbac-authority.ts`) checks every delegation action against the authority rules before executing. An approval manager (`rbac-approvals.ts`) handles pending/approve/reject workflows. The institution admin gets a scoped RBAC page at `/school-admin/rbac/` consuming the same API pattern as the super admin panel.

**Tech Stack:** Supabase PostgreSQL, TypeScript (Next.js), Vitest, React 18, Tailwind

**Depends on:** Phase 2A (tenant schema), Phase 2B (temporary access managers)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260417400000_rbac_phase3_cascading_delegation.sql` | delegation_authority, delegation_approvals tables, cascade_authority_revocation RPC, seed platform defaults |
| Create | `src/lib/rbac-authority.ts` | Validate delegation actions against authority rules |
| Create | `src/lib/rbac-approvals.ts` | Approval workflow CRUD (request, approve, reject, list) |
| Create | `src/__tests__/rbac-authority.test.ts` | Tests for authority validation |
| Create | `src/__tests__/rbac-approvals.test.ts` | Tests for approval workflows |
| Create | `src/app/api/school-admin/rbac/route.ts` | School-scoped RBAC API (elevations, delegations, approvals) |
| Create | `src/app/school-admin/rbac/page.tsx` | Institution admin RBAC management page |

---

## Task 1: Migration — delegation_authority + delegation_approvals + cascade RPC

Create `supabase/migrations/20260417400000_rbac_phase3_cascading_delegation.sql`.

### delegation_authority table
Controls what each role can do at each level:
- id UUID PK, school_id UUID nullable FK->schools (NULL=platform rule), granter_role_id UUID FK->roles NOT NULL
- action TEXT NOT NULL CHECK IN ('assign_role','revoke_role','elevate','delegate','create_role','modify_role_permissions')
- target_max_hierarchy INT, target_role_ids UUID[] nullable, target_permissions TEXT[] nullable
- requires_reason BOOLEAN DEFAULT false, requires_approval BOOLEAN DEFAULT false
- max_duration_hours INT nullable, is_active BOOLEAN DEFAULT true
- RLS: service_role full, authenticated SELECT for own school + admin

### delegation_approvals table
Pending approval queue:
- id UUID PK, school_id UUID NOT NULL FK->schools, requested_by UUID NOT NULL
- action TEXT NOT NULL, target_user_id UUID nullable, target_role_id UUID nullable
- payload JSONB NOT NULL, status TEXT DEFAULT 'pending' CHECK IN ('pending','approved','rejected','expired')
- decided_by UUID nullable, decision_reason TEXT nullable, decided_at TIMESTAMPTZ nullable
- expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+72h, created_at TIMESTAMPTZ DEFAULT now()
- RLS: service_role full, authenticated SELECT if requested_by=self OR admin OR school member

### cascade_authority_revocation RPC
`cascade_authority_revocation(p_user_id UUID, p_school_id UUID)` — SECURITY DEFINER:
1. Revoke all role assignments this user made at this school (user_roles WHERE assigned_by)
2. Revoke all delegation tokens this user created (delegation_tokens WHERE granter_user_id)
3. Revoke all active elevations this user granted (role_elevations WHERE granted_by)
4. Expire all pending approvals from this user (delegation_approvals WHERE requested_by)
5. Return JSONB with counts of each type revoked + list of affected user IDs for cache invalidation

### Seed platform defaults
Insert default delegation_authority rows matching the spec:
- super_admin: assign_role (max 100), create_role (100), modify_role_permissions (100), elevate (max 90, cannot elevate to super_admin)
- admin: assign_role (max 80), elevate (max 70, max 168h)
- institution_admin: assign_role (max 69, school-scoped), revoke_role (69), create_role (65), modify_role_permissions (69), elevate (max 65, 48h, requires_reason)
- teacher: delegate only (own permissions, class-scoped, max 7 days)
- content_manager: delegate (content permissions, max 7d)
- finance: delegate (finance read permissions, max 24h)
- support: delegate (support permissions, max 7d)

## Task 2: Authority Validation Engine

Create `src/lib/rbac-authority.ts` + `src/__tests__/rbac-authority.test.ts`.

### rbac-authority.ts
- Interface `DelegationRequest`: { granterId, action, schoolId, targetUserId?, targetRoleId?, permissions?, durationHours?, reason? }
- Interface `DelegationValidation`: { allowed, requiresApproval, violations: string[], effectiveConstraints: { maxHierarchy, allowedPermissions: string[], maxDurationHours } }
- `validateDelegation(req)`: 
  1. Look up granter's roles in the school
  2. Find matching delegation_authority rows for granter's role + requested action
  3. If no authority row → denied
  4. Check target_max_hierarchy (if targetRoleId provided, check its hierarchy <= max)
  5. Check permissions are within granter's own permissions
  6. Check duration <= max_duration_hours
  7. Check requires_approval → return requiresApproval=true
  8. Return allowed=true with effectiveConstraints
- Tests: 6+ covering allowed, denied (no authority), denied (hierarchy too high), denied (permission not held), requires_approval, school-scoped rules

## Task 3: Approval Workflow Manager

Create `src/lib/rbac-approvals.ts` + `src/__tests__/rbac-approvals.test.ts`.

### rbac-approvals.ts
- `requestApproval(input)`: insert delegation_approvals row, return {success, approvalId}
- `approveRequest(approvalId, decidedBy, reason?)`: validate decider has higher hierarchy than requester, update status='approved', execute the original action, write audit
- `rejectRequest(approvalId, decidedBy, reason)`: update status='rejected', write audit
- `listPendingApprovals(schoolId)`: return pending approvals for a school
- Tests: 5+ covering create, approve, reject, list, expired-auto-skip

## Task 4: School-Admin RBAC API + Page

### API: `src/app/api/school-admin/rbac/route.ts`
Similar to super-admin RBAC route but uses school-scoped auth. Pattern:
- Extract school context from authenticated user (school_memberships lookup)
- Verify user has institution_admin role for that school
- GET: list elevations/delegations/approvals scoped to school
- POST: grant_elevation, create_delegation, request_approval, approve, reject — all validated via rbac-authority.ts

### Page: `src/app/school-admin/rbac/page.tsx`
Tabs: Dashboard, Elevations, Delegations, Approvals. Same pattern as super-admin/rbac but scoped to one school. Uses existing school-admin layout if available, otherwise standalone.

## Task 5: Verification
Full test suite, type-check, push.
