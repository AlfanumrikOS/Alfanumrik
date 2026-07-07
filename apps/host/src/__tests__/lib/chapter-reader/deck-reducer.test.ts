import { describe, it, expect } from 'vitest';
import { deckReducer } from '@alfanumrik/lib/chapter-reader/deck-reducer';
import { initialDeckState, type DeckBlueprint, type DeckState } from '@alfanumrik/lib/chapter-reader/deck-types';

const BP: DeckBlueprint = {
  chapterSubjectCode: 'math',
  chapterNumber: 1,
  concepts: [
    {
      id: 'c1', conceptNumber: 1,
      checks: [
        { id: 'c1q1', source: 'embedded' },
        { id: 'c1q2', source: 'extra' },
      ] as const,
    },
    {
      id: 'c2', conceptNumber: 2,
      checks: [
        { id: 'c2q1', source: 'embedded' },
        { id: 'c2q2', source: 'extra' },
      ] as const,
    },
  ],
  microTestQuestionIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
};

describe('deckReducer', () => {
  it('starts in reading state at concept 0', () => {
    expect(initialDeckState()).toEqual({
      kind: 'reading', conceptIdx: 0, attemptsThisConcept: 0,
    });
  });

  it('reading → checking on concept_read_complete', () => {
    const s = deckReducer(BP, initialDeckState(), { type: 'concept_read_complete' });
    expect(s).toEqual({
      kind: 'checking', conceptIdx: 0, checkIdx: 0, attemptsThisConcept: 1,
    });
  });

  it('checking q0 correct → checking q1', () => {
    let s = deckReducer(BP, initialDeckState(), { type: 'concept_read_complete' });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    expect(s).toEqual({
      kind: 'checking', conceptIdx: 0, checkIdx: 1, attemptsThisConcept: 1,
    });
  });

  it('checking q1 correct after q0 correct → advances to next concept', () => {
    let s = initialDeckState();
    s = deckReducer(BP, s, { type: 'concept_read_complete' });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    expect(s).toEqual({ kind: 'reading', conceptIdx: 1, attemptsThisConcept: 0 });
  });

  it('checking q0 wrong → re_read state', () => {
    let s = deckReducer(BP, initialDeckState(), { type: 'concept_read_complete' });
    s = deckReducer(BP, s, { type: 'check_answered', correct: false });
    expect(s).toEqual({ kind: 're_read', conceptIdx: 0, missedCheckIdx: 0 });
  });

  it('re_read + re_read_clicked → back to reading, attempt counter ticks', () => {
    let s = initialDeckState();
    s = deckReducer(BP, s, { type: 'concept_read_complete' });
    s = deckReducer(BP, s, { type: 'check_answered', correct: false });
    s = deckReducer(BP, s, { type: 're_read_clicked' });
    expect(s).toEqual({ kind: 'reading', conceptIdx: 0, attemptsThisConcept: 1 });
  });

  it('finishing the last concept → enters micro_test at question 0', () => {
    let s = initialDeckState();
    // concept 0 perfect
    s = deckReducer(BP, s, { type: 'concept_read_complete' });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    // concept 1 perfect
    s = deckReducer(BP, s, { type: 'concept_read_complete' });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    s = deckReducer(BP, s, { type: 'check_answered', correct: true });
    expect(s).toEqual({ kind: 'micro_test', questionIdx: 0, correctSoFar: 0 });
  });

  it('micro_test 5 answers (3 correct) → done with score', () => {
    let s: DeckState = { kind: 'micro_test', questionIdx: 0, correctSoFar: 0 };
    s = deckReducer(BP, s, { type: 'micro_test_answered', correct: true });
    s = deckReducer(BP, s, { type: 'micro_test_answered', correct: false });
    s = deckReducer(BP, s, { type: 'micro_test_answered', correct: true });
    s = deckReducer(BP, s, { type: 'micro_test_answered', correct: false });
    s = deckReducer(BP, s, { type: 'micro_test_answered', correct: true });
    expect(s).toEqual({ kind: 'done', correctOutOfFive: 3 });
  });

  it('done state absorbs further events without change', () => {
    const done: DeckState = { kind: 'done', correctOutOfFive: 4 };
    expect(deckReducer(BP, done, { type: 'check_answered', correct: true })).toBe(done);
  });

  it('unknown event on any state returns state unchanged', () => {
    const s = initialDeckState();
    // @ts-expect-error — runtime safety check
    expect(deckReducer(BP, s, { type: 'garbage' })).toBe(s);
  });
});
