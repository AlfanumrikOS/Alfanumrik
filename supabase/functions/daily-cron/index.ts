// daily-cron v24
// Fix: CRON_SECRET env-var fallback to DB RPC; corrected column names:
//   last_session_at (not last_activity_at), students.grade join, no student_id
//   on notifications, task_queue uses completed_at/created_at (no updated_at).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from './_shared/cors.ts'

async function resetMissedStreaks(supabase: ReturnType<typeof createClient>): Promise<number> {
  const yesterdayStart = new Date()
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)
  yesterdayStart.setUTCHours(0, 0, 0, 0)
  const { data: profiles, error } = await supabase
    .from('student_learning_profiles')
    .select('student_id, subject, streak_days, last_session_at')
    .gt('streak_days', 0)
    .lt('last_session_at', yesterdayStart.toISOString())
  if (error) throw new Error(`resetMissedStreaks: ${error.message}`)
  if (!profiles || profiles.length === 0) return 0
  await Promise.all(
    profiles.map((p: { student_id: string; subject: string }) =>
      supabase.from('student_learning_profiles')
        .update({ streak_days: 0, updated_at: new Date().toISOString() })
        .eq('student_id', p.student_id)
        .eq('subject', p.subject)
    )
  )
  return new Set(profiles.map((p: { student_id: string }) => p.student_id)).size
}

async function recalculateLeaderboards(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data: students, error } = await supabase
    .from('students').select('id, grade, xp_total').eq('is_active', true).is('deleted_at', null)
  if (error) throw new Error(`recalculateLeaderboards: ${error.message}`)
  if (!students || students.length === 0) return 0
  const gradeMap = new Map<string, Array<{ id: string; xp_total: number }>>()
  for (const s of students as { id: string; grade: string; xp_total: number }[]) {
    const grade = s.grade ?? 'unknown'
    const arr = gradeMap.get(grade) ?? []
    arr.push({ id: s.id, xp_total: s.xp_total ?? 0 })
    gradeMap.set(grade, arr)
  }
  const now = new Date().toISOString()
  const entries: { student_id: string; grade: string; total_xp: number; rank: number; updated_at: string }[] = []
  for (const [grade, list] of gradeMap.entries()) {
    list.sort((a, b) => b.xp_total - a.xp_total)
    list.forEach((s, idx) => entries.push({ student_id: s.id, grade, total_xp: s.xp_total, rank: idx + 1, updated_at: now }))
  }
  if (entries.length === 0) return 0
  const { error: upsertErr } = await supabase.from('leaderboard_snapshots').upsert(entries, { onConflict: 'student_id' })
  if (upsertErr) throw new Error(`recalculateLeaderboards upsert: ${upsertErr.message}`)
  return entries.length
}

async function generateParentDigests(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data: links, error: linksErr } = await supabase
    .from('guardian_student_links').select('guardian_id, student_id').in('status', ['approved', 'active'])
  if (linksErr) throw new Error(`generateParentDigests: ${linksErr.message}`)
  if (!links || links.length === 0) return 0
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  yesterday.setUTCHours(0, 0, 0, 0)
  const notifications: Record<string, unknown>[] = []
  for (const link of links as { guardian_id: string; student_id: string }[]) {
    const { student_id, guardian_id } = link
    const { data: sessions } = await supabase
      .from('quiz_sessions').select('id, subject, score_percent, xp_earned')
      .eq('student_id', student_id).eq('is_completed', true).gte('created_at', yesterday.toISOString())
    const list = (sessions ?? []) as { subject: string; score_percent: number; xp_earned: number }[]
    const base = { recipient_type: 'guardian', recipient_id: guardian_id, is_read: false, created_at: new Date().toISOString() }
    if (list.length === 0) {
      const body = 'Your child did not complete any quizzes yesterday.'
      notifications.push({ ...base, type: 'parent_digest_no_activity', title: 'No study activity yesterday', message: body, body, data: { quizzes: 0, student_id } })
    } else {
      const totalXp  = list.reduce((s, q) => s + (q.xp_earned ?? 0), 0)
      const avgScore = Math.round(list.reduce((s, q) => s + (q.score_percent ?? 0), 0) / list.length)
      const subjects = [...new Set(list.map((q) => q.subject))].join(', ')
      const body = `Subjects: ${subjects}. Avg score: ${avgScore}%. XP: +${totalXp}.`
      notifications.push({ ...base, type: 'parent_digest', title: `Yesterday: ${list.length} quiz${list.length > 1 ? 'zes' : ''} completed`, message: body, body, data: { quizzes: list.length, avg_score: avgScore, total_xp: totalXp, subjects, student_id } })
    }
  }
  if (notifications.length > 0) {
    const { error: insertErr } = await supabase.from('notifications').insert(notifications)
    if (insertErr) throw new Error(`generateParentDigests insert: ${insertErr.message}`)
  }
  return notifications.length
}

async function cleanupTaskQueue(supabase: ReturnType<typeof createClient>): Promise<number> {
  const sevenDaysAgo  = new Date(Date.now() -  7 * 86_400_000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { count: c1, error: e1 } = await supabase.from('task_queue').delete({ count: 'exact' }).eq('status', 'completed').lt('completed_at', sevenDaysAgo)
  if (e1) throw new Error(`cleanupTaskQueue completed: ${e1.message}`)
  const { count: c2, error: e2 } = await supabase.from('task_queue').delete({ count: 'exact' }).eq('status', 'failed').lt('created_at', thirtyDaysAgo)
  if (e2) throw new Error(`cleanupTaskQueue failed: ${e2.message}`)
  return (c1 ?? 0) + (c2 ?? 0)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const startTime = Date.now()
  const supabase  = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  try {
    let expectedSecret = Deno.env.get('CRON_SECRET') ?? null
    if (!expectedSecret) {
      const { data, error: rpcErr } = await supabase.rpc('get_cron_secret')
      if (rpcErr || !data) {
        console.error('daily-cron: cron secret unavailable:', rpcErr?.message)
        return new Response(JSON.stringify({ error: 'Server misconfiguration: cron secret unavailable' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      expectedSecret = data as string
    }
    if (req.headers.get('x-cron-secret') !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const steps: [string, () => Promise<number>][] = [
      ['streaks_reset',           () => resetMissedStreaks(supabase)],
      ['leaderboard_entries',     () => recalculateLeaderboards(supabase)],
      ['parent_digests_sent',     () => generateParentDigests(supabase)],
      ['task_queue_rows_deleted', () => cleanupTaskQueue(supabase)],
    ]
    const settled = await Promise.allSettled(steps.map(([, fn]) => fn()))
    const results: Record<string, number> = {}
    const errors:  Record<string, string> = {}
    for (let i = 0; i < steps.length; i++) {
      const [name] = steps[i]; const r = settled[i]
      if (r.status === 'fulfilled') results[name] = r.value
      else { const msg = r.reason instanceof Error ? r.reason.message : String(r.reason); errors[name] = msg; console.error(`daily-cron [${name}]:`, msg) }
    }
    const hasErrors = Object.keys(errors).length > 0
    return new Response(JSON.stringify({ run_at: new Date().toISOString(), elapsed_ms: Date.now() - startTime, results, ...(hasErrors ? { errors } : {}) }), { status: hasErrors ? 207 : 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('daily-cron fatal:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
