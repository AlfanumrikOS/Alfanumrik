// apps/host/src/app/api/cron/synthesis-delivery-monitor/_lib/compute-rollup.ts
//
// Pure rollup computation for the Monthly-Synthesis WhatsApp delivery monitor
// (Master Action Plan Phase 8, item 8.4). Kept DB-free and side-effect-free so
// the decision logic is unit-testable in isolation from the DB read and the
// ops_events emitter — and, critically, so route.ts exports ONLY HTTP method
// handlers + recognized route config (Next.js App Router rejects any other
// export from a route module at `next build`). Mirrors the sibling
// adaptive-loops-monitor/_lib/evaluate-alerts.ts split.

/** Trailing window (hours) the rollup is computed over. */
export const WINDOW_HOURS = 24;
/** Alert when the failure rate strictly exceeds this percentage… */
export const FAILURE_RATE_ALERT_PCT = 20;
/** …AND there are at least this many terminal delivery attempts (sent+failed). */
export const MIN_ATTEMPTS_FOR_ALERT = 5;

export interface StatusRow {
  parent_share_status: string;
}

export interface DeliveryRollup {
  window_hours: number;
  sent: number;
  failed: number;
  opted_out: number;
  flagged: number;
  suppressed: number;
  pending: number;
  /** failed / (sent+failed) * 100, rounded; null when no terminal attempts. */
  failure_rate_pct: number | null;
  /** opted_out / (sent+failed+opted_out) * 100, rounded; null when empty. */
  opted_out_pct: number | null;
  attempts: number; // sent + failed
  breached: boolean;
}

/** Pure — computes the rollup from raw status rows so it is unit-testable. */
export function computeRollup(rows: StatusRow[]): DeliveryRollup {
  let sent = 0, failed = 0, opted_out = 0, flagged = 0, suppressed = 0, pending = 0;
  for (const r of rows) {
    switch (r.parent_share_status) {
      case 'sent': sent++; break;
      case 'failed': failed++; break;
      case 'opted_out': opted_out++; break;
      case 'flagged': flagged++; break;
      case 'suppressed': suppressed++; break;
      case 'pending': pending++; break;
      default: break; // unknown/future status — ignored, never crashes
    }
  }
  const attempts = sent + failed;
  const failure_rate_pct = attempts > 0 ? Math.round((failed / attempts) * 100) : null;
  const optedDenom = attempts + opted_out;
  const opted_out_pct = optedDenom > 0 ? Math.round((opted_out / optedDenom) * 100) : null;
  const breached =
    failure_rate_pct !== null &&
    failure_rate_pct > FAILURE_RATE_ALERT_PCT &&
    attempts >= MIN_ATTEMPTS_FOR_ALERT;

  return {
    window_hours: WINDOW_HOURS,
    sent, failed, opted_out, flagged, suppressed, pending,
    failure_rate_pct, opted_out_pct, attempts, breached,
  };
}
