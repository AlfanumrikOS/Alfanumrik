import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * SILENT-SWALLOW CANARY (G5) — student-facing server code may not discard a
 * supabase-js error.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase-js` does NOT throw. Every query resolves with `{ data, error }`.
 * Two idioms turn that into a permanently invisible outage, and both shipped:
 *
 *   1. `const { data } = await supabase.from(…)…; return data ?? [];`
 *      The error is never bound, so a query against a column that does not
 *      exist returns `data: null` and the caller serves an empty list. This is
 *      exactly how `/api/foxy/suggest-prompts` hid THREE queries filtering on
 *      nonexistent columns: the endpoint returned 200 with a plausible-looking
 *      empty payload, so the UI showed its normal empty state and no alert
 *      fired.
 *
 *   2. `try { const { data } = await supabase.from(…).insert(…); if (data) {…} }
 *       catch (e) { log(e) }`
 *      The `catch` is UNREACHABLE for the failure mode that actually happens —
 *      constraint violation, RLS denial, PGRST204 schema-cache miss — because
 *      none of those throw. This is how all seven `foxy_chat_messages` write
 *      sites hid a 21-day outage in which Foxy persisted zero messages while
 *      every turn appeared to succeed.
 *
 * Neither is catchable by tsc (the destructure is well-typed), by lint, or by
 * a mock-backed unit test (a mock that resolves `{data: [], error: null}` makes
 * the broken and the correct code indistinguishable). Only a structural scan
 * tells "no rows" apart from "no error handling".
 *
 * SCOPE — student-facing server code
 * ----------------------------------
 * The API routes and shared-lib modules on the learning path. Deliberately NOT
 * the whole monorepo: the same idioms exist across super-admin/ops surfaces in
 * the hundreds, and a guard that opens 190 findings on day one gets deleted
 * rather than acted on. The student lane is where a silent zero costs a
 * three-week outage nobody sees. Widening the scope is a follow-up (see the
 * TODO on SCAN_ROOTS), not a reason to not have this.
 *
 * DELIBERATE LIMITS (a canary that cries wolf gets deleted):
 *   - Only recognises a supabase call by a LITERAL `.from('table')`. RPC calls
 *     (`.rpc(...)`) and computed table refs are out of scope here.
 *   - `?? []` on something that is NOT a supabase `data` binding is legitimate
 *     defaulting and is not flagged — the binding must come from an
 *     `await …from('…')…` destructure in the same file.
 *   - A try-block that binds `error` ANYWHERE inside it is accepted, even if
 *     the handling is weak. This guard is about the unreachable-catch shape,
 *     not about how good the handling is.
 *   - Rule coverage of reads is a ratchet over a recorded baseline, not zero
 *     tolerance; WRITES that swallow are the zero-tolerance half, because a
 *     lost write is unrecoverable while a lost read re-renders next time.
 *   So: PASSING does not prove every error is handled. FAILING always means an
 *   error value is being thrown away where a student would never find out.
 *
 * IF THIS TEST FAILS: destructure `error` and act on it. Adding to BASELINE
 * needs a reason and a TODO(owner) — it is not the default.
 */

function findRepoRoot(): string {
  const candidates = [resolve(process.cwd(), '..', '..'), resolve(process.cwd(), '..'), process.cwd()];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/lib/src'))) return c;
  }
  throw new Error('silent-supabase-error-swallow: could not locate the monorepo root');
}

const REPO_ROOT = findRepoRoot();

/**
 * TODO(testing): widen to all of `apps/host/src/app/api` + `packages/lib/src`
 * once the student lane is clean. Repo-wide the same rules currently find ~71
 * data-default and ~119 unreachable-catch sites; that is a remediation
 * programme, not a gate.
 */
const SCAN_ROOTS = [
  'apps/host/src/app/api/foxy',
  'apps/host/src/app/api/quiz',
  'apps/host/src/app/api/v2',
  'apps/host/src/app/api/learner',
  'apps/host/src/app/api/learn',
  'apps/host/src/app/api/revision',
  'apps/host/src/app/api/rhythm',
  'apps/host/src/app/api/dive',
  'apps/host/src/app/api/synthesis',
  'apps/host/src/app/api/practice',
  'apps/host/src/app/api/dashboard',
  'apps/host/src/app/api/student',
  'apps/host/src/app/api/exams',
  'apps/host/src/app/api/progress',
  'packages/lib/src/quiz',
  'packages/lib/src/learn',
  'packages/lib/src/foxy',
  'packages/lib/src/learner-model',
  'packages/lib/src/pulse',
  'packages/lib/src/domains',
] as const;

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', '.next', 'dist', 'build', 'coverage']);
const SKIP_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;
const toPosix = (p: string) => p.split(sep).join('/');

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
      out.push({ rel: toPosix(relative(REPO_ROOT, abs)), abs });
    }
  };
  for (const r of SCAN_ROOTS) walk(resolve(REPO_ROOT, r));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Blank out comment bodies, preserving newlines and string literals. Without
 * this, the incident write-up at the top of
 * `api/foxy/_lib/message-persistence.ts` — which QUOTES the defective idiom in
 * a doc comment so the next reader recognises it — would be reported as an
 * instance of the defect it exists to prevent.
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

export type RuleId = 'data_default_without_error' | 'unreachable_catch_write' | 'unreachable_catch_read';

export interface Violation {
  rule: RuleId;
  rel: string;
  line: number;
  detail: string;
}

/** A postgrest query builder, recognised by a literal table name. */
const SUPABASE_CALL = /\.from\(\s*['"`][A-Za-z_]/;
const WRITE_VERB = /\.(insert|upsert|update|delete)\(/;

/** How far after a destructure we look for the `?? []` that hides the error. */
const USE_WINDOW_CHARS = 3000;

export function findViolations(rel: string, rawSource: string): Violation[] {
  const s = stripComments(rawSource);
  const found: Violation[] = [];

  // ── rule 1: `const { data } = await supabase.from(…)` then `data ?? []` ────
  const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+([\s\S]{0,400}?);/g;
  for (const m of s.matchAll(DESTRUCTURE)) {
    const pattern = m[1];
    const rhs = m[2];
    if (!SUPABASE_CALL.test(rhs)) continue;
    // The error IS bound — out of scope, however weakly it is then handled.
    if (/\berror\b/.test(pattern)) continue;

    const dm = /\bdata\b\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:=\s*(\[\]|\{\}))?/.exec(pattern);
    if (!dm) continue;
    const bound = dm[1] || 'data';

    if (dm[2]) {
      found.push({
        rule: 'data_default_without_error',
        rel,
        line: lineOf(s, m.index),
        detail: `{ data = ${dm[2]} } destructured from a supabase call with no \`error\` binding`,
      });
      continue;
    }

    const after = s.slice(m.index + m[0].length, m.index + m[0].length + USE_WINDOW_CHARS);
    const useRe = new RegExp(String.raw`\b${bound}\s*(?:\?\?|\|\|)\s*(\[\]|\{\})`);
    const use = useRe.exec(after);
    if (use) {
      found.push({
        rule: 'data_default_without_error',
        rel,
        line: lineOf(s, m.index),
        detail: `\`${bound} ${use[0].includes('??') ? '??' : '||'} ${use[1]}\` on a supabase result whose \`error\` was never bound`,
      });
    }
  }

  // ── rules 2 & 3: try { await supabase.from(…) } catch — unreachable ───────
  let ti = -1;
  while ((ti = s.indexOf('try {', ti + 1)) !== -1) {
    let depth = 0;
    let end = -1;
    for (let j = ti + 4; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    if (!/^\}\s*catch/.test(s.slice(end, end + 40))) continue;

    const body = s.slice(ti, end);
    if (!SUPABASE_CALL.test(body)) continue;
    if (!/\bawait\b/.test(body)) continue;
    if (/\berror\b/.test(body)) continue;

    const isWrite = WRITE_VERB.test(body);
    found.push({
      rule: isWrite ? 'unreachable_catch_write' : 'unreachable_catch_read',
      rel,
      line: lineOf(s, ti),
      detail: isWrite
        ? 'try/catch around a supabase WRITE with no `error` binding — supabase-js resolves ' +
          '{data:null,error} instead of throwing, so a rejected write is silently lost'
        : 'try/catch around a supabase READ with no `error` binding — the catch cannot fire ' +
          'for a query error, so the failure reads as "no data"',
    });
  }

  return found;
}

// ── baseline ──────────────────────────────────────────────────────────────────
interface BaselineGroup {
  rule: RuleId;
  reason: string;
  todo: string;
  files: string[];
}

/**
 * PRE-EXISTING instances, recorded on the day this guard was written so it can
 * gate NEW code immediately instead of waiting on a remediation programme.
 * This is a RATCHET: the set may shrink but never grow, and the staleness
 * assertion forces an entry out the moment its file is fixed.
 *
 * The `unreachable_catch_write` group is deliberately tiny and is the one to
 * clear first — a swallowed write is unrecoverable, which is precisely the
 * Foxy 21-day outage. A swallowed read re-renders correctly on the next
 * request once the underlying query is fixed.
 */
const BASELINE: BaselineGroup[] = [
  {
    rule: 'data_default_without_error',
    reason:
      'Read paths on the student learning lane that default a supabase result to []/{} without ' +
      'ever binding the driver error. Each is a potential silent zero of the /api/foxy/' +
      'suggest-prompts kind: a query that starts failing (dropped column, renamed table, RLS ' +
      'change) degrades to an empty section that looks like "no data yet".',
    todo: 'TODO(backend): bind `error`, log it, and distinguish empty-from-failed at each site.',
    files: [
      'apps/host/src/app/api/exams/sync-mastery/route.ts',
      'apps/host/src/app/api/foxy/_lib/cognitive-context.ts',
      'apps/host/src/app/api/foxy/route.ts',
      'apps/host/src/app/api/synthesis/parent-share/route.ts',
      'packages/lib/src/domains/profile.ts',
      'packages/lib/src/foxy/curriculum-scope.ts',
      'packages/lib/src/learn/build-rhythm-queue.ts',
      'packages/lib/src/learn/srs-quiz-review.ts',
      'packages/lib/src/learner-model/due-reviews.ts',
      'packages/lib/src/quiz/post-submit-telemetry.ts',
    ],
  },
  {
    rule: 'unreachable_catch_write',
    reason:
      'Two remaining student-lane writes still wrapped in the unreachable-catch shape that cost ' +
      'Foxy 21 days of message persistence. Neither is on the quiz-submission path (that goes ' +
      'through the atomic RPC), but both lose data silently when they fail.',
    todo: 'TODO(backend): route these through an error-binding helper the way api/foxy/_lib/message-persistence.ts does.',
    files: [
      'apps/host/src/app/api/foxy/remediation/route.ts',
      'apps/host/src/app/api/student/subjects/route.ts',
    ],
  },
  {
    rule: 'unreachable_catch_read',
    reason:
      'Read-side unreachable catches on the student lane. Lower severity than the write group ' +
      '(nothing is lost permanently) but the same blindness: the catch can only fire for a ' +
      'thrown JS error, never for the PostgREST error that actually occurs.',
    todo: 'TODO(backend): destructure `error` in each try body; the catch can then stay for genuine throws.',
    files: [
      'apps/host/src/app/api/foxy/_lib/cognitive-context.ts',
      'apps/host/src/app/api/foxy/_lib/quota.ts',
      'apps/host/src/app/api/foxy/route.ts',
      'apps/host/src/app/api/learner/memory/route.ts',
      'apps/host/src/app/api/learner/review/grade/route.ts',
      'apps/host/src/app/api/quiz/ncert-questions/route.ts',
      'apps/host/src/app/api/student/engagement/route.ts',
      'apps/host/src/app/api/v2/student/progress/route.ts',
      'packages/lib/src/domains/profile.ts',
      'packages/lib/src/domains/quiz.ts',
      'packages/lib/src/foxy/curriculum-scope.ts',
      'packages/lib/src/learn/build-rhythm-queue.ts',
      'packages/lib/src/learn/foxy-long-memory.ts',
      'packages/lib/src/learn/srs-quiz-review.ts',
      'packages/lib/src/learner-model/due-reviews.ts',
      'packages/lib/src/quiz/post-submit-telemetry.ts',
      'packages/lib/src/quiz/submit-side-effects.ts',
    ],
  },
];

const isBaselined = (v: Violation) =>
  BASELINE.some((g) => g.rule === v.rule && g.files.includes(v.rel));

const sourceFiles = collectSourceFiles();
const allViolations = sourceFiles.flatMap(({ rel, abs }) => findViolations(rel, readFileSync(abs, 'utf8')));
const newViolations = allViolations.filter((v) => !isBaselined(v));

const render = (v: Violation) => `${v.rel}:${v.line} [${v.rule}] ${v.detail}`;

// ── assertions ────────────────────────────────────────────────────────────────
describe('silent-swallow canary — scan is non-vacuous', () => {
  it('walked the student-facing server lane', () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(sourceFiles.some((f) => f.rel === 'apps/host/src/app/api/foxy/route.ts')).toBe(true);
    expect(sourceFiles.some((f) => f.rel === 'packages/lib/src/quiz/submit-side-effects.ts')).toBe(true);
    expect(sourceFiles.some((f) => f.rel.includes('/__tests__/'))).toBe(false);
  });

  it('the matcher finds real code, not nothing', () => {
    // If the rules silently stopped matching, `newViolations` would be empty
    // for the wrong reason and this guard would be a tautology. The recorded
    // baseline is the proof of life.
    expect(allViolations.length).toBeGreaterThan(20);
  });

  it('detects a planted instance of every rule', () => {
    const planted = [
      "const { data: rows } = await supabaseAdmin.from('concept_mastery').select('id');",
      'return rows ?? [];',
      'try {',
      "  await supabaseAdmin.from('foxy_chat_messages').insert([row]);",
      '} catch (e) { console.warn(e); }',
      'try {',
      "  const { data } = await supabaseAdmin.from('quiz_sessions').select('id');",
      '  if (data) use(data);',
      '} catch { /* ignore */ }',
    ].join('\n');
    const rules = findViolations('planted.ts', planted).map((v) => v.rule);
    expect(rules).toContain('data_default_without_error');
    expect(rules).toContain('unreachable_catch_write');
    expect(rules).toContain('unreachable_catch_read');
  });

  it('detects the in-destructure default form too', () => {
    const planted = "const { data: rows = [] } = await supabase.from('topics').select('id');";
    expect(findViolations('p.ts', planted).map((v) => v.rule)).toEqual(['data_default_without_error']);
  });
});

describe('silent-swallow canary — does not fire on legitimate code', () => {
  it('accepts the correct shape: error bound, then defaulted', () => {
    const ok = [
      "const { data, error } = await supabaseAdmin.from('concept_mastery').select('id');",
      "if (error) { logger.error('read failed', { code: error.code }); return []; }",
      'return data ?? [];',
    ].join('\n');
    expect(findViolations('ok.ts', ok)).toEqual([]);
  });

  it('accepts a try/catch that DOES bind the error', () => {
    const ok = [
      'try {',
      "  const { error } = await supabaseAdmin.from('foxy_chat_messages').insert([row]);",
      '  if (error) logFailure(error);',
      '} catch (e) { logger.warn(e); }',
    ].join('\n');
    expect(findViolations('ok.ts', ok)).toEqual([]);
  });

  it('accepts ordinary defaulting that has nothing to do with supabase', () => {
    const ok = [
      'const rows = props.rows ?? [];',
      'const opts = JSON.parse(raw) ?? {};',
      'const data = await fetch(url).then((r) => r.json());',
      'return data ?? [];',
    ].join('\n');
    expect(findViolations('ok.ts', ok)).toEqual([]);
  });

  it('does NOT indict a doc comment that quotes the defective idiom', () => {
    // `api/foxy/_lib/message-persistence.ts` reproduces the broken pattern in
    // its header so the next reader recognises it on sight. A guard that fires
    // on its own incident write-up teaches people to delete the write-up.
    const doc = [
      '/**',
      " *   const { data } = await supabaseAdmin.from('foxy_chat_messages').insert([...]);",
      ' *   } catch (e) { console.warn(e) }',
      ' */',
      'export const x = 1;',
    ].join('\n');
    expect(findViolations('doc.ts', doc)).toEqual([]);
    // ...and the real file is likewise not flagged.
    expect(
      findViolations(
        'apps/host/src/app/api/foxy/_lib/message-persistence.ts',
        readFileSync(resolve(REPO_ROOT, 'apps/host/src/app/api/foxy/_lib/message-persistence.ts'), 'utf8'),
      ),
    ).toEqual([]);
  });
});

describe('silent-swallow canary — no NEW silent swallow in student-facing code', () => {
  it('adds no unbaselined instance of any rule', () => {
    const report = newViolations.map((v) => `  ${render(v)}`).join('\n');
    expect(
      newViolations.map(render),
      `supabase-js does not throw — these discard the driver error, so the failure is ` +
        `invisible to CI, to Sentry, and to the student (who just sees an empty ` +
        `section):\n${report}\n\n` +
        `Fix by destructuring \`error\` and acting on it. BASELINE is for pre-existing debt ` +
        `only and may not grow.`,
    ).toEqual([]);
  });

  it('the baseline is a ratchet, not permanent cover', () => {
    for (const group of BASELINE) {
      for (const rel of group.files) {
        expect(
          allViolations.some((v) => v.rule === group.rule && v.rel === rel),
          `${rel} no longer violates ${group.rule} — delete it from BASELINE so the ratchet tightens`,
        ).toBe(true);
      }
    }
  });

  it('every baseline group carries a reason and a TODO with an owner', () => {
    for (const group of BASELINE) {
      expect(group.reason.length, `${group.rule} needs a real reason`).toBeGreaterThan(60);
      expect(group.todo, `${group.rule} needs TODO(<owner>):`).toMatch(/^TODO\([a-z-]+\):/);
      expect(group.files.length).toBeGreaterThan(0);
    }
  });
});

describe('silent-swallow canary — the Foxy write seam stays the only writer', () => {
  const FOXY_API = resolve(REPO_ROOT, 'apps/host/src/app/api/foxy');
  const SEAM = 'apps/host/src/app/api/foxy/_lib/message-persistence.ts';

  function foxyFiles(): { rel: string; abs: string }[] {
    const out: { rel: string; abs: string }[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = resolve(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(abs);
          continue;
        }
        if (!/\.[cm]?tsx?$/.test(e.name) || SKIP_FILE.test(e.name)) continue;
        out.push({ rel: toPosix(relative(REPO_ROOT, abs)), abs });
      }
    };
    walk(FOXY_API);
    return out;
  }

  it('every foxy_chat_messages write goes through message-persistence.ts', () => {
    // Zero tolerance, NOT baselined. This is the exact 21-day-outage surface:
    // seven write sites, each with its own unreachable catch. One seam that
    // binds `error` is the fix; a new direct write reintroduces the incident.
    const offenders: string[] = [];
    for (const { rel, abs } of foxyFiles()) {
      if (rel === SEAM) continue;
      const s = stripComments(readFileSync(abs, 'utf8'));
      const re = /\.from\(\s*['"`]foxy_chat_messages['"`]\s*\)([\s\S]{0,400}?)(?:;|\n\s*\n)/g;
      for (const m of s.matchAll(re)) {
        if (WRITE_VERB.test(m[1])) offenders.push(`${rel}:${lineOf(s, m.index)}`);
      }
    }
    expect(
      offenders,
      'a foxy_chat_messages write bypasses the message-persistence seam — that seam is the ' +
        'only place the driver error is surfaced',
    ).toEqual([]);
  });

  it('the seam itself binds and logs the driver error on both write paths', () => {
    const src = readFileSync(resolve(REPO_ROOT, SEAM), 'utf8');
    // insert path and update path each destructure `error` and branch on it.
    expect(src).toMatch(/const\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s+supabaseAdmin/);
    expect(src).toMatch(/const\s*\{\s*error\s*\}\s*=\s*await\s+supabaseAdmin/);
    expect(src.match(/if\s*\(\s*error\s*\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src).toContain('foxy.message_persist_failed');
  });
});
