'use client';

/**
 * Admin UI — BarChart render body (Recharts).
 *
 * Split out of BarChart.tsx so `recharts` is reachable only through the
 * `next/dynamic` boundary in the public wrapper. See chart-shared.ts.
 *
 * Render output is byte-identical to the pre-split BarChart body. The empty
 * check happens in the wrapper (synchronously, without Recharts).
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
import { CHART_PALETTE, mergeSeries, type BarChartProps } from './chart-shared';

export default function BarChartImpl({
  series,
  xLabel,
  yLabel,
  height = 240,
  stacked = false,
  pointColor,
}: BarChartProps) {
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
