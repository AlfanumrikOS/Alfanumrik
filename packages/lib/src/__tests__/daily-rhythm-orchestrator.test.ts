import { describe, it, expect } from 'vitest';
import { composeDailyRhythm, type DailyRhythmInput } from '../learn/daily-rhythm-orchestrator';
import type { GoalCode } from '../goals/goal-profile';

const fakePool = (n: number) => Array.from({ length: n }, (_, i) => ({
  questionId: `q${i}`,
  difficulty: 0.5,
  bloomLevel: 'understand' as const,
  topicId: `t${i % 3}`,
  isAheadOfGrade: false,
  isBoardPattern: i % 2 === 0,
  isOlympiad: false,
  isJeeNeet: false,
}));

const baseInput = (persona: GoalCode): DailyRhythmInput => ({
  persona,
  studentAbility: 0.0,
  dueSm2Cards: Array.from({ length: 7 }, (_, i) => ({
    questionId: `due${i}`,
    topicId: `t${i % 2}`,
    isAheadOfGrade: false,
  })),
  candidateProblemPool: fakePool(20),
  reflectionPromptIndex: 0,
});

describe('composeDailyRhythm', () => {
  it('returns 7 items: 5 SRS + 1 ZPD + 1 reflection', () => {
    const queue = composeDailyRhythm(baseInput('school_topper'));
    expect(queue.items).toHaveLength(7);
    expect(queue.items.filter((i) => i.kind === 'srs_review')).toHaveLength(5);
    expect(queue.items.filter((i) => i.kind === 'zpd_problem')).toHaveLength(1);
    expect(queue.items.filter((i) => i.kind === 'reflection')).toHaveLength(1);
  });

  it('places ZPD problem at position 5 (after SRS, before reflection)', () => {
    const queue = composeDailyRhythm(baseInput('school_topper'));
    expect(queue.items[5].kind).toBe('zpd_problem');
    expect(queue.items[6].kind).toBe('reflection');
  });

  it('improve_basics persona: ZPD item carries workedExampleFirst=true', () => {
    const queue = composeDailyRhythm(baseInput('improve_basics'));
    const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
    expect(zpd?.kind).toBe('zpd_problem');
    if (zpd?.kind === 'zpd_problem') {
      expect(zpd.workedExampleFirst).toBe(true);
      expect(zpd.productiveFailure).toBe(false);
    }
  });

  it('competitive_exam persona: SRS allows ahead-of-grade cards', () => {
    const input = baseInput('competitive_exam');
    input.dueSm2Cards = [
      ...input.dueSm2Cards,
      { questionId: 'ahead1', topicId: 'tA', isAheadOfGrade: true },
      { questionId: 'ahead2', topicId: 'tA', isAheadOfGrade: true },
    ];
    const queue = composeDailyRhythm(input);
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs.some((i) => i.kind === 'srs_review' && i.questionId.startsWith('ahead'))).toBe(true);
  });

  it('improve_basics persona: SRS rejects ahead-of-grade cards', () => {
    const input = baseInput('improve_basics');
    input.dueSm2Cards = [
      ...input.dueSm2Cards.slice(0, 3),
      { questionId: 'ahead1', topicId: 'tA', isAheadOfGrade: true },
      { questionId: 'ahead2', topicId: 'tA', isAheadOfGrade: true },
      { questionId: 'in1', topicId: 'tB', isAheadOfGrade: false },
      { questionId: 'in2', topicId: 'tB', isAheadOfGrade: false },
    ];
    const queue = composeDailyRhythm(input);
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs.some((i) => i.kind === 'srs_review' && i.questionId.startsWith('ahead'))).toBe(false);
  });

  it('pass_comfortably persona: ZPD picks board-pattern problem when available', () => {
    const queue = composeDailyRhythm(baseInput('pass_comfortably'));
    const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
    if (zpd?.kind === 'zpd_problem') {
      const picked = zpd.questionId;
      const num = parseInt(picked.replace('q', ''), 10);
      expect(num % 2).toBe(0);
    }
  });

  it('handles empty SRS due-card list by padding with placeholders flagged as `pad`', () => {
    const input = baseInput('school_topper');
    input.dueSm2Cards = [];
    const queue = composeDailyRhythm(input);
    const srs = queue.items.filter((i) => i.kind === 'srs_review');
    expect(srs).toHaveLength(5);
    srs.forEach((i) => {
      if (i.kind === 'srs_review') expect(i.isPadding).toBe(true);
    });
  });

  it('reflection item carries non-empty bilingual prompt text', () => {
    const queue = composeDailyRhythm(baseInput('school_topper'));
    const reflection = queue.items.find((i) => i.kind === 'reflection');
    if (reflection?.kind === 'reflection') {
      expect(reflection.promptText).toBeTruthy();
      expect(reflection.promptTextHi).toBeTruthy();
      expect(typeof reflection.promptText).toBe('string');
      expect(typeof reflection.promptTextHi).toBe('string');
    }
  });

  it('reflection prompt rotates with reflectionPromptIndex (deterministic)', () => {
    const a = composeDailyRhythm({ ...baseInput('school_topper'), reflectionPromptIndex: 0 });
    const b = composeDailyRhythm({ ...baseInput('school_topper'), reflectionPromptIndex: 1 });
    const refA = a.items.find((i) => i.kind === 'reflection');
    const refB = b.items.find((i) => i.kind === 'reflection');
    if (refA?.kind === 'reflection' && refB?.kind === 'reflection') {
      expect(refA.promptText).not.toBe(refB.promptText);
    }
  });
});
