/**
 * Canonical-math-pipeline SINGLE-SOURCE + truncated-preview canaries
 * (docs/math-rendering-spec.md §5/§6, 2026-07-20 consolidation).
 *
 * Static-source contract canaries (same convention as
 * math-density-drift-guard.test.ts and the daily-cron REG-118 canary):
 * cheap, deterministic, no rendering.
 *
 * Pins:
 *   1. SINGLE NORMALIZER: every math-normalization primitive
 *      (normalizeLatexDelimiters, tokenizeInline, containsAllowlistedMathCommand,
 *      containsRenderableMath, splitUndelimitedMath, normalizeMathSegments) is
 *      DEFINED exactly once, in `packages/ui/src/math/normalize.ts`. The spec
 *      forbids a second frontend regex patch (§5 "rescue, singular") — a
 *      duplicate definition anywhere else in packages/ui is a rejectable change.
 *   2. SHIM PURITY: `packages/ui/src/foxy/math-normalization.ts` is an
 *      export-only compatibility shim over `../math/normalize` — zero logic.
 *   3. SINGLE KATEX-DIRECT SITE: `katex.renderToString` / `from 'katex'`
 *      appear only in `packages/ui/src/math/katex-segments.tsx`; the single
 *      react-markdown+math config lives only in `math/MathMarkdown.tsx`.
 *   4. CONSUMER WIRING: FoxyStructuredRenderer, RichContent, QuizResults,
 *      the quiz page, and MockTestRunner all consume the canonical pipeline
 *      (imports from math/normalize / math/katex-segments / math/MathRenderer)
 *      with the spec invocation shapes (inline on option rows).
 *   5. TRUNCATED-PREVIEW CANARY: strings sliced mid-LaTeX are NEVER passed to
 *      MathRenderer — the QuizResults collapsed row header (`substring(0, 90)`),
 *      and the super-admin cms + workbench `slice(0, 80)` list cells stay
 *      PLAIN text (a truncated `\frac{1}{` must not reach KaTeX).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * cwd-insensitive repo-root resolution. NOTE: this deliberately anchors on
 * `packages/ui/src` rather than `supabase/functions` (the drift-guard
 * convention) — setup.ts shims fs.existsSync to remap `apps/host/supabase/…`
 * to the repo root, which would make the supabase anchor match at apps/host
 * and mislocate the root. `packages/` is NOT in the shim's remap set, so this
 * anchor is honest.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'packages', 'ui', 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `math-pipeline-single-source: could not locate packages/ui/src walking up from ${process.cwd()}`,
  );
}

const ROOT = findRepoRoot();
const UI_SRC = join(ROOT, 'packages', 'ui', 'src');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** All .ts/.tsx files under packages/ui/src, as repo-relative paths. */
function walkUiSources(dir = UI_SRC, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkUiSources(full, acc);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      acc.push(full.slice(ROOT.length + 1).replace(/\\/g, '/'));
    }
  }
  return acc;
}

const uiFiles = walkUiSources();

const NORMALIZER_FNS = [
  'normalizeLatexDelimiters',
  'tokenizeInline',
  'containsAllowlistedMathCommand',
  'containsRenderableMath',
  'splitUndelimitedMath',
  'normalizeMathSegments',
] as const;

// ── 1. Single normalizer definition site ─────────────────────────────────────

describe('single normalizer — definition sites live ONLY in packages/ui/src/math/normalize.ts', () => {
  it('sanity: the packages/ui walk found the canonical files', () => {
    expect(uiFiles).toContain('packages/ui/src/math/normalize.ts');
    expect(uiFiles).toContain('packages/ui/src/math/katex-segments.tsx');
    expect(uiFiles).toContain('packages/ui/src/math/MathRenderer.tsx');
    expect(uiFiles).toContain('packages/ui/src/foxy/math-normalization.ts');
    expect(uiFiles.length).toBeGreaterThan(20);
  });

  it.each(NORMALIZER_FNS)(
    '%s is DEFINED exactly once across packages/ui/src — in math/normalize.ts',
    (fn) => {
      const defRe = new RegExp(`\\bfunction ${fn}\\b|\\bconst ${fn}\\s*=`);
      const definers = uiFiles.filter((f) => defRe.test(read(f)));
      expect(definers).toEqual(['packages/ui/src/math/normalize.ts']);
    },
  );

  it('the KaTeX-direct segment renderer (renderKatex / renderInlineSegments) is defined only in math/katex-segments.tsx', () => {
    for (const fn of ['renderKatex', 'renderInlineSegments']) {
      const defRe = new RegExp(`\\bfunction ${fn}\\b|\\bconst ${fn}\\s*=`);
      const definers = uiFiles.filter((f) => defRe.test(read(f)));
      expect(definers, `${fn} must have exactly one definition site`).toEqual([
        'packages/ui/src/math/katex-segments.tsx',
      ]);
    }
  });
});

// ── 2. Shim purity ───────────────────────────────────────────────────────────

describe('foxy/math-normalization.ts — export-only compatibility shim (zero logic)', () => {
  const shim = read('packages/ui/src/foxy/math-normalization.ts');

  it('re-exports from ../math/normalize', () => {
    expect(shim).toContain("from '../math/normalize'");
    expect(shim).toContain('normalizeMathSegments');
    expect(shim).toContain('containsAllowlistedMathCommand');
    expect(shim).toContain('splitUndelimitedMath');
    expect(shim).toContain('MATH_COMMAND_ALLOWLIST');
  });

  it('contains NO logic — no function/const/class/regex declarations', () => {
    // Strip block + line comments, then assert only export/import/blank lines remain.
    const stripped = shim
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/\bfunction\b/);
    expect(stripped).not.toMatch(/\bconst\b/);
    expect(stripped).not.toMatch(/\bclass\b/);
    expect(stripped).not.toMatch(/=>/);
    for (const line of stripped.split('\n').map((l) => l.trim()).filter(Boolean)) {
      expect(
        /^(export|import|\}|\{|type|[A-Za-z_$][\w$]*,?|\} from .*;?)/.test(line),
        `unexpected non-export line in shim: "${line}"`,
      ).toBe(true);
    }
  });
});

// ── 3. Single KaTeX-direct + single markdown-math config ─────────────────────

describe('single heavy-dependency sites', () => {
  it("`from 'katex'` (direct KaTeX import) appears ONLY in math/katex-segments.tsx", () => {
    const importers = uiFiles.filter((f) => /from ['"]katex['"]/.test(read(f)));
    expect(importers).toEqual(['packages/ui/src/math/katex-segments.tsx']);
  });

  it('`katex.renderToString(` is CALLED only in math/katex-segments.tsx', () => {
    const callers = uiFiles.filter((f) => read(f).includes('katex.renderToString('));
    expect(callers).toEqual(['packages/ui/src/math/katex-segments.tsx']);
  });

  it("the react-markdown+math config (`from 'react-markdown'`) lives ONLY in math/MathMarkdown.tsx", () => {
    const importers = uiFiles.filter((f) => /from ['"]react-markdown['"]/.test(read(f)));
    expect(importers).toEqual(['packages/ui/src/math/MathMarkdown.tsx']);
  });
});

// ── 4. Consumer wiring (canonical pipeline, spec invocation shapes) ──────────

describe('consumer wiring — all math surfaces flow through the canonical pipeline', () => {
  it('FoxyStructuredRenderer imports tokenizer/normalizer from ../math/normalize and the renderer from ../math/katex-segments', () => {
    const fsr = read('packages/ui/src/foxy/FoxyStructuredRenderer.tsx');
    expect(fsr).toContain("from '../math/normalize'");
    expect(fsr).toContain("from '../math/katex-segments'");
  });

  it('RichContent pre-normalizes via the canonical normalizeLatexDelimiters and renders via MathMarkdown', () => {
    const rc = read('packages/ui/src/foxy/RichContent.tsx');
    expect(rc).toContain("from '../math/normalize'");
    expect(rc).toContain('normalizeLatexDelimiters');
    expect(rc).toContain('MathMarkdown');
  });

  it('QuizResults renders explanations full-width and options inline through MathRenderer', () => {
    const qr = read('packages/ui/src/quiz/QuizResults.tsx');
    expect(qr).toContain("import MathRenderer from '@alfanumrik/ui/math/MathRenderer'");
    expect(qr).toContain('<MathRenderer content={explanation} />');
    expect(qr).toContain('<MathRenderer inline content={opt} />');
    expect(qr).toContain('<MathRenderer inline content={w.questionText} />');
  });

  it('the quiz page renders question text / options / explanation through MathRenderer (inline on options)', () => {
    const qp = read('apps/host/src/app/(student)/quiz/page.tsx');
    expect(qp).toContain("import MathRenderer from '@alfanumrik/ui/math/MathRenderer'");
    expect(qp).toContain('<MathRenderer content={isHi && q.question_hi ? q.question_hi : q.question_text} />');
    expect(qp).toContain('<MathRenderer inline content={optText} />');
  });

  it('MockTestRunner renders question text through MathRenderer and options inline', () => {
    const mtr = read('packages/ui/src/exams/MockTestRunner.tsx');
    expect(mtr).toContain("import MathRenderer from '@alfanumrik/ui/math/MathRenderer'");
    expect(mtr).toContain('<MathRenderer content={questionText} />');
    expect(mtr).toContain('<MathRenderer inline content={opt} />');
  });
});

// ── 5. Truncated-preview canaries (never KaTeX a sliced LaTeX fragment) ──────

describe('truncated previews stay PLAIN text — sliced strings never reach MathRenderer', () => {
  it('QuizResults collapsed row header: the substring(0, 90) line does NOT route through MathRenderer', () => {
    const qr = read('packages/ui/src/quiz/QuizResults.tsx');
    const lines = qr.split('\n');
    const previewLines = lines.filter((l) => l.includes('substring(0, 90)'));
    expect(previewLines.length).toBeGreaterThanOrEqual(1);
    for (const l of previewLines) {
      expect(l, 'collapsed header preview must stay plain text').not.toContain('MathRenderer');
    }
  });

  it('super-admin cms list cell: the slice(0, 80) line stays plain and the page never imports MathRenderer', () => {
    const cms = read('apps/host/src/app/super-admin/cms/page.tsx');
    const previewLines = cms.split('\n').filter((l) => l.includes('.slice(0, 80)'));
    expect(previewLines.length).toBeGreaterThanOrEqual(1);
    for (const l of previewLines) {
      expect(l).not.toContain('MathRenderer');
      // Full text remains reachable on hover.
      expect(l).toContain('title=');
    }
    expect(cms).not.toContain('MathRenderer');
  });

  it('super-admin workbench list cell: the slice(0, 80) line stays plain and the page never imports MathRenderer', () => {
    const wb = read('apps/host/src/app/super-admin/workbench/page.tsx');
    const previewLines = wb.split('\n').filter((l) => l.includes('.slice(0, 80)'));
    expect(previewLines.length).toBeGreaterThanOrEqual(1);
    for (const l of previewLines) {
      expect(l).not.toContain('MathRenderer');
      expect(l).toContain('title=');
    }
    expect(wb).not.toContain('MathRenderer');
  });
});
