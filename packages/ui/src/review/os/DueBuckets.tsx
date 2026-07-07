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
 * Phase 8 rebuild: Card containers, Badge counts, Alert error state; every
 * severity hue is a semantic token (danger/primary/neutral) — zero raw hex/rgb.
 *
 * States: loading (skeleton), error (distinct from empty), empty (per bucket).
 */

import { useState } from 'react';
import { Card, Badge, Alert, Skeleton, type Tone } from '@alfanumrik/ui/ui/primitives';
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
  { glyph: string; color: string; tone: Tone; titleEn: string; titleHi: string; emptyEn: string; emptyHi: string }
> = {
  overdue: {
    glyph: '▲',
    color: 'var(--danger)',
    tone: 'danger',
    titleEn: 'Overdue',
    titleHi: 'समय बीत चुका',
    emptyEn: 'Nothing overdue — great.',
    emptyHi: 'कुछ भी बकाया नहीं — बढ़िया।',
  },
  dueToday: {
    glyph: '●',
    color: 'var(--primary)',
    tone: 'brand',
    titleEn: 'Due today',
    titleHi: 'आज दोहराने हैं',
    emptyEn: 'Nothing due today.',
    emptyHi: 'आज कुछ नहीं है।',
  },
  upcoming: {
    glyph: '○',
    color: 'var(--text-3)',
    tone: 'neutral',
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
      className="flex items-center justify-between gap-3 border-t border-surface-3 px-1 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-fluid-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-fluid-xs text-muted-foreground">
          <span className="truncate">{formatSubject(item.subject)}</span>
          {kind === 'overdue' && item.daysOverdue > 0 && (
            <Badge tone="danger" variant="soft" icon={<span>▲</span>} className="tabular-nums">
              {isHi ? `${item.daysOverdue} दिन देर` : `${item.daysOverdue}d late`}
            </Badge>
          )}
        </p>
      </div>
      <span
        className="inline-flex shrink-0 items-center gap-1 text-fluid-xs font-medium"
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
    <Card variant="flat">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={spec.count === 0}
        aria-expanded={open && spec.count > 0}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
        style={{ minHeight: 48 }}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" style={{ color: meta.color }}>
            {meta.glyph}
          </span>
          <span className="text-fluid-sm font-bold text-foreground">
            {isHi ? meta.titleHi : meta.titleEn}
          </span>
          <Badge
            tone={spec.count > 0 ? meta.tone : 'neutral'}
            variant="soft"
            className="tabular-nums"
            aria-label={isHi ? `${spec.count} विषय` : `${spec.count} topics`}
          >
            {spec.count}
          </Badge>
        </span>
        {spec.count > 0 && (
          <span
            aria-hidden="true"
            className="text-fluid-xs text-muted-foreground transition-transform duration-150 motion-reduce:transition-none"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
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
            <p className="py-2 text-fluid-xs text-muted-foreground">
              {isHi
                ? `${spec.count} विषय — सूची दोहराव में दिखेगी।`
                : `${spec.count} topic${spec.count === 1 ? '' : 's'} — they'll appear in your session.`}
            </p>
          )}
        </div>
      )}

      {spec.count === 0 && (
        <p className="px-4 pb-3 text-fluid-xs text-muted-foreground">
          {isHi ? meta.emptyHi : meta.emptyEn}
        </p>
      )}
    </Card>
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
        <Skeleton radius="lg" className="h-14 w-full" />
        <Skeleton radius="lg" className="h-14 w-full" />
        <Skeleton radius="lg" className="h-14 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="danger">
        {isHi
          ? 'दोहराव की सूची लोड नहीं हो पाई — थोड़ी देर बाद फिर देखो।'
          : "Couldn't load your buckets — try again in a moment."}
      </Alert>
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
