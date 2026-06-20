/**
 * Phase 3a tests — pure action-display mapper.
 *
 * Every LearnerAction kind gets a bilingual display test. The mapper is
 * a total function over the LearnerAction discriminated union; if a new
 * action kind is added, the compiler errors at action-display.ts AND a
 * test below should be added. This file pins both the English and
 * Hindi strings + the icon + the tint so design changes are explicit.
 */

import { describe, it, expect } from 'vitest';
import { actionDisplay } from '../../../lib/state/learner-loop/action-display';
import type { LearnerAction } from '../../../lib/state/learner-loop/types';
import { ALL_ACTION_KINDS } from '../../../lib/state/learner-loop/types';

describe('actionDisplay — every action kind has a bilingual display', () => {
  it('cold_start_diagnostic', () => {
    const action: LearnerAction = {
      kind: 'cold_start_diagnostic',
      url: '/diagnostic',
      reason: 'no_signals_yet',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('🎯');
    expect(d.titleEn).toBe('Take the diagnostic quiz');
    expect(d.titleHi.length).toBeGreaterThan(0);
    expect(d.eyebrowEn).toBe('Get started');
  });

  it('review_due_cards — singular n=1', () => {
    const action: LearnerAction = {
      kind: 'review_due_cards',
      url: '/review',
      dueCount: 1,
      reason: 'reviews_stacking',
    };
    const d = actionDisplay(action);
    expect(d.titleEn).toBe('Review 1 flashcard');
  });

  it('review_due_cards — plural n>1', () => {
    const action: LearnerAction = {
      kind: 'review_due_cards',
      url: '/review',
      dueCount: 7,
      reason: 'reviews_stacking',
    };
    const d = actionDisplay(action);
    expect(d.titleEn).toBe('Review 7 flashcards');
    expect(d.titleHi).toContain('7');
  });

  it('revise_decayed_topic — read modality', () => {
    const action: LearnerAction = {
      kind: 'revise_decayed_topic',
      url: '/learn/science/7?mode=read&from=revise',
      subjectCode: 'science',
      chapterNumber: 7,
      daysSinceLastTouch: 30,
      recommendedModality: 'read',
      reason: 'decay_above_threshold',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('📖');
    expect(d.titleEn).toContain('Science');
    expect(d.titleEn).toContain('Chapter 7');
    expect(d.titleHi).toContain('विज्ञान');
    expect(d.subEn).toContain('30 days');
  });

  it('revise_decayed_topic — worked-example modality', () => {
    const action: LearnerAction = {
      kind: 'revise_decayed_topic',
      url: '/learn/math/3?mode=read&from=revise',
      subjectCode: 'math',
      chapterNumber: 3,
      daysSinceLastTouch: 60,
      recommendedModality: 'worked-example',
      reason: 'decay_above_threshold',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('✏️');
    expect(d.titleHi).toContain('गणित');
  });

  it('start_quiz — todays_zpd eyebrow', () => {
    const action: LearnerAction = {
      kind: 'start_quiz',
      url: '/quiz?subject=science&chapter=3',
      subjectCode: 'science',
      chapterNumber: 3,
      zpdBin: 2,
      reason: 'todays_zpd',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('⚡');
    expect(d.eyebrowEn).toBe("Today's practice");
    expect(d.subEn).toContain('Build');
    expect(d.subHi).toContain('मज़बूती');
  });

  it('start_quiz — weakest_topic_practice eyebrow', () => {
    const action: LearnerAction = {
      kind: 'start_quiz',
      url: '/quiz?subject=math&chapter=1',
      subjectCode: 'math',
      chapterNumber: 1,
      zpdBin: 1,
      reason: 'weakest_topic_practice',
    };
    const d = actionDisplay(action);
    expect(d.eyebrowEn).toBe('Practice');
    expect(d.subEn).toContain('Foundation');
  });

  it('continue_lesson — progress percent shown', () => {
    const action: LearnerAction = {
      kind: 'continue_lesson',
      url: '/learn/science/4',
      subjectCode: 'science',
      chapterNumber: 4,
      progressPct: 0.62,
      reason: 'in_progress_lesson',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('📚');
    expect(d.subEn).toContain('62%');
    expect(d.subHi).toContain('62%');
  });

  it('weekly_dive — passes through suggestedPrompt', () => {
    const action: LearnerAction = {
      kind: 'weekly_dive',
      url: '/dive',
      suggestedPrompt: 'Pick a phenomenon from physics you are curious about',
      reason: 'sunday_default',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('🌊');
    expect(d.subEn).toBe('Pick a phenomenon from physics you are curious about');
    expect(d.eyebrowEn).toBe('This Sunday');
  });

  it('monthly_synthesis', () => {
    const action: LearnerAction = {
      kind: 'monthly_synthesis',
      url: '/progress?view=synthesis',
      reason: 'month_end_default',
    };
    const d = actionDisplay(action);
    expect(d.icon).toBe('🎓');
    expect(d.titleEn).toBe('Your monthly synthesis');
    expect(d.eyebrowEn).toBe('Month-end');
  });
});

describe('actionDisplay — coverage', () => {
  it('handles every kind in ALL_ACTION_KINDS without throwing', () => {
    // Build a synthetic action per kind with minimal valid payload. The
    // type assertions are safe because the mapper accesses only the
    // discriminator + kind-specific fields, not optional ones.
    const synthetic = (kind: typeof ALL_ACTION_KINDS[number]): LearnerAction => {
      switch (kind) {
        case 'cold_start_diagnostic':
          return { kind, url: '/diagnostic', reason: 'no_signals_yet' };
        case 'teacher_remediation':
          return {
            kind,
            url: '/quiz?subject=x&chapter=1&remediationId=99999999-9999-9999-9999-999999999999&from=teacher',
            source: 'teacher',
            assignmentId: '99999999-9999-9999-9999-999999999999',
            chapterId: '88888888-8888-8888-8888-888888888888',
            subjectCode: 'x', chapterNumber: 1, reason: 'teacher_assigned',
          };
        case 'review_due_cards':
          return { kind, url: '/review', dueCount: 3, reason: 'reviews_stacking' };
        case 'revise_decayed_topic':
          return {
            kind, url: '/learn/x/1?mode=read&from=revise',
            subjectCode: 'x', chapterNumber: 1, daysSinceLastTouch: 10,
            recommendedModality: 'read', reason: 'decay_above_threshold',
          };
        case 'start_quiz':
          return {
            kind, url: '/quiz?subject=x&chapter=1',
            subjectCode: 'x', chapterNumber: 1, zpdBin: 1, reason: 'todays_zpd',
          };
        case 'continue_lesson':
          return {
            kind, url: '/learn/x/1',
            subjectCode: 'x', chapterNumber: 1, progressPct: 0.5, reason: 'in_progress_lesson',
          };
        case 'weekly_dive':
          return { kind, url: '/dive', suggestedPrompt: 'x', reason: 'sunday_default' };
        case 'monthly_synthesis':
          return { kind, url: '/progress?view=synthesis', reason: 'month_end_default' };
        case 'introduce_new_topic':
          return {
            kind, url: '/learn/x/2?mode=read&from=new_topic',
            subjectCode: 'x', chapterNumber: 2, reason: 'unstarted_chapter_available',
          };
        case 'resume_in_progress':
          return {
            kind, url: '/learn/x/1', liveKind: 'in_lesson',
            subjectCode: 'x', chapterNumber: 1, reason: 'live_session',
          };
      }
    };
    for (const kind of ALL_ACTION_KINDS) {
      const d = actionDisplay(synthetic(kind));
      expect(d.icon.length).toBeGreaterThan(0);
      expect(d.titleEn.length).toBeGreaterThan(0);
      expect(d.titleHi.length).toBeGreaterThan(0);
      expect(d.subEn.length).toBeGreaterThan(0);
      expect(d.subHi.length).toBeGreaterThan(0);
    }
  });
});

describe('actionDisplay — Hindi subject vocabulary', () => {
  it('translates known subjects to Devanagari', () => {
    const cases: Array<[string, string]> = [
      ['math', 'गणित'],
      ['mathematics', 'गणित'],
      ['science', 'विज्ञान'],
      ['physics', 'भौतिकी'],
      ['chemistry', 'रसायन'],
      ['biology', 'जीव विज्ञान'],
    ];
    for (const [code, hi] of cases) {
      const action: LearnerAction = {
        kind: 'start_quiz',
        url: `/quiz?subject=${code}&chapter=1`,
        subjectCode: code,
        chapterNumber: 1,
        zpdBin: 1,
        reason: 'todays_zpd',
      };
      const d = actionDisplay(action);
      expect(d.titleHi).toContain(hi);
    }
  });

  it('falls back to capitalised English for unknown subjects', () => {
    const action: LearnerAction = {
      kind: 'start_quiz',
      url: '/quiz?subject=unknownsubject&chapter=1',
      subjectCode: 'unknownsubject',
      chapterNumber: 1,
      zpdBin: 1,
      reason: 'todays_zpd',
    };
    const d = actionDisplay(action);
    expect(d.titleHi).toContain('Unknownsubject');
  });
});
