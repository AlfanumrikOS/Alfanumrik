'use client';

// src/components/pulse/PulseTimeline.tsx
//
// The recent-activity timeline: the last ~10 `state_events`, each rendered as a
// human-readable bilingual line via `timelineLine()` (pulse-copy.ts). The
// entries come verbatim from the frozen contract (`PulseResponse.timeline`,
// newest-first, non-PII summaries) — this component only PRESENTS them.
//
// P7 bilingual via `isHi`. Accessible: semantic <ol>, each row carries its own
// time. Empty state when the timeline is blank.

import type { PulseTimelineEntry } from '@/lib/pulse/types';
import { timelineLine, timeAgo, tp } from './pulse-copy';

interface PulseTimelineProps {
  timeline: PulseTimelineEntry[];
  isHi: boolean;
  /** Cap the number of rows shown (default 10, matching the contract size). */
  max?: number;
}

export default function PulseTimeline({
  timeline,
  isHi,
  max = 10,
}: PulseTimelineProps) {
  const rows = (timeline ?? []).slice(0, max);

  if (rows.length === 0) {
    return (
      <div
        className="rounded-xl py-6 px-4 text-center"
        style={{ background: 'var(--surface-2, #f8fafc)' }}
      >
        <div className="text-2xl mb-1" aria-hidden="true">
          🗓️
        </div>
        <p className="text-sm text-[var(--text-3)]">
          {tp(isHi, 'No recent activity yet', 'अभी तक कोई हाल की गतिविधि नहीं')}
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-1.5" aria-label={tp(isHi, 'Recent activity', 'हाल की गतिविधि')}>
      {rows.map((entry, i) => {
        const { icon, text } = timelineLine(entry.kind, entry.summary, isHi);
        return (
          <li
            key={`${entry.kind}-${entry.occurredAt}-${i}`}
            className="flex items-center gap-3 rounded-xl px-3 py-2"
            style={{ background: 'var(--surface-2, #f8fafc)' }}
          >
            <span
              className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-sm"
              style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
              aria-hidden="true"
            >
              {icon}
            </span>
            <span className="flex-1 min-w-0 text-sm text-[var(--text-1)] truncate">
              {text}
            </span>
            <time
              dateTime={entry.occurredAt}
              className="text-[11px] text-[var(--text-3)] shrink-0 tabular-nums"
            >
              {timeAgo(entry.occurredAt, isHi)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
