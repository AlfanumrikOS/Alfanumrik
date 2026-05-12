/**
 * Chapter Reader v2 — pure deck reducer.
 *
 * Drives ConceptCard → ConceptCheck → next-concept (or re-read on miss) →
 * end-of-chapter micro-test → done. No I/O — the consumer (ConceptDeck.tsx)
 * is responsible for posting state-bus events and showing UX delays around
 * dispatching the resulting events.
 *
 * Spec: docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md §4.5
 */

import type { DeckBlueprint, DeckState, DeckEvent } from './deck-types';

/**
 * Apply one event to the current state.
 * Unknown events on a given state → state is returned unchanged (safe fallback;
 * tested explicitly in deck-reducer.test.ts).
 */
export function deckReducer(
  bp: DeckBlueprint,
  state: DeckState,
  event: DeckEvent,
): DeckState {
  switch (state.kind) {
    case 'reading': {
      if (event.type !== 'concept_read_complete') return state;
      return {
        kind: 'checking',
        conceptIdx: state.conceptIdx,
        checkIdx: 0,
        attemptsThisConcept: state.attemptsThisConcept + 1,
      };
    }
    case 'checking': {
      if (event.type !== 'check_answered') return state;
      if (!event.correct) {
        return {
          kind: 're_read',
          conceptIdx: state.conceptIdx,
          missedCheckIdx: state.checkIdx,
        };
      }
      // Correct.
      if (state.checkIdx === 0) {
        return { ...state, checkIdx: 1 };
      }
      // Both checks correct → advance.
      const nextConceptIdx = state.conceptIdx + 1;
      if (nextConceptIdx >= bp.concepts.length) {
        return { kind: 'micro_test', questionIdx: 0, correctSoFar: 0 };
      }
      return { kind: 'reading', conceptIdx: nextConceptIdx, attemptsThisConcept: 0 };
    }
    case 're_read': {
      if (event.type !== 're_read_clicked') return state;
      return {
        kind: 'reading',
        conceptIdx: state.conceptIdx,
        attemptsThisConcept: 1,
      };
    }
    case 'micro_test': {
      if (event.type !== 'micro_test_answered') return state;
      const correctSoFar = state.correctSoFar + (event.correct ? 1 : 0);
      const nextIdx = state.questionIdx + 1;
      if (nextIdx >= bp.microTestQuestionIds.length) {
        return { kind: 'done', correctOutOfFive: correctSoFar };
      }
      return { kind: 'micro_test', questionIdx: nextIdx, correctSoFar };
    }
    case 'done':
      return state;
  }
}
