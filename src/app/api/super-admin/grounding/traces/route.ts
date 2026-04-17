import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/grounding/traces
 *
 * Trace search for incident triage (Tasks 3.16/3.17 render this).
 *
 * Query params (pick ONE of the three search modes):
 *   ?traceId=<uuid>
 *   ?studentId=<uuid>&from=<iso>&to=<iso>
 *   ?abstainReason=<reason>&from=<iso>&to=<iso>
 *
 * Optional: ?caller=foxy, ?grade=10, ?subject=science, ?limit=N (default 100, cap 500).
 *
 * Response: { success: true, data: { traces: [...], count: N } }
 *
 * Auth: super_admin.access permission.
 *
 * Privacy (P13): full query_text lives only in foxy_chat_messages (student-RLS).
 * Traces store a 200-char preview + query_hash only. The admin reads these to
 * match against reported incidents; the preview is not PII-flagged because the
 * grounded-answer service already redacts via redact-pii.ts at write-time.
 */

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ABSTAIN_REASONS = new Set([
  'chapter_not_ready', 'no_chunks_retrieved', 'low_similarity', 'no_supporting_chunks',
  'scope_mismatch', 'upstream_error', 'circuit_open',
]);
const VALID_CALLERS = new Set(['foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic']);

const TRACE_FIELDS =
  'id, created_at, caller, student_id, grade, subject_code, chapter_number, ' +
  'query_hash, query_preview, embedding_model, retrieved_chunk_ids, top_similarity, ' +
  'chunk_count, claude_model, prompt_template_id, prompt_hash, grounded, ' +
  'abstain_reason, confidence, answer_length, input_tokens, output_tokens, ' +
  'latency_ms, client_reported_issue_id';

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const params = new URL(request.url).searchParams;
    const traceId = params.get('traceId');
    const studentId = params.get('studentId');
    const abstainReason = params.get('abstainReason');
    const from = params.get('from');
    const to = params.get('to');
    const caller = params.get('caller');
    const grade = params.get('grade');
    const subject = params.get('subject');
    const limitRaw = parseInt(params.get('limit') || '100', 10);
    const limit = Math.min(500, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 100));

    // Validate exclusive search modes
    const modeCount = [traceId, studentId, abstainReason].filter(Boolean).length;
    if (modeCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide one of: traceId, studentId, abstainReason' },
        { status: 400 },
      );
    }

    let query = supabaseAdmin.from('grounded_ai_traces').select(TRACE_FIELDS);

    if (traceId) {
      if (!UUID_RE.test(traceId)) {
        return NextResponse.json({ success: false, error: 'Invalid traceId UUID' }, { status: 400 });
      }
      query = query.eq('id', traceId);
    } else if (studentId) {
      if (!UUID_RE.test(studentId)) {
        return NextResponse.json({ success: false, error: 'Invalid studentId UUID' }, { status: 400 });
      }
      query = query.eq('student_id', studentId);
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to);
    } else if (abstainReason) {
      if (!VALID_ABSTAIN_REASONS.has(abstainReason)) {
        return NextResponse.json(
          { success: false, error: `Invalid abstainReason. Expected one of: ${Array.from(VALID_ABSTAIN_REASONS).join(', ')}` },
          { status: 400 },
        );
      }
      query = query.eq('grounded', false).eq('abstain_reason', abstainReason);
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to);
    }

    // Optional filters (composable with any mode)
    if (caller) {
      if (!VALID_CALLERS.has(caller)) {
        return NextResponse.json({ success: false, error: 'Invalid caller' }, { status: 400 });
      }
      query = query.eq('caller', caller);
    }
    if (grade) query = query.eq('grade', grade);
    if (subject) query = query.eq('subject_code', subject);

    query = query.order('created_at', { ascending: false }).limit(limit);

    const { data, error } = await query;
    if (error) throw new Error(`trace search: ${error.message}`);

    const traces = ((data ?? []) as unknown) as Array<Record<string, unknown>>;

    return NextResponse.json({
      success: true,
      data: {
        traces,
        count: traces.length,
        limit,
        truncated: traces.length === limit,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}