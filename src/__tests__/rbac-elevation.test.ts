import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data ──
const MOCK_ELEVATION_ID = 'elev-uuid-001';
const MOCK_USER_ID = 'user-uuid-001';
const MOCK_ROLE_ID = 'role-uuid-001';
const MOCK_GRANTER_ID = 'admin-uuid-001';

// ── Mock Supabase chain builder ──
let mockInsertResult: { data: unknown; error: unknown } = {
  data: { id: MOCK_ELEVATION_ID },
  error: null,
};

let mockSelectResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

let mockUpdateResult: { error: unknown } = { error: null };

const mockSingle = vi.fn();
const mockGt = vi.fn();
const mockEqChain = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

function resetChainMocks() {
  mockSingle.mockImplementation(() => mockSelectResult);
  mockGt.mockImplementation(() => ({ data: [], error: null }));
  mockEqChain.mockImplementation(() => ({
    eq: mockEqChain,
    gt: mockGt,
    single: mockSingle,
  }));
  mockSelect.mockImplementation(() => ({
    eq: mockEqChain,
    single: mockSingle,
  }));
  mockInsert.mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockReturnValue(mockInsertResult),
    }),
  }));
  mockUpdate.mockImplementation(() => ({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(mockUpdateResult),
    }),
  }));
}

const mockFrom = vi.fn().mockImplementation(() => ({
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
}));

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

vi.mock('@/lib/rbac', () => ({
  invalidateForSecurityEvent: vi.fn().mockResolvedValue(undefined),
  getUserPermissions: vi.fn().mockResolvedValue({
    roles: [{ name: 'admin', display_name: 'Admin', hierarchy_level: 90 }],
    permissions: ['admin.manage_users'],
  }),
}));

vi.mock('@/lib/audit-pipeline', () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ──
import { grantElevation, revokeElevation, getActiveElevations } from '@/lib/rbac-elevation';
import { invalidateForSecurityEvent } from '@/lib/rbac';

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('RBAC Elevation Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertResult = { data: { id: MOCK_ELEVATION_ID }, error: null };
    mockSelectResult = { data: null, error: null };
    mockUpdateResult = { error: null };
    resetChainMocks();
  });

  // ── Grant Elevation ──

  describe('grantElevation', () => {
    it('should create an elevation with valid fields', async () => {
      const result = await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: MOCK_ROLE_ID,
        grantedBy: MOCK_GRANTER_ID,
        reason: 'Temporary admin access for event setup',
        durationHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.elevationId).toBe(MOCK_ELEVATION_ID);
      expect(result.error).toBeUndefined();

      // Verify insert was called on role_elevations
      expect(mockFrom).toHaveBeenCalledWith('role_elevations');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: MOCK_USER_ID,
          elevated_role_id: MOCK_ROLE_ID,
          granted_by: MOCK_GRANTER_ID,
          reason: 'Temporary admin access for event setup',
          max_duration_hours: 24,
          status: 'active',
        }),
      );
    });

    it('should reject empty reason', async () => {
      const result = await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: MOCK_ROLE_ID,
        grantedBy: MOCK_GRANTER_ID,
        reason: '',
        durationHours: 24,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reason is required');
      // Should NOT have called Supabase
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only reason', async () => {
      const result = await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: MOCK_ROLE_ID,
        grantedBy: MOCK_GRANTER_ID,
        reason: '   ',
        durationHours: 24,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reason is required');
    });

    it('should reject duration exceeding 168 hours', async () => {
      const result = await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: MOCK_ROLE_ID,
        grantedBy: MOCK_GRANTER_ID,
        reason: 'Need admin access',
        durationHours: 200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('168');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should reject duration less than 1 hour', async () => {
      const result = await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: MOCK_ROLE_ID,
        grantedBy: MOCK_GRANTER_ID,
        reason: 'Need admin access',
        durationHours: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('1');
    });

    it('should trigger cache invalidation on successful grant', async () => {
      await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: MOCK_ROLE_ID,
        grantedBy: MOCK_GRANTER_ID,
        reason: 'Admin access needed',
        durationHours: 24,
      });

      expect(invalidateForSecurityEvent).toHaveBeenCalledWith(
        [MOCK_USER_ID],
        'role_elevation_granted',
      );
    });

    it('should handle DB insert errors gracefully', async () => {
      mockInsertResult = { data: null, error: { message: 'FK violation' } };

      const result = await grantElevation({
        userId: MOCK_USER_ID,
        elevatedRoleId: 'nonexistent-role',
        grantedBy: MOCK_GRANTER_ID,
        reason: 'Admin access',
        durationHours: 24,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FK violation');
    });
  });

  // ── Revoke Elevation ──

  describe('revokeElevation', () => {
    it('should revoke an active elevation and trigger cache invalidation', async () => {
      // Mock the fetch returning an active elevation
      mockSelectResult = {
        data: { id: MOCK_ELEVATION_ID, user_id: MOCK_USER_ID, status: 'active' },
        error: null,
      };

      const result = await revokeElevation(MOCK_ELEVATION_ID, MOCK_GRANTER_ID);

      expect(result.success).toBe(true);
      expect(invalidateForSecurityEvent).toHaveBeenCalledWith(
        [MOCK_USER_ID],
        'role_elevation_revoked',
      );
    });

    it('should reject revoking a non-active elevation', async () => {
      mockSelectResult = {
        data: { id: MOCK_ELEVATION_ID, user_id: MOCK_USER_ID, status: 'expired' },
        error: null,
      };

      const result = await revokeElevation(MOCK_ELEVATION_ID, MOCK_GRANTER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already expired');
    });

    it('should handle not-found elevation', async () => {
      mockSelectResult = { data: null, error: { message: 'not found' } };

      const result = await revokeElevation('nonexistent-id', MOCK_GRANTER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Elevation not found');
    });
  });

  // ── List Active Elevations ──

  describe('getActiveElevations', () => {
    it('should return active elevations for a user', async () => {
      // Override the gt mock to return elevation data
      const mockElevations = [
        {
          id: MOCK_ELEVATION_ID,
          user_id: MOCK_USER_ID,
          school_id: null,
          elevated_role_id: MOCK_ROLE_ID,
          original_roles: [],
          granted_by: MOCK_GRANTER_ID,
          reason: 'Admin access',
          starts_at: '2026-04-17T00:00:00Z',
          expires_at: '2026-04-18T00:00:00Z',
          status: 'active',
        },
      ];

      mockGt.mockReturnValue({ data: mockElevations, error: null });

      const elevations = await getActiveElevations(MOCK_USER_ID);

      expect(elevations).toHaveLength(1);
      expect(elevations[0].id).toBe(MOCK_ELEVATION_ID);
      expect(elevations[0].userId).toBe(MOCK_USER_ID);
      expect(elevations[0].reason).toBe('Admin access');
    });

    it('should return empty array on DB error', async () => {
      mockGt.mockReturnValue({ data: null, error: { message: 'DB error' } });

      const elevations = await getActiveElevations(MOCK_USER_ID);

      expect(elevations).toEqual([]);
    });
  });
});
