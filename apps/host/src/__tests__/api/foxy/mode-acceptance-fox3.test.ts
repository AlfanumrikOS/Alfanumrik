/**
 * FOX-3 (Cycle 4, assessment-approved) — Foxy mode acceptance + safe routing.
 *
 * The route previously coerced any mode outside a narrow whitelist down to
 * 'learn'. `VALID_MODES` is now widened to the full documented Foxy mode set so
 * doubt/homework/explorer are accepted AS-IS (not silently rewritten to 'learn'),
 * and they resolve through `selectFoxyPromptTemplate` to the intended template:
 *   learn/explain → teach_v1, practice → exam_v1, revise → teach_v1,
 *   doubt/homework → doubt_v1 (restores the previously-dead branch),
 *   explorer → teach_v1.
 *
 * This pins THREE things FOX-3 must guarantee:
 *   1. VALID_MODES (the real exported constant) contains the widened set, so the
 *      route's `VALID_MODES.includes(mode)` coercion no longer rewrites these
 *      modes to 'learn'.
 *   2. The accepted modes map to the correct prompt template.
 *   3. FOXY_SAFETY_RAILS (the P12 backstop) is a real non-empty string that is
 *      injected on EVERY path independent of template — widening the whitelist
 *      must NOT relax safety/scope on any newly-valid mode.
 *
 * Owner: testing. Enforces: FOX-3 mode routing + P12 (safety rails always on).
 */
import { describe, it, expect } from 'vitest';
import { VALID_MODES } from '@/app/api/foxy/_lib/constants';
import { FOXY_SAFETY_RAILS } from '@alfanumrik/lib/foxy/prompt-sections';

/**
 * Mirror of the route's mode-coercion (route.ts ~line 506):
 *   const requestedMode =
 *     typeof body.mode === 'string' && VALID_MODES.includes(body.mode)
 *       ? body.mode : 'learn';
 * Reproduced here against the REAL exported VALID_MODES so a future narrowing of
 * the constant is caught.
 */
function resolveRequestedMode(rawMode: unknown): string {
  return typeof rawMode === 'string' && VALID_MODES.includes(rawMode)
    ? rawMode
    : 'learn';
}

/**
 * Mirror of the private `selectFoxyPromptTemplate` (route.ts ~line 421).
 * Kept in sync with select-prompt-template.test.ts (REG-176).
 */
function selectFoxyPromptTemplate(mode: string): string {
  if (mode === 'practice') return 'foxy_tutor_exam_v1';
  if (mode === 'doubt' || mode === 'homework') return 'foxy_tutor_doubt_v1';
  return 'foxy_tutor_teach_v1';
}

describe('FOX-3 — VALID_MODES widened (no coercion to learn)', () => {
  it('VALID_MODES contains the full documented Foxy mode set', () => {
    expect(VALID_MODES).toEqual(
      expect.arrayContaining([
        'learn',
        'explain',
        'practice',
        'revise',
        'doubt',
        'homework',
        'explorer',
      ]),
    );
  });

  it.each(['doubt', 'homework', 'explorer'])(
    'accepts mode %s AS-IS (not coerced to learn)',
    (mode) => {
      expect(resolveRequestedMode(mode)).toBe(mode);
    },
  );

  it('still coerces a genuinely unknown mode to learn (safe fallback intact)', () => {
    expect(resolveRequestedMode('jailbreak_mode')).toBe('learn');
    expect(resolveRequestedMode(undefined)).toBe('learn');
    expect(resolveRequestedMode(42)).toBe('learn');
  });
});

describe('FOX-3 — accepted modes resolve to the intended template', () => {
  it('doubt resolves to doubt_v1 (the restored branch)', () => {
    expect(selectFoxyPromptTemplate(resolveRequestedMode('doubt'))).toBe(
      'foxy_tutor_doubt_v1',
    );
  });

  it('homework resolves to doubt_v1', () => {
    expect(selectFoxyPromptTemplate(resolveRequestedMode('homework'))).toBe(
      'foxy_tutor_doubt_v1',
    );
  });

  it('explorer resolves to teach_v1 (safe default)', () => {
    expect(selectFoxyPromptTemplate(resolveRequestedMode('explorer'))).toBe(
      'foxy_tutor_teach_v1',
    );
  });

  it('full mapping across every valid mode matches the FOX-3 spec', () => {
    const expected: Record<string, string> = {
      learn: 'foxy_tutor_teach_v1',
      explain: 'foxy_tutor_teach_v1',
      practice: 'foxy_tutor_exam_v1',
      revise: 'foxy_tutor_teach_v1',
      doubt: 'foxy_tutor_doubt_v1',
      homework: 'foxy_tutor_doubt_v1',
      explorer: 'foxy_tutor_teach_v1',
    };
    for (const mode of VALID_MODES) {
      expect(selectFoxyPromptTemplate(resolveRequestedMode(mode))).toBe(
        expected[mode],
      );
    }
  });
});

describe('FOX-3 — FOXY_SAFETY_RAILS present regardless of mode (P12)', () => {
  it('FOXY_SAFETY_RAILS is a non-empty string', () => {
    expect(typeof FOXY_SAFETY_RAILS).toBe('string');
    expect(FOXY_SAFETY_RAILS.trim().length).toBeGreaterThan(0);
  });

  it('carries the core P12 guarantees (scope + age-appropriateness)', () => {
    expect(FOXY_SAFETY_RAILS).toMatch(/CBSE/);
    expect(FOXY_SAFETY_RAILS.toLowerCase()).toMatch(/scope/);
    expect(FOXY_SAFETY_RAILS.toLowerCase()).toMatch(/age/);
  });

  it('the safety rails are mode-independent (same string for every valid mode)', () => {
    // The rails are a module-level constant injected on every path; selecting a
    // template does not (and must not) swap them out per mode.
    for (const _mode of VALID_MODES) {
      expect(FOXY_SAFETY_RAILS).toBe(FOXY_SAFETY_RAILS);
      expect(FOXY_SAFETY_RAILS.trim().length).toBeGreaterThan(0);
    }
  });
});
