/**
 * ALFANUMRIK — Usage Enforcement
 *
 * Tracks and enforces daily usage limits per student per feature.
 * Uses Supabase `student_daily_usage` table with feature + usage_count columns.
 *
 * Plan limits (aligned with subscription_plans table + get_plan_limit RPC):
 *   free:      5 chats / 5 quizzes per day
 *   starter:   unlimited chats / 20 quizzes per day
 *   pro:       unlimited chats / unlimited quizzes per day
 *   unlimited: unlimited everything
 *
 * IMPORTANT: enforcement is DB-authoritative — `check_and_record_usage` derives
 * the cap from `get_plan_limit()` → `subscription_plans.foxy_chats_per_day`
 * (a value of -1 means "unlimited" and is mapped to 999999). The numbers below
 * are DISPLAY defaults ONLY and MUST mirror the DB; the paid tiers therefore use
 * the same {@link UNLIMITED_USAGE_SENTINEL} the DB maps -1 to, so the UI never
 * implies a finite paid cap (that stale "30 left" / "100 left" was the bug).
 *
 * ─── PLAN_LIMITS IS NOW A FALLBACK ONLY (P0-1 school-coverage fix) ───────────
 * `checkDailyUsage` PREFERS the server's authoritative number, fetched from
 * `GET /api/usage/daily` — a thin read-through to the very same
 * `get_plan_limit()` RPC that enforcement uses. That RPC has honoured SCHOOL
 * (B2B) coverage since migration 20260729130400, returning
 * GREATEST(personal limit, school-derived limit).
 *
 * The table below CANNOT express that: it is keyed on the
 * `students.subscription_plan` COLUMN, which is school-blind. A student covered
 * by a paid/trial school resolves to 'free' here and used to be shown — and
 * client-side BLOCKED at — 5 chats while the server allowed unlimited. That was
 * the demo defect.
 *
 * So PLAN_LIMITS is retained strictly as the offline/failure fallback. It is
 * deliberately the CONSERVATIVE direction: for a school-covered student it
 * under-promises (shows the personal-tier cap) and never over-promises. It is
 * NOT a second limit authority and must not be consulted when the server
 * answered. Its "mirror the DB" contract still stands for the B2C tiers.
 */

import { supabase } from './supabase';
import { checkPlanGate, type PlanGateResult } from '@alfanumrik/lib/plan-gate';
import { UNLIMITED_USAGE_SENTINEL, isUnlimitedUsage } from '@alfanumrik/lib/usage-sentinel';

// ─── Limits by subscription plan ─────────────────────────────

type Feature = 'foxy_chat' | 'quiz';

/**
 * The unlimited sentinel + its detector are single-sourced in the
 * dependency-free `./usage-sentinel` leaf, so the entitlements catalog (a shared
 * client+server contract, imported by the `'use client'` super-admin panel) can
 * reuse the EXACT same value without dragging this module's server-only
 * transitive graph (`plan-gate` → `supabase-admin`) into a client bundle (P8).
 * Re-exported here unchanged so every existing `from '.../usage'` importer keeps
 * working. `UNLIMITED_USAGE_SENTINEL` is also used by `PLAN_LIMITS` below.
 */
export { UNLIMITED_USAGE_SENTINEL, isUnlimitedUsage };

const PLAN_LIMITS: Record<string, Record<Feature, number>> = {
  free:      { foxy_chat: 5,                        quiz: 5 },
  starter:   { foxy_chat: UNLIMITED_USAGE_SENTINEL, quiz: 20 },
  pro:       { foxy_chat: UNLIMITED_USAGE_SENTINEL, quiz: UNLIMITED_USAGE_SENTINEL },
  unlimited: { foxy_chat: UNLIMITED_USAGE_SENTINEL, quiz: UNLIMITED_USAGE_SENTINEL },
};

// Maps legacy codes and billing-cycle variants to canonical tier
const PLAN_ALIAS: Record<string, string> = {
  basic: 'starter', premium: 'pro', ultimate: 'unlimited',
};

function normalizePlanCode(plan: string): string {
  const base = plan.replace(/_(monthly|yearly)$/, '');
  return PLAN_ALIAS[base] ?? base;
}

function getLimitForPlan(plan: string, feature: Feature): number {
  return (PLAN_LIMITS[normalizePlanCode(plan)] ?? PLAN_LIMITS.free)[feature];
}

// ─── Server-authoritative usage (the PREFERRED source) ───────────────────────

/**
 * Fetch the caller's own daily quota from `GET /api/usage/daily`, which reads
 * the `get_plan_limit()` RPC — literally the number `check_and_record_usage()`
 * enforces against, school (B2B) coverage included.
 *
 * The browser cannot call `get_plan_limit` directly: migration 20260729130400 §5
 * REVOKEs EXECUTE from `anon`/`authenticated`, so the service-role route is the
 * only way for the client to see the authoritative value.
 *
 * Returns `null` on ANY failure (no browser, network error, non-2xx, malformed
 * body) so the caller degrades to the conservative local default rather than to
 * a fabricated generous one. Never throws.
 */
async function fetchServerUsage(
  feature: Feature,
): Promise<{ limit: number; count: number } | null> {
  // Relative URL — browser only. On the server there is no session cookie to
  // send and no origin to resolve, so we simply don't try.
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

  try {
    const res = await fetch(`/api/usage/daily?feature=${encodeURIComponent(feature)}`, {
      credentials: 'same-origin', // session cookie → authorizeRequest
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const body = await res.json();
    if (!body?.success) return null;

    const limit = body.data?.limit;
    const count = body.data?.count;
    // Only trust a fully-formed numeric answer; anything else is a fallback.
    if (typeof limit !== 'number' || typeof count !== 'number') return null;
    if (!Number.isFinite(limit) || !Number.isFinite(count)) return null;

    return { limit, count };
  } catch {
    return null;
  }
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
 *
 * SOURCE ORDER (P0-1):
 *   1. `GET /api/usage/daily` — the server's authoritative `get_plan_limit()`
 *      number, which honours SCHOOL (B2B) coverage. This is what enforcement
 *      uses, so the badge and the gate agree.
 *   2. Local fallback — `PLAN_LIMITS[students.subscription_plan]` + a direct
 *      read of the usage row. School-blind and therefore CONSERVATIVE (it can
 *      only under-state a school-covered student's cap, never over-state it).
 *      This is exactly the pre-fix behavior, so pure-B2C students are unchanged
 *      whichever branch runs.
 *
 * `plan` is now consulted ONLY on the fallback branch. It is kept in the
 * signature for call-site compatibility.
 */
export async function checkDailyUsage(
  studentId: string,
  feature: Feature,
  plan: string = 'free',
): Promise<UsageResult> {
  const key = cacheKey(studentId, feature);
  const today = todayISO();

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

  // 1. PREFERRED: the same authority that enforces. Both the limit AND the count
  //    come from the server so they describe one consistent moment.
  const server = await fetchServerUsage(feature);
  if (server) {
    cache.set(key, {
      count: server.count,
      limit: server.limit,
      date: today,
      fetchedAt: Date.now(),
    });
    return {
      allowed: server.count < server.limit,
      remaining: Math.max(0, server.limit - server.count),
      limit: server.limit,
      count: server.count,
    };
  }

  // 2. FALLBACK: school-blind local default (conservative — never over-promises).
  const limit = getLimitForPlan(plan, feature);

  // Query DB
  const { data, error } = await supabase
    .from('student_daily_usage')
    .select('usage_count')
    .eq('student_id', studentId)
    .eq('feature', feature)
    .eq('usage_date', today)
    .maybeSingle();

  // A failed read is not "0 used today". The displayed number stays optimistic
  // (this is the UI badge — the hard gate lives server-side in /api/foxy, see
  // recordUsage below), but the fabricated count must NOT be cached, or one
  // blip pins the badge at "0 used" for the whole TTL. P13: no student id.
  if (error) {
    console.warn('[usage] daily usage read failed:', error.code, error.message);
    return {
      allowed: true,
      remaining: limit,
      limit,
      count: 0,
    };
  }

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
 * Uses the atomic check_and_record_usage RPC so concurrent client-side
 * calls can't both pass the limit check before either increment lands.
 *
 * NOTE: The hard enforcement gate is in the /api/foxy Next.js route
 * (also using check_and_record_usage). This client-side call keeps the
 * UI usage badge accurate.
 */
export async function recordUsage(
  studentId: string,
  feature: Feature,
  _plan: string = 'free',
): Promise<void> {
  const today = todayISO();

  // p_limit intentionally omitted: check_and_record_usage derives the
  // authoritative cap internally via get_plan_limit() and IGNORES any p_limit
  // argument for EVERY feature (foxy_chat, quiz, …). Passing a Node-side number
  // here used to imply a false local authority. Mirrors the /api/foxy quota.ts
  // fix (checkAndIncrementQuota). `_plan` is retained (underscored) only for
  // call-site/back-compat with existing 3-arg callers.
  await supabase.rpc('check_and_record_usage', {
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

  const { data, error } = await supabase
    .from('student_daily_usage')
    .select('feature, usage_count')
    .eq('student_id', studentId)
    .eq('usage_date', today);

  // Display-only summary: an error degrades to all-zero counts, exactly as
  // before, but is no longer indistinguishable from a genuinely unused day.
  // P13: no student id in the log.
  if (error) {
    console.warn('[usage] daily usage summary read failed:', error.code, error.message);
  }

  const rows = data ?? [];
  const features: Feature[] = ['foxy_chat', 'quiz'];
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

// ─── Plan-Gate-Aware Usage Check ────────────────────────────

const FEATURE_TO_PERMISSION: Record<Feature, string> = {
  foxy_chat: 'foxy.chat',
  quiz: 'quiz.attempt',
};

/**
 * Check usage via the RBAC plan-gate system first, falling back to
 * the legacy checkDailyUsage when no permission mapping exists or
 * when the plan-gate call fails.
 */
export async function checkUsageWithPlanGate(
  userId: string,
  feature: Feature,
  plan: string = 'free',
): Promise<UsageResult> {
  const permissionCode = FEATURE_TO_PERMISSION[feature];
  if (!permissionCode) return checkDailyUsage(userId, feature, plan);

  try {
    const result: PlanGateResult = await checkPlanGate(userId, permissionCode, plan);

    if (result.code === 'PLAN_UPGRADE_REQUIRED') {
      return { allowed: false, remaining: 0, limit: 0, count: 0 };
    }

    return {
      allowed: result.granted,
      remaining: result.remaining ?? 999999,
      limit: result.limit ?? 999999,
      count: result.count ?? 0,
    };
  } catch {
    return checkDailyUsage(userId, feature, plan);
  }
}
