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
import { Card } from '@alfanumrik/ui/ui';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import type { TodayQueueItem as TodayQueueItemDTO } from '@alfanumrik/lib/today/types';
import { deepLinkToHref } from '@alfanumrik/lib/today/copy';
import { todayIcon } from '@alfanumrik/lib/today/icon-map';
import { resolveItemCopy, isTeacherAssigned, fromTeacherLabel } from '@alfanumrik/lib/today/render';

interface TodayQueueItemProps {
  item: TodayQueueItemDTO;
  subjects: Subject[];
  isHi: boolean;
}

export default function TodayQueueItem({ item, subjects, isHi }: TodayQueueItemProps) {
  const router = useRouter();
  const { label, subtitle, minutesBadge } = resolveItemCopy(item, subjects, isHi);
  const href = deepLinkToHref(item.deepLink);
  // Phase 3A Wave A — compact "from your teacher" tag above the label.
  const teacherAssigned = isTeacherAssigned(item);

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
            background: teacherAssigned
              ? 'rgb(var(--purple-rgb, 124 58 237) / 0.10)'
              : 'var(--surface-2)',
            fontSize: 20,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          {todayIcon(item.iconHint)}
        </div>
        <div className="flex-1 min-w-0">
          {teacherAssigned && (
            <span
              data-testid="today-from-teacher-tag"
              className="inline-block text-[10px] font-bold uppercase tracking-wider mb-0.5"
              style={{ color: 'var(--purple, #7C3AED)' }}
            >
              {fromTeacherLabel(isHi)}
            </span>
          )}
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
