'use client';

/**
 * TodayFocusCard — the large primary "Today's focus" CTA on the /today home.
 *
 * Pure presentation: it renders the resolved primary `TodayQueueItem` (title,
 * subtitle, "~N min" badge) and a single "Continue" button that navigates to
 * the item's parsed deep link. All copy routes through `todayCopy`/`resolveItemCopy`
 * (P7); URL assembly routes through the single `deepLinkToHref` helper.
 *
 * Reuses the shared `Card` / `Button` primitives — no new design system.
 */

import { useRouter } from 'next/navigation';
import { Card, Button } from '@/components/ui';
import type { Subject } from '@/lib/subjects.types';
import type { TodayQueueItem } from '@/lib/today/types';
import { todayCopy, deepLinkToHref } from '@/lib/today/copy';
import { todayIcon } from '@/lib/today/icon-map';
import { resolveItemCopy } from '@/lib/today/render';

interface TodayFocusCardProps {
  item: TodayQueueItem;
  subjects: Subject[];
  isHi: boolean;
}

export default function TodayFocusCard({ item, subjects, isHi }: TodayFocusCardProps) {
  const router = useRouter();
  const { label, subtitle, minutesBadge } = resolveItemCopy(item, subjects, isHi);
  const href = deepLinkToHref(item.deepLink);

  return (
    <Card accent="var(--orange)" className="!p-5">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div
            className="rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              width: 56,
              height: 56,
              background: 'rgb(var(--orange-rgb) / 0.10)',
              fontSize: 26,
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            {todayIcon(item.iconHint)}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-bold uppercase tracking-wider mb-1"
              style={{ color: 'var(--text-3)' }}
            >
              {todayCopy('today.focus', isHi)}
            </p>
            <h2
              className="text-lg font-bold leading-snug"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
            >
              {label}
            </h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
            }}
          >
            <span aria-hidden="true">⏱️</span>
            {minutesBadge}
          </span>
          <Button
            variant="primary"
            size="md"
            onClick={() => router.push(href)}
            data-testid="today-focus-continue"
          >
            {isHi ? 'जारी रखें' : 'Continue'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
