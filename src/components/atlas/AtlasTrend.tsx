/**
 * AtlasTrend — full-width trend chart used on parent + school surfaces.
 *
 * Bigger sibling of AtlasSpark: includes baseline grid lines, an end-point
 * dot, optional x-axis labels, and a filled area underneath.
 *
 * Layout: render inside an AtlasCard for the chrome.
 */

import { useMemo } from 'react';
import { clsx } from 'clsx';

export interface AtlasTrendPoint {
  value: number;
  label?: string;
}

export interface AtlasTrendProps {
  points: AtlasTrendPoint[];
  tone?: 'accent' | 'teal';
  /** Render height. Default 120. */
  height?: number;
  /** Render width via viewBox. Default 600. */
  width?: number;
  /** Show 3 light grid lines. Default true. */
  grid?: boolean;
  className?: string;
  ariaLabel?: string;
}

const TONE: Record<NonNullable<AtlasTrendProps['tone']>, { stroke: string; fillId: string }> = {
  accent: { stroke: '#E8581C', fillId: 'atlas-trend-accent' },
  teal:   { stroke: '#0F2A2E', fillId: 'atlas-trend-teal' },
};

export function AtlasTrend({
  points,
  tone = 'accent',
  height = 120,
  width = 600,
  grid = true,
  className,
  ariaLabel,
}: AtlasTrendProps) {
  const labels = useMemo(() => points.map(p => p.label).filter(Boolean) as string[], [points]);

  if (!points.length) return null;

  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const pad = 12;
  const innerH = height - pad * 2;

  const pts = values
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + innerH - ((v - min) / range) * innerH;
      return { x, y };
    });

  const linePath = `M ${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`;
  const fillPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg
      className={clsx(className)}
      role="img"
      aria-label={ariaLabel ?? 'Trend chart'}
      viewBox={`0 0 ${width} ${height + (labels.length ? 18 : 0)}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
    >
      <defs>
        <linearGradient id={TONE[tone].fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={TONE[tone].stroke} stopOpacity={0.18} />
          <stop offset="100%" stopColor={TONE[tone].stroke} stopOpacity={0} />
        </linearGradient>
      </defs>

      {grid && (
        <g stroke="rgba(26,18,7,0.05)" strokeWidth={1}>
          <line x1={0} y1={height * 0.25} x2={width} y2={height * 0.25} />
          <line x1={0} y1={height * 0.5}  x2={width} y2={height * 0.5} />
          <line x1={0} y1={height * 0.75} x2={width} y2={height * 0.75} />
        </g>
      )}

      <path d={fillPath} fill={`url(#${TONE[tone].fillId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={TONE[tone].stroke}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last && (
        <>
          <circle cx={last.x} cy={last.y} r={9} fill={TONE[tone].stroke} fillOpacity={0.2} />
          <circle cx={last.x} cy={last.y} r={5} fill={TONE[tone].stroke} />
        </>
      )}

      {labels.length > 0 && (
        <g fontFamily="var(--font-display)" fontSize={10} fill="var(--ink-4)">
          <text x={0} y={height + 14}>{labels[0]}</text>
          {labels.length > 2 && (
            <text x={width / 2} y={height + 14} textAnchor="middle">
              {labels[Math.floor(labels.length / 2)]}
            </text>
          )}
          <text x={width} y={height + 14} textAnchor="end">{labels[labels.length - 1]}</text>
        </g>
      )}
    </svg>
  );
}

export default AtlasTrend;
