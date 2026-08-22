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

// ── 3b. collect OBJECT-PROPERTY hrefs (nav configs, quick-action tables) ──────
/**
 * `HREF_LITERAL` above only matches the JSX ATTRIBUTE form (`href="/x"`). Every
 * navigation destination in this product is declared as an OBJECT PROPERTY
 * instead — `{ href: '/learn', icon: '📚', label: 'Learn' }` — in nav config
 * tables that are later spread onto `<Link>`. The attribute scan is structurally
 * blind to all of them.
 *
 * That was the canary's highest-stakes blind spot. A dead JSX link is one broken
 * CTA on one screen; a dead nav entry is a permanently broken tab in the chrome
 * of an entire portal — the "no nav item may lead to a blank page" rule, which
 * has cost a live school demo before. It is also not hypothetical: the same
 * sweep that added this block found `ROLE_CONFIG.guardian.nav` shipping two
 * entries pointing at `/parent/children`, one of them labelled "Exams".
 *
 * Scanned across `packages/lib/src` as well as the two roots above, because the
 * role nav tables live in `packages/lib/src/constants.ts`. Deliberately a
 * SEPARATE scan rather than widening `SCAN_ROOTS`, so the attribute canary's
 * proven-green scope is not altered by this addition.
 *
 * Same literal-only limits as the attribute scan: template/computed hrefs are
 * skipped, `/api/*` is skipped.
 */
const NAV_SCAN_ROOTS = ['apps/host/src', 'packages/ui/src', 'packages/lib/src'] as const;
const HREF_PROPERTY = /\bhref\s*:\s*['"](\/[^'"]*)['"]/g;

const navSourceFiles: string[] = [];
for (const root of NAV_SCAN_ROOTS) {
  const abs = resolve(REPO_ROOT, root);
  if (existsSync(abs)) walkSource(abs, navSourceFiles);
}

const propertyHrefHits: HrefHit[] = [];
for (const abs of navSourceFiles) {
  const rel = toPosix(relative(REPO_ROOT, abs));
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(HREF_PROPERTY)) {
      if (m[1].includes('${')) continue;
      propertyHrefHits.push({ path: normalizeUrlPath(m[1]), rel, line: i + 1 });
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
 * TODO(frontend): resolve and delete the entry.
 *   - `/super-admin/students` — `apps/host/src/app/super-admin/students/` exists
 *     but contains ONLY `[id]/page.tsx`; there is no index page, so the "back to
 *     students" link in the Foxy report 404s.
 *     Linked from apps/host/src/app/super-admin/foxy-report/[studentId]/page.tsx
 *
 * RESOLVED 2026-08-11 (R7): `/upgrade` is no longer dead. It now has a real
 * page (`apps/host/src/app/upgrade/page.tsx`) that redirects to `/pricing`. It
 * is deliberately a route and not a repoint of the five hrefs, because the API
 * emits `upgrade_url: '/upgrade'` as DATA and mobile consumes the same field —
 * see the hard assertion below, which replaces the allowlist entry.
 */
const KNOWN_DEAD_LINKS = new Set<string>(['/super-admin/students']);

export function isResolvable(urlPath: string, routes: string[], redirects: string[]): boolean {
  if (redirects.some((r) => routeMatches(r, urlPath))) return true;
  return routes.some((r) => routeMatches(r, urlPath));
}

const internalHrefs = hrefHits.filter((h) => !h.path.startsWith('/api/'));
const unresolved = internalHrefs.filter(
  (h) => !isResolvable(h.path, ROUTES, REDIRECTS) && !KNOWN_DEAD_LINKS.has(h.path),
);

const internalPropertyHrefs = propertyHrefHits.filter((h) => !h.path.startsWith('/api/'));
const unresolvedProperty = internalPropertyHrefs.filter(
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

describe('R7 — the paywall CTA /upgrade resolves (monetisation path)', () => {
  // Hard assertions, NOT allowlist-mediated. Every tap on a locked mock-test
  // paper used to 404 because /upgrade had no page, no redirect and no rewrite.
  it('/upgrade resolves to a real page or redirect', () => {
    expect(
      isResolvable('/upgrade', ROUTES, REDIRECTS),
      '/upgrade does not resolve — every locked-paper CTA 404s on the payment path',
    ).toBe(true);
  });

  it('is still actually linked (so this is not a dead assertion about a dead URL)', () => {
    expect(internalHrefs.some((h) => h.path === '/upgrade')).toBe(true);
  });

  it('/pricing — the destination — is itself a real route', () => {
    // A redirect to a second dead route would move the 404, not fix it.
    expect(ROUTES).toContain('/pricing');
  });

  it('the /upgrade page redirects rather than forking pricing copy', () => {
    // Price/plan copy must live in exactly one place (P11-adjacent: a second
    // pricing surface is where ₹-drift starts). Pinned structurally.
    const page = readFileSync(resolve(APP_DIR, 'upgrade/page.tsx'), 'utf8');
    expect(page).toMatch(/redirect\(\s*['"]\/pricing['"]\s*\)/);
    // No rupee amounts, no plan names restated here.
    expect(page).not.toMatch(/₹|\bRs\.?\s*\d/);
  });

  it('the API still emits /upgrade as data, which is WHY the route had to exist', () => {
    // If this ever stops being true, repointing the hrefs would have been
    // sufficient and this route can be reconsidered. Until then, deleting the
    // route re-breaks the server-supplied and mobile paths.
    const paperRoute = readFileSync(
      resolve(REPO_ROOT, 'apps/host/src/app/api/exams/papers/[id]/route.ts'),
      'utf8',
    );
    expect(paperRoute).toContain("upgrade_url: '/upgrade'");
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

describe('nav-destination canary — no nav item leads to a blank page', () => {
  it('scanned the nav config tables (non-vacuous)', () => {
    // If the object-property regex ever stops matching, this block would pass
    // trivially while covering nothing. Pin that it still sees the real tables.
    expect(internalPropertyHrefs.length).toBeGreaterThan(100);
    const byFile = (needle: string) => internalPropertyHrefs.some((h) => h.rel.includes(needle));
    expect(byFile('packages/ui/src/navigation/nav-config.ts')).toBe(true);
    expect(byFile('packages/lib/src/constants.ts')).toBe(true);
    expect(byFile('apps/host/src/app/parent/_components/ParentShell.tsx')).toBe(true);
    expect(byFile('apps/host/src/app/teacher/_components/TeacherShell.tsx')).toBe(true);
    // The student core tabs and both portal home paths are in the scan.
    const paths = [...new Set(internalPropertyHrefs.map((h) => h.path))];
    expect(paths).toContain('/today');
    expect(paths).toContain('/parent');
    expect(paths).toContain('/teacher');
  });

  it('every object-property href resolves to a page or a configured redirect', () => {
    const report = unresolvedProperty.map((h) => `  ${h.path}\n      ${h.rel}:${h.line}`).join('\n');
    expect(
      unresolvedProperty.map((h) => `${h.path} (${h.rel}:${h.line})`),
      `Nav/config entr(ies) point at paths with no page.tsx and no redirect. A nav item ` +
        `that leads nowhere is a blank screen in the chrome of a whole portal:\n${report}\n\n` +
        `Fix by adding the page, adding a redirect in apps/host/next.config.js, or removing the entry.`,
    ).toEqual([]);
  });

  it('nothing links to a parent exams page — no such route exists', () => {
    // Hard assertion, not allowlist-mediated — same shape as the /answer-checker
    // pin above. `ROLE_CONFIG.guardian.nav` carried an "Exams" tab pointing at
    // `/parent/children`; the honest fix was to drop it, because no parent-facing
    // exams surface exists. If one ever ships, this flips first.
    //
    // The label-vs-destination half of that defect (two names for one href) is
    // asserted where the tables live, in `constants.test.ts` — not duplicated here.
    expect(ROUTES).not.toContain('/parent/exams');
    expect(internalPropertyHrefs.filter((h) => h.path === '/parent/exams')).toEqual([]);
    expect(internalHrefs.filter((h) => h.path === '/parent/exams')).toEqual([]);
  });

  it('/review is redirect-served, so the links still pointing at it are not dead', () => {
    // `/review` has had no page since Study Menu v2 deleted it; the orphan
    // `app/review/{layout,error}.tsx` left behind (unreachable — a segment with
    // no page.tsx is not a route, and the 301 fires before routing anyway) was
    // removed on 2026-08-08. Many live surfaces still link to `/review`
    // (dashboard quick actions, ReviewsDueCard, QuizResults, NextActionCard,
    // TodaysFocus, the learner-loop next-action). The ONLY thing keeping them
    // off a 404 is the redirect — deleting that line silently breaks all of them.
    expect(ROUTES).not.toContain('/review');
    expect(REDIRECTS).toContain('/review');
    expect(isResolvable('/review', ROUTES, REDIRECTS)).toBe(true);
    // ...and its destination is a real page.
    expect(ROUTES).toContain('/refresh');
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
