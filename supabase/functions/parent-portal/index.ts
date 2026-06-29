/**
 * parent-portal — Supabase Edge Function
 *
 * Serves the parent portal pages with data about linked children.
 * Actions:
 *   - parent_login: Authenticate parent via link code, return guardian + student
 *   - get_child_dashboard: Return comprehensive child stats for dashboard + reports
 *   - get_tips: Return parenting tips based on child data
 *   - get_children: Return all linked children for a guardian
 *   - get_monthly_report: Return monthly report data for a child
 */

function logDeprecatedEdgeFunctionHit() {
  console.warn('api_deprecated_edge_function_hit', { workflow: 'parent', route: 'supabase/functions/parent-portal/index.ts', canonical_route: '/api/v2/parent/children or /api/v2/parent/glance', compatibility_type: 'compatibility', metric: 'api_deprecated_route_hit' })
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { isValidLinkCode } from '../_shared/link-code.ts'
import { createDurableRateLimiter } from '../_shared/durable-rate-limiter.ts'
// P12/P13: never surface stale/invalid subject data to a parent; see
// docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2
// validateSubjectRpc is per-subject; for the list filter we call the RPC
// directly and intersect with selected_subjects.

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function getServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Date helpers — IST bucketing ─────────────────────────────────────────
//
// All Indian users live in IST (UTC+5:30). The CBSE academic day is an IST
// day. Bucketing quiz activity by UTC date causes today's early-morning IST
// quizzes (anything before 05:30 IST) to be silently dropped from the
// previous UTC date AND — more visibly — leaves the "today" cell on the
// "This week" chart empty for hours after the user took quizzes (because
// the chart loop builds dateStr from `new Date()` in UTC while quiz
// `created_at` slices are also UTC, so when the IST day rolls over at
// 18:30 UTC the previous day, the chart's "Wed" UTC slot doesn't match
// the user's IST "Wed" until 18:30 UTC).
//
// `istDateString(d)` returns the IST calendar date (YYYY-MM-DD) for a given
// instant, regardless of the host's local timezone. Edge Functions run in
// UTC by default; this is the canonical conversion.
const IST_OFFSET_MIN = 330 // +5h30m
const IST_DAY_LABELS_FROM_SUNDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function istDateString(d: Date): string {
  const istMs = d.getTime() + IST_OFFSET_MIN * 60_000
  return new Date(istMs).toISOString().slice(0, 10)
}

function istDayOfWeekLabel(d: Date): string {
  const istMs = d.getTime() + IST_OFFSET_MIN * 60_000
  return IST_DAY_LABELS_FROM_SUNDAY[new Date(istMs).getUTCDay()]
}

// ─── PP-1: server-side brute-force rate limit for parent_login ──────────────
//
// The legacy `parent_login` action creates an ACTIVE guardian link from a bare
// link-code match (6 uppercase hex chars). Until now it had ONLY a client-side
// lockout (parent-session.ts, sessionStorage) — trivially bypassed by calling
// this Edge Function directly, leaving the link code brute-forceable
// server-side. We add a per-IP limit that mirrors the hardened OTP request
// path's per-IP bound (REQUEST_OTP_IP_LIMIT = 5 / hour; see
// src/app/api/parent/link-code/request-otp/route.ts).
//
// Mechanism: a DURABLE cross-instance limiter (createDurableRateLimiter) backed
// by Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN secrets are present, with a
// transparent in-memory sliding-window fallback (same 5/hour bound) when the
// secrets are absent or Redis errors. Upstash makes the bound durable across
// Edge instances/cold starts (closing the per-instance reset gap); the in-memory
// fallback still bounds rapid enumeration through a warm instance and never fails
// open. See supabase/functions/_shared/durable-rate-limiter.ts.
//
// TODO(PP-1, USER-GATED — DO NOT auto-fix): the deeper fix is to retire the
// link-code-only auto-ACTIVE posture — have parent_login create links as
// `pending` and require student approval (A1) or OTP (A2) before `active`, OR
// fully deprecate parent_login now that /api/v2/parent/* is canonical. That
// changes the CONSENT/LINK MODEL and REQUIRES USER APPROVAL. NOT done here;
// this change ONLY adds the brute-force rate limit + input validation.
const PARENT_LOGIN_IP_LIMIT = 5
const PARENT_LOGIN_IP_WINDOW_MS = 60 * 60 * 1000 // 1 hour — mirrors request-otp per-IP bound
const parentLoginIpLimiter = createDurableRateLimiter(PARENT_LOGIN_IP_LIMIT, PARENT_LOGIN_IP_WINDOW_MS, 'rl:parent_login')

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

// ─── Action Handlers ──────────────────────────────────────────────────────

/**
 * notifyStudentOfPendingLink — best-effort in-app notification telling the
 * STUDENT that a parent has requested to link to their account (PP-1/3 consent,
 * Option B). The student then approves/declines on their dashboard, which is the
 * PRIMARY discovery path; this notification is a secondary surface.
 *
 * Canonical path: the `send_notification` RPC (baseline_from_prod.sql:6950),
 * which sets recipient_id/recipient_type/notification_type/type/title/body/
 * message/data correctly AND has built-in 6-hour dedupe (notification_type +
 * title). We never hand-build the row shape ourselves on the primary path — the
 * notifications table has NO `student_id` column (recipient_id/recipient_type)
 * and `message` is NOT NULL. Bilingual title_hi/body_hi + the opaque link_id
 * ride inside p_data (jsonb). If the RPC is uncallable for any reason we fall
 * back to a direct insert that sets BOTH `message` and `body` (message is
 * NOT NULL) plus recipient_id/recipient_type + type + data.
 *
 * P13: NO PII — generic copy (no guardian name/email/phone); only the opaque
 * link_id rides in data. P15: NEVER throws — a notify hiccup must not fail the
 * parent_login response.
 */
async function notifyStudentOfPendingLink(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string,
  linkId: string
): Promise<void> {
  const titleEn = 'A parent wants to link to your account'
  const bodyEn = 'A parent has requested to link to your account. Approve or decline on your dashboard.'
  const titleHi = 'एक अभिभावक आपके अकाउंट से जुड़ना चाहता है'
  const bodyHi = 'एक अभिभावक ने आपके अकाउंट से जुड़ने का अनुरोध किया है। अपने डैशबोर्ड पर स्वीकार या अस्वीकार करें।'
  // P13: NO guardian PII (name/email/phone) — only the opaque link_id + bilingual copy.
  const data = {
    icon: '🔔',
    link_id: linkId,
    title_hi: titleHi,
    message_hi: bodyHi,
    body_hi: bodyHi,
    trigger: 'parent_link_request',
  }

  try {
    // Primary: canonical RPC. A NULL return (no error) means the 6-hour dedupe
    // suppressed a duplicate — that is success, so we stop here either way.
    const { error: rpcError } = await supabase.rpc('send_notification', {
      p_recipient_id: studentId,
      p_recipient_type: 'student',
      p_type: 'parent_link_request',
      p_title: titleEn,
      p_body: bodyEn,
      p_data: data,
    })
    if (!rpcError) return

    // Fallback: direct insert. MUST set BOTH `message` and `body` (message is
    // NOT NULL in prod) + recipient_id/recipient_type + type + data jsonb.
    const { error: insertError } = await supabase.from('notifications').insert({
      recipient_type: 'student',
      recipient_id: studentId,
      type: 'parent_link_request',
      title: titleEn,
      message: bodyEn,
      body: bodyEn,
      data,
      is_read: false,
      created_at: new Date().toISOString(),
    })
    if (insertError) {
      // P13: log the failure SHAPE only — never the student id, name, or any PII.
      console.warn(JSON.stringify({
        action: 'parent_link_request_notify_failed',
        status: 'warning',
        reason: insertError.message,
      }))
    }
  } catch (err) {
    console.warn(JSON.stringify({
      action: 'parent_link_request_notify_failed',
      status: 'warning',
      reason: err instanceof Error ? err.message : 'unknown',
    }))
  }
}

/**
 * parent_login — Authenticate a parent by link code.
 * Looks up guardian_student_links by link_code on the student,
 * or creates a guardian + link if the code matches a student's invite_code.
 */
async function handleParentLogin(
  body: Record<string, unknown>,
  origin: string | null,
  authUserId: string | null = null,
  clientIp: string = 'unknown'
): Promise<Response> {
  // PP-1: per-IP brute-force rate limit. Apply BEFORE any DB lookup so a noisy
  // IP can neither tax the cluster nor grind link codes server-side.
  const rl = await parentLoginIpLimiter(`parent_login:${clientIp}`)
  if (!rl.allowed) {
    // P13: log limits/counts only — never the IP, link code, or any PII.
    console.warn(JSON.stringify({
      action: 'parent_login_rate_limited',
      status: 'denied',
      limit: PARENT_LOGIN_IP_LIMIT,
      window_ms: PARENT_LOGIN_IP_WINDOW_MS,
      retry_after_ms: rl.retryAfterMs,
    }))
    return jsonResponse(
      { error: 'Too many attempts. Please try again later.' },
      429,
      { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      origin
    )
  }

  const linkCode = String(body.link_code || '').trim().toUpperCase()
  const parentName = String(body.parent_name || 'Parent')

  if (!linkCode) {
    return jsonResponse({ error: 'Link code is required' }, 400, {}, origin)
  }

  // PP-2: strict charset validation BEFORE the code is interpolated into the
  // PostgREST `.or()` filter below (filter-injection guard). A malformed code
  // can never match a real student, so return the SAME generic response as a
  // genuine no-match (no leak about which check failed). Does NOT change the
  // link-code format itself — server-generated codes are [A-Z0-9]{6,8}.
  if (!isValidLinkCode(linkCode)) {
    return jsonResponse(
      { error: 'Invalid link code. Please check and try again.' },
      200,
      {},
      origin
    )
  }

  const supabase = getServiceClient()

  // 1. Try to find a student with this invite_code or link_code
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, name, grade, last_active, invite_code, link_code')
    .or(`invite_code.eq.${linkCode},link_code.eq.${linkCode}`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (studentErr || !student) {
    return jsonResponse(
      { error: 'Invalid link code. Please check and try again.' },
      200,
      {},
      origin
    )
  }

  // 2. Find or create guardian
  let guardianId: string
  let guardianName: string

  // 2a. If caller is authenticated, check for an existing guardian profile by auth_user_id.
  //     This prevents creating orphan guardian rows when the parent already signed up via auth.
  if (authUserId) {
    const { data: authGuardian } = await supabase
      .from('guardians')
      .select('id, name')
      .eq('auth_user_id', authUserId)
      .limit(1)
      .maybeSingle()

    if (authGuardian) {
      guardianId = authGuardian.id
      guardianName = authGuardian.name || parentName

      // PP-1/3 consent (Option B): a link-code match proves the PARENT's intent,
      // not the child's CONSENT. So this creates a PENDING link (not active) that
      // the STUDENT must approve via /api/parent/approve-link before any data is
      // exposed. Look up any existing link (status-agnostic) to decide pending vs
      // already-approved, and to guarantee no duplicate / no downgrade.
      const { data: existingAuthLink } = await supabase
        .from('guardian_student_links')
        .select('id, status')
        .eq('guardian_id', guardianId)
        .eq('student_id', student.id)
        .limit(1)
        .maybeSingle()

      // Already approved/active (re-submit by an already-linked parent): return
      // the existing success/session shape UNCHANGED + status:'approved'. Never
      // downgrade an approved link back to pending.
      if (existingAuthLink && (existingAuthLink.status === 'approved' || existingAuthLink.status === 'active')) {
        return jsonResponse(
          {
            status: 'approved',
            guardian: { id: guardianId, name: guardianName },
            student: { id: student.id, name: student.name, grade: student.grade },
          },
          200,
          {},
          origin
        )
      }

      // Otherwise ensure a PENDING link exists. Insert only when none exists; a
      // re-submit on an existing pending row just returns its id (no duplicate,
      // no second notification).
      let linkId = existingAuthLink?.id || ''
      if (!existingAuthLink) {
        // Defense-in-depth ON CONFLICT DO NOTHING (the (guardian_id, student_id)
        // unique key) so a concurrent double-submit can never 23505 or overwrite
        // an approved row. ignoreDuplicates ⇒ the row is returned ONLY on a
        // genuine new insert, so we notify the student exactly once.
        const { data: insertedLink } = await supabase
          .from('guardian_student_links')
          .upsert(
            {
              guardian_id: guardianId,
              student_id: student.id,
              status: 'pending',
              link_code: linkCode,
              is_verified: false,
              linked_at: new Date().toISOString(),
              initiated_by: 'parent_login',
            },
            { onConflict: 'guardian_id,student_id', ignoreDuplicates: true }
          )
          .select('id')
          .maybeSingle()

        if (insertedLink?.id) {
          linkId = insertedLink.id
          await notifyStudentOfPendingLink(supabase, student.id, insertedLink.id)
        } else {
          // Race: a concurrent submit won the upsert (no row returned). Re-read
          // the existing link id so the response still carries it.
          const { data: raceLink } = await supabase
            .from('guardian_student_links')
            .select('id')
            .eq('guardian_id', guardianId)
            .eq('student_id', student.id)
            .limit(1)
            .maybeSingle()
          linkId = raceLink?.id || ''
        }
      }

      // Pending: NO session, NO grade/stats — only the child's name (so the
      // parent knows the request targets the right child) + the link id (P13).
      return jsonResponse(
        { status: 'pending_approval', student_name: student.name, link_id: linkId },
        200,
        {},
        origin
      )
    }
  }

  // 2b. Check if there's already a guardian linked to this student.
  // Bug fix (2026-04-29) — privacy hardening (P13):
  // Previously, when an UNAUTHENTICATED user entered a link code that another
  // guardian had already claimed, this branch returned that other guardian's
  // id + name, effectively logging the new caller in as that other parent.
  // That allowed anyone in possession of a leaked link code (e.g. a tuition
  // center) to impersonate the real parent and view all of their linked
  // children. We now require the caller to be authenticated (handled by the
  // auth_user_id branch above) before reusing an existing guardian; otherwise
  // we add a NEW guardian + link, scoping the new caller's session to a
  // distinct guardian row.
  const { data: existingLink } = await supabase
    .from('guardian_student_links')
    .select('guardian_id, guardians(id, name, email)')
    .eq('student_id', student.id)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  if (existingLink?.guardian_id && authUserId) {
    // Authenticated caller AND a guardian already exists for this student.
    // The auth_user_id branch above would have matched the caller's own
    // guardian if they had one; falling through to here means they don't.
    // Reuse the existing guardian only when the existing guardian's
    // auth_user_id matches the caller (prevents hijack). Otherwise, create a
    // distinct guardian row below.
    const { data: existingGuardian } = await supabase
      .from('guardians')
      .select('id, name, auth_user_id')
      .eq('id', existingLink.guardian_id)
      .maybeSingle()

    if (existingGuardian && existingGuardian.auth_user_id === authUserId) {
      guardianId = existingGuardian.id
      guardianName = existingGuardian.name || parentName
    } else {
      // Fall through to create-new-guardian path
      guardianId = ''
      guardianName = ''
    }
  } else {
    guardianId = ''
    guardianName = ''
  }

  // Tracks the new pending link id (set below when a brand-new guardian is
  // created). When guardianId was already resolved above, it can only be an
  // existing guardian whose own active/approved link to this student was matched
  // by auth_user_id (the 2a branch would otherwise have handled it) — in that
  // case there is nothing to downgrade and we report 'approved'.
  let pendingLinkId = ''
  let alreadyLinked = false

  if (!guardianId) {
    // Create new guardian and link — set auth_user_id if the caller is authenticated
    const guardianInsert: Record<string, unknown> = { name: parentName, relationship: 'parent' }
    if (authUserId) {
      guardianInsert.auth_user_id = authUserId
    }

    const { data: newGuardian, error: guardianErr } = await supabase
      .from('guardians')
      .insert(guardianInsert)
      .select('id, name')
      .single()

    if (guardianErr || !newGuardian) {
      return jsonResponse(
        { error: 'Could not create parent profile. Please try again.' },
        200,
        {},
        origin
      )
    }

    guardianId = newGuardian.id
    guardianName = newGuardian.name

    // PP-1/3 consent (Option B): create the link as PENDING (not active) — the
    // STUDENT must approve before any data is exposed. Brand-new guardian ⇒ no
    // prior link; ON CONFLICT DO NOTHING is defense-in-depth against a concurrent
    // double-submit. Notify the student exactly once (only on a genuine insert).
    const { data: insertedLink } = await supabase
      .from('guardian_student_links')
      .upsert(
        {
          guardian_id: guardianId,
          student_id: student.id,
          status: 'pending',
          link_code: linkCode,
          is_verified: false,
          linked_at: new Date().toISOString(),
          initiated_by: 'parent_login',
        },
        { onConflict: 'guardian_id,student_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle()

    if (insertedLink?.id) {
      pendingLinkId = insertedLink.id
      await notifyStudentOfPendingLink(supabase, student.id, insertedLink.id)
    } else {
      const { data: raceLink } = await supabase
        .from('guardian_student_links')
        .select('id')
        .eq('guardian_id', guardianId)
        .eq('student_id', student.id)
        .limit(1)
        .maybeSingle()
      pendingLinkId = raceLink?.id || ''
    }
  } else {
    // Existing guardian matched by auth_user_id already holds an active/approved
    // link to this student. No downgrade — report approved (unchanged shape).
    alreadyLinked = true
  }

  if (alreadyLinked) {
    return jsonResponse(
      {
        status: 'approved',
        guardian: { id: guardianId, name: guardianName },
        student: { id: student.id, name: student.name, grade: student.grade },
      },
      200,
      {},
      origin
    )
  }

  // Pending: NO session, NO grade/stats — only the child's name + link id (P13).
  return jsonResponse(
    { status: 'pending_approval', student_name: student.name, link_id: pendingLinkId },
    200,
    {},
    origin
  )
}

/**
 * get_children — Return all linked children for a guardian.
 * Used by the reports page child selector.
 */
async function handleGetChildren(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '')

  if (!guardianId) {
    return jsonResponse({ error: 'guardian_id is required' }, 400, {}, origin)
  }

  const supabase = getServiceClient()

  const { data: links, error } = await supabase
    .from('guardian_student_links')
    .select('student_id, students(id, name, grade)')
    .eq('guardian_id', guardianId)
    .in('status', ['active', 'approved'])

  if (error) {
    return jsonResponse({ error: 'Failed to load children' }, 500, {}, origin)
  }

  const children = (links || [])
    .map((link: Record<string, unknown>) => {
      const s = link.students as unknown as { id: string; name: string; grade: string } | null
      return s ? { id: s.id, name: s.name, grade: s.grade } : null
    })
    .filter(Boolean)

  return jsonResponse({ children }, 200, {}, origin)
}

/**
 * getChildDashboardData — Internal helper that builds dashboard data for a single student.
 * Extracted so it can be reused by both single-child and multi-child flows.
 */
async function getChildDashboardData(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string
): Promise<Record<string, unknown>> {
  // Fetch student basic info
  const { data: student } = await supabase
    .from('students')
    .select('id, name, grade, xp_total, streak_days, last_active, preferred_subject, selected_subjects')
    .eq('id', studentId)
    .single()

  if (!student) {
    return { error: 'Student not found', id: studentId }
  }

  // Fetch learning profiles
  const { data: profiles } = await supabase
    .from('student_learning_profiles')
    .select('subject, xp, streak_days, total_sessions, total_questions_asked, total_questions_answered_correctly, total_time_minutes, last_session_at')
    .eq('student_id', studentId)

  // Fetch quiz sessions
  const { data: quizSessions } = await supabase
    .from('quiz_sessions')
    .select('id, subject, topic_title, score_percent, correct_answers, total_questions, time_taken_seconds, created_at, completed_at, is_completed')
    .eq('student_id', studentId)
    .eq('is_completed', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  // Fetch chat session count
  const { count: totalChats } = await supabase
    .from('chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)

  // Fetch concept mastery
  const { data: conceptMastery } = await supabase
    .from('concept_mastery')
    .select('topic_id, mastery_level, mastery_probability')
    .eq('student_id', studentId)

  const allProfiles = profiles || []
  const allQuizzes = quizSessions || []
  const allConcepts = conceptMastery || []

  const totalXp = student.xp_total || 0
  const streak = student.streak_days || 0
  const totalQuizCount = allQuizzes.length
  const totalMinutes = allProfiles.reduce(
    (sum: number, p: Record<string, unknown>) => sum + (Number(p.total_time_minutes) || 0),
    0
  )
  const avgScore =
    totalQuizCount > 0
      ? Math.round(
          allQuizzes.reduce(
            (sum: number, q: Record<string, unknown>) => sum + (Number(q.score_percent) || 0),
            0
          ) / totalQuizCount
        )
      : 0
  const totalCorrect = allQuizzes.reduce(
    (sum: number, q: Record<string, unknown>) => sum + (Number(q.correct_answers) || 0),
    0
  )
  const totalQuestions = allQuizzes.reduce(
    (sum: number, q: Record<string, unknown>) => sum + (Number(q.total_questions) || 0),
    0
  )
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0

  // Daily activity (last 7 IST days).
  //
  // Bug fix (2026-04-29): bucket by IST calendar date, not UTC.
  //   - The chart cell for "today" is the current IST date.
  //   - A quiz `created_at` (TIMESTAMPTZ, stored as UTC) is matched to its
  //     IST calendar date via istDateString(). This ensures a quiz taken at
  //     10:00 IST today (= 04:30 UTC today) lands in today's cell, and a
  //     quiz at 04:00 IST today (= 22:30 UTC yesterday) also lands in
  //     today's cell — matching how an Indian user perceives "today".
  const nowUtc = new Date()
  const dailyActivity: Array<Record<string, unknown>> = []
  const weekQuizzes: Record<string, unknown>[] = []

  for (let i = 6; i >= 0; i--) {
    // Step back i days in IST. We add the offset once before subtracting
    // days so the "midnight boundary" is the IST one, not UTC's.
    const d = new Date(nowUtc.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = istDateString(d)
    const dayQuizzes = allQuizzes.filter((q: Record<string, unknown>) => {
      const createdAt = q.created_at
      if (!createdAt) return false
      const qDate = new Date(String(createdAt))
      if (Number.isNaN(qDate.getTime())) return false
      return istDateString(qDate) === dateStr
    })
    const quizCount = dayQuizzes.length
    const dayXp = dayQuizzes.reduce(
      (sum: number, q: Record<string, unknown>) => sum + (Number(q.correct_answers) || 0) * 10,
      0
    )
    dailyActivity.push({
      label: istDayOfWeekLabel(d),
      day: dateStr,
      quizzes: quizCount,
      xp: dayXp,
      active: quizCount > 0,
      studyTime: dayQuizzes.reduce(
        (sum: number, q: Record<string, unknown>) => sum + (Number(q.time_taken_seconds) || 0),
        0
      ),
    })
    weekQuizzes.push(...dayQuizzes)
  }

  const weekQuizCount = weekQuizzes.length
  const weekAvgScore =
    weekQuizCount > 0
      ? Math.round(
          weekQuizzes.reduce(
            (sum: number, q: Record<string, unknown>) => sum + (Number(q.score_percent) || 0),
            0
          ) / weekQuizCount
        )
      : 0
  const activeDays = dailyActivity.filter((d) => d.active).length

  // BKT mastery
  const masteryLevels: Record<string, number> = { mastered: 0, proficient: 0, familiar: 0, attempted: 0 }
  for (const c of allConcepts) {
    const level = String(c.mastery_level || '')
    if (level === 'mastered') masteryLevels.mastered++
    else if (level === 'proficient') masteryLevels.proficient++
    else if (level === 'familiar') masteryLevels.familiar++
    else masteryLevels.attempted++
  }

  // Bug fix (2026-04-29): Compute a true mastery percentage from concept_mastery
  // rather than aliasing accuracy. Previously stats.mastery was set to accuracy,
  // so the parent UI showed identical numbers for "Mastery" and "Accuracy" pills,
  // misleading parents about distinct measures.
  // mastery_percent = (mastered + 0.66 * proficient + 0.33 * familiar) / total
  // Same weighting used by the student-facing /progress page.
  const totalConcepts = allConcepts.length
  const masteryPercent = totalConcepts > 0
    ? Math.round(
        ((masteryLevels.mastered + 0.66 * masteryLevels.proficient + 0.33 * masteryLevels.familiar) /
          totalConcepts) *
          100
      )
    : 0

  // Subject data
  const subjectMap = new Map<string, { quizzes: Record<string, unknown>[] }>()
  for (const q of allQuizzes) {
    const subj = String(q.subject || 'Unknown')
    if (!subjectMap.has(subj)) subjectMap.set(subj, { quizzes: [] })
    subjectMap.get(subj)!.quizzes.push(q)
  }

  // P12/P13: never surface stale/invalid subject data to a parent; see
  // docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2
  // Intersect selected_subjects AND quiz-derived subjects with the student's
  // currently-valid subjects (grade-map ∩ plan). Record what was filtered
  // out for ops visibility.
  let allowedCodes: Set<string> | null = null
  const staleSubjects: string[] = []
  try {
    const { data: allowedRows } = await supabase.rpc('get_available_subjects', {
      p_student_id: student.id,
    })
    if (Array.isArray(allowedRows)) {
      allowedCodes = new Set(
        (allowedRows as Array<{ code: string; is_locked: boolean }>)
          .filter((r) => !r.is_locked)
          .map((r) => r.code),
      )
    }
  } catch (subjErr) {
    console.warn(
      'parent-portal: get_available_subjects failed, returning unfiltered data:',
      subjErr instanceof Error ? subjErr.message : String(subjErr),
    )
  }

  const selected = Array.isArray(student.selected_subjects)
    ? (student.selected_subjects as unknown[]).map((s) => String(s))
    : []
  if (allowedCodes) {
    for (const s of selected) {
      if (!allowedCodes.has(s)) staleSubjects.push(s)
    }
    for (const s of Array.from(subjectMap.keys())) {
      if (!allowedCodes.has(s)) {
        staleSubjects.push(s)
        subjectMap.delete(s)
      }
    }
  }

  const subjects = Array.from(subjectMap.keys())

  const subjectProgress = Array.from(subjectMap.entries()).map(([name, data]) => {
    const sqz = data.quizzes
    const percent = sqz.length > 0
      ? Math.round(sqz.reduce((s: number, q: Record<string, unknown>) => s + (Number(q.score_percent) || 0), 0) / sqz.length)
      : 0
    return { name, percent }
  })

  // Insights
  const insights: string[] = []
  if (streak >= 7) insights.push(`Great consistency! ${student.name} has a ${streak}-day study streak.`)
  else if (streak === 0) insights.push(`${student.name} hasn't studied today. A gentle reminder might help!`)
  if (accuracy >= 80) insights.push(`Strong performance with ${accuracy}% accuracy overall.`)
  else if (accuracy > 0 && accuracy < 50) insights.push(`Accuracy is at ${accuracy}%. More practice on weak topics could help.`)

  const todayQuizzes = dailyActivity[dailyActivity.length - 1]?.quizzes || 0
  const todayStudyTime = dailyActivity[dailyActivity.length - 1]?.studyTime || 0

  // De-duplicate stale list
  const dedupedStale = Array.from(new Set(staleSubjects))

  return {
    id: student.id,
    ...(dedupedStale.length > 0 ? { stale_subjects: dedupedStale } : {}),
    student: { name: student.name, grade: student.grade },
    name: student.name,
    grade: student.grade,
    subject: student.preferred_subject || 'Science',
    stats: {
      xp: totalXp,
      streak,
      accuracy,
      totalQuizzes: totalQuizCount,
      minutes: totalMinutes,
      totalChats: totalChats || 0,
      avgScore,
      // Bug fix (2026-04-29): mastery is now derived from concept_mastery, not
      // aliased to accuracy. See computation of masteryPercent above.
      mastery: masteryPercent,
      mastery_percent: masteryPercent,
      avg_score: avgScore,
      total_quizzes: totalQuizCount,
      study_minutes: totalMinutes,
      current_streak: streak,
      today_quizzes: todayQuizzes,
      today_minutes: Math.round(todayStudyTime / 60),
      todayQuizzes,
      todayMinutes: Math.round(todayStudyTime / 60),
    },
    dailyActivity,
    weekSummary: { quizzes: weekQuizCount, avgScore: weekAvgScore, activeDays },
    bktMastery: {
      levels: masteryLevels,
      total: allConcepts.length,
      concepts: allConcepts.map((c: Record<string, unknown>) => ({
        name: String(c.topic_id || '').slice(0, 8),
        level: String(c.mastery_level || 'developing'),
        subject: 'General',
      })),
    },
    activeBursts: [],
    insights,
    subjects,
    subjectProgress,
    recentAchievements: [],
    weekSummary_text: weekQuizCount > 0
      ? `Completed ${weekQuizCount} quizzes with ${weekAvgScore}% average score, active ${activeDays} of 7 days.`
      : '',
    last_active: student.last_active,
    lastActive: student.last_active,
    todayQuizzes,
    todayMinutes: Math.round(todayStudyTime / 60),
    activeToday: todayQuizzes > 0,
  }
}

/**
 * handleGetAllChildrenDashboard — Returns dashboard data for all linked children.
 * Used by parent/children/page.tsx when no student_id is provided.
 */
async function handleGetAllChildrenDashboard(
  guardianId: string,
  origin: string | null
): Promise<Response> {
  const supabase = getServiceClient()

  // Get all linked children
  const { data: links, error } = await supabase
    .from('guardian_student_links')
    .select('student_id')
    .eq('guardian_id', guardianId)
    .in('status', ['active', 'approved'])

  if (error || !links || links.length === 0) {
    return jsonResponse({ students: [] }, 200, {}, origin)
  }

  // Fetch dashboard data for each child
  const students = []
  for (const link of links) {
    const data = await getChildDashboardData(supabase, link.student_id)
    if (!data.error) {
      students.push(data)
    }
  }

  return jsonResponse({ students }, 200, {}, origin)
}

/**
 * get_child_dashboard — Return comprehensive stats for a child.
 * Serves both the main dashboard (parent/page.tsx) and the reports page.
 *
 * Expected response shape (DashboardData / ReportData):
 *   student: { name, grade }
 *   stats: { xp, streak, accuracy, totalQuizzes, minutes, totalChats, avgScore }
 *   dailyActivity: WeeklyDay[]
 *   weekSummary: { quizzes, avgScore, activeDays }
 *   bktMastery: { levels: Record<string, number>, total, concepts: ConceptItem[] }
 *   activeBursts: ActiveBurst[]
 *   insights: string[]
 *   subjects: SubjectData[]
 *   quizHistory: QuizRecord[]
 *   parentTips: TipItem[]
 */
async function handleGetChildDashboard(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '')
  const studentId = String(body.student_id || '')

  if (!guardianId) {
    return jsonResponse(
      { error: 'guardian_id is required' },
      400,
      {},
      origin
    )
  }

  // If no student_id, return dashboard data for ALL linked children
  // (used by parent/children/page.tsx)
  if (!studentId) {
    return await handleGetAllChildrenDashboard(guardianId, origin)
  }

  const supabase = getServiceClient()

  // Verify guardian-student link (P13: data privacy)
  const { data: link } = await supabase
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  if (!link) {
    return jsonResponse(
      { error: 'You do not have access to this child\'s data.' },
      403,
      {},
      origin
    )
  }

  // Use shared helper for all data fetching + computation
  const dashData = await getChildDashboardData(supabase, studentId)

  if (dashData.error) {
    return jsonResponse({ error: dashData.error }, 404, {}, origin)
  }

  // Enrich with quiz history and subject detail for the reports page
  const allQuizzes = await fetchQuizHistory(supabase, studentId)
  const allProfiles = await fetchLearningProfiles(supabase, studentId)
  const subjectsDetailed = buildSubjectDetail(allQuizzes, allProfiles)
  const quizHistory = buildQuizHistory(allQuizzes)
  const stats = dashData.stats as Record<string, unknown>
  const accuracy = Number(stats.accuracy) || 0
  const streak = Number(stats.streak) || 0
  const totalQuizzes = Number(stats.totalQuizzes) || 0
  const weekQuizzes = Number((dashData.weekSummary as Record<string, unknown>)?.quizzes) || 0
  const parentTips = generateTips(accuracy, streak, totalQuizzes, weekQuizzes)

  return jsonResponse(
    {
      ...dashData,
      subjects: subjectsDetailed,
      quizHistory,
      recentQuizzes: quizHistory,
      parentTips,
      tips: parentTips,
    },
    200,
    {},
    origin
  )
}

// ─── Data-fetch helpers (used by handleGetChildDashboard for report-level detail) ──

async function fetchQuizHistory(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string
): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from('quiz_sessions')
    .select('id, subject, topic_title, score_percent, correct_answers, total_questions, time_taken_seconds, created_at, completed_at, is_completed')
    .eq('student_id', studentId)
    .eq('is_completed', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)
  return data || []
}

async function fetchLearningProfiles(
  supabase: ReturnType<typeof getServiceClient>,
  studentId: string
): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from('student_learning_profiles')
    .select('subject, xp, streak_days, total_sessions, total_questions_asked, total_questions_answered_correctly, total_time_minutes, last_session_at')
    .eq('student_id', studentId)
  return data || []
}

function buildSubjectDetail(
  allQuizzes: Record<string, unknown>[],
  allProfiles: Record<string, unknown>[]
): Record<string, unknown>[] {
  const subjectMap = new Map<string, { quizzes: Record<string, unknown>[]; profile: Record<string, unknown> | null }>()

  for (const q of allQuizzes) {
    const subj = String(q.subject || 'Unknown')
    if (!subjectMap.has(subj)) subjectMap.set(subj, { quizzes: [], profile: null })
    subjectMap.get(subj)!.quizzes.push(q)
  }

  for (const p of allProfiles) {
    const subj = String(p.subject || 'Unknown')
    if (!subjectMap.has(subj)) subjectMap.set(subj, { quizzes: [], profile: null })
    subjectMap.get(subj)!.profile = p
  }

  return Array.from(subjectMap.entries()).map(([name, data]) => {
    const sqz = data.quizzes
    const mastery = sqz.length > 0
      ? Math.round(sqz.reduce((s: number, q: Record<string, unknown>) => s + (Number(q.score_percent) || 0), 0) / sqz.length)
      : 0
    const recentScore = sqz.length > 0 ? Math.round(Number(sqz[0].score_percent) || 0) : undefined

    const topicScores = new Map<string, number[]>()
    for (const q of sqz) {
      const topic = String(q.topic_title || '')
      if (!topic) continue
      if (!topicScores.has(topic)) topicScores.set(topic, [])
      topicScores.get(topic)!.push(Number(q.score_percent) || 0)
    }
    const strongTopics: string[] = []
    const weakTopics: string[] = []
    for (const [topic, scores] of topicScores) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      if (avg >= 70) strongTopics.push(topic)
      else if (avg < 50) weakTopics.push(topic)
    }

    return {
      name,
      mastery,
      recentScore,
      topicsMastered: strongTopics.length,
      totalTopics: topicScores.size,
      strongTopics: strongTopics.slice(0, 3),
      weakTopics: weakTopics.slice(0, 3),
    }
  })
}

function buildQuizHistory(allQuizzes: Record<string, unknown>[]): Record<string, unknown>[] {
  return allQuizzes.slice(0, 20).map((q) => ({
    topic: q.topic_title || '',
    subject: q.subject || '',
    score: Math.round(Number(q.score_percent) || 0),
    date: q.created_at || '',
    created_at: q.created_at || '',
    timeSpent: Number(q.time_taken_seconds) || 0,
  }))
}

/**
 * get_tips — Return parenting tips.
 */
async function handleGetTips(
  _body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  // Static tips list — could be personalized in the future based on child data
  const tips = [
    {
      id: 'tip-1',
      title: 'Set a daily study routine',
      description:
        'Even 20 minutes of focused practice daily leads to significant improvement over time. Help your child pick a consistent time each day.',
    },
    {
      id: 'tip-2',
      title: 'Celebrate small wins',
      description:
        'Acknowledge streaks, completed quizzes, and improved scores. Positive reinforcement builds intrinsic motivation.',
    },
    {
      id: 'tip-3',
      title: 'Ask what they learned today',
      description:
        'When your child explains a concept to you, it reinforces their understanding. This technique is called "teach-back" and is highly effective.',
    },
    {
      id: 'tip-4',
      title: 'Focus on progress, not perfection',
      description:
        'A score improving from 40% to 60% is more meaningful than always scoring 90%. Growth mindset is key to long-term success.',
    },
    {
      id: 'tip-5',
      title: 'Use the AI tutor together',
      description:
        'Sit with your child and explore Foxy together. Understanding how the AI tutor works helps you guide their learning better.',
    },
    {
      id: 'tip-6',
      title: 'Review the weekly report',
      description:
        'Check the Reports page weekly to spot trends. Consistent dips in a subject mean your child may need extra support there.',
    },
  ]

  return jsonResponse({ tips }, 200, {}, origin)
}

async function handleGetChildAttendance(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '').trim()
  const studentId  = String(body.student_id  || '').trim()
  const dateFrom   = String(body.date_from   || '').trim()
  const dateTo     = String(body.date_to     || '').trim()

  if (!guardianId || !studentId) {
    return jsonResponse({ error: 'guardian_id and student_id required' }, 400, {}, origin)
  }

  const supabase = getServiceClient()

  // P13: Verify guardian→student link before any attendance read
  const { data: link, error: linkErr } = await supabase
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .maybeSingle()

  if (linkErr || !link) {
    return jsonResponse({ error: 'Access denied' }, 403, {}, origin)
  }

  let query = supabase
    .from('student_attendance')
    .select('id, date, status, period, notes, created_at')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(90)

  if (dateFrom) query = query.gte('date', dateFrom)
  if (dateTo)   query = query.lte('date', dateTo)

  const { data: records, error: fetchErr } = await query

  if (fetchErr) {
    return jsonResponse({ error: 'Failed to fetch attendance' }, 500, {}, origin)
  }

  const list = records ?? []
  const summary = {
    total:   list.length,
    present: list.filter((r: Record<string, unknown>) => r.status === 'present').length,
    absent:  list.filter((r: Record<string, unknown>) => r.status === 'absent').length,
    late:    list.filter((r: Record<string, unknown>) => r.status === 'late').length,
    excused: list.filter((r: Record<string, unknown>) => r.status === 'excused').length,
  }

  return jsonResponse({ records: list, summary }, 200, {}, origin)
}

/**
 * get_monthly_report — Return monthly report data for a child.
 */
async function handleGetMonthlyReport(
  body: Record<string, unknown>,
  origin: string | null
): Promise<Response> {
  const guardianId = String(body.guardian_id || '')
  const studentId = String(body.student_id || '')
  const reportMonth = String(body.report_month || '') // e.g. "2026-03"

  if (!guardianId || !studentId || !reportMonth) {
    return jsonResponse(
      { error: 'guardian_id, student_id, and report_month are required' },
      400,
      {},
      origin
    )
  }

  const supabase = getServiceClient()

  // Verify guardian-student link
  const { data: link } = await supabase
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle()

  if (!link) {
    return jsonResponse(
      { error: 'You do not have access to this child\'s data.' },
      403,
      {},
      origin
    )
  }

  // Parse report_month to first-of-month date
  const monthDate = `${reportMonth}-01`

  // Fetch from monthly_reports table
  const { data: report, error } = await supabase
    .from('monthly_reports')
    .select('*')
    .eq('student_id', studentId)
    .eq('report_month', monthDate)
    .maybeSingle()

  if (error) {
    return jsonResponse({ error: 'Failed to load monthly report' }, 500, {}, origin)
  }

  if (!report) {
    // Try to generate the report if it doesn't exist
    const { data: generated, error: genErr } = await supabase.rpc(
      'generate_monthly_report',
      { p_student_id: studentId, p_month: monthDate }
    )

    if (genErr || !generated) {
      return jsonResponse(
        { error: 'No monthly report available for this period.' },
        200,
        {},
        origin
      )
    }

    // Fetch the newly generated report
    const { data: newReport } = await supabase
      .from('monthly_reports')
      .select('*')
      .eq('student_id', studentId)
      .eq('report_month', monthDate)
      .maybeSingle()

    if (newReport) {
      return jsonResponse(formatMonthlyReport(newReport), 200, {}, origin)
    }

    // Return the RPC result directly if table fetch failed
    return jsonResponse({ report_data: generated }, 200, {}, origin)
  }

  return jsonResponse(formatMonthlyReport(report), 200, {}, origin)
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function formatMonthlyReport(report: Record<string, unknown>) {
  // Parse JSONB fields
  const weakChapters = Array.isArray(report.weak_chapters)
    ? report.weak_chapters
    : parseJsonbArray(report.weak_chapters)
  const strongChapters = Array.isArray(report.strong_chapters)
    ? report.strong_chapters
    : parseJsonbArray(report.strong_chapters)
  const accuracyTrend = Array.isArray(report.accuracy_trend)
    ? report.accuracy_trend
    : parseJsonbArray(report.accuracy_trend)
  const reportData = (report.report_data || {}) as Record<string, unknown>

  return {
    report_data: {
      conceptMasteryPct: Number(report.concept_mastery_pct) || 0,
      retentionScore: Number(report.retention_score) || 0,
      weakChapters,
      strongChapters,
      predictedScore: parsePredictedScore(report.predicted_score),
      syllabusCompletionPct: Number(report.syllabus_completion_pct) || 0,
      accuracyTrend,
      timeEfficiency: Number(report.time_efficiency) || 0,
      studyConsistencyPct: Number(report.study_consistency_pct) || 0,
      totalStudyMinutes: Number(report.total_study_minutes) || 0,
      totalQuestionsAttempted: Number(report.total_questions_attempted) || 0,
      improvementAreas: (reportData.improvementAreas as string[]) || [],
      achievements: (reportData.achievements as string[]) || [],
    },
  }
}

function parseJsonbArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function parsePredictedScore(val: unknown): number | string {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const num = Number(val)
    return isNaN(num) ? val : num
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    // predicted_score is stored as JSONB, might be { score: N } or just N
    if ('score' in obj) return Number(obj.score) || '--'
    if ('value' in obj) return Number(obj.value) || '--'
  }
  return '--'
}

function generateTips(
  accuracy: number,
  streak: number,
  totalQuizzes: number,
  weekQuizzes: number
): Array<{ id: string; title: string; description: string; icon?: string }> {
  const tips: Array<{ id: string; title: string; description: string; icon?: string }> = []

  if (accuracy < 50 && totalQuizzes > 0) {
    tips.push({
      id: 'tip-accuracy',
      title: 'Focus on understanding over speed',
      description:
        'Your child might be rushing through questions. Encourage them to read each question carefully and use the explanation feature after wrong answers.',
      icon: '\uD83C\uDFAF',
    })
  }

  if (streak === 0) {
    tips.push({
      id: 'tip-streak',
      title: 'Help restart the study streak',
      description:
        'Even a 5-minute session counts! Suggest your child open the app and do just one quiz to rebuild the streak habit.',
      icon: '\uD83D\uDD25',
    })
  } else if (streak >= 7) {
    tips.push({
      id: 'tip-streak-praise',
      title: 'Celebrate the streak!',
      description:
        `Your child has studied for ${streak} days straight. This consistency is the #1 predictor of academic improvement. Let them know you noticed!`,
      icon: '\uD83C\uDF1F',
    })
  }

  if (weekQuizzes === 0) {
    tips.push({
      id: 'tip-inactive',
      title: 'Encourage regular practice',
      description:
        'No quizzes this week. Try setting a specific "study time" each day — consistency matters more than duration.',
      icon: '\uD83D\uDCDA',
    })
  }

  if (totalQuizzes === 0) {
    tips.push({
      id: 'tip-start',
      title: 'Get started together',
      description:
        'Sit with your child and explore a topic together. Taking the first quiz together can reduce anxiety and build confidence.',
      icon: '\uD83D\uDE80',
    })
  }

  // Always add a general tip
  tips.push({
    id: 'tip-general',
    title: 'Praise effort, not just results',
    description:
      'Research shows that praising hard work ("You practiced so well!") is more effective than praising ability ("You\'re so smart!") in building long-term motivation.',
    icon: '\uD83D\uDCA1',
  })

  return tips
}

// ─── Main Handler ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  logDeprecatedEdgeFunctionHit()
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    const body = await req.json()
    const action = String(body.action || '')

    // P13 enforcement: resolve the caller's auth_user_id from the
    // Authorization Bearer token. The previous version trusted body.auth_user_id
    // and treated spoofing as "harmless" — it isn't, since a spoofed
    // auth_user_id of an EXISTING guardian causes the function to return
    // that guardian's children's data. body.auth_user_id is now ignored.
    //
    // parent_login is allowed to proceed with a JWT but no existing guardian
    // (it's the link/create flow). All other actions require a guardian
    // row keyed by the JWT's user.id, and override body.guardian_id with
    // the JWT-resolved value.
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Missing or invalid Authorization header', 401, origin)
    }
    const token = authHeader.slice(7)
    const supabase = getServiceClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return errorResponse('Invalid or expired token', 401, origin)
    }
    const authUserId = user.id

    if (action === 'parent_login') {
      // Linking flow: guardian row may not yet exist. handleParentLogin
      // already takes authUserId; pass the JWT-verified value + client IP
      // (PP-1 per-IP brute-force rate limit lives inside the handler).
      return await handleParentLogin(body, origin, authUserId, getClientIp(req))
    }

    // For every other action, the caller must already be a registered
    // guardian. Resolve the canonical guardian_id from the JWT, then
    // override body.guardian_id so handlers see the trusted value.
    const { data: guardian } = await supabase
      .from('guardians')
      .select('id')
      .eq('auth_user_id', authUserId)
      .single()
    if (!guardian) {
      return errorResponse('Caller is not a registered guardian', 403, origin)
    }
    body.guardian_id = guardian.id

    switch (action) {
      case 'get_child_dashboard':
        return await handleGetChildDashboard(body, origin)

      case 'get_tips':
        return await handleGetTips(body, origin)

      case 'get_children':
        return await handleGetChildren(body, origin)

      case 'get_monthly_report':
        return await handleGetMonthlyReport(body, origin)

      case 'get_child_attendance':
        return await handleGetChildAttendance(body, origin)

      default:
        return errorResponse(`Unknown action: ${action}`, 400, origin)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return errorResponse(message, 500, origin)
  }
})
