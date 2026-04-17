/**
 * ALFANUMRIK -- Audit Anomaly Detector
 *
 * Pure-function anomaly detection over audit event streams.
 * No database access -- all detectors take an event array and return
 * anomalies (or null). Designed to be called by the daily-cron or
 * a queue-consumer job.
 *
 * Usage:
 *   import { runAllDetectors } from '@/lib/anomaly-detector';
 *   const anomalies = runAllDetectors(recentEvents);
 */

// ─── Types ───────────────────────────────────────────────────

export interface AuditEvent {
  actor_user_id: string;
  event_type: string;
  resource_type: string;
  action: string;
  result: string;
  created_at: string;
  metadata?: any;
}

export interface Anomaly {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId: string;
  details: string;
  detectedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

// ─── Detectors ───────────────────────────────────────────────

/**
 * Detect bulk student data access.
 * Triggers when any single user reads >100 student records in the event set.
 */
export function detectBulkAccess(events: AuditEvent[]): Anomaly | null {
  const studentReads = events.filter(
    (e) => e.resource_type === 'student' && e.action === 'read',
  );

  const grouped = groupBy(studentReads, (e) => e.actor_user_id);

  for (const [userId, userEvents] of grouped) {
    if (userEvents.length > 100) {
      return {
        type: 'bulk_student_access',
        severity: 'high',
        userId,
        details: `User read ${userEvents.length} student records (threshold: 100)`,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

/**
 * Detect permission escalation attempts.
 * Triggers when any single user has >5 denied permission checks.
 */
export function detectEscalationAttempts(events: AuditEvent[]): Anomaly | null {
  const denied = events.filter((e) => e.result === 'denied');

  const grouped = groupBy(denied, (e) => e.actor_user_id);

  for (const [userId, userEvents] of grouped) {
    if (userEvents.length > 5) {
      return {
        type: 'escalation_attempt',
        severity: 'medium',
        userId,
        details: `User had ${userEvents.length} denied access attempts (threshold: 5)`,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

/**
 * Detect impersonation abuse.
 * Triggers when an impersonation session has action_count > 50.
 */
export function detectImpersonationAbuse(events: AuditEvent[]): Anomaly | null {
  const impersonations = events.filter(
    (e) => e.event_type === 'impersonation_start',
  );

  for (const event of impersonations) {
    if (event.metadata?.action_count > 50) {
      return {
        type: 'impersonation_abuse',
        severity: 'high',
        userId: event.actor_user_id,
        details: `Impersonation session had ${event.metadata.action_count} actions (threshold: 50)`,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

/**
 * Detect delegation storms.
 * Triggers when any single user grants >20 delegations in the event set.
 */
export function detectDelegationStorm(events: AuditEvent[]): Anomaly | null {
  const grants = events.filter((e) => e.event_type === 'delegation_grant');

  const grouped = groupBy(grants, (e) => e.actor_user_id);

  for (const [userId, userEvents] of grouped) {
    if (userEvents.length > 20) {
      return {
        type: 'delegation_storm',
        severity: 'medium',
        userId,
        details: `User granted ${userEvents.length} delegations (threshold: 20)`,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── Run All ─────────────────────────────────────────────────

/**
 * Run all anomaly detectors against the event set.
 * Returns all detected anomalies (non-null results).
 */
export function runAllDetectors(events: AuditEvent[]): Anomaly[] {
  const detectors = [
    detectBulkAccess,
    detectEscalationAttempts,
    detectImpersonationAbuse,
    detectDelegationStorm,
  ];

  const anomalies: Anomaly[] = [];
  for (const detector of detectors) {
    const result = detector(events);
    if (result) {
      anomalies.push(result);
    }
  }

  return anomalies;
}
