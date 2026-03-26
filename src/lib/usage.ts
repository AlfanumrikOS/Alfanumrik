/**
 * ALFANUMRIK — Usage Enforcement
 *
 * Tracks and enforces daily usage limits per student per feature.
 * Uses Supabase `student_daily_usage` table with feature + usage_count columns.
 *
 * Plan limits (aligned with subscription_plans table):
 *   free:      5 chats / 3 TTS / 5 quizzes per day
 *   starter:   30 chats / 15 TTS / 20 quizzes per day
 *   pro:       100 chats / 50 TTS / unlimited quizzes per day
 *   unlimited: unlimited everything
 */

import { supabase } from './supabase';

// ─── Limits by subscription plan ─────────────────────────────

type Feature = 'foxy_chat' | 'foxy_tts' | 'quiz';

const PLAN_LIMITS: Record<string, Record<Feature, number>> = {
  free:      { foxy_chat: 5,      foxy_tts: 3,      quiz: 5 },
  starter:   { foxy_chat: 30,     foxy_tts: 15,     quiz: 20 },
  basic:     { foxy_chat: 30,     foxy_tts: 15,     quiz: 20 },
  pro:       { foxy_chat: 100,    foxy_tts: 50,     quiz: 999999 },
  premium:   { foxy_chat: 100,    foxy_tts: 50,     quiz: 999999 },
  unlimited: { foxy_chat: 999999, foxy_tts: 999999,  quiz: 999999 },
};

function getLimitForPlan(plan: string, feature: Feature): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free)[feature];
}

// ─── Client-side in-memory cache (avoids spamming DB) ────────

interface CachedUsage {
  count: number;
  limit: number;
  date: string; // YYYY-MM-DD
  fetchedAt: number;
}

const cache = new Map<string, CachedUsage>();
const CACHE_TTL = 30_000; // 30 seconds

/** Clear usage cache — call after plan upgrade so new limits take effect immediately */
export function clearUsageCache() {
  cache.clear();
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(studentId: string, feature: Feature): string {
  return `${studentId}:${feature}`;
}

// ─── Public API ──────────────────────────────────────────────

export interface UsageResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  count: number;
}

/**
 * Check whether the student can use the given feature today.
 * Returns current count, limit, and whether the action is allowed.
 */
export async function checkDailyUsage(
  studentId: string,
  feature: Feature,
  plan: string = 'free',
): Promise<UsageResult> {
  const key = cacheKey(studentId, feature);
  const today = todayISO();
  const limit = getLimitForPlan(plan, feature);

  // Return from cache if fresh
  const cached = cache.get(key);
  if (cached && cached.date === today && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return {
      allowed: cached.count < cached.limit,
      remaining: Math.max(0, cached.limit - cached.count),
      limit: cached.limit,
      count: cached.count,
    };
  }

  // Query DB
  const { data } = await supabase
    .from('student_daily_usage')
    .select('usage_count')
    .eq('student_id', studentId)
    .eq('feature', feature)
    .eq('usage_date', today)
    .maybeSingle();

  const count = data?.usage_count ?? 0;

  cache.set(key, { count, limit, date: today, fetchedAt: Date.now() });

  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    limit,
    count,
  };
}

/**
 * Increment usage count for the student + feature + today.
 * Uses upsert so rows are created on first use each day.
 */
export async function recordUsage(
  studentId: string,
  feature: Feature,
): Promise<void> {
  const today = todayISO();

  await supabase.rpc('increment_daily_usage', {
    p_student_id: studentId,
    p_feature: feature,
    p_usage_date: today,
  });

  // Update cache optimistically
  const key = cacheKey(studentId, feature);
  const cached = cache.get(key);
  if (cached && cached.date === today) {
    cached.count += 1;
    cached.fetchedAt = Date.now();
  }
}

/**
 * Get all usage stats for a student for today (for UI display).
 */
export async function getDailyUsageSummary(
  studentId: string,
  plan: string = 'free',
): Promise<Record<Feature, UsageResult>> {
  const today = todayISO();

  const { data } = await supabase
    .from('student_daily_usage')
    .select('feature, usage_count')
    .eq('student_id', studentId)
    .eq('usage_date', today);

  const rows = data ?? [];
  const features: Feature[] = ['foxy_chat', 'foxy_tts', 'quiz'];
  const result = {} as Record<Feature, UsageResult>;

  for (const f of features) {
    const row = rows.find((r: any) => r.feature === f);
    const count = row?.usage_count ?? 0;
    const limit = getLimitForPlan(plan, f);
    result[f] = {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      limit,
      count,
    };
  }

  return result;
}
