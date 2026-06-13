import { describe, it, expect } from 'vitest';

/**
 * pulse-copy — Phase A Loop A timeline lines for the three system.* kinds
 * (system.remediation_injected / _recovered / _escalated).
 *
 * Pure-function pins:
 *   - variant-aware copy (student encouraging / parent + teacher actionable)
 *   - P7 bilingual (Hi + En for every line)
 *   - icon + accent always paired with text (never colour-alone)
 *   - escalated copy never claims the wrong helper when `escalatedTo` is
 *     absent from the whitelisted summary (degrades to neutral framing)
 *   - unknown kinds still hit the clean fallback (no raw event names)
 */
import { timelineLine, PULSE_COLORS } from '@/components/pulse/pulse-copy';

const SUMMARY = { subjectCode: 'science', chapterNumber: 4 };

describe('timelineLine — system.remediation_injected', () => {
  it('student EN/HI: Foxy added extra practice for Chapter 4', () => {
    const en = timelineLine('system.remediation_injected', SUMMARY, false, 'student');
    expect(en.text).toBe('Foxy added extra practice for Chapter 4');
    expect(en.icon).toBe('🦊');
    expect(en.accent).toBe(PULSE_COLORS.remediation);

    const hi = timelineLine('system.remediation_injected', SUMMARY, true, 'student');
    expect(hi.text).toBe('Foxy ने अध्याय 4 के लिए अतिरिक्त अभ्यास जोड़ा');
  });

  it('parent + teacher variants use actionable phrasing', () => {
    const parent = timelineLine('system.remediation_injected', SUMMARY, false, 'parent');
    expect(parent.text).toMatch(/Extra practice was added for Chapter 4/);

    const teacher = timelineLine('system.remediation_injected', SUMMARY, false, 'teacher');
    expect(teacher.text).toMatch(/Auto-practice assigned/);
    expect(teacher.text).toMatch(/recovery being tracked/);
  });
});

describe('timelineLine — system.remediation_recovered', () => {
  it('student EN/HI: celebratory recovered line', () => {
    const en = timelineLine('system.remediation_recovered', SUMMARY, false, 'student');
    expect(en.text).toBe('You recovered Chapter 4 🎉');
    expect(en.icon).toBe('🎉');
    expect(en.accent).toBe(PULSE_COLORS.recovered);

    const hi = timelineLine('system.remediation_recovered', SUMMARY, true, 'student');
    expect(hi.text).toContain('अध्याय 4');
    expect(hi.text).toContain('🎉');
  });

  it('teacher variant signals no action needed', () => {
    const teacher = timelineLine('system.remediation_recovered', SUMMARY, false, 'teacher');
    expect(teacher.text).toMatch(/Mastery recovered/);
    expect(teacher.text).toMatch(/no action needed/);
  });
});

describe('timelineLine — system.remediation_escalated', () => {
  it('student: teacher-helper copy only when escalatedTo === "teacher"', () => {
    const en = timelineLine(
      'system.remediation_escalated',
      { ...SUMMARY, escalatedTo: 'teacher' },
      false,
      'student',
    );
    expect(en.text).toBe('Your teacher was asked to help with Chapter 4');
    expect(en.icon).toBe('🤝');
    expect(en.accent).toBe(PULSE_COLORS.escalated);
  });

  it('student: family copy when escalatedTo === "parent"; neutral when absent', () => {
    const fam = timelineLine(
      'system.remediation_escalated',
      { ...SUMMARY, escalatedTo: 'parent' },
      false,
      'student',
    );
    expect(fam.text).toBe('We asked your family to help with Chapter 4');

    // escalatedTo is not in today's whitelist — never claim the wrong helper.
    const neutral = timelineLine('system.remediation_escalated', SUMMARY, false, 'student');
    expect(neutral.text).toBe('Foxy arranged extra help for Chapter 4');
    expect(neutral.text).not.toMatch(/teacher|family/i);
  });

  it('parent + teacher variants are actionable, bilingual', () => {
    const parentEn = timelineLine('system.remediation_escalated', SUMMARY, false, 'parent');
    expect(parentEn.text).toMatch(/Your child needs your support with Chapter 4/);
    const parentHi = timelineLine('system.remediation_escalated', SUMMARY, true, 'parent');
    expect(parentHi.text).toContain('अध्याय 4');

    const teacher = timelineLine('system.remediation_escalated', SUMMARY, false, 'teacher');
    expect(teacher.text).toMatch(/Needs intervention/);
  });
});

describe('timelineLine — fallback safety', () => {
  it('unknown kinds still degrade to the clean generic line', () => {
    const out = timelineLine('system.some_future_kind', {}, false, 'student');
    expect(out.text).toBe('Learning activity');
    expect(out.accent).toBeUndefined();
  });

  it('variant defaults to student (existing 3-arg call sites unchanged)', () => {
    const out = timelineLine('system.remediation_injected', SUMMARY, false);
    expect(out.text).toBe('Foxy added extra practice for Chapter 4');
  });
});
