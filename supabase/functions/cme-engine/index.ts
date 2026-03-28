import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Cognitive Mastery Engine (CME)
 *
 * Actions:
 *   get_next_action    — What should the student do next?
 *   record_response    — Student answered a question
 *   get_concept_state  — Current mastery for a subject
 *   get_revision_due   — Concepts due for revision
 *   get_exam_readiness — Exam readiness estimate
 */

// ── Mastery Update ──────────────────────────────────────────────────

function updateMastery(
  state: { mastery_mean: number; mastery_variance: number; retention_half_life: number; total_attempts: number; total_correct: number; streak_current: number; error_count_conceptual: number; error_count_procedural: number; error_count_careless: number },
  correct: boolean,
  questionDifficulty: number,
  responseTimeMs: number,
  expectedTimeMs: number
) {
  const studentAbility = state.mastery_mean * 6 - 3
  const qDiff = (questionDifficulty || 2) - 3 // normalize 1-5 to IRT-ish scale
  const pCorrect = 1 / (1 + Math.exp(-1.7 * (studentAbility - qDiff)))
  const surprise = Math.abs((correct ? 1 : 0) - pCorrect)
  const alpha = state.mastery_variance * 0.5 + 0.05

  let newMastery = state.mastery_mean
  if (correct) {
    newMastery += alpha * (1 - newMastery) * (1 + surprise * 0.3)
  } else {
    newMastery -= alpha * newMastery * (0.5 + surprise * 0.3)
  }
  newMastery = Math.max(0.01, Math.min(0.99, newMastery))

  let newVariance = state.mastery_variance * (1 - 0.1 * (1 + surprise))
  newVariance = Math.max(0.01, newVariance)

  let newHalfLife = state.retention_half_life
  if (correct) {
    newHalfLife = Math.min(newHalfLife * 1.5, 720) // cap at 30 days
  } else {
    newHalfLife = Math.max(newHalfLife * 0.8, 4) // min 4 hours
  }

  // Error classification
  let errorType: string | null = null
  if (!correct) {
    if (responseTimeMs < 5000 && questionDifficulty <= 2) {
      errorType = 'careless'
    } else if (state.mastery_mean < 0.4) {
      errorType = 'conceptual'
    } else {
      errorType = 'procedural'
    }
  }

  const newStreak = correct ? state.streak_current + 1 : 0

  return {
    mastery_mean: newMastery,
    mastery_variance: newVariance,
    retention_half_life: newHalfLife,
    current_retention: newMastery, // just updated, no decay yet
    total_attempts: state.total_attempts + 1,
    total_correct: state.total_correct + (correct ? 1 : 0),
    streak_current: newStreak,
    error_count_conceptual: state.error_count_conceptual + (errorType === 'conceptual' ? 1 : 0),
    error_count_procedural: state.error_count_procedural + (errorType === 'procedural' ? 1 : 0),
    error_count_careless: state.error_count_careless + (errorType === 'careless' ? 1 : 0),
    last_practiced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    errorType,
  }
}

// ── Retention Decay ─────────────────────────────────────────────────

function computeRetention(masteryMean: number, halfLifeHours: number, lastPracticedAt: string | null): number {
  if (!lastPracticedAt) return masteryMean * 0.5 // assume 50% decay if never practiced
  const hoursSince = (Date.now() - new Date(lastPracticedAt).getTime()) / 3600000
  const decayFactor = Math.exp(-0.693 * hoursSince / Math.max(halfLifeHours, 1))
  return masteryMean * decayFactor
}

// ── Next Best Action ────────────────────────────────────────────────

interface ConceptState {
  concept_id: string
  mastery_mean: number
  current_retention: number
  retention_half_life: number
  last_practiced_at: string | null
  error_count_conceptual: number
  total_attempts: number
  max_difficulty_succeeded: number
}

interface TopicInfo {
  id: string
  title: string
  parent_topic_id: string | null
  prerequisite_topic_ids: string[] | null
  difficulty_level: number
  bloom_focus: string
  chapter_number: number | null
  display_order: number
  grade: string
  subject_id: string
}

function selectNextAction(
  states: ConceptState[],
  topics: TopicInfo[],
  subjectId: string,
  grade: string
) {
  const stateMap = new Map(states.map(s => [s.concept_id, s]))

  // Filter topics for this subject+grade
  const relevantTopics = topics
    .filter(t => t.subject_id === subjectId && t.grade === grade)
    .sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0) || (a.display_order || 0) - (b.display_order || 0))

  // Priority 1: Prerequisite gaps
  for (const topic of relevantTopics) {
    const prereqs = topic.prerequisite_topic_ids || []
    for (const prereqId of prereqs) {
      const prereqState = stateMap.get(prereqId)
      if (prereqState) {
        const retention = computeRetention(prereqState.mastery_mean, prereqState.retention_half_life, prereqState.last_practiced_at)
        if (retention < 0.4) {
          const prereqTopic = topics.find(t => t.id === prereqId)
          return {
            type: 'remediate',
            concept_id: prereqId,
            title: prereqTopic?.title || 'Prerequisite',
            reason: 'Prerequisite gap needs remediation before advancing',
            difficulty: Math.max(1, (prereqState.max_difficulty_succeeded || 1)),
          }
        }
      }
    }
  }

  // Priority 2: Concepts with high forgetting risk
  const atRisk = states
    .filter(s => {
      const retention = computeRetention(s.mastery_mean, s.retention_half_life, s.last_practiced_at)
      return retention < 0.5 && s.mastery_mean > 0.4 && s.total_attempts > 0
    })
    .sort((a, b) => {
      const retA = computeRetention(a.mastery_mean, a.retention_half_life, a.last_practiced_at)
      const retB = computeRetention(b.mastery_mean, b.retention_half_life, b.last_practiced_at)
      return retA - retB
    })

  if (atRisk.length > 0) {
    const urgent = atRisk[0]
    const topic = topics.find(t => t.id === urgent.concept_id)
    return {
      type: 'revise',
      concept_id: urgent.concept_id,
      title: topic?.title || 'Review concept',
      reason: 'Previously learned concept fading — revision needed',
      difficulty: urgent.max_difficulty_succeeded || 2,
    }
  }

  // Priority 3: Concepts with repeated conceptual errors
  const errorProne = states
    .filter(s => s.error_count_conceptual >= 3)
    .sort((a, b) => b.error_count_conceptual - a.error_count_conceptual)

  if (errorProne.length > 0) {
    const worst = errorProne[0]
    const topic = topics.find(t => t.id === worst.concept_id)
    return {
      type: 're_teach',
      concept_id: worst.concept_id,
      title: topic?.title || 'Re-learn concept',
      reason: 'Repeated conceptual errors — needs different explanation approach',
      difficulty: 1,
    }
  }

  // Priority 4: Next unmastered concept in chapter order
  for (const topic of relevantTopics) {
    const state = stateMap.get(topic.id)
    if (!state || state.total_attempts === 0) {
      return {
        type: 'teach',
        concept_id: topic.id,
        title: topic.title,
        reason: 'New concept — ready to learn',
        difficulty: topic.difficulty_level || 1,
      }
    }
    if (state.mastery_mean < 0.6) {
      return {
        type: 'practice',
        concept_id: topic.id,
        title: topic.title,
        reason: 'Partially learned — needs more practice',
        difficulty: state.max_difficulty_succeeded || topic.difficulty_level || 2,
      }
    }
    if (state.mastery_mean < 0.85) {
      return {
        type: 'challenge',
        concept_id: topic.id,
        title: topic.title,
        reason: 'Approaching mastery — increasing difficulty',
        difficulty: Math.min((state.max_difficulty_succeeded || 2) + 1, 5),
      }
    }
  }

  // Priority 5: All mastered — exam prep mode
  return {
    type: 'exam_prep',
    concept_id: null,
    title: 'Exam Preparation',
    reason: 'All concepts mastered — focus on exam-style practice',
    difficulty: 3,
  }
}

// ── Revision Schedule ───────────────────────────────────────────────

function computeRevisionSchedule(states: ConceptState[]): Array<{ concept_id: string; due_at: string; priority: number; revision_type: string }> {
  const now = Date.now()
  const schedule = []

  for (const s of states) {
    if (s.total_attempts === 0) continue
    const retention = computeRetention(s.mastery_mean, s.retention_half_life, s.last_practiced_at)
    if (retention < 0.7) {
      const hoursUntilHalf = s.retention_half_life * 0.7
      const lastMs = s.last_practiced_at ? new Date(s.last_practiced_at).getTime() : now
      const dueMs = lastMs + hoursUntilHalf * 3600000
      const due = new Date(Math.max(dueMs, now))

      schedule.push({
        concept_id: s.concept_id,
        due_at: due.toISOString(),
        priority: (1 - retention) * (s.mastery_mean > 0.6 ? 1.5 : 1.0),
        revision_type: s.mastery_mean < 0.5 ? 'remediation' : 'revision',
      })
    }
  }

  return schedule.sort((a, b) => b.priority - a.priority).slice(0, 10)
}

// ── Exam Readiness ──────────────────────────────────────────────────

function computeExamReadiness(states: ConceptState[], topics: TopicInfo[], subjectId: string, grade: string) {
  const relevant = topics.filter(t => t.subject_id === subjectId && t.grade === grade)
  const stateMap = new Map(states.map(s => [s.concept_id, s]))

  if (relevant.length === 0) return { overall: 0, chapters: {}, weakest: [] }

  const chapters: Record<number, { total: number; mastered: number; retention_sum: number }> = {}

  for (const topic of relevant) {
    const ch = topic.chapter_number || 0
    if (!chapters[ch]) chapters[ch] = { total: 0, mastered: 0, retention_sum: 0 }
    chapters[ch].total++

    const state = stateMap.get(topic.id)
    if (state) {
      const retention = computeRetention(state.mastery_mean, state.retention_half_life, state.last_practiced_at)
      chapters[ch].retention_sum += retention
      if (retention >= 0.7) chapters[ch].mastered++
    }
  }

  const chapterScores: Record<string, number> = {}
  let totalWeighted = 0
  let totalTopics = 0

  for (const [ch, data] of Object.entries(chapters)) {
    const score = data.total > 0 ? data.retention_sum / data.total : 0
    chapterScores[`Chapter ${ch}`] = Math.round(score * 100) / 100
    totalWeighted += data.retention_sum
    totalTopics += data.total
  }

  const overall = totalTopics > 0 ? totalWeighted / totalTopics : 0
  const weakest = Object.entries(chapterScores)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([ch, score]) => ({ chapter: ch, score }))

  return {
    overall: Math.round(overall * 100) / 100,
    predicted_percentage: Math.round(overall * 100),
    chapters: chapterScores,
    weakest,
    total_concepts: relevant.length,
    concepts_mastered: states.filter(s => {
      const r = computeRetention(s.mastery_mean, s.retention_half_life, s.last_practiced_at)
      return r >= 0.7
    }).length,
  }
}

// ── Main Handler ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Auth: extract student from JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('id, grade, preferred_subject')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!student) {
      return new Response(JSON.stringify({ error: 'Student not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const body = await req.json()
    const action = body.action

    // ── GET_NEXT_ACTION ──
    if (action === 'get_next_action') {
      const subjectId = body.subject_id
      if (!subjectId) {
        return new Response(JSON.stringify({ error: 'subject_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const [statesRes, topicsRes] = await Promise.all([
        supabase.from('cme_concept_state').select('*').eq('student_id', student.id),
        supabase.from('curriculum_topics').select('id,title,parent_topic_id,prerequisite_topic_ids,difficulty_level,bloom_focus,chapter_number,display_order,grade,subject_id').eq('is_active', true).is('deleted_at', null),
      ])

      const states = (statesRes.data || []) as ConceptState[]
      const topics = (topicsRes.data || []) as TopicInfo[]
      const result = selectNextAction(states, topics, subjectId, student.grade)

      // Log action
      await supabase.from('cme_action_log').insert({
        student_id: student.id,
        action_type: result.type,
        concept_id: result.concept_id,
        reason: result.reason,
      })

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── RECORD_RESPONSE ──
    if (action === 'record_response') {
      const { concept_id, question_id, correct, difficulty, response_time_ms, student_answer, correct_answer } = body
      if (!concept_id || correct === undefined) {
        return new Response(JSON.stringify({ error: 'concept_id and correct required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Get or create concept state
      let { data: existing } = await supabase
        .from('cme_concept_state')
        .select('*')
        .eq('student_id', student.id)
        .eq('concept_id', concept_id)
        .maybeSingle()

      const currentState = existing || {
        mastery_mean: 0.3,
        mastery_variance: 0.25,
        retention_half_life: 48,
        total_attempts: 0,
        total_correct: 0,
        streak_current: 0,
        error_count_conceptual: 0,
        error_count_procedural: 0,
        error_count_careless: 0,
        last_practiced_at: null,
      }

      const updated = updateMastery(currentState, correct, difficulty || 2, response_time_ms || 30000, 30000)

      // Upsert concept state
      const { error: upsertError } = await supabase
        .from('cme_concept_state')
        .upsert({
          student_id: student.id,
          concept_id,
          mastery_mean: updated.mastery_mean,
          mastery_variance: updated.mastery_variance,
          retention_half_life: updated.retention_half_life,
          current_retention: updated.current_retention,
          total_attempts: updated.total_attempts,
          total_correct: updated.total_correct,
          streak_current: updated.streak_current,
          error_count_conceptual: updated.error_count_conceptual,
          error_count_procedural: updated.error_count_procedural,
          error_count_careless: updated.error_count_careless,
          last_practiced_at: updated.last_practiced_at,
          avg_response_time_ms: response_time_ms || null,
          max_difficulty_succeeded: correct ? Math.max(currentState.max_difficulty_succeeded || 1, difficulty || 1) : (currentState.max_difficulty_succeeded || 1),
          updated_at: updated.updated_at,
        }, { onConflict: 'student_id,concept_id' })

      // Log error if incorrect
      if (!correct && updated.errorType) {
        await supabase.from('cme_error_log').insert({
          student_id: student.id,
          concept_id,
          question_id: question_id || null,
          error_type: updated.errorType,
          student_answer: (student_answer || '').slice(0, 500),
          correct_answer: (correct_answer || '').slice(0, 500),
          response_time_ms: response_time_ms || null,
        })
      }

      return new Response(JSON.stringify({
        mastery: updated.mastery_mean,
        retention: updated.current_retention,
        streak: updated.streak_current,
        error_type: updated.errorType,
        total_attempts: updated.total_attempts,
        total_correct: updated.total_correct,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── GET_CONCEPT_STATE ──
    if (action === 'get_concept_state') {
      const subjectId = body.subject_id
      const { data: states } = await supabase
        .from('cme_concept_state')
        .select('concept_id, mastery_mean, current_retention, retention_half_life, last_practiced_at, total_attempts, total_correct, streak_current, error_count_conceptual, max_difficulty_succeeded')
        .eq('student_id', student.id)

      // Compute current retention with decay
      const withRetention = (states || []).map(s => ({
        ...s,
        current_retention: computeRetention(s.mastery_mean, s.retention_half_life, s.last_practiced_at),
      }))

      return new Response(JSON.stringify({ data: withRetention }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── GET_REVISION_DUE ──
    if (action === 'get_revision_due') {
      const { data: states } = await supabase
        .from('cme_concept_state')
        .select('concept_id, mastery_mean, retention_half_life, last_practiced_at, total_attempts, max_difficulty_succeeded, error_count_conceptual, current_retention')
        .eq('student_id', student.id)

      const schedule = computeRevisionSchedule((states || []) as ConceptState[])

      // Enrich with topic titles
      if (schedule.length > 0) {
        const conceptIds = schedule.map(s => s.concept_id)
        const { data: topics } = await supabase
          .from('curriculum_topics')
          .select('id, title')
          .in('id', conceptIds)

        const titleMap = new Map((topics || []).map(t => [t.id, t.title]))
        for (const item of schedule) {
          (item as any).title = titleMap.get(item.concept_id) || 'Unknown'
        }
      }

      return new Response(JSON.stringify({ data: schedule }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── GET_EXAM_READINESS ──
    if (action === 'get_exam_readiness') {
      const subjectId = body.subject_id
      if (!subjectId) {
        return new Response(JSON.stringify({ error: 'subject_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const [statesRes, topicsRes] = await Promise.all([
        supabase.from('cme_concept_state').select('concept_id, mastery_mean, retention_half_life, last_practiced_at, total_attempts, max_difficulty_succeeded, error_count_conceptual, current_retention').eq('student_id', student.id),
        supabase.from('curriculum_topics').select('id,title,subject_id,grade,chapter_number,difficulty_level,bloom_focus,prerequisite_topic_ids,parent_topic_id,display_order').eq('is_active', true).is('deleted_at', null),
      ])

      const readiness = computeExamReadiness(
        (statesRes.data || []) as ConceptState[],
        (topicsRes.data || []) as TopicInfo[],
        subjectId,
        student.grade
      )

      // Save snapshot
      await supabase.from('cme_exam_readiness').insert({
        student_id: student.id,
        exam_type: body.exam_type || 'periodic',
        overall_score: readiness.overall,
        predicted_marks: readiness.predicted_percentage,
        chapter_breakdown: readiness.chapters,
        weakest_chapters: readiness.weakest.map(w => w.chapter),
      })

      return new Response(JSON.stringify(readiness), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
