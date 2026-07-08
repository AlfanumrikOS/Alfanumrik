/**
 * Chapter Reader v2 — deck state machine types.
 *
 * The deck is a pure reducer: (DeckBlueprint, DeckState, DeckEvent) → DeckState.
 * All effects (event posting, dwell-time timing) live in ConceptDeck.tsx; the
 * types below are I/O-free so they're exhaustively unit-testable.
 *
 * Spec: docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md §4.5
 */

/** One MCQ in a concept. `source` distinguishes the embedded MCQ
 * (chapter_concepts.practice_*) from the extra one (concept_checks). */
export interface CheckRef {
  id: string;
  source: 'embedded' | 'extra';
}

/** One concept in a chapter — exactly two checks (embedded + extra). */
export interface ConceptRef {
  id: string;
  conceptNumber: number;
  checks: readonly [CheckRef, CheckRef];
}

/** Everything the reducer needs to know about a chapter, frozen at deck mount. */
export interface DeckBlueprint {
  chapterSubjectCode: string;
  chapterNumber: number;
  concepts: ConceptRef[];
  /** Exactly 5 ncert_exercises ids forming the end-of-chapter micro-test. */
  microTestQuestionIds: string[];
}

/** Current state of the deck. */
export type DeckState =
  | { kind: 'reading'; conceptIdx: number; attemptsThisConcept: number }
  | { kind: 'checking'; conceptIdx: number; checkIdx: 0 | 1; attemptsThisConcept: number }
  | { kind: 're_read'; conceptIdx: number; missedCheckIdx: 0 | 1 }
  | { kind: 'micro_test'; questionIdx: number; correctSoFar: number }
  | { kind: 'done'; correctOutOfFive: number };

/** Events the reducer accepts. */
export type DeckEvent =
  | { type: 'concept_read_complete' }
  | { type: 'check_answered'; correct: boolean }
  | { type: 're_read_clicked' }
  | { type: 'micro_test_answered'; correct: boolean };

/** Always start at concept 0, reading state, zero attempts. */
export const initialDeckState = (): DeckState => ({
  kind: 'reading',
  conceptIdx: 0,
  attemptsThisConcept: 0,
});
