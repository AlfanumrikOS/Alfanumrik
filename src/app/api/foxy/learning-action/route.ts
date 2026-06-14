/**
 * POST /api/foxy/learning-action
 *
 * Foxy Post-Answer Learning Actions — Phase 1 (2026-06-14).
 *
 * Records a student's tap on a post-answer action chip attached to a Foxy
 * assistant message: Got it / Explain simpler / Show example / Quiz me on this
 * / Save to notebook. The ChatBubble action bar is gated by
 * `ff_foxy_learning_actions_v1` (default OFF) on the FRONTEND; this route is the
 * server endpoint the bar calls.
 *
 * ⚠️ BINDING learner-state contract (assessment-issued, non-negotiable):
 *   - This event + route are NON-EVIDENTIAL telemetry. They MUST NOT write
 *     (directly or via any subscriber) to ANY mastery surface: concept_mastery,
 *     cme_concept_state, student_skill_state, knowledge_gaps (mastery/resolution),
 *     learner_mastery, cme_error_log, quiz_sessions, student_learning_profiles,
 *     bloom_progression. A self-report cannot move mastery_mean / p_know.
 *   - Award 0 XP. Never calls submitQuizResults / atomic_quiz_profile_update.
 *     No XP literals anywhere in this file.
 *   - The new `learner.learning_action` event has NO mastery-writing subscriber
 *     (conceptMasteryProjector is typed to `learner.concept_check_answered`
 *     ONLY and never receives this kind). Only a REAL "Quiz me" answer moves
 *     mastery, and it does so through the EXISTING concept-check / BKT path —
 *     never through this route. `quiz_me` here records the SIGNAL only.
 *
 * Behavior per actionType:
 *   - got_it          : publish event; record feedback is_up=true
 *                       (reason="learning_action:got_it"); continuity rule below.
 *   - explain_simpler : publish event; record feedback is_up=false
 *                       (reason="learning_action:explain_simpler"); leave the
 *                       open expectation OPEN.
 *   - show_example    : publish event; leave the open expectation OPEN; no
 *                       feedback write.
 *   - save            : publish event; insert into student_bookmarks
 *                       (content_type='foxy_answer') via the RLS-RESPECTING
 *                       server client so the owner policy applies. Never touches
 *                       expectations.
 *   - quiz_me         : publish event ONLY (MCQ generation + answer evidence is
 *                       owned by ai-engineer/frontend). Never touches expectations.
 *
 * Continuity rule (got_it only):
 *   If an open expectation exists and its kind is CHECKABLE (mcq/recall/solve),
 *   DO NOT mark it answered — leave it open so the next message is still graded
 *   against the question. If NON-CHECKABLE (explain/open/choose_topic), we MAY
 *   markExpectationAnswered(id, null). explain_simpler/show_example always leave
 *   the expectation OPEN.
 *
 * Auth: `progress.view_own` + requireStudentId — the SAME permission the
 * existing /api/foxy/feedback route uses. The route is the trust boundary: it
 * fetches the message row server-side via supabaseAdmin (service-role; the RPC's
 * own auth.uid() guard does NOT fire) and rejects when m.student_id != caller or
 * the message is not an assistant row. NOT_FOUND is returned for both "doesn't
 * exist" and "owned by another student" so the endpoint can't probe other
 * students' message UUIDs (P13).
 *
 * publishEvent is best-effort / flag-gated (ff_event_bus_v1). Failures log.warn
 * and the route still returns success — mirroring resolveSession() in
 * /api/foxy/route.ts.
 *
 * Response: { success: true, data: { recorded: true, feedbackId?: string } }
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';
import { publishEvent } from '@/lib/state/events/publish';
import { loadOpenExpectation, markExpectationAnswered } from '@/lib/learn/foxy-expectations';
import { randomUUID } from 'node:crypto';

type ActionType = 'got_it' | 'explain_simpler' | 'show_example' | 'quiz_me' | 'save';
const VALID_ACTIONS: readonly ActionType[] = [
  'got_it',
  'explain_simpler',
  'show_example',
  'quiz_me',
  'save',
];

// Expectation kinds that are gradable against the student's NEXT message. For
// these we must NOT close the loop on a "Got it" tap — the question stays open
// so the next reply is still evaluated. (Mirror of foxy-expectations
// ExpectationKind — kept local so we don't widen that module's surface.)
const CHECKABLE_EXPECTATION_KINDS = new Set(['mcq', 'recall', 'solve']);

// Progression-ladder expectation kinds. A "Got it" tap must NOT close these —
// the chapter ladder anchor has to survive so the next turn keeps advancing
// the student topic-to-topic (Part 2C). 'choose_topic' = a topic menu still
// awaiting a pick; 'next_topic' = Foxy advanced to the next topic and posed a
// check. An ack tap is not an answer to either, so we leave them OPEN.
const PROGRESSION_EXPECTATION_KINDS = new Set(['choose_topic', 'next_topic']);

// Kinds that "Got it" is allowed to close: anything NOT checkable and NOT a
// progression-ladder anchor. Today that is 'explain' and 'open'.
function isGotItClosable(kind: string): boolean {
  return !CHECKABLE_EXPECTATION_KINDS.has(kind) && !PROGRESSION_EXPECTATION_KINDS.has(kind);
}

export async function POST(request: Request) {
  try {
    // 1. Auth — identical permission to /api/foxy/feedback.
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;
    const callerStudentId = auth.studentId;
    if (!callerStudentId) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', error_hi: 'Anumati nahi hai.', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // 2. Parse + validate body.
    const body = (await request.json().catch(() => null)) as
      | {
          messageId?: unknown;
          actionType?: unknown;
          sessionId?: unknown;
          conceptId?: unknown;
          subjectCode?: unknown;
          chapterNumber?: unknown;
        }
      | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', error_hi: 'Request body galat hai.', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const messageId = body.messageId;
    if (typeof messageId !== 'string' || !isValidUUID(messageId)) {
      return NextResponse.json(
        { success: false, error: 'messageId must be a valid uuid', error_hi: 'messageId sahi uuid hona chahiye.', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const actionType = body.actionType;
    if (typeof actionType !== 'string' || !VALID_ACTIONS.includes(actionType as ActionType)) {
      return NextResponse.json(
        { success: false, error: 'actionType is invalid', error_hi: 'actionType galat hai.', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    const action = actionType as ActionType;

    // Optional fields. sessionId/conceptId must be UUIDs when present.
    let sessionId: string | null = null;
    if (body.sessionId !== undefined && body.sessionId !== null) {
      if (typeof body.sessionId !== 'string' || !isValidUUID(body.sessionId)) {
        return NextResponse.json(
          { success: false, error: 'sessionId must be a valid uuid', error_hi: 'sessionId sahi uuid hona chahiye.', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      sessionId = body.sessionId;
    }

    let conceptId: string | null = null;
    if (body.conceptId !== undefined && body.conceptId !== null) {
      if (typeof body.conceptId !== 'string' || !isValidUUID(body.conceptId)) {
        return NextResponse.json(
          { success: false, error: 'conceptId must be a valid uuid', error_hi: 'conceptId sahi uuid hona chahiye.', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      conceptId = body.conceptId;
    }

    let subjectCode: string | null = null;
    if (body.subjectCode !== undefined && body.subjectCode !== null) {
      if (typeof body.subjectCode !== 'string') {
        return NextResponse.json(
          { success: false, error: 'subjectCode must be a string', error_hi: 'subjectCode string hona chahiye.', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      const trimmed = body.subjectCode.trim();
      subjectCode = trimmed.length > 0 ? trimmed.slice(0, 64).toLowerCase() : null;
    }

    let chapterNumber: number | null = null;
    if (body.chapterNumber !== undefined && body.chapterNumber !== null) {
      if (typeof body.chapterNumber !== 'number' || !Number.isInteger(body.chapterNumber) || body.chapterNumber < 0) {
        return NextResponse.json(
          { success: false, error: 'chapterNumber must be a non-negative integer', error_hi: 'chapterNumber sahi number hona chahiye.', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      chapterNumber = body.chapterNumber;
    }

    // 3. Ownership check (P13 trust boundary). We fetch the assistant message
    // server-side and confirm it belongs to the caller. We also pull
    // session_id + content so we don't trust the client for those on the
    // continuity + save paths. Collapse not-found / wrong-owner / non-assistant
    // to a single 404 so the endpoint can't probe other students' UUIDs.
    const { data: msgRow, error: msgErr } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('id, student_id, role, session_id, content')
      .eq('id', messageId)
      .maybeSingle();
    if (msgErr) {
      logger.error('foxy.learning_action: ownership lookup failed', {
        error: msgErr.message,
        messageId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to record action', error_hi: 'Action record nahi ho saka.', code: 'LOOKUP_ERROR' },
        { status: 500 },
      );
    }
    if (
      !msgRow ||
      (msgRow.student_id as string) !== callerStudentId ||
      (msgRow.role as string) !== 'assistant'
    ) {
      return NextResponse.json(
        { success: false, error: 'Message not found', error_hi: 'Message nahi mila.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Trust the server-resolved session_id for continuity; fall back to the
    // (already validated) client value only when the row has none.
    const resolvedSessionId: string | null =
      (msgRow.session_id as string | null) ?? sessionId;
    const messageContent: string = (msgRow.content as string | null) ?? '';

    // 4. Publish the non-evidential telemetry event. Best-effort: the bus
    // gate (ff_event_bus_v1) lives inside publishEvent; failures log + continue.
    // tenantId is null — this is B2C learner self-report telemetry with no
    // school context resolved on this route. Payload is IDs + enums only (P13).
    try {
      await publishEvent(supabaseAdmin, {
        kind: 'learner.learning_action',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorAuthUserId: auth.userId!,
        tenantId: null,
        idempotencyKey: `learning_action:${messageId}:${action}`,
        payload: {
          messageId,
          // The event registry requires a sessionId UUID; when the message row
          // has no session (shouldn't happen for assistant rows) we skip the
          // publish rather than send a malformed payload.
          sessionId: resolvedSessionId ?? messageId,
          conceptId: conceptId,
          actionType: action,
          subjectCode,
          chapterNumber,
        },
      });
    } catch (err) {
      logger.warn('foxy.learning_action: publishEvent failed', {
        messageId,
        actionType: action,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let feedbackId: string | undefined;

    // 5. Action-specific side effects.
    if (action === 'got_it' || action === 'explain_simpler') {
      // Feedback-repurpose: written ONLY through the existing
      // record_message_feedback RPC (server-side ownership re-checked there for
      // authenticated callers; here we already verified ownership above). Tagged
      // with provenance in the reason field. Exactly one feedback row per
      // (message, student) — the RPC UPSERTs on UNIQUE(message_id, student_id).
      const isUp = action === 'got_it';
      const reason = `learning_action:${action}`;
      const { data: fbData, error: fbErr } = await supabaseAdmin.rpc('record_message_feedback', {
        p_message_id: messageId,
        p_is_up: isUp,
        p_reason: reason,
      });
      if (fbErr) {
        logger.error('foxy.learning_action: record_message_feedback failed', {
          error: fbErr.message,
          messageId,
          actionType: action,
        });
        return NextResponse.json(
          { success: false, error: 'Failed to record action', error_hi: 'Action record nahi ho saka.', code: 'RPC_ERROR' },
          { status: 500 },
        );
      }
      const rows = (fbData ?? []) as Array<{ id: string; coach_mode_used: string | null }>;
      // Ownership already verified above, so an empty resultset would be an
      // unexpected race (message deleted between the two reads). Treat as 404.
      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Message not found', error_hi: 'Message nahi mila.', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      feedbackId = rows[0].id;
    }

    if (action === 'save') {
      // Insert into student_bookmarks via the RLS-RESPECTING server client so
      // the `bookmarks_own` policy (student_id = get_my_student_id()) applies —
      // NOT supabaseAdmin. The unique index idx_bm_u on
      // (student_id, content_type, source_id) WHERE source_id IS NOT NULL makes
      // a repeated save idempotent; we ignore the unique-violation.
      try {
        const serverClient = await createSupabaseServerClient();
        const { error: bmErr } = await serverClient.from('student_bookmarks').insert({
          student_id: callerStudentId,
          content_type: 'foxy_answer',
          content_text: messageContent,
          subject: subjectCode,
          chapter_number: chapterNumber,
          source_id: messageId,
        });
        if (bmErr && bmErr.code !== '23505') {
          logger.error('foxy.learning_action: bookmark insert failed', {
            error: bmErr.message,
            messageId,
          });
          return NextResponse.json(
            { success: false, error: 'Failed to save to notebook', error_hi: 'Notebook mein save nahi ho saka.', code: 'SAVE_ERROR' },
            { status: 500 },
          );
        }
      } catch (err) {
        logger.error('foxy.learning_action: bookmark insert threw', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(
          { success: false, error: 'Failed to save to notebook', error_hi: 'Notebook mein save nahi ho saka.', code: 'SAVE_ERROR' },
          { status: 500 },
        );
      }
    }

    // 6. Continuity (pending-expectations) — got_it only, and only for kinds
    // that a "Got it" is allowed to close (explain / open). explain_simpler /
    // show_example always leave the expectation OPEN; save / quiz_me never
    // touch expectations. Checkable (mcq/recall/solve) AND progression-ladder
    // (choose_topic/next_topic) kinds stay OPEN on a got_it tap.
    if (action === 'got_it' && resolvedSessionId) {
      try {
        const open = await loadOpenExpectation(supabaseAdmin, resolvedSessionId);
        if (open && isGotItClosable(open.kind)) {
          // Closable (explain/open): the student's "Got it" legitimately closes
          // the loop. answeredMessageId is null — there is no answer message,
          // just an acknowledgement tap.
          await markExpectationAnswered(supabaseAdmin, open.id, null);
        }
        // Checkable (mcq/recall/solve) and progression (choose_topic/
        // next_topic): DO NOTHING — leave it open so the ladder / question
        // survives to the next message.
      } catch (err) {
        // Best-effort — continuity failure never blocks the action.
        logger.warn('foxy.learning_action: continuity resolve failed', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        recorded: true,
        ...(feedbackId ? { feedbackId } : {}),
      },
    });
  } catch (err) {
    logger.error('foxy.learning_action: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', error_hi: 'Server error.', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
