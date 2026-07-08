/**
 * Foxy conversation continuity — Phase 4 unit tests.
 *
 * Pins the shape + PII contract of the cross-session long-memory helper:
 *   - Empty snapshot → prompt section is "".
 *   - Partial snapshots render only the populated lines.
 *   - Synthesis text is hard-capped at 500 chars (defense at both load
 *     time and render time).
 *   - Student name is scrubbed from synthesis text BEFORE injection
 *     (P13 — no PII into the model prompt).
 *   - Loader returns EMPTY_LONG_MEMORY on a full Supabase failure.
 *
 * The actual DB query is integration-tested via /api/foxy E2E. Here we
 * test the pure formatter + the empty-state contract + the PII scrub.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  EMPTY_LONG_MEMORY,
  buildLongMemoryPromptSection,
  loadLongMemorySnapshot,
  scrubStudentName,
  type LongMemorySnapshot,
} from '@alfanumrik/lib/learn/foxy-long-memory';

// vitest setup already mocks @alfanumrik/lib/logger; we don't need to re-mock here.

describe('buildLongMemoryPromptSection', () => {
  it('returns empty string when snapshot is fully empty', () => {
    expect(buildLongMemoryPromptSection(EMPTY_LONG_MEMORY)).toBe('');
  });

  it('renders mastery-only block (no synthesis, no misconceptions)', () => {
    const snap: LongMemorySnapshot = {
      synthesis_month: null,
      synthesis_summary: null,
      high_concepts: ['photosynthesis', 'food chains'],
      low_concepts: ['cell division'],
      top_misconceptions: [],
    };
    const out = buildLongMemoryPromptSection(snap);
    expect(out).toContain('## LEARNER MEMORY (last 30 days)');
    expect(out).toContain('Mastered concepts: photosynthesis, food chains');
    expect(out).toContain('Struggling concepts: cell division');
    // No synthesis line when null.
    expect(out).not.toContain('Recent monthly synthesis');
    // No misconceptions line when empty.
    expect(out).not.toContain('Misconceptions to watch');
  });

  it('renders synthesis-only block (no mastery, no misconceptions)', () => {
    const snap: LongMemorySnapshot = {
      synthesis_month: '2026-04',
      synthesis_summary: 'The student showed strong progress in nutrition.',
      high_concepts: [],
      low_concepts: [],
      top_misconceptions: [],
    };
    const out = buildLongMemoryPromptSection(snap);
    expect(out).toContain('## LEARNER MEMORY (last 30 days)');
    expect(out).toContain('Recent monthly synthesis (2026-04):');
    expect(out).toContain('strong progress in nutrition');
    expect(out).not.toContain('Mastered concepts');
    expect(out).not.toContain('Struggling concepts');
  });

  it('renders a full snapshot with all sections in the expected order', () => {
    const snap: LongMemorySnapshot = {
      synthesis_month: '2026-04',
      synthesis_summary: 'Strong month in biology.',
      high_concepts: ['photosynthesis'],
      low_concepts: ['mitosis'],
      top_misconceptions: ['confuses mass with weight', 'mixes redox direction'],
    };
    const out = buildLongMemoryPromptSection(snap);
    // Order: header → mastered → struggling → synthesis → misconceptions → guidance
    const idxHeader = out.indexOf('## LEARNER MEMORY');
    const idxMastered = out.indexOf('Mastered concepts');
    const idxStruggling = out.indexOf('Struggling concepts');
    const idxSynthesis = out.indexOf('Recent monthly synthesis');
    const idxMisconceptions = out.indexOf('Misconceptions to watch');
    expect(idxHeader).toBeGreaterThanOrEqual(0);
    expect(idxHeader).toBeLessThan(idxMastered);
    expect(idxMastered).toBeLessThan(idxStruggling);
    expect(idxStruggling).toBeLessThan(idxSynthesis);
    expect(idxSynthesis).toBeLessThan(idxMisconceptions);
    // Guidance footer must instruct Foxy NOT to address the section directly.
    expect(out).toMatch(/Do NOT address it directly/);
  });

  it('truncates oversized synthesis text to 500 chars with ellipsis', () => {
    const longSynthesis = 'X'.repeat(900);
    const snap: LongMemorySnapshot = {
      synthesis_month: '2026-04',
      synthesis_summary: longSynthesis,
      high_concepts: [],
      low_concepts: [],
      top_misconceptions: [],
    };
    const out = buildLongMemoryPromptSection(snap);
    // The synthesis line should end with the ellipsis marker.
    expect(out).toMatch(/…/);
    // Sanity: the raw 900-char string must not appear verbatim.
    expect(out).not.toContain(longSynthesis);
    // Bound: the synthesis substring (after the "synthesis (2026-04):" label)
    // should not exceed 500+slack chars on that single line.
    const synthLine = out
      .split('\n')
      .find((l) => l.includes('Recent monthly synthesis'));
    expect(synthLine).toBeDefined();
    // The line includes the "Recent monthly synthesis (2026-04): " prefix (~36 chars)
    // plus up to 500 chars of payload plus the leading "- ". Loose upper bound.
    expect((synthLine ?? '').length).toBeLessThan(600);
  });

  it('caps misconceptions list at 3 items even if more are passed', () => {
    const snap: LongMemorySnapshot = {
      synthesis_month: null,
      synthesis_summary: null,
      high_concepts: [],
      low_concepts: [],
      top_misconceptions: ['m1', 'm2', 'm3', 'm4', 'm5'],
    };
    const out = buildLongMemoryPromptSection(snap);
    expect(out).toContain('m1');
    expect(out).toContain('m3');
    expect(out).not.toContain('m4');
    expect(out).not.toContain('m5');
  });
});

describe('scrubStudentName (P13 PII discipline)', () => {
  it('returns "" for empty input', () => {
    expect(scrubStudentName('', 'Aarav')).toBe('');
    expect(scrubStudentName('', null)).toBe('');
  });

  it('removes a first name occurrence', () => {
    const out = scrubStudentName('Aarav showed strong progress in nutrition.', 'Aarav');
    expect(out).not.toContain('Aarav');
    expect(out).toContain('the student showed strong progress');
  });

  it('removes the name case-insensitively', () => {
    const out = scrubStudentName('AARAV is making good progress.', 'Aarav');
    expect(out.toLowerCase()).not.toContain('aarav');
  });

  it('removes multiple occurrences (e.g. "Aarav... Aarav...")', () => {
    const out = scrubStudentName(
      "Aarav's progress is steady. We recommend Aarav focus on cell division.",
      'Aarav',
    );
    expect(out).not.toContain('Aarav');
    expect(out.toLowerCase()).not.toContain('aarav');
  });

  it('strips both tokens of a multi-token name', () => {
    const out = scrubStudentName(
      'Aarav Sharma did well in physics. Sharma should keep practicing.',
      'Aarav Sharma',
    );
    expect(out).not.toContain('Aarav');
    expect(out).not.toContain('Sharma');
  });

  it('collapses "Dear Aarav" → "Dear parent" (defense-in-depth address line)', () => {
    const out = scrubStudentName('Dear Aarav, this month was strong.', 'Aarav');
    expect(out).toMatch(/Dear parent/);
    expect(out).not.toContain('Aarav');
  });

  it('does not partial-match a name token (Ram ≠ Rama)', () => {
    const out = scrubStudentName('Ram studies Ramayana stories.', 'Ram');
    // "Ram" should be scrubbed but "Ramayana" should remain.
    expect(out).toContain('Ramayana');
    // The standalone "Ram" should be replaced.
    expect(out).toMatch(/the student studies Ramayana/);
  });

  it('ignores 1-character names (avoid catastrophic scrub on initials)', () => {
    // Names like 'A' (1 char) are intentionally not scrubbed — they would
    // match a huge fraction of the text. This is acceptable risk because
    // single-character first names are rare in Indian student data.
    const out = scrubStudentName('A learned about atoms.', 'A');
    expect(out).toContain('A learned');
  });

  it('returns original text when studentName is null/empty (still applies generic scrub)', () => {
    const out = scrubStudentName('Dear parent, your child is doing well.', null);
    expect(out).toContain('Dear parent');
  });

  it('escapes regex metacharacters in names (e.g. "O.J.") without throwing', () => {
    expect(() => scrubStudentName('O.J. read Newton today.', 'O.J.')).not.toThrow();
  });
});

describe('loadLongMemorySnapshot (Supabase contract)', () => {
  /**
   * Build a thenable PostgrestBuilder-shaped object. The real client lets you
   * chain `.from().select().eq().order()...` and the chain is itself a thenable.
   * We just need each chain step to return `this` and the terminal `.maybeSingle()`
   * / `.then()` to resolve with the right payload.
   */
  function makeChain(resolved: { data: any; error: any }) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      ilike: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(resolved),
      then: (cb: any) => Promise.resolve(resolved).then(cb),
    };
    return chain;
  }

  it('returns EMPTY_LONG_MEMORY when the subject lookup throws', async () => {
    const supabase: any = {
      from: vi.fn((table: string) => {
        if (table === 'subjects') {
          // Force a throw on the terminal call.
          return {
            select: () => ({
              ilike: () => ({
                maybeSingle: () => Promise.reject(new Error('boom')),
              }),
            }),
          };
        }
        return makeChain({ data: null, error: null });
      }),
    };
    const out = await loadLongMemorySnapshot(supabase, 'stu-1', 'physics', null, []);
    // Without subjectId we never query mastery, and synthesis returned null.
    expect(out.synthesis_summary).toBeNull();
    expect(out.high_concepts).toEqual([]);
    expect(out.low_concepts).toEqual([]);
  });

  it('returns EMPTY_LONG_MEMORY when every block rejects', async () => {
    const supabase: any = {
      from: vi.fn(() => ({
        select: () => {
          throw new Error('catastrophic');
        },
      })),
    };
    const out = await loadLongMemorySnapshot(supabase, 'stu-1', 'physics', 'Aarav', []);
    expect(out).toEqual(EMPTY_LONG_MEMORY);
  });

  it('projects passed-in misconception labels (no separate DB query)', async () => {
    // Synthesis + mastery both return empty (covered above). We only verify
    // that misconception labels flow through the projection.
    const supabase: any = {
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };
    const labels = ['confuses mass with weight', 'mixes redox direction', 'parallax error', 'extra'];
    const out = await loadLongMemorySnapshot(supabase, 'stu-1', 'physics', null, labels);
    expect(out.top_misconceptions).toHaveLength(3);
    expect(out.top_misconceptions).toEqual([
      'confuses mass with weight',
      'mixes redox direction',
      'parallax error',
    ]);
  });

  it('trims whitespace and drops empty misconception labels', async () => {
    const supabase: any = {
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };
    const labels = ['  good label  ', '', '  ', 'another'];
    const out = await loadLongMemorySnapshot(supabase, 'stu-1', 'physics', null, labels);
    expect(out.top_misconceptions).toEqual(['good label', 'another']);
  });
});
