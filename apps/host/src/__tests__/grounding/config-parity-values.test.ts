// apps/host/src/__tests__/grounding/config-parity-values.test.ts
//
// VALUE parity between the two grounding-config mirrors.
//
//   TS  (Node graph):  packages/lib/src/grounding-config.ts
//   Deno (Edge graph): supabase/functions/grounded-answer/config.ts
//
// Deno cannot import from packages/lib, so the whole constant table is
// duplicated. Both files' headers declare themselves a mandatory mirror — but
// until this file existed, NOTHING compared their VALUES:
//
//   * scripts/pre-rollout-checklist.ts extracts constant NAMES only
//     (/^export const ([A-Z_]+)\s*=/) and asserts the two name sets match.
//     A mirror can hold PROMPT_REV=3 against the authority's 4 and still pass.
//   * scripts/check-config-parity.sh is DEAD — it points at pre-monorepo paths
//     (src/lib/grounding-config.ts), exits 1 on any current checkout, and is
//     invoked by no workflow, package script, or hook.
//   * src/__tests__/grounding/config-parity.test.ts does compare values, but
//     only for 7 retrieval/threshold constants. It covers neither cache-
//     generation revision (PROMPT_REV / MODEL_ROUTE_REV) nor the timeout budget.
//
// That gap is not theoretical. This mirror has silently diverged TWICE:
// MODEL_ROUTE_REV sat at 3 while the authority read 4 (2026-08-26 -> 2026-08-31),
// and PROMPT_REV sat at 3 while the authority read 4 (2026-08-31, same day).
// Both revisions are hashed into the response-cache gen_ctx tuple, so a stale
// mirror is a cache-keying defect: a consumer reading the TS copy computes a key
// for a prompt revision the Edge Function no longer sends.
//
// Technique follows the established cross-runtime parity convention (see
// lib/ai/gateway/deno-parity.test.ts): read BOTH files as text, parse the real
// declarations out of the source, compare the parsed values.
//
// Owner: testing. Enforces: mirror integrity for P12 prompt/model routing.
// Reviewer: ai-engineer.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * cwd-resilient repo-root resolution (tests run with cwd=apps/host).
 *
 * Line endings are normalized to LF. On a core.autocrlf checkout both files sit
 * on disk with CRLF, and JS's `.` does not match `\r` — a `//`-comment stripper
 * written against `.*$` would then silently strip NOTHING and every value
 * comparison would run over comment-laden text.
 */
function repoRead(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  const raw = existsSync(fromHost)
    ? readFileSync(fromHost, 'utf8')
    : readFileSync(resolve(process.cwd(), rel), 'utf8');
  return raw.replace(/\r\n?/g, '\n');
}

const TS_PATH = 'packages/lib/src/grounding-config.ts';
const DENO_PATH = 'supabase/functions/grounded-answer/config.ts';

const tsSrc = repoRead(TS_PATH);
const denoSrc = repoRead(DENO_PATH);

/**
 * Remove `//` line comments and block comments. Neither file contains `//`
 * inside a string literal (the only strings are model ids, template ids and
 * caller names), so a line-wise strip is safe and keeps the parser small.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const tsClean = stripComments(tsSrc);
const denoClean = stripComments(denoSrc);

/** Every `export const NAME` in a (comment-stripped) source, in file order. */
function exportedNames(src: string): string[] {
  return [...src.matchAll(/^export const ([A-Z_][A-Z0-9_]*)\b/gm)].map((m) => m[1]);
}

/**
 * The raw initializer text of `export const NAME[: Type] = <here>;`.
 *
 * Scans to the terminating semicolon with bracket-depth and string awareness so
 * object/array literals (PER_PLAN_TIMEOUT_MS, REGISTERED_PROMPT_TEMPLATES,
 * VALID_CALLERS) are captured whole rather than truncated at the first `;`.
 */
function extractInitializer(src: string, name: string): string | null {
  const re = new RegExp(`export const ${name}\\b[^=]*=`);
  const m = re.exec(src);
  if (!m) return null;

  const QUOTES = ["'", '"', '`'];
  let depth = 0;
  let quote: string | null = null;
  let out = '';
  for (let i = m.index + m[0].length; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') {
        out += ch + src[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      continue;
    }
    if (QUOTES.includes(ch)) {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) return out;
    out += ch;
  }
  return null;
}

/** Whitespace / trailing-comma / `as const` normalization for text comparison. */
function normalize(init: string): string {
  return init
    .replace(/\bas const\b/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function value(src: string, name: string): string {
  const init = extractInitializer(stripComments(src), name);
  expect(init, `${name}: no initializer parsed`).not.toBeNull();
  return normalize(init as string);
}

/** Parse a numeric literal that may carry `_` separators. */
function num(src: string, name: string): number {
  const n = Number(value(src, name).replace(/_/g, ''));
  expect(Number.isFinite(n), `${name} is not a finite number`).toBe(true);
  return n;
}

/** Parse `{ free: 41_000, ... }` into a plain numeric record. */
function parsePlanBudget(src: string): Record<string, number> {
  const init = value(src, 'PER_PLAN_TIMEOUT_MS');
  const out: Record<string, number> = {};
  for (const m of init.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([0-9_]+)/g)) {
    out[m[1]] = Number(m[2].replace(/_/g, ''));
  }
  return out;
}

// Deno-only constants. Both are the Edge-side mirror of the TS Model Gateway
// registry (packages/lib/src/ai/gateway/registry.ts), NOT of grounding-config,
// and are already value-pinned by lib/ai/gateway/deno-parity.test.ts.
const DENO_ONLY = ['CLAUDE_PRIMARY_FALLBACK_ORDER', 'MODEL_FALLBACK_ORDER'];

describe('grounding-config mirrors — the parser works (guard against a vacuous suite)', () => {
  it('parses a non-trivial number of exported constants from BOTH files', () => {
    expect(exportedNames(tsClean).length).toBeGreaterThanOrEqual(20);
    expect(exportedNames(denoClean).length).toBeGreaterThanOrEqual(20);
  });

  it('captures multi-line object/array initializers whole (not truncated at the first ";")', () => {
    // If the scanner were naive, PER_PLAN_TIMEOUT_MS would come back as '{' and
    // every comparison below would pass vacuously.
    expect(value(denoSrc, 'PER_PLAN_TIMEOUT_MS')).toContain('unlimited');
    expect(value(tsSrc, 'PER_PLAN_TIMEOUT_MS')).toContain('unlimited');
    expect(Object.keys(parsePlanBudget(denoSrc)).sort()).toEqual([
      'free',
      'pro',
      'starter',
      'unlimited',
    ]);
    expect(value(denoSrc, 'REGISTERED_PROMPT_TEMPLATES')).toContain('diagram_spec_v1');
  });

  it('actually strips // comments (a CRLF checkout defeats a naive `.*$` stripper)', () => {
    // JS `.` does not match \r, so on a core.autocrlf checkout a `.*$` line
    // stripper removes NOTHING and every value comparison below runs over
    // comment prose instead of code. This caught exactly that during authoring.
    expect(tsClean).not.toContain('RCA-FIX');
    expect(denoClean).not.toContain('RCA-FIX');
    expect(value(denoSrc, 'REGISTERED_PROMPT_TEMPLATES')).not.toContain('//');
    expect(value(tsSrc, 'REGISTERED_PROMPT_TEMPLATES')).not.toContain('//');
  });
});

describe('grounding-config mirrors — constant NAME sets agree', () => {
  it('every TS constant exists in the Deno mirror', () => {
    const deno = new Set(exportedNames(denoClean));
    for (const name of exportedNames(tsClean)) {
      expect(deno.has(name), `${DENO_PATH} is missing ${name}`).toBe(true);
    }
  });

  it('the Deno mirror adds only the two known model-routing tables', () => {
    const ts = new Set(exportedNames(tsClean));
    const extra = exportedNames(denoClean).filter((n) => !ts.has(n));
    expect(extra.sort()).toEqual(DENO_ONLY);
  });
});

describe('grounding-config mirrors — VALUE parity (what the name-only checks cannot see)', () => {
  const shared = exportedNames(denoClean).filter((n) => !DENO_ONLY.includes(n));

  it.each(shared)('%s has an identical value on both sides', (name) => {
    expect(value(tsSrc, name)).toBe(value(denoSrc, name));
  });
});

describe('grounding-config mirrors — the three constants the MOL audit named explicitly', () => {
  it('PROMPT_REV matches (gen_ctx cache revision — a stale mirror mis-keys the cache)', () => {
    expect(num(tsSrc, 'PROMPT_REV')).toBe(num(denoSrc, 'PROMPT_REV'));
  });

  it('PROMPT_REV is at least 3 — a DROP would resurrect responses cached under an older prompt', () => {
    // The bump rule is one-way: a registered template's TEXT changing for 100%
    // of turns REQUIRES a bump, because every response cached under the old rev
    // must become unreachable. Lowering the constant is what makes stale
    // entries reachable again, so the floor is what this pins.
    //
    // Currently 3. A rev-4 bump landed on 2026-08-31 with the
    // {{foxy_safety_rails}} / {{mode_instruction}} template wiring and was
    // REVERTED the same day, together with the template text it keyed:
    // the added Safety Rails section drove the model to emit a preamble ahead
    // of the JSON envelope, which stripCodeFence (it only strips a fence at
    // string START) could not clean, so wrapAsParagraph emitted the raw
    // envelope to students as visible text. Reverting the templates returns the
    // prompt text to exactly what rev 3 keys, so rev 3 is correct again — the
    // rev-4 cache entries are simply orphaned, which is harmless.
    // Re-raise this floor when the rails wiring returns WITH a rails eval.
    expect(num(denoSrc, 'PROMPT_REV')).toBeGreaterThanOrEqual(3);
  });

  it('MODEL_ROUTE_REV matches (this pair silently diverged 2026-08-26 -> 2026-08-31)', () => {
    expect(num(tsSrc, 'MODEL_ROUTE_REV')).toBe(num(denoSrc, 'MODEL_ROUTE_REV'));
  });

  it('MODEL_ROUTE_REV is at least 5 — the dead-sonnet-pin repair rev', () => {
    expect(num(denoSrc, 'MODEL_ROUTE_REV')).toBeGreaterThanOrEqual(5);
  });

  it('PER_PLAN_TIMEOUT_MS matches plan-for-plan (parsed numbers, not just text)', () => {
    expect(parsePlanBudget(tsSrc)).toEqual(parsePlanBudget(denoSrc));
  });
});

// ── Timeout-budget invariants (the P0 closed 2026-08-31, and the latency
//    regression the SAME-DAY recalibration closed on top of it) ──────────────
//
// PER_PLAN_TIMEOUT_MS is not a free parameter. Ceilings sit above it and a
// latency floor sits below it.
//
// Ceiling failure (part 1, the P0): the pre-repair values 20/35/55/75s ran
// hop = budget + 2s up to 77s under a 30s maxDuration, so Vercel killed the
// function before the Edge Function's own abstain payload could return AND
// before refundQuota ran — a paying student lost a quota unit for an answer
// they never received.
//
// Floor failure (part 2, the recalibration): part 1's fix sliced the budget
// UNIFORMLY (chainBudget / 3 = 12.00-14.00s per rung). Measured against 1000
// recent successful Foxy answers (grounded_ai_traces, caller='foxy',
// grounded=true) that severs ~8.2% of answers that succeed today at rung 1 —
// and sends them to Sonnet, which is SLOWER than Haiku, on a slice no longer.
// The ladder below fixes the SHAPE: rung 1 (the ~92%-success attempt) takes the
// lion's share; rungs 2+ are short recovery attempts, which is what keeps the
// cross-provider rung reachable.
//
// This block no longer MIRRORS claude.ts / vercel.json constants as literals —
// it PARSES them out of the real files. A mirrored literal can only catch drift
// after someone remembers to update it here; parsing catches it the moment
// either side moves alone, which is the whole failure mode this suite exists
// for.
describe('PER_PLAN_TIMEOUT_MS — budget invariants (ladder in claude.ts + ceilings in vercel.json / foxy route)', () => {
  const budgets = parsePlanBudget(denoSrc);
  const plans = Object.entries(budgets);

  const claudeSrc = repoRead('supabase/functions/grounded-answer/claude.ts');
  const routeSrc = repoRead('apps/host/src/app/api/foxy/route.ts');
  const vercel = JSON.parse(repoRead('apps/host/vercel.json')) as {
    functions: Record<string, { maxDuration: number }>;
  };

  /** Parse a NON-exported `const NAME = 12_000;` out of real source. */
  function constNum(src: string, name: string): number {
    const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*([0-9_]+)\\s*;`).exec(stripComments(src));
    expect(m, `${name}: no plain numeric const found in source`).not.toBeNull();
    return Number(m![1].replace(/_/g, ''));
  }

  // Real planner constants, read from claude.ts.
  const CHAIN_RESERVE_MS = constNum(claudeSrc, 'CHAIN_RESERVE_MS');
  const PLANNED_FALLBACK_RUNGS = constNum(claudeSrc, 'PLANNED_FALLBACK_RUNGS');
  const RECOVERY_RUNG_TIMEOUT_MS = constNum(claudeSrc, 'RECOVERY_RUNG_TIMEOUT_MS');
  const FIRST_RUNG_FLOOR_MS = constNum(claudeSrc, 'FIRST_RUNG_TIMEOUT_FLOOR_MS');
  const PER_CALL_CAP_MS = constNum(claudeSrc, 'PER_CALL_TIMEOUT_CAP_MS');

  // Real ceiling constants, read from the Foxy route + vercel.json.
  const HOP_OVERHEAD_MS = 2_000;
  const CLEANUP_RESERVE_MS = constNum(routeSrc, 'FOXY_CLEANUP_RESERVE_MS');
  const ROUTE_MAX_DURATION_MS = constNum(routeSrc, 'FOXY_MAX_DURATION_MS');
  const VERCEL_MAX_DURATION_MS = vercel.functions['src/app/api/foxy/route.ts'].maxDuration * 1_000;
  // Headroom the route's hop clamp needs for the preamble (auth, quota, session,
  // flags) that has already run before the hop starts. If the budget eats this,
  // the clamp binds on ordinary requests and the transport aborts BEFORE the
  // Edge Function's own abstain payload — a graceful degrade becomes a generic
  // error. Not a constant in source (the route measures elapsed time directly);
  // pinned here as the design allowance the budgets were sized against.
  const PREAMBLE_HEADROOM_MS = 5_000;

  // Production latency distribution — 1000 most recent successful Foxy answers,
  // grounded_ai_traces where caller='foxy' AND grounded=true (2026-08-31).
  // NOTE latency_ms is stamped from the top of the Edge Function invocation, so
  // these ALREADY include retrieval time that CHAIN_RESERVE_MS pays for
  // separately — every coverage assertion below is therefore conservative.
  const P95_MS = 14_098;
  const P99_MS = 20_215;

  /** Byte-for-byte replication of claude.ts's planChainBudget. */
  function ladder(budgetMs: number) {
    const chainBudgetMs = Math.max(budgetMs - CHAIN_RESERVE_MS, 1_000);
    const recoveryCallMs = Math.min(RECOVERY_RUNG_TIMEOUT_MS, chainBudgetMs);
    const firstCallMs = Math.min(
      PER_CALL_CAP_MS,
      Math.max(
        chainBudgetMs - (PLANNED_FALLBACK_RUNGS - 1) * recoveryCallMs,
        Math.min(chainBudgetMs, FIRST_RUNG_FLOOR_MS),
      ),
    );
    return { chainBudgetMs, firstCallMs, recoveryCallMs };
  }

  it('vercel.json and the route constant agree on /api/foxy maxDuration', () => {
    expect(ROUTE_MAX_DURATION_MS).toBe(VERCEL_MAX_DURATION_MS);
  });

  it.each(plans)('%s: hop (budget + 2s) fits inside the /api/foxy maxDuration', (_plan, ms) => {
    expect(ms + HOP_OVERHEAD_MS).toBeLessThanOrEqual(VERCEL_MAX_DURATION_MS);
  });

  it.each(plans)(
    '%s: hop + cleanup reserve + preamble headroom still fits the platform clock',
    (_plan, ms) => {
      // This is the invariant that actually keeps refundQuota reachable: the
      // hop must end early enough for the failure path to run.
      expect(ms + HOP_OVERHEAD_MS + CLEANUP_RESERVE_MS + PREAMBLE_HEADROOM_MS).toBeLessThanOrEqual(
        VERCEL_MAX_DURATION_MS,
      );
    },
  );

  it.each(plans)(
    '%s: rung 1 + two recovery rungs + retrieval reserve fit — the OpenAI rung is REACHABLE',
    (_plan, ms) => {
      // Rung 3 of MODEL_FALLBACK_ORDER.auto is openai:gpt-4o-mini, the FIRST
      // cross-provider rung. It fitting on a PURE-TIMEOUT chain (no rung failing
      // fast and donating its slice) is what makes cross-provider fallback real
      // rather than arithmetically dead code. This is the P0 property.
      const { firstCallMs, recoveryCallMs } = ladder(ms);
      const worstCaseChain =
        CHAIN_RESERVE_MS + firstCallMs + (PLANNED_FALLBACK_RUNGS - 1) * recoveryCallMs;
      expect(worstCaseChain).toBeLessThanOrEqual(ms);
    },
  );

  it.each(plans)('%s: rung 1 covers at least p95 of real answer latency', (_plan, ms) => {
    // The regression the recalibration closed. A rung-1 budget below p95 severs
    // answers that succeed today and hands them to a slower model on a shorter
    // slice — strictly worse for the student than doing nothing.
    expect(ladder(ms).firstCallMs).toBeGreaterThanOrEqual(P95_MS);
  });

  it.each(plans)('%s: rung 1 reaches into the p95-p99 band (approaching p99)', (_plan, ms) => {
    // "Preferably approach p99". 19s (free) is ~98.2% coverage; the paid tiers
    // sit at or past p99. Asserted as a band so a future retune cannot quietly
    // drop back toward p90 while still clearing the p95 gate above.
    const { firstCallMs } = ladder(ms);
    expect(firstCallMs).toBeGreaterThanOrEqual(P99_MS - 1_500);
  });

  it.each(plans)('%s: the ladder is genuinely NON-uniform (rung 1 > recovery rung)', (_plan, ms) => {
    // Guards the shape, not just the size. A uniform slice that happens to be
    // large enough would pass the p95 gate on the big plans and silently
    // reintroduce the "3 x equal rungs" design this replaced.
    const { firstCallMs, recoveryCallMs, chainBudgetMs } = ladder(ms);
    expect(firstCallMs).toBeGreaterThan(recoveryCallMs);
    expect(firstCallMs).toBeGreaterThan(chainBudgetMs / PLANNED_FALLBACK_RUNGS);
  });

  it('claude.ts actually APPLIES the ladder per rung (planner alone is not enough)', () => {
    // Static canary: a revert that leaves planChainBudget intact but re-points
    // both loops at a single slice would pass every arithmetic test above.
    // Both call sites must select on the attempt counter, and both must be fed
    // by the attempt counter rather than the array index (skipped rungs — no
    // provider key, provider already 401'd — must not consume rung 1's slice).
    const clean = stripComments(claudeSrc);
    const selections = clean.match(/attemptsMade === 0 \? firstCallMs : recoveryCallMs/g) ?? [];
    expect(selections.length, 'expected the ladder selection in BOTH loops').toBe(2);
    expect((clean.match(/attemptsMade \+= 1;/g) ?? []).length).toBe(2);
    expect((clean.match(/let attemptsMade = 0;/g) ?? []).length).toBe(2);
    // The uniform destructure must be gone from both loops.
    expect(clean).not.toContain('const { chainBudgetMs, perCallMs } = planChainBudget');
  });

  it('small-budget callers still get ONE usable attempt, not three useless slices', () => {
    // ncert-solver runs at 30s and the quiz verifiers at 15-20s. The ladder's
    // subtraction goes negative for them; the floor branch must rescue it.
    for (const budget of [15_000, 20_000, 30_000]) {
      const { firstCallMs, chainBudgetMs } = ladder(budget);
      expect(firstCallMs).toBeGreaterThan(0);
      expect(firstCallMs).toBeGreaterThanOrEqual(Math.min(chainBudgetMs, FIRST_RUNG_FLOOR_MS));
      expect(firstCallMs).toBeLessThanOrEqual(chainBudgetMs);
    }
  });

  it('the pre-repair budgets (20/35/55/75s) cannot return', () => {
    const values = Object.values(budgets);
    expect(values).not.toContain(75_000);
    expect(values).not.toContain(55_000);
    expect(values).not.toContain(35_000);
    expect(values).not.toContain(20_000);
  });
});
