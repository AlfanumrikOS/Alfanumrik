/**
 * Canonical shuffle — `packages/lib/src/shuffle.ts`.
 *
 * WHY THIS SUITE EXISTS
 * =====================
 * `arr.sort(() => Math.random() - 0.5)` is not a shuffle. The comparator is
 * non-transitive (it can assert a<b, b<c AND c<a within a single sort), so the
 * result is implementation-defined and heavily biased toward the INPUT order —
 * V8's TimSort leaves short runs largely untouched. Every call site in this repo
 * then does `.slice(0, count)`, so the bias decides WHICH questions a student is
 * served: the first N rows the database happened to return win far more often
 * than chance. That is a quiz-integrity defect (P6-adjacent: question
 * selection), not a cosmetic one. Eight such sites plus three duplicate
 * hand-rolled Fisher-Yates definitions were replaced by this one module.
 *
 * The three properties that matter, and why each is tested:
 *   1. NON-MUTATING — the biased `.sort()` it replaced mutated in place, and at
 *      least two call sites (`supabase.ts:getChapterQuestions`,
 *      `teacher/worksheets`) shuffled a caller-owned array.
 *   2. PERMUTATION-PRESERVING — no element dropped, duplicated, or invented.
 *   3. DISTRIBUTION-CORRECT — the actual fix. Tested through the INJECTABLE
 *      `rng` seam, so it is deterministic rather than a flaky statistical
 *      assertion: a scripted rng must produce the EXACT Fisher-Yates
 *      permutation, and a real PRNG must reach every position roughly uniformly.
 *
 * Every test is independent; the seeded rng is constructed per test.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { shuffle } from '@alfanumrik/lib/shuffle';

// ── Deterministic randomness sources ──────────────────────────────────────────

/**
 * Replays a fixed script of values. Throws if the shuffle draws more numbers
 * than scripted — which makes "the algorithm changed its draw count" a loud
 * failure rather than a silent one.
 */
function scriptedRng(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted after ${values.length} draws`);
    return values[i++];
  };
}

/** Deterministic PRNG (mulberry32) for distribution sampling without flake. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Non-mutating
// ════════════════════════════════════════════════════════════════════════════

describe('shuffle: does not mutate its input', () => {
  it('leaves the input array untouched', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const before = [...input];
    shuffle(input, seededRng(1));
    expect(input).toEqual(before);
  });

  it('returns a NEW array instance, not the same reference', () => {
    const input = [1, 2, 3, 4];
    const out = shuffle(input, seededRng(2));
    expect(out).not.toBe(input);
  });

  it('mutating the result does not write back into the input', () => {
    const input = [1, 2, 3, 4];
    const out = shuffle(input, seededRng(3));
    out[0] = 999;
    expect(input).not.toContain(999);
  });

  it('accepts a readonly array (compile-time contract, exercised at runtime)', () => {
    const frozen = Object.freeze([1, 2, 3, 4, 5]);
    // Would throw in strict mode if the implementation shuffled in place.
    expect(() => shuffle(frozen, seededRng(4))).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Permutation-preserving
// ════════════════════════════════════════════════════════════════════════════

describe('shuffle: is a permutation', () => {
  it('returns the same multiset for a 10-element array', () => {
    const input = Array.from({ length: 10 }, (_, i) => i);
    const out = shuffle(input, seededRng(5));
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('preserves duplicates exactly (multiset, not set)', () => {
    const input = ['a', 'a', 'b', 'b', 'b', 'c'];
    const out = shuffle(input, seededRng(6));
    const count = (arr: string[], v: string) => arr.filter((x) => x === v).length;
    expect(out).toHaveLength(6);
    expect(count(out, 'a')).toBe(2);
    expect(count(out, 'b')).toBe(3);
    expect(count(out, 'c')).toBe(1);
  });

  it('preserves object identity (elements are moved, not cloned)', () => {
    const objects = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const out = shuffle(objects, seededRng(7));
    for (const o of objects) expect(out).toContain(o);
  });

  it('handles the empty array', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('handles a single-element array without drawing from the rng', () => {
    // The loop runs while i > 0, so a 1-element array draws ZERO random values.
    // scriptedRng([]) throws on the first draw, proving no draw happened.
    expect(shuffle(['only'], scriptedRng([]))).toEqual(['only']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Distribution correctness — via the injectable rng seam.
// ════════════════════════════════════════════════════════════════════════════

describe('shuffle: distribution correctness through the injectable rng', () => {
  it('draws exactly n-1 values for an n-element array', () => {
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0;
    };
    shuffle([1, 2, 3, 4, 5, 6], counting);
    expect(draws).toBe(5);
  });

  it('produces the EXACT Fisher-Yates permutation for a scripted rng', () => {
    // Reference walk-through of the implementation for ['A','B','C','D']:
    //   i=3: j = floor(0.00 * 4) = 0 → swap idx3,idx0 → D B C A
    //   i=2: j = floor(0.75 * 3) = 2 → swap idx2,idx2 → D B C A  (self-swap)
    //   i=1: j = floor(0.50 * 2) = 1 → swap idx1,idx1 → D B C A  (self-swap)
    // Expected: D B C A
    expect(shuffle(['A', 'B', 'C', 'D'], scriptedRng([0.0, 0.75, 0.5]))).toEqual([
      'D',
      'B',
      'C',
      'A',
    ]);
  });

  it('produces a different EXACT permutation for a different script', () => {
    //   i=3: j = floor(0.99 * 4) = 3 → self-swap        → A B C D
    //   i=2: j = floor(0.00 * 3) = 0 → swap idx2,idx0   → C B A D
    //   i=1: j = floor(0.99 * 2) = 1 → self-swap        → C B A D
    expect(shuffle(['A', 'B', 'C', 'D'], scriptedRng([0.99, 0.0, 0.99]))).toEqual([
      'C',
      'B',
      'A',
      'D',
    ]);
  });

  it('an rng pinned at 0 reverses-by-rotation deterministically (identity check on the swap seam)', () => {
    //   i=3: j=0 → D B C A
    //   i=2: j=0 → C B D A
    //   i=1: j=0 → B C D A
    expect(shuffle(['A', 'B', 'C', 'D'], () => 0)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('an rng pinned just below 1 is the identity permutation (every swap is a self-swap)', () => {
    const input = ['A', 'B', 'C', 'D', 'E'];
    // j = floor(0.999 * (i+1)) === i for every i, so each swap is a no-op.
    expect(shuffle(input, () => 0.999999)).toEqual(input);
  });

  it('is deterministic: the same seed produces the same permutation', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(input, seededRng(42))).toEqual(shuffle(input, seededRng(42)));
  });

  it('is uniform: over 12,000 trials every element reaches every position (no input-order bias)', () => {
    // THE regression this module exists for. Under the old
    // `.sort(() => Math.random() - 0.5)` comparator, element 0 stayed at
    // position 0 far more often than 1/n, so `.slice(0, count)` kept serving
    // the same questions. With a correct Fisher-Yates each cell should be
    // ~1/n; the bounds below are wide enough to never flake yet far tighter
    // than the biased sort could ever satisfy.
    const n = 6;
    const trials = 12000;
    const expected = trials / n; // 2000
    const rng = seededRng(20260729);
    const input = Array.from({ length: n }, (_, i) => i);

    // counts[element][position]
    const counts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let t = 0; t < trials; t += 1) {
      const out = shuffle(input, rng);
      for (let pos = 0; pos < n; pos += 1) counts[out[pos]][pos] += 1;
    }

    for (let element = 0; element < n; element += 1) {
      for (let pos = 0; pos < n; pos += 1) {
        expect(
          counts[element][pos],
          `element ${element} landed at position ${pos} ${counts[element][pos]} times (expected ~${expected})`,
        ).toBeGreaterThan(expected * 0.8);
        expect(counts[element][pos]).toBeLessThan(expected * 1.2);
      }
    }
  });

  it('defaults to Math.random when no rng is supplied (production behaviour unchanged)', () => {
    const input = Array.from({ length: 12 }, (_, i) => i);
    const out = shuffle(input);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    // Over 40 default-rng shuffles of 12 items, at least one must differ from
    // the input order. Probability of a false failure is ~(1/12!)^40.
    const anyReordered = Array.from({ length: 40 }, () => shuffle(input)).some(
      (o) => o.some((v, i) => v !== input[i]),
    );
    expect(anyReordered).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. STATIC-SOURCE CANARY — the biased comparator must not come back.
// ════════════════════════════════════════════════════════════════════════════

describe('shuffle: no biased sort-comparator shuffle survives anywhere in packages/ or apps/', () => {
  function findRepoRoot(): string {
    let dir = path.resolve(process.cwd());
    for (let i = 0; i < 8; i += 1) {
      if (
        fs.existsSync(path.join(dir, 'apps')) &&
        fs.existsSync(path.join(dir, 'packages', 'lib', 'src'))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`could not locate the monorepo root from cwd=${process.cwd()}`);
  }

  const REPO_ROOT = findRepoRoot();

  /** All non-test .ts/.tsx sources under the given roots, repo-relative. */
  function collectSources(roots: readonly string[]): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.next', '__tests__', 'dist', 'build'].includes(entry.name)) continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
      }
    };
    for (const r of roots) walk(path.join(REPO_ROOT, r));
    return out.sort();
  }

  const SOURCES = collectSources(['packages', 'apps']);

  /** Strip comments so the explanatory prose about the OLD pattern never matches. */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  }

  // Both orderings of the biased comparator, whitespace-tolerant.
  const BIASED_COMPARATOR =
    /\.sort\(\s*\(\s*\)\s*=>\s*(?:Math\.random\(\)\s*-\s*0?\.5|0?\.5\s*-\s*Math\.random\(\))/;

  it('the scan found a real, non-trivial set of sources (not vacuous)', () => {
    expect(SOURCES.length).toBeGreaterThan(200);
  });

  it('no source file contains `.sort(() => Math.random() - 0.5)` or its mirror', () => {
    const offenders = SOURCES.filter((rel) =>
      BIASED_COMPARATOR.test(stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('the canonical module is a Fisher-Yates with an injectable rng defaulting to Math.random', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'packages', 'lib', 'src', 'shuffle.ts'),
      'utf8',
    );
    expect(src).toMatch(/export function shuffle<T>\(\s*arr: readonly T\[\]/);
    // The rng seam these tests depend on — losing the default would silently
    // change production behaviour; losing the parameter would kill the seam.
    expect(src).toMatch(/rng:\s*RandomFn\s*=\s*Math\.random/);
    // Descending swap loop = Fisher-Yates, not a comparator sort.
    expect(src).toMatch(/for \(let i = result\.length - 1; i > 0; i--\)/);
    expect(stripComments(src)).not.toMatch(/\.sort\(/);
  });
});
