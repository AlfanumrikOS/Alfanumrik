'use client';

/**
 * CommandCenter — Phase 3A Wave A / A4. The dense, desktop-first teacher home
 * gated behind `ff_teacher_command_center`. Composes the EXISTING
 * `teacher-dashboard` Edge data (get_dashboard / get_heatmap / get_alerts) into
 * a single command surface:
 *
 *   - Class switcher (header) — picks the class scope; re-fetches heatmap+alerts.
 *   - Roster mastery heatmap (concept × student) — get_heatmap. A cell links to
 *     the student detail page.
 *   - At-risk alerts rail — get_alerts. Each alert carries its A2
 *     `remediation_status`: when `none`, a one-tap "Assign remediation" button
 *     POSTs /api/teacher/remediation (optimistic + rollback on error); when
 *     assigned/in_progress/resolved, that state is shown read-only.
 *   - Today summary + action bar (assign remediation · gradebook · messages ·
 *     grading queue placeholder for Wave B).
 *
 * Boundary discipline (frontend):
 *   - NO business logic in the client — the server owns remediation state. The
 *     button only POSTs; the row's authoritative status comes back from the
 *     Edge join on the next load.
 *   - Scoring/XP/mastery math is untouched — mastery % is rendered verbatim
 *     from get_heatmap (assessment owns the values).
 *   - P7 bilingual via AuthContext.isHi. P13 no PII in client logs.
 *
 * Reuses the SAME `api()` Edge-call pattern and dark `.td-*` chrome the legacy
 * dashboard uses (defined inline here so this surface stands alone).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  supabase,
  supabaseUrl as SUPABASE_URL,
  supabaseAnonKey as SUPABASE_ANON,
} from '@/lib/supabase';
import { authHeader } from '@/lib/api/auth-header';
import { useTeacherAssignmentLifecycle } from '@/lib/use-teacher-assignment-lifecycle';
import { useTeacherGradebookDepth } from '@/lib/use-teacher-gradebook-depth';
import type {
  HeatmapData,
  HeatmapCell,
  HeatmapRow,
  RiskAlert,
  RemediationStatus,
  StudentMasteryReport as StudentMasteryReportData,
} from '@/lib/types';
import type { GradingQueueItem } from './GradingQueue';

// Phase 3A Wave B — the grading-queue surface is code-split so its chunk only
// loads when a teacher actually opens the queue (P10). The Wave B flag defaults
// OFF and is unseeded, so production never loads this chunk until rollout.
const GradingQueue = dynamic(() => import('./GradingQueue'), { ssr: false });

// Phase 3A Wave C — the Student Mastery Report panel is code-split so its chunk
// only loads when a teacher actually drills into a heatmap cell/row (P10). The
// Wave C flag defaults OFF and is unseeded, so production never loads this chunk
// until rollout (flag-OFF stays byte-identical).
const StudentMasteryReport = dynamic(() => import('./StudentMasteryReport'), { ssr: false });

// ── Bilingual helper (P7) ───────────────────────────────────────────────────
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ── Local Edge-data shapes (mirror the legacy dashboard) ────────────────────
interface DashboardClass {
  id: string;
  name: string;
  student_count: number;
  avg_mastery?: number;
}
interface DashboardStats {
  total_students: number;
  active_alerts: number;
  critical_alerts: number;
  active_assignments: number;
}
interface DashboardData {
  teacher?: { name: string };
  classes?: DashboardClass[];
  stats?: DashboardStats;
}
interface HeatmapConcept {
  id: string;
  title: string;
  chapter: number;
}

/** teacher-dashboard Edge call. Mirrors the legacy dashboard's `api()`. */
async function api(action: string, params: Record<string, unknown> = {}) {
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
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

function heatColor(p: number) {
  if (p >= 0.95) return 'bg-emerald-600';
  if (p >= 0.8) return 'bg-violet-600';
  if (p >= 0.6) return 'bg-blue-600';
  if (p >= 0.3) return 'bg-amber-600';
  if (p > 0.1) return 'bg-amber-400';
  return 'bg-slate-800';
}

const SEV: Record<string, { bg: string; border: string }> = {
  critical: { bg: 'bg-red-600', border: 'border-red-500' },
  high: { bg: 'bg-orange-600', border: 'border-orange-500' },
  medium: { bg: 'bg-amber-600', border: 'border-amber-400' },
  low: { bg: 'bg-blue-600', border: 'border-blue-500' },
};

const CHAPTER_NAMES: Record<number, string> = {
  1: 'Forces', 2: 'Motion', 3: 'Light', 4: 'Heat', 5: 'Sound',
  6: 'Atoms', 7: 'Cells', 8: 'Plants', 9: 'Animals', 10: 'Earth',
  11: 'Weather', 12: 'Matter',
};

// The Edge heatmap row carries `student_name`; some deploys additionally stamp
// `student_id` (the students page reads it defensively too). We widen the type
// locally so the drill-through can use the id when present without a contract
// change.
type HeatmapRowWithId = HeatmapRow & { student_id?: string };

// ─── Roster mastery heatmap ─────────────────────────────────────────────────
function RosterHeatmap({
  data,
  isHi,
  onCellStudent,
}: {
  data: HeatmapData;
  isHi: boolean;
  onCellStudent: (row: HeatmapRowWithId) => void;
}) {
  if (!data?.matrix?.length) {
    return (
      <div className="p-10 text-center text-slate-600 italic">
        {tt(
          isHi,
          'No mastery data yet — students need to start practicing.',
          'अभी तक कोई मास्टरी डेटा नहीं — छात्रों को अभ्यास शुरू करना होगा।',
        )}
      </div>
    );
  }
  const concepts = (data.concepts || []).slice(0, 12);
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-slate-500 font-medium text-[10px] text-left border-b border-slate-800 min-w-[120px] sticky left-0 bg-[#0F172A]">
              {tt(isHi, 'Student', 'छात्र')}
            </th>
            <th className="px-1 py-1.5 text-slate-500 font-medium text-[10px] text-center border-b border-slate-800">
              {tt(isHi, 'Avg', 'औसत')}
            </th>
            {concepts.map((c: HeatmapConcept, i: number) => (
              <th
                key={i}
                className="px-1 py-1.5 text-slate-500 font-medium text-[10px] text-center border-b border-slate-800"
                title={c.title}
              >
                Ch{c.chapter}
                {CHAPTER_NAMES[c.chapter] ? `: ${CHAPTER_NAMES[c.chapter].slice(0, 6)}` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row: HeatmapRow, ri: number) => (
            <tr key={ri} className="hover:bg-slate-800/40">
              <td className="px-2 py-1.5 text-slate-200 font-medium text-[13px] whitespace-nowrap sticky left-0 bg-[#0F172A]">
                <button
                  type="button"
                  onClick={() => onCellStudent(row as HeatmapRowWithId)}
                  className="text-left text-slate-200 hover:text-indigo-400 bg-transparent border-none cursor-pointer p-0"
                  title={tt(isHi, 'View student detail', 'छात्र विवरण देखें')}
                >
                  {row.student_name}
                </button>
              </td>
              <td className="px-1 py-1.5 text-center font-semibold text-slate-200 text-[13px]">
                {row.avg_mastery}%
              </td>
              {(row.cells || []).slice(0, 12).map((cell: HeatmapCell, ci: number) => (
                <td key={ci} className="py-[5px] px-[3px] text-center">
                  <button
                    type="button"
                    onClick={() => onCellStudent(row as HeatmapRowWithId)}
                    title={`${row.student_name} · ${concepts[ci]?.title ?? ''}: ${
                      cell.attempts > 0 ? Math.round(cell.p_know * 100) + '%' : '—'
                    }`}
                    className={`inline-block min-w-[32px] py-1 px-0.5 rounded text-[10px] font-medium text-white border-none cursor-pointer ${heatColor(
                      cell.p_know,
                    )} ${cell.attempts > 0 ? 'opacity-100' : 'opacity-30'}`}
                  >
                    {cell.attempts > 0 ? Math.round(cell.p_know * 100) : '—'}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── At-risk alert row with assign-remediation ──────────────────────────────
function AlertRow({
  alert,
  isHi,
  onAssign,
  busy,
}: {
  alert: RiskAlert;
  isHi: boolean;
  onAssign: (alert: RiskAlert) => void;
  busy: boolean;
}) {
  const s = SEV[alert.severity] || SEV.medium;
  const status: RemediationStatus = alert.remediation_status ?? 'none';

  return (
    <div className={`bg-slate-800 rounded-lg p-3 border-l-[3px] ${s.border}`}>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <span className={`text-[10px] font-bold py-0.5 px-2 rounded ${s.bg} text-white uppercase`}>
            {alert.severity}
          </span>
          <span className="ml-2 font-semibold text-slate-100 text-sm">{alert.title}</span>
        </div>
        {/* Remediation control — server owns the state; the button only POSTs. */}
        <div className="shrink-0">
          {status === 'none' && (
            <button
              type="button"
              onClick={() => onAssign(alert)}
              disabled={busy}
              data-testid="assign-remediation-btn"
              className="py-1 px-2.5 bg-indigo-500 text-white border-none rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {busy
                ? tt(isHi, 'Assigning…', 'सौंपा जा रहा है…')
                : tt(isHi, 'Assign remediation', 'रिमेडिएशन सौंपें')}
            </button>
          )}
          {status === 'assigned' && (
            <span
              data-testid="remediation-status"
              className="inline-flex items-center gap-1 py-1 px-2.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30"
            >
              {tt(isHi, 'Assigned', 'सौंपा गया')}
            </span>
          )}
          {status === 'in_progress' && (
            <span
              data-testid="remediation-status"
              className="inline-flex items-center gap-1 py-1 px-2.5 rounded-md text-[11px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30"
            >
              {tt(isHi, 'In progress', 'जारी है')}
            </span>
          )}
          {status === 'resolved' && (
            <span
              data-testid="remediation-status"
              className="inline-flex items-center gap-1 py-1 px-2.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            >
              ✓ {tt(isHi, 'Resolved', 'हल हो गया')}
            </span>
          )}
        </div>
      </div>
      <p className="text-slate-400 text-[13px] my-1.5">{alert.description}</p>
      {alert.recommended_action && (
        <p className="text-indigo-400 text-xs m-0 italic">
          {tt(isHi, 'Action', 'कार्रवाई')}: {alert.recommended_action}
        </p>
      )}
    </div>
  );
}

// ─── Action bar ─────────────────────────────────────────────────────────────
// `gradingQueueEnabled` is the Wave B flag (ff_teacher_assignment_lifecycle).
// When OFF the "Grading queue" button stays the disabled placeholder (Wave A
// behaviour, byte-identical). When ON it is enabled and opens the queue; the
// `gradingQueueCount` decorates it with the awaiting-grading backlog size.
// Exported so the Wave B flag-gating of this button is unit-testable in
// isolation (see grading-queue.test.tsx) without mounting the whole CC.
export function ActionBar({
  isHi,
  router,
  gradingQueueEnabled,
  gradingQueueCount,
  onOpenGradingQueue,
}: {
  isHi: boolean;
  router: ReturnType<typeof useRouter>;
  gradingQueueEnabled: boolean;
  gradingQueueCount: number;
  onOpenGradingQueue: () => void;
}) {
  const actions: {
    label: string;
    labelHi: string;
    onClick: () => void;
    disabled?: boolean;
    testid?: string;
    badge?: number;
  }[] = [
    {
      label: 'Open gradebook',
      labelHi: 'ग्रेड बुक खोलें',
      onClick: () => router.push('/teacher/grade-book'),
    },
    {
      label: 'Messages',
      labelHi: 'संदेश',
      onClick: () => router.push('/teacher/messages'),
    },
    {
      label: 'Assignments',
      labelHi: 'असाइनमेंट',
      onClick: () => router.push('/teacher/assignments'),
    },
    // Wave B — grading queue. Enabled only when ff_teacher_assignment_lifecycle
    // is ON; otherwise it stays the disabled placeholder from Wave A / A4.
    gradingQueueEnabled
      ? {
          label: 'Grading queue',
          labelHi: 'ग्रेडिंग कतार',
          onClick: onOpenGradingQueue,
          testid: 'grading-queue-action',
          badge: gradingQueueCount > 0 ? gradingQueueCount : undefined,
        }
      : {
          label: 'Grading queue',
          labelHi: 'ग्रेडिंग कतार',
          onClick: () => {},
          disabled: true,
          testid: 'grading-queue-action',
        },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          data-testid={a.testid}
          title={a.disabled ? tt(isHi, 'Coming soon', 'जल्द आ रहा है') : undefined}
          className="py-2 px-3.5 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg text-[13px] font-medium cursor-pointer hover:border-indigo-500 disabled:opacity-40 disabled:cursor-default"
        >
          {tt(isHi, a.label, a.labelHi)}
          {a.disabled && (
            <span className="ml-1.5 text-[10px] text-slate-500">
              {tt(isHi, 'soon', 'जल्द')}
            </span>
          )}
          {a.badge != null && (
            <span
              data-testid="grading-queue-action-badge"
              className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-500 text-white text-[10px] font-bold align-middle"
            >
              {a.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Command Center ─────────────────────────────────────────────────────────
export default function CommandCenter() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();

  // Wave B — additional gate (layered on top of ff_teacher_command_center) for
  // the cross-assignment grading queue. Default OFF ⇒ Wave A behaviour.
  const gradingQueueEnabled = useTeacherAssignmentLifecycle();

  // Wave C — additional gate for the mastery + Bloom's reporting depth. Default
  // OFF ⇒ heatmap cells stay plain navigate-to-student links (byte-identical).
  const gradebookDepthEnabled = useTeacherGradebookDepth();

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [activeClassId, setActiveClassId] = useState<string>('');
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [loadingDash, setLoadingDash] = useState(true);
  const [loadingClass, setLoadingClass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Wave B — grading queue state.
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueItems, setQueueItems] = useState<GradingQueueItem[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(false);

  // Wave C — student mastery report drill-through state.
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState<StudentMasteryReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  // The student currently being reported on (id + name) — re-used by retry/export.
  const [reportStudent, setReportStudent] = useState<{ id: string; name: string } | null>(null);

  const teacherId = teacher?.id || '';

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Wrong-role / unauth redirect (mirrors the legacy page).
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // 1. Dashboard (teacher + classes + stats).
  const loadDashboard = useCallback(async () => {
    if (!teacherId) {
      setLoadingDash(false);
      return;
    }
    setLoadingDash(true);
    setError(null);
    try {
      const d: DashboardData = await api('get_dashboard', { teacher_id: teacherId });
      setDash(d);
      const firstClassId = d?.classes?.[0]?.id || '';
      setActiveClassId((prev) => prev || firstClassId);
    } catch {
      // No PII in logs (P13) — surface a generic error to the user.
      setError('dashboard_load_failed');
    } finally {
      setLoadingDash(false);
    }
  }, [teacherId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // 2. Per-class heatmap + alerts (re-runs on class switch).
  const loadClassData = useCallback(async () => {
    if (!teacherId || !activeClassId) return;
    setLoadingClass(true);
    try {
      const [h, a] = await Promise.all([
        api('get_heatmap', { teacher_id: teacherId, class_id: activeClassId, subject: 'math' }),
        api('get_alerts', { teacher_id: teacherId, class_id: activeClassId }),
      ]);
      setHeatmap(h);
      // get_alerts returns the array directly (A2 shape: each alert carries
      // remediation_status). Tolerate the legacy {alerts:[...]} envelope too.
      setAlerts(Array.isArray(a) ? a : a?.alerts ?? []);
    } catch {
      setHeatmap(null);
      setAlerts([]);
    } finally {
      setLoadingClass(false);
    }
  }, [teacherId, activeClassId]);

  useEffect(() => {
    loadClassData();
  }, [loadClassData]);

  // 3. (Wave B) Cross-assignment grading queue. Fetched only when the Wave B
  //    flag is ON — when OFF this is a no-op and the queue surface never mounts,
  //    so flag-OFF stays byte-identical to Wave A. Scoped to the active class so
  //    the count tracks what the teacher is currently looking at; the Edge
  //    action defends teacher/roster scoping server-side regardless.
  const loadGradingQueue = useCallback(async () => {
    if (!gradingQueueEnabled || !teacherId) return;
    setQueueLoading(true);
    setQueueError(false);
    try {
      const params: Record<string, unknown> = { teacher_id: teacherId };
      if (activeClassId) params.class_id = activeClassId;
      const res = await api('get_grading_queue', params);
      const items: GradingQueueItem[] = Array.isArray(res?.items) ? res.items : [];
      setQueueItems(items);
      setQueueCount(typeof res?.count === 'number' ? res.count : items.length);
    } catch {
      // No PII in logs (P13). Surface a retryable error in the queue surface;
      // the badge falls back to 0 rather than a stale count.
      setQueueError(true);
      setQueueItems([]);
      setQueueCount(0);
    } finally {
      setQueueLoading(false);
    }
  }, [gradingQueueEnabled, teacherId, activeClassId]);

  useEffect(() => {
    loadGradingQueue();
  }, [loadGradingQueue]);

  // Open a queue row → navigate to the EXISTING /teacher/submissions review for
  // that submission/assignment (reuse, not rebuild). The submissions page
  // deep-links straight into its per-question breakdown + feedback form via the
  // query params. We optimistically remove the row so it leaves the queue the
  // moment the teacher starts grading it; loadGradingQueue() reconciles on
  // return (and after mark_submission_reviewed lands graded_at).
  const openQueueRow = useCallback(
    (item: GradingQueueItem) => {
      setQueueItems((list) => list.filter((x) => x.submission_id !== item.submission_id));
      setQueueCount((c) => Math.max(0, c - 1));
      router.push(
        `/teacher/submissions?assignment=${encodeURIComponent(
          item.assignment_id,
        )}&submission=${encodeURIComponent(item.submission_id)}`,
      );
    },
    [router],
  );

  // Assign remediation — optimistic update + rollback on error. The alert id is
  // the key; derived alerts have no chapter, so we POST general remediation
  // (student_id only). The server owns the authoritative status — we reconcile
  // by re-fetching alerts on success.
  const assignRemediation = useCallback(
    async (alert: RiskAlert) => {
      if (assigning[alert.id]) return;
      setAssigning((m) => ({ ...m, [alert.id]: true }));

      // Optimistic: flip THIS alert (and any other alert for the same student)
      // to 'assigned' immediately.
      const prevAlerts = alerts;
      setAlerts((list) =>
        list.map((x) =>
          x.student_id === alert.student_id ? { ...x, remediation_status: 'assigned' } : x,
        ),
      );

      try {
        const res = await fetch('/api/teacher/remediation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ student_id: alert.student_id }),
        });
        if (!res.ok) throw new Error(`remediation_assign_failed:${res.status}`);
        showToast(tt(isHi, 'Remediation assigned', 'रिमेडिएशन सौंपा गया'), 'success');
        // Reconcile with the server's authoritative status.
        await loadClassData();
      } catch {
        // Rollback the optimistic flip.
        setAlerts(prevAlerts);
        showToast(
          tt(isHi, "Couldn't assign — please retry", 'सौंपने में विफल — पुनः प्रयास करें'),
          'error',
        );
      } finally {
        setAssigning((m) => {
          const next = { ...m };
          delete next[alert.id];
          return next;
        });
      }
    },
    [assigning, alerts, isHi, showToast, loadClassData],
  );

  const goToStudent = useCallback(
    (studentName: string) => {
      // Reuse the existing students page (it owns roster + per-student drill-in).
      // We pass the name as a query hint; the page resolves it. No PII in logs.
      router.push(`/teacher/students?q=${encodeURIComponent(studentName)}`);
    },
    [router],
  );

  // Wave C — resolve a student_name → student_id map. The heatmap matrix carries
  // only the name; the alerts carry both, so we use them as the lookup. (When
  // the Edge additionally stamps student_id on a heatmap row we read it directly
  // in the drill handler and skip this map.) Lowercased keys for a tolerant
  // match against the heatmap's display name.
  const studentIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of alerts) {
      if (a.student_id && a.student_name) m.set(a.student_name.trim().toLowerCase(), a.student_id);
    }
    return m;
  }, [alerts]);

  // Wave C — fetch the per-student mastery report and open the panel. Roster
  // scoping + all mastery/Bloom math live server-side; the client only fetches
  // and renders verbatim. P13: no PII in logs (we surface a generic error).
  const fetchReport = useCallback(
    async (studentId: string, studentName: string) => {
      setReportLoading(true);
      setReportError(false);
      try {
        const res = await api('get_student_mastery_report', {
          teacher_id: teacherId,
          student_id: studentId,
        });
        setReport(res as StudentMasteryReportData);
      } catch {
        setReport(null);
        setReportError(true);
      } finally {
        setReportLoading(false);
      }
      // keep the target for retry/export even on error
      setReportStudent({ id: studentId, name: studentName });
    },
    [teacherId],
  );

  // Wave C — drill-through entry from a heatmap cell/row. When the depth flag is
  // OFF this is never invoked (the heatmap calls goToStudent instead), so
  // flag-OFF stays byte-identical. Resolves the id from the row (if stamped) or
  // the alerts map; falls back to the legacy navigate when no id is resolvable.
  const openReport = useCallback(
    (row: HeatmapRowWithId) => {
      const name = row.student_name || '';
      const resolvedId = row.student_id || studentIdByName.get(name.trim().toLowerCase()) || '';
      if (!resolvedId) {
        // No id available (e.g. a heatmap-only student with no alert) — fall back
        // to the existing students page so the click is never a dead end.
        goToStudent(name);
        return;
      }
      setReportOpen(true);
      setReport(null);
      setReportStudent({ id: resolvedId, name });
      fetchReport(resolvedId, name);
    },
    [studentIdByName, fetchReport, goToStudent],
  );

  // Heatmap cell handler: drill into the report when the depth flag is ON,
  // otherwise keep the existing navigate-to-student behaviour (byte-identical).
  const onHeatmapStudent = useCallback(
    (row: HeatmapRowWithId) => {
      if (gradebookDepthEnabled) openReport(row);
      else goToStudent(row.student_name);
    },
    [gradebookDepthEnabled, openReport, goToStudent],
  );

  // Wave C — parent-ready CSV export. Reuses the SAME blob-download pattern as
  // the gradebook export. The server builds the CSV (single source of truth);
  // the client only triggers the download.
  const exportReport = useCallback(async () => {
    if (!reportStudent) return;
    setReportExporting(true);
    try {
      const res = await api('export_student_report', {
        teacher_id: teacherId,
        student_id: reportStudent.id,
      });
      const filename = String(res?.filename || 'student_report.csv');
      const content = String(res?.csv_content || '');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(tt(isHi, 'Report downloaded', 'रिपोर्ट डाउनलोड हुई'), 'success');
    } catch {
      // P13: no PII in logs — generic toast only.
      showToast(
        tt(isHi, "Couldn't download — please retry", 'डाउनलोड नहीं हो सका — पुनः प्रयास करें'),
        'error',
      );
    } finally {
      setReportExporting(false);
    }
  }, [reportStudent, teacherId, isHi, showToast]);

  const classes = useMemo(() => dash?.classes ?? [], [dash?.classes]);
  const activeClass = useMemo(
    () => classes.find((c) => c.id === activeClassId) ?? classes[0],
    [classes, activeClassId],
  );
  const stats = dash?.stats;

  // ── Loading (initial) ──
  if (loadingDash) {
    return (
      <Shell>
        <div className="text-center py-20 text-slate-500">
          <div className="w-10 h-10 border-[3px] border-slate-800 border-t-indigo-500 rounded-full mx-auto mb-4 animate-spin" />
          {tt(isHi, 'Loading command center…', 'कमांड सेंटर लोड हो रहा है…')}
        </div>
      </Shell>
    );
  }

  // ── Not a teacher yet ──
  if (!teacher) {
    return (
      <Shell>
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#x1F464;</div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {tt(isHi, 'Setting up your teacher account', 'आपका शिक्षक खाता सेट हो रहा है')}
          </h2>
          <button
            onClick={() => window.location.reload()}
            className="py-2.5 px-6 bg-indigo-500 text-white border-none rounded-lg text-sm font-semibold cursor-pointer"
          >
            {tt(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <Shell>
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#x1F615;</div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {tt(isHi, "Couldn't load the command center", 'कमांड सेंटर लोड नहीं हो सका')}
          </h2>
          <button
            onClick={loadDashboard}
            className="py-2.5 px-6 bg-indigo-500 text-white border-none rounded-lg text-sm font-semibold cursor-pointer"
          >
            {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Empty: no classes ──
  if (!classes.length) {
    return (
      <Shell>
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#x1F3EB;</div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {tt(isHi, 'Welcome to your command center!', 'आपके कमांड सेंटर में स्वागत है!')}
          </h2>
          <p className="text-sm text-slate-500 mb-5 max-w-[360px] mx-auto">
            {tt(
              isHi,
              'Create your first class to start tracking student mastery and assign remediation.',
              'छात्र मास्टरी ट्रैक करने और रिमेडिएशन सौंपने के लिए अपनी पहली कक्षा बनाएं।',
            )}
          </p>
          <button
            onClick={() => router.push('/teacher/classes')}
            className="py-2.5 px-6 bg-indigo-500 text-white border-none rounded-lg text-sm font-semibold cursor-pointer"
          >
            {tt(isHi, 'Create a Class', 'कक्षा बनाएं')}
          </button>
        </div>
      </Shell>
    );
  }

  const criticalCount = alerts.filter(
    (a) => a.severity === 'critical' || a.severity === 'high',
  ).length;

  return (
    <Shell>
      {/* Header — title + class switcher */}
      <header className="flex flex-wrap justify-between items-center gap-3 mb-5 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 m-0">
            {tt(isHi, 'Class Command Center', 'क्लास कमांड सेंटर')}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{dash?.teacher?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">
            {tt(isHi, 'Class', 'कक्षा')}
          </label>
          <select
            value={activeClassId}
            onChange={(e) => setActiveClassId(e.target.value)}
            data-testid="class-switcher"
            className="bg-slate-800 border border-slate-700 rounded-lg text-slate-100 text-sm py-2 px-3 outline-none cursor-pointer"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.student_count})
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              loadDashboard();
              loadClassData();
            }}
            className="py-2 px-3 bg-transparent text-indigo-400 border border-indigo-500/40 rounded-lg text-[13px] font-medium cursor-pointer"
          >
            {tt(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
        </div>
      </header>

      {/* Today summary — stat tiles from the existing dashboard counts.
          The "Awaiting grading" tile is Wave B: it appears only when
          ff_teacher_assignment_lifecycle is ON (otherwise the grid is the
          byte-identical Wave A 4-tile layout). One-tap it to open the queue. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 mb-4">
        {[
          {
            label: tt(isHi, 'Students', 'छात्र'),
            val: activeClass?.student_count ?? stats?.total_students ?? 0,
            color: 'text-indigo-400',
          },
          {
            label: tt(isHi, 'Avg mastery', 'औसत मास्टरी'),
            val: activeClass?.avg_mastery != null ? `${activeClass.avg_mastery}%` : '—',
            color: 'text-violet-400',
          },
          {
            label: tt(isHi, 'At-risk', 'जोखिम में'),
            val: alerts.length,
            color: criticalCount > 0 ? 'text-red-500' : 'text-amber-400',
          },
          {
            label: tt(isHi, 'Assignments', 'असाइनमेंट'),
            val: stats?.active_assignments ?? 0,
            color: 'text-emerald-400',
          },
        ].map((s, i) => (
          <div key={i} className="bg-slate-900 rounded-xl py-3.5 px-4 border border-slate-800">
            <p className="text-slate-500 text-[11px] m-0 uppercase tracking-wide">{s.label}</p>
            <p className={`${s.color} text-[26px] font-bold mt-1`}>{s.val}</p>
          </div>
        ))}

        {gradingQueueEnabled && (
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            data-testid="awaiting-grading-tile"
            className="text-left bg-slate-900 rounded-xl py-3.5 px-4 border border-slate-800 cursor-pointer hover:border-indigo-500 transition-colors"
          >
            <p className="text-slate-500 text-[11px] m-0 uppercase tracking-wide">
              {tt(isHi, 'Awaiting grading', 'ग्रेडिंग लंबित')}
            </p>
            <p className="text-sky-400 text-[26px] font-bold mt-1 flex items-center gap-2">
              {queueLoading ? '…' : queueCount}
              {!queueLoading && queueCount > 0 && (
                <span
                  data-testid="awaiting-grading-badge"
                  className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-sky-500 text-white text-[12px] font-bold"
                >
                  {queueCount}
                </span>
              )}
            </p>
          </button>
        )}
      </div>

      {/* Action bar */}
      <div className="mb-5">
        <ActionBar
          isHi={isHi}
          router={router}
          gradingQueueEnabled={gradingQueueEnabled}
          gradingQueueCount={queueCount}
          onOpenGradingQueue={() => setQueueOpen(true)}
        />
      </div>

      {/* Wave B — grading queue surface (lazy-loaded; mounts only when opened) */}
      {gradingQueueEnabled && queueOpen && (
        <div className="mb-5">
          <GradingQueue
            items={queueItems}
            count={queueCount}
            loading={queueLoading}
            error={queueError}
            isHi={isHi}
            onOpenRow={openQueueRow}
            onRetry={loadGradingQueue}
            onClose={() => setQueueOpen(false)}
          />
        </div>
      )}

      {/* Wave C — student mastery report panel (lazy-loaded; mounts only when a
          teacher drills into a heatmap cell/row with the depth flag ON). */}
      {gradebookDepthEnabled && reportOpen && (
        <div className="mb-5">
          <StudentMasteryReport
            report={report}
            loading={reportLoading}
            error={reportError}
            exporting={reportExporting}
            isHi={isHi}
            onExport={exportReport}
            onRetry={() => reportStudent && fetchReport(reportStudent.id, reportStudent.name)}
            onClose={() => setReportOpen(false)}
          />
        </div>
      )}

      {/* Dense two-column body: heatmap (wide) + alerts rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 items-start">
        {/* Roster mastery heatmap */}
        <div className="td-card">
          <div className="td-card-head">
            <h3>{tt(isHi, 'Roster mastery heatmap', 'रोस्टर मास्टरी हीटमैप')}</h3>
            {heatmap && (
              <span className="td-badge">
                {heatmap.student_count} {tt(isHi, 'students', 'छात्र')} × {heatmap.concept_count}{' '}
                {tt(isHi, 'concepts', 'अवधारणाएं')}
              </span>
            )}
          </div>
          <div className="mt-3.5">
            {loadingClass ? (
              <div className="h-40 rounded-lg bg-slate-800/50 animate-pulse" aria-hidden="true" />
            ) : heatmap ? (
              <RosterHeatmap data={heatmap} isHi={isHi} onCellStudent={onHeatmapStudent} />
            ) : (
              <div className="text-center py-8 text-slate-500">
                <div className="text-3xl mb-3">&#x1F4CA;</div>
                <p className="text-[14px] font-medium text-slate-400 mb-1">
                  {tt(isHi, 'No mastery data yet', 'अभी तक कोई मास्टरी डेटा नहीं')}
                </p>
                <p className="text-[13px] text-slate-600">
                  {tt(
                    isHi,
                    'Students need to complete quizzes before mastery data appears.',
                    'मास्टरी डेटा दिखने के लिए छात्रों को क्विज़ पूरी करनी होगी।',
                  )}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* At-risk alerts rail */}
        <div className="td-card">
          <div className="td-card-head">
            <h3>{tt(isHi, 'At-risk alerts', 'जोखिम अलर्ट')}</h3>
            {alerts.length > 0 && <span className="td-badge bg-red-600">{alerts.length}</span>}
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {loadingClass ? (
              <div className="h-24 rounded-lg bg-slate-800/50 animate-pulse" aria-hidden="true" />
            ) : alerts.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                <span className="text-emerald-500 text-2xl block mb-2">&#x2713;</span>
                <p className="text-[13px] text-slate-400 m-0">
                  {tt(
                    isHi,
                    'No at-risk students detected.',
                    'कोई जोखिम वाले छात्र नहीं मिले।',
                  )}
                </p>
              </div>
            ) : (
              alerts.map((a) => (
                <AlertRow
                  key={a.id}
                  alert={a}
                  isHi={isHi}
                  onAssign={assignRemediation}
                  busy={!!assigning[a.id]}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </Shell>
  );
}

// Shared dark page chrome (the `.td-*` tokens the legacy dashboard defines).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[1280px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-slate-200 bg-[#0B1120] min-h-screen">
      <style>{`.td-card{background:#0F172A;border-radius:14px;padding:18px 20px;border:1px solid #1E293B} .td-card-head{display:flex;justify-content:space-between;align-items:center} .td-card-head h3{font-size:16px;font-weight:600;color:#F1F5F9;margin:0} .td-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:#1E293B;color:#94A3B8}`}</style>
      {children}
    </div>
  );
}
