/**
 * POST /api/cron/synthesis-quality-sample — Phase 8 item 8.6.
 *
 * Nightly LLM-as-judge sampler for Monthly Synthesis, cloned from
 * /api/cron/foxy-quality-sample. For each run:
 *   1. Pick up to SAMPLE_SIZE monthly_synthesis_runs from the last
 *      SAMPLE_WINDOW_DAYS that don't already have a synthesis_quality_scores
 *      row for the current rubric_version (anti-join).
 *   2. Load the student's grade + name (needed for the fabrication-oracle
 *      allowlist + the judge's grade-appropriate tone check). Used
 *      server-side ONLY — never persisted (P13).
 *   3. Call scoreSynthesisSummary() (packages/lib/src/ai/validation/
 *      synthesis-quality-eval.ts): deterministic fabrication oracle +
 *      Sonnet judge, gated by the shared synthesis circuit breaker.
 *   4. INSERT into synthesis_quality_scores. UNIQUE(synthesis_run_id,
 *      rubric_version) makes the run idempotent.
 *
 * Monthly Synthesis is a MONTHLY cadence, so the window is 35 days (not 24h
 * like Foxy) and the sampler chews through the backlog gradually at the small
 * default sample size.
 *
 * Auth: CRON_SECRET (x-cron-secret / Bearer). Same constant-time gate as the
 * other cron routes.
 *
 * Failure mode: scoring is best-effort. A judge miss (rate-limited, breaker
 * open, parse failure, network blip) returns null and is counted `failed` in
 * the payload but NEVER aborts the loop or crashes the cron (P12). Only fatal
 * misconfiguration (missing ANTHROPIC_API_KEY) returns 503.
 *
 * P13: persists scores + a judge note + COUNTS-ONLY oracle findings. Never the
 * summary body, the bundle, the phone, or the student name.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  scoreSynthesisSummary,
  SYNTHESIS_RUBRIC_VERSION,
} from '@alfanumrik/lib/ai/validation/synthesis-quality-eval';
import type { SynthesisBundle } from '@alfanumrik/lib/learn/monthly-synthesis-orchestrator';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SAMPLE_SIZE_DEFAULT = 20;
const SAMPLE_SIZE_MAX = 100;
/** Monthly cadence — sample the last 35 days so a full month is always covered. */
const SAMPLE_WINDOW_DAYS = 35;

// ─── Auth (constant-time, fail-closed) ───────────────────────────────────────

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

// ─── DB row shapes ───────────────────────────────────────────────────────────

interface SynthesisRunRow {
  id: string;
  student_id: string;
  synthesis_month: string;
  bundle: SynthesisBundle;
  summary_text_en: string;
  summary_text_hi: string;
  created_at: string;
}

interface StudentRow {
  id: string;
  name: string;
  grade: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickQuerySize(request: NextRequest): number {
  const raw = new URL(request.url).searchParams.get('n');
  if (!raw) return SAMPLE_SIZE_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return SAMPLE_SIZE_DEFAULT;
  return Math.min(Math.max(parsed, 1), SAMPLE_SIZE_MAX);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error('cron/synthesis-quality-sample: ANTHROPIC_API_KEY not configured');
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 503 });
  }

  const startTime = Date.now();
  const sampleSize = pickQuerySize(request);
  const cutoff = new Date(Date.now() - SAMPLE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

  // ── Step 1: candidate runs from the window ──
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('monthly_synthesis_runs')
    .select('id, student_id, synthesis_month, bundle, summary_text_en, summary_text_hi, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(sampleSize * 5);

  if (candErr) {
    logger.error('cron/synthesis-quality-sample: candidate fetch failed', { error: candErr.message });
    return NextResponse.json(
      { success: false, error: 'Sample fetch failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
  const candidateRows = (candidates ?? []) as SynthesisRunRow[];
  if (candidateRows.length === 0) {
    await recordCronJobHealth({
      path: '/api/cron/synthesis-quality-sample',
      metric: 'ops.cron.synthesis_quality_sample.last_success_at',
      source: 'cron/synthesis-quality-sample',
      durationMs: Date.now() - startTime,
      context: { sampled: 0, scored: 0, failed: 0, skipped: 0 },
    });
    return NextResponse.json({
      success: true, sampled: 0, scored: 0, failed: 0, skipped: 0,
      duration_ms: Date.now() - startTime, rubric_version: SYNTHESIS_RUBRIC_VERSION,
    });
  }

  // ── Step 2: anti-join already-scored runs for this rubric_version ──
  const candidateIds = candidateRows.map((r) => r.id);
  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from('synthesis_quality_scores')
    .select('synthesis_run_id')
    .eq('rubric_version', SYNTHESIS_RUBRIC_VERSION)
    .in('synthesis_run_id', candidateIds);
  if (existingErr) {
    logger.error('cron/synthesis-quality-sample: existing-scores fetch failed', { error: existingErr.message });
    return NextResponse.json(
      { success: false, error: 'Existing-score fetch failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
  const alreadyScored = new Set((existingRows ?? []).map((r) => r.synthesis_run_id as string));
  const toScore = candidateRows.filter((r) => !alreadyScored.has(r.id)).slice(0, sampleSize);

  if (toScore.length === 0) {
    await recordCronJobHealth({
      path: '/api/cron/synthesis-quality-sample',
      metric: 'ops.cron.synthesis_quality_sample.last_success_at',
      source: 'cron/synthesis-quality-sample',
      durationMs: Date.now() - startTime,
      context: { sampled: candidateRows.length, scored: 0, failed: 0, skipped: candidateRows.length },
    });
    return NextResponse.json({
      success: true, sampled: candidateRows.length, scored: 0, failed: 0, skipped: candidateRows.length,
      duration_ms: Date.now() - startTime, rubric_version: SYNTHESIS_RUBRIC_VERSION,
    });
  }

  // ── Step 3: batch-load the students (name + grade) — server-side only ──
  const studentIds = Array.from(new Set(toScore.map((r) => r.student_id)));
  const { data: studentRows } = await supabaseAdmin
    .from('students')
    .select('id, name, grade')
    .in('id', studentIds);
  const studentById = new Map<string, StudentRow>(
    (studentRows ?? []).map((s) => [s.id as string, s as StudentRow]),
  );

  // ── Step 4: score each run + INSERT ──
  let scored = 0;
  let failed = 0;
  for (const run of toScore) {
    const student = studentById.get(run.student_id);
    if (!student) {
      failed += 1;
      continue;
    }

    let result;
    try {
      result = await scoreSynthesisSummary(
        {
          summaryEn: run.summary_text_en,
          summaryHi: run.summary_text_hi,
          bundle: run.bundle,
          studentName: student.name,
          studentGrade: student.grade,
        },
        apiKey,
      );
    } catch (e) {
      // Defensive: scoreSynthesisSummary only throws on missing key (checked
      // above), but never let an unexpected throw crash the sampler.
      logger.warn('cron/synthesis-quality-sample: judge threw', {
        synthesis_run_id: run.id, error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
      continue;
    }

    if (!result) {
      failed += 1;
      continue;
    }

    const { error: insertErr } = await supabaseAdmin
      .from('synthesis_quality_scores')
      .insert({
        synthesis_run_id: run.id,
        student_id: run.student_id,
        grounding_score: result.groundingScore,
        tone_score: result.toneScore,
        no_fabrication_score: result.noFabricationScore,
        cbse_scope_score: result.cbseScopeScore,
        overall_score: result.overallScore,
        judge_model: result.judgeModel,
        rubric_version: result.rubricVersion,
        oracle_findings: result.oracleFindings,
        raw_judge_response: result.rawJudgeResponse,
        notes: result.notes,
      });
    if (insertErr) {
      // UNIQUE-violation race (duplicate cron fire) → silent skip.
      if (!String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
        logger.warn('cron/synthesis-quality-sample: insert failed', {
          error: insertErr.message, synthesis_run_id: run.id,
        });
        failed += 1;
      }
      continue;
    }
    scored += 1;
  }

  const durationMs = Date.now() - startTime;
  logger.info('cron/synthesis-quality-sample: completed', {
    sampled: candidateRows.length, scored, failed, skipped: alreadyScored.size, duration_ms: durationMs,
  });

  await recordCronJobHealth({
    path: '/api/cron/synthesis-quality-sample',
    metric: 'ops.cron.synthesis_quality_sample.last_success_at',
    source: 'cron/synthesis-quality-sample',
    durationMs,
    context: { sampled: candidateRows.length, scored, failed, skipped: alreadyScored.size },
  });

  return NextResponse.json({
    success: true, sampled: candidateRows.length, scored, failed, skipped: alreadyScored.size,
    duration_ms: durationMs, rubric_version: SYNTHESIS_RUBRIC_VERSION,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return POST(request);
}
