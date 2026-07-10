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
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { getGuardianByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { listChildrenForGuardian } from '@alfanumrik/lib/domains/relationship';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// 10MB cap on the in-app export. Anything larger requires the ops
// pipeline documented in per-school-backup-restore.md §2 — keyed by
// the runbook so the limit travels with the doc.
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

// Schema version for the exported file. Bumped when the file shape
// breaks; consumers that re-import the JSON read this to branch.
const EXPORT_SCHEMA_VERSION = 'v1-2026-05';

interface ParentChildExportRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: Record<string, unknown>;
  tableCounts?: Record<string, number>;
}

async function createRlsScopedClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // RLS-scoped export data reads only; this route does not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

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

    // ── 5. Aggregate the tables through a scoped DB helper ─────────────
    // The helper repeats the guardian ownership check using auth.uid() and
    // returns the same DPDP export shape this route has historically served.
    const rlsClient = await createRlsScopedClient(request);
    const { data: rpcData, error: rpcError } = await rlsClient.rpc('parent_child_export_data', {
      p_student_id: studentId,
    });

    if (rpcError) {
      logger.error('parent_child_export_rpc_failed', {
        route: 'parent/children/export',
        error: new Error(rpcError.message),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load export data' },
        { status: 500 },
      );
    }

    const exportResult = rpcData as ParentChildExportRpcResponse | null;
    if (!exportResult?.success || !exportResult.data || !exportResult.tableCounts) {
      return NextResponse.json(
        { success: false, error: exportResult?.error ?? 'Failed to load export data' },
        { status: exportResult?.status ?? 500 },
      );
    }

    const exportBody = exportResult.data;
    const tableCounts = exportResult.tableCounts;

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
      const { error: eventError } = await rlsClient.rpc('parent_publish_child_state_event', {
        p_kind: 'parent.child_data_exported',
        p_student_id: studentId,
        p_event_id: randomUUID(),
        p_occurred_at: new Date().toISOString(),
        p_actor_auth_user_id: auth.userId!,
        p_tenant_id: linkedChild.schoolId ?? null,
        p_idempotency_key: `parent_child_data_exported:${guardian.id}:${studentId}:${Date.now()}`,
        p_payload: {
          guardianId: guardian.id,
          studentId,
          schemaVersion: EXPORT_SCHEMA_VERSION,
          payloadBytes,
          tableCount: Object.keys(tableCounts).length,
          rowCountTotal,
        },
      });
      if (eventError) throw new Error(eventError.message);
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
