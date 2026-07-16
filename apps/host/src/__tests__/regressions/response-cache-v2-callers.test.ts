/**
 * Response-cache v2 — caller-side static-source canaries (2026-07-16).
 *
 * The grounded-answer response-cache v2 (gen_ctx keys, cache_scope gate,
 * per-caller serving flags, durable L3) is enforced behaviorally by the
 * Deno suites under supabase/functions/grounded-answer/__tests__/. What
 * those suites CANNOT see is the two production callers' source — this
 * file pins the caller-side contracts as static-source canaries (the
 * REG-118 / bulk-jee-neet-import readFileSync convention):
 *
 *  1. QUOTA-BEFORE-CACHE (P12): in BOTH callers the daily-quota gate runs
 *     strictly BEFORE the grounded-answer call, with an early-return deny
 *     branch in between. A cache hit inside grounded-answer therefore can
 *     NEVER bypass daily usage limits — the unit was already consumed
 *     before the (possibly cached) answer was fetched.
 *  2. CACHE_SCOPE DECLARATIONS (P13): ncert-solver declares
 *     cache_scope: 'shared' (personalization-free by construction), and
 *     the Foxy route computes cache_scope through the fail-closed
 *     conjunction — 'shared' ONLY when there is no conversation history,
 *     no tenant AI override, and every per-student prompt section is
 *     empty; the ternary's default branch is 'none'. A personalized Foxy
 *     turn can never be written to (or served from) the shared cache.
 *  3. CONTRACT MIRRORS: both GroundedRequest client mirrors
 *     (packages/lib + supabase/functions/_shared) carry the optional
 *     cache_scope field with the same 'shared' | 'none' shape as the
 *     service (grounded-answer/types.ts), so a caller-side declaration is
 *     never silently dropped by a stale type.
 *  4. CONTENT-VERSION BUMPS (P12 stale-grounding): all four ingestion
 *     writers call bumpRagContentVersion after content writes, so a
 *     re-ingestion rotates every cached answer's gen_ctx key for that
 *     (grade, subject) scope.
 *  5. ENV-PAIR SPLIT (operational integrity): the executable source of
 *     cache-redis.ts reads ONLY the dedicated cache instance pair
 *     (UPSTASH_CACHE_REDIS_REST_URL/TOKEN) and never falls back to the
 *     security-critical rate-limiter/session instance pair.
 *
 * Deterministic, no DB, no network. Candidates REG-264..REG-269 in
 * .claude/regression-catalog.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root derived from this file's location (…/apps/host/src/__tests__/
// regressions/ → five levels up) so the canary is cwd-independent.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const FOXY_ROUTE = resolve(REPO_ROOT, 'apps/host/src/app/api/foxy/route.ts');
const NCERT_SOLVER = resolve(REPO_ROOT, 'supabase/functions/ncert-solver/index.ts');
const CACHE_REDIS = resolve(REPO_ROOT, 'supabase/functions/grounded-answer/cache-redis.ts');
const LIB_CLIENT = resolve(REPO_ROOT, 'packages/lib/src/ai/grounded-client.ts');
const SHARED_CLIENT = resolve(REPO_ROOT, 'supabase/functions/_shared/grounded-client.ts');
const SERVICE_TYPES = resolve(REPO_ROOT, 'supabase/functions/grounded-answer/types.ts');

const INGESTION_WRITERS = [
  'supabase/functions/embed-ncert-qa/index.ts',
  'supabase/functions/embed-questions/index.ts',
  'supabase/functions/generate-embeddings/index.ts',
  'supabase/functions/extract-ncert-questions/index.ts',
].map((p) => resolve(REPO_ROOT, p));

const read = (p: string) => readFileSync(p, 'utf8');

/**
 * Strip comment-only content so pins target EXECUTABLE source. Removes
 * block comments and full-line // comments (a leading-whitespace-only
 * prefix), which is sufficient here without risking URL-in-string
 * mangling from a naive `//.*` strip.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line.trimEnd()))
    .join('\n');
}

describe('response-cache v2 — quota gate runs BEFORE the grounded-answer call (cache hits cannot bypass P12 limits)', () => {
  it('foxy route: checkAndIncrementQuota + deny early-return precede callGroundedAnswer', () => {
    const src = read(FOXY_ROUTE);
    const quotaIdx = src.indexOf('await checkAndIncrementQuota(');
    const groundedIdx = src.indexOf('await callGroundedAnswer(groundedRequest');
    expect(quotaIdx, 'quota call site missing').toBeGreaterThan(-1);
    expect(groundedIdx, 'grounded call site missing').toBeGreaterThan(-1);
    expect(quotaIdx).toBeLessThan(groundedIdx);
    // The deny branch sits between the two: quota exhausted → 429 before
    // any grounded-answer (and therefore any cache) involvement.
    const between = src.slice(quotaIdx, groundedIdx);
    expect(between).toMatch(/if\s*\(!allowed\)/);
    expect(between).toContain('429');
  });

  it('ncert-solver: check_and_record_usage RPC + daily_limit_reached deny precede callGroundedAnswer', () => {
    const src = read(NCERT_SOLVER);
    const quotaIdx = src.indexOf("rpc('check_and_record_usage'");
    const groundedIdx = src.indexOf('await callGroundedAnswer(');
    expect(quotaIdx, 'quota RPC call site missing').toBeGreaterThan(-1);
    expect(groundedIdx, 'grounded call site missing').toBeGreaterThan(-1);
    expect(quotaIdx).toBeLessThan(groundedIdx);
    const between = src.slice(quotaIdx, groundedIdx);
    expect(between).toMatch(/if\s*\(!usageRow\?\.allowed\)/);
    expect(between).toContain('daily_limit_reached');
  });
});

describe('response-cache v2 — cache_scope declarations (P13: personalized turns never reach the shared cache)', () => {
  it("ncert-solver declares cache_scope: 'shared' on its GroundedRequest", () => {
    const src = read(NCERT_SOLVER);
    expect(src).toMatch(/cache_scope:\s*'shared'/);
  });

  it("foxy route wires cache_scope: foxyCacheScope onto the GroundedRequest", () => {
    const src = read(FOXY_ROUTE);
    expect(src).toMatch(/cache_scope:\s*foxyCacheScope/);
  });

  it("foxy route's foxyCacheScope is the fail-closed conjunction over history + tenant + all six per-student sections, defaulting to 'none'", () => {
    const src = read(FOXY_ROUTE);
    const declMatch = src.match(/const foxyCacheScope[\s\S]*?'none';/);
    expect(declMatch, 'foxyCacheScope declaration not found').not.toBeNull();
    const decl = declMatch![0];
    // Every conjunct must be present. Removing ANY of these would let a
    // personalized turn masquerade as shared — each is load-bearing.
    const requiredConjuncts = [
      'history.length === 0',
      '!hasTenantAiOverride',
      '!cognitiveSectionIsPersonal',
      "academicGoalSectionValue === ''",
      "misconceptionSectionValue === ''",
      "pendingExpectationValue === ''",
      "previousSessionContextValue === ''",
      "learnerMemorySectionValue === ''",
    ];
    for (const conjunct of requiredConjuncts) {
      expect(decl, `foxyCacheScope lost the conjunct: ${conjunct}`).toContain(conjunct);
    }
    // Ternary shape: shared only on full satisfaction, 'none' otherwise.
    expect(decl).toMatch(/\?\s*'shared'/);
    expect(decl).toMatch(/:\s*'none';$/);
    // The six sections feeding the conjunction are the SAME hoisted values
    // wired into template_variables (they cannot drift apart).
    expect(src).toMatch(/academic_goal_section:\s*academicGoalSectionValue/);
    expect(src).toMatch(/cognitive_context_section:\s*cognitiveContextSectionValue/);
    expect(src).toMatch(/misconception_section:\s*misconceptionSectionValue/);
    expect(src).toMatch(/pending_expectation:\s*pendingExpectationValue/);
    expect(src).toMatch(/previous_session_context:\s*previousSessionContextValue/);
    expect(src).toMatch(/learner_memory_section:\s*learnerMemorySectionValue/);
  });

  it('both GroundedRequest client mirrors + the service contract carry the optional cache_scope field', () => {
    for (const p of [LIB_CLIENT, SHARED_CLIENT, SERVICE_TYPES]) {
      const src = read(p);
      expect(src, `${p} is missing the cache_scope contract field`).toMatch(
        /cache_scope\?:\s*'shared'\s*\|\s*'none';/,
      );
    }
  });
});

describe('response-cache v2 — content-version bumps (P12: re-ingested content invalidates cached answers)', () => {
  it.each(INGESTION_WRITERS)('%s imports and calls bumpRagContentVersion', (writer) => {
    const src = read(writer);
    expect(src).toContain("from '../_shared/rag-content-version.ts'");
    expect(src).toMatch(/await bumpRagContentVersion\(/);
  });
});

describe('response-cache v2 — Redis env-pair split (cache traffic never touches the rate-limiter/session instance)', () => {
  it('cache-redis.ts executable source reads ONLY the UPSTASH_CACHE_* pair (legacy pair appears in comments only)', () => {
    const executable = stripComments(read(CACHE_REDIS));
    expect(executable).toContain("Deno.env.get('UPSTASH_CACHE_REDIS_REST_URL')");
    expect(executable).toContain("Deno.env.get('UPSTASH_CACHE_REDIS_REST_TOKEN')");
    // No fallback: the legacy (security-instance) pair must not appear in
    // executable source at all. `(?<!CACHE_)` keeps the CACHE_-prefixed
    // reads above from matching.
    expect(executable).not.toMatch(/(?<!CACHE_)UPSTASH_REDIS_REST_(URL|TOKEN)/);
  });
});
