/**
 * src/lib/state/rules/engine.ts — Step 7: declarative decision-making.
 *
 * Most of the policy decisions in Alfanumrik live in scattered if/else
 * blocks inside route handlers: "if streak >= 7 and grade >= 9, show
 * the family-plan upsell", "if mastery on this chapter < 0.4, suggest
 * a lesson before the next quiz", "if no parent linked and student is
 * a minor, gate Foxy", "if school admin disabled the AI module, hide
 * Foxy from the sidebar".
 *
 * Today these decisions are duplicated across the student dashboard,
 * the API gate, the Foxy edge function, the parent dashboard, and the
 * teacher's class view. When the rule changes, you have to find all
 * the copies.
 *
 * After this: rules are typed, declarative, and live in one place
 * (rules/stdlib.ts). The engine evaluates them against StudentState
 * and returns a list of Decisions. Surfaces consume Decisions; nobody
 * re-implements the policy.
 *
 * Design:
 *
 *   - A Rule<R> takes StudentState and returns Decision<R> | null.
 *     Returning null means the rule didn't fire — it had nothing to
 *     contribute on this state.
 *   - Rules are PURE — no I/O, no clock reads except via the optional
 *     `now` injected for tests. Determinism makes rule tests trivial.
 *   - The engine sorts decisions by `priority` DESC; surfaces typically
 *     render the top-N relevant decisions for their context.
 *   - When two rules disagree (one says "upsell to family", another
 *     says "this user just downgraded, no upsell"), priority + an
 *     optional `supersedes: Rule.id[]` makes the conflict explicit.
 *
 * What rules are NOT:
 *
 *   - They don't trigger side effects directly. A rule that says
 *     "send WhatsApp digest" emits a Decision the orchestrator routes
 *     to the right service; the rule itself doesn't queue jobs.
 *   - They don't read external systems. If a rule needs to know
 *     whether a feature flag is on, that flag is part of StudentState
 *     (or of the rule's scoped context object), not a side-effect
 *     fetched inside the rule.
 */

import type { StudentState } from '../student-state';

// ── Decision — what a rule can emit ──────────────────────────────────

export interface Decision<Reason = unknown> {
  /** Stable id of the rule that produced this decision. Used for
   *  supersedes resolution and for audit log. */
  ruleId: string;

  /** Slug identifying what the surface should DO. Examples:
   *    - 'foxy.gate'                       (block access)
   *    - 'nav.module.hide'                 (don't render module link)
   *    - 'dashboard.suggest.next_quiz'     (offer next quiz card)
   *    - 'upsell.show'                     (show plan upsell)
   *    - 'notification.parent.weekly'      (queue parent digest)
   *
   *  These are NOT free-form. The stdlib of rules enumerates the
   *  decision slugs the engine emits; surfaces switch on them.
   */
  decision: string;

  /** Higher = more important. 100 is "must consider", 1 is
   *  "decorative". Surfaces typically filter by priority threshold. */
  priority: number;

  /** Free-form payload the surface needs to render the decision.
   *  Typed via the generic for callers that want compile-time safety. */
  reason: Reason;

  /** Optional list of rule ids this decision supersedes. If both are
   *  present in the result set, the superseded one is dropped. */
  supersedes?: string[];
}

// ── Rule — the building block ────────────────────────────────────────

export interface RuleEvaluationContext {
  state: StudentState;
  /** Wall-clock — injected for tests. Most rules don't need this; the
   *  ones that do (streak windows, deadline checks) consume it
   *  explicitly so test fixtures are deterministic. */
  now: Date;
}

export type Rule<Reason = unknown> = {
  /** Stable id. Used for supersedes resolution + analytics ("which
   *  rule fired on this user this session?"). */
  readonly id: string;
  /** Human-readable description for debugging + the rule audit log. */
  readonly description: string;
  /** The decision body. Return null if the rule has nothing to say
   *  for this state — most rules return null most of the time. */
  evaluate(ctx: RuleEvaluationContext): Decision<Reason> | null;
};

// ── Engine ───────────────────────────────────────────────────────────

export interface EvaluateOptions {
  /** Test injection for `now`. Defaults to system clock. */
  now?: Date;
  /** Filter to only return decisions at or above this priority. */
  minPriority?: number;
  /** Limit the result set after sorting; useful for surfaces that
   *  display a fixed slot count. */
  limit?: number;
}

/**
 * Run every rule against the state. Returns Decisions sorted by
 * priority DESC, with supersession resolved.
 *
 * The engine is `O(rules)` per call. Rules are pure functions so an
 * engine evaluation typically runs in microseconds; call sites can
 * evaluate fresh per request without caching.
 */
export function evaluate(
  rules: ReadonlyArray<Rule>,
  state: StudentState,
  opts: EvaluateOptions = {},
): Decision[] {
  const ctx: RuleEvaluationContext = {
    state,
    now: opts.now ?? new Date(),
  };

  const fired: Decision[] = [];
  for (const rule of rules) {
    try {
      const d = rule.evaluate(ctx);
      if (d !== null) fired.push(d);
    } catch (err: unknown) {
      // A buggy rule must not break the whole evaluation. Log + drop.
      // eslint-disable-next-line no-console
      console.error(`[rule-engine] rule "${rule.id}" threw: ${(err as Error).message}`);
    }
  }

  // Resolve supersedes — any rule listed in another's `supersedes`
  // gets dropped from the final result.
  const superseded = new Set<string>();
  for (const d of fired) {
    if (d.supersedes) {
      for (const id of d.supersedes) superseded.add(id);
    }
  }
  let result = fired.filter(d => !superseded.has(d.ruleId));

  // Sort by priority DESC; ties resolved by ruleId for determinism.
  result.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.ruleId.localeCompare(b.ruleId);
  });

  if (opts.minPriority !== undefined) {
    result = result.filter(d => d.priority >= opts.minPriority!);
  }
  if (opts.limit !== undefined) {
    result = result.slice(0, opts.limit);
  }

  return result;
}

/**
 * Convenience: filter decisions by slug. Surfaces typically pick one
 * decision class — `pick(decisions, 'dashboard.suggest.next_quiz')` —
 * to render in a specific slot.
 */
export function pickDecision<Reason = unknown>(
  decisions: ReadonlyArray<Decision>,
  decisionSlug: string,
): Decision<Reason> | null {
  return (decisions.find(d => d.decision === decisionSlug) as Decision<Reason> | undefined) ?? null;
}

export function filterDecisions(
  decisions: ReadonlyArray<Decision>,
  decisionSlug: string,
): Decision[] {
  return decisions.filter(d => d.decision === decisionSlug);
}
