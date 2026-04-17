// supabase/functions/verify-question-bank/index.ts
//
// Retroactive verifier cron: drains the question_bank.verification_state =
// 'legacy_unverified' backlog by running each row through the grounded-answer
// service with the quiz_answer_verifier_v1 template. Per spec §8.3.
//
// Schedule: `supabase functions schedule verify-question-bank --cron "*/30 * * * *"`
// (user/ops configures separately — see README).
//
// Contract per run:
//   1. Determine IST hour → peak window (14:00-22:00 IST = 08:30-16:30 UTC).
//   2. Pick batch size: off-peak=1000, peak=250.
//   3. Adaptive throttle: halve batch if grounded_ai_traces last-minute RPM > 2400.
//   4. Claim batch atomically via claim_verification_batch RPC.
//   5. For each claimed row: call grounded-answer with quiz_answer_verifier_v1
//      and update the row based on the verifier verdict.
//   6. 429 / upstream_error: exponential backoff (5,10,20,40s); after 4 retries,
//      release the claim (let the claim TTL expire naturally).
//   7. Emit `grounding.verifier.batch_complete` ops_event with stats.
//
// Idempotency: the claim RPC + TTL make concurrent/repeated runs safe.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { callGroundedAnswer } from '../_shared/grounded-client.ts';
import { logOpsEvent } from '../_shared/ops-events.ts';
import {
  decideBatchSize,
  isPeakHourIST,
  shouldThrottle,
  DEFAULT_CLAIM_TTL_SECONDS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  THROTTLE_RPM_THRESHOLD,
} from './shared.ts';

interface QuestionRow {
  id: string;
  question_text: string;
  options: string[] | null;
  correct_answer_index: number | null;
  explanation: string | null;
  grade: string;
  subject: string;
  chapter_number: number | null;
  chapter_title: string | null;
}

interface VerifierVerdict {
  verified: boolean;
  correct_option_index: number | null;
  supporting_chunk_ids: string[];
  reason?: string;
}

/**
 * Format a question_bank row into the `query` field the verifier template
 * expects. The prompt template reads `question_json` — we serialize the
 * minimal fields the verifier needs to make a decision.
 */
export function formatForVerification(row: QuestionRow): string {
  return JSON.stringify({
    question: row.question_text,
    options: row.options ?? [],
    claimed_correct_index: row.correct_answer_index,
    explanation: row.explanation ?? '',
  });
}

/**
 * Parse verifier response. The grounded-answer service returns `answer` as
 * a string; the quiz_answer_verifier_v1 template instructs Claude to emit
 * strict JSON, but we defensively parse and fall back to failure.
 */
function parseVerdict(answerText: string): VerifierVerdict | null {
  try {
    // Strip possible markdown code fences
    const clean = answerText
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(clean);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.verified !== 'boolean') return null;
    return {
      verified: parsed.verified,
      correct_option_index:
        typeof parsed.correct_option_index === 'number' ? parsed.correct_option_index : null,
      supporting_chunk_ids: Array.isArray(parsed.supporting_chunk_ids)
        ? parsed.supporting_chunk_ids.filter((x: unknown): x is string => typeof x === 'string')
        : [],
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Query grounded_ai_traces for calls in the last minute. Used for adaptive
 * throttle. Returns -1 on error so callers can treat it as "unknown" and
 * stay at default batch size.
 */
async function getLastMinuteRPM(supabase: ReturnType<typeof createClient>): Promise<number> {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await supabase
    .from('grounded_ai_traces')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneMinuteAgo);
  if (error) return -1;
  return count ?? 0;
}

/**
 * Call the grounded-answer service for one question. Retries on upstream_error
 * up to MAX_RETRIES with exponential backoff. Returns null to signal "give up"
 * so the caller can release the claim.
 */
async function verifyOneRow(
  row: QuestionRow,
): Promise<{ verdict: VerifierVerdict | null; traceId: string; model: string; chunkIds: string[] } | null> {
  const query = formatForVerification(row);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await callGroundedAnswer(
      {
        caller: 'quiz-generator',
        student_id: null,
        query,
        scope: {
          board: 'CBSE',
          grade: row.grade,
          subject_code: row.subject,
          chapter_number: row.chapter_number,
          chapter_title: row.chapter_title,
        },
        mode: 'strict',
        generation: {
          model_preference: 'haiku',
          max_tokens: 400,
          temperature: 0.0,
          system_prompt_template: 'quiz_answer_verifier_v1',
          template_variables: { question_json: query },
        },
        retrieval: { match_count: 8 },
        timeout_ms: 15000,
      },
      { hopTimeoutMs: 20000 },
    );

    if (response.grounded) {
      const verdict = parseVerdict(response.answer);
      return {
        verdict,
        traceId: response.trace_id,
        model: response.meta.claude_model,
        chunkIds: response.citations.map((c) => c.chunk_id),
      };
    }

    // Abstain path: if upstream_error, retry with backoff; else treat as
    // permanent failure (chapter_not_ready → mark failed so we don't loop).
    if (response.abstain_reason === 'upstream_error' || response.abstain_reason === 'circuit_open') {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      // Exhausted retries → release claim (return null, don't write)
      return null;
    }

    // Non-retryable abstain (chapter_not_ready, no_chunks_retrieved, etc.) →
    // mark failed with the abstain reason so the ingestion team can triage.
    return {
      verdict: { verified: false, correct_option_index: null, supporting_chunk_ids: [], reason: `abstain:${response.abstain_reason}` },
      traceId: response.trace_id,
      model: '',
      chunkIds: [],
    };
  }

  return null;
}

async function processBatch(
  supabase: ReturnType<typeof createClient>,
  claimedBy: string,
  batchSize: number,
): Promise<{ claimed: number; verified: number; failed: number; released: number }> {
  const { data: claimed, error: claimError } = await supabase.rpc('claim_verification_batch', {
    p_batch_size: batchSize,
    p_claimed_by: claimedBy,
    p_claim_ttl_seconds: DEFAULT_CLAIM_TTL_SECONDS,
  });

  if (claimError) {
    await logOpsEvent({
      category: 'grounding.verifier',
      source: 'verify-question-bank',
      severity: 'error',
      message: 'claim_verification_batch RPC failed',
      context: { error: claimError.message },
    });
    return { claimed: 0, verified: 0, failed: 0, released: 0 };
  }

  const rows = (claimed ?? []) as QuestionRow[];
  let verified = 0;
  let failed = 0;
  let released = 0;

  for (const row of rows) {
    const result = await verifyOneRow(row);

    // Null → retries exhausted → release the claim (revert state so next
    // run picks it up again). We do NOT mark failed because the upstream
    // error is our fault, not the question's.
    if (!result) {
      released++;
      await supabase
        .from('question_bank')
        .update({
          verification_state: 'legacy_unverified',
          verification_claimed_by: null,
          verification_claim_expires_at: null,
        })
        .eq('id', row.id);
      continue;
    }

    const { verdict, traceId, model, chunkIds } = result;
    const isVerified = verdict?.verified === true
      && verdict.correct_option_index === row.correct_answer_index;

    const newState = isVerified ? 'verified' : 'failed';
    const updatePayload: Record<string, unknown> = {
      verification_state: newState,
      verified_against_ncert: isVerified,
      verifier_trace_id: traceId,
      verifier_model: model,
      verified_at: new Date().toISOString(),
      verifier_chunk_ids: chunkIds.length > 0 ? chunkIds : (verdict?.supporting_chunk_ids ?? []),
      verifier_failure_reason: isVerified ? null : (verdict?.reason ?? 'verifier_disagreement'),
      verification_claimed_by: null,
      verification_claim_expires_at: null,
    };

    const { error: updateError } = await supabase
      .from('question_bank')
      .update(updatePayload)
      .eq('id', row.id);

    if (updateError) {
      failed++;
      continue;
    }

    if (isVerified) verified++;
    else failed++;
  }

  return { claimed: rows.length, verified, failed, released };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const claimedBy = `verify-question-bank:${runId}`;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();
  const peak = isPeakHourIST(now);
  const rpm = await getLastMinuteRPM(supabase);
  const throttled = shouldThrottle(rpm, THROTTLE_RPM_THRESHOLD);
  const batchSize = decideBatchSize({ peak, throttled });

  try {
    const stats = await processBatch(supabase, claimedBy, batchSize);

    await logOpsEvent({
      category: 'grounding.verifier',
      source: 'verify-question-bank',
      severity: 'info',
      message: 'batch_complete',
      context: {
        run_id: runId,
        peak,
        rpm,
        throttled,
        batch_size: batchSize,
        claimed: stats.claimed,
        verified: stats.verified,
        failed: stats.failed,
        released: stats.released,
        duration_ms: Date.now() - startedAt,
      },
    });

    return new Response(
      JSON.stringify({ success: true, run_id: runId, batch_size: batchSize, ...stats }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    await logOpsEvent({
      category: 'grounding.verifier',
      source: 'verify-question-bank',
      severity: 'error',
      message: 'batch_run_exception',
      context: {
        run_id: runId,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startedAt,
      },
    });
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});