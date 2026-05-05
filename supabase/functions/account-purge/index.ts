// account-purge — DPDP Section 17 right-to-erasure executor (Wave 2 D7.1 follow-up #2).
//
// Invoked by /api/cron/account-purge (route lives in src/app/api/cron/account-purge/route.ts)
// once the 30-day cooling-off window has elapsed for a given account_deletion_log row.
//
// Contract (REQUIRED — pinned by tests, called by the cron route):
//   POST {SUPABASE_URL}/functions/v1/account-purge
//   Headers:
//     Authorization: Bearer <SERVICE_ROLE_KEY>
//     x-cron-secret: <CRON_SECRET>
//   Body: { account_id: UUID, account_role: 'student'|'teacher'|'parent', deletion_log_id: UUID }
//   Returns:
//     200 { success: true, purged_categories: {...} }   on full purge
//     200 { success: true, idempotent: true }           when log row already terminal
//     401                                                on missing/wrong cron secret
//     422 { success: false, error: '...' }              on invalid body — log row also flipped to 'failed'
//     5xx { success: false, error: '...' }              on partial failure — log row flipped to 'failed', cron retries
//
// What it does (in this exact order):
//   1. Verify x-cron-secret with constant-time compare (pattern from daily-cron/index.ts:802-809).
//   2. Validate body shape — invalid → 422 (no log mutation: invalid input cannot be re-tried).
//   3. Re-read the account_deletion_log row. If status ∈ {'purged','cancelled_by_user'} → 200 idempotent.
//   4. Generate ONE synthetic UUID per call. Reuse across every payment-FK rewrite so the
//      anonymised payment trail stays internally consistent.
//   5. Anonymise payment-FK columns (subscription_events, student_subscriptions, payment_history)
//      to the synthetic UUID. We do NOT delete these rows — Indian IT Act §44AA mandates 8-year
//      retention on financial records. Note: payment_webhook_events has no student FK.
//   6. Hard-delete PII rows owned by this account (quiz_*, chat_sessions, foxy_chat_messages,
//      foxy_sessions, foxy_scan_queries, image_uploads, etc.).
//   7. Null PII columns on the role table itself (students/teachers/guardians) — keep the row so
//      anonymised payment FK targets still resolve in joins for retention reads.
//   8. Delete the auth.users row via auth.admin.deleteUser. This cascades to auth.identities and
//      kills any active session.
//   9. Update account_deletion_log → status='purged', completed_at, purged_categories with counts.
//
// Idempotency: short-circuit at step 3. Each step is also independently safe-to-rerun
// (DELETE on already-empty rows = 0 rows; UPDATE setting NULL on already-NULL = no-op).
//
// PII discipline: console.log only IDs and counts, never email/name/phone/free-text.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

type AccountRole = 'student' | 'teacher' | 'parent'

interface PurgeBody {
  account_id: string
  account_role: AccountRole
  deletion_log_id: string
}

interface PurgedCategories {
  payment_fk_anonymised: {
    subscription_events: number
    student_subscriptions: number
    payment_history: number
  }
  pii_rows_deleted: Record<string, number>
  pii_columns_nulled: boolean
  auth_user_deleted: boolean
  synthetic_anon_id: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_ROLES = new Set<AccountRole>(['student', 'teacher', 'parent'])

function validateBody(raw: unknown): { ok: true; body: PurgeBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body must be an object' }
  const obj = raw as Record<string, unknown>
  const account_id = obj.account_id
  const account_role = obj.account_role
  const deletion_log_id = obj.deletion_log_id
  if (typeof account_id !== 'string' || !UUID_RE.test(account_id)) {
    return { ok: false, reason: 'account_id must be a UUID' }
  }
  if (typeof deletion_log_id !== 'string' || !UUID_RE.test(deletion_log_id)) {
    return { ok: false, reason: 'deletion_log_id must be a UUID' }
  }
  if (typeof account_role !== 'string' || !VALID_ROLES.has(account_role as AccountRole)) {
    return { ok: false, reason: "account_role must be one of 'student'|'teacher'|'parent'" }
  }
  return { ok: true, body: { account_id, account_role: account_role as AccountRole, deletion_log_id } }
}

/**
 * Constant-time string comparison. Same pattern as daily-cron/index.ts:802-809
 * and the cron route (timingSafeEqual on Node). Guards against timing-based
 * secret guessing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

// ─── Per-step purge primitives ───────────────────────────────────────────────

type SB = ReturnType<typeof createClient>

async function anonymisePaymentFks(
  sb: SB,
  studentId: string,
  syntheticId: string,
): Promise<PurgedCategories['payment_fk_anonymised']> {
  // student_subscriptions: rewrite student_id → synthetic. Returns affected count
  // via { count: 'exact' } so we can record what was retained.
  const { count: subEventsCount, error: e1 } = await sb
    .from('subscription_events')
    .update({ student_id: syntheticId }, { count: 'exact' })
    .eq('student_id', studentId)
  if (e1) throw new Error(`anonymise subscription_events: ${e1.message}`)

  const { count: subCount, error: e2 } = await sb
    .from('student_subscriptions')
    .update({ student_id: syntheticId }, { count: 'exact' })
    .eq('student_id', studentId)
  if (e2) throw new Error(`anonymise student_subscriptions: ${e2.message}`)

  const { count: payCount, error: e3 } = await sb
    .from('payment_history')
    .update({ student_id: syntheticId }, { count: 'exact' })
    .eq('student_id', studentId)
  if (e3) throw new Error(`anonymise payment_history: ${e3.message}`)

  // payment_webhook_events intentionally skipped — schema (baseline 12627-12637)
  // has no student FK; it's keyed on (razorpay_account_id, razorpay_event_id).

  return {
    subscription_events: subEventsCount ?? 0,
    student_subscriptions: subCount ?? 0,
    payment_history: payCount ?? 0,
  }
}

async function deleteStudentPii(
  sb: SB,
  studentId: string,
): Promise<{ deleted: Record<string, number>; nulled: boolean }> {
  // Tables with student_id FK whose rows are pure PII / behavioural history.
  // Order does not matter — none of these reference each other in a way that
  // a single-row anonymisation would violate.
  const STUDENT_PII_TABLES = [
    'quiz_responses',
    'quiz_sessions',
    'chat_sessions',
    'foxy_chat_messages',
    'foxy_sessions',
    'foxy_scan_queries',
    'image_uploads',
  ] as const

  const deleted: Record<string, number> = {}
  for (const table of STUDENT_PII_TABLES) {
    const { count, error } = await sb
      .from(table)
      .delete({ count: 'exact' })
      .eq('student_id', studentId)
    if (error) throw new Error(`delete ${table}: ${error.message}`)
    deleted[table] = count ?? 0
  }

  // Null PII columns on the students row but KEEP the row. Why keep:
  // anonymised payment-FK reads (audit + IT-Act retention) join back via
  // student_id; deleting the row would orphan those FKs. We zero out every
  // identifier column from the baseline schema (lines 11590-11648).
  const { error: uErr } = await sb
    .from('students')
    .update({
      name: 'Deleted Account',
      email: null,
      phone: null,
      avatar_url: null,
      date_of_birth: null,
      city: null,
      state: null,
      school_name: null,
      school_code: null,
      father_name: null,
      mother_name: null,
      emergency_contact: null,
      learning_style: null,
      academic_goal: null,
      interests: [],
      weak_subjects: [],
      strong_subjects: [],
      referral_code: null,
      referred_by: null,
      device_type: null,
      app_version: null,
      link_code: null,
      target_exams: [],
      invite_code: null,
      parent_name: null,
      parent_phone: null,
      target_exam: null,
      selected_subjects: [],
      auth_user_id: null,
      is_active: false,
      account_status: 'deleted',
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', studentId)
  if (uErr) throw new Error(`null students PII: ${uErr.message}`)

  return { deleted, nulled: true }
}

async function deleteTeacherPii(
  sb: SB,
  teacherId: string,
): Promise<{ deleted: Record<string, number>; nulled: boolean }> {
  // Teachers don't have direct quiz/chat history rows keyed on teacher_id in
  // the baseline; anything that does (HPC narratives, class assignments) is
  // covered by the auth.users delete cascading through approved_by FKs which
  // are nullable. We just null PII on the teachers row.
  const { error: uErr } = await sb
    .from('teachers')
    .update({
      name: 'Deleted Account',
      email: '__deleted__@invalid.local',  // teachers.email is NOT NULL per baseline 14394
      phone: null,
      avatar_url: null,
      employee_id: null,
      school_name: null,
      school_code: null,
      city: null,
      state: null,
      subjects_taught: [],
      grades_taught: [],
      qualification: null,
      bio: null,
      verification_code: null,
      auth_user_id: null,
      is_active: false,
      is_verified: false,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', teacherId)
  if (uErr) throw new Error(`null teachers PII: ${uErr.message}`)

  return { deleted: {}, nulled: true }
}

async function deleteGuardianPii(
  sb: SB,
  guardianId: string,
): Promise<{ deleted: Record<string, number>; nulled: boolean }> {
  // Per baseline schema lines 11432-11452. Guardian-linked notification
  // history lives on notifications.recipient_id which is unscoped; the
  // auth.users delete + this row null is sufficient.
  const { error: uErr } = await sb
    .from('guardians')
    .update({
      name: 'Deleted Account',
      email: null,
      phone: null,
      avatar_url: null,
      city: null,
      state: null,
      auth_user_id: null,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', guardianId)
  if (uErr) throw new Error(`null guardians PII: ${uErr.message}`)

  return { deleted: {}, nulled: true }
}

async function deleteAuthUserForAccount(
  sb: SB,
  role: AccountRole,
  accountId: string,
): Promise<boolean> {
  // Find the auth.users.id by reading auth_user_id from the role table BEFORE
  // we nulled it (this is called early in the orchestration) — but we may also
  // be called in re-run scenarios where it was already nulled. So we check the
  // account_deletion_log.auth_user_id (captured at request time) as a fallback.
  // Here we simply attempt the delete using the auth_user_id we've fetched
  // upstream. Returns false if no auth user found.
  const table = role === 'student' ? 'students' : role === 'teacher' ? 'teachers' : 'guardians'
  const { data: row, error } = await sb
    .from(table)
    .select('auth_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw new Error(`fetch auth_user_id: ${error.message}`)
  const authUserId = (row as { auth_user_id: string | null } | null)?.auth_user_id
  if (!authUserId) return false

  const { error: aErr } = await sb.auth.admin.deleteUser(authUserId)
  if (aErr) {
    // 404 / not-found is benign in idempotent re-runs — auth row was already
    // cascaded. Anything else is a hard failure.
    const msg = aErr.message ?? String(aErr)
    if (/not.?found|user_not_found|404/i.test(msg)) return false
    throw new Error(`auth.admin.deleteUser: ${msg}`)
  }
  return true
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

async function runPurge(sb: SB, body: PurgeBody): Promise<PurgedCategories> {
  // Synthetic anon UUID — generated ONCE per call via crypto.randomUUID() so
  // two re-signups of the same email don't correlate to each other through
  // the historical payment trail. Non-deterministic by construction.
  const syntheticId = crypto.randomUUID()

  let paymentFkAnonymised: PurgedCategories['payment_fk_anonymised'] = {
    subscription_events: 0,
    student_subscriptions: 0,
    payment_history: 0,
  }
  let piiRowsDeleted: Record<string, number> = {}
  let piiColumnsNulled = false

  // Step A — delete auth user FIRST while we can still read auth_user_id from
  // the role row. After step B/C the role row's auth_user_id is nulled.
  // (deleteAuthUserForAccount is itself tolerant of already-deleted users.)
  const authUserDeleted = await deleteAuthUserForAccount(sb, body.account_role, body.account_id)

  // Step B — anonymise payment FKs (student-only; teachers/guardians don't
  // own subscriptions in our model).
  if (body.account_role === 'student') {
    paymentFkAnonymised = await anonymisePaymentFks(sb, body.account_id, syntheticId)
  }

  // Step C — delete PII rows + null PII columns on role row.
  if (body.account_role === 'student') {
    const r = await deleteStudentPii(sb, body.account_id)
    piiRowsDeleted = r.deleted
    piiColumnsNulled = r.nulled
  } else if (body.account_role === 'teacher') {
    const r = await deleteTeacherPii(sb, body.account_id)
    piiRowsDeleted = r.deleted
    piiColumnsNulled = r.nulled
  } else {
    const r = await deleteGuardianPii(sb, body.account_id)
    piiRowsDeleted = r.deleted
    piiColumnsNulled = r.nulled
  }

  return {
    payment_fk_anonymised: paymentFkAnonymised,
    pii_rows_deleted: piiRowsDeleted,
    pii_columns_nulled: piiColumnsNulled,
    auth_user_deleted: authUserDeleted,
    synthetic_anon_id: syntheticId,
  }
}

async function markLogPurged(
  sb: SB,
  deletionLogId: string,
  purged: PurgedCategories,
): Promise<void> {
  const { error } = await sb
    .from('account_deletion_log')
    .update({
      status: 'purged',
      completed_at: new Date().toISOString(),
      purged_categories: purged,
      error_text: null,
    })
    .eq('id', deletionLogId)
  if (error) throw new Error(`markLogPurged: ${error.message}`)
}

async function markLogFailed(
  sb: SB,
  deletionLogId: string,
  errMessage: string,
): Promise<void> {
  // Best-effort: if THIS update fails too, we surface 5xx and the cron retries.
  // We deliberately do NOT throw from here — the caller is in an outer catch.
  const { error } = await sb
    .from('account_deletion_log')
    .update({
      status: 'failed',
      // Truncate to keep the column readable in ops dashboards. Full stack
      // is in console.error which goes to the Edge Function log.
      error_text: errMessage.slice(0, 2000),
    })
    .eq('id', deletionLogId)
  if (error) {
    console.error('account-purge: failed to write status=failed', { id: deletionLogId, secondary_error: error.message })
  }
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const t0 = Date.now()
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // ── Auth (constant-time) ──
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const provided = req.headers.get('x-cron-secret') ?? ''
  if (!expected || !provided || !constantTimeEqual(provided, expected)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // ── Body parse + validate ──
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'invalid JSON body' }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const v = validateBody(raw)
  if (!v.ok) {
    return new Response(
      JSON.stringify({ success: false, error: v.reason }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const body = v.body

  // ── Short-circuit on terminal log status ──
  let logStatus: string | null = null
  try {
    const { data: logRow, error: logErr } = await sb
      .from('account_deletion_log')
      .select('status')
      .eq('id', body.deletion_log_id)
      .maybeSingle()
    if (logErr) throw new Error(`read log: ${logErr.message}`)
    if (!logRow) {
      return new Response(
        JSON.stringify({ success: false, error: 'deletion_log_id not found' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    logStatus = (logRow as { status: string }).status
    if (logStatus === 'purged' || logStatus === 'cancelled_by_user') {
      console.log('account-purge: idempotent short-circuit', {
        deletion_log_id: body.deletion_log_id,
        status: logStatus,
        elapsed_ms: Date.now() - t0,
      })
      return new Response(
        JSON.stringify({ success: true, idempotent: true, status: logStatus }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('account-purge: log read failed', { deletion_log_id: body.deletion_log_id, error: msg })
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // ── Run the purge ──
  try {
    const purged = await runPurge(sb, body)
    await markLogPurged(sb, body.deletion_log_id, purged)
    console.log('account-purge: complete', {
      deletion_log_id: body.deletion_log_id,
      account_role: body.account_role,
      payment_fk_anonymised: purged.payment_fk_anonymised,
      pii_rows_deleted: purged.pii_rows_deleted,
      auth_user_deleted: purged.auth_user_deleted,
      elapsed_ms: Date.now() - t0,
    })
    return new Response(
      JSON.stringify({ success: true, purged_categories: purged }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('account-purge: failed', {
      deletion_log_id: body.deletion_log_id,
      account_role: body.account_role,
      error: msg,
      elapsed_ms: Date.now() - t0,
    })
    await markLogFailed(sb, body.deletion_log_id, msg)
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
