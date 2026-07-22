// src/app/api/cron/adaptive-loops-monitor/_lib/evaluate-alerts.ts
//
// Pure threshold-evaluation for the adaptive-loops monitor (Master Action Plan
// item 8.1). Kept DB-free and side-effect-free so the decision logic is unit
// testable in isolation from the SECURITY DEFINER RPC that produces the
// aggregates and from the ops_events emitter that consumes these verdicts.
//
// Every threshold here is SOURCED from docs/runbooks/adaptive-program-rollout.md
// (cited inline) — none is invented.

/** Aggregate-only health shape returned by get_adaptive_loops_health (P13 —
 *  counts + ratios only, never a student id). */
export interface AdaptiveLoopsHealth {
  window_hours: number;
  storm_days: number;
  daily_new_by_signal: {
    mastery_cliff: number;
    inactivity: number;
    at_risk_concentration: number;
    blocked_prerequisite: number;
  };
  daily_new_total: number;
  ceiling_violation_count: number;
  ceiling_violation_students: number;
  terminal_total: number;
  escalation_total: number;
  escalation_share: number; // 0..1
  last_success_at: string | null;
  hours_since_last_success: number | null;
  generated_at: string;
}

// ── Thresholds (sourced, not invented) ──────────────────────────────────────

/**
 * The per-student daily ceiling is 1 NEW intervention/student/day (runbook §5
 * guardrail table + §7 "Per-student new rows per day MUST be <= 1"). The
 * arbiter guarantees it; ANY breach is a worker bug and the runbook's "Top
 * alert." So the alert threshold on the violation COUNT is 0 — a single
 * offending (student, day) pair fires.
 */
export const CEILING_VIOLATION_THRESHOLD = 0;

/**
 * "Escalation share > 50% of terminal outcomes during a pilot" (runbook §5
 * storm list). This is the EXACT storm threshold — reused verbatim, expressed
 * as a fraction.
 */
export const ESCALATION_STORM_SHARE_THRESHOLD = 0.5;

/**
 * Noise floor (NOT the storm threshold): the > 50% share is only meaningful
 * once there is a non-trivial sample of terminal outcomes. Without this, a
 * single 1-of-1 escalation reads as 100% and would page on day one of a pilot.
 * The runbook itself frames the storm as a sustained "during a pilot" pattern,
 * so requiring a modest terminal sample before evaluating the ratio is a
 * faithful reading of that intent, not a new threshold.
 */
export const ESCALATION_STORM_MIN_SAMPLE = 10;

/**
 * Missed-heartbeat staleness bound. The adaptive-remediation cron runs nightly
 * (via daily-cron), so a healthy heartbeat is < 24h old; 26h gives a ~2h grace
 * for cron drift/retries before declaring the nightly run missed.
 */
export const HEARTBEAT_STALE_HOURS = 26;

export type AdaptiveAlertKind =
  | 'ceiling_violation'
  | 'escalation_storm'
  | 'heartbeat_stale';

export interface AdaptiveAlert {
  kind: AdaptiveAlertKind;
  /** ops_events category — one per condition so each seeded alert_rule matches
   *  exactly one condition (evaluate_alert_rules keys on category + source). */
  category: string;
  severity: 'error' | 'critical';
  message: string;
  /** Aggregate-only context (P13) attached to the ops_events row. */
  context: Record<string, unknown>;
}

/**
 * Decide which alerts (if any) the monitor should emit for a given health
 * snapshot. Order is stable (ceiling, storm, heartbeat) but callers should not
 * depend on it. Pure: no I/O, no clock reads (uses the RPC's own
 * hours_since_last_success).
 */
export function evaluateAdaptiveLoopsAlerts(health: AdaptiveLoopsHealth): AdaptiveAlert[] {
  const alerts: AdaptiveAlert[] = [];

  // 1. Per-student ceiling breach — the top alert. Critical ⇒ the ops_events
  //    critical-insert trigger fires evaluate_alert_rules immediately.
  if (health.ceiling_violation_count > CEILING_VIOLATION_THRESHOLD) {
    alerts.push({
      kind: 'ceiling_violation',
      category: 'adaptive_ceiling_violation',
      severity: 'critical',
      message: `Adaptive loops ceiling violation: ${health.ceiling_violation_count} (student, day) pair(s) opened more than one new intervention in the last 7 days — the arbiter's <=1/student/day guarantee is not holding.`,
      context: {
        ceiling_violation_count: health.ceiling_violation_count,
        ceiling_violation_students: health.ceiling_violation_students,
      },
    });
  }

  // 2. Escalation storm — share > 50% of terminal outcomes, once the sample is
  //    large enough to be meaningful. Error severity ⇒ delivered by the */5
  //    evaluate_alert_rules sweep (window must exceed 5 min — it does).
  if (
    health.terminal_total >= ESCALATION_STORM_MIN_SAMPLE &&
    health.escalation_share > ESCALATION_STORM_SHARE_THRESHOLD
  ) {
    alerts.push({
      kind: 'escalation_storm',
      category: 'adaptive_escalation_storm',
      severity: 'error',
      message: `Adaptive loops escalation storm: ${(health.escalation_share * 100).toFixed(1)}% of the last ${health.storm_days}d terminal outcomes were escalations (> 50% threshold) — verify may be blind (check ff_event_bus_v1) or the windows/content are not working.`,
      context: {
        escalation_share: health.escalation_share,
        escalation_total: health.escalation_total,
        terminal_total: health.terminal_total,
        storm_days: health.storm_days,
      },
    });
  }

  // 3. Missed heartbeat — the nightly adaptive-remediation run has not recorded
  //    a success in > 26h (or has never recorded one). Critical ⇒ immediate.
  const stale =
    health.hours_since_last_success === null ||
    health.hours_since_last_success > HEARTBEAT_STALE_HOURS;
  if (stale) {
    alerts.push({
      kind: 'heartbeat_stale',
      category: 'adaptive_cron_stale',
      severity: 'critical',
      message:
        health.last_success_at === null
          ? 'Adaptive remediation cron has no recorded successful run — the nightly loop worker may never have run (or the heartbeat is unwired).'
          : `Adaptive remediation cron last succeeded ${health.hours_since_last_success}h ago (> ${HEARTBEAT_STALE_HOURS}h) — the nightly loop worker appears to have missed a run.`,
      context: {
        last_success_at: health.last_success_at,
        hours_since_last_success: health.hours_since_last_success,
        stale_threshold_hours: HEARTBEAT_STALE_HOURS,
      },
    });
  }

  return alerts;
}
