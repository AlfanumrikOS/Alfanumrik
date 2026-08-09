'use client';

/**
 * Admin UI — LineChart
 *
 * Thin Recharts wrapper used by /super-admin, /school-admin (and later
 * /teacher, /parent) dashboards. All colors come from the existing CSS-
 * variable palette in tailwind.config.js + globals.css so the chart
 * automatically respects light/dark + school theme overrides.
 *
 * - Renders an empty-state fallback (token-driven muted text) when data is
 *   empty, missing, or has zero series. That path is SYNCHRONOUS and never
 *   loads Recharts.
 * - Series colors are pulled from CHART_PALETTE (var(--primary)/--secondary
 *   /--success/--warning/--info/--danger) and cycle for >6 series.
 * - Height defaults to 240px to fit Plan 0 dashboard cards. Width fills the
 *   parent via ResponsiveContainer.
 *
 * P10 (2026-08-09): the Recharts render body lives in ./LineChartImpl and is
 * loaded through `next/dynamic`, so the ~94.5 kB gzipped Recharts chunk is no
 * longer on the eager first-load graph of every route that touches the
 * `admin-ui` barrel. The outer div reserves the full `height` up front, so the
 * chart swapping in causes zero layout shift.
 *
 * The `ChartSeries` type and `CHART_PALETTE` now live in ./chart-shared (a
 * Recharts-free module) and are re-exported here so the public import surface
 * is unchanged for every existing consumer.
 */

import dynamic from 'next/dynamic';
import { isEmpty, type LineChartProps } from './chart-shared';

export { CHART_PALETTE } from './chart-shared';
export type { ChartSeries, LineChartProps } from './chart-shared';

const LineChartImpl = dynamic(() => import('./LineChartImpl'), {
  ssr: false,
  // Space is reserved by the wrapper div below, so the placeholder is empty on
  // purpose: no spinner, no copy (any copy here would need a Hindi twin, P7).
  loading: () => null,
});

export function LineChart({
  series,
  xLabel,
  yLabel,
  height = 240,
  emptyLabel = 'No data to display',
}: LineChartProps) {
  if (isEmpty(series)) {
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
      <LineChartImpl series={series} xLabel={xLabel} yLabel={yLabel} height={height} />
    </div>
  );
}

export default LineChart;
