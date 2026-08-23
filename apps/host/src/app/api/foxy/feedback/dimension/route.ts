/** @license Apache-2.0 */
/**
 * Phase A.2: Dimension-level Foxy feedback API route.
 *
 * POST /api/foxy/feedback/dimension
 *
 * Body:   { messageId: uuid, dimension: 'accuracy'|'clarity'|'helpfulness'|'scope',
 *            isUp: boolean, reason?: string }
 * Response: { success: true, data: { feedbackId: uuid, coachModeUsed: string|null } }
 *
 * Auth: `progress.view_own` + requireStudentId. Ownership check mirrors
 * /api/foxy/feedback: fetches the message row server-side, verifies
 * m.student_id === caller's studentId, rejects on mismatch BEFORE invoking
 * the RPC. The RPC's auth.uid() guard does NOT fire (service-role JWT), so
 * the route is the trust boundary.
 *
 * P13: never log message content or reason text. messageId is a
 * server-generated UUID, safe to log for triage.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';

/** Allowed dimension values — mirrors the CHECK constraint in the migration. */
const ALLOWED_DIMENSIONS = new Set(['accuracy', 'clarity', 'helpfulness', 'scope']);

export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;
    const callerStudentId = auth.studentId;
    if (!callerStudentId) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { messageId?: unknown; dimension?: unknown; isUp?: unknown; reason?: unknown }
      | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const messageId = body.messageId;
    const dimension = body.dimension;
    const isUp = body.isUp;
    const reasonRaw = body.reason;

    // Validate messageId
    if (typeof messageId !== 'string' || !isValidUUID(messageId)) {
      return NextResponse.json(
        { success: false, error: 'messageId must be a valid uuid', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    // Validate dimension
    if (typeof dimension !== 'string' || !ALLOWED_DIMENSIONS.has(dimension)) {
      return NextResponse.json(
        { success: false, error: 'dimension must be one of: accuracy, clarity, helpfulness, scope', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    // Validate isUp
    if (typeof isUp !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isUp must be a boolean', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    // Validate and sanitize reason (same as /api/foxy/feedback)
    let reason: string | null = null;
    if (reasonRaw !== undefined && reasonRaw !== null) {
      if (typeof reasonRaw !== 'string') {
        return NextResponse.json(
          { success: false, error: 'reason must be a string', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      const trimmed = reasonRaw.trim();
      if (trimmed.length > 0) {
        reason = trimmed.slice(0, 500);
      }
    }

    // ── Ownership check (P5/P13 trust boundary) ──────────────────────────
    // The RPC's auth.uid() guard does NOT fire here because we invoke it via
    // supabaseAdmin (service-role JWT). So the route must verify the caller
    // owns the message before writing. Collapses "not found" and "wrong
    // owner" to the same NOT_FOUND response so the endpoint can't be used
    // to probe other students' message UUIDs.
    const { data: msgRow, error: msgErr } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('id, student_id, role')
      .eq('id', messageId)
      .maybeSingle();
    if (msgErr) {
      logger.error('foxy.dimension-feedback: ownership lookup failed', {
        error: msgErr.message,
        messageId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to record dimension feedback', code: 'RPC_ERROR' },
        { status: 500 },
      );
    }
    if (
      !msgRow ||
      (msgRow.student_id as string) !== callerStudentId ||
      (msgRow.role as string) !== 'assistant'
    ) {
      return NextResponse.json(
        { success: false, error: 'Message not found or not eligible for feedback', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const { data, error } = await supabaseAdmin.rpc('record_message_dimension_feedback', {
      p_message_id: messageId,
      p_dimension: dimension,
      p_is_up: isUp,
      p_reason: reason,
    });

    if (error) {
      logger.error('foxy.dimension-feedback: RPC failed', {
        error: error.message,
        messageId,
        dimension,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to record dimension feedback', code: 'RPC_ERROR' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<{ id: string; coach_mode_used: string | null }>;
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Message not found or not eligible for feedback', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        feedbackId: rows[0].id,
        coachModeUsed: rows[0].coach_mode_used,
      },
    });
  } catch (err) {
    logger.error('foxy.dimension-feedback: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
