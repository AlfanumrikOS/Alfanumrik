/**
 * Safe DB adapters for fetching student and session context.
 *
 * Used by AI workflows to personalize responses by grade, board,
 * plan, and conversation history. Never throws — returns null on error.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { StudentContext, SessionContext, ChatMessage } from '../types';
import { MAX_HISTORY_TURNS } from '../config';

export async function getStudentContext(
  studentId: string,
): Promise<StudentContext | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('students')
      .select('id, grade, board, subscription_plan, academic_goal, account_status')
      .eq('id', studentId)
      .single();

    if (error || !data) {
      logger.warn('Failed to fetch student context', {
        studentId,
        error: error?.message ?? 'no data',
      });
      return null;
    }

    return {
      studentId: data.id,
      grade: String(data.grade), // P5: always string
      board: data.board ?? 'CBSE',
      subscriptionPlan: data.subscription_plan ?? 'free',
      academicGoal: data.academic_goal ?? null,
      accountStatus: data.account_status ?? 'active',
    };
  } catch (err) {
    logger.error('Unexpected error fetching student context', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return null;
  }
}

export async function getSessionContext(
  sessionId: string,
  studentId: string,
): Promise<SessionContext | null> {
  try {
    // Fetch session metadata
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('foxy_sessions')
      .select('id, subject, grade, chapter, mode')
      .eq('id', sessionId)
      .eq('student_id', studentId)
      .single();

    if (sessionError || !session) {
      logger.warn('Failed to fetch session context', {
        sessionId,
        studentId,
        error: sessionError?.message ?? 'no data',
      });
      return null;
    }

    // Fetch recent chat history
    const { data: messages } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(MAX_HISTORY_TURNS * 2); // 2 messages per turn (user + assistant)

    const history: ChatMessage[] = (messages ?? []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    return {
      sessionId: session.id,
      subject: session.subject,
      grade: String(session.grade), // P5: always string
      chapter: session.chapter ?? null,
      mode: session.mode ?? 'learn',
      history,
    };
  } catch (err) {
    logger.error('Unexpected error fetching session context', {
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      studentId,
    });
    return null;
  }
}
