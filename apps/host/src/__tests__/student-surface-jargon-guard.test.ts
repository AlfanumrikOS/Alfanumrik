/**
 * R5 — no internal model or metric vocabulary reaches a student.
 *
 * CEO acceptance criterion: "Never expose internal names such as IRT, BKT, DKT,
 * CME or SRS to students."
 *
 * This is the repo-wide sibling of the /today guard in
 * `apps/host/src/__tests__/lib/today/reason-copy.test.ts`. That file pins ONE
 * copy table (`packages/lib/src/today/copy.ts`) and its own header names the
 * leaks it could not reach: "the product audit found live jargon leaks
 * elsewhere (`ZPD:` badges, Cohen's `d=0.54`, 'Fatigue 47%')". Every one of
 * those was live on a student surface at the time it was written, which is
 * exactly the point — a guard scoped to one file is not a guard against the
 * class of defect. This suite widens the file set to the student-visible
 * surfaces those leaks were actually found on.
 *
 * WHAT IS CHECKED: rendered strings only. Comments and identifiers are stripped
 * first, so a file may (and should) explain in a comment WHY a term was removed
 * — the removal notes left behind by R5 are load-bearing documentation and must
 * not be what makes this suite fail. Identifiers are exempt for the same
 * reason: `cogLoad.fatigueScore` is an internal field name, `fatigue_detected`
 * is a real DB column, and neither is user-visible. The leak is the LITERAL a
 * child reads.
 *
 * NOT A LINT RULE ABOUT WORDS: "Bloom's" is explicitly permitted by P7 as a
 * technical term. What is banned is the raw enum TOKEN (`analyze`, `evaluate`)
 * rendered as a machine value — covered by its own assertion below rather than
 * by the vocabulary list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Student-visible surfaces. Each entry is a real file a signed-in student can
 * reach. Kept as an explicit list (not a glob over every page) so the suite
 * states precisely which surfaces are covered and cannot silently go vacuous by
 * matching nothing.
 */
const STUDENT_SURFACES = [
  'apps/host/src/app/help/page.tsx',
  'apps/host/src/app/tutor/page.tsx',
  'apps/host/src/app/(student)/exam-prep/page.tsx',
  'apps/host/src/app/(student)/quiz/page.tsx',
  'apps/host/src/app/foxy/_components/StudyArtifactSheet.tsx',
  'packages/ui/src/quiz/QuizResults.tsx',
  'packages/ui/src/quiz/QuizSetup.tsx',
  'packages/ui/src/quiz/FeedbackOverlay.tsx',
  'packages/ui/src/dashboard/os/BoardScoreWidget.tsx',
] as const;

/**
 * Internal vocabulary that must never reach a student, mirroring the JARGON
 * list in reason-copy.test.ts plus the terms that audit found live on these
 * surfaces.
 *
 * Deliberately NOT listed: 'confidence' as a bare word (a student-facing
 * "you're getting more confident" is legitimate copy); the banned construct is
 * "confidence band", listed as a phrase.
 */
const JARGON = [
  'IRT',
  'BKT',
  'DKT',
  'CME',
  'SRS',
  'ZPD',
  'theta',
  'Bayesian',
  'Knowledge Tracing',
  'spaced repetition',
  'स्पेस्ड रिपिटिशन',
  'confidence band',
  'विश्वास सीमा',
  'cognitive load',
  'retrieval practice',
  'interleaved',
  'interleaving',
] as const;

/**
 * "Fatigue"/"थकान" as a rendered word, and Cohen's d effect sizes. Separated
 * from JARGON because they need their own explanation:
 *
 *   - fatigue: `fatigueScore` is an internal cognitive-load scalar. A student
 *     cannot act on "47%". The COMPUTATION is untouched by R5 — only the
 *     readouts were deleted (mid-quiz chip, scorecard line).
 *   - Cohen's d: `d=0.54` / `d=1.05` were rendered verbatim to Class 6-12
 *     students in the exam-prep daily-cycle card.
 */
const SCALAR_LEAKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'fatigue (EN)', re: /\bfatigue\b/i },
  { name: 'थकान (HI)', re: /थकान/ },
  { name: "Cohen's d effect size", re: /\bd\s*=\s*\d/ },
];

/** Raw lowercase Bloom enum tokens, rendered as machine values. */
const BLOOM_TOKENS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

// ── source → rendered string literals ────────────────────────────────────────

/**
 * Strip comments so a removal note explaining WHY a term is gone does not fail
 * the suite. Handles `//`, `/* *\/` and JSX `{/* *\/}` — but never inside a
 * string literal, which is why this is a small scanner and not a regex.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * String literals from comment-stripped source. Import specifiers and bare
 * identifiers are excluded: a `from '@alfanumrik/lib/cognitive-engine'` path
 * and a `fatigue_detected` DB column are not things a student reads.
 */
export function renderedLiterals(src: string): string[] {
  const code = stripComments(src)
    // import/export module specifiers
    .replace(/\b(?:import|export)\s[^;\n]*?from\s*['"][^'"]*['"]/g, '')
    .replace(/\bimport\s*\(\s*['"][^'"]*['"]\s*\)/g, '')
    // object KEYS (`fatigue_detected:` / `'fatigue':`) are field names, not copy
    .replace(/['"]([A-Za-z0-9_$]+)['"]\s*:/g, '')
    // `.select('fatigue_detected, difficulty_adjustments')` — a column list
    .replace(/\.(?:select|eq|order|from|neq|gte|lte|in)\(\s*['"][^'"]*['"]/g, '');

  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) out.push(m[1]);
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) out.push(m[1]);
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) out.push(m[1]);
  // JSX text nodes. A text node ends at the next `<` OR the next `{` \u2014 the
  // second half matters: the live `ZPD: {isHi ? z.labelHi : z.label}` badge is
  // a text node terminated by an EXPRESSION, so a `>\u2026<`-only pattern walked
  // straight past the exact leak this suite exists to catch. Verified against
  // the pre-change file before this line was written.
  // `[ \t\r\n]*` after the anchor is load-bearing: real JSX is indented, so the
  // badge reads `>\n    ZPD: {`. Without it the pattern never fires on formatted
  // source and the whole JSX-text arm silently scans nothing.
  for (const m of code.matchAll(/>[ \t\r\n]*([^<>{}\n]*[A-Za-z\u0900-\u097F][^<>{}\n]*)[<{]/g)) {
    out.push(m[1].trim());
  }
  // \u2026and text that FOLLOWS an expression container: `{pct}% of chapters<`.
  // Anchored on `}`, which is also a plain JS block close, so statement-shaped
  // captures are dropped \u2014 otherwise `} else if (mode === 'srs') {` reads as
  // student copy and the word list has to be weakened to accommodate it.
  const STATEMENT_SHAPED = /[=;()]|\b(?:if|else|return|const|let|var|function|async|await|typeof|new|catch|try)\b/;
  for (const m of code.matchAll(/\}[ \t\r\n]*([^<>{}\n]*[A-Za-z\u0900-\u097F][^<>{}\n]*)[<{]/g)) {
    const text = m[1].trim();
    if (!STATEMENT_SHAPED.test(text)) out.push(text);
  }
  return out.map((s) => s.trim()).filter(isProseLike);
}

/**
 * Separates COPY from MACHINE VALUES. Without this the scan drowns in false
 * positives that are not user-visible at all and would force the vocabulary
 * list to be watered down \u2014 which is how a guard stops guarding:
 *
 *   `kind: 'srs'`                       \u2014 a deep-link discriminant
 *   `q.bloom_level === 'analyze'`       \u2014 a DB column value in a comparison
 *   `'@alfanumrik/lib/learn/srs-quiz-review'` \u2014 a module path
 *
 * The rule: real student copy is either Devanagari, or contains a capital or a
 * space (English sentences, "Fatigue", "ZPD: ", "Confidence Band"). An
 * all-lowercase single token, or anything shaped like a path/identifier, is
 * machine vocabulary. Every string R5 actually removed satisfies the rule \u2014
 * asserted directly in the self-test below, so this filter cannot quietly be
 * loosened until it excuses the original defects.
 */
export function isProseLike(s: string): boolean {
  if (s.length === 0) return false;
  if (/[\u0900-\u097F]/.test(s)) return true;
  // path- or identifier-shaped: no spaces and only code-ish characters
  if (!/\s/.test(s) && /^[a-z0-9_@./\-[\]$]+$/i.test(s) && !/[A-Z]/.test(s)) return false;
  if (!/\s/.test(s) && /^[a-z0-9_-]+$/.test(s)) return false;
  return /[A-Z]/.test(s) || /\s/.test(s);
}

function read(rel: string): string {
  const abs = path.join(REPO_ROOT, rel);
  return readFileSync(abs, 'utf8');
}

// ── the suite ────────────────────────────────────────────────────────────────

describe('R5 guard — scan is non-vacuous', () => {
  it('every listed student surface exists (a moved file must not silently pass)', () => {
    const missing = STUDENT_SURFACES.filter((rel) => !existsSync(path.join(REPO_ROOT, rel)));
    expect(
      missing,
      `listed student surface(s) no longer exist — update this list rather than letting the guard scan nothing:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('extracts a realistic number of rendered strings from each surface', () => {
    for (const rel of STUDENT_SURFACES) {
      expect(renderedLiterals(read(rel)).length, `${rel} yielded almost no strings — the extractor is broken`).toBeGreaterThan(15);
    }
  });

  it('the extractor keeps copy and drops comments (self-test)', () => {
    const sample = [
      "const a = 'Review due';",
      '// we removed the ZPD badge here',
      "/* Cohen's d=0.54 was rendered to students */",
      "const b = 'Fatigue 47%';",
    ].join('\n');
    const lits = renderedLiterals(sample);
    expect(lits).toContain('Review due');
    expect(lits).toContain('Fatigue 47%');
    expect(lits.join(' ')).not.toContain('ZPD');
    expect(lits.join(' ')).not.toContain('d=0.54');
  });

  it('reads a JSX text node that ends at an expression, not just at a tag', () => {
    // The live leak was `ZPD: {isHi ? z.labelHi : z.label}` — text terminated by
    // `{`. An extractor that only reads `>text<` reports a clean file.
    expect(renderedLiterals('<span>ZPD: {isHi ? a : b}</span>')).toContain('ZPD:');
    expect(renderedLiterals('<span>{n} Fatigue {pct}%</span>')).toContain('Fatigue');
    // …and through real (indented, multi-line) JSX, which is how it actually
    // appeared. A pattern that only matched single-line JSX scanned nothing.
    expect(
      renderedLiterals('<span\n  className="x"\n>\n    ZPD: {isHi ? a : b}\n</span>'),
    ).toContain('ZPD:');
  });

  it('does not read plain JS control flow as student copy', () => {
    // `} else if (mode === \'srs\') {` is code, not copy. Reading it as copy
    // would force 'SRS' out of the vocabulary list to keep the suite green.
    const lits = renderedLiterals("if (a) {\n  x();\n} else if (mode === 'srs') {\n  y();\n}");
    expect(lits.filter((s) => /\bsrs\b/i.test(s))).toEqual([]);
  });

  it('the prose filter still admits every string R5 removed (it cannot be loosened into a no-op)', () => {
    // If a future edit widens `isProseLike` until one of these is treated as a
    // machine value, the guard stops guarding — so they are asserted by name.
    for (const removed of [
      'Fatigue',
      'थकान',
      'ZPD: ',
      'Confidence Band',
      'विश्वास सीमा',
      'Bayesian Knowledge Tracing',
      'Flashcard Review — spaced repetition (d=0.54)',
      'स्पेस्ड रिपिटिशन कैसे काम करता है?',
      'Powered by proven science: Retrieval Practice + Spaced Repetition + Interleaved Practice',
    ]) {
      expect(isProseLike(removed), `"${removed}" would no longer be scanned`).toBe(true);
    }
  });

  it('the prose filter rejects machine vocabulary (so the word list need not be watered down)', () => {
    for (const token of ['srs', 'remember', 'analyze', '@alfanumrik/lib/learn/srs-quiz-review', 'bloom_level']) {
      expect(isProseLike(token), `"${token}" is a machine value, not copy`).toBe(false);
    }
  });
});

describe('R5 — no internal model or metric name is rendered to a student', () => {
  for (const rel of STUDENT_SURFACES) {
    describe(rel, () => {
      const literals = renderedLiterals(read(rel));

      it.each(JARGON)('renders no "%s"', (term) => {
        // Word-anchored where the term is a single word, substring for phrases
        // and Devanagari (which has no \b semantics in JS regex).
        const isWord = /^[A-Za-z]+$/.test(term);
        const re = isWord
          ? new RegExp(`\\b${term}\\b`, 'i')
          : new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const offenders = literals.filter((s) => re.test(s));
        expect(offenders, `"${term}" is rendered in ${rel}: ${offenders.join(' | ')}`).toEqual([]);
      });

      it.each(SCALAR_LEAKS.map((s) => [s.name, s.re] as const))(
        'renders no %s',
        (_name, re) => {
          const offenders = literals.filter((s) => re.test(s));
          expect(offenders, `internal scalar leaked in ${rel}: ${offenders.join(' | ')}`).toEqual([]);
        },
      );
    });
  }
});

describe("R5 — Bloom's is permitted, the raw enum token is not", () => {
  it('StudyArtifactSheet renders the bilingual label, not `s.bloomLevel`', () => {
    const src = stripComments(read('apps/host/src/app/foxy/_components/StudyArtifactSheet.tsx'));
    // The raw token was rendered two ways: as the badge body and inside a
    // `title={`Bloom's: ${s.bloomLevel}`}` tooltip.
    expect(src).not.toMatch(/\{\s*s\.bloomLevel\s*\}/);
    expect(src).not.toMatch(/Bloom's:\s*\$\{/);
    // Non-vacuous: it really does still render a Bloom badge, via BLOOM_CONFIG.
    expect(src).toContain('BLOOM_CONFIG');
    expect(src).toMatch(/labelHi/);
  });

  it('no student surface renders a bloom field straight into JSX', () => {
    // The leak is structural, not lexical: `{s.bloomLevel}` puts the raw DB
    // value on screen, untranslated, in both languages. A literal scan can
    // never see it (there is no literal), so this asserts on the expression.
    const RAW_BLOOM_JSX = /\{\s*[A-Za-z_$][\w$]*(?:\?\.|\.)[\w$.?]*bloom_?[Ll]evel\s*\}/;
    for (const rel of STUDENT_SURFACES) {
      const code = stripComments(read(rel));
      expect(
        RAW_BLOOM_JSX.test(code),
        `${rel} renders a raw bloom_level/bloomLevel value — use BLOOM_CONFIG's bilingual label`,
      ).toBe(false);
    }
  });

  it('the raw-bloom detector actually detects (self-test — not a vacuous false)', () => {
    const RAW_BLOOM_JSX = /\{\s*[A-Za-z_$][\w$]*(?:\?\.|\.)[\w$.?]*bloom_?[Ll]evel\s*\}/;
    expect(RAW_BLOOM_JSX.test('<span>{s.bloomLevel}</span>')).toBe(true);
    expect(RAW_BLOOM_JSX.test('<span>{q.bloom_level}</span>')).toBe(true);
    expect(RAW_BLOOM_JSX.test('<span>{bc.label}</span>')).toBe(false);
  });

  it('a bare Bloom enum token is never used as copy', () => {
    // Belt-and-braces: catches someone hardcoding `>analyze<` as JSX text.
    for (const rel of STUDENT_SURFACES) {
      const jsxText = [...stripComments(read(rel)).matchAll(/>([^<>{}\n]+)</g)].map((m) => m[1].trim());
      const offenders = jsxText.filter((s) => BLOOM_TOKENS.includes(s));
      expect(offenders, `${rel} renders a raw Bloom enum token: ${offenders.join(' | ')}`).toEqual([]);
    }
  });
});

describe('R5 — the specific removals stay removed', () => {
  it('exam-prep derives no Bloom badge from the task-type string', () => {
    // TASK_BLOOM_MAP mapped task_type → BloomLevel, so EVERY quiz task claimed
    // "Apply" regardless of its questions. Fabricated metadata, not a label.
    const src = read('apps/host/src/app/(student)/exam-prep/page.tsx');
    expect(stripComments(src)).not.toContain('TASK_BLOOM_MAP');
    // The file must still document why, so a revert is visible in review.
    expect(src).toContain('TASK_BLOOM_MAP');
  });

  it('the fatigue readouts are gone from both quiz surfaces', () => {
    for (const rel of ['apps/host/src/app/(student)/quiz/page.tsx', 'packages/ui/src/quiz/QuizResults.tsx']) {
      const code = stripComments(read(rel));
      expect(code, `${rel} still renders a fatigue percentage`).not.toMatch(
        /fatigueScore\s*\*\s*100/,
      );
    }
  });

  it('the cognitive-load COMPUTATION is untouched (P3/P4 unaffected)', () => {
    // R5 removed displays, not logic. The quiz page must still persist
    // `fatigue_detected` on the session row — if this flips, someone deleted
    // the engine wiring while chasing a copy defect.
    const quiz = stripComments(read('apps/host/src/app/(student)/quiz/page.tsx'));
    expect(quiz).toContain('fatigue_detected');
    expect(quiz).toContain('cogLoad');
  });

  it('BoardScoreWidget renders no confidence interval, but still receives one', () => {
    const src = read('packages/ui/src/dashboard/os/BoardScoreWidget.tsx');
    const code = stripComments(src);
    // The band is no longer painted…
    expect(code).not.toMatch(/confidence_band_low\s*\)/);
    // …but the API contract field is untouched (backend/mobile unaffected).
    expect(code).toContain('confidence_band_low');
  });

  it('help page states the real five mastery levels', () => {
    // The old copy invented "Familiar" and omitted "Beginner". The live enum is
    // packages/lib/src/exams/mastery-band.ts: ConceptMasteryLevel.
    const help = read('apps/host/src/app/help/page.tsx');
    const enumSrc = read('packages/lib/src/exams/mastery-band.ts');
    expect(enumSrc).toContain("'not_started' | 'beginner' | 'developing' | 'proficient' | 'mastered'");
    expect(help).toContain('Not Started → Beginner → Developing → Proficient → Mastered');
    expect(help).not.toContain('Familiar');
  });

  it('the help "Reset password" quick fix does not dump the student on the homepage', () => {
    const help = stripComments(read('apps/host/src/app/help/page.tsx'));
    const idx = help.indexOf("case 'reset-password'");
    expect(idx).toBeGreaterThan(-1);
    const branch = help.slice(idx, idx + 200);
    expect(branch).not.toMatch(/router\.push\(\s*['"]\/['"]\s*\)/);
    expect(branch).toMatch(/\/settings|\/login/);
  });
});

describe('R6 — /missions is not shipped while it cannot work', () => {
  it('the page is gone (its endpoint does not exist)', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/host/src/app/(student)/missions/page.tsx'))).toBe(false);
  });

  it('/api/play/mission-progress still does not exist — which is why', () => {
    // When backend ships it, this flips and the surface may be re-mounted.
    expect(existsSync(path.join(REPO_ROOT, 'apps/host/src/app/api/play'))).toBe(false);
  });

  it('nothing links to /missions', () => {
    const hits: string[] = [];
    for (const root of ['apps/host/src', 'packages/ui/src']) {
      walk(path.join(REPO_ROOT, root), (file) => {
        if (!/\.(tsx?|jsx?)$/.test(file) || /__tests__/.test(file)) return;
        const code = stripComments(readFileSync(file, 'utf8'));
        if (/['"`]\/missions(?:['"`?/])/.test(code)) hits.push(path.relative(REPO_ROOT, file));
      });
    }
    expect(hits, `dead link to the removed /missions page: ${hits.join(', ')}`).toEqual([]);
  });
});

function walk(dir: string, visit: (file: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full);
  }
}
