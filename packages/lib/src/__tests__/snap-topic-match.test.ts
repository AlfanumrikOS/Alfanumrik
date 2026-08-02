import { describe, it, expect } from 'vitest';
import {
  matchTopicFromText,
  SNAP_MATCH_CONFIDENCE_FLOOR,
  type SnapCurriculumTopic,
} from '../foxy/snap-topic-match';

function topic(overrides: Partial<SnapCurriculumTopic> = {}): SnapCurriculumTopic {
  return {
    id: 't1',
    title: 'Linear Equations in One Variable',
    titleHi: null,
    chapterNumber: 2,
    subjectCode: 'math',
    subjectName: 'Mathematics',
    ...overrides,
  };
}

describe('matchTopicFromText — REAL deterministic topic-matching heuristic', () => {
  it('matches a question that shares significant words with a topic title', () => {
    const topics = [topic()];
    const result = matchTopicFromText('Solve: 3x + 5 = 20 using linear equations', topics);
    expect(result).not.toBeNull();
    expect(result!.topic.id).toBe('t1');
    expect(result!.confidence).toBeGreaterThanOrEqual(SNAP_MATCH_CONFIDENCE_FLOOR);
  });

  it('returns null when no topic clears the confidence floor', () => {
    const topics = [topic({ title: 'Photosynthesis in Plants' })];
    const result = matchTopicFromText('Solve: 3x + 5 = 20', topics);
    expect(result).toBeNull();
  });

  it('returns null for empty/stopword-only question text', () => {
    const topics = [topic()];
    expect(matchTopicFromText('', topics)).toBeNull();
    expect(matchTopicFromText('the of and is are', topics)).toBeNull();
  });

  it('returns null when the topic list is empty', () => {
    expect(matchTopicFromText('Solve: 3x + 5 = 20 linear equation', [])).toBeNull();
  });

  it('picks the best-scoring topic when multiple overlap', () => {
    const topics = [
      topic({ id: 'weak', title: 'Word Problems on Numbers' }),
      topic({ id: 'strong', title: 'Linear Equations in One Variable' }),
    ];
    const result = matchTopicFromText(
      'Solve this linear equation in one variable: 2x - 7 = 15',
      topics,
    );
    expect(result?.topic.id).toBe('strong');
  });

  it('is case-insensitive and punctuation-insensitive', () => {
    const topics = [topic({ title: 'Force and Pressure' })];
    const result = matchTopicFromText('What is FORCE, and how is PRESSURE defined?', topics);
    expect(result?.topic.title).toBe('Force and Pressure');
  });

  it('never returns a confidence above 1', () => {
    const topics = [topic({ title: 'Force' })];
    const result = matchTopicFromText('force force force force', topics);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  it('skips topics with an empty/whitespace title without throwing', () => {
    const topics = [topic({ title: '' }), topic({ id: 't2', title: '   ' })];
    expect(matchTopicFromText('anything at all here', topics)).toBeNull();
  });
});
