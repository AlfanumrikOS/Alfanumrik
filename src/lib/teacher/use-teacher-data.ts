'use client';

/**
 * Teacher dashboard SWR hooks — thin, additive wrappers over the EXISTING
 * `teacher-dashboard` Edge actions. No server/Edge code is changed; these hooks
 * fetch and return server data VERBATIM (no scoring/XP/mastery math — assessment
 * owns those values). Phases 2-3 consume these so each surface stops re-rolling
 * its own bespoke `api()` call.
 *
 * Conventions (mirror src/lib/swr.tsx DEFAULT_CONFIG):
 *   dedupingInterval 10s · revalidateOnFocus false · revalidateOnReconnect true ·
 *   errorRetryCount 2 · keepPreviousData true.
 *
 * Key discipline: the SWR key is null until the required params are present
 * (teacher session, classId, studentId, the Wave B `enabled` gate) so a hook is
 * inert — and its data/chunk never loads — until the caller is ready.
 */

import useSWR, { SWRConfiguration } from 'swr';
import { useAuth } from '@/lib/AuthContext';
import {
  supabase,
  supabaseUrl as SUPABASE_URL,
  supabaseAnonKey as SUPABASE_ANON,
} from '@/lib/supabase';
import type {
  HeatmapData,
  RiskAlert,
  StudentMasteryReport,
} from '@/lib/types';
import type { GradingQueueItem } from '@/app/teacher/GradingQueue';

// OS SWR config for the teacher surfaces (mirrors swr.tsx DEFAULT_CONFIG).
const TEACHER_SWR_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 10000,
  errorRetryCount: 2,
  keepPreviousData: true,
};

/**
 * teacher-dashboard Edge call. Mirrors CommandCenter's `api()` exactly:
 * auth header from the Supabase session with an apikey fallback, POST
 * { action, ...params }. Factored here so every hook shares one fetcher.
 */
export async function teacherDashboardFetch<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* apikey-only fallback */
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    const error = new Error(`API error ${res.status}: ${errorText}`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

// ── Local response shapes for actions without a shared type ──────────────────

/** `get_dashboard` — the teacher home summary. */
export interface TeacherDashboardClass {
  id: string;
  name: string;
  student_count: number;
  avg_mastery?: number;
}
export interface TeacherDashboardStats {
  total_students: number;
  active_alerts: number;
  critical_alerts: number;
  active_assignments: number;
}
export interface TeacherDashboardData {
  teacher?: { name: string };
  classes?: TeacherDashboardClass[];
  stats?: TeacherDashboardStats;
}

/** `get_alerts` — the at-risk rail. */
export interface AlertsResponse {
  alerts: RiskAlert[];
}

/** `get_grading_queue` — Wave B. */
export interface GradingQueueResponse {
  items: GradingQueueItem[];
  count: number;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Teacher home summary (`get_dashboard`). Inert until a teacher session resolves. */
export function useTeacherDashboard() {
  const { teacher } = useAuth();
  const teacherId = teacher?.id || '';
  return useSWR<TeacherDashboardData>(
    teacherId ? ['teacher-dashboard', 'get_dashboard', teacherId] : null,
    () => teacherDashboardFetch<TeacherDashboardData>('get_dashboard', { teacher_id: teacherId }),
    TEACHER_SWR_CONFIG,
  );
}

/**
 * Roster mastery heatmap (`get_heatmap`). Scoped to a class (and optional
 * subject). Inert until both the teacher session and a classId are present.
 */
export function useHeatmap(classId?: string, subject?: string) {
  const { teacher } = useAuth();
  const teacherId = teacher?.id || '';
  const subj = subject || 'math';
  return useSWR<HeatmapData>(
    teacherId && classId ? ['teacher-dashboard', 'get_heatmap', teacherId, classId, subj] : null,
    () =>
      teacherDashboardFetch<HeatmapData>('get_heatmap', {
        teacher_id: teacherId,
        class_id: classId,
        subject: subj,
      }),
    TEACHER_SWR_CONFIG,
  );
}

/**
 * At-risk alerts rail (`get_alerts`). Class scope is optional; without a
 * classId the Edge defaults to the teacher's full roster.
 */
export function useAlerts(classId?: string) {
  const { teacher } = useAuth();
  const teacherId = teacher?.id || '';
  return useSWR<AlertsResponse>(
    teacherId ? ['teacher-dashboard', 'get_alerts', teacherId, classId || 'all'] : null,
    () =>
      teacherDashboardFetch<AlertsResponse>('get_alerts', {
        teacher_id: teacherId,
        ...(classId ? { class_id: classId } : {}),
      }),
    TEACHER_SWR_CONFIG,
  );
}

/**
 * Class overview (`get_dashboard`, classes slice). Alias hook for surfaces that
 * only need the class list / switcher; shares the same Edge action + cache key
 * as useTeacherDashboard so there is no extra request.
 */
export function useClassOverview() {
  return useTeacherDashboard();
}

/**
 * Grading queue (`get_grading_queue`) — Wave B. Gated by `enabled`: when false
 * the key is null, so the hook is inert and the data never loads until the
 * Wave B flag is on at the call site.
 */
export function useGradingQueue(enabled: boolean, classId?: string) {
  const { teacher } = useAuth();
  const teacherId = teacher?.id || '';
  return useSWR<GradingQueueResponse>(
    enabled && teacherId
      ? ['teacher-dashboard', 'get_grading_queue', teacherId, classId || 'all']
      : null,
    () =>
      teacherDashboardFetch<GradingQueueResponse>('get_grading_queue', {
        teacher_id: teacherId,
        ...(classId ? { class_id: classId } : {}),
      }),
    TEACHER_SWR_CONFIG,
  );
}

/**
 * Per-student mastery + Bloom's report (`get_student_mastery_report`) — Wave C.
 * Inert until both the teacher session and a studentId are present.
 */
export function useStudentMasteryReport(studentId?: string) {
  const { teacher } = useAuth();
  const teacherId = teacher?.id || '';
  return useSWR<StudentMasteryReport>(
    teacherId && studentId
      ? ['teacher-dashboard', 'get_student_mastery_report', teacherId, studentId]
      : null,
    () =>
      teacherDashboardFetch<StudentMasteryReport>('get_student_mastery_report', {
        teacher_id: teacherId,
        student_id: studentId,
      }),
    TEACHER_SWR_CONFIG,
  );
}
