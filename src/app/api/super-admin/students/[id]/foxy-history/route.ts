import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  validateImpersonationSession,
  recordPageView,
} from '../../_lib/validate-session';

// GET /api/super-admin/students/[id]/foxy-history — chat history for Live View
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  // Require active impersonation session
  const valid = await validateImpersonationSession(auth.adminId, studentId);
  if (!valid) {
    return NextResponse.json(
      { error: 'No active impersonation session' },
      { status: 403 }
    );
  }

  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    // Fetch foxy_sessions (new system) and chat_sessions (legacy) in parallel
    const [foxySessionsRes, legacySessionsRes] = await Promise.all([
      supabaseAdmin
        .from('foxy_sessions')
        .select('id, subject, grade, chapter, mode, last_active_at, created_at')
        .eq('student_id', studentId)
        .order('last_active_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('chat_sessions')
        .select('id, subject, title, message_count, is_active, created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // If a specific sessionId is requested, fetch its messages
    let messages: unknown[] = [];
    if (sessionId && isValidUUID(sessionId)) {
      // Try foxy_chat_messages first (new system), then fall back to chat_sessions.messages
      const { data: foxyMessages } = await supabaseAdmin
        .from('foxy_chat_messages')
        .select('id, role, content, sources, tokens_used, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (foxyMessages && foxyMessages.length > 0) {
        messages = foxyMessages;
      } else {
        // Legacy: chat_sessions stores messages as JSONB in the row itself
        const { data: legacySession } = await supabaseAdmin
          .from('chat_sessions')
          .select('messages')
          .eq('id', sessionId)
          .single();

        if (legacySession?.messages) {
          messages = Array.isArray(legacySession.messages)
            ? legacySession.messages
            : [];
        }
      }
    }

    // Fire-and-forget page view tracking
    recordPageView(auth.adminId, studentId, 'foxy-history');

    return NextResponse.json({
      sessions: [
        ...(foxySessionsRes.data || []).map((s) => ({
          ...s,
          source: 'foxy' as const,
        })),
        ...(legacySessionsRes.data || []).map((s) => ({
          ...s,
          source: 'legacy' as const,
        })),
      ],
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
