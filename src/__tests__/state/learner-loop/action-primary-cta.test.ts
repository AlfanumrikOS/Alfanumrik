/**
 * Phase 3b tests — pure actionPrimaryCta mapper.
 *
 * Every LearnerAction kind gets a bilingual button-label test. CTAs are
 * tighter than the card display strings — verb-led, fit on one line of
 * a 56px mobile button, ~24 chars max.
 *
 * The mapper is total over the LearnerAction discriminated union; this
 * file enforces both the language pair AND a "short enough to button"
 * length guard so prod doesn't ship a CTA that wraps awkwardly.
 */

import { describe, it, expect } from 'vitest';
import { actionPrimaryCta } from '../../../lib/state/learner-loop/action-display';
import type { LearnerAction } from '../../../lib/state/learner-loop/types';
import { ALL_ACTION_KINDS } from '../../../lib/state/learner-loop/types';

// Reasonable button-fit caps; the actual font/width is checked
// visually but a length guard catches accidentally long copy edits.
const EN_MAX_CHARS = 28;
const HI_MAX_CHARS = 28;

function makeSyntheticAction(kind: typeof ALL_ACTION_KINDS[number]): LearnerAction {
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
}

// ── Per-kind label tests ─────────────────────────────────────────────

describe('actionPrimaryCta — per-kind labels', () => {
  it('cold_start_diagnostic', () => {
    const cta = actionPrimaryCta({
      kind: 'cold_start_diagnostic',
      url: '/diagnostic',
      reason: 'no_signals_yet',
    });
    expect(cta.en).toBe('Take the diagnostic');
    expect(cta.hi).toBe('डायग्नोस्टिक लो');
  });

  it('review_due_cards — singular n=1', () => {
    const cta = actionPrimaryCta({
      kind: 'review_due_cards',
      url: '/review',
      dueCount: 1,
      reason: 'reviews_due_today',
    });
    expect(cta.en).toBe('Review 1 card');
    expect(cta.hi).toBe('1 कार्ड दोहराओ');
  });

  it('review_due_cards — plural n>1', () => {
    const cta = actionPrimaryCta({
      kind: 'review_due_cards',
      url: '/review',
      dueCount: 7,
      reason: 'reviews_stacking',
    });
    expect(cta.en).toBe('Review 7 cards');
    expect(cta.hi).toBe('7 कार्ड दोहराओ');
  });

  it('revise_decayed_topic — names the chapter', () => {
    const cta = actionPrimaryCta({
      kind: 'revise_decayed_topic',
      url: '/learn/science/7?mode=read&from=revise',
      subjectCode: 'science',
      chapterNumber: 7,
      daysSinceLastTouch: 30,
      recommendedModality: 'read',
      reason: 'decay_above_threshold',
    });
    expect(cta.en).toBe('Revise Chapter 7');
    expect(cta.hi).toBe('अध्याय 7 दोहराओ');
  });

  it("start_quiz — preserves the legacy 'Start today's quiz' wording", () => {
    const cta = actionPrimaryCta({
      kind: 'start_quiz',
      url: '/quiz?subject=math&chapter=1',
      subjectCode: 'math',
      chapterNumber: 1,
      zpdBin: 1,
      reason: 'todays_zpd',
    });
    expect(cta.en).toBe("Start today's quiz");
    expect(cta.hi).toBe('आज का क्विज़ शुरू करो');
  });

  it('continue_lesson — names the chapter', () => {
    const cta = actionPrimaryCta({
      kind: 'continue_lesson',
      url: '/learn/x/4',
      subjectCode: 'x',
      chapterNumber: 4,
      progressPct: 0.62,
      reason: 'in_progress_lesson',
    });
    expect(cta.en).toBe('Continue Chapter 4');
    expect(cta.hi).toBe('अध्याय 4 जारी रखो');
  });

  it('weekly_dive', () => {
    const cta = actionPrimaryCta({
      kind: 'weekly_dive',
      url: '/dive',
      suggestedPrompt: 'ignored at CTA layer',
      reason: 'sunday_default',
    });
    expect(cta.en).toBe('Take a deep dive');
    expect(cta.hi).toBe('गहरी डाइव लो');
  });

  it('monthly_synthesis', () => {
    const cta = actionPrimaryCta({
      kind: 'monthly_synthesis',
      url: '/progress?view=synthesis',
      reason: 'month_end_default',
    });
    expect(cta.en).toBe('See monthly synthesis');
    expect(cta.hi).toBe('महीने का सारांश देखो');
  });
});

// ── Length guard — protects against accidentally long copy edits ─────

describe('actionPrimaryCta — button-fit length guard', () => {
  it.each(ALL_ACTION_KINDS)('every kind fits the button cap: %s', (kind) => {
    const cta = actionPrimaryCta(makeSyntheticAction(kind));
    expect(cta.en.length).toBeLessThanOrEqual(EN_MAX_CHARS);
    expect(cta.hi.length).toBeLessThanOrEqual(HI_MAX_CHARS);
  });
});

// ── Exhaustiveness — match action-display.test.ts pattern ────────────

describe('actionPrimaryCta — coverage', () => {
  it('returns non-empty bilingual labels for every kind', () => {
    for (const kind of ALL_ACTION_KINDS) {
      const cta = actionPrimaryCta(makeSyntheticAction(kind));
      expect(cta.en.length).toBeGreaterThan(0);
      expect(cta.hi.length).toBeGreaterThan(0);
    }
  });
});
