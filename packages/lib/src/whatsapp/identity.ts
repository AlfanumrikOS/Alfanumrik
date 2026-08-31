/**
 * ALFANUMRIK — WhatsApp bot identity resolution (THE R6 CHOKEPOINT).
 *
 * ── SECURITY INVARIANT (plan R6 / behavioral spec (e), P14-binding) ──────────
 * `p_student_id` for ANY quiz/mastery RPC invoked on behalf of a WhatsApp
 * conversation (get_practice_queue, seed_adaptive_mastery,
 * get_questions_for_node, select_quiz_questions_rag, start_quiz_session,
 * bkt_update, submit_quiz_results_v2, ...) MUST originate ONLY from the
 * return value of `resolveActiveStudent()` in this module. No caller may
 * accept a student id from an inbound message payload, a button opcode, or
 * any other channel-controlled surface.
 *
 * Resolution chain (each link is load-bearing):
 *   1. `whatsapp_identities` row by id — MUST be live:
 *        verified_at IS NOT NULL AND revoked_at IS NULL
 *        AND opt_in_status = 'opted_in'
 *      An unverified/revoked/opted-out row NEVER resolves a student.
 *   2. `whatsapp_sessions.active_student_id` for that identity (the
 *      sibling-selection column — migration 20260801100100 comments pin it as
 *      the only legitimate p_student_id source). When no session row exists
 *      yet (first interaction after LINK), fall back to the verified identity
 *      row's own `student_id` — the OTP-verified binding itself.
 *   3. `students` join for grade (P5: STRING "6".."12") + subject seeds.
 *
 * Returns null when any link fails — callers must treat null as "not linked"
 * and never guess a student.
 *
 * P13: no phone, no student name in this module's logs (it does not log).
 */

/** Minimal structural Supabase client (service-role; server-only callers). */
interface MinimalSupabaseClient {
  from(table: string): any;
}

export interface ActiveStudent {
  /** The ONLY legitimate p_student_id for bot-originated RPC calls (R6). */
  studentId: string;
  /** P5: grade is a STRING "6".."12" — never an integer. */
  grade: string;
  /**
   * Best-known current subject: the conversation session's subject when set,
   * else the student's preferred_subject, else null (caller shows the picker).
   */
  subject: string | null;
  /** Reply language — session row wins, then identity row, default 'en'. */
  locale: 'en' | 'hi';
  /**
   * students.selected_subjects (may be empty) — seeds the Daily-6 subject
   * picker (spec Q5). Additive to the task's minimal contract; documented.
   */
  selectedSubjects: string[];
}

interface IdentityRow {
  id: string;
  student_id: string | null;
  role: 'student' | 'guardian';
  locale: 'en' | 'hi' | null;
  verified_at: string | null;
  revoked_at: string | null;
  opt_in_status: string;
}

interface SessionRowLite {
  active_student_id: string | null;
  subject: string | null;
  locale: 'en' | 'hi' | null;
}

interface StudentRowLite {
  id: string;
  grade: string | number | null;
  selected_subjects: string[] | null;
  preferred_subject: string | null;
}

/**
 * Resolve the active student for a WhatsApp identity. See module header —
 * this is the single R6 chokepoint. Never throws; resolution failure → null.
 */
export async function resolveActiveStudent(
  supabase: MinimalSupabaseClient,
  identityId: string,
): Promise<ActiveStudent | null> {
  try {
    const { data: identity, error: idErr } = await supabase
      .from('whatsapp_identities')
      .select('id, student_id, role, locale, verified_at, revoked_at, opt_in_status')
      .eq('id', identityId)
      .maybeSingle();
    if (idErr || !identity) return null;
    const ident = identity as IdentityRow;

    // Live-identity gate (R6): unverified / revoked / not-opted-in rows never
    // resolve a student.
    if (
      ident.verified_at === null ||
      ident.revoked_at !== null ||
      ident.opt_in_status !== 'opted_in'
    ) {
      return null;
    }

    const { data: sessionRow, error: sessionErr } = await supabase
      .from('whatsapp_sessions')
      .select('active_student_id, subject, locale')
      .eq('identity_id', identityId)
      .maybeSingle();
    // A failed session read is NOT "fresh session". Falling through would
    // silently resolve the OTP binding's own student — i.e. serve the WRONG
    // SIBLING to a parent who had explicitly switched. This resolver is the
    // single R6 chokepoint and its documented failure mode is null, so return
    // null rather than guess. P13: no phone/identity values logged.
    if (sessionErr) {
      console.warn(
        '[whatsapp-identity] session read failed:',
        sessionErr.code,
        sessionErr.message,
      );
      return null;
    }
    const session = (sessionRow ?? null) as SessionRowLite | null;

    // Session's sibling selection wins; fresh sessions fall back to the
    // OTP-verified binding's own student_id.
    const activeStudentId = session?.active_student_id ?? ident.student_id;
    if (!activeStudentId) return null;

    const { data: studentRow, error: stErr } = await supabase
      .from('students')
      .select('id, grade, selected_subjects, preferred_subject')
      .eq('id', activeStudentId)
      .maybeSingle();
    if (stErr || !studentRow) return null;
    const student = studentRow as StudentRowLite;
    if (student.grade === null || student.grade === undefined) return null;

    const selectedSubjects = Array.isArray(student.selected_subjects)
      ? student.selected_subjects.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : [];

    return {
      studentId: student.id,
      // P5 defensive normalization: always a string.
      grade: String(student.grade),
      subject: session?.subject ?? student.preferred_subject ?? null,
      locale: session?.locale === 'hi' || (!session?.locale && ident.locale === 'hi') ? 'hi' : 'en',
      selectedSubjects,
    };
  } catch {
    return null;
  }
}
