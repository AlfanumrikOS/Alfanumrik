/**
 * usage.ts — unit tests.
 *
 * P12 (AI safety) ties usage limits to subscription plan. We test:
 *   - Plan-limit lookup (free / starter / pro / unlimited)
 *   - Plan alias normalization (basic→starter, premium→pro, ultimate→unlimited)
 *   - Billing-cycle suffix stripping (_monthly / _yearly)
 *   - checkDailyUsage cache hit + miss paths (count, allowed, remaining)
 *   - checkDailyUsage when DB returns null
 *   - clearUsageCache resets cached state
 *   - recordUsage calls the atomic RPC + bumps cached count
 *   - getDailyUsageSummary aggregates per feature with defaults
 *   - checkUsageWithPlanGate happy path + PLAN_UPGRADE_REQUIRED + falls back on throw
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @/lib/supabase (the legacy facade — usage.ts imports `supabase`) ─

const mockMaybeSingle = vi.fn();
const mockEqDate = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEqFeature = vi.fn(() => ({ eq: mockEqDate }));
const mockEqStudent = vi.fn(() => ({ eq: mockEqFeature }));
// For getDailyUsageSummary the .eq chain ends earlier (no maybeSingle, returns rows)
const mockEqDateList = vi.fn(() => Promise.resolve({ data: [] as any[], error: null }));
const mockEqStudentList = vi.fn(() => ({ eq: mockEqDateList }));

const mockSelect = vi.fn();
const mockFrom = vi.fn((_table: string) => ({ select: mockSelect }));
const mockRpc = vi.fn((_name: string, _params?: unknown) =>
  Promise.resolve({ data: null, error: null }),
);

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

// Mock plan-gate so checkUsageWithPlanGate is testable in isolation
const mockCheckPlanGate = vi.fn();
vi.mock('@/lib/plan-gate', () => ({
  checkPlanGate: (userId: string, code: string, plan: string) => mockCheckPlanGate(userId, code, plan),
}));

// Import AFTER mocks
import {
  checkDailyUsage,
  recordUsage,
  getDailyUsageSummary,
  checkUsageWithPlanGate,
  clearUsageCache,
} from '@/lib/usage';

beforeEach(() => {
  clearUsageCache();
  vi.clearAllMocks();
  // Reset the chain so each test re-wires it freshly.
  mockSelect.mockReturnValue({ eq: mockEqStudent });
});

describe('checkDailyUsage', () => {
  it('returns allowed=true with full remaining when DB row is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const r = await checkDailyUsage('s-1', 'foxy_chat', 'free');

    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(5);
    expect(r.count).toBe(0);
    expect(r.remaining).toBe(5);
  });

  it('uses starter limits (30 chats / 20 quizzes)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { usage_count: 7 }, error: null });

    const r = await checkDailyUsage('s-2', 'foxy_chat', 'starter');

    expect(r.limit).toBe(30);
    expect(r.count).toBe(7);
    expect(r.remaining).toBe(23);
    expect(r.allowed).toBe(true);
  });

  it('returns allowed=false at limit exhaustion', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { usage_count: 5 }, error: null });

    const r = await checkDailyUsage('s-3', 'foxy_chat', 'free');

    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('serves second call from in-memory cache without re-querying DB', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { usage_count: 2 }, error: null });

    const r1 = await checkDailyUsage('s-cache', 'foxy_chat', 'free');
    const r2 = await checkDailyUsage('s-cache', 'foxy_chat', 'free');

    expect(r1).toEqual(r2);
    // The chain enters select() once (first call only); second call hits the cache.
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('clearUsageCache forces a re-query', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { usage_count: 1 }, error: null })
      .mockResolvedValueOnce({ data: { usage_count: 4 }, error: null });

    const r1 = await checkDailyUsage('s-clear', 'foxy_chat', 'free');
    expect(r1.count).toBe(1);

    clearUsageCache();

    const r2 = await checkDailyUsage('s-clear', 'foxy_chat', 'free');
    expect(r2.count).toBe(4);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it('normalizes legacy plan aliases (basic → starter)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const r = await checkDailyUsage('s-alias', 'foxy_chat', 'basic');
    expect(r.limit).toBe(30); // starter limit
  });

  it('strips _monthly billing-cycle suffix', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const r = await checkDailyUsage('s-monthly', 'quiz', 'starter_monthly');
    expect(r.limit).toBe(20); // starter quiz
  });

  it('falls back to free limits for unknown plan code', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const r = await checkDailyUsage('s-unknown', 'quiz', 'mystery_tier');
    expect(r.limit).toBe(5); // free quiz
  });

  it('treats pro tier as effectively unlimited for quizzes', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { usage_count: 50 }, error: null });
    const r = await checkDailyUsage('s-pro', 'quiz', 'pro');
    expect(r.limit).toBe(999999);
    expect(r.allowed).toBe(true);
  });
});

describe('recordUsage', () => {
  it('calls check_and_record_usage RPC with the right shape', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await recordUsage('student-x', 'foxy_chat', 'starter');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'check_and_record_usage',
      expect.objectContaining({
        p_student_id: 'student-x',
        p_feature: 'foxy_chat',
        p_limit: 30,
      }),
    );
  });

  it('optimistically bumps the cached count when present for today', async () => {
    // Seed the cache with a fresh entry
    mockMaybeSingle.mockResolvedValueOnce({ data: { usage_count: 4 }, error: null });
    await checkDailyUsage('student-y', 'foxy_chat', 'free');

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await recordUsage('student-y', 'foxy_chat', 'free');

    // No new DB query — second checkDailyUsage should reflect the bumped count.
    const r = await checkDailyUsage('student-y', 'foxy_chat', 'free');
    expect(r.count).toBe(5);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});

describe('getDailyUsageSummary', () => {
  it('returns zeroed entries for both features when DB returns no rows', async () => {
    mockSelect.mockReturnValueOnce({ eq: mockEqStudentList });
    mockEqDateList.mockResolvedValueOnce({ data: [], error: null });

    const out = await getDailyUsageSummary('student-z', 'free');

    expect(out.foxy_chat.count).toBe(0);
    expect(out.foxy_chat.limit).toBe(5);
    expect(out.foxy_chat.allowed).toBe(true);
    expect(out.quiz.count).toBe(0);
    expect(out.quiz.limit).toBe(5);
  });

  it('aggregates rows correctly per feature', async () => {
    mockSelect.mockReturnValueOnce({ eq: mockEqStudentList });
    mockEqDateList.mockResolvedValueOnce({
      data: [
        { feature: 'foxy_chat', usage_count: 12 },
        { feature: 'quiz', usage_count: 3 },
      ],
      error: null,
    });

    const out = await getDailyUsageSummary('student-q', 'starter');

    expect(out.foxy_chat.count).toBe(12);
    expect(out.foxy_chat.remaining).toBe(18);
    expect(out.quiz.count).toBe(3);
    expect(out.quiz.remaining).toBe(17);
  });

  it('handles null data gracefully (treats as empty array)', async () => {
    mockSelect.mockReturnValueOnce({ eq: mockEqStudentList });
    mockEqDateList.mockResolvedValueOnce({ data: null as unknown as any[], error: null });

    const out = await getDailyUsageSummary('student-null', 'free');

    expect(out.foxy_chat.count).toBe(0);
    expect(out.quiz.count).toBe(0);
  });
});

describe('checkUsageWithPlanGate', () => {
  it('returns granted result from plan-gate happy path', async () => {
    mockCheckPlanGate.mockResolvedValueOnce({
      granted: true,
      remaining: 25,
      limit: 30,
      count: 5,
    });

    const r = await checkUsageWithPlanGate('user-1', 'foxy_chat', 'starter');

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(25);
    expect(r.limit).toBe(30);
    expect(r.count).toBe(5);
    expect(mockCheckPlanGate).toHaveBeenCalledWith('user-1', 'foxy.chat', 'starter');
  });

  it('returns blocked sentinel when plan-gate signals upgrade required', async () => {
    mockCheckPlanGate.mockResolvedValueOnce({
      granted: false,
      code: 'PLAN_UPGRADE_REQUIRED',
    });

    const r = await checkUsageWithPlanGate('user-2', 'quiz', 'free');

    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.limit).toBe(0);
    expect(r.count).toBe(0);
  });

  it('falls back to checkDailyUsage when plan-gate throws', async () => {
    mockCheckPlanGate.mockRejectedValueOnce(new Error('plan-gate down'));
    mockMaybeSingle.mockResolvedValueOnce({ data: { usage_count: 2 }, error: null });

    const r = await checkUsageWithPlanGate('user-3', 'quiz', 'starter');

    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(20); // starter quiz
    expect(r.count).toBe(2);
  });

  it('uses sentinel-large remaining/limit when plan-gate omits them', async () => {
    mockCheckPlanGate.mockResolvedValueOnce({ granted: true });
    const r = await checkUsageWithPlanGate('user-4', 'foxy_chat', 'unlimited');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(999999);
    expect(r.limit).toBe(999999);
  });
});
