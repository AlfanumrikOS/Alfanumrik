/**
 * Foxy Teaching Director — Phase 2.1 route WIRING contract tests (2026-07-15).
 *
 * The PURE brain (composeTeachingPlan) is pinned separately in
 * lib/foxy/teaching-director.test.ts. This file pins the WIRING adapter
 * (apps/host/src/app/api/foxy/_lib/teaching-director.ts) + the route's
 * flag-gated injection/return/persist decision, all behind
 * ff_foxy_teaching_director_v1:
 *
 *   1. Flag ON, teaching turn → the additive `teaching_director_section` is
 *      built (conceptName + bilingual whyNow + lesson step + Bloom/depth) AND
 *      the wire returns `suggestedButtons` + `nextActions`.
 *   2. Flag OFF (or non-teaching quiz_me/practice turn) → section is '' and the
 *      wire OMITS both keys → BYTE-IDENTICAL to today.
 *   3. Director failure (compose throws) → safe no-op: null plan → '' section,
 *      no wire keys.
 *   4. loadLessonStepState reads foxy_sessions.lesson_step → LessonState | null
 *      (cold start on absent/invalid/error).
 *   5. persistLessonProgress advances lesson_step best-effort, and degrades to
 *      lesson_step-only when the objective concept id violates the
 *      chapter_concepts FK — the lesson step ALWAYS advances.
 *
 * Run against the REAL helpers + the REAL pure composeTeachingPlan with a fake
 * supabaseAdmin, so a refactor that drops the gate, the section, the wire
 * fields, or the persist fallback surfaces immediately. The route's gating
 * mirror (`resolveDirectorForTurn`) reflects route.ts and is tagged so drift is
 * caught in review.
 *
 * Owner: ai-engineer. P14 reviewers: assessment (pedagogy), testing, frontend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── logger mock (capture warns; assert P13 no-PII shape) ────────────────────
const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── supabaseAdmin stub ──────────────────────────────────────────────────────
// Configurable: select(...).eq(...).maybeSingle() resolves to {selectData,
// selectError}; update(...).eq(...) records the patch and drains updateResults.
const dbState: {
  selectData: unknown;
  selectError: unknown;
  updateResults: Array<{ error: unknown }>;
  updateCalls: Array<{ table: string; patch: Record<string, unknown> }>;
} = {
  selectData: null,
  selectError: null,
  updateResults: [],
  updateCalls: [],
};

function makeChain(table: string) {
  let pendingUpdatePatch: Record<string, unknown> | null = null;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.update = (patch: Record<string, unknown>) => {
    pendingUpdatePatch = patch;
    return chain;
  };
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: dbState.selectData, error: dbState.selectError });
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    if (pendingUpdatePatch) {
      dbState.updateCalls.push({ table, patch: pendingUpdatePatch });
      const result = dbState.updateResults.shift() ?? { error: null };
      return Promise.resolve(result).then(res, rej);
    }
    return Promise.resolve({ data: dbState.selectData, error: dbState.selectError }).then(res, rej);
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => makeChain(t) },
}));

// eslint-disable-next-line import/first
import {
  isTeachingTurn,
  lessonStateFromStep,
  loadLessonStepState,
  maybeComposeTeachingPlan,
  buildTeachingDirectorSection,
  persistLessonProgress,
  type TeachingPlan,
} from '@/app/api/foxy/_lib/teaching-director';
// eslint-disable-next-line import/first
import {
  composeTeachingPlan,
  type TeachingDirectorInput,
  type DirectorCognitiveContext,
  type DirectorChapterProgress,
} from '@alfanumrik/lib/foxy/teaching-director';
// eslint-disable-next-line import/first
import { LESSON_STEPS } from '@alfanumrik/lib/cognitive-engine';

const DEVANAGARI = /[ऀ-ॿ]/;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<DirectorCognitiveContext> = {}): DirectorCognitiveContext {
  return {
    weakTopics: [],
    strongTopics: [],
    knowledgeGaps: [],
    revisionDue: [],
    recentErrors: [],
    nextAction: null,
    masteryLevel: 'medium',
    ...overrides,
  };
}

function makeChapter(overrides: Partial<DirectorChapterProgress> = {}): DirectorChapterProgress {
  return {
    orderedTopics: [],
    currentTopic: null,
    nextTopic: null,
    nextTopicId: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<TeachingDirectorInput> = {}): TeachingDirectorInput {
  return {
    cognitiveContext: makeCtx(),
    chapterProgress: makeChapter(),
    persona: 'pass_comfortably',
    lessonStepState: null,
    twin: null,
    perception: null,
    ...overrides,
  };
}

/** A real plan produced by the pure Director for a next-in-ladder objective. */
function realPlan(): TeachingPlan {
  return composeTeachingPlan(
    makeInput({
      chapterProgress: makeChapter({
        orderedTopics: ['Fractions', 'Decimals'],
        nextTopic: 'Decimals',
        nextTopicId: 'topic-decimals-uuid',
      }),
    }),
  );
}

// ─── Route gating mirror ─────────────────────────────────────────────────────
// Mirror of route.ts /api/foxy Director block: the `directorTeachingTurn` gate,
// the APPEND of the directive to the `cognitive_context_section` template var
//   (base + twinPromptSection + (section ? `\n\n${section}` : '')),
// and the `...(teachingPlan ? {…} : {})` wire spread. If either drifts, BOTH
// the route and this mirror must update.
const BASE_COGNITIVE = '## COGNITIVE CONTEXT\nweak: Fractions';
const TWIN_SECTION = '\n\n## LONGITUDINAL LEARNING SIGNALS\ndecay: high';

function resolveDirectorForTurn(args: {
  flagEnabled: boolean;
  mode: string;
  isQuizMe: boolean;
  isRealPractice: boolean;
  /** what maybeComposeTeachingPlan returned (null on Director failure). */
  composed: TeachingPlan | null;
}): {
  cognitiveContextSection: string;
  wireFields: { suggestedButtons?: unknown; nextActions?: unknown };
} {
  const directorTeachingTurn =
    isTeachingTurn(args.mode) && !args.isQuizMe && !args.isRealPractice;
  let section = '';
  let plan: TeachingPlan | null = null;
  if (directorTeachingTurn && args.flagEnabled) {
    plan = args.composed;
    if (plan) section = buildTeachingDirectorSection(plan);
  }
  return {
    // Mirror of route.ts cognitive_context_section value.
    cognitiveContextSection:
      BASE_COGNITIVE + TWIN_SECTION + (section ? `\n\n${section}` : ''),
    wireFields: plan
      ? { suggestedButtons: plan.suggestedButtons, nextActions: plan.recommendedNextActions }
      : {},
  };
}

beforeEach(() => {
  loggerWarn.mockClear();
  loggerInfo.mockClear();
  dbState.selectData = null;
  dbState.selectError = null;
  dbState.updateResults = [];
  dbState.updateCalls = [];
});

// ─── isTeachingTurn ──────────────────────────────────────────────────────────

describe('isTeachingTurn', () => {
  it('teaching modes are teaching turns', () => {
    for (const m of ['learn', 'explain', 'revise', 'doubt', 'homework', 'explorer']) {
      expect(isTeachingTurn(m)).toBe(true);
    }
  });
  it("'practice' (quiz_me / practice / real-practice all promote to practice) is NOT a teaching turn", () => {
    expect(isTeachingTurn('practice')).toBe(false);
  });
});

// ─── lessonStateFromStep ─────────────────────────────────────────────────────

describe('lessonStateFromStep', () => {
  it("cold-first step 'hook' → no prior steps, null scores", () => {
    const s = lessonStateFromStep('hook');
    expect(s.currentStep).toBe('hook');
    expect(s.stepsCompleted).toEqual([]);
    expect(s.recallScore).toBeNull();
    expect(s.applicationScore).toBeNull();
  });
  it('mid-ladder step → stepsCompleted is the prefix before it', () => {
    const s = lessonStateFromStep('application');
    const idx = LESSON_STEPS.indexOf('application');
    expect(s.currentStep).toBe('application');
    expect(s.stepsCompleted).toEqual(LESSON_STEPS.slice(0, idx));
  });
});

// ─── buildTeachingDirectorSection (pure) ─────────────────────────────────────

describe('buildTeachingDirectorSection', () => {
  it('contains conceptName + bilingual whyNow (EN + Devanagari HI) + lesson step + Bloom + depth', () => {
    const plan = realPlan();
    const section = buildTeachingDirectorSection(plan);

    expect(section).toContain('TEACHING DIRECTOR');
    // Concept the Director chose.
    expect(section).toContain(plan.currentObjective.conceptName);
    // Bilingual whyNow (P7): both EN and HI reason strings, HI is Devanagari.
    expect(section).toContain(plan.currentObjective.reason.en);
    expect(section).toContain(plan.currentObjective.reason.hi);
    expect(DEVANAGARI.test(section)).toBe(true);
    // Lesson step + target Bloom + persona depth ceiling all named.
    expect(section).toContain(plan.lessonStep);
    expect(section).toContain(plan.targetBloom);
    expect(section).toContain(plan.depthCeiling);
  });

  it('is ADDITIVE: reaffirms reference material is the only fact source (never overrides it)', () => {
    const section = buildTeachingDirectorSection(realPlan());
    expect(section.toLowerCase()).toContain('reference material');
    expect(section.toLowerCase()).toContain('only source');
  });

  it('cold-start empty concept → still emits a bilingual, safe section (no crash)', () => {
    // No nextAction, no ladder, no revisionDue → generic getting-started reason.
    const plan = composeTeachingPlan(makeInput());
    const section = buildTeachingDirectorSection(plan);
    expect(section).toContain('TEACHING DIRECTOR');
    expect(DEVANAGARI.test(section)).toBe(true);
  });
});

// ─── maybeComposeTeachingPlan (guarded) ──────────────────────────────────────

describe('maybeComposeTeachingPlan', () => {
  it('valid input → a plan with suggestedButtons + recommendedNextActions', () => {
    const plan = maybeComposeTeachingPlan(
      makeInput({
        chapterProgress: makeChapter({ nextTopic: 'Decimals', nextTopicId: 'id-1' }),
      }),
    );
    expect(plan).not.toBeNull();
    expect(Array.isArray(plan!.suggestedButtons)).toBe(true);
    expect(plan!.suggestedButtons.length).toBeGreaterThan(0);
    expect(Array.isArray(plan!.recommendedNextActions)).toBe(true);
  });

  it('Director failure (malformed input throws) → null (safe no-op)', () => {
    // Destructuring a null input throws inside composeTeachingPlan → guarded → null.
    const plan = maybeComposeTeachingPlan(null as unknown as TeachingDirectorInput);
    expect(plan).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      'foxy.teaching_director.compose_failed',
      expect.any(Object),
    );
  });
});

// ─── Route gating mirror: ON injects + returns; OFF byte-identical ───────────

describe('route Director gating (mirror of /api/foxy)', () => {
  // Baseline cognitive_context_section (base + twin) with NO director appended.
  const BYTE_IDENTICAL = BASE_COGNITIVE + TWIN_SECTION;

  it('flag ON + teaching turn + plan → directive APPENDED to cognitive_context_section AND wire returns suggestedButtons + nextActions', () => {
    const plan = realPlan();
    const out = resolveDirectorForTurn({
      flagEnabled: true,
      mode: 'learn',
      isQuizMe: false,
      isRealPractice: false,
      composed: plan,
    });
    // Directive is appended AFTER the existing base+twin cognitive context
    // (additive — the base is preserved verbatim as a prefix).
    expect(out.cognitiveContextSection.startsWith(BYTE_IDENTICAL)).toBe(true);
    expect(out.cognitiveContextSection.length).toBeGreaterThan(BYTE_IDENTICAL.length);
    expect(out.cognitiveContextSection).toContain('TEACHING DIRECTOR');
    expect(out.wireFields.suggestedButtons).toEqual(plan.suggestedButtons);
    expect(out.wireFields.nextActions).toEqual(plan.recommendedNextActions);
  });

  it('flag OFF → cognitive_context_section is byte-identical (base+twin only) and the wire OMITS both keys', () => {
    const out = resolveDirectorForTurn({
      flagEnabled: false,
      mode: 'learn',
      isQuizMe: false,
      isRealPractice: false,
      composed: realPlan(),
    });
    expect(out.cognitiveContextSection).toBe(BYTE_IDENTICAL);
    expect(Object.keys(out.wireFields)).toEqual([]);
  });

  it('non-teaching turns (practice / quiz_me / real-practice) never inject even with flag ON', () => {
    for (const turn of [
      { mode: 'practice', isQuizMe: false, isRealPractice: false }, // plain practice
      { mode: 'practice', isQuizMe: true, isRealPractice: false }, // quiz_me (promoted)
      { mode: 'practice', isQuizMe: false, isRealPractice: true }, // real-practice
    ]) {
      const out = resolveDirectorForTurn({
        flagEnabled: true,
        composed: realPlan(),
        ...turn,
      });
      expect(out.cognitiveContextSection).toBe(BYTE_IDENTICAL);
      expect(Object.keys(out.wireFields)).toEqual([]);
    }
  });

  it('flag ON + teaching turn but Director FAILED (composed=null) → safe no-op (byte-identical, no keys)', () => {
    const out = resolveDirectorForTurn({
      flagEnabled: true,
      mode: 'learn',
      isQuizMe: false,
      isRealPractice: false,
      composed: null,
    });
    expect(out.cognitiveContextSection).toBe(BYTE_IDENTICAL);
    expect(Object.keys(out.wireFields)).toEqual([]);
  });
});

// ─── loadLessonStepState (DB read, best-effort) ──────────────────────────────

describe('loadLessonStepState', () => {
  it('valid persisted step → reconstructed LessonState', async () => {
    dbState.selectData = { lesson_step: 'guided_examples' };
    const state = await loadLessonStepState('sess-1');
    expect(state).not.toBeNull();
    expect(state!.currentStep).toBe('guided_examples');
  });

  it('NULL lesson_step (cold start) → null', async () => {
    dbState.selectData = { lesson_step: null };
    expect(await loadLessonStepState('sess-1')).toBeNull();
  });

  it('unknown/invalid step string → null (not a LESSON_STEPS value)', async () => {
    dbState.selectData = { lesson_step: 'not_a_real_step' };
    expect(await loadLessonStepState('sess-1')).toBeNull();
  });

  it('DB error (e.g. column missing on un-migrated env) → null, never throws', async () => {
    dbState.selectData = null;
    dbState.selectError = { message: 'column "lesson_step" does not exist' };
    expect(await loadLessonStepState('sess-1')).toBeNull();
  });
});

// ─── persistLessonProgress (DB write, best-effort) ───────────────────────────

describe('persistLessonProgress', () => {
  it('conceptId absent → single write of lesson_step (+ null pointer)', async () => {
    const plan = composeTeachingPlan(makeInput()); // cold-start → conceptId null
    expect(plan.currentObjective.conceptId).toBeNull();
    await persistLessonProgress('sess-1', plan);
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.updateCalls[0].patch.lesson_step).toBe(plan.lessonStep);
    expect(dbState.updateCalls[0].patch.lesson_objective_concept_id).toBeNull();
  });

  it('conceptId present + write succeeds → single write of both columns', async () => {
    const plan = realPlan(); // nextTopicId set → conceptId present
    expect(plan.currentObjective.conceptId).toBe('topic-decimals-uuid');
    dbState.updateResults = [{ error: null }];
    await persistLessonProgress('sess-1', plan);
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.updateCalls[0].patch.lesson_step).toBe(plan.lessonStep);
    expect(dbState.updateCalls[0].patch.lesson_objective_concept_id).toBe('topic-decimals-uuid');
  });

  it('conceptId FK-violates chapter_concepts → falls back to lesson_step-only; step STILL advances', async () => {
    const plan = realPlan();
    // First (both-column) write fails the FK; fallback (step-only) succeeds.
    dbState.updateResults = [{ error: { code: '23503' } }, { error: null }];
    await persistLessonProgress('sess-1', plan);
    expect(dbState.updateCalls).toHaveLength(2);
    // Fallback write advances the step and nulls the concept pointer.
    expect(dbState.updateCalls[1].patch.lesson_step).toBe(plan.lessonStep);
    expect(dbState.updateCalls[1].patch.lesson_objective_concept_id).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      'foxy.teaching_director.persist_concept_id_skipped',
      expect.objectContaining({ reason: '23503' }),
    );
  });
});
