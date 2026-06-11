'use client';

/**
 * DueBuckets — the three spaced-repetition buckets of the Alfa OS Revision
 * Center (ff_revision_os_v1, Tier 1 / presentation-only):
 *   • Overdue   (daysOverdue badge)
 *   • Due Today
 *   • Upcoming  (next 7 days)
 *
 * Each bucket is an expandable disclosure. Counts are encoded number + glyph
 * (not colour alone, WCAG 1.4.1). Severity uses colour ONLY as reinforcement
 * alongside the glyph/label. No scoring/XP — masteryProbability is shown as a
 * qualitative impact chip, never a number.
 *
 * States: loading (skeleton), error (distinct from empty), empty (per bucket).
 */

import { useState } from 'react';
import { Skeleton } from '@/components/ui';
import type { RevisionItem } from './useRevisionOverview';
import { formatSubject, masteryImpact, impactMeta } from './revision-labels';

type BucketKind = 'overdue' | 'dueToday' | 'upcoming';

interface BucketSpec {
  kind: BucketKind;
  count: number;
  items: RevisionItem[];
}

interface DueBucketsProps {
  overdue: BucketSpec;
  dueToday: BucketSpec;
  upcoming: BucketSpec;
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

const META: Record<
  BucketKind,
  { glyph: string; color: string; titleEn: string; titleHi: string; emptyEn: string; emptyHi: string }
> = {
  overdue: {
    glyph: '▲',
    color: 'var(--red, #DC2626)',
    titleEn: 'Overdue',
    titleHi: 'समय बीत चुका',
    emptyEn: 'Nothing overdue — great.',
    emptyHi: 'कुछ भी बकाया नहीं — बढ़िया।',
  },
  dueToday: {
    glyph: '●',
    color: 'var(--orange, #E8581C)',
    titleEn: 'Due today',
    titleHi: 'आज दोहराने हैं',
    emptyEn: 'Nothing due today.',
    emptyHi: 'आज कुछ नहीं है।',
  },
  upcoming: {
    glyph: '○',
    color: 'var(--text-3)',
    titleEn: 'Upcoming (7 days)',
    titleHi: 'अगले 7 दिन',
    emptyEn: 'Nothing scheduled this week.',
    emptyHi: 'इस हफ़्ते कुछ तय नहीं है।',
  },
};

function ItemRow({ item, kind, isHi }: { item: RevisionItem; kind: BucketKind; isHi: boolean }) {
  const title = (isHi && item.titleHi) || item.title || (isHi ? 'विषय' : 'Topic');
  const impact = impactMeta(masteryImpact(item.masteryProbability), isHi);

  return (
    <li
      className="flex items-center justify-between gap-3 py-2.5 px-1"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
          {title}
        </p>
        <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <span className="truncate">{formatSubject(item.subject)}</span>
          {kind === 'overdue' && item.daysOverdue > 0 && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-semibold"
              style={{
                background: 'rgba(220,38,38,0.1)',
                color: 'var(--red, #DC2626)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span aria-hidden="true">▲</span>
              {isHi
                ? `${item.daysOverdue} दिन देर`
                : `${item.daysOverdue}d late`}
            </span>
          )}
        </p>
      </div>
      <span
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium"
        style={{ color: impact.color }}
        title={impact.label}
      >
        <span aria-hidden="true">{impact.glyph}</span>
        <span>{impact.label}</span>
      </span>
    </li>
  );
}

function Bucket({ spec, isHi }: { spec: BucketSpec; isHi: boolean }) {
  const meta = META[spec.kind];
  const [open, setOpen] = useState(spec.kind !== 'upcoming'); // upcoming collapsed by default
  const hasItems = spec.items.length > 0;
  const panelId = `revision-bucket-${spec.kind}`;

  return (
    <section
      className="rounded-2xl"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={spec.count === 0}
        aria-expanded={open && spec.count > 0}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default"
        style={{ minHeight: 48 }}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" style={{ color: meta.color }}>
            {meta.glyph}
          </span>
          <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            {isHi ? meta.titleHi : meta.titleEn}
          </span>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{
              background: 'var(--surface-2)',
              color: spec.count > 0 ? meta.color : 'var(--text-3)',
              fontVariantNumeric: 'tabular-nums',
            }}
            aria-label={isHi ? `${spec.count} विषय` : `${spec.count} topics`}
          >
            {spec.count}
          </span>
        </span>
        {spec.count > 0 && (
          <span
            aria-hidden="true"
            className="text-xs transition-transform duration-150"
            style={{
              color: 'var(--text-3)',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            ▾
          </span>
        )}
      </button>

      {open && spec.count > 0 && (
        <div id={panelId} className="px-4 pb-2">
          {hasItems ? (
            <ul>
              {spec.items.map((item) => (
                <ItemRow key={`${spec.kind}-${item.topicId}-${item.dueDate}`} item={item} kind={spec.kind} isHi={isHi} />
              ))}
            </ul>
          ) : (
            // count>0 but items capped/missing — still show a count-only note.
            <p className="text-xs py-2" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? `${spec.count} विषय — सूची दोहराव में दिखेगी।`
                : `${spec.count} topic${spec.count === 1 ? '' : 's'} — they'll appear in your session.`}
            </p>
          )}
        </div>
      )}

      {spec.count === 0 && (
        <p className="text-xs px-4 pb-3" style={{ color: 'var(--text-3)' }}>
          {isHi ? meta.emptyHi : meta.emptyEn}
        </p>
      )}
    </section>
  );
}

export default function DueBuckets({
  overdue,
  dueToday,
  upcoming,
  isLoading,
  error,
  isHi,
}: DueBucketsProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton height={56} rounded="rounded-2xl" />
        <Skeleton height={56} rounded="rounded-2xl" />
        <Skeleton height={56} rounded="rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <section
        className="rounded-2xl p-4 flex items-start gap-3"
        style={{
          background: 'rgba(220,38,38,0.06)',
          border: '1px solid var(--red, #DC2626)',
        }}
        role="status"
      >
        <span aria-hidden="true" style={{ color: 'var(--red, #DC2626)' }}>
          ⚠
        </span>
        <p className="text-sm" style={{ color: 'var(--text-1)' }}>
          {isHi
            ? 'दोहराव की सूची लोड नहीं हो पाई — थोड़ी देर बाद फिर देखो।'
            : "Couldn't load your buckets — try again in a moment."}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Bucket spec={overdue} isHi={isHi} />
      <Bucket spec={dueToday} isHi={isHi} />
      <Bucket spec={upcoming} isHi={isHi} />
    </div>
  );
}
