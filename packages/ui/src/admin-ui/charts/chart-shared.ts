/**
 * Admin UI — chart shapes, palette and pure helpers.
 *
 * DELIBERATELY RECHARTS-FREE. This module is the static half of the chart
 * wrappers: types, the token palette, and the emptiness/merge helpers that
 * decide whether Recharts is needed at all. LineChart/BarChart/DonutChart
 * import it eagerly and defer the Recharts render body (`*Impl.tsx`) behind
 * `next/dynamic`.
 *
 * WHY (P10, measured 2026-08-09): `admin-ui/index.ts` does
 * `export * from './charts'`, so the single 94.5 kB gzipped Recharts chunk sat
 * in the eager client graph of 101 of 209 routes — exactly the 101 routes over
 * the 260 kB per-page cap — including student-facing `/progress` and
 * `/leaderboard`. Nothing may statically import 'recharts' from this file or
 * from the three public wrappers, or that regresses.
 *
 * No 'use client' directive on purpose: this file exports only types, a frozen
 * palette and pure functions, so it must stay importable from both server and
 * client graphs.
 */

/** A single chart series — name + ordered data points. */
export interface ChartSeries {
  /** Display name (used in legend + tooltip). */
  name: string;
  /** Ordered data points. `x` is the category/time axis, `y` is the value. */
  data: Array<{ x: string | number; y: number }>;
}

/** A single donut slice — donut data is flat, not series-shaped. */
export interface DonutSlice {
  /** Display name (used in legend + tooltip). */
  name: string;
  /** Slice value — share is computed against the sum. */
  value: number;
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

export interface DonutChartProps {
  data: DonutSlice[];
  /** Pixel height of the chart (defaults to 240). */
  height?: number;
  /** Override empty-state copy. */
  emptyLabel?: string;
  /** Inner radius (% of outer) — controls donut hole size. Defaults 60%. */
  innerRadiusPct?: number;
}

/** True when there is nothing worth charting (no series, or every series empty). */
export function isEmpty(series: ChartSeries[]): boolean {
  if (!series || series.length === 0) return true;
  return series.every((s) => !s.data || s.data.length === 0);
}

/** True when donut data is missing, empty, or entirely non-positive. */
export function isDonutEmpty(data: DonutSlice[]): boolean {
  if (!data || data.length === 0) return true;
  // All-zero values render an invisible chart — treat as empty.
  return data.every((d) => !d.value || d.value <= 0);
}

/**
 * Recharts expects a single flat array of points keyed by series name. We
 * merge our `series[]` shape into that on every render — cheap for the data
 * sizes admin dashboards see (<= ~500 points / chart).
 */
export function mergeSeries(series: ChartSeries[]): Array<Record<string, string | number>> {
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
