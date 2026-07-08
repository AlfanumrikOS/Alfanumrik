/**
 * Unit tests for src/lib/today/map-action.ts.
 *
 * Pins the pure LearnerAction → TodayQueueItem projection:
 *   - url is PARSED into { route, params } for every action shape,
 *   - kind (+reason for start_quiz) maps to the correct render TodayItemType,
 *   - meta fields are lifted verbatim and absent fields are omitted,
 *   - estMinutes / iconHint / labelKey / subtitleKey follow the contract.
 */
import { describe, it, expect } from 'vitest';
import { mapActionToTodayItem } from '@alfanumrik/lib/today/map-action';
import type { LearnerAction } from '@alfanumrik/lib/state/learner-loop/types';

describe('mapActionToTodayItem — deep link parsing', () => {
  it('parses path + querystring into route and params (start_quiz)', () => {
    const action: LearnerAction = {
      kind: 'start_quiz',
      url: '/quiz?subject=math&chapter=4',
      subjectCode: 'math',
      chapterNumber: 4,
      zpdBin: 2,
      reason: 'todays_zpd',
    };
    const item = mapActionToTodayItem(action, 1);
    expect(item.deepLink.route).toBe('/quiz');
    expect(item.deepLink.params).toEqual({ subject: 'math', chapter: 4 });
  });

  it('keeps non-numeric query values as strings, coerces integers (revise)', () => {
    const action: LearnerAction = {
      kind: 'revise_decayed_topic',
      url: '/learn/science/3?mode=read&from=revise',
      subjectCode: 'science',
      chapterNumber: 3,
      daysSinceLastTouch: 12,
      recommendedModality: 'read',
      reason: 'decay_above_threshold',
    };
    const item = mapActionToTodayItem(action, 2);
    expect(item.deepLink.route).toBe('/learn/science/3');
    expect(item.deepLink.params).toEqual({ mode: 'read', from: 'revise' });
  });

  it('omits params entirely when the url has no querystring (cold start)', () => {
    const action: LearnerAction = {
      kind: 'cold_start_diagnostic',
      url: '/diagnostic',
      reason: 'no_signals_yet',
    };
    const item = mapActionToTodayItem(action, 1);
    expect(item.deepLink).toEqual({ route: '/diagnostic' });
    expect(item.deepLink.params).toBeUndefined();
  });

  it('parses the synthesis view-param url (monthly_synthesis)', () => {
    const action: LearnerAction = {
      kind: 'monthly_synthesis',
      url: '/progress?view=synthesis',
      reason: 'month_end_default',
    };
    const item = mapActionToTodayItem(action, 1);
    expect(item.deepLink.route).toBe('/progress');
    expect(item.deepLink.params).toEqual({ view: 'synthesis' });
  });
});

describe('mapActionToTodayItem — type + reason split', () => {
  it("maps start_quiz reason 'todays_zpd' → weak_topic_zpd", () => {
    const item = mapActionToTodayItem(
      {
        kind: 'start_quiz',
        url: '/quiz?subject=math&chapter=4',
        subjectCode: 'math',
        chapterNumber: 4,
        zpdBin: 2,
        reason: 'todays_zpd',
      },
      1,
    );
    expect(item.type).toBe('weak_topic_zpd');
    expect(item.iconHint).toBe('target');
    expect(item.estMinutes).toBe(7);
  });

  it("maps start_quiz reason 'weakest_topic_practice' → practice_weakest", () => {
    const item = mapActionToTodayItem(
      {
        kind: 'start_quiz',
        url: '/quiz?subject=math&chapter=4',
        subjectCode: 'math',
        chapterNumber: 4,
        zpdBin: 3,
        reason: 'weakest_topic_practice',
      },
      1,
    );
    expect(item.type).toBe('practice_weakest');
    expect(item.iconHint).toBe('target');
  });

  it('maps review_due_cards → srs_due', () => {
    const item = mapActionToTodayItem(
      { kind: 'review_due_cards', url: '/review', dueCount: 8, reason: 'reviews_stacking' },
      1,
    );
    expect(item.type).toBe('srs_due');
    expect(item.iconHint).toBe('cards-stack');
  });

  it('maps weekly_dive → weekly_dive_due', () => {
    const item = mapActionToTodayItem(
      { kind: 'weekly_dive', url: '/dive', suggestedPrompt: 'Pick a phenomenon', reason: 'sunday_default' },
      1,
    );
    expect(item.type).toBe('weekly_dive_due');
    expect(item.iconHint).toBe('telescope');
    expect(item.estMinutes).toBe(15);
  });

  it('maps monthly_synthesis → monthly_synthesis_due', () => {
    const item = mapActionToTodayItem(
      { kind: 'monthly_synthesis', url: '/progress?view=synthesis', reason: 'month_end_default' },
      1,
    );
    expect(item.type).toBe('monthly_synthesis_due');
    expect(item.iconHint).toBe('scroll');
    expect(item.estMinutes).toBe(12);
  });

  it('maps resume_in_progress (in_lesson) → resume_in_progress', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'resume_in_progress',
        url: '/learn/science/3',
        liveKind: 'in_lesson',
        subjectCode: 'science',
        chapterNumber: 3,
        reason: 'live_session',
      },
      1,
    );
    expect(item.type).toBe('resume_in_progress');
    expect(item.iconHint).toBe('play-resume');
    expect(item.estMinutes).toBe(5);
  });

  it('maps continue_lesson → continue_lesson', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'continue_lesson',
        url: '/learn/math/2',
        subjectCode: 'math',
        chapterNumber: 2,
        progressPct: 0.6,
        reason: 'in_progress_lesson',
      },
      1,
    );
    expect(item.type).toBe('continue_lesson');
    expect(item.iconHint).toBe('book-open');
    expect(item.estMinutes).toBe(6);
  });
});

describe('mapActionToTodayItem — meta extraction (verbatim, no fabrication)', () => {
  it('srs_due meta carries dueCount; estMinutes = min(dueCount, 5)', () => {
    const small = mapActionToTodayItem(
      { kind: 'review_due_cards', url: '/review', dueCount: 3, reason: 'reviews_due_today' },
      1,
    );
    expect(small.meta).toEqual({ dueCount: 3 });
    expect(small.estMinutes).toBe(3);

    const large = mapActionToTodayItem(
      { kind: 'review_due_cards', url: '/review', dueCount: 20, reason: 'reviews_stacking' },
      1,
    );
    expect(large.estMinutes).toBe(5); // clamped to 5
  });

  it('revise meta carries subjectCode/chapter/daysSince/modality', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'revise_decayed_topic',
        url: '/learn/science/3?mode=read&from=revise',
        subjectCode: 'science',
        chapterNumber: 3,
        daysSinceLastTouch: 12,
        recommendedModality: 'explainer',
        reason: 'decay_above_threshold',
      },
      1,
    );
    expect(item.meta).toEqual({
      subjectCode: 'science',
      chapterNumber: 3,
      daysSinceLastTouch: 12,
      recommendedModality: 'explainer',
    });
  });

  it('start_quiz meta carries subjectCode/chapter/zpdBin', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'start_quiz',
        url: '/quiz?subject=math&chapter=4',
        subjectCode: 'math',
        chapterNumber: 4,
        zpdBin: 2,
        reason: 'todays_zpd',
      },
      1,
    );
    expect(item.meta).toEqual({ subjectCode: 'math', chapterNumber: 4, zpdBin: 2 });
  });

  it('continue_lesson meta carries subjectCode/chapter/progressPct', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'continue_lesson',
        url: '/learn/math/2',
        subjectCode: 'math',
        chapterNumber: 2,
        progressPct: 0.6,
        reason: 'in_progress_lesson',
      },
      1,
    );
    expect(item.meta).toEqual({ subjectCode: 'math', chapterNumber: 2, progressPct: 0.6 });
  });

  it('weekly_dive surfaces suggestedPrompt; omits absent defaultPicker', () => {
    const item = mapActionToTodayItem(
      { kind: 'weekly_dive', url: '/dive', suggestedPrompt: 'Pick something', reason: 'sunday_default' },
      1,
    );
    expect(item.meta).toEqual({ suggestedPrompt: 'Pick something' });
    expect(item.meta).not.toHaveProperty('defaultPicker');
  });

  it('monthly_synthesis omits meta entirely (no monthLabel field exists)', () => {
    const item = mapActionToTodayItem(
      { kind: 'monthly_synthesis', url: '/progress?view=synthesis', reason: 'month_end_default' },
      1,
    );
    expect(item.meta).toBeUndefined();
  });

  it('cold_start omits meta entirely', () => {
    const item = mapActionToTodayItem(
      { kind: 'cold_start_diagnostic', url: '/diagnostic', reason: 'no_signals_yet' },
      1,
    );
    expect(item.meta).toBeUndefined();
  });

  it('resume_in_progress (in_foxy, no subject) omits absent optional fields', () => {
    const item = mapActionToTodayItem(
      { kind: 'resume_in_progress', url: '/foxy', liveKind: 'in_foxy', reason: 'live_session' },
      1,
    );
    expect(item.meta).toEqual({ liveKind: 'in_foxy' });
    expect(item.meta).not.toHaveProperty('subjectCode');
    expect(item.meta).not.toHaveProperty('chapterNumber');
  });

  it('teacher_remediation surfaces source/assignmentId/chapterId + anchor (Phase 3A A3)', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'teacher_remediation',
        url: '/quiz?subject=science&chapter=2&remediationId=99999999-9999-9999-9999-999999999999&from=teacher',
        source: 'teacher',
        assignmentId: '99999999-9999-9999-9999-999999999999',
        chapterId: '88888888-8888-8888-8888-888888888888',
        subjectCode: 'science',
        chapterNumber: 2,
        reason: 'teacher_assigned',
      },
      1,
    );
    expect(item.type).toBe('teacher_remediation');
    expect(item.deepLink.route).toBe('/quiz');
    expect(item.deepLink.params).toMatchObject({
      subject: 'science',
      chapter: 2,
      remediationId: '99999999-9999-9999-9999-999999999999',
      from: 'teacher',
    });
    expect(item.meta).toEqual({
      source: 'teacher',
      assignmentId: '99999999-9999-9999-9999-999999999999',
      chapterId: '88888888-8888-8888-8888-888888888888',
      subjectCode: 'science',
      chapterNumber: 2,
    });
    expect(item.reason).toBe('teacher_assigned');
  });

  it('teacher_remediation (general, chapter_id null) omits the anchor fields', () => {
    const item = mapActionToTodayItem(
      {
        kind: 'teacher_remediation',
        url: '/quiz?subject=science&chapter=3&remediationId=99999999-9999-9999-9999-999999999999&from=teacher',
        source: 'teacher',
        assignmentId: '99999999-9999-9999-9999-999999999999',
        chapterId: null,
        subjectCode: 'science',
        chapterNumber: 3,
        reason: 'teacher_assigned',
      },
      1,
    );
    expect(item.meta).toMatchObject({ source: 'teacher', chapterId: null });
  });
});

describe('mapActionToTodayItem — rank + i18n keys', () => {
  it('uses the passed rank and derives today.item.<type>.{label,subtitle}', () => {
    const item = mapActionToTodayItem(
      { kind: 'review_due_cards', url: '/review', dueCount: 6, reason: 'reviews_stacking' },
      3,
    );
    expect(item.rank).toBe(3);
    expect(item.labelKey).toBe('today.item.srs_due.label');
    expect(item.subtitleKey).toBe('today.item.srs_due.subtitle');
    expect(item.reason).toBe('reviews_stacking');
  });
});
