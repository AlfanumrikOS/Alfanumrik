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
 *
 * Transport (both supported): the RPC runs on `createSupabaseRouteClient(request)`,
 * which forwards `Authorization: Bearer <jwt>` (the ONLY transport the Flutter app
 * uses) to PostgREST under the anon key and falls back to the cookie session client
 * for web. RLS enforced on both paths; the service-role key is never used for the
 * RPC. See the long note at the call site for why the previous cookie-only client
 * both disarmed the RPC's ownership guard for mobile and left START one anon-revoke
 * away from the 2026-08-12 submit P0.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { logger } from '@alfanumrik/lib/logger';
import { validateBody } from '@alfanumrik/lib/validation';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { QuizStartRequest } from '@alfanumrik/lib/api/v2/contract';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

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

export const POST = withRoute(async (request: NextRequest) => {
  try {
    // 1. RBAC.
    const auth = await authorizeRequest(request, 'quiz.attempt');
    if (!auth.authorized || !auth.userId) return auth.errorResponse as unknown as NextResponse;

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
    // Service-role ON PURPOSE: this reads the `students` row that maps the
    // caller's auth_user_id → student id BEFORE we know which student the
    // caller is, which is exactly the lookup RLS cannot help with. It selects
    // one non-PII column (`id`) keyed by the caller's OWN auth id, and its only
    // effect is to REFUSE requests. Kept on the admin client deliberately.
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
    //
    // BOTH transports are handled: `createSupabaseRouteClient` forwards an
    // `Authorization: Bearer <jwt>` (mobile) to PostgREST under the anon key,
    // and falls back to the cookie session client (`createSupabaseServerClient`)
    // for web callers. RLS is enforced on both paths; the service-role key is
    // never used for the RPC.
    //
    // This was the COOKIE-ONLY client, which is the same shape as the
    // 2026-08-12 quiz-submit P0 — two ways:
    //
    //  1. DEFENSE-IN-DEPTH LOSS (today). `start_quiz_session` is SECURITY
    //     DEFINER and opens with `IF auth.uid() IS NOT NULL AND NOT EXISTS
    //     (... students ...)` — the guard is SKIPPED when auth.uid() is NULL so
    //     that service-role/cron callers still work. Bearer callers arrived as
    //     `anon` with auth.uid() NULL, so the ownership guard was skipped for
    //     EVERY mobile caller. Access was still refused by the route-layer 403
    //     above, so this was never a live cross-student hole — but the DB-level
    //     half of the check was doing nothing.
    //
    //  2. LATENT BREAKAGE (tomorrow). It only worked at all because
    //     `start_quiz_session` still carries a residual PUBLIC EXECUTE grant:
    //     the `REVOKE EXECUTE ... FROM anon` in migration 20260515000002 is a
    //     silent no-op while PUBLIC grants the same privilege. The anon-
    //     revocation campaign (cf. 20260813000006, which does `REVOKE ALL ...
    //     FROM PUBLIC`) removes that, and quiz START would then break for every
    //     mobile user exactly as submit did. Start is the direct predecessor in
    //     the funnel — a student cannot submit a quiz they cannot start.
    const supabaseUser = await createSupabaseRouteClient(request);
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
});
