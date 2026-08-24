import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * DEAD-TABLE / GHOST-COLUMN CANARY — no server or shared-lib query may read a
 * table that has been tombstoned, or a column that nothing writes.
 *
 * WHY THIS EXISTS
 * ---------------
 * In June 2026 migrations 20260623000700 and 20260623000800 repointed
 * `get_bloom_progression`, `get_knowledge_gaps` and `get_dashboard_data` off
 * `question_responses`. The sweep missed `/api/practice/history`, and nobody
 * noticed for 14 months. `question_responses` has ZERO rows in production, so
 * the two panels that route feeds — "Common mistakes" and "Bloom's levels
 * attempted" — rendered their empty state for every student, forever, while
 * "Average score" (which reads a different, live table) kept updating. That
 * asymmetry is exactly what made it invisible: the card looked alive.
 *
 * The same class of bug has a second form here: a GHOST COLUMN.
 * `concept_mastery.next_review_date` is a DATE column with
 * `DEFAULT CURRENT_DATE + 1 day` that no function, cron, or application code
 * has ever written. Reading it marks every concept a student has ever touched
 * "due for review" one day later, forever — 91 rows due by the ghost vs 27 by
 * the real `next_review_at`, a 3.4x inflation. The real SM-2 schedule lives in
 * `next_review_at` (timestamptz), written by `update_learner_state_post_quiz`.
 *
 * Neither failure mode is catchable by the type checker, by lint, or by any
 * mock-backed unit test: `.from('question_responses')` is a valid table name in
 * `database.types.ts`, and a query against an empty table is a successful query
 * that returns `[]`. Only a structural scan of the source distinguishes
 * "no data yet" from "wired to nothing".
 *
 * WHAT THIS CANARY DOES
 * ---------------------
 * Walks every non-test `.ts`/`.tsx` file under `apps/host/src` and
 * `packages/lib/src`, strips comments (so a warning ABOUT a dead table never
 * trips the guard that forbids USING it), and fails on:
 *
 *   1. `.from('question_responses')`   — zero rows in production; its only
 *      writer was a client-side fire-and-forget insert, removed 2026-08-24.
 *   2. `.from('topic_mastery')` / `.from('cme_concept_state')` — COMMENT-
 *      tombstoned by migration 20260808000100.
 *   3. `.from('chat_messages')`        — the table does not exist in
 *      production at all (`to_regclass('public.chat_messages')` → NULL).
 *   4. `next_review_date` referenced inside a `concept_mastery` query chain.
 *      NOT a blanket ban on the identifier: `spaced_repetition_cards` has a
 *      legitimate `next_review_date` that IS written on every review grade
 *      (`/api/learner/cards/create`, `/api/learner/review/grade`,
 *      `packages/lib/src/domains/practice.ts`). Only the `concept_mastery`
 *      one is a ghost.
 *
 * DELIBERATE LIMITS (a canary that cries wolf gets deleted):
 *   - Only LITERAL table names. `.from(SOME_DESCRIPTOR.table)` and other
 *     computed table references are invisible here; resolving them needs data
 *     flow analysis and guessing would produce false positives.
 *   - Comments and JSDoc are stripped before matching, on purpose. The sibling
 *     routes `/api/dashboard/reviews-due` and `/api/revision/overview` carry
 *     prominent "do NOT read next_review_date" warnings, and those warnings
 *     must not be self-incriminating.
 *   - `database.types.ts` is excluded: it is generated from the live schema and
 *     legitimately names every table, dead or alive.
 *   - Test files are excluded, so a test may still name a dead table to pin
 *     its deadness (this file does exactly that).
 *   - Raw SQL and RPC bodies in `supabase/` are NOT scanned — migrations are
 *     the architect's surface and have their own review.
 *   So: PASSING does not prove every read is live. FAILING always means real
 *   application code is querying something that cannot return real data.
 *
 * IF THIS TEST FAILS: repoint the query at the live table/column
 * (`question_responses` → `quiz_responses`; `concept_mastery.next_review_date`
 * → `concept_mastery.next_review_at`). Adding to ALLOWLIST is a documented
 * exception that needs a reason and a TODO — it is not the default.
 */

function findRepoRoot(): string {
  const candidates = [
    resolve(process.cwd(), '..', '..'),
    resolve(process.cwd(), '..'),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/lib/src'))) {
      return c;
    }
  }
  throw new Error('dead-table-and-ghost-column-reads: could not locate the monorepo root');
}

const REPO_ROOT = findRepoRoot();

const SCAN_ROOTS = ['apps/host/src', 'packages/lib/src'] as const;

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

/** Generated from the live schema — legitimately names every table. */
const SKIP_BASENAMES = new Set(['database.types.ts']);

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

// ── 1. collect source files ───────────────────────────────────────────────────
function collectSourceFiles(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = [];
  const walk = (dir: string): void => {
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
        walk(abs);
        continue;
      }
      if (!/\.[cm]?tsx?$/.test(entry.name)) continue;
      if (SKIP_FILE.test(entry.name)) continue;
      if (SKIP_BASENAMES.has(entry.name)) continue;
      out.push({ rel: toPosix(relative(REPO_ROOT, abs)), abs });
    }
  };
  for (const root of SCAN_ROOTS) walk(resolve(REPO_ROOT, root));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ── 2. strip comments, preserving line numbering and string literals ──────────
/**
 * Replaces the BODY of every `//` and block comment with spaces, keeping every
 * newline so line numbers in failure messages stay accurate. String and
 * template literals are walked through so a `'//'` inside a string is not
 * mistaken for a comment opener. Regex literals are not tracked — a `/` in a
 * regex is at worst treated as division, which cannot swallow real code here.
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
      // the closing */ (or EOF)
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

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

// ── 3. rules ──────────────────────────────────────────────────────────────────
type RuleId = 'question_responses' | 'tombstoned_table' | 'missing_table' | 'ghost_next_review_date';

interface Violation {
  rule: RuleId;
  rel: string;
  line: number;
  detail: string;
}

/** `.from('x')` with any of the three quote styles. */
function fromLiteralRegex(table: string): RegExp {
  return new RegExp(String.raw`\.from\(\s*['"\`]${table}['"\`]\s*\)`, 'g');
}

const DEAD_TABLES: { table: string; rule: RuleId; why: string }[] = [
  {
    table: 'question_responses',
    rule: 'question_responses',
    why: 'zero rows in production; readers were repointed to quiz_responses',
  },
  {
    table: 'topic_mastery',
    rule: 'tombstoned_table',
    why: 'COMMENT-tombstoned by migration 20260808000100',
  },
  {
    table: 'cme_concept_state',
    rule: 'tombstoned_table',
    why: 'COMMENT-tombstoned by migration 20260808000100',
  },
  {
    table: 'chat_messages',
    rule: 'missing_table',
    why: "table does not exist in production (to_regclass('public.chat_messages') is NULL)",
  },
];

/**
 * How far past a `.from('concept_mastery')` we consider part of the same query
 * chain. Supabase chains are contiguous `.select(...).eq(...).lte(...)` calls;
 * the window ends early at the next `.from(` so two adjacent queries can't be
 * conflated.
 */
const CHAIN_WINDOW_CHARS = 1200;

export function findViolations(rel: string, rawSource: string): Violation[] {
  const src = stripComments(rawSource);
  const found: Violation[] = [];

  for (const { table, rule, why } of DEAD_TABLES) {
    const re = fromLiteralRegex(table);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      found.push({
        rule,
        rel,
        line: lineOf(src, m.index),
        detail: `.from('${table}') — ${why}`,
      });
    }
  }

  const cmRe = fromLiteralRegex('concept_mastery');
  let cm: RegExpExecArray | null;
  while ((cm = cmRe.exec(src)) !== null) {
    const start = cm.index;
    const hardEnd = Math.min(src.length, start + CHAIN_WINDOW_CHARS);
    const nextFrom = src.indexOf('.from(', start + 1);
    const end = nextFrom !== -1 && nextFrom < hardEnd ? nextFrom : hardEnd;
    const window = src.slice(start, end);
    const ghostAt = window.indexOf('next_review_date');
    if (ghostAt !== -1) {
      found.push({
        rule: 'ghost_next_review_date',
        rel,
        line: lineOf(src, start + ghostAt),
        detail:
          "concept_mastery query references the ghost column 'next_review_date' " +
          '(DEFAULT CURRENT_DATE + 1, never written) — use next_review_at',
      });
    }
  }

  return found;
}

// ── 4. allowlist — reason + TODO required, same discipline as KNOWN_DEAD_LINKS ─
interface AllowEntry {
  rel: string;
  rule: RuleId;
  reason: string;
  todo: string;
}

/**
 * EMPTY, and that is the intended steady state.
 *
 * This list briefly held `apps/host/src/app/api/foxy/suggest-prompts/route.ts`
 * (ghost_next_review_date): its "overdue revision" query filtered
 * `concept_mastery.next_review_date`, so Foxy offered a revision prompt for
 * every concept a student had ever touched. That was a real instance of the
 * same defect, owned by a different agent and fixed in the same 2026-08-24
 * wave; the entry was deleted the moment the fix landed, which is exactly what
 * the staleness assertion below is for.
 *
 * Adding an entry requires a `reason` explaining why the dead read must stay,
 * and a `TODO(owner):` naming who removes it — same discipline as
 * KNOWN_DEAD_LINKS in internal-href-route-resolution.test.ts. It is a
 * documented exception, not the default. Fix the query instead.
 */
const ALLOWLIST: AllowEntry[] = [];

function isAllowed(v: Violation): boolean {
  return ALLOWLIST.some((a) => a.rel === v.rel && a.rule === v.rule);
}

// ── 5. run ────────────────────────────────────────────────────────────────────
const sourceFiles = collectSourceFiles();
const allViolations = sourceFiles.flatMap(({ rel, abs }) =>
  findViolations(rel, readFileSync(abs, 'utf8')),
);
const unallowed = allViolations.filter((v) => !isAllowed(v));

function render(v: Violation): string {
  return `${v.rel}:${v.line} [${v.rule}] ${v.detail}`;
}

describe('dead-table / ghost-column canary — scan is non-vacuous', () => {
  it('walked a realistic slice of the monorepo', () => {
    // If the walker broke, everything would "pass" and the guard would be a
    // tautology. apps/host/src + packages/lib/src is well over a thousand files.
    expect(sourceFiles.length).toBeGreaterThan(500);
    expect(sourceFiles.some((f) => f.rel === 'apps/host/src/app/api/practice/history/route.ts')).toBe(
      true,
    );
    expect(sourceFiles.some((f) => f.rel === 'packages/lib/src/supabase.ts')).toBe(true);
  });

  it('excludes generated types and test files from the scan', () => {
    expect(sourceFiles.some((f) => f.rel.endsWith('database.types.ts'))).toBe(false);
    expect(sourceFiles.some((f) => f.rel.includes('/__tests__/'))).toBe(false);
  });

  it('the .from() matcher actually matches real query code', () => {
    // Proves the regex is not silently matching nothing. quiz_responses and
    // concept_mastery are both live tables queried in the scanned tree.
    const corpus = sourceFiles.map((f) => stripComments(readFileSync(f.abs, 'utf8'))).join('\n');
    expect(fromLiteralRegex('quiz_responses').test(corpus)).toBe(true);
    expect(fromLiteralRegex('concept_mastery').test(corpus)).toBe(true);
  });

  it('detects a planted violation of every rule', () => {
    const planted = `
      const a = await supabaseAdmin.from('question_responses').select('is_correct');
      const b = await supabaseAdmin.from('topic_mastery').select('*');
      const c = await supabaseAdmin.from('cme_concept_state').select('*');
      const d = await supabaseAdmin.from("chat_messages").select('*');
      const e = await supabaseAdmin
        .from('concept_mastery')
        .select('next_review_date')
        .lte('next_review_date', today);
    `;
    const rules = findViolations('planted.ts', planted).map((v) => v.rule);
    expect(rules).toContain('question_responses');
    expect(rules.filter((r) => r === 'tombstoned_table')).toHaveLength(2);
    expect(rules).toContain('missing_table');
    expect(rules).toContain('ghost_next_review_date');
  });

  it('does NOT fire on comments that merely warn about the dead names', () => {
    const warningOnly = `
      // Do NOT read next_review_date on concept_mastery — it is a ghost column.
      /* The legacy .from('question_responses') table has zero rows. */
      const ok = await supabaseAdmin.from('concept_mastery').select('next_review_at');
    `;
    expect(findViolations('warning-only.ts', warningOnly)).toEqual([]);
  });

  it('does NOT fire on the legitimate spaced_repetition_cards.next_review_date', () => {
    const legit = `
      const cards = await supabaseAdmin
        .from('spaced_repetition_cards')
        .select('id, next_review_date')
        .lte('next_review_date', today);
    `;
    expect(findViolations('legit.ts', legit)).toEqual([]);
  });
});

describe('dead-table / ghost-column canary — no application code reads a dead source', () => {
  it('no query targets question_responses, topic_mastery, cme_concept_state, or chat_messages', () => {
    const hits = unallowed.filter((v) => v.rule !== 'ghost_next_review_date').map(render);
    expect(
      hits,
      'a query targets a table that cannot return real data — repoint it (question_responses → quiz_responses)',
    ).toEqual([]);
  });

  it('no concept_mastery query reads the ghost next_review_date column', () => {
    const hits = unallowed.filter((v) => v.rule === 'ghost_next_review_date').map(render);
    expect(
      hits,
      'concept_mastery.next_review_date is never written (DEFAULT CURRENT_DATE + 1) — use next_review_at',
    ).toEqual([]);
  });

  it('every allowlist entry is still live, carries a reason, and carries a TODO', () => {
    // A stale allowlist is how a guard rots into a rubber stamp. Each entry must
    // correspond to a violation that really still exists. Vacuous while the
    // allowlist is empty — which is the point; the assertions below only start
    // doing work the moment someone grants themselves an exception.
    for (const a of ALLOWLIST) {
      expect(a.reason.length, `allowlist entry ${a.rel} needs a reason`).toBeGreaterThan(30);
      expect(a.todo, `allowlist entry ${a.rel} needs a TODO(owner)`).toMatch(/^TODO\([a-z-]+\):/);
      expect(
        allViolations.some((v) => v.rel === a.rel && v.rule === a.rule),
        `allowlist entry ${a.rel} [${a.rule}] no longer matches any violation — delete it`,
      ).toBe(true);
    }
  });
});

describe('practice history route is wired to the live tables (CEO defect #9)', () => {
  const routeSrc = readFileSync(
    resolve(REPO_ROOT, 'apps/host/src/app/api/practice/history/route.ts'),
    'utf8',
  );
  const code = stripComments(routeSrc);

  it('reads errorPatterns and bloomDistribution off quiz_responses', () => {
    expect(fromLiteralRegex('quiz_responses').test(code)).toBe(true);
    expect(code).toContain('error_type');
    // quiz_responses.bloom_level — NOT the legacy bloom_level_attempted.
    expect(code).toContain('bloom_level');
    expect(code).not.toContain('bloom_level_attempted');
  });

  it('counts due reviews off next_review_at, never the ghost column', () => {
    expect(code).toContain('next_review_at');
    expect(code).not.toContain('next_review_date');
  });

  it('still reads avgScore from the server-written quiz_sessions.score_percent (P1 untouched)', () => {
    // The panel that always WORKED. Pinned so a future repointing sweep does not
    // "helpfully" recompute it from responses and break P1.
    expect(fromLiteralRegex('quiz_sessions').test(code)).toBe(true);
    expect(code).toContain('score_percent');
  });
});
