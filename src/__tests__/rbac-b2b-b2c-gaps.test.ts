import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase-admin
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mockMaybeSingle,
      }),
      maybeSingle: mockMaybeSingle,
    }),
    maybeSingle: mockMaybeSingle,
  }),
});
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockRpc = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom, rpc: mockRpc }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { checkParentPlanGate } from '@/lib/plan-gate';

describe('B2B/B2C Gap Fixes', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('Parent Plan Gate (Gap 5)', () => {
    it('should resolve child plan when checking parent permission', async () => {
      // Mock parent_plan_permission_map lookup
      mockMaybeSingle
        .mockResolvedValueOnce({ data: { required_child_permission: 'report.download_own' }, error: null })
        // Mock student lookup
        .mockResolvedValueOnce({ data: { subscription_plan: 'pro' }, error: null })
        // Mock plan_permission_overrides lookup (from checkPlanGate)
        .mockResolvedValueOnce({ data: { is_granted: true, usage_limit: null }, error: null });

      const result = await checkParentPlanGate('parent-1', 'child.download_report', 'student-1');
      expect(result.granted).toBe(true);
    });

    it('should deny parent when child is on free plan without the permission', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: { required_child_permission: 'report.download_own' }, error: null })
        .mockResolvedValueOnce({ data: { subscription_plan: 'free' }, error: null })
        .mockResolvedValueOnce({ data: { is_granted: false, usage_limit: null }, error: null });

      const result = await checkParentPlanGate('parent-1', 'child.download_report', 'student-1');
      expect(result.granted).toBe(false);
      expect(result.code).toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('should grant when no mapping exists (no restriction)', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await checkParentPlanGate('parent-1', 'child.view_progress', 'student-1');
      expect(result.granted).toBe(true);
    });

    it('should fail open when child not found', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: { required_child_permission: 'report.download_own' }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const result = await checkParentPlanGate('parent-1', 'child.download_report', 'nonexistent');
      expect(result.granted).toBe(true);
    });
  });
});
