/**
 * GET /api/support/tickets/[id] — fetch a single ticket the user owns.
 *
 * Auth: authorizeRequest(request, 'foxy.chat')
 * Ownership: enforced server-side by filtering on student_id = auth.studentId.
 *   The service-role client bypasses RLS, so we MUST filter explicitly.
 *
 * Replies: there is no `support_ticket_replies` table in the current schema.
 *   When that lands, append it to the response under `replies`. For now we
 *   return `replies: []` so the frontend contract is forward-compatible.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number, code?: string) {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}) },
    { status },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'foxy.chat');
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) {
    return err('Invalid ticket id', 400, 'INVALID_ID');
  }

  // Without a student profile, the user can't own any ticket — return 404
  // rather than 403 so we don't leak ticket existence.
  if (!auth.studentId) {
    return err('Ticket not found', 404, 'NOT_FOUND');
  }

  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(
      'id, subject, message, category, priority, status, created_at, updated_at, resolved_at, student_id',
    )
    .eq('id', id)
    .eq('student_id', auth.studentId) // explicit ownership filter
    .maybeSingle();

  if (error) {
    logger.error('support_ticket_get_failed', {
      error: new Error(error.message),
      userId: auth.userId,
      ticketId: id,
    });
    return err('Failed to fetch ticket', 500, 'FETCH_FAILED');
  }

  if (!data) {
    return err('Ticket not found', 404, 'NOT_FOUND');
  }

  // Strip ownership column from response — already verified above.
  const { student_id: _student_id, ...ticket } = data;
  void _student_id;

  return NextResponse.json({
    success: true,
    data: {
      ticket,
      replies: [], // forward-compat: no replies table yet
    },
  });
}
