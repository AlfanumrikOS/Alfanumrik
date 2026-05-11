/**
 * src/lib/state/rules/service.ts — server-side rule evaluation entrypoint.
 *
 * Phase 4 of the unified state architecture. THE single function every
 * server route calls to ask "what does the rule engine think for this
 * learner?". Wraps three things:
 *
 *   1. Build StudentState (via createStudentStateBuilder)
 *   2. Evaluate STANDARD_RULES against the state
 *   3. Return Decision[] (optionally filtered by slug)
 *
 * Flag-gated on `ff_rule_engine_v1`. While OFF, returns an empty array
 * with reason='flag_off'. Surfaces fall back to their legacy in-line
 * checks until they're ready to switch to the rule engine.
 *
 * Per-process cache: keyed by authUserId with a 30s TTL. Rule
 * evaluation is pure given state, and state has its own short cache
 * inside the orchestrator. The cache here exists to coalesce repeated
 * fetches from a single page render (sidebar + dashboard cards +
 * upsell banner all asking for decisions on the same learner).
 *
 * What this service does NOT do:
 *   - It does NOT mutate state. The rule engine is read-only.
 *   - It does NOT publish events. If a rule's decision needs to fire
 *     a side effect (a parent digest, a teacher alert), the caller
 *     dispatches an event through the orchestrator. The rule engine
 *     just SURFACES the decision; the caller chooses how to act.
 *   - It does NOT replace the legacy in-line checks. Those stay until
 *     a per-surface migration PR removes them.
 */

import { logger } from '@/lib/logger';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createStudentStateBuilder } from '../student-state-builder';
import { evaluate, filterDecisions, type Decision } from './engine';
import { STANDARD_RULES } from './stdlib';

export const RULE_ENGINE_FLAG = 'ff_rule_engine_v1';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  decisions: Decision[];
}

const cache = new Map<string, CacheEntry>();

export interface GetDecisionsArgs {
  authUserId: string;
  /** Filter to only these decision slugs (e.g. ['nav.module.hide']). */
  decisionSlugs?: readonly string[];
  /** Minimum priority to surface. Default 0 (all decisions). */
  minPriority?: number;
}

export interface GetDecisionsResult {
  decisions: Decision[];
  reason: 'flag_off' | 'error' | 'ok';
  /** When reason='error', the message for logs. Never surfaced to clients. */
  errorMessage?: string;
}

/**
 * Best-effort fetch of rule-engine decisions for a learner. Never
 * throws — failures are logged and an empty array is returned. The
 * caller's legacy fallback runs in that case.
 *
 * Test injection: pass `opts.sb` to bypass the admin client, and
 * `opts.isEnabled` to bypass the feature-flags resolver.
 */
export async function getLearnerDecisions(
  args: GetDecisionsArgs,
  opts?: {
    sb?: SupabaseClient;
    isEnabled?: () => Promise<boolean>;
    now?: () => Date;
  },
): Promise<GetDecisionsResult> {
  const enabled = opts?.isEnabled
    ? await safeAsync(opts.isEnabled, false)
    : await safeIsFeatureEnabled(RULE_ENGINE_FLAG, args.authUserId);

  if (!enabled) {
    return { decisions: [], reason: 'flag_off' };
  }

  const cacheKey = args.authUserId;
  const cached = cache.get(cacheKey);
  const now = (opts?.now ?? (() => new Date()))().getTime();
  let allDecisions: Decision[];

  if (cached && now - cached.at < CACHE_TTL_MS) {
    allDecisions = cached.decisions;
  } else {
    try {
      const sb = opts?.sb ?? getSupabaseAdmin();
      const builder = createStudentStateBuilder({ sb });
      const state = await builder(args.authUserId);
      allDecisions = evaluate(STANDARD_RULES, state, {
        now: opts?.now ? opts.now() : new Date(),
      });
      cache.set(cacheKey, { at: now, decisions: allDecisions });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('rules/service: evaluate failed (surfaces fall back)', {
        error: new Error(message),
        authUserId: args.authUserId,
      });
      return {
        decisions: [],
        reason: 'error',
        errorMessage: message,
      };
    }
  }

  // Optional slug filter — surfaces typically ask for one or two slugs.
  let filtered = allDecisions;
  if (args.decisionSlugs && args.decisionSlugs.length > 0) {
    const slugSet = new Set(args.decisionSlugs);
    filtered = filtered.filter(d => slugSet.has(d.decision));
  }
  if (typeof args.minPriority === 'number') {
    const min = args.minPriority;
    filtered = filtered.filter(d => d.priority >= min);
  }

  return { decisions: filtered, reason: 'ok' };
}

/**
 * Convenience for surfaces that need a specific slug. Returns the
 * highest-priority decision for the slug, or null. Equivalent to
 * `pickDecision(decisions, slug)` after `getLearnerDecisions`.
 */
export async function getLearnerDecision(
  authUserId: string,
  decisionSlug: string,
): Promise<Decision | null> {
  const result = await getLearnerDecisions({
    authUserId,
    decisionSlugs: [decisionSlug],
  });
  return result.decisions[0] ?? null;
}

/**
 * Reduce a list of `nav.module.hide` decisions to the `Record<moduleKey, boolean>`
 * shape the existing DashboardSidebar expects. Modules NOT in the decisions
 * list are enabled by default. Modules that ARE in the list are disabled.
 *
 * Defensive: only consumes decisions whose `decision === 'nav.module.hide'`.
 */
export function decisionsToModuleEnablement(
  decisions: Decision[],
  allModuleKeys: readonly string[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of allModuleKeys) out[key] = true;
  for (const d of decisions) {
    if (d.decision !== 'nav.module.hide') continue;
    const reason = d.reason as { moduleKey?: string } | null;
    const key = reason?.moduleKey;
    if (key && typeof key === 'string') {
      out[key] = false;
    }
  }
  return out;
}

/** Re-exports for client / surface code that builds on top. */
export { filterDecisions };

// ── Helpers ──────────────────────────────────────────────────────────

async function safeIsFeatureEnabled(
  flag: string,
  userId: string,
): Promise<boolean> {
  try {
    return await isFeatureEnabled(flag, { userId });
  } catch {
    return false;
  }
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Test-only — clear the per-process cache between tests. */
export function _resetCacheForTests(): void {
  cache.clear();
}
