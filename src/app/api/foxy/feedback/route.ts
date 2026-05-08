/**
 * POST /api/foxy/feedback
 *
 * B'-5 Phase 1: persist per-message Foxy feedback. Replaces the
 * aggregate-only `track_ai_quality(subject, isUp)` RPC that was the only
 * existing path — which threw away message_id, session_id, and coach_mode.
 *
 * Body:
 *   { messageId: uuid, isUp: boolean, reason?: string }
 *
 * Response:
 *   { success: true, data: { feedbackId: uuid, coachModeUsed: string|null } }
 *
 * Auth: `progress.view_own` permission (student-scoped). The underlying
 * RPC `record_message_feedback` re-checks ownership via auth.uid() so a
 * forged messageId belonging to another student returns an empty
 * resultset rather than silently writing.
 *
 * Phase 2: client wiring in /foxy/page.tsx will call this from the 👍/👎
 * buttons; resolveCoachMode will read recent feedback to switch mode for
 * students whose recent socratic turns get mostly 👎.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';

export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse!;

    const body = (await request.json().catch(() => null)) as
      | { messageId?: unknown; isUp?: unknown; reason?: unknown }
      | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const messageId = body.messageId;
    const isUp = body.isUp;
    const reasonRaw = body.reason;

    if (typeof messageId !== 'string' || !isValidUUID(messageId)) {
      return NextResponse.json(
        { success: false, error: 'messageId must be a valid uuid', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    if (typeof isUp !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isUp must be a boolean', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    // reason is optional. Cap at 500 chars to bound DB row size; nullify
    // empty/whitespace-only strings so the column stays NULL not "".
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

    const { data, error } = await supabaseAdmin.rpc('record_message_feedback', {
      p_message_id: messageId,
      p_is_up: isUp,
      p_reason: reason,
    });

    if (error) {
      logger.error('foxy.feedback: RPC failed', {
        error: error.message,
        // P13: never log message content or reason text. messageId is a
        // server-generated UUID, safe to log for triage.
        messageId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to record feedback', code: 'RPC_ERROR' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<{ id: string; coach_mode_used: string | null }>;
    if (rows.length === 0) {
      // RPC returned empty: message not found, not an assistant message,
      // or auth.uid() guard rejected. All three look the same to the
      // client to avoid leaking which case applied.
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
    logger.error('foxy.feedback: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
