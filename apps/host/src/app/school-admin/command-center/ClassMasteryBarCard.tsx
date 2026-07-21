'use client';

/**
 * ClassMasteryBarCard — Phase 2 Task 2.1. Per-class average-mastery BarChart
 * for the Command Center. Lazy-loaded via next/dynamic from CommandCenter.tsx
 * (P10) exactly like its sibling panels.
 *
 * Data source: the SAME `get_classes_at_risk` rows already fetched for
 * ClassesAtRiskRail — no new API call, no new RPC. Reuses each row's existing
 * `avg_mastery` field (0..1 BKT p_know average) verbatim, rendered as a
 * whole-percent bar. Rows with a null avg_mastery (no mastery signal yet) are
 * excluded from the chart rather than rendered as a misleading 0%.
 *
 * Boundary discipline (frontend): 100% read-only, no mutations, no new
 * business-logic thresholds. Reuses the existing NoDataState/skeleton/error-
 * retry pattern already established by ClassesAtRiskRail/CommandCenter.
 */

import { BarChart, type ChartSeries } from '@alfanumrik/ui/admin-ui/charts';
import type { ClassAtRiskRow } from '@alfanumrik/lib/school-admin/command-center-types';
import { Card } from '@alfanumrik/ui/ui/primitives';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface ClassMasteryBarCardProps {
  rows: ClassAtRiskRow[];
  loading: boolean;
  error: boolean;
  isHi: boolean;
  onRetry: () => void;
}

export default function ClassMasteryBarCard({
  rows,
  loading,
  error,
  isHi,
  onRetry,
}: ClassMasteryBarCardProps) {
  const series: ChartSeries[] = [
    {
      name: tt(isHi, 'Avg mastery %', 'औसत महारत %'),
      data: rows
        .filter((row) => row.avg_mastery != null)
        .map((row) => ({ x: row.class_name, y: Math.round((row.avg_mastery as number) * 100) })),
    },
  ];

  return (
    <Card
      variant="elevated"
      aria-label={tt(isHi, 'Class average mastery', 'कक्षा औसत महारत')}
      className="p-4"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
          {tt(isHi, 'Class average mastery', 'कक्षा औसत महारत')}
        </h3>
      </header>

      {loading ? (
        <div
          className="rounded-xl bg-[var(--surface-2)] animate-pulse"
          style={{ height: 240 }}
          aria-hidden="true"
        />
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--text-2)] mb-3">
            {tt(
              isHi,
              "Couldn't load class mastery.",
              'कक्षा महारत लोड नहीं हो सकी।',
            )}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[var(--purple,#7C3AED)] active:scale-95 transition-transform min-h-[44px]"
          >
            {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </button>
        </div>
      ) : (
        <BarChart
          series={series}
          yLabel={tt(isHi, 'Mastery %', 'महारत %')}
          height={240}
          emptyLabel={tt(isHi, 'No class mastery data yet', 'अभी कोई कक्षा महारत डेटा नहीं')}
        />
      )}
    </Card>
  );
}
