/**
 * REG-176 (partial): buildStarters personalisation contract.
 *
 * Pins the MasteryHints personalization layer added in the Foxy RCA fix
 * (RC-17/RC-18, 2026-06-26). Ensures:
 *   - Static fallback is unchanged when no masteryHints provided
 *   - nextAction chip prepends with "Continue:" prefix
 *   - overdueTopics chip prepends with title + days-overdue text
 *   - weakTopics chip prepends with title + mastery percent
 *   - Priority order: nextAction > overdueTopics > weakTopics
 *   - Total chip count never exceeds 12 (soft ceiling)
 */
import { describe, it, expect } from 'vitest';
import { buildStarters, type MasteryHints } from '@alfanumrik/lib/foxy/starter-intents';

describe('buildStarters — no personalisation (regression guard)', () => {
  it('returns static chips when no masteryHints provided', () => {
    const chips = buildStarters({ subject: 'science', hasLastTopic: false });
    expect(chips.length).toBeGreaterThan(0);
    // Static chips never contain a mastery percentage (that pattern only
    // appears in personalized chips generated from MasteryHints).
    expect(chips.every((c) => !c.text.match(/\d+%/))).toBe(true);
  });

  it('static chips for unknown subject still produce universal starters', () => {
    const chips = buildStarters({ subject: 'unknown_subject', hasLastTopic: false });
    // Universal starters are always present (minus explain_last when no last topic).
    expect(chips.some((c) => c.intent === 'study_today')).toBe(true);
    expect(chips.some((c) => c.intent === 'quiz')).toBe(true);
  });

  it('filters out explain_last chip when hasLastTopic is false', () => {
    const chips = buildStarters({ subject: 'math', hasLastTopic: false });
    expect(chips.every((c) => c.intent !== 'explain_last')).toBe(true);
  });

  it('includes explain_last chip when hasLastTopic is true', () => {
    const chips = buildStarters({ subject: 'math', hasLastTopic: true });
    expect(chips.some((c) => c.intent === 'explain_last')).toBe(true);
  });
});

describe('buildStarters — personalisation', () => {
  it('prepends CME next action chip when nextAction provided', () => {
    const hints: MasteryHints = {
      nextAction: { conceptName: 'Refraction of Light' },
    };
    const chips = buildStarters({ subject: 'science', hasLastTopic: false, masteryHints: hints });
    expect(chips[0].text).toContain('Refraction of Light');
    // "Continue:" is the prefix — test case-insensitively to be resilient to
    // minor copy changes while still catching a missing/wrong prefix.
    expect(chips[0].text.toLowerCase()).toContain('continue');
  });

  it('prepends overdue revision chip when overdueTopics provided', () => {
    const hints: MasteryHints = {
      overdueTopics: [{ title: 'Photosynthesis', daysOverdue: 3 }],
    };
    const chips = buildStarters({ subject: 'science', hasLastTopic: false, masteryHints: hints });
    expect(chips[0].text).toContain('Photosynthesis');
    // "3 days overdue" contains "3 day" regardless of singular/plural branching
    expect(chips[0].text).toContain('3 day');
  });

  it('uses "1 day" (singular) for exactly 1 day overdue', () => {
    const hints: MasteryHints = {
      overdueTopics: [{ title: 'Gravity', daysOverdue: 1 }],
    };
    const chips = buildStarters({ subject: 'physics', hasLastTopic: false, masteryHints: hints });
    expect(chips[0].text).toContain('1 day');
    // Must NOT render "1 days"
    expect(chips[0].text).not.toContain('1 days');
  });

  it('prepends weak topic chip with mastery percent', () => {
    const hints: MasteryHints = {
      weakTopics: [{ title: 'Acids and Bases', mastery: 0.32 }],
    };
    const chips = buildStarters({ subject: 'science', hasLastTopic: false, masteryHints: hints });
    expect(chips[0].text).toContain('Acids and Bases');
    expect(chips[0].text).toContain('32%');
  });

  it('respects priority: nextAction > overdueTopics > weakTopics', () => {
    const hints: MasteryHints = {
      nextAction: { conceptName: 'Electricity' },
      overdueTopics: [{ title: 'Motion', daysOverdue: 2 }],
      weakTopics: [{ title: 'Force', mastery: 0.28 }],
    };
    const chips = buildStarters({ subject: 'science', hasLastTopic: false, masteryHints: hints });
    // nextAction must land at index 0
    expect(chips[0].text.toLowerCase()).toContain('electricity');
    // overdue must land at index 1
    expect(chips[1].text.toLowerCase()).toContain('motion');
    // weak must land at index 2
    expect(chips[2].text.toLowerCase()).toContain('force');
  });

  it('produces only nextAction chip when only nextAction is provided', () => {
    const hints: MasteryHints = {
      nextAction: { conceptName: 'Osmosis' },
    };
    const chips = buildStarters({ subject: 'biology', hasLastTopic: false, masteryHints: hints });
    // First chip is the personalized one
    expect(chips[0].text.toLowerCase()).toContain('osmosis');
    // No weak-topic or overdue chip follows (no data for them)
    const hasWeakChip = chips.slice(1).some((c) => c.text.includes('%'));
    expect(hasWeakChip).toBe(false);
  });

  it('does not exceed 12 total chips (soft ceiling)', () => {
    const hints: MasteryHints = {
      nextAction: { conceptName: 'Topic A' },
      overdueTopics: [{ title: 'Topic B', daysOverdue: 1 }],
      weakTopics: [{ title: 'Topic C', mastery: 0.3 }],
    };
    // Include a topicTitle and hasLastTopic:true to maximise the static set
    const chips = buildStarters({
      subject: 'science',
      topicTitle: 'Chapter 1',
      hasLastTopic: true,
      masteryHints: hints,
    });
    expect(chips.length).toBeLessThanOrEqual(12);
  });

  it('is byte-identical to static output when masteryHints object is empty', () => {
    const staticChips = buildStarters({ subject: 'math', hasLastTopic: false });
    const emptyHintChips = buildStarters({
      subject: 'math',
      hasLastTopic: false,
      masteryHints: {},
    });
    expect(emptyHintChips).toEqual(staticChips);
  });

  it('every personalized chip has a non-empty textHi field (P7 bilingual)', () => {
    const hints: MasteryHints = {
      nextAction: { conceptName: 'Refraction' },
      overdueTopics: [{ title: 'Photosynthesis', daysOverdue: 2 }],
      weakTopics: [{ title: 'Acids', mastery: 0.25 }],
    };
    const chips = buildStarters({ subject: 'science', hasLastTopic: false, masteryHints: hints });
    // First 3 chips are personalized; each must have a non-empty Hindi label
    chips.slice(0, 3).forEach((chip) => {
      expect(chip.textHi).toBeTruthy();
      expect(chip.textHi.length).toBeGreaterThan(0);
    });
  });
});
