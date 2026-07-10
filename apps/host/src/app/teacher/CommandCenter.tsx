'use client';

/**
 * CommandCenter — the dense, desktop-first teacher home (the platform's
 * flagship "Command Center"). Phase 2 of the Atlas redesign re-themes this
 * surface from the legacy dark "Cosmic" chrome to the warm-cream Atlas OS theme
 * shared with the parent/student portals. PRESENTATION + DATA-PLUMBING ONLY —
 * all behaviour (flag gates, remediation state machine, parent-comms, testids)
 * is byte-stable.
 *
 * It composes the EXISTING `teacher-dashboard` Edge data (get_dashboard /
 * get_heatmap / get_alerts / get_grading_queue / get_student_mastery_report)
 * into a single command surface:
 *
 *   - Class switcher (header) — picks the class scope; re-fetches heatmap+alerts.
 *   - Roster mastery heatmap (concept × student) — a cell links to the student
 *     detail / drill-through.
 *   - At-risk alerts rail — each alert carries its A2 `remediation_status`: when
 *     `none`, a one-tap "Assign remediation" button POSTs /api/teacher/remediation
 *     (optimistic + rollback on error); when assigned/in_progress/resolved that
 *     state is shown read-only.
 *   - Today summary + action bar.
 *
 * Data plumbing (Phase 2):
 *   - READ paths now flow through the shared SWR hooks in
 *     `@alfanumrik/lib/teacher/use-teacher-data` (useTeacherDashboard / useHeatmap /
 *     useAlerts / useGradingQueue / useStudentMasteryReport) instead of bespoke
 *     api()+useState/useEffect.
 *   - POST mutations (remediation assign, parent-notify) stay direct calls and
 *     then call the relevant hook's mutate() to revalidate (no manual refetch).
 *
 * Boundary discipline (frontend):
 *   - NO business logic in the client — the server owns remediation state. The
 *     button only POSTs; the row's authoritative status comes back from the Edge
 *     join on the next revalidate.
 *   - Scoring/XP/mastery math is untouched — mastery % is rendered verbatim from
 *     get_heatmap (assessment owns the values); heat-scale only maps a fraction
 *     to a colour/label (P1/P2).
 *   - P7 bilingual via AuthContext.isHi. P13 no PII in client logs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { useTeacherAssignmentLifecycle } from '@alfanumrik/lib/use-teacher-assignment-lifecycle';
import { useTeacherGradebookDepth } from '@alfanumrik/lib/use-teacher-gradebook-depth';
import { useTeacherParentComms } from '@alfanumrik/lib/use-teacher-parent-comms';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import { heatColorClass } from '@alfanumrik/lib/teacher/heat-scale';
import {
  useTeacherDashboard,
  useHeatmap,
  useAlerts,
  useGradingQueue,
  useStudentMasteryReport,
  useClassLeaderboard,
} from '@alfanumrik/lib/teacher/use-teacher-data';
import { TeacherDashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import { StatusBadge, type StatusBadgeVariant } from '@alfanumrik/ui/admin-ui/StatusBadge';
import type {
  HeatmapData,
  HeatmapCell,
  HeatmapRow,
  RiskAlert,
  RemediationStatus,
} from '@alfanumrik/lib/types';
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

// ── Local Edge-data shapes ──────────────────────────────────────────────────
interface DashboardClass {
  id: string;
  name: string;
  student_count: number;
  avg_mastery?: number;
}
interface HeatmapConcept {
  id: string;
  title: string;
  chapter: number;
}

// Severity → StatusBadge variant + accent for the at-risk rail (Atlas semantic
// status colours). The numeric/visual mapping is unchanged from the dark theme;
// only the palette is re-themed.
const SEV_VARIANT: Record<string, StatusBadgeVariant> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};
const SEV_ACCENT: Record<string, string> = {
  critical: 'var(--danger, var(--danger))',
  high: 'var(--orange)',
  medium: 'var(--warning, var(--warning))',
  low: 'var(--info, var(--info))',
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
      <div className="p-10 text-center italic" style={{ color: 'var(--text-3)' }}>
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
            <th
              className="px-2 py-1.5 font-semibold text-[12px] text-left min-w-[120px] sticky left-0"
              style={{
                color: 'var(--text-3)',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface-1)',
              }}
            >
              {tt(isHi, 'Student', 'छात्र')}
            </th>
            <th
              className="px-1 py-1.5 font-semibold text-[12px] text-center"
              style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
            >
              {tt(isHi, 'Avg', 'औसत')}
            </th>
            {concepts.map((c: HeatmapConcept, i: number) => (
              <th
                key={i}
                className="px-1 py-1.5 font-semibold text-[12px] text-center"
                style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
                title={c.title || `Ch. ${c.chapter}`}
              >
                {c.title ? c.title.slice(0, 8) : `Ch. ${c.chapter}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row: HeatmapRow, ri: number) => (
            <tr key={ri} className="hover:bg-[var(--surface-2)]">
              <td
                className="px-2 py-1.5 font-semibold text-[13px] whitespace-nowrap sticky left-0"
                style={{ color: 'var(--text-1)', background: 'var(--surface-1)' }}
              >
                <button
                  type="button"
                  onClick={() => onCellStudent(row as HeatmapRowWithId)}
                  className="text-left bg-transparent border-none cursor-pointer p-0 hover:text-[var(--purple)]"
                  style={{ color: 'var(--text-1)' }}
                  title={tt(isHi, 'View student detail', 'छात्र विवरण देखें')}
                >
                  {row.student_name}
                </button>
              </td>
              <td
                className="px-1 py-1.5 text-center font-bold text-[13px]"
                style={{ color: 'var(--text-1)' }}
              >
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
                    className={`inline-block min-w-[32px] py-1 px-0.5 rounded text-[12px] font-semibold text-on-accent border-none cursor-pointer ${heatColorClass(
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
// Wave D: `parentCommsEnabled` (ff_teacher_parent_comms) layers a one-tap "Tell
// the parent 🎉" button onto a RESOLVED alert. When the flag is OFF the button is
// never rendered and `onTellParent` is never wired — flag-OFF stays byte-identical
// to Wave A–C. `parentNotifyDone` reflects an already-sent notification for this
// student (idempotent-safe: the button disables to a "Parent notified ✓" chip
// after a successful POST so it can't be double-fired).
function AlertRow({
  alert,
  isHi,
  onAssign,
  busy,
  parentCommsEnabled,
  onTellParent,
  parentNotifyBusy,
  parentNotifyDone,
}: {
  alert: RiskAlert;
  isHi: boolean;
  onAssign: (alert: RiskAlert) => void;
  busy: boolean;
  parentCommsEnabled: boolean;
  onTellParent: (alert: RiskAlert) => void;
  parentNotifyBusy: boolean;
  parentNotifyDone: boolean;
}) {
  const variant = SEV_VARIANT[alert.severity] || 'warning';
  const accent = SEV_ACCENT[alert.severity] || SEV_ACCENT.medium;
  const status: RemediationStatus = alert.remediation_status ?? 'none';

  return (
    <div
      className="rounded-xl p-3 border-l-[3px]"
      style={{
        background: 'var(--surface-2)',
        borderLeftColor: accent,
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <StatusBadge label={alert.severity} variant={variant} />
          <span className="ml-2 font-bold text-sm" style={{ color: 'var(--text-1)' }}>
            {alert.title}
          </span>
        </div>
        {/* Remediation control — server owns the state; the button only POSTs. */}
        <div className="shrink-0 flex items-center gap-2">
          {status === 'none' && (
            <button
              type="button"
              onClick={() => onAssign(alert)}
              disabled={busy}
              data-testid="assign-remediation-btn"
              className="py-1 px-2.5 bg-brand-purple text-on-accent border-none rounded-md text-[12px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {busy
                ? tt(isHi, 'Assigning…', 'सौंपा जा रहा है…')
                : tt(isHi, 'Assign remediation', 'रिमेडिएशन सौंपें')}
            </button>
          )}
          {status === 'assigned' && (
            <span data-testid="remediation-status">
              <StatusBadge label={tt(isHi, 'Assigned', 'सौंपा गया')} variant="warning" />
            </span>
          )}
          {status === 'in_progress' && (
            <span data-testid="remediation-status">
              <StatusBadge label={tt(isHi, 'In progress', 'जारी है')} variant="info" />
            </span>
          )}
          {status === 'resolved' && (
            <span data-testid="remediation-status">
              <StatusBadge label={`✓ ${tt(isHi, 'Resolved', 'हल हो गया')}`} variant="success" />
            </span>
          )}
          {/* Wave D — one-tap "Tell the parent" on a RESOLVED alert (flag-gated).
              Server owns thread/message creation; this button only POSTs. */}
          {parentCommsEnabled && status === 'resolved' &&
            (parentNotifyDone ? (
              <span data-testid="parent-notified-chip">
                <StatusBadge
                  label={`✓ ${tt(isHi, 'Parent notified', 'अभिभावक को सूचित किया')}`}
                  variant="info"
                />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onTellParent(alert)}
                disabled={parentNotifyBusy}
                data-testid="tell-parent-btn"
                className="py-1 px-2.5 bg-primary text-on-accent border-none rounded-md text-[12px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {parentNotifyBusy
                  ? tt(isHi, 'Sending…', 'भेजा जा रहा है…')
                  : tt(isHi, 'Tell the parent 🎉', 'अभिभावक को बताएं 🎉')}
              </button>
            ))}
        </div>
      </div>
      <p className="text-[13px] my-1.5" style={{ color: 'var(--text-2)' }}>
        {alert.description}
      </p>
      {alert.recommended_action && (
        <p className="text-xs m-0 italic" style={{ color: 'var(--purple)' }}>
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
    // is ON; when OFF the button is omitted entirely so teachers never see a
    // disabled "soon" tombstone (hidden feature looks better than broken UI).
    ...(gradingQueueEnabled
      ? [{
          label: 'Grading queue',
          labelHi: 'ग्रेडिंग कतार',
          onClick: onOpenGradingQueue,
          testid: 'grading-queue-action',
          badge: gradingQueueCount > 0 ? gradingQueueCount : undefined,
          disabled: undefined as boolean | undefined,
        }]
      : []),
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
          className="py-2 px-3.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors hover:border-[var(--purple)] disabled:opacity-40 disabled:cursor-default"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
          }}
        >
          {tt(isHi, a.label, a.labelHi)}
          {a.disabled && (
            <span className="ml-1.5 text-[12px]" style={{ color: 'var(--text-3)' }}>
              {tt(isHi, 'soon', 'जल्द')}
            </span>
          )}
          {a.badge != null && (
            <span
              data-testid="grading-queue-action-badge"
              className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-purple text-on-accent text-[12px] font-bold align-middle"
            >
              {a.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Today-summary KPI tile (Atlas warm-cream card) ─────────────────────────
function KpiTile({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div
      className="rounded-xl py-3.5 px-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
    >
      <p className="text-[12px] m-0 uppercase tracking-wide font-semibold" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p className="text-[26px] font-extrabold mt-1" style={{ color: accent }}>
        {value}
      </p>
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

  // Wave D — additional gate for the one-tap "Tell the parent" affordance.
  // Default OFF ⇒ NO parent-comms button anywhere and NO parent-notify fetch is
  // ever issued (byte-identical to Wave A–C).
  const parentCommsEnabled = useTeacherParentComms();

  const [activeClassId, setActiveClassId] = useState<string>('');
  const [heatmapSubject, setHeatmapSubject] = useState<string>('math');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});

  // Wave B — grading queue open state (data comes from the SWR hook below).
  const [queueOpen, setQueueOpen] = useState(false);

  // Wave C — student mastery report drill-through state.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  // The student currently being reported on (id + name) — drives the SWR key and
  // is re-used by retry/export.
  const [reportStudent, setReportStudent] = useState<{ id: string; name: string } | null>(null);

  // Wave D — parent-comms state. `parentNotifyBusy` is keyed by student_id (a
  // student can surface on multiple alerts; we disable every "Tell the parent"
  // affordance for that student while one POST is in flight). `parentNotifyDone`
  // is the set of student_ids already notified this session — once notified the
  // button collapses to a "Parent notified ✓" chip so it can't be double-fired
  // (idempotent-safe). Both surfaces (alert + report panel) read this state.
  const [parentNotifyBusy, setParentNotifyBusy] = useState<Record<string, boolean>>({});
  const [parentNotifyDone, setParentNotifyDone] = useState<Record<string, boolean>>({});

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Read paths (Phase 2): shared SWR hooks replace the bespoke api()+useState. ──
  const { data: dash, error: dashError, isLoading: dashLoading, mutate: mutateDashboard } =
    useTeacherDashboard();

  // The class scope drives heatmap/alerts/queue. We derive it from the dashboard
  // data so the FIRST class-scoped fetch already carries the resolved class_id —
  // this avoids an extra, roster-wide pre-fetch flash before the switcher's
  // explicit `activeClassId` lands (parity with the legacy page, which only ever
  // fetched alerts/heatmap WITH a class). The hooks stay inert (null SWR key)
  // until a class id is present.
  const effectiveClassId = activeClassId || dash?.classes?.[0]?.id || undefined;

  const { data: heatmap, isLoading: heatmapLoading } = useHeatmap(effectiveClassId, heatmapSubject);
  // Inert until a class scope resolves — never a transient roster-wide read.
  const { data: alertsRes, mutate: mutateAlerts } = useAlerts(effectiveClassId, !!effectiveClassId);
  const { data: queueRes, isLoading: queueSwrLoading, error: queueSwrError, mutate: mutateQueue } =
    useGradingQueue(gradingQueueEnabled, effectiveClassId);
  const {
    data: report,
    isLoading: reportLoading,
    error: reportError,
    mutate: mutateReport,
  } = useStudentMasteryReport(reportStudent?.id);

  // get_alerts returns the array directly (A2 shape: each alert carries
  // remediation_status). Tolerate the legacy {alerts:[...]} envelope too.
  const alerts: RiskAlert[] = useMemo(() => {
    const raw = alertsRes as unknown;
    if (Array.isArray(raw)) return raw as RiskAlert[];
    return (raw as { alerts?: RiskAlert[] })?.alerts ?? [];
  }, [alertsRes]);

  // Grading-queue derived view.
  const queueItems: GradingQueueItem[] = Array.isArray(queueRes?.items) ? queueRes.items : [];
  const queueCount = typeof queueRes?.count === 'number' ? queueRes.count : queueItems.length;
  const queueLoading = gradingQueueEnabled && queueSwrLoading;
  const queueError = !!queueSwrError;

  const classes = useMemo<DashboardClass[]>(() => dash?.classes ?? [], [dash?.classes]);
  const stats = dash?.stats;

  // Default the active class to the first one once the dashboard resolves.
  useEffect(() => {
    if (!activeClassId && classes.length) setActiveClassId(classes[0].id);
  }, [activeClassId, classes]);

  // Wrong-role / unauth redirect (mirrors the legacy page).
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Open a queue row → navigate to the EXISTING /teacher/submissions review for
  // that submission/assignment (reuse, not rebuild). The submissions page
  // deep-links straight into its per-question breakdown + feedback form via the
  // query params. We optimistically drop the row from the cached queue so it
  // leaves the moment the teacher starts grading it; the SWR revalidate on
  // return reconciles (after mark_submission_reviewed lands graded_at).
  const openQueueRow = useCallback(
    (item: GradingQueueItem) => {
      void mutateQueue(
        (prev) =>
          prev
            ? {
                items: prev.items.filter((x) => x.submission_id !== item.submission_id),
                count: Math.max(0, prev.count - 1),
              }
            : prev,
        { revalidate: false },
      );
      router.push(
        `/teacher/submissions?assignment=${encodeURIComponent(
          item.assignment_id,
        )}&submission=${encodeURIComponent(item.submission_id)}`,
      );
    },
    [router, mutateQueue],
  );

  // Assign remediation — optimistic update + rollback on error. The alert id is
  // the key; derived alerts have no chapter, so we POST general remediation
  // (student_id only). The server owns the authoritative status — we reconcile
  // by revalidating the alerts SWR cache on success.
  const assignRemediation = useCallback(
    async (alert: RiskAlert) => {
      if (assigning[alert.id]) return;
      setAssigning((m) => ({ ...m, [alert.id]: true }));

      // Optimistic: flip THIS alert (and any other alert for the same student)
      // to 'assigned' immediately in the SWR cache, without revalidating yet.
      const prev = alertsRes;
      const optimistic = alerts.map((x) =>
        x.student_id === alert.student_id ? { ...x, remediation_status: 'assigned' as const } : x,
      );
      void mutateAlerts(optimistic as unknown as typeof alertsRes, { revalidate: false });

      try {
        const res = await fetch('/api/teacher/remediation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ student_id: alert.student_id }),
        });
        if (!res.ok) throw new Error(`remediation_assign_failed:${res.status}`);
        showToast(tt(isHi, 'Remediation assigned', 'रिमेडिएशन सौंपा गया'), 'success');
        // Reconcile with the server's authoritative status.
        await mutateAlerts();
      } catch {
        // Rollback the optimistic flip.
        void mutateAlerts(prev, { revalidate: false });
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
    [assigning, alerts, alertsRes, isHi, showToast, mutateAlerts],
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

  // Wave C — drill-through entry from a heatmap cell/row. When the depth flag is
  // OFF this is never invoked (the heatmap calls goToStudent instead), so
  // flag-OFF stays byte-identical. Resolves the id from the row (if stamped) or
  // the alerts map; falls back to the legacy navigate when no id is resolvable.
  // Setting reportStudent activates the useStudentMasteryReport SWR key.
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
      setReportStudent({ id: resolvedId, name });
    },
    [studentIdByName, goToStudent],
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
      const { teacherDashboardFetch } = await import('@alfanumrik/lib/teacher/use-teacher-data');
      const res = await teacherDashboardFetch<{ filename?: string; csv_content?: string }>(
        'export_student_report',
        { teacher_id: teacher?.id || '', student_id: reportStudent.id },
      );
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
  }, [reportStudent, teacher?.id, isHi, showToast]);

  // Wave D — "Tell the parent". One shared POST helper for BOTH entry points:
  //   1. a RESOLVED at-risk alert → context 'remediation_resolved' (+ remediation
  //      hint when resolvable) → templated good-news message;
  //   2. the Student Mastery Report panel → context 'general'.
  // The server find-or-creates the teacher↔parent thread and sends the message;
  // include_report:true appends an inline progress summary. Outcomes:
  //   200 → "Parent notified ✓" (with a deep-link to /teacher/messages);
  //   409 no_guardian → informational "No parent linked" toast (NOT an error);
  //   other → friendly error toast.
  // Optimistic disable + spinner via parentNotifyBusy; on success we mark the
  // student done so the button collapses to a chip (idempotent-safe — a second
  // tap can't fire). P13: no PII in client logs.
  const notifyParent = useCallback(
    async (opts: {
      studentId: string;
      context: 'remediation_resolved' | 'general';
      remediationId?: string;
    }) => {
      const { studentId, context, remediationId } = opts;
      if (!studentId || parentNotifyBusy[studentId] || parentNotifyDone[studentId]) return;
      setParentNotifyBusy((m) => ({ ...m, [studentId]: true }));
      try {
        const res = await fetch('/api/teacher/parent-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({
            student_id: studentId,
            context,
            include_report: true,
            ...(remediationId ? { remediation_id: remediationId } : {}),
          }),
        });

        if (res.ok) {
          // Mark done so the affordance collapses to a "Parent notified ✓" chip.
          setParentNotifyDone((m) => ({ ...m, [studentId]: true }));
          showToast(tt(isHi, 'Parent notified ✓', 'अभिभावक को सूचित किया ✓'), 'success');
          return;
        }

        if (res.status === 409) {
          // No linked guardian — informational, NOT an error. The student simply
          // has no parent on the platform yet.
          showToast(
            tt(isHi, 'No parent linked for this student', 'इस छात्र के लिए कोई अभिभावक लिंक नहीं है'),
            'success',
          );
          return;
        }

        // Any other status — friendly, retryable error.
        showToast(
          tt(isHi, "Couldn't notify the parent — please retry", 'अभिभावक को सूचित नहीं कर सके — पुनः प्रयास करें'),
          'error',
        );
      } catch {
        // Network/transport failure — generic toast (P13: no PII in logs).
        showToast(
          tt(isHi, "Couldn't notify the parent — please retry", 'अभिभावक को सूचित नहीं कर सके — पुनः प्रयास करें'),
          'error',
        );
      } finally {
        setParentNotifyBusy((m) => {
          const next = { ...m };
          delete next[studentId];
          return next;
        });
      }
    },
    [parentNotifyBusy, parentNotifyDone, isHi, showToast],
  );

  // Entry point 1 — resolved at-risk alert. We pass the alert's remediation id as
  // a hint when present so the templated message can name the resolved concept;
  // derived alerts carry no remediation id, which the server tolerates.
  const tellParentFromAlert = useCallback(
    (alert: RiskAlert) => {
      const remediationId = (alert as RiskAlert & { remediation_id?: string }).remediation_id;
      void notifyParent({
        studentId: alert.student_id,
        context: 'remediation_resolved',
        remediationId,
      });
    },
    [notifyParent],
  );

  // Entry point 2 — Student Mastery Report panel "Share with parent".
  const shareReportWithParent = useCallback(() => {
    if (!reportStudent) return;
    void notifyParent({ studentId: reportStudent.id, context: 'general' });
  }, [notifyParent, reportStudent]);

  const activeClass = useMemo(
    () => classes.find((c) => c.id === activeClassId) ?? classes[0],
    [classes, activeClassId],
  );

  // ── Loading (initial) ── Atlas warm-cream skeleton.
  if (dashLoading && !dash) {
    return <TeacherDashboardSkeleton />;
  }

  // ── Not a teacher yet ──
  if (!teacher) {
    return (
      <Shell>
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#x1F464;</div>
          <h2 className="text-xl font-bold mb-2 font-heading" style={{ color: 'var(--text-1)' }}>
            {tt(isHi, 'Setting up your teacher account', 'आपका शिक्षक खाता सेट हो रहा है')}
          </h2>
          <button
            onClick={() => window.location.reload()}
            className="py-2.5 px-6 bg-primary text-on-accent border-none rounded-lg text-sm font-semibold cursor-pointer"
          >
            {tt(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Error ──
  if (dashError) {
    return (
      <Shell>
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#x1F615;</div>
          <h2 className="text-xl font-bold mb-2 font-heading" style={{ color: 'var(--text-1)' }}>
            {tt(isHi, "Couldn't load the command center", 'कमांड सेंटर लोड नहीं हो सका')}
          </h2>
          <button
            onClick={() => mutateDashboard()}
            className="py-2.5 px-6 bg-primary text-on-accent border-none rounded-lg text-sm font-semibold cursor-pointer"
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
          <h2 className="text-xl font-bold mb-2 font-heading" style={{ color: 'var(--text-1)' }}>
            {tt(isHi, 'Welcome to your command center!', 'आपके कमांड सेंटर में स्वागत है!')}
          </h2>
          <p className="text-sm mb-5 max-w-[360px] mx-auto" style={{ color: 'var(--text-3)' }}>
            {tt(
              isHi,
              'Create your first class to start tracking student mastery and assign remediation.',
              'छात्र मास्टरी ट्रैक करने और रिमेडिएशन सौंपने के लिए अपनी पहली कक्षा बनाएं।',
            )}
          </p>
          <button
            onClick={() => router.push('/teacher/classes')}
            className="py-2.5 px-6 bg-primary text-on-accent border-none rounded-lg text-sm font-semibold cursor-pointer"
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
  const topAttentionAlerts = alerts.slice(0, 3);
  const loadingClass = heatmapLoading;

  return (
    <Shell>
      {/* Header — title + class switcher */}
      <header
        className="flex flex-wrap justify-between items-center gap-3 mb-5 pb-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h1 className="text-2xl font-extrabold m-0 font-heading" style={{ color: 'var(--text-1)' }}>
            {tt(isHi, 'Class Command Center', 'क्लास कमांड सेंटर')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>{dash?.teacher?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[12px] uppercase tracking-wide font-bold" style={{ color: 'var(--text-3)' }}>
            {tt(isHi, 'Class', 'कक्षा')}
          </label>
          <select
            value={activeClassId}
            onChange={(e) => setActiveClassId(e.target.value)}
            data-testid="class-switcher"
            className="rounded-lg text-sm py-2 px-3 outline-none cursor-pointer"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.student_count})
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              mutateDashboard();
              mutateAlerts();
            }}
            className="py-2 px-3 bg-transparent rounded-lg text-[13px] font-semibold cursor-pointer"
            style={{ color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 35%, transparent)' }}
          >
            {tt(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
        </div>
      </header>

      <SectionErrorBoundary section="Attention summary">
        <section
          className="mb-4 rounded-2xl border p-4"
          style={{
            background: 'var(--surface-1)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-md)',
          }}
          aria-label={tt(isHi, 'Students needing attention', 'ध्यान चाहने वाले छात्र')}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
                {tt(isHi, 'Who needs my attention?', 'मेरे ध्यान की अभी किसे ज़रूरत है?')}
              </p>
              <h2 className="mt-1 text-2xl font-extrabold font-heading" style={{ color: 'var(--text-1)' }}>
                {alerts.length > 0
                  ? tt(isHi, `${alerts.length} student${alerts.length === 1 ? '' : 's'} need intervention`, `${alerts.length} छात्रों को हस्तक्षेप चाहिए`)
                  : tt(isHi, 'No urgent student interventions', 'कोई तत्काल छात्र हस्तक्षेप नहीं')}
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
                {activeClass?.name
                  ? tt(isHi, `${activeClass.name} is selected`, `${activeClass.name} चुनी गई है`)
                  : tt(isHi, 'Pick a class to review learning risk.', 'लर्निंग जोखिम देखने के लिए कक्षा चुनें।')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (topAttentionAlerts[0]) assignRemediation(topAttentionAlerts[0]);
                else router.push('/teacher/assignments');
              }}
              className="min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-bold text-on-accent"
              style={{ background: 'var(--surface-accent)' }}
            >
              {alerts.length > 0
                ? tt(isHi, 'Create intervention', 'हस्तक्षेप बनाएं')
                : tt(isHi, 'Assign practice', 'अभ्यास दें')}
            </button>
          </div>

          {topAttentionAlerts.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {topAttentionAlerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => goToStudent(alert.student_name)}
                  className="rounded-xl border px-3 py-2.5 text-left"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
                >
                  <span className="block truncate text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                    {alert.student_name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--text-3)' }}>
                    {alert.title || alert.description || tt(isHi, 'Needs practice', 'अभ्यास चाहिए')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </SectionErrorBoundary>

      {/* Today summary — stat tiles from the existing dashboard counts.
          The "Awaiting grading" tile is Wave B: it appears only when
          ff_teacher_assignment_lifecycle is ON (otherwise the grid is the
          byte-identical Wave A 4-tile layout). One-tap it to open the queue. */}
      <SectionErrorBoundary section="Today summary">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 mb-4">
        <KpiTile
          label={tt(isHi, 'Students', 'छात्र')}
          value={activeClass?.student_count ?? stats?.total_students ?? 0}
          accent="var(--purple)"
        />
        <KpiTile
          label={tt(isHi, 'Avg mastery', 'औसत मास्टरी')}
          value={activeClass?.avg_mastery != null ? `${activeClass.avg_mastery}%` : '—'}
          accent="var(--purple)"
        />
        <KpiTile
          label={tt(isHi, 'At-risk', 'जोखिम में')}
          value={alerts.length}
          accent={criticalCount > 0 ? 'var(--danger, var(--danger))' : 'var(--warning, var(--warning))'}
        />
        <KpiTile
          label={tt(isHi, 'Assignments', 'असाइनमेंट')}
          value={stats?.active_assignments ?? 0}
          accent="var(--success, var(--success))"
        />

        {gradingQueueEnabled && (
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            data-testid="awaiting-grading-tile"
            className="text-left rounded-xl py-3.5 px-4 cursor-pointer transition-colors hover:border-[var(--purple)]"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            <p className="text-[12px] m-0 uppercase tracking-wide font-semibold" style={{ color: 'var(--text-3)' }}>
              {tt(isHi, 'Awaiting grading', 'ग्रेडिंग लंबित')}
            </p>
            <p className="text-[26px] font-extrabold mt-1 flex items-center gap-2" style={{ color: 'var(--info, var(--info))' }}>
              {queueLoading ? '…' : queueCount}
              {!queueLoading && queueCount > 0 && (
                <span
                  data-testid="awaiting-grading-badge"
                  className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-info text-on-accent text-[12px] font-bold"
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
      </SectionErrorBoundary>

      {/* Wave B — grading queue surface (lazy-loaded; mounts only when opened) */}
      {gradingQueueEnabled && queueOpen && (
        <SectionErrorBoundary section="Grading Queue">
        <div className="mb-5">
          <GradingQueue
            items={queueItems}
            count={queueCount}
            loading={queueLoading}
            error={queueError}
            isHi={isHi}
            onOpenRow={openQueueRow}
            onRetry={() => mutateQueue()}
            onClose={() => setQueueOpen(false)}
          />
        </div>
        </SectionErrorBoundary>
      )}

      {/* Wave C — student mastery report panel (lazy-loaded; mounts only when a
          teacher drills into a heatmap cell/row with the depth flag ON). */}
      {gradebookDepthEnabled && reportOpen && (
        <SectionErrorBoundary section="Student Mastery Report">
        <div className="mb-5">
          <StudentMasteryReport
            report={report ?? null}
            loading={reportLoading}
            error={!!reportError}
            exporting={reportExporting}
            isHi={isHi}
            onExport={exportReport}
            onRetry={() => mutateReport()}
            onClose={() => setReportOpen(false)}
            /* Wave D — "Share with parent" (flag-gated). When OFF the button is
               not rendered and shareReportWithParent is never invoked. */
            parentCommsEnabled={parentCommsEnabled}
            onShareWithParent={shareReportWithParent}
            shareWithParentBusy={!!(reportStudent && parentNotifyBusy[reportStudent.id])}
            shareWithParentDone={!!(reportStudent && parentNotifyDone[reportStudent.id])}
          />
        </div>
        </SectionErrorBoundary>
      )}

      {/* Dense two-column body: heatmap (wide) + alerts rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 items-start">
        {/* Roster mastery heatmap */}
        <SectionErrorBoundary section="Roster Mastery Heatmap">
        <Panel>
          <div className="flex flex-wrap justify-between items-center gap-2">
            <PanelHead
              title={tt(isHi, 'Roster mastery heatmap', 'रोस्टर मास्टरी हीटमैप')}
              badge={
                heatmap
                  ? `${heatmap.student_count} ${tt(isHi, 'students', 'छात्र')} × ${heatmap.concept_count} ${tt(
                      isHi,
                      'concepts',
                      'अवधारणाएं',
                    )}`
                  : undefined
              }
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[12px] uppercase tracking-wide font-bold" style={{ color: 'var(--text-3)' }}>
                {tt(isHi, 'Subject', 'विषय')}
              </label>
              <select
                value={heatmapSubject}
                onChange={(e) => setHeatmapSubject(e.target.value)}
                data-testid="heatmap-subject-selector"
                className="rounded-md text-[12px] py-1 px-2 outline-none cursor-pointer"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                }}
              >
                <option value="math">{tt(isHi, 'Math', 'गणित')}</option>
                <option value="science">{tt(isHi, 'Science', 'विज्ञान')}</option>
                <option value="english">{tt(isHi, 'English', 'अंग्रेज़ी')}</option>
                <option value="hindi">{tt(isHi, 'Hindi', 'हिंदी')}</option>
                <option value="social_science">{tt(isHi, 'Soc. Science', 'सामाजिक विज्ञान')}</option>
              </select>
            </div>
          </div>
          <div className="mt-3.5">
            {loadingClass ? (
              <div
                className="h-40 rounded-lg animate-pulse motion-reduce:animate-none"
                style={{ background: 'var(--surface-2)' }}
                aria-hidden="true"
              />
            ) : heatmap ? (
              <RosterHeatmap data={heatmap} isHi={isHi} onCellStudent={onHeatmapStudent} />
            ) : (
              <div className="text-center py-8" style={{ color: 'var(--text-3)' }}>
                <div className="text-3xl mb-3">&#x1F4CA;</div>
                <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
                  {tt(isHi, 'No mastery data yet', 'अभी तक कोई मास्टरी डेटा नहीं')}
                </p>
                <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                  {tt(
                    isHi,
                    'Students need to complete quizzes before mastery data appears.',
                    'मास्टरी डेटा दिखने के लिए छात्रों को क्विज़ पूरी करनी होगी।',
                  )}
                </p>
              </div>
            )}
          </div>
        </Panel>
        </SectionErrorBoundary>

        {/* At-risk alerts rail */}
        <SectionErrorBoundary section="At-Risk Alerts">
        <Panel>
          <PanelHead
            title={tt(isHi, 'At-risk alerts', 'जोखिम अलर्ट')}
            badge={alerts.length > 0 ? String(alerts.length) : undefined}
            badgeVariant={alerts.length > 0 ? 'danger' : 'neutral'}
          />
          <div className="mt-3 flex flex-col gap-2.5">
            {loadingClass ? (
              <div
                className="h-24 rounded-lg animate-pulse motion-reduce:animate-none"
                style={{ background: 'var(--surface-2)' }}
                aria-hidden="true"
              />
            ) : alerts.length === 0 ? (
              <div className="py-8 text-center" style={{ color: 'var(--text-3)' }}>
                <span className="text-2xl block mb-2" style={{ color: 'var(--success, var(--success))' }}>
                  &#x2713;
                </span>
                <p className="text-[13px] m-0" style={{ color: 'var(--text-2)' }}>
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
                  parentCommsEnabled={parentCommsEnabled}
                  onTellParent={tellParentFromAlert}
                  parentNotifyBusy={!!parentNotifyBusy[a.student_id]}
                  parentNotifyDone={!!parentNotifyDone[a.student_id]}
                />
              ))
            )}
          </div>
        </Panel>
        </SectionErrorBoundary>
      </div>

      {/* Class Rankings */}
      {effectiveClassId && (
        <SectionErrorBoundary section="Class Rankings">
          <div className="mt-4">
            <ClassRankingsWidget classId={effectiveClassId} isHi={isHi} />
          </div>
        </SectionErrorBoundary>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 rounded-lg px-4 py-2.5 text-sm font-semibold text-on-accent shadow-lg"
          style={{
            background:
              toast.type === 'success' ? 'var(--success, var(--success))' : 'var(--danger, var(--danger))',
          }}
        >
          {toast.msg}
        </div>
      )}
    </Shell>
  );
}


// ── Class Rankings Widget ──────────────────────────────────────────────
// Top 5 this week. Collapsible. 5-min refresh. P7: bilingual. P13: name+XP only.
function ClassRankingsWidget({ classId, isHi }: { classId: string; isHi: boolean }) {
  const { data, isLoading } = useClassLeaderboard(classId, true);
  const [open, setOpen] = useState(true);
  const rankColor = (r: number) =>
    r === 1 ? 'var(--warning)' : r === 2 ? 'var(--text-3)' : r === 3 ? 'var(--orange)' : 'var(--surface-2)';
  return (
    <Panel>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between">
        <PanelHead title={isHi ? '🏆 कक्षा रैंकिंग' : '🏆 Class Rankings'} />
        <span className="text-[12px] ml-2" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'इस सप्ताह शीर्ष 5' : 'Top 5 this week'}{' '}{open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {isLoading && (
            <div className="h-24 rounded-lg animate-pulse" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
          )}
          {!isLoading && (!data?.items || data.items.length === 0) && (
            <p className="text-[13px] text-center py-4" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'अभी कोई डेटा नहीं' : 'No data yet'}
            </p>
          )}
          {data?.items?.map((row) => (
            <div key={row.student_id} className="flex items-center gap-2.5 text-[13px]">
              <span
                className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                style={{ background: rankColor(row.rank), color: row.rank <= 3 ? 'var(--text-1)' : 'var(--text-2)' }}
              >
                {row.rank}
              </span>
              <span className="flex-1 truncate" style={{ color: 'var(--text-1)' }}>{row.name}</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--orange, var(--orange))' }}>
                {row.xp_this_period} XP
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Atlas warm-cream panel primitives (replace the dark `.td-*` chrome) ──────
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl px-5 py-[18px]"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
    >
      {children}
    </div>
  );
}

function PanelHead({
  title,
  badge,
  badgeVariant = 'neutral',
}: {
  title: string;
  badge?: string;
  badgeVariant?: StatusBadgeVariant;
}) {
  return (
    <div className="flex justify-between items-center">
      <h3 className="text-[16px] font-bold m-0 font-heading" style={{ color: 'var(--text-1)' }}>
        {title}
      </h3>
      {badge && <StatusBadge label={badge} variant={badgeVariant} />}
    </div>
  );
}

// Shared warm-cream page chrome (Atlas tokens). The TeacherShell already sets
// the page background to var(--bg); this wrapper centres + pads the content.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="max-w-[1280px] mx-auto px-4 py-5 min-h-dvh"
      style={{ background: 'var(--bg)', color: 'var(--text-2)' }}
    >
      {children}
    </div>
  );
}
