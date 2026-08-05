/**
 * Foxy North-Star L4 — buildDirectorPedagogySection renderer pin.
 *
 * The renderer emits ONE resolved branch of the 5-mode pedagogy tree
 * (PREREQUISITE_CHECK / MISCONCEPTION_REPAIR / STRETCH / SOCRATIC /
 * NEW_TOPIC) plus the two standing quality/progression blocks. This test:
 *   (a) covers all 5 modes,
 *   (b) asserts the correct closing-question kind per mode,
 *   (c) asserts the two standing blocks are always carried through, and
 *   (d) pins the threshold-drift contract — FOXY_MASTERY_LOW/HIGH must
 *       appear verbatim (0.4 / 0.7) in the grounded-answer inline prompt
 *       file so the numeric mirror stays in lockstep.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  buildDirectorPedagogySection,
  DIRECTOR_CLOSING_QUESTION_QUALITY_BLOCK,
  DIRECTOR_CHAPTER_PROGRESSION_BLOCK,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { TEACHING_DIRECTOR_CONFIG } from '@alfanumrik/lib/foxy/teaching-director-config';
import {
  FOXY_MASTERY_LOW,
  FOXY_MASTERY_HIGH,
} from '@alfanumrik/lib/learner-model';
import type { TeachingPlan } from '@alfanumrik/lib/foxy/teaching-director';

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'supabase', 'functions'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (supabase/functions) not found');
}

function makePlan(overrides: Partial<TeachingPlan> = {}): TeachingPlan {
  const base: TeachingPlan = {
    currentObjective: {
      conceptName: 'Fractions',
      conceptId: null,
      whyNow: 'next-in-ladder',
      reason: {
        en: 'The next unmastered step in this chapter.',
        hi: 'इस अध्याय में अगला अभी-सीखा-नहीं गया चरण।',
      },
    },
    lessonStep: 'hook',
    difficultyTarget: 0.55,
    targetBloom: 'apply',
    depthCeiling: 'within_grade',
    suggestedButtons: ['got_it', 'show_example'],
    recommendedNextActions: [],
  };
  return { ...base, ...overrides };
}

describe('buildDirectorPedagogySection — 5-mode renderer coverage', () => {
  it('PREREQUISITE_CHECK (whyNow: prerequisite-block) → SCAFFOLD close', () => {
    const s = buildDirectorPedagogySection(
      makePlan({
        currentObjective: {
          conceptName: 'Integers',
          conceptId: null,
          whyNow: 'prerequisite-block',
          reason: {
            en: 'A named prerequisite is blocking the next topic.',
            hi: 'एक नामित पूर्वापेक्षा अगले विषय को रोक रही है।',
          },
        },
      }),
    );
    expect(s).toContain('THIS TURN: PREREQUISITE CHECK on Integers.');
    expect(s).toContain('End with a SCAFFOLD question.');
    expect(s).toContain(DIRECTOR_CLOSING_QUESTION_QUALITY_BLOCK);
    expect(s).toContain(DIRECTOR_CHAPTER_PROGRESSION_BLOCK);
  });

  it('MISCONCEPTION_REPAIR (whyNow: gap) → CHECK close', () => {
    const s = buildDirectorPedagogySection(
      makePlan({
        currentObjective: {
          conceptName: 'Fractions',
          conceptId: null,
          whyNow: 'gap',
          reason: {
            en: 'A gap must be closed before advancing.',
            hi: 'आगे बढ़ने से पहले अंतर को भरना है।',
          },
        },
      }),
    );
    expect(s).toContain('THIS TURN: MISCONCEPTION REPAIR on Fractions.');
    expect(s).toContain('End with a CHECK question.');
  });

  it('SOCRATIC (whyNow: overdue-review) → SCAFFOLD close', () => {
    const s = buildDirectorPedagogySection(
      makePlan({
        currentObjective: {
          conceptName: 'Decimals',
          conceptId: null,
          whyNow: 'overdue-review',
          reason: {
            en: 'A previously-learned concept is fading.',
            hi: 'पहले सीखा गया विषय मंद पड़ रहा है।',
          },
        },
      }),
    );
    expect(s).toContain('THIS TURN: SOCRATIC SCAFFOLDING on Decimals.');
    expect(s).toContain('End with a SCAFFOLD question.');
  });

  it('NEW_TOPIC (whyNow: next-in-ladder) → CHECK close', () => {
    const s = buildDirectorPedagogySection(makePlan());
    expect(s).toContain('THIS TURN: NEW TOPIC introduction on Fractions.');
    expect(s).toContain('End with a CHECK question.');
    // Deterministic — same input → same output.
    expect(s).toBe(buildDirectorPedagogySection(makePlan()));
  });

  it('STRETCH branch: closing kind is STRETCH per config mapping', () => {
    // STRETCH isn't produced by any WhyNowKind directly today (whyNow tops
    // out at 'next-in-ladder' in the director), but the config exposes the
    // STRETCH row so the ai-engineer wiring can escalate a plan to it. We
    // pin the row here so future callers know which closing to expect.
    expect(TEACHING_DIRECTOR_CONFIG.closingQuestionByMode.STRETCH).toBe('STRETCH');
    expect(TEACHING_DIRECTOR_CONFIG.closingQuestionTaxonomy.STRETCH.rubric.en).toMatch(
      /one Bloom level higher/i,
    );
    // HI rubric is Devanagari (P7 parity).
    expect(TEACHING_DIRECTOR_CONFIG.closingQuestionTaxonomy.STRETCH.rubric.hi).toMatch(
      /[ऀ-ॿ]/,
    );
  });

  it('renders both static blocks (CLOSING_QUESTION_QUALITY + CHAPTER_PROGRESSION)', () => {
    const s = buildDirectorPedagogySection(makePlan());
    expect(s.indexOf(DIRECTOR_CLOSING_QUESTION_QUALITY_BLOCK)).toBeGreaterThan(0);
    expect(s.indexOf(DIRECTOR_CHAPTER_PROGRESSION_BLOCK)).toBeGreaterThan(
      s.indexOf(DIRECTOR_CLOSING_QUESTION_QUALITY_BLOCK),
    );
  });

  it('includes bilingual reason (EN + HI) for the mode', () => {
    const s = buildDirectorPedagogySection(makePlan());
    expect(s).toContain('Reason (EN):');
    expect(s).toContain('Reason (HI):');
    expect(s).toMatch(/[ऀ-ॿ]/); // Devanagari present
  });

  it('carries lessonStep + targetBloom + depthCeiling into the directive', () => {
    const s = buildDirectorPedagogySection(
      makePlan({ lessonStep: 'practice', targetBloom: 'analyze', depthCeiling: 'jee_neet' }),
    );
    expect(s).toContain('Lesson step: practice.');
    expect(s).toContain('Target Bloom: analyze (depth ceiling jee_neet).');
  });
});

describe('teaching-director-config — threshold mirror-drift snapshot', () => {
  it('config thresholds are sourced from learner-model (no duplicates)', () => {
    expect(TEACHING_DIRECTOR_CONFIG.thresholds.masteryLow).toBe(FOXY_MASTERY_LOW);
    expect(TEACHING_DIRECTOR_CONFIG.thresholds.masteryHigh).toBe(FOXY_MASTERY_HIGH);
    expect(FOXY_MASTERY_LOW).toBe(0.4);
    expect(FOXY_MASTERY_HIGH).toBe(0.7);
  });

  it('vertical/lateral Bloom ratio matches inline.ts 70/30 rule at Apply+Analyze', () => {
    const r = TEACHING_DIRECTOR_CONFIG.verticalLateralBloomRatio;
    expect(r.verticalPct + r.lateralPct).toBe(100);
    expect(r.verticalPct).toBe(70);
    expect(r.lateralPct).toBe(30);
    expect([...r.appliesAt].sort()).toEqual(['analyze', 'apply']);
  });

  it('FOXY_MASTERY_LOW / HIGH appear verbatim in the grounded-answer inline prompt', () => {
    // Mirror-drift guard: if the TS constants change but inline.ts still
    // shows the old numeric literal (or vice versa), the pedagogy tree the
    // model reads diverges from the one the director resolves. Read the
    // real EF prompt file and grep the two numeric literals.
    const inlinePath = path.join(
      findRepoRoot(),
      'supabase',
      'functions',
      'grounded-answer',
      'prompts',
      'inline.ts',
    );
    const text = fs.readFileSync(inlinePath, 'utf8');
    // Both FOXY_TUTOR_V1 (lines 61-110) and FOXY_TUTOR_TEACH_V1
    // (lines 296-345) carry the pedagogy tree with the same literals.
    expect(text).toContain(`mastery on the queried topic or its prerequisites is < ${FOXY_MASTERY_LOW}`);
    expect(text).toContain(`mastery on the topic is >= ${FOXY_MASTERY_HIGH}`);
    expect(text).toContain(
      `for the middle band (mastery ${FOXY_MASTERY_LOW} to ${FOXY_MASTERY_HIGH})`,
    );
  });
});
