'use server';

/**
 * Server actions for /learn/[subject]/[chapter] (Phase 2-B).
 *
 * The page is a `'use client'` component (existing behaviour); these server
 * actions are how it reaches the database without exposing the admin client
 * to the browser. One action today: `loadChapterContent` for Read mode.
 */

import {
  fetchChapterContent,
  type ChapterContent,
} from '@alfanumrik/lib/learn/fetchChapterContent';

export async function loadChapterContent(args: {
  subjectCode: string;
  grade: string;
  chapterNumber: number;
  language?: 'en' | 'hi';
}): Promise<ChapterContent | null> {
  if (
    !args.subjectCode ||
    !args.grade ||
    !Number.isFinite(args.chapterNumber) ||
    args.chapterNumber < 1
  ) {
    return null;
  }
  return fetchChapterContent(args);
}
