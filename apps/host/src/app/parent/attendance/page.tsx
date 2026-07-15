'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { loadParentSession } from '../_components/parent-session';

// ============================================================
// BILINGUAL HELPER (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string): string => (isHi ? hi : en);

// ============================================================
// TYPES
// ============================================================
interface AttendanceRecord {
  id: string;
  date: string;          // YYYY-MM-DD
  status: 'present' | 'absent' | 'late' | 'excused';
  period: string;        // 'All Day' or period name
  notes: string | null;
  created_at: string;
}

interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

interface ChildOption {
  id: string;
  name: string;
  grade: string;
  school_name?: string;
}

// ============================================================
// CONSTANTS
// ============================================================
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const STATUS_COLORS: Record<string, string> = {
  present: 'bg-green-100 text-green-800 border-green-200',
  absent: 'bg-red-100 text-red-800 border-red-200',
  late: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  excused: 'bg-blue-100 text-blue-700 border-blue-200',
};

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_NAMES_HI = [
  'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
  'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर',
];

const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS_HI = ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'];

function STATUS_LABEL(status: string, isHi: boolean): string {
  const map: Record<string, [string, string]> = {
    present: ['P', 'उ'],
    absent:  ['A', 'अ'],
    late:    ['L', 'वि'],
    excused: ['E', 'म'],
  };
  const [en, hi] = map[status] || ['?', '?'];
  return isHi ? hi : en;
}

// ============================================================
// API HELPER (matches children/page.tsx pattern — raw fetch with JWT)
// ============================================================
async function api(action: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* no session — request will be rejected by Edge Function */ }

  const res = await fetch(`${SB_URL}/functions/v1/parent-portal`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ============================================================
// SKELETON
// ============================================================
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-orange-100 rounded ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <Skeleton className="h-8 w-48 mb-6" />
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      {/* Calendar placeholder */}
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================
function SummaryCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-orange-200 p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-base" aria-hidden="true">{icon}</span>
        <span className="text-[11px] text-gray-500 uppercase tracking-[0.4px] leading-none">{label}</span>
      </div>
      <span className="text-[22px] font-bold leading-none" style={{ color }}>{value}</span>
    </div>
  );
}

// ============================================================
// CALENDAR GRID
// ============================================================
function CalendarGrid({
  year,
  month,
  records,
  isHi,
}: {
  year: number;
  month: number;
  records: AttendanceRecord[];
  isHi: boolean;
}) {
  // Build a lookup: date string -> record
  const byDate: Record<string, AttendanceRecord> = {};
  for (const r of records) {
    byDate[r.date] = r;
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Start on Monday: (0=Sun → 6) (1=Mon → 0) ... (6=Sat → 5)
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;

  // Build grid cells: nulls for leading blanks, then day numbers
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dayLabels = isHi ? DAY_LABELS_HI : DAY_LABELS_EN;

  return (
    <div className="bg-white rounded-xl border border-orange-200 p-4">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-2">
        {dayLabels.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`blank-${idx}`} />;
          }

          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const record = byDate[dateStr];
          const dow = (new Date(year, month, day).getDay()); // 0=Sun, 6=Sat
          const isWeekend = dow === 0 || dow === 6;

          let cellClass = 'border ';
          let dayTextClass = 'text-[11px] font-bold ';
          let statusText = '';

          if (record) {
            cellClass += STATUS_COLORS[record.status] ?? 'bg-white border-gray-200';
            statusText = STATUS_LABEL(record.status, isHi);
            dayTextClass += 'text-inherit';
          } else if (isWeekend) {
            cellClass += 'bg-gray-50 border-gray-100 text-gray-400';
            dayTextClass += 'text-gray-400';
          } else {
            cellClass += 'bg-white border-gray-100 text-gray-700';
            dayTextClass += 'text-gray-700';
          }

          return (
            <div
              key={dateStr}
              className={`rounded-lg flex flex-col items-center justify-center aspect-square min-h-[36px] ${cellClass}`}
              title={record ? `${dateStr}: ${record.status}${record.notes ? ' — ' + record.notes : ''}` : dateStr}
            >
              <span className={dayTextClass}>{day}</span>
              {statusText && (
                <span className="text-[9px] font-semibold leading-none mt-0.5">{statusText}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// RECENT ABSENCES LIST
// ============================================================
function RecentAbsences({
  records,
  isHi,
}: {
  records: AttendanceRecord[];
  isHi: boolean;
}) {
  const nonPresent = records
    .filter((r) => r.status !== 'present')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  if (nonPresent.length === 0) return null;

  const statusLabelFull: Record<string, [string, string]> = {
    absent:  ['Absent', 'अनुपस्थित'],
    late:    ['Late', 'विलंब'],
    excused: ['Excused', 'माफ़'],
  };

  return (
    <div className="bg-white rounded-xl border border-orange-200 p-4">
      <h3 className="text-[14px] font-semibold text-gray-900 mb-3">
        {tt(isHi, 'Recent Absences', 'हाल की अनुपस्थिति')}
      </h3>
      <div className="space-y-2">
        {nonPresent.map((r) => {
          const [en, hi] = statusLabelFull[r.status] ?? ['Unknown', 'अज्ञात'];
          return (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 py-2 border-b border-orange-50 last:border-b-0"
            >
              <div className="flex flex-col">
                <span className="text-[13px] font-semibold text-gray-900">{r.date}</span>
                {r.notes && (
                  <span className="text-[12px] text-gray-500 mt-0.5">{r.notes}</span>
                )}
              </div>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}
              >
                {isHi ? hi : en}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function ParentAttendancePage() {
  const auth = useAuth();
  const router = useRouter();
  const isHi = auth.isHi ?? false;

  // Auth state
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Children selector
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);

  // Month/year navigation
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-indexed

  // Data
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Resolve auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (auth.isLoading) return;

    // Guardian-mode parent (has Supabase JWT)
    if (auth.guardian) {
      setGuardianId(auth.guardian.id);
      setAuthChecked(true);
      return;
    }

    // Link-code fallback (HMAC session)
    loadParentSession().then((session) => {
      if (session) {
        setGuardianId(session.guardian.id);
      } else {
        router.replace('/parent');
      }
      setAuthChecked(true);
    });
  }, [auth.isLoading, auth.guardian, router]);

  // ── Fetch children list ───────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked || !guardianId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await api('get_children', { guardian_id: guardianId });
        if (cancelled) return;
        // Normalise the two known response shapes (res.children or res.students)
        const raw = (res.children ?? res.students);
        if (Array.isArray(raw) && raw.length > 0) {
          setChildren(
            (raw as Record<string, unknown>[]).map((c) => ({
              id: String(c.id ?? ''),
              name: String(c.name ?? 'Child'),
              grade: String(c.grade ?? ''),
              school_name: c.school_name ? String(c.school_name) : undefined,
            }))
          );
        }
      } catch {
        // Non-fatal: page will show no child tabs but attendance fetch will still run
      }
    })();
    return () => { cancelled = true; };
  }, [authChecked, guardianId]);

  // ── Fetch attendance for selected child + month ──────────────────────────
  const fetchAttendance = useCallback(async () => {
    if (!authChecked || !guardianId) return;

    const selectedChild = children[selectedChildIdx];
    if (!selectedChild && children.length > 0) return;

    // If we have no children list yet (still loading), use guardianId as a
    // best-effort probe; the Edge Function resolves the first linked child.
    const studentId = selectedChild?.id ?? null;
    if (!studentId && children.length > 0) return;

    setLoading(true);
    setError(null);

    const dateFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateTo = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      const params: Record<string, unknown> = { date_from: dateFrom, date_to: dateTo };
      if (guardianId) params.guardian_id = guardianId;
      if (studentId) params.student_id = studentId;

      const res = await api('get_child_attendance', params);
      const rawRecords = Array.isArray(res.records) ? res.records : [];
      const rawSummary = res.summary as AttendanceSummary | undefined;

      setRecords(
        (rawRecords as Record<string, unknown>[]).map((r) => ({
          id: String(r.id ?? ''),
          date: String(r.date ?? ''),
          status: String(r.status ?? 'absent') as AttendanceRecord['status'],
          period: String(r.period ?? 'All Day'),
          notes: r.notes != null ? String(r.notes) : null,
          created_at: String(r.created_at ?? ''),
        }))
      );
      setSummary(
        rawSummary
          ? {
              total: Number(rawSummary.total ?? 0),
              present: Number(rawSummary.present ?? 0),
              absent: Number(rawSummary.absent ?? 0),
              late: Number(rawSummary.late ?? 0),
              excused: Number(rawSummary.excused ?? 0),
            }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(isHi, 'Failed to load attendance', 'उपस्थिति लोड करने में विफल'));
    } finally {
      setLoading(false);
    }
  }, [authChecked, guardianId, children, selectedChildIdx, year, month, isHi]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  // ── Month navigation helpers ─────────────────────────────────────────────
  const goToPrevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const goToNextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  // Prevent navigating beyond the current month
  const now = new Date();
  const isCurrentOrFuture = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth());

  // ── Auth loading ─────────────────────────────────────────────────────────
  if (!authChecked || auth.isLoading) {
    return (
      <div className="font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 min-h-dvh bg-[var(--bg)]">
        <PageSkeleton />
      </div>
    );
  }

  // ── Main loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 min-h-dvh bg-[var(--bg)]">
        <PageSkeleton />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 min-h-dvh bg-[var(--bg)]">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <div className="text-4xl mb-3" aria-hidden="true">!</div>
          <p className="text-red-600 text-[14px] font-semibold mb-1">
            {tt(isHi, 'Could not load attendance', 'उपस्थिति लोड नहीं हो सकी')}
          </p>
          <p className="text-gray-500 text-[13px] mb-4">{error}</p>
          <button
            onClick={fetchAttendance}
            className="px-5 py-2.5 bg-orange-500 text-white rounded-[10px] text-[14px] font-semibold border-0 cursor-pointer min-h-[44px]"
          >
            {tt(isHi, 'Try Again', 'पुनः प्रयास करें')}
          </button>
        </div>
      </div>
    );
  }

  const selectedChild = children[selectedChildIdx] ?? null;
  const childName = selectedChild?.name ?? tt(isHi, 'Your Child', 'आपका बच्चा');

  // Attendance percentage
  const presentPct =
    summary && summary.total > 0
      ? Math.round((summary.present / summary.total) * 100)
      : null;

  const monthLabel = isHi ? MONTH_NAMES_HI[month] : MONTH_NAMES_EN[month];

  return (
    <div
      className="font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 min-h-dvh bg-[var(--bg)]"
    >
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] text-orange-500 font-semibold uppercase tracking-[1px] mb-0.5">
            {tt(isHi, 'Parent Portal', 'अभिभावक पोर्टल')}
          </p>
          <h1 className="text-[22px] font-bold text-gray-900 m-0">
            {tt(isHi, 'Attendance', 'उपस्थिति')}
          </h1>
          {selectedChild && (
            <p className="text-[13px] text-gray-500 mt-0.5">
              {childName}
              {selectedChild.grade ? ` — ${tt(isHi, 'Grade', 'कक्षा')} ${selectedChild.grade}` : ''}
              {selectedChild.school_name ? ` | ${selectedChild.school_name}` : ''}
            </p>
          )}
        </div>

        {/* ── Child selector tabs (multi-child) ───────────────────────────── */}
        {children.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
            {children.map((child, idx) => {
              const active = idx === selectedChildIdx;
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => { setSelectedChildIdx(idx); }}
                  className={[
                    'flex items-center gap-2 px-3 py-2 rounded-2xl text-[13px] font-semibold whitespace-nowrap border min-h-[44px] transition-all',
                    active
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-gray-700 border-orange-200 hover:bg-orange-50',
                  ].join(' ')}
                >
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-bold"
                    style={{ background: active ? 'rgba(255,255,255,0.3)' : '#E8581C' }}
                    aria-hidden="true"
                  >
                    {child.name.charAt(0).toUpperCase()}
                  </span>
                  {child.name.split(' ')[0]}
                  {child.grade && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${active ? 'bg-white/25 text-white' : 'bg-orange-100 text-orange-600'}`}
                    >
                      {tt(isHi, 'G', 'क')}{child.grade}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Month navigation ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between bg-white border border-orange-200 rounded-xl px-4 py-3">
          <button
            type="button"
            onClick={goToPrevMonth}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-orange-50 text-orange-500 font-bold text-lg border-0 bg-transparent cursor-pointer"
            aria-label={tt(isHi, 'Previous month', 'पिछला महीना')}
          >
            &lt;
          </button>
          <span className="text-[15px] font-semibold text-gray-900">
            {monthLabel} {year}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            disabled={isCurrentOrFuture}
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg font-bold text-lg border-0 bg-transparent cursor-pointer ${isCurrentOrFuture ? 'text-gray-300 cursor-not-allowed' : 'text-orange-500 hover:bg-orange-50'}`}
            aria-label={tt(isHi, 'Next month', 'अगला महीना')}
          >
            &gt;
          </button>
        </div>

        {/* ── Summary cards ────────────────────────────────────────────────── */}
        {summary && summary.total > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard
              label={tt(isHi, 'Present', 'उपस्थित')}
              value={presentPct !== null ? `${presentPct}%` : '—'}
              color="#059669"
              icon="✓"
            />
            <SummaryCard
              label={tt(isHi, 'Absent', 'अनुपस्थित')}
              value={summary.absent}
              color="#DC2626"
              icon="✗"
            />
            <SummaryCard
              label={tt(isHi, 'Late', 'विलंब')}
              value={summary.late}
              color="#D97706"
              icon="●"
            />
          </div>
        ) : (
          /* Empty summary placeholder so grid doesn't collapse */
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label={tt(isHi, 'Present', 'उपस्थित')} value="—" color="#059669" icon="✓" />
            <SummaryCard label={tt(isHi, 'Absent', 'अनुपस्थित')} value="—" color="#DC2626" icon="✗" />
            <SummaryCard label={tt(isHi, 'Late', 'विलंब')} value="—" color="#D97706" icon="●" />
          </div>
        )}

        {/* ── Calendar grid ────────────────────────────────────────────────── */}
        <CalendarGrid year={year} month={month} records={records} isHi={isHi} />

        {/* ── Legend ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3">
          {[
            { status: 'present', en: 'Present', hi: 'उपस्थित' },
            { status: 'absent',  en: 'Absent',  hi: 'अनुपस्थित' },
            { status: 'late',    en: 'Late',    hi: 'विलंब' },
            { status: 'excused', en: 'Excused', hi: 'माफ़' },
          ].map(({ status, en, hi }) => (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold border ${STATUS_COLORS[status]}`}
              >
                {STATUS_LABEL(status, isHi)}
              </span>
              <span className="text-[12px] text-gray-600">{isHi ? hi : en}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold border bg-gray-50 border-gray-100 text-gray-400">
              {isHi ? 'र' : 'S'}
            </span>
            <span className="text-[12px] text-gray-600">{tt(isHi, 'Weekend', 'सप्ताहांत')}</span>
          </div>
        </div>

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {records.length === 0 && (
          <div className="bg-white rounded-xl border border-orange-200 p-6 text-center">
            <div className="text-3xl mb-2" aria-hidden="true">&#x1F4C5;</div>
            <p className="text-[14px] font-semibold text-gray-900 mb-1">
              {tt(isHi, 'No attendance records for this month', 'इस महीने कोई उपस्थिति रिकॉर्ड नहीं')}
            </p>
            <p className="text-[12px] text-gray-500">
              {tt(
                isHi,
                'Records will appear here once the school submits attendance.',
                'जब स्कूल उपस्थिति दर्ज करेगा, रिकॉर्ड यहाँ दिखाई देंगे।',
              )}
            </p>
          </div>
        )}

        {/* ── Recent absences list ─────────────────────────────────────────── */}
        {records.length > 0 && <RecentAbsences records={records} isHi={isHi} />}

        {/* ── Footer note ──────────────────────────────────────────────────── */}
        {summary && summary.total > 0 && (
          <p className="text-[11px] text-gray-400 text-center pb-2">
            {tt(isHi, `${summary.total} school days recorded this month`, `इस महीने ${summary.total} स्कूल दिन दर्ज`)}
          </p>
        )}
      </div>
    </div>
  );
}
