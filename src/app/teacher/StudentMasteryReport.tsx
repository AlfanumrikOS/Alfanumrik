'use client';

/**
 * StudentMasteryReport — Phase 3A Wave C drill-through panel (lazy-loaded, P10).
 *
 * Pure presentation of the `get_student_mastery_report` Edge response plus a
 * parent-ready CSV export. The parent Command Center owns the fetch (so this
 * stays trivially testable and tree-shakeable out of the flag-OFF bundle, the
 * same discipline GradingQueue uses); this component only renders the data and
 * drives the export via the `onExport` callback.
 *
 * What it surfaces:
 *   - Recent performance strip (quizzes · avg score · streak · overall mastery).
 *   - Mastery by concept — a horizontal bar per concept (heat-coloured), read
 *     VERBATIM from `mastery_pct`. NO scoring/XP math here (P1/P2 untouched).
 *   - Bloom's distribution — ALWAYS the canonical 6 levels in canonical order
 *     (remember→understand→apply→analyze→evaluate→create), each with its
 *     correct/total and accuracy_pct. Unattempted levels render as a muted "—"
 *     row (the Edge omits them; we render the full ladder for a stable, complete
 *     pedagogical picture). The server's `weakest_level` is highlighted.
 *
 * Boundary discipline (frontend):
 *   - mastery_pct / accuracy_pct are display figures the assessment layer owns —
 *     rendered verbatim, never recomputed.
 *   - P7 bilingual via the `isHi` prop, EXCEPT Bloom's level NAMES, which are
 *     technical terms and are never translated (P7 exception).
 *   - P13 no PII in client logs (this component logs nothing).
 */

import { useMemo } from 'react';
import { BLOOM_LEVEL_ORDER } from '@/lib/types';
import type { StudentMasteryReport as StudentMasteryReportData } from '@/lib/types';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

/** Heat colour for a 0–100 mastery/accuracy percent (matches the heatmap scale). */
function heatBg(pct: number): string {
  if (pct >= 95) return 'bg-emerald-600';
  if (pct >= 80) return 'bg-violet-600';
  if (pct >= 60) return 'bg-blue-600';
  if (pct >= 30) return 'bg-amber-600';
  if (pct > 10) return 'bg-amber-400';
  return 'bg-slate-700';
}

/** Recent-performance stat tile. */
function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-slate-900 rounded-xl py-3 px-3.5 border border-slate-800">
      <p className="text-slate-500 text-[10px] m-0 uppercase tracking-wide">{label}</p>
      <p className={`${color} text-[22px] font-bold mt-1`}>{value}</p>
    </div>
  );
}

export default function StudentMasteryReport({
  report,
  loading,
  error,
  exporting,
  isHi,
  onExport,
  onRetry,
  onClose,
}: {
  report: StudentMasteryReportData | null;
  loading: boolean;
  error: boolean;
  exporting: boolean;
  isHi: boolean;
  onExport: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  // Always render the canonical 6-level Bloom's ladder. The Edge omits levels a
  // student never answered; we project its `by_level` onto the canonical order
  // so the picture is complete and stable (unattempted → muted "—").
  const bloomLadder = useMemo(() => {
    const byLevel = new Map(
      (report?.bloom.by_level ?? []).map((r) => [r.bloom_level.trim().toLowerCase(), r]),
    );
    return BLOOM_LEVEL_ORDER.map((level) => {
      const row = byLevel.get(level);
      return {
        level, // technical term — NEVER translated (P7 exception)
        attempted: !!row && row.total > 0,
        correct: row?.correct ?? 0,
        total: row?.total ?? 0,
        accuracy_pct: row?.accuracy_pct ?? 0,
      };
    });
  }, [report?.bloom.by_level]);

  const weakest = report?.bloom.weakest_level
    ? report.bloom.weakest_level.trim().toLowerCase()
    : null;

  return (
    <div className="td-card" data-testid="student-mastery-report">
      <div className="td-card-head">
        <h3>{tt(isHi, 'Student mastery report', 'छात्र मास्टरी रिपोर्ट')}</h3>
        <div className="flex items-center gap-2">
          {report && !loading && !error && (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              data-testid="report-export-btn"
              className="py-1 px-2.5 bg-emerald-600 text-white border-none rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {exporting
                ? tt(isHi, 'Preparing…', 'तैयार हो रहा है…')
                : tt(isHi, 'Download report', 'रिपोर्ट डाउनलोड करें')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="report-close-btn"
            className="py-1 px-2.5 bg-transparent text-slate-400 border border-slate-700 rounded-md text-[11px] font-medium cursor-pointer hover:border-indigo-500"
          >
            {tt(isHi, 'Close', 'बंद करें')}
          </button>
        </div>
      </div>

      <div className="mt-3.5">
        {loading ? (
          // Loading
          <div className="h-48 rounded-lg bg-slate-800/50 animate-pulse" aria-hidden="true" />
        ) : error ? (
          // Error
          <div className="text-center py-8 text-slate-500" data-testid="report-error">
            <div className="text-3xl mb-3">&#x1F615;</div>
            <p className="text-[14px] font-medium text-slate-400 mb-3">
              {tt(isHi, "Couldn't load the report", 'रिपोर्ट लोड नहीं हो सकी')}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="py-2 px-5 bg-indigo-500 text-white border-none rounded-lg text-[13px] font-semibold cursor-pointer"
            >
              {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
            </button>
          </div>
        ) : !report ? null : (
          <div className="flex flex-col gap-5">
            {/* Header: name + grade */}
            <div>
              <p className="text-[16px] font-bold text-slate-100 m-0">{report.student_name}</p>
              <p className="text-[12px] text-slate-500 m-0">
                {tt(isHi, 'Grade', 'कक्षा')} {report.grade || '—'}
              </p>
            </div>

            {/* Recent performance */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatTile
                label={tt(isHi, 'Overall mastery', 'कुल मास्टरी')}
                value={`${report.mastery.overall_pct}%`}
                color="text-violet-400"
              />
              <StatTile
                label={tt(isHi, 'Quizzes', 'क्विज़')}
                value={report.recent.quizzes}
                color="text-indigo-400"
              />
              <StatTile
                label={tt(isHi, 'Avg score', 'औसत स्कोर')}
                value={`${report.recent.avg_score}%`}
                color="text-sky-400"
              />
              <StatTile
                label={tt(isHi, 'Streak', 'स्ट्रीक')}
                value={report.recent.streak}
                color="text-emerald-400"
              />
            </div>

            {/* Mastery by concept */}
            <div data-testid="report-mastery-section">
              <h4 className="text-[13px] font-semibold text-slate-200 m-0 mb-2.5 uppercase tracking-wide">
                {tt(isHi, 'Mastery by concept', 'अवधारणा अनुसार मास्टरी')}
              </h4>
              {report.mastery.by_concept.length === 0 ? (
                <p className="text-[13px] text-slate-500 m-0">
                  {tt(
                    isHi,
                    'No mastery data yet — this student needs to start practicing.',
                    'अभी कोई मास्टरी डेटा नहीं — इस छात्र को अभ्यास शुरू करना होगा।',
                  )}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {report.mastery.by_concept.map((c) => (
                    <div key={c.topic_id} className="flex items-center gap-2.5" data-testid="report-concept-row">
                      <span className="text-[12px] text-slate-300 w-[42%] truncate" title={c.concept}>
                        {c.concept}
                      </span>
                      <div className="flex-1 h-[18px] rounded bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${heatBg(c.mastery_pct)}`}
                          style={{ width: `${Math.max(0, Math.min(100, c.mastery_pct))}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-semibold text-slate-200 w-[40px] text-right tabular-nums">
                        {c.mastery_pct}%
                      </span>
                      <span className="text-[10px] text-slate-500 w-[58px] text-right">
                        {c.attempts} {tt(isHi, 'tries', 'प्रयास')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bloom's distribution — canonical 6 levels; weakest highlighted.
                Bloom's level NAMES are technical terms — NOT translated (P7). */}
            <div data-testid="report-bloom-section">
              <h4 className="text-[13px] font-semibold text-slate-200 m-0 mb-2.5 uppercase tracking-wide">
                {/* "Bloom's" is a technical term — kept verbatim (P7 exception). */}
                {tt(isHi, "Bloom's distribution", "Bloom's वितरण")}
              </h4>
              <div className="flex flex-col gap-1.5">
                {bloomLadder.map((b) => {
                  const isWeakest = weakest === b.level && b.attempted;
                  return (
                    <div
                      key={b.level}
                      data-testid={`bloom-row-${b.level}`}
                      className={`flex items-center gap-2.5 rounded-md py-1 px-2 ${
                        isWeakest ? 'bg-red-500/10 border border-red-500/40' : ''
                      }`}
                    >
                      {/* Bloom level NAME — never translated. */}
                      <span className="text-[12px] font-medium text-slate-200 w-[88px] capitalize">
                        {b.level}
                      </span>
                      <div className="flex-1 h-[16px] rounded bg-slate-800 overflow-hidden">
                        {b.attempted && (
                          <div
                            className={`h-full ${heatBg(b.accuracy_pct)}`}
                            style={{ width: `${Math.max(0, Math.min(100, b.accuracy_pct))}%` }}
                          />
                        )}
                      </div>
                      <span
                        className={`text-[12px] font-semibold w-[40px] text-right tabular-nums ${
                          b.attempted ? 'text-slate-200' : 'text-slate-600'
                        }`}
                      >
                        {b.attempted ? `${b.accuracy_pct}%` : '—'}
                      </span>
                      <span className="text-[10px] text-slate-500 w-[58px] text-right">
                        {b.attempted ? `${b.correct}/${b.total}` : '—'}
                      </span>
                      {isWeakest && (
                        <span
                          data-testid="bloom-weakest-badge"
                          className="text-[9px] font-bold text-red-400 uppercase tracking-wide whitespace-nowrap"
                        >
                          {tt(isHi, 'Weakest', 'सबसे कमज़ोर')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
