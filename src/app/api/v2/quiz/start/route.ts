/**
 * POST /api/v2/quiz/start — create a server-shuffled quiz session (mobile + web).
 *
 * THIN wrapper over the start_quiz_session RPC (server-owned shuffle authority,
 * migration 20260428160000). The RPC generates a per-question shuffle, snapshots
 * options + correct_answer_index into quiz_session_shuffles, and returns the
 * SHUFFLED options WITHOUT correct_answer_index. The shuffle_map stays
 * server-side (P6) and is never returned.
 *
 * This mirrors the existing client helper `startQuizSession` in src/lib/supabase.ts
 * (same RPC, same args) but moves it server-side behind RBAC + a JWT/body
 * studentId cross-check (defense-in-depth, same guard as /api/quiz/submit).
 *
 * No scoring / XP / anti-cheat math here.
 *
 * Auth boundary (P9): authorizeRequest('quiz.attempt'); body.studentId is
 * cross-checked against the JWT's resolved student (403 on mismatch). The RPC
 * runs under a JWT-bound client so its SECURITY DEFINER auth.uid() guard sees
 * the calling student.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { validateBody } from '@/lib/validation';
import { v2Success, v2Error } from '@/lib/api/v2/envelope';
import { QuizStartRequest } from '@/lib/api/v2/contract';

interface ServerShuffledQuestion {
  question_id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options_displayed: string[];
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
}
interface ServerQuizSession {
  session_id: string;
  questions: ServerShuffledQuestion[];
}

export async function POST(request: NextRequest) {
  try {
    // 1. RBAC.
    const auth = await authorizeRequest(request, 'quiz.attempt');
    if (!auth.authorized || !auth.userId) return auth.errorResponse!;

    // 2. Body validation.
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return v2Error('Invalid JSON body', 400, 'VALIDATION_ERROR');
    }
    const validation = validateBody(QuizStartRequest, raw);
    if (!validation.success) return validation.error;
    const { studentId, questionIds } = validation.data;

    // 3. Cross-check JWT's student matches body.studentId (defense-in-depth).
    const admin = getSupabaseAdmin();
    const { data: studentRow } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', auth.userId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (!studentRow?.id) {
      return v2Error('No student profile linked to this account', 403, 'NO_STUDENT_PROFILE');
    }
    if (studentRow.id !== studentId) {
      logger.warn('v2.quiz.start: studentId mismatch', {
        jwtStudentId: studentRow.id,
        bodyStudentId: studentId,
      });
      return v2Error('Student ID mismatch', 403, 'STUDENT_ID_MISMATCH');
    }

    // 4. Call start_quiz_session verbatim under a JWT-bound client.
    const supabaseUser = await createSupabaseServerClient();
    let session: ServerQuizSession | null = null;
    try {
      const { data, error } = await supabaseUser.rpc('start_quiz_session', {
        p_student_id: studentId,
        p_question_ids: questionIds,
      });
      if (error) {
        logger.warn('v2.quiz.start: RPC failed', { error: error.message });
      } else if (data && typeof data === 'object') {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (parsed?.session_id && Array.isArray(parsed?.questions)) {
          session = parsed as ServerQuizSession;
        }
      }
    } catch (e) {
      logger.warn('v2.quiz.start: RPC exception', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (!session) {
      // RPC null/failure → 503 so the client can retry.
      return v2Error('Could not start quiz session — please retry', 503, 'START_SESSION_FAILED');
    }

    return v2Success({
      schemaVersion: 1 as const,
      session_id: session.session_id,
      questions: session.questions,
    });
  } catch (err) {
    logger.error('v2_quiz_start_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/quiz/start',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
