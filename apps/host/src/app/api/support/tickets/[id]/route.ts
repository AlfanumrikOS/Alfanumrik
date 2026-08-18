/**
 * /api/support/tickets/[id] — one support ticket thread, requester side.
 *
 * GET  — fetch the ticket the caller owns + its student-visible reply thread.
 * POST — append a reply to a thread the caller owns.
 *
 * Auth: authorizeTicketRequest() — 'foxy.chat' (student/teacher) with a
 *   'child.view_progress' fallback (parent). Identical to the list route; no
 *   new permission code was introduced.
 *
 * ── OWNERSHIP (P13) ────────────────────────────────────────────────────────
 * A ticket is scoped by TWO columns, not one:
 *   student_id ∈ (caller's anchor set)  AND  user_role = (caller's role anchor)
 * A guardian's ticket is anchored to the CHILD's student_id with
 * user_role='parent' (../route.ts:185-195). This route previously filtered on
 * student_id ALONE, so a student could open a ticket their parent had filed
 * about them. With a reply thread attached that becomes a disclosure of the
 * entire support conversation about the child — refunds, escalations,
 * behavioural concerns. Both halves now come from the shared
 * resolveTicketScope() in ../../_lib/ticket-auth so this route and the list
 * route cannot drift apart again.
 *
 * ── SERVICE ROLE (P8) ──────────────────────────────────────────────────────
 * This route uses `supabaseAdmin`, which BYPASSES RLS. The RLS policies on
 * support_ticket_replies (owner_select requires is_internal = false) are a
 * backstop, NOT the enforcement here. The `.eq('is_internal', false)` filter
 * below is the thing that actually keeps operator notes off a student's screen.
 * Do not remove it on the grounds that "the policy covers it" — it does not,
 * for this client.
 *
 * ── REPLY PAYLOAD (P13) ────────────────────────────────────────────────────
 * { id, author_role, body, created_at } only. `author_user_id` is never
 * selected and never returned; there is deliberately no author name or email
 * field — the UI renders "You" vs "Alfanumrik Support" from author_role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { checkRateLimit, type RateLimitStore } from '@alfanumrik/lib/rate-limiter';
import {
  applyTicketOwnershipScope,
  authorizeTicketRequest,
  resolveTicketScope,
  type TicketRoleAnchor,
} from '../../_lib/ticket-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hard ceiling on thread length returned in one response. */
const MAX_REPLIES = 200;

/** Reply body bounds — mirror the DB CHECK (btrim(body) <> '', length <= 5000). */
const REPLY_MAX_LENGTH = 5000;

// ── Rate limiter: 20 replies / hour / user ────────────────────────────
// Deliberately more generous than ticket CREATION (5 / 24h, ../route.ts:84-87):
// a back-and-forth conversation is the desired behaviour here, whereas ticket
// creation is the spam surface. Still bounded so a compromised session cannot
// flood a thread. In-memory per-instance, same trade-off as the create limiter.
const REPLY_RATE_STORE: RateLimitStore = new Map();
const REPLY_RATE_LIMIT = 20;
const REPLY_RATE_WINDOW_MS = 60 * 60 * 1000;

const replyCreateSchema = z.object({
  body: z.string().trim().min(1).max(REPLY_MAX_LENGTH),
});

interface StudentVisibleReply {
  id: string;
  author_role: string;
  body: string;
  created_at: string;
}

function err(message: string, status: number, code?: string) {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}) },
    { status },
  );
}

/**
 * Load the ticket iff the caller owns it under BOTH ownership columns.
 * Returns null when the ticket does not exist OR is not the caller's — the
 * caller must render both as 404 so ticket existence is never leaked.
 */
async function loadOwnedTicket(
  ticketId: string,
  auth: Awaited<ReturnType<typeof authorizeTicketRequest>>['auth'],
  isGuardianPath: boolean,
  columns: string,
): Promise<
  | { ok: true; ticket: Record<string, unknown>; roleAnchor: TicketRoleAnchor }
  | { ok: false; status: 404 | 500 }
> {
  const scope = await resolveTicketScope(auth, isGuardianPath);
  if (!scope.ok) {
    // No anchor at all → cannot own any ticket. 404, not 403.
    return { ok: false, status: 404 };
  }

  const { data, error } = await applyTicketOwnershipScope(
    supabaseAdmin.from('support_tickets').select(columns).eq('id', ticketId),
    scope,
  ).maybeSingle();

  if (error) {
    logger.error('support_ticket_scope_lookup_failed', {
      error: new Error(error.message),
      userId: auth.userId,
      ticketId,
    });
    return { ok: false, status: 500 };
  }
  if (!data) return { ok: false, status: 404 };

  return {
    ok: true,
    ticket: data as unknown as Record<string, unknown>,
    roleAnchor: scope.roleAnchor,
  };
}

// ── GET: ticket + student-visible reply thread ────────────────────────
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { auth, isGuardianPath } = await authorizeTicketRequest(request);
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) {
    return err('Invalid ticket id', 400, 'INVALID_ID');
  }

  const owned = await loadOwnedTicket(
    id,
    auth,
    isGuardianPath,
    'id, subject, message, category, priority, status, created_at, updated_at, resolved_at',
  );
  if (!owned.ok) {
    return owned.status === 404
      ? err('Ticket not found', 404, 'NOT_FOUND')
      : err('Failed to fetch ticket', 500, 'FETCH_FAILED');
  }

  // Student-visible thread only.
  //   * `.eq('is_internal', false)` — MANDATORY. supabaseAdmin bypasses RLS, so
  //     without this line every private operator note ships to the requester.
  //   * the column list omits author_user_id and is_internal entirely, so
  //     neither can leak through the response even by accident (P13).
  let replies: StudentVisibleReply[] = [];
  let repliesUnavailable = false;

  const { data: replyRows, error: replyError } = await supabaseAdmin
    .from('support_ticket_replies')
    .select('id, author_role, body, created_at')
    .eq('ticket_id', id)
    .eq('is_internal', false)
    .order('created_at', { ascending: true })
    .limit(MAX_REPLIES);

  if (replyError) {
    // Fail soft: a thread-read failure must not 500 the whole ticket page, but
    // we must NOT silently render "no replies" as if support never answered.
    // The flag lets the UI say "couldn't load replies — retry".
    repliesUnavailable = true;
    logger.error('support_ticket_replies_fetch_failed', {
      error: new Error(replyError.message),
      userId: auth.userId,
      ticketId: id,
    });
  } else {
    replies = (replyRows ?? []) as StudentVisibleReply[];
  }

  // Belt and braces: the column list above never asks for student_id or
  // user_role, but strip them anyway so a future column-list edit cannot leak
  // the ownership anchor (which for a parent-filed ticket is the CHILD's id).
  const {
    student_id: _studentId,
    user_role: _userRole,
    ...ticket
  } = owned.ticket as Record<string, unknown>;
  void _studentId;
  void _userRole;

  return NextResponse.json({
    success: true,
    data: {
      ticket: {
        ...ticket,
        // Aliases for the existing detail page, which reads `ticket_id` and
        // `description` (app/support/[ticket_id]/page.tsx:26-44). Additive —
        // `id` and `message` are still present, so no existing consumer breaks.
        ticket_id: ticket.id,
        description: ticket.message,
        replies,
      },
      replies,
      ...(repliesUnavailable ? { replies_unavailable: true } : {}),
    },
  });
}

// ── POST: requester appends a reply to their own thread ───────────────
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { auth, isGuardianPath } = await authorizeTicketRequest(request);
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) {
    return err('Invalid ticket id', 400, 'INVALID_ID');
  }

  // Rate limit before any DB work.
  const rl = checkRateLimit(
    REPLY_RATE_STORE,
    `support-reply:${auth.userId ?? 'anon'}`,
    REPLY_RATE_LIMIT,
    REPLY_RATE_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many replies. Please wait before sending another message.',
        code: 'RATE_LIMITED',
        retry_after_ms: rl.retryAfterMs,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err('Invalid JSON body', 400, 'INVALID_BODY');
  }

  const parsed = replyCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  // Ownership is verified BEFORE the insert, under the same two-column scope
  // the GET uses. A caller can never reply into someone else's thread.
  const owned = await loadOwnedTicket(id, auth, isGuardianPath, 'id, status');
  if (!owned.ok) {
    return owned.status === 404
      ? err('Ticket not found', 404, 'NOT_FOUND')
      : err('Failed to post reply', 500, 'REPLY_FAILED');
  }

  // Every security-relevant field is SERVER-derived; none is read from the body.
  //   author_role    — the caller's own resolved role anchor. Requester-side
  //                    only, so a student can never post a message that renders
  //                    as an official support answer.
  //   is_internal    — hard false. The table CHECK independently forbids a
  //                    requester-side internal note.
  //   author_user_id — from the authorized session, never the payload.
  const insertRow = {
    ticket_id: id,
    author_user_id: auth.userId,
    author_role: owned.roleAnchor satisfies TicketRoleAnchor,
    body: parsed.data.body.slice(0, REPLY_MAX_LENGTH),
    is_internal: false,
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('support_ticket_replies')
    .insert(insertRow)
    .select('id, author_role, body, created_at')
    .single();

  if (insertError || !inserted) {
    logger.error('support_ticket_reply_insert_failed', {
      error: insertError ? new Error(insertError.message) : new Error('no data'),
      userId: auth.userId,
      ticketId: id,
    });
    return err('Failed to post reply', 500, 'REPLY_FAILED');
  }

  // Thread bookkeeping the migration deliberately left to the API layer:
  // a requester reply on a resolved/closed ticket re-opens it, so the answer
  // does not disappear into the operator console's resolved bucket. Best-effort
  // — the reply itself is already durable, so a failure here must not 500.
  const currentStatus = String(owned.ticket.status ?? '');
  const statusUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (currentStatus === 'resolved' || currentStatus === 'closed') {
    statusUpdate.status = 'open';
    statusUpdate.resolved_at = null;
  }
  const { error: bumpError } = await supabaseAdmin
    .from('support_tickets')
    .update(statusUpdate)
    .eq('id', id);
  if (bumpError) {
    logger.warn('support_ticket_reply_status_bump_failed', {
      ticketId: id,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      reply: inserted as StudentVisibleReply,
      ticket_status: statusUpdate.status ?? currentStatus,
    },
  });
}
