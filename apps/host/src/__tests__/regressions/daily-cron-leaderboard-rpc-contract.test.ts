import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * daily-cron `recalculateLeaderboards` — set-based RPC contract canary.
 *
 * MIRRORS the REG-118 daily-cron static-source contract canary
 * (`supabase/functions/daily-cron/__tests__/contract.test.ts`) and extends it to
 * the leaderboard step. Same rationale, restated because it is the reason this
 * file is static rather than behavioural: daily-cron/index.ts is a MONOLITHIC
 * `Deno.serve()` handler — the handler is passed inline at module top level and
 * is NOT exported, and its service-role client is built from a top-level esm.sh
 * import. There is no seam to inject a mocked Supabase client, so the step
 * cannot be imported and invoked. We read the source as TEXT and assert the
 * load-bearing structure. No execution, no network, deterministic.
 *
 * This file lives in the VITEST lane (the REG-118 canary is a `Deno.test` file
 * that only runs in CI's separate `edge-function-tests` job), so the leaderboard
 * contract is enforced by `npm test` too. The Deno canary is extended in
 * parallel; neither is a substitute for the other.
 *
 * THE DEFECT THIS PINS (DSA audit, 2026-07-29)
 * ============================================
 * `recalculateLeaderboards` used to
 *   `.select('id,grade,xp_total')` the WHOLE students table with no limit,
 *   group + sort it in JS, and assign `rank = i + 1` by array index.
 * PostgREST silently truncates an unfiltered select at its max-rows cap (1000 by
 * default). Past 1000 active students the fetch returned an arbitrary partial
 * page: everyone outside it kept a permanently stale rank, and everyone inside
 * it was ranked against a fraction of their own grade cohort. Silent in every
 * case — no error, no 207, no log.
 *
 * The fix moves ranking into `public.recalculate_leaderboard_snapshots()`
 * (migration 20260729130100), which ranks the entire population in-database via
 * ROW_NUMBER() and returns the number of students written.
 *
 * WHAT WOULD TURN THIS RED
 * ------------------------
 *   - the step reverting to a client-side `.select` + `.sort` ranking (the
 *     unbounded-fetch defect regressing),
 *   - the RPC being renamed or the call dropped,
 *   - the `>= 2` feature-flag auto-enable being driven off something other than
 *     the RPC's return value (e.g. a hardcoded number, or a second query),
 *   - the RPC losing ROW_NUMBER / the population filter / the id tie-break,
 *   - the RPC's EXECUTE grant widening beyond service_role.
 */

// ── Repo-root resolution (cwd is apps/host under vitest) ─────────────────────

function findRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    if (
      fs.existsSync(path.join(dir, 'apps')) &&
      fs.existsSync(path.join(dir, 'supabase', 'functions'))
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
const CRON_SRC = fs.readFileSync(
  path.join(REPO_ROOT, 'supabase', 'functions', 'daily-cron', 'index.ts'),
  'utf8',
);
const RPC_MIGRATION = path.join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260729130100_recalculate_leaderboard_snapshots_rpc.sql',
);

/** Strip `//` and `/* *​/` comments — the fix's own explanatory comments quote
 *  the OLD code verbatim, and must never satisfy an assertion. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

/** The body of `recalculateLeaderboards`, comments stripped. */
function leaderboardBody(): string {
  const src = stripTsComments(CRON_SRC);
  const start = src.indexOf('async function recalculateLeaderboards');
  if (start === -1) return '';
  const end = src.indexOf('\n}', start);
  return src.slice(start, end === -1 ? undefined : end + 2);
}

// ════════════════════════════════════════════════════════════════════════════
// 0. Preconditions — never pass vacuously.
// ════════════════════════════════════════════════════════════════════════════

describe('daily-cron leaderboard canary: preconditions', () => {
  it('daily-cron/index.ts is readable and is a Deno.serve Edge Function', () => {
    expect(CRON_SRC.length).toBeGreaterThan(1000);
    expect(CRON_SRC).toContain('Deno.serve(');
  });

  it('recalculateLeaderboards is still defined and still registered as a cron step', () => {
    expect(leaderboardBody().length).toBeGreaterThan(100);
    const src = stripTsComments(CRON_SRC);
    // Step registration (REG-118 style): name + dispatch.
    expect(
      src.includes('leaderboard_entries:') || src.includes("'leaderboard_entries'"),
      'the leaderboard_entries cron step must remain registered',
    ).toBe(true);
    expect(src).toContain('recalculateLeaderboards(sb)');
  });

  it('the RPC migration exists on disk', () => {
    expect(fs.existsSync(RPC_MIGRATION)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. The step calls the RPC — and no longer ranks in JS.
// ════════════════════════════════════════════════════════════════════════════

describe('daily-cron leaderboard canary: ranking is delegated to the RPC', () => {
  const body = leaderboardBody();

  it("calls supabase.rpc('recalculate_leaderboard_snapshots')", () => {
    expect(body).toMatch(/\.rpc\(\s*['"]recalculate_leaderboard_snapshots['"]\s*\)/);
  });

  it('no longer performs an unbounded students .select() inside the step', () => {
    // The exact defect: an unfiltered select silently truncated at PostgREST's
    // 1000-row cap. Any `.from('students')` read here is a regression.
    expect(body).not.toMatch(/\.from\(\s*['"]students['"]\s*\)/);
    expect(body).not.toMatch(/\.select\(/);
  });

  it('no longer ranks in JavaScript (no .sort, no rank-by-array-index)', () => {
    expect(body).not.toMatch(/\.sort\(/);
    expect(body).not.toMatch(/rank\s*:\s*i\s*\+\s*1/);
    expect(body).not.toMatch(/forEach\(/);
  });

  it('no longer upserts leaderboard_snapshots from the client (the RPC owns the write)', () => {
    // NB: the RPC *name* contains "leaderboard_snapshots", so this must match
    // the TABLE access specifically, not the bare substring.
    expect(body).not.toMatch(/\.from\(\s*['"]leaderboard_snapshots['"]\s*\)/);
    expect(body).not.toMatch(/\.upsert\(/);
  });

  it('still throws on RPC error so the step surfaces in the 207 errors map', () => {
    // Step contract from REG-118: a failing step throws, Promise.allSettled
    // isolates it, and the run reports 207 rather than silently returning 0.
    expect(body).toMatch(/if \(error\) throw new Error\(`recalculateLeaderboards:/);
  });

  it('logs counts only — no student identifiers (P13)', () => {
    const logLines = body.split('\n').filter((l) => /console\.(log|warn|error)/.test(l));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toMatch(/student_id|studentId|\bemail\b|\bname\b/i);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. The `>= 2` feature-flag gate is driven off the RPC return value.
// ════════════════════════════════════════════════════════════════════════════

describe('daily-cron leaderboard canary: the flag gate reads the RPC return', () => {
  const body = leaderboardBody();

  it('coerces the RPC return to a number and returns it as the step count', () => {
    expect(body).toMatch(/const ranked = Number\(data \?\? 0\)/);
    expect(body).toMatch(/return ranked/);
  });

  it('short-circuits on a non-finite or non-positive RPC return', () => {
    expect(body).toMatch(/!Number\.isFinite\(ranked\)\s*\|\|\s*ranked <= 0/);
  });

  it('gates the leaderboard auto-enable on `ranked >= 2` — the RPC value, not a re-query', () => {
    // The threshold semantics must stay attached to "number of students
    // ranked", which is what entries.length used to mean. A second query or a
    // hardcoded number here would silently decouple the flag from reality.
    expect(body).toMatch(/if \(ranked >= 2\)/);
    const gateIdx = body.search(/if \(ranked >= 2\)/);
    const gateBlock = body.slice(gateIdx);
    expect(gateBlock).toMatch(/\.from\(\s*['"]feature_flags['"]\s*\)/);
    expect(gateBlock).toContain('leaderboard_global');
    expect(gateBlock).toContain('wave1_leaderboard');
  });

  it('flag mutation stayed in TypeScript (ops-owned) — the RPC must not touch feature_flags', () => {
    const sql = fs.readFileSync(RPC_MIGRATION, 'utf8').replace(/--[^\n]*$/gm, '');
    const fnBody = sql.slice(sql.indexOf('AS $$'), sql.indexOf('$$;') + 3);
    expect(fnBody).not.toMatch(/feature_flags/i);
  });

  it('a failed flag flip is non-fatal (ranks are already committed by the RPC)', () => {
    expect(body).toMatch(/if \(flagErr\) console\.warn/);
    // ...and it must NOT throw, which would mark a successful ranking run failed.
    const gateBlock = body.slice(body.search(/if \(ranked >= 2\)/));
    expect(gateBlock).not.toMatch(/throw/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. The RPC itself preserves the ranking semantics it replaced.
// ════════════════════════════════════════════════════════════════════════════

describe('recalculate_leaderboard_snapshots RPC: semantics preserved', () => {
  const sql = fs.readFileSync(RPC_MIGRATION, 'utf8').replace(/--[^\n]*$/gm, '');
  // The executable body only. The trailing `COMMENT ON FUNCTION ... IS '...'`
  // is a SQL STRING LITERAL that narrates the change and legitimately contains
  // the words RANK / DENSE_RANK / "feature flags" — scanning the whole file
  // would make the negative assertions below fail on documentation.
  const fnBody = sql.slice(sql.indexOf('AS $$'), sql.indexOf('$$;') + 3);

  it('the executable body was extracted (non-vacuity)', () => {
    expect(fnBody).toContain('BEGIN');
    expect(fnBody.length).toBeGreaterThan(200);
  });

  it('is an idempotent CREATE OR REPLACE returning integer', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.recalculate_leaderboard_snapshots\(\)\s*RETURNS integer/i,
    );
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it('uses ROW_NUMBER (distinct consecutive ranks), not RANK or DENSE_RANK', () => {
    // The JS assigned rank by array index, so tied students got DISTINCT
    // consecutive ranks. RANK() would gap and DENSE_RANK() would share — either
    // silently changes what every student sees.
    expect(fnBody).toMatch(/ROW_NUMBER\(\)\s*OVER\s*\(/i);
    expect(fnBody).not.toMatch(/\bDENSE_RANK\s*\(/i);
    expect(fnBody).not.toMatch(/[^_]\bRANK\s*\(\s*\)\s*OVER/i);
  });

  it('partitions by COALESCE(grade, \'unknown\') and orders by xp_total DESC with an id tie-break', () => {
    expect(fnBody).toMatch(/PARTITION BY COALESCE\(s\.grade,\s*'unknown'\)/i);
    expect(fnBody).toMatch(/ORDER BY COALESCE\(s\.xp_total,\s*0\) DESC,\s*s\.id/i);
  });

  it('keeps the exact population filter the PostgREST query had', () => {
    expect(fnBody).toMatch(/WHERE s\.is_active = true/i);
    expect(fnBody).toMatch(/AND s\.deleted_at IS NULL/i);
  });

  it('has NO row limit (the whole point — the JS path was capped at 1000)', () => {
    const stmtStart = fnBody.search(/INSERT INTO public\.leaderboard_snapshots/i);
    expect(stmtStart).toBeGreaterThan(-1);
    const stmt = fnBody.slice(stmtStart, fnBody.indexOf('GET DIAGNOSTICS', stmtStart));
    expect(stmt).not.toMatch(/\bLIMIT\b/i);
  });

  it('upserts on student_id and returns ROW_COUNT (= students ranked, what the >=2 gate reads)', () => {
    expect(fnBody).toMatch(/ON CONFLICT \(student_id\) DO UPDATE SET/i);
    // Unconditional DO UPDATE: a `WHERE ... IS DISTINCT FROM` short-circuit
    // would make ROW_COUNT mean "rows CHANGED", which reads 0 on a quiet night
    // and silently decouples the caller's >= 2 gate.
    expect(fnBody).not.toMatch(/DO UPDATE SET[\s\S]*?\bWHERE\b/i);
    expect(fnBody).toMatch(/GET DIAGNOSTICS v_rows = ROW_COUNT/i);
    expect(fnBody).toMatch(/RETURN v_rows/i);
  });

  it('is SECURITY DEFINER with a pinned search_path and service_role-only EXECUTE', () => {
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = public, pg_temp/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.recalculate_leaderboard_snapshots\(\) FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.recalculate_leaderboard_snapshots\(\) FROM anon/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.recalculate_leaderboard_snapshots\(\) FROM authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.recalculate_leaderboard_snapshots\(\) TO service_role/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. The DORMANT sibling RPC must stay unwired.
//
//    `20260729130200_recalculate_performance_scores_rpc.sql` ships alongside
//    these fixes but is DELIBERATELY NOT CALLED — assessment rejected
//    activation, because wiring it would switch a scoring pipeline ON for the
//    first time (writing performance_scores + score_history and firing
//    score_milestone notifications at every student), not perform a
//    like-for-like port. A drive-by swap is exactly the kind of change that
//    looks like a cleanup in review.
// ════════════════════════════════════════════════════════════════════════════

describe('dormant recalculate_performance_scores RPC: must remain unwired', () => {
  it('the migration exists but nothing in daily-cron calls it', () => {
    const migration = path.join(
      REPO_ROOT,
      'supabase',
      'migrations',
      '20260729130200_recalculate_performance_scores_rpc.sql',
    );
    expect(fs.existsSync(migration)).toBe(true);
    // Stripping comments matters here: the TODO(assessment) note in daily-cron
    // names the function on purpose.
    expect(stripTsComments(CRON_SRC)).not.toMatch(
      /\.rpc\(\s*['"]recalculate_performance_scores['"]/,
    );
  });

  it('no caller anywhere in supabase/functions or apps/host invokes it', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.next', '__tests__', '_archive'].includes(entry.name)) continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
        const src = stripTsComments(fs.readFileSync(full, 'utf8'));
        if (/\.rpc\(\s*['"]recalculate_performance_scores['"]/.test(src)) {
          hits.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(REPO_ROOT, 'supabase', 'functions'));
    walk(path.join(REPO_ROOT, 'apps', 'host', 'src'));
    walk(path.join(REPO_ROOT, 'packages'));
    expect(hits).toEqual([]);
  });
});
