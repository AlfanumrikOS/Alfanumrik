'use client';

/**
 * Admin UI — DonutChart
 *
 * Thin Recharts wrapper for single-series share-of-total visualizations
 * (e.g. plan mix, status breakdown, mastery buckets). Token-driven palette
 * + empty-state fallback identical to LineChart/BarChart.
 *
 * Donut data is flat (not series-shaped) since each slice is a category.
 *
 * P10 (2026-08-09): the Recharts render body lives in ./DonutChartImpl and is
 * loaded through `next/dynamic`. The outer div reserves the full `height` up
 * front, so the chart swapping in causes zero layout shift.
 */

import dynamic from 'next/dynamic';
import { isDonutEmpty, type DonutChartProps } from './chart-shared';

export type { DonutSlice, DonutChartProps } from './chart-shared';

const DonutChartImpl = dynamic(() => import('./DonutChartImpl'), {
  ssr: false,
  // Space is reserved by the wrapper div below — no spinner, no copy (any copy
  // here would need a Hindi twin, P7).
  loading: () => null,
});

export function DonutChart({
  data,
  height = 240,
  emptyLabel = 'No data to display',
  innerRadiusPct = 60,
}: DonutChartProps) {
  if (isDonutEmpty(data)) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
        role="status"
        aria-label={emptyLabel}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <DonutChartImpl data={data} height={height} innerRadiusPct={innerRadiusPct} />
    </div>
  );
}

export default DonutChart;
