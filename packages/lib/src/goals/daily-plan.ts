/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 3
 * Goal-Aware Daily Plan Builder
 *
 * Owner: assessment
 * Founder constraint: this file MUST NOT modify any existing file. Pure new module.
 * Other agents will wire callers in behind feature flags.
 *
 * Single source of truth for the per-goal daily-plan composition (item kind,
 * order, minutes, bilingual labels). Every downstream consumer (parent/teacher
 * visibility API, dashboard daily-plan card, study-plan UI) MUST read from
 * `buildDailyPlan` / `buildDailyPlanByCode` here rather than hardcoding plan
 * structure per surface.
 *
 * Consumers (will wire this in behind feature flags in the same Phase-3 sprint):
 *  - src/app/api/goals/daily-plan/route.ts        (backend — server reads goal,
 *                                                  returns DailyPlan as JSON)
 *  - src/components/dashboard/DailyPlanCard.tsx   (frontend — student dashboard)
 *  - src/components/parent/StudentDailyPlan.tsx   (frontend — parent visibility)
 *  - src/components/teacher/StudentDailyPlan.tsx  (frontend — teacher visibility)
 *
 * Feature flag that gates this module's effect (managed by architect):
 *  - ff_goal_daily_plan   (master switch — when off, callers fall back to legacy
 *                          static "today's quiz" suggestion)
 *
 * Pure data + functions. ZERO IO, ZERO React, ZERO Supabase, ZERO fetch,
 * ZERO side effects, ZERO PII handling. All strings are author-written
 * literals — no LLM-generated text in this file.
 *
 * Invariants:
 *  - sum(items[].estimatedMinutes) is within ±15% of profile.dailyTargetMinutes
 *  - every item has non-empty titleEn AND titleHi (P7 bilingual)
 *  - every item has a non-empty rationale containing the goal code
 *  - buildDailyPlanByCode(null | undefined | unknown) returns the empty shape:
 *      { goal: null, totalMinutes: 0, items: [], generatedAt: <now ISO> }
 *  - generatedAt is ISO 8601 derived from opts.now() (defaults to new Date())
 *  - kind values are exactly the union members of DailyPlanItemKind
 *
 * P5: grade-format invariant is unaffected — this module doesn't carry grade values.
 * P7: bilingual labels authored in pairs (en + hi).
 */

import type { GoalCode, GoalProfile } from './goal-profile';
import { resolveGoalProfile } from './goal-profile';

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Kind of a single planned item in a daily plan.
 *  - pyq:        past-year question practice (board_topper, school_topper)
 *  - concept:    1 NCERT concept walkthrough (improve_basics, pass_comfortably,
 *                school_topper)
 *  - practice:   standard quiz (school_topper, pass_comfortably,
 *                competitive_exam, olympiad)
 *  - challenge:  hard problem (olympiad, competitive_exam)
 *  - review:     spaced repetition (all goals)
 *  - reflection: post-task journaling (olympiad, board_topper, competitive_exam)
 */
export type DailyPlanItemKind =
  | 'pyq'
  | 'concept'
  | 'practice'
  | 'challenge'
  | 'review'
  | 'reflection';

export interface DailyPlanItem {
  kind: DailyPlanItemKind;
  titleEn: string;
  titleHi: string;
  estimatedMinutes: number;
  /** Diagnostic — why this item was chosen for this goal. Server-side only. */
  rationale: string;
}

export interface DailyPlan {
  goal: GoalCode | null;
  totalMinutes: number;
  items: DailyPlanItem[];
  /** ISO 8601 timestamp when this plan was built. Useful for cache invalidation. */
  generatedAt: string;
}

// ─── Internal authoring helpers ───────────────────────────────────────────

interface RawItem {
  kind: DailyPlanItemKind;
  titleEn: string;
  titleHi: string;
  minutes: number;
}

/**
 * Compose a rationale string. Format is fixed for downstream parsers/log
 * scrapers:
 *   "goal=<code>, kind=<kind>, planned_minutes=<n>, persona_match=<pacePolicy>"
 */
function buildRationale(
  code: GoalCode,
  kind: DailyPlanItemKind,
  minutes: number,
  pacePolicy: GoalProfile['pacePolicy'],
): string {
  return `goal=${code}, kind=${kind}, planned_minutes=${minutes}, persona_match=${pacePolicy}`;
}

/**
 * Pure mapping from GoalCode to the author-defined item list. Edit ONLY with
 * assessment-agent sign-off. Total minutes for each goal is verified by the
 * unit test suite (within ±15% of dailyTargetMinutes).
 */
const PLAN_TEMPLATES: Record<GoalCode, RawItem[]> = {
  improve_basics: [
    {
      kind: 'concept',
      titleEn: "Today's concept: easy NCERT topic",
      titleHi: 'आज की अवधारणा: आसान NCERT विषय',
      minutes: 8,
    },
    {
      kind: 'review',
      titleEn: "Quick recap of yesterday's words",
      titleHi: 'कल के शब्दों की त्वरित पुनरावृत्ति',
      minutes: 2,
    },
  ],
  pass_comfortably: [
    {
      kind: 'concept',
      titleEn: 'Top board-frequency concept',
      titleHi: 'बोर्ड में सबसे अधिक पूछे गए विषय',
      minutes: 8,
    },
    {
      kind: 'practice',
      titleEn: '5-question practice on this concept',
      titleHi: 'इस अवधारणा पर 5 प्रश्न अभ्यास',
      minutes: 10,
    },
    {
      kind: 'review',
      titleEn: "Yesterday's tricky question",
      titleHi: 'कल का मुश्किल प्रश्न',
      minutes: 2,
    },
  ],
  school_topper: [
    {
      kind: 'concept',
      titleEn: 'Concept of the day with worked example',
      titleHi: 'हल किए गए उदाहरण के साथ आज की अवधारणा',
      minutes: 10,
    },
    {
      kind: 'practice',
      titleEn: '10-question application set',
      titleHi: '10 प्रश्नों का अनुप्रयोग सेट',
      minutes: 15,
    },
    {
      kind: 'review',
      titleEn: 'Spaced review: weakest 2 chapters',
      titleHi: 'अंतराल पुनरावृत्ति: सबसे कमज़ोर 2 अध्याय',
      minutes: 5,
    },
  ],
  board_topper: [
    {
      kind: 'pyq',
      titleEn: 'PYQ daily streak: 5 board questions',
      titleHi: 'PYQ दैनिक श्रृंखला: 5 बोर्ड प्रश्न',
      minutes: 20,
    },
    {
      kind: 'practice',
      titleEn: '1 HOTS-style problem set',
      titleHi: '1 HOTS-शैली का प्रश्न सेट',
      minutes: 15,
    },
    {
      kind: 'review',
      titleEn: "Marking-scheme check on yesterday's incorrect",
      titleHi: 'कल गलत प्रश्नों की अंकन योजना जाँच',
      minutes: 5,
    },
    {
      kind: 'reflection',
      titleEn: 'Examiner mindset note',
      titleHi: 'परीक्षक दृष्टिकोण नोट',
      minutes: 5,
    },
  ],
  competitive_exam: [
    {
      kind: 'practice',
      titleEn: 'IRT-targeted set: 10 questions at θ ± 0.3',
      titleHi: 'IRT-लक्षित सेट: θ ± 0.3 पर 10 प्रश्न',
      minutes: 25,
    },
    {
      kind: 'challenge',
      titleEn: '1 multi-step problem',
      titleHi: '1 बहु-चरणीय समस्या',
      minutes: 20,
    },
    {
      kind: 'review',
      titleEn: 'Weakest chapter retest',
      titleHi: 'सबसे कमज़ोर अध्याय का पुनः परीक्षण',
      minutes: 10,
    },
    {
      kind: 'reflection',
      titleEn: 'Speed log: time per question',
      titleHi: 'गति लॉग: प्रति प्रश्न समय',
      minutes: 5,
    },
  ],
  olympiad: [
    {
      kind: 'challenge',
      titleEn: '1 Olympiad challenge problem (15-min budget × 2)',
      titleHi: '1 ओलंपियाड चुनौती समस्या (15-min बजट × 2)',
      minutes: 30,
    },
    {
      kind: 'practice',
      titleEn: 'Alternate solution path exercise',
      titleHi: 'वैकल्पिक समाधान पथ अभ्यास',
      minutes: 15,
    },
    {
      kind: 'review',
      titleEn: "Yesterday's missed insights",
      titleHi: 'कल की छूटी अंतर्दृष्टि',
      minutes: 10,
    },
    {
      kind: 'reflection',
      titleEn: 'Reasoning journal entry',
      titleHi: 'तर्क पत्रिका प्रविष्टि',
      minutes: 5,
    },
  ],
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Resolve the current ISO timestamp via an injectable clock (test seam).
 */
function nowIso(opts?: { now?: () => Date }): string {
  const clock = opts?.now ?? (() => new Date());
  return clock().toISOString();
}

/**
 * Build a deterministic daily plan from a GoalProfile.
 *
 * Total of `items[].estimatedMinutes` is within ±15% of
 * `profile.dailyTargetMinutes` (verified by unit tests).
 *
 * Pure: same `profile` + same `opts.now` => byte-identical result.
 */
export function buildDailyPlan(
  profile: GoalProfile,
  opts?: { now?: () => Date },
): DailyPlan {
  const template = PLAN_TEMPLATES[profile.code];
  const items: DailyPlanItem[] = template.map((raw) => ({
    kind: raw.kind,
    titleEn: raw.titleEn,
    titleHi: raw.titleHi,
    estimatedMinutes: raw.minutes,
    rationale: buildRationale(
      profile.code,
      raw.kind,
      raw.minutes,
      profile.pacePolicy,
    ),
  }));
  const totalMinutes = items.reduce((sum, it) => sum + it.estimatedMinutes, 0);
  return {
    goal: profile.code,
    totalMinutes,
    items,
    generatedAt: nowIso(opts),
  };
}

/**
 * Convenience wrapper for callers that have a goal CODE (or null/unknown).
 *
 * Returns an EMPTY plan `{ goal: null, totalMinutes: 0, items: [], generatedAt }`
 * for null, undefined, empty string, or any unrecognised GoalCode value. Never
 * throws. Callers MUST handle the empty shape by falling back to legacy
 * "today's quiz" suggestion (or hiding the daily-plan card entirely).
 */
export function buildDailyPlanByCode(
  goal: GoalCode | null | undefined,
  opts?: { now?: () => Date },
): DailyPlan {
  const profile = resolveGoalProfile(goal ?? null);
  if (!profile) {
    return {
      goal: null,
      totalMinutes: 0,
      items: [],
      generatedAt: nowIso(opts),
    };
  }
  return buildDailyPlan(profile, opts);
}
