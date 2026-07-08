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
import { BLOOM_LEVEL_ORDER } from '@alfanumrik/lib/types';
import type { StudentMasteryReport as StudentMasteryReportData } from '@alfanumrik/lib/types';
import { heatColorClass } from '@alfanumrik/lib/teacher/heat-scale';
import { StatusBadge } from '@alfanumrik/ui/admin-ui/StatusBadge';
import { Button } from '@alfanumrik/ui/ui/primitives';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

/**
 * Heat colour for a 0–100 mastery/accuracy percent. The shared heat scale
 * (`heatColorClass`) takes a 0..1 fraction, so we divide by 100 before
 * delegating — the unified Atlas band thresholds are the single source of truth.
 */
function heatBg(pct: number): string {
  return heatColorClass(pct / 100);
}

/** Recent-performance stat tile (Atlas warm-cream). */
function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      className="rounded-xl py-3 px-3.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <p className="text-[12px] m-0 uppercase tracking-wide font-semibold" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-[22px] font-extrabold mt-1" style={{ color }}>{value}</p>
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
  // Wave D — "Share with parent" (flag-gated by the parent CommandCenter). When
  // `parentCommsEnabled` is false the button is NOT rendered and
  // `onShareWithParent` is never wired, so flag-OFF stays byte-identical to
  // Wave C. The button optimistically disables (spinner) via `shareWithParentBusy`
  // and collapses to a "Shared ✓" chip via `shareWithParentDone` (idempotent-safe).
  parentCommsEnabled = false,
  onShareWithParent,
  shareWithParentBusy = false,
  shareWithParentDone = false,
}: {
  report: StudentMasteryReportData | null;
  loading: boolean;
  error: boolean;
  exporting: boolean;
  isHi: boolean;
  onExport: () => void;
  onRetry: () => void;
  onClose: () => void;
  parentCommsEnabled?: boolean;
  onShareWithParent?: () => void;
  shareWithParentBusy?: boolean;
  shareWithParentDone?: boolean;
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
    <div
      className="rounded-2xl px-5 py-[18px]"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
      data-testid="student-mastery-report"
    >
      <div className="flex justify-between items-center">
        <h3 className="text-[16px] font-bold m-0 font-heading" style={{ color: 'var(--text-1)' }}>
          {tt(isHi, 'Student mastery report', 'छात्र मास्टरी रिपोर्ट')}
        </h3>
        <div className="flex items-center gap-2">
          {/* Wave D — "Share with parent" (flag-gated). Only when a report is
              loaded and the parent-comms flag is ON. Server owns thread/message
              creation; this button only triggers the parent CommandCenter's POST. */}
          {parentCommsEnabled && report && !loading && !error &&
            (shareWithParentDone ? (
              <span data-testid="report-share-parent-done">
                <StatusBadge
                  label={`✓ ${tt(isHi, 'Shared with parent', 'अभिभावक के साथ साझा किया')}`}
                  variant="info"
                />
              </span>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onShareWithParent}
                disabled={shareWithParentBusy}
                data-testid="report-share-parent-btn"
              >
                {shareWithParentBusy
                  ? tt(isHi, 'Sending…', 'भेजा जा रहा है…')
                  : tt(isHi, 'Share with parent', 'अभिभावक के साथ साझा करें')}
              </Button>
            ))}
          {report && !loading && !error && (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              data-testid="report-export-btn"
              className="py-1 px-2.5 border-none rounded-md text-[12px] font-semibold cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--success)', color: 'white' }}
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
            className="py-1 px-2.5 bg-transparent rounded-md text-[12px] font-semibold cursor-pointer hover:border-primary"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            {tt(isHi, 'Close', 'बंद करें')}
          </button>
        </div>
      </div>

      <div className="mt-3.5">
        {loading ? (
          // Loading
          <div
            className="h-48 rounded-lg animate-pulse motion-reduce:animate-none"
            style={{ background: 'var(--surface-2)' }}
            aria-hidden="true"
          />
        ) : error ? (
          // Error
          <div className="text-center py-8" style={{ color: 'var(--text-3)' }} data-testid="report-error">
            <div className="text-3xl mb-3">&#x1F615;</div>
            <p className="text-[14px] font-semibold mb-3" style={{ color: 'var(--text-2)' }}>
              {tt(isHi, "Couldn't load the report", 'रिपोर्ट लोड नहीं हो सकी')}
            </p>
            <Button type="button" variant="primary" size="sm" onClick={onRetry}>
              {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
            </Button>
          </div>
        ) : !report ? null : (
          <div className="flex flex-col gap-5">
            {/* Header: name + grade */}
            <div>
              <p className="text-[16px] font-bold m-0" style={{ color: 'var(--text-1)' }}>{report.student_name}</p>
              <p className="text-[12px] m-0" style={{ color: 'var(--text-3)' }}>
                {tt(isHi, 'Grade', 'कक्षा')} {report.grade || '—'}
              </p>
            </div>

            {/* Recent performance */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatTile
                label={tt(isHi, 'Overall mastery', 'कुल मास्टरी')}
                value={`${report.mastery.overall_pct}%`}
                color="var(--purple)"
              />
              <StatTile
                label={tt(isHi, 'Quizzes', 'क्विज़')}
                value={report.recent.quizzes}
                color="var(--purple)"
              />
              <StatTile
                label={tt(isHi, 'Avg score', 'औसत स्कोर')}
                value={`${report.recent.avg_score}%`}
                color="var(--info)"
              />
              <StatTile
                label={tt(isHi, 'Streak', 'स्ट्रीक')}
                value={report.recent.streak}
                color="var(--success)"
              />
            </div>

            {/* Mastery by concept */}
            <div data-testid="report-mastery-section">
              <h4 className="text-[13px] font-bold m-0 mb-2.5 uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
                {tt(isHi, 'Mastery by concept', 'अवधारणा अनुसार मास्टरी')}
              </h4>
              {report.mastery.by_concept.length === 0 ? (
                <p className="text-[13px] m-0" style={{ color: 'var(--text-3)' }}>
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
                      <span className="text-[12px] w-[42%] truncate" style={{ color: 'var(--text-2)' }} title={c.concept}>
                        {c.concept}
                      </span>
                      <div className="flex-1 h-[18px] rounded overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className={`h-full ${heatBg(c.mastery_pct)}`}
                          style={{ width: `${Math.max(0, Math.min(100, c.mastery_pct))}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-bold w-[40px] text-right tabular-nums" style={{ color: 'var(--text-1)' }}>
                        {c.mastery_pct}%
                      </span>
                      <span className="text-[12px] w-[58px] text-right" style={{ color: 'var(--text-3)' }}>
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
              <h4 className="text-[13px] font-bold m-0 mb-2.5 uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
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
                      className="flex items-center gap-2.5 rounded-md py-1 px-2"
                      style={
                        isWeakest
                          ? {
                              background: 'var(--danger-light)',
                              border: '1px solid var(--danger)',
                            }
                          : undefined
                      }
                    >
                      {/* Bloom level NAME — never translated. */}
                      <span className="text-[12px] font-semibold w-[88px] capitalize" style={{ color: 'var(--text-1)' }}>
                        {b.level}
                      </span>
                      <div className="flex-1 h-[16px] rounded overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        {b.attempted && (
                          <div
                            className={`h-full ${heatBg(b.accuracy_pct)}`}
                            style={{ width: `${Math.max(0, Math.min(100, b.accuracy_pct))}%` }}
                          />
                        )}
                      </div>
                      <span
                        className="text-[12px] font-bold w-[40px] text-right tabular-nums"
                        style={{ color: b.attempted ? 'var(--text-1)' : 'var(--text-3)' }}
                      >
                        {b.attempted ? `${b.accuracy_pct}%` : '—'}
                      </span>
                      <span className="text-[12px] w-[58px] text-right" style={{ color: 'var(--text-3)' }}>
                        {b.attempted ? `${b.correct}/${b.total}` : '—'}
                      </span>
                      {isWeakest && (
                        <span
                          data-testid="bloom-weakest-badge"
                          className="text-[12px] font-bold uppercase tracking-wide whitespace-nowrap"
                          style={{ color: 'var(--danger)' }}
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
