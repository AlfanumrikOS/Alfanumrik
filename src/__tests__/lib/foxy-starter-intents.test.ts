/**
 * Foxy starter-intents registry tests.
 *
 * P0 chip-action fix (2026-05-04). Locks the intent contract:
 *   - Every starter (universal + subject) carries one of the 9 intents.
 *   - The intent union covers exactly the 9 codes the dispatcher knows.
 *   - hasLastTopic=false hides the explain_last chip.
 *   - The total chip count is sane (no surprise 8-chip truncation).
 *   - P7: every chip carries both EN and HI labels.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_STARTER_INTENTS,
  UNIVERSAL_STARTERS,
  SUBJECT_STARTERS,
  buildStarters,
  type StarterIntent,
} from '@/lib/foxy/starter-intents';

describe('foxy starter intents — type contract', () => {
  it('exposes exactly 9 canonical intent codes', () => {
    expect(ALL_STARTER_INTENTS).toHaveLength(9);
    const expected: StarterIntent[] = [
      'teach', 'study_today', 'quiz', 'explain_last', 'formulas',
      'weak_areas', 'experiment', 'real_world', 'diagram',
    ];
    expect([...ALL_STARTER_INTENTS].sort()).toEqual([...expected].sort());
  });

  it('every UNIVERSAL_STARTERS entry has an intent on the union', () => {
    for (const s of UNIVERSAL_STARTERS) {
      expect(s.intent).toBeDefined();
      expect(ALL_STARTER_INTENTS).toContain(s.intent);
    }
  });

  it('every SUBJECT_STARTERS entry (across every subject) has an intent', () => {
    for (const [subject, list] of Object.entries(SUBJECT_STARTERS)) {
      for (const s of list) {
        expect(s.intent, `${subject} chip "${s.text}" missing intent`).toBeDefined();
        expect(ALL_STARTER_INTENTS).toContain(s.intent);
      }
    }
  });
});

describe('foxy starter intents — bilingual (P7)', () => {
  it('every universal chip has non-empty EN + HI labels', () => {
    for (const s of UNIVERSAL_STARTERS) {
      expect(s.text.trim().length).toBeGreaterThan(0);
      expect(s.textHi.trim().length).toBeGreaterThan(0);
    }
  });

  it('every subject chip has non-empty EN + HI labels', () => {
    for (const list of Object.values(SUBJECT_STARTERS)) {
      for (const s of list) {
        expect(s.text.trim().length).toBeGreaterThan(0);
        expect(s.textHi.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every chip has a non-empty icon', () => {
    for (const s of UNIVERSAL_STARTERS) {
      expect(s.icon.trim().length).toBeGreaterThan(0);
    }
    for (const list of Object.values(SUBJECT_STARTERS)) {
      for (const s of list) {
        expect(s.icon.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('foxy starter intents — buildStarters', () => {
  it('hasLastTopic=false filters out the explain_last chip', () => {
    const out = buildStarters({ subject: 'science', hasLastTopic: false });
    expect(out.some((s) => s.intent === 'explain_last')).toBe(false);
  });

  it('hasLastTopic=true keeps the explain_last chip', () => {
    const out = buildStarters({ subject: 'science', hasLastTopic: true });
    expect(out.some((s) => s.intent === 'explain_last')).toBe(true);
  });

  it('prepends a teach-me chip when topicTitle is present', () => {
    const out = buildStarters({
      subject: 'science',
      topicTitle: 'Photosynthesis',
      hasLastTopic: true,
    });
    expect(out[0].intent).toBe('teach');
    expect(out[0].text).toContain('Photosynthesis');
  });

  it('does not prepend the teach-me chip when topicTitle is absent', () => {
    const out = buildStarters({ subject: 'science', hasLastTopic: true });
    // First chip should be the first universal (study_today), not "Teach me: …"
    expect(out[0].intent).toBe('study_today');
    expect(out[0].text).not.toMatch(/^Teach me:/);
  });

  it('returns a reasonable chip count for chemistry (no surprise slice(0,8) truncation)', () => {
    const out = buildStarters({ subject: 'chemistry', hasLastTopic: true });
    // 5 universal + 3 chemistry = 8. With hasLastTopic=false it would be 4 + 3 = 7.
    // Critical: the subject-specific chips MUST NOT be silently dropped.
    expect(out.length).toBeGreaterThanOrEqual(7);
    const subjectIntents = out.filter((s) => ['teach', 'experiment', 'real_world', 'diagram'].includes(s.intent));
    // Must include at least one chemistry-specific chip ("Balance this equation", etc.)
    expect(subjectIntents.length).toBeGreaterThan(0);
  });

  it('handles unknown subject by falling back to universal-only', () => {
    const out = buildStarters({ subject: 'unknown_subject', hasLastTopic: true });
    // Should be exactly the 5 universal chips, no subject extras.
    expect(out).toHaveLength(UNIVERSAL_STARTERS.length);
  });

  it('caps total chips at the 12 ceiling (defensive, not currently hit)', () => {
    // Even with topicTitle prepended + every universal + every subject,
    // we're well under 12 today. Lock the cap so future expansions
    // don't blow past it without an explicit decision.
    const out = buildStarters({
      subject: 'science',
      topicTitle: 'Cell Biology',
      hasLastTopic: true,
    });
    expect(out.length).toBeLessThanOrEqual(12);
  });
});
