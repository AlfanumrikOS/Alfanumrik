# Unicorn RBAC Phase 2A: Tenant-Scoped Schema + Resolution Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add school-level tenancy to all RBAC tables, update the permission resolution engine to support school-scoped lookups, school-aware caching, and a `ResolutionContext` parameter on `authorizeRequest()` — while keeping all 50+ existing API routes backward-compatible.

**Architecture:** Extends existing RBAC tables with nullable `school_id` foreign keys (NULL = platform default). The `get_user_permissions` RPC gains an optional `p_school_id` parameter. Cache keys become `rbac:perms:<user_id>:platform` and `rbac:perms:<user_id>:school:<school_id>`. A new `school_rbac_config` table controls per-school RBAC customization limits. School onboarding clones platform RBAC defaults via a `clone_platform_rbac_for_school` RPC. All existing `authorizeRequest(request, 'perm')` calls continue to work unchanged — the school context is opt-in via a new `context` property on the options parameter.

**Tech Stack:** Supabase PostgreSQL (migrations), TypeScript (Next.js), Upstash Redis, Vitest

**Spec:** `docs/superpowers/specs/2026-04-17-unicorn-rbac-design.md` — Section 1 (Foundation) + Section 2 (Resolution Engine)

**Depends on:** Phase 1 migration (`20260417100000_rbac_phase1_security_hardening.sql`) must be applied first.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql` | Add school_id to RBAC tables, school_rbac_config, permission_ceilings, updated RPC, school onboarding RPC |
| Modify | `src/lib/rbac.ts` | School-aware cache keys, ResolutionContext type, updated authorizeRequest signature, school-scoped getUserPermissions |
| Create | `src/lib/rbac-types.ts` | Extracted types shared between rbac.ts and consumers (ResolutionContext, ResolutionTrace, extended AuthorizationResult) |
| Create | `src/__tests__/rbac-school-scoped.test.ts` | Tests for school-scoped permission resolution |
| Modify | `src/__tests__/rbac.test.ts` | Verify backward compatibility of existing tests with new signature |

---

## Task 1: Migration — Add school_id to RBAC Tables

**Files:**
- Create: `supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql`

- [ ] **Step 1: Create migration with school_id columns**

```sql
-- =============================================================================
-- RBAC Phase 2A: Tenant-Scoped Schema
-- Migration: 20260417200000_rbac_phase2a_tenant_scoped_schema.sql
--
-- Adds school_id to all RBAC tables, creates school_rbac_config and
-- permission_ceilings tables, updates get_user_permissions RPC.
--
-- Depends on: 20260417100000_rbac_phase1_security_hardening.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADD school_id TO RBAC TABLES
-- NULL = platform-level default; non-NULL = school-specific override.
-- ---------------------------------------------------------------------------

-- roles: add school_id + source_role_id + is_customizable
ALTER TABLE roles ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS source_role_id UUID REFERENCES roles(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_customizable BOOLEAN DEFAULT true;

-- Drop the old unique constraint on name, replace with (school_id, name)
-- Must handle case where old constraint exists or doesn't
DO $$ BEGIN
  ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Partial unique: platform roles (school_id IS NULL) must have unique names
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_platform
  ON roles (name) WHERE school_id IS NULL;

-- School-scoped roles must have unique names within their school
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_school
  ON roles (school_id, name) WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roles_school ON roles (school_id) WHERE school_id IS NOT NULL;

-- permissions: add school_id + namespace
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS namespace TEXT DEFAULT 'platform';

CREATE INDEX IF NOT EXISTS idx_permissions_school ON permissions (school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_permissions_namespace ON permissions (namespace);

-- role_permissions: add school_id
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_role_permissions_school
  ON role_permissions (school_id) WHERE school_id IS NOT NULL;

-- user_roles: add school_id
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_roles_school
  ON user_roles (school_id) WHERE school_id IS NOT NULL;

-- user_roles unique constraint: allow same user+role in different schools
-- Drop old constraint, add new one
DO $$ BEGIN
  ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_auth_user_id_role_id_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique_platform
  ON user_roles (auth_user_id, role_id) WHERE school_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique_school
  ON user_roles (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL;

-- resource_access_rules: add school_id
ALTER TABLE resource_access_rules ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_resource_access_rules_school
  ON resource_access_rules (school_id) WHERE school_id IS NOT NULL;
```

- [ ] **Step 2: Verify migration syntax**

Run: `head -60 supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql`
Expected: SQL prints without syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql
git commit -m "feat(rbac): add school_id tenant scope to RBAC tables"
```

---

## Task 2: Migration — school_rbac_config + permission_ceilings

**Files:**
- Modify: `supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql`

- [ ] **Step 1: Append school_rbac_config table**

```sql
-- ---------------------------------------------------------------------------
-- 2. SCHOOL RBAC CONFIG — per-school RBAC settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_rbac_config (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  allow_custom_roles BOOLEAN NOT NULL DEFAULT true,
  max_custom_roles INT NOT NULL DEFAULT 10,
  allow_custom_permissions BOOLEAN NOT NULL DEFAULT false,
  max_hierarchy_level INT NOT NULL DEFAULT 70,
  delegation_enabled BOOLEAN NOT NULL DEFAULT true,
  max_delegation_depth INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE school_rbac_config ENABLE ROW LEVEL SECURITY;

-- Service role can manage all configs
CREATE POLICY school_rbac_config_service ON school_rbac_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can read their school's config
CREATE POLICY school_rbac_config_read ON school_rbac_config
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT s.school_id FROM school_memberships s
      WHERE s.auth_user_id = auth.uid() AND s.is_active = true
    )
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_rbac_config_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_rbac_config_updated_at ON school_rbac_config;
CREATE TRIGGER trg_school_rbac_config_updated_at
  BEFORE UPDATE ON school_rbac_config
  FOR EACH ROW EXECUTE FUNCTION update_school_rbac_config_updated_at();
```

- [ ] **Step 2: Append permission_ceilings table**

```sql
-- ---------------------------------------------------------------------------
-- 3. PERMISSION CEILINGS — what a school is allowed to grant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_ceilings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_grantable BOOLEAN NOT NULL DEFAULT true,
  max_scope JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_permission_ceilings_school
  ON permission_ceilings (school_id);

ALTER TABLE permission_ceilings ENABLE ROW LEVEL SECURITY;

CREATE POLICY permission_ceilings_service ON permission_ceilings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY permission_ceilings_read ON permission_ceilings
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT s.school_id FROM school_memberships s
      WHERE s.auth_user_id = auth.uid() AND s.is_active = true
    )
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql
git commit -m "feat(rbac): add school_rbac_config and permission_ceilings tables"
```

---

## Task 3: Migration — Updated get_user_permissions RPC

**Files:**
- Modify: `supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql`

- [ ] **Step 1: Append updated RPC with optional school_id parameter**

```sql
-- ---------------------------------------------------------------------------
-- 4. UPDATED get_user_permissions RPC
-- Now accepts optional p_school_id. When provided:
--   - Fetches school-scoped roles (user_roles WHERE school_id = p_school_id)
--   - Merges with platform roles (user_roles WHERE school_id IS NULL)
--   - Returns union of permissions from both sets
-- When p_school_id is NULL (default): identical to original behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_permissions(
  p_auth_user_id UUID,
  p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(DISTINCT
        jsonb_build_object(
          'name', r.name,
          'display_name', r.display_name,
          'hierarchy_level', r.hierarchy_level,
          'school_id', ur.school_id
        )
      )
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.is_active = true
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND (
          -- Platform roles (always included)
          ur.school_id IS NULL
          -- School-scoped roles (only when school_id is requested or all)
          OR (p_school_id IS NOT NULL AND ur.school_id = p_school_id)
          OR p_school_id IS NULL  -- NULL means "all schools"
        )
    ), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT jsonb_agg(DISTINCT p.code)
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.is_active = true
      JOIN role_permissions rp ON rp.role_id = ur.role_id
        AND (rp.school_id IS NULL OR rp.school_id = ur.school_id)
      JOIN permissions p ON p.id = rp.permission_id AND p.is_active = true
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND (
          ur.school_id IS NULL
          OR (p_school_id IS NOT NULL AND ur.school_id = p_school_id)
          OR p_school_id IS NULL
        )
    ), '[]'::jsonb),
    'school_id', to_jsonb(p_school_id)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql
git commit -m "feat(rbac): update get_user_permissions RPC with school_id support"
```

---

## Task 4: Migration — School RBAC Onboarding RPC

**Files:**
- Modify: `supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql`

- [ ] **Step 1: Append clone_platform_rbac_for_school RPC**

```sql
-- ---------------------------------------------------------------------------
-- 5. SCHOOL ONBOARDING: Clone platform RBAC defaults
-- Called when a new school is created. Copies platform roles and
-- role_permissions into school-scoped rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clone_platform_rbac_for_school(
  p_school_id UUID,
  p_admin_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles_cloned INT := 0;
  v_perms_cloned INT := 0;
  v_role_record RECORD;
  v_new_role_id UUID;
BEGIN
  -- 1. Create school_rbac_config with defaults
  INSERT INTO school_rbac_config (school_id)
  VALUES (p_school_id)
  ON CONFLICT (school_id) DO NOTHING;

  -- 2. Clone customizable platform roles (school_id IS NULL, is_customizable = true)
  FOR v_role_record IN
    SELECT id, name, display_name, display_name_hi, description, hierarchy_level
    FROM roles
    WHERE school_id IS NULL
      AND is_active = true
      AND is_customizable = true
      AND name NOT IN ('super_admin', 'admin')  -- Never clone platform admin roles
  LOOP
    INSERT INTO roles (
      name, display_name, display_name_hi, description,
      hierarchy_level, is_system_role, is_active,
      school_id, source_role_id, is_customizable
    ) VALUES (
      v_role_record.name,
      v_role_record.display_name,
      v_role_record.display_name_hi,
      v_role_record.description,
      v_role_record.hierarchy_level,
      false,  -- School-cloned roles are not system roles
      true,
      p_school_id,
      v_role_record.id,  -- Track source for upgrade sync
      true
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_role_id;

    IF v_new_role_id IS NOT NULL THEN
      v_roles_cloned := v_roles_cloned + 1;

      -- Clone role_permissions for this role
      INSERT INTO role_permissions (role_id, permission_id, school_id, granted_by)
      SELECT v_new_role_id, rp.permission_id, p_school_id, p_admin_user_id
      FROM role_permissions rp
      WHERE rp.role_id = v_role_record.id
        AND rp.school_id IS NULL  -- Only clone platform-level grants
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_perms_cloned = v_perms_cloned + ROW_COUNT;
    END IF;
  END LOOP;

  -- 3. Seed permission ceilings (all platform permissions grantable by default)
  INSERT INTO permission_ceilings (school_id, permission_id, is_grantable)
  SELECT p_school_id, p.id, true
  FROM permissions p
  WHERE p.school_id IS NULL
    AND p.is_active = true
    AND p.code NOT LIKE 'system.%'  -- System permissions not grantable to schools
    AND p.code NOT LIKE 'analytics.%'  -- Global analytics not school-grantable
  ON CONFLICT (school_id, permission_id) DO NOTHING;

  -- 4. If admin user provided, assign institution_admin role
  IF p_admin_user_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
    SELECT p_admin_user_id, r.id, p_school_id, true
    FROM roles r
    WHERE r.name = 'institution_admin'
      AND r.school_id = p_school_id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'school_id', p_school_id,
    'roles_cloned', v_roles_cloned,
    'permissions_cloned', v_perms_cloned
  );
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql
git commit -m "feat(rbac): add clone_platform_rbac_for_school onboarding RPC"
```

---

## Task 5: Extract Shared Types to rbac-types.ts

Separate the types that consumers (plan-gate, audit-pipeline, API routes) need from the implementation details in rbac.ts.

**Files:**
- Create: `src/lib/rbac-types.ts`

- [ ] **Step 1: Create rbac-types.ts with shared types**

```typescript
// src/lib/rbac-types.ts
/**
 * ALFANUMRIK — RBAC Shared Types
 *
 * Types used by rbac.ts and its consumers (plan-gate, audit-pipeline, API routes).
 * Extracted to avoid circular imports and keep rbac.ts focused on implementation.
 */

export type RoleName =
  | 'student' | 'parent' | 'teacher' | 'tutor'
  | 'admin' | 'super_admin'
  | 'institution_admin' | 'content_manager' | 'reviewer' | 'support' | 'finance';

export type OwnershipType = 'own' | 'linked' | 'assigned' | 'any';

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

/** Context for school-scoped and policy-path resolution */
export interface ResolutionContext {
  schoolId?: string;
  resourceType?: string;
  resourceId?: string;
  delegationToken?: string;
  impersonationSession?: string;
  oauthAppId?: string;
  ipAddress?: string;
}

/** Trace produced by every permission resolution (feeds forensic audit) */
export interface ResolutionTrace {
  userId: string;
  permission: string;
  granted: boolean;
  resolvedVia:
    | 'direct'
    | 'delegation'
    | 'elevation'
    | 'impersonation'
    | 'oauth'
    | 'super_admin_bypass'
    | 'plan_gated';
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/rbac-types.ts
git commit -m "refactor(rbac): extract shared types to rbac-types.ts"
```

---

## Task 6: Update rbac.ts — School-Aware Cache + Resolution

The core changes to `rbac.ts`: school-aware cache keys, updated `getUserPermissions` to accept school_id, and extended `authorizeRequest` signature with `context`.

**Files:**
- Modify: `src/lib/rbac.ts`
- Create: `src/__tests__/rbac-school-scoped.test.ts`

- [ ] **Step 1: Write failing tests for school-scoped resolution**

```typescript
// src/__tests__/rbac-school-scoped.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Redis ──
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisDel = vi.fn().mockResolvedValue(1);

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  })),
}));

// ── Mock Supabase ──
const mockRpc = vi.fn();
const mockFrom = vi.fn(() => ({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}));
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'test-user' } },
  error: null,
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { getUser: mockGetUser },
  }),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Import after mocks
import { getUserPermissions } from '@/lib/rbac';

describe('School-Scoped Permission Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call RPC without school_id for platform-wide lookup', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }],
        permissions: ['quiz.attempt'],
        school_id: null,
      },
      error: null,
    });

    const perms = await getUserPermissions('user-1');
    expect(mockRpc).toHaveBeenCalledWith('get_user_permissions', {
      p_auth_user_id: 'user-1',
    });
    expect(perms.permissions).toContain('quiz.attempt');
  });

  it('should call RPC with school_id for school-scoped lookup', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        roles: [
          { name: 'student', display_name: 'Student', hierarchy_level: 10 },
          { name: 'teacher', display_name: 'Teacher', hierarchy_level: 50, school_id: 'school-1' },
        ],
        permissions: ['quiz.attempt', 'class.manage'],
        school_id: 'school-1',
      },
      error: null,
    });

    const perms = await getUserPermissions('user-1', 'school-1');
    expect(mockRpc).toHaveBeenCalledWith('get_user_permissions', {
      p_auth_user_id: 'user-1',
      p_school_id: 'school-1',
    });
    expect(perms.permissions).toContain('class.manage');
    expect(perms.schoolId).toBe('school-1');
  });

  it('should use different cache keys for platform vs school lookups', async () => {
    // First call: platform
    mockRpc.mockResolvedValueOnce({
      data: { roles: [{ name: 'student', display_name: 'Student', hierarchy_level: 10 }], permissions: ['quiz.attempt'] },
      error: null,
    });
    await getUserPermissions('user-1');

    // Second call: same user, different school — should NOT use cached result
    mockRpc.mockResolvedValueOnce({
      data: { roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }], permissions: ['class.manage'] },
      error: null,
    });
    await getUserPermissions('user-1', 'school-1');

    // Both calls should have hit the RPC (different cache keys)
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('should throw on RPC error (not return empty perms)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC failed' },
    });

    await expect(getUserPermissions('user-1')).rejects.toThrow('Permission lookup failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/rbac-school-scoped.test.ts`
Expected: FAIL — getUserPermissions doesn't accept school_id parameter yet.

- [ ] **Step 3: Update CACHE_KEY to support school scoping**

In `src/lib/rbac.ts`, replace the cache key definition (around line 62):

```typescript
// Old:
const CACHE_KEY = (uid: string) => `rbac:perms:${uid}`;

// New:
const CACHE_KEY = (uid: string, schoolId?: string | null) =>
  schoolId ? `rbac:perms:${uid}:school:${schoolId}` : `rbac:perms:${uid}:platform`;
```

- [ ] **Step 4: Update getUserPermissions to accept optional schoolId**

Replace the existing `getUserPermissions` function (around line 125-147):

```typescript
/**
 * Get all permissions for a user (server-side, with caching).
 * When schoolId is provided, returns school-scoped permissions merged with platform.
 * When schoolId is omitted/null, returns platform-wide permissions (backward compat).
 */
export async function getUserPermissions(
  authUserId: string,
  schoolId?: string | null,
): Promise<UserPermissions> {
  const cached = await getCachedPermissions(authUserId, schoolId);
  if (cached) return cached;

  const supabase = getServiceClient();
  const rpcParams: Record<string, string> = { p_auth_user_id: authUserId };
  if (schoolId) rpcParams.p_school_id = schoolId;

  const { data, error } = await supabase.rpc('get_user_permissions', rpcParams);

  if (error || !data) {
    logger.error('rbac_permissions_failed', { error: error ? new Error(error.message) : new Error('unknown'), route: 'rbac' });
    throw new Error(`Permission lookup failed: ${error?.message ?? 'no data returned'}`);
  }

  const result: UserPermissions = {
    roles: data.roles || [],
    permissions: data.permissions || [],
  };
  if (schoolId) (result as any).schoolId = schoolId;

  await setCachedPermissions(authUserId, result, schoolId);
  return result;
}
```

- [ ] **Step 5: Update getCachedPermissions and setCachedPermissions signatures**

Update `getCachedPermissions` to pass schoolId through to CACHE_KEY:

```typescript
async function getCachedPermissions(userId: string, schoolId?: string | null): Promise<UserPermissions | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const tainted = await redis.get(`rbac:tainted:${userId}`);
      if (tainted) {
        _localCache.delete(CACHE_KEY(userId, schoolId));
        return null;
      }
    } catch { /* Redis unavailable */ }
  }
  if (redis) {
    try {
      const raw = await redis.get<UserPermissions>(CACHE_KEY(userId, schoolId));
      return raw ?? null;
    } catch { /* fall through */ }
  }
  const local = _localCache.get(CACHE_KEY(userId, schoolId));
  if (local && local.expires > Date.now()) return local.data;
  if (local) _localCache.delete(CACHE_KEY(userId, schoolId));
  return null;
}

async function setCachedPermissions(userId: string, data: UserPermissions, schoolId?: string | null): Promise<void> {
  const key = CACHE_KEY(userId, schoolId);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, data, { ex: CACHE_TTL_SECS });
      return;
    } catch { /* fall through */ }
  }
  _localCache.set(key, { data, expires: Date.now() + CACHE_TTL_SECS * 1000 });
  if (_localCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _localCache.entries()) {
      if (v.expires < now) _localCache.delete(k);
    }
  }
}
```

- [ ] **Step 6: Update invalidatePermissionCache to clear all school variants**

```typescript
export async function invalidatePermissionCache(userId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      // Delete platform cache key
      await redis.del(CACHE_KEY(userId));
      // Note: school-specific keys are cleared by invalidateForSecurityEvent
      // which already handles the taint marker approach
    } catch { /* ignore */ }
  }
  // Clear all local cache entries for this user (platform + school variants)
  for (const key of _localCache.keys()) {
    if (key.startsWith(`rbac:perms:${userId}:`)) {
      _localCache.delete(key);
    }
  }
}
```

- [ ] **Step 7: Update authorizeRequest options to accept context**

Update the options type in `authorizeRequest` (around line 344):

```typescript
export async function authorizeRequest(
  request: Request,
  requiredPermission?: string,
  options?: {
    requireStudentId?: boolean;
    resourceCheck?: { type: string; id: string };
    context?: { schoolId?: string };
  }
): Promise<AuthorizationResult> {
```

And update the permission lookup call (around line 403):

```typescript
  // 2. Get user permissions (school-scoped if context provided)
  let perms: UserPermissions;
  try {
    perms = await getUserPermissions(authUserId, options?.context?.schoolId);
  } catch (permError) {
```

And update the return value to include schoolId (around line 491):

```typescript
  return {
    authorized: true,
    userId: authUserId,
    studentId,
    roles: perms.roles.map(r => r.name as RoleName),
    permissions: perms.permissions,
    schoolId: options?.context?.schoolId ?? null,
  };
```

- [ ] **Step 8: Run school-scoped tests**

Run: `npx vitest run src/__tests__/rbac-school-scoped.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 9: Run existing RBAC tests for backward compatibility**

Run: `npx vitest run src/__tests__/rbac.test.ts`
Expected: PASS — all existing tests still pass (no school_id = same behavior).

- [ ] **Step 10: Commit**

```bash
git add src/lib/rbac.ts src/lib/rbac-types.ts src/__tests__/rbac-school-scoped.test.ts
git commit -m "feat(rbac): school-aware cache keys, scoped getUserPermissions, context in authorizeRequest"
```

---

## Task 7: Full Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all new RBAC tests**

Run: `npx vitest run src/__tests__/rbac-school-scoped.test.ts src/__tests__/rbac.test.ts src/__tests__/rbac-plan-integration.test.ts src/__tests__/plan-gate.test.ts src/__tests__/audit-pipeline.test.ts src/__tests__/permission-gate.test.tsx`
Expected: All pass.

- [ ] **Step 2: Run type-check**

Run: `npm run type-check 2>&1 | tail -10`
Expected: No new errors from Phase 2A files.

- [ ] **Step 3: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 4: Commit fixups if needed**

```bash
git add -A && git commit -m "chore(rbac): phase 2A verification fixups"
```

---

## Summary

| Task | What It Delivers |
|---|---|
| 1 | school_id columns on roles, permissions, role_permissions, user_roles, resource_access_rules |
| 2 | school_rbac_config + permission_ceilings tables with RLS |
| 3 | Updated get_user_permissions RPC with optional school_id |
| 4 | clone_platform_rbac_for_school onboarding RPC |
| 5 | Shared types in rbac-types.ts (ResolutionContext, ResolutionTrace, etc.) |
| 6 | School-aware cache keys, scoped getUserPermissions, context in authorizeRequest |
| 7 | Full verification — all tests pass, type-check clean |

**Backward compatibility:** All existing `authorizeRequest(request, 'perm')` calls work identically — no school_id means platform-wide lookup. New callers can pass `{ context: { schoolId: 'xxx' } }` to get school-scoped permissions.

**Next:** Phase 2B (Temporary Access System) — role elevations, impersonation sessions, delegation tokens.