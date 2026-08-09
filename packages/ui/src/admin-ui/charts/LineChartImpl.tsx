'use client';

/**
 * Admin UI — LineChart render body (Recharts).
 *
 * Split out of LineChart.tsx so `recharts` is reachable only through the
 * `next/dynamic` boundary in the public wrapper. Never import this file
 * statically from anything on a page's eager path — see chart-shared.ts for
 * the measured reason.
 *
 * Render output is byte-identical to the pre-split LineChart body. The empty
 * check happens in the wrapper (synchronously, without Recharts), so this
 * component is only ever mounted with non-empty series.
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
import { CHART_PALETTE, mergeSeries, type LineChartProps } from './chart-shared';

export default function LineChartImpl({
  series,
  xLabel,
  yLabel,
  height = 240,
}: LineChartProps) {
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
