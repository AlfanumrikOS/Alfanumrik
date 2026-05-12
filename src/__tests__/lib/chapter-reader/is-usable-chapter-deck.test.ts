import { describe, it, expect } from 'vitest';
import { isUsableChapterDeck } from '@/lib/chapter-reader/get-concepts-from-table';
import type { CurriculumTopic } from '@/lib/types';

const goodTopic = (i: number): CurriculumTopic => ({
  id: `c${i}`,
  subject_id: '',
  title: `Concept ${i}`,
  title_hi: null,
  description:
    'Place value of a digit depends on its position. ' +
    'In 1,00,000 the leftmost 1 is in the lakh place. ' +
    'Reading from the right, the place values double in length.',
  grade: '7',
  board: 'CBSE',
  chapter_number: 1,
  difficulty_level: 1,
  estimated_minutes: 5,
  tags: null,
  is_active: true,
  display_order: i,
  learning_objectives: null,
  bloom_focus: 'understand',
  ncert_page_range: null,
  topic_type: 'curated_concept',
});

describe('isUsableChapterDeck', () => {
  it('passes when 3+ rich-content concepts exist', () => {
    expect(isUsableChapterDeck([goodTopic(1), goodTopic(2), goodTopic(3)])).toBe(true);
  });

  it('fails when fewer than MIN_CONCEPTS rows', () => {
    expect(isUsableChapterDeck([goodTopic(1), goodTopic(2)])).toBe(false);
  });

  it('fails when any row has a tiny title', () => {
    const rows = [goodTopic(1), goodTopic(2), goodTopic(3)];
    rows[1].title = 'A';
    expect(isUsableChapterDeck(rows)).toBe(false);
  });

  it('fails when any row has a short explanation (placeholder LP)', () => {
    const rows = [goodTopic(1), goodTopic(2), goodTopic(3)];
    rows[2].description = 'Apply sign rules.';
    expect(isUsableChapterDeck(rows)).toBe(false);
  });

  it('fails on empty input', () => {
    expect(isUsableChapterDeck([])).toBe(false);
  });
});
