'use client';

/**
 * packages/lib/src/quiz/v2/use-next-task.ts
 *
 * Screen 08 "Result" (`ff_quiz_result_v2`) — resolves the "Next task" CTA
 * that SCREENS.md requires to always be present after a quiz ("Never a dead
 * end — the last action is always Next task").
 *
 * This does NOT invent a new "what's next" resolver. It reuses the EXISTING
 * Today-queue mechanism (`useTodayQueue` → `GET /api/v2/today`), whose
 * `resolveTodayQueue` (learner-loop) already owns "what should this student
 * do next" end-to-end (resume → exam → plan, per screen 03). The primary
 * queue item's `deepLink` (parsed from the resolver's own `action.url` — see
 * `map-action.ts`) is reassembled into a navigable href here.
 *
 * Fails soft to a generic `/today` link on any error, loading state, or an
 * empty queue (e.g. `useTodayQueue` returns `null` on a 404) so the CTA is
 * NEVER missing — a broken "next task" fetch must not create the dead end
 * this hook exists to prevent.
 */

import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';

export interface NextTaskLink {
  /** Navigable href — either the resolved primary Today item, or the
   *  generic `/today` fallback. */
  href: string;
  labelEn: string;
  labelHi: string;
  /** True while the Today queue is still resolving (initial fetch only —
   *  callers may show the fallback href immediately since it's always safe
   *  to navigate to `/today`). */
  isLoading: boolean;
}

const FALLBACK_HREF = '/today';
const LABEL_EN = 'Next task';
const LABEL_HI = 'अगला काम';

/**
 * @param studentId Same param `useTodayQueue` takes — `null`/`undefined`
 *   suspends the fetch (auth not ready yet) and returns the fallback link.
 */
export function useNextTask(studentId: string | null | undefined): NextTaskLink {
  const { data, isLoading } = useTodayQueue(studentId);
  const primary = data?.primary;

  if (!primary) {
    return { href: FALLBACK_HREF, labelEn: LABEL_EN, labelHi: LABEL_HI, isLoading };
  }

  const { route, params } = primary.deepLink;
  const qs = params
    ? `?${Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')}`
    : '';

  return {
    href: `${route}${qs}`,
    labelEn: LABEL_EN,
    labelHi: LABEL_HI,
    isLoading,
  };
}
