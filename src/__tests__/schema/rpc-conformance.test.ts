import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * STATIC RPC-conformance guard (no DB). Prevents the REG-144 CLASS of defect:
 * a `.rpc('<name>')` call whose target function is NOT defined anywhere in the
 * APPLIED migration path, so it 500s the instant that code path runs on a fresh
 * DB (or any DB that only ever applied the root migrations).
 *
 * REG-144 itself was a pg_dump baseline that silently dropped
 * `update_learner_state_post_quiz` (PERFORM'd unguarded inside the quiz-submit
 * RPC). That specific footgun is pinned by the LIVE-DB probe in
 * `fresh-db-quiz-functions.test.ts`. THIS test is the cheap, always-on, no-DB
 * companion: it can't prove a function exists in pg_proc (only the live probe
 * can), but it CAN prove that every statically-resolvable `.rpc()` literal in
 * `src/` is at least DEFINED in SQL we actually apply — catching the most common
 * way the class re-appears (a new `.rpc('foo')` whose CREATE FUNCTION only ever
 * lived in `_legacy/`, or never existed at all).
 *
 * WHAT IT SCANS
 *  - Targets: every distinct `.rpc('<name>')` / `.rpc("<name>")` literal in
 *    src/**.{ts,tsx} (both quote styles, single- and multi-line call layout).
 *    Dynamic `.rpc(varName)` cannot be statically resolved and is IGNORED — see
 *    the dynamic-site note below.
 *  - Defined: every function created in the APPLIED path =
 *      supabase/migrations/00000000000000_baseline_from_prod.sql
 *      + supabase/migrations/*.sql      (root only — NOT _legacy/)
 *    Accounts for pg_dump quoting: `CREATE [OR REPLACE] FUNCTION "public"."name"`
 *    AND unquoted `CREATE [OR REPLACE] FUNCTION public.name` / `... FUNCTION name`.
 *
 * THE ASSERTION
 *  Every statically-resolved `.rpc()` target is EITHER defined in the applied
 *  path OR present in the documented KNOWN_GAPS allowlist below. A target that is
 *  neither fails this test, naming the offender(s) and their call site(s).
 *
 * KNOWN DYNAMIC SITE (intentionally NOT scannable, documented here for the audit
 * trail): `src/app/api/super-admin/db-performance/route.ts` calls
 * `supabaseAdmin.rpc(name)` inside `safeRpc(name)`, where `name` is a function
 * parameter, not a literal. Its three call-time literals
 * (`get_slow_functions_stats`, `get_connection_stats`, `get_table_sizes`) reach
 * `.rpc()` only via that variable, so the static scan never sees them. They are
 * STILL listed in KNOWN_GAPS (defensively, with their real reason) so the audit
 * record is complete even though this test cannot match them as targets.
 */

const REPO_ROOT = process.cwd();
const SRC_DIR = path.join(REPO_ROOT, 'src');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const BASELINE_FILE = path.join(MIGRATIONS_DIR, '00000000000000_baseline_from_prod.sql');

// ---------------------------------------------------------------------------
// KNOWN_GAPS — documented allowlist of `.rpc()` targets that are NOT (yet) in
// the applied migration path. Each entry MUST carry a short, true reason so it
// is visible and removable the moment the gap is closed.
//
// GOAL: DRAIN this list over time. Every fix that lands a compensating migration
// for one of these names should DELETE the corresponding entry — which keeps the
// test honest (a now-defined name that lingers here is dead weight, but never a
// failure). ADDING a new entry is a deliberate act that requires a tracked
// reason; the default outcome for an undefined `.rpc()` target is a test FAILURE,
// not a silent allowlist grant.
// ---------------------------------------------------------------------------
const KNOWN_GAPS: Record<string, string> = {
  // --- P1 — absent from prod; live 500s; REG-144-class; pending compensating migration ---
  get_question_history_stats:
    'P1 — absent from prod; live 500s; REG-144-class; pending compensating migration.',
  get_exam_paper:
    'P1 — absent from prod; live 500s; REG-144-class; pending compensating migration.',
  get_ncert_coverage:
    'P1 — absent from prod; live 500s; REG-144-class; pending compensating migration.',

  // --- P1 — recoverable from _legacy/ (CREATE FUNCTION exists only in the archived chain) ---
  predict_exam_score:
    'P1 — _legacy-recoverable (definition lives only under supabase/migrations/_legacy/).',

  // --- P2 — _legacy-recoverable; fail-soft (reached via the dynamic db-performance safeRpc) ---
  get_slow_functions_stats:
    'P2 — _legacy-recoverable; fail-soft via safeRpc (dynamic db-performance call; not a static target).',
  get_connection_stats:
    'P2 — _legacy-recoverable; fail-soft via safeRpc (dynamic db-performance call; not a static target).',
  get_table_sizes:
    'P2 — _legacy-recoverable; fail-soft via safeRpc (dynamic db-performance call; not a static target).',

  // --- P2 — orphaned dead code (the only caller, ChallengeMode.tsx, is unmounted) ---
  create_challenge:
    'P2 — orphaned dead code; ChallengeMode.tsx is unmounted (no live caller).',
  join_challenge:
    'P2 — orphaned dead code; ChallengeMode.tsx is unmounted (no live caller).',

  // --- test-only fail-soft helper; intentionally absent from any applied migration ---
  pg_get_constraintdef_by_name:
    'Test-only fail-soft helper; intentionally absent from the applied path by design.',

  // --- P2 — fail-OPEN; _legacy-recoverable; surfaced by THIS scan (plan-gate.ts daily-limit) ---
  // src/lib/plan-gate.ts:194 — daily permission-usage limit enforcement. Missing
  // from the applied path; CREATE FUNCTION exists only under _legacy/. On a fresh
  // DB the RPC errors and plan-gate FAILS OPEN (grants access, logs
  // `plan_gate_rpc_failed`), so daily limits are silently unenforced rather than a
  // hard 500. Tracked for a compensating migration alongside the P1 set.
  check_and_increment_permission_usage:
    'P2 — fail-OPEN; _legacy-recoverable; plan-gate.ts daily-limit RPC; pending compensating migration.',
};

// ---------------------------------------------------------------------------
// Static scanners
// ---------------------------------------------------------------------------

/**
 * Recursively collect APPLICATION .ts/.tsx files under src/. The REG-144 class
 * is about LIVE application `.rpc()` calls, so we deliberately exclude
 * `src/__tests__/` — test files carry illustrative example strings (this file's
 * own `.rpc('foo')` doc), ESLint-rule fixtures (e.g. the literal
 * ``supabase.rpc(`match_rag_chunks_ncert`)`` in no-direct-rag-rpc.test.ts), and
 * mock `.rpc()` controllers, none of which are real production call sites.
 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules can't appear under src/, but stay defensive.
      if (entry.name === 'node_modules') continue;
      // Skip the test tree — example/fixture/mock `.rpc()` strings live here.
      if (entry.name === '__tests__') continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Distinct `.rpc('<name>')` / `.rpc("<name>")` literal targets across src/,
 * mapped to ONE representative call site (file:line) for failure reporting.
 * Matches both quote styles and tolerates whitespace/newlines between `.rpc(`
 * and the literal (covers the multi-line call layout used across the codebase).
 * Dynamic `.rpc(varName)` produces no string literal, so it is skipped.
 */
function scanRpcTargets(): Map<string, string> {
  // [\s\S]*? across the gap so a `.rpc(\n  'name'` multi-line call still matches;
  // anchored to the FIRST quoted arg only.
  const rpcRe = /\.rpc\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g;
  const targets = new Map<string, string>();
  for (const file of collectSourceFiles(SRC_DIR)) {
    const text = fs.readFileSync(file, 'utf-8');
    let m: RegExpExecArray | null;
    while ((m = rpcRe.exec(text)) !== null) {
      const name = m[2];
      if (targets.has(name)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      targets.set(name, `${rel}:${line}`);
    }
  }
  return targets;
}

/**
 * Function names DEFINED in the applied migration path (baseline + root *.sql,
 * excluding _legacy/). Handles the three CREATE FUNCTION shapes pg_dump and
 * hand-written migrations emit:
 *   CREATE [OR REPLACE] FUNCTION "public"."name"
 *   CREATE [OR REPLACE] FUNCTION public.name
 *   CREATE [OR REPLACE] FUNCTION name
 * Case-insensitive (migrations mix `CREATE OR REPLACE FUNCTION` and lower-case).
 */
function scanDefinedFunctions(): Set<string> {
  const defRe =
    /create\s+(?:or\s+replace\s+)?function\s+(?:"public"\."([A-Za-z_][A-Za-z0-9_]*)"|public\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/gi;

  const files: string[] = [];
  if (fs.existsSync(BASELINE_FILE)) files.push(BASELINE_FILE);
  for (const entry of fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    // Root-level *.sql only — NEVER recurse into _legacy/.
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const full = path.join(MIGRATIONS_DIR, entry.name);
    if (full === BASELINE_FILE) continue; // already added first
    files.push(full);
  }

  const defined = new Set<string>();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    let m: RegExpExecArray | null;
    while ((m = defRe.exec(text)) !== null) {
      const name = m[1] || m[2] || m[3];
      if (name) defined.add(name);
    }
  }
  return defined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RPC conformance — static REG-144-class guard (no DB)', () => {
  const targets = scanRpcTargets();
  const defined = scanDefinedFunctions();

  it('finds .rpc() targets and applied-path function definitions', () => {
    // Sanity floors: the scanners must actually be reading files. If either
    // collapses to ~0 (broken glob, moved migrations), every conformance check
    // below would vacuously pass — so guard the guard.
    expect(targets.size).toBeGreaterThan(50);
    expect(defined.size).toBeGreaterThan(100);
  });

  it('every static .rpc() target is defined in the applied path or documented in KNOWN_GAPS', () => {
    const offenders: string[] = [];
    for (const [name, site] of targets) {
      if (defined.has(name)) continue;
      if (name in KNOWN_GAPS) continue;
      offenders.push(`  - ${name}  (called at ${site})`);
    }

    expect(
      offenders.length,
      offenders.length === 0
        ? ''
        : [
            `Found ${offenders.length} .rpc() target(s) NOT defined in the applied migration path and NOT in KNOWN_GAPS.`,
            'This is the REG-144 class of defect: the call will 500 on a fresh DB.',
            'Fix by adding a CREATE FUNCTION in supabase/migrations/ (preferred), or — if',
            'the absence is intentional/tracked — add it to KNOWN_GAPS with a real reason.',
            'Offenders:',
            ...offenders,
          ].join('\n'),
    ).toBe(0);
  });

  it('KNOWN_GAPS stays drainable: no entry is already defined in the applied path', () => {
    // The allowlist is debt to be paid down. Once a compensating migration lands
    // a gap's function, the name becomes "defined" and its KNOWN_GAPS entry is
    // dead weight that should be DELETED. Flag stale entries so they don't rot.
    const stale = Object.keys(KNOWN_GAPS).filter((name) => defined.has(name));
    expect(
      stale,
      stale.length === 0
        ? ''
        : `These KNOWN_GAPS entries are now DEFINED in the applied path and must be removed: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
