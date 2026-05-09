// monthly-synthesis-builder v1 — Pedagogy v2 Wave 3 Task 4.
//
// Builds the structured bundle for a (student, month) and writes it to
// monthly_synthesis_runs. The bilingual parent-share text is intentionally
// LEFT EMPTY at insert time — the summary is generated lazily by the
// Next.js side (Task 5's /api/synthesis/state) when the student first views
// the synthesis. This keeps the Claude API call in the same module that
// owns the prompt builder (src/lib/ai/workflows/synthesis-summary.ts) and
// avoids duplicating prompt logic across the Next.js / Deno boundary.
//
// POST body:
//   { student_id: uuid, synthesis_month: 'YYYY-MM' }
// Auth:
//   x-cron-secret header matching CRON_SECRET env var. Same convention as
//   other internal Edge Functions (daily-cron, etc).
// Returns:
//   { id: uuid, alreadyExists: boolean, bundle: SynthesisBundle }
//
// Idempotent on (student_id, synthesis_month) via the UNIQUE constraint
// from migration 20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql.
//
// Audit findings encoded:
//   C5 — no month-bounded HPC RPC exists; we compute approximate deltas
//        from concept_mastery + curriculum_topics joined by month boundary.
//   C4 — no chapter-mock summary RPC exists; we derive it from the same
//        chapters-touched data (2 questions per chapter, capped at 20,
//        target difficulty 0.55 fixed for v1).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://alfanumrik.com',
  'https://www.alfanumrik.com',
  'https://alfanumrik.vercel.app',
]
function corsHeaders(origin?: string | null): Record<string, string> {
  const isAllowed =
    origin &&
    (ALLOWED_ORIGINS.includes(origin) ||
      (origin.endsWith('.vercel.app') && origin.includes('alfanumrik')))
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function jsonResponse(body: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─── Month boundary helper (matches src/lib/learn/monthly-synthesis-orchestrator.ts) ──
function monthBoundariesOf(monthLabel: string): { startIso: string; endIso: string } | null {
  const m = monthLabel.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1 // 0-indexed
  if (!Number.isFinite(year) || month < 0 || month > 11) return null
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 1))
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

// ─── Bundle builder ────────────────────────────────────────────────────────
interface SynthesisBundle {
  monthLabel: string
  weeklyArtifactIds: string[]
  masteryDelta: {
    chaptersTouched: string[]
    topicsMastered: number
    topicsImproved: number
    topicsRegressed: number
  }
  chapterMockSummary: {
    chapters: string[]
    totalQuestions: number
    targetDifficulty: number
  } | null
}

interface CmRow {
  topic_id: string
  mastery_probability: number | null
  mastery_level: string | null
  total_attempts: number | null
  last_attempted_at: string | null
}

interface TopicRow {
  id: string
  title: string | null
  chapter_number: number | null
}

const TARGET_DIFFICULTY_V1 = 0.55
const MOCK_QUESTIONS_PER_CHAPTER = 2
const MOCK_QUESTIONS_CAP = 20
const MASTERY_IMPROVED_THRESHOLD = 0.5

async function buildBundle(
  supabase: SupabaseClient,
  studentId: string,
  monthLabel: string,
): Promise<{ bundle: SynthesisBundle | null; error?: string }> {
  const bounds = monthBoundariesOf(monthLabel)
  if (!bounds) return { bundle: null, error: 'invalid_synthesis_month_format' }

  // 1. Weekly artifact ids for the month.
  const { data: artifactRows, error: artErr } = await supabase
    .from('dive_artifacts')
    .select('id, iso_week')
    .eq('student_id', studentId)
    .gte('created_at', bounds.startIso)
    .lt('created_at', bounds.endIso)
    .order('iso_week', { ascending: true })
  if (artErr) return { bundle: null, error: `artifact_fetch_failed: ${artErr.message}` }
  const weeklyArtifactIds = (artifactRows ?? []).map((r) => (r as { id: string }).id)

  // 2. Concept-mastery rows touched this month (last_attempted_at proxy).
  const { data: cmRows, error: cmErr } = await supabase
    .from('concept_mastery')
    .select('topic_id, mastery_probability, mastery_level, total_attempts, last_attempted_at')
    .eq('student_id', studentId)
    .gte('last_attempted_at', bounds.startIso)
    .lt('last_attempted_at', bounds.endIso)
  if (cmErr) return { bundle: null, error: `mastery_fetch_failed: ${cmErr.message}` }
  const cmList: CmRow[] = (cmRows ?? []) as CmRow[]

  const touchedTopicIds = cmList.map((r) => r.topic_id).filter(Boolean)
  const topicsMastered = cmList.filter((r) => r.mastery_level === 'mastered').length
  const topicsImproved = cmList.filter(
    (r) => (r.mastery_probability ?? 0) > MASTERY_IMPROVED_THRESHOLD && (r.total_attempts ?? 0) > 0,
  ).length
  // V1 simplification: regressions need historical snapshots we don't have.
  // Reported as 0 with a note in the prompt's empty-month branch handled
  // upstream; full regression detection is a future enhancement.
  const topicsRegressed = 0

  // 3. Curriculum topics → chapter titles for chaptersTouched.
  let chaptersTouched: string[] = []
  if (touchedTopicIds.length > 0) {
    const { data: topicRows, error: topicErr } = await supabase
      .from('curriculum_topics')
      .select('id, title, chapter_number')
      .in('id', touchedTopicIds)
    if (topicErr) return { bundle: null, error: `topic_fetch_failed: ${topicErr.message}` }
    const titles = new Set<string>()
    for (const r of (topicRows ?? []) as TopicRow[]) {
      const t = r.title ?? ''
      if (t.length > 0) titles.add(t)
    }
    chaptersTouched = Array.from(titles).slice(0, 12) // soft cap for prompt readability
  }

  // 4. Chapter mock summary derived from chaptersTouched.
  const chapterMockSummary = chaptersTouched.length > 0
    ? {
        chapters: chaptersTouched.slice(0, 6),
        totalQuestions: Math.min(MOCK_QUESTIONS_CAP, chaptersTouched.length * MOCK_QUESTIONS_PER_CHAPTER),
        targetDifficulty: TARGET_DIFFICULTY_V1,
      }
    : null

  return {
    bundle: {
      monthLabel,
      weeklyArtifactIds,
      masteryDelta: {
        chaptersTouched,
        topicsMastered,
        topicsImproved,
        topicsRegressed,
      },
      chapterMockSummary,
    },
  }
}

// ─── HTTP handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  // Cron-secret auth (service-role caller, no end-user JWT).
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const provided = req.headers.get('x-cron-secret') ?? ''
  if (!expected || !constantTimeEqual(expected, provided)) {
    return jsonResponse({ error: 'unauthorized' }, 401, origin)
  }

  let body: { student_id?: string; synthesis_month?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  if (!body.student_id || typeof body.student_id !== 'string') {
    return jsonResponse({ error: 'missing_student_id' }, 400, origin)
  }
  if (!body.synthesis_month || !/^\d{4}-\d{2}$/.test(body.synthesis_month)) {
    return jsonResponse({ error: 'invalid_synthesis_month' }, 400, origin)
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceKey) return jsonResponse({ error: 'server_misconfigured' }, 500, origin)
  const supabase = createClient(url, serviceKey)

  // Short-circuit if the row already exists (idempotent).
  const { data: existing, error: existingErr } = await supabase
    .from('monthly_synthesis_runs')
    .select('id, bundle')
    .eq('student_id', body.student_id)
    .eq('synthesis_month', body.synthesis_month)
    .maybeSingle()
  if (existingErr) {
    return jsonResponse({ error: `existing_check_failed: ${existingErr.message}` }, 500, origin)
  }
  if (existing) {
    return jsonResponse({
      id: (existing as { id: string }).id,
      alreadyExists: true,
      bundle: (existing as { bundle: SynthesisBundle }).bundle,
    }, 200, origin)
  }

  // Build the bundle.
  const { bundle, error: buildErr } = await buildBundle(
    supabase,
    body.student_id,
    body.synthesis_month,
  )
  if (!bundle) return jsonResponse({ error: buildErr ?? 'bundle_build_failed' }, 500, origin)

  // Insert. summary_text_en and summary_text_hi are intentionally empty —
  // Task 5's /api/synthesis/state lazy-fills via Claude on first view.
  const { data: inserted, error: insertErr } = await supabase
    .from('monthly_synthesis_runs')
    .insert({
      student_id: body.student_id,
      synthesis_month: body.synthesis_month,
      bundle,
      summary_text_en: '',
      summary_text_hi: '',
      parent_share_status: 'pending',
    })
    .select('id')
    .single()
  if (insertErr) {
    // 23505 = unique_violation — race with another invocation, treat as already exists.
    if ((insertErr as { code?: string }).code === '23505') {
      return jsonResponse({ alreadyExists: true, bundle }, 200, origin)
    }
    return jsonResponse({ error: `insert_failed: ${insertErr.message}` }, 500, origin)
  }

  return jsonResponse({
    id: (inserted as { id: string }).id,
    alreadyExists: false,
    bundle,
  }, 200, origin)
})
