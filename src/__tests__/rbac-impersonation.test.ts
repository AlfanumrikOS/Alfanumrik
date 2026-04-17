import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data ──
const MOCK_SESSION_ID = 'session-uuid-001';
const MOCK_ADMIN_ID = 'admin-uuid-001';
const MOCK_TARGET_ID = 'student-uuid-001';

// ── Mock Supabase chain builder ──
let mockInsertResult: { data: unknown; error: unknown } = {
  data: { id: MOCK_SESSION_ID },
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

vi.mock('@/lib/audit-pipeline', () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ──
import {
  startImpersonation,
  validateImpersonation,
  endImpersonation,
} from '@/lib/rbac-impersonation';

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('RBAC Impersonation Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertResult = { data: { id: MOCK_SESSION_ID }, error: null };
    mockSelectResult = { data: null, error: null };
    mockUpdateResult = { error: null };
    resetChainMocks();
  });

  // ── Start Impersonation ──

  describe('startImpersonation', () => {
    it('should create a session with valid inputs', async () => {
      const result = await startImpersonation({
        adminUserId: MOCK_ADMIN_ID,
        targetUserId: MOCK_TARGET_ID,
        reason: 'Investigating reported display issue',
        durationMinutes: 15,
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(MOCK_SESSION_ID);
      expect(result.expiresAt).toBeDefined();
      expect(result.error).toBeUndefined();

      expect(mockFrom).toHaveBeenCalledWith('impersonation_sessions');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          reason: 'Investigating reported display issue',
          permissions_granted: ['read'],
          status: 'active',
        }),
      );
    });

    it('should reject empty reason', async () => {
      const result = await startImpersonation({
        adminUserId: MOCK_ADMIN_ID,
        targetUserId: MOCK_TARGET_ID,
        reason: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reason is required');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should reject self-impersonation', async () => {
      const result = await startImpersonation({
        adminUserId: MOCK_ADMIN_ID,
        targetUserId: MOCK_ADMIN_ID,
        reason: 'Testing my own account',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot impersonate yourself');
    });

    it('should reject duration exceeding 60 minutes', async () => {
      const result = await startImpersonation({
        adminUserId: MOCK_ADMIN_ID,
        targetUserId: MOCK_TARGET_ID,
        reason: 'Need extended access',
        durationMinutes: 120,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('60');
    });

    it('should use default 30 minute duration when not specified', async () => {
      const before = Date.now();

      const result = await startImpersonation({
        adminUserId: MOCK_ADMIN_ID,
        targetUserId: MOCK_TARGET_ID,
        reason: 'Quick check',
      });

      expect(result.success).toBe(true);

      // The expires_at should be approximately 30 minutes from now
      if (result.expiresAt) {
        const expiresMs = new Date(result.expiresAt).getTime();
        const expectedMs = before + 30 * 60 * 1000;
        // Allow 5 seconds of tolerance
        expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(5000);
      }
    });
  });

  // ── Validate Impersonation ──

  describe('validateImpersonation', () => {
    it('should validate an active session and increment action count', async () => {
      const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      mockSelectResult = {
        data: {
          id: MOCK_SESSION_ID,
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          expires_at: futureExpiry,
          action_count: 5,
          status: 'active',
        },
        error: null,
      };

      const result = await validateImpersonation(MOCK_SESSION_ID);

      expect(result.valid).toBe(true);
      expect(result.readOnly).toBe(true);
      expect(result.adminUserId).toBe(MOCK_ADMIN_ID);
      expect(result.targetUserId).toBe(MOCK_TARGET_ID);

      // Verify action count was incremented
      expect(mockUpdate).toHaveBeenCalledWith({ action_count: 6 });
    });

    it('should reject an expired session', async () => {
      const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();
      mockSelectResult = {
        data: {
          id: MOCK_SESSION_ID,
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          expires_at: pastExpiry,
          action_count: 3,
          status: 'active',
        },
        error: null,
      };

      const result = await validateImpersonation(MOCK_SESSION_ID);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should terminate session when action count reaches 50', async () => {
      const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      mockSelectResult = {
        data: {
          id: MOCK_SESSION_ID,
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          expires_at: futureExpiry,
          action_count: 50,
          status: 'active',
        },
        error: null,
      };

      const result = await validateImpersonation(MOCK_SESSION_ID);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Action limit exceeded');
    });

    it('should reject a non-active session', async () => {
      mockSelectResult = {
        data: {
          id: MOCK_SESSION_ID,
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          action_count: 0,
          status: 'ended',
        },
        error: null,
      };

      const result = await validateImpersonation(MOCK_SESSION_ID);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('ended');
    });

    it('should return not found for nonexistent session', async () => {
      mockSelectResult = { data: null, error: { message: 'not found' } };

      const result = await validateImpersonation('nonexistent-session');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Session not found');
    });
  });

  // ── End Impersonation ──

  describe('endImpersonation', () => {
    it('should end an active session manually', async () => {
      mockSelectResult = {
        data: {
          id: MOCK_SESSION_ID,
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          status: 'active',
          action_count: 10,
        },
        error: null,
      };

      const result = await endImpersonation(MOCK_SESSION_ID, 'manual');

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ended',
          ended_reason: 'manual',
        }),
      );
    });

    it('should reject ending a non-active session', async () => {
      mockSelectResult = {
        data: {
          id: MOCK_SESSION_ID,
          admin_user_id: MOCK_ADMIN_ID,
          target_user_id: MOCK_TARGET_ID,
          status: 'expired',
          action_count: 0,
        },
        error: null,
      };

      const result = await endImpersonation(MOCK_SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already expired');
    });

    it('should handle not-found session', async () => {
      mockSelectResult = { data: null, error: { message: 'not found' } };

      const result = await endImpersonation('nonexistent-session');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });
  });
});
