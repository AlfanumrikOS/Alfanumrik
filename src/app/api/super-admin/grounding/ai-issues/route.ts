import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

/**
 * GET /api/super-admin/grounding/ai-issues
 *
 * Lists student-reported AI issues for triage. Tasks 3.16/3.17 render this.
 *
 * Query params:
 *   ?status=pending   (pending | resolved | all)   default: pending
 *   ?limit=N          default 50, cap 500
 *
 * Response shape:
 *   {
 *     issues: [{
 *       id, student_id, foxy_message_id, question_bank_id, trace_id,
 *       reason_category, student_comment, admin_notes, admin_resolution,
 *       resolved_by, resolved_at, created_at,
 *       trace: { ...grounded_ai_traces columns... } | null,
 *       foxy_message: { role, content, created_at } | null,
 *     }, ...],
 *     count: N
 *   }
 *
 * Auth: super_admin.access permission.
 *
 * Privacy (P13): foxy_chat_messages.content contains the full student query
 * + AI answer. RLS on that table normally restricts to the student; here we
 * access via service_role because consent for admin review is implicit in
 * the student filing an ai_issue_report. We surface content ONLY when a
 * linked report exists.
 */

export const runtime = 'nodejs';

const ISSUE_FIELDS =
  'id, student_id, foxy_message_id, question_bank_id, trace_id, reason_category, ' +
  'student_comment, admin_notes, admin_resolution, resolved_by, resolved_at, created_at';

const TRACE_FIELDS =
  'id, created_at, caller, grade, subject_code, chapter_number, query_preview, ' +
  'grounded, abstain_reason, confidence, prompt_template_id, claude_model, latency_ms';

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const params = new URL(request.url).searchParams;
    const status = params.get('status') || 'pending';
    const limitRaw = parseInt(params.get('limit') || '50', 10);
    const limit = Math.min(500, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

    if (!['pending', 'resolved', 'all'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status. Expected: pending | resolved | all' },
        { status: 400 },
      );
    }

    let query = supabaseAdmin
      .from('ai_issue_reports')
      .select(ISSUE_FIELDS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status === 'pending') {
      // Pending = admin_resolution IS NULL or 'pending'. Matches the
      // idx_ai_issue_reports_pending index predicate.
      query = query.or('admin_resolution.is.null,admin_resolution.eq.pending');
    } else if (status === 'resolved') {
      // Resolved = any non-null, non-pending resolution.
      query = query
        .not('admin_resolution', 'is', null)
        .neq('admin_resolution', 'pending');
    }

    const { data: issuesData, error: issuesErr } = await query;
    if (issuesErr) throw new Error(`ai_issue_reports: ${issuesErr.message}`);

    const issues = ((issuesData ?? []) as unknown) as Array<{
      id: string; student_id: string; foxy_message_id: string | null; question_bank_id: string | null;
      trace_id: string | null; reason_category: string; student_comment: string | null;
      admin_notes: string | null; admin_resolution: string | null; resolved_by: string | null;
      resolved_at: string | null; created_at: string;
    }>;

    if (issues.length === 0) {
      return NextResponse.json({ success: true, data: { issues: [], count: 0, status, limit } });
    }

    // Bulk-fetch joined traces + foxy messages
    const traceIds = Array.from(new Set(issues.map((i) => i.trace_id).filter((x): x is string => !!x)));
    const messageIds = Array.from(new Set(issues.map((i) => i.foxy_message_id).filter((x): x is string => !!x)));

    const [tracesRes, messagesRes] = await Promise.all([
      traceIds.length > 0
        ? supabaseAdmin.from('grounded_ai_traces').select(TRACE_FIELDS).in('id', traceIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      messageIds.length > 0
        ? supabaseAdmin
            .from('foxy_chat_messages')
            .select('id, role, content, created_at')
            .in('id', messageIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    ]);

    if (tracesRes.error) throw new Error(`traces join: ${tracesRes.error.message}`);
    // Don't fail the whole route if foxy_chat_messages is unavailable (table may
    // be missing in some environments). Empty join is acceptable.
    const traceMap = new Map<string, Record<string, unknown>>();
    for (const t of (tracesRes.data ?? []) as Array<Record<string, unknown>>) {
      if (typeof t.id === 'string') traceMap.set(t.id, t);
    }
    const msgMap = new Map<string, Record<string, unknown>>();
    if (!messagesRes.error) {
      for (const m of (messagesRes.data ?? []) as Array<Record<string, unknown>>) {
        if (typeof m.id === 'string') msgMap.set(m.id, m);
      }
    }

    const enriched = issues.map((i) => ({
      ...i,
      trace: i.trace_id ? (traceMap.get(i.trace_id) ?? null) : null,
      foxy_message: i.foxy_message_id ? (msgMap.get(i.foxy_message_id) ?? null) : null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        issues: enriched,
        count: enriched.length,
        status,
        limit,
        truncated: enriched.length === limit,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/super-admin/grounding/ai-issues
 *
 * Resolve an ai_issue_report.
 * Body: { action: 'resolve', payload: { id, admin_resolution, admin_notes? } }
 *
 * admin_resolution must be one of the CHECK constraint values from migration
 * 20260418100400_feedback_and_failures.sql:
 *   'bad_chunk' | 'bad_prompt' | 'bad_question' | 'infra' | 'no_issue' | 'pending'
 *
 * Writes an ops_events row (category='grounding.admin_action',
 * source='super-admin.ai-issues').
 *
 * Auth: super_admin.access permission.
 */

type PostAction = 'resolve';
const VALID_ACTIONS: readonly PostAction[] = ['resolve'];

const VALID_RESOLUTIONS = [
  'bad_chunk',
  'bad_prompt',
  'bad_question',
  'infra',
  'no_issue',
  'pending',
] as const;
type AdminResolution = (typeof VALID_RESOLUTIONS)[number];

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function isResolution(v: unknown): v is AdminResolution {
  return typeof v === 'string' && (VALID_RESOLUTIONS as readonly string[]).includes(v);
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  let body: { action?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const action = body.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as PostAction)) {
    return NextResponse.json(
      { success: false, error: `Invalid action. Expected one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const payload = (body.payload && typeof body.payload === 'object')
    ? body.payload as Record<string, unknown>
    : {};

  try {
    if (action === 'resolve') {
      const id = payload.id;
      const admin_resolution = payload.admin_resolution;
      const admin_notes = typeof payload.admin_notes === 'string' ? payload.admin_notes : null;

      if (!isUuid(id)) {
        return NextResponse.json(
          { success: false, error: 'resolve requires payload.id (uuid)' },
          { status: 400 },
        );
      }
      if (!isResolution(admin_resolution)) {
        return NextResponse.json(
          {
            success: false,
            error:
              `resolve requires payload.admin_resolution ∈ {${VALID_RESOLUTIONS.join(', ')}}`,
          },
          { status: 400 },
        );
      }

      const nowIso = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('ai_issue_reports')
        .update({
          admin_resolution,
          admin_notes,
          resolved_by: auth.userId,
          resolved_at: nowIso,
        })
        .eq('id', id);

      if (error) {
        return NextResponse.json(
          { success: false, error: `resolve failed: ${error.message}` },
          { status: 500 },
        );
      }

      await logOpsEvent({
        category: 'grounding.admin_action',
        source: 'super-admin.ai-issues',
        severity: 'info',
        message: `ai_issue_report ${id} resolved (${admin_resolution})`,
        subjectType: 'ai_issue_report',
        subjectId: id,
        context: {
          action,
          admin_resolution,
          admin_user_id: auth.userId,
          // admin_notes intentionally not logged to ops_events to avoid
          // bleeding free-text into observability (P13 defence-in-depth).
          has_notes: !!admin_notes,
        },
      });

      return NextResponse.json({
        success: true,
        data: { action, id, admin_resolution, resolved_at: nowIso },
      });
    }

    // Unreachable — action validated above.
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}