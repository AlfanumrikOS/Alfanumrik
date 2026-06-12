'use client';

// src/components/pulse/PulseMasterySummary.tsx
//
// The mastery rollup: strengths vs at-risk subjects + a per-subject bar with the
// at-risk chapter count. All values are read verbatim from the frozen contract
// (`PulseResponse.masterySummary`) — strengths/atRisk are subject CODES the
// server already chose; `meanMastery` is a 0..1 fraction; `atRiskChapterCount`
// is a count. This component computes NO mastery math (assessment owns it).
//
// P7 bilingual via `isHi`. Subject codes are NOT translated (they are
// curriculum identifiers, shown as-is); only surrounding copy is bilingual.

import type { MasterySummary } from '@/lib/pulse/types';
import { tp, masteryPct } from './pulse-copy';

interface PulseMasterySummaryProps {
  masterySummary: MasterySummary;
  isHi: boolean;
}

function masteryColor(mean: number | null): string {
  if (mean == null || !Number.isFinite(mean)) return '#64748B';
  if (mean < 0.4) return '#DC2626'; // at-risk line (platform 0.4 convention)
  if (mean < 0.7) return '#F59E0B';
  return '#16A34A';
}

function SubjectPills({
  codes,
  color,
  emptyLabel,
}: {
  codes: string[];
  color: string;
  emptyLabel: string;
}) {
  if (codes.length === 0) {
    return <span className="text-xs text-[var(--text-3)]">{emptyLabel}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((code) => (
        <span
          key={code}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize"
          style={{ background: `${color}14`, border: `1px solid ${color}33`, color }}
        >
          {code}
        </span>
      ))}
    </div>
  );
}

export default function PulseMasterySummary({
  masterySummary,
  isHi,
}: PulseMasterySummaryProps) {
  const { bySubject, strengths, atRisk, totalAtRiskChapters } = masterySummary;

  const hasAnySubject = bySubject.length > 0;

  return (
    <div className="space-y-3">
      {/* Strengths vs At-risk split */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ background: '#16A34A0F', border: '1px solid #16A34A2E' }}
        >
          <div className="text-[11px] font-bold mb-1.5" style={{ color: '#16A34A' }}>
            <span aria-hidden="true">💪</span> {tp(isHi, 'Strengths', 'मज़बूत पक्ष')}
          </div>
          <SubjectPills
            codes={strengths}
            color="#16A34A"
            emptyLabel={tp(isHi, 'Building up', 'अभी बन रहा है')}
          />
        </div>
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ background: '#DC26260F', border: '1px solid #DC26262E' }}
        >
          <div className="text-[11px] font-bold mb-1.5" style={{ color: '#DC2626' }}>
            <span aria-hidden="true">🎯</span> {tp(isHi, 'Needs work', 'सुधार चाहिए')}
          </div>
          <SubjectPills
            codes={atRisk}
            color="#DC2626"
            emptyLabel={tp(isHi, 'Nothing at risk', 'कुछ जोखिम में नहीं')}
          />
        </div>
      </div>

      {/* Total at-risk chapters headline */}
      <div className="flex items-center justify-between rounded-xl px-3 py-2"
        style={{ background: 'var(--surface-2, #f8fafc)' }}
      >
        <span className="text-xs text-[var(--text-2)]">
          {tp(isHi, 'Chapters needing revision', 'दोहराने लायक अध्याय')}
        </span>
        <span
          className="text-sm font-bold tabular-nums"
          style={{ color: totalAtRiskChapters > 0 ? '#DC2626' : '#16A34A' }}
        >
          {totalAtRiskChapters}
        </span>
      </div>

      {/* Per-subject bars */}
      {hasAnySubject ? (
        <ul className="space-y-2" aria-label={tp(isHi, 'Subject mastery', 'विषयवार महारत')}>
          {bySubject.map((s) => {
            const pct =
              s.meanMastery != null && Number.isFinite(s.meanMastery)
                ? Math.round(s.meanMastery * 100)
                : 0;
            const color = masteryColor(s.meanMastery);
            return (
              <li key={s.subject}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[var(--text-1)] capitalize">
                    {s.subject}
                  </span>
                  <span className="text-[11px] text-[var(--text-3)]">
                    {masteryPct(s.meanMastery)}
                    {s.atRiskChapterCount > 0 && (
                      <span style={{ color: '#DC2626' }}>
                        {' · '}
                        {tp(
                          isHi,
                          `${s.atRiskChapterCount} at risk`,
                          `${s.atRiskChapterCount} जोखिम में`,
                        )}
                      </span>
                    )}
                  </span>
                </div>
                <div
                  className="w-full rounded-full overflow-hidden"
                  style={{ height: 6, background: 'var(--surface-2, #eef2f6)' }}
                  role="img"
                  aria-label={
                    isHi
                      ? `${s.subject}: ${pct} प्रतिशत महारत`
                      : `${s.subject}: ${pct} percent mastery`
                  }
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: color, transition: 'width 0.5s ease' }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-[var(--text-3)] text-center py-2">
          {tp(isHi, 'No mastery readings yet', 'अभी कोई महारत रीडिंग नहीं')}
        </p>
      )}
    </div>
  );
}
