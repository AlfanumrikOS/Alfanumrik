# Unicorn RBAC System — Design Specification

**Date:** 2026-04-17
**Author:** Orchestrator + User (CEO)
**Status:** Approved — ready for implementation planning
**Approach:** Hybrid — Tenant-Scoped Storage + Lightweight Policy Evaluation
**Rollout:** Progressive, 4 phases

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Foundation — Tenant-Scoped RBAC Schema](#phase-1-foundation--tenant-scoped-rbac-schema)
3. [Phase 2: Permission Resolution Engine](#phase-2-permission-resolution-engine)
4. [Phase 3: Forensic Audit Pipeline](#phase-3-forensic-audit-pipeline)
5. [Phase 4: Temporary Access System](#phase-4-temporary-access-system)
6. [Cascading Delegation Model](#cascading-delegation-model)
7. [OAuth2 / Developer Platform](#oauth2--developer-platform)
8. [Hybrid Cache Invalidation](#hybrid-cache-invalidation)
9. [Admin UI — RBAC Management](#admin-ui--rbac-management)
10. [B2C RBAC Flow — Students & Parents](#b2c-rbac-flow--students--parents)
11. [Rollout Phases](#rollout-phases)

---

## Overview

Comprehensive redesign of Alfanumrik's RBAC system targeting five dimensions:

1. **Tighter security** — close existing gaps, enforce all schema features
2. **Operational agility** — admin UI for role management, delegation, impersonation
3. **Multi-tenancy** — fully isolated school RBAC tenants with platform templates
4. **Full forensic audit** — immutable, cryptographically-chained, anomaly-detecting audit trail
5. **Developer platform** — OAuth2, API keys, school-level app consent

### Current State (What Exists)

| Layer | Implementation | Status |
|---|---|---|
| DB Schema | 7 tables: permissions, roles, role_permissions, user_roles, audit_logs, resource_access_rules, api_keys + admin_users | Mature |
| Roles | 11 roles from student (10) to super_admin (100) | Complete |
| Permissions | 71+ permission codes across 15+ resource domains | Comprehensive |
| Server enforcement | authorizeRequest() — 3-layer check | Solid |
| Client hook | usePermissions() — UI convenience only | Correct |
| Caching | Redis (Upstash) 5-min TTL + in-memory fallback | Scalable |
| Middleware | Session refresh, rate limiting, bot blocking | Good |
| Admin auth | Dual system: session-based + secret-based | Functional |
| Audit | Two separate systems: audit_logs + admin_audit_log | Split |

### Known Gaps

1. `tutor` role has zero permissions seeded
2. Two separate audit log tables with different schemas
3. `resource_access_rules` table exists but app uses hardcoded ownership checks
4. Role hierarchy is informational only — no inheritance logic
5. No permission delegation capability
6. No role-change notifications
7. `api_keys` table exists but no auth flow wired
8. Cache invalidation not wired to role-change events automatically
9. No plan-based permission gating in RBAC layer

---

## Phase 1: Foundation — Tenant-Scoped RBAC Schema

### Tenancy Model

```
Platform Layer (school_id = NULL)
  - Provides default roles, permissions, and role-permission mappings
  - Acts as the "template" when onboarding a new school

School Layer (school_id = <uuid>)
  - Gets a COPY of platform defaults on creation (full isolation)
  - Can add custom roles, modify permission assignments, create new permissions
  - Cannot affect other schools or the platform layer
  - Soft deletes only (is_active = false)
```

### Schema Changes to Existing Tables

#### `roles` — add tenant scope

| New Column | Type | Purpose |
|---|---|---|
| `school_id` | UUID nullable, FK -> schools(id) | NULL = platform default, non-NULL = school-specific |
| `source_role_id` | UUID nullable, FK -> roles(id) | Which platform role this was cloned from |
| `is_customizable` | BOOLEAN default true | Platform can mark roles as non-customizable |

Unique constraint: `UNIQUE(name)` -> `UNIQUE(school_id, name)`

#### `permissions` — add tenant scope

| New Column | Type | Purpose |
|---|---|---|
| `school_id` | UUID nullable | NULL = platform, non-NULL = school-created |
| `namespace` | TEXT default 'platform' | `platform`, `school.<school_id>`, `app.<app_id>` |

#### `role_permissions` — add tenant scope

| New Column | Type | Purpose |
|---|---|---|
| `school_id` | UUID nullable | Scopes the mapping to a tenant |

#### `user_roles` — add tenant scope

| New Column | Type | Purpose |
|---|---|---|
| `school_id` | UUID nullable | Which school context this role applies to |

#### `resource_access_rules` — add tenant scope

| New Column | Type | Purpose |
|---|---|---|
| `school_id` | UUID nullable | School-specific access rules |

### New Tables

#### `school_rbac_config`

| Column | Type | Purpose |
|---|---|---|
| `school_id` | UUID PK, FK -> schools(id) | One config per school |
| `allow_custom_roles` | BOOLEAN default true | Can this school create custom roles? |
| `max_custom_roles` | INT default 10 | Guard against role sprawl |
| `allow_custom_permissions` | BOOLEAN default false | Can this school define custom permissions? |
| `max_hierarchy_level` | INT default 70 | Ceiling for school-created roles |
| `delegation_enabled` | BOOLEAN default true | Whether cascading delegation is active |
| `max_delegation_depth` | INT default 2 | How many levels deep delegation can go |
| `created_at` / `updated_at` | TIMESTAMPTZ | Standard timestamps |

#### `permission_ceilings`

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `school_id` | UUID FK -> schools(id) | |
| `permission_id` | UUID FK -> permissions(id) | |
| `is_grantable` | BOOLEAN default true | Can this school include this permission? |
| `max_scope` | JSONB | Optional constraints |

### RLS Strategy

Every tenant-scoped table gets isolation policy:

```sql
CREATE POLICY "school_isolation" ON roles
  FOR ALL
  USING (
    school_id IS NULL  -- platform defaults visible to all
    OR school_id IN (
      SELECT school_id FROM school_memberships
      WHERE auth_user_id = auth.uid() AND is_active = true
    )
  );
```

### School Onboarding Flow

1. Platform roles (school_id IS NULL) cloned into school-scoped rows with `source_role_id`
2. Platform role_permissions cloned similarly
3. permission_ceilings seeded based on subscription plan
4. school_rbac_config created with defaults
5. School admin gets institution_admin role scoped to that school

---

## Phase 2: Permission Resolution Engine

### Resolution Architecture

```
Request arrives
  |
  +- Fast path (95% of checks)
  |   authorizeRequest(req, 'quiz.attempt')
  |   -> Redis cache hit? -> return
  |   -> Cache miss? -> DB lookup via get_user_permissions(user_id, school_id)
  |
  +- Policy path (5% of checks)
      authorizeRequest(req, 'quiz.attempt', { context: ... })
      -> PolicyResolver.evaluate(user, permission, context)
```

### Core Types

```typescript
interface ResolutionContext {
  schoolId?: string;
  resourceType?: string;
  resourceId?: string;
  delegationToken?: string;
  impersonationSession?: string;
  oauthAppId?: string;
  ipAddress?: string;
}

interface ResolutionTrace {
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

interface ResolutionResult {
  authorized: boolean;
  userId: string;
  effectiveUserId: string;
  studentId: string | null;
  roles: RoleName[];
  permissions: string[];
  schoolId: string | null;
  trace: ResolutionTrace;
  errorResponse?: Response;
}
```

### Evaluation Order (strict priority, first match wins)

1. **Super admin bypass** — super_admin role -> GRANT (no further checks)
2. **Direct grant** (fast path) — permission in cached role-permissions for school_id -> GRANT
3. **Plan gate** (B2C) — check plan_permission_overrides + usage limits -> GRANT/DENY with specific error codes
4. **Time-boxed elevation** — active, non-expired elevation -> GRANT
5. **Delegation token** — valid token, granter still has permission -> GRANT (cascading revocation check)
6. **Impersonation session** — read-only check as target user -> GRANT for reads, DENY for writes
7. **OAuth app scope** — triple intersection (app scopes ^ school consent ^ user permissions) -> GRANT
8. **Default -> DENY**

### Backward Compatibility

```typescript
// Existing calls work unchanged (fast path)
const auth = await authorizeRequest(request, 'quiz.attempt');

// New context for complex resolution
const auth = await authorizeRequest(request, 'quiz.attempt', {
  context: { schoolId: 'xxx', delegationToken: 'yyy' }
});
```

### School-Scoped Permission RPC

```sql
-- Backward compatible: school_id defaults to NULL
get_user_permissions(p_auth_user_id UUID, p_school_id UUID DEFAULT NULL)
```

### Cache Key Structure

```
rbac:perms:<user_id>:platform           (platform-wide)
rbac:perms:<user_id>:school:<school_id> (school-scoped)
```

---

## Phase 3: Forensic Audit Pipeline

### Core Table: `audit_events` (replaces audit_logs + admin_audit_log)

| Column | Type | Purpose |
|---|---|---|
| `id` | BIGINT generated always as identity | Sequential, gap-free |
| `event_id` | UUID | Globally unique reference |
| `chain_hash` | TEXT not null | SHA-256(previous_hash + payload) |
| `previous_event_id` | BIGINT | Linked list for chain verification |
| `event_type` | TEXT not null | permission_check, data_access, role_change, impersonation_start, delegation_grant, oauth_consent, login, logout, admin_action, anomaly_detected |
| `actor_user_id` | UUID | Who performed the action |
| `effective_user_id` | UUID | Who the action was performed as |
| `school_id` | UUID nullable | Tenant scope |
| `permission_code` | TEXT nullable | Which permission was checked |
| `resource_type` | TEXT | Resource kind |
| `resource_id` | TEXT nullable | Specific resource |
| `action` | TEXT not null | read, write, delete, grant, revoke, login, evaluate |
| `result` | TEXT not null | granted, denied, error |
| `resolution_trace` | JSONB | Full trace from permission resolver |
| `before_snapshot` | JSONB nullable | State before action |
| `after_snapshot` | JSONB nullable | State after action |
| `ip_address` | INET | |
| `user_agent` | TEXT | |
| `session_id` | UUID nullable | Links events within same session |
| `request_id` | UUID nullable | Links events within same request |
| `metadata` | JSONB default '{}' | Extensible |
| `created_at` | TIMESTAMPTZ default now() | Immutable |

### Immutability

- REVOKE UPDATE, DELETE from all roles including service_role
- Only `audit_writer` role (NOLOGIN) can INSERT
- No row modification possible even by super_admin

### Cryptographic Chaining

```
chain_hash = SHA-256(previous_chain_hash || event_id || event_type || actor_user_id || action || result || created_at)
```

Verification function: `verify_audit_chain(p_school_id, p_from_id, p_to_id)` — runs daily via cron and on-demand.

### Before/After Snapshots

Captured for high-value resources only:
- user_roles (role grant/revoke)
- role_permissions (permission changes)
- students (subscription field changes)
- student_subscriptions (status changes)
- admin_users (any modification)
- school_rbac_config (any modification)
- oauth_app_consents (grant/revoke)

### Anomaly Detection

Edge Function `audit-anomaly-detector` runs every 15 minutes:

| Anomaly | Rule | Response |
|---|---|---|
| Bulk data access | >100 student records in 5 min | Flag + alert |
| Off-hours admin | 11 PM - 6 AM IST on non-school days | Flag + log |
| Permission escalation | >5 denials from same user in 1 min | Flag + temp rate limit |
| Impersonation abuse | Session >30 min or >50 actions | Auto-terminate + alert |
| Chain break | verify_audit_chain finds gap | Critical alert |
| Geographic anomaly | Same user, distant IPs in 10 min | Flag + optional session kill |
| Delegation storm | >20 tokens by one user in 1 hour | Flag + pause delegation |

### School-Scoped Export

```
GET /api/v1/audit/export?school_id=xxx&from=2026-01-01&to=2026-03-31&format=pdf
```

Includes: events, chain verification status, summary statistics. DPDPA compliant.

### Migration Path

- audit_logs -> audit_events (event_type inferred from action)
- admin_audit_log -> audit_events (event_type = 'admin_action')
- Old tables kept read-only for 90 days, then dropped

---

## Phase 4: Temporary Access System

### 4A: Time-Boxed Role Elevation

**Table: `role_elevations`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID not null | Recipient |
| `school_id` | UUID nullable | Tenant scope |
| `elevated_role_id` | UUID FK -> roles(id) | Temporary role |
| `original_roles` | JSONB | Snapshot at grant time |
| `granted_by` | UUID not null | Authorizer |
| `reason` | TEXT not null | Mandatory justification |
| `starts_at` | TIMESTAMPTZ default now() | |
| `expires_at` | TIMESTAMPTZ not null | Hard expiry |
| `max_duration_hours` | INT default 48 | Platform ceiling |
| `revoked_at` | TIMESTAMPTZ nullable | |
| `revoked_by` | UUID nullable | |
| `status` | TEXT default 'active' | active, expired, revoked |
| `created_at` | TIMESTAMPTZ | |

**Rules:**
- Granter hierarchy_level must be strictly higher than elevated role
- super_admin cannot be granted via elevation
- Maximum 168 hours (7 days), configurable per school
- Expiry enforced at query-time + cron cleanup
- Revocation is Tier 1 (instant cache invalidation)

### 4B: Impersonation Sessions

**Table: `impersonation_sessions`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK (also session token) | |
| `admin_user_id` | UUID not null | Impersonator |
| `target_user_id` | UUID not null | Impersonated |
| `school_id` | UUID nullable | |
| `reason` | TEXT not null | Mandatory |
| `permissions_granted` | TEXT[] | {'read'} only |
| `started_at` | TIMESTAMPTZ | |
| `expires_at` | TIMESTAMPTZ not null | Default 30 min |
| `ended_at` | TIMESTAMPTZ nullable | |
| `ended_reason` | TEXT nullable | manual, expired, anomaly_auto_terminate |
| `action_count` | INT default 0 | |
| `status` | TEXT | active, ended, expired, terminated |

**Rules:**
- Only super_admin or support + user.impersonate permission
- Cannot impersonate super_admin users
- Read-only: write operations return 403 IMPERSONATION_READ_ONLY
- Max 60 minutes, auto-terminate at 30 min or 50 actions
- Both actor and effective user logged in audit events

### 4C: Scoped Delegation Tokens

**Table: `delegation_tokens`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `token_hash` | TEXT unique | SHA-256 (token never stored) |
| `granter_user_id` | UUID not null | Creator |
| `grantee_user_id` | UUID nullable | Specific recipient or NULL for bearer |
| `school_id` | UUID not null | Must be school-scoped |
| `permissions` | TEXT[] not null | Granted permission codes |
| `resource_scope` | JSONB | Narrowing constraint |
| `max_uses` | INT nullable | |
| `use_count` | INT default 0 | |
| `expires_at` | TIMESTAMPTZ not null | |
| `revoked_at` | TIMESTAMPTZ nullable | |
| `revoked_by` | UUID nullable | |
| `status` | TEXT | active, expired, revoked, exhausted |
| `created_at` | TIMESTAMPTZ | |

**Rules:**
- Cannot delegate what you don't have
- Cascading revocation: granter loses permission -> token invalid (checked at evaluation time)
- Depth limit: max_delegation_depth from school_rbac_config (default 1)
- Scope narrowing only — sub-delegation cannot widen scope
- Max 20 active tokens per user per school

### Interaction Rules

- Impersonation overrides everything (acting as someone else)
- Elevation checked before delegation (direct role > token)
- Cannot use delegation token while impersonating
- Elevated role supersedes delegation tokens for same permissions
- They never stack

---

## Cascading Delegation Model

### Authority Hierarchy

```
super_admin (100) — everything, create schools, override any config
  +-- admin (90) — all explicit permissions, no bypass
  +-- institution_admin (70) — school-scoped, manage roles up to hierarchy 69
  |     +-- finance (65) — delegate finance read perms, max 24h
  |     +-- content_manager (60) — delegate content perms, max 7d
  |     +-- reviewer (58) — delegate content review perms, max 7d
  |     +-- support (55) — delegate support perms, max 7d
  |     +-- teacher (50) — delegation tokens for parents/students, class-scoped
  +-- tutor (40) — to be configured per-institution
  +-- parent (30) — no delegation authority
  +-- student (10) — no delegation authority
```

### Delegation Authority Table

**Table: `delegation_authority`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `school_id` | UUID nullable | NULL = platform rule, non-NULL = school override |
| `granter_role_id` | UUID FK -> roles(id) | Role with this authority |
| `action` | TEXT not null | assign_role, revoke_role, elevate, delegate, create_role, modify_role_permissions |
| `target_max_hierarchy` | INT | Highest hierarchy this action can target |
| `target_role_ids` | UUID[] nullable | Restrict to specific roles |
| `target_permissions` | TEXT[] nullable | Restrict delegatable permissions |
| `requires_reason` | BOOLEAN default false | |
| `requires_approval` | BOOLEAN default false | |
| `max_duration_hours` | INT nullable | For elevations |
| `is_active` | BOOLEAN default true | |

### Approval Workflows

**Table: `delegation_approvals`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `school_id` | UUID | |
| `requested_by` | UUID not null | |
| `action` | TEXT not null | |
| `target_user_id` | UUID nullable | |
| `target_role_id` | UUID nullable | |
| `payload` | JSONB | Full request details |
| `status` | TEXT default 'pending' | pending, approved, rejected, expired |
| `decided_by` | UUID nullable | |
| `decision_reason` | TEXT nullable | |
| `decided_at` | TIMESTAMPTZ nullable | |
| `expires_at` | TIMESTAMPTZ not null | Default 72h auto-expire |
| `created_at` | TIMESTAMPTZ | |

### Validation Engine

```typescript
async function validateDelegation(req: DelegationRequest): Promise<DelegationValidation>
```

Checks in order:
1. Granter has active role in this school
2. delegation_authority grants this action to granter's role
3. Target within hierarchy limit
4. Permissions within granter's own permissions
5. Permissions within school's permission ceiling
6. Duration within max_duration_hours
7. Approval required? Create delegation_approval instead

### Cascading Revocation

When authority is removed at any level:
- All downstream role assignments revoked
- All delegation tokens invalidated
- All elevations revoked
- All pending approvals expired
- Cache invalidation: instant (Tier 1) for all affected users

Implemented as `cascade_authority_revocation(user_id, school_id)` in-transaction.

---

## OAuth2 / Developer Platform

### OAuth2 Flow

Standard Authorization Code with PKCE.

### Tables

#### `oauth_apps`

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT not null | Display name |
| `description` | TEXT | |
| `developer_id` | UUID not null | |
| `developer_org` | TEXT nullable | |
| `logo_url` | TEXT nullable | |
| `homepage_url` | TEXT nullable | |
| `privacy_policy_url` | TEXT not null | Required (minors' data) |
| `redirect_uris` | TEXT[] not null | |
| `client_id` | TEXT unique | Public identifier |
| `client_secret_hash` | TEXT not null | Bcrypt |
| `requested_scopes` | TEXT[] not null | |
| `app_type` | TEXT default 'third_party' | first_party, third_party, school_internal |
| `review_status` | TEXT default 'pending' | pending, approved, rejected, suspended |
| `reviewed_by` | UUID nullable | |
| `reviewed_at` | TIMESTAMPTZ nullable | |
| `is_active` | BOOLEAN default true | |
| `rate_limit_per_minute` | INT default 60 | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

All third-party apps require platform review before consent flow works.

#### `oauth_scopes`

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `code` | TEXT unique | e.g., read:students |
| `display_name` | TEXT not null | |
| `display_name_hi` | TEXT | Hindi (P7) |
| `description` | TEXT not null | |
| `permissions_required` | TEXT[] not null | Maps to RBAC permissions |
| `risk_level` | TEXT default 'low' | low, medium, high |
| `is_active` | BOOLEAN default true | |

#### `oauth_consents` (school-level)

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `school_id` | UUID not null | |
| `app_id` | UUID not null | |
| `consented_by` | UUID not null | institution_admin |
| `granted_scopes` | TEXT[] not null | |
| `denied_scopes` | TEXT[] | |
| `consent_type` | TEXT default 'school_wide' | |
| `expires_at` | TIMESTAMPTZ nullable | |
| `revoked_at` | TIMESTAMPTZ nullable | |
| `revoked_by` | UUID nullable | |
| `status` | TEXT default 'active' | |
| `created_at` | TIMESTAMPTZ | |

#### `oauth_tokens`

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `app_id` | UUID not null | |
| `school_id` | UUID not null | |
| `user_id` | UUID not null | |
| `access_token_hash` | TEXT not null | |
| `refresh_token_hash` | TEXT nullable | |
| `scopes` | TEXT[] not null | Effective (intersection) |
| `access_token_expires_at` | TIMESTAMPTZ | 1 hour |
| `refresh_token_expires_at` | TIMESTAMPTZ nullable | 30 days |
| `revoked_at` | TIMESTAMPTZ nullable | |
| `created_at` | TIMESTAMPTZ | |

### Triple Intersection Rule

```
Effective permissions = App's granted scopes
                        INTERSECT School's consent (granted_scopes)
                        INTERSECT Authorizing user's own RBAC permissions
```

### School-Scoped API Keys

**Table: `school_api_keys`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `school_id` | UUID not null | |
| `name` | TEXT not null | |
| `key_hash` | TEXT not null | |
| `created_by` | UUID not null | |
| `scopes` | TEXT[] not null | |
| `ip_allowlist` | INET[] nullable | |
| `rate_limit_per_minute` | INT default 30 | |
| `last_used_at` | TIMESTAMPTZ nullable | |
| `expires_at` | TIMESTAMPTZ nullable | |
| `is_active` | BOOLEAN default true | |
| `created_at` | TIMESTAMPTZ | |

### Rate Limiting

| Client Type | Default | Configurable |
|---|---|---|
| OAuth app (approved) | 60 req/min per app per school | Per-app |
| School API key | 30 req/min per key | Per-key |
| OAuth app (first_party) | 300 req/min | Platform-set |

---

## Hybrid Cache Invalidation

### Event Classification

**Tier 1 — Instant (< 5 seconds):**
Role revocation, account deactivation, impersonation terminated, OAuth consent revoked, API key deactivated, cascading revocation, elevation revoked (manual), delegation token revoked, anomaly lockout, password changed, parent-child link revoked.

**Tier 2 — Eventual (5-minute cache TTL):**
Permission granted, role assigned, elevation granted, delegation token created, school config change (non-revocation), OAuth app approved.

### Propagation Mechanism

**Tier 1: Redis cache delete + taint marker**

```typescript
async function invalidateForSecurityEvent(userIds: string[], schoolId?: string): Promise<void> {
  // 1. Delete Redis cache keys
  // 2. Delete in-memory cache (current instance)
  // 3. Set taint marker in Redis (5-second TTL)
  //    Other instances check marker before trusting local cache
}
```

Permission resolver checks taint marker before local cache:

```typescript
async function getCachedPermissions(userId: string): Promise<UserPermissions | null> {
  const tainted = await redis.get(`rbac:tainted:${userId}`);
  if (tainted) { _localCache.delete(userId); return null; }
  // ... existing cache logic ...
}
```

**Tier 2: Existing 5-minute Redis TTL (no changes)**

### Session Invalidation (Critical Events)

| Event | Session Action |
|---|---|
| Account deactivation | Revoke all Supabase sessions |
| Anomaly lockout | Revoke all + set locked_until |
| Password changed by admin | Revoke all except admin's |

### Performance Budget

| Operation | Current | With Hybrid |
|---|---|---|
| Cache hit | ~2ms Redis / ~0ms local | ~3ms / ~1ms (+taint check) |
| Cache miss | ~50ms (DB) | ~50ms (unchanged) |
| Security propagation | ~5 min | ~50ms |

---

## Admin UI — RBAC Management

### Super Admin Pages (/super-admin/rbac/)

```
rbac/
  +-- dashboard/         RBAC health overview
  +-- roles/             Platform role management
  |   +-- [role-id]/     Role detail + permission editor
  |   +-- create/        New platform role
  +-- permissions/       Permission registry browser
  +-- users/             User role assignments
  |   +-- [user-id]/     Full RBAC profile
  +-- schools/           Per-school RBAC overview
  |   +-- [school-id]/
  |       +-- roles/     School's custom roles
  |       +-- ceilings/  Permission ceiling editor
  |       +-- api-keys/  School's API keys
  |       +-- apps/      OAuth app consents
  +-- elevations/        Active + historical
  +-- impersonation/     Session manager
  +-- delegations/       Active tokens
  +-- approvals/         Pending approval queue
  +-- oauth-apps/        App registry + review
  |   +-- [app-id]/      Detail, review, suspend
  +-- audit/
      +-- events/        Searchable timeline
      +-- chain-verify/  Chain integrity checker
      +-- anomalies/     Anomaly dashboard
      +-- export/        Compliance export
```

### Institution Admin Pages (/school-admin/rbac/)

Scoped subset — own school only:

```
rbac/
  +-- roles/             School's roles (custom + inherited)
  +-- staff/             Assign roles to school staff
  +-- elevations/        Grant + view
  +-- delegations/       View active tokens
  +-- approvals/         Approval queue
  +-- api-keys/          Manage school API keys
  +-- apps/              OAuth app consents
  +-- audit/             School-scoped audit explorer
```

### Key Dashboard Widgets

- Active elevations (count, expiry)
- Active impersonation sessions
- Pending approvals (count, overdue)
- Anomalies (last 24h by type)
- Permission deny rate trend
- Audit chain status
- OAuth apps (active, pending review)
- Top schools by RBAC activity

### Notification Integration

| Event | Notified |
|---|---|
| Role assigned/revoked | Affected user |
| Elevation granted | Elevated user + school admin |
| Elevation expiring (1h before) | Elevated user |
| Delegation token first use | Granter |
| Delegation expiring (1d before) | Granter + grantee |
| Impersonation ended | Impersonated user (after session) |
| OAuth app approved | Developer |
| Consent granted | School admin confirmation |
| Anomaly detected | Super admin + school admin |
| Approval pending | Designated approver |
| Approval decided | Requester |

---

## B2C RBAC Flow — Students & Parents

### Plan-Permission Gating

Subscription plan acts as a permission modifier layer:

**Table: `plan_permission_overrides`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `plan_id` | TEXT not null | free, basic, premium, school_premium |
| `permission_code` | TEXT not null | |
| `is_granted` | BOOLEAN default true | |
| `usage_limit` | JSONB nullable | Rate/quota constraints |
| `feature_flags` | JSONB nullable | Additional constraints |

### Plan Matrix

| Permission | Free | Basic | Premium | School Premium |
|---|---|---|---|---|
| `quiz.attempt` | 5/day | 20/day | unlimited | unlimited |
| `foxy.chat` | 5 msgs/day | 30 msgs/day | unlimited | unlimited |
| `foxy.interact` | no | yes | yes | yes |
| `simulation.interact` | no | no | yes | yes |
| `report.download_own` | no | yes | yes | yes |
| `exam.create` | 2/week | 10/week | unlimited | unlimited |
| `review.practice` | basic | yes | yes | yes |
| `diagnostic.attempt` | no | 1/month | weekly | unlimited |
| `stem.observe` | no | no | yes | yes |

### Plan Gate Error Codes

| Code | Meaning | Frontend Response |
|---|---|---|
| `PERMISSION_DENIED` | No role/permission at all | Hide feature |
| `PLAN_UPGRADE_REQUIRED` | Permission exists but plan excludes it | Show upgrade prompt |
| `DAILY_LIMIT_REACHED` | Plan includes it but quota exhausted | Show "come back tomorrow" or upgrade |

### Usage Tracking

**Table: `permission_usage`**

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID not null | |
| `permission_code` | TEXT not null | |
| `school_id` | UUID nullable | |
| `period` | DATE not null | |
| `usage_count` | INT default 0 | |
| `last_used_at` | TIMESTAMPTZ | |
| UNIQUE | (user_id, permission_code, school_id, period) | |

Atomic increment on gated checks. Partitioned by date, archived by daily-cron.

### Student Onboarding (P15 Compliant)

1. Signup -> send-auth-email returns 200 (P15 rule 1)
2. Email verified -> PKCE + token_hash handled (P15 rule 3)
3. Profile creation (3-layer failsafe preserved — P15 rule 2):
   - Layer 1: Client insert -> sync_user_roles trigger -> student role + free plan assigned
   - Layer 2: /api/auth/bootstrap fallback (idempotent — P15 rule 4)
   - Layer 3: AuthContext runtime fallback
4. Onboarding: grade (string "6"-"12") + board selection
5. Dashboard loads with plan-gated permission UI

### Parent RBAC Flow

Parent permissions are always child-scoped:

1. Parent signup -> onboarding (phone + link code)
2. Link code creates guardian_student_links (status: pending)
3. Approval -> status: active -> sync_user_roles -> parent role
4. child.* permissions scoped per linked child
5. Multiple children: independent permission sets, child switcher in UI

### Parent-Plan Interaction

Parents don't have own plans. Access derived from child's plan:

**Table: `parent_plan_permission_map`**

| Parent Permission | Required Child Permission |
|---|---|---|
| `child.download_report` | `report.download_own` |
| `child.view_performance` | `progress.view_own` |

If child's plan gates `report.download_own`, parent's `child.download_report` is also gated.

### Plan Precedence for School-Enrolled Students

When student has personal plan AND school plan: **higher plan wins**.
- Student has Premium + school offers School Premium -> School Premium
- Student has Premium + school has free tier -> Premium

### Link Lifecycle

- Created (pending) -> Approved (active) -> Revocable by student, parent, or admin
- Revocation is Tier 1 (instant cache invalidation)
- Cascades: parent delegation tokens for that child revoked
- If last child unlinked: parent has zero functional permissions

### Frontend Permission Gate Component

```typescript
interface PermissionGateProps {
  permission: string;
  children: React.ReactNode;
  fallback?: 'hide' | 'lock' | 'upgrade';
  planRequired?: string;
}
```

- `hide` — feature absent from UI (role-level denial)
- `lock` — visible but disabled with lock icon (plan-gated)
- `upgrade` — visible with upgrade CTA (conversion funnel)

---

## Rollout Phases

### Phase 1: Security Hardening
- Close existing gaps (enforce resource_access_rules, wire expires_at)
- Unify audit tables into audit_events with cryptographic chaining
- Seed tutor permissions
- Add plan_permission_overrides + permission_usage for B2C gating
- Add PermissionGate component for frontend
- Instant cache invalidation for security events (taint marker)

### Phase 2: Operational Agility
- Tenant-scoped RBAC schema (school_id on all tables)
- Permission resolution engine with fast path + policy path
- Time-boxed elevation system
- Impersonation sessions
- Scoped delegation tokens
- Super admin RBAC management UI
- RBAC notification integration

### Phase 3: Multi-Tenancy
- School onboarding RBAC cloning
- Permission ceilings
- school_rbac_config
- Cascading delegation model + delegation_authority table
- Approval workflows
- Cascading revocation
- Institution admin RBAC management UI
- Teacher delegation UI

### Phase 4: Developer Platform
- OAuth2 Authorization Code + PKCE flow
- App registration + review workflow
- School consent flow + consent screen
- Triple intersection permission evaluation
- School-scoped API keys
- OAuth rate limiting
- Developer portal pages
- Forensic audit explorer + export
- Anomaly detection engine