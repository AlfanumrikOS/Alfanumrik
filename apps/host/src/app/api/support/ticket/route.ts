/**
 * POST /api/support/ticket
 *
 * Creates a support ticket. Allows unauthenticated (guest) submissions
 * but always resolves student_id from auth — never trusts client-provided student_id.
 * Replaces direct anon-client insert in help/page.tsx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getStudentByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { logger } from '@alfanumrik/lib/logger';
import { validateBody } from '@alfanumrik/lib/validation';

const TicketBodySchema = z.object({
  category: z.enum(['bug', 'content', 'payment', 'account', 'feature', 'other']),
  message: z.string().trim().min(10, 'message must be at least 10 characters').max(5000, 'message cannot exceed 5000 characters'),
  subject: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(254).optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try { rawBody = await request.json(); } catch { return err('Invalid request body', 400); }

  const validation = validateBody(TicketBodySchema, rawBody);
  if (!validation.success) return validation.error;
  const { category, subject, message, email } = validation.data;

  // Try to resolve authenticated student (optional — guests can also submit)
  let studentId: string | null = null;
  let studentName: string | null = null;
  let studentEmail: string | null = null;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (user) {
      const result = await getStudentByAuthUserId(user.id);
      if (result.ok && result.data) {
        studentId = result.data.id;
        studentName = result.data.name;
        studentEmail = result.data.email;
      }
    }
  }

  // Resolve email — authed student's email > body email (guest) > anonymous.
  // The schema already validates email format when supplied; no second check needed.
  const resolvedEmail = studentEmail ?? email ?? 'anonymous';

  const ua = request.headers.get('user-agent') ?? '';

  const { error } = await supabaseAdmin.from('support_tickets').insert({
    student_id: studentId,
    email: resolvedEmail,
    category,
    subject: subject || category,
    message,
    status: 'open',
    user_role: studentId ? 'student' : 'guest',
    user_name: studentName ?? 'Guest',
    device_info: ua.substring(0, 200),
  });

  if (error) {
    logger.error('support_ticket_insert_failed', { error: new Error(error.message), category });
    return err('Failed to create ticket', 500);
  }

  return NextResponse.json({ success: true });
}
