'use client';

/**
 * TodayQueueItem — a compact, tappable row for a non-primary item on the
 * /today home queue. Icon (mapped from `iconHint`) + label + "~N min", whole
 * row navigates to the item's deep link.
 *
 * Pure presentation. Copy via `resolveItemCopy` (P7); URL via the single
 * `deepLinkToHref` helper. Reuses the shared `Card` chrome; 44px+ tap target.
 */

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import type { Subject } from '@/lib/subjects.types';
import type { TodayQueueItem as TodayQueueItemDTO } from '@/lib/today/types';
import { deepLinkToHref } from '@/lib/today/copy';
import { todayIcon } from '@/lib/today/icon-map';
import { resolveItemCopy } from '@/lib/today/render';

interface TodayQueueItemProps {
  item: TodayQueueItemDTO;
  subjects: Subject[];
  isHi: boolean;
}

export default function TodayQueueItem({ item, subjects, isHi }: TodayQueueItemProps) {
  const router = useRouter();
  const { label, subtitle, minutesBadge } = resolveItemCopy(item, subjects, isHi);
  const href = deepLinkToHref(item.deepLink);

  return (
    <Card
      hoverable
      onClick={() => router.push(href)}
      className="!p-3.5"
    >
      <div className="flex items-center gap-3" style={{ minHeight: 44 }}>
        <div
          className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            width: 44,
            height: 44,
            background: 'var(--surface-2)',
            fontSize: 20,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          {todayIcon(item.iconHint)}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--text-1)' }}
          >
            {label}
          </p>
          <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
            {subtitle}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
            {minutesBadge}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-3)', fontSize: 16 }}>
            →
          </span>
        </div>
      </div>
    </Card>
  );
}
