import { describe, it, expect } from 'vitest';
import { parseFoxyChapterNumber } from './chapter-parser';

describe('parseFoxyChapterNumber', () => {
  it('parses bare chapter numbers', () => {
    expect(parseFoxyChapterNumber('3')).toBe(3);
  });

  it('parses "Chapter N" legacy labels', () => {
    expect(parseFoxyChapterNumber('Chapter 3')).toBe(3);
  });

  it('parses abbreviated "Ch. N" legacy labels', () => {
    expect(parseFoxyChapterNumber('Ch. 3')).toBe(3);
  });

  it('parses chapter labels with suffix text', () => {
    expect(parseFoxyChapterNumber('Chapter 3: Light')).toBe(3);
  });

  it('returns null when no positive chapter number is present', () => {
    expect(parseFoxyChapterNumber('Light')).toBeNull();
    expect(parseFoxyChapterNumber(null)).toBeNull();
  });
});
