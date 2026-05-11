/**
 * agents/runtime/metrics/registry.ts — outcome-metric registry.
 *
 * The single source of truth for "what metrics the mesh can attribute
 * cycles against". Each metric defines how to compute itself from
 * state_events + supporting tables, given a time window.
 *
 * Why a code-side registry and not a DB table:
 *   - Metric definitions are math, not data. Computing a metric
 *     requires SQL that can't live as a DB row without an arbitrary
 *     query interpreter (giant blast radius).
 *   - Adding a metric always requires shipping code anyway (the
 *     compute function). Forcing a separate DB write is overhead.
 *   - The TS type system enforces that L8's attribution loop only
 *     references metrics that have a compute function. Typos at
 *     cycle-creation time would silently no-op without this guard.
 *
 * Each metric returns `{ value: number, sampleSize: number, kind }`.
 *   - value: the raw aggregate (e.g. 0.74 for a 74% rate, or 12.3 for
 *     a mean count). Units are metric-defined and documented in the
 *     description.
 *   - sampleSize: how many distinct learners contributed. Used by the
 *     significance test downstream.
 *   - kind: 'rate' (in [0,1], higher is better) | 'count' (non-negative
 *     integer, higher is better) | 'duration_sec' (non-negative, lower
 *     is better) — drives the comparator at attribution time.
 *
 * Phase 5 ships four metrics: foxy_helpful_rate, quiz_completion_rate,
 * mastery_velocity, streak_retention_7d. More can be added without
 * any L8 changes — the runner reflects on the registry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type MetricKind = 'rate' | 'count' | 'duration_sec';

export interface MetricWindow {
  /** ISO-8601 inclusive lower bound. */
  startsAt: string;
  /** ISO-8601 exclusive upper bound. */
  endsAt: string;
  /** Optional school filter — null for global cohorts. */
  schoolId?: string | null;
}

export interface MetricSample {
  value: number;
  sampleSize: number;
}

export interface MetricDef {
  /** Stable lower-snake-case slug. Must match `^[a-z][a-z0-9_]{0,127}$`
   *  (outcome_metrics.metric CHECK). */
  name: string;
  description: string;
  kind: MetricKind;
  /** "Higher is better" / "Lower is better" / "Stable is best". Drives
   *  the sign of the comparator at attribution. */
  direction: 'up' | 'down' | 'stable';
  /** Compute the metric for a single window. Returns NaN-safe values. */
  compute(sb: SupabaseClient, window: MetricWindow): Promise<MetricSample>;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function fetchEventCount(
  sb: SupabaseClient,
  kind: string,
  window: MetricWindow,
): Promise<{ rows: Array<{ actor_auth_user_id: string; payload: unknown }>; }> {
  let q = sb
    .from('state_events')
    .select('actor_auth_user_id, payload')
    .eq('kind', kind)
    .gte('occurred_at', window.startsAt)
    .lt('occurred_at', window.endsAt);
  if (window.schoolId) {
    q = q.eq('tenant_id', window.schoolId);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(`fetchEventCount(${kind}): ${error.message}`);
  }
  return { rows: (data ?? []) as Array<{ actor_auth_user_id: string; payload: unknown }> };
}

function uniqueLearners(rows: Array<{ actor_auth_user_id: string }>): number {
  return new Set(rows.map(r => r.actor_auth_user_id)).size;
}

function safeRate(numer: number, denom: number): number {
  if (!denom) return 0;
  return numer / denom;
}

// ── Concrete metrics ─────────────────────────────────────────────────

/**
 * foxy_helpful_rate — share of completed Foxy sessions where the
 * learner explicitly marked it helpful. We treat missing feedback
 * as "no signal" (excluded from both numerator and denominator) so
 * an L4 change that improves prompts isn't penalised by silent users.
 */
const foxyHelpfulRate: MetricDef = {
  name: 'foxy_helpful_rate',
  description:
    'Share of ai.foxy_session_completed events with payload.helpful === true, '
    + 'over the count of events where helpful is non-null. Higher is better.',
  kind: 'rate',
  direction: 'up',
  async compute(sb, window) {
    const { rows } = await fetchEventCount(sb, 'ai.foxy_session_completed', window);
    let withFeedback = 0;
    let helpful = 0;
    const learners = new Set<string>();
    for (const r of rows) {
      const helpfulField = (r.payload as { helpful?: boolean | null } | null)?.helpful;
      if (helpfulField === true || helpfulField === false) {
        withFeedback++;
        if (helpfulField === true) helpful++;
        learners.add(r.actor_auth_user_id);
      }
    }
    return {
      value: safeRate(helpful, withFeedback),
      sampleSize: learners.size,
    };
  },
};

/**
 * quiz_completion_rate — quizzes completed per active learner per day.
 * Approximates "learners actually practicing"; higher = better
 * engagement.
 */
const quizCompletionRate: MetricDef = {
  name: 'quiz_completion_rate',
  description:
    'Quiz completions per active learner per day. Active = at least one '
    + 'learner.* event in the window. Higher is better.',
  kind: 'count',
  direction: 'up',
  async compute(sb, window) {
    const [quiz, active] = await Promise.all([
      fetchEventCount(sb, 'learner.quiz_completed', window),
      fetchActiveLearners(sb, window),
    ]);
    const days = Math.max(1, daysBetween(window.startsAt, window.endsAt));
    return {
      value: safeRate(quiz.rows.length, active.size * days),
      sampleSize: active.size,
    };
  },
};

/**
 * mastery_velocity — average mastery delta per learner.mastery_changed
 * event, restricted to positive deltas. Negative deltas (regressions)
 * are excluded from the average but counted in sampleSize so we don't
 * lie about coverage. Higher = faster learning.
 */
const masteryVelocity: MetricDef = {
  name: 'mastery_velocity',
  description:
    'Average positive (toMastery - fromMastery) delta per '
    + 'learner.mastery_changed event. Higher is better.',
  kind: 'rate',
  direction: 'up',
  async compute(sb, window) {
    const { rows } = await fetchEventCount(sb, 'learner.mastery_changed', window);
    let positiveSum = 0;
    let positiveN = 0;
    const learners = new Set<string>();
    for (const r of rows) {
      const p = r.payload as { fromMastery?: number | null; toMastery?: number };
      const from = typeof p?.fromMastery === 'number' ? p.fromMastery : 0;
      const to = typeof p?.toMastery === 'number' ? p.toMastery : 0;
      const delta = to - from;
      learners.add(r.actor_auth_user_id);
      if (delta > 0) {
        positiveSum += delta;
        positiveN++;
      }
    }
    return {
      value: positiveN === 0 ? 0 : positiveSum / positiveN,
      sampleSize: learners.size,
    };
  },
};

/**
 * streak_retention_7d — share of learners who had ≥1 activity event in
 * the first 3 days of the window AND ≥1 in the last 3 days. Approximates
 * "learners came back". Higher = better retention.
 */
const streakRetention: MetricDef = {
  name: 'streak_retention_7d',
  description:
    'Share of learners with at least one learner.* event in days 1-3 '
    + 'of the window AND at least one in days 5-7. Higher is better.',
  kind: 'rate',
  direction: 'up',
  async compute(sb, window) {
    const startMs = Date.parse(window.startsAt);
    const endMs = Date.parse(window.endsAt);
    const totalMs = endMs - startMs;
    if (totalMs <= 0) return { value: 0, sampleSize: 0 };
    const firstThirdEndsAt = new Date(startMs + totalMs * 0.42).toISOString();
    const lastThirdStartsAt = new Date(startMs + totalMs * 0.58).toISOString();

    const early = await fetchAnyLearnerEvent(sb, {
      startsAt: window.startsAt,
      endsAt: firstThirdEndsAt,
      schoolId: window.schoolId ?? null,
    });
    const late = await fetchAnyLearnerEvent(sb, {
      startsAt: lastThirdStartsAt,
      endsAt: window.endsAt,
      schoolId: window.schoolId ?? null,
    });
    const both = intersectSets(early, late);
    return {
      value: safeRate(both.size, early.size),
      sampleSize: early.size,
    };
  },
};

// ── Active-learner helpers ───────────────────────────────────────────

async function fetchActiveLearners(
  sb: SupabaseClient,
  window: MetricWindow,
): Promise<Set<string>> {
  return fetchAnyLearnerEvent(sb, window);
}

async function fetchAnyLearnerEvent(
  sb: SupabaseClient,
  window: MetricWindow,
): Promise<Set<string>> {
  let q = sb
    .from('state_events')
    .select('actor_auth_user_id')
    .like('kind', 'learner.%')
    .gte('occurred_at', window.startsAt)
    .lt('occurred_at', window.endsAt);
  if (window.schoolId) {
    q = q.eq('tenant_id', window.schoolId);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(`fetchAnyLearnerEvent: ${error.message}`);
  }
  return new Set((data ?? []).map((r: { actor_auth_user_id: string }) => r.actor_auth_user_id));
}

function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

function daysBetween(startIso: string, endIso: string): number {
  return Math.max(0, (Date.parse(endIso) - Date.parse(startIso)) / (24 * 3600 * 1000));
}

// ── Registry ─────────────────────────────────────────────────────────

const ALL_METRICS: ReadonlyArray<MetricDef> = [
  foxyHelpfulRate,
  quizCompletionRate,
  masteryVelocity,
  streakRetention,
];

export const METRIC_REGISTRY: ReadonlyMap<string, MetricDef> = (() => {
  const m = new Map<string, MetricDef>();
  for (const def of ALL_METRICS) {
    if (m.has(def.name)) {
      throw new Error(`metrics/registry: duplicate name "${def.name}"`);
    }
    m.set(def.name, def);
  }
  return m;
})();

export function getMetricDef(name: string): MetricDef | null {
  return METRIC_REGISTRY.get(name) ?? null;
}

export function allMetricNames(): readonly string[] {
  return Array.from(METRIC_REGISTRY.keys());
}
