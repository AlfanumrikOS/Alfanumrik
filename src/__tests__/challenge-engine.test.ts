import { describe, it, expect } from 'vitest';
import {
  checkChainOrder,
  countMisplacedCards,
  selectCardsForStudent,
  applyHint,
  type ChainCard,
  type ChallengeData,
  type StudentChallenge,
  type HintResult,
} from '@/lib/challenge-engine';
import type { ChallengeDifficulty } from '@/lib/challenge-config';

/**
 * Challenge Engine Tests
 *
 * Tests pure game logic functions for the Concept Chain:
 * - Chain order verification
 * - Misplaced card counting
 * - Card selection by difficulty
 * - Hint application (locking correct cards)
 */

// ---- Test Fixtures ----

function makeChain(count: number): ChainCard[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i}`,
    text: `Step ${i + 1}`,
    textHi: `चरण ${i + 1}`,
    position: i,
  }));
}

function makeDistractors(count: number): ChainCard[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `distractor-${i}`,
    text: `Wrong step ${i + 1}`,
    textHi: `गलत चरण ${i + 1}`,
    position: -1,
  }));
}

function makeChallengeData(chainSize: number, distractorSize: number): ChallengeData {
  return {
    baseChain: makeChain(chainSize),
    distractors: makeDistractors(distractorSize),
  };
}

// ---- checkChainOrder ----

describe('checkChainOrder', () => {
  it('returns true when submitted order matches correct chain order', () => {
    const chain = makeChain(5);
    const submittedIds = chain.map(c => c.id);
    expect(checkChainOrder(submittedIds, chain)).toBe(true);
  });

  it('returns true when submitted includes distractors but non-distractor order is correct', () => {
    const chain = makeChain(4);
    // Submitted includes a distractor interleaved, but chain cards are in order
    const submittedIds = ['card-0', 'distractor-0', 'card-1', 'card-2', 'card-3'];
    expect(checkChainOrder(submittedIds, chain)).toBe(true);
  });

  it('returns false when chain cards are out of order', () => {
    const chain = makeChain(4);
    const submittedIds = ['card-1', 'card-0', 'card-2', 'card-3'];
    expect(checkChainOrder(submittedIds, chain)).toBe(false);
  });

  it('returns false when chain is fully reversed', () => {
    const chain = makeChain(5);
    const submittedIds = ['card-4', 'card-3', 'card-2', 'card-1', 'card-0'];
    expect(checkChainOrder(submittedIds, chain)).toBe(false);
  });

  it('returns true for a single-card chain', () => {
    const chain = makeChain(1);
    expect(checkChainOrder(['card-0'], chain)).toBe(true);
  });
});

// ---- countMisplacedCards ----

describe('countMisplacedCards', () => {
  it('returns 0 when all cards are in correct position', () => {
    const chain = makeChain(5);
    const ids = chain.map(c => c.id);
    expect(countMisplacedCards(ids, chain)).toBe(0);
  });

  it('returns 2 when two cards are swapped', () => {
    const chain = makeChain(5);
    // Swap card-0 and card-1
    const ids = ['card-1', 'card-0', 'card-2', 'card-3', 'card-4'];
    expect(countMisplacedCards(ids, chain)).toBe(2);
  });

  it('returns count of chain length for fully reversed order', () => {
    const chain = makeChain(4);
    // Reversed: positions 3,2,1,0 -- cards at index 0 and 3 are wrong, 1 and 2 are wrong
    const ids = ['card-3', 'card-2', 'card-1', 'card-0'];
    // All 4 cards are misplaced
    expect(countMisplacedCards(ids, chain)).toBe(4);
  });

  it('ignores distractors when counting misplaced cards', () => {
    const chain = makeChain(4);
    // Chain cards in correct order with distractor mixed in
    const ids = ['card-0', 'distractor-0', 'card-1', 'card-2', 'card-3'];
    expect(countMisplacedCards(ids, chain)).toBe(0);
  });

  it('returns correct count when some chain cards are in wrong positions among distractors', () => {
    const chain = makeChain(3);
    // card-1 and card-0 swapped, distractor mixed in
    const ids = ['card-1', 'distractor-0', 'card-0', 'card-2'];
    expect(countMisplacedCards(ids, chain)).toBe(2);
  });
});

// ---- selectCardsForStudent ----

describe('selectCardsForStudent', () => {
  it('selects 4 cards for low difficulty (4 base, 0 distractors)', () => {
    const data = makeChallengeData(6, 3);
    const difficulty: ChallengeDifficulty = { cardCount: 4, distractorCount: 0, band: 'low' };
    const result = selectCardsForStudent(data, difficulty);

    expect(result.cards).toHaveLength(4);
    expect(result.correctOrder).toHaveLength(4);
    expect(result.distractorIds).toHaveLength(0);
  });

  it('selects 5 cards for medium difficulty (5 base, 0 distractors)', () => {
    const data = makeChallengeData(6, 3);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 0, band: 'medium' };
    const result = selectCardsForStudent(data, difficulty);

    expect(result.cards).toHaveLength(5);
    expect(result.correctOrder).toHaveLength(5);
    expect(result.distractorIds).toHaveLength(0);
  });

  it('selects 6 cards for high difficulty (5 base + 1 distractor)', () => {
    const data = makeChallengeData(6, 3);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 1, band: 'high' };
    const result = selectCardsForStudent(data, difficulty);

    expect(result.cards).toHaveLength(6);
    expect(result.correctOrder).toHaveLength(5);
    expect(result.distractorIds).toHaveLength(1);
  });

  it('selects 7 cards for expert difficulty (5 base + 2 distractors)', () => {
    const data = makeChallengeData(6, 3);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 2, band: 'expert' };
    const result = selectCardsForStudent(data, difficulty);

    expect(result.cards).toHaveLength(7);
    expect(result.correctOrder).toHaveLength(5);
    expect(result.distractorIds).toHaveLength(2);
  });

  it('shuffles cards (not in original order)', () => {
    // Run multiple times to statistically verify shuffling
    const data = makeChallengeData(8, 4);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 2, band: 'expert' };

    let foundDifferent = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = selectCardsForStudent(data, difficulty);
      const cardIds = result.cards.map(c => c.id);
      const sortedCorrectOrder = [...result.correctOrder, ...result.distractorIds];
      if (cardIds.join(',') !== sortedCorrectOrder.join(',')) {
        foundDifferent = true;
        break;
      }
    }
    expect(foundDifferent).toBe(true);
  });

  it('correctOrder contains only base chain card IDs', () => {
    const data = makeChallengeData(6, 3);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 1, band: 'high' };
    const result = selectCardsForStudent(data, difficulty);

    const baseIds = new Set(data.baseChain.map(c => c.id));
    for (const id of result.correctOrder) {
      expect(baseIds.has(id)).toBe(true);
    }
  });

  it('distractorIds contains only distractor card IDs', () => {
    const data = makeChallengeData(6, 3);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 2, band: 'expert' };
    const result = selectCardsForStudent(data, difficulty);

    const distractorIds = new Set(data.distractors.map(c => c.id));
    for (const id of result.distractorIds) {
      expect(distractorIds.has(id)).toBe(true);
    }
  });

  it('handles when base chain has fewer cards than requested', () => {
    const data = makeChallengeData(3, 2);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 0, band: 'medium' };
    const result = selectCardsForStudent(data, difficulty);

    // Should use all 3 available base cards
    expect(result.cards.length).toBe(3);
    expect(result.correctOrder).toHaveLength(3);
  });

  it('handles when fewer distractors are available than requested', () => {
    const data = makeChallengeData(6, 1);
    const difficulty: ChallengeDifficulty = { cardCount: 5, distractorCount: 2, band: 'expert' };
    const result = selectCardsForStudent(data, difficulty);

    // Should use all 1 available distractor
    expect(result.distractorIds).toHaveLength(1);
    expect(result.cards).toHaveLength(6); // 5 base + 1 distractor
  });
});

// ---- applyHint ----

describe('applyHint', () => {
  it('locks the first correct card when no cards are locked', () => {
    const chain = makeChain(4);
    const currentOrder = ['card-2', 'card-0', 'card-1', 'card-3'];

    const result = applyHint(currentOrder, chain, []);

    // card-0 should be locked at position 0
    expect(result.lockedIds).toContain('card-0');
    expect(result.lockedIds).toHaveLength(1);
    expect(result.newOrder[0]).toBe('card-0');
  });

  it('locks the next correct card when some are already locked', () => {
    const chain = makeChain(4);
    const currentOrder = ['card-0', 'card-3', 'card-2', 'card-1'];

    const result = applyHint(currentOrder, chain, ['card-0']);

    // card-1 should be locked at position 1
    expect(result.lockedIds).toContain('card-0');
    expect(result.lockedIds).toContain('card-1');
    expect(result.lockedIds).toHaveLength(2);
    expect(result.newOrder[0]).toBe('card-0');
    expect(result.newOrder[1]).toBe('card-1');
  });

  it('returns all locked when all cards are already locked', () => {
    const chain = makeChain(3);
    const currentOrder = ['card-0', 'card-1', 'card-2'];
    const allLocked = ['card-0', 'card-1', 'card-2'];

    const result = applyHint(currentOrder, chain, allLocked);

    expect(result.lockedIds).toHaveLength(3);
    expect(result.newOrder).toEqual(['card-0', 'card-1', 'card-2']);
  });

  it('preserves non-locked card relative order (except the newly placed card)', () => {
    const chain = makeChain(5);
    // Start: card-3, card-4, card-0, card-1, card-2
    const currentOrder = ['card-3', 'card-4', 'card-0', 'card-1', 'card-2'];

    const result = applyHint(currentOrder, chain, []);

    // card-0 should be at position 0
    expect(result.newOrder[0]).toBe('card-0');
    expect(result.lockedIds).toEqual(['card-0']);
    // All original cards should still be present
    expect(result.newOrder).toHaveLength(5);
    expect(new Set(result.newOrder).size).toBe(5);
  });

  it('works correctly with distractors in the order', () => {
    const chain = makeChain(3);
    const currentOrder = ['distractor-0', 'card-2', 'card-0', 'card-1'];

    const result = applyHint(currentOrder, chain, []);

    // card-0 should be at position 0 (among chain cards)
    expect(result.lockedIds).toContain('card-0');
    // All cards still present
    expect(result.newOrder).toHaveLength(4);
  });
});
