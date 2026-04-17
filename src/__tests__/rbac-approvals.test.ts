import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data ──
const MOCK_SCHOOL_ID = 'school-uuid-001';
const MOCK_REQUESTER_ID = 'requester-uuid-001';
const MOCK_DECIDER_ID = 'decider-uuid-001';
const MOCK_APPROVAL_ID = 'approval-uuid-001';
const MOCK_TARGET_USER_ID = 'target-uuid-001';
const MOCK_TARGET_ROLE_ID = 'role-uuid-teacher';

// ── Mock Supabase chain builder ──
let mockInsertResult: { data: unknown; error: unknown } = {
  data: { id: MOCK_APPROVAL_ID },
  error: null,
};

let mockSelectSingleResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

let mockUpdateResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

let mockSelectListResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};

const mockSingle = vi.fn();
const mockEqChain = vi.fn();
const mockSelectFn = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockGt = vi.fn();
const mockOrder = vi.fn();

function resetChainMocks() {
  // For select().eq().single() — used by fetch approval
  mockSingle.mockImplementation(() => mockSelectSingleResult);
  mockEqChain.mockImplementation(() => ({
    eq: mockEqChain,
    single: mockSingle,
    gt: mockGt,
    order: mockOrder,
    select: mockSelectFn,
  }));
  mockSelectFn.mockImplementation(() => ({
    eq: mockEqChain,
    single: mockSingle,
  }));

  // For insert().select().single() — used by requestApproval
  mockInsert.mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockImplementation(() => mockInsertResult),
    }),
  }));

  // For update().eq().select().single() — used by approve/reject
  mockUpdate.mockImplementation(() => ({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockImplementation(() => mockUpdateResult),
      }),
    }),
  }));

  // For gt() and order() — used by listPendingApprovals
  mockGt.mockImplementation(() => ({
    order: mockOrder,
  }));
  mockOrder.mockImplementation(() => mockSelectListResult);
}

const mockFrom = vi.fn().mockImplementation(() => ({
  insert: mockInsert,
  select: mockSelectFn,
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

const mockWriteAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/audit-pipeline', () => ({
  writeAuditEvent: (...args: unknown[]) => mockWriteAuditEvent(...args),
}));

// ── Import after mocks ──
import {
  requestApproval,
  approveRequest,
  rejectRequest,
  listPendingApprovals,
} from '@/lib/rbac-approvals';

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('RBAC Approval Workflow Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertResult = { data: { id: MOCK_APPROVAL_ID }, error: null };
    mockSelectSingleResult = { data: null, error: null };
    mockUpdateResult = { data: null, error: null };
    mockSelectListResult = { data: [], error: null };
    resetChainMocks();
  });

  // ── Create approval request ──

  describe('requestApproval', () => {
    it('should create an approval request with correct fields', async () => {
      const result = await requestApproval({
        schoolId: MOCK_SCHOOL_ID,
        requestedBy: MOCK_REQUESTER_ID,
        action: 'assign_role',
        targetUserId: MOCK_TARGET_USER_ID,
        targetRoleId: MOCK_TARGET_ROLE_ID,
        payload: { reason: 'Needs access to class management' },
      });

      expect(result.success).toBe(true);
      expect(result.approvalId).toBe(MOCK_APPROVAL_ID);

      // Verify insert was called with correct fields
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          school_id: MOCK_SCHOOL_ID,
          requested_by: MOCK_REQUESTER_ID,
          action: 'assign_role',
          target_user_id: MOCK_TARGET_USER_ID,
          target_role_id: MOCK_TARGET_ROLE_ID,
          status: 'pending',
        }),
      );

      // Verify expires_at is set (roughly 72h from now)
      const insertArg = mockInsert.mock.calls[0][0];
      const expiresAt = new Date(insertArg.expires_at);
      const expectedExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(5000);

      // Verify audit event was written
      expect(mockWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'delegation_grant',
          actorUserId: MOCK_REQUESTER_ID,
          resourceType: 'delegation_approval',
          resourceId: MOCK_APPROVAL_ID,
        }),
      );
    });
  });

  // ── Approve request ──

  describe('approveRequest', () => {
    it('should approve a pending request and set decided_by and decided_at', async () => {
      const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      // Fetch returns pending, non-expired approval
      mockSelectSingleResult = {
        data: {
          id: MOCK_APPROVAL_ID,
          school_id: MOCK_SCHOOL_ID,
          requested_by: MOCK_REQUESTER_ID,
          action: 'assign_role',
          status: 'pending',
          expires_at: futureDate,
        },
        error: null,
      };

      // Update returns the approved row
      mockUpdateResult = {
        data: {
          id: MOCK_APPROVAL_ID,
          status: 'approved',
          decided_by: MOCK_DECIDER_ID,
          decided_at: new Date().toISOString(),
          decision_reason: 'Looks good',
        },
        error: null,
      };

      const result = await approveRequest(MOCK_APPROVAL_ID, MOCK_DECIDER_ID, 'Looks good');

      expect(result.success).toBe(true);
      expect(result.approval).toBeDefined();
      expect(result.approval!.status).toBe('approved');
      expect(result.approval!.decided_by).toBe(MOCK_DECIDER_ID);

      // Verify update was called
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          decided_by: MOCK_DECIDER_ID,
          decision_reason: 'Looks good',
        }),
      );

      // Verify audit event
      expect(mockWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'delegation_grant',
          action: 'grant',
          resourceId: MOCK_APPROVAL_ID,
        }),
      );
    });
  });

  // ── Reject request requires reason ──

  describe('rejectRequest', () => {
    it('should fail when reason is not provided for rejection', async () => {
      const result = await rejectRequest(MOCK_APPROVAL_ID, MOCK_DECIDER_ID, '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reason is required');

      // Should not have queried the database at all
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('should reject a pending request with reason', async () => {
      const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      // Fetch returns pending, non-expired approval
      mockSelectSingleResult = {
        data: {
          id: MOCK_APPROVAL_ID,
          school_id: MOCK_SCHOOL_ID,
          requested_by: MOCK_REQUESTER_ID,
          action: 'assign_role',
          status: 'pending',
          expires_at: futureDate,
        },
        error: null,
      };

      // Update returns the rejected row
      mockUpdateResult = {
        data: {
          id: MOCK_APPROVAL_ID,
          status: 'rejected',
          decided_by: MOCK_DECIDER_ID,
          decided_at: new Date().toISOString(),
          decision_reason: 'Insufficient justification',
        },
        error: null,
      };

      const result = await rejectRequest(
        MOCK_APPROVAL_ID,
        MOCK_DECIDER_ID,
        'Insufficient justification',
      );

      expect(result.success).toBe(true);
      expect(result.approval).toBeDefined();
      expect(result.approval!.status).toBe('rejected');
      expect(result.approval!.decision_reason).toBe('Insufficient justification');

      // Verify audit event for rejection
      expect(mockWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'delegation_revoke',
          action: 'revoke',
          result: 'denied',
        }),
      );
    });
  });

  // ── List pending approvals ──

  describe('listPendingApprovals', () => {
    it('should return filtered list of pending non-expired approvals', async () => {
      const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const approvals = [
        {
          id: 'approval-1',
          school_id: MOCK_SCHOOL_ID,
          status: 'pending',
          expires_at: futureDate,
          created_at: new Date().toISOString(),
        },
        {
          id: 'approval-2',
          school_id: MOCK_SCHOOL_ID,
          status: 'pending',
          expires_at: futureDate,
          created_at: new Date().toISOString(),
        },
      ];

      mockSelectListResult = { data: approvals, error: null };

      const result = await listPendingApprovals(MOCK_SCHOOL_ID);

      expect(result.success).toBe(true);
      expect(result.approvals).toHaveLength(2);
      expect(result.approvals[0].id).toBe('approval-1');
    });

    it('should not return expired approvals (filtered by gt query)', async () => {
      // The implementation uses .gt('expires_at', now) which means
      // the database does the filtering. An empty result means no
      // non-expired pending approvals exist.
      mockSelectListResult = { data: [], error: null };

      const result = await listPendingApprovals(MOCK_SCHOOL_ID);

      expect(result.success).toBe(true);
      expect(result.approvals).toHaveLength(0);

      // Verify the gt filter was applied
      expect(mockGt).toHaveBeenCalledWith('expires_at', expect.any(String));
    });
  });
});
