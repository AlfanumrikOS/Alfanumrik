import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * DEEP-LINK PARAM CONTRACT (G4) — every query param the app EMITS at a route
 * must be a param that route actually READS.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is the gap the route canary structurally cannot close.
 * `internal-href-route-resolution.test.ts` asks "does this path resolve?".
 * `/foxy?topic_id=<uuid>` resolves — there is a real page, it renders, no 404,
 * no error, nothing in Sentry. The Foxy page simply never read `topic_id`
 * (it read `topic`, `subject`, `chapter`, `mode`, `grade`), so the student
 * tapped "Revise this" on a decaying topic, the app navigated, and Foxy opened
 * completely unscoped. To the student that is indistinguishable from a dead
 * button — "nothing happened" — and to CI it is indistinguishable from success.
 *
 * Three of the 2026-08-24 CEO-reported defects were this exact shape:
 *   - /progress' decay list pushed `/foxy?topic=a3f2b1c0…` (a UUID in the
 *     human-readable `topic` slot, because a `/^Topic \d+$/` test against a
 *     UUID-prefix label could never match and the topic_id branch was dead).
 *   - The Revision Center's per-row CTA and primary CTA both deep-linked
 *     `topic_id`, which nothing read.
 *   - `ReviewsDueCard` pushed `/review?due_only=1`, which 301s to
 *     `/refresh?tab=flashcards` — the redirect discards the query entirely, so
 *     "due only" was silently dropped on the way.
 *
 * WHAT THIS GUARD DOES
 * --------------------
 * For a HAND-MAINTAINED table of deep-linkable student routes:
 *   READ set  — derived by scanning that route's page + its component dirs for
 *               `searchParams.get('x')` / `useSearchParams().get('x')` /
 *               `new URLSearchParams(...).get('x')` (also `.has` / `.getAll`).
 *   EMIT set  — derived by scanning apps/host/src + packages/ui/src +
 *               packages/lib/src for literal query strings aimed at that route,
 *               including the `new URLSearchParams()` builder form.
 * Fails when EMIT ⊄ READ.
 *
 * The table is hand-maintained ON PURPOSE. Auto-discovering "every route with a
 * query param" would drag in super-admin filter UIs, the auth `redirectTo`
 * dance and third-party callbacks, and the guard would spend its life being
 * allowlisted. These are the student-facing deep links that carry learning
 * context — the ones where a dropped param means a dead-feeling button.
 *
 * DELIBERATE LIMITS (a canary that cries wolf gets deleted):
 *   - EMIT is literal-only. `/foxy?${qs}` where `qs` is built somewhere else
 *     (e.g. `TodaysFocus`'s `subjectParam`/`sourceParam` string fragments) is
 *     invisible here; resolving it needs data-flow analysis.
 *   - The builder form is resolved by a bounded BACKWARD window for
 *     `<ident>.set('k')` — a `.set()` further away than the window, or in
 *     another function, is missed.
 *   - READ is derived from `.get()`-shaped access on a searchParams-derived
 *     identifier. A page that reads its params some other way (server
 *     `searchParams` prop destructuring, a custom hook) would look like it
 *     reads nothing — which is why every route in the table has a non-vacuity
 *     assertion pinning at least one param it is known to read.
 *   So: PASSING does not prove every deep link works end to end. FAILING always
 *   means a param is being sent to a page that cannot see it.
 *
 * IF THIS TEST FAILS: either make the page read the param, or stop sending it.
 * Adding to ALLOWLIST needs a reason and a TODO — it is not the default.
 */

function findRepoRoot(): string {
  const candidates = [resolve(process.cwd(), '..', '..'), resolve(process.cwd(), '..'), process.cwd()];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/ui/src'))) return c;
  }
  throw new Error('deep-link-param-contract: could not locate the monorepo root');
}

const REPO_ROOT = findRepoRoot();

const EMIT_SCAN_ROOTS = ['apps/host/src', 'packages/ui/src', 'packages/lib/src'] as const;
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

const toPosix = (p: string) => p.split(sep).join('/');

/**
 * When `routeBoundary` is set, a subdirectory that is itself a routable App
 * Router segment is NOT descended into — only Next.js private folders
 * (`_components`, `_lib`, `_hooks`) are.
 *
 * This matters, and getting it wrong makes the guard lie: `/quiz`'s directory
 * contains `ncert/`, which is the SEPARATE route `/quiz/ncert`. That shim reads
 * `params.has('types')` before forwarding — so a naive recursive walk concludes
 * "/quiz reads types", which is exactly the false clean bill of health this
 * guard exists to prevent (the unified /quiz page never reads `types`).
 */
function collectFiles(roots: readonly string[], routeBoundary = false): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = [];
  const walk = (dir: string, depth = 0): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (routeBoundary && !entry.name.startsWith('_')) continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      if (SKIP_FILE.test(entry.name)) continue;
      out.push({ rel: toPosix(relative(REPO_ROOT, abs)), abs });
    }
  };
  for (const r of roots) walk(resolve(REPO_ROOT, r));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Blank out comment bodies, preserving newlines and string literals, so a
 * doc-comment that MENTIONS `/foxy?topic_id=…` is never read as an emission.
 * (Every one of these guards documents the defect it pins, in prose, in the
 * file it pins — without this, each guard would indict its own header.)
 */
export function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      for (let k = 0; k < 2 && i < n; k++, i++) out.push(' ');
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out.push(c);
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out.push(src[i], src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out.push(src[i]);
        const done = src[i] === quote;
        i++;
        if (done) break;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

const lineOf = (src: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
};

// ── 1. READ set: which params does a page actually look at? ───────────────────
/**
 * Identifiers bound to a searchParams-like object, plus the two inline forms.
 * `.has()` and `.getAll()` count as reads — a page that branches on
 * `params.has('types')` is honouring the param.
 */
export function collectReadParams(source: string): Set<string> {
  const s = stripComments(source);
  const reads = new Set<string>();

  const idents = new Set<string>(['searchParams']);
  const BIND =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:useSearchParams\s*\(\)|new\s+URLSearchParams\s*\()/g;
  for (const m of s.matchAll(BIND)) idents.add(m[1]);

  for (const ident of idents) {
    const re = new RegExp(
      String.raw`\b${ident}\s*\??\.\s*(?:get|getAll|has)\(\s*['"\`]([A-Za-z_][\w-]*)['"\`]`,
      'g',
    );
    for (const m of s.matchAll(re)) reads.add(m[1]);
  }

  // Inline, unbound: `useSearchParams().get('x')`,
  // `new URLSearchParams(window.location.search).get('x')`.
  const INLINE =
    /(?:useSearchParams\s*\(\)|new\s+URLSearchParams\s*\([^)]*\))\s*\??\.\s*(?:get|getAll|has)\(\s*['"`]([A-Za-z_][\w-]*)['"`]/g;
  for (const m of s.matchAll(INLINE)) reads.add(m[1]);

  return reads;
}

// ── 2. EMIT set: which params does anything send to a route? ──────────────────
export interface EmitHit {
  route: string;
  param: string;
  rel: string;
  line: number;
}

/** How far back from a `` `/route?${qs}` `` we look for `qs.set('k')`. */
const BUILDER_WINDOW_CHARS = 2000;

/** A quoted string that starts with an absolute path and carries a query. */
const QUERY_LITERAL = /(['"`])(\/[A-Za-z0-9/_\-.[\]]*)\?([^'"`]*)\1/g;

export function collectEmittedParams(rel: string, source: string, routes: Set<string>): EmitHit[] {
  const s = stripComments(source);
  const hits: EmitHit[] = [];

  for (const m of s.matchAll(QUERY_LITERAL)) {
    const route = m[2];
    const query = m[3];
    if (!routes.has(route)) continue;
    const line = lineOf(s, m.index);

    // Builder form: the whole query is one interpolation of a params object.
    const builder = /^\$\{\s*([A-Za-z_$][\w$]*)\s*(?:\.toString\(\))?\s*\}$/.exec(query.trim());
    if (builder) {
      const ident = builder[1];
      const from = Math.max(0, m.index - BUILDER_WINDOW_CHARS);
      const window = s.slice(from, m.index);
      const setRe = new RegExp(
        String.raw`\b${ident}\s*\.\s*(?:set|append)\(\s*['"\`]([A-Za-z_][\w-]*)['"\`]`,
        'g',
      );
      for (const sm of window.matchAll(setRe)) hits.push({ route, param: sm[1], rel, line });
      continue;
    }

    // Static `a=1&b=2` segments. A segment whose KEY is interpolated is
    // computed and skipped rather than guessed at.
    for (const seg of query.split('&')) {
      const km = /^\s*([A-Za-z_][\w-]*)=/.exec(seg);
      if (km) hits.push({ route, param: km[1], rel, line });
    }
  }

  return hits;
}

// ── 3. the hand-maintained route table ────────────────────────────────────────
interface RouteContract {
  route: string;
  /**
   * Directories whose source constitutes "the page". Includes the shared
   * components the page mounts, because that is where several of these routes
   * actually read their params (e.g. `/refresh`'s `subject`/`chapter`/`from`
   * are read by `packages/ui/src/refresh/ChapterRefreshSection.tsx`, not by
   * `app/refresh/page.tsx`).
   */
  readDirs: string[];
  /**
   * A route with no page of its own, served by a `next.config.js` redirect.
   * Its effective read set is the DESTINATION's — and everything else in the
   * query is dropped by the 301, which is the `/review?due_only=1` defect.
   */
  redirectsTo?: string;
  /** Params this route is known to read; pins the derivation as non-vacuous. */
  mustRead: string[];
}

const CONTRACTS: RouteContract[] = [
  {
    route: '/foxy',
    readDirs: ['apps/host/src/app/foxy'],
    // `topic_id` is here as a HARD pin: it is the param defect #10 added, and
    // the whole point of `_lib/resolve-topic-id.ts`. If Foxy stops reading it,
    // every Revision Center CTA silently goes back to opening unscoped.
    mustRead: ['topic', 'topic_id', 'subject', 'chapter', 'mode', 'grade', 'source'],
  },
  {
    route: '/quiz',
    readDirs: ['apps/host/src/app/(student)/quiz'],
    mustRead: ['subject', 'chapter', 'mode'],
  },
  {
    route: '/refresh',
    readDirs: ['apps/host/src/app/refresh', 'packages/ui/src/refresh'],
    mustRead: ['tab'],
  },
  {
    route: '/revision',
    readDirs: ['apps/host/src/app/(student)/revision', 'packages/ui/src/review/os'],
    // Deliberately empty: /revision takes no deep-link params today. Declared
    // so that the first one someone adds is checked instead of unnoticed.
    mustRead: [],
  },
  {
    route: '/practice',
    readDirs: ['apps/host/src/app/(student)/practice', 'packages/ui/src/practice/os'],
    mustRead: [],
  },
  {
    route: '/progress',
    readDirs: ['apps/host/src/app/(student)/progress'],
    mustRead: ['view'],
  },
  {
    route: '/review',
    readDirs: [],
    redirectsTo: '/refresh',
    mustRead: [],
  },
];

const ROUTE_SET = new Set(CONTRACTS.map((c) => c.route));

const readSets = new Map<string, Set<string>>();
const readFileCounts = new Map<string, number>();
for (const c of CONTRACTS) {
  const params = new Set<string>();
  let n = 0;
  for (const dir of c.readDirs) {
    // Route dirs stop at the next routable segment; shared component packages
    // are walked in full.
    const files = collectFiles([dir], dir.startsWith('apps/host/src/app'));
    n += files.length;
    for (const { abs } of files) {
      for (const p of collectReadParams(readFileSync(abs, 'utf8'))) params.add(p);
    }
  }
  readSets.set(c.route, params);
  readFileCounts.set(c.route, n);
}
/** A redirect-only route can only honour what its DESTINATION reads. */
function effectiveReadSet(route: string): Set<string> {
  const c = CONTRACTS.find((x) => x.route === route);
  if (!c) return new Set();
  if (c.redirectsTo) return readSets.get(c.redirectsTo) ?? new Set();
  return readSets.get(route) ?? new Set();
}

const emitFiles = collectFiles(EMIT_SCAN_ROOTS);
const emitHits: EmitHit[] = emitFiles.flatMap(({ rel, abs }) =>
  collectEmittedParams(rel, readFileSync(abs, 'utf8'), ROUTE_SET),
);

// ── 4. allowlist — reason + TODO required ─────────────────────────────────────
interface AllowEntry {
  route: string;
  param: string;
  reason: string;
  todo: string;
}

/**
 * PRE-EXISTING instances of exactly this defect class, found by this guard on
 * the day it was written and OUTSIDE the four CTAs the 2026-08-24 wave fixed.
 * Every entry is a param a student-facing surface sends and the target page
 * cannot see. They are recorded rather than silently fixed because the owning
 * surfaces belong to other agents.
 *
 * This list may not GROW without the same discipline: a reason, and a
 * `TODO(<owner>):` naming who resolves it. The staleness assertion below
 * deletes entries automatically-by-failing once they stop being violations.
 */
const ALLOWLIST: AllowEntry[] = [
  {
    route: '/foxy',
    param: 'bloom',
    reason:
      "QuizResults + quiz/v2/ResultSummary send the student's worst Bloom level as " +
      '`/foxy?mode=doubt&bloom=<level>`; Foxy reads mode/subject but never bloom, so the ' +
      'doubt session opens without the pedagogical context the CTA promised.',
    todo: 'TODO(ai-engineer): read `bloom` in the Foxy URL-context effect, or drop it from the two CTAs.',
  },
  {
    route: '/foxy',
    param: 'saved',
    reason:
      '`OfflineBoundaryActive` routes "open saved explanations" to `/foxy?saved=1`. Foxy ' +
      'has no `saved` branch, so the offline CTA lands on a normal empty chat.',
    todo: 'TODO(frontend): implement the saved-explanations view or repoint the offline CTA.',
  },
  {
    route: '/foxy',
    param: 'from',
    reason:
      '/diagnostic sends `/foxy?from=diagnostic_unavailable` on the fallback path. Foxy reads ' +
      '`source`, not `from`, so the provenance is lost (harmless to the student, but the two ' +
      'names for one concept are how the next real drop happens).',
    todo: 'TODO(frontend): normalise the diagnostic fallback onto `source=`, which Foxy does read.',
  },
  {
    route: '/quiz',
    param: 'exam_id',
    reason:
      '/exams and the exam-briefing StartExamCTA both deep-link `/quiz?mode=exam&exam_id=<id>`. ' +
      'The quiz page reads `mode` but never `exam_id`, so exam mode starts unbound to the ' +
      'exam_configs row the student chose.',
    todo: 'TODO(assessment): confirm whether exam mode is meant to be exam-scoped; wire or drop `exam_id`.',
  },
  {
    route: '/quiz',
    param: 'types',
    reason:
      '/quiz/ncert is a back-compat redirect that stamps `types=ncert` before forwarding to ' +
      '/quiz. The unified quiz page never reads `types`, so the NCERT-written-answer intent ' +
      'is dropped and the student gets a normal MCQ quiz.',
    todo: 'TODO(assessment): honour `types` in the unified quiz page, or delete the /quiz/ncert shim.',
  },
  {
    route: '/foxy',
    param: 'q',
    reason:
      "MisconceptionExplainer's \"Ask Foxy to explain more\" link sends the offending " +
      '`questionId` as `/foxy?mode=doubt&q=<uuid>`. Foxy reads `prompt`, not `q`, so the ' +
      'remediation link opens a doubt session with no idea which question it is about.',
    todo: 'TODO(ai-engineer): resolve `q` to a prompt on the Foxy page, or send `prompt=` instead.',
  },
  {
    route: '/foxy',
    param: 'message',
    reason:
      'QuizResults\' per-question "Ask Foxy" builds the full natural-language question and ' +
      'sends it as `message=`. Foxy auto-sends `prompt=`, never `message=`, so the composed ' +
      'question is dropped and the student lands in an empty chat — the same "nothing ' +
      'happened" shape as the topic_id defect.',
    todo: 'TODO(frontend): rename the emitted param to `prompt`, which Foxy already auto-sends.',
  },
  {
    route: '/foxy',
    param: 'question',
    reason:
      "/scan's \"Solve Step-by-Step\" pushes the OCR'd question text as `/foxy?question=<text>`. " +
      'Foxy does not read `question`; the scanned problem never reaches the tutor.',
    todo: 'TODO(frontend): send `prompt=` (auto-sent) instead of `question=`.',
  },
  {
    route: '/quiz',
    param: 'topic',
    reason:
      'Four surfaces deep-link `/quiz?topic=<name-or-uuid>` — the Foxy page\'s "quiz me on ' +
      'this" intent (x2), /scan\'s per-question CTA, and KnowledgeGapActions\' "Take Quiz". ' +
      'The quiz page scopes on `subject` + `chapter` only and never reads `topic`, so every ' +
      'one of these starts a generic quiz. This is the same defect as the fixed ' +
      '/foxy?topic_id case, pointing the other way.',
    todo: 'TODO(assessment): decide whether /quiz can be topic-scoped; wire `topic` or repoint the CTAs to subject+chapter.',
  },
  {
    route: '/quiz',
    param: 'source',
    reason:
      'The Foxy page tags its quiz hand-off `&source=foxy` for provenance. /quiz reads `from`, ' +
      'not `source` — two names for one concept across sibling surfaces, which is how the ' +
      'next real drop happens.',
    todo: 'TODO(frontend): normalise onto `from=`, which /quiz already reads.',
  },
  {
    route: '/review',
    param: 'filter',
    reason:
      'QuizResults and NextActionCard send `/review?filter=quiz_wrong_answer`. /review has no ' +
      'page — it 301s to /refresh?tab=flashcards and the redirect discards the query, so the ' +
      '"review your wrong answers" CTA opens the generic flashcard session. Same mechanism as ' +
      'the `due_only=1` defect fixed in this wave, different param.',
    todo: 'TODO(frontend): give /refresh a `filter` branch, or point these CTAs at a surface that has one.',
  },
];

const isAllowed = (h: EmitHit) => ALLOWLIST.some((a) => a.route === h.route && a.param === h.param);

const violations = emitHits.filter((h) => !effectiveReadSet(h.route).has(h.param) && !isAllowed(h));

const render = (h: EmitHit) => `${h.route}?${h.param}= emitted at ${h.rel}:${h.line}`;

// ── 5. assertions ─────────────────────────────────────────────────────────────
describe('deep-link param contract — scan is non-vacuous', () => {
  it('walked a realistic emit corpus', () => {
    expect(emitFiles.length).toBeGreaterThan(500);
    expect(emitHits.length).toBeGreaterThan(15);
  });

  it('derived a non-empty READ set for every route that has one', () => {
    for (const c of CONTRACTS) {
      const reads = readSets.get(c.route)!;
      for (const p of c.mustRead) {
        expect(
          reads.has(p),
          `${c.route} is documented to read '${p}' but no ${c.readDirs.join(' / ')} source reads it — ` +
            `either the page stopped honouring the param, or the READ derivation broke ` +
            `(which would make this whole guard vacuous).`,
        ).toBe(true);
      }
    }
  });

  it('stops the READ walk at the next routable segment', () => {
    // `/quiz/ncert` is a different page. If its `params.has('types')` leaked
    // into /quiz's read set, the guard would report the NCERT shim as working.
    expect(readSets.get('/quiz')!.has('types')).toBe(false);
    // ...while /foxy still reaches its own private `_lib` / `_components`.
    expect(readFileCounts.get('/foxy')!).toBeGreaterThan(5);
    expect(readSets.get('/foxy')!.has('prompt')).toBe(true);
  });

  it('found the real emitters this guard was written for', () => {
    const at = (route: string, param: string, needle: string) =>
      emitHits.some((h) => h.route === route && h.param === param && h.rel.includes(needle));
    // /progress' "Revise Now" (defect #10's fixed form) — builder-shape emit.
    expect(at('/foxy', 'topic', 'app/(student)/progress/page.tsx')).toBe(true);
    expect(at('/foxy', 'mode', 'app/(student)/progress/page.tsx')).toBe(true);
    // DueBuckets' per-row CTA, via the shared reviseTopicHref builder.
    expect(at('/foxy', 'topic_id', 'packages/ui/src/review/os/revision-labels.ts')).toBe(true);
    // A plain static literal.
    expect(at('/refresh', 'tab', 'packages/ui/src/review/os/StartRevisionCTA.tsx')).toBe(true);
  });
});

describe('deep-link param contract — every emitted param is read by its target', () => {
  it('emits nothing the target page cannot see', () => {
    const report = violations.map((v) => `  ${render(v)}`).join('\n');
    expect(
      violations.map(render),
      `Deep link(s) send a query param the target route never reads. The route RESOLVES, so ` +
        `the link canary passes and nothing 404s — the student taps, navigates, and the page ` +
        `ignores the context it was given. That reads as "nothing happened":\n${report}\n\n` +
        `Fix by reading the param on the target page, or by not sending it.`,
    ).toEqual([]);
  });

  it('the allowlist is not silently over-broad', () => {
    // Every entry must STILL be emitted and STILL be unread. When one is fixed
    // this fails and forces the entry out — the allowlist cannot rot into cover.
    for (const a of ALLOWLIST) {
      expect(
        emitHits.some((h) => h.route === a.route && h.param === a.param),
        `nothing emits ${a.route}?${a.param}= any more — delete it from ALLOWLIST`,
      ).toBe(true);
      expect(
        effectiveReadSet(a.route).has(a.param),
        `${a.route} now reads '${a.param}' — delete it from ALLOWLIST`,
      ).toBe(false);
    }
  });

  it('every allowlist entry carries a reason and a TODO with an owner', () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.length, `${a.route}?${a.param} needs a real reason`).toBeGreaterThan(40);
      expect(a.todo, `${a.route}?${a.param} needs TODO(<owner>):`).toMatch(/^TODO\([a-z-]+\):/);
    }
  });
});

describe('deep-link param contract — the four fixed CTAs stay fixed', () => {
  it('/foxy reads topic_id (defect #10 — the Revision Center CTAs depend on it)', () => {
    expect(readSets.get('/foxy')!.has('topic_id')).toBe(true);
    // ...and the resolver that turns it into subject/chapter context still exists.
    const resolver = resolve(REPO_ROOT, 'apps/host/src/app/foxy/_lib/resolve-topic-id.ts');
    expect(existsSync(resolver)).toBe(true);
    expect(readFileSync(resolver, 'utf8')).toContain('export async function resolveTopicId');
  });

  it('nothing sends /review?due_only= any more', () => {
    // Hard assertion, not allowlist-mediated. `ReviewsDueCard` pushed
    // `/review?due_only=1`; /review 301s to /refresh?tab=flashcards and the
    // query is discarded, so "N reviews due" opened the generic session.
    const hits = emitHits.filter((h) => h.route === '/review' && h.param === 'due_only');
    expect(hits.map(render)).toEqual([]);
    expect(effectiveReadSet('/review').has('due_only')).toBe(false);
  });

  it('reviseTopicHref only emits params /foxy reads', () => {
    // The shared builder behind every per-row "Revise this" link. Asserted at
    // the source so a fourth param added here is caught even before a caller
    // ships.
    const src = readFileSync(resolve(REPO_ROOT, 'packages/ui/src/review/os/revision-labels.ts'), 'utf8');
    const emitted = collectEmittedParams('revision-labels.ts', src, ROUTE_SET)
      .filter((h) => h.route === '/foxy')
      .map((h) => h.param);
    expect(emitted.length).toBeGreaterThan(0);
    const foxyReads = readSets.get('/foxy')!;
    expect(emitted.filter((p) => !foxyReads.has(p))).toEqual([]);
    expect(emitted).toContain('topic_id');
  });

  it("/progress' Revise Now sends the topic TITLE plus scope, not a bare uuid in ?topic", () => {
    const src = readFileSync(resolve(REPO_ROOT, 'apps/host/src/app/(student)/progress/page.tsx'), 'utf8');
    const emitted = new Set(
      collectEmittedParams('progress/page.tsx', src, ROUTE_SET)
        .filter((h) => h.route === '/foxy')
        .map((h) => h.param),
    );
    for (const p of ['topic', 'subject', 'chapter', 'mode', 'source']) expect(emitted.has(p)).toBe(true);
    const foxyReads = readSets.get('/foxy')!;
    expect([...emitted].filter((p) => !foxyReads.has(p))).toEqual([]);
  });
});

describe('deep-link param contract — has teeth (pure matchers, no source touched)', () => {
  const routes = new Set(['/foxy', '/quiz', '/review']);

  it('FLAGS the original defect shape: a param the target never reads', () => {
    const planted = collectEmittedParams(
      'planted.tsx',
      "router.push('/foxy?topic_id=abc&nonsense=1');",
      routes,
    );
    expect(planted.map((h) => h.param)).toEqual(['topic_id', 'nonsense']);
    const foxyReads = readSets.get('/foxy')!;
    expect(planted.filter((h) => !foxyReads.has(h.param)).map((h) => h.param)).toEqual(['nonsense']);
  });

  it('resolves the URLSearchParams builder form used by the real CTAs', () => {
    const planted = collectEmittedParams(
      'planted.tsx',
      [
        'const params = new URLSearchParams();',
        "params.set('topic_id', id);",
        "params.set('mode', 'revise');",
        "params.append('source', 'revision');",
        'return `/foxy?${params.toString()}`;',
      ].join('\n'),
      routes,
    );
    expect(planted.map((h) => h.param).sort()).toEqual(['mode', 'source', 'topic_id']);
  });

  it('says nothing about a query assembled from string fragments (documented limit)', () => {
    // `TodaysFocus` builds `subjectParam`/`sourceParam` as separate `k=v`
    // strings and joins them into the query. Recovering those keys needs data
    // flow analysis; guessing would produce false positives, so this form is a
    // deliberate FALSE NEGATIVE. Pinned so the limit is a decision, not a
    // surprise the next reader has to rediscover.
    const planted = collectEmittedParams(
      'planted.tsx',
      "return `/foxy?${[subjectParam, 'mode=learn'].filter(Boolean).join('&')}`;",
      routes,
    );
    expect(planted).toEqual([]);
  });

  it('does NOT fire on a route outside the hand-maintained table', () => {
    const planted = collectEmittedParams('p.tsx', "'/super-admin/logs?action=whatever'", routes);
    expect(planted).toEqual([]);
  });

  it('does NOT fire on a comment that documents the defect', () => {
    const planted = collectEmittedParams(
      'p.tsx',
      "// the old CTA pushed '/foxy?nonsense=1' and Foxy ignored it\n" +
        "/* also '/quiz?bogus=2' */\n",
      routes,
    );
    expect(planted).toEqual([]);
  });

  it('skips a segment whose KEY is computed rather than guessing', () => {
    const planted = collectEmittedParams('p.tsx', 'return `/foxy?${key}=${value}`;', routes);
    expect(planted).toEqual([]);
  });

  it('READ derivation sees every access shape the real pages use', () => {
    const reads = collectReadParams(
      [
        'const searchParams = useSearchParams();',
        "const a = searchParams.get('alpha');",
        'const params = new URLSearchParams(window.location.search);',
        "const b = params.get('beta');",
        "if (params.has('gamma')) {}",
        "const d = new URLSearchParams(window.location.search).get('delta');",
        "const e = useSearchParams().get('epsilon');",
      ].join('\n'),
    );
    expect([...reads].sort()).toEqual(['alpha', 'beta', 'delta', 'epsilon', 'gamma']);
  });

  it('READ derivation ignores a commented-out read', () => {
    expect(collectReadParams("// searchParams.get('ghost')").size).toBe(0);
  });
});
