'use client';

/**
 * src/lib/pulse/use-pulse.ts — Student Pulse SWR hooks.
 *
 * Client-side data hooks for the four Pulse lenses. They follow the platform
 * SWR conventions in `src/lib/swr.tsx`:
 *   - revalidateOnFocus: false (Pulse is a slow-moving monitoring surface; we
 *     do not want a refetch every time a teacher tabs back).
 *   - refreshInterval in the 30–60s band (live-ish, but cheap for Indian 4G).
 *   - errorRetryCount 2 with no retry on 4xx (auth/permission failures are not
 *     transient).
 *   - The fetcher throws a typed Error carrying `.status` so SWR's onErrorRetry
 *     can branch on it (same shape as useLeaderboard / useLearnerNext).
 *
 * Every route returns `{ success, data }`; these hooks unwrap `.data` so the
 * consumer gets the bare contract type (PulseResponse / ClassPulseResponse /
 * SchoolPulse). A null SWR key (missing id) disables the request entirely.
 *
 * Contract types: `@/lib/pulse/types` (the single source of truth shared with
 * the server routes).
 */

import useSWR, { SWRConfiguration } from 'swr';
import { authHeader } from '@/lib/api/auth-header';
import type {
  PulseResponse,
  ClassPulseResponse,
  SchoolPulse,
} from './types';

// ── Config: monitoring-surface defaults (no focus revalidation, gentle poll) ──
const PULSE_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 15000,
  refreshInterval: 30000, // 30s live-ish refresh for single-student + class.
  errorRetryCount: 2,
  keepPreviousData: true,
  onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
    const status = (error as { status?: number })?.status;
    // Never retry auth/permission/validation failures.
    if (typeof status === 'number' && status >= 400 && status < 500) return;
    const delay = Math.min(2000 * Math.pow(2, retryCount), 8000);
    setTimeout(() => revalidate({ retryCount }), delay);
  },
};

// School Pulse changes slowly (whole-school aggregates) — poll less often.
const SCHOOL_PULSE_CONFIG: SWRConfiguration = {
  ...PULSE_CONFIG,
  dedupingInterval: 30000,
  refreshInterval: 60000, // 60s.
};

/**
 * Shared fetcher: GET a Pulse route, throw a typed Error on non-2xx, and unwrap
 * the `{ success, data }` envelope to the bare contract type.
 */
async function pulseFetcher<T>(url: string): Promise<T> {
  // The app's session lives in localStorage, not a cookie, so server routes
  // (authorizeRequest) need the access token forwarded as a Bearer header;
  // without it every /api/pulse/* route returns 401. authHeader() returns {}
  // when there is no session (the request still fires and surfaces the 401).
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: await authHeader(),
  });
  if (!res.ok) {
    const error = new Error(`Pulse fetch failed: ${url}`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  const json = (await res.json()) as { success?: boolean; data?: T };
  return (json.data ?? null) as T;
}

/* ── 1. Single-student Pulse ──
 * Pass a `students.id` to view another student's Pulse via
 * /api/pulse/student/[id]. Pass `'me'` (or omit and call useMyPulse) for the
 * caller's own self lens. A null/undefined id disables the request.
 */
export function usePulse(studentId: string | undefined) {
  return useSWR<PulseResponse>(
    studentId ? `/api/pulse/student/${studentId}` : null,
    pulseFetcher,
    PULSE_CONFIG,
  );
}

/* ── 1b. Own (self) Pulse ── */
export function useMyPulse(enabled: boolean = true) {
  return useSWR<PulseResponse>(
    enabled ? '/api/pulse/me' : null,
    pulseFetcher,
    PULSE_CONFIG,
  );
}

/* ── 2. Class Pulse (teacher) ── */
export function useClassPulse(classId: string | undefined) {
  return useSWR<ClassPulseResponse>(
    classId ? `/api/pulse/class/${classId}` : null,
    pulseFetcher,
    PULSE_CONFIG,
  );
}

/* ── 3. School Pulse (principal / institution_admin) ──
 * Optionally pass a schoolId to disambiguate when the caller administers
 * multiple schools (forwarded as ?school_id, validated server-side).
 */
export function useSchoolPulse(schoolId?: string) {
  const key = schoolId
    ? `/api/pulse/school?school_id=${encodeURIComponent(schoolId)}`
    : '/api/pulse/school';
  return useSWR<SchoolPulse>(key, pulseFetcher, SCHOOL_PULSE_CONFIG);
}
