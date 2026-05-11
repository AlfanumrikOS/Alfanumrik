/**
 * AtlasSpark — sparkline SVG used in KPI tiles and trend cards.
 *
 * Two modes:
 *   - inline (default): renders an inline SVG sized by width/height props.
 *   - flush: pinned to the bottom of a containing card; expects a positioned
 *     parent. Used inside AtlasKpi where the spark hugs the card's lower edge.
 *
 * Stroke colour comes from the `tone` prop and resolves to a CSS var so
 * dark/light theme would Just Work (we ship light-only today, but the
 * indirection is cheap).
 */

import type { CSSProperties } from 'react';
import { clsx } from 'clsx';

export interface AtlasSparkProps {
  /** Numeric series. Plotted left-to-right; min/max auto-scaled. */
  values: number[];
  tone?: 'accent' | 'teal' | 'green' | 'gold' | 'red' | 'ink';
  /** Render as a flush bottom-edge spark (for KPI cards). */
  flush?: boolean;
  /** Show a small fill under the line. Default true. */
  filled?: boolean;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

const TONE: Record<NonNullable<AtlasSparkProps['tone']>, string> = {
  accent: '#E8581C',
  teal:   '#0F2A2E',
  green:  '#1F7A4C',
  gold:   '#C9831A',
  red:    '#C32E2E',
  ink:    '#1A1207',
};

export function AtlasSpark({
  values,
  tone = 'accent',
  flush = false,
  filled = true,
  width = 200,
  height = 38,
  className,
  ariaLabel,
}: AtlasSparkProps) {
  if (!values.length) return null;

  const stroke = TONE[tone];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 4;
  const innerH = height - pad * 2;

  // Build polyline string (linear interpolation, no smoothing — fine at this size).
  const pts = values
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' L ');

  const linePath = `M ${pts}`;
  const fillPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const gradId = `atlas-spark-${tone}-${Math.random().toString(36).slice(2, 8)}`;

  const containerStyle: CSSProperties = flush
    ? { position: 'absolute', insetInline: 0, bottom: 0, height, pointerEvents: 'none' }
    : { display: 'block' };

  return (
    <svg
      className={clsx('atlas-spark', className)}
      role="img"
      aria-label={ariaLabel ?? 'Trend sparkline'}
      width={flush ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={containerStyle}
    >
      {filled && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={fillPath} fill={`url(#${gradId})`} />
        </>
      )}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default AtlasSpark;
