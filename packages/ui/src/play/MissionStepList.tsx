'use client';

/**
 * MissionStepList — the ordered list of steps inside a MissionCard. Each step
 * carries a bilingual label + an optional deep-link (href) to the canonical
 * activity page. When the target page reads `?mission=<id>` it can render a
 * read-only breadcrumb linking back to /missions (non-blocking).
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
