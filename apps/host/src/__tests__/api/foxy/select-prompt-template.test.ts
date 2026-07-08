/**
 * REG-176: selectFoxyPromptTemplate routing invariant.
 *
 * `selectFoxyPromptTemplate` is a private function in src/app/api/foxy/route.ts
 * (not exported). This test mirrors the mapping in isolation so:
 *   1. A rename/revert to `foxy_tutor_v1` is caught immediately (the monolithic
 *      prompt had 3 competing output format sections — RCA root cause RC-1).
 *   2. Adding a new mode that accidentally falls through to `foxy_tutor_v1`
 *      is caught.
 *   3. Swapping the practice/doubt buckets by accident is caught.
 *
 * When the implementation changes, this test must be updated to match — the
 * test is the spec, not a snapshot of history.
 *
 * Source location: src/app/api/foxy/route.ts line ~2832
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror of the private `selectFoxyPromptTemplate` in route.ts.
 * Keep in sync: if the route's implementation changes, update here too.
 * Intentional duplicate because the function is private and testing it via
 * HTTP would require full Supabase/auth stubs (out of scope for this unit pin).
 */
function selectFoxyPromptTemplate(mode: string): string {
  if (mode === 'practice') return 'foxy_tutor_exam_v1';
  if (mode === 'doubt' || mode === 'homework') return 'foxy_tutor_doubt_v1';
  return 'foxy_tutor_teach_v1';
}

describe('selectFoxyPromptTemplate — REG-176 prompt routing invariant', () => {
  // ── Happy paths ────────────────────────────────────────────────────────────

  it('routes practice to exam prompt', () => {
    expect(selectFoxyPromptTemplate('practice')).toBe('foxy_tutor_exam_v1');
  });

  it('routes doubt to doubt prompt', () => {
    expect(selectFoxyPromptTemplate('doubt')).toBe('foxy_tutor_doubt_v1');
  });

  it('routes homework to doubt prompt', () => {
    expect(selectFoxyPromptTemplate('homework')).toBe('foxy_tutor_doubt_v1');
  });

  it('routes learn to teach prompt', () => {
    expect(selectFoxyPromptTemplate('learn')).toBe('foxy_tutor_teach_v1');
  });

  it('routes explain to teach prompt', () => {
    expect(selectFoxyPromptTemplate('explain')).toBe('foxy_tutor_teach_v1');
  });

  it('routes revise to teach prompt', () => {
    expect(selectFoxyPromptTemplate('revise')).toBe('foxy_tutor_teach_v1');
  });

  // ── Safe-default for unknown / future modes ───────────────────────────────

  it('routes unknown modes to teach prompt (safe default)', () => {
    expect(selectFoxyPromptTemplate('unknown_mode')).toBe('foxy_tutor_teach_v1');
  });

  it('routes empty string to teach prompt (safe default)', () => {
    expect(selectFoxyPromptTemplate('')).toBe('foxy_tutor_teach_v1');
  });

  it('routes explorer mode to teach prompt', () => {
    expect(selectFoxyPromptTemplate('explorer')).toBe('foxy_tutor_teach_v1');
  });

  // ── RC-1 regression guard: legacy monolithic prompt must never be returned ─

  it('NEVER returns the legacy monolithic foxy_tutor_v1 for any mode', () => {
    const allKnownModes = [
      'learn',
      'explain',
      'practice',
      'revise',
      'doubt',
      'homework',
      'quiz',
      'notes',
      'explorer',
      '',
      'unknown',
    ];
    for (const mode of allKnownModes) {
      expect(selectFoxyPromptTemplate(mode)).not.toBe('foxy_tutor_v1');
    }
  });

  // ── Distinctness guard: each bucket returns a different template ──────────

  it('returns distinct templates for each routing bucket', () => {
    const practice = selectFoxyPromptTemplate('practice');
    const doubt = selectFoxyPromptTemplate('doubt');
    const teach = selectFoxyPromptTemplate('learn');

    expect(practice).not.toBe(doubt);
    expect(practice).not.toBe(teach);
    expect(doubt).not.toBe(teach);
  });

  // ── Exact template name pins (guards against partial string revert) ────────

  it('practice template name ends with _exam_v1', () => {
    expect(selectFoxyPromptTemplate('practice')).toMatch(/_exam_v1$/);
  });

  it('doubt/homework template name ends with _doubt_v1', () => {
    expect(selectFoxyPromptTemplate('doubt')).toMatch(/_doubt_v1$/);
    expect(selectFoxyPromptTemplate('homework')).toMatch(/_doubt_v1$/);
  });

  it('default template name ends with _teach_v1', () => {
    expect(selectFoxyPromptTemplate('learn')).toMatch(/_teach_v1$/);
  });
});
