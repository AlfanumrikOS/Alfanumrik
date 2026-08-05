'use client';

/**
 * MemoryLayerCard — presentational section card for the student memory screen
 * ("What Foxy remembers about me", Foxy North-Star Phase 1).
 *
 * One card per memory layer (cognitive / monthly summary / preferences).
 * Purely presentational: the page resolves all bilingual strings (P7) before
 * passing them in.
 */

import type { ReactNode } from 'react';

export interface MemoryLayerCardProps {
  icon: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Optional footer slot (e.g. the per-layer erase button). */
  footer?: ReactNode;
}

export default function MemoryLayerCard({ icon, title, subtitle, children, footer }: MemoryLayerCardProps) {
  return (
    <section
      aria-label={title}
      className="rounded-2xl p-4 mb-4"
      style={{
        background: 'var(--surface-1, #fff)',
        border: '1px solid var(--border, #E5E0D8)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl leading-none" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h2
            className="text-sm font-bold"
            style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{subtitle}</p>
          )}
        </div>
      </div>
      <div>{children}</div>
      {footer && <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border, #E5E0D8)' }}>{footer}</div>}
    </section>
  );
}

/** Small rounded topic/concept chip used inside memory layer cards. */
export function MemoryChip({ label, tone = 'neutral' }: { label: string; tone?: 'positive' | 'building' | 'neutral' }) {
  const styles: Record<string, React.CSSProperties> = {
    positive: { background: 'rgba(22,163,74,0.1)', color: '#16A34A' },
    building: { background: 'rgba(245,166,35,0.12)', color: '#B45309' },
    neutral: { background: 'var(--surface-2, #F4F0E9)', color: 'var(--text-2, #4A4335)' },
  };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold mr-1.5 mb-1.5"
      style={styles[tone]}
    >
      {label}
    </span>
  );
}
