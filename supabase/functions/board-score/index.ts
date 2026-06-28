import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { checkBearerToken } from '../_shared/auth.ts'

/**
 * board-score Edge Function  (BoardScore™ v1)
 *
 * Actions:
 *   compute — Fetch a student's CME states for one subject, apply CBSE chapter
 *             weights, compute predicted board exam score, persist to
 *             board_score_predictions. Called by the nightly cron.
 *
 *   get     — Return the latest board_score_predictions row(s) for the
 *             authenticated student, optionally filtered by subject.
 *
 * Auth model:
 *   - compute: requires service_role key (server-to-server only).
 *   - get:     requires a valid student JWT; row-level policy enforces
 *              that students can only read their own predictions.
 *
 * Scoring formula:
 *   effective_mastery(chapter) = mean of (mastery_mean × retention_factor)
 *                                over all cme_concept_states in that chapter
 *   predicted_marks(chapter)   = effective_mastery × marks_allocated
 *   predicted_score            = Σ predicted_marks(all chapters)
 *   predicted_pct              = predicted_score / total_marks × 100
 *   confidence_band            = ±10 pct points (widened to ±15 if coverage < 60%)
 *
 * Retention decay (mirrors cme-engine/computeRetention):
 *   retention = mastery_mean × exp(-0.693 × hoursSince / halfLifeHours)
 *   Clamped to [0, 1]. Returns mastery_mean unchanged if no last_practiced_at.
 *
 * Recovery plan:
 *   Rank chapters by (marks_allocated × (1 – effective_mastery)) DESC — the
 *   highest number of recoverable marks appears first. Top 5 returned.
 *
 * Chapter status thresholds:
 *   effective_mastery ≥ 0.75 → 'strong'
 *   effective_mastery ≥ 0.50 → 'moderate'
 *   effective_mastery ≥ 0.25 → 'weak'
 *   effective_mastery < 0.25  → 'critical'
 */

// ── Types ──────────────────────────────────────────────────────────────────

interface ComputeRequest {
  action: 'compute'
  student_id: string
  subject_code: string
  grade: string
}

interface GetRequest {
  action: 'get'
  subject_code?: string
  grade?: string
}

type RequestBody = ComputeRequest | GetRequest

interface ChapterWeight {
  chapter_number: number
  chapter_name: string
  unit_name: string
  marks_allocated: number
  total_marks: number
}

interface ConceptState {
  concept_id: string
  chapter_number: number | null
  mastery_mean: number
  retention_half_life: number
  last_practiced_at: string | null
}

interface ChapterScore {
  chapter_name: string
  unit_name: string
  marks_allocated: number
  max_marks: number
  mastery_mean: number          // simple mean of concept mastery_means in chapter
  retention_factor: number      // mean retention across concepts in chapter
  effective_mastery: number     // mastery_mean × retention_factor
  predicted_marks: number
  status: 'strong' | 'moderate' | 'weak' | 'critical'
}

interface RecoveryItem {
  priority: number
  chapter_number: number
  chapter_name: string
  marks_allocated: number
  current_predicted_marks: number
  recoverable_marks: number
  action_label: string
}

// ── Scoring helpers ────────────────────────────────────────────────────────

function computeRetention(
  masteryMean: number,
  halfLifeHours: number,
  lastPracticedAt: string | null,
): number {
  if (!lastPracticedAt) return masteryMean
  const hoursSince = (Date.now() - new Date(lastPracticedAt).getTime()) / 3_600_000
  if (hoursSince <= 0) return masteryMean
  const retention = masteryMean * Math.exp(-0.693 * hoursSince / halfLifeHours)
  return Math.max(0, Math.min(1, retention))
}

function classifyMastery(m: number): 'strong' | 'moderate' | 'weak' | 'critical' {
  if (m >= 0.75) return 'strong'
  if (m >= 0.50) return 'moderate'
  if (m >= 0.25) return 'weak'
  return 'critical'
}

function buildActionLabel(chapter_name: string, status: string): string {
  if (status === 'critical') return `Start ${chapter_name} from basics`
  if (status === 'weak')     return `Revise ${chapter_name} and practice MCQs`
  return                            `Practice past-paper questions on ${chapter_name}`
}

// ── Feature flag check (fail-closed) ──────────────────────────────────────

async function isBoardScoreEnabled(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_board_score_v1')
      .maybeSingle()
    return data?.is_enabled === true
  } catch {
    return false // fail-closed
  }
}

// ── Core compute logic ─────────────────────────────────────────────────────

async function computeBoardScore(
  supabase: ReturnType<typeof createClient>,
  body: ComputeRequest,
  correlationId: string,
): Promise<Response> {
  const { student_id, subject_code, grade } = body

  // 1. Load CBSE chapter weights for this subject/grade
  const { data: weights, error: wErr } = await supabase
    .from('cbse_chapter_weights')
    .select('chapter_number, chapter_name, unit_name, marks_allocated, total_marks')
    .eq('board', 'CBSE')
    .eq('grade', grade)
    .eq('subject_code', subject_code)
    .eq('is_active', true)
    .order('chapter_number', { ascending: true })

  if (wErr || !weights?.length) {
    console.error(`[board-score][${correlationId}] weights load failed: ${wErr?.message}`)
    return errorResponse(`No chapter weights found for ${subject_code} Grade ${grade}`, 422)
  }

  const totalMarks = (weights[0] as ChapterWeight).total_marks
  const totalChapters = weights.length

  // 2. Load CME concept states for this student / subject / grade
  // We join through curriculum_topics to get chapter_number alignment.
  const { data: states, error: sErr } = await supabase
    .from('cme_concept_state')
    .select(`
      concept_id,
      mastery_mean,
      retention_half_life,
      last_practiced_at,
      curriculum_topics!inner (
        chapter_number,
        grade,
        subject_id,
        subjects!inner (code)
      )
    `)
    .eq('student_id', student_id)
    .eq('curriculum_topics.grade', grade)
    .eq('curriculum_topics.subjects.code', subject_code)
    .not('mastery_mean', 'is', null)

  if (sErr) {
    console.error(`[board-score][${correlationId}] concept states load failed: ${sErr.message}`)
    return errorResponse('Failed to load student concept states', 500)
  }

  const snapshotAt = new Date().toISOString()

  // Flatten concept states to include chapter_number
  const flatStates: ConceptState[] = (states ?? []).map((row: any) => ({
    concept_id: row.concept_id,
    chapter_number: row.curriculum_topics?.chapter_number ?? null,
    mastery_mean: row.mastery_mean ?? 0,
    retention_half_life: row.retention_half_life ?? 48,
    last_practiced_at: row.last_practiced_at ?? null,
  }))

  // Group concept states by chapter_number
  const byChapter = new Map<number, ConceptState[]>()
  for (const s of flatStates) {
    if (s.chapter_number == null) continue
    const list = byChapter.get(s.chapter_number) ?? []
    list.push(s)
    byChapter.set(s.chapter_number, list)
  }

  // 3. Score each chapter
  const chapterScoresMap: Record<string, ChapterScore> = {}
  let predictedScore = 0
  let chaptersWithData = 0

  for (const w of weights as ChapterWeight[]) {
    const concepts = byChapter.get(w.chapter_number) ?? []
    const hasData = concepts.length > 0

    if (hasData) chaptersWithData++

    const masteryMean = hasData
      ? concepts.reduce((s, c) => s + c.mastery_mean, 0) / concepts.length
      : 0

    const retentionFactor = hasData
      ? concepts.reduce(
          (s, c) => s + computeRetention(c.mastery_mean, c.retention_half_life, c.last_practiced_at),
          0,
        ) / concepts.length / (masteryMean || 1)
      : 0

    const effectiveMastery = hasData
      ? Math.max(0, Math.min(1, masteryMean * retentionFactor))
      : 0

    const predictedMarks = effectiveMastery * w.marks_allocated
    predictedScore += predictedMarks

    chapterScoresMap[String(w.chapter_number)] = {
      chapter_name: w.chapter_name,
      unit_name: w.unit_name,
      marks_allocated: w.marks_allocated,
      max_marks: w.marks_allocated,
      mastery_mean: Math.round(masteryMean * 1000) / 1000,
      retention_factor: Math.round(retentionFactor * 1000) / 1000,
      effective_mastery: Math.round(effectiveMastery * 1000) / 1000,
      predicted_marks: Math.round(predictedMarks * 100) / 100,
      status: hasData ? classifyMastery(effectiveMastery) : 'critical',
    }
  }

  const coveragePct = totalChapters > 0 ? (chaptersWithData / totalChapters) * 100 : 0
  const predictedPct = totalMarks > 0 ? (predictedScore / totalMarks) * 100 : 0

  // Confidence band widens when data is sparse
  const bandHalf = coveragePct < 60 ? 15 : 10
  const confidenceLow  = Math.max(0,   predictedPct - bandHalf)
  const confidenceHigh = Math.min(100, predictedPct + bandHalf)

  // 4. Build recovery plan — top 5 chapters by recoverable marks
  const recoveryPlan: RecoveryItem[] = (weights as ChapterWeight[])
    .map((w) => {
      const cs = chapterScoresMap[String(w.chapter_number)]
      const recoverableMarks = w.marks_allocated * (1 - (cs?.effective_mastery ?? 0))
      return {
        chapter_number: w.chapter_number,
        chapter_name: w.chapter_name,
        marks_allocated: w.marks_allocated,
        current_predicted_marks: cs?.predicted_marks ?? 0,
        recoverable_marks: Math.round(recoverableMarks * 100) / 100,
        status: cs?.status ?? 'critical',
      }
    })
    .filter((r) => r.recoverable_marks > 0.5)
    .sort((a, b) => b.recoverable_marks - a.recoverable_marks)
    .slice(0, 5)
    .map((r, i) => ({
      priority: i + 1,
      chapter_number: r.chapter_number,
      chapter_name: r.chapter_name,
      marks_allocated: r.marks_allocated,
      current_predicted_marks: r.current_predicted_marks,
      recoverable_marks: r.recoverable_marks,
      action_label: buildActionLabel(r.chapter_name, r.status),
    }))

  // 5. Get subject label from weights (carry through for display)
  const { data: subjectRow } = await supabase
    .from('cbse_chapter_weights')
    .select('subject_label')
    .eq('board', 'CBSE')
    .eq('grade', grade)
    .eq('subject_code', subject_code)
    .limit(1)
    .maybeSingle()

  const subjectLabel = subjectRow?.subject_label ?? subject_code

  // 6. Upsert to board_score_predictions (idempotent by natural key)
  const scoreDate = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
  const { error: upsertErr } = await supabase
    .from('board_score_predictions')
    .upsert(
      {
        student_id,
        subject_code,
        subject_label: subjectLabel,
        grade,
        score_date: scoreDate,
        predicted_score: Math.round(predictedScore * 100) / 100,
        max_score: totalMarks,
        predicted_pct: Math.round(predictedPct * 100) / 100,
        confidence_band_low: Math.round(confidenceLow * 100) / 100,
        confidence_band_high: Math.round(confidenceHigh * 100) / 100,
        chapter_scores: chapterScoresMap,
        recovery_plan: recoveryPlan,
        chapters_with_data: chaptersWithData,
        total_chapters: totalChapters,
        coverage_pct: Math.round(coveragePct * 100) / 100,
        cme_snapshot_at: snapshotAt,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,subject_code,grade,score_date' },
    )

  if (upsertErr) {
    console.error(`[board-score][${correlationId}] upsert failed: ${upsertErr.message}`)
    return errorResponse('Failed to persist board score prediction', 500)
  }

  console.log(
    `[board-score][${correlationId}] success | student=${student_id} subject=${subject_code} ` +
    `grade=${grade} predicted=${Math.round(predictedPct)}% coverage=${Math.round(coveragePct)}%`,
  )

  return jsonResponse({
    code: 'ok',
    message: 'Board score computed and saved',
    data: {
      student_id,
      subject_code,
      grade,
      score_date: scoreDate,
      predicted_score: Math.round(predictedScore * 100) / 100,
      predicted_pct: Math.round(predictedPct * 100) / 100,
      coverage_pct: Math.round(coveragePct * 100) / 100,
      chapters_with_data: chaptersWithData,
      total_chapters: totalChapters,
    },
  })
}

// ── Get latest predictions ─────────────────────────────────────────────────

async function getBoardScores(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
  body: GetRequest,
): Promise<Response> {
  let query = supabase
    .from('board_score_predictions')
    .select(
      'id, subject_code, subject_label, grade, score_date, ' +
      'predicted_score, max_score, predicted_pct, ' +
      'confidence_band_low, confidence_band_high, ' +
      'chapter_scores, recovery_plan, ' +
      'chapters_with_data, total_chapters, coverage_pct, computed_at',
    )
    .eq('student_id', studentId)
    .order('score_date', { ascending: false })
    .order('computed_at', { ascending: false })
    .limit(20)

  if (body.subject_code) query = query.eq('subject_code', body.subject_code)
  if (body.grade)        query = query.eq('grade', body.grade)

  const { data, error } = await query
  if (error) return errorResponse('Failed to fetch board score predictions', 500)

  // Deduplicate: keep only the most recent row per (subject_code, grade) pair
  const seen = new Set<string>()
  const latest = (data ?? []).filter((row: any) => {
    const key = `${row.subject_code}:${row.grade}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return jsonResponse({
    code: 'ok',
    message: 'Board score predictions retrieved',
    data: latest,
  })
}

// ── Entry point ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const correlationId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  // Parse body first (needed to know action before auth routing)
  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  if (!body?.action) {
    return errorResponse('Missing required field: action', 400, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // ── compute: service_role only ────────────────────────────────────────────
  if (body.action === 'compute') {
    const authHeader = req.headers.get('authorization')
    if (!checkBearerToken(authHeader, serviceRoleKey)) {
      console.warn(`[board-score][${correlationId}] compute rejected — bad service_role token`)
      return errorResponse('Unauthorized', 401, origin)
    }

    const { student_id, subject_code, grade } = body as ComputeRequest
    if (!student_id || !subject_code || !grade) {
      return errorResponse('compute requires: student_id, subject_code, grade', 400, origin)
    }

    // Validate UUID format
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRe.test(student_id)) {
      return errorResponse('student_id must be a valid UUID', 400, origin)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const flagEnabled = await isBoardScoreEnabled(supabase)
    if (!flagEnabled) {
      return jsonResponse({ code: 'disabled', message: 'ff_board_score_v1 is disabled' }, 200, {}, origin)
    }

    console.log(`[board-score][${correlationId}] compute start | student=${student_id} subject=${subject_code} grade=${grade}`)

    try {
      return await computeBoardScore(supabase, body as ComputeRequest, correlationId)
    } catch (err) {
      console.error(`[board-score][${correlationId}] compute unhandled: ${String(err)}`)
      return errorResponse('Internal server error', 500, origin)
    }
  }

  // ── get: authenticated student JWT ────────────────────────────────────────
  if (body.action === 'get') {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Authorization required', 401, origin)
    }

    // Build a user-scoped client — RLS policies enforce student-owns-rows
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })

    // Verify token and get user
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return errorResponse('Invalid or expired token', 401, origin)
    }

    // Resolve student_id from auth_user_id
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey)

    const flagEnabled = await isBoardScoreEnabled(sbAdmin)
    if (!flagEnabled) {
      return jsonResponse({ code: 'disabled', message: 'BoardScore™ is not yet available', data: [] }, 200, {}, origin)
    }

    const { data: student, error: studErr } = await sbAdmin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (studErr || !student) {
      return errorResponse('Student profile not found', 404, origin)
    }

    console.log(`[board-score][${correlationId}] get | student=${student.id}`)

    try {
      return await getBoardScores(supabase, student.id, body as GetRequest)
    } catch (err) {
      console.error(`[board-score][${correlationId}] get unhandled: ${String(err)}`)
      return errorResponse('Internal server error', 500, origin)
    }
  }

  return errorResponse(`Unknown action: ${(body as any).action}`, 400, origin)
})
