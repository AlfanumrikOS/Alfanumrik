/**
 * `@alfanumrik/lib/diagnostic/evidence` — the assessment rulings behind
 * Phase 5C (derived weak/strong topics) and Phase 5D (damped diagnostic
 * mastery seeding).
 *
 * WHY THESE ARE PINNED HERE AND NOT ONLY AT THE ROUTE
 * Both rulings are numbers with a justification, and the justification is only
 * enforceable if the numbers cannot be quietly edited:
 *
 *   - The BKT damping is what stops a 15-question cold-start check from
 *     speaking with the authority of sustained practice. If someone "cleans up"
 *     `DIAGNOSTIC_BKT_PARAMS` back to the RPC defaults, every diagnostic answer
 *     starts moving `concept_mastery.mastery_probability` as hard as a real
 *     quiz answer — and, worse, a WRONG answer starts RAISING mastery (the
 *     p_learn term dominates at the defaults). The posterior arithmetic below
 *     reproduces the RPC's own update, so this file fails on that edit.
 *
 *   - The topic banding decides what the student is told to go fix. It reuses
 *     `DIAGNOSTIC_PLACEMENT_THRESHOLDS` so a topic can never be labelled "weak"
 *     at a percentage the whole-form placement calls "medium".
 *
 * P13: every fixture is synthetic. No student data.
 */

import { describe, it, expect } from 'vitest';
import {
  DIAGNOSTIC_BKT_PARAMS,
  DIAGNOSTIC_TOPIC_MAX_LABELS,
  QUIZ_BKT_PARAM_DEFAULTS,
  aggregateDiagnosticTopics,
  type DiagnosticTopicOutcome,
} from '@alfanumrik/lib/diagnostic/evidence';
import { DIAGNOSTIC_PLACEMENT_THRESHOLDS } from '@alfanumrik/lib/diagnostic/placement';

// ── The RPC's own BKT update, transcribed from ───────────────────────────────
//    supabase/migrations/20260807000400_update_learner_state_post_quiz_evidence.sql
//    (body inherited verbatim from 20260623000100). Kept here so the damping
//    claim is arithmetic, not a comment.

function bktPosterior(
  prior: number,
  isCorrect: boolean,
  params: { p_p_learn: number; p_p_slip: number; p_p_guess: number },
): number {
  const { p_p_learn: L, p_p_slip: s, p_p_guess: g } = params;
  const evidence = isCorrect
    ? (prior * (1 - s)) / (prior * (1 - s) + (1 - prior) * g)
    : (prior * s) / (prior * s + (1 - prior) * (1 - g));
  return evidence + (1 - evidence) * L;
}

/** The RPC's default prior for a topic with no `concept_mastery` row yet. */
const FRESH_TOPIC_PRIOR = 0.1;

describe('DIAGNOSTIC_BKT_PARAMS — cold-start damping (assessment ruling)', () => {
  it('is strictly damped relative to the quiz defaults on every parameter', () => {
    // p_learn DOWN: a diagnostic teaches nothing mid-test.
    expect(DIAGNOSTIC_BKT_PARAMS.p_p_learn).toBeLessThan(QUIZ_BKT_PARAM_DEFAULTS.p_p_learn);
    // p_slip UP: a wrong cold-start answer is weaker evidence of not-knowing.
    expect(DIAGNOSTIC_BKT_PARAMS.p_p_slip).toBeGreaterThan(QUIZ_BKT_PARAM_DEFAULTS.p_p_slip);
    // p_guess UP: a lone correct answer is weaker evidence of knowing.
    expect(DIAGNOSTIC_BKT_PARAMS.p_p_guess).toBeGreaterThan(QUIZ_BKT_PARAM_DEFAULTS.p_p_guess);
  });

  it('keeps every parameter a valid probability', () => {
    for (const v of Object.values(DIAGNOSTIC_BKT_PARAMS)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('p_guess stays at or above the 0.25 four-option chance floor', () => {
    // Below chance would claim a correct answer is MORE informative than it is
    // on a 4-option MCQ. P6 fixes the option count at exactly 4.
    expect(DIAGNOSTIC_BKT_PARAMS.p_p_guess).toBeGreaterThanOrEqual(0.25);
  });

  it('a CORRECT diagnostic answer moves a fresh topic less than half as far as a quiz answer', () => {
    const quiz = bktPosterior(FRESH_TOPIC_PRIOR, true, QUIZ_BKT_PARAM_DEFAULTS);
    const diag = bktPosterior(FRESH_TOPIC_PRIOR, true, DIAGNOSTIC_BKT_PARAMS);

    const quizMove = quiz - FRESH_TOPIC_PRIOR;
    const diagMove = diag - FRESH_TOPIC_PRIOR;

    expect(diagMove).toBeGreaterThan(0);           // it IS evidence — the spine gets seeded
    expect(diagMove).toBeLessThan(quizMove / 2);   // …but nowhere near a practice attempt
  });

  it('THE LOAD-BEARING PIN: a WRONG diagnostic answer must never raise mastery', () => {
    // At the RPC's defaults the p_learn transition dominates, so a wrong answer
    // on a fresh topic actually moves 0.10 -> ~0.21. That is defensible for a
    // practice attempt (the student was taught by the attempt) and indefensible
    // for a placement check that shows no worked solution. If someone restores
    // the default p_learn for the diagnostic, this fails.
    const quizWrong = bktPosterior(FRESH_TOPIC_PRIOR, false, QUIZ_BKT_PARAM_DEFAULTS);
    expect(quizWrong).toBeGreaterThan(FRESH_TOPIC_PRIOR); // documents the quiz behaviour

    const diagWrong = bktPosterior(FRESH_TOPIC_PRIOR, false, DIAGNOSTIC_BKT_PARAMS);
    expect(diagWrong).toBeLessThanOrEqual(FRESH_TOPIC_PRIOR);
  });

  it('sustained quiz evidence overtakes the whole diagnostic prior within a few attempts', () => {
    // Seed with 3 correct diagnostic answers on one topic…
    let seeded = FRESH_TOPIC_PRIOR;
    for (let i = 0; i < 3; i++) seeded = bktPosterior(seeded, true, DIAGNOSTIC_BKT_PARAMS);

    // …then 2 WRONG quiz answers must be able to pull it back below the seed's
    // starting point. A damped prior can never lock a student in.
    let after = seeded;
    for (let i = 0; i < 2; i++) after = bktPosterior(after, false, QUIZ_BKT_PARAM_DEFAULTS);

    expect(after).toBeLessThan(seeded);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('aggregateDiagnosticTopics — weak/strong derivation (5C)', () => {
  const mk = (
    topicId: string,
    isCorrect: boolean,
    title = `Topic ${topicId}`,
    titleHi: string | null = `विषय ${topicId}`,
  ): DiagnosticTopicOutcome => ({ topicId, title, titleHi, isCorrect });

  it('bands on the SAME cuts as the whole-form placement (no third set of numbers)', () => {
    // 1/3 = 33% -> below medium(50) -> weak
    const weakSide = aggregateDiagnosticTopics([
      mk('a', true), mk('a', false), mk('a', false),
    ]);
    expect(weakSide.weak.map((l) => l.title)).toEqual(['Topic a']);
    expect(weakSide.strong).toEqual([]);

    // 4/5 = 80% -> at hard(80) -> strong
    const strongSide = aggregateDiagnosticTopics([
      mk('b', true), mk('b', true), mk('b', true), mk('b', true), mk('b', false),
    ]);
    expect(strongSide.strong.map((l) => l.title)).toEqual(['Topic b']);
    expect(strongSide.weak).toEqual([]);

    expect(DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium).toBe(50);
    expect(DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard).toBe(80);
  });

  it('leaves the 50-79 middle band UNLABELLED in both lists', () => {
    // 1/2 = 50 (bottom of the band) and 3/4 = 75 (top of the band)
    const out = aggregateDiagnosticTopics([
      mk('mid-lo', true), mk('mid-lo', false),
      mk('mid-hi', true), mk('mid-hi', true), mk('mid-hi', true), mk('mid-hi', false),
    ]);
    expect(out.weak).toEqual([]);
    expect(out.strong).toEqual([]);
  });

  it('a single wrong answer on a topic is enough to call it weak (cold start has thin evidence by design)', () => {
    const out = aggregateDiagnosticTopics([mk('solo', false)]);
    expect(out.weak.map((l) => l.title)).toEqual(['Topic solo']);
  });

  it('OMITS outcomes with no topic id and outcomes with no resolvable title — never fabricates, never shows a UUID', () => {
    const out = aggregateDiagnosticTopics([
      mk('', false),                                   // NULL topic_id upstream
      mk('untitled', false, '', null),                 // curriculum_topics miss
      mk('untitled-ws', false, '   ', null),           // whitespace-only title
      mk('real', false),
    ]);
    expect(out.weak.map((l) => l.title)).toEqual(['Topic real']);
    for (const l of [...out.weak, ...out.strong]) {
      expect(l.title).not.toMatch(/^[0-9a-f-]{36}$/i);
      expect(l.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('returns empty lists for an empty input — an empty result is honest, not an error', () => {
    expect(aggregateDiagnosticTopics([])).toEqual({ weak: [], strong: [] });
  });

  it('P7: carries a Hindi label for every English label, falling back to English when title_hi is null', () => {
    const out = aggregateDiagnosticTopics([
      mk('hi-ok', false, 'Linear Equations', 'रैखिक समीकरण'),
      mk('hi-null', false, 'Trigonometry', null),
    ]);
    expect(out.weak.length).toBe(2);
    for (const l of out.weak) {
      expect(typeof l.titleHi).toBe('string');
      expect(l.titleHi.length).toBeGreaterThan(0);
    }
    const byTitle = new Map(out.weak.map((l) => [l.title, l.titleHi]));
    expect(byTitle.get('Linear Equations')).toBe('रैखिक समीकरण');
    // Untranslated technical term falls back to English rather than blank.
    expect(byTitle.get('Trigonometry')).toBe('Trigonometry');
  });

  it('orders weak worst-first and strong best-first, deterministically', () => {
    const out = aggregateDiagnosticTopics([
      // 0%
      mk('zero', false), mk('zero', false),
      // 33%
      mk('third', true), mk('third', false), mk('third', false),
      // 100%
      mk('perfect', true), mk('perfect', true),
      // 80%
      mk('eighty', true), mk('eighty', true), mk('eighty', true), mk('eighty', true), mk('eighty', false),
    ]);
    expect(out.weak.map((l) => l.title)).toEqual(['Topic zero', 'Topic third']);
    expect(out.strong.map((l) => l.title)).toEqual(['Topic perfect', 'Topic eighty']);
  });

  it('is a pure function — the same input always yields the same output', () => {
    const input = [mk('a', false), mk('b', true), mk('c', false)];
    expect(aggregateDiagnosticTopics(input)).toEqual(aggregateDiagnosticTopics(input));
  });

  it(`caps each list at ${DIAGNOSTIC_TOPIC_MAX_LABELS} — a wall of chips is not actionable`, () => {
    const many: DiagnosticTopicOutcome[] = [];
    for (let i = 0; i < 12; i++) many.push(mk(`w${i}`, false));
    for (let i = 0; i < 12; i++) many.push(mk(`s${i}`, true));
    const out = aggregateDiagnosticTopics(many);
    expect(out.weak.length).toBe(DIAGNOSTIC_TOPIC_MAX_LABELS);
    expect(out.strong.length).toBe(DIAGNOSTIC_TOPIC_MAX_LABELS);
  });

  it('uses the P1 rounding shape for per-topic accuracy (2/3 = 67 -> middle band, not weak)', () => {
    const out = aggregateDiagnosticTopics([
      mk('two-thirds', true), mk('two-thirds', true), mk('two-thirds', false),
    ]);
    expect(Math.round((2 / 3) * 100)).toBe(67);
    expect(out.weak).toEqual([]);
    expect(out.strong).toEqual([]);
  });
});
