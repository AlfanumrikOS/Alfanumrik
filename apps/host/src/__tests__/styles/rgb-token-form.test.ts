import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ═══════════════════════════════════════════════════════════════════════════
   RGB TOKEN FORM — static source lint over packages/ui/src/globals.css

   THE DEFECT CLASS THIS PINS
   ──────────────────────────
   A CSS custom property that holds an RGB triple can be written two ways:

       --x-rgb: 232 88 28;      ← SPACE-separated  (modern)
       --x-rgb: 232, 88, 28;    ← COMMA-separated  (legacy)

   Consumers come in two matching flavours, and they are MUTUALLY
   INCOMPATIBLE:

       rgb(var(--x-rgb) / 0.2)    ← modern slash-alpha. REQUIRES SPACE form.
       rgba(var(--x-rgb), 0.2)    ← legacy alpha arg.   REQUIRES COMMA form.

   Mix them and you get `rgb(232, 88, 28 / 0.2)`, which is not valid CSS.
   The failure mode is the dangerous part: CSS does not error, does not warn,
   and does not fall back to the un-alpha'd colour. It drops the ENTIRE
   declaration at computed-value time. No build error. No lint error. No
   console message. The element simply paints nothing.

   This is exactly how the Foxy header background silently vanished and how
   ~142 `rgb(var(--x-rgb) / a)` call sites across 31 files became no-ops. A
   one-character edit (adding commas to a token "for consistency") is enough
   to do it again, which is why this rule is mechanically enforced here
   rather than left to review.

   THE RULE, IN ONE LINE
   ─────────────────────
   Space-separated is the DEFAULT for every `--*-rgb` token. A token may only
   be comma-separated if it has a real `rgba(var(--token), a)` consumer, and
   in that case it must be listed in COMMA_FORM_TOKENS below AND must stay
   comma-separated (test 2 is the converse guard).

   HOW THE ALLOWLIST WAS DERIVED (re-derive it the same way before editing):
       grep -rn "rgba(var(--" packages/ui/src apps/host/src packages/lib/src
   As of 2026-08-24 that returns exactly two consumers, both of --bg-rgb:
       packages/ui/src/globals.css:599   background: rgba(var(--bg-rgb), 0.88);
       packages/ui/src/globals.css:1727  background: rgba(var(--bg-rgb), 0.92);
   Hence the allowlist is --bg-rgb and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Tokens that legitimately carry the COMMA form because they have live
 * `rgba(var(--token), alpha)` consumers.
 *
 * Adding a token here is a deliberate act: it means you have verified a
 * comma-form consumer exists. Removing a token here means you have verified
 * every comma-form consumer is gone. Do neither casually — see the grep above.
 */
const COMMA_FORM_TOKENS = new Set(['--bg-rgb']);

/** Repo root, found by walking up from this test file until globals.css exists. */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let hop = 0; hop < 12; hop += 1) {
    if (fs.existsSync(path.join(dir, 'packages', 'ui', 'src', 'globals.css'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'rgb-token-form.test.ts could not locate the repo root ' +
      '(walked up from the test file looking for packages/ui/src/globals.css).',
  );
}

const REPO_ROOT = findRepoRoot();
const GLOBALS_CSS = path.join(REPO_ROOT, 'packages', 'ui', 'src', 'globals.css');
// The --*-rgb token DECLARATIONS moved to tokens.css in the Gate-2 B1
// consolidation; the two comma-form rgba(var(--bg-rgb), alpha) CONSUMER
// usages this file's error messages reference stayed in globals.css (they
// are usages, not declarations, so the move didn't touch them). Both files
// are scanned for declarations below so the allowlist logic doesn't care
// which one currently holds a given token.
const TOKENS_CSS = path.join(REPO_ROOT, 'packages', 'ui', 'src', 'tokens.css');

/**
 * Blank out CSS block comments, PRESERVING newlines so reported line numbers
 * match the real file.
 *
 * Comments must be excluded because globals.css documents this very rule in
 * prose — it literally spells out the invalid `rgb(232, 88, 28 / 0.20)` string
 * at line ~1842 — so a naive scan of the raw text would flag the warning that
 * exists to prevent the bug. Comments are not CSS; they cannot break a paint.
 */
function maskCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Line number of `index` in `text` (1-based), for actionable failure output. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

interface TokenDecl {
  token: string;   // e.g. '--bg-rgb'
  value: string;   // e.g. '251, 248, 244'
  line: number;    // line number in the ORIGINAL (uncommented) file
}

/** A bare RGB triple: three 0-255-ish integers, comma- or space-separated. */
const BARE_TRIPLE = /^\d{1,3}\s*(?:,\s*|\s+)\d{1,3}\s*(?:,\s*|\s+)\d{1,3}$/;

function collectDeclarationsFrom(cssPath: string): TokenDecl[] {
  const masked = maskCssComments(fs.readFileSync(cssPath, 'utf8'));

  const decls: TokenDecl[] = [];
  const re = /(--[A-Za-z0-9_-]*-rgb)\s*:\s*([^;{}]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    decls.push({ token: m[1], value: m[2].trim(), line: lineOf(masked, m.index) });
  }
  return decls;
}

function collectRgbTokenDeclarations(): TokenDecl[] {
  return [...collectDeclarationsFrom(GLOBALS_CSS), ...collectDeclarationsFrom(TOKENS_CSS)];
}

describe('globals.css — --*-rgb token separator form', () => {
  it('finds the --*-rgb token declarations (harness sanity check)', () => {
    const decls = collectRgbTokenDeclarations();
    // If this ever drops to zero the two real tests below would vacuously
    // pass, which is the one way a source-lint test can lie.
    expect(decls.length).toBeGreaterThan(5);
    expect(decls.map((d) => d.token)).toContain('--bg-rgb');
    expect(decls.map((d) => d.token)).toContain('--accent-warm-rgb');
  });

  it('every --*-rgb token NOT on the comma allowlist is SPACE-separated', () => {
    const decls = collectRgbTokenDeclarations();
    const offenders = decls.filter(
      (d) =>
        BARE_TRIPLE.test(d.value) &&
        !COMMA_FORM_TOKENS.has(d.token) &&
        d.value.includes(','),
    );

    const message = offenders
      .map(
        (d) =>
          `  globals.css:${d.line}  ${d.token}: ${d.value};\n` +
          `      → must be SPACE-separated: ${d.token}: ${d.value.replace(/\s*,\s*/g, ' ')};`,
      )
      .join('\n');

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `\n${offenders.length} --*-rgb token(s) use the COMMA form but are not on the ` +
            `comma allowlist (${[...COMMA_FORM_TOKENS].join(', ')}):\n\n${message}\n\n` +
            'WHY THIS MATTERS: these tokens are consumed as `rgb(var(--x-rgb) / <alpha>)`.\n' +
            'The comma form substitutes to `rgb(232, 88, 28 / 0.2)`, which is invalid CSS.\n' +
            'The browser then drops the WHOLE declaration silently — no error, no warning,\n' +
            'no fallback — and the element paints nothing. This is the Foxy-header defect\n' +
            '(~142 call sites across 31 files went no-op from one comma edit).\n\n' +
            'FIX: use spaces (`232 88 28`). Only add a token to COMMA_FORM_TOKENS if you\n' +
            'have verified it has a real `rgba(var(--token), alpha)` consumer:\n' +
            '  grep -rn "rgba(var(--" packages/ui/src apps/host/src packages/lib/src\n',
    ).toEqual([]);
  });

  it('every allowlisted token STAYS comma-separated (converse guard)', () => {
    const decls = collectRgbTokenDeclarations();

    for (const token of COMMA_FORM_TOKENS) {
      const declsForToken = decls.filter(
        (d) => d.token === token && BARE_TRIPLE.test(d.value),
      );

      // The token must actually exist, or the allowlist is stale.
      expect(
        declsForToken.length,
        `${token} is on COMMA_FORM_TOKENS but has no bare-triple declaration in ` +
          'globals.css. Either the token was renamed/removed (drop it from the ' +
          'allowlist) or the value stopped being a literal RGB triple.',
      ).toBeGreaterThan(0);

      const spaceFormed = declsForToken.filter((d) => !d.value.includes(','));
      const message = spaceFormed
        .map(
          (d) =>
            `  globals.css:${d.line}  ${d.token}: ${d.value};\n` +
            `      → must stay COMMA-separated: ${d.token}: ${d.value.trim().split(/\s+/).join(', ')};`,
        )
        .join('\n');

      expect(
        spaceFormed,
        spaceFormed.length === 0
          ? ''
          : `\n${token} was converted to the SPACE form:\n\n${message}\n\n` +
              'WHY THIS MATTERS: this token has LEGACY consumers that pass alpha as a\n' +
              'separate argument — `rgba(var(--bg-rgb), 0.88)` at globals.css:599 and\n' +
              '`rgba(var(--bg-rgb), 0.92)` at globals.css:1727 (the app-shell sticky\n' +
              'header and its sibling glass surface). With the space form those become\n' +
              '`rgba(251 248 244, 0.88)`, which is invalid CSS, so the declaration is\n' +
              'dropped silently and the sticky header loses its background entirely.\n' +
              'This is the SAME failure mode as the space/comma rule above, in the\n' +
              'opposite direction — "tidying" this token to match the others breaks it.\n\n' +
              'FIX: keep the commas, OR migrate BOTH consumers to\n' +
              '`rgb(var(--bg-rgb) / <alpha>)` in the same change and then remove the\n' +
              'token from COMMA_FORM_TOKENS.\n',
      ).toEqual([]);
    }
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   Direct catch: the invalid mixed syntax, written out literally in source.
   Cheap, exact, and independent of any token bookkeeping above.
   ─────────────────────────────────────────────────────────────────────────── */

const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'packages', 'ui', 'src'),
  path.join(REPO_ROOT, 'apps', 'host', 'src'),
];
const SCAN_EXTENSIONS = new Set(['.css', '.ts', '.tsx']);
// `__tests__` is excluded because THIS FILE quotes the invalid pattern in its
// own documentation and regexes; scanning it would make the test flag itself.
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next', 'dist', 'build']);

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSourceFiles(path.join(dir, entry.name), out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Comment-masked contents of every scannable source file that mentions `rgb`,
 * read ONCE and shared by the scans below (the tree is ~2.7k files; reading it
 * per-assertion costs a second each).
 */
let scanCache: Array<{ file: string; text: string }> | null = null;
function scannableSources(): Array<{ file: string; text: string }> {
  if (scanCache) return scanCache;
  const out: Array<{ file: string; text: string }> = [];
  for (const root of SCAN_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkSourceFiles(root)) {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.includes('rgb')) continue;
      out.push({ file, text: maskCssComments(raw) });
    }
  }
  scanCache = out;
  return out;
}

/** Run `re` over every scannable source, formatting `file:line → match`. */
function scanSources(re: RegExp, extra: (m: RegExpExecArray) => string = () => ''): string[] {
  const offenders: string[] = [];
  for (const { file, text } of scannableSources()) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      offenders.push(
        `${path.relative(REPO_ROOT, file).split(path.sep).join('/')}:` +
          `${lineOf(text, m.index)}  →  ${m[0].trim()}…${extra(m)}`,
      );
    }
  }
  return offenders;
}

describe('source files — no mixed comma/slash rgb() syntax', () => {
  it('no source file writes a literal `rgb(r, g, b / alpha)`', () => {
    // Matches the invalid hybrid ONLY: comma-separated channels followed by a
    // slash-alpha. `rgb(1, 2, 3)` and `rgb(1 2 3 / .4)` are both valid and are
    // deliberately NOT matched.
    const MIXED = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\//g;

    const offenders = scanSources(MIXED);

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `\nMixed comma/slash rgb() syntax found:\n\n${offenders.join('\n')}\n\n` +
            'Channels are comma-separated but alpha is given with the modern `/`\n' +
            'separator. `rgb(232, 88, 28 / 0.2)` is invalid CSS — the whole declaration\n' +
            'is dropped silently at computed-value time and the element paints nothing.\n\n' +
            'FIX: pick ONE form.\n' +
            '  modern: rgb(232 88 28 / 0.2)\n' +
            '  legacy: rgba(232, 88, 28, 0.2)\n',
    ).toEqual([]);
  });

  it('no `rgb(var(--x-rgb, <comma fallback>) / alpha)` — the fallback must be space-form', () => {
    /*
     * SAME defect class, one level of indirection deeper — and the reason this
     * check exists separately from the literal scan above.
     *
     * `var(--x, FALLBACK)` substitutes FALLBACK verbatim whenever --x is not
     * defined in the current scope. So:
     *
     *     rgb(var(--accent-warm-rgb, 232, 88, 28) / 0.22)
     *
     * resolves to `rgb(232, 88, 28 / 0.22)` — the exact invalid hybrid — in any
     * scope where the token is missing. The literal scan above CANNOT see this,
     * because the offending string only exists after substitution.
     *
     * It is dormant while the token happens to be defined in :root, which is
     * precisely what makes it dangerous: the fallback is dead code that looks
     * like a safety net and is actually a landmine. The repo's own correct
     * precedent is `rgb(var(--green-rgb, 22 163 74) / …)` — space-form fallback.
     *
     * FIX: drop the commas from the fallback.
     */
    const BAD_FALLBACK =
      /rgba?\(\s*var\(\s*(--[A-Za-z0-9_-]*-rgb)\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)\s*\//g;

    const offenders = scanSources(BAD_FALLBACK, (m) => `  (token ${m[1]})`);

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `\nComma-separated var() fallback inside a slash-alpha rgb():\n\n` +
            `${offenders.join('\n')}\n\n` +
            'When the token is undefined in a scope, the fallback substitutes literally\n' +
            'and produces `rgb(232, 88, 28 / 0.22)` — invalid CSS, whole declaration\n' +
            'dropped silently. Same failure mode as the Foxy header.\n\n' +
            'FIX: space-separate the fallback, matching the repo precedent\n' +
            '`rgb(var(--green-rgb, 22 163 74) / …)`:\n' +
            '  rgb(var(--accent-warm-rgb, 232 88 28) / 0.22)\n',
    ).toEqual([]);
  });
});
