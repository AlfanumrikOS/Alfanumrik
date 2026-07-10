/**
 * POST /api/cron/foxy-quality-sample — B'-1 Phase 2.
 *
 * Nightly sampler that drives the LLM-as-judge eval pipeline shipped in
 * Phase 1 (#631). For each run:
 *   1. Pick up to SAMPLE_SIZE assistant turns from the last 24h that don't
 *      already have a foxy_quality_scores row for the current rubric_version.
 *   2. Pull the matching session (grade/subject) and message metadata
 *      (content, sources, coach_mode_used).
 *   3. Call scoreFoxyAnswer() (src/lib/foxy/quality-eval.ts) which calls
 *      Sonnet via raw fetch and returns a 4-dimension rubric score.
 *   4. INSERT into foxy_quality_scores. UNIQUE(message_id, rubric_version)
 *      makes the run idempotent — a second invocation in the same night is
 *      a no-op for already-scored messages.
 *
 * Schedule: nightly at 03:40 UTC (09:10 IST) — after daily-cron 02:30 and
 * irt-calibrate 02:50 so we don't fight for the same DB connection budget.
 *
 * Cost: ~20 turns × Sonnet × ~3k input + ~400 output tokens = ~$0.50/night
 * = ~$15/month at the default sample size. Bump SAMPLE_SIZE_DEFAULT down if
 * costs need to be tighter; bump up once the dashboard surfaces value.
 *
 * Auth: x-cron-secret header (Vercel Cron sets it). Same pattern as
 * /api/cron/daily-cron — see verifyCronSecret().
 *
 * Failure mode: scoring is best-effort. A judge call that returns null
 * (rate-limited, parse failure, network blip) is counted as `failed` in
 * the response payload but does NOT abort the loop — the cron tries the
 * next message. Only fatal misconfiguration (missing ANTHROPIC_API_KEY,
 * missing service-role) returns 503. Manual super-admin invocation (Phase
 * 3) will be able to re-target a specific message_id and bypass the
 * 24h window.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  scoreFoxyAnswer,
  RUBRIC_VERSION,
  type QualityScoreInput,
} from '@alfanumrik/lib/foxy/quality-eval';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Tunables ────────────────────────────────────────────────────────────────

/**
 * Default sample size per nightly run. Set deliberately small for cost
 * control during the rollout; can be raised once the dashboard demonstrates
 * the rubric is producing actionable signal.
 *
 * Caller can override via `?n=` query (clamped to [1, 100]) for ad-hoc
 * super-admin invocations during the initial calibration window.
 */
const SAMPLE_SIZE_DEFAULT = 20;
const SAMPLE_SIZE_MAX = 100;

/** Sample window — only messages from the last 24h are eligible. */
const SAMPLE_WINDOW_HOURS = 24;

// ─── Auth ────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
  if (cronSecret.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cronSecret.length; i++) {
    mismatch |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Types (DB row shapes) ───────────────────────────────────────────────────

interface ChatMessageRow {
  id: string;
  session_id: string;
  student_id: string;
  content: string;
  sources: unknown; // jsonb — array of citation objects (see foxy/route.ts)
  coach_mode_used: 'socratic' | 'answer' | 'review' | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  grade: string;
  subject: string;
}

interface SourceCitation {
  chunk_id?: string;
  chapter?: string;
  page_number?: number;
  content_preview?: string;
  // (other fields ignored — we only need text + chapter + page for the judge)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickQuerySize(request: NextRequest): number {
  const raw = new URL(request.url).searchParams.get('n');
  if (!raw) return SAMPLE_SIZE_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return SAMPLE_SIZE_DEFAULT;
  return Math.min(Math.max(parsed, 1), SAMPLE_SIZE_MAX);
}

/** Convert persisted `sources` jsonb to the shape scoreFoxyAnswer expects. */
function normaliseCitations(sources: unknown): QualityScoreInput['citations'] {
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((s): s is SourceCitation => typeof s === 'object' && s !== null)
    .map((s) => ({
      chunk_text: typeof s.content_preview === 'string' ? s.content_preview : '',
      chapter_title: typeof s.chapter === 'string' ? s.chapter : null,
      page_number: typeof s.page_number === 'number' ? s.page_number : null,
    }))
    .filter((c) => c.chunk_text.length > 0);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error('cron/foxy-quality-sample: ANTHROPIC_API_KEY not configured');
    return NextResponse.json(
      { success: false, error: 'Server not configured' },
      { status: 503 },
    );
  }

  const startTime = Date.now();
  const sampleSize = pickQuerySize(request);
  const cutoff = new Date(Date.now() - SAMPLE_WINDOW_HOURS * 3600 * 1000).toISOString();

  // ── Step 1: candidate messages from the window ───────────────────────────
  // Read more than sampleSize so we can filter out already-scored ones in
  // step 2 without paginating. 5x is an empirical ceiling — beyond that the
  // anti-join below is cheaper as a separate query.
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('id, session_id, student_id, content, sources, coach_mode_used, created_at')
    .eq('role', 'assistant')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(sampleSize * 5);

  if (candErr) {
    logger.error('cron/foxy-quality-sample: candidate fetch failed', {
      error: candErr.message,
    });
    return NextResponse.json(
      { success: false, error: 'Sample fetch failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
  const candidateRows = (candidates ?? []) as ChatMessageRow[];
  if (candidateRows.length === 0) {
    const durationMs = Date.now() - startTime;
    await recordCronJobHealth({
      path: '/api/cron/foxy-quality-sample',
      metric: 'ops.cron.foxy_quality_sample.last_success_at',
      source: 'cron/foxy-quality-sample',
      durationMs,
      context: { sampled: 0, scored: 0, failed: 0, skipped: 0 },
    });
    return NextResponse.json({
      success: true,
      sampled: 0,
      scored: 0,
      failed: 0,
      skipped: 0,
      duration_ms: Date.now() - startTime,
      rubric_version: RUBRIC_VERSION,
    });
  }

  // ── Step 2: filter out messages that already have a score for this version
  const candidateIds = candidateRows.map((m) => m.id);
  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from('foxy_quality_scores')
    .select('message_id')
    .eq('rubric_version', RUBRIC_VERSION)
    .in('message_id', candidateIds);
  if (existingErr) {
    logger.error('cron/foxy-quality-sample: existing-scores fetch failed', {
      error: existingErr.message,
    });
    return NextResponse.json(
      { success: false, error: 'Existing-score fetch failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
  const alreadyScored = new Set(
    (existingRows ?? []).map((r) => r.message_id as string),
  );
  const toScore = candidateRows.filter((m) => !alreadyScored.has(m.id)).slice(0, sampleSize);

  if (toScore.length === 0) {
    const durationMs = Date.now() - startTime;
    await recordCronJobHealth({
      path: '/api/cron/foxy-quality-sample',
      metric: 'ops.cron.foxy_quality_sample.last_success_at',
      source: 'cron/foxy-quality-sample',
      durationMs,
      context: { sampled: candidateRows.length, scored: 0, failed: 0, skipped: candidateRows.length },
    });
    return NextResponse.json({
      success: true,
      sampled: candidateRows.length,
      scored: 0,
      failed: 0,
      skipped: candidateRows.length,
      duration_ms: Date.now() - startTime,
      rubric_version: RUBRIC_VERSION,
    });
  }

  // ── Step 3: load sessions in a single batch fetch ────────────────────────
  const sessionIds = Array.from(new Set(toScore.map((m) => m.session_id)));
  const { data: sessionRows } = await supabaseAdmin
    .from('foxy_sessions')
    .select('id, grade, subject')
    .in('id', sessionIds);
  const sessionById = new Map<string, SessionRow>(
    (sessionRows ?? []).map((s) => [s.id as string, s as SessionRow]),
  );

  // ── Step 4: score each message and INSERT result ─────────────────────────
  // We also need each message's preceding `user` row to feed the judge as
  // the question. Pull all user rows for the relevant sessions in one go,
  // then walk per assistant message to find the closest-prior user message.
  const { data: userRows } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('id, session_id, content, created_at')
    .in('session_id', sessionIds)
    .eq('role', 'user')
    .order('created_at', { ascending: true });
  const userBySession = new Map<string, Array<{ content: string; created_at: string }>>();
  for (const u of (userRows ?? []) as Array<{ session_id: string; content: string; created_at: string }>) {
    const arr = userBySession.get(u.session_id) ?? [];
    arr.push({ content: u.content, created_at: u.created_at });
    userBySession.set(u.session_id, arr);
  }

  let scored = 0;
  let failed = 0;
  for (const msg of toScore) {
    const session = sessionById.get(msg.session_id);
    if (!session) {
      failed += 1;
      continue;
    }
    // Find the user message immediately preceding this assistant message.
    const userTurns = userBySession.get(msg.session_id) ?? [];
    let question = '';
    for (let i = userTurns.length - 1; i >= 0; i--) {
      if (userTurns[i].created_at < msg.created_at) {
        question = userTurns[i].content;
        break;
      }
    }
    if (!question) {
      failed += 1;
      continue;
    }

    const result = await scoreFoxyAnswer(
      {
        question,
        answer: msg.content,
        citations: normaliseCitations(msg.sources),
        grade: session.grade,
        subject: session.subject,
        coachMode: msg.coach_mode_used,
      },
      apiKey,
    );

    if (!result) {
      failed += 1;
      continue;
    }

    const { error: insertErr } = await supabaseAdmin
      .from('foxy_quality_scores')
      .insert({
        message_id: msg.id,
        session_id: msg.session_id,
        student_id: msg.student_id,
        accuracy_score: result.accuracyScore,
        scaffold_fidelity_score: result.scaffoldFidelityScore,
        age_appropriateness_score: result.ageAppropriatenessScore,
        cbse_scope_score: result.cbseScopeScore,
        overall_score: result.overallScore,
        judge_model: result.judgeModel,
        rubric_version: result.rubricVersion,
        raw_judge_response: result.rawJudgeResponse,
        notes: result.notes,
      });
    if (insertErr) {
      // UNIQUE-violation race (duplicate cron fire) → silently skip; treat as
      // already-scored. Anything else is a real failure.
      if (!String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
        logger.warn('cron/foxy-quality-sample: insert failed', {
          error: insertErr.message,
          message_id: msg.id,
        });
        failed += 1;
      }
      continue;
    }
    scored += 1;
  }

  const durationMs = Date.now() - startTime;
  logger.info('cron/foxy-quality-sample: completed', {
    sampled: candidateRows.length,
    scored,
    failed,
    skipped: alreadyScored.size,
    duration_ms: durationMs,
  });

  await recordCronJobHealth({
    path: '/api/cron/foxy-quality-sample',
    metric: 'ops.cron.foxy_quality_sample.last_success_at',
    source: 'cron/foxy-quality-sample',
    durationMs,
    context: { sampled: candidateRows.length, scored, failed, skipped: alreadyScored.size },
  });

  return NextResponse.json({
    success: true,
    sampled: candidateRows.length,
    scored,
    failed,
    skipped: alreadyScored.size,
    duration_ms: durationMs,
    rubric_version: RUBRIC_VERSION,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return POST(request);
}
