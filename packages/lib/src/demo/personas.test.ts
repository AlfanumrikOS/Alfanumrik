import { describe, it, expect } from 'vitest';
import { DEMO_PERSONAS, DEMO_ROLES, PERSONA_PROFILES, normalisePersona } from './personas';

describe('DEMO_PERSONAS', () => {
  it('contains exactly three values in the v2 spelling', () => {
    expect(DEMO_PERSONAS).toEqual(['weak_student', 'average', 'high_performer']);
  });

  it('does not contain the legacy `weak` value', () => {
    expect((DEMO_PERSONAS as readonly string[]).includes('weak')).toBe(false);
  });

  it('every persona has a PERSONA_PROFILES entry', () => {
    for (const p of DEMO_PERSONAS) {
      expect(PERSONA_PROFILES[p]).toBeDefined();
      expect(PERSONA_PROFILES[p].xp_total).toBeGreaterThanOrEqual(0);
      expect(PERSONA_PROFILES[p].streak_days).toBeGreaterThanOrEqual(0);
    }
  });

  it('weak_student has the lowest xp_total of the three', () => {
    const xps = DEMO_PERSONAS.map(p => PERSONA_PROFILES[p].xp_total);
    expect(PERSONA_PROFILES.weak_student.xp_total).toBe(Math.min(...xps));
    expect(PERSONA_PROFILES.high_performer.xp_total).toBe(Math.max(...xps));
  });
});

describe('DEMO_ROLES', () => {
  it('contains all five demo roles', () => {
    expect(DEMO_ROLES).toEqual(['student', 'teacher', 'parent', 'school_admin', 'super_admin']);
  });
});

describe('normalisePersona', () => {
  it('returns `average` for null / undefined / empty', () => {
    expect(normalisePersona(null)).toBe('average');
    expect(normalisePersona(undefined)).toBe('average');
    expect(normalisePersona('')).toBe('average');
  });

  it('maps the legacy `weak` value to `weak_student`', () => {
    expect(normalisePersona('weak')).toBe('weak_student');
  });

  it('passes through valid v2 personas', () => {
    expect(normalisePersona('weak_student')).toBe('weak_student');
    expect(normalisePersona('average')).toBe('average');
    expect(normalisePersona('high_performer')).toBe('high_performer');
  });

  it('falls back to `average` for unknown values', () => {
    expect(normalisePersona('genius')).toBe('average');
    expect(normalisePersona('foo')).toBe('average');
  });
});
