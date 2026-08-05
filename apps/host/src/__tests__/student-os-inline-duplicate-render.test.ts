import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * STUDENT-OS DASHBOARD — inline duplicate-render guard (AppShell rail/aside
 * breakpoint parity).
 *
 * WHY THIS EXISTS
 * ---------------
 * `StudentOSDashboard` renders `MasterySnapshot` and `RevisionRail` TWICE in the
 * markup, on purpose:
 *
 *   - once inside `AppShell`'s `rail` / `aside` slots (the tablet+/desktop home),
 *   - once inline in the content column (the mobile home),
 *
 * ...and relies on CSS to show exactly ONE of each at any viewport. The rail and
 * aside are revealed by MEDIA QUERIES in `packages/ui/src/globals.css`; the
 * inline copies are hidden by TAILWIND `{bp}:hidden` utilities in the TSX. Those
 * two mechanisms live in different files, in different languages, with no
 * compiler or type relating them.
 *
 * When they disagree, NOTHING fails. There is no error, no console warning, no
 * type error, no failing render test — the student just silently sees the same
 * panel twice in a viewport band. That is exactly what shipped: the inline
 * copies hid at `lg:hidden` (1024) and `xl:hidden` (1280) while the rail/aside
 * revealed at 768 and 1024, so `MasterySnapshot` rendered twice across
 * 768-1023px and `RevisionRail` twice across 1024-1279px.
 *
 * A render test cannot catch this: JSDOM applies no CSS and evaluates no media
 * query, so both copies are always in the tree and both hide-classes look
 * equally "present". The only thing that distinguishes correct from broken is
 * whether the Tailwind breakpoint NUMBER equals the media-query breakpoint
 * NUMBER — a cross-file contract. Hence a static-source test, following the
 * fs-scanning convention of `font-role-lockdown-fraunces-confinement.test.ts`
 * and the `*-structure.test.ts` family.
 *
 * WHAT IS PINNED (the invariant, not the current string)
 * -----------------------------------------------------
 *   1. The hide-breakpoint of each inline copy, resolved to PIXELS through the
 *      Tailwind screens scale, EQUALS the `min-width` of the media query that
 *      reveals its rail/aside counterpart, PARSED OUT OF globals.css.
 *      Move the media query to 820px and this fails until the TSX follows.
 *   2. `apps/host/tailwind.config.js` does not override `theme.screens`, which
 *      is what makes the md=768 / lg=1024 mapping in (1) legitimate. If someone
 *      customises the scale, (1)'s px mapping would go stale silently — so the
 *      absence of the override is itself asserted.
 *   3. `student-os-snapshot-inline` / `student-os-revision-inline` have NO CSS
 *      rule anywhere in the repo. They are markup hooks (grep handles / e2e
 *      selectors) only, which is what makes "the Tailwind class is the sole
 *      visibility control" true. If someone later adds
 *      `.student-os-snapshot-inline { display: block }`, assertion (1) stops
 *      being sufficient — so the Tailwind-only assumption is pinned too.
 *
 * IF THIS TEST FAILS: do not just edit the expected number. Work out which side
 * moved (globals.css shell breakpoints, or the dashboard's hide classes) and
 * make BOTH agree, or you are re-shipping the duplicate render.
 */

// ── repo-root discovery ───────────────────────────────────────────────────────
// Mirrors font-role-lockdown-fraunces-confinement.test.ts: vitest's root is
// apps/host (process.cwd()), and the shared packages live two levels up.
function findRepoRoot(): string {
  const candidates = [resolve(process.cwd(), '..', '..'), resolve(process.cwd(), '..'), process.cwd()];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/ui/src'))) return c;
  }
  throw new Error(
    'student-os-inline-duplicate-render: could not locate the monorepo root (needs apps/host/src + packages/ui/src)',
  );
}

const REPO_ROOT = findRepoRoot();
const DASHBOARD_REL = 'apps/host/src/app/(student)/dashboard/StudentOSDashboard.tsx';
const GLOBALS_REL = 'packages/ui/src/globals.css';
const TAILWIND_REL = 'apps/host/tailwind.config.js';

const dashboardSrc = readFileSync(resolve(REPO_ROOT, DASHBOARD_REL), 'utf8');
const globalsSrc = readFileSync(resolve(REPO_ROOT, GLOBALS_REL), 'utf8');
const tailwindSrc = readFileSync(resolve(REPO_ROOT, TAILWIND_REL), 'utf8');

/**
 * Tailwind's DEFAULT screens scale. Legitimate ONLY while the project does not
 * override `theme.screens` — asserted below rather than assumed.
 * https://tailwindcss.com/docs/screens
 */
const TAILWIND_SCREENS_PX: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

// ── minimal brace-aware CSS reader ────────────────────────────────────────────
// We need the ENCLOSING at-rule of a declaration block, which a flat regex over
// the stylesheet cannot give (globals.css is 4k+ lines with many nested media
// blocks). This walks the source tracking an at-rule stack. Comments are
// stripped first so a `{`/`}` inside prose cannot desync the stack.
interface CssRule {
  /** Selector text of the declaration block. */
  prelude: string;
  /** Raw declarations inside the block. */
  body: string;
  /** Enclosing at-rule preludes, outermost first (e.g. '@media (min-width: 768px)'). */
  ancestors: string[];
}

export function parseCssRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: CssRule[] = [];
  const stack: string[] = [];
  let buf = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) {
        // Nesting at-rule (@media / @supports / @container). Push and descend.
        stack.push(prelude);
        i++;
        continue;
      }
      let depth = 1;
      let body = '';
      i++;
      while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
        body += src[i];
        i++;
      }
      out.push({ prelude, body, ancestors: [...stack] });
      i++;
      continue;
    }
    if (c === '}') {
      stack.pop();
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return out;
}

const globalsRules = parseCssRules(globalsSrc);

/**
 * The `min-width` (px) at which `.app-shell-v2 > .<slot>` is switched to
 * `display: block` — i.e. the viewport at which AppShell starts rendering that
 * slot. Throws rather than returning a default: a silent fallback would make
 * this whole guard vacuous if the stylesheet were restructured.
 */
export function shellSlotRevealPx(rules: CssRule[], slotClass: string): number {
  const selectorRe = new RegExp(`\\.app-shell-v2\\s*>\\s*\\.${slotClass}\\b`);
  const matches = rules.filter(
    (r) => selectorRe.test(r.prelude) && /display\s*:\s*block/.test(r.body),
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly ONE '.app-shell-v2 > .${slotClass} { display: block }' rule in ${GLOBALS_REL}, found ${matches.length}`,
    );
  }
  const media = matches[0].ancestors.filter((a) => a.startsWith('@media'));
  const withMinWidth = media
    .map((a) => /min-width\s*:\s*(\d+)px/.exec(a))
    .filter((m): m is RegExpExecArray => m !== null);
  if (withMinWidth.length !== 1) {
    throw new Error(
      `expected '.app-shell-v2 > .${slotClass} { display: block }' to sit inside exactly one '@media (min-width: Npx)' block; ancestors were ${JSON.stringify(matches[0].ancestors)}`,
    );
  }
  return Number(withMinWidth[0][1]);
}

/**
 * Source with `/* *\/` blocks (incl. `{/* JSX comments *\/}`) and `//` lines
 * removed. Needed because this file's own header comment and the fix's
 * explanatory JSX comments BOTH mention `<MasterySnapshot>` in prose — counting
 * raw occurrences would conflate documentation with actual render sites.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The `className` string of the `<div>` carrying `hookClass` in the dashboard.
 * Deliberately matches the ATTRIBUTE, not a whole-file grep, so a stray mention
 * of the class inside a comment cannot satisfy the assertion.
 */
export function classNameForHook(tsx: string, hookClass: string): string {
  const re = new RegExp(`className\\s*=\\s*"([^"]*\\b${hookClass}\\b[^"]*)"`);
  const m = re.exec(tsx);
  if (!m) {
    throw new Error(`no className attribute containing '${hookClass}' found in ${DASHBOARD_REL}`);
  }
  return m[1];
}

/**
 * The single Tailwind responsive hide utility (`{bp}:hidden`) in a className.
 * Requires exactly one: `md:hidden lg:hidden` would be ambiguous, and a bare
 * `hidden` (unconditional) is not a breakpoint at all.
 */
export function hideBreakpointPx(className: string): number {
  const tokens = className.split(/\s+/).filter(Boolean);
  const hides = tokens.filter((t) => /^[a-z0-9]+:hidden$/.test(t));
  if (hides.length !== 1) {
    throw new Error(
      `expected exactly one '{bp}:hidden' utility, found ${hides.length} in className "${className}"`,
    );
  }
  const bp = hides[0].split(':')[0];
  const px = TAILWIND_SCREENS_PX[bp];
  if (px === undefined) {
    throw new Error(`'${hides[0]}' uses breakpoint '${bp}', which is not in the Tailwind screens scale`);
  }
  return px;
}

// ── repo-wide CSS sweep for the markup hooks ──────────────────────────────────
const CSS_SCAN_ROOTS = ['apps/host/src', 'packages/ui/src', 'packages/lib/src'] as const;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo']);

function walkCss(absDir: string, out: string[]): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkCss(resolve(absDir, entry.name), out);
      continue;
    }
    if (entry.isFile() && /\.(css|scss)$/.test(entry.name)) out.push(resolve(absDir, entry.name));
  }
}

const cssFiles: string[] = [];
for (const root of CSS_SCAN_ROOTS) {
  const abs = resolve(REPO_ROOT, root);
  if (existsSync(abs)) walkCss(abs, cssFiles);
}

const MARKUP_HOOKS = ['student-os-snapshot-inline', 'student-os-revision-inline'] as const;

function cssRulesTargetingHook(hook: string): string[] {
  const found: string[] = [];
  for (const abs of cssFiles) {
    const rel = relative(REPO_ROOT, abs).split(sep).join('/');
    for (const rule of parseCssRules(readFileSync(abs, 'utf8'))) {
      if (rule.prelude.includes(`.${hook}`)) found.push(`${rel}  ${rule.prelude}`);
    }
  }
  return found;
}

// ── resolved values, computed once ────────────────────────────────────────────
const railRevealPx = shellSlotRevealPx(globalsRules, 'app-shell-rail');
const asideRevealPx = shellSlotRevealPx(globalsRules, 'app-shell-aside');

describe('StudentOS dashboard — inline copies hide exactly where AppShell reveals the rail/aside', () => {
  it('parses a non-trivial stylesheet (non-vacuous: the reader actually saw globals.css)', () => {
    // If the brace walker silently returned nothing, every assertion below would
    // pass or throw for the wrong reason. globals.css is a 4k+ line design system.
    expect(globalsRules.length).toBeGreaterThan(200);
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('reads the shell reveal breakpoints out of globals.css (rail 768, aside 1024)', () => {
    // These are the CURRENT values. They are asserted so that a deliberate shell
    // re-design shows up here as an explicit, reviewed change rather than
    // silently re-pointing the parity assertions below at a new number.
    expect(railRevealPx).toBe(768);
    expect(asideRevealPx).toBe(1024);
  });

  it('does not override theme.screens, so the md=768 / lg=1024 px mapping is valid', () => {
    // The parity assertions translate `md:`/`lg:` to px via Tailwind's DEFAULT
    // scale. A custom `screens` block would invalidate that translation without
    // failing anything else.
    expect(
      /\bscreens\s*:/.test(tailwindSrc),
      'apps/host/tailwind.config.js now defines theme.screens — update TAILWIND_SCREENS_PX in this test to match',
    ).toBe(false);
  });

  it('hides the inline MasterySnapshot at exactly the rail reveal breakpoint (no 768-1023px double render)', () => {
    const cls = classNameForHook(dashboardSrc, 'student-os-snapshot-inline');
    expect(
      hideBreakpointPx(cls),
      `inline MasterySnapshot hides at ${hideBreakpointPx(cls)}px but AppShell's rail (which also renders ` +
        `MasterySnapshot) appears at ${railRevealPx}px — MasterySnapshot renders TWICE in the gap. ` +
        `className was "${cls}".`,
    ).toBe(railRevealPx);
  });

  it('hides the inline RevisionRail at exactly the aside reveal breakpoint (no 1024-1279px double render)', () => {
    const cls = classNameForHook(dashboardSrc, 'student-os-revision-inline');
    expect(
      hideBreakpointPx(cls),
      `inline RevisionRail hides at ${hideBreakpointPx(cls)}px but AppShell's aside (which also renders ` +
        `RevisionRail) appears at ${asideRevealPx}px — RevisionRail renders TWICE in the gap. ` +
        `className was "${cls}".`,
    ).toBe(asideRevealPx);
  });

  it('renders each panel in BOTH the shell slot and the content column (the premise of this guard)', () => {
    // If a future refactor drops one of the two copies, the parity assertions
    // above become meaningless (nothing to duplicate). Pin the premise.
    const code = stripComments(dashboardSrc);
    expect(code).toMatch(/rail=\{/);
    expect(code).toMatch(/aside=\{/);
    expect((code.match(/<MasterySnapshot\b/g) ?? []).length).toBe(2);
    expect((code.match(/<RevisionRail\b/g) ?? []).length).toBe(2);
  });

  it('stripComments removes prose mentions but keeps real render sites', () => {
    const sample = `
      /** Doc: <MasterySnapshot> shows buckets. */
      {/* hidden at md because <MasterySnapshot> also lives in the rail */}
      <MasterySnapshot isHi={isHi} />
    `;
    expect((stripComments(sample).match(/<MasterySnapshot\b/g) ?? []).length).toBe(1);
  });

  it.each(MARKUP_HOOKS)(
    '`%s` has NO CSS rule anywhere — it is a markup hook, so the Tailwind class is the sole visibility control',
    (hook) => {
      const rules = cssRulesTargetingHook(hook);
      expect(
        rules,
        `.${hook} now has CSS rule(s):\n${rules.map((r) => `  ${r}`).join('\n')}\n` +
          `This breaks the assumption that the '{bp}:hidden' Tailwind utility alone controls visibility. ` +
          `Either drop the CSS rule, or fold the breakpoint into CSS and rewrite this guard to compare THAT.`,
      ).toEqual([]);
    },
  );
});

describe('StudentOS inline duplicate-render guard — has teeth (pure helpers, no source touched)', () => {
  it('FLAGS the exact regression that shipped (snapshot hidden at lg while rail reveals at md)', () => {
    expect(hideBreakpointPx('student-os-snapshot-inline lg:hidden')).toBe(1024);
    // 1024 !== the real 768 rail reveal → the parity assertion would fail.
    expect(hideBreakpointPx('student-os-snapshot-inline lg:hidden')).not.toBe(railRevealPx);
  });

  it('FLAGS the exact regression that shipped (revision hidden at xl while aside reveals at lg)', () => {
    expect(hideBreakpointPx('student-os-revision-inline xl:hidden')).toBe(1280);
    expect(hideBreakpointPx('student-os-revision-inline xl:hidden')).not.toBe(asideRevealPx);
  });

  it('ACCEPTS the fixed classNames', () => {
    expect(hideBreakpointPx('student-os-snapshot-inline md:hidden')).toBe(railRevealPx);
    expect(hideBreakpointPx('student-os-revision-inline lg:hidden')).toBe(asideRevealPx);
  });

  it('REFUSES an ambiguous or missing hide utility rather than guessing', () => {
    expect(() => hideBreakpointPx('student-os-snapshot-inline')).toThrow(/exactly one/);
    expect(() => hideBreakpointPx('md:hidden lg:hidden')).toThrow(/exactly one/);
    // A bare `hidden` is unconditional, not a breakpoint — must not be accepted.
    expect(() => hideBreakpointPx('student-os-snapshot-inline hidden')).toThrow(/exactly one/);
  });

  it('REFUSES an unknown breakpoint token rather than silently passing', () => {
    expect(() => hideBreakpointPx('student-os-snapshot-inline tablet:hidden')).toThrow(
      /not in the Tailwind screens scale/,
    );
  });

  it('the CSS reader attributes a rule to its enclosing @media block', () => {
    const rules = parseCssRules(
      '.a { color: red; } @media (min-width: 900px) { .app-shell-v2 > .app-shell-rail { display: block; } }',
    );
    expect(shellSlotRevealPx(rules, 'app-shell-rail')).toBe(900);
  });

  it('the CSS reader REFUSES a rule with no enclosing media query (would silently mean "always shown")', () => {
    const rules = parseCssRules('.app-shell-v2 > .app-shell-rail { display: block; }');
    expect(() => shellSlotRevealPx(rules, 'app-shell-rail')).toThrow(/exactly one '@media/);
  });

  it('the CSS reader ignores braces inside comments (stack cannot desync)', () => {
    const rules = parseCssRules(
      '/* a stray { brace } in prose */ @media (min-width: 800px) { .app-shell-v2 > .app-shell-aside { display: block; } }',
    );
    expect(shellSlotRevealPx(rules, 'app-shell-aside')).toBe(800);
  });

  it('classNameForHook reads the ATTRIBUTE, not a comment mention of the class', () => {
    const tsx = `
      {/* Note: student-os-snapshot-inline has no CSS rule anywhere. */}
      <div className="student-os-snapshot-inline md:hidden">
    `;
    expect(classNameForHook(tsx, 'student-os-snapshot-inline')).toBe(
      'student-os-snapshot-inline md:hidden',
    );
    expect(() => classNameForHook('{/* student-os-revision-inline */}', 'student-os-revision-inline')).toThrow(
      /no className attribute/,
    );
  });
});
