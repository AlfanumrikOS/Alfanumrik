/**
 * P3 anti-cheat: this endpoint MUST only return remediation for a (question_id, distractor_index)
 * the student has already submitted as a wrong answer in their quiz history. All other cases
 * (correct answer, no submission, distractor mismatch) MUST return identical 403 responses to
 * prevent oracle attacks that probe correctness. See assessment review 2026-04-26.
 */

/**
 * /api/foxy/remediation — Misconception Remediation Stopgap (Phase 2.3)
 *
 * Given (question_id, distractor_index), returns a 2-sentence remediation
 * snippet explaining why that distractor is wrong. Phase 3 will replace
 * this LLM-cached path with a curated misconception bank authored by
 * the assessment team.
 *
 * Cache contract (table `wrong_answer_remediations`):
 *  - UNIQUE(question_id, distractor_index) — same cached snippet for every
 *    student who hits the same wrong answer.
 *  - Service-role inserts only; authenticated read (no PII stored).
 *
 * P12 (AI safety) posture — see generateWithHaiku() for the details:
 *  - Rule 2 (no unfiltered LLM output): every student-facing string is run
 *    through `screenStudentFacingText` in BOTH languages. Because the cache
 *    row is durable and shared, screening happens BEFORE the INSERT, not just
 *    before the response — a rejected completion leaves no row behind. Cached
 *    rows are ALSO screened on read, since rows written before this screen
 *    existed were never checked.
 *  - Rule 5 (circuit breaker): the Claude call goes through `callClaude`,
 *    which owns the breaker, retry/backoff, timeout and model fallback. This
 *    route no longer hand-rolls a fetch to the Anthropic endpoint.
 *  - Every generation failure mode (no key, upstream error, breaker open,
 *    empty completion, screening rejection) collapses into one identical 503
 *    so no new oracle is introduced alongside the P3 uniform 403.
 *
 * Wire: this endpoint is intentionally NOT yet wired from the quiz UI —
 * the assessment + frontend agents will integrate it after the curated
 * bank lands.
 *
 * POST /api/foxy/remediation
 * Body: { question_id: uuid, distractor_index: 0..3 }
 * Response (success):
 *   { success: true, remediation: string, remediation_hi: string|null,
 *     source: 'cache' | 'llm', cached: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { callClaude } from '@alfanumrik/lib/ai/clients/claude';
import { screenStudentFacingText } from '@alfanumrik/lib/ai/validation/output-screen';
// Daily-quota gate (P12 rule 4) — the SAME helper + RPC pair (/api/foxy →
// check_and_record_usage → get_plan_limit) that meters Foxy chat. Remediation
// is Claude inference inside the Foxy tutoring flow, so it debits the same
// daily `foxy_chat` bucket (DB-authoritative per-plan cap; unlimited for the
// paid plans). The bilingual errorJson is imported ALIASED because this route
// has its own single-language errorJson used by the P3 uniform-403 machinery.
import { checkAndIncrementQuota, refundQuota } from '../_lib/quota';
import { errorJson as bilingualErrorJson } from '../_lib/constants';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const REMEDIATION_TIMEOUT_MS = 8_000;

const REMEDIATION_SYSTEM_PROMPT =
  'You are an Indian CBSE tutor writing a 2-sentence remediation for a student who picked the wrong answer. ' +
  'Sentence 1: name the misconception in plain English. ' +
  'Sentence 2: a 1-line correction or example pointing to the right idea. ' +
  'Then on a new line, write the same remediation in simple Hindi prefixed with "HI: ". ' +
  'No greetings, no markdown, no citations.';

function errorJson(message: string, status: number, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

/**
 * Single canonical "we will not generate remediation for this request"
 * response. P3 anti-cheat: the SAME shape and SAME status code MUST be
 * returned for every non-eligible case (no matching wrong submission,
 * distractor === correct_answer_index, student never attempted, etc.) so
 * an attacker cannot use response shape, length, or status to learn the
 * correct answer.
 */
function remediationUnavailable(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'remediation_unavailable' },
    { status: 403 },
  );
}

interface RemediationRow {
  remediation_text: string;
  remediation_text_hi: string | null;
}

async function fetchCached(
  questionId: string,
  distractorIndex: number,
): Promise<RemediationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('wrong_answer_remediations')
    .select('remediation_text, remediation_text_hi')
    .eq('question_id', questionId)
    .eq('distractor_index', distractorIndex)
    .maybeSingle();
  if (error || !data) return null;
  return data as RemediationRow;
}

async function fetchQuestion(questionId: string): Promise<{
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  subject: string | null;
  grade: string | null;
} | null> {
  const { data } = await supabaseAdmin
    .from('quiz_questions')
    .select('question_text, options, correct_answer_index, explanation, subject, grade')
    .eq('id', questionId)
    .maybeSingle();
  if (!data) return null;
  return data as {
    question_text: string;
    options: string[];
    correct_answer_index: number;
    explanation: string | null;
    subject: string | null;
    grade: string | null;
  };
}

/**
 * P3 anti-cheat attestation gate.
 *
 * Returns true ONLY if the student has already submitted `distractorIndex`
 * as a wrong answer for this `questionId` in their own quiz history.
 *
 * This query bypasses RLS (service role) intentionally — RLS is the wrong
 * layer to enforce attestation: a student CAN read their own quiz_responses
 * via RLS, so an RLS-respecting check would pass for any answer they
 * submitted, but we need to verify both (a) it was THIS distractor and
 * (b) it was wrong. We do that here so the gate is uniform and the caller
 * cannot influence it via header tricks.
 *
 * IMPORTANT: every "no" outcome (no row, query error, missing student id)
 * must collapse into a single `false` so the caller returns the same
 * `remediation_unavailable` shape regardless of which branch failed. Do
 * NOT add new error reasons here.
 */
/**
 * Phase 3 moat plan: curated misconception lookup.
 *
 * If the editorial team has annotated this (question_id, distractor_index),
 * return the canonical misconception_label (and Hindi if present) so we can
 * anchor the Haiku prompt on it. When no curation exists, returns null and
 * the prompt falls back to the question + correct-option only.
 */
interface CuratedMisconception {
  code: string;
  label: string;
  label_hi: string | null;
}

async function fetchCuratedMisconception(
  questionId: string,
  distractorIndex: number,
): Promise<CuratedMisconception | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("question_misconceptions")
      .select("misconception_code, misconception_label, misconception_label_hi")
      .eq("question_id", questionId)
      .eq("distractor_index", distractorIndex)
      .maybeSingle();
    if (error || !data) return null;
    return {
      code: data.misconception_code,
      label: data.misconception_label,
      label_hi: data.misconception_label_hi ?? null,
    };
  } catch {
    return null;
  }
}

async function studentHasSubmittedDistractor(
  studentId: string,
  questionId: string,
  distractorIndex: number,
): Promise<boolean> {
  try {
    // quiz_responses.student_answer_index holds the 0..3 index (not _index suffix);
    // join via quiz_session_id to confirm ownership. We require is_correct=false
    // so submitting the correct answer never unlocks remediation.
    const { data, error } = await supabaseAdmin
      .from('quiz_responses')
      .select('id, quiz_sessions!inner(student_id)')
      .eq('quiz_sessions.student_id', studentId)
      .eq('question_id', questionId)
      .eq("student_answer_index", distractorIndex)
      .eq('is_correct', false)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authorizeRequest(request, 'foxy.chat', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  // Honor the global AI kill switch.
  if (!(await isFeatureEnabled('ai_usage_global'))) {
    return errorJson('Remediation is temporarily unavailable.', 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorJson('Invalid request body.', 400);
  }

  const questionId = typeof body.question_id === 'string' ? body.question_id.trim() : '';
  const distractorIndex =
    typeof body.distractor_index === 'number' ? body.distractor_index : -1;

  if (!questionId) return errorJson('question_id is required.', 400);
  if (!Number.isInteger(distractorIndex) || distractorIndex < 0 || distractorIndex > 3) {
    return errorJson('distractor_index must be 0..3.', 400);
  }

  // P3 attestation gate — must come BEFORE any cache lookup or question
  // fetch so that an attacker cannot tell "valid request, cache miss" from
  // "this is the correct answer" or "you never attempted this question".
  // All three collapse to the same 403 below.
  const studentId = auth.studentId;
  if (!studentId) return remediationUnavailable();

  const eligible = await studentHasSubmittedDistractor(
    studentId,
    questionId,
    distractorIndex,
  );
  if (!eligible) {
    // Identical response shape used for: no matching wrong submission,
    // distractor_index === correct_answer_index (collapsed below into the
    // same gate via is_correct=false filter), student never attempted,
    // attestation query errored. P3 oracle closure.
    logger.info('foxy_remediation_attestation_denied', {
      student_id: studentId,
      question_id: questionId,
      distractor_index: distractorIndex,
    });
    return remediationUnavailable();
  }

  // 1. Cache lookup.
  const cached = await fetchCached(questionId, distractorIndex);
  if (cached) {
    // P12: screen on READ as well as on write. Rows written BEFORE output
    // screening existed on this route were never screened, and the cache is
    // durable — UNIQUE(question_id, distractor_index) means one such row is
    // replayed to every future student who picks that distractor. Screening
    // the write path alone would leave that pre-existing population unfiltered.
    // We refuse to serve a failing row (same 503 as a generation failure) but
    // deliberately do NOT delete it: deletion here would let a screening
    // false-positive silently destroy curated content, and the row is already
    // unreachable to students either way.
    const safe = remediationTextIsSafe(
      [cached.remediation_text, cached.remediation_text_hi],
      { grade: undefined, subject: undefined },
      { question_id: questionId, distractor_index: distractorIndex, origin: 'cache' },
    );
    if (!safe) {
      return errorJson('Could not generate remediation. Please try again.', 503);
    }
    return NextResponse.json({
      success: true,
      remediation: cached.remediation_text,
      remediation_hi: cached.remediation_text_hi,
      source: 'cache',
      cached: true,
    });
  }

  // 2. Cache miss — fetch question and generate.
  const question = await fetchQuestion(questionId);
  const curated = await fetchCuratedMisconception(questionId, distractorIndex);
  if (!question) return errorJson('Question not found.', 404);

  const distractor = question.options?.[distractorIndex];
  const correct = question.options?.[question.correct_answer_index];
  if (!distractor || !correct) {
    return errorJson('Question options are malformed.', 422);
  }
  // P3: distractor_index === correct_answer_index is structurally impossible
  // here because the attestation gate above requires is_correct=false. If
  // the DB ever drifts, fall through to the same uniform 403 instead of a
  // distinguishable 422 oracle.
  if (distractorIndex === question.correct_answer_index) {
    logger.warn('foxy_remediation_attestation_passed_for_correct_index', {
      question_id: questionId,
      distractor_index: distractorIndex,
    });
    return remediationUnavailable();
  }

  // Daily-quota gate (P12 rule 4). Guard order: auth → ai_usage_global kill
  // switch (top of POST) → … → quota → paid inference. Placed AFTER the cache
  // lookup and all validation, immediately BEFORE the paid Claude call, so:
  //   (a) serving a cached snippet stays free — no inference happens there,
  //       and the cache is the designed common path for this endpoint;
  //   (b) 400/403/404/422 misfires never consume a unit (no refunds needed
  //       on those paths);
  //   (c) only attestation-passed students can reach the 429, so the P3
  //       uniform-403 oracle closure above is untouched (cache existence is
  //       already public via `cached: true` on the success shape).
  // 429 envelope is byte-identical to /api/foxy's quota-exhaustion response.
  const quota = await checkAndIncrementQuota(studentId);
  if (!quota.allowed) {
    return bilingualErrorJson(
      'Daily Foxy chat limit reached. Upgrade your plan or try again tomorrow.',
      'Aaj ke Foxy chats khatam ho gaye. Kal dobara try karein ya plan upgrade karein.',
      429,
      { quotaRemaining: 0 },
    );
  }

  const prompt =
    (curated
      ? `Editor-curated misconception for this distractor: ${curated.label}
` +
        (curated.label_hi ? `Hindi label: ${curated.label_hi}
` : "")
      : "") +
    `Question (${question.subject ?? 'subject'}, Grade ${question.grade ?? '?'}): ${question.question_text}\n` +
    `Wrong answer chosen: ${distractor}\n` +
    `Correct answer: ${correct}\n` +
    (question.explanation ? `Reference explanation: ${question.explanation}\n` : '') +
    'Write the 2-sentence remediation now.';

  // P12: generateWithHaiku screens internally and returns null on ANY of
  // {no API key, upstream failure, circuit breaker open, empty completion,
  // screening rejection}. All five collapse into this single 503 so the
  // student-facing surface cannot distinguish them.
  const generated = await generateWithHaiku(
    prompt,
    { grade: question.grade ?? undefined, subject: question.subject ?? undefined },
    { question_id: questionId, distractor_index: distractorIndex },
  );
  if (!generated) {
    // Refund the quota unit — the student did not receive a usable answer.
    // Same refund-on-upstream-failure semantics as /api/foxy (best-effort;
    // refundQuota never throws). Keeps a breaker-open / screening-rejection
    // window from silently eating a free student's daily foxy_chat cap.
    await refundQuota(studentId, 'foxy_chat');
    return errorJson('Could not generate remediation. Please try again.', 503);
  }

  // 3. Persist (upsert is safe — UNIQUE(question_id, distractor_index)).
  try {
    await supabaseAdmin.from('wrong_answer_remediations').insert({
      question_id: questionId,
      distractor_index: distractorIndex,
      remediation_text: generated.english,
      remediation_text_hi: generated.hindi,
      source: 'llm-haiku',
    });
  } catch (err) {
    logger.warn('foxy_remediation_cache_write_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    success: true,
    remediation: generated.english,
    remediation_hi: generated.hindi,
    source: 'llm',
    cached: false,
  });
}

/**
 * P7 bilingual split — BEHAVIOUR-PRESERVING extraction of the original
 * inline logic. Do not "simplify" this:
 *
 *  - The system prompt asks Haiku for the English remediation, then the SAME
 *    remediation in simple Hindi on a NEW LINE prefixed with "HI: ". The
 *    marker we search for is therefore `'\nHI:'` (4 chars), and `hiMarker + 4`
 *    lands immediately after the colon; the trailing `.trim()` eats the space.
 *  - The `hiMarker > 0` guard (NOT `>= 0`) is deliberate: a marker at index 0
 *    means the model emitted Hindi with no English half, which would leave
 *    `remediation_text` empty. In that case we keep the whole string as the
 *    English field rather than persisting a blank primary remediation.
 *  - A missing marker yields `hindi: null`, which is a valid value for the
 *    nullable `remediation_text_hi` column.
 */
function splitBilingual(text: string): { english: string; hindi: string | null } {
  const hiMarker = text.indexOf('\nHI:');
  if (hiMarker > 0) {
    const english = text.slice(0, hiMarker).trim();
    const hindi = text.slice(hiMarker + 4).trim() || null;
    return { english, hindi };
  }
  return { english: text, hindi: null };
}

/**
 * P12 rule 2 — "no unfiltered LLM output to students".
 *
 * Deterministic, fail-safe screen applied to EVERY student-facing remediation
 * string, in BOTH languages. Returns true only if every supplied part passes.
 *
 * `screenStudentFacingText` is the Next-side twin of the grounded-answer
 * Deno module of the same name; it fails safe (returns `safe:false`) if the
 * screen itself throws, and blank strings are treated as safe because the
 * empty case is owned by the `!text` guard in the caller.
 *
 * P13: we log the CATEGORY tags only — never the screened text.
 */
function remediationTextIsSafe(
  parts: Array<string | null>,
  context: { grade?: string; subject?: string },
  telemetry: Record<string, unknown>,
): boolean {
  for (const part of parts) {
    if (part == null) continue;
    const screen = screenStudentFacingText(part, context);
    if (!screen.safe) {
      logger.warn('foxy_remediation_output_screen_blocked', {
        ...telemetry,
        categories: screen.categories,
      });
      return false;
    }
  }
  return true;
}

/**
 * Generate a remediation via Claude Haiku.
 *
 * P12 rule 5 (circuit breaker): this goes through `callClaude`, the single
 * Next-layer Claude client, which owns the circuit breaker (opens after 5
 * failures, holds 60s, then allows one half-open probe), bounded retry with
 * jittered backoff, per-request timeout and Haiku→Sonnet model fallback. We
 * deliberately do NOT pre-check `isCircuitBreakerOpen()` here: the open →
 * half-open transition happens inside `callClaude`'s own gate, so short-
 * circuiting ahead of it would leave a tripped breaker permanently open and
 * block its own recovery probe. When the breaker is open `callClaude` throws
 * and we return null, which the caller renders as the SAME 503 fallback used
 * for any other generation failure — no new response shape, no new oracle.
 *
 * P12 rule 2 (screening): the model text is screened INSIDE this function,
 * before it is returned. There is therefore no code path on which the caller
 * can persist or serve text that has not been screened. A screening rejection
 * returns null, so the rejected text is never written to
 * `wrong_answer_remediations` — which matters more than the response, because
 * that table is keyed UNIQUE(question_id, distractor_index) and one poisoned
 * row would be served to every future student who picks that distractor.
 */
async function generateWithHaiku(
  prompt: string,
  context: { grade?: string; subject?: string },
  telemetry: Record<string, unknown>,
): Promise<{ english: string; hindi: string | null } | null> {
  // Preserved fast-bail from the pre-refactor implementation. Without it a
  // deploy with no key configured would be treated by callClaude as a 503,
  // i.e. a TRANSIENT failure, and burn the full retry/backoff ladder on every
  // request before failing. Nothing is recoverable here — bail immediately.
  if (!process.env.ANTHROPIC_API_KEY) return null;

  let text: string;
  try {
    const response = await callClaude({
      model: HAIKU_MODEL,
      systemPrompt: REMEDIATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
      temperature: 0.3,
      timeoutMs: REMEDIATION_TIMEOUT_MS,
    });
    text = (response?.content ?? '').trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish breaker-open from other upstream failures for observability
    // ONLY. Both produce an identical null → identical 503 to the student.
    if (message.includes('circuit breaker is open')) {
      logger.warn('foxy_remediation_circuit_open', telemetry);
    } else {
      logger.warn('foxy_remediation_llm_failed', { ...telemetry, error: message });
    }
    return null;
  }

  if (!text) return null;

  const { english, hindi } = splitBilingual(text);

  // Screen the raw completion AND both derived halves. Screening the raw text
  // alone would be sufficient today (both halves are substrings of it), but
  // screening the halves explicitly keeps the invariant true if the split ever
  // changes, and covers the Hindi field independently of the English one.
  if (!remediationTextIsSafe([text, english, hindi], context, telemetry)) {
    return null;
  }

  return { english, hindi };
}
