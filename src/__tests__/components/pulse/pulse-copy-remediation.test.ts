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

// ════════════════════════════════════════════════════════════════════════════
// Phase A Loop B — inactivity / re-engagement (subject-less)
// ════════════════════════════════════════════════════════════════════════════

describe('timelineLine — system.engagement_nudged', () => {
  it('student EN/HI: warm "come back, we missed you" nudge', () => {
    const en = timelineLine('system.engagement_nudged', {}, false, 'student');
    expect(en.text).toBe("Foxy noticed you've been away — come back, we missed you!");
    expect(en.icon).toBe('👋');
    expect(en.accent).toBe(PULSE_COLORS.nudged);

    const hi = timelineLine('system.engagement_nudged', {}, true, 'student');
    expect(hi.text).toContain('वापस आ जाओ');
    expect(hi.text).not.toBe(en.text); // genuinely localised, not the En string
  });

  it('parent + teacher variants are actionable, bilingual', () => {
    const parent = timelineLine('system.engagement_nudged', {}, false, 'parent');
    expect(parent.text).toMatch(/nudge from you would help/);
    const teacher = timelineLine('system.engagement_nudged', {}, false, 'teacher');
    expect(teacher.text).toMatch(/gone quiet|re-engagement nudge/);
  });
});

describe('timelineLine — system.engagement_returned', () => {
  it('student EN/HI: celebratory welcome-back line', () => {
    const en = timelineLine('system.engagement_returned', {}, false, 'student');
    expect(en.text).toMatch(/Welcome back/);
    expect(en.text).toContain('🎉');
    expect(en.icon).toBe('🎉');
    expect(en.accent).toBe(PULSE_COLORS.returned);

    const hi = timelineLine('system.engagement_returned', {}, true, 'student');
    expect(hi.text).toContain('🎉');
    expect(hi.text).toContain('स्वागत');
  });

  it('teacher variant signals no action needed', () => {
    const teacher = timelineLine('system.engagement_returned', {}, false, 'teacher');
    expect(teacher.text).toMatch(/no action needed/);
  });
});

describe('timelineLine — system.engagement_escalated', () => {
  it('student: family copy when escalatedTo === "parent"; neutral when absent', () => {
    const fam = timelineLine(
      'system.engagement_escalated',
      { escalatedTo: 'parent' },
      false,
      'student',
    );
    expect(fam.text).toMatch(/we let your family know/);
    expect(fam.icon).toBe('🏠');
    expect(fam.accent).toBe(PULSE_COLORS.escalated);

    // escalatedTo absent → never claim a family was told.
    const neutral = timelineLine('system.engagement_escalated', {}, false, 'student');
    expect(neutral.text).not.toMatch(/family/i);
    expect(neutral.text).toMatch(/come back whenever you're ready/);
  });

  it('parent + teacher variants are actionable, bilingual', () => {
    const parent = timelineLine('system.engagement_escalated', {}, false, 'parent');
    expect(parent.text).toMatch(/short session together/);
    const parentHi = timelineLine('system.engagement_escalated', {}, true, 'parent');
    expect(parentHi.text).toContain('साथ बैठकर');

    const teacher = timelineLine('system.engagement_escalated', {}, false, 'teacher');
    expect(teacher.text).toMatch(/family was alerted|stayed inactive/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Phase A Loop C — at-risk concentration (subject-scoped, escalates immediately)
// ════════════════════════════════════════════════════════════════════════════

const C_SUMMARY = { subjectCode: 'science', chapterNumber: 4 };

describe('timelineLine — system.concentration_escalated', () => {
  it('student: teacher-helper copy only when escalatedTo === "teacher"', () => {
    const en = timelineLine(
      'system.concentration_escalated',
      { ...C_SUMMARY, escalatedTo: 'teacher' },
      false,
      'student',
    );
    expect(en.text).toBe('Foxy asked your teacher to help with science');
    expect(en.icon).toBe('🆘');
    expect(en.accent).toBe(PULSE_COLORS.concentration);
  });

  it('student: family copy when escalatedTo === "parent"; neutral when absent', () => {
    const fam = timelineLine(
      'system.concentration_escalated',
      { ...C_SUMMARY, escalatedTo: 'parent' },
      false,
      'student',
    );
    expect(fam.text).toMatch(/let your family know science needs/);

    // escalatedTo absent → never claim the wrong helper.
    const neutral = timelineLine('system.concentration_escalated', C_SUMMARY, false, 'student');
    expect(neutral.text).toBe('science needs some real focus — Foxy arranged extra help');
    expect(neutral.text).not.toMatch(/teacher|family/i);
  });

  it('uses subjectCode from the generic whitelist; HI is localised', () => {
    const hi = timelineLine(
      'system.concentration_escalated',
      { ...C_SUMMARY, escalatedTo: 'teacher' },
      true,
      'student',
    );
    expect(hi.text).toContain('science');
    expect(hi.text).toContain('शिक्षक');
  });

  it('parent + teacher variants are actionable, bilingual', () => {
    const parent = timelineLine('system.concentration_escalated', C_SUMMARY, false, 'parent');
    expect(parent.text).toMatch(/weak area for your child/);
    const teacher = timelineLine('system.concentration_escalated', C_SUMMARY, false, 'teacher');
    expect(teacher.text).toMatch(/flagged at-risk/);
  });
});

describe('timelineLine — system.concentration_resolved', () => {
  it('student EN/HI: celebratory back-on-track line', () => {
    const en = timelineLine('system.concentration_resolved', C_SUMMARY, false, 'student');
    expect(en.text).toBe('Great work — science is back on track! 🎉');
    expect(en.icon).toBe('🎉');
    expect(en.accent).toBe(PULSE_COLORS.recovered);

    const hi = timelineLine('system.concentration_resolved', C_SUMMARY, true, 'student');
    expect(hi.text).toContain('science');
    expect(hi.text).toContain('🎉');
  });

  it('teacher variant signals no action needed', () => {
    const teacher = timelineLine('system.concentration_resolved', C_SUMMARY, false, 'teacher');
    expect(teacher.text).toMatch(/no action needed/);
  });
});

describe('timelineLine — system.concentration_reescalated', () => {
  it('student EN/HI: still-needs-focus, Foxy keeping help going', () => {
    const en = timelineLine('system.concentration_reescalated', C_SUMMARY, false, 'student');
    expect(en.text).toMatch(/still needs focus/);
    expect(en.icon).toBe('🔁');
    expect(en.accent).toBe(PULSE_COLORS.concentration);

    const hi = timelineLine('system.concentration_reescalated', C_SUMMARY, true, 'student');
    expect(hi.text).toContain('science');
  });

  it('teacher re-flag copy when escalatedTo === "teacher"; follow-up otherwise', () => {
    const teacher = timelineLine(
      'system.concentration_reescalated',
      { ...C_SUMMARY, escalatedTo: 'teacher' },
      false,
      'teacher',
    );
    expect(teacher.text).toMatch(/re-flagged for your attention/);

    const ops = timelineLine('system.concentration_reescalated', C_SUMMARY, false, 'teacher');
    expect(ops.text).toMatch(/follow-up was sent/);
  });

  it('parent variant is supportive, bilingual', () => {
    const parent = timelineLine('system.concentration_reescalated', C_SUMMARY, false, 'parent');
    expect(parent.text).toMatch(/keep working on it together/);
    const parentHi = timelineLine('system.concentration_reescalated', C_SUMMARY, true, 'parent');
    expect(parentHi.text).toContain('साथ मिलकर');
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
