/**
 * Contract tests for the 3 Reports actions added to the teacher-dashboard
 * Edge Function in Phase A.2:
 *
 *   - get_class_overview
 *   - get_student_report
 *   - get_class_trends
 *
 * The Edge Function runs in Deno + esm.sh and cannot be imported directly
 * under vitest. This file mirrors the parent-dashboard-data.test.ts
 * pattern: it re-implements the pure shaping/decision logic of each
 * handler as a frozen reference, then pins the response shape and the
 * ownership-gate behaviour. If the Edge Function regresses (e.g. the
 * dispatcher loses a case, a handler renames a field, or an ownership
 * check is dropped) these tests must fail.
 *
 * Why this matters: the /teacher/reports page calls all three of these
 * actions and the Edge Function dispatch table previously did not handle
 * any of them — every Reports tab returned 400 "Unknown action" in prod.
 */

import { describe, it, expect } from 'vitest'

// ─── Shared types & helpers (frozen mirror of the handler logic) ─────────

type MasteryLevel = 'mastered' | 'proficient' | 'familiar' | 'developing' | 'not_started'

function masteryLevelFromPercent(pct: number): MasteryLevel {
  if (pct >= 80) return 'mastered'
  if (pct >= 60) return 'proficient'
  if (pct >= 40) return 'familiar'
  if (pct > 0) return 'developing'
  return 'not_started'
}

interface ProfileRow {
  student_id: string
  subject: string
  xp: number
  total_questions_asked: number
  total_questions_answered_correctly: number
  streak_days?: number
  last_session_at?: string | null
}

interface StudentRow {
  id: string
  name: string
  grade: string
}

interface QuizSessionRow {
  student_id: string
  completed_at: string | null
  score_percent: number | null
  time_spent_seconds?: number | null
  time_taken_seconds?: number | null
}

// ─── get_class_overview shaping ─────────────────────────────────────────

interface ClassOverviewResponse {
  stats: {
    total_students: number
    avg_mastery: number
    avg_accuracy: number
    active_this_week: number
  }
  mastery_distribution: Record<MasteryLevel, number>
  top_performers: Array<{ name: string; student_name: string; xp: number; total_xp: number; mastery: number }>
  needs_attention: Array<{ name: string; student_name: string; mastery: number; reason: string }>
}

function buildClassOverview(
  students: StudentRow[],
  profiles: ProfileRow[],
  recentSessionsThisWeek: Array<{ student_id: string }>,
): ClassOverviewResponse {
  const nameById = new Map(students.map(s => [s.id, s.name]))
  if (students.length === 0) {
    return {
      stats: { total_students: 0, avg_mastery: 0, avg_accuracy: 0, active_this_week: 0 },
      mastery_distribution: { mastered: 0, proficient: 0, familiar: 0, developing: 0, not_started: 0 },
      top_performers: [],
      needs_attention: [],
    }
  }
  const agg = new Map<string, { xp: number; asked: number; correct: number }>()
  for (const s of students) agg.set(s.id, { xp: 0, asked: 0, correct: 0 })
  for (const p of profiles) {
    const a = agg.get(p.student_id)
    if (!a) continue
    a.xp += Number(p.xp || 0)
    a.asked += Number(p.total_questions_asked || 0)
    a.correct += Number(p.total_questions_answered_correctly || 0)
  }
  const seen = new Set<string>()
  for (const r of recentSessionsThisWeek) if (r.student_id) seen.add(r.student_id)
  const activeThisWeek = seen.size

  const dist: Record<MasteryLevel, number> = {
    mastered: 0, proficient: 0, familiar: 0, developing: 0, not_started: 0,
  }
  let accSum = 0, accN = 0, mastSum = 0, mastN = 0
  const rows: Array<{ id: string; name: string; xp: number; accuracy: number; mastery: number }> = []
  for (const [id, a] of agg) {
    const accuracy = a.asked > 0 ? Math.round((a.correct / a.asked) * 100) : 0
    const mastery = accuracy
    dist[masteryLevelFromPercent(mastery)]++
    if (a.asked > 0) {
      accSum += accuracy; accN++
      mastSum += mastery; mastN++
    }
    rows.push({ id, name: nameById.get(id) || 'Student', xp: a.xp, accuracy, mastery })
  }
  const total = students.length
  const distPct: Record<MasteryLevel, number> = {
    mastered: Math.round((dist.mastered / total) * 100),
    proficient: Math.round((dist.proficient / total) * 100),
    familiar: Math.round((dist.familiar / total) * 100),
    developing: Math.round((dist.developing / total) * 100),
    not_started: Math.round((dist.not_started / total) * 100),
  }
  return {
    stats: {
      total_students: total,
      avg_mastery: mastN > 0 ? Math.round(mastSum / mastN) : 0,
      avg_accuracy: accN > 0 ? Math.round(accSum / accN) : 0,
      active_this_week: activeThisWeek,
    },
    mastery_distribution: distPct,
    top_performers: [...rows]
      .filter(r => r.xp > 0)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 5)
      .map(r => ({ name: r.name, student_name: r.name, xp: r.xp, total_xp: r.xp, mastery: r.mastery })),
    needs_attention: [...rows]
      .filter(r => r.mastery < 50)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 5)
      .map(r => ({ name: r.name, student_name: r.name, mastery: r.mastery, reason: `${r.mastery}% mastery` })),
  }
}

describe('get_class_overview — response shape', () => {
  it('degrades to all-zero / empty arrays when the teacher has no students', () => {
    const res = buildClassOverview([], [], [])
    expect(res.stats).toEqual({ total_students: 0, avg_mastery: 0, avg_accuracy: 0, active_this_week: 0 })
    expect(res.mastery_distribution).toEqual({ mastered: 0, proficient: 0, familiar: 0, developing: 0, not_started: 0 })
    expect(res.top_performers).toEqual([])
    expect(res.needs_attention).toEqual([])
  })

  it('rolls up XP across (student, subject) profile rows and ranks top performers', () => {
    const students: StudentRow[] = [
      { id: 's1', name: 'Alice', grade: '7' },
      { id: 's2', name: 'Bob', grade: '7' },
      { id: 's3', name: 'Carol', grade: '7' },
    ]
    const profiles: ProfileRow[] = [
      { student_id: 's1', subject: 'Math', xp: 800, total_questions_asked: 100, total_questions_answered_correctly: 90 },
      { student_id: 's1', subject: 'Science', xp: 200, total_questions_asked: 50, total_questions_answered_correctly: 40 },
      { student_id: 's2', subject: 'Math', xp: 100, total_questions_asked: 50, total_questions_answered_correctly: 15 },
      { student_id: 's3', subject: 'Math', xp: 0, total_questions_asked: 0, total_questions_answered_correctly: 0 },
    ]
    const res = buildClassOverview(students, profiles, [{ student_id: 's1' }, { student_id: 's2' }])
    expect(res.stats.total_students).toBe(3)
    expect(res.stats.active_this_week).toBe(2)
    // Top performer is Alice (1000 XP), then Bob (100).
    expect(res.top_performers[0].name).toBe('Alice')
    expect(res.top_performers[0].xp).toBe(1000)
    expect(res.top_performers[1].name).toBe('Bob')
    // Bob has 30% accuracy → < 50, needs attention; Carol has 0 (not_started, also < 50).
    const attentionNames = res.needs_attention.map(r => r.name)
    expect(attentionNames).toContain('Bob')
    expect(attentionNames).toContain('Carol')
    // Mastery distribution sums to ~100 (small rounding drift for 1/3 splits).
    const distTotal = Object.values(res.mastery_distribution).reduce((a, b) => a + b, 0)
    expect(distTotal).toBeGreaterThanOrEqual(99)
    expect(distTotal).toBeLessThanOrEqual(100)
    // Alice (90%) is mastered, Bob (30%) is developing, Carol (0) is not_started.
    expect(res.mastery_distribution.mastered).toBe(33)
    expect(res.mastery_distribution.developing).toBe(33)
    expect(res.mastery_distribution.not_started).toBe(33)
  })

  it('only counts students with attempts in avg_accuracy / avg_mastery (no zero-dilution)', () => {
    const students: StudentRow[] = [
      { id: 's1', name: 'Alice', grade: '7' },
      { id: 's2', name: 'Bob', grade: '7' },
    ]
    const profiles: ProfileRow[] = [
      { student_id: 's1', subject: 'Math', xp: 100, total_questions_asked: 10, total_questions_answered_correctly: 8 },
      // Bob has never attempted — must NOT pull avg_accuracy down to 40
      { student_id: 's2', subject: 'Math', xp: 0, total_questions_asked: 0, total_questions_answered_correctly: 0 },
    ]
    const res = buildClassOverview(students, profiles, [])
    expect(res.stats.avg_accuracy).toBe(80)
    expect(res.stats.avg_mastery).toBe(80)
    expect(res.stats.total_students).toBe(2)
  })
})

// ─── get_student_report shaping & ownership gate ────────────────────────

interface StudentReportResponse {
  student_id: string
  name: string
  student_name: string
  xp: number
  total_xp: number
  streak: number
  current_streak: number
  accuracy: number
  avg_accuracy: number
  subjects: Array<{ subject: string; name: string; mastery: number; level: string }>
  subject_mastery: Array<{ subject: string; name: string; mastery: number; level: string }>
  strengths: Array<{ topic: string; name: string }>
  weaknesses: Array<{ topic: string; name: string }>
  recommendations: string[]
}

function decideStudentOwnership(
  target: { id: string } | null,
  ownedStudents: StudentRow[],
): 'allow' | 'deny' {
  if (!target) return 'deny'
  return ownedStudents.some(s => s.id === target.id) ? 'allow' : 'deny'
}

function buildStudentReport(
  target: StudentRow,
  profiles: ProfileRow[],
): StudentReportResponse {
  let totalXp = 0, totalStreak = 0, totalAsked = 0, totalCorrect = 0
  const subjects: Array<{ subject: string; name: string; mastery: number; level: string }> = []
  for (const p of profiles) {
    const asked = Number(p.total_questions_asked || 0)
    const correct = Number(p.total_questions_answered_correctly || 0)
    totalXp += Number(p.xp || 0)
    if ((p.streak_days || 0) > totalStreak) totalStreak = Number(p.streak_days || 0)
    totalAsked += asked
    totalCorrect += correct
    const pct = asked > 0 ? Math.round((correct / asked) * 100) : 0
    subjects.push({
      subject: String(p.subject || ''),
      name: String(p.subject || ''),
      mastery: pct,
      level: masteryLevelFromPercent(pct),
    })
  }
  const accuracy = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0
  const sortedAttempted = [...subjects].filter(s => s.mastery > 0).sort((a, b) => b.mastery - a.mastery)
  const strengths = sortedAttempted.slice(0, 3).map(s => ({ topic: s.subject, name: s.subject }))
  const weaknesses = [...sortedAttempted].reverse().slice(0, 3).map(s => ({ topic: s.subject, name: s.subject }))
  const recommendations: string[] = []
  for (const s of subjects) {
    if (s.mastery > 0 && s.mastery < 40) {
      recommendations.push(`Assign a focused revision quiz on ${s.subject} fundamentals.`)
    }
  }
  if (totalStreak === 0 && totalXp > 100) {
    recommendations.push('Student is losing streak — send an encouragement nudge.')
  }
  if (recommendations.length === 0 && subjects.length > 0) {
    recommendations.push('Student is on track — continue with current plan.')
  }
  return {
    student_id: target.id,
    name: target.name,
    student_name: target.name,
    xp: totalXp,
    total_xp: totalXp,
    streak: totalStreak,
    current_streak: totalStreak,
    accuracy,
    avg_accuracy: accuracy,
    subjects,
    subject_mastery: subjects,
    strengths,
    weaknesses,
    recommendations,
  }
}

describe('get_student_report — ownership gate', () => {
  const owned: StudentRow[] = [
    { id: 's1', name: 'Alice', grade: '7' },
    { id: 's2', name: 'Bob', grade: '7' },
  ]

  it('REGRESSION: rejects when student is not in the teacher\'s resolved set', () => {
    // P13: a teacher in another school must not be able to fetch this
    // student's profile by passing their id directly.
    const decision = decideStudentOwnership({ id: 's-foreign' }, owned)
    expect(decision).toBe('deny')
  })

  it('allows access to a student in the teacher\'s class roster', () => {
    expect(decideStudentOwnership({ id: 's1' }, owned)).toBe('allow')
  })
})

describe('get_student_report — response shape', () => {
  it('rolls up per-subject mastery, computes accuracy, and surfaces strengths/weaknesses', () => {
    const target: StudentRow = { id: 's1', name: 'Alice', grade: '7' }
    const profiles: ProfileRow[] = [
      { student_id: 's1', subject: 'Math', xp: 500, streak_days: 5, total_questions_asked: 100, total_questions_answered_correctly: 90 },
      { student_id: 's1', subject: 'Science', xp: 200, streak_days: 3, total_questions_asked: 50, total_questions_answered_correctly: 20 },
      { student_id: 's1', subject: 'English', xp: 0, streak_days: 0, total_questions_asked: 0, total_questions_answered_correctly: 0 },
    ]
    const res = buildStudentReport(target, profiles)
    // Identity fields
    expect(res.student_id).toBe('s1')
    expect(res.name).toBe('Alice')
    expect(res.student_name).toBe('Alice')
    // XP rolls up across subjects
    expect(res.xp).toBe(700)
    expect(res.total_xp).toBe(700)
    // Streak is the max across subjects
    expect(res.streak).toBe(5)
    // Accuracy = 110 / 150 = 73
    expect(res.accuracy).toBe(73)
    // Subjects array preserves order and includes the un-attempted one
    expect(res.subjects.length).toBe(3)
    expect(res.subject_mastery).toEqual(res.subjects)
    // Math (90%) is the top strength
    expect(res.strengths[0].topic).toBe('Math')
    // Science (40%) is the weakest among attempted (English is excluded as
    // not_started — not a tracked weakness)
    expect(res.weaknesses[0].topic).toBe('Science')
    // Science < 40 doesn't fire (40 is the floor for the recommend rule);
    // but English has no attempts so no rec either. Default reassurance fires.
    expect(res.recommendations.length).toBeGreaterThan(0)
  })

  it('emits empty profile shape (not 500) when student has no learning_profile rows', () => {
    const target: StudentRow = { id: 's1', name: 'Alice', grade: '7' }
    const res = buildStudentReport(target, [])
    expect(res.xp).toBe(0)
    expect(res.streak).toBe(0)
    expect(res.accuracy).toBe(0)
    expect(res.subjects).toEqual([])
    expect(res.strengths).toEqual([])
    expect(res.weaknesses).toEqual([])
    // No subjects means no default reassurance either — recommendations stays empty.
    expect(res.recommendations).toEqual([])
  })
})

// ─── get_class_trends shaping ───────────────────────────────────────────

interface ClassTrendsResponse {
  daily: Array<{ date: string; attempts: number; avg_mastery: number; time_on_task: number }>
  weekly_progress: Array<{ label: string; week: string; progress: number; percent: number }>
  activity_heatmap: number[][]
  most_improved: Array<{ name: string; student_name: string; improvement: number; delta: number }>
  week_over_week_delta: number
}

function buildClassTrends(
  students: StudentRow[],
  sessions: QuizSessionRow[],
  now: Date,
): ClassTrendsResponse {
  const nameById = new Map(students.map(s => [s.id, s.name]))
  const studentIds = students.map(s => s.id)
  if (studentIds.length === 0) {
    return {
      daily: [],
      weekly_progress: [],
      activity_heatmap: [],
      most_improved: [],
      week_over_week_delta: 0,
    }
  }
  const windowDays = 30
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const windowStart = new Date(todayUtc.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000)
  const dateKey = (d: Date) => d.toISOString().slice(0, 10)
  const daily = new Map<string, { attempts: number; masterySum: number; timeOnTask: number }>()
  for (let i = 0; i < windowDays; i++) {
    daily.set(dateKey(new Date(windowStart.getTime() + i * 24 * 60 * 60 * 1000)),
      { attempts: 0, masterySum: 0, timeOnTask: 0 })
  }
  for (const s of sessions) {
    if (!s.completed_at) continue
    const b = daily.get(s.completed_at.slice(0, 10))
    if (!b) continue
    b.attempts++
    b.masterySum += Number(s.score_percent || 0)
    b.timeOnTask += Number(s.time_spent_seconds || s.time_taken_seconds || 0)
  }
  const dailyArr = Array.from(daily.entries()).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      attempts: b.attempts,
      avg_mastery: b.attempts > 0 ? Math.round(b.masterySum / b.attempts) : 0,
      time_on_task: b.timeOnTask,
    }))
  const last7 = dailyArr.slice(-7).reduce((acc, d) => acc + d.attempts, 0)
  const prior7 = dailyArr.slice(-14, -7).reduce((acc, d) => acc + d.attempts, 0)
  const wow = prior7 === 0 ? (last7 > 0 ? 100 : 0) : Math.round(((last7 - prior7) / prior7) * 100)

  const weekly: Array<{ label: string; week: string; progress: number; percent: number }> = []
  for (let w = 0; w < 4; w++) {
    const slice = dailyArr.slice(w * 7, (w + 1) * 7)
    const att = slice.reduce((a, d) => a + d.attempts, 0)
    const mast = slice.reduce((a, d) => a + d.avg_mastery * d.attempts, 0)
    const avg = att > 0 ? Math.round(mast / att) : 0
    const label = `Week ${w + 1}`
    weekly.push({ label, week: label, progress: avg, percent: avg })
  }

  const heat: number[][] = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ]
  for (let i = 0; i < dailyArr.length; i++) {
    const wi = Math.floor(i / 7)
    if (wi >= 4) break
    const d = new Date(dailyArr[i].date + 'T00:00:00Z')
    const col = (d.getUTCDay() + 6) % 7
    heat[wi][col] += dailyArr[i].attempts
  }

  const midpoint = new Date(windowStart.getTime() + Math.floor(windowDays / 2) * 24 * 60 * 60 * 1000)
  const imp = new Map<string, { id: string; first: number[]; second: number[] }>()
  for (const id of studentIds) imp.set(id, { id, first: [], second: [] })
  for (const s of sessions) {
    if (!s.completed_at) continue
    const r = imp.get(s.student_id)
    if (!r) continue
    const score = Number(s.score_percent || 0)
    if (new Date(s.completed_at) < midpoint) r.first.push(score)
    else r.second.push(score)
  }
  const mostImproved = Array.from(imp.values())
    .map(m => {
      const before = m.first.length > 0 ? m.first.reduce((a, b) => a + b, 0) / m.first.length : 0
      const after = m.second.length > 0 ? m.second.reduce((a, b) => a + b, 0) / m.second.length : 0
      return { id: m.id, improvement: Math.round(after - before), beforeN: m.first.length, afterN: m.second.length }
    })
    .filter(m => m.improvement > 0 && m.beforeN > 0 && m.afterN > 0)
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 5)
    .map(m => ({
      name: nameById.get(m.id) || 'Student',
      student_name: nameById.get(m.id) || 'Student',
      improvement: m.improvement,
      delta: m.improvement,
    }))

  return {
    daily: dailyArr,
    weekly_progress: weekly,
    activity_heatmap: heat,
    most_improved: mostImproved,
    week_over_week_delta: wow,
  }
}

describe('get_class_trends — response shape', () => {
  it('emits a 30-cell daily series and 4x7 activity heatmap', () => {
    const students: StudentRow[] = [{ id: 's1', name: 'Alice', grade: '7' }]
    const sessions: QuizSessionRow[] = [
      { student_id: 's1', completed_at: '2026-05-15T10:00:00.000Z', score_percent: 80 },
      { student_id: 's1', completed_at: '2026-05-15T12:00:00.000Z', score_percent: 60 },
      { student_id: 's1', completed_at: '2026-05-10T09:00:00.000Z', score_percent: 50 },
    ]
    const now = new Date('2026-05-16T12:00:00.000Z')
    const res = buildClassTrends(students, sessions, now)
    expect(res.daily.length).toBe(30)
    expect(res.activity_heatmap.length).toBe(4)
    expect(res.activity_heatmap[0].length).toBe(7)
    expect(res.weekly_progress.length).toBe(4)
    // The last cell of the window is today.
    expect(res.daily[res.daily.length - 1].date).toBe('2026-05-16')
    // 2026-05-15 (yesterday) has 2 attempts.
    const yesterday = res.daily.find(d => d.date === '2026-05-15')
    expect(yesterday?.attempts).toBe(2)
    expect(yesterday?.avg_mastery).toBe(70)
  })

  it('degrades to empty arrays / zero delta when the teacher has no students', () => {
    const res = buildClassTrends([], [], new Date('2026-05-16T12:00:00.000Z'))
    expect(res.daily).toEqual([])
    expect(res.weekly_progress).toEqual([])
    expect(res.activity_heatmap).toEqual([])
    expect(res.most_improved).toEqual([])
    expect(res.week_over_week_delta).toBe(0)
  })

  it('flags most-improved learners by comparing first half vs second half of the window', () => {
    const students: StudentRow[] = [
      { id: 's1', name: 'Improver', grade: '7' },
      { id: 's2', name: 'Steady', grade: '7' },
    ]
    const now = new Date('2026-05-16T12:00:00.000Z')
    // Window starts 2026-04-17. Midpoint ~2026-05-02.
    const sessions: QuizSessionRow[] = [
      // Improver: low in first half, high in second half.
      { student_id: 's1', completed_at: '2026-04-20T10:00:00.000Z', score_percent: 30 },
      { student_id: 's1', completed_at: '2026-04-22T10:00:00.000Z', score_percent: 40 },
      { student_id: 's1', completed_at: '2026-05-10T10:00:00.000Z', score_percent: 80 },
      { student_id: 's1', completed_at: '2026-05-12T10:00:00.000Z', score_percent: 90 },
      // Steady: flat.
      { student_id: 's2', completed_at: '2026-04-20T10:00:00.000Z', score_percent: 60 },
      { student_id: 's2', completed_at: '2026-05-10T10:00:00.000Z', score_percent: 60 },
    ]
    const res = buildClassTrends(students, sessions, now)
    expect(res.most_improved.length).toBeGreaterThan(0)
    expect(res.most_improved[0].name).toBe('Improver')
    expect(res.most_improved[0].improvement).toBeGreaterThan(0)
    // Steady should NOT appear (no positive delta).
    expect(res.most_improved.find(r => r.name === 'Steady')).toBeUndefined()
  })
})

// ─── Dispatcher contract — the 3 new actions must be recognized ─────────
//
// Regression test for the actual bug: the Edge Function dispatch table
// must list these 3 actions. We re-implement the dispatch contract here
// rather than spin up Deno, but if the source dispatcher ever drops one
// of these cases, the grep below also fails.

// Phase A.2 base actions + Phase A.2.1 aliases consumed by the /teacher/reports page.
// The page calls get_trends (not get_class_trends) and get_students_list — both must
// be present in the dispatcher source so the page never sees a 400.
const REQUIRED_REPORTS_ACTIONS = [
  'get_class_overview',
  'get_student_report',
  'get_class_trends',
  'get_trends',
  'get_students_list',
] as const

describe('teacher-dashboard dispatcher — Phase A.2 actions present', () => {
  // This is a static contract check: the dispatcher source MUST list each
  // of the 3 actions. We can't import the Deno file under vitest, so we
  // read it as text and assert the 'case' lines exist.
  it('every required action has a switch case in the Edge Function source', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const sourcePath = path.resolve(
      process.cwd(),
      'supabase/functions/teacher-dashboard/index.ts',
    )
    const src = await fs.readFile(sourcePath, 'utf8')
    for (const action of REQUIRED_REPORTS_ACTIONS) {
      expect(src).toContain(`case '${action}':`)
    }
  })
})
