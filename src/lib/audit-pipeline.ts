/**
 * ALFANUMRIK -- Tamper-Evident Audit Pipeline
 *
 * Provides a chain-hashed, fire-and-forget audit event pipeline for the
 * RBAC Phase 1 system.  Every event is linked to its predecessor via a
 * SHA-256 chain hash, making retrospective tampering detectable.
 *
 * Usage:
 *   import { writeAuditEvent, computeChainHash } from '@/lib/audit-pipeline';
 *
 *   await writeAuditEvent({
 *     eventType: 'permission_check',
 *     actorUserId: userId,
 *     action: 'evaluate',
 *     result: 'granted',
 *     resourceType: 'api_route',
 *     permissionCode: 'quiz.attempt',
 *   });
 */

import { createHash, randomUUID } from 'crypto';
import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────

export type AuditEventType =
  | 'permission_check'
  | 'data_access'
  | 'role_change'
  | 'impersonation_start'
  | 'impersonation_end'
  | 'delegation_grant'
  | 'delegation_revoke'
  | 'oauth_consent'
  | 'login'
  | 'logout'
  | 'admin_action'
  | 'anomaly_detected'
  | 'cache_invalidation';

export type AuditAction =
  | 'read'
  | 'write'
  | 'delete'
  | 'grant'
  | 'revoke'
  | 'login'
  | 'logout'
  | 'evaluate'
  | 'elevate'
  | 'impersonate';

export type AuditResult = 'granted' | 'denied' | 'error';

export interface AuditEventInput {
  eventType: AuditEventType;
  actorUserId?: string | null;
  effectiveUserId?: string | null;
  schoolId?: string | null;
  permissionCode?: string | null;
  resourceType: string;
  resourceId?: string | null;
  action: AuditAction;
  result: AuditResult;
  resolutionTrace?: Record<string, unknown> | null;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ChainHashInput {
  previousHash: string;
  eventId: string;
  eventType: string;
  actorUserId: string | null;
  action: string;
  result: string;
  createdAt: string;
}

export interface SnapshotCapture {
  table: string;
  resourceId: string;
  capturedAt: string;
  data: Record<string, unknown> | null;
}

// ─── Chain Hash ──────────────────────────────────────────────

/** Module-level chain state. Starts at GENESIS for the first event. */
let _lastChainHash = 'GENESIS';

/**
 * Compute a SHA-256 chain hash from the given input fields.
 * Concatenates fields with '|' separator. Uses 'GENESIS' as default
 * when previousHash is falsy.
 */
export function computeChainHash(input: ChainHashInput): string {
  const previous = input.previousHash || 'GENESIS';
  const actor = input.actorUserId ?? 'null';
  const payload = [
    previous,
    input.eventId,
    input.eventType,
    actor,
    input.action,
    input.result,
    input.createdAt,
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}

// ─── Snapshot Helpers ────────────────────────────────────────

/**
 * Capture the current state of a row from the database for before-snapshot.
 * Returns null data if the row cannot be found.
 */
export async function captureBeforeSnapshot(
  table: string,
  resourceId: string,
  fields?: string[],
): Promise<SnapshotCapture> {
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
    const supabase = getSupabaseAdmin();
    const selectFields = fields ? fields.join(', ') : '*';
    const { data, error } = await supabase
      .from(table)
      .select(selectFields)
      .eq('id', resourceId)
      .single();

    return {
      table,
      resourceId,
      capturedAt: new Date().toISOString(),
      data: error ? null : (data as Record<string, unknown>),
    };
  } catch {
    return {
      table,
      resourceId,
      capturedAt: new Date().toISOString(),
      data: null,
    };
  }
}

/**
 * Compose an audit event with before/after snapshots attached.
 */
export function createAuditEventWithSnapshot(
  snapshot: SnapshotCapture,
  after: Record<string, unknown> | null,
  input: Omit<AuditEventInput, 'beforeSnapshot' | 'afterSnapshot'>,
): AuditEventInput {
  return {
    ...input,
    beforeSnapshot: snapshot.data,
    afterSnapshot: after,
  };
}

// ─── Write Audit Event ───────────────────────────────────────

/**
 * Write an audit event to the audit_events table.
 * Fire-and-forget: logs errors but never throws.
 */
export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();

    const chainHash = computeChainHash({
      previousHash: _lastChainHash,
      eventId,
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      result: input.result,
      createdAt,
    });

    _lastChainHash = chainHash;

    const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
    const supabase = getSupabaseAdmin();

    await supabase.from('audit_events').insert({
      event_id: eventId,
      event_type: input.eventType,
      actor_user_id: input.actorUserId ?? null,
      effective_user_id: input.effectiveUserId ?? null,
      school_id: input.schoolId ?? null,
      permission_code: input.permissionCode ?? null,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      action: input.action,
      result: input.result,
      resolution_trace: input.resolutionTrace ?? null,
      before_snapshot: input.beforeSnapshot ?? null,
      after_snapshot: input.afterSnapshot ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      session_id: input.sessionId ?? null,
      request_id: input.requestId ?? null,
      metadata: input.metadata ?? null,
      chain_hash: chainHash,
      created_at: createdAt,
    });
  } catch (err) {
    logger.error('audit_pipeline_write_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      eventType: input.eventType,
      action: input.action,
    });
    // Fire-and-forget: never throw
  }
}

// ─── Test Helpers (exported for testing only) ────────────────

/** Reset chain hash to GENESIS. For tests only. */
export function _resetChainHash(): void {
  _lastChainHash = 'GENESIS';
}

/** Get current chain hash. For tests only. */
export function _getLastChainHash(): string {
  return _lastChainHash;
}
