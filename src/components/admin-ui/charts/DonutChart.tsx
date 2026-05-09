'use client';

/**
 * Admin UI — DonutChart
 *
 * Thin Recharts wrapper for single-series share-of-total visualizations
 * (e.g. plan mix, status breakdown, mastery buckets). Token-driven palette
 * + empty-state fallback identical to LineChart/BarChart.
 *
 * Donut data is flat (not series-shaped) since each slice is a category.
 */

import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART_PALETTE } from './LineChart';

export interface DonutSlice {
  /** Display name (used in legend + tooltip). */
  name: string;
  /** Slice value — share is computed against the sum. */
  value: number;
}

export interface DonutChartProps {
  data: DonutSlice[];
  /** Pixel height of the chart (defaults to 240). */
  height?: number;
  /** Override empty-state copy. */
  emptyLabel?: string;
  /** Inner radius (% of outer) — controls donut hole size. Defaults 60%. */
  innerRadiusPct?: number;
}

function isEmpty(data: DonutSlice[]): boolean {
  if (!data || data.length === 0) return true;
  // All-zero values render an invisible chart — treat as empty.
  return data.every((d) => !d.value || d.value <= 0);
}

export function DonutChart({
  data,
  height = 240,
  emptyLabel = 'No data to display',
  innerRadiusPct = 60,
}: DonutChartProps) {
  if (isEmpty(data)) {
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
    <ResponsiveContainer width="100%" height={height}>
      <RechartsPieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={`${innerRadiusPct}%`}
          outerRadius="80%"
          paddingAngle={2}
          isAnimationActive={false}
        >
          {data.map((slice, i) => (
            <Cell
              key={slice.name}
              fill={CHART_PALETTE[i % CHART_PALETTE.length]}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-1)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}

export default DonutChart;
