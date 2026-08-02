import { describe, it, expect } from 'vitest';
import { flattenCurriculumTopics } from '../foxy/use-snap-curriculum-topics';

describe('flattenCurriculumTopics — REAL flatten of the EXISTING /api/v2/learn/curriculum shape', () => {
  it('returns an empty array for null (404 / no student profile)', () => {
    expect(flattenCurriculumTopics(null)).toEqual([]);
  });

  it('flattens subject -> chapter -> topic into a flat list with denormalized subject/chapter fields', () => {
    const flat = flattenCurriculumTopics({
      schemaVersion: 1,
      grade: '9',
      subjects: [
        {
          code: 'math',
          name: 'Mathematics',
          name_hi: 'गणित',
          is_locked: false,
          chapters: [
            {
              chapter_number: 2,
              title: 'Linear Equations',
              title_hi: null,
              topics: [
                { id: 'topic-1', title: 'Linear Equations in One Variable', title_hi: null },
                { id: 'topic-2', title: 'Word Problems', title_hi: null },
              ],
            },
          ],
        },
      ],
    });

    expect(flat).toEqual([
      {
        id: 'topic-1',
        title: 'Linear Equations in One Variable',
        titleHi: null,
        chapterNumber: 2,
        subjectCode: 'math',
        subjectName: 'Mathematics',
      },
      {
        id: 'topic-2',
        title: 'Word Problems',
        titleHi: null,
        chapterNumber: 2,
        subjectCode: 'math',
        subjectName: 'Mathematics',
      },
    ]);
  });

  it('excludes locked (plan/stream-gated) subjects entirely', () => {
    const flat = flattenCurriculumTopics({
      schemaVersion: 1,
      grade: '9',
      subjects: [
        {
          code: 'physics',
          name: 'Physics',
          name_hi: null,
          is_locked: true,
          chapters: [
            {
              chapter_number: 1,
              title: 'Force and Pressure',
              title_hi: null,
              topics: [{ id: 'topic-locked', title: 'Force and Pressure', title_hi: null }],
            },
          ],
        },
      ],
    });
    expect(flat).toEqual([]);
  });

  it('skips topics with a null/empty title', () => {
    const flat = flattenCurriculumTopics({
      schemaVersion: 1,
      grade: '9',
      subjects: [
        {
          code: 'math',
          name: 'Mathematics',
          name_hi: null,
          is_locked: false,
          chapters: [
            {
              chapter_number: 1,
              title: 'Chapter 1',
              title_hi: null,
              topics: [{ id: 'no-title', title: null, title_hi: null }],
            },
          ],
        },
      ],
    });
    expect(flat).toEqual([]);
  });
});
