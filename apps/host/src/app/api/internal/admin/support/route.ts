/**
 * /api/internal/admin/support — operator console for support tickets.
 *
 * GET   ?status=…&page=&limit=   → paginated ticket list      (support.view_tickets)
 * GET   ?ticket_id=<uuid>        → one ticket + FULL thread    (support.view_tickets)
 * PATCH { id, status?, admin_note? } → status / legacy note   (support.manage_tickets)
 * POST  { ticket_id, body, is_internal? } → post a reply      (support.manage_tickets)
 *
 * The POST reply endpoint closes the SEV1 where an operator could only flip a
 * ticket to `resolved` and had no way to actually answer the student: the only
 * operator-writable text field was `support_tickets.admin_notes`, which is
 * internal and never returned to the requester.
 *
 * Authorization matches this file's existing convention — `authorizeRequest`
 * with the already-granted `support.view_tickets` / `support.manage_tickets`
 * codes (migration 20260612123200_rbac_matrix_conformance.sql:177-178). No new
 * permission code was introduced.
 *
 * P13: reply/note BODIES are never written to the audit log or the logger —
 * only ids, the is_internal flag, the ticket status, and a body/note length.
 * This holds on BOTH write paths (PATCH `admin_note`, POST reply `body`); the
 * bodies themselves are persisted only to the ticket/thread rows, whose read
 * scope is narrower than `admin_audit_log`'s (readable by any admin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@alfanumrik/lib/admin-auth';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the support_ticket_replies body CHECK (length <= 5000, non-blank). */
const REPLY_MAX_LENGTH = 5000;

/** Hard ceiling on thread length returned in one operator response. */
const MAX_REPLIES = 500;

// ── Ticket-owner notification (F4 fix) ──────────────────────────────────
//
// When an operator replies (student-visible) or resolves a ticket, the
// requester previously got no signal at all — the reply/resolution sat
// silently in `support_tickets`/`support_ticket_replies` until the student
// happened to reopen the support page. This fires ONE best-effort in-app
// `notifications` row to the ticket's owning student.
//
// Scope: `support_tickets` only carries a single ownership anchor
// (`student_id` + `user_role`; see ../../support/tickets/route.ts:16-25 for
// why there is no dedicated `created_by_user_id` column). This helper only
// notifies when `user_role === 'student'` — i.e. the ticket's own filer is a
// student with a direct `student_id` anchor. Parent- and teacher-filed
// tickets are intentionally skipped (a parent ticket's student_id anchor is
// the CHILD, not the filer, and notifying the child would leak the
// existence/content of a ticket the child never filed and may not know
// about — a P13 concern; teacher tickets carry no anchor at all).
//
// P7: top-level `message`/`body` carry English (NOT NULL); Hindi lives
// nested under `data.title_hi`/`data.body_hi` — mirrors the verified
// notification-triggers.ts house shape, NOT a top-level body_hi column.
// P13: `data` carries only the ticket id and a deep-link target — no ticket
// subject/body text, and errors here are logged with ids only.
async function notifyTicketOwner(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ticketId: string,
  kind: 'reply' | 'resolved',
): Promise<void> {
  try {
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select('student_id, user_role')
      .eq('id', ticketId)
      .maybeSingle();
    if (error || !ticket || !ticket.student_id || ticket.user_role !== 'student') {
      return; // no direct student anchor — best-effort only, never blocks the caller
    }

    const type = kind === 'reply' ? 'support_ticket_reply' : 'support_ticket_resolved';
    const titleEn = kind === 'reply' ? 'New reply on your support ticket' : 'Your support ticket is resolved';
    const titleHi = kind === 'reply' ? 'आपकी सहायता टिकट पर नया उत्तर' : 'आपकी सहायता टिकट हल हो गई है';
    const bodyEn =
      kind === 'reply'
        ? 'Support has replied to your ticket. Tap to view the response.'
        : 'Your support ticket has been marked resolved. Tap to view the details.';
    const bodyHi =
      kind === 'reply'
        ? 'सहायता टीम ने आपकी टिकट का उत्तर दिया है। उत्तर देखने के लिए टैप करें।'
        : 'आपकी सहायता टिकट को हल के रूप में चिह्नित किया गया है। विवरण देखने के लिए टैप करें।';

    const { error: insertError } = await supabase.from('notifications').insert({
      recipient_type: 'student',
      recipient_id: ticket.student_id,
      type,
      title: titleEn,
      message: bodyEn,
      body: bodyEn,
      data: {
        ticket_id: ticketId,
        trigger: type,
        action: `/support/${ticketId}`,
        title_hi: titleHi,
        body_hi: bodyHi,
      },
      is_read: false,
      created_at: new Date().toISOString(),
    });
    if (insertError) {
      logger.error('support_ticket_notify_insert_failed', {
        error: new Error(insertError.message),
        ticketId,
        kind,
      });
    }
  } catch (err) {
    logger.error('support_ticket_notify_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      ticketId,
      kind,
    });
  }
}

// GET /api/internal/admin/support?status=open|pending|resolved|all&page=&limit=
// GET /api/internal/admin/support?ticket_id=<uuid>  → single ticket + full thread
export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'support.view_tickets');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;

  // ── Thread view ───────────────────────────────────────────────────────
  // Operators see the WHOLE thread, internal notes included — that is the
  // point of the operator console, and it is why the student-facing route
  // (api/support/tickets/[id]) filters `.eq('is_internal', false)` explicitly.
  const ticketId = sp.get('ticket_id');
  if (ticketId) {
    if (!UUID_RE.test(ticketId)) {
      return NextResponse.json({ error: 'invalid ticket_id' }, { status: 400 });
    }

    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .maybeSingle();
    if (ticketError) {
      return NextResponse.json({ error: ticketError.message }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: 'ticket not found' }, { status: 404 });
    }

    const { data: replies, error: repliesError } = await supabase
      .from('support_ticket_replies')
      .select('id, author_user_id, author_role, body, is_internal, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .limit(MAX_REPLIES);
    if (repliesError) {
      return NextResponse.json({ error: repliesError.message }, { status: 500 });
    }

    return NextResponse.json({ ticket, replies: replies ?? [] });
  }

  // ── List view (unchanged shape) ───────────────────────────────────────
  const status = sp.get('status') || 'open';
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, parseInt(sp.get('limit') || '25'));
  const offset = (page - 1) * limit;

  let q = supabase
    .from('support_tickets')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== 'all') q = q.eq('status', status);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, total: count ?? 0, page, limit });
}

// PATCH /api/internal/admin/support — update ticket status / add note
export async function PATCH(request: NextRequest) {
  const auth = await authorizeRequest(request, 'support.manage_tickets');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { id, status, admin_note } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (admin_note !== undefined) updates.admin_notes = admin_note; // column is admin_notes
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();

    const { error } = await supabase.from('support_tickets').update(updates).eq('id', id);
    if (error) throw error;

    // Best-effort ticket-owner notification — never fails the status change.
    if (status === 'resolved') {
      await notifyTicketOwner(supabase, id, 'resolved');
    }

    // P13: the note text is NOT audited — only the new status and a length.
    // `admin_audit_log` is readable by every admin (`audit_read` USING is_admin()),
    // which is wider than the ticket itself, and operator prose about a case
    // routinely carries name / contact / situation. Mirrors the POST path below.
    await logAdminAction({
      action: 'update_support_ticket',
      entity_type: 'support_ticket',
      entity_id: id,
      details: {
        status,
        admin_note_length: typeof admin_note === 'string' ? admin_note.length : 0,
      },
      ip,
      actorUserId: auth.userId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST /api/internal/admin/support — operator posts a reply on a ticket thread.
//
// Body: { ticket_id: uuid, body: string (1..5000), is_internal?: boolean }
//   is_internal=false (default) → student-visible answer. This is the message
//     that actually reaches the requester through
//     GET /api/support/tickets/[id].
//   is_internal=true            → private working note. Structurally
//     unreachable by the requester: the student route filters it out
//     explicitly AND the RLS read policy excludes it.
//
// author_role is pinned server-side to 'operator' (never read from the body),
// so the reply always renders as official support and a caller cannot forge a
// requester-side message.
export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'support.manage_tickets');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  let payload: { ticket_id?: unknown; body?: unknown; is_internal?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const ticketId = typeof payload.ticket_id === 'string' ? payload.ticket_id : '';
  if (!UUID_RE.test(ticketId)) {
    return NextResponse.json({ error: 'ticket_id required' }, { status: 400 });
  }

  const rawBody = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!rawBody) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  if (rawBody.length > REPLY_MAX_LENGTH) {
    return NextResponse.json(
      { error: `body cannot exceed ${REPLY_MAX_LENGTH} characters` },
      { status: 400 },
    );
  }
  const isInternal = payload.is_internal === true;

  try {
    // Ticket must exist before we attach a reply to it. (The FK would reject a
    // dangling ticket_id anyway; this turns that into a clean 404.)
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('id, status')
      .eq('id', ticketId)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) {
      return NextResponse.json({ error: 'ticket not found' }, { status: 404 });
    }

    const { data: reply, error: insertError } = await supabase
      .from('support_ticket_replies')
      .insert({
        ticket_id: ticketId,
        author_user_id: auth.userId,
        author_role: 'operator', // server-pinned, never from the body
        body: rawBody,
        is_internal: isInternal,
      })
      .select('id, author_role, body, is_internal, created_at')
      .single();
    if (insertError || !reply) throw insertError ?? new Error('reply insert returned no row');

    // A student-visible answer moves an `open` ticket to `pending` (awaiting the
    // requester). An internal note never changes ticket state. Best-effort: the
    // reply is already durable, so a bookkeeping failure must not 500.
    let nextStatus = String(ticket.status ?? '');
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (!isInternal && nextStatus === 'open') {
      nextStatus = 'pending';
      updates.status = 'pending';
    }
    await supabase.from('support_tickets').update(updates).eq('id', ticketId);

    // Best-effort ticket-owner notification — student-visible replies only,
    // never internal notes. Never fails the reply itself.
    if (!isInternal) {
      await notifyTicketOwner(supabase, ticketId, 'reply');
    }

    // P13: the reply text is NOT audited — only ids, the visibility flag and a
    // length. A support body routinely contains student-identifiable detail.
    await logAdminAction({
      action: 'reply_support_ticket',
      entity_type: 'support_ticket',
      entity_id: ticketId,
      details: { reply_id: reply.id, is_internal: isInternal, body_length: rawBody.length },
      ip,
      actorUserId: auth.userId,
    });

    return NextResponse.json({ success: true, reply, ticket_status: nextStatus });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
