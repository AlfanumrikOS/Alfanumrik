// packages/lib/src/teacher/alert-reconciler.ts
//
// Teacher Command Center — at-risk alert RECONCILER.
//
// BACKGROUND (RCA, 2026-07-20): the Command Center's PRIMARY alerts rail reads
// the legacy `get_alerts` action in `supabase/functions/teacher-dashboard/
// index.ts` (a simple cumulative-accuracy threshold + a streak-broken
// heuristic, read from `student_learning_profiles`). Two SECONDARY panels
// (`/teacher/classes`, `/teacher/students`) separately surface Student Pulse
// (`packages/lib/src/pulse/*`) — three richer signals: inactivity,
// mastery-cliff, at-risk concentration. The two systems can disagree on the
// SAME student at the SAME time, and neither one is a strict superset of the
// other:
//
//   - `get_alerts`' accuracy check is a LIFETIME/cumulative correct/asked
//     ratio per subject (>=5 questions), which is a fundamentally different
//     measurement than Pulse's per-chapter BKT mastery (p_know). A student can
//     have chronically low cumulative accuracy from day one (never a
//     "decline", so Pulse's mastery-cliff signal — which only fires on a
//     DROP or a 3-in-a-row DECLINE — never flags it) while their per-chapter
//     p_know values individually stay at/above the 0.4 at-risk line (BKT
//     updates on a different curve than raw accuracy). `get_alerts` would
//     catch this; Pulse would not.
//   - `get_alerts`' streak check reads `student_learning_profiles.streak_days`
//     literally (`=== 0`), whereas Pulse's inactivity signal derives its own
//     verdict from `last_active` on a UTC-calendar-day boundary. These two
//     can disagree (e.g. a freeze consumed differently, or the daily-cron
//     reset having already run against a different snapshot).
//   - Conversely, Pulse's inactivity GRACE-day warning ('at_risk', i.e. active
//     yesterday but streak resets tonight) and at-risk-CONCENTRATION signal
//     (a cluster of weak chapters within one subject) are things `get_alerts`
//     never looks at at all.
//
// Because neither system is a safe superset of the other, and reconciling
// them is a genuine product judgment call (not something a single agent
// should force), the SAFE REVERSIBLE choice implemented here is: keep BOTH
// systems computing independently, and reconcile their outputs into ONE
// at-risk determination per student — the UNION of whatever either system
// flagged — with a single, traceable "why flagged" reason string. Nothing is
// deleted; both `get_alerts` and the two secondary Pulse panels keep working
// exactly as they do today. This module is the (pure, side-effect-free) merge
// step; the Command Center calls it with data it already fetches via
// `useAlerts` (legacy) and `useClassPulse` (Pulse).
//
// FLAG-GATING DECISION (documented, not guessed): `ff_school_pulse_v1` today
// only gates the school-admin surface — the two teacher-side Pulse panels
// (`/teacher/classes`, `/teacher/students`) already render UNCONDITIONALLY,
// with no flag check at all. To avoid introducing a THIRD, inconsistent
// gating pattern, this reconciler's Pulse-derived alerts are ALSO
// unconditional on the Command Center — consistent with the two panels that
// already ship this way. If Pulse is ever flag-gated for the teacher surface,
// all three call sites (this reconciler + the two panels) must be gated
// together in one follow-up change.
//
// P1/P2 untouched: this module never touches score or XP math. P5: subject
// codes pass through verbatim, no grade math. P13: reasons are derived,
// non-PII strings (subject codes, day counts, chapter counts) — never raw
// event payloads.

import type { RiskAlert } from '../types';
import type { PulseSignals, PulseListItem } from '../pulse/types';

// ════════════════════════════════════════════════════════════════════════════
// SEVERITY
// ════════════════════════════════════════════════════════════════════════════

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Lower rank = more severe. Single source of truth for severity ordering. */
export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function worseSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

// ════════════════════════════════════════════════════════════════════════════
// RECONCILED ALERT SHAPE
// ════════════════════════════════════════════════════════════════════════════

/**
 * One at-risk determination per student — the UNION of whatever the legacy
 * `get_alerts` accuracy/streak check and Pulse's three signals independently
 * flagged. Drop-in compatible with `RiskAlert` (same fields the existing
 * `AlertRow` component renders) plus `reasons`/`sources` for traceability and
 * testability.
 */
export interface ReconciledAlert extends RiskAlert {
  /** One or more short, human-readable reason strings — each traceable to a
   *  specific legacy check or Pulse signal. `description` (from `RiskAlert`)
   *  is these joined with " and " — the single "why flagged" string. */
  reasons: string[];
  /** Which system(s) contributed to this student's determination. Never both
   *  false — a student only appears here if at least one system flagged them. */
  sources: { legacy: boolean; pulse: boolean };
}

// ════════════════════════════════════════════════════════════════════════════
// LEGACY REASON EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract a short, subject-attributed reason from a legacy `get_alerts` row.
 * `get_alerts` always formats `title` as `${name} — ${reason}` (verified in
 * `supabase/functions/teacher-dashboard/index.ts` handleGetAlerts — the
 * critical/high/streak templates all follow this shape), so we strip the name
 * prefix rather than re-deriving accuracy math the Edge function already
 * computed (single source of truth stays server-side, P1-adjacent discipline:
 * never recompute a score-derived number client-side).
 */
export function legacyReasonFromAlert(alert: RiskAlert): string {
  const parts = alert.title.split(' — ');
  const base = parts.length > 1 ? parts.slice(1).join(' — ') : alert.title;
  const pctMatch = alert.description.match(/(\d+)%/);
  if (pctMatch && !base.includes('%')) {
    return `${base} (${pctMatch[1]}%)`;
  }
  return base;
}

// ════════════════════════════════════════════════════════════════════════════
// PULSE REASON EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Derive a severity + reason list from one student's Pulse signals. Returns
 * `null` when Pulse does not consider the student at risk (no signal reaches
 * at least the 'watch' bar — 'thriving' / 'steady' / 'unknown' never
 * contribute a Pulse-side alert, keeping the rail free of low-signal noise).
 */
export function pulseReasonsAndSeverity(
  signals: PulseSignals,
): { severity: AlertSeverity; reasons: string[] } | null {
  const { inactivity, masteryCliff, atRiskConcentration } = signals;
  const reasons: string[] = [];
  let severity: AlertSeverity | null = null;

  if (inactivity.verdict === 'broken') {
    reasons.push(`${inactivity.daysSinceActive ?? 2}+ days inactive`);
    severity = 'critical';
  } else if (inactivity.verdict === 'at_risk') {
    reasons.push('Streak at risk (inactive since yesterday)');
    severity = worseSeverity(severity ?? 'low', 'medium');
  }

  if (atRiskConcentration.worstBand === 'high') {
    reasons.push(
      `${atRiskConcentration.totalAtRiskChapters} weak chapters across subjects`,
    );
    severity = 'critical';
  } else if (atRiskConcentration.worstBand === 'medium') {
    const worst = atRiskConcentration.bySubject[0];
    reasons.push(
      worst
        ? `Weak-chapter cluster forming in ${worst.subject}`
        : 'Weak-chapter cluster forming',
    );
    severity = worseSeverity(severity ?? 'low', 'medium');
  }

  if (masteryCliff.verdict === 'flagged') {
    reasons.push(
      masteryCliff.worstSubject
        ? `Mastery drop in ${masteryCliff.worstSubject}`
        : 'Recent mastery decline',
    );
    severity = worseSeverity(severity ?? 'low', 'medium');
  }

  if (reasons.length === 0 || severity == null) return null;
  return { severity, reasons };
}

// ════════════════════════════════════════════════════════════════════════════
// RECONCILE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Merge legacy `get_alerts` rows + Pulse class-lens items into ONE
 * determination per student (worst-severity-first). Pure: same inputs always
 * yield the same output, no I/O.
 */
export function reconcileAlerts(
  legacyAlerts: RiskAlert[],
  pulseItems: PulseListItem[],
): ReconciledAlert[] {
  const byStudent = new Map<string, ReconciledAlert>();

  // Legacy pass — process most-severe-first so the "base" id / recommended
  // action / remediation_status a student keeps is from their worst legacy row.
  const sortedLegacy = [...legacyAlerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  for (const a of sortedLegacy) {
    const reason = legacyReasonFromAlert(a);
    const existing = byStudent.get(a.student_id);
    if (existing) {
      existing.reasons.push(reason);
      existing.severity = worseSeverity(existing.severity, a.severity);
      existing.sources.legacy = true;
    } else {
      byStudent.set(a.student_id, {
        id: a.id,
        student_id: a.student_id,
        student_name: a.student_name,
        severity: a.severity,
        title: `${a.student_name} — at risk`,
        description: reason,
        recommended_action: a.recommended_action,
        remediation_status: a.remediation_status,
        reasons: [reason],
        sources: { legacy: true, pulse: false },
      });
    }
  }

  // Pulse pass.
  for (const item of pulseItems) {
    const pulse = pulseReasonsAndSeverity(item.signals);
    if (!pulse) continue;
    const existing = byStudent.get(item.studentId);
    if (existing) {
      existing.reasons.push(...pulse.reasons);
      existing.severity = worseSeverity(existing.severity, pulse.severity);
      existing.sources.pulse = true;
    } else {
      byStudent.set(item.studentId, {
        id: `pulse-${item.studentId}`,
        student_id: item.studentId,
        student_name: item.displayName,
        severity: pulse.severity,
        title: `${item.displayName} — at risk`,
        description: pulse.reasons.join(' and '),
        recommended_action: undefined,
        remediation_status: 'none',
        reasons: pulse.reasons,
        sources: { legacy: false, pulse: true },
      });
    }
  }

  // Finalize: description is the joined reason string (the single "why
  // flagged" line the rail renders) — recomputed here in case a student was
  // touched by BOTH passes (union of reasons).
  const out = Array.from(byStudent.values()).map((a) => ({
    ...a,
    description: a.reasons.join(' and '),
  }));

  out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.student_name.localeCompare(b.student_name),
  );
  return out;
}
