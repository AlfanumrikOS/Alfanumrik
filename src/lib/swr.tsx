'use client';

/**
 * SWR Data Layer — Alfanumrik's Caching Architecture
 *
 * Why SWR over raw fetch:
 * 1. Indian students on Jio 4G: show cached data instantly, revalidate in background
 * 2. Deduplication: 5 components requesting same data = 1 API call
 * 3. Retry on reconnect: auto-retry when student's phone gets signal back
 * 4. Focus revalidation: refresh data when student comes back to tab
 *
 * This is Alfanumrik's equivalent of Khan Academy's data fetching layer.
 *
 * Caching strategy:
 * - Snapshot: revalidate on focus + after mutations, no polling
 * - Leaderboard: poll every 5 min (same data for all users)
 * - Dashboard: revalidate on mount only (mutations trigger manual refresh)
 * - All hooks: 10s deduping interval to prevent request storms
 */

import useSWR, { SWRConfiguration } from 'swr';
import { supabase } from './supabase';
import {
  getStudentProfiles,
  getSubjects,
  getStudentSnapshot,
  getFeatureFlags,
  getStudyPlan,
  getReviewCards,
  getLeaderboard,
  getStudentNotifications,
  getMasteryOverview,
} from './supabase';

// Default SWR config optimized for Indian mobile networks
const DEFAULT_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false,         // Disabled by default; enabled per-hook where needed
  revalidateOnReconnect: true,      // Refresh when phone gets signal back
  dedupingInterval: 10000,          // 10s dedup to prevent request storms at scale
  errorRetryCount: 3,               // Retry failed requests 3 times
  errorRetryInterval: 2000,         // 2s between retries
  keepPreviousData: true,           // Show stale data while loading new
};

// Longer cache for relatively static data
const STATIC_CONFIG: SWRConfiguration = {
  ...DEFAULT_CONFIG,
  dedupingInterval: 60000,          // Dedupe for 1 min
  refreshInterval: 5 * 60 * 1000,  // Refresh every 5 min
};

/* ── Student Learning Profiles ── */
export function useStudentProfiles(studentId: string | undefined) {
  return useSWR(
    studentId ? `profiles/${studentId}` : null,
    () => getStudentProfiles(studentId!),
    DEFAULT_CONFIG
  );
}

/* ── Subjects List (rarely changes) ── */
export function useSubjects() {
  return useSWR('subjects', getSubjects, STATIC_CONFIG);
}

/* ── Student Snapshot (XP, streaks, mastery counts) ── */
export function useStudentSnapshot(studentId: string | undefined) {
  return useSWR(
    studentId ? `snapshot/${studentId}` : null,
    () => getStudentSnapshot(studentId!),
    { ...DEFAULT_CONFIG, revalidateOnFocus: true } // No polling; refreshed via invalidateSnapshot() after mutations
  );
}

/* ── Feature Flags ── */
export function useFeatureFlags() {
  return useSWR('flags', getFeatureFlags, STATIC_CONFIG);
}

/* ── Study Plan ── */
export function useStudyPlan(studentId: string | undefined) {
  return useSWR(
    studentId ? `study-plan/${studentId}` : null,
    () => getStudyPlan(studentId!),
    DEFAULT_CONFIG
  );
}

/* ── Review Cards (spaced repetition) ── */
export function useReviewCards(studentId: string | undefined, limit = 20) {
  return useSWR(
    studentId ? `review/${studentId}/${limit}` : null,
    () => getReviewCards(studentId!, limit),
    DEFAULT_CONFIG
  );
}

/* ── Leaderboard (via CDN-cached API route, not direct Supabase) ── */
export function useLeaderboard(period = 'weekly', limit = 50) {
  return useSWR(
    `leaderboard/${period}/${limit}`,
    async () => {
      // Use server API route with CDN caching (s-maxage=60) instead of direct
      // Supabase query. At 50K users this reduces DB load from 10K req/min to 1/min.
      const res = await fetch(`/api/v1/leaderboard?period=${period}&limit=${limit}`);
      if (!res.ok) throw new Error('Leaderboard fetch failed');
      const json = await res.json();
      return json.data ?? [];
    },
    { ...DEFAULT_CONFIG, refreshInterval: 300000 } // 5 min client polling + 60s CDN cache
  );
}

/* ── Notifications ── */
export function useNotifications(studentId: string | undefined, limit = 50) {
  return useSWR(
    studentId ? `notifications/${studentId}` : null,
    () => getStudentNotifications(studentId!, limit),
    DEFAULT_CONFIG
  );
}

/* ── Mastery Overview ── */
export function useMasteryOverview(studentId: string | undefined, subject?: string) {
  return useSWR(
    studentId ? `mastery/${studentId}/${subject || 'all'}` : null,
    () => getMasteryOverview(studentId!, subject),
    DEFAULT_CONFIG
  );
}

/* ── Dashboard (batched RPC) ── */
export function useDashboardData(studentId: string | undefined) {
  return useSWR(
    studentId ? `dashboard/${studentId}` : null,
    async () => {
      const { data, error } = await supabase.rpc('get_dashboard_data', { p_student_id: studentId });
      if (error) throw error;
      return data as Record<string, any>;
    },
    DEFAULT_CONFIG
  );
}

/* ── Cache Invalidation Helpers ── */
import { mutate } from 'swr';

export function invalidateSnapshot(studentId: string) {
  mutate(`snapshot/${studentId}`);
}

export function invalidateProfiles(studentId: string) {
  mutate(`profiles/${studentId}`);
}

export function invalidateLeaderboard() {
  mutate((key: string) => typeof key === 'string' && key.startsWith('leaderboard/'), undefined, { revalidate: true });
}

export function invalidateNotifications(studentId: string) {
  mutate(`notifications/${studentId}`);
}

export function invalidateDashboard(studentId: string) {
  mutate(`dashboard/${studentId}`);
}

export function invalidateAll(studentId: string) {
  invalidateSnapshot(studentId);
  invalidateProfiles(studentId);
  invalidateLeaderboard();
  invalidateNotifications(studentId);
}

/** Clear ALL SWR cache entries — call on signout to prevent data leakage between accounts */
export function clearAllCache() {
  mutate(() => true, undefined, { revalidate: false });
}
