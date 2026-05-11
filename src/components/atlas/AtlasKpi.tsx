/**
 * AtlasKpi — the school-admin KPI tile. One number, one delta line, one spark.
 *
 * Composition pattern: <AtlasKpi label value delta sparkValues />
 *   - `value` is rendered in Fraunces 44px with tabular nums.
 *   - `delta` colour-codes the change marker (↑/↓) and label.
 *   - `sparkValues` powers the flush sparkline at the bottom edge.
 *
 * Designed for the 4-up KPI row but renders fine 1-up or 2-up.
 */

import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AtlasIcon } from './AtlasIcon';
import { AtlasSpark } from './AtlasSpark';

export interface AtlasKpiProps {
  label: string;
  value: ReactNode;
  /** Optional trailing unit (e.g. %), rendered smaller alongside the value. */
  suffix?: string;
  delta?: {
    direction: 'up' | 'down' | 'flat';
    label: string;
  };
  sparkValues?: number[];
  sparkTone?: 'accent' | 'teal' | 'green' | 'gold' | 'red' | 'ink';
  className?: string;
}

export function AtlasKpi({
  label,
  value,
  suffix,
  delta,
  sparkValues,
  sparkTone = 'accent',
  className,
}: AtlasKpiProps) {
  return (
    <div
      className={clsx('atlas-card', className)}
      style={{ padding: '22px 24px 18px', position: 'relative', overflow: 'hidden' }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>

      <div
        className="atlas-tabnum"
        style={{
          fontFamily: 'var(--font-serif)',
          fontWeight: 500,
          fontSize: 44,
          lineHeight: 1,
          letterSpacing: '-0.025em',
          color: 'var(--ink)',
        }}
      >
        {value}
        {suffix && (
          <span style={{ fontSize: 18, color: 'var(--ink-3)', marginLeft: 2 }}>{suffix}</span>
        )}
      </div>

      {delta && (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            color: 'var(--ink-3)',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <strong
            style={{
              fontWeight: 700,
              color:
                delta.direction === 'up'
                  ? '#1F7A4C'
                  : delta.direction === 'down'
                    ? '#C32E2E'
                    : 'var(--ink-3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {delta.direction !== 'flat' && (
              <AtlasIcon
                name={delta.direction === 'up' ? 'arrow-up' : 'arrow-down'}
                size={12}
                strokeWidth={2}
              />
            )}
            {delta.label}
          </strong>
        </div>
      )}

      {sparkValues && sparkValues.length > 0 && (
        <AtlasSpark
          values={sparkValues}
          tone={sparkTone}
          flush
          filled={false}
          ariaLabel={`${label} trend sparkline`}
        />
      )}
    </div>
  );
}

export default AtlasKpi;
