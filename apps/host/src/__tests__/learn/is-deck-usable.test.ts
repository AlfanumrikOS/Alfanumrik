/**
 * REG: is-deck-usable — chapter_concepts pilot content gate
 *
 * Pins the `isUsableChapterDeck` floor logic in
 * src/lib/chapter-reader/get-concepts-from-table.ts.
 *
 * This is the SAME gate the pilot seed migration
 * `20260621000750_seed_chapter_concepts_pilot_g7_g9.sql` must clear for every
 * chapter (G7 science ch1+ch3, G9 math ch1 — 4 curated concepts each). If this
 * floor moves, the assessment rubric at
 *   docs/superpowers/specs/2026-06-21-chapter-concepts-derivation-rubric.md
 *   scripts/sql/validate-chapter-concepts.sql
 * and the seed content must move with it. Failing here means the gate the
 * pilot content was authored against has silently changed.
 *
 * The function is pure (no DB) — we exercise the real export directly and only
 * populate the fields it reads (`title`, `description`). `description` is what
 * the rowToTopic mapper builds from `explanation` (+ worked example), so the
 * >=80-char floor on `description` is the production proxy for the rubric's
 * ">=80-char explanation" rule.
 */

import { describe, it, expect } from 'vitest';
import { isUsableChapterDeck, MIN_CONCEPTS } from '@alfanumrik/lib/chapter-reader/get-concepts-from-table';
import type { CurriculumTopic } from '@alfanumrik/lib/types';

// 80-char floor → use a comfortably-long explanation for the happy path.
const LONG_DESC =
  'Photosynthesis is the process by which green plants convert sunlight, water, ' +
  'and carbon dioxide into glucose and oxygen inside the chloroplasts of leaf cells.';

function makeTopic(overrides: Partial<CurriculumTopic> = {}): CurriculumTopic {
  return {
    id: crypto.randomUUID(),
    title: 'A Valid Concept Title',
    description: LONG_DESC,
    ...overrides,
  } as unknown as CurriculumTopic;
}

function deckOf(n: number, overrides: Partial<CurriculumTopic> = {}): CurriculumTopic[] {
  return Array.from({ length: n }, (_, i) =>
    makeTopic({ title: `Concept ${i + 1}`, ...overrides }),
  );
}

describe('isUsableChapterDeck — pilot content floor', () => {
  it('MIN_CONCEPTS is 3 (the floor the pilot seed authors against)', () => {
    expect(MIN_CONCEPTS).toBe(3);
  });

  it('returns TRUE for a 3-concept deck with valid titles and >=80-char explanations (pilot minimum)', () => {
    expect(isUsableChapterDeck(deckOf(3))).toBe(true);
  });

  it('returns TRUE for a 4-concept deck (the actual pilot shape: 4 concepts/chapter)', () => {
    expect(isUsableChapterDeck(deckOf(4))).toBe(true);
  });

  it('returns FALSE for a 2-concept deck (below MIN_CONCEPTS)', () => {
    expect(isUsableChapterDeck(deckOf(2))).toBe(false);
  });

  it('returns FALSE for an empty deck', () => {
    expect(isUsableChapterDeck([])).toBe(false);
  });

  it('returns FALSE when any concept explanation is shorter than 80 chars (placeholder LP)', () => {
    const deck = deckOf(3);
    deck[1] = makeTopic({
      title: 'Short Concept',
      description: 'Apply sign rules step by step.', // < 80 chars
    });
    expect(isUsableChapterDeck(deck)).toBe(false);
  });

  it('returns FALSE when explanation is exactly at the boundary minus one (79 chars)', () => {
    const seventyNine = 'x'.repeat(79);
    const deck = deckOf(3, { description: seventyNine });
    expect(isUsableChapterDeck(deck)).toBe(false);
  });

  it('returns TRUE when explanation is exactly 80 chars (inclusive boundary)', () => {
    const eighty = 'y'.repeat(80);
    const deck = deckOf(3, { description: eighty });
    expect(isUsableChapterDeck(deck)).toBe(true);
  });

  it('returns FALSE when any concept title is shorter than 3 chars', () => {
    const deck = deckOf(3);
    deck[0] = makeTopic({ title: 'AB', description: LONG_DESC }); // 2-char title
    expect(isUsableChapterDeck(deck)).toBe(false);
  });

  it('returns FALSE when a concept title is empty / whitespace-only', () => {
    const deck = deckOf(3);
    deck[2] = makeTopic({ title: '   ', description: LONG_DESC });
    expect(isUsableChapterDeck(deck)).toBe(false);
  });

  it('treats a whitespace-padded explanation by its trimmed length (padding does not satisfy the floor)', () => {
    const deck = deckOf(3, { description: '   short   ' }); // trims to 5 chars
    expect(isUsableChapterDeck(deck)).toBe(false);
  });
});
