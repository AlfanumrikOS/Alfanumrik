/**
 * REG-257 — Foxy math-normalization production canary corpus.
 *
 * The undelimited-LaTeX normalization pass
 * (`packages/ui/src/foxy/math-normalization.ts`, wired into `InlineContent`
 * in FoxyStructuredRenderer as `normalizeMathSegments(tokenizeInline(text))`)
 * runs over EVERY text span Foxy renders. The binding CEO constraint on the
 * feature is a NEGATIVE one: no non-math production message may be altered by
 * the pass. Bare `^`, `_`, `$`, brackets, `°`/`∠`/`÷`/`₹` symbols, ASCII-art
 * underscores, and Devanagari prose must all pass through byte-identically.
 *
 * This file pins that constraint against REAL sanitized production Foxy
 * messages captured in
 * `src/__tests__/fixtures/foxy-math-canary-corpus.json`:
 *
 *   { provenance, math: string[], nonMath: string[] }
 *
 *   1. NON-MATH IMMUTABILITY (the load-bearing pin) — for EVERY `nonMath`
 *      excerpt: the trigger predicate is false, AND
 *      `normalizeMathSegments(tokenizeInline(excerpt))` returns the ORIGINAL
 *      segment array (reference-equal — the pass's untouched fast-path) with
 *      no in-place mutation (deep-equal to an independent tokenization).
 *      Iterated over the fixture, so future corpus additions are covered
 *      automatically.
 *   2. MATH DETECTION — every `math` excerpt yields at least one math segment
 *      through the full pipeline; excerpts carrying an allowlisted command
 *      OUTSIDE proper delimiters gain NEW math segments (the fix working),
 *      while properly-delimited-only excerpts return reference-equal (no
 *      double conversion of already-delimited math).
 *   3. FIXTURE INTEGRITY GUARDS — the JSON parses, `nonMath` contains zero
 *      backslash characters by construction, provenance records sanitization
 *      (P13), and the corpus floors (>=15 math / >=25 nonMath, >=2
 *      undelimited) fail loudly if anyone guts the fixture.
 *
 * If any nonMath excerpt IS altered by the pass, that is a REAL production
 * defect in the normalization trigger — fix the pass, never the fixture.
 *
 * Invariants: P12 (fail-safe KaTeX path), P13 (sanitized corpus — no PII),
 * P6-adjacent (display correctness of served math content).
 *
 * Companion suite: `undelimited-math-normalization.test.tsx` (algorithm +
 * DOM acceptance for the 5 production screenshot strings).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Mocks mirror undelimited-math-normalization.test.tsx — the renderer module
// pulls AuthContext + useSubjectLookup at module-eval time.
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));

vi.mock('@alfanumrik/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({
    code: 'math',
    icon: '∑',
    color: '#7C3AED',
    name: 'Math',
  }),
}));

// Import after mocks.
import {
  tokenizeInline,
  containsAllowlistedMathCommand,
  splitUndelimitedMath,
  normalizeMathSegments,
  type InlineSegment,
} from '@alfanumrik/ui/foxy/FoxyStructuredRenderer';

// ── Fixture loading (raw text kept for the explicit parse guard) ─────────────

interface CanaryCorpus {
  provenance: string;
  math: string[];
  nonMath: string[];
}

// Resolve relative to THIS test file (CWD-independent). Vitest's transform
// may surface `import.meta.url` as a `file:` URL or as a bare/rooted path
// (observed on Windows) — handle all three shapes.
function testFilePath(): string {
  const rawUrl = import.meta.url;
  if (rawUrl.startsWith('file:')) return fileURLToPath(rawUrl);
  // `/C:/...` → `C:/...`; plain `C:/...` and POSIX paths pass through.
  return rawUrl.replace(/^\/(?=[A-Za-z]:\/)/, '');
}

const FIXTURE_PATH = path.resolve(
  path.dirname(testFilePath()),
  '../fixtures/foxy-math-canary-corpus.json',
);
const RAW_FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');
const corpus: CanaryCorpus = JSON.parse(RAW_FIXTURE);

/** Short single-line label so it.each titles stay readable. */
function label(excerpt: string): string {
  return excerpt.replace(/\s+/g, ' ').trim().slice(0, 48);
}

function mathSegments(segments: InlineSegment[]): InlineSegment[] {
  return segments.filter((s) => s.kind === 'math');
}

// The two undelimited production cases the fixture MUST retain (task-named).
const REQUIRED_UNDELIMITED_CASES = [
  '3.5 \\times 100 = 350',
  '\\frac{1}{4} + \\frac{1}{2}',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fixture integrity guards — fail loudly if the corpus is gutted
// ─────────────────────────────────────────────────────────────────────────────

describe('canary corpus — fixture integrity guards', () => {
  it('JSON parses into { provenance, math[], nonMath[] } of non-empty strings', () => {
    expect(() => JSON.parse(RAW_FIXTURE)).not.toThrow();
    const parsed = JSON.parse(RAW_FIXTURE) as CanaryCorpus;
    expect(typeof parsed.provenance).toBe('string');
    expect(Array.isArray(parsed.math)).toBe(true);
    expect(Array.isArray(parsed.nonMath)).toBe(true);
    for (const [i, excerpt] of parsed.math.entries()) {
      expect(typeof excerpt, `math[${i}] must be a string`).toBe('string');
      expect(excerpt.trim().length, `math[${i}] must be non-empty`).toBeGreaterThan(0);
    }
    for (const [i, excerpt] of parsed.nonMath.entries()) {
      expect(typeof excerpt, `nonMath[${i}] must be a string`).toBe('string');
      expect(excerpt.trim().length, `nonMath[${i}] must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('provenance records sanitization (P13 — real prod messages, PII removed)', () => {
    expect(corpus.provenance).toMatch(/saniti[sz]/i);
  });

  it('corpus size floors hold: >=15 math excerpts, >=25 nonMath excerpts', () => {
    expect(corpus.math.length).toBeGreaterThanOrEqual(15);
    expect(corpus.nonMath.length).toBeGreaterThanOrEqual(25);
  });

  it('every nonMath excerpt contains ZERO backslash characters (by construction)', () => {
    for (const [i, excerpt] of corpus.nonMath.entries()) {
      expect(
        excerpt.includes('\\'),
        `nonMath[${i}] ("${label(excerpt)}") must contain no backslash — ` +
          'a backslash-bearing excerpt belongs in math[], not nonMath[]',
      ).toBe(false);
    }
  });

  it('the named undelimited production cases are still present in math[]', () => {
    for (const needle of REQUIRED_UNDELIMITED_CASES) {
      expect(
        corpus.math.some((e) => e.includes(needle)),
        `fixture must retain the undelimited production case: ${needle}`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Non-math immutability — THE load-bearing pin (CEO constraint)
// ─────────────────────────────────────────────────────────────────────────────

describe('non-math immutability — the pass alters NOTHING on real prod prose', () => {
  it.each(corpus.nonMath.map((e, i) => [i, label(e), e] as const))(
    'nonMath[%i] "%s" — trigger false, segments reference-equal, no mutation',
    (_i, _label, excerpt) => {
      // (a) The trigger predicate never fires on non-math prod content.
      expect(containsAllowlistedMathCommand(excerpt)).toBe(false);

      // (b) The pass returns the ORIGINAL array — the untouched fast-path.
      const segments = tokenizeInline(excerpt);
      const normalized = normalizeMathSegments(segments);
      expect(normalized).toBe(segments);

      // (c) …and did not mutate it in place either: deep-equal to an
      // independent tokenization of the same excerpt.
      expect(normalized).toEqual(tokenizeInline(excerpt));

      // (d) The raw splitter is likewise a no-op single text segment.
      expect(splitUndelimitedMath(excerpt)).toEqual([
        { kind: 'text', value: excerpt },
      ]);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Math detection — undelimited converts; delimited is never double-converted
// ─────────────────────────────────────────────────────────────────────────────

// Classify each math excerpt by whether any TEXT segment (i.e. content the
// tokenizer did NOT already extract as properly-delimited math) carries an
// allowlisted command — those are the undelimited cases the pass must fix.
const mathCases = corpus.math.map((excerpt, i) => {
  const tokenized = tokenizeInline(excerpt);
  const undelimited = tokenized.some(
    (s) => s.kind === 'text' && containsAllowlistedMathCommand(s.value),
  );
  return { i, excerpt, undelimited };
});
const undelimitedCases = mathCases.filter((c) => c.undelimited);
const delimitedOnlyCases = mathCases.filter((c) => !c.undelimited);

describe('math detection — every math excerpt renders math through the pipeline', () => {
  it('the corpus keeps >=2 excerpts with an allowlisted command OUTSIDE delimiters', () => {
    expect(undelimitedCases.length).toBeGreaterThanOrEqual(2);
  });

  it.each(mathCases.map((c) => [c.i, label(c.excerpt), c.excerpt] as const))(
    'math[%i] "%s" — full pipeline yields at least one math segment',
    (_i, _label, excerpt) => {
      const normalized = normalizeMathSegments(tokenizeInline(excerpt));
      expect(mathSegments(normalized).length).toBeGreaterThanOrEqual(1);
    },
  );
});

describe('math detection — undelimited commands convert to NEW math segments', () => {
  it.each(
    undelimitedCases.map((c) => [c.i, label(c.excerpt), c.excerpt] as const),
  )(
    'math[%i] "%s" — the pass adds math segments and passes delimited ones through',
    (_i, _label, excerpt) => {
      const tokenized = tokenizeInline(excerpt);
      const normalized = normalizeMathSegments(tokenized);

      // The pass DID something: a new array with strictly more math segments.
      expect(normalized).not.toBe(tokenized);
      expect(mathSegments(normalized).length).toBeGreaterThan(
        mathSegments(tokenized).length,
      );

      // Every properly-delimited math segment the tokenizer produced passes
      // through UNTOUCHED (same object reference — no double conversion).
      for (const seg of mathSegments(tokenized)) {
        expect(normalized).toContain(seg);
      }
    },
  );

  it('the named undelimited cases produce a math segment carrying the expression', () => {
    for (const needle of REQUIRED_UNDELIMITED_CASES) {
      const excerpt = corpus.math.find((e) => e.includes(needle));
      expect(excerpt, `fixture lost the undelimited case: ${needle}`).toBeDefined();
      const normalized = normalizeMathSegments(tokenizeInline(excerpt as string));
      expect(
        normalized.some((s) => s.kind === 'math' && s.latex.includes(needle)),
        `expected a math segment containing "${needle}"`,
      ).toBe(true);
    }
  });
});

describe('math detection — properly-delimited excerpts are never double-converted', () => {
  it.each(
    delimitedOnlyCases.map((c) => [c.i, label(c.excerpt), c.excerpt] as const),
  )(
    'math[%i] "%s" — pass returns input reference-equal, segment counts stable',
    (_i, _label, excerpt) => {
      const tokenized = tokenizeInline(excerpt);
      const normalized = normalizeMathSegments(tokenized);

      // Delimited math was extracted by the tokenizer; the pass has nothing
      // to do and must return the ORIGINAL array (untouched fast-path).
      expect(normalized).toBe(tokenized);
      expect(normalized.length).toBe(tokenized.length);
      expect(mathSegments(normalized).length).toBe(
        mathSegments(tokenized).length,
      );
    },
  );
});
