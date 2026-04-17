import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data ──
const MOCK_GRANTER_ID = 'granter-uuid-001';
const MOCK_SCHOOL_ID = 'school-uuid-001';
const MOCK_TARGET_ROLE_ID = 'role-uuid-teacher';

// ── Mock results (mutated per test) ──
let mockAuthorityRows: unknown[] = [];
let mockAuthorityError: unknown = null;
let mockRoleLookupData: unknown = null;
let mockRoleLookupError: unknown = null;

/**
 * Create a chainable PostgREST-like builder that resolves to { data, error }
 * when awaited. Supports .select(), .eq(), .in(), .single().
 */
function createChainable(resolveWith: () => { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.single = vi.fn(() => resolveWith());
  // Make it thenable so `await builder` resolves to { data, error }
  builder.then = (resolve: (v: unknown) => void) => {
    return Promise.resolve(resolveWith()).then(resolve);
  };

  return builder;
}

const mockFrom = vi.fn();

function resetFromMock() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'delegation_authority') {
      return createChainable(() => ({
        data: mockAuthorityRows,
        error: mockAuthorityError,
      }));
    }
    if (table === 'roles') {
      return createChainable(() => ({
        data: mockRoleLookupData,
        error: mockRoleLookupError,
      }));
    }
    return createChainable(() => ({ data: null, error: null }));
  });
}

const mockSupabaseAdmin = { from: mockFrom };

// ── Module mocks ──
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockSupabaseAdmin,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGetUserPermissions = vi.fn();

vi.mock('@/lib/rbac', () => ({
  getUserPermissions: (...args: unknown[]) => mockGetUserPermissions(...args),
}));

// ── Import after mocks ──
import { validateDelegation } from '@/lib/rbac-authority';
import type { DelegationRequest } from '@/lib/rbac-authority';

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('RBAC Authority Validation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorityRows = [];
    mockAuthorityError = null;
    mockRoleLookupData = null;
    mockRoleLookupError = null;
    resetFromMock();
  });

  // ── Allowed: admin assigns teacher role ──

  it('should allow when admin has authority and target hierarchy is within range', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
      permissions: ['user.manage', 'role.manage', 'class.manage'],
    });

    mockAuthorityRows = [
      {
        id: 'auth-001',
        granter_role_id: 'admin',
        action: 'assign_role',
        target_max_hierarchy: 80,
        max_duration_hours: null,
        requires_approval: false,
        requires_reason: false,
        is_active: true,
        school_id: null,
      },
    ];

    mockRoleLookupData = { hierarchy_level: 50 };

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'assign_role',
      schoolId: MOCK_SCHOOL_ID,
      targetRoleId: MOCK_TARGET_ROLE_ID,
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.requiresApproval).toBe(false);
    expect(result.effectiveConstraints.maxHierarchy).toBe(80);
  });

  // ── Denied: no authority row ──

  it('should deny when no delegation_authority rows exist for the action', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
      permissions: ['class.manage', 'quiz.attempt'],
    });

    mockAuthorityRows = [];

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'assign_role',
      schoolId: MOCK_SCHOOL_ID,
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(false);
    expect(result.violations).toContain('No delegation authority for this action');
  });

  // ── Denied: target hierarchy too high ──

  it('should deny when target role hierarchy exceeds the allowed maximum', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'institution_admin', display_name: 'Institution Admin', hierarchy_level: 70 }],
      permissions: ['institution.manage', 'class.manage'],
    });

    mockAuthorityRows = [
      {
        id: 'auth-002',
        granter_role_id: 'institution_admin',
        action: 'assign_role',
        target_max_hierarchy: 69,
        max_duration_hours: null,
        requires_approval: false,
        requires_reason: false,
        is_active: true,
        school_id: null,
      },
    ];

    mockRoleLookupData = { hierarchy_level: 70 };

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'assign_role',
      schoolId: MOCK_SCHOOL_ID,
      targetRoleId: MOCK_TARGET_ROLE_ID,
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain('exceeds maximum');
  });

  // ── Denied: permission not held ──

  it('should deny when granter does not hold the delegated permissions', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
      permissions: ['class.manage', 'quiz.attempt'],
    });

    mockAuthorityRows = [
      {
        id: 'auth-003',
        granter_role_id: 'teacher',
        action: 'delegate',
        target_max_hierarchy: 40,
        max_duration_hours: null,
        requires_approval: false,
        requires_reason: false,
        is_active: true,
        school_id: null,
      },
    ];

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'delegate',
      schoolId: MOCK_SCHOOL_ID,
      permissions: ['finance.view_revenue'],
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(false);
    expect(result.violations).toContain('Granter does not hold permission: finance.view_revenue');
  });

  // ── Denied: duration exceeded ──

  it('should deny when requested duration exceeds authority maximum', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
      permissions: ['user.manage', 'role.manage'],
    });

    mockAuthorityRows = [
      {
        id: 'auth-004',
        granter_role_id: 'admin',
        action: 'elevate',
        target_max_hierarchy: 80,
        max_duration_hours: 48,
        requires_approval: false,
        requires_reason: false,
        is_active: true,
        school_id: null,
      },
    ];

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'elevate',
      schoolId: MOCK_SCHOOL_ID,
      durationHours: 100,
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain('exceeds maximum allowed');
    expect(result.violations[0]).toContain('100');
    expect(result.violations[0]).toContain('48');
  });

  // ── Requires approval ──

  it('should return allowed with requiresApproval when authority requires it', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
      permissions: ['user.manage', 'role.manage'],
    });

    mockAuthorityRows = [
      {
        id: 'auth-005',
        granter_role_id: 'admin',
        action: 'create_role',
        target_max_hierarchy: 60,
        max_duration_hours: null,
        requires_approval: true,
        requires_reason: false,
        is_active: true,
        school_id: null,
      },
    ];

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'create_role',
      schoolId: MOCK_SCHOOL_ID,
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.violations).toEqual([]);
  });

  // ── Denied: reason required but empty ──

  it('should deny when reason is required but not provided', async () => {
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
      permissions: ['user.manage', 'role.manage'],
    });

    mockAuthorityRows = [
      {
        id: 'auth-006',
        granter_role_id: 'admin',
        action: 'revoke_role',
        target_max_hierarchy: 80,
        max_duration_hours: null,
        requires_approval: false,
        requires_reason: true,
        is_active: true,
        school_id: null,
      },
    ];

    const req: DelegationRequest = {
      granterId: MOCK_GRANTER_ID,
      action: 'revoke_role',
      schoolId: MOCK_SCHOOL_ID,
    };

    const result = await validateDelegation(req);

    expect(result.allowed).toBe(false);
    expect(result.violations).toContain('Reason is required for this action');
  });
});
