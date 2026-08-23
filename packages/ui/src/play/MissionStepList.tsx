'use client';

/**
 * MissionStepList — the ordered list of steps inside a MissionCard. Each step
 * carries a bilingual label + an optional deep-link (href) to the canonical
 * activity page.
 *
 * ⚠️ NOT CURRENTLY MOUNTED (R6, 2026-08-11). The only consumer was the student
 * `/missions` page, which was deleted: it read progress from
 * `/api/play/mission-progress`, an endpoint that does not exist, and its
 * fetcher returned null on `!res.ok` — so every mission rendered "0/N steps"
 * with green todo chips, permanently, while looking functional. The page was
 * also absent from the student nav after Phase 3, so nothing linked to it.
 *
 * This component and `packages/lib/src/play/*` (still unit-tested) are kept so
 * the surface can be re-mounted UNCHANGED once backend/assessment ship the
 * endpoint. Whoever does: `stepHref()` in the old page also ignored
 * `step.subject` / `chapterNumber` / `phenomenonSlug` and deep-linked every
 * step to a bare `/quiz` | `/dive` | `/simulations` | `/foxy` while the label
 * promised "Concept · Science · ch. 4" — fix that too, don't restore it.
 *
 * P7 bilingual.
 */

import Link from 'next/link';

export interface MissionStepView {
  id: string;
  label: string;
  labelHi?: string;
  href?: string;
  status: 'todo' | 'in_progress' | 'done';
}

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const STATUS_ICON: Record<MissionStepView['status'], string> = {
  todo: '○',
  in_progress: '◐',
  done: '●',
};

export function MissionStepList({
  steps,
  isHi,
  missionId,
}: {
  steps: MissionStepView[];
  isHi: boolean;
  missionId?: string;
}) {
  return (
    <ol
      data-testid="mission-step-list"
      className="list-none p-0 m-0 flex flex-col gap-1"
    >
      {steps.map((s) => {
        const label = isHi && s.labelHi ? s.labelHi : s.label;
        const href = s.href
          ? missionId
            ? `${s.href}${s.href.includes('?') ? '&' : '?'}mission=${encodeURIComponent(
                missionId,
              )}`
            : s.href
          : undefined;
        const body = (
          <span
            className="flex items-center gap-2 text-[13px] py-1"
            style={{
              color: s.status === 'done' ? 'var(--text-3)' : 'var(--text-1)',
              textDecoration: s.status === 'done' ? 'line-through' : undefined,
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block w-4 text-center"
              style={{
                color:
                  s.status === 'done'
                    ? 'var(--success, #059669)'
                    : s.status === 'in_progress'
                      ? 'var(--purple)'
                      : 'var(--text-3)',
              }}
            >
              {STATUS_ICON[s.status]}
            </span>
            <span className="min-w-0 truncate">{label}</span>
          </span>
        );
        return (
          <li key={s.id} data-testid="mission-step">
            {href ? (
              <Link href={href} className="no-underline block hover:bg-[var(--surface-2)] rounded-md px-1">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default MissionStepList;
