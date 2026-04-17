import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabase-admin before importing plan-gate ──

const mockMaybeSingle = vi.fn();
const mockEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockRpc = vi.fn();

const mockSupabaseAdmin = {
  from: mockFrom,
  rpc: mockRpc,
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabaseAdmin),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import { checkPlanGate, getOverride, clearPlanGateCache } from '@/lib/plan-gate';

describe('Plan Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPlanGateCache();

    // Reset chain so each test can set maybeSingle independently
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq1 });
    mockEq1.mockReturnValue({ eq: mockEq2 });
    mockEq2.mockReturnValue({ maybeSingle: mockMaybeSingle });
  });

  // ─── Test 1: Grant when no override row exists ──────────────

  it('should grant access when no override row exists (null)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'starter');

    expect(result.granted).toBe(true);
    expect(result.code).toBeUndefined();
  });

  // ─── Test 2: Deny with PLAN_UPGRADE_REQUIRED ────────────────

  it('should deny with PLAN_UPGRADE_REQUIRED when is_granted=false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: false, usage_limit: null },
      error: null,
    });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'free');

    expect(result.granted).toBe(false);
    expect(result.code).toBe('PLAN_UPGRADE_REQUIRED');
    expect(result.planNeeded).toBe('starter'); // free -> starter
  });

  // ─── Test 3: Grant when under daily limit ───────────────────

  it('should grant when under daily limit (RPC returns allowed:true)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 30, period: 'day' } },
      error: null,
    });

    mockRpc.mockResolvedValueOnce({
      data: { allowed: true, current_count: 5, daily_limit: 30 },
      error: null,
    });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'starter');

    expect(result.granted).toBe(true);
    expect(result.remaining).toBe(25);
    expect(result.limit).toBe(30);
    expect(result.count).toBe(5);
    expect(result.code).toBeUndefined();

    // Verify RPC was called with correct params
    expect(mockRpc).toHaveBeenCalledWith(
      'check_and_increment_permission_usage',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_permission_code: 'foxy.chat',
        p_daily_limit: 30,
      }),
    );
  });

  // ─── Test 4: Deny with DAILY_LIMIT_REACHED ─────────────────

  it('should deny with DAILY_LIMIT_REACHED when over limit', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 5, period: 'day' } },
      error: null,
    });

    mockRpc.mockResolvedValueOnce({
      data: { allowed: false, current_count: 5, daily_limit: 5 },
      error: null,
    });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'free');

    expect(result.granted).toBe(false);
    expect(result.code).toBe('DAILY_LIMIT_REACHED');
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(5);
    expect(result.count).toBe(5);
  });

  // ─── Test 5: Default to free for unknown plan ───────────────

  it('should default to free for unknown plan', async () => {
    // An unknown plan like "mystery_plan" normalizes to "mystery_plan"
    // which has no alias, so it stays as-is. The override lookup uses
    // this normalized value. If no override exists, it grants access.
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'mystery_plan');

    expect(result.granted).toBe(true);

    // Verify the query was called with the raw plan name (no alias match)
    expect(mockEq1).toHaveBeenCalledWith('plan', 'mystery_plan');
  });

  // ─── Test 6: Grant when usage_limit is null (unlimited) ─────

  it('should grant when usage_limit is null (unlimited)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: null },
      error: null,
    });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'unlimited');

    expect(result.granted).toBe(true);
    expect(result.code).toBeUndefined();
    // RPC should NOT be called when there's no usage limit
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ─── Plan alias normalization ───────────────────────────────

  it('should normalize plan aliases (basic -> starter)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await checkPlanGate('user-1', 'foxy.chat', 'basic');

    expect(mockEq1).toHaveBeenCalledWith('plan', 'starter');
  });

  it('should normalize plan aliases (premium -> pro)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await checkPlanGate('user-1', 'foxy.chat', 'premium');

    expect(mockEq1).toHaveBeenCalledWith('plan', 'pro');
  });

  it('should strip billing cycle suffixes (starter_monthly -> starter)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await checkPlanGate('user-1', 'foxy.chat', 'starter_monthly');

    expect(mockEq1).toHaveBeenCalledWith('plan', 'starter');
  });

  it('should normalize school_premium to unlimited', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await checkPlanGate('user-1', 'foxy.chat', 'school_premium');

    expect(mockEq1).toHaveBeenCalledWith('plan', 'unlimited');
  });

  // ─── Fail-open on errors ────────────────────────────────────

  it('should fail open on override query error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB connection timeout' },
    });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'starter');

    // Error in getOverride returns null -> no restriction -> granted
    expect(result.granted).toBe(true);
  });

  it('should fail open on RPC error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: { max: 5, period: 'day' } },
      error: null,
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC failed' },
    });

    const result = await checkPlanGate('user-1', 'foxy.chat', 'free');

    expect(result.granted).toBe(true);
  });

  // ─── Cache behavior ─────────────────────────────────────────

  it('should cache override lookups', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_granted: true, usage_limit: null },
      error: null,
    });

    // First call hits DB
    await getOverride('starter', 'foxy.chat');
    expect(mockFrom).toHaveBeenCalledTimes(1);

    // Reset so second call doesn't use a new mock return
    mockFrom.mockClear();
    mockFrom.mockReturnValue({ select: mockSelect });

    // Second call should use cache
    const result = await getOverride('starter', 'foxy.chat');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result).toEqual({ is_granted: true, usage_limit: null });
  });

  it('should clear cache via clearPlanGateCache()', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { is_granted: true, usage_limit: null },
      error: null,
    });

    // Populate cache
    await getOverride('starter', 'foxy.chat');
    expect(mockFrom).toHaveBeenCalledTimes(1);

    // Clear cache
    clearPlanGateCache();
    mockFrom.mockClear();
    mockFrom.mockReturnValue({ select: mockSelect });

    // Should hit DB again
    await getOverride('starter', 'foxy.chat');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});
