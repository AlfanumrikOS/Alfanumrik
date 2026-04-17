/**
 * ALFANUMRIK -- Concept Chain Game Engine
 *
 * Pure game logic functions for the daily challenge "Concept Chain" mini-game.
 * Students arrange concept cards into the correct sequential order.
 *
 * Features:
 * - Chain order verification (ignoring distractors)
 * - Misplaced card counting for partial feedback
 * - ZPD-based card selection with shuffling
 * - Hint system that progressively locks correct cards
 *
 * All functions are pure (no side effects, no DB calls).
 * Difficulty settings come from challenge-config.ts.
 */

import type { ChallengeDifficulty } from './challenge-config';

// ---- Types ----

/**
 * A single card in the concept chain.
 * position = 0-based index in correct chain; -1 for distractors.
 */
export interface ChainCard {
  /** Unique card identifier. */
  id: string;
  /** English text for the card. */
  text: string;
  /** Hindi text for the card. */
  textHi: string;
  /** 0-based position in the correct chain, or -1 for distractors. */
  position: number;
}

/**
 * Raw challenge data containing the full chain and available distractors.
 */
export interface ChallengeData {
  /** The correct chain of cards in order. */
  baseChain: ChainCard[];
  /** Distractor cards (position = -1). */
  distractors: ChainCard[];
}

/**
 * The challenge as presented to a student after card selection and shuffling.
 */
export interface StudentChallenge {
  /** All cards the student sees (shuffled mix of base + distractors). */
  cards: ChainCard[];
  /** Correct order of base chain card IDs (no distractors). */
  correctOrder: string[];
  /** IDs of distractor cards included. */
  distractorIds: string[];
}

/**
 * Result of applying a hint -- one more card locked into correct position.
 */
export interface HintResult {
  /** Updated card order with locked cards in correct positions. */
  newOrder: string[];
  /** All card IDs that are now locked (including previously locked). */
  lockedIds: string[];
}

// ---- Internal Helpers ----

/**
 * Fisher-Yates shuffle (returns a new array).
 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---- Chain Order Verification ----

/**
 * Checks whether the submitted card order is correct.
 * Only considers non-distractor (base chain) cards.
 * Distractors (IDs not in baseChain) are ignored.
 *
 * @param submittedIds Array of card IDs in the student's submitted order
 * @param baseChain The correct chain cards (sorted by position)
 * @returns true if the non-distractor cards are in the correct order
 */
export function checkChainOrder(submittedIds: string[], baseChain: ChainCard[]): boolean {
  const chainIdSet = new Set(baseChain.map(c => c.id));
  const sortedChain = [...baseChain].sort((a, b) => a.position - b.position);
  const correctOrder = sortedChain.map(c => c.id);

  // Filter submitted to only chain cards
  const submittedChainIds = submittedIds.filter(id => chainIdSet.has(id));

  if (submittedChainIds.length !== correctOrder.length) return false;

  for (let i = 0; i < correctOrder.length; i++) {
    if (submittedChainIds[i] !== correctOrder[i]) return false;
  }
  return true;
}

// ---- Misplaced Card Counting ----

/**
 * Counts how many base chain cards are NOT in their correct position.
 * Distractors are ignored.
 *
 * @param submittedIds Array of card IDs in the student's submitted order
 * @param baseChain The correct chain cards
 * @returns Number of misplaced chain cards
 */
export function countMisplacedCards(submittedIds: string[], baseChain: ChainCard[]): number {
  const chainIdSet = new Set(baseChain.map(c => c.id));
  const sortedChain = [...baseChain].sort((a, b) => a.position - b.position);
  const correctOrder = sortedChain.map(c => c.id);

  // Extract only chain card IDs from submitted, preserving order
  const submittedChainIds = submittedIds.filter(id => chainIdSet.has(id));

  let misplaced = 0;
  for (let i = 0; i < correctOrder.length; i++) {
    if (i >= submittedChainIds.length || submittedChainIds[i] !== correctOrder[i]) {
      misplaced++;
    }
  }
  return misplaced;
}

// ---- Card Selection ----

/**
 * Selects cards for a student based on difficulty settings.
 * Picks cardCount base chain cards and distractorCount distractors,
 * then shuffles them all together.
 *
 * If fewer cards are available than requested, uses what is available.
 *
 * @param challenge The full challenge data
 * @param difficulty Difficulty settings (from getDifficultyForZPD)
 * @returns StudentChallenge with shuffled cards, correct order, and distractor IDs
 */
export function selectCardsForStudent(
  challenge: ChallengeData,
  difficulty: ChallengeDifficulty
): StudentChallenge {
  // Select base chain cards (take first cardCount from sorted chain)
  const sortedChain = [...challenge.baseChain].sort((a, b) => a.position - b.position);
  const selectedBase = sortedChain.slice(0, difficulty.cardCount);
  const correctOrder = selectedBase.map(c => c.id);

  // Select distractors (take first distractorCount)
  const availableDistractors = [...challenge.distractors];
  const selectedDistractors = availableDistractors.slice(0, difficulty.distractorCount);
  const distractorIds = selectedDistractors.map(c => c.id);

  // Combine and shuffle
  const allCards = [...selectedBase, ...selectedDistractors];
  const shuffled = shuffle(allCards);

  return {
    cards: shuffled,
    correctOrder,
    distractorIds,
  };
}

// ---- Hint System ----

/**
 * Applies a hint by locking the next correct card into its proper position.
 * Finds the first unlocked card in the correct chain order and places it
 * at its correct position, then fills remaining positions with other cards.
 *
 * @param currentOrder Array of card IDs in their current displayed order
 * @param baseChain The correct chain cards
 * @param alreadyLocked IDs of cards that are already locked in place
 * @returns HintResult with the new order and updated locked IDs
 */
export function applyHint(
  currentOrder: string[],
  baseChain: ChainCard[],
  alreadyLocked: string[]
): HintResult {
  const sortedChain = [...baseChain].sort((a, b) => a.position - b.position);
  const lockedSet = new Set(alreadyLocked);

  // Find the next card to lock: first chain card (by position) not already locked
  let cardToLock: ChainCard | null = null;
  let targetPosition = -1;

  for (let i = 0; i < sortedChain.length; i++) {
    if (!lockedSet.has(sortedChain[i].id)) {
      cardToLock = sortedChain[i];
      targetPosition = i;
      break;
    }
  }

  // If all chain cards are already locked, return unchanged
  if (!cardToLock) {
    return {
      newOrder: [...currentOrder],
      lockedIds: [...alreadyLocked],
    };
  }

  const newLockedIds = [...alreadyLocked, cardToLock.id];
  const newLockedSet = new Set(newLockedIds);

  // Build the new order:
  // 1. Locked cards go at their correct chain positions
  // 2. Remaining cards fill the other slots in their original relative order
  const chainIdSet = new Set(sortedChain.map(c => c.id));

  // Figure out which positions in the output are "chain positions"
  // We need to map chain card positions to output positions.
  // The output has the same length as currentOrder.
  // Chain cards' target positions correspond to their index among chain cards
  // in the currentOrder (i.e., filtering out non-chain cards to determine position).

  // Simple approach: rebuild the order
  // - Remove the card-to-lock from its current position
  // - Insert it at the correct position among chain cards

  // Build list of remaining cards (everything except the card being locked, preserving order)
  const remaining = currentOrder.filter(id => id !== cardToLock!.id);

  // Now insert the locked cards at their correct positions
  // We need to place all locked chain cards at their correct chain positions
  // among all chain cards in the sequence.

  // Strategy: separate chain cards and non-chain cards,
  // build chain card order with locked ones in correct positions,
  // then interleave non-chain cards back.

  // Actually, simpler: we have a flat array. The locked card needs to go
  // at index = targetPosition (its chain position) in the output,
  // but only among chain cards. Non-chain cards can stay in their relative positions.

  // Simplest correct approach: build output array
  // - Place all locked chain cards at their absolute position in the output
  // - Place remaining cards in the remaining slots

  // To keep it simple, treat the output as: locked cards get priority positions
  // from left to right (position 0, 1, 2... in chain order), then everything else.

  // Determine all locked chain cards and their target positions
  const lockedPositions = new Map<number, string>();
  for (const chainCard of sortedChain) {
    if (newLockedSet.has(chainCard.id)) {
      // Position in the output = chain card's position index
      lockedPositions.set(sortedChain.indexOf(chainCard), chainCard.id);
    }
  }

  // Get all non-locked cards in their current relative order
  const nonLockedCards = remaining.filter(id => !newLockedSet.has(id));

  // Build output: locked cards at their indices, fill rest with non-locked
  const output: string[] = new Array(currentOrder.length);
  let nonLockedIdx = 0;

  // First pass: place locked cards
  for (const [pos, id] of lockedPositions) {
    output[pos] = id;
  }

  // Second pass: fill remaining slots with non-locked cards
  for (let i = 0; i < output.length; i++) {
    if (output[i] === undefined) {
      if (nonLockedIdx < nonLockedCards.length) {
        output[i] = nonLockedCards[nonLockedIdx++];
      }
    }
  }

  return {
    newOrder: output.filter(id => id !== undefined),
    lockedIds: newLockedIds,
  };
}
