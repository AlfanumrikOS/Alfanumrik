import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RBAC + Plan Gate Integration Tests
 *
 * Verifies the full RBAC + Plan Gate flow with mocked DB calls.
 * Tests cover: free/starter/pro/unlimited plan gating, daily limits,
 * plan alias normalization, fail-open on DB errors.
 */

// ── Mock supabase-admin before importing plan-gate ──

const mockMaybeSingle = vi.fn();
const mockEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockRpc = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { checkPlanGate, clearPlanGateCache } from '@/lib/plan-gate';

describe('RBAC + Plan Gate Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPlanGateCache();

    // Reset chain so each test can set maybeSingle independently
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq1 });
    mockEq1.mockReturnValue({ eq: mockEq2 });
    mockEq2.mockReturnValue({ maybeSingle: mockMaybeSingle });
  });

  // ─── Scenario 1: Free student quiz.attempt under limit ───────

  it('free student: quiz.attempt allowed under limit', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 5, period: 'day' } },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { allowed: true, current_count: 3, daily_limit: 5 },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'quiz.attempt', 'free');

    expect(result.granted).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.limit).toBe(5);
    expect(result.count).toBe(3);
  });

  // ─── Scenario 2: Free student blocked from simulation ────────

  it('free student: simulation.interact blocked by plan', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: false, usage_limit: null },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'simulation.interact', 'free');

    expect(result.granted).toBe(false);
    expect(result.code).toBe('PLAN_UPGRADE_REQUIRED');
    expect(result.planNeeded).toBe('starter'); // free -> starter
  });

  // ─── Scenario 3: Free student at daily quiz limit ────────────

  it('free student: quiz.attempt blocked at daily limit', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 5, period: 'day' } },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { allowed: false, current_count: 5, daily_limit: 5 },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'quiz.attempt', 'free');

    expect(result.granted).toBe(false);
    expect(result.code).toBe('DAILY_LIMIT_REACHED');
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(5);
    expect(result.count).toBe(5);
  });

  // ─── Scenario 4: Pro student unlimited quiz ──────────────────

  it('pro student: quiz.attempt unlimited (no usage check)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: null },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'quiz.attempt', 'pro');

    expect(result.granted).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ─── Scenario 5: Legacy plan alias maps correctly ────────────

  it('legacy plan alias "basic" maps to starter limits', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 20, period: 'day' } },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { allowed: true, current_count: 10, daily_limit: 20 },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'quiz.attempt', 'basic');

    expect(result.granted).toBe(true);
    expect(result.remaining).toBe(10);
    // Verify the override lookup used the normalized plan name
    expect(mockEq1).toHaveBeenCalledWith('plan', 'starter');
    expect(mockFrom).toHaveBeenCalledWith('plan_permission_overrides');
  });

  // ─── Scenario 6: Free student foxy.chat under limit ──────────

  it('free student: foxy.chat allowed under 5/day limit', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 5, period: 'day' } },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { allowed: true, current_count: 2, daily_limit: 5 },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'foxy.chat', 'free');

    expect(result.granted).toBe(true);
    expect(result.remaining).toBe(3);
    expect(result.limit).toBe(5);
    expect(result.count).toBe(2);
  });

  // ─── Scenario 7: Starter student foxy.chat under limit ───────

  it('starter student: foxy.chat allowed under 30/day limit', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 30, period: 'day' } },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { allowed: true, current_count: 15, daily_limit: 30 },
      error: null,
    });

    const result = await checkPlanGate('student-1', 'foxy.chat', 'starter');

    expect(result.granted).toBe(true);
    expect(result.remaining).toBe(15);
    expect(result.limit).toBe(30);
    expect(result.count).toBe(15);
  });

  // ─── Scenario 8: Fail-open on DB errors ──────────────────────

  it('gracefully handles DB errors (fail-open)', async () => {
    // Simulate a thrown exception in the override lookup
    mockMaybeSingle.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await checkPlanGate('student-1', 'quiz.attempt', 'free');

    // Plan gate is designed to fail-open: errors grant access
    expect(result.granted).toBe(true);
  });
});
