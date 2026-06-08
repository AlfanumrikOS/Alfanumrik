/**
 * src/lib/today/map-action.ts — pure projection: LearnerAction → TodayQueueItem.
 *
 * This is the ONLY place a resolved `LearnerAction` becomes a render DTO. It
 * adds NO "what next" logic — that all lives in `resolveTodayQueue`. The
 * mapper is a deterministic, side-effect-free function over a single action.
 *
 * Two hard rules:
 *
 *   1. `deepLink` is derived by PARSING `action.url`. The resolver's `url` is
 *      the navigation contract; we split it into { route, params } and never
 *      hand-build a new URL. If the resolver changes a route shape, this
 *      mapper inherits it for free.
 *
 *   2. `meta` fields are lifted VERBATIM from the source action variant. We
 *      only surface fields that already exist on the action; an absent field
 *      is omitted, never fabricated. `estMinutes` / `iconHint` are static
 *      presentation badges per the approved assessment contract.
 *
 * `estMinutes` is a presentation badge — it is NOT a timing-model value and
 * is unrelated to scoring/XP (P1/P2 untouched).
 */

import type { LearnerAction } from '@/lib/state/learner-loop/types';
import type {
  TodayDeepLink,
  TodayItemType,
  TodayQueueItem,
} from '@/lib/today/types';

/**
 * Split a `LearnerAction.url` into a parsed deep link. The url may be an
 * absolute path with an optional querystring (e.g.
 * `/learn/science/3?mode=read&from=revise` or `/quiz?subject=math&chapter=4`).
 * We parse defensively against a dummy origin so query handling is robust;
 * only the pathname + search params survive into the DTO.
 */
function parseDeepLink(url: string): TodayDeepLink {
  // Parse against a stable dummy origin so root-relative urls resolve.
  const parsed = new URL(url, 'http://_');
  const route = parsed.pathname;

  if (parsed.searchParams.size === 0) {
    return { route };
  }

  const params: Record<string, string | number> = {};
  for (const [key, raw] of parsed.searchParams.entries()) {
    // Coerce unambiguous integers to numbers (e.g. `chapter=3`), keep
    // everything else as the original string. Empty / non-numeric stays text.
    if (raw !== '' && /^-?\d+$/.test(raw)) {
      params[key] = Number(raw);
    } else {
      params[key] = raw;
    }
  }
  return { route, params };
}

/**
 * Static per-type presentation contract: render type, estimated-minutes badge,
 * and icon hint. SRS (`srs_due`) computes its badge dynamically from dueCount,
 * so its `estMinutes` here is a placeholder overridden below.
 */
const TYPE_PRESENTATION: Record<
  TodayItemType,
  { estMinutes: number; iconHint: string }
> = {
  resume_in_progress:     { estMinutes: 5,  iconHint: 'play-resume' },
  cold_start_diagnostic:  { estMinutes: 10, iconHint: 'compass' },
  teacher_remediation:    { estMinutes: 8,  iconHint: 'teacher-badge' },
  srs_due:                { estMinutes: 5,  iconHint: 'cards-stack' },
  revise_decayed_topic:   { estMinutes: 8,  iconHint: 'refresh-book' },
  weak_topic_zpd:         { estMinutes: 7,  iconHint: 'target' },
  continue_lesson:        { estMinutes: 6,  iconHint: 'book-open' },
  weekly_dive_due:        { estMinutes: 15, iconHint: 'telescope' },
  monthly_synthesis_due:  { estMinutes: 12, iconHint: 'scroll' },
  practice_weakest:       { estMinutes: 7,  iconHint: 'target' },
};

/**
 * Resolve the render `TodayItemType` for an action. Most kinds map 1:1; the
 * `start_quiz` kind splits on `reason` (today's ZPD vs. catch-all practice).
 */
function itemTypeFor(action: LearnerAction): TodayItemType {
  switch (action.kind) {
    case 'resume_in_progress':
      return 'resume_in_progress';
    case 'cold_start_diagnostic':
      return 'cold_start_diagnostic';
    case 'teacher_remediation':
      return 'teacher_remediation';
    case 'review_due_cards':
      return 'srs_due';
    case 'revise_decayed_topic':
      return 'revise_decayed_topic';
    case 'start_quiz':
      // todays_zpd → weak_topic_zpd; weakest_topic_practice → practice_weakest.
      return action.reason === 'todays_zpd' ? 'weak_topic_zpd' : 'practice_weakest';
    case 'continue_lesson':
      return 'continue_lesson';
    case 'weekly_dive':
      return 'weekly_dive_due';
    case 'monthly_synthesis':
      return 'monthly_synthesis_due';
  }
}

/**
 * Lift the per-type `meta` fields from a source action, verbatim. Only fields
 * that already exist on the action variant are surfaced; absent optionals are
 * omitted (never fabricated). Returns `undefined` when there is nothing to
 * surface (e.g. cold-start), so the DTO omits `meta` entirely.
 */
function metaFor(action: LearnerAction): Record<string, unknown> | undefined {
  switch (action.kind) {
    case 'resume_in_progress': {
      const m: Record<string, unknown> = { liveKind: action.liveKind };
      if (action.subjectCode !== undefined) m.subjectCode = action.subjectCode;
      if (action.chapterNumber !== undefined) m.chapterNumber = action.chapterNumber;
      return m;
    }
    case 'cold_start_diagnostic':
      return undefined; // contract: meta {}

    case 'teacher_remediation': {
      // Surface the provenance marker + tracking id verbatim. `source:'teacher'`
      // is the "from your teacher" marker (assessment rule 1); `assignmentId`
      // lets the Today completion flow flip the assignment to resolved. Optional
      // anchor (subjectCode/chapterNumber) surfaced only when resolved.
      const m: Record<string, unknown> = {
        source: action.source,
        assignmentId: action.assignmentId,
        chapterId: action.chapterId,
      };
      if (action.subjectCode !== undefined) m.subjectCode = action.subjectCode;
      if (action.chapterNumber !== undefined) m.chapterNumber = action.chapterNumber;
      return m;
    }

    case 'review_due_cards':
      return { dueCount: action.dueCount };

    case 'revise_decayed_topic':
      return {
        subjectCode: action.subjectCode,
        chapterNumber: action.chapterNumber,
        daysSinceLastTouch: action.daysSinceLastTouch,
        recommendedModality: action.recommendedModality,
      };

    case 'start_quiz':
      // Covers both weak_topic_zpd and practice_weakest (same fields).
      return {
        subjectCode: action.subjectCode,
        chapterNumber: action.chapterNumber,
        zpdBin: action.zpdBin,
      };

    case 'continue_lesson':
      return {
        subjectCode: action.subjectCode,
        chapterNumber: action.chapterNumber,
        progressPct: action.progressPct,
      };

    case 'weekly_dive':
      // Contract: meta {defaultPicker, suggestedPrompt}. The action only
      // carries suggestedPrompt — surface what exists; omit defaultPicker.
      return { suggestedPrompt: action.suggestedPrompt };

    case 'monthly_synthesis':
      // Contract: meta {monthLabel}. The action carries no monthLabel field,
      // so there is nothing to surface — omit meta entirely.
      return undefined;
  }
}

/**
 * Project a resolved `LearnerAction` into a render-ready `TodayQueueItem`.
 *
 * @param action The resolved action (from `resolveTodayQueue` primary/queue).
 * @param rank   1-based position in the Today queue (1 = primary CTA).
 */
export function mapActionToTodayItem(
  action: LearnerAction,
  rank: number,
): TodayQueueItem {
  const type = itemTypeFor(action);
  const presentation = TYPE_PRESENTATION[type];

  // SRS badge is dynamic: min(dueCount, 5). Everything else is the static
  // per-type badge.
  let estMinutes = presentation.estMinutes;
  if (action.kind === 'review_due_cards') {
    estMinutes = Math.min(action.dueCount, 5);
  }

  const meta = metaFor(action);

  const item: TodayQueueItem = {
    type,
    rank,
    labelKey: `today.item.${type}.label`,
    subtitleKey: `today.item.${type}.subtitle`,
    estMinutes,
    deepLink: parseDeepLink(action.url),
    iconHint: presentation.iconHint,
    reason: action.reason,
  };
  if (meta !== undefined) {
    item.meta = meta;
  }
  return item;
}
