/**
 * Alfanumrik — Pedagogy v2 / Wave 1
 * Daily Rhythm Orchestrator.
 *
 * Composes today's daily-rhythm queue:
 *   5 × SRS reviews + 1 × ZPD problem + 1 × reflection
 *
 * Pure function. Inputs are: persona, ability estimate, due-cards list,
 * candidate problem pool (already filtered for grade/subject elsewhere),
 * and a reflection prompt index. Output is an ordered queue of items.
 *
 * Selection rules come from pedagogy-content-rules.resolvePedagogyRule.
 * No persona conditionals appear in this file.
 *
 * Note on reflection prompts: cognitive-engine's getReflectionPrompt is
 * an in-quiz metacognitive helper that takes (isCorrect, errors, correct,
 * bloomLevel). It does not match the daily-rhythm session-end use case,
 * which has no in-quiz signal yet. We carry a small bilingual rotation
 * here (SESSION_REFLECTION_PROMPTS) for the daily session-end slot.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */

import type { GoalCode } from '../goals/goal-profile';
import { resolvePedagogyRule, type ProblemFlavor } from './pedagogy-content-rules';

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface DueSm2Card {
  questionId: string;
  topicId: string;
  isAheadOfGrade: boolean;
}

export interface CandidateProblem {
  questionId: string;
  difficulty: number;        // 0..1
  bloomLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  topicId: string;
  isAheadOfGrade: boolean;
  isBoardPattern: boolean;
  isOlympiad: boolean;
  isJeeNeet: boolean;
}

export interface DailyRhythmInput {
  persona: GoalCode;
  studentAbility: number;
  dueSm2Cards: DueSm2Card[];
  candidateProblemPool: CandidateProblem[];
  reflectionPromptIndex: number;
}

// ─── Output ────────────────────────────────────────────────────────────────

export type RhythmItem =
  | { kind: 'srs_review'; questionId: string; topicId: string; isPadding: boolean }
  | {
      kind: 'zpd_problem';
      questionId: string;
      productiveFailure: boolean;
      workedExampleFirst: boolean;
      problemFlavor: ProblemFlavor | null;
    }
  | { kind: 'reflection'; promptText: string; promptTextHi: string };

export interface DailyRhythmQueue {
  items: RhythmItem[];
  composedAtIso: string;
}

// ─── Session-end reflection prompts (bilingual rotation) ──────────────────

const SESSION_REFLECTION_PROMPTS: ReadonlyArray<{ en: string; hi: string }> = [
  { en: 'In one line — what is the most useful thing you learned just now?',         hi: 'एक पंक्ति में — अभी जो सीखा, उसमें सबसे काम की बात क्या थी?' },
  { en: 'Which step felt the trickiest, and what helped you through it?',            hi: 'कौन सा कदम सबसे मुश्किल लगा, और किस चीज़ ने मदद की?' },
  { en: 'If a friend asked you to explain today\'s topic, what would you say first?', hi: 'अगर कोई दोस्त आज का टॉपिक पूछे, तो तुम सबसे पहले क्या बताओगे?' },
  { en: 'Where did you feel confident? Where did you guess?',                         hi: 'कहाँ तुम्हें भरोसा था? कहाँ अंदाज़ा लगाना पड़ा?' },
  { en: 'What is one question you still want answered about this topic?',             hi: 'इस टॉपिक के बारे में कौन सा एक सवाल अभी भी मन में है?' },
  { en: 'Did anything you learned today connect to something else you already know?', hi: 'क्या आज सीखी कोई बात पहले से जानी हुई किसी चीज़ से जुड़ी?' },
  { en: 'What would you do differently if you started today\'s session over?',        hi: 'अगर आज का सेशन फिर से शुरू करना पड़े, तो क्या बदलोगे?' },
];

function reflectionPromptAt(index: number): { en: string; hi: string } {
  const safeIndex = ((index % SESSION_REFLECTION_PROMPTS.length) + SESSION_REFLECTION_PROMPTS.length)
    % SESSION_REFLECTION_PROMPTS.length;
  return SESSION_REFLECTION_PROMPTS[safeIndex];
}

// ─── Composer ──────────────────────────────────────────────────────────────

const SRS_TARGET = 5;

function pickSrsItems(input: DailyRhythmInput): RhythmItem[] {
  const rule = resolvePedagogyRule(input.persona, 'daily', 'srs_review');
  const allow = rule.allowAheadOfGrade;

  const ahead = input.dueSm2Cards.filter((c) => c.isAheadOfGrade);
  const inGrade = input.dueSm2Cards.filter((c) => !c.isAheadOfGrade);

  // When allow is true (competitive_exam, olympiad), allocate ~20% of slots to
  // ahead-of-grade enrichment so the persona actually sees stretch reviews
  // rather than only foundation reviews. When allow is false, ahead cards are
  // excluded entirely (improve_basics MUST never see them).
  let picked: DueSm2Card[];
  if (allow && ahead.length > 0) {
    const aheadQuota = Math.min(ahead.length, Math.max(1, Math.floor(SRS_TARGET / 5)));
    picked = [
      ...ahead.slice(0, aheadQuota),
      ...inGrade.slice(0, SRS_TARGET - aheadQuota),
    ];
    if (picked.length < SRS_TARGET) {
      // Backfill from remaining ahead-of-grade if in-grade ran out.
      const need = SRS_TARGET - picked.length;
      picked = [...picked, ...ahead.slice(aheadQuota, aheadQuota + need)];
    }
  } else {
    picked = inGrade.slice(0, SRS_TARGET);
  }

  const items: RhythmItem[] = picked.slice(0, SRS_TARGET).map((c) => ({
    kind: 'srs_review' as const,
    questionId: c.questionId,
    topicId: c.topicId,
    isPadding: false,
  }));

  while (items.length < SRS_TARGET) {
    items.push({
      kind: 'srs_review' as const,
      questionId: `__pad_${items.length}__`,
      topicId: '__pad__',
      isPadding: true,
    });
  }

  return items;
}

function flavorMatches(p: CandidateProblem, flavor: ProblemFlavor | null): boolean {
  if (!flavor) return true;
  switch (flavor) {
    case 'board_pattern':         return p.isBoardPattern;
    case 'intuition_led':         return !p.isBoardPattern && !p.isJeeNeet && !p.isOlympiad;
    case 'prerequisite_repair':   return !p.isAheadOfGrade && p.difficulty <= 0.55;
    case 'enrichment':            return p.isJeeNeet || p.isAheadOfGrade;
    case 'puzzle':                return p.isOlympiad;
  }
}

function pickZpdItem(input: DailyRhythmInput): RhythmItem {
  const rule = resolvePedagogyRule(input.persona, 'daily', 'zpd_problem');

  const flavored = input.candidateProblemPool.filter((p) => flavorMatches(p, rule.problemFlavor));
  const pool = flavored.length > 0 ? flavored : input.candidateProblemPool;

  // Pick the candidate closest in difficulty to a band centered on student ability.
  // Ability ~ logit scale; convert to 0..1 difficulty target via sigmoid.
  const targetDifficulty = 1 / (1 + Math.exp(-input.studentAbility));
  const sorted = [...pool].sort(
    (a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty),
  );
  const picked = sorted[0];

  return {
    kind: 'zpd_problem',
    questionId: picked?.questionId ?? '__no_pool__',
    productiveFailure: rule.productiveFailure,
    workedExampleFirst: rule.workedExampleFirst,
    problemFlavor: rule.problemFlavor,
  };
}

function pickReflectionItem(input: DailyRhythmInput): RhythmItem {
  const prompt = reflectionPromptAt(input.reflectionPromptIndex);
  return { kind: 'reflection', promptText: prompt.en, promptTextHi: prompt.hi };
}

export function composeDailyRhythm(input: DailyRhythmInput): DailyRhythmQueue {
  const srs = pickSrsItems(input);
  const zpd = pickZpdItem(input);
  const reflection = pickReflectionItem(input);
  return {
    items: [...srs, zpd, reflection],
    composedAtIso: new Date().toISOString(),
  };
}
