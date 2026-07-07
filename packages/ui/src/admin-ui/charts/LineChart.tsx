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
 *   empty, missing, or has zero series.
 * - Series colors are pulled from CHART_PALETTE (var(--primary)/--secondary
 *   /--success/--warning/--info/--danger) and cycle for >6 series.
 * - Height defaults to 240px to fit Plan 0 dashboard cards. Width fills the
 *   parent via ResponsiveContainer.
 *
 * The `ChartSeries` type is the canonical chart-data shape and is also
 * imported by BarChart.tsx — keep it exported here.
 */

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/** A single chart series — name + ordered data points. */
export interface ChartSeries {
  /** Display name (used in legend + tooltip). */
  name: string;
  /** Ordered data points. `x` is the category/time axis, `y` is the value. */
  data: Array<{ x: string | number; y: number }>;
}

/** Token-driven palette. Cycles for >6 series. */
export const CHART_PALETTE = [
  'var(--primary)',
  'var(--secondary)',
  'var(--success)',
  'var(--warning)',
  'var(--info)',
  'var(--danger)',
] as const;

export interface LineChartProps {
  series: ChartSeries[];
  /** xAxis label (optional). */
  xLabel?: string;
  /** yAxis label (optional). */
  yLabel?: string;
  /** Pixel height of the chart (defaults to 240 — Plan 0 dashboard card). */
  height?: number;
  /** Override empty-state copy. */
  emptyLabel?: string;
}

function isEmpty(series: ChartSeries[]): boolean {
  if (!series || series.length === 0) return true;
  return series.every((s) => !s.data || s.data.length === 0);
}

/**
 * Recharts expects a single flat array of points keyed by series name. We
 * merge our `series[]` shape into that on every render — cheap for the data
 * sizes admin dashboards see (<= ~500 points / chart).
 */
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

  const data = mergeSeries(series);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
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
        />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

export default LineChart;
