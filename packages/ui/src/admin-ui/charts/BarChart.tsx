'use client';

/**
 * Admin UI — BarChart
 *
 * Thin Recharts wrapper. Same token-driven palette + empty-state fallback
 * as LineChart. The canonical `ChartSeries` shape now lives in ./chart-shared
 * (a Recharts-free module) and is re-exported here so every existing consumer
 * import keeps working unchanged.
 *
 * P10 (2026-08-09): the Recharts render body lives in ./BarChartImpl and is
 * loaded through `next/dynamic`. The outer div reserves the full `height` up
 * front, so the chart swapping in causes zero layout shift.
 */

import dynamic from 'next/dynamic';
import { isEmpty, type BarChartProps } from './chart-shared';

export type { ChartSeries, BarChartProps } from './chart-shared';

const BarChartImpl = dynamic(() => import('./BarChartImpl'), {
  ssr: false,
  // Space is reserved by the wrapper div below — no spinner, no copy (any copy
  // here would need a Hindi twin, P7).
  loading: () => null,
});

export function BarChart({
  series,
  xLabel,
  yLabel,
  height = 240,
  emptyLabel = 'No data to display',
  stacked = false,
  pointColor,
}: BarChartProps) {
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
      <BarChartImpl
        series={series}
        xLabel={xLabel}
        yLabel={yLabel}
        height={height}
        stacked={stacked}
        pointColor={pointColor}
      />
    </div>
  );
}

export default BarChart;
