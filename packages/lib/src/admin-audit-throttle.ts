/**
 * Phase G.5 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * Throttled audit for read-only PII routes. Without this, every page-refresh
 * on /super-admin/students/:id/* would emit several audit rows per admin per
 * minute, drowning the audit table and making forensic queries useless.
 *
 * Strategy: in-process Map keyed by (admin_id, entity_id, action), TTL 1 hour.
 * Process-local; serverless cold starts reset the throttle. Acceptable because
 * the worst-case spam is bounded by the number of cold containers spawned per
 * hour (~tens), and the goal is to record "admin X looked at student Y" once
 * per investigation session, not every keystroke.
 *
 * Use ONLY for read-path PII routes. Mutations always audit.
 */

import { logAdminAudit, type AdminAuth } from './admin-auth';

interface ThrottleKey {
  adminId: string;
  entityId: string;
  action: string;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, number>();

// Periodic eviction so the Map doesn't grow without bound during a long-lived
// Lambda/Vercel container. Cheap O(n) sweep; n is tiny because of the TTL.
function evictExpired(now: number): void {
  for (const [k, expires] of cache.entries()) {
    if (expires <= now) cache.delete(k);
  }
}

function shouldAudit(key: ThrottleKey, now: number): boolean {
  const compositeKey = `${key.adminId}|${key.entityId}|${key.action}`;
  const expires = cache.get(compositeKey);
  if (expires && expires > now) return false;
  cache.set(compositeKey, now + TTL_MS);
  // Sweep on every 32nd write so we don't pay O(n) on every call.
  if (cache.size > 100 && Math.random() < 1 / 32) evictExpired(now);
  return true;
}

/**
 * Audit a PII read at most once per admin/entity/action/hour.
 *
 * Fire-and-forget. Caller does not await; failures are swallowed by the
 * underlying logAdminAudit fire-and-forget behaviour.
 */
export function auditPiiReadThrottled(
  admin: AdminAuth,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
  ipAddress?: string,
): void {
  const now = Date.now();
  const allow = shouldAudit({ adminId: admin.userId, entityId, action }, now);
  if (!allow) return;
  // Don't await — caller's hot path stays fast.
  void logAdminAudit(admin, action, entityType, entityId, details, ipAddress);
}

/** For tests only: clears the in-process throttle cache. */
export function _resetAuditThrottleForTests(): void {
  cache.clear();
}
