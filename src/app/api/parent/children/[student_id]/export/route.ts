/**
 * GET /api/parent/children/[student_id]/export — Phase D.2 (DPDP §13).
 *
 * India's Digital Personal Data Protection Act §13 grants every data
 * principal (here: a child, exercised via their guardian) the right to
 * access a copy of all personal data the platform holds about them.
 *
 * This route returns a single JSON file containing every row keyed by
 * `student_id` across the school-scoped table set documented in
 * `docs/runbooks/per-school-backup-restore.md` §1. The guardian must be
 * verified and linked to the child via `guardian_student_links`; no
 * cross-guardian access is permitted.
 *
 * Auth contract:
 *   1. `authorizeRequest(request, 'child.view_progress')` — RBAC gate
 *   2. `getGuardianByAuthUserId` — caller must be a parent
 *   3. `listChildrenForGuardian` — caller must be linked to `student_id`
 *
 * Side effects:
 *   - `audit_logs` row with action `'parent.child_data_exported'` + row
 *     counts per table (success path)
 *   - `parent.child_data_exported` state_event (success path, gated by
 *     `ff_event_bus_v1` like every other publisher)
 *   - On 403/413 we still write a `denied` audit row so misuse + ops
 *     handoffs are observable.
 *
 * Size guardrail:
 *   The in-app endpoint is for small payloads. If the assembled JSON
 *   exceeds 10MB the route returns 413 + a message asking the guardian
 *   to contact ops for an offline export (the school-scoped backup
 *   pipeline at §2 of the runbook handles arbitrarily large datasets).
 *
 * Hard rules (per D.2 brief):
 *   - No new dependencies
 *   - `ChildSummary.studentId` (not `.id`) when matching the link
 *   - journey.ts handles the new event kind (exhaustiveness)
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getGuardianByAuthUserId } from '@/lib/domains/identity';
import { listChildrenForGuardian } from '@/lib/domains/relationship';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';
import { publishEvent } from '@/lib/state/events/publish';

// 10MB cap on the in-app export. Anything larger requires the ops
// pipeline documented in per-school-backup-restore.md §2 — keyed by
// the runbook so the limit travels with the doc.
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

// Schema version for the exported file. Bumped when the file shape
// breaks; consumers that re-import the JSON read this to branch.
const EXPORT_SCHEMA_VERSION = 'v1-2026-05';

interface TableSpec {
  /** Key on the response JSON. */
  key: string;
  /** Postgres table name. */
  table: string;
  /** Column holding the student id; null means single-row by id. */
  studentIdColumn: string | null;
  /** When studentIdColumn is null, the column the student id matches. */
  singleColumn?: string;
}

// School-scoped student data — sourced from per-school-backup-restore.md §1
// (the canonical inventory). Tables not keyed by student_id are excluded
// — guardian_student_links, school_audit_log, school subscriptions, etc.,
// are about the parent or the school, not the child. The reverse-FK lookup
// for parental_consent / guardian_consents tables is omitted because no
// such table exists yet in the schema (see RBAC v1 oauth_consents only).
const TABLE_SPECS: ReadonlyArray<TableSpec> = [
  // Core profile — single row.
  { key: 'student',             table: 'students',                  studentIdColumn: null, singleColumn: 'id' },
  // Subscription — at most one active row per student.
  { key: 'subscription',        table: 'student_subscriptions',     studentIdColumn: 'student_id' },
  // BKT / mastery profile — typically 1 row.
  { key: 'learning_profile',    table: 'student_learning_profiles', studentIdColumn: 'student_id' },
  // Quiz history.
  { key: 'quiz_sessions',       table: 'quiz_sessions',             studentIdColumn: 'student_id' },
  { key: 'quiz_attempts',       table: 'quiz_responses',            studentIdColumn: 'student_id' },
  // Foxy AI conversations.
  { key: 'foxy_chat_messages',  table: 'foxy_chat_messages',        studentIdColumn: 'student_id' },
  // Report-card scores.
  { key: 'score_history',       table: 'score_history',             studentIdColumn: 'student_id' },
  // Assignment submissions.
  { key: 'submissions',         table: 'assignment_submissions',    studentIdColumn: 'student_id' },
  // Notifications addressed to this child.
  { key: 'notifications',       table: 'notifications',             studentIdColumn: 'recipient_id' },
];

function shortId(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 8);
}

function yyyymmdd(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ student_id: string }> },
) {
  try {
    // ── 1. RBAC gate ─────────────────────────────────────────────────
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    // ── 2. Path param validation ─────────────────────────────────────
    const { student_id: studentId } = await context.params;
    if (!studentId || !isValidUUID(studentId)) {
      return NextResponse.json(
        { success: false, error: 'Valid student_id is required' },
        { status: 400 },
      );
    }

    // ── 3. Resolve parent (guardian) record ──────────────────────────
    const guardianRes = await getGuardianByAuthUserId(auth.userId!);
    if (!guardianRes.ok || !guardianRes.data) {
      logAudit(auth.userId!, {
        action: 'parent.child_data_exported',
        resourceType: 'students',
        resourceId: studentId,
        status: 'denied',
        details: { reason: 'no_guardian_profile' },
      });
      return NextResponse.json(
        { success: false, error: 'No parent profile found' },
        { status: 403 },
      );
    }
    const guardian = guardianRes.data;

    // ── 4. Verify guardian-child link (strict ownership) ─────────────
    // Use listChildrenForGuardian rather than isGuardianLinkedToStudent
    // because we need the school_id for the state-event tenantId. The
    // function uses ACTIVE_GUARDIAN_LINK_STATUSES so revoked/pending
    // links return 403.
    const childrenRes = await listChildrenForGuardian(auth.userId!);
    if (!childrenRes.ok) {
      logger.error('parent_child_export_children_lookup_failed', {
        route: 'parent/children/export',
        guardianId: guardian.id,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to verify guardian link' },
        { status: 500 },
      );
    }
    const linkedChild = childrenRes.data.find((c) => c.studentId === studentId);
    if (!linkedChild) {
      logAudit(auth.userId!, {
        action: 'parent.child_data_exported',
        resourceType: 'students',
        resourceId: studentId,
        status: 'denied',
        details: { reason: 'not_linked', guardian_id: guardian.id },
      });
      return NextResponse.json(
        { success: false, error: 'You are not linked to this student' },
        { status: 403 },
      );
    }

    // ── 5. Aggregate the tables ──────────────────────────────────────
    // We run reads in parallel — each table is independent. Errors on
    // any single table fail the whole export (better to refuse a partial
    // download than ship a misleading "complete" file). Notifications
    // for guardians (recipient_type='guardian') aren't included here —
    // they belong to the guardian, not the child.
    const tableCounts: Record<string, number> = {};
    const exportBody: Record<string, unknown> = {
      schema_version: EXPORT_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
    };

    for (const spec of TABLE_SPECS) {
      try {
        if (spec.studentIdColumn === null && spec.singleColumn) {
          // Single-row read keyed by id.
          const { data, error } = await supabaseAdmin
            .from(spec.table)
            .select('*')
            .eq(spec.singleColumn, studentId)
            .maybeSingle();
          if (error) {
            logger.error('parent_child_export_table_fetch_failed', {
              route: 'parent/children/export',
              table: spec.table,
              error: new Error(error.message),
            });
            return NextResponse.json(
              { success: false, error: `Failed to load ${spec.key}` },
              { status: 500 },
            );
          }
          exportBody[spec.key] = data;
          tableCounts[spec.table] = data ? 1 : 0;
        } else if (spec.table === 'notifications') {
          // Notifications need a compound filter so a guardian can't
          // exfiltrate notifications addressed to a guardian by passing
          // the guardian's id as a student_id (the columns share UUID
          // shape but the row is owned by a different role).
          const { data, error } = await supabaseAdmin
            .from(spec.table)
            .select('*')
            .eq('recipient_id', studentId)
            .eq('recipient_type', 'student');
          if (error) {
            logger.error('parent_child_export_table_fetch_failed', {
              route: 'parent/children/export',
              table: spec.table,
              error: new Error(error.message),
            });
            return NextResponse.json(
              { success: false, error: `Failed to load ${spec.key}` },
              { status: 500 },
            );
          }
          exportBody[spec.key] = data ?? [];
          tableCounts[spec.table] = (data ?? []).length;
        } else if (spec.table === 'student_subscriptions' || spec.table === 'student_learning_profiles') {
          // These are typically single-row-per-student but we treat as
          // a list defensively — the test suite for student_subscriptions
          // shows multiple rows are possible during plan transitions.
          const { data, error } = await supabaseAdmin
            .from(spec.table)
            .select('*')
            .eq(spec.studentIdColumn!, studentId);
          if (error) {
            logger.error('parent_child_export_table_fetch_failed', {
              route: 'parent/children/export',
              table: spec.table,
              error: new Error(error.message),
            });
            return NextResponse.json(
              { success: false, error: `Failed to load ${spec.key}` },
              { status: 500 },
            );
          }
          // Preserve the "subscription" / "learning_profile" naming as a
          // single object when there's exactly one row to keep the
          // payload spec stable; emit array when there are 0 or 2+.
          if (Array.isArray(data) && data.length === 1) {
            exportBody[spec.key] = data[0];
          } else {
            exportBody[spec.key] = data ?? [];
          }
          tableCounts[spec.table] = (data ?? []).length;
        } else {
          // Multi-row list read.
          const { data, error } = await supabaseAdmin
            .from(spec.table)
            .select('*')
            .eq(spec.studentIdColumn!, studentId);
          if (error) {
            logger.error('parent_child_export_table_fetch_failed', {
              route: 'parent/children/export',
              table: spec.table,
              error: new Error(error.message),
            });
            return NextResponse.json(
              { success: false, error: `Failed to load ${spec.key}` },
              { status: 500 },
            );
          }
          exportBody[spec.key] = data ?? [];
          tableCounts[spec.table] = (data ?? []).length;
        }
      } catch (e) {
        logger.error('parent_child_export_table_exception', {
          route: 'parent/children/export',
          table: spec.table,
          error: e instanceof Error ? e : new Error(String(e)),
        });
        return NextResponse.json(
          { success: false, error: `Failed to load ${spec.key}` },
          { status: 500 },
        );
      }
    }

    // Audit logs row where the child is the resource. Filtered by
    // resource_type so we don't pick up audit rows about an admin who
    // happens to share a UUID with the student (the columns share UUID
    // shape across resource_type domains).
    try {
      const { data: auditRows, error: auditErr } = await supabaseAdmin
        .from('audit_logs')
        .select('id, auth_user_id, action, resource_type, resource_id, details, status, created_at')
        .eq('resource_id', studentId)
        .eq('resource_type', 'students');
      if (auditErr) {
        logger.warn('parent_child_export_audit_fetch_failed', {
          route: 'parent/children/export',
          error: auditErr.message,
        });
      }
      // Key is `audit_logs` (matches the Phase D.2 brief's response
      // shape). The table-counts map keeps the same key so the audit
      // row metadata stays addressable by table name.
      exportBody['audit_logs'] = auditRows ?? [];
      tableCounts['audit_logs'] = (auditRows ?? []).length;
    } catch (e) {
      logger.warn('parent_child_export_audit_exception', {
        route: 'parent/children/export',
        error: e instanceof Error ? e.message : String(e),
      });
      exportBody['audit_logs'] = [];
      tableCounts['audit_logs'] = 0;
    }

    // No `parental_consent` table exists in the schema today; emit an
    // empty array so the field shape is stable for future migrations.
    exportBody['consents'] = [];
    tableCounts['parental_consent'] = 0;

    // ── 6. Serialise + enforce 10MB cap ──────────────────────────────
    const serialized = JSON.stringify(exportBody);
    const payloadBytes = Buffer.byteLength(serialized, 'utf8');

    if (payloadBytes > MAX_EXPORT_BYTES) {
      logAudit(auth.userId!, {
        action: 'parent.child_data_exported',
        resourceType: 'students',
        resourceId: studentId,
        status: 'failure',
        details: {
          reason: 'payload_too_large',
          payload_bytes: payloadBytes,
          max_bytes: MAX_EXPORT_BYTES,
          guardian_id: guardian.id,
        },
      });
      return NextResponse.json(
        {
          success: false,
          error:
            'Export exceeds the 10MB in-app cap. Please contact ops@alfanumrik.com to request an offline export — large datasets are produced through the school-scoped backup pipeline (per docs/runbooks/per-school-backup-restore.md).',
          payload_bytes: payloadBytes,
        },
        { status: 413 },
      );
    }

    // ── 7. Audit + state_event ───────────────────────────────────────
    const rowCountTotal = Object.values(tableCounts).reduce((a, b) => a + b, 0);

    // Audit the successful export. Fire-and-forget per logAudit contract.
    logAudit(auth.userId!, {
      action: 'parent.child_data_exported',
      resourceType: 'students',
      resourceId: studentId,
      status: 'success',
      details: {
        guardian_id: guardian.id,
        schema_version: EXPORT_SCHEMA_VERSION,
        payload_bytes: payloadBytes,
        table_counts: tableCounts,
        row_count_total: rowCountTotal,
      },
    });

    // State-event for cross-feature subscribers (analytics, compliance
    // dashboard). Best-effort: a publish failure does NOT block the
    // download — the audit_logs row is the canonical record.
    try {
      await publishEvent(supabaseAdmin, {
        kind: 'parent.child_data_exported',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorAuthUserId: auth.userId!,
        tenantId: linkedChild.schoolId ?? null,
        idempotencyKey: `parent_child_data_exported:${guardian.id}:${studentId}:${Date.now()}`,
        payload: {
          guardianId: guardian.id,
          studentId,
          schemaVersion: EXPORT_SCHEMA_VERSION,
          payloadBytes,
          tableCount: Object.keys(tableCounts).length,
          rowCountTotal,
        },
      });
    } catch (e) {
      logger.warn('parent_child_data_exported_publish_failed', {
        route: 'parent/children/export',
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // ── 8. Build the downloadable response ───────────────────────────
    const filename = `child-export-${shortId(studentId)}-${yyyymmdd(new Date())}.json`;
    return new Response(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(payloadBytes),
        // The export carries PII; prevent any layer in the chain from
        // caching the body.
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    });
  } catch (err) {
    logger.error('parent_child_export_failed', {
      route: 'parent/children/export',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
