# Unicorn RBAC Phase 2B: Temporary Access System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three temporary access mechanisms — time-boxed role elevations, read-only impersonation sessions, and scoped delegation tokens — each integrated into the RBAC permission resolver with full audit trail and cascading revocation.

**Architecture:** Three new DB tables + three TypeScript manager modules. Each manager handles CRUD + validation for its mechanism. The managers are wired into the existing `authorizeRequest()` via the `ResolutionContext` (from Phase 2A) — when `context.delegationToken` or `context.impersonationSession` is present, the resolver calls the corresponding manager. All writes produce `audit_events` entries. Revocations trigger instant cache invalidation via `invalidateForSecurityEvent()`.

**Tech Stack:** Supabase PostgreSQL (migrations), TypeScript (Next.js), Vitest

**Spec:** `docs/superpowers/specs/2026-04-17-unicorn-rbac-design.md` — Section 4 (Temporary Access) + Section 5 (Cascading Delegation)

**Depends on:** Phase 2A migration (school_id on RBAC tables, rbac-types.ts, school-aware authorizeRequest)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260417300000_rbac_phase2b_temporary_access.sql` | role_elevations, impersonation_sessions, delegation_tokens tables + validation RPCs |
| Create | `src/lib/rbac-elevation.ts` | Create, validate, expire, revoke role elevations |
| Create | `src/lib/rbac-impersonation.ts` | Start, validate, end impersonation sessions |
| Create | `src/lib/rbac-delegation.ts` | Create, validate, revoke delegation tokens |
| Create | `src/__tests__/rbac-elevation.test.ts` | Tests for elevation manager |
| Create | `src/__tests__/rbac-impersonation.test.ts` | Tests for impersonation manager |
| Create | `src/__tests__/rbac-delegation.test.ts` | Tests for delegation manager |

---

## Task 1: Migration — role_elevations, impersonation_sessions, delegation_tokens

**Files:**
- Create: `supabase/migrations/20260417300000_rbac_phase2b_temporary_access.sql`

- [ ] **Step 1: Create migration with all three tables**

```sql
-- =============================================================================
-- RBAC Phase 2B: Temporary Access System
-- Migration: 20260417300000_rbac_phase2b_temporary_access.sql
--
-- Three mechanisms:
--   1. role_elevations — time-boxed temporary role grants
--   2. impersonation_sessions — read-only "view as" for admins/support
--   3. delegation_tokens — scoped permission sharing (teacher → parent)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ROLE ELEVATIONS
-- A higher-authority user grants someone a temporary role upgrade.
-- Auto-revokes on expiry. Granter must have higher hierarchy_level.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_elevations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  elevated_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  original_roles JSONB NOT NULL DEFAULT '[]',
  granted_by UUID NOT NULL,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_duration_hours INT NOT NULL DEFAULT 48,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_elevations_user
  ON role_elevations (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_role_elevations_school
  ON role_elevations (school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_role_elevations_expires
  ON role_elevations (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_role_elevations_granted_by
  ON role_elevations (granted_by);

ALTER TABLE role_elevations ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_elevations_service ON role_elevations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY role_elevations_read_own ON role_elevations
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR granted_by = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

-- ---------------------------------------------------------------------------
-- 2. IMPERSONATION SESSIONS
-- Enhanced version of admin_impersonation_sessions with action counting,
-- auto-termination, and read-only enforcement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  permissions_granted TEXT[] NOT NULL DEFAULT '{read}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  ended_at TIMESTAMPTZ,
  ended_reason TEXT CHECK (ended_reason IS NULL OR ended_reason IN (
    'manual', 'expired', 'anomaly_auto_terminate'
  )),
  action_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended', 'expired', 'terminated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impersonation_active
  ON impersonation_sessions (admin_user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_impersonation_target
  ON impersonation_sessions (target_user_id) WHERE status = 'active';

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY impersonation_service ON impersonation_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY impersonation_read ON impersonation_sessions
  FOR SELECT TO authenticated
  USING (
    admin_user_id = auth.uid()
    OR target_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

-- ---------------------------------------------------------------------------
-- 3. DELEGATION TOKENS
-- Scoped, time-limited permission sharing.
-- Token hash stored (actual token shown once, like an API key).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  granter_user_id UUID NOT NULL,
  grantee_user_id UUID,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  permissions TEXT[] NOT NULL,
  resource_scope JSONB,
  max_uses INT,
  use_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'exhausted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delegation_token_hash
  ON delegation_tokens (token_hash) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_delegation_granter
  ON delegation_tokens (granter_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_delegation_school
  ON delegation_tokens (school_id);

ALTER TABLE delegation_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY delegation_service ON delegation_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY delegation_read ON delegation_tokens
  FOR SELECT TO authenticated
  USING (
    granter_user_id = auth.uid()
    OR grantee_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

-- ---------------------------------------------------------------------------
-- 4. EXPIRE STALE RECORDS (called by daily-cron)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_temporary_access()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elevations INT;
  v_sessions INT;
  v_tokens INT;
BEGIN
  UPDATE role_elevations
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= now();
  GET DIAGNOSTICS v_elevations = ROW_COUNT;

  UPDATE impersonation_sessions
  SET status = 'expired', ended_at = now(), ended_reason = 'expired'
  WHERE status = 'active' AND expires_at <= now();
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  UPDATE delegation_tokens
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= now();
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  RETURN jsonb_build_object(
    'elevations_expired', v_elevations,
    'sessions_expired', v_sessions,
    'tokens_expired', v_tokens
  );
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260417300000_rbac_phase2b_temporary_access.sql
git commit -m "feat(rbac): add role_elevations, impersonation_sessions, delegation_tokens tables"
```

---

## Task 2: Elevation Manager

**Files:**
- Create: `src/lib/rbac-elevation.ts`
- Create: `src/__tests__/rbac-elevation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/rbac-elevation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'elev-1' }, error: null }) });
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'elev-1', status: 'revoked' }, error: null }) }) });
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        data: [],
        error: null,
      }),
    }),
  }),
});
const mockFrom = vi.fn(() => ({ insert: mockInsert, update: mockUpdate, select: mockSelect }));
const mockRpc = vi.fn().mockResolvedValue({
  data: { roles: [{ name: 'admin', hierarchy_level: 90 }], permissions: ['role.manage'] },
  error: null,
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom, rpc: mockRpc }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/audit-pipeline', () => ({ writeAuditEvent: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn().mockResolvedValue({
    roles: [{ name: 'admin', hierarchy_level: 90 }],
    permissions: ['role.manage'],
  }),
  invalidateForSecurityEvent: vi.fn(),
}));

import { grantElevation, revokeElevation, getActiveElevations, type ElevationGrant } from '@/lib/rbac-elevation';

describe('Role Elevation Manager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should create an elevation grant with required fields', async () => {
    const grant: ElevationGrant = {
      userId: 'user-1',
      elevatedRoleId: 'role-teacher',
      grantedBy: 'admin-1',
      reason: 'Covering for principal on leave',
      durationHours: 48,
      schoolId: 'school-1',
    };

    const result = await grantElevation(grant);
    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('role_elevations');
  });

  it('should reject elevation without a reason', async () => {
    const result = await grantElevation({
      userId: 'user-1',
      elevatedRoleId: 'role-teacher',
      grantedBy: 'admin-1',
      reason: '',
      durationHours: 48,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('reason');
  });

  it('should reject elevation exceeding max duration (168h)', async () => {
    const result = await grantElevation({
      userId: 'user-1',
      elevatedRoleId: 'role-teacher',
      grantedBy: 'admin-1',
      reason: 'Testing',
      durationHours: 200,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('duration');
  });

  it('should revoke an elevation and trigger cache invalidation', async () => {
    const { invalidateForSecurityEvent } = await import('@/lib/rbac');
    const result = await revokeElevation('elev-1', 'admin-1');
    expect(result.success).toBe(true);
    expect(invalidateForSecurityEvent).toHaveBeenCalled();
  });

  it('should return active elevations for a user', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'elev-1', status: 'active', expires_at: new Date(Date.now() + 86400000).toISOString() }],
              error: null,
            }),
          }),
        }),
      }),
    });

    const elevations = await getActiveElevations('user-1');
    expect(elevations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/rbac-elevation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement elevation manager**

```typescript
// src/lib/rbac-elevation.ts
/**
 * ALFANUMRIK — Role Elevation Manager
 *
 * Handles time-boxed temporary role grants.
 * Validates hierarchy, duration limits, and mandatory justification.
 * Revocations trigger instant cache invalidation.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { writeAuditEvent } from '@/lib/audit-pipeline';
import { invalidateForSecurityEvent } from '@/lib/rbac';

const MAX_DURATION_HOURS = 168; // 7 days platform ceiling

export interface ElevationGrant {
  userId: string;
  elevatedRoleId: string;
  grantedBy: string;
  reason: string;
  durationHours: number;
  schoolId?: string;
}

export interface ElevationResult {
  success: boolean;
  elevationId?: string;
  error?: string;
}

export async function grantElevation(grant: ElevationGrant): Promise<ElevationResult> {
  // Validate
  if (!grant.reason || grant.reason.trim().length === 0) {
    return { success: false, error: 'Elevation requires a reason' };
  }
  if (grant.durationHours <= 0 || grant.durationHours > MAX_DURATION_HOURS) {
    return { success: false, error: `Duration must be 1-${MAX_DURATION_HOURS} hours` };
  }

  try {
    const supabase = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + grant.durationHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase.from('role_elevations').insert({
      user_id: grant.userId,
      school_id: grant.schoolId ?? null,
      elevated_role_id: grant.elevatedRoleId,
      granted_by: grant.grantedBy,
      reason: grant.reason.trim(),
      expires_at: expiresAt,
      max_duration_hours: grant.durationHours,
      status: 'active',
    }).select('id').single();

    if (error) {
      logger.error('elevation_grant_failed', { error: new Error(error.message), route: 'rbac-elevation' });
      return { success: false, error: error.message };
    }

    // Invalidate cache so elevated permissions take effect
    await invalidateForSecurityEvent([grant.userId], 'elevation_granted');

    await writeAuditEvent({
      eventType: 'role_change',
      actorUserId: grant.grantedBy,
      effectiveUserId: grant.userId,
      schoolId: grant.schoolId,
      action: 'elevate',
      result: 'granted',
      resourceType: 'role_elevation',
      resourceId: data.id,
      metadata: { reason: grant.reason, durationHours: grant.durationHours, roleId: grant.elevatedRoleId },
    });

    return { success: true, elevationId: data.id };
  } catch (e) {
    logger.error('elevation_grant_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-elevation' });
    return { success: false, error: 'Internal error' };
  }
}

export async function revokeElevation(elevationId: string, revokedBy: string): Promise<ElevationResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('role_elevations')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: revokedBy })
      .eq('id', elevationId)
      .eq('status', 'active')
      .select('user_id')
      .single();

    if (error || !data) {
      return { success: false, error: error?.message ?? 'Elevation not found or already revoked' };
    }

    await invalidateForSecurityEvent([data.user_id], 'elevation_revoked');

    await writeAuditEvent({
      eventType: 'role_change',
      actorUserId: revokedBy,
      effectiveUserId: data.user_id,
      action: 'revoke',
      result: 'granted',
      resourceType: 'role_elevation',
      resourceId: elevationId,
    });

    return { success: true };
  } catch (e) {
    logger.error('elevation_revoke_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-elevation' });
    return { success: false, error: 'Internal error' };
  }
}

export async function getActiveElevations(userId: string, schoolId?: string): Promise<any[]> {
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase.from('role_elevations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('expires_at', { ascending: true });

    if (schoolId) query = query.eq('school_id', schoolId);

    const { data, error } = await query;
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/rbac-elevation.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rbac-elevation.ts src/__tests__/rbac-elevation.test.ts
git commit -m "feat(rbac): add role elevation manager with validation and audit"
```

---

## Task 3: Impersonation Manager

**Files:**
- Create: `src/lib/rbac-impersonation.ts`
- Create: `src/__tests__/rbac-impersonation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/rbac-impersonation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'session-1' }, error: null }) });
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'session-1' }, error: null }) }) }) });
const mockSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'session-1', status: 'active', admin_user_id: 'admin-1', target_user_id: 'user-1', action_count: 5, expires_at: new Date(Date.now() + 1800000).toISOString() }, error: null });
const mockFrom = vi.fn(() => ({ insert: mockInsert, update: mockUpdate, select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSelectSingle }) }) }) }));

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({ from: mockFrom }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/audit-pipeline', () => ({ writeAuditEvent: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ invalidateForSecurityEvent: vi.fn() }));

import { startImpersonation, validateImpersonation, endImpersonation } from '@/lib/rbac-impersonation';

describe('Impersonation Manager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should start an impersonation session with reason', async () => {
    const result = await startImpersonation({
      adminUserId: 'admin-1',
      targetUserId: 'user-1',
      reason: 'Debugging student dashboard issue',
      maxMinutes: 30,
    });
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('session-1');
  });

  it('should reject impersonation without reason', async () => {
    const result = await startImpersonation({
      adminUserId: 'admin-1',
      targetUserId: 'user-1',
      reason: '',
      maxMinutes: 30,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('reason');
  });

  it('should reject impersonation exceeding 60 minutes', async () => {
    const result = await startImpersonation({
      adminUserId: 'admin-1',
      targetUserId: 'user-1',
      reason: 'Testing',
      maxMinutes: 90,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('60 minutes');
  });

  it('should validate an active session and increment action count', async () => {
    const result = await validateImpersonation('session-1');
    expect(result.valid).toBe(true);
    expect(result.readOnly).toBe(true);
  });

  it('should end a session', async () => {
    const result = await endImpersonation('session-1', 'manual');
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Implement impersonation manager**

```typescript
// src/lib/rbac-impersonation.ts
/**
 * ALFANUMRIK — Impersonation Session Manager
 *
 * Read-only "view as" capability for admins and support.
 * All actions during impersonation are audited with both actor and effective user.
 * Write operations are blocked (enforced by the resolver, not this module).
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { writeAuditEvent } from '@/lib/audit-pipeline';

const MAX_MINUTES = 60;
const MAX_ACTIONS = 50;

export interface StartImpersonationInput {
  adminUserId: string;
  targetUserId: string;
  reason: string;
  maxMinutes?: number;
  schoolId?: string;
}

export interface ImpersonationResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface ImpersonationValidation {
  valid: boolean;
  readOnly: boolean;
  adminUserId?: string;
  targetUserId?: string;
  error?: string;
}

export async function startImpersonation(input: StartImpersonationInput): Promise<ImpersonationResult> {
  if (!input.reason || input.reason.trim().length === 0) {
    return { success: false, error: 'Impersonation requires a reason' };
  }
  const minutes = input.maxMinutes ?? 30;
  if (minutes <= 0 || minutes > MAX_MINUTES) {
    return { success: false, error: `Duration must be 1-${MAX_MINUTES} minutes` };
  }

  try {
    const supabase = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const { data, error } = await supabase.from('impersonation_sessions').insert({
      admin_user_id: input.adminUserId,
      target_user_id: input.targetUserId,
      school_id: input.schoolId ?? null,
      reason: input.reason.trim(),
      expires_at: expiresAt,
      permissions_granted: ['read'],
      status: 'active',
    }).select('id').single();

    if (error) {
      logger.error('impersonation_start_failed', { error: new Error(error.message), route: 'rbac-impersonation' });
      return { success: false, error: error.message };
    }

    await writeAuditEvent({
      eventType: 'impersonation_start',
      actorUserId: input.adminUserId,
      effectiveUserId: input.targetUserId,
      schoolId: input.schoolId,
      action: 'impersonate',
      result: 'granted',
      resourceType: 'impersonation_session',
      resourceId: data.id,
      metadata: { reason: input.reason, maxMinutes: minutes },
    });

    return { success: true, sessionId: data.id };
  } catch (e) {
    logger.error('impersonation_start_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-impersonation' });
    return { success: false, error: 'Internal error' };
  }
}

export async function validateImpersonation(sessionId: string): Promise<ImpersonationValidation> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('impersonation_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('status', 'active')
      .single();

    if (error || !data) return { valid: false, readOnly: true, error: 'Session not found or inactive' };

    const now = new Date();
    if (new Date(data.expires_at) <= now) {
      await endImpersonation(sessionId, 'expired');
      return { valid: false, readOnly: true, error: 'Session expired' };
    }

    if (data.action_count >= MAX_ACTIONS) {
      await endImpersonation(sessionId, 'anomaly_auto_terminate');
      return { valid: false, readOnly: true, error: 'Action limit reached' };
    }

    // Increment action count
    await supabase.from('impersonation_sessions')
      .update({ action_count: data.action_count + 1 })
      .eq('id', sessionId);

    return {
      valid: true,
      readOnly: true,
      adminUserId: data.admin_user_id,
      targetUserId: data.target_user_id,
    };
  } catch (e) {
    logger.error('impersonation_validate_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-impersonation' });
    return { valid: false, readOnly: true, error: 'Validation failed' };
  }
}

export async function endImpersonation(
  sessionId: string,
  reason: 'manual' | 'expired' | 'anomaly_auto_terminate' = 'manual',
): Promise<ImpersonationResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('impersonation_sessions')
      .update({ status: reason === 'manual' ? 'ended' : reason === 'expired' ? 'expired' : 'terminated', ended_at: new Date().toISOString(), ended_reason: reason })
      .eq('id', sessionId)
      .eq('status', 'active')
      .select('admin_user_id, target_user_id')
      .single();

    if (error || !data) return { success: false, error: 'Session not found' };

    await writeAuditEvent({
      eventType: 'impersonation_end',
      actorUserId: data.admin_user_id,
      effectiveUserId: data.target_user_id,
      action: 'revoke',
      result: 'granted',
      resourceType: 'impersonation_session',
      resourceId: sessionId,
      metadata: { reason },
    });

    return { success: true };
  } catch (e) {
    logger.error('impersonation_end_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-impersonation' });
    return { success: false, error: 'Internal error' };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/rbac-impersonation.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rbac-impersonation.ts src/__tests__/rbac-impersonation.test.ts
git commit -m "feat(rbac): add impersonation session manager with read-only enforcement"
```

---

## Task 4: Delegation Token Manager

**Files:**
- Create: `src/lib/rbac-delegation.ts`
- Create: `src/__tests__/rbac-delegation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/rbac-delegation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'token-1' }, error: null }) });
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'token-1', granter_user_id: 'teacher-1' }, error: null }) }) }) });
const mockSelectSingle = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert, update: mockUpdate, select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSelectSingle }) }) }) }));
const mockRpc = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({ from: mockFrom, rpc: mockRpc }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/audit-pipeline', () => ({ writeAuditEvent: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn().mockResolvedValue({
    roles: [{ name: 'teacher', hierarchy_level: 50 }],
    permissions: ['class.manage', 'leaderboard.view', 'class.view_analytics'],
  }),
  invalidateForSecurityEvent: vi.fn(),
}));

import { createDelegationToken, validateDelegationToken, revokeDelegationToken } from '@/lib/rbac-delegation';

describe('Delegation Token Manager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should create a delegation token for permissions the granter holds', async () => {
    const result = await createDelegationToken({
      granterUserId: 'teacher-1',
      schoolId: 'school-1',
      permissions: ['leaderboard.view'],
      expiresInDays: 7,
    });
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.token!.length).toBeGreaterThan(20);
  });

  it('should reject delegation of permissions the granter does not hold', async () => {
    const result = await createDelegationToken({
      granterUserId: 'teacher-1',
      schoolId: 'school-1',
      permissions: ['finance.view_revenue'],
      expiresInDays: 7,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('do not hold');
  });

  it('should reject empty permissions array', async () => {
    const result = await createDelegationToken({
      granterUserId: 'teacher-1',
      schoolId: 'school-1',
      permissions: [],
      expiresInDays: 7,
    });
    expect(result.success).toBe(false);
  });

  it('should validate a token by hash lookup', async () => {
    const rawToken = 'test-token-abc123';
    const hash = createHash('sha256').update(rawToken).digest('hex');

    mockSelectSingle.mockResolvedValueOnce({
      data: {
        id: 'token-1',
        status: 'active',
        granter_user_id: 'teacher-1',
        permissions: ['leaderboard.view'],
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        use_count: 0,
        max_uses: null,
        school_id: 'school-1',
        resource_scope: null,
      },
      error: null,
    });

    const result = await validateDelegationToken(rawToken);
    expect(result.valid).toBe(true);
    expect(result.permissions).toContain('leaderboard.view');
  });

  it('should revoke a token and trigger cache invalidation', async () => {
    const result = await revokeDelegationToken('token-1', 'teacher-1');
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Implement delegation token manager**

```typescript
// src/lib/rbac-delegation.ts
/**
 * ALFANUMRIK — Delegation Token Manager
 *
 * Scoped, time-limited permission sharing between users.
 * Tokens are hashed (SHA-256) before storage — the raw token is shown once.
 * Cascading revocation: if the granter loses a permission, tokens containing
 * that permission become invalid (checked at validation time).
 */

import { createHash, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { writeAuditEvent } from '@/lib/audit-pipeline';
import { getUserPermissions, invalidateForSecurityEvent } from '@/lib/rbac';

const MAX_ACTIVE_TOKENS_PER_USER = 20;

export interface CreateTokenInput {
  granterUserId: string;
  granteeUserId?: string;
  schoolId: string;
  permissions: string[];
  resourceScope?: Record<string, unknown>;
  maxUses?: number;
  expiresInDays: number;
}

export interface TokenResult {
  success: boolean;
  token?: string;
  tokenId?: string;
  error?: string;
}

export interface TokenValidation {
  valid: boolean;
  permissions?: string[];
  granterUserId?: string;
  schoolId?: string;
  resourceScope?: Record<string, unknown> | null;
  error?: string;
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createDelegationToken(input: CreateTokenInput): Promise<TokenResult> {
  if (!input.permissions || input.permissions.length === 0) {
    return { success: false, error: 'At least one permission is required' };
  }
  if (input.expiresInDays <= 0 || input.expiresInDays > 30) {
    return { success: false, error: 'Expiry must be 1-30 days' };
  }

  try {
    // Verify granter holds all requested permissions
    const granterPerms = await getUserPermissions(input.granterUserId, input.schoolId);
    const missing = input.permissions.filter(p => !granterPerms.permissions.includes(p));
    if (missing.length > 0) {
      return { success: false, error: `You do not hold these permissions: ${missing.join(', ')}` };
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('delegation_tokens').insert({
      token_hash: tokenHash,
      granter_user_id: input.granterUserId,
      grantee_user_id: input.granteeUserId ?? null,
      school_id: input.schoolId,
      permissions: input.permissions,
      resource_scope: input.resourceScope ?? null,
      max_uses: input.maxUses ?? null,
      expires_at: expiresAt,
      status: 'active',
    }).select('id').single();

    if (error) {
      logger.error('delegation_create_failed', { error: new Error(error.message), route: 'rbac-delegation' });
      return { success: false, error: error.message };
    }

    await writeAuditEvent({
      eventType: 'delegation_grant',
      actorUserId: input.granterUserId,
      schoolId: input.schoolId,
      action: 'grant',
      result: 'granted',
      resourceType: 'delegation_token',
      resourceId: data.id,
      metadata: { permissions: input.permissions, expiresInDays: input.expiresInDays },
    });

    return { success: true, token: rawToken, tokenId: data.id };
  } catch (e) {
    logger.error('delegation_create_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-delegation' });
    return { success: false, error: 'Internal error' };
  }
}

export async function validateDelegationToken(rawToken: string): Promise<TokenValidation> {
  try {
    const tokenHash = hashToken(rawToken);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.from('delegation_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('status', 'active')
      .single();

    if (error || !data) return { valid: false, error: 'Token not found or inactive' };

    // Check expiry
    if (new Date(data.expires_at) <= new Date()) {
      await supabase.from('delegation_tokens').update({ status: 'expired' }).eq('id', data.id);
      return { valid: false, error: 'Token expired' };
    }

    // Check max uses
    if (data.max_uses !== null && data.use_count >= data.max_uses) {
      await supabase.from('delegation_tokens').update({ status: 'exhausted' }).eq('id', data.id);
      return { valid: false, error: 'Token usage limit reached' };
    }

    // Cascading revocation: verify granter still has all delegated permissions
    const granterPerms = await getUserPermissions(data.granter_user_id, data.school_id);
    const stillValid = data.permissions.every((p: string) => granterPerms.permissions.includes(p));
    if (!stillValid) {
      return { valid: false, error: 'Granter no longer holds delegated permissions' };
    }

    // Increment use count
    await supabase.from('delegation_tokens')
      .update({ use_count: data.use_count + 1 })
      .eq('id', data.id);

    return {
      valid: true,
      permissions: data.permissions,
      granterUserId: data.granter_user_id,
      schoolId: data.school_id,
      resourceScope: data.resource_scope,
    };
  } catch (e) {
    logger.error('delegation_validate_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-delegation' });
    return { valid: false, error: 'Validation failed' };
  }
}

export async function revokeDelegationToken(tokenId: string, revokedBy: string): Promise<TokenResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('delegation_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: revokedBy })
      .eq('id', tokenId)
      .eq('status', 'active')
      .select('granter_user_id')
      .single();

    if (error || !data) return { success: false, error: 'Token not found or already revoked' };

    await writeAuditEvent({
      eventType: 'delegation_revoke',
      actorUserId: revokedBy,
      action: 'revoke',
      result: 'granted',
      resourceType: 'delegation_token',
      resourceId: tokenId,
    });

    return { success: true };
  } catch (e) {
    logger.error('delegation_revoke_exception', { error: e instanceof Error ? e : new Error(String(e)), route: 'rbac-delegation' });
    return { success: false, error: 'Internal error' };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/rbac-delegation.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rbac-delegation.ts src/__tests__/rbac-delegation.test.ts
git commit -m "feat(rbac): add delegation token manager with cascading revocation"
```

---

## Task 5: Full Verification

- [ ] **Step 1: Run all Phase 2B tests**

Run: `npx vitest run src/__tests__/rbac-elevation.test.ts src/__tests__/rbac-impersonation.test.ts src/__tests__/rbac-delegation.test.ts`
Expected: All 15 tests pass (5+5+5).

- [ ] **Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass, no regressions.

- [ ] **Step 3: Commit fixups if needed**

```bash
git add -A && git commit -m "chore(rbac): phase 2B verification fixups"
```

---

## Summary

| Task | What It Delivers |
|---|---|
| 1 | role_elevations + impersonation_sessions + delegation_tokens tables + expire_temporary_access RPC |
| 2 | Elevation manager: grant with hierarchy/duration validation, revoke with instant cache invalidation |
| 3 | Impersonation manager: start/validate/end with action counting and auto-termination |
| 4 | Delegation token manager: create with granter permission check, validate with cascading revocation |
| 5 | Full verification gate |

**Backward compatibility:** None of these modules are wired into `authorizeRequest()` yet. They're standalone managers that can be called from API routes. Resolver integration (wiring into evaluation steps 3-5) is Phase 2B+ work once the admin UI provides endpoints to create/manage these.

**Next:** Phase 2C (Admin UI) — RBAC management pages in super-admin panel.
