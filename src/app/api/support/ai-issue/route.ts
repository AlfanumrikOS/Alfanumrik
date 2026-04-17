/**
 * POST /api/support/ai-issue
 *
 * Student-facing endpoint for flagging problematic AI answers. Writes to
 * `ai_issue_reports` which the super-admin grounding panel consumes via
 * /api/super-admin/grounding/ai-issues.
 *
 * Auth: authorizeRequest(req, 'foxy.chat') — any authenticated student
 *        with chat access can report.
 * Body: {
 *   traceId?: string,         // grounded_ai_traces.id
 *   messageId?: string,       // foxy_chat_messages.id (optional FK)
 *   questionBankId?: string,  // question_bank.id
 *   reasonCategory: 'wrong_answer' | 'off_topic' | 'inappropriate' | 'unclear' | 'other',
 *   comment?: string          // max 500 chars
 * }
 * Response: { success: true, id } | { success: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const ALLOWED_REASONS = [
  'wrong_answer',
  'off_topic',
  'inappropriate',
  'unclear',
  'other',
] as const;
type ReasonCategory = typeof ALLOWED_REASONS[number];

const MAX_COMMENT_LENGTH = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

function isReasonCategory(x: unknown): x is ReasonCategory {
  return typeof x === 'string' && (ALLOWED_REASONS as readonly string[]).includes(x);
}

function sanitizeUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

export async function POST(request: NextRequest) {
  // 1. Auth — must be an authenticated student with foxy.chat
  const auth = await authorizeRequest(request, 'foxy.chat');
  if (!auth.authorized) return auth.errorResponse!;
  if (!auth.studentId) {
    return err('Student profile required to report an issue', 403, 'STUDENT_REQUIRED');
  }

  // 2. Parse + validate body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body', 400, 'INVALID_BODY');
  }

  if (!isReasonCategory(body.reasonCategory)) {
    return err(
      `reasonCategory must be one of: ${ALLOWED_REASONS.join(', ')}`,
      400,
      'INVALID_REASON',
    );
  }

  const comment = typeof body.comment === 'string'
    ? body.comment.trim().slice(0, MAX_COMMENT_LENGTH)
    : null;

  // 3. Insert
  const { data, error } = await supabaseAdmin
    .from('ai_issue_reports')
    .insert({
      student_id: auth.studentId,
      trace_id: sanitizeUuid(body.traceId),
      foxy_message_id: sanitizeUuid(body.messageId),
      question_bank_id: sanitizeUuid(body.questionBankId),
      reason_category: body.reasonCategory,
      student_comment: comment || null,
    })
    .select('id')
    .single();

  if (error || !data) {
    logger.error('ai_issue_report_insert_failed', {
      error: error ? new Error(error.message) : new Error('no data returned'),
      studentId: auth.studentId,
      reasonCategory: body.reasonCategory,
    });
    return err('Failed to submit issue report', 500, 'INSERT_FAILED');
  }

  return NextResponse.json({ success: true, id: data.id });
}