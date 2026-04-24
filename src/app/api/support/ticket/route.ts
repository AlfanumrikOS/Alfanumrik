/**
 * POST /api/support/ticket
 *
 * Creates a support ticket. Allows unauthenticated (guest) submissions
 * but always resolves student_id from auth — never trusts client-provided student_id.
 * Replaces direct anon-client insert in help/page.tsx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getStudentByAuthUserId } from '@/lib/domains/identity';
import { logger } from '@/lib/logger';

const ALLOWED_CATEGORIES = ['bug', 'content', 'payment', 'account', 'feature', 'other'];

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const { category, subject, message, email } = body;

  if (typeof category !== 'string' || !ALLOWED_CATEGORIES.includes(category)) {
    return err(`category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`, 400);
  }
  if (typeof message !== 'string' || message.trim().length < 10) {
    return err('message must be at least 10 characters', 400);
  }
  if (message.trim().length > 5000) {
    return err('message cannot exceed 5000 characters', 400);
  }

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

  // Validate email for guests
  const resolvedEmail = studentEmail ?? (typeof email === 'string' ? email.trim() : 'anonymous');
  if (resolvedEmail !== 'anonymous' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
    return err('Invalid email format', 400);
  }

  const ua = request.headers.get('user-agent') ?? '';

  const { error } = await supabaseAdmin.from('support_tickets').insert({
    student_id: studentId,
    email: resolvedEmail,
    category,
    subject: typeof subject === 'string' ? subject.trim().substring(0, 200) : category,
    message: message.trim(),
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
