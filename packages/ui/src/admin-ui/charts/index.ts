// Admin UI — Charts subdirectory barrel.
//
// Token-driven Recharts wrappers shared by /super-admin, /school-admin
// (and later /teacher, /parent) dashboards. Each wrapper:
//   - Pulls colors from the existing CSS-variable palette
//     (var(--primary)/--secondary/--success/--warning/--info/--danger).
//   - Renders an empty-state fallback when data is missing or empty.
//   - Animates off (admin dashboards refresh frequently — animation churn
//     is distracting + bad for low-end Indian hardware).
//
// The canonical `ChartSeries` shape lives in LineChart.tsx and is re-
// exported by BarChart.tsx — keep that single source of truth.

export { LineChart, CHART_PALETTE } from './LineChart';
export type { ChartSeries, LineChartProps } from './LineChart';

export { BarChart } from './BarChart';
export type { BarChartProps } from './BarChart';

export { DonutChart } from './DonutChart';
export type { DonutSlice, DonutChartProps } from './DonutChart';
