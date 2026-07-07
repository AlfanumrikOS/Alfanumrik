/**
 * Tests for POST /api/rhythm/today — cache-bust endpoint
 * REG coverage: validates the new cache-invalidation handler is authenticated
 * and calls cacheInvalidatePrefixAsync with the correct key prefix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache module
vi.mock('@alfanumrik/lib/cache', () => ({
  cacheFetchAsync: vi.fn(),
  CACHE_TTL: { USER: 30000 },
  cacheInvalidatePrefixAsync: vi.fn().mockResolvedValue(undefined),
}));

// Mock supabase-server
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

// Mock feature-flags
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
  PEDAGOGY_V2_FLAGS: { DAILY_RHYTHM: 'ff_pedagogy_v2_daily_rhythm' },
  ADAPTIVE_REMEDIATION_FLAGS: { V1: 'ff_adaptive_remediation_v1' },
}));

// Mock logger
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn() } }));

// Mock other dependencies used by GET handler to prevent import errors
vi.mock('@alfanumrik/lib/learn/daily-rhythm-orchestrator', () => ({ composeDailyRhythm: vi.fn() }));
vi.mock('@alfanumrik/lib/learn/due-reviews-adapter', () => ({ dueReviewsToCards: vi.fn() }));
vi.mock('@alfanumrik/lib/learn/remediation-queue-adapter', () => ({
  ADAPTIVE_REMEDIATION_RULES: { max_remediation_cards_per_day: 3, max_daily_queue_total: 10 },
  compareBySeverity: vi.fn(),
}));
vi.mock('@alfanumrik/lib/goals/goal-profile', () => ({ resolveGoalProfile: vi.fn() }));

import { POST } from '@/app/api/rhythm/today/route';
import { cacheInvalidatePrefixAsync } from '@alfanumrik/lib/cache';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';

const USER_ID = 'user-abc-123';

function makeMockSupabase(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        userId
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: new Error('no session') }
      ),
    },
  };
}

describe('POST /api/rhythm/today', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    (createSupabaseServerClient as any).mockResolvedValue(makeMockSupabase(null));
    const req = new Request('http://localhost/api/rhythm/today', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
    expect(cacheInvalidatePrefixAsync).not.toHaveBeenCalled();
  });

  it('invalidates rhythm cache with correct prefix for authenticated user', async () => {
    (createSupabaseServerClient as any).mockResolvedValue(makeMockSupabase(USER_ID));
    const req = new Request('http://localhost/api/rhythm/today', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(cacheInvalidatePrefixAsync).toHaveBeenCalledWith(`rhythm:today:${USER_ID}:`);
    expect(cacheInvalidatePrefixAsync).toHaveBeenCalledTimes(1);
  });

  it('uses prefix with trailing colon to match all dayKey variants', async () => {
    (createSupabaseServerClient as any).mockResolvedValue(makeMockSupabase(USER_ID));
    const req = new Request('http://localhost/api/rhythm/today', { method: 'POST' });
    await POST(req);
    const callArg = (cacheInvalidatePrefixAsync as any).mock.calls[0][0] as string;
    // Must end with ":" so it prefix-matches rhythm:today:userId:12345 (dayKey)
    expect(callArg.endsWith(':')).toBe(true);
    // Must not be just the userId (must include the route segment)
    expect(callArg).toContain('rhythm:today:');
  });
});
