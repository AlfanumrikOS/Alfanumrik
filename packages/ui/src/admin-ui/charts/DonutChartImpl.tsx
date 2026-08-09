'use client';

/**
 * Admin UI — DonutChart render body (Recharts).
 *
 * Split out of DonutChart.tsx so `recharts` is reachable only through the
 * `next/dynamic` boundary in the public wrapper. See chart-shared.ts.
 *
 * Render output is byte-identical to the pre-split DonutChart body. The empty
 * check happens in the wrapper (synchronously, without Recharts).
 */

import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART_PALETTE, type DonutChartProps } from './chart-shared';

export default function DonutChartImpl({
  data,
  height = 240,
  innerRadiusPct = 60,
}: DonutChartProps) {
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
