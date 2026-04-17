import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// ── Mock data ──
const MOCK_TOKEN_ID = 'token-uuid-001';
const MOCK_GRANTER_ID = 'teacher-uuid-001';
const MOCK_GRANTEE_ID = 'student-uuid-001';
const MOCK_SCHOOL_ID = 'school-uuid-001';
const MOCK_PERMISSIONS = ['quiz.attempt', 'study_plan.view'];

// ── Mock Supabase chain builder ──
let mockInsertResult: { data: unknown; error: unknown } = {
  data: { id: MOCK_TOKEN_ID },
  error: null,
};

let mockSelectResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

let mockUpdateResult: { error: unknown } = { error: null };

const mockSingle = vi.fn();
const mockEqChain = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

function resetChainMocks() {
  mockSingle.mockImplementation(() => mockSelectResult);
  mockEqChain.mockImplementation(() => ({
    eq: mockEqChain,
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

const mockGetUserPermissions = vi.fn();

vi.mock('@/lib/rbac', () => ({
  getUserPermissions: (...args: unknown[]) => mockGetUserPermissions(...args),
  invalidateForSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit-pipeline', () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ──
import {
  createDelegationToken,
  validateDelegationToken,
  revokeDelegationToken,
} from '@/lib/rbac-delegation';

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('RBAC Delegation Token Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertResult = { data: { id: MOCK_TOKEN_ID }, error: null };
    mockSelectResult = { data: null, error: null };
    mockUpdateResult = { error: null };
    resetChainMocks();

    // Default: granter holds the delegated permissions
    mockGetUserPermissions.mockResolvedValue({
      roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
      permissions: ['quiz.attempt', 'study_plan.view', 'class.manage'],
    });
  });

  // ── Create Token ──

  describe('createDelegationToken', () => {
    it('should create a token when granter holds all permissions', async () => {
      const result = await createDelegationToken({
        granterUserId: MOCK_GRANTER_ID,
        schoolId: MOCK_SCHOOL_ID,
        permissions: MOCK_PERMISSIONS,
        expiryDays: 7,
      });

      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token!.length).toBe(64); // 32 bytes hex = 64 chars
      expect(result.tokenId).toBe(MOCK_TOKEN_ID);

      // Verify the stored hash is a SHA-256 of the raw token
      const expectedHash = createHash('sha256').update(result.token!).digest('hex');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          token_hash: expectedHash,
          granter_user_id: MOCK_GRANTER_ID,
          school_id: MOCK_SCHOOL_ID,
          permissions: MOCK_PERMISSIONS,
          status: 'active',
        }),
      );
    });

    it('should reject empty permissions array', async () => {
      const result = await createDelegationToken({
        granterUserId: MOCK_GRANTER_ID,
        schoolId: MOCK_SCHOOL_ID,
        permissions: [],
        expiryDays: 7,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one permission');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should reject expiry exceeding 30 days', async () => {
      const result = await createDelegationToken({
        granterUserId: MOCK_GRANTER_ID,
        schoolId: MOCK_SCHOOL_ID,
        permissions: MOCK_PERMISSIONS,
        expiryDays: 60,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('30');
    });

    it('should reject expiry less than 1 day', async () => {
      const result = await createDelegationToken({
        granterUserId: MOCK_GRANTER_ID,
        schoolId: MOCK_SCHOOL_ID,
        permissions: MOCK_PERMISSIONS,
        expiryDays: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('1');
    });

    it('should reject when granter lacks delegated permissions', async () => {
      mockGetUserPermissions.mockResolvedValue({
        roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
        permissions: ['quiz.attempt'], // missing study_plan.view
      });

      const result = await createDelegationToken({
        granterUserId: MOCK_GRANTER_ID,
        schoolId: MOCK_SCHOOL_ID,
        permissions: MOCK_PERMISSIONS,
        expiryDays: 7,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('study_plan.view');
    });

    it('should allow super_admin to delegate any permissions', async () => {
      mockGetUserPermissions.mockResolvedValue({
        roles: [{ name: 'super_admin', display_name: 'Super Admin', hierarchy_level: 100 }],
        permissions: ['*'],
      });

      const result = await createDelegationToken({
        granterUserId: MOCK_GRANTER_ID,
        schoolId: MOCK_SCHOOL_ID,
        permissions: ['admin.manage_users', 'system.config'],
        expiryDays: 7,
      });

      expect(result.success).toBe(true);
    });
  });

  // ── Validate Token ──

  describe('validateDelegationToken', () => {
    it('should validate an active token and increment use count', async () => {
      const rawToken = 'a'.repeat(64);
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      mockSelectResult = {
        data: {
          id: MOCK_TOKEN_ID,
          granter_user_id: MOCK_GRANTER_ID,
          grantee_user_id: MOCK_GRANTEE_ID,
          school_id: MOCK_SCHOOL_ID,
          permissions: MOCK_PERMISSIONS,
          resource_scope: null,
          max_uses: 10,
          use_count: 3,
          expires_at: futureExpiry,
          status: 'active',
        },
        error: null,
      };

      // Granter still holds permissions
      mockGetUserPermissions.mockResolvedValue({
        roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
        permissions: ['quiz.attempt', 'study_plan.view'],
      });

      const result = await validateDelegationToken(rawToken);

      expect(result.valid).toBe(true);
      expect(result.tokenId).toBe(MOCK_TOKEN_ID);
      expect(result.permissions).toEqual(MOCK_PERMISSIONS);
      expect(result.schoolId).toBe(MOCK_SCHOOL_ID);

      // Verify use count was incremented
      expect(mockUpdate).toHaveBeenCalledWith({ use_count: 4 });
    });

    it('should reject an expired token', async () => {
      const rawToken = 'b'.repeat(64);
      const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();

      mockSelectResult = {
        data: {
          id: MOCK_TOKEN_ID,
          granter_user_id: MOCK_GRANTER_ID,
          grantee_user_id: null,
          school_id: MOCK_SCHOOL_ID,
          permissions: MOCK_PERMISSIONS,
          resource_scope: null,
          max_uses: null,
          use_count: 0,
          expires_at: pastExpiry,
          status: 'active',
        },
        error: null,
      };

      const result = await validateDelegationToken(rawToken);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject an exhausted token (max uses reached)', async () => {
      const rawToken = 'c'.repeat(64);
      const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      mockSelectResult = {
        data: {
          id: MOCK_TOKEN_ID,
          granter_user_id: MOCK_GRANTER_ID,
          grantee_user_id: null,
          school_id: MOCK_SCHOOL_ID,
          permissions: MOCK_PERMISSIONS,
          resource_scope: null,
          max_uses: 5,
          use_count: 5,
          expires_at: futureExpiry,
          status: 'active',
        },
        error: null,
      };

      const result = await validateDelegationToken(rawToken);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('exhausted');
    });

    it('should cascade-revoke when granter loses permissions', async () => {
      const rawToken = 'd'.repeat(64);
      const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      mockSelectResult = {
        data: {
          id: MOCK_TOKEN_ID,
          granter_user_id: MOCK_GRANTER_ID,
          grantee_user_id: null,
          school_id: MOCK_SCHOOL_ID,
          permissions: MOCK_PERMISSIONS,
          resource_scope: null,
          max_uses: null,
          use_count: 0,
          expires_at: futureExpiry,
          status: 'active',
        },
        error: null,
      };

      // Granter lost study_plan.view
      mockGetUserPermissions.mockResolvedValue({
        roles: [{ name: 'teacher', display_name: 'Teacher', hierarchy_level: 50 }],
        permissions: ['quiz.attempt'], // missing study_plan.view
      });

      const result = await validateDelegationToken(rawToken);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('granter no longer holds');

      // Verify the token was revoked in DB
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'revoked',
        }),
      );
    });

    it('should return not found for nonexistent token', async () => {
      mockSelectResult = { data: null, error: { message: 'not found' } };

      const result = await validateDelegationToken('nonexistent-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });
  });

  // ── Revoke Token ──

  describe('revokeDelegationToken', () => {
    it('should revoke an active token', async () => {
      mockSelectResult = {
        data: {
          id: MOCK_TOKEN_ID,
          granter_user_id: MOCK_GRANTER_ID,
          grantee_user_id: MOCK_GRANTEE_ID,
          status: 'active',
          school_id: MOCK_SCHOOL_ID,
        },
        error: null,
      };

      const result = await revokeDelegationToken(MOCK_TOKEN_ID, MOCK_GRANTER_ID);

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'revoked',
          revoked_by: MOCK_GRANTER_ID,
        }),
      );
    });

    it('should reject revoking a non-active token', async () => {
      mockSelectResult = {
        data: {
          id: MOCK_TOKEN_ID,
          granter_user_id: MOCK_GRANTER_ID,
          grantee_user_id: null,
          status: 'expired',
          school_id: MOCK_SCHOOL_ID,
        },
        error: null,
      };

      const result = await revokeDelegationToken(MOCK_TOKEN_ID, MOCK_GRANTER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already expired');
    });

    it('should handle not-found token', async () => {
      mockSelectResult = { data: null, error: { message: 'not found' } };

      const result = await revokeDelegationToken('nonexistent-id', MOCK_GRANTER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token not found');
    });
  });
});
