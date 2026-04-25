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
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const REMEDIATION_TIMEOUT_MS = 8_000;

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
async function studentHasSubmittedDistractor(
  studentId: string,
  questionId: string,
  distractorIndex: number,
): Promise<boolean> {
  try {
    // quiz_responses.selected_option holds the 0..3 index (not _index suffix);
    // join via quiz_session_id to confirm ownership. We require is_correct=false
    // so submitting the correct answer never unlocks remediation.
    const { data, error } = await supabaseAdmin
      .from('quiz_responses')
      .select('id, quiz_sessions!inner(student_id)')
      .eq('quiz_sessions.student_id', studentId)
      .eq('question_id', questionId)
      .eq('selected_option', distractorIndex)
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

  const prompt =
    `Question (${question.subject ?? 'subject'}, Grade ${question.grade ?? '?'}): ${question.question_text}\n` +
    `Wrong answer chosen: ${distractor}\n` +
    `Correct answer: ${correct}\n` +
    (question.explanation ? `Reference explanation: ${question.explanation}\n` : '') +
    'Write the 2-sentence remediation now.';

  const generated = await generateWithHaiku(prompt);
  if (!generated) {
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

async function generateWithHaiku(prompt: string): Promise<{ english: string; hindi: string | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMEDIATION_TIMEOUT_MS);
  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 256,
        temperature: 0.3,
        system:
          'You are an Indian CBSE tutor writing a 2-sentence remediation for a student who picked the wrong answer. ' +
          'Sentence 1: name the misconception in plain English. ' +
          'Sentence 2: a 1-line correction or example pointing to the right idea. ' +
          'Then on a new line, write the same remediation in simple Hindi prefixed with "HI: ". ' +
          'No greetings, no markdown, no citations.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.text().catch(() => '');
      return null;
    }
    const body = await response.json().catch(() => null);
    // deno-lint-ignore no-explicit-any
    const blocks: any[] = Array.isArray(body?.content) ? body.content : [];
    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    if (!text) return null;

    // Split English vs Hindi by the "HI:" marker.
    const hiMarker = text.indexOf('\nHI:');
    if (hiMarker > 0) {
      const english = text.slice(0, hiMarker).trim();
      const hindi = text.slice(hiMarker + 4).trim() || null;
      return { english, hindi };
    }
    return { english: text, hindi: null };
  } catch (err) {
    logger.warn('foxy_remediation_llm_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
