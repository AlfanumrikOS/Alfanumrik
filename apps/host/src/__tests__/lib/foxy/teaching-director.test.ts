import { describe, it, expect } from 'vitest';

/**
 * Foxy Teaching Director (Phase 2.1) — pure pedagogy brain.
 *
 * Pins the assessment-owned rules for composeTeachingPlan:
 *   - objective selection ladder (gap / overdue / unmastered / cold-start)
 *   - bilingual whyNow reasons (P7)
 *   - lesson-step progression across calls (getNextLessonStep reuse)
 *   - ZPD target bounded by BOTH the persona depthCeiling and the
 *     mastery → max-Bloom ceiling (never above earned-ceiling + 1)
 *   - context-aware suggestedButtons per state
 *   - advisory recommendedNextActions (never invent XP/mastery)
 *   - determinism / purity
 *
 * Owner: assessment. P14 reviewers: ai-engineer (route wiring), testing, quality.
 */

import {
  composeTeachingPlan,
  type TeachingDirectorInput,
  type DirectorCognitiveContext,
  type DirectorChapterProgress,
} from '@alfanumrik/lib/foxy/teaching-director';
import { LESSON_STEPS, type LessonState } from '@alfanumrik/lib/cognitive-engine';

// ─── Factories ───────────────────────────────────────────────────────────────

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

const DEVANAGARI = /[ऀ-ॿ]/;

function assertBilingual(text: { en: string; hi: string }): void {
  expect(text.en.trim().length).toBeGreaterThan(0);
  expect(text.hi.trim().length).toBeGreaterThan(0);
  expect(DEVANAGARI.test(text.hi)).toBe(true);
}

// ─── Objective selection ─────────────────────────────────────────────────────

describe('composeTeachingPlan — objective selection', () => {
  it('gap → remediate objective (whyNow=gap) with bilingual reason', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({
          nextAction: { actionType: 'remediate', conceptName: 'Decimals', reason: 'x' },
          knowledgeGaps: [{ target: 'Decimals', prerequisite: '', gapType: 'weak_prerequisite' }],
        }),
      }),
    );
    expect(plan.currentObjective.conceptName).toBe('Decimals');
    expect(plan.currentObjective.whyNow).toBe('gap');
    expect(plan.currentObjective.reason.en).toContain('Decimals');
    assertBilingual(plan.currentObjective.reason);
  });

  it('remediate a NAMED prerequisite → whyNow=prerequisite-block', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({
          nextAction: { actionType: 'remediate', conceptName: 'Fractions', reason: 'x' },
          knowledgeGaps: [
            { target: 'Decimals', prerequisite: 'Fractions', gapType: 'weak_prerequisite' },
          ],
        }),
      }),
    );
    expect(plan.currentObjective.whyNow).toBe('prerequisite-block');
    expect(plan.currentObjective.reason.en).toContain('prerequisite');
    assertBilingual(plan.currentObjective.reason);
  });

  it('overdue review → whyNow=overdue-review (from revisionDue when no action/ladder)', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({
          revisionDue: [
            { title: 'Photosynthesis', lastReviewed: '2026-01-01T00:00:00Z', mastery: 40 },
          ],
        }),
        chapterProgress: makeChapter(),
      }),
    );
    expect(plan.currentObjective.conceptName).toBe('Photosynthesis');
    expect(plan.currentObjective.whyNow).toBe('overdue-review');
    expect(plan.currentObjective.reason.en).toContain('revisit');
    assertBilingual(plan.currentObjective.reason);
  });

  it('unmastered → advance objective from the chapter ladder (carries conceptId)', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({ nextAction: null }),
        chapterProgress: makeChapter({
          orderedTopics: ['Intro', 'Linear Equations', 'Graphs'],
          currentTopic: 'Intro',
          nextTopic: 'Linear Equations',
          nextTopicId: 'topic-uuid-1',
        }),
      }),
    );
    expect(plan.currentObjective.conceptName).toBe('Linear Equations');
    expect(plan.currentObjective.conceptId).toBe('topic-uuid-1');
    expect(plan.currentObjective.whyNow).toBe('next-in-ladder');
    expect(plan.currentObjective.reason.en).toContain('Linear Equations');
    assertBilingual(plan.currentObjective.reason);
  });

  it('nextAction takes priority over the chapter ladder', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({
          nextAction: { actionType: 'revise', conceptName: 'Ohm law', reason: 'x' },
        }),
        chapterProgress: makeChapter({ nextTopic: 'Circuits', nextTopicId: 'c-1' }),
      }),
    );
    expect(plan.currentObjective.conceptName).toBe('Ohm law');
    expect(plan.currentObjective.whyNow).toBe('overdue-review');
  });
});

// ─── Lesson-step progression ─────────────────────────────────────────────────

describe('composeTeachingPlan — lesson step progression', () => {
  it('null lessonStepState → starts at the first lesson step (hook)', () => {
    const plan = composeTeachingPlan(makeInput({ lessonStepState: null }));
    expect(plan.lessonStep).toBe(LESSON_STEPS[0]);
    expect(plan.lessonStep).toBe('hook');
  });

  it('advances hook → visualization → guided_examples → active_recall across calls', () => {
    const walk = (currentStep: LessonState['currentStep'], recallScore: number | null = null) =>
      composeTeachingPlan(
        makeInput({
          lessonStepState: { currentStep, stepsCompleted: [], recallScore, applicationScore: null },
        }),
      ).lessonStep;

    expect(walk('hook')).toBe('visualization');
    expect(walk('visualization')).toBe('guided_examples');
    expect(walk('guided_examples')).toBe('active_recall');
    // Gating: active_recall with a weak recall score loops back to guided_examples.
    expect(walk('active_recall', 0.4)).toBe('guided_examples');
    // Gating cleared: recall >= 0.6 advances to application.
    expect(walk('active_recall', 0.8)).toBe('application');
    expect(walk('application')).toBe('spaced_revision');
    // 'complete' is held on the final consolidation step (∈ LESSON_STEPS).
    expect(walk('spaced_revision')).toBe('spaced_revision');
  });
});

// ─── ZPD bounding ────────────────────────────────────────────────────────────

describe('composeTeachingPlan — ZPD bounded by ceilings', () => {
  // A near-mastered concept (0.97) whose Bloom target would otherwise be
  // 'create'. The persona depthCeiling must cap it.
  const nearMastered = () =>
    makeCtx({
      masteryLevel: 'high',
      nextAction: { actionType: 'challenge', conceptName: 'Trigonometry', reason: 'x' },
      strongTopics: [{ title: 'Trigonometry', mastery: 97 }],
    });

  it('within_grade persona caps target Bloom at analyze', () => {
    const plan = composeTeachingPlan(
      makeInput({ persona: 'pass_comfortably', cognitiveContext: nearMastered() }),
    );
    expect(plan.depthCeiling).toBe('within_grade');
    expect(plan.targetBloom).toBe('analyze');
    // difficulty stays within the analyze band ([0.5, 0.667]).
    expect(plan.difficultyTarget).toBeLessThanOrEqual(0.67);
  });

  it('olympiad persona lets the same near-mastered concept reach create', () => {
    const plan = composeTeachingPlan(
      makeInput({ persona: 'olympiad', cognitiveContext: nearMastered() }),
    );
    expect(plan.depthCeiling).toBe('olympiad');
    expect(plan.targetBloom).toBe('create');
  });

  it('low mastery is capped at remember by the mastery→max-Bloom ceiling (never above ceiling+1)', () => {
    const plan = composeTeachingPlan(
      makeInput({
        persona: 'olympiad', // even the deepest persona cannot lift a beginner
        cognitiveContext: makeCtx({ masteryLevel: 'low' }),
        chapterProgress: makeChapter({ nextTopic: 'Atoms', nextTopicId: 'a-1' }),
      }),
    );
    expect(plan.targetBloom).toBe('remember');
    // difficulty stays within the remember band ([0, 0.167]).
    expect(plan.difficultyTarget).toBeLessThanOrEqual(0.17);
  });

  it('depthCeiling output mirrors the resolved persona rule (unknown persona → within_grade)', () => {
    expect(composeTeachingPlan(makeInput({ persona: 'competitive_exam' })).depthCeiling).toBe(
      'jee_neet',
    );
    expect(composeTeachingPlan(makeInput({ persona: null })).depthCeiling).toBe('within_grade');
    expect(composeTeachingPlan(makeInput({ persona: 'not-a-persona' })).depthCeiling).toBe(
      'within_grade',
    );
  });
});

// ─── Suggested buttons per state ─────────────────────────────────────────────

describe('composeTeachingPlan — suggestedButtons per state', () => {
  it('a struggling student gets explain_simpler first, no quiz_me', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({ masteryLevel: 'medium' }),
        perception: { struggleSignal: 'repeated_wrong', bloomLevel: 'apply' },
      }),
    );
    expect(plan.suggestedButtons[0]).toBe('explain_simpler');
    expect(plan.suggestedButtons).toEqual(['explain_simpler', 'show_example', 'got_it']);
    expect(plan.suggestedButtons).not.toContain('quiz_me');
  });

  it('a fresh mastery signal gets quiz_me + got_it', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({ masteryLevel: 'high' }),
        perception: { struggleSignal: 'none', bloomLevel: 'understand' },
        chapterProgress: makeChapter({ nextTopic: 'Vectors', nextTopicId: 'v-1' }),
      }),
    );
    expect(plan.suggestedButtons).toEqual(['quiz_me', 'got_it']);
  });

  it('a hard (higher-order) concept, not struggling, gets scaffolding buttons', () => {
    const plan = composeTeachingPlan(
      makeInput({
        persona: 'board_topper',
        cognitiveContext: makeCtx({ masteryLevel: 'high' }), // → analyze target, no perception
        chapterProgress: makeChapter({ nextTopic: 'Thermodynamics', nextTopicId: 't-1' }),
        perception: null,
      }),
    );
    expect(plan.targetBloom).toBe('analyze');
    expect(plan.suggestedButtons).toEqual(['explain_simpler', 'show_example', 'got_it']);
  });

  it('a balanced default state offers got_it / show_example / quiz_me', () => {
    const plan = composeTeachingPlan(
      makeInput({
        persona: 'pass_comfortably',
        cognitiveContext: makeCtx({ masteryLevel: 'medium' }),
        chapterProgress: makeChapter({ nextTopic: 'Nouns', nextTopicId: 'n-1' }),
        perception: null,
      }),
    );
    expect(plan.suggestedButtons).toEqual(['got_it', 'show_example', 'quiz_me']);
  });
});

// ─── Recommended next actions (advisory only) ────────────────────────────────

describe('composeTeachingPlan — recommendedNextActions', () => {
  it('a gap recommends reviewing the prerequisite then a quick check (bilingual)', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({
          nextAction: { actionType: 'remediate', conceptName: 'Fractions', reason: 'x' },
          knowledgeGaps: [
            { target: 'Ratios', prerequisite: 'Fractions', gapType: 'weak_prerequisite' },
          ],
        }),
      }),
    );
    const kinds = plan.recommendedNextActions.map((a) => a.kind);
    expect(kinds).toContain('review_prerequisite');
    expect(kinds).toContain('quiz_concept');
    for (const a of plan.recommendedNextActions) assertBilingual(a.label);
  });

  it('a mastery signal recommends advancing to the next topic', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({
          masteryLevel: 'high',
          nextAction: { actionType: 'challenge', conceptName: 'Vectors', reason: 'x' },
          strongTopics: [{ title: 'Vectors', mastery: 88 }],
        }),
        perception: { struggleSignal: 'none', bloomLevel: 'apply' },
      }),
    );
    const kinds = plan.recommendedNextActions.map((a) => a.kind);
    expect(kinds).toContain('advance_topic');
  });

  it('a struggling turn appends a reflect action sourced from getReflectionPrompt', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx({ masteryLevel: 'medium' }),
        perception: { struggleSignal: 'give_up', bloomLevel: 'apply' },
      }),
    );
    const reflect = plan.recommendedNextActions.find((a) => a.kind === 'reflect');
    expect(reflect).toBeDefined();
    assertBilingual(reflect!.label);
  });

  it('the Director never emits XP/mastery — only advisory action kinds', () => {
    const plan = composeTeachingPlan(
      makeInput({
        chapterProgress: makeChapter({ nextTopic: 'Cells', nextTopicId: 'cell-1' }),
      }),
    );
    const allowed = new Set(['quiz_concept', 'review_prerequisite', 'advance_topic', 'reflect']);
    for (const a of plan.recommendedNextActions) {
      expect(allowed.has(a.kind)).toBe(true);
      expect(a).not.toHaveProperty('xp');
      expect(a).not.toHaveProperty('mastery');
    }
  });
});

// ─── Cold start + purity ─────────────────────────────────────────────────────

describe('composeTeachingPlan — cold start & purity', () => {
  it('cold start (no signal, no perception, no twin) produces a safe generic plan', () => {
    const plan = composeTeachingPlan(
      makeInput({
        cognitiveContext: makeCtx(),
        chapterProgress: makeChapter(),
        lessonStepState: null,
        perception: null,
        twin: null,
      }),
    );
    expect(plan.lessonStep).toBe('hook');
    expect(plan.currentObjective.whyNow).toBe('next-in-ladder');
    // Generic (empty concept) bilingual getting-started reason.
    assertBilingual(plan.currentObjective.reason);
    expect(plan.suggestedButtons.length).toBeGreaterThan(0);
    expect(plan.recommendedNextActions.length).toBeGreaterThan(0);
    for (const a of plan.recommendedNextActions) assertBilingual(a.label);
    // No perception → no reflect action.
    expect(plan.recommendedNextActions.some((a) => a.kind === 'reflect')).toBe(false);
  });

  it('is deterministic — identical inputs produce deep-equal plans', () => {
    const input = makeInput({
      cognitiveContext: makeCtx({
        nextAction: { actionType: 'practice', conceptName: 'Motion', reason: 'x' },
      }),
      chapterProgress: makeChapter({ nextTopic: 'Motion', nextTopicId: 'm-1' }),
      perception: { struggleSignal: 'none', bloomLevel: 'understand' },
    });
    expect(composeTeachingPlan(input)).toEqual(composeTeachingPlan(input));
  });

  it('an optional twin never breaks the plan and is not required', () => {
    const withTwin = composeTeachingPlan(
      makeInput({
        chapterProgress: makeChapter({ nextTopic: 'Acids', nextTopicId: 'ac-1' }),
        twin: {
          weakTopics: [{ topicId: 't-9', mastery: 0.2 }],
          decayedTopics: [],
          dominantErrorTypes: ['conceptual'],
          misconceptionClusterCount: 1,
          cohortPercentile: 30,
          highlights: [],
          isEmpty: false,
        },
      }),
    );
    expect(withTwin.currentObjective.conceptName).toBe('Acids');
    expect(withTwin.targetBloom).toBeTypeOf('string');
  });
});
