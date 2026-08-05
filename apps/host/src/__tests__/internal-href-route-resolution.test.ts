import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * INTERNAL LINK CANARY — every hard-coded internal `href` must resolve to a real
 * App Router page or a configured redirect.
 *
 * WHY THIS EXISTS
 * ---------------
 * `BoardScoreWidget` shipped a prominent AnswerChecker™ CTA linking to
 * `/answer-checker`. No `page.tsx` and no `next.config.js` redirect for that
 * path has ever existed, so the link 404'd — for every student whose recovery
 * plan carried any recoverable marks, i.e. exactly the engaged users it targeted.
 *
 * Nothing caught it. A plain string `href` is not type-checked against the route
 * tree, the CTA rendered only behind a data condition (`ctaGain > 0`) that no
 * test fixture produced, and a 404 is a runtime event on the USER's machine —
 * invisible to the build, to lint, and to every render test. This is a
 * silent-failure class: it will recur the next time someone writes a link ahead
 * of the page.
 *
 * WHAT THIS CANARY DOES
 * ---------------------
 * Enumerates the App Router page tree (route groups `(x)` stripped, dynamic
 * segments `[id]` / `[...slug]` turned into matchers), collects every literal
 * internal `href="/..."` / `to="/..."` in `apps/host/src` + `packages/ui/src`,
 * and asserts each one resolves to a page, a redirect `source`, or an allowlisted
 * known-dead entry.
 *
 * The BROAD form was chosen over a narrow `/answer-checker` grep because it is
 * cheap and reliable here: ~200 routes and ~50 distinct literal hrefs, all
 * resolved with fs reads and no network, in well under a second. It generalises
 * the fix instead of pinning one string.
 *
 * DELIBERATE LIMITS (a canary that cries wolf gets deleted):
 *   - Only LITERAL hrefs. Template literals and computed hrefs
 *     (`href={\`/learn/${code}\`}`) are skipped — resolving them needs data flow
 *     analysis, and guessing would produce false positives.
 *   - `router.push(...)` / `redirect(...)` call sites are NOT scanned. Same
 *     reason; most take computed paths. A follow-up could add the literal subset.
 *   - `/api/*` is skipped: those are route handlers (`route.ts`), not pages, and
 *     are covered by the API route-manifest specs.
 *   - External URLs, `#anchors`, `mailto:`, `tel:` are not internal links.
 *   So: PASSING does not prove every link works. FAILING always means a real
 *   dead literal link.
 *
 * IF THIS TEST FAILS: build the page, add a redirect in
 * `apps/host/next.config.js`, or fix the href. Adding to KNOWN_DEAD_LINKS is a
 * documented exception that needs a reason and a TODO — it is not the default.
 */

function findRepoRoot(): string {
  const candidates = [resolve(process.cwd(), '..', '..'), resolve(process.cwd(), '..'), process.cwd()];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/ui/src'))) return c;
  }
  throw new Error('internal-href-route-resolution: could not locate the monorepo root');
}

const REPO_ROOT = findRepoRoot();
const APP_DIR = resolve(REPO_ROOT, 'apps/host/src/app');
const NEXT_CONFIG = resolve(REPO_ROOT, 'apps/host/next.config.js');

const SCAN_ROOTS = ['apps/host/src', 'packages/ui/src'] as const;
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

// ── 1. enumerate the App Router page tree ─────────────────────────────────────
/**
 * Route paths served by a `page.tsx`. Route groups `(student)` contribute no URL
 * segment; private folders `_components` are not routable.
 */
export function enumerateRoutes(appDir: string): string[] {
  const routes: string[] = [];
  const walk = (dir: string, urlPath: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('_')) continue;
        const isRouteGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        walk(resolve(dir, entry.name), isRouteGroup ? urlPath : `${urlPath}/${entry.name}`);
        continue;
      }
      if (entry.isFile() && /^page\.[cm]?[jt]sx?$/.test(entry.name)) {
        routes.push(urlPath === '' ? '/' : urlPath);
      }
    }
  };
  walk(appDir, '');
  return [...new Set(routes)];
}

/**
 * A concrete URL path matches a route pattern, honouring dynamic segments.
 *
 * Dynamic placeholders are tokenized FIRST and the literal text between them is
 * regex-escaped separately. Escaping the whole pattern up front would rewrite
 * `[...slug]` into `[\.\.\.slug]` and the placeholder patterns would then miss —
 * silently degrading every catch-all route to "matches nothing".
 */
export function routeMatches(routePattern: string, urlPath: string): boolean {
  if (routePattern === urlPath) return true;
  if (!routePattern.includes('[')) return false;

  const PLACEHOLDER = /\[\[\.\.\.[^\]]+\]\]|\[\.\.\.[^\]]+\]|\[[^\]]+\]/g;
  const escapeLiteral = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let source = '';
  let lastIndex = 0;
  for (const m of routePattern.matchAll(PLACEHOLDER)) {
    source += escapeLiteral(routePattern.slice(lastIndex, m.index));
    if (m[0].startsWith('[[...')) {
      // Optional catch-all: `/docs/[[...path]]` serves `/docs` AS WELL AS
      // `/docs/a/b`, so the SEPARATOR in front of it is optional too. Pull the
      // preceding '/' inside the optional group rather than requiring it.
      if (source.endsWith('/')) source = source.slice(0, -1);
      source += '(?:/.*)?';
    } else if (m[0].startsWith('[...')) {
      source += '(?:.+)'; // catch-all — needs at least one segment
    } else {
      source += '(?:[^/]+)'; // single dynamic segment
    }
    lastIndex = m.index + m[0].length;
  }
  source += escapeLiteral(routePattern.slice(lastIndex));

  return new RegExp(`^${source}$`).test(urlPath);
}

// ── 2. redirect sources from next.config.js ───────────────────────────────────
/**
 * `source` values inside the `redirects()` block. Parsed textually — importing
 * next.config.js pulls in the Sentry wrapper and env validation, which is far
 * more fragile than a scoped regex over the one function body.
 */
export function redirectSources(nextConfigSrc: string): string[] {
  const start = nextConfigSrc.indexOf('async redirects()');
  if (start === -1) return [];
  // Bound the scan at the next `async <name>()` sibling so `rewrites()`/`headers()`
  // sources are not mistaken for redirects.
  const rest = nextConfigSrc.slice(start + 'async redirects()'.length);
  const nextFn = /\n\s{0,4}async\s+\w+\s*\(/.exec(rest);
  const body = nextFn ? rest.slice(0, nextFn.index) : rest;
  return [...body.matchAll(/source\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

// ── 3. collect literal internal hrefs ─────────────────────────────────────────
interface HrefHit {
  path: string;
  rel: string;
  line: number;
}

/** `href="/x"`, `href={'/x'}`, `to="/x"` — literals only, no template interpolation. */
const HREF_LITERAL = /\b(?:href|to)\s*=\s*\{?\s*['"`](\/[^'"`]*)['"`]/g;

function normalizeUrlPath(raw: string): string {
  const withoutQuery = raw.split('?')[0].split('#')[0];
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function walkSource(absDir: string, out: string[]): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSource(resolve(absDir, entry.name), out);
      continue;
    }
    if (!entry.isFile() || SKIP_FILE.test(entry.name)) continue;
    if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(resolve(absDir, entry.name));
  }
}

const sourceFiles: string[] = [];
for (const root of SCAN_ROOTS) {
  const abs = resolve(REPO_ROOT, root);
  if (existsSync(abs)) walkSource(abs, sourceFiles);
}

const hrefHits: HrefHit[] = [];
for (const abs of sourceFiles) {
  const rel = toPosix(relative(REPO_ROOT, abs));
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(HREF_LITERAL)) {
      // `${` anywhere means the literal was really a template — skip it.
      if (m[1].includes('${')) continue;
      hrefHits.push({ path: normalizeUrlPath(m[1]), rel, line: i + 1 });
    }
  }
}

const ROUTES = enumerateRoutes(APP_DIR);
const REDIRECTS = redirectSources(readFileSync(NEXT_CONFIG, 'utf8'));

/**
 * Literal internal links with no page and no redirect, reviewed and accepted as
 * PRE-EXISTING defects so this canary can go green on the links it was written
 * for. Every entry is a real user-visible 404 that predates this test and is
 * OUTSIDE the four fixes it pins. Do not add to this list to silence a new link.
 *
 * TODO(frontend): resolve both and delete the entries.
 *   - `/super-admin/students` — `apps/host/src/app/super-admin/students/` exists
 *     but contains ONLY `[id]/page.tsx`; there is no index page, so the "back to
 *     students" link in the Foxy report 404s.
 *     Linked from apps/host/src/app/super-admin/foxy-report/[studentId]/page.tsx
 *   - `/upgrade` — no page and no redirect. `/pricing` and `/billing` both exist
 *     and are plausible intended targets; picking one is a product decision.
 *     Linked from apps/host/src/app/(student)/exams/mock/MockTestCatalog.tsx
 */
const KNOWN_DEAD_LINKS = new Set<string>(['/super-admin/students', '/upgrade']);

export function isResolvable(urlPath: string, routes: string[], redirects: string[]): boolean {
  if (redirects.some((r) => routeMatches(r, urlPath))) return true;
  return routes.some((r) => routeMatches(r, urlPath));
}

const internalHrefs = hrefHits.filter((h) => !h.path.startsWith('/api/'));
const unresolved = internalHrefs.filter(
  (h) => !isResolvable(h.path, ROUTES, REDIRECTS) && !KNOWN_DEAD_LINKS.has(h.path),
);

describe('internal link canary — scan is non-vacuous', () => {
  it('enumerated a realistic App Router page tree', () => {
    // If the walker broke, every link would "fail to resolve" (or the allowlist
    // would silently carry the suite). The app has ~200 pages.
    expect(ROUTES.length).toBeGreaterThan(100);
    expect(ROUTES).toContain('/dashboard');
    expect(ROUTES).toContain('/pricing');
  });

  it('scanned a realistic number of source files and found real links', () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(internalHrefs.length).toBeGreaterThan(20);
    expect(internalHrefs.some((h) => h.path === '/dashboard')).toBe(true);
  });

  it('parsed the redirect table out of next.config.js', () => {
    // Study Menu v2 redirects — the only entries today. Their presence proves the
    // parser found the right function body.
    expect(REDIRECTS).toContain('/review');
    expect(REDIRECTS).toContain('/study-plan');
    // ...and did NOT bleed into rewrites()/headers() sources.
    expect(REDIRECTS).not.toContain('/(.*)');
    expect(REDIRECTS.some((s) => s.startsWith('/ingest'))).toBe(false);
  });
});

describe('internal link canary — no source file links to the removed /answer-checker CTA', () => {
  // Hard assertion, NOT allowlist-mediated: this is the specific dead link the
  // fix removed, and it must never come back without a real route.
  it('has no /answer-checker href anywhere in the scanned source', () => {
    const hits = hrefHits.filter((h) => h.path === '/answer-checker' || h.path.startsWith('/answer-checker/'));
    expect(
      hits.map((h) => `${h.rel}:${h.line}`),
      'a link to /answer-checker is back, but no such route exists — it 404s for every student who sees it',
    ).toEqual([]);
  });

  it('has no /answer-checker page or redirect either (so the link would still 404)', () => {
    // Stated as the REASON the assertion above holds. If AnswerChecker ships for
    // real, this flips first and the CTA can legitimately return.
    expect(ROUTES.some((r) => r.startsWith('/answer-checker'))).toBe(false);
    expect(REDIRECTS.some((r) => r.startsWith('/answer-checker'))).toBe(false);
  });

  it('BoardScoreWidget renders no anchor to the dead route', () => {
    const widget = readFileSync(resolve(REPO_ROOT, 'packages/ui/src/dashboard/os/BoardScoreWidget.tsx'), 'utf8');
    // Comments explaining WHY the CTA was removed are fine and expected; an
    // actual href attribute is not. Asserted on the attribute form only.
    expect(/\b(?:href|to)\s*=\s*\{?\s*['"`]\/answer-checker/.test(widget)).toBe(false);
    // Non-vacuous: the file really is the widget, and it really does still
    // document the removal (so a wholesale revert is visible here too).
    expect(widget).toContain('BoardScoreWidget');
    expect(widget).toContain('answer-checker');
  });
});

describe('internal link canary — every literal internal href resolves', () => {
  it('resolves to a page or a configured redirect', () => {
    const report = unresolved
      .map((h) => `  ${h.path}\n      ${h.rel}:${h.line}`)
      .join('\n');
    expect(
      unresolved.map((h) => `${h.path} (${h.rel}:${h.line})`),
      `Internal link(s) point at paths with no page.tsx and no redirect — these 404 for users:\n${report}\n\n` +
        `Fix by adding the page, adding a redirect in apps/host/next.config.js, or correcting the href.`,
    ).toEqual([]);
  });

  it('the known-dead allowlist is not silently over-broad', () => {
    // Every allowlisted path must STILL be dead and STILL be linked. When one is
    // fixed, this fails and forces the entry to be deleted — the allowlist cannot
    // rot into permanent cover.
    for (const dead of KNOWN_DEAD_LINKS) {
      expect(
        isResolvable(dead, ROUTES, REDIRECTS),
        `${dead} now resolves — delete it from KNOWN_DEAD_LINKS`,
      ).toBe(false);
      expect(
        internalHrefs.some((h) => h.path === dead),
        `nothing links to ${dead} any more — delete it from KNOWN_DEAD_LINKS`,
      ).toBe(true);
    }
  });
});

describe('internal link canary — has teeth (pure matchers, no source touched)', () => {
  const routes = ['/dashboard', '/learn/[subject]/[chapter]', '/blog/[...slug]', '/docs/[[...path]]'];

  it('FLAGS a path with no page and no redirect (the /answer-checker class)', () => {
    expect(isResolvable('/answer-checker', routes, [])).toBe(false);
  });

  it('ACCEPTS an exact static route', () => {
    expect(isResolvable('/dashboard', routes, [])).toBe(true);
  });

  it('ACCEPTS a path filled into dynamic segments', () => {
    expect(isResolvable('/learn/science/3', routes, [])).toBe(true);
    // ...but not one with the wrong segment count.
    expect(isResolvable('/learn/science', routes, [])).toBe(false);
    expect(isResolvable('/learn/science/3/extra', routes, [])).toBe(false);
  });

  it('ACCEPTS catch-all and optional catch-all routes', () => {
    expect(isResolvable('/blog/a/b/c', routes, [])).toBe(true);
    expect(isResolvable('/blog', routes, [])).toBe(false); // [...slug] needs >=1 segment
    expect(isResolvable('/docs', routes, [])).toBe(true); // [[...path]] matches empty
    expect(isResolvable('/docs/a/b', routes, [])).toBe(true);
  });

  it('ACCEPTS a path served only by a redirect', () => {
    expect(isResolvable('/study-plan', routes, [])).toBe(false);
    expect(isResolvable('/study-plan', routes, ['/study-plan'])).toBe(true);
  });

  it('strips route groups but not real segments when enumerating', () => {
    // /(student)/quiz is served at /quiz, and a literal "(student)" must not leak.
    expect(ROUTES).toContain('/quiz');
    expect(ROUTES.some((r) => r.includes('('))).toBe(false);
    // Private `_folders` are not routable, so no SEGMENT may start with `_`.
    // (An underscore INSIDE a segment name is fine and does occur — e.g. the
    // real route `/support/[ticket_id]` — so a bare `includes('_')` would be
    // wrong here.)
    const segments = ROUTES.flatMap((r) => r.split('/').filter(Boolean));
    expect(segments.filter((s) => s.startsWith('_'))).toEqual([]);
    expect(ROUTES).toContain('/support/[ticket_id]');
  });

  it('normalizes query strings, hashes and trailing slashes to a bare path', () => {
    expect(normalizeUrlPath('/refresh?tab=flashcards')).toBe('/refresh');
    expect(normalizeUrlPath('/pricing#plans')).toBe('/pricing');
    expect(normalizeUrlPath('/dashboard/')).toBe('/dashboard');
    expect(normalizeUrlPath('/')).toBe('/');
  });

  it('does not treat regex metacharacters in a route as wildcards', () => {
    // A literal '.' in a route segment must not match any character.
    expect(routeMatches('/a.b', '/axb')).toBe(false);
    expect(routeMatches('/a.b', '/a.b')).toBe(true);
  });
});
