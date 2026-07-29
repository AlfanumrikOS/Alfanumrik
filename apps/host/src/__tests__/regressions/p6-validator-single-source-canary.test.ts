/**
 * P6 ANTI-FORK CANARY — there is exactly ONE question validator.
 *
 * STATIC-SOURCE test. It executes no product code; it reads
 * `packages/lib/src/**` as text and asserts a structural property.
 *
 * WHY THIS EXISTS (this is the whole point of the fix it guards)
 * =============================================================
 * P6 was implemented THREE times:
 *
 *   packages/lib/src/quiz-assembler.ts   ← LIVE student quiz path
 *   packages/lib/src/domains/quiz.ts
 *   packages/lib/src/supabase.ts
 *
 * They drifted. The 2026-07-29 forensic audit found the `correct_answer_index`
 * null hole (`null < 0` and `null > 3` are both false in JS, so a question with
 * no answer key passed the gate) and FIXED IT IN TWO OF THE THREE COPIES — the
 * live one kept the hole. That is the defect class: an audit fix landing in the
 * wrong copy, with every reviewer believing the invariant was enforced.
 *
 * Behavioural tests cannot catch this. A fourth copy can be introduced
 * tomorrow, be wrong, be on the live path, and every existing test still
 * passes — because the tests exercise the canonical module while production
 * calls the fork. Only a static single-implementation assertion catches it.
 *
 * WHAT WOULD TURN THIS RED
 * ------------------------
 *   - someone re-inlines a `validateQuestion(s)` body in one of the three
 *     historical fork sites instead of delegating,
 *   - someone adds a NEW file under packages/lib/src that re-implements the
 *     gate (detected via the rejection-reason vocabulary and the garbage
 *     substring set, which only the canonical module may own),
 *   - someone deletes the canonical module or renames its exports.
 *
 * Invariant: P6 (Question Quality). Companion behavioural suite:
 * `src/__tests__/lib/quiz/question-validation.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Repo-root resolution ──────────────────────────────────────────────────────
// The vitest process runs with cwd = apps/host. Walk up until we find the
// monorepo root (the directory that owns BOTH `apps/` and `packages/lib/src`).
// Deliberately independent of the setup.ts fs shim, which only remaps a fixed
// allow-list of repo-root directories and does not cover `packages/`.

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
const LIB_SRC = path.join(REPO_ROOT, 'packages', 'lib', 'src');
const CANONICAL_REL = 'quiz/question-validation.ts';

/** Every non-test .ts/.tsx file under packages/lib/src, as repo-relative paths. */
function listLibSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      out.push(path.relative(LIB_SRC, full).split(path.sep).join('/'));
    }
  };
  walk(LIB_SRC);
  return out.sort();
}

const LIB_FILES = listLibSources();
const read = (rel: string) => fs.readFileSync(path.join(LIB_SRC, rel), 'utf8');

/** Strip line and block comments so prose about the old forks never matches. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

// ════════════════════════════════════════════════════════════════════════════
// 0. Canary preconditions — fail loudly rather than vacuously.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 anti-fork canary: preconditions', () => {
  it('the scan found a real, non-trivial set of packages/lib sources', () => {
    expect(LIB_FILES.length).toBeGreaterThan(50);
  });

  it('the canonical module exists and exports the gate plus its thresholds', () => {
    expect(LIB_FILES).toContain(CANONICAL_REL);
    const src = read(CANONICAL_REL);
    expect(src).toMatch(/export function validateQuestion\s*\(/);
    expect(src).toMatch(/export function validateQuestions\s*</);
    for (const constant of [
      'MIN_QUESTION_TEXT_LENGTH',
      'MIN_EXPLANATION_LENGTH',
      'MIN_EXPLANATION_WORDS',
      'REQUIRED_OPTION_COUNT',
    ]) {
      expect(src).toContain(`export const ${constant}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Exactly ONE implementation of the gate under packages/lib/src.
//
//    The rejection-reason vocabulary and the garbage-pattern substrings are the
//    fingerprints of an implementation. A delegating wrapper does not contain
//    them; a re-implementation cannot avoid them.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 anti-fork canary: exactly one implementation', () => {
  /** Reason codes only the canonical module may emit. */
  const IMPLEMENTATION_FINGERPRINTS = [
    "'missing_answer_index'",
    "'bad_answer_index'",
    "'duplicate_options'",
    "'weak_explanation'",
    "'terse_explanation'",
    "'unreliable_explanation'",
    "'garbage_text'",
    "'invalid_bloom_level'",
  ] as const;

  for (const fingerprint of IMPLEMENTATION_FINGERPRINTS) {
    it(`rejection reason ${fingerprint} is emitted from exactly one file`, () => {
      const owners = LIB_FILES.filter((rel) => stripComments(read(rel)).includes(fingerprint));
      // The type alias in the canonical module counts as the same file, so the
      // expected owner set is exactly [canonical].
      expect(owners).toEqual([CANONICAL_REL]);
    });
  }

  it('the garbage-option substring set lives in exactly one live file, plus one quarantined leftover', () => {
    // 'no board exam' / 'art and craft' are verbatim filler-distractor
    // fingerprints. Two files carrying them means two pattern sets that can
    // drift apart — which is precisely how the three forks diverged.
    //
    // KNOWN LEFTOVER, deliberately allow-listed rather than ignored:
    // `quiz-engine.ts` still carries `validateQuestionForQuiz()`, a FOURTH
    // partial copy of the P6 pattern set that the 2026-07-29 consolidation did
    // not fold in. It accepts `>= 3` distinct options and has no bloom_level
    // check — i.e. it carries two of the exact defects the consolidation
    // removed from the other three. It is NOT deleted here because this suite
    // does not edit product code, and it is tolerable ONLY because it has zero
    // production callers — which the next test enforces.
    //
    // TODO(assessment): fold validateQuestionForQuiz into the canonical gate
    // (or delete it) and shrink this expectation back to [CANONICAL_REL].
    const owners = LIB_FILES.filter((rel) => {
      const src = stripComments(read(rel));
      return src.includes('no board exam') && src.includes('art and craft');
    });
    expect(owners.slice().sort()).toEqual(['quiz-engine.ts', CANONICAL_REL].sort());
  });

  it('the quarantined quiz-engine copy has NO production callers (it can never serve a student)', () => {
    // The allow-list above is only safe while nothing calls it. The moment a
    // route, component, or lib module imports validateQuestionForQuiz, a weaker
    // P6 gate is back on a serving path and this turns red.
    const callers: string[] = [];

    const scanTree = (root: string, label: string) => {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (
              entry.name === 'node_modules' ||
              entry.name === '__tests__' ||
              entry.name === '.next'
            ) {
              continue;
            }
            walk(full);
            continue;
          }
          if (!/\.tsx?$/.test(entry.name)) continue;
          if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
          const rel = `${label}/${path.relative(root, full).split(path.sep).join('/')}`;
          const src = stripComments(fs.readFileSync(full, 'utf8'));
          if (!src.includes('validateQuestionForQuiz')) continue;
          // The DECLARATION site is not a caller. Matching on the declaration
          // rather than on a hard-coded path also covers the auto-generated
          // `apps/host/src/lib/*.ts` re-export stubs, whose reads the test
          // harness transparently redirects to the packages/lib original.
          if (src.includes('export function validateQuestionForQuiz')) continue;
          callers.push(rel);
        }
      };
      walk(root);
    };

    scanTree(LIB_SRC, 'packages/lib');
    scanTree(path.join(REPO_ROOT, 'packages', 'ui', 'src'), 'packages/ui');
    scanTree(path.join(REPO_ROOT, 'apps', 'host', 'src'), 'apps/host');

    expect(callers).toEqual([]);
  });

  it('no packages/lib file other than the canonical one declares validateQuestion/validateQuestions with a body of its own', () => {
    const DECL = /(?:export\s+)?function\s+validateQuestions?\s*[<(]/g;
    const offenders: Array<{ file: string; body: string }> = [];

    for (const rel of LIB_FILES) {
      if (rel === CANONICAL_REL) continue;
      const src = stripComments(read(rel));
      let match: RegExpExecArray | null;
      DECL.lastIndex = 0;
      while ((match = DECL.exec(src)) !== null) {
        // A legitimate site is a THIN delegation: its body calls the canonical
        // gate. Take a generous slice after the declaration and require the
        // delegation call inside it.
        const declSlice = src.slice(match.index, match.index + 600);
        if (/validateQuestions?P6\s*\(/.test(declSlice)) continue;
        offenders.push({ file: rel, body: declSlice.slice(0, 200) });
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. The three historical fork sites IMPORT the canonical gate.
//
//    These are the exact files whose forks diverged. Each must (a) import from
//    the canonical module and (b) delegate rather than re-implement.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 anti-fork canary: the three former fork sites delegate', () => {
  const FORK_SITES = [
    // [file, the local symbol it delegates through]
    ['quiz-assembler.ts', 'validateQuestionP6'],
    ['domains/quiz.ts', 'validateQuestionsP6'],
    ['supabase.ts', 'validateQuestionsP6'],
  ] as const;

  for (const [rel, delegate] of FORK_SITES) {
    it(`${rel} imports the canonical gate and calls it`, () => {
      expect(LIB_FILES).toContain(rel);
      const src = read(rel);

      // (a) It imports from the canonical module. Both the alias form
      // (`@alfanumrik/lib/quiz/question-validation`) and a relative form are
      // accepted — what matters is that it is THAT module.
      expect(
        /from\s+['"](?:@alfanumrik\/lib\/|\.{1,2}\/(?:\.\.\/)*)quiz\/question-validation['"]/.test(
          src,
        ),
        `${rel} must import from packages/lib/src/quiz/question-validation`,
      ).toBe(true);

      // (b) It actually calls the imported gate.
      expect(stripComments(src)).toContain(`${delegate}(`);
    });
  }

  it('quiz-assembler is the ONLY fork site that passes allowNonMcq: true', () => {
    // allowNonMcq is the one non-unioned axis. quiz-assembler needs it (its
    // 2026-05-09 fix let short/long-answer types through the MCQ SHAPE checks);
    // the other two paths must keep rejecting non-MCQ rows. If a second site
    // starts passing it, a UI starts receiving a question shape it cannot
    // render — silently, as an empty or broken quiz item.
    const passers = LIB_FILES.filter((rel) => {
      if (rel === CANONICAL_REL) return false;
      return /allowNonMcq\s*:\s*true/.test(stripComments(read(rel)));
    });
    expect(passers).toEqual(['quiz-assembler.ts']);
  });
});
