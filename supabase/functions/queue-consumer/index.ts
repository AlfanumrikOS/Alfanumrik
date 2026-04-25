/**
 * queue-consumer – Alfanumrik Edge Function
 *
 * Dequeues tasks from `task_queue` and processes them.
 * Supported queue types:
 *   - quiz_processing        : BKT mastery update, spaced-rep card generation, XP credit
 *   - notification_batching  : Generate in-app notifications from trigger events
 *   - ai_response_processing : Extract topic mastery signals from Foxy AI sessions
 *
 * Invoke via POST (cron or manual) – no request body required.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getCorsHeaders } from '../_shared/cors.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TaskRow {
  id: string
  queue_name: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
  attempts: number
}

interface QuizPayload {
  student_id: string
  session_id: string
  subject: string
  grade: string
  responses: QuizResponse[]
  xp_earned: number
  score_percent: number
}

interface QuizResponse {
  question_id: string
  topic_id?: string
  concept_id?: string
  is_correct: boolean
  time_spent: number
  bloom_level?: string
}

interface NotificationPayload {
  student_id: string
  trigger: 'streak_milestone' | 'quiz_completion' | 'achievement_unlock' | 'weekly_summary'
  data: Record<string, unknown>
}

interface AiSessionPayload {
  student_id: string
  session_id: string
  subject: string
  grade: string
  messages_processed: number
  topic_signals: TopicSignal[]
}

interface TopicSignal {
  topic_id: string
  confidence_delta: number    // -1.0 to +1.0
  interaction_type: string
}

// ─── BKT helper (Bayesian Knowledge Tracing) ──────────────────────────────

/**
 * Single-parameter BKT update.
 * P(Know_t+1) = P(Know_t | evidence) * (1 - P_slip) + (1 - P(Know_t | evidence)) * P_learn
 */
function bktUpdate(
  pKnow: number,
  isCorrect: boolean,
  pLearn = 0.2,
  pSlip = 0.1,
  pGuess = 0.25,
): number {
  // Posterior given evidence
  const pCorrectGivenKnow = 1 - pSlip
  const pCorrectGivenNotKnow = pGuess

  const pEvidence = isCorrect
    ? pKnow * pCorrectGivenKnow + (1 - pKnow) * pCorrectGivenNotKnow
    : pKnow * pSlip + (1 - pKnow) * (1 - pGuess)

  const pKnowGivenEvidence = isCorrect
    ? (pKnow * pCorrectGivenKnow) / pEvidence
    : (pKnow * pSlip) / pEvidence

  // Transition
  const pKnowNext = pKnowGivenEvidence + (1 - pKnowGivenEvidence) * pLearn

  return Math.min(1, Math.max(0, pKnowNext))
}

// ─── Spaced repetition helper ─────────────────────────────────────────────

/** SM-2 inspired next-review interval (days). */
function nextReviewInterval(currentInterval: number, easeFactor: number, isCorrect: boolean): number {
  if (!isCorrect) return 1
  if (currentInterval === 0) return 1
  if (currentInterval === 1) return 6
  return Math.round(currentInterval * easeFactor)
}

// ─── Processor: quiz_processing ──────────────────────────────────────────

async function processQuizTask(supabase: SupabaseClient, payload: QuizPayload): Promise<void> {
  const { student_id, subject, grade, responses, xp_earned, score_percent, session_id } = payload

  if (!student_id || !Array.isArray(responses)) {
    throw new Error('quiz_processing: missing student_id or responses')
  }

  // 1. Update concept_mastery (BKT) via atomic RPC — prevents race conditions
  //    The RPC uses SELECT ... FOR UPDATE to lock the row during read-modify-write.
  //    Process sequentially per student to avoid deadlocks on row locks.
  for (const resp of responses) {
    const topicId = resp.topic_id ?? resp.concept_id
    if (!topicId) continue

    const { error: bktError } = await supabase.rpc('update_concept_mastery_bkt', {
      p_student_id: student_id,
      p_topic_id: topicId,
      p_is_correct: resp.is_correct,
    })

    if (bktError) {
      console.warn(`BKT update failed for ${student_id}/${topicId}:`, bktError.message)
    }
  }

  // 2. Generate spaced-repetition review cards for missed questions
  const missedResponses = responses.filter((r) => !r.is_correct)
  if (missedResponses.length > 0) {
    const reviewCards = missedResponses.map((r) => ({
      student_id,
      question_id: r.question_id,
      source_session_id: session_id ?? null,
      due_date: new Date(Date.now() + 86_400_000).toISOString(), // review tomorrow
      interval_days: 1,
      ease_factor: 2.0,
      repetitions: 0,
      created_at: new Date().toISOString(),
    }))

    // Insert cards, ignore conflicts (card may already exist)
    await supabase
      .from('review_cards')
      .upsert(reviewCards, { onConflict: 'student_id,question_id', ignoreDuplicates: true })
  }

  // 3. Credit XP to the student's learning profile for this subject
  //    Use atomic RPC to prevent race conditions with concurrent quiz submissions
  if (xp_earned > 0) {
    const correctCount = responses.filter((r) => r.is_correct).length

    const { error: creditError } = await supabase.rpc('credit_quiz_xp', {
      p_student_id: student_id,
      p_subject: subject,
      p_grade: grade,
      p_xp: xp_earned,
      p_questions_asked: responses.length,
      p_questions_correct: correctCount,
    })

    // Fallback: if the RPC doesn't exist yet, use upsert with conflict handling
    if (creditError) {
      console.warn('credit_quiz_xp RPC unavailable, using upsert fallback:', creditError.message)
      const now = new Date().toISOString()
      const { data: profile } = await supabase
        .from('student_learning_profiles')
        .select('id, xp_total, total_questions_asked, total_questions_answered_correctly')
        .eq('student_id', student_id)
        .eq('subject', subject)
        .maybeSingle()

      if (profile) {
        await supabase
          .from('student_learning_profiles')
          .update({
            xp_total: ((profile.xp_total as number) ?? 0) + xp_earned,
            total_questions_asked:
              ((profile.total_questions_asked as number) ?? 0) + responses.length,
            total_questions_answered_correctly:
              ((profile.total_questions_answered_correctly as number) ?? 0) + correctCount,
            last_activity_at: now,
            updated_at: now,
          })
          .eq('id', profile.id)
      } else {
        await supabase.from('student_learning_profiles').insert({
          student_id,
          subject,
          grade,
          xp_total: xp_earned,
          total_questions_asked: responses.length,
          total_questions_answered_correctly: correctCount,
          streak_days: 0,
          last_activity_at: now,
          created_at: now,
          updated_at: now,
        })
      }
    }
  }
}

// ─── Processor: notification_batching ───────────────────────────────────

async function processNotificationTask(
  supabase: SupabaseClient,
  payload: NotificationPayload,
): Promise<void> {
  const { student_id, trigger, data } = payload

  if (!student_id || !trigger) {
    throw new Error('notification_batching: missing student_id or trigger')
  }

  type NotifRow = {
    student_id: string
    type: string
    title: string
    body: string
    data: Record<string, unknown>
    is_read: boolean
    created_at: string
  }

  let notification: NotifRow | null = null

  switch (trigger) {
    case 'streak_milestone': {
      const days = data.streak_days as number
      notification = {
        student_id,
        type: 'streak',
        title: `🔥 ${days}-Day Streak!`,
        body: `Amazing! You've studied for ${days} days in a row. Keep it going!`,
        data,
        is_read: false,
        created_at: new Date().toISOString(),
      }
      break
    }

    case 'quiz_completion': {
      const score = data.score_percent as number
      const subject = data.subject as string
      const xp = data.xp_earned as number
      const emoji = score >= 80 ? '🏆' : score >= 60 ? '👍' : '💪'
      notification = {
        student_id,
        type: 'quiz_result',
        title: `${emoji} Quiz Complete — ${score}%`,
        body: `You earned +${xp} XP on your ${subject} quiz! ${score >= 80 ? 'Outstanding work!' : 'Keep practising!'}`,
        data,
        is_read: false,
        created_at: new Date().toISOString(),
      }
      break
    }

    case 'achievement_unlock': {
      const achievement = data.achievement_name as string
      const icon = (data.icon as string) ?? '🏅'
      notification = {
        student_id,
        type: 'achievement',
        title: `${icon} Achievement Unlocked!`,
        body: `You earned "${achievement}". Tap to see your collection!`,
        data,
        is_read: false,
        created_at: new Date().toISOString(),
      }
      break
    }

    case 'weekly_summary': {
      const totalXp = data.total_xp as number
      const quizzes = data.quizzes_taken as number
      notification = {
        student_id,
        type: 'weekly_summary',
        title: '📊 Your Weekly Report',
        body: `This week: ${quizzes} quizzes, +${totalXp} XP earned. ${totalXp >= 100 ? "You're on fire!" : 'Every session counts!'}`,
        data,
        is_read: false,
        created_at: new Date().toISOString(),
      }
      break
    }

    default:
      throw new Error(`notification_batching: unknown trigger "${trigger}"`)
  }

  if (notification) {
    await supabase.from('notifications').insert(notification)
  }
}

// ─── Processor: ai_response_processing ──────────────────────────────────

async function processAiResponseTask(
  supabase: SupabaseClient,
  payload: AiSessionPayload,
): Promise<void> {
  const { student_id, session_id, topic_signals } = payload

  if (!student_id || !Array.isArray(topic_signals)) {
    throw new Error('ai_response_processing: missing student_id or topic_signals')
  }

  if (topic_signals.length === 0) return

  // Apply confidence deltas to concept_mastery
  const updates: Promise<unknown>[] = []

  for (const signal of topic_signals) {
    if (!signal.topic_id || typeof signal.confidence_delta !== 'number') continue

    const { data: existing } = await supabase
      .from('concept_mastery')
      .select('id, mastery_level')
      .eq('student_id', student_id)
      .eq('topic_id', signal.topic_id)
      .maybeSingle()

    const currentMastery = (existing?.mastery_level as number) ?? 0.1
    const newMastery = Math.min(
      1,
      Math.max(0, currentMastery + signal.confidence_delta * 0.15),
    )

    updates.push(
      supabase.from('concept_mastery').upsert(
        {
          student_id,
          topic_id: signal.topic_id,
          mastery_level: newMastery,
          last_reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'student_id,topic_id' },
      ),
    )
  }

  // Record the AI session reference
  updates.push(
    supabase.from('ai_session_logs').upsert(
      {
        session_id,
        student_id,
        signals_processed: topic_signals.length,
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'session_id', ignoreDuplicates: true },
    ),
  )

  await Promise.all(updates)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

async function dispatchTask(
  supabase: SupabaseClient,
  task: TaskRow,
): Promise<void> {
  switch (task.queue_name) {
    case 'quiz_processing':
      await processQuizTask(supabase, task.payload as unknown as QuizPayload)
      break
    case 'notification_batching':
      await processNotificationTask(supabase, task.payload as unknown as NotificationPayload)
      break
    case 'ai_response_processing':
      await processAiResponseTask(supabase, task.payload as unknown as AiSessionPayload)
      break
    default:
      throw new Error(`Unknown queue_name: "${task.queue_name}"`)
  }
}

// ─── Domain events outbox drain (Phase 0 Wave 3) ──────────────────────────
//
// Drains public.domain_events alongside the legacy task_queue. The outbox
// is the canonical async boundary for cross-context events (E1 quiz.completed,
// E2/E3 payment, E4 subscription.cancelled, E5/E6 notification, E8 practice).
//
// Contract:
//   - Claim oldest pending events, mark processing.
//   - Dispatch by event_type to a registered handler; missing handlers are
//     ack'd as processed (we don't retain unrecognised events forever).
//   - On dispatch error, increment retry_count and re-pend (up to 3
//     attempts; then dead_letter).
//   - processed_at is set on terminal status (processed / dead_letter).

interface DomainEventRow {
  id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string | null
  payload: Record<string, unknown>
  status: string
  retry_count: number
  created_at: string
}

type EventHandler = (
  supabase: SupabaseClient,
  event: DomainEventRow,
) => Promise<void>

/**
 * Registry of event_type → handler. Add new handlers as Phase 0 consumers
 * come online. Today every event is a no-op ack — we record that the event
 * was observed and mark it processed. Real consumers (analytics aggregator
 * for E1/E8, notification dispatcher for E2/E5/E6) will register real
 * handlers in subsequent PRs.
 */
const eventHandlers: Record<string, EventHandler> = {
  // E1 — quiz.completed: future analytics aggregation will live here.
  'quiz.completed': async (_supabase, event) => {
    console.log(`[outbox] ack quiz.completed for session ${event.aggregate_id}`)
  },
  // E2/E3 — payment events: future notification dispatch.
  'payment.completed': async (_supabase, event) => {
    console.log(`[outbox] ack payment.completed for ${event.aggregate_id}`)
  },
  'payment.failed': async (_supabase, event) => {
    console.log(`[outbox] ack payment.failed for ${event.aggregate_id}`)
  },
  // E4 — subscription terminal state.
  'subscription.cancelled': async (_supabase, event) => {
    console.log(`[outbox] ack subscription.cancelled for ${event.aggregate_id}`)
  },
  // E5/E6 — notification dispatched.
  'notification.dispatched.email': async (_supabase, event) => {
    console.log(`[outbox] ack notification.dispatched.email for ${event.aggregate_id}`)
  },
  'notification.dispatched.in_app': async (_supabase, event) => {
    console.log(`[outbox] ack notification.dispatched.in_app for ${event.aggregate_id}`)
  },
  // E8 — practice.completed.
  'practice.completed': async (_supabase, event) => {
    console.log(`[outbox] ack practice.completed for ${event.aggregate_id}`)
  },
  // Phase 0d test event.
  'content.request_submitted': async (_supabase, event) => {
    console.log(`[outbox] ack content.request_submitted for ${event.aggregate_id}`)
  },
}

async function dispatchDomainEvent(
  supabase: SupabaseClient,
  event: DomainEventRow,
): Promise<void> {
  const handler = eventHandlers[event.event_type]
  if (!handler) {
    // No registered handler — ack and continue. We don't fail unrecognised
    // events; this lets new event types be deployed before consumers ship.
    console.warn(`[outbox] no handler registered for event_type=${event.event_type}; ack'ing`)
    return
  }
  await handler(supabase, event)
}

interface OutboxDrainResult {
  processed: number
  failed: number
  dead_lettered: number
  errors: string[]
}

async function drainDomainEvents(
  supabase: SupabaseClient,
  batchSize: number,
): Promise<OutboxDrainResult> {
  const result: OutboxDrainResult = {
    processed: 0,
    failed: 0,
    dead_lettered: 0,
    errors: [],
  }

  // Claim batch of pending events.
  const { data: events, error: fetchErr } = await supabase
    .from('domain_events')
    .select('id, event_type, aggregate_type, aggregate_id, payload, status, retry_count, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (fetchErr) {
    result.errors.push(`outbox fetch failed: ${fetchErr.message}`)
    return result
  }
  if (!events || events.length === 0) {
    return result
  }

  const eventIds = events.map((e: DomainEventRow) => e.id)

  // Atomically mark as processing.
  await supabase
    .from('domain_events')
    .update({ status: 'processing' })
    .in('id', eventIds)
    .eq('status', 'pending')

  for (const event of events as DomainEventRow[]) {
    try {
      await dispatchDomainEvent(supabase, event)
      await supabase
        .from('domain_events')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', event.id)
      result.processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`[${event.id}/${event.event_type}] ${message}`)
      const nextRetry = event.retry_count + 1
      const terminal = nextRetry >= 3
      await supabase
        .from('domain_events')
        .update({
          status: terminal ? 'dead_letter' : 'pending',
          retry_count: nextRetry,
          last_error: message,
          processed_at: terminal ? new Date().toISOString() : null,
        })
        .eq('id', event.id)
      if (terminal) {
        result.dead_lettered++
      } else {
        result.failed++
      }
    }
  }

  return result
}

// ─── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    // Parse optional filter from body (e.g. { queue_name: 'quiz_processing', batch_size: 20 })
    let queueFilter: string | null = null
    let batchSize = 25

    if (req.method === 'POST' && req.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await req.json()
        queueFilter = body.queue_name ?? null
        batchSize = body.batch_size ?? 25
      } catch {
        // body is optional
      }
    }

    // Claim pending tasks (mark as processing to prevent double-processing)
    let query = supabaseClient
      .from('task_queue')
      .select('id, queue_name, payload, status, created_at, attempts')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (queueFilter) {
      query = query.eq('queue_name', queueFilter)
    }

    const { data: tasks, error: fetchError } = await query

    if (fetchError) throw fetchError

    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No pending tasks' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const taskIds = tasks.map((t: TaskRow) => t.id)

    // Atomically mark tasks as processing
    await supabaseClient
      .from('task_queue')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .in('id', taskIds)

    const results = { processed: 0, failed: 0, errors: [] as string[] }

    for (const task of tasks as TaskRow[]) {
      try {
        await dispatchTask(supabaseClient, task)

        await supabaseClient
          .from('task_queue')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.id)

        results.processed++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.errors.push(`[${task.id}] ${message}`)
        results.failed++

        const nextAttempt = task.attempts + 1
        // Exponential backoff with jitter: delay reprocessing by 2^attempt * jitter minutes
        const backoffMinutes = Math.pow(2, nextAttempt) * (0.5 + Math.random() * 0.5)
        const retryAfter = new Date(Date.now() + backoffMinutes * 60_000).toISOString()

        await supabaseClient
          .from('task_queue')
          .update({
            status: nextAttempt >= 3 ? 'failed' : 'pending',
            attempts: nextAttempt,
            last_error: message,
            retry_after: retryAfter,
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.id)
      }
    }

    // Drain the domain_events outbox alongside the legacy task_queue.
    // Failure here is logged but does NOT fail the overall request — the
    // task_queue results above are already useful, and a transient outbox
    // error should not poison the ops cron.
    let outboxResult: OutboxDrainResult | { error: string }
    try {
      outboxResult = await drainDomainEvents(supabaseClient, batchSize)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('queue-consumer outbox drain error:', message)
      outboxResult = { error: message }
    }

    return new Response(
      JSON.stringify({ ...results, outbox: outboxResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('queue-consumer fatal error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
