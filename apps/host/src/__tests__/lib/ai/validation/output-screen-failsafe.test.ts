/**
 * FOX-1 (P12) — output-screen FAIL-SAFE behaviour.
 *
 * The screen reuses the legacy `validateOutput` as a WARN-only telemetry signal.
 * If `validateOutput` THROWS, the screen must NOT crash the turn: its advisory
 * call is wrapped in an inner try/catch, so the blocking decision is still made
 * purely from the deterministic HARD_BLOCK_PATTERNS set.
 *
 * This file mocks `validateOutput` to throw, then asserts:
 *   - clean curriculum text  → safe:true  (no crash; legacy flag swallowed)
 *   - hard-blocked text      → safe:false (blocklist still fires)
 *
 * Owner: testing. Enforces: P12 (AI Safety).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@alfanumrik/lib/ai/validation/output-guard', () => ({
  validateOutput: () => {
    throw new Error('boom — legacy validator exploded');
  },
}));

import { screenStudentFacingText } from '@alfanumrik/lib/ai/validation/output-screen';

describe('screenStudentFacingText — fail-safe when validateOutput throws', () => {
  it('does not throw and returns safe:true for clean curriculum text', () => {
    const fn = () =>
      screenStudentFacingText('The mass of the object stays constant.', {
        grade: '9',
        subject: 'science',
      });
    expect(fn).not.toThrow();
    const result = fn();
    expect(result.safe).toBe(true);
    // The advisory validator threw → its flag is swallowed, not surfaced.
    expect(result.categories).not.toContain('legacy_validator_flag');
  });

  it('still blocks hard-blocked text even when the advisory validator throws', () => {
    const result = screenStudentFacingText('You should kill yourself.', {
      grade: '9',
      subject: 'science',
    });
    expect(result.safe).toBe(false);
    expect(result.categories).toContain('blocklist');
  });
});
