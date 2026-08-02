/**
 * POST /api/exams/papers/[id]/autosave — periodic (~10s) safety-net save of
 * an IN-PROGRESS mock-exam attempt's responses. Screen 11 "Mock exam"
 * (`ff_exam_v2`); replay target for the client's `pending_writes` queue
 * (`packages/lib/src/offline/store.ts` → `queueWrite()` / `replayPending()`).
 *
 * SAVE-ONLY, ADDITIVE, NEVER SCORES:
 *   - This route NEVER calls `submit_mock_test_attempt` and NEVER writes
 *     `score_percent` / `raw_score` / `xp_earned` / `status` / `submitted_at`
 *     on `mock_test_attempts`. It only ever touches the pre-existing
 *     `client_metadata` jsonb column (see 20260520000008_mock_test_attempts.sql
 *     — "Opaque jsonb for non-PII diagnostics"), scoped to a row the caller
 *     already owns and that is still `status='in_progress'`.
 *   - It does not create the `cbse_board` in-progress attempt row — that
 *     already happens at POST .../start (`start_mock_test_attempt` RPC,
 *     20260722097000). This route only UPDATEs that existing row.
 *   - Static JEE/NEET/Olympiad papers have no pre-created attempt row (no
 *     `attempt_id` is ever passed to <MockTestRunner>/<ExamRunner> for that
 *     flow — see mock-test-types.ts's Props comment). For those, this route
 *     is a well-formed no-op: it validates + logs the autosave attempt and
 *     returns `persisted: false`. The client's own `pending_writes` IndexedDB
 *     row is the durable copy in that case (survives reload/browser-restart
 *     on the same device even with zero server round-trip) — inventing a new
 *     table/column to persist static-paper drafts server-side is a schema
 *     change and is explicitly OUT of scope here (architect territory).
 *
 * NOT a general "offline mock exam" mode: starting and submitting a mock
 * exam still always requires a live connection, per the `ff_offline_v2`
 * scope note in 20260802090200_seed_ff_wave_b_frontend_flags.sql
 * ("Mock exams are explicitly excluded from offline scope"). This route only
 * protects an already-live in-progress attempt against a transient signal
 * drop — it does not let a student start or author an attempt while fully
 * offline.
 *
 * Idempotency: naturally idempotent (last-write-wins on the same
 * client_metadata field), so no separate ledger is needed. The
 * `Idempotency-Key` header (set by `replayPending()`) is accepted and logged
 * for traceability only.
 *
 * Permission: exam.view — same gate as the sibling detail/start/submit
 * routes; this is still the same exam flow, just a lower-stakes write.
 *
 * P13: logs paper_id + attempt_id + response counts only. Never logs
 * question_id/response_index content or any student-identifying data.
 *
 * Response shapes:
 *   200 -> { success: true, persisted: boolean }
 *   400 -> { success: false, error: 'invalid_paper_id' | 'invalid_body' | ... }
 *   401 -> unauthenticated (from authorizeRequest)
 *   403 -> { success: false, error: 'student_profile_required' }
 *   500 -> { success: false, error: 'internal_server_error' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (s: string): boolean => UUID_RE.test(s);

const MAX_RESPONSES = 500;
const ROUTE = '/api/exams/papers/[id]/autosave';

interface AutosaveResponseEntry {
  question_id: string;
  response_index: number | null;
  marked_for_review?: boolean;
}

interface AutosaveBody {
  attempt_id?: string;
  responses: AutosaveResponseEntry[];
  cursor: number;
  remaining_seconds: number;
  /** Stamped by `replayPending()` from the queued row's `occurredAt` — the
   *  client-side capture time, NOT this request's arrival time. */
  occurredAt?: string;
}

function isResponseEntry(v: unknown): v is AutosaveResponseEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.question_id !== 'string' || !isValidUuid(o.question_id)) return false;
  if (o.response_index !== null) {
    if (typeof o.response_index !== 'number' || !Number.isInteger(o.response_index)) return false;
    if (o.response_index < 0 || o.response_index > 3) return false;
  }
  if (o.marked_for_review !== undefined && typeof o.marked_for_review !== 'boolean') return false;
  return true;
}

function parseBody(raw: unknown): AutosaveBody | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_body' };
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.responses)) return { error: 'invalid_responses' };
  if (o.responses.length > MAX_RESPONSES) return { error: 'invalid_responses' };
  for (const r of o.responses) if (!isResponseEntry(r)) return { error: 'invalid_responses' };

  if (typeof o.cursor !== 'number' || !Number.isInteger(o.cursor) || o.cursor < 0) {
    return { error: 'invalid_cursor' };
  }
  if (
    typeof o.remaining_seconds !== 'number' ||
    !Number.isInteger(o.remaining_seconds) ||
    o.remaining_seconds < 0
  ) {
    return { error: 'invalid_remaining_seconds' };
  }
  if (o.attempt_id !== undefined) {
    if (typeof o.attempt_id !== 'string' || !isValidUuid(o.attempt_id)) {
      return { error: 'invalid_attempt_id' };
    }
  }
  if (o.occurredAt !== undefined && typeof o.occurredAt !== 'string') {
    return { error: 'invalid_occurred_at' };
  }

  return {
    attempt_id: (o.attempt_id as string | undefined) ?? undefined,
    responses: o.responses as AutosaveResponseEntry[],
    cursor: o.cursor,
    remaining_seconds: o.remaining_seconds,
    occurredAt: (o.occurredAt as string | undefined) ?? undefined,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeRequest(request, 'exam.view');
    if (!auth.authorized) return auth.errorResponse!;

    const { id: paperId } = await context.params;
    if (!paperId || !isValidUuid(paperId)) {
      return NextResponse.json({ success: false, error: 'invalid_paper_id' }, { status: 400 });
    }

    const studentId = auth.studentId;
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'student_profile_required' },
        { status: 403 },
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
    }
    const parsed = parseBody(raw);
    if ('error' in parsed) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }
    const body = parsed;
    const idempotencyKey = request.headers.get('Idempotency-Key') ?? undefined;

    // Static JEE/NEET/Olympiad flow: no attempt row exists to attach a
    // draft to (see file header). Acknowledge the write so replayPending()
    // drains the client queue; the IndexedDB copy remains the durable one.
    if (!body.attempt_id) {
      logger.info('exams_autosave_noop_no_attempt', {
        route: ROUTE,
        paper_id: paperId,
        response_count: body.responses.length,
        idempotency_key: idempotencyKey,
      });
      return NextResponse.json({ success: true, persisted: false });
    }

    // Scoped, save-only UPDATE: student's own row, still in_progress, this
    // paper. Never touches score_percent/raw_score/xp_earned/status.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('mock_test_attempts')
      .update({
        client_metadata: {
          autosave: {
            responses: body.responses,
            cursor: body.cursor,
            remaining_seconds: body.remaining_seconds,
            saved_at: body.occurredAt ?? new Date().toISOString(),
          },
        },
      })
      .eq('id', body.attempt_id)
      .eq('student_id', studentId)
      .eq('exam_paper_id', paperId)
      .eq('status', 'in_progress')
      .select('id');

    if (updateError) {
      logger.error('exams_autosave_update_failed', {
        error: new Error(updateError.message),
        route: ROUTE,
        paper_id: paperId,
      });
      return NextResponse.json({ success: false, error: 'autosave_failed' }, { status: 500 });
    }

    const persisted = Array.isArray(updated) && updated.length > 0;
    logger.info('exams_autosave_saved', {
      route: ROUTE,
      paper_id: paperId,
      attempt_id: body.attempt_id,
      response_count: body.responses.length,
      persisted,
      idempotency_key: idempotencyKey,
    });

    return NextResponse.json({ success: true, persisted });
  } catch (err) {
    logger.error('exams_autosave_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'internal_server_error' },
      { status: 500 },
    );
  }
}

// 405 for non-POST. App Router doesn't auto-405 when other handlers aren't
// exported — make the contract explicit (mirrors the sibling routes).
const methodNotAllowed = () =>
  NextResponse.json(
    { success: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const PATCH = methodNotAllowed;
