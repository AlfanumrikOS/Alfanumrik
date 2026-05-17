'use client';

import type { ReactNode } from 'react';

/**
 * Phase H.2 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * Renders an explicit "no data yet" state instead of letting a page silently
 * render zero / empty values that look like a healthy system. Used by routes
 * whose backing instrumentation table is missing or empty (e.g. SLA dashboard
 * before `school_slo` ships, white-label health column before synthetic
 * monitor schedule, Sentry-degraded health page, alerts before any rules
 * configured).
 *
 * Variants:
 *   - `table_missing` (red)  — schema migration hasn't shipped yet
 *   - `no_data`       (yellow) — table exists but is empty / not collected
 *   - `partial`       (blue)  — some data but key dimension absent
 *   - `pending_instrumentation` (gray) — code path exists but the emitter
 *                                        hasn't been wired up yet
 */

export type NoDataStateReason =
  | 'table_missing'
  | 'no_data'
  | 'partial'
  | 'pending_instrumentation'
  | 'unknown';

export interface NoDataStateProps {
  /** Machine-readable cause; drives colour + default copy. */
  reason: NoDataStateReason;
  /** Optional title override. Defaults derived from reason. */
  title?: string;
  /** Human-readable explanation. Defaults derived from reason. */
  message?: string;
  /** Optional runbook / dashboard link the operator can follow. */
  learnMoreHref?: string;
  /** Optional CTA — primary action the operator can take right now. */
  cta?: ReactNode;
  /** Compact layout for inline use inside a card/cell. */
  compact?: boolean;
}

const PALETTE: Record<NoDataStateReason, { bg: string; border: string; fg: string; icon: string }> = {
  table_missing:           { bg: '#FEF2F2', border: '#FCA5A5', fg: '#991B1B', icon: '⚠' },
  no_data:                 { bg: '#FFFBEB', border: '#FDE68A', fg: '#92400E', icon: '◌' },
  partial:                 { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', icon: 'ⓘ' },
  pending_instrumentation: { bg: '#F9FAFB', border: '#E5E7EB', fg: '#6B7280', icon: '◌' },
  unknown:                 { bg: '#F9FAFB', border: '#E5E7EB', fg: '#6B7280', icon: '◌' },
};

const DEFAULT_COPY: Record<NoDataStateReason, { title: string; message: string }> = {
  table_missing: {
    title: 'Instrumentation table missing',
    message: 'The backing table for this view has not been migrated yet. Apply the corresponding migration to start collecting data.',
  },
  no_data: {
    title: 'No data yet',
    message: 'The backing table exists but is empty. Data will appear here once the collection job runs.',
  },
  partial: {
    title: 'Partial data',
    message: 'Some data is available but a key dimension is missing. Full breakdown will appear once collection catches up.',
  },
  pending_instrumentation: {
    title: 'Instrumentation pending',
    message: 'The schema is ready but the emitter has not been wired up yet. Tracked as a follow-up.',
  },
  unknown: {
    title: 'No data',
    message: 'Data not yet available for this view.',
  },
};

export function NoDataState({ reason, title, message, learnMoreHref, cta, compact = false }: NoDataStateProps) {
  const colours = PALETTE[reason];
  const copy = DEFAULT_COPY[reason];
  const finalTitle = title ?? copy.title;
  const finalMessage = message ?? copy.message;

  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          background: colours.bg,
          border: `1px solid ${colours.border}`,
          color: colours.fg,
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>{colours.icon}</span>
        <span>{finalTitle}</span>
        {learnMoreHref && (
          <a
            href={learnMoreHref}
            style={{ color: colours.fg, textDecoration: 'underline', marginLeft: 6 }}
            target="_blank"
            rel="noopener noreferrer"
          >
            details
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: colours.bg,
        border: `1px solid ${colours.border}`,
        color: colours.fg,
        padding: '16px 20px',
        borderRadius: 10,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span aria-hidden style={{ fontSize: 20, lineHeight: 1, marginTop: 2 }}>{colours.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{finalTitle}</div>
          <div style={{ opacity: 0.9 }}>{finalMessage}</div>
          {(learnMoreHref || cta) && (
            <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              {learnMoreHref && (
                <a
                  href={learnMoreHref}
                  style={{ color: colours.fg, textDecoration: 'underline', fontSize: 12 }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn more →
                </a>
              )}
              {cta}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NoDataState;
