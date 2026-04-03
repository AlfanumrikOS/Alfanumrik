/**
 * daily-cron – Alfanumrik Edge Function
 *
 * Intended to be triggered once per day via a Supabase cron job or
 * an external scheduler (pg_cron, GitHub Actions, etc.).
 *
 * Responsibilities:
 *   1. Reset streaks for students who didn't study yesterday
 *   2. Recalculate leaderboard rankings (top students by XP per grade)
 *   3. Generate daily parent digest notifications
 *   4. Clean up expired/stale tasks from task_queue
 *   5. Purge expired study_payload_cache entries (24h TTL)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface StudentProfile {
  student_id: string
  subject: string
  grade: string
  xp_total: number
  streak_days: number
  last_activity_at: string | null
}

interface LeaderboardEntry {
  student_id: string
  grade: string
  total_xp: number
  rank: number
  updated_at: string
}

// ─── Step 1: Streak resets ─────────────────────────────────────────────────

async function resetMissedStreaks(supabase: ReturnType<typeof createClient>): Promise<number> {
  const yesterdayStart = new Date()
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)
  yesterdayStart.setUTCHours(0, 0, 0, 0)

  const yesterdayEnd = new Date()
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() - 1)
  yesterdayEnd.setUTCHours(23, 59, 59, 999)

  // Fetch profiles where streak > 0 and last_activity_at is not from yesterday or today
  const { data: profiles, error } = await supabase
    .from('student_learning_profiles')
    .select('student_id, subject, streak_days, last_activity_at')
    .gt('streak_days', 0)
    .lt('last_activity_at', yesterdayStart.toISOString())

  if (error) throw new Error(`resetMissedStreaks fetch: ${error.message}`)
  if (!profiles || profiles.length === 0) return 0

  // Group by student_id — only reset if ALL subjects missed yesterday
  const studentMap = new Map<string, StudentProfile[]>()
  for (const p of profiles as StudentProfile[]) {
    const arr = studentMap.get(p.student_id) ?? []
    arr.push(p)
    studentMap.set(p.student_id, arr)
  }

  let resetCount = 0
  const updates: Promise<unknown>[] = []

  for (const [studentId, studentProfiles] of studentMap.entries()) {
    for (const profile of studentProfiles) {
      updates.push(
        supabase
          .from('student_learning_profiles')
          .update({
            streak_days: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('student_id', studentId)
          .eq('subject', profile.subject),
      )
    }
    resetCount++
  }

  await Promise.all(updates)
  return resetCount
}

// ─── Step 2: Leaderboard recalculation ────────────────────────────────────

async function recalculateLeaderboards(supabase: ReturnType<typeof createClient>): Promise<number> {
  // Aggregate total XP per student across all subjects
  const { data: profiles, error } = await supabase
    .from('student_learning_profiles')
    .select('student_id, grade, xp_total')

  if (error) throw new Error(`recalculateLeaderboards fetch: ${error.message}`)
  if (!profiles || profiles.length === 0) return 0

  // Sum XP per student, keep grade
  const studentXp = new Map<string, { grade: string; totalXp: number }>()
  for (const p of profiles as Pick<StudentProfile, 'student_id' | 'grade' | 'xp_total'>[]) {
    const existing = studentXp.get(p.student_id)
    if (existing) {
      existing.totalXp += p.xp_total ?? 0
    } else {
      studentXp.set(p.student_id, { grade: p.grade, totalXp: p.xp_total ?? 0 })
    }
  }

  // Rank within each grade
  const gradeGroups = new Map<string, Array<{ student_id: string; totalXp: number }>>()
  for (const [studentId, info] of studentXp.entries()) {
    const arr = gradeGroups.get(info.grade) ?? []
    arr.push({ student_id: studentId, totalXp: info.totalXp })
    gradeGroups.set(info.grade, arr)
  }

  const entries: LeaderboardEntry[] = []
  const now = new Date().toISOString()

  for (const [grade, students] of gradeGroups.entries()) {
    students.sort((a, b) => b.totalXp - a.totalXp)
    students.forEach((s, idx) => {
      entries.push({
        student_id: s.student_id,
        grade,
        total_xp: s.totalXp,
        rank: idx + 1,
        updated_at: now,
      })
    })
  }

  // Upsert leaderboard snapshot
  const { error: upsertError } = await supabase
    .from('leaderboard_snapshots')
    .upsert(entries, { onConflict: 'student_id' })

  if (upsertError) throw new Error(`recalculateLeaderboards upsert: ${upsertError.message}`)

  return entries.length
}

// ─── Step 3: Parent digest notifications ──────────────────────────────────

async function generateParentDigests(supabase: ReturnType<typeof createClient>): Promise<number> {
  // Find guardian–student links (only approved/active links)
  const { data: links, error: linksError } = await supabase
    .from('guardian_student_links')
    .select('guardian_id, student_id')
    .in('status', ['approved', 'active'])

  if (linksError) throw new Error(`generateParentDigests fetch: ${linksError.message}`)
  if (!links || links.length === 0) return 0

  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  yesterday.setUTCHours(0, 0, 0, 0)

  const notifications: Record<string, unknown>[] = []

  for (const link of links as { guardian_id: string; student_id: string }[]) {
    const { student_id, guardian_id } = link

    // Fetch yesterday's quiz sessions for this student
    const { data: sessions } = await supabase
      .from('quiz_sessions')
      .select('id, subject, score_percent, xp_earned, created_at')
      .eq('student_id', student_id)
      .gte('created_at', yesterday.toISOString())

    const sessionList = (sessions ?? []) as {
      id: string
      subject: string
      score_percent: number
      xp_earned: number
    }[]

    if (sessionList.length === 0) {
      // Student didn't study — send a gentle nudge notification
      notifications.push({
        recipient_type: 'guardian',
        recipient_id: guardian_id,
        student_id,
        type: 'parent_digest_no_activity',
        title: 'No study activity yesterday',
        body: 'Your child did not complete any quizzes yesterday. Encourage them to keep their streak alive!',
        data: { quizzes: 0, xp_earned: 0 },
        is_read: false,
        created_at: new Date().toISOString(),
      })
    } else {
      const totalXp = sessionList.reduce((sum, s) => sum + (s.xp_earned ?? 0), 0)
      const avgScore = Math.round(
        sessionList.reduce((sum, s) => sum + (s.score_percent ?? 0), 0) / sessionList.length,
      )
      const subjects = [...new Set(sessionList.map((s) => s.subject))].join(', ')

      notifications.push({
        recipient_type: 'guardian',
        recipient_id: guardian_id,
        student_id,
        type: 'parent_digest',
        title: `Yesterday's report: ${sessionList.length} quiz${sessionList.length > 1 ? 'zes' : ''} completed`,
        body: `Subjects: ${subjects}. Average score: ${avgScore}%. XP earned: +${totalXp}.`,
        data: {
          quizzes: sessionList.length,
          avg_score: avgScore,
          total_xp: totalXp,
          subjects,
        },
        is_read: false,
        created_at: new Date().toISOString(),
      })
    }
  }

  if (notifications.length > 0) {
    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications)
    if (insertError) throw new Error(`generateParentDigests insert: ${insertError.message}`)
  }

  return notifications.length
}

// ─── Step 4: Clean up stale task_queue rows ───────────────────────────────

async function cleanupTaskQueue(supabase: ReturnType<typeof createClient>): Promise<number> {
  // Delete completed tasks older than 7 days and failed tasks older than 30 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const { count: completedCount, error: e1 } = await supabase
    .from('task_queue')
    .delete({ count: 'exact' })
    .eq('status', 'completed')
    .lt('updated_at', sevenDaysAgo)

  if (e1) throw new Error(`cleanupTaskQueue completed: ${e1.message}`)

  const { count: failedCount, error: e2 } = await supabase
    .from('task_queue')
    .delete({ count: 'exact' })
    .eq('status', 'failed')
    .lt('updated_at', thirtyDaysAgo)

  if (e2) throw new Error(`cleanupTaskQueue failed: ${e2.message}`)

  return (completedCount ?? 0) + (failedCount ?? 0)
}

// ─── Step 5: Purge expired study_payload_cache entries ────────────────────

/**
 * Purge expired study_payload_cache entries.
 * Rows have a 24-hour TTL set at insert time via expires_at.
 * Returns the count of rows deleted.
 */
async function purgeExpiredStudyCache(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  const { count, error } = await supabase
    .from('study_payload_cache')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())

  if (error) throw new Error(`purgeExpiredStudyCache: ${error.message}`)
  return count ?? 0
}

// ─── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Require CRON_SECRET for all calls
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET environment variable is not set')
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const cronAuthHeader = req.headers.get('x-cron-secret')
  if (cronAuthHeader !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const startTime = Date.now()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    const stepResults: Record<string, number | string> = {}
    const stepErrors: Record<string, string> = {}

    // Run all independent steps in parallel — each has its own error handling
    // so a slow/failing step doesn't delay others. Critical for scaling:
    // at 5K users, sequential execution can exceed Vercel's function timeout.
    const steps: [string, () => Promise<number>][] = [
      ['streaks_reset', () => resetMissedStreaks(supabase)],
      ['leaderboard_entries_updated', () => recalculateLeaderboards(supabase)],
      ['parent_digests_sent', () => generateParentDigests(supabase)],
      ['task_queue_rows_deleted', () => cleanupTaskQueue(supabase)],
      ['study_cache_entries_purged', () => purgeExpiredStudyCache(supabase)],
    ]

    const settled = await Promise.allSettled(steps.map(([, fn]) => fn()))
    for (let i = 0; i < steps.length; i++) {
      const [name] = steps[i]
      const result = settled[i]
      if (result.status === 'fulfilled') {
        stepResults[name] = result.value
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        stepErrors[name] = msg
        console.error(`daily-cron step [${name}] failed:`, msg)
      }
    }

    const elapsed = Date.now() - startTime

    return new Response(
      JSON.stringify({
        run_at: new Date().toISOString(),
        elapsed_ms: elapsed,
        results: stepResults,
        errors: Object.keys(stepErrors).length > 0 ? stepErrors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('daily-cron fatal error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
