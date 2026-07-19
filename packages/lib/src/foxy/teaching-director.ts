// packages/lib/src/foxy/teaching-director.ts
//
// Foxy Teaching Director (Phase 2.1, 2026-07-15) — the pure, deterministic
// "brain" that turns already-loaded learner state into an explicit,
// machine-readable teaching plan. This is the module that makes Foxy behave
// like a teacher who knows the next step: what concept to teach, why now, at
// what depth, with which lesson step, and which follow-up actions to offer.
//
// ─── HARD INVARIANTS ─────────────────────────────────────────────────────────
//   • PURE + DETERMINISTIC: no DB, no fetch, no Date.now(), no randomness, no
//     side effects. Same inputs → byte-identical output. Trivially unit-testable
//     and reusable by both the Foxy route and the reports surface.
//   • BILINGUAL (P7): every student-facing string is authored EN + HI. Technical
//     terms (Bloom, CBSE) and topic proper-nouns are not translated.
//   • GRADE (P5): this module carries NO grade value and does NO grade handling,
//     so the grade-string invariant is trivially preserved.
//   • ADVISORY ONLY: the Director never invents XP or moves mastery. It only
//     ADVISES. Actual mastery changes ride the existing evidential-quiz path.
//
// ─── REUSE (composed, never re-implemented) ──────────────────────────────────
//   • `cognitiveContext.nextAction` — the output of the live 5-priority
//     next-action ladder `deriveNextAction` (apps/host cognitive-context.ts),
//     already computed upstream. The Director READS it (priority 1 objective
//     source); it does not re-derive it.
//   • `resolvePedagogyRule(persona,'daily','zpd_problem')` — persona depthCeiling
//     + productive-failure policy (packages/lib learn/pedagogy-content-rules).
//   • `calculateZPD` / `getNextLessonStep` / `LESSON_STEPS` / `getReflectionPrompt`
//     (packages/lib cognitive-engine) — ZPD target, lesson-step ladder, and the
//     bilingual metacognitive prompt.
//   • `BLOOM_CEILING` (packages/lib score-config) — the mastery → max-Bloom
//     ceiling (single source of truth for the per-level score cap).
//
// ─── PACKAGE-BOUNDARY NOTE ───────────────────────────────────────────────────
//   packages/lib MUST NOT depend on apps/host, so the `CognitiveContext` /
//   `ChapterTopicProgress` / perception shapes this module consumes are declared
//   here as STRUCTURAL input contracts (Director* interfaces below). The real
//   apps/host `CognitiveContext` (constants.ts) and `ChapterTopicProgress`
//   (cognitive-context.ts) are assignable to these by TypeScript structural
//   typing — no logic is duplicated, only the read-surface is pinned.
//
// Owner: assessment (learner-state / pedagogy rules).
// Reviewers (P14): ai-engineer (wires it into the route next, gated by
//   ff_foxy_teaching_director_v1), testing, quality.

import {
  resolvePedagogyRule,
  type DepthCeiling,
} from '@alfanumrik/lib/learn/pedagogy-content-rules';
import {
  calculateZPD,
  getNextLessonStep,
  getReflectionPrompt,
  bloomToDifficultyRange,
  LESSON_STEPS,
  BLOOM_LEVELS,
  BLOOM_ORDER,
  type BloomLevel,
  type LessonStep,
  type LessonState,
  type ReflectionPrompt,
} from '@alfanumrik/lib/cognitive-engine';
import { BLOOM_CEILING } from '@alfanumrik/lib/score-config';
import type { GoalCode } from '@alfanumrik/lib/goals/goal-profile';
// Type-only imports — fully erased, so this pure module pulls NO runtime code
// (no Supabase client, no Python-MOL client, no Zod event union) from the
// perception / twin modules.
import type { StruggleSignal } from '@alfanumrik/lib/foxy/perception';
import type { TwinContext } from '@alfanumrik/lib/learn/build-twin-context';

// ─── Public output vocabulary ────────────────────────────────────────────────

/** A pair of author-written, parallel EN/HI strings (P7). */
export interface BilingualText {
  en: string;
  hi: string;
}

/** WHY this concept is being taught right now. */
export type WhyNowKind =
  | 'gap' // an unresolved knowledge gap must be closed first
  | 'overdue-review' // a previously-learned concept is fading (SM-2 due)
  | 'prerequisite-block' // a named prerequisite is blocking the next topic
  | 'next-in-ladder'; // the natural next unmastered step in the chapter

export interface TeachingObjective {
  /** The concept the Director wants Foxy to teach this turn. */
  conceptName: string;
  /** curriculum_topics/chapter_concepts id when known, else null. */
  conceptId: string | null;
  /** Machine-readable reason category. */
  whyNow: WhyNowKind;
  /** Student-facing bilingual justification (P7). */
  reason: BilingualText;
}

/**
 * The four PRIMARY post-answer learning actions the Director may suggest. This
 * is the structural subset of the UI `LearningActionType`
 * (packages/ui/src/foxy/ChatBubble.tsx: 'got_it' | 'explain_simpler' |
 * 'show_example' | 'quiz_me' | 'save') MINUS 'save' — the notebook action the
 * Director never advises. Declared locally so this pure lib module never
 * imports the React UI package; `SuggestedButton[]` is assignable to
 * `LearningActionType[]` at the route wiring point.
 */
export type SuggestedButton = 'got_it' | 'explain_simpler' | 'show_example' | 'quiz_me';

/** Kind of a recommended NEXT action the Director advises (never auto-runs). */
export type RecommendedActionKind =
  | 'quiz_concept' // formative check / recall on the current concept
  | 'review_prerequisite' // repair a blocking prerequisite
  | 'advance_topic' // move to the next ladder step
  | 'reflect'; // metacognitive reflection prompt

export interface RecommendedAction {
  kind: RecommendedActionKind;
  /** Bilingual, student-facing CTA label (P7). */
  label: BilingualText;
  /** Concept the action targets, when known. */
  conceptId?: string;
}

export interface TeachingPlan {
  /** What to teach + why now (bilingual reason). */
  currentObjective: TeachingObjective;
  /** The lesson step Foxy should run this turn (one of LESSON_STEPS). */
  lessonStep: LessonStep;
  /** ZPD difficulty target, 0-1, bounded by the Bloom ceilings. */
  difficultyTarget: number;
  /** Target Bloom level (canonical lowercase), bounded by ceilings. */
  targetBloom: BloomLevel;
  /** Persona depth ceiling (from resolvePedagogyRule). */
  depthCeiling: DepthCeiling;
  /** Context-aware subset of the four primary post-answer buttons. */
  suggestedButtons: SuggestedButton[];
  /** Advisory follow-up actions (never mutate XP/mastery). */
  recommendedNextActions: RecommendedAction[];
}

// ─── Structural input contracts (mirror apps/host read-surfaces) ─────────────

/**
 * Structural mirror of the fields this Director READS from apps/host's
 * `CognitiveContext` (apps/host/src/app/api/foxy/_lib/constants.ts). Declared
 * here because packages/lib must not depend on apps/host; the real
 * CognitiveContext (a superset) is assignable by structural typing.
 */
export interface DirectorCognitiveContext {
  weakTopics: Array<{ title: string; mastery: number; attempts: number }>;
  strongTopics: Array<{ title: string; mastery: number }>;
  knowledgeGaps: Array<{ target: string; prerequisite: string; gapType: string }>;
  revisionDue: Array<{ title: string; lastReviewed: string; mastery: number }>;
  recentErrors: Array<{ errorType: string; count: number }>;
  /** Output of the deriveNextAction 5-priority ladder, or null. */
  nextAction: { actionType: string; conceptName: string; reason: string } | null;
  masteryLevel: 'low' | 'medium' | 'high';
}

/**
 * Structural mirror of `ChapterTopicProgress`
 * (apps/host/src/app/api/foxy/_lib/cognitive-context.ts). Same boundary
 * rationale as above.
 */
export interface DirectorChapterProgress {
  orderedTopics: string[];
  currentTopic: string | null;
  nextTopic: string | null;
  nextTopicId: string | null;
}

/**
 * The latest per-turn perception signal (optional). Structural subset of
 * `TurnClassification` (packages/lib/src/foxy/perception.ts) — the Director
 * only reads the struggle signal + Bloom level (+ misconception presence).
 */
export interface DirectorPerceptionSignal {
  struggleSignal?: StruggleSignal;
  bloomLevel?: BloomLevel | null;
  misconceptionCode?: string | null;
}

export interface TeachingDirectorInput {
  /** Already-loaded cognitive context (RLS/service-role loaded upstream). */
  cognitiveContext: DirectorCognitiveContext;
  /** Ordered chapter topic ladder + next-unmastered target. */
  chapterProgress: DirectorChapterProgress;
  /** Academic-goal persona / goalCode; tolerant of unknown (safe fallback). */
  persona: GoalCode | string | null | undefined;
  /**
   * Session-persisted lesson state. null → start of LESSON_STEPS ('hook').
   * Otherwise the Director advances the ladder via getNextLessonStep.
   */
  lessonStepState: LessonState | null;
  /** Optional longitudinal digital-twin context. NEVER required. */
  twin?: TwinContext | null;
  /** Optional latest perception signal for this turn. */
  perception?: DirectorPerceptionSignal | null;
}

// ─── depthCeiling → max Bloom index ──────────────────────────────────────────
//
// The persona depthCeiling caps how DEEP (cognitively) the Director may push,
// independent of grade: within-grade CBSE tops out at analyze; board rigor
// reaches evaluate; JEE/NEET + olympiad reach create. This is one of the two
// bounds the task mandates (the other is the mastery → max-Bloom ceiling).
const DEPTH_CEILING_MAX_BLOOM: Record<DepthCeiling, BloomLevel> = {
  within_grade: 'analyze',
  board_rigorous: 'evaluate',
  jee_neet: 'create',
  olympiad: 'create',
};

// Struggle signals that indicate the student is in cognitive difficulty (as
// opposed to a clean 'none' turn). MIRRORS the StruggleSignal union minus
// 'none'; kept as literals so this stays a pure module (the StruggleSignal type
// import above makes any drift in the union a compile error here).
const HARD_STRUGGLE_SIGNALS: ReadonlySet<StruggleSignal> = new Set<StruggleSignal>([
  'repeated_wrong',
  'give_up',
  'explicit_confusion',
]);

// ─── Small pure helpers ──────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isStruggleSignal(sig: StruggleSignal | undefined): sig is StruggleSignal {
  return typeof sig === 'string' && sig !== 'none';
}

/**
 * Highest Bloom index the student has "earned" given their mastery, using the
 * BLOOM_CEILING per-level score cap as the inverse mapping. Returns -1 when the
 * student has not even cleared the remember ceiling (mastery < 0.45).
 */
function masteryCeilingIndex(mastery: number): number {
  let idx = -1;
  for (let i = 0; i < BLOOM_LEVELS.length; i++) {
    if (BLOOM_CEILING[BLOOM_LEVELS[i]] <= mastery) idx = i;
  }
  return idx;
}

// ─── Objective selection (priority ladder) ───────────────────────────────────

function mapActionToWhyNow(
  actionType: string,
  conceptName: string,
  gaps: DirectorCognitiveContext['knowledgeGaps'],
): WhyNowKind {
  switch (actionType) {
    case 'remediate': {
      // A prerequisite gap where the concept IS the named prerequisite is a
      // prerequisite-block; otherwise it's a plain gap.
      const target = conceptName.trim().toLowerCase();
      const isPrereq = gaps.some(
        (g) => g.prerequisite.trim().length > 0 && g.prerequisite.trim().toLowerCase() === target,
      );
      return isPrereq ? 'prerequisite-block' : 'gap';
    }
    case 're_teach':
      return 'gap';
    case 'revise':
      return 'overdue-review';
    case 'practice':
    case 'challenge':
    default:
      return 'next-in-ladder';
  }
}

function buildReason(whyNow: WhyNowKind, concept: string): BilingualText {
  const c = concept.trim();
  if (!c) {
    return {
      en: "Let's start with the fundamentals of this chapter.",
      hi: 'चलो इस अध्याय की बुनियादी बातों से शुरू करते हैं।',
    };
  }
  switch (whyNow) {
    case 'gap':
      return {
        en: `We're closing a knowledge gap in ${c} before moving ahead.`,
        hi: `आगे बढ़ने से पहले हम ${c} में एक कमी को दूर कर रहे हैं।`,
      };
    case 'prerequisite-block':
      return {
        en: `${c} is a prerequisite you need solid before the next topic.`,
        hi: `${c} एक ज़रूरी आधार है जिसे अगले टॉपिक से पहले पक्का करना है।`,
      };
    case 'overdue-review':
      return {
        en: `It's time to revisit ${c} so it stays fresh in your memory.`,
        hi: `${c} को दोहराने का समय है ताकि वह याद रहे।`,
      };
    case 'next-in-ladder':
    default:
      return {
        en: `You're ready for the next step: ${c}.`,
        hi: `आप अगले चरण के लिए तैयार हैं: ${c}।`,
      };
  }
}

/**
 * Choose the objective. Priority (task-mandated):
 *   1. cognitiveContext.nextAction (the deriveNextAction ladder output)
 *   2. next-unmastered topic in the chapter ladder
 *   3. an overdue review
 *   4. cold-start fallback (current/first topic, else generic getting-started)
 */
function selectObjective(
  ctx: DirectorCognitiveContext,
  chapter: DirectorChapterProgress,
): TeachingObjective {
  // 1. Next-action ladder (already computed by deriveNextAction upstream).
  if (ctx.nextAction && ctx.nextAction.conceptName.trim().length > 0) {
    const na = ctx.nextAction;
    const whyNow = mapActionToWhyNow(na.actionType, na.conceptName, ctx.knowledgeGaps);
    // We only know the id if the concept coincides with the ladder's next topic.
    const conceptId =
      na.conceptName.trim().toLowerCase() === (chapter.nextTopic ?? '').trim().toLowerCase()
        ? chapter.nextTopicId
        : null;
    return {
      conceptName: na.conceptName.trim(),
      conceptId,
      whyNow,
      reason: buildReason(whyNow, na.conceptName),
    };
  }

  // 2. Next-unmastered in the chapter ladder.
  if (chapter.nextTopic && chapter.nextTopic.trim().length > 0) {
    return {
      conceptName: chapter.nextTopic.trim(),
      conceptId: chapter.nextTopicId,
      whyNow: 'next-in-ladder',
      reason: buildReason('next-in-ladder', chapter.nextTopic),
    };
  }

  // 3. Overdue review (weakest-first order preserved from upstream).
  const due = ctx.revisionDue.find((r) => r.title.trim().length > 0);
  if (due) {
    return {
      conceptName: due.title.trim(),
      conceptId: null,
      whyNow: 'overdue-review',
      reason: buildReason('overdue-review', due.title),
    };
  }

  // 4. Cold-start — current topic, else the first ordered topic, else generic.
  const cold =
    (chapter.currentTopic && chapter.currentTopic.trim()) ||
    (chapter.orderedTopics.find((t) => t.trim().length > 0) ?? '').trim();
  return {
    conceptName: cold,
    conceptId: null,
    whyNow: 'next-in-ladder',
    reason: buildReason('next-in-ladder', cold),
  };
}

// ─── ZPD + Bloom bounding ────────────────────────────────────────────────────

function deriveCurrentMastery(ctx: DirectorCognitiveContext, conceptName: string): number {
  const c = conceptName.trim().toLowerCase();
  if (c) {
    const w = ctx.weakTopics.find((t) => t.title.trim().toLowerCase() === c);
    if (w) return clamp01(w.mastery / 100);
    const r = ctx.revisionDue.find((t) => t.title.trim().toLowerCase() === c);
    if (r) return clamp01(r.mastery / 100);
    const s = ctx.strongTopics.find((t) => t.title.trim().toLowerCase() === c);
    if (s) return clamp01(s.mastery / 100);
  }
  // Fall back to the coarse mastery bucket.
  return ctx.masteryLevel === 'low' ? 0.3 : ctx.masteryLevel === 'high' ? 0.8 : 0.55;
}

function deriveRecentAccuracy(
  perception: DirectorPerceptionSignal | null | undefined,
  twin: TwinContext | null | undefined,
): number {
  if (perception && isStruggleSignal(perception.struggleSignal)) return 0.4; // struggling
  if (perception && perception.struggleSignal === 'none') return 0.8; // clean turn
  // Cold start (no perception this turn). A non-empty twin with weak/decayed
  // topics is a longitudinal weakness signal → scaffold a little more.
  if (twin && !twin.isEmpty && (twin.weakTopics.length > 0 || twin.decayedTopics.length > 0)) {
    return 0.5;
  }
  return 0.6; // neutral
}

interface BoundedTarget {
  difficultyTarget: number;
  targetBloom: BloomLevel;
}

/**
 * Compute the ZPD target and bound it by BOTH ceilings:
 *   • mastery → max-Bloom ceiling: never above (earned ceiling + 1) level.
 *   • persona depthCeiling.
 * The perception Bloom level nudges the target within those bounds (build on a
 * demonstrated level after a clean turn; never push above where the student is
 * struggling), but the ceilings always win.
 */
function computeBoundedTarget(
  currentMastery: number,
  recentAccuracy: number,
  depthCeiling: DepthCeiling,
  perception: DirectorPerceptionSignal | null | undefined,
  struggling: boolean,
): BoundedTarget {
  const zpd = calculateZPD(currentMastery, recentAccuracy, []); // no per-Bloom masteries → difficultyToBloom
  let targetIdx = BLOOM_ORDER[zpd.targetBloomLevel];

  // Perception Bloom nudge (still capped by the ceilings below).
  if (perception && perception.bloomLevel) {
    const pIdx = BLOOM_ORDER[perception.bloomLevel];
    if (struggling) {
      targetIdx = Math.min(targetIdx, pIdx); // don't exceed where they struggle
    } else {
      targetIdx = Math.max(targetIdx, Math.min(pIdx + 1, BLOOM_LEVELS.length - 1)); // build +1
    }
  }

  // Ceiling 1: mastery → max Bloom (never above earned ceiling + 1).
  const masteryMaxIdx = Math.min(masteryCeilingIndex(currentMastery) + 1, BLOOM_LEVELS.length - 1);
  // Ceiling 2: persona depthCeiling.
  const depthMaxIdx = BLOOM_ORDER[DEPTH_CEILING_MAX_BLOOM[depthCeiling]];

  const boundedIdx = Math.max(0, Math.min(targetIdx, masteryMaxIdx, depthMaxIdx));
  const targetBloom = BLOOM_LEVELS[boundedIdx];

  // Keep difficulty coherent with the (possibly re-bounded) Bloom band.
  const [bloomLo, bloomHi] = bloomToDifficultyRange(targetBloom);
  let difficultyTarget = zpd.targetDifficulty;
  if (difficultyTarget > bloomHi) difficultyTarget = bloomHi;
  if (difficultyTarget < bloomLo) difficultyTarget = bloomLo;

  return { difficultyTarget: round2(clamp01(difficultyTarget)), targetBloom };
}

// ─── State classification + button/action selection ──────────────────────────

function isStrugglingState(
  perception: DirectorPerceptionSignal | null | undefined,
  ctx: DirectorCognitiveContext,
): boolean {
  if (perception && isStruggleSignal(perception.struggleSignal)) return true;
  if (ctx.masteryLevel === 'low') return true;
  if (ctx.recentErrors.some((e) => e.errorType === 'conceptual' && e.count >= 3)) return true;
  return false;
}

function isMasterySignalState(
  perception: DirectorPerceptionSignal | null | undefined,
  ctx: DirectorCognitiveContext,
): boolean {
  if (perception && perception.struggleSignal === 'none' && ctx.masteryLevel !== 'low') return true;
  if (ctx.nextAction?.actionType === 'challenge') return true;
  return false;
}

function selectButtons(
  struggling: boolean,
  masterySignal: boolean,
  targetBloomIdx: number,
): SuggestedButton[] {
  // Struggling wins — scaffold first, never quiz a struggling student.
  if (struggling) return ['explain_simpler', 'show_example', 'got_it'];
  // Fresh mastery signal — test it + advance.
  if (masterySignal) return ['quiz_me', 'got_it'];
  // A hard (higher-order) concept — offer simpler explanation + a worked example.
  if (targetBloomIdx >= BLOOM_ORDER.analyze) return ['explain_simpler', 'show_example', 'got_it'];
  // Balanced default.
  return ['got_it', 'show_example', 'quiz_me'];
}

/**
 * Derive a metacognitive reflection prompt via the reused getReflectionPrompt,
 * mapping the perception signal onto the (isCorrect, consecutiveErrors,
 * consecutiveCorrect) inputs it expects. Returns null when there is no
 * meaningful reflection to offer (e.g. a clean turn at a low Bloom level, or no
 * perception at all).
 */
function deriveReflection(
  perception: DirectorPerceptionSignal | null | undefined,
  targetBloom: BloomLevel,
): ReflectionPrompt | null {
  if (!perception || !perception.struggleSignal) return null;
  const sig = perception.struggleSignal;
  if (sig === 'none') {
    // Clean turn → praise (mid Bloom) / transfer (high Bloom); null otherwise.
    return getReflectionPrompt(true, 0, 2, targetBloom);
  }
  if (HARD_STRUGGLE_SIGNALS.has(sig)) {
    return getReflectionPrompt(false, 3, 0, targetBloom); // pause
  }
  return getReflectionPrompt(false, 0, 0, targetBloom); // metacognitive
}

function withConceptId(base: RecommendedAction, conceptId: string | null): RecommendedAction {
  return conceptId ? { ...base, conceptId } : base;
}

function buildRecommendedActions(
  objective: TeachingObjective,
  masterySignal: boolean,
  reflection: ReflectionPrompt | null,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const c = objective.conceptName.trim();
  const cid = objective.conceptId;

  switch (objective.whyNow) {
    case 'gap':
    case 'prerequisite-block': {
      actions.push(
        withConceptId(
          {
            kind: 'review_prerequisite',
            label: c
              ? { en: `Review the building blocks of ${c}`, hi: `${c} की बुनियादी बातें दोहराओ` }
              : { en: 'Review the building blocks first', hi: 'पहले बुनियादी बातें दोहराओ' },
          },
          cid,
        ),
      );
      actions.push(
        withConceptId(
          {
            kind: 'quiz_concept',
            label: c
              ? { en: `Try a quick check on ${c}`, hi: `${c} पर एक छोटा टेस्ट दो` }
              : { en: 'Try a quick check', hi: 'एक छोटा टेस्ट दो' },
          },
          cid,
        ),
      );
      break;
    }
    case 'overdue-review': {
      actions.push(
        withConceptId(
          {
            kind: 'quiz_concept',
            label: c
              ? { en: `Quick recall quiz on ${c}`, hi: `${c} पर त्वरित स्मरण क्विज़` }
              : { en: 'Quick recall quiz', hi: 'त्वरित स्मरण क्विज़' },
          },
          cid,
        ),
      );
      break;
    }
    case 'next-in-ladder':
    default: {
      actions.push(
        withConceptId(
          {
            kind: 'quiz_concept',
            label: c
              ? { en: `Practice ${c} with a few questions`, hi: `${c} के कुछ सवालों से अभ्यास करो` }
              : { en: 'Start with a few practice questions', hi: 'कुछ अभ्यास सवालों से शुरू करो' },
          },
          cid,
        ),
      );
      if (masterySignal) {
        actions.push({
          kind: 'advance_topic',
          label: { en: 'Move on to the next topic', hi: 'अगले टॉपिक पर बढ़ो' },
        });
      }
      break;
    }
  }

  if (reflection) {
    actions.push({
      kind: 'reflect',
      label: { en: reflection.message, hi: reflection.messageHi },
    });
  }

  return actions;
}

// ─── Lesson-step advance ─────────────────────────────────────────────────────

function nextLessonStep(state: LessonState | null): LessonStep {
  if (!state) return LESSON_STEPS[0]; // cold start → 'hook'
  const next = getNextLessonStep(state);
  // 'complete' → hold on the final consolidation step; recommendedNextActions
  // carry the student forward (advance_topic) when ready.
  return next === 'complete' ? LESSON_STEPS[LESSON_STEPS.length - 1] : next;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compose an explicit, deterministic teaching plan from the learner's current
 * state. Pure — no IO, no side effects. Safe to call on the Foxy hot path and
 * to reuse from reports.
 */
export function composeTeachingPlan(input: TeachingDirectorInput): TeachingPlan {
  const { cognitiveContext: ctx, chapterProgress: chapter, persona, perception, twin } = input;

  // 1. What to teach + why now.
  const objective = selectObjective(ctx, chapter);

  // 2. Persona pedagogy rule → depthCeiling (+ productive-failure policy).
  const rule = resolvePedagogyRule(persona, 'daily', 'zpd_problem');

  // 3. State classification (struggling / mastery-signal) drives buttons.
  const struggling = isStrugglingState(perception, ctx);
  const masterySignal = !struggling && isMasterySignalState(perception, ctx);

  // 4. ZPD target, bounded by the two Bloom ceilings.
  const currentMastery = deriveCurrentMastery(ctx, objective.conceptName);
  const recentAccuracy = deriveRecentAccuracy(perception, twin);
  const { difficultyTarget, targetBloom } = computeBoundedTarget(
    currentMastery,
    recentAccuracy,
    rule.depthCeiling,
    perception,
    struggling,
  );

  // 5. Lesson step + context-aware buttons + advisory next actions.
  const lessonStep = nextLessonStep(input.lessonStepState);
  const suggestedButtons = selectButtons(struggling, masterySignal, BLOOM_ORDER[targetBloom]);
  const reflection = deriveReflection(perception, targetBloom);
  const recommendedNextActions = buildRecommendedActions(objective, masterySignal, reflection);

  return {
    currentObjective: objective,
    lessonStep,
    difficultyTarget,
    targetBloom,
    depthCeiling: rule.depthCeiling,
    suggestedButtons,
    recommendedNextActions,
  };
}

/**
 * Apply olympiad mode overrides to a teaching plan:
 * - targetBloom clamped to min 'analyze' (index 3)
 * - depthCeiling forced to 'olympiad'
 * - suppress 'explain_simpler', add 'show_strategy' button variant
 *
 * Gated by ff_foxy_olympiad_mode_v1; caller only invokes when mode='olympiad'.
 */
export function applyOlympiadOverrides(plan: TeachingPlan): TeachingPlan {
  const analyzeIdx = BLOOM_ORDER.analyze;
  const currentIdx = BLOOM_ORDER[plan.targetBloom];
  const targetBloom = currentIdx < analyzeIdx
    ? BLOOM_LEVELS[analyzeIdx]
    : plan.targetBloom;

  const suggestedButtons = plan.suggestedButtons
    .filter((b) => b !== 'explain_simpler')
    .concat('quiz_me') as TeachingPlan['suggestedButtons'];

  return {
    ...plan,
    targetBloom,
    depthCeiling: 'olympiad',
    suggestedButtons,
  };
}
