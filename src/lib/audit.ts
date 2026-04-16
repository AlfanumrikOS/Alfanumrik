/**
 * ALFANUMRIK -- Structured Audit Logging
 *
 * Records security-relevant events with full context for compliance
 * and incident investigation. Writes to both the audit_logs table
 * and structured console logs.
 *
 * Every audit event includes:
 *   - actor_id: who performed the action (auth user ID)
 *   - actor_role: the role(s) of the actor at time of action
 *   - action: what was done (e.g., 'user.suspended', 'role.updated')
 *   - target_entity: type of resource affected (e.g., 'student', 'role')
 *   - target_id: ID of the affected resource
 *   - previous_state: state before the change (for mutations)
 *   - timestamp: ISO 8601 timestamp
 *   - request_id: correlation ID from middleware
 *
 * Usage:
 *   import { auditLog, AuditAction } from '@/lib/audit';
 *
 *   await auditLog({
 *     actor_id: auth.userId,
 *     actor_role: auth.roles,
 *     action: AuditAction.USER_SUSPENDED,
 *     target_entity: 'student',
 *     target_id: studentId,
 *     previous_state: { is_active: true },
 *     metadata: { reason: 'policy violation' },
 *     request,
 *   });
 */

import { logger } from '@/lib/logger';
import type { RoleName } from '@/lib/rbac';

// ---- Well-known audit actions ----

export const AuditAction = {
  // Auth
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password_changed',
  PASSWORD_RESET: 'auth.password_reset',

  // User management
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_SUSPENDED: 'user.suspended',
  USER_ACTIVATED: 'user.activated',
  USER_DELETED: 'user.deleted',

  // RBAC
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  ROLE_ASSIGNED: 'role.assigned',
  ROLE_REVOKED: 'role.revoked',
  PERMISSION_DENIED: 'permission.denied',

  // Feature flags
  FLAG_CREATED: 'feature_flag.created',
  FLAG_UPDATED: 'feature_flag.updated',
  FLAG_DELETED: 'feature_flag.deleted',

  // Payments
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_RENEWED: 'subscription.renewed',
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',

  // Content
  QUESTION_CREATED: 'question.created',
  QUESTION_UPDATED: 'question.updated',
  QUESTION_DELETED: 'question.deleted',

  // Data access
  DATA_EXPORTED: 'data.exported',
  REPORT_DOWNLOADED: 'report.downloaded',
  BULK_OPERATION: 'bulk.operation',
} as const;

export type AuditActionType = typeof AuditAction[keyof typeof AuditAction] | string;

// ---- Audit event interface ----

export interface AuditEvent {
  /** Auth user ID of the actor. Null for system actions. */
  actor_id: string | null;
  /** Role(s) of the actor at the time of the action. */
  actor_role?: RoleName | RoleName[] | string;
  /** What was done. Use AuditAction constants for well-known actions. */
  action: AuditActionType;
  /** Type of resource affected. */
  target_entity: string;
  /** ID of the affected resource. */
  target_id?: string;
  /** State before the change (for mutations). */
  previous_state?: Record<string, unknown>;
  /** Additional context. */
  metadata?: Record<string, unknown>;
  /** The incoming request (used to extract IP, user-agent, request ID). */
  request?: Request;
  /** Override status. Defaults to 'success'. */
  status?: 'success' | 'failure' | 'denied';
}

// ---- Helpers ----

function extractRequestContext(request?: Request): {
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
} {
  if (!request) {
    return { ip_address: null, user_agent: null, request_id: null };
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null;
  const userAgent = request.headers.get('user-agent') || null;
  const requestId = request.headers.get('x-request-id') || null;

  return { ip_address: ip, user_agent: userAgent, request_id: requestId };
}

// ---- Main audit function ----

/**
 * Record a structured audit event.
 *
 * Writes to:
 * 1. Structured console log (always, for log aggregation)
 * 2. audit_logs database table (best-effort, fire-and-forget)
 *
 * Never throws -- audit failures must not break business logic.
 */
export async function auditLog(event: AuditEvent): Promise<void> {
  const timestamp = new Date().toISOString();
  const { ip_address, user_agent, request_id } = extractRequestContext(event.request);

  const roles = Array.isArray(event.actor_role)
    ? event.actor_role.join(',')
    : event.actor_role || 'unknown';

  // 1. Always emit structured log
  const logEntry: Record<string, unknown> = {
    audit: true,
    action: event.action,
    actor_id: event.actor_id,
    actor_role: roles,
    target_entity: event.target_entity,
    target_id: event.target_id || null,
    status: event.status || 'success',
    timestamp,
    request_id,
    ip_address,
  };

  if (event.metadata) {
    logEntry.metadata = event.metadata;
  }
  if (event.previous_state) {
    logEntry.previous_state = event.previous_state;
  }

  logger.info(`AUDIT: ${event.action}`, logEntry);

  // 2. Write to database (best-effort)
  try {
    // Dynamic import to avoid circular dependency with supabase-admin
    const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
    const supabase = getSupabaseAdmin();

    await supabase.from('audit_logs').insert({
      auth_user_id: event.actor_id,
      action: event.action,
      resource_type: event.target_entity,
      resource_id: event.target_id || null,
      details: {
        actor_role: roles,
        previous_state: event.previous_state || null,
        ...event.metadata,
      },
      ip_address,
      user_agent,
      status: event.status || 'success',
    });
  } catch (err) {
    // Audit DB write failed -- log but never throw
    logger.error('audit_db_write_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      action: event.action,
      actor_id: event.actor_id,
    });
  }
}

/**
 * Convenience: log a denied access attempt.
 */
export async function auditDenied(
  actorId: string | null,
  action: string,
  targetEntity: string,
  request?: Request,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return auditLog({
    actor_id: actorId,
    action,
    target_entity: targetEntity,
    status: 'denied',
    request,
    metadata,
  });
}

// ── School-Scoped Audit Logging (Phase 3C) ──────────────────

export const SCHOOL_AUDIT_ACTIONS = [
  'teacher.invited', 'teacher.deactivated', 'student.invited', 'student.deactivated',
  'branding.updated', 'announcement.published', 'announcement.deleted',
  'exam.scheduled', 'exam.cancelled', 'content.approved', 'content.rejected',
  'api_key.generated', 'api_key.revoked', 'data.exported', 'settings.updated',
] as const;

export type SchoolAuditAction = (typeof SCHOOL_AUDIT_ACTIONS)[number];

interface SchoolAuditEntry {
  schoolId: string;
  actorId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Log a school-scoped audit event to the school_audit_log table.
 * Fire-and-forget — failures never break the main operation.
 */
export async function logSchoolAudit(entry: SchoolAuditEntry): Promise<void> {
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
    const supabase = getSupabaseAdmin();
    await supabase.from('school_audit_log').insert({
      school_id: entry.schoolId,
      actor_id: entry.actorId,
      action: entry.action,
      resource_type: entry.resourceType || null,
      resource_id: entry.resourceId || null,
      metadata: entry.metadata || {},
      ip_address: entry.ipAddress || null,
    });
  } catch {
    // Audit failures must never block the main operation
  }
}
