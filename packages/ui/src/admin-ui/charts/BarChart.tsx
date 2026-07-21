'use client';

/**
 * Admin UI — BarChart
 *
 * Thin Recharts wrapper. Same token-driven palette + empty-state fallback
 * as LineChart. Re-imports the canonical `ChartSeries` shape from LineChart
 * so all admin-ui chart consumers see one type.
 */

import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART_PALETTE, type ChartSeries } from './LineChart';

export type { ChartSeries } from './LineChart';

export interface BarChartProps {
  series: ChartSeries[];
  /** xAxis label (optional). */
  xLabel?: string;
  /** yAxis label (optional). */
  yLabel?: string;
  /** Pixel height of the chart (defaults to 240 — Plan 0 dashboard card). */
  height?: number;
  /** Override empty-state copy. */
  emptyLabel?: string;
  /** Stack bars instead of grouping side-by-side. */
  stacked?: boolean;
  /**
   * Optional per-bar fill override — e.g. severity-band colouring (danger/
   * warning/success) instead of the default one-colour-per-series palette.
   * Only applied to single-series charts (the common "one bar per category,
   * coloured by a severity threshold" case). When provided, returns a CSS
   * color/token string for a given data point; return undefined to fall back
   * to the series palette color for that bar. Backward compatible: omitting
   * this prop leaves every existing caller byte-identical.
   */
  pointColor?: (point: { x: string | number; y: number }, seriesIndex: number) => string | undefined;
}

function isEmpty(series: ChartSeries[]): boolean {
  if (!series || series.length === 0) return true;
  return series.every((s) => !s.data || s.data.length === 0);
}

function mergeSeries(series: ChartSeries[]): Array<Record<string, string | number>> {
  const xKeys = new Set<string | number>();
  for (const s of series) {
    for (const point of s.data) xKeys.add(point.x);
  }
  const ordered = Array.from(xKeys);
  return ordered.map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of series) {
      const found = s.data.find((p) => p.x === x);
      if (found) row[s.name] = found.y;
    }
    return row;
  });
}

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

  const data = mergeSeries(series);
  const stackId = stacked ? 'stack-1' : undefined;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3)" />
        <XAxis
          dataKey="x"
          stroke="var(--text-3)"
          tick={{ fill: 'var(--text-3)', fontSize: 12 }}
          label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -4, fill: 'var(--text-3)', fontSize: 12 } : undefined}
        />
        <YAxis
          stroke="var(--text-3)"
          tick={{ fill: 'var(--text-3)', fontSize: 12 }}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-3)', fontSize: 12 } : undefined}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-1)',
          }}
          cursor={{ fill: 'var(--surface-2)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
        {series.map((s, i) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            fill={CHART_PALETTE[i % CHART_PALETTE.length]}
            stackId={stackId}
            isAnimationActive={false}
          >
            {pointColor &&
              s.data.map((point) => (
                <Cell
                  key={`${s.name}-${point.x}`}
                  fill={pointColor(point, i) ?? CHART_PALETTE[i % CHART_PALETTE.length]}
                />
              ))}
          </Bar>
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

export default BarChart;
