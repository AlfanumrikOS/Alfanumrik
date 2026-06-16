'use client';

/**
 * SchoolReports — Phase 3B Wave D. The DEEP, board/parent-ready school-wide
 * academic reporting surface, gated behind `ff_school_reports_depth` (the flag
 * gate + lazy import live in reports-depth/page.tsx). It composes the three NEW
 * read routes into a single read-only reporting view:
 *
 *   1. Mastery rollup (SWR) — get_school_mastery_rollup via
 *      /api/school-admin/reports/mastery?group_by=grade|subject|teacher. A
 *      group-by toggle (Grade / Subject / Teacher) refetches; rendered as a
 *      bar-augmented table of group_label → student_count, avg_mastery (%, '—'
 *      when null), at_risk_count.
 *   2. Bloom summary (SWR) — get_school_bloom_summary via
 *      /api/school-admin/reports/bloom. Rendered as the Bloom distribution
 *      (bloom_level → response_count, accuracy %). Bloom level NAMES are
 *      technical terms — NOT translated even when isHi (P7 exception).
 *   3. Export — a "Download CSV" button hits /reports/export?format=csv (blob
 *      download), and a "Print / Save as PDF" action opens a print-friendly
 *      view via window.print() with print CSS — NO heavy PDF library (P10).
 *
 * Multi-school caller: when the caller administers MULTIPLE schools and no
 * ?school_id is supplied, the read endpoints return HTTP 400 with
 * { school_ids:[...] }. We surface a school picker; once a school is chosen we
 * pass ?school_id= on ALL fetches + the export. A single-school caller never
 * sees the picker.
 *
 * Boundary discipline (frontend):
 *   - 100% read-only. NO mutations, NO scoring/XP/mastery math — every numeric is
 *     rendered verbatim from the read models (assessment owns the values).
 *   - avg_mastery / accuracy null → render '—', never NaN or a fake 0.
 *   - data_state / empty arrays are honored (NoDataState), never faked numbers.
 *   - SWR for client cache + revalidate. P7 bilingual via AuthContext.isHi.
 *     P13: no PII in client logs (and the API returns aggregates only).
 */

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { authedFetch } from '@/lib/school-admin/authed-fetch';
import { useAuth } from '@/lib/AuthContext';
import { NoDataState } from '@/components/admin-ui';
import {
  DEFAULT_MASTERY_GROUP_BY,
  type MasteryGroupBy,
  type MasteryRollupResponse,
  type BloomSummaryResponse,
} from '@/lib/school-admin/reporting-types';

// ── Bilingual helper (P7) ─────────────────────────────────────────────────────
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ── SWR fetcher: { success:false } envelope OR a 400 multi-school hint ─────────
interface SchoolPickerError extends Error {
  status: number;
  schoolIds?: string[];
}

async function reportFetcher<T>(url: string): Promise<T> {
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

/** Format a 0..1 fraction as a whole-percent string; null/NaN → '—'. */
function pct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** Bar fill width for a 0..1 fraction; null/NaN → 0 (renders as a dash row). */
function barWidth(value: number | null): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

// ── Group-by toggle ────────────────────────────────────────────────────────────
const GROUP_BY_OPTIONS: { key: MasteryGroupBy; en: string; hi: string }[] = [
  { key: 'grade', en: 'Grade', hi: 'कक्षा' },
  { key: 'subject', en: 'Subject', hi: 'विषय' },
  { key: 'teacher', en: 'Teacher', hi: 'शिक्षक' },
];

function GroupByToggle({
  value,
  onChange,
  isHi,
}: {
  value: MasteryGroupBy;
  onChange: (g: MasteryGroupBy) => void;
  isHi: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={tt(isHi, 'Group mastery by', 'महारत समूहित करें')}
      className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-0.5 no-print"
    >
      {GROUP_BY_OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
              active
                ? 'bg-[var(--surface-1)] text-[var(--purple,#7C3AED)] shadow-sm'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            {tt(isHi, opt.en, opt.hi)}
          </button>
        );
      })}
    </div>
  );
}

// ── Mastery bar (renders the 0..1 avg_mastery; '—' when null) ───────────────────
function MasteryBar({ value, isHi }: { value: number | null; isHi: boolean }) {
  const label = pct(value);
  const width = barWidth(value);
  const color = width >= 80 ? '#16A34A' : width >= 40 ? '#7C3AED' : width > 0 ? '#F59E0B' : '#9CA3AF';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div
        className="h-2 flex-1 rounded-full bg-[var(--surface-2)] overflow-hidden"
        role="img"
        aria-label={tt(isHi, `${label} average mastery`, `${label} औसत महारत`)}
      >
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
      <span className="text-sm font-bold tabular-nums text-[var(--text-1)] w-10 text-right">{label}</span>
    </div>
  );
}

// ── Section card wrapper ────────────────────────────────────────────────────────
function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4 sm:p-5 print-card">
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">{title}</h2>
          {subtitle && <p className="text-xs text-[var(--text-3)] mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="h-9 rounded-lg bg-[var(--surface-2)] animate-pulse" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-11 rounded-lg bg-[var(--surface-2)] animate-pulse" />
      ))}
    </div>
  );
}

function ErrorBlock({ onRetry, isHi }: { onRetry: () => void; isHi: boolean }) {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-[var(--text-2)] mb-3">
        {tt(isHi, "Couldn't load this report.", 'यह रिपोर्ट लोड नहीं हो सकी।')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[var(--purple,#7C3AED)] active:scale-95 transition-transform min-h-[44px] no-print"
      >
        {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
      </button>
    </div>
  );
}

// ── School picker (multi-school 400 case) ───────────────────────────────────────
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
          'You administer more than one school. Pick which one to report on.',
          'आप एक से अधिक स्कूल संभालते हैं। रिपोर्ट के लिए एक चुनें।',
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

// ── Print stylesheet (no heavy PDF library — window.print() → Save as PDF) ───────
const PRINT_STYLES = `
@media print {
  body { background: #fff !important; }
  .no-print { display: none !important; }
  .print-card { border: 1px solid #E5E7EB !important; box-shadow: none !important; break-inside: avoid; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

// ── SchoolReports ────────────────────────────────────────────────────────────
export default function SchoolReports() {
  const { isHi } = useAuth();

  // The selected school for a multi-school caller. null = no explicit selection
  // (single-school callers never set this; the API resolves their one school).
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);

  // Mastery group-by dimension (Grade / Subject / Teacher).
  const [groupBy, setGroupBy] = useState<MasteryGroupBy>(DEFAULT_MASTERY_GROUP_BY);

  // CSV export in-flight (disables the button + shows progress; no PII logged).
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const schoolQS = selectedSchoolId ? `school_id=${encodeURIComponent(selectedSchoolId)}` : '';
  const withSchool = (base: string) =>
    schoolQS ? `${base}${base.includes('?') ? '&' : '?'}${schoolQS}` : base;

  // 1. Mastery rollup (refetches on group-by change). A 400 here = "pick a school".
  const masterySWR = useSWR<MasteryRollupResponse, SchoolPickerError>(
    withSchool(`/api/school-admin/reports/mastery?group_by=${groupBy}`),
    reportFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true },
  );

  // The multi-school disambiguation list (only present on the 400 from mastery).
  const pickerSchoolIds = useMemo(() => {
    const err = masterySWR.error;
    if (err && err.status === 400 && Array.isArray(err.schoolIds)) return err.schoolIds;
    return null;
  }, [masterySWR.error]);

  // 2. Bloom summary. Gate it behind a resolvable school so we don't 400 twice
  //    while the picker is showing.
  const listGate = !pickerSchoolIds;
  const bloomSWR = useSWR<BloomSummaryResponse, SchoolPickerError>(
    listGate ? withSchool('/api/school-admin/reports/bloom') : null,
    reportFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true },
  );

  const handlePickSchool = useCallback((id: string) => {
    setSelectedSchoolId(id);
  }, []);

  // 3a. Export CSV — blob download from the export route (server builds the CSV;
  //     the client only triggers the download). authedFetch forwards the Bearer
  //     access token (the session lives in localStorage, not a cookie). P13: only
  //     a generic error toast/message, never any PII.
  const handleDownloadCsv = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await authedFetch(withSchool('/api/school-admin/reports/export?format=csv'));
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const datePart = new Date().toISOString().slice(0, 10);
      const filename = `school-report-${datePart}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // P13: no PII in logs — generic message only.
      setExportError(tt(isHi, "Couldn't download — please retry.", 'डाउनलोड नहीं हो सका — पुनः प्रयास करें।'));
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHi, schoolQS]);

  // 3b. Print / Save as PDF — print-friendly view via the browser print dialog.
  //     No heavy PDF library (P10); print CSS hides the chrome + controls.
  const handlePrint = useCallback(() => {
    if (typeof window !== 'undefined') window.print();
  }, []);

  const masteryRows = masterySWR.data?.data ?? [];
  const bloomRows = bloomSWR.data?.data ?? [];
  const masteryHardError = masterySWR.error && masterySWR.error.status !== 400;
  const generatedAt = new Date().toLocaleString(isHi ? 'hi-IN' : 'en-IN');

  return (
    <div className="font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Page header + export actions */}
      <header className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
            {tt(isHi, 'School Academic Report', 'स्कूल शैक्षणिक रिपोर्ट')}
          </h1>
          <p className="text-xs text-[var(--text-3)] mt-1">
            {tt(isHi, 'Generated', 'तैयार')}: {generatedAt}
          </p>
        </div>

        {!pickerSchoolIds && (
          <div className="flex items-center gap-2 no-print">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={exporting}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[var(--text-1)] bg-[var(--surface-1)] border border-[var(--border)] hover:border-[var(--purple,#7C3AED)] active:scale-95 transition-all min-h-[44px] disabled:opacity-50"
            >
              {exporting
                ? tt(isHi, 'Downloading…', 'डाउनलोड हो रहा…')
                : tt(isHi, 'Download CSV', 'CSV डाउनलोड करें')}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--purple,#7C3AED)] active:scale-95 transition-all min-h-[44px]"
            >
              {tt(isHi, 'Print / Save as PDF', 'प्रिंट / PDF सहेजें')}
            </button>
          </div>
        )}
      </header>

      {exportError && (
        <p className="text-xs text-red-600 mb-4 no-print" role="alert">
          {exportError}
        </p>
      )}

      {/* Multi-school disambiguation: show the picker instead of the report. */}
      {pickerSchoolIds ? (
        <SchoolPicker schoolIds={pickerSchoolIds} onPick={handlePickSchool} isHi={isHi} />
      ) : (
        <div className="space-y-5">
          {/* ── 1. Mastery rollup ── */}
          <SectionCard
            title={tt(isHi, 'Mastery comparatives', 'महारत तुलना')}
            subtitle={tt(
              isHi,
              'Average mastery and at-risk counts across the school.',
              'पूरे स्कूल में औसत महारत और जोखिम वाले छात्र।',
            )}
            action={<GroupByToggle value={groupBy} onChange={setGroupBy} isHi={isHi} />}
          >
            {masterySWR.isLoading && masteryRows.length === 0 ? (
              <TableSkeleton />
            ) : masteryHardError ? (
              <ErrorBlock onRetry={() => masterySWR.mutate()} isHi={isHi} />
            ) : masteryRows.length === 0 ? (
              <NoDataState
                reason="no_data"
                title={tt(isHi, 'No mastery signal yet', 'अभी कोई महारत संकेत नहीं')}
                message={tt(
                  isHi,
                  'Mastery comparatives will appear once your students start learning.',
                  'जब आपके छात्र सीखना शुरू करेंगे, तब महारत तुलना यहाँ दिखेगी।',
                )}
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-left">
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] whitespace-nowrap">
                        {GROUP_BY_OPTIONS.find((o) => o.key === groupBy)
                          ? tt(
                              isHi,
                              GROUP_BY_OPTIONS.find((o) => o.key === groupBy)!.en,
                              GROUP_BY_OPTIONS.find((o) => o.key === groupBy)!.hi,
                            )
                          : tt(isHi, 'Group', 'समूह')}
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] text-right whitespace-nowrap">
                        {tt(isHi, 'Students', 'छात्र')}
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] whitespace-nowrap">
                        {tt(isHi, 'Avg mastery', 'औसत महारत')}
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] text-right whitespace-nowrap">
                        {tt(isHi, 'At risk', 'जोखिम में')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {masteryRows.map((row, idx) => (
                      <tr
                        key={row.group_key}
                        className={idx % 2 === 0 ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-2)]/40'}
                      >
                        <td className="px-3 py-2.5 font-medium text-[var(--text-1)]">
                          {row.group_label}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-2)]">
                          {row.student_count}
                        </td>
                        <td className="px-3 py-2.5">
                          <MasteryBar value={row.avg_mastery} isHi={isHi} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span className={row.at_risk_count > 0 ? 'font-bold text-red-600' : 'text-[var(--text-3)]'}>
                            {row.at_risk_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ── 2. Bloom's distribution ── */}
          <SectionCard
            title={tt(isHi, "Bloom's distribution", "ब्लूम वितरण")}
            subtitle={tt(
              isHi,
              "Responses and accuracy by Bloom's cognitive level.",
              "ब्लूम संज्ञानात्मक स्तर के अनुसार प्रतिक्रियाएँ और सटीकता।",
            )}
          >
            {bloomSWR.isLoading && bloomRows.length === 0 ? (
              <TableSkeleton rows={4} />
            ) : bloomSWR.error ? (
              <ErrorBlock onRetry={() => bloomSWR.mutate()} isHi={isHi} />
            ) : bloomRows.length === 0 ? (
              <NoDataState
                reason="no_data"
                title={tt(isHi, "No Bloom's data yet", 'अभी कोई ब्लूम डेटा नहीं')}
                message={tt(
                  isHi,
                  'The distribution will appear as students answer quiz questions.',
                  'जैसे-जैसे छात्र क्विज़ के उत्तर देंगे, वितरण यहाँ दिखेगा।',
                )}
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-left">
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] whitespace-nowrap">
                        {/* Bloom's level names are technical terms — NOT translated (P7 exception). */}
                        Bloom&apos;s level
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] text-right whitespace-nowrap">
                        {tt(isHi, 'Responses', 'प्रतिक्रियाएँ')}
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[var(--text-2)] whitespace-nowrap">
                        {tt(isHi, 'Accuracy', 'सटीकता')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bloomRows.map((row, idx) => (
                      <tr
                        key={row.bloom_level}
                        className={idx % 2 === 0 ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-2)]/40'}
                      >
                        {/* Raw bloom_level value emitted verbatim — technical term, not translated. */}
                        <td className="px-3 py-2.5 font-medium text-[var(--text-1)] capitalize">
                          {row.bloom_level}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-2)]">
                          {row.response_count}
                        </td>
                        <td className="px-3 py-2.5">
                          <MasteryBar value={row.accuracy} isHi={isHi} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <p className="text-[11px] text-[var(--text-3)] text-center pt-1">
            {tt(
              isHi,
              'Aggregate figures only — no individual student data. Powered by Alfanumrik.',
              'केवल समग्र आँकड़े — किसी छात्र का व्यक्तिगत डेटा नहीं। Alfanumrik द्वारा संचालित।',
            )}
          </p>
        </div>
      )}
    </div>
  );
}
