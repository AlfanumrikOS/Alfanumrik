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
import { useAuth } from '@/lib/AuthContext';
import { NoDataState } from '@/components/admin-ui';
import {
  DEFAULT_PAGE_LIMIT,
  type SchoolOverview,
  type OverviewResponse,
  type ClassesAtRiskResponse,
  type TeacherEngagementResponse,
} from '@/lib/school-admin/command-center-types';

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

// ── Bilingual helper (P7) ───────────────────────────────────────────────────
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ── SWR fetcher: { success:false } envelope OR a 400 multi-school hint ───────
interface SchoolPickerError extends Error {
  status: number;
  schoolIds?: string[];
}

async function ccFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
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

// ── Seat-utilization gauge (DISPLAY ONLY — no enforcement implied) ───────────
function SeatGauge({ pct, isHi }: { pct: number | null; isHi: boolean }) {
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
  const bar =
    clamped >= 90 ? 'bg-amber-500' : clamped >= 60 ? 'bg-[var(--purple,#7C3AED)]' : 'bg-emerald-500';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl font-bold text-[var(--text-1)] tabular-nums">{clamped}%</span>
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
}: {
  overview: SchoolOverview;
  isHi: boolean;
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
      <Kpi label={tt(isHi, 'Classes', 'कक्षाएँ')} value={overview.class_count} color="#7C3AED" />
      <Kpi label={tt(isHi, 'Teachers', 'शिक्षक')} value={overview.teacher_count} color="#0891B2" />
      <Kpi label={tt(isHi, 'Students', 'छात्र')} value={overview.student_count} color="#F97316" />
      <Kpi
        label={tt(isHi, 'Active', 'सक्रिय')}
        value={overview.active_students}
        color="#16A34A"
      />
      {/* Seat utilization — DISPLAY ONLY (Wave A). No blocking is implied. */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3.5">
        <SeatGauge pct={overview.seat_utilization_pct} isHi={isHi} />
      </div>
      <Kpi
        label={tt(isHi, 'Avg mastery', 'औसत महारत')}
        value={masteryPct(overview.avg_mastery)}
        color="#7C3AED"
      />
    </div>
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
            className="px-4 py-3 rounded-xl text-sm font-semibold text-left text-[var(--text-1)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--purple,#7C3AED)] active:scale-[0.99] transition-all min-h-[44px] truncate"
          >
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Command Center ───────────────────────────────────────────────────────────
export default function CommandCenter() {
  const auth = useAuth();
  const { isHi, signOut } = auth;

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
            {tt(isHi, 'Read-only overview', 'केवल-पठन अवलोकन')}
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
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[var(--purple,#7C3AED)] active:scale-95 transition-transform min-h-[44px]"
                  >
                    {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
                  </button>
                </div>
              ) : overview ? (
                <OverviewStrip overview={overview} isHi={isHi} />
              ) : null}
            </section>

            {/* 2 + 3. Two-column body: classes-at-risk rail + teacher table */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
          </>
        )}
      </main>
    </div>
  );
}
