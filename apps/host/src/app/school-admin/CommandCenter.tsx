'use client';

/**
 * CommandCenter — Phase 3B Wave A / step A4. The dense, read-only "School Command
 * Center" home, gated behind `ff_school_command_center` (mirrors the Phase 3A
 * Teacher Command Center). Composes the three Wave A read-model RPCs into a single
 * principal/admin surface:
 *
 *   1. Overview KPI strip (eager) — get_school_overview via
 *      /api/school-admin/overview. Class/teacher/student counts, a seat-
 *      utilization gauge (DISPLAY ONLY — enforcement is Wave B, never implies
 *      blocking) and average mastery. data_state==='no_data' renders a proper
 *      NoDataState rather than fake green zeros.
 *   2. Classes-at-risk rail (lazy) — get_classes_at_risk via
 *      /api/school-admin/classes-at-risk. Paginated (limit/offset).
 *   3. Teacher-engagement table (lazy) — get_teacher_engagement via
 *      /api/school-admin/teacher-engagement. Paginated (limit/offset).
 *   4. School Pulse summary (lazy, DOUBLE-gated: `ff_school_pulse_v1` default
 *      OFF + institution.view_analytics) — /api/pulse/school. A slim summary
 *      lens only (flagged-class count + freshness + anchor to the rail); the
 *      overview tiles and the at-risk roster render EXACTLY ONCE on this page
 *      (panels 1 and 2 above — ops de-dup review 2026-06-12).
 *
 * Multi-school caller: when the caller administers MULTIPLE schools and no
 * ?school_id is supplied, the overview endpoint returns HTTP 400 with
 * { school_ids:[...] }. We surface a school picker; once a school is chosen we
 * pass ?school_id= on ALL THREE fetches. A single-school caller never sees the
 * picker.
 *
 * Boundary discipline (frontend):
 *   - 100% read-only. NO mutations, NO scoring/XP/mastery math — every numeric is
 *     rendered verbatim from the read models (assessment owns the values).
 *   - SWR for client cache + revalidate; the two non-critical panels are
 *     code-split via next/dynamic to protect the P10 bundle budget.
 *   - P7 bilingual via AuthContext.isHi. P13: no PII in client logs.
 */

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { usePermissions } from '@alfanumrik/lib/usePermissions';
import { useSchoolPulse } from '@alfanumrik/lib/pulse/use-pulse';
import { useSchoolPulseFlag } from '@alfanumrik/lib/use-school-pulse-flag';
import { useSchoolProvisioning } from '@alfanumrik/lib/use-school-provisioning';
import { NoDataState } from '@alfanumrik/ui/admin-ui';
import {
  DEFAULT_PAGE_LIMIT,
  type SchoolOverview,
  type OverviewResponse,
  type ClassesAtRiskResponse,
  type TeacherEngagementResponse,
} from '@alfanumrik/lib/school-admin/command-center-types';

// The two non-critical panels are code-split so their chunks only ship when the
// Command Center renders (P10). Loading skeletons cover the import latency.
const ClassesAtRiskRail = dynamic(() => import('./command-center/ClassesAtRiskRail'), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});
const TeacherEngagementTable = dynamic(
  () => import('./command-center/TeacherEngagementTable'),
  { ssr: false, loading: () => <PanelSkeleton /> },
);
// School Pulse panel is code-split (P10) — only ships when the Command Center
// renders the principal Pulse section.
const SchoolPulsePanel = dynamic(
  () => import('@alfanumrik/ui/pulse/SchoolPulsePanel'),
  { ssr: false, loading: () => <PanelSkeleton /> },
);

// ── Bilingual helper (P7) ───────────────────────────────────────────────────
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ── SWR fetcher: { success:false } envelope OR a 400 multi-school hint ───────
interface SchoolPickerError extends Error {
  status: number;
  schoolIds?: string[];
}

async function ccFetcher<T>(url: string): Promise<T> {
  const res = await authedFetch(url);
  if (!res.ok) {
    let body: { error?: string; school_ids?: string[] } | null = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(body?.error || `Request failed (${res.status})`) as SchoolPickerError;
    err.status = res.status;
    if (res.status === 400 && Array.isArray(body?.school_ids)) {
      err.schoolIds = body!.school_ids;
    }
    throw err;
  }
  return (await res.json()) as T;
}

// ── Seat band derived purely from the overview data ──────────────────────────
// IMPORTANT: get_school_overview does NOT expose grace state (no grace clock /
// expiry — see command-center-types.ts). So when ff_school_provisioning is ON we
// DO NOT add a new fetch (per the Wave B brief). We instead derive the seat BAND
// from the counts the overview already carries — within plan, in the grace band
// (active > seats, up to floor(seats*1.10)), or over the ceiling. We deliberately
// do NOT claim "N days left" here (that requires the grace clock, which only the
// enroll/invite responses carry); the gauge only reflects the seat position.
type SeatBand = 'within_plan' | 'grace' | 'over';

function deriveSeatBand(
  seatsPurchased: number,
  activeStudents: number,
): SeatBand | null {
  if (!seatsPurchased || seatsPurchased <= 0) return null; // uncapped / no signal
  if (activeStudents <= seatsPurchased) return 'within_plan';
  const ceiling = Math.floor(seatsPurchased * 1.1);
  return activeStudents <= ceiling ? 'grace' : 'over';
}

// ── Seat-utilization gauge ────────────────────────────────────────────────────
// Wave A: DISPLAY ONLY (enforced=false) — utilization % only, no enforcement.
// Wave B (enforced=true, flag ON): the SAME gauge, augmented with the enforcement
// BAND colour + label (within plan / in grace / over). Still display-only data —
// no new fetch, no mutation; the band is derived from the overview counts.
function SeatGauge({
  pct,
  isHi,
  enforced = false,
  seatsPurchased,
  activeStudents,
}: {
  pct: number | null;
  isHi: boolean;
  enforced?: boolean;
  seatsPurchased?: number;
  activeStudents?: number;
}) {
  // null → no seat cap / no signal → render a neutral dash, never 0% or NaN.
  if (pct == null || Number.isNaN(pct)) {
    return (
      <div className="flex flex-col">
        <span className="text-2xl font-bold text-[var(--text-2)]">—</span>
        <span className="text-[11px] text-[var(--text-3)]">
          {tt(isHi, 'Seat use', 'सीट उपयोग')}
        </span>
      </div>
    );
  }
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));

  // Enforcement band (ON path only). When OFF, `band` stays null and the gauge is
  // byte-identical to Wave A's utilization-only colour ramp.
  const band =
    enforced && seatsPurchased != null && activeStudents != null
      ? deriveSeatBand(seatsPurchased, activeStudents)
      : null;

  // Colour: when we have an enforcement band, colour BY THE BAND (amber=grace,
  // red=over, emerald=within). Otherwise fall back to the Wave A utilization ramp.
  const bar = band
    ? band === 'over'
      ? 'bg-danger'
      : band === 'grace'
        ? 'bg-warning'
        : 'bg-success'
    : clamped >= 90
      ? 'bg-warning'
      : clamped >= 60
        ? 'bg-[var(--purple)]'
        : 'bg-success';

  const bandLabel =
    band === 'grace'
      ? tt(isHi, 'In grace', 'छूट में')
      : band === 'over'
        ? tt(isHi, 'Over plan', 'योजना से अधिक')
        : null;

  const bandColor = band === 'over' ? 'var(--danger)' : band === 'grace' ? 'var(--warning)' : undefined;

  return (
    <div className="flex flex-col gap-1">
      {/* When a band label is present (ON path) wrap the % + label in a row;
          otherwise render the % span exactly as Wave A did (byte-identical OFF). */}
      {bandLabel ? (
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-2xl font-bold text-[var(--text-1)] tabular-nums">{clamped}%</span>
          <span className="text-[11px] font-semibold" style={{ color: bandColor }}>
            {bandLabel}
          </span>
        </div>
      ) : (
        <span className="text-2xl font-bold text-[var(--text-1)] tabular-nums">{clamped}%</span>
      )}
      <span className="text-[11px] text-[var(--text-3)]">
        {tt(isHi, 'Seat use', 'सीट उपयोग')}
      </span>
      <div
        className="h-1.5 w-full rounded-full bg-[var(--surface-2)] overflow-hidden"
        role="img"
        aria-label={tt(isHi, `${clamped} percent of seats in use`, `${clamped} प्रतिशत सीटें उपयोग में`)}
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function masteryPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
function Kpi({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">{label}</p>
      <p className="text-[26px] font-bold mt-1 tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="h-4 w-32 rounded bg-[var(--surface-2)] animate-pulse mb-3" aria-hidden="true" />
      <div className="space-y-2" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-11 rounded-xl bg-[var(--surface-2)] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ── Overview strip (eager) ───────────────────────────────────────────────────
function OverviewStrip({
  overview,
  isHi,
  seatEnforced = false,
}: {
  overview: SchoolOverview;
  isHi: boolean;
  /** ff_school_provisioning ON → augment the seat gauge with the enforcement band. */
  seatEnforced?: boolean;
}) {
  if (overview.data_state === 'no_data') {
    return (
      <NoDataState
        reason="no_data"
        title={tt(isHi, 'No school activity yet', 'अभी कोई स्कूल गतिविधि नहीं')}
        message={tt(
          isHi,
          'Counts and mastery will appear here once your students start learning.',
          'जब आपके छात्र सीखना शुरू करेंगे, तब आँकड़े और महारत यहाँ दिखेंगे।',
        )}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      <Kpi label={tt(isHi, 'Classes', 'कक्षाएँ')} value={overview.class_count} color="var(--purple)" />
      <Kpi label={tt(isHi, 'Teachers', 'शिक्षक')} value={overview.teacher_count} color="var(--info)" />
      <Kpi label={tt(isHi, 'Students', 'छात्र')} value={overview.student_count} color="var(--orange)" />
      <Kpi
        label={tt(isHi, 'Active', 'सक्रिय')}
        value={overview.active_students}
        color="var(--success)"
      />
      {/* Seat utilization. Wave A: display-only. Wave B (flag ON): the same
          gauge augmented with the enforcement band (within plan / grace / over),
          derived from the overview counts — NO new fetch (get_school_overview
          does not expose grace state). */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3.5">
        <SeatGauge
          pct={overview.seat_utilization_pct}
          isHi={isHi}
          enforced={seatEnforced}
          seatsPurchased={overview.seats_purchased}
          activeStudents={overview.active_students}
        />
      </div>
      <Kpi
        label={tt(isHi, 'Avg mastery', 'औसत महारत')}
        value={masteryPct(overview.avg_mastery)}
        color="var(--purple)"
      />
    </div>
  );
}

// ── School Pulse section (principal / institution_admin lens) ────────────────
// Gated by the host on ff_school_pulse_v1 AND can('institution.view_analytics');
// the /api/pulse/school route enforces the school-membership boundary
// server-side (usePermissions is UX-only). Forwards the selected school id for
// a multi-school caller.
//
// FETCH SUPPRESSION: useSchoolPulse always builds a non-null SWR key, so the
// only way to suppress the /api/pulse/school call while the flag is OFF (or
// still resolving from its default-OFF initial value) is to NOT MOUNT this
// section — the host renders it only when useSchoolPulseFlag() is true. That
// also keeps the code-split SchoolPulsePanel chunk off the wire when OFF (P10).
function SchoolPulseSection({
  schoolId,
  isHi,
}: {
  schoolId: string | null;
  isHi: boolean;
}) {
  const { data, error, isLoading, mutate } = useSchoolPulse(schoolId ?? undefined);
  return (
    <section aria-label={tt(isHi, 'School Pulse', 'स्कूल पल्स')}>
      <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
        🩺 {tt(isHi, 'School Pulse', 'स्कूल पल्स')}
      </h2>
      <SchoolPulsePanel
        school={data}
        isHi={isHi}
        isLoading={isLoading}
        error={error}
        onRetry={() => mutate()}
        atRiskHref="#cc-classes-at-risk"
      />
    </section>
  );
}

// ── School picker (multi-school 400 case) ────────────────────────────────────
function SchoolPicker({
  schoolIds,
  onPick,
  isHi,
}: {
  schoolIds: string[];
  onPick: (id: string) => void;
  isHi: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center max-w-md mx-auto">
      <div className="text-3xl mb-3" aria-hidden="true">🏫</div>
      <h2 className="text-base font-bold text-[var(--text-1)] mb-1">
        {tt(isHi, 'Choose a school', 'एक स्कूल चुनें')}
      </h2>
      <p className="text-sm text-[var(--text-3)] mb-4">
        {tt(
          isHi,
          'You administer more than one school. Pick which one to view.',
          'आप एक से अधिक स्कूल संभालते हैं। देखने के लिए एक चुनें।',
        )}
      </p>
      <div className="flex flex-col gap-2">
        {schoolIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="px-4 py-3 rounded-xl text-sm font-semibold text-left text-[var(--text-1)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--purple)] active:scale-[0.99] transition-all min-h-[44px] truncate"
          >
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── First-run setup nudge (no_data state only) ───────────────────────────────
// A dismissible "Get started" checklist surfaced ONLY when the overview resolves
// to data_state==='no_data' (a brand-new school with nothing set up yet). It
// links to the four provisioning surfaces a fresh school admin needs to reach but
// can't discover from the empty Command Center alone. Pure navigation — no fetch,
// no mutation, no scoring math. Bilingual via tt() (P7).
const SETUP_STEPS: { href: string; en: string; hi: string }[] = [
  { href: '/school-admin/setup', en: 'Finish school setup', hi: 'स्कूल सेटअप पूरा करें' },
  { href: '/school-admin/invite-codes', en: 'Invite teachers & students', hi: 'शिक्षक और छात्र आमंत्रित करें' },
  { href: '/school-admin/enroll', en: 'Enroll students', hi: 'छात्रों का नामांकन करें' },
  { href: '/school-admin/classes', en: 'Create classes', hi: 'कक्षाएँ बनाएँ' },
];

function SetupChecklist({ isHi }: { isHi: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <section
      aria-label={tt(isHi, 'Get started', 'शुरू करें')}
      className="rounded-2xl border border-[var(--purple)] bg-[var(--surface-1)] p-4 sm:p-5"
      style={{ background: 'color-mix(in srgb, var(--purple) 6%, var(--surface-1))' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
            🚀 {tt(isHi, 'Get your school started', 'अपना स्कूल शुरू करें')}
          </h2>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {tt(
              isHi,
              'A few quick steps to bring your students and teachers on board.',
              'अपने छात्रों और शिक्षकों को जोड़ने के लिए कुछ त्वरित चरण।',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={tt(isHi, 'Dismiss', 'खारिज करें')}
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors min-h-[44px] min-w-[44px]"
        >
          ✕
        </button>
      </div>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SETUP_STEPS.map((step) => (
          <li key={step.href}>
            <a
              href={step.href}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-3 py-3 text-sm font-semibold text-[var(--text-1)] no-underline hover:border-[var(--purple)] active:scale-[0.99] transition-all min-h-[44px]"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[var(--purple)]"
              />
              <span className="truncate">{tt(isHi, step.en, step.hi)}</span>
              <span aria-hidden="true" className="ml-auto text-[var(--purple)]">→</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Command Center ───────────────────────────────────────────────────────────
export default function CommandCenter() {
  const auth = useAuth();
  const { isHi, signOut } = auth;
  const { can } = usePermissions();

  // Seat-enforcement UI gate (Phase 3B Wave B). OFF ⇒ the seat gauge stays the
  // Wave A display-only gauge (byte-identical). ON ⇒ the gauge is augmented with
  // the enforcement band derived from the overview counts (no new fetch).
  const seatEnforced = useSchoolProvisioning();

  // School Pulse gate (`ff_school_pulse_v1`, default OFF). OFF ⇒ the Pulse
  // section never mounts ⇒ useSchoolPulse never runs ⇒ zero /api/pulse/school
  // calls AND the code-split SchoolPulsePanel chunk never loads (P10).
  const pulseEnabled = useSchoolPulseFlag();

  // The selected school for a multi-school caller. null = no explicit selection
  // (single-school callers never set this; the API resolves their one school).
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);

  // Pagination windows for the two list panels.
  const [classOffset, setClassOffset] = useState(0);
  const [teacherOffset, setTeacherOffset] = useState(0);
  const limit = DEFAULT_PAGE_LIMIT;

  const schoolQS = selectedSchoolId ? `school_id=${encodeURIComponent(selectedSchoolId)}` : '';
  const withSchool = (base: string) => (schoolQS ? `${base}${base.includes('?') ? '&' : '?'}${schoolQS}` : base);

  // 1. Overview (eager). A 400 here means "multiple schools — pick one".
  const overviewSWR = useSWR<OverviewResponse, SchoolPickerError>(
    withSchool('/api/school-admin/overview'),
    ccFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true },
  );

  // The multi-school disambiguation list (only present on the 400 from overview).
  const pickerSchoolIds = useMemo(() => {
    const err = overviewSWR.error;
    if (err && err.status === 400 && Array.isArray(err.schoolIds)) return err.schoolIds;
    return null;
  }, [overviewSWR.error]);

  // 2 + 3. The two list panels only fetch once we have a resolvable school
  //    (single-school caller → no picker → fetch immediately; multi-school →
  //    wait for a selection so we don't 400 three times).
  const listGate = !pickerSchoolIds; // false while the picker is showing

  const classesSWR = useSWR<ClassesAtRiskResponse, SchoolPickerError>(
    listGate ? withSchool(`/api/school-admin/classes-at-risk?limit=${limit}&offset=${classOffset}`) : null,
    ccFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true },
  );

  const teachersSWR = useSWR<TeacherEngagementResponse, SchoolPickerError>(
    listGate ? withSchool(`/api/school-admin/teacher-engagement?limit=${limit}&offset=${teacherOffset}`) : null,
    ccFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true },
  );

  const handlePickSchool = useCallback((id: string) => {
    setSelectedSchoolId(id);
    setClassOffset(0);
    setTeacherOffset(0);
  }, []);

  // ── Render ──
  const overview = overviewSWR.data?.data;
  // A 400 with school_ids is NOT a hard error — it's the picker path.
  const overviewHardError = overviewSWR.error && overviewSWR.error.status !== 400;

  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {/* Sticky header — title + chrome (language toggle + sign out) */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{
          background: 'color-mix(in srgb, var(--surface-1) 92%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <h1 className="text-base font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
            {tt(isHi, 'School Command Center', 'स्कूल कमांड सेंटर')}
          </h1>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {tt(isHi, 'School overview and analytics', 'स्कूल अवलोकन और विश्लेषण')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => auth.setLanguage && auth.setLanguage(isHi ? 'en' : 'hi')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              minHeight: '36px',
            }}
            aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
          >
            {isHi ? 'EN' : 'हि'}
          </button>
          <button
            onClick={() => signOut()}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-3)',
              minHeight: '36px',
            }}
            aria-label={tt(isHi, 'Sign out', 'साइन आउट')}
          >
            {tt(isHi, 'Sign Out', 'साइन आउट')}
          </button>
        </div>
      </header>

      <main className="px-4 pt-4 pb-24 max-w-5xl mx-auto space-y-5">
        {/* Multi-school disambiguation: show the picker instead of the panels */}
        {pickerSchoolIds ? (
          <SchoolPicker schoolIds={pickerSchoolIds} onPick={handlePickSchool} isHi={isHi} />
        ) : (
          <>
            {/* First-run setup nudge — ONLY when the overview resolves to the
                no_data state (brand-new school). Surfaces the provisioning
                surfaces a fresh admin must reach but can't discover from the
                empty Command Center. Dismissible; pure navigation. */}
            {overview?.data_state === 'no_data' && <SetupChecklist isHi={isHi} />}

            {/* 1. Overview KPI strip (eager) */}
            <section aria-label={tt(isHi, 'School overview', 'स्कूल अवलोकन')}>
              {overviewSWR.isLoading && !overview ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-[78px] rounded-2xl bg-[var(--surface-2)] animate-pulse" />
                  ))}
                </div>
              ) : overviewHardError ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center">
                  <p className="text-sm text-[var(--text-2)] mb-3">
                    {tt(isHi, "Couldn't load the overview.", 'अवलोकन लोड नहीं हो सका।')}
                  </p>
                  <button
                    type="button"
                    onClick={() => overviewSWR.mutate()}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-on-accent bg-[var(--purple)] active:scale-95 transition-transform min-h-[44px]"
                  >
                    {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
                  </button>
                </div>
              ) : overview ? (
                <OverviewStrip overview={overview} isHi={isHi} seatEnforced={seatEnforced} />
              ) : null}
            </section>

            {/* 2 + 3. Two-column body: classes-at-risk rail + teacher table.
                The rail wrapper carries the anchor id the Pulse summary links
                to (scroll-mt offsets the sticky header). This rail is the ONE
                authoritative at-risk roster on the page (ops de-dup review). */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div id="cc-classes-at-risk" className="scroll-mt-20">
                <ClassesAtRiskRail
                  rows={classesSWR.data?.data ?? []}
                  loading={classesSWR.isLoading && !classesSWR.data}
                  error={Boolean(classesSWR.error)}
                  isHi={isHi}
                  limit={classesSWR.data?.limit ?? limit}
                  offset={classesSWR.data?.offset ?? classOffset}
                  count={classesSWR.data?.count ?? 0}
                  onPrev={() => setClassOffset((o) => Math.max(0, o - limit))}
                  onNext={() => setClassOffset((o) => o + limit)}
                  onRetry={() => classesSWR.mutate()}
                />
              </div>
              <TeacherEngagementTable
                rows={teachersSWR.data?.data ?? []}
                loading={teachersSWR.isLoading && !teachersSWR.data}
                error={Boolean(teachersSWR.error)}
                isHi={isHi}
                limit={teachersSWR.data?.limit ?? limit}
                offset={teachersSWR.data?.offset ?? teacherOffset}
                count={teachersSWR.data?.count ?? 0}
                onPrev={() => setTeacherOffset((o) => Math.max(0, o - limit))}
                onNext={() => setTeacherOffset((o) => o + limit)}
                onRetry={() => teachersSWR.mutate()}
              />
            </div>

            {/* School Pulse — principal lens. DOUBLE-gated:
                1. ff_school_pulse_v1 (default OFF) — independent kill switch.
                   Flag-first ordering matters: while OFF/unresolved the section
                   never mounts, so useSchoolPulse never runs (no SWR key ⇒ zero
                   /api/pulse/school calls) and the code-split SchoolPulsePanel
                   chunk never loads (P10).
                2. institution.view_analytics (UX only; /api/pulse/school
                   enforces school membership server-side). */}
            {pulseEnabled && can('institution.view_analytics') && (
              <SchoolPulseSection schoolId={selectedSchoolId} isHi={isHi} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
