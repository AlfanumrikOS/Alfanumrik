/**
 * REG-173: Chapter titles in Today queue
 *
 * Verifies that chapter titles from curriculum_topics are correctly surfaced
 * in TodayQueueItem via mapActionToTodayItem, and that todayCopy renders
 * the {chapterTitle} interpolation token correctly (including the edge case
 * where chapterTitle is an empty string, which must not leave a stray " · ").
 *
 * Uses the REAL mapActionToTodayItem and todayCopy — no mocks needed; both
 * are pure, side-effect-free functions.
 */
import { describe, it, expect } from 'vitest';
import { mapActionToTodayItem } from '@alfanumrik/lib/today/map-action';
import { todayCopy } from '@alfanumrik/lib/today/copy';
import type {
  StartQuizAction,
  ColdStartDiagnosticAction,
  IntroduceNewTopicAction,
  ReviseDecayedTopicAction,
} from '@alfanumrik/lib/state/learner-loop/types';

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** Minimal valid start_quiz action for today's ZPD branch. */
function makeStartQuizAction(subjectCode: string, chapterNumber: number): StartQuizAction {
  return {
    kind: 'start_quiz',
    url: `/quiz?subject=${subjectCode}&chapter=${chapterNumber}`,
    subjectCode,
    chapterNumber,
    zpdBin: 2,
    reason: 'todays_zpd',
  };
}

/** Minimal cold_start_diagnostic action — no chapter anchor. */
const coldStartAction: ColdStartDiagnosticAction = {
  kind: 'cold_start_diagnostic',
  url: '/diagnostic',
  reason: 'no_signals_yet',
};

/** Minimal introduce_new_topic action. */
function makeNewTopicAction(subjectCode: string, chapterNumber: number): IntroduceNewTopicAction {
  return {
    kind: 'introduce_new_topic',
    url: `/learn/${subjectCode}/${chapterNumber}?mode=read&from=new_topic`,
    subjectCode,
    chapterNumber,
    reason: 'unstarted_chapter_available',
  };
}

/** Minimal revise_decayed_topic action. */
function makeReviseAction(subjectCode: string, chapterNumber: number): ReviseDecayedTopicAction {
  return {
    kind: 'revise_decayed_topic',
    url: `/learn/${subjectCode}/${chapterNumber}?mode=read&from=revise`,
    subjectCode,
    chapterNumber,
    daysSinceLastTouch: 14,
    recommendedModality: 'read',
    reason: 'decay_above_threshold',
  };
}

type ChapterTitleMap = Map<string, { title: string; titleHi: string | null }>;

// ── Tests: mapActionToTodayItem chapter title wiring ─────────────────────────

describe('REG-173: mapActionToTodayItem — chapter title population', () => {
  it('REG-173-A: start_quiz with matching chapterTitles entry → chapterTitle and chapterTitleHi populated', () => {
    const chapterTitles: ChapterTitleMap = new Map([
      ['science|1', { title: 'Nutrition in Plants', titleHi: 'पादपों में पोषण' }],
    ]);
    const item = mapActionToTodayItem(makeStartQuizAction('science', 1), 1, chapterTitles);

    expect(item.chapterTitle).toBe('Nutrition in Plants');
    expect(item.chapterTitleHi).toBe('पादपों में पोषण');
  });

  it('REG-173-B: start_quiz without chapterTitles arg → chapterTitle absent', () => {
    const item = mapActionToTodayItem(makeStartQuizAction('science', 1), 1);

    expect(item.chapterTitle).toBeUndefined();
    expect(item.chapterTitleHi).toBeUndefined();
  });

  it('REG-173-C: chapterTitles entry has titleHi = null → chapterTitleHi absent (not null)', () => {
    const chapterTitles: ChapterTitleMap = new Map([
      ['science|1', { title: 'Nutrition in Plants', titleHi: null }],
    ]);
    const item = mapActionToTodayItem(makeStartQuizAction('science', 1), 1, chapterTitles);

    expect(item.chapterTitle).toBe('Nutrition in Plants');
    // null titleHi must be converted to undefined, not kept as null
    expect(item.chapterTitleHi).toBeUndefined();
  });

  it('REG-173-D: key format is "subjectCode|chapterNumber" — wrong key → no title', () => {
    // Only entry has key 'mathematics|5'; action uses chapter 6
    const chapterTitles: ChapterTitleMap = new Map([
      ['mathematics|5', { title: 'Integers', titleHi: 'पूर्णांक' }],
    ]);
    const item = mapActionToTodayItem(makeStartQuizAction('mathematics', 6), 1, chapterTitles);

    expect(item.chapterTitle).toBeUndefined();
  });

  it('REG-173-E: key format matches "mathematics|5" for chapter 5', () => {
    const chapterTitles: ChapterTitleMap = new Map([
      ['mathematics|5', { title: 'Integers', titleHi: 'पूर्णांक' }],
    ]);
    const item = mapActionToTodayItem(makeStartQuizAction('mathematics', 5), 1, chapterTitles);

    expect(item.chapterTitle).toBe('Integers');
    expect(item.chapterTitleHi).toBe('पूर्णांक');
  });

  it('REG-173-F: cold_start_diagnostic (no chapter anchor) → no chapterTitle even with map', () => {
    const chapterTitles: ChapterTitleMap = new Map([
      ['science|1', { title: 'Nutrition in Plants', titleHi: null }],
    ]);
    const item = mapActionToTodayItem(coldStartAction, 1, chapterTitles);

    expect(item.chapterTitle).toBeUndefined();
    expect(item.chapterTitleHi).toBeUndefined();
  });

  it('REG-173-G: introduce_new_topic → chapterTitle populated from map', () => {
    const chapterTitles: ChapterTitleMap = new Map([
      ['history|3', { title: 'The French Revolution', titleHi: 'फ्रांसीसी क्रांति' }],
    ]);
    const item = mapActionToTodayItem(makeNewTopicAction('history', 3), 2, chapterTitles);

    expect(item.chapterTitle).toBe('The French Revolution');
    expect(item.chapterTitleHi).toBe('फ्रांसीसी क्रांति');
  });

  it('REG-173-H: revise_decayed_topic → chapterTitle populated from map', () => {
    const chapterTitles: ChapterTitleMap = new Map([
      ['science|2', { title: 'Nutrition in Animals', titleHi: 'जंतुओं में पोषण' }],
    ]);
    const item = mapActionToTodayItem(makeReviseAction('science', 2), 3, chapterTitles);

    expect(item.chapterTitle).toBe('Nutrition in Animals');
  });
});

// ── Tests: todayCopy {chapterTitle} interpolation ────────────────────────────

describe('REG-173: todayCopy — {chapterTitle} interpolation', () => {
  it('REG-173-I: weak_topic_zpd subtitle with {chapterTitle} suffix → full subtitle rendered', () => {
    // The copy template is: 'Practice {subject}{chapterTitle} at your level'
    // Caller pre-builds the separator into chapterTitle: ' · Nutrition in Plants'
    const result = todayCopy('today.item.weak_topic_zpd.subtitle', false, {
      subject: 'Science',
      chapterTitle: ' · Nutrition in Plants',
    });

    expect(result).toContain('Science');
    expect(result).toContain('Nutrition in Plants');
    expect(result).toContain(' · ');
    expect(result).toBe('Practice Science · Nutrition in Plants at your level');
  });

  it('REG-173-J: weak_topic_zpd subtitle with chapterTitle="" → no stray separator in output', () => {
    // When chapterTitle is empty string, it replaces {chapterTitle} with ""
    // Result should be: 'Practice Science at your level' (no " · " artifact)
    const result = todayCopy('today.item.weak_topic_zpd.subtitle', false, {
      subject: 'Science',
      chapterTitle: '',
    });

    expect(result).toContain('Science');
    // Must not have a dangling " · " at the end or with nothing after it
    expect(result).not.toMatch(/ · $/);
    expect(result).not.toMatch(/ · \s*$/);
    // The empty chapterTitle should simply disappear from the output
    expect(result).toBe('Practice Science at your level');
  });

  it('REG-173-K: revise_decayed_topic subtitle with chapterTitle and days → full subtitle', () => {
    // Template: '{subject}{chapterTitle} · last studied {days} days ago'
    const result = todayCopy('today.item.revise_decayed_topic.subtitle', false, {
      subject: 'Science',
      chapterTitle: ' · Nutrition in Plants',
      days: 14,
    });

    expect(result).toBe('Science · Nutrition in Plants · last studied 14 days ago');
  });

  it('REG-173-L: practice_weakest subtitle with chapterTitle in Hindi → bilingual rendering', () => {
    // Template (hi): '{subject}{chapterTitle} मजबूत करें'
    const result = todayCopy('today.item.practice_weakest.subtitle', true, {
      subject: 'विज्ञान',
      chapterTitle: ' · पादपों में पोषण',
    });

    expect(result).toContain('विज्ञान');
    expect(result).toContain('पादपों में पोषण');
    expect(result).toContain('मजबूत करें');
  });

  it('REG-173-M: todayCopy with missing chapterTitle token → token left as-is (graceful fallback)', () => {
    // When vars does not include chapterTitle, the {chapterTitle} token is left raw
    const result = todayCopy('today.item.weak_topic_zpd.subtitle', false, {
      subject: 'Science',
      // chapterTitle deliberately omitted
    });

    // The token is left in-place: 'Practice Science{chapterTitle} at your level'
    expect(result).toContain('Science');
    expect(result).toContain('{chapterTitle}');
  });
});
