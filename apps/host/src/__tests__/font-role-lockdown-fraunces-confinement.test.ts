import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * FONT-ROLE LOCKDOWN — Fraunces BRAND font confined to marketing
 * (Batch 2 · Increment 3 guard).
 *
 * Increment 3 switched every APP display/heading surface off Fraunces
 * (`--font-serif`) and onto Sora (`--font-display`). Fraunces — the premium
 * editorial brand serif — is now allowed ONLY on the marketing skin
 * (`/welcome` + the shared landing package), plus its token definition and
 * font loader. This structural test freezes that boundary so the
 * Sora↔Fraunces drift cannot silently return: if any student- or
 * dashboard-facing surface re-introduces the Fraunces brand token, this test
 * fails.
 *
 * SCOPE OF THE ASSERTION — brand token only, not the Tailwind utility:
 *   We scan for the Fraunces BRAND token specifically:
 *     (1) `--font-serif`      — the CSS custom-property name of the brand serif
 *     (2) `'Fraunces'` / `"Fraunces"` — the quoted font-family literal
 *   We deliberately do NOT flag the Tailwind `.font-serif` utility class. The
 *   Tailwind config has no `serif` fontFamily key, so `.font-serif` resolves to
 *   the generic default serif — NOT the brand token (e.g. FoxyRenderEngine.tsx's
 *   `.font-serif` usage is legitimate and must stay green). The `--` prefix on
 *   the CSS-var pattern is what distinguishes the two.
 *
 * This mirrors the fs-scanning + repo-root-discovery convention of the sibling
 * structural specs (product-surface-matrix.test.ts, the *-structure.test.ts
 * family): the vitest root is `apps/host`, and the shared packages live two
 * levels up under `packages/…`.
 */

// ── repo-root discovery ───────────────────────────────────────────────────────
// Works whether vitest's root is apps/host (the normal `npm test` invocation,
// process.cwd() === .../apps/host) or the monorepo root.
function findRepoRoot(): string {
  const candidates = [
    resolve(process.cwd(), '..', '..'),
    resolve(process.cwd(), '..'),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/ui/src'))) {
      return c;
    }
  }
  throw new Error(
    'font-role-lockdown: could not locate the monorepo root (needs apps/host/src + packages/ui/src)',
  );
}

const REPO_ROOT = findRepoRoot();

// The two surface trees that must stay free of the Fraunces brand token
// (except for the explicit marketing allowlist below).
const SCAN_ROOTS = ['apps/host/src', 'packages/ui/src'] as const;

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss']);
// Directories we never scan. `__tests__` matters most: THIS spec (and any other
// test) legitimately contains the `Fraunces` literal + `--font-serif` while
// describing the guard — scanning tests would make the guard flag itself.
const SKIP_DIRS = new Set([
  'node_modules',
  '__tests__',
  '__mocks__',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.storybook',
]);
const SKIP_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function walk(absDir: string, out: string[]): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(resolve(absDir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE.test(entry.name)) continue;
    const dot = entry.name.lastIndexOf('.');
    const ext = dot >= 0 ? entry.name.slice(dot) : '';
    if (SCAN_EXTS.has(ext)) out.push(resolve(absDir, entry.name));
  }
}

// ── brand-token match patterns (exported semantics documented above) ──────────
const CSS_VAR = /--font-serif\b/;
const BRAND_LITERAL = /['"]Fraunces['"]/;

/** True when a line references the Fraunces BRAND token (var name OR quoted literal). */
export function isBrandHit(line: string): boolean {
  return CSS_VAR.test(line) || BRAND_LITERAL.test(line);
}

// A line that actually CONSUMES the brand token in a real rule — as opposed to
// merely defining it or naming it in prose. `var(--font-serif …)` or a
// `font-family:` declaration that pulls in the brand token/literal. Used to keep
// the globals.css allowance tight: the design-system stylesheet may DEFINE and
// DOCUMENT the token, but must not itself wire an in-app rule to it.
const CONSUMES_BRAND = /var\(\s*--font-serif|font-family\s*:[^;{}]*(?:--font-serif|['"]Fraunces['"])/;

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * The ONLY legitimate homes for the Fraunces brand token. Everything else is a
 * regression. Kept as a pure function so the guard's teeth can be unit-tested
 * against synthetic regressions without touching real source.
 *
 * `rel` is the repo-root-relative, forward-slashed path.
 */
export function isAllowed(rel: string, line: string): boolean {
  // 1. Marketing skin — the host /welcome route. The display serif is the brand.
  if (rel.startsWith('apps/host/src/app/welcome/')) return true;

  // 2. Marketing skin — the shared UI landing package.
  if (rel.startsWith('packages/ui/src/landing/')) return true;

  // 3. Design-system stylesheet: the `--font-serif` token DEFINITION line and
  //    the FONT-ROLE LOCKDOWN documentation comment live here. Allowed UNLESS
  //    the line CONSUMES the brand token in an in-app rule — so re-wiring an
  //    `.editorial-*` heading to `var(--font-serif)` inside globals.css FAILS.
  if (rel === 'packages/ui/src/globals.css') return !CONSUMES_BRAND.test(line);

  // 4. Root layout: momentumFontVars maps the self-hosted font vars onto the
  //    canonical --font-display/--font-body/--font-serif names in a COMMENT.
  //    Only comment lines are allowed — a real `fontFamily: 'Fraunces'` style
  //    anywhere in the root layout tree must fail.
  if (rel === 'apps/host/src/app/layout.tsx') return isCommentLine(line);

  // 5. The next/font loader is the definitional home of the font-var → family
  //    mapping — it legitimately wires `--font-serif` to the Fraunces stack
  //    (with the Devanagari serif fallback). It lives at
  //    packages/lib/src/momentum-fonts.ts and is re-exported into the host app
  //    at apps/host/src/lib/momentum-fonts.ts (the built loader, which the
  //    runtime resolves to the full module). Allowlist the loader itself — it is
  //    NOT a student/dashboard display surface, so brand-token refs here are
  //    correct, not a regression.
  if (
    rel === 'packages/lib/src/momentum-fonts.ts' ||
    rel === 'apps/host/src/lib/momentum-fonts.ts'
  ) {
    return true;
  }

  // 6. KNOWN DEFERRED (documented tech-debt): the 429 rate-limit interstitial
  //    <h1> in proxy.ts still hard-codes 'Fraunces'. Pinned to that EXACT line
  //    so any OTHER Fraunces use in proxy.ts still fails the guard. This makes
  //    the test pass today while documenting the deferred item.
  //    TODO(frontend): re-home the 429 interstitial heading onto --font-display.
  if (rel === 'apps/host/src/proxy.ts') {
    return line.includes("font-family: 'Fraunces', Georgia, serif");
  }

  return false;
}

// ── run the scan once, shared across the assertions ───────────────────────────
interface Hit {
  rel: string;
  line: number;
  text: string;
}

const scannedFiles: string[] = [];
for (const root of SCAN_ROOTS) {
  const abs = resolve(REPO_ROOT, root);
  if (existsSync(abs)) walk(abs, scannedFiles);
}

const hits: Hit[] = [];
for (const abs of scannedFiles) {
  const rel = toPosix(relative(REPO_ROOT, abs));
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isBrandHit(lines[i])) hits.push({ rel, line: i + 1, text: lines[i] });
  }
}

const violations = hits.filter((h) => !isAllowed(h.rel, h.text));

describe('font-role lockdown: Fraunces brand font confined to marketing (Batch 2 · Increment 3)', () => {
  it('scan roots exist and the walk actually visited a meaningful number of source files', () => {
    for (const root of SCAN_ROOTS) {
      expect(existsSync(resolve(REPO_ROOT, root)), `${root} missing`).toBe(true);
    }
    // Non-vacuous: if the walk silently returned nothing (broken glob / wrong
    // root) the whole guard would pass vacuously. Both trees are large.
    expect(scannedFiles.length).toBeGreaterThan(100);
  });

  it('found the known LEGIT marketing occurrences (non-vacuous — proves the scan sees real refs)', () => {
    // /welcome marketing route references the brand serif.
    expect(
      hits.some((h) => h.rel.startsWith('apps/host/src/app/welcome/')),
      'expected at least one Fraunces/--font-serif ref under apps/host/src/app/welcome/',
    ).toBe(true);
    // Shared landing package references it via its --display token.
    expect(
      hits.some((h) => h.rel.startsWith('packages/ui/src/landing/')),
      'expected at least one Fraunces/--font-serif ref under packages/ui/src/landing/',
    ).toBe(true);
    // The design-system stylesheet DEFINES the token.
    expect(
      hits.some(
        (h) =>
          h.rel === 'packages/ui/src/globals.css' &&
          /--font-serif\s*:\s*["']Fraunces["']/.test(h.text),
      ),
      'expected the --font-serif token DEFINITION line in packages/ui/src/globals.css',
    ).toBe(true);
    // The KNOWN DEFERRED proxy.ts 429 interstitial is still present.
    expect(
      hits.some(
        (h) => h.rel === 'apps/host/src/proxy.ts' && h.text.includes("font-family: 'Fraunces'"),
      ),
      'expected the deferred 429-interstitial Fraunces heading in apps/host/src/proxy.ts',
    ).toBe(true);
    // Overall the scan should surface the handful of known legit references.
    expect(hits.length).toBeGreaterThanOrEqual(6);
  });

  it('the Fraunces BRAND token appears ONLY inside the marketing allowlist (regression guard)', () => {
    const report = violations.map((v) => `  ${v.rel}:${v.line}  ${v.text.trim()}`).join('\n');
    expect(
      violations,
      `Fraunces brand font (--font-serif / 'Fraunces') leaked outside the marketing allowlist.\n` +
        `App display/heading surfaces must use Sora (--font-display). Offending lines:\n${report}`,
    ).toEqual([]);
  });
});

describe('font-role lockdown: guard has teeth (pure classifier checks — no source touched)', () => {
  it('FLAGS the Fraunces literal re-added to a student page surface', () => {
    expect(
      isAllowed(
        'apps/host/src/app/(student)/dashboard/StudentOSDashboard.tsx',
        `  <h1 style={{ fontFamily: "'Fraunces', serif" }}>Today</h1>`,
      ),
    ).toBe(false);
  });

  it('FLAGS var(--font-serif) re-added to a dashboard section component', () => {
    expect(
      isAllowed(
        'packages/ui/src/dashboard/sections/AboveFoldHero.tsx',
        '  const heroStyle = { fontFamily: "var(--font-serif)" };',
      ),
    ).toBe(false);
  });

  it('FLAGS a re-wired in-app editorial rule inside globals.css (definition-only allowance)', () => {
    expect(
      isAllowed('packages/ui/src/globals.css', '  .editorial-name { font-family: var(--font-serif); }'),
    ).toBe(false);
  });

  it('FLAGS a non-comment Fraunces style in the root layout', () => {
    expect(
      isAllowed('apps/host/src/app/layout.tsx', `      <body style={{ fontFamily: "'Fraunces'" }}>`),
    ).toBe(false);
  });

  it('ALLOWS the globals.css token DEFINITION line', () => {
    expect(
      isAllowed('packages/ui/src/globals.css', '  --font-serif:    "Fraunces", Georgia, serif;'),
    ).toBe(true);
  });

  it('ALLOWS the globals.css lockdown documentation comment', () => {
    expect(
      isAllowed(
        'packages/ui/src/globals.css',
        '   Sora (--font-display). Fraunces (--font-serif) is confined to the',
      ),
    ).toBe(true);
  });

  it('ALLOWS marketing landing + welcome usage', () => {
    expect(
      isAllowed(
        'packages/ui/src/landing/welcome-v2.module.css',
        "  --display: var(--font-serif, 'Fraunces', Georgia, serif);",
      ),
    ).toBe(true);
    expect(
      isAllowed(
        'apps/host/src/app/welcome/layout.tsx',
        "  // (The display serif now comes from the root layout's --font-serif/Fraunces.)",
      ),
    ).toBe(true);
  });

  it('ALLOWS the deferred proxy.ts 429-interstitial heading but nothing else in proxy.ts', () => {
    expect(
      isAllowed('apps/host/src/proxy.ts', "    font-family: 'Fraunces', Georgia, serif;"),
    ).toBe(true);
    // Any OTHER Fraunces use in proxy.ts is still a regression.
    expect(
      isAllowed('apps/host/src/proxy.ts', `  const f = "'Fraunces'";`),
    ).toBe(false);
  });

  it('ALLOWS the next/font loader (definitional home of the --font-serif → Fraunces mapping)', () => {
    const loaderLine = `  ['--font-serif' as string]: \`var(--font-fraunces), "Fraunces", Georgia, serif\`,`;
    expect(isAllowed('packages/lib/src/momentum-fonts.ts', loaderLine)).toBe(true);
    expect(isAllowed('apps/host/src/lib/momentum-fonts.ts', loaderLine)).toBe(true);
    // A non-loader lib file is NOT covered by the loader allowance.
    expect(isAllowed('apps/host/src/lib/theme.ts', loaderLine)).toBe(false);
  });

  it('does NOT treat the Tailwind .font-serif utility class as the brand token', () => {
    expect(isBrandHit('<div className="font-serif italic">Body</div>')).toBe(false);
    expect(isBrandHit('  @apply font-serif;')).toBe(false);
  });
});
