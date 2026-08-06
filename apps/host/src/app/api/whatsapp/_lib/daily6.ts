/**
 * daily6.ts — WhatsApp Daily 6 processor (Phase 3, the core product loop).
 *
 * Implements the BINDING assessment behavioral spec
 * `docs/superpowers/specs/2026-07-30-whatsapp-daily6-behavioral-spec.md`
 * (P14 pre-implementation gate). Shared by the two callers:
 *   - apps/host/src/app/api/whatsapp/webhook/route.ts  (after() inline path;
 *     sends carry internal caller 'whatsapp-webhook-route')
 *   - apps/host/src/app/api/cron/whatsapp-drain/route.ts (retry path; sends
 *     carry internal caller 'whatsapp-drain-cron')
 *   Both caller literals are BYTE-EXACT rows in security_internal_callers
 *   (migration 20260801100600 lines 161-162) — do not rename.
 *
 * ── The four binding corrections (spec header) as implemented here ──────────
 *   1. submit_quiz_results_v2 is called DIRECTLY (no attemptMode arg); the
 *      only replay rule replicated is the 168h staleness cap. Partial sets
 *      are NEVER submitted.
 *   2. Mastery advances via bkt_update() per answered question. NEVER
 *      record_adaptive_response() (it awards uncapped XP outside P2 —
 *      REJECTED path).
 *   3. get_questions_for_node has no P6 gate — `passesP6Gate` below is
 *      applied to every candidate before start_quiz_session.
 *   4. Immediate feedback grades against quiz_session_shuffles.shuffle_map +
 *      correct_answer_index_snapshot — never live question_bank. Display
 *      only; the RPC stays the sole scoring authority and its return values
 *      are shown verbatim.
 *
 * ── R6 chokepoint ───────────────────────────────────────────────────────────
 * p_student_id for EVERY RPC in this module comes only from
 * `resolveActiveStudent()` (@alfanumrik/lib/whatsapp/identity).
 *
 * ── P13 ─────────────────────────────────────────────────────────────────────
 * No raw phone anywhere (identity ids + phone_hash only); question text is
 * logged as length only; logs carry UUIDs and outcome labels.
 *
 * Never throws: processDaily6Event catches everything → outcome 'retry'.
 */

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { buildInternalCallerHeaders } from '@alfanumrik/lib/security/internal-caller-signing';
import { resolveActiveStudent, type ActiveStudent } from '@alfanumrik/lib/whatsapp/identity';
import { istDate, istNow } from '@alfanumrik/lib/whatsapp/ist';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Daily-6 set size (spec (a)). */
const SET_SIZE = 6;
/** Serve a smaller set down to this floor; below it → no session (spec (a).3). */
const MIN_SET_SIZE = 3;
/** Submit-retry staleness cap in hours after d6_served_at (spec correction 1 / (g)). */
const STALENESS_HOURS = 168;
/** P3 timing clamp bounds, seconds (spec (c)). Do NOT raise the 1s floor to 3. */
const TIME_SPENT_MIN_S = 1;
const TIME_SPENT_MAX_S = 600;
/** Wrong-answer explanation truncation target (spec (d)). */
const EXPLANATION_MAX_CHARS = 300;

const APP_DEEP_LINK = 'https://alfanumrik.com/dashboard';

/** Intents this processor owns (webhook + drain both gate on this set). */
export const DAILY6_PROCESSABLE_INTENTS: ReadonlySet<string> = new Set([
  'd6_start',
  'd6_answer',
  'subject_pick',
  'menu',
]);

export type Daily6Intent = 'd6_start' | 'd6_answer' | 'subject_pick' | 'menu';

export type Daily6Outcome =
  | 'done' // terminally handled (including friendly refusals)
  | 'retry' // transient failure — leave/bounce the event row to 'pending'
  | 'failed'; // non-retryable (e.g. no live identity to even reply to)

export interface Daily6Event {
  /** whatsapp_inbound_events.id */
  id: string;
  intent: Daily6Intent;
  args: Record<string, string>;
  phoneHash: string;
  /** Best-available arrival time of the message (P3 timing source). */
  receivedAtMs: number;
  source: 'webhook' | 'drain';
}

// ─── Internal row shapes ────────────────────────────────────────────────────

interface SessionRow {
  identity_id: string;
  active_student_id: string | null;
  state: string;
  d6_date: string | null;
  d6_quiz_session_id: string | null;
  d6_question_ids: string[];
  d6_index: number;
  d6_responses: Array<{ question_id: string; selected_displayed_index: number; time_spent: number }>;
  d6_served_at: string | null;
  subject: string | null;
  grade: string | null;
  locale: 'en' | 'hi';
  context: Record<string, unknown>;
}

interface QueueItem {
  node_code: string;
  title?: string;
  subject?: string;
  source: string;
  mastery_pct?: number;
  [key: string]: unknown;
}

/** question_bank-shaped candidate (from get_questions_for_node / RAG top-up). */
interface CandidateQuestion {
  id: string;
  question_text?: string | null;
  options?: unknown;
  correct_answer_index?: number | null;
  explanation?: string | null;
  [key: string]: unknown;
}

export interface ComposedQuestion {
  question_id: string;
  node_code: string | null;
  source: string;
  mastery_pct_before: number | null;
  title: string | null;
}

/** Snapshot question as returned by start_quiz_session (server-side only). */
interface ServedQuestion {
  question_id: string;
  question_text: string | null;
  question_hi: string | null;
  options_displayed: string[];
  explanation: string | null;
  explanation_hi: string | null;
}

type Locale = 'en' | 'hi';

// ─── Small helpers ──────────────────────────────────────────────────────────

function t(locale: Locale, en: string, hi: string): string {
  return locale === 'hi' ? hi : en;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Truncate at a sentence boundary near `max` chars (spec (d)). */
export function truncateAtSentence(s: string, max: number = EXPLANATION_MAX_CHARS): string {
  const clean = s.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('। '), // Devanagari danda boundary
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  if (lastEnd > 40) return cut.slice(0, lastEnd + 1).trim();
  return `${cut.trim()}…`;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * P6 quality gate (spec correction 3 / (b)): non-empty text, no template
 * braces or [BLANK], exactly 4 DISTINCT non-empty string options,
 * correct_answer_index an integer 0-3, non-empty explanation.
 */
export function passesP6Gate(q: CandidateQuestion): boolean {
  const text = (q.question_text ?? '').trim();
  if (!text || text.includes('{{') || text.toUpperCase().includes('[BLANK]')) return false;

  if (!Array.isArray(q.options) || q.options.length !== 4) return false;
  const opts = q.options.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (opts.some((o) => !o)) return false;
  if (new Set(opts).size !== 4) return false;

  const ci = q.correct_answer_index;
  if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0 || ci > 3) return false;

  if (!(q.explanation ?? '').trim()) return false;
  return true;
}

// ─── Outbound sends (whatsapp-send Edge Function) ───────────────────────────

type WaMessage =
  | { type: 'text'; body: string }
  | { type: 'interactive_buttons'; body: string; buttons: Array<{ id: string; title: string }> }
  | {
      type: 'interactive_list';
      body: string;
      button: string;
      items: Array<{ id: string; title: string; description?: string }>;
    };

/**
 * POST one message to the whatsapp-send Edge Function with signed internal
 * caller headers. The caller literal MUST be byte-exact
 * 'whatsapp-webhook-route' | 'whatsapp-drain-cron' (migration 20260801100600).
 *
 * A 200 with {sent:false, reason} is a NORMAL suppression (opt-out, window
 * closed → nudge parked, daily cap) — treated as handled, NOT retried
 * (retrying cannot change any of those gates). Non-200 → false (retryable).
 */
async function sendWa(input: {
  identityId: string;
  message: WaMessage;
  idempotencyKey: string;
  caller: 'whatsapp-webhook-route' | 'whatsapp-drain-cron';
}): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    logger.error('whatsapp_daily6: sendWa env not configured', {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!serviceRoleKey,
    });
    return false;
  }

  try {
    const payload = JSON.stringify({
      to_identity_id: input.identityId,
      kind: 'session',
      message: input.message,
      idempotency_key: input.idempotencyKey,
    });
    const signHeaders = buildInternalCallerHeaders(
      'POST',
      '/functions/v1/whatsapp-send',
      payload,
      input.caller,
    );
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        ...(signHeaders ?? {}),
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn('whatsapp_daily6: whatsapp-send non-200', {
        status: res.status,
        messageType: input.message.type,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('whatsapp_daily6: whatsapp-send fetch failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Session persistence helpers ────────────────────────────────────────────

async function loadSession(identityId: string): Promise<SessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_sessions')
    .select(
      'identity_id, active_student_id, state, d6_date, d6_quiz_session_id, d6_question_ids, ' +
        'd6_index, d6_responses, d6_served_at, subject, grade, locale, context',
    )
    .eq('identity_id', identityId)
    .maybeSingle();
  if (error) {
    logger.warn('whatsapp_daily6: session load failed', { error: error.message });
    return null;
  }
  return (data ?? null) as SessionRow | null;
}

async function upsertSession(
  identityId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('whatsapp_sessions')
    .upsert(
      {
        identity_id: identityId,
        expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        ...fields,
      },
      { onConflict: 'identity_id' },
    );
  if (error) {
    logger.warn('whatsapp_daily6: session upsert failed', { error: error.message });
    return false;
  }
  return true;
}

/**
 * Clear d6_* back to defaults after submit/abandon. KEEPS d6_date — it is the
 * daily-gate marker (spec (c)) — unless `alsoClearDate` (abandon of an
 * EXPIRED set must not gate the fresh day).
 */
async function clearD6(
  identityId: string,
  context: Record<string, unknown>,
  opts: { keepDate: string | null },
): Promise<boolean> {
  const nextContext = { ...context };
  delete nextContext.d6_idempotency_key;
  delete nextContext.d6_q_sent_at;
  delete nextContext.d6_meta;
  delete nextContext.d6_questions;
  delete nextContext.d6_last_event_id;
  return upsertSession(identityId, {
    state: 'idle',
    d6_date: opts.keepDate,
    d6_quiz_session_id: null,
    d6_question_ids: [],
    d6_index: 0,
    d6_responses: [],
    d6_served_at: null,
    context: nextContext,
  });
}

// ─── Identity resolution for an inbound phone_hash ──────────────────────────

/**
 * Pick the identity this conversation acts through. Live rows only; prefers
 * the identity that already has a session row (most recently updated), then
 * the oldest student-role binding. Beta simplification: sibling switching
 * (`sw:` opcode) is a later phase; document, don't guess.
 */
async function resolveIdentityId(phoneHash: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_identities')
    .select('id, role, created_at')
    .eq('phone_hash', phoneHash)
    .is('revoked_at', null)
    .not('verified_at', 'is', null)
    .eq('opt_in_status', 'opted_in')
    .order('created_at', { ascending: true });
  if (error || !data || data.length === 0) return null;
  const rows = data as Array<{ id: string; role: string }>;

  const ids = rows.map((r) => r.id);
  const { data: sessions } = await supabaseAdmin
    .from('whatsapp_sessions')
    .select('identity_id, updated_at')
    .in('identity_id', ids)
    .order('updated_at', { ascending: false })
    .limit(1);
  const sessionIdentity = (sessions as Array<{ identity_id: string }> | null)?.[0]?.identity_id;
  if (sessionIdentity) return sessionIdentity;

  const student = rows.find((r) => r.role === 'student');
  return (student ?? rows[0]).id;
}

// ─── Message builders (P7 bilingual, locale from the session row) ───────────

function notLinkedMessage(locale: Locale): WaMessage {
  return {
    type: 'text',
    body: t(
      locale,
      'This WhatsApp number is not linked to a student account yet. Open the Alfanumrik app → Settings → WhatsApp, then send LINK <code> here.',
      'यह WhatsApp नंबर अभी किसी विद्यार्थी खाते से जुड़ा नहीं है। Alfanumrik ऐप → Settings → WhatsApp खोलें, फिर यहाँ LINK <code> भेजें।',
    ),
  };
}

function doneForTodayMessage(locale: Locale): WaMessage {
  return {
    type: 'text',
    body: t(
      locale,
      `🎉 Today's Daily 6 is done — come back tomorrow! Keep learning in the app: ${APP_DEEP_LINK}`,
      `🎉 आज का Daily 6 पूरा हो गया — कल फिर आना! ऐप में और सीखो: ${APP_DEEP_LINK}`,
    ),
  };
}

function expiredMessage(locale: Locale): WaMessage {
  return {
    type: 'text',
    body: t(
      locale,
      "Yesterday's set expired — starting fresh.",
      'कल का सेट समाप्त हो गया — नया सेट शुरू करते हैं।',
    ),
  };
}

function notEnoughMessage(locale: Locale): WaMessage {
  return {
    type: 'text',
    body: t(
      locale,
      'Not enough practice for this subject yet — try another subject.',
      'इस विषय के लिए अभी पर्याप्त अभ्यास सामग्री नहीं है — कोई और विषय आज़माओ।',
    ),
  };
}

function menuMessage(locale: Locale): WaMessage {
  return {
    type: 'interactive_buttons',
    body: t(locale, 'What would you like to do?', 'क्या करना चाहोगे?'),
    buttons: [
      { id: 'd6:start', title: 'Daily 6' },
      // 'Help' has no opcode: Twilio copies the button text into Body and the
      // webhook's keyword tier answers HELP synchronously (regulatory path).
      { id: 'show:help', title: t(locale, 'Help', 'मदद') },
    ],
  };
}

function subjectPickerMessage(
  locale: Locale,
  subjects: string[],
  lastSubject: string | null,
): WaMessage {
  const items: Array<{ id: string; title: string; description?: string }> = [];
  if (lastSubject && subjects.includes(lastSubject)) {
    items.push({
      id: `subj:${lastSubject}`,
      title: truncate(t(locale, `Continue ${lastSubject}`, `${lastSubject} जारी रखें`), 24),
      description: t(locale, 'Pick up where you left off', 'जहाँ छोड़ा था वहीं से'),
    });
  }
  for (const s of subjects) {
    if (s === lastSubject) continue;
    if (items.length >= 10) break;
    items.push({ id: `subj:${s}`, title: truncate(s, 24) });
  }
  return {
    type: 'interactive_list',
    body: t(locale, "Which subject for today's Daily 6?", 'आज का Daily 6 किस विषय में?'),
    button: t(locale, 'Choose subject', 'विषय चुनें'),
    items,
  };
}

function questionMessage(
  q: ServedQuestion,
  index: number,
  total: number,
  locale: Locale,
): WaMessage {
  const text =
    locale === 'hi' && (q.question_hi ?? '').trim() ? (q.question_hi as string) : (q.question_text ?? '');
  const header = `Q${index + 1}/${total}`;
  const optionLines = q.options_displayed
    .map((opt, i) => `${LETTERS[i]}. ${opt}`)
    .join('\n');
  // FULL question + all 4 FULL options go in the body (≤1024) so 72-char row
  // truncation can never change the real choice (spec (b)). If the combined
  // body would overflow, the QUESTION text is trimmed, never the options.
  const fixed = `${header}\n\n\n${optionLines}`;
  const room = 1024 - fixed.length;
  const body = `${header}\n\n${truncate(text, Math.max(40, room))}\n\n${optionLines}`;
  return {
    type: 'interactive_list',
    body: body.length <= 1024 ? body : body.slice(0, 1024),
    button: t(locale, 'Answer', 'जवाब दो'),
    // dev-5 (Phase-3 conformance, assessment): the opcode encodes BOTH the
    // question's served position (`index` — the session's d6_index at serve
    // time) and the displayed option index, so a tap on a STALE list (an
    // older, already-superseded question message — WhatsApp never disables
    // previously-sent lists) can be rejected server-side instead of being
    // silently misapplied to whatever question is currently active.
    items: q.options_displayed.map((opt, i) => ({
      id: `d6:a:${index}:${i}`,
      title: `${LETTERS[i]}. ${truncate(opt, 20)}`,
      description: truncate(opt, 72),
    })),
  };
}

// ─── Compose (spec (a)/(b) + the Phase-6 injection seam (j)) ────────────────

/**
 * mixed_recall_queue injection point (spec (j)): runs AFTER get_practice_queue
 * and BEFORE the top-up. Identity today; Phase 6 replaces the body.
 * Deliberately exported so it is a discrete, testable step.
 */
export function applyMixedRecallInjection(
  queue: QueueItem[],
  _ctx: { studentId: string; subject: string; grade: string },
): QueueItem[] {
  // TODO(Phase 6, plan-alfanumrik-whatsapp-bot-mighty-frost.md): inject
  // mixed_recall_queue items here. Contract: same QueueItem shape, output
  // feeds the per-node fetch verbatim (no re-ranking of RPC-ordered items).
  return queue;
}

interface ComposeResult {
  questionIds: string[];
  meta: ComposedQuestion[];
}

/**
 * Queue composition (spec (a)): get_practice_queue verbatim (NO bot-side
 * re-ranking), cold-start seed-and-retry, per-node fetch with the P6 gate and
 * one refetch (spec (b)), then RAG top-up for the deficit. Caller enforces
 * the floor of 3.
 */
export async function composeDaily6Set(
  studentId: string,
  subject: string,
  grade: string,
): Promise<ComposeResult> {
  const fetchQueue = async (): Promise<QueueItem[]> => {
    const { data, error } = await supabaseAdmin.rpc('get_practice_queue', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_session_size: SET_SIZE,
    });
    if (error) {
      logger.warn('whatsapp_daily6: get_practice_queue failed', { error: error.message });
      return [];
    }
    const queue = (data as { queue?: unknown } | null)?.queue;
    return Array.isArray(queue) ? (queue as QueueItem[]) : [];
  };

  let queue = await fetchQueue();

  // Cold start (spec (a).1): zero adaptive_mastery rows for (subject, grade)
  // → seed once, retry. Node list is bounded; the .in() membership count is
  // capped at 200 codes — enough to distinguish "zero" from "some".
  if (queue.length < SET_SIZE) {
    const { data: nodes } = await supabaseAdmin
      .from('learning_graph')
      .select('node_code')
      .eq('grade', grade)
      .eq('subject_code', subject)
      .eq('is_active', true)
      .limit(500);
    const nodeCodes = ((nodes ?? []) as Array<{ node_code: string }>).map((n) => n.node_code);
    if (nodeCodes.length > 0) {
      const { count } = await supabaseAdmin
        .from('adaptive_mastery')
        .select('node_code', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .in('node_code', nodeCodes.slice(0, 200));
      if ((count ?? 0) === 0) {
        const { error: seedErr } = await supabaseAdmin.rpc('seed_adaptive_mastery', {
          p_student_id: studentId,
          p_subject: subject,
          p_grade: grade,
        });
        if (seedErr) {
          logger.warn('whatsapp_daily6: seed_adaptive_mastery failed', {
            error: seedErr.message,
          });
        } else {
          queue = await fetchQueue();
        }
      }
    }
  }

  // Phase-6 seam (spec (j)): AFTER get_practice_queue, BEFORE the top-up.
  queue = applyMixedRecallInjection(queue, { studentId, subject, grade });

  const picked: Array<{ q: CandidateQuestion; meta: ComposedQuestion }> = [];
  const excludeIds: string[] = [];

  const fetchForNode = async (nodeCode: string): Promise<CandidateQuestion | null> => {
    const { data, error } = await supabaseAdmin.rpc('get_questions_for_node', {
      p_node_code: nodeCode,
      p_count: 1,
      p_bloom_level: null,
      p_exclude_ids: excludeIds,
    });
    if (error) {
      logger.warn('whatsapp_daily6: get_questions_for_node failed', {
        nodeCode,
        error: error.message,
      });
      return null;
    }
    const rows = Array.isArray(data) ? (data as CandidateQuestion[]) : [];
    return rows[0] ?? null;
  };

  for (const item of queue) {
    if (picked.length >= SET_SIZE) break;
    if (!item?.node_code) continue;

    // One fetch + one refetch per node (spec (b)); then the slot falls to top-up.
    let candidate = await fetchForNode(item.node_code);
    if (candidate && !passesP6Gate(candidate)) {
      excludeIds.push(candidate.id);
      logger.info('whatsapp_daily6: candidate failed P6 gate, refetching once', {
        nodeCode: item.node_code,
        questionId: candidate.id,
      });
      candidate = await fetchForNode(item.node_code);
      if (candidate && !passesP6Gate(candidate)) {
        excludeIds.push(candidate.id);
        candidate = null;
      }
    }
    if (!candidate) continue;

    excludeIds.push(candidate.id);
    picked.push({
      q: candidate,
      meta: {
        question_id: candidate.id,
        node_code: item.node_code,
        source: item.source ?? 'unknown',
        mastery_pct_before: typeof item.mastery_pct === 'number' ? item.mastery_pct : null,
        title: typeof item.title === 'string' ? item.title : null,
      },
    });
  }

  // Top-up (spec (a).2). ⚠️ CONTRACT DEVIATION (reported, not hidden): the
  // CURRENT select_quiz_questions_rag (migration 20260625000200) has a strict
  // ownership check with NO service-role (auth.uid() IS NULL) skip — unlike
  // start_quiz_session / submit_quiz_results_v2 — so this call RAISES
  // 'Access denied' under the service-role client until architect ships the
  // skip. We call it exactly as the spec directs and degrade gracefully to
  // the floor-3 rule on failure.
  const deficit = SET_SIZE - picked.length;
  if (deficit > 0) {
    const { data, error } = await supabaseAdmin.rpc('select_quiz_questions_rag', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapter_number: null,
      p_count: deficit,
      p_difficulty_mode: 'mixed',
      p_question_types: ['mcq'],
      p_query_embedding: null,
    });
    if (error) {
      logger.warn('whatsapp_daily6: select_quiz_questions_rag top-up unavailable', {
        error: error.message,
      });
    } else {
      const rows = Array.isArray(data) ? (data as CandidateQuestion[]) : [];
      for (const row of rows) {
        if (picked.length >= SET_SIZE) break;
        if (!row?.id || excludeIds.includes(row.id)) continue;
        if (!passesP6Gate(row)) continue;
        excludeIds.push(row.id);
        picked.push({
          q: row,
          meta: {
            question_id: row.id,
            node_code: null,
            source: 'topup',
            mastery_pct_before: null,
            title: null,
          },
        });
      }
    }
  }

  return {
    questionIds: picked.map((p) => p.meta.question_id),
    meta: picked.map((p) => p.meta),
  };
}

// ─── Subject selection (spec Q5) ────────────────────────────────────────────

async function subjectChoicesFor(active: ActiveStudent): Promise<string[]> {
  if (active.selectedSubjects.length > 0) return active.selectedSubjects;
  if (active.subject) return [active.subject];
  // Fallback: the grade's valid subject set from the learning graph.
  const { data } = await supabaseAdmin
    .from('learning_graph')
    .select('subject_code')
    .eq('grade', active.grade)
    .eq('is_active', true)
    .limit(500);
  const codes = ((data ?? []) as Array<{ subject_code: string }>).map((r) => r.subject_code);
  return [...new Set(codes)];
}

// ─── Serve / start ──────────────────────────────────────────────────────────

async function composeAndServe(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow | null,
  subject: string,
): Promise<Daily6Outcome> {
  const locale = active.locale;
  const composed = await composeDaily6Set(active.studentId, subject, active.grade);

  if (composed.questionIds.length < MIN_SET_SIZE) {
    // No session below the floor (spec (a).3). d6_date is NOT set — the
    // student may immediately try another subject.
    await upsertSession(identityId, {
      active_student_id: active.studentId,
      state: 'idle',
      subject,
      grade: active.grade,
      locale,
      context: session?.context ?? {},
    });
    const sent = await sendWa({
      identityId,
      message: notEnoughMessage(locale),
      idempotencyKey: `d6:noset:${evt.id}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }

  // Server-owned shuffle + snapshot; serve ONLY the returned options_displayed.
  const { data: startData, error: startErr } = await supabaseAdmin.rpc('start_quiz_session', {
    p_student_id: active.studentId,
    p_question_ids: composed.questionIds,
  });
  if (startErr) {
    logger.warn('whatsapp_daily6: start_quiz_session failed', { error: startErr.message });
    return 'retry';
  }
  const quizSessionId = (startData as { session_id?: string } | null)?.session_id;
  const servedRaw = (startData as { questions?: unknown } | null)?.questions;
  const served: ServedQuestion[] = (Array.isArray(servedRaw) ? servedRaw : []).map((q: any) => ({
    question_id: q.question_id,
    question_text: q.question_text ?? null,
    question_hi: q.question_hi ?? null,
    options_displayed: Array.isArray(q.options_displayed)
      ? q.options_displayed.map((o: unknown) => String(o))
      : [],
    explanation: q.explanation ?? null,
    explanation_hi: q.explanation_hi ?? null,
  }));
  if (!quizSessionId || served.length < MIN_SET_SIZE) {
    logger.warn('whatsapp_daily6: start_quiz_session returned too few questions', {
      returned: served.length,
    });
    return 'retry';
  }

  // Served order (the RPC may silently skip an inactive id) is authoritative.
  const metaByQid = new Map(composed.meta.map((m) => [m.question_id, m]));
  const servedIds = served.map((q) => q.question_id);
  const servedMeta = servedIds.map(
    (qid) =>
      metaByQid.get(qid) ?? {
        question_id: qid,
        node_code: null,
        source: 'unknown',
        mastery_pct_before: null,
        title: null,
      },
  );

  const nowIso = new Date().toISOString();
  const ok = await upsertSession(identityId, {
    active_student_id: active.studentId,
    state: 'daily6_active',
    d6_date: istDate(),
    d6_quiz_session_id: quizSessionId,
    d6_question_ids: servedIds,
    d6_index: 0,
    d6_responses: [],
    d6_served_at: nowIso,
    subject,
    grade: active.grade, // P5: STRING
    locale,
    context: {
      ...(session?.context ?? {}),
      // Regenerated ONLY on a new compose (spec (c)).
      d6_idempotency_key: randomUUID(),
      d6_q_sent_at: nowIso,
      d6_meta: servedMeta,
      d6_questions: served,
      // Reset the redelivery guard too — inheriting a PRIOR set's
      // d6_last_event_id would let a fresh-serve send failure ('retry')
      // that gets redelivered by the drain apply that stale guard state
      // against today's freshly-composed Q1.
      d6_last_event_id: null,
    },
  });
  if (!ok) return 'retry';

  const sent = await sendWa({
    identityId,
    message: questionMessage(served[0], 0, served.length, locale),
    idempotencyKey: `d6:q:${quizSessionId}:0`,
    caller: callerFor(evt.source),
  });
  return sent ? 'done' : 'retry';
}

function callerFor(source: 'webhook' | 'drain'): 'whatsapp-webhook-route' | 'whatsapp-drain-cron' {
  return source === 'webhook' ? 'whatsapp-webhook-route' : 'whatsapp-drain-cron';
}

/**
 * D6 entry (spec (c)/(g)/(f) daily gate + Q5 subject pick).
 */
export async function startDaily6(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow | null,
): Promise<Daily6Outcome> {
  const locale = active.locale;
  const today = istDate();

  if (session?.state === 'daily6_active') {
    if (session.d6_date === today) return handleDaily6Resume(evt, identityId, active, session);
    return handleDaily6Expiry(evt, identityId, active, session);
  }

  // Interim daily gate (spec (f)): d6_date == today ⇒ one set/day for everyone.
  // TODO(Phase 4, migration 20260801100400): replace with
  // check_and_record_usage — the feature code does not exist in
  // get_plan_limit yet, and that migration MUST extend the school-aware
  // 20260729130400 version of get_plan_limit, not an older overload.
  if (session?.d6_date === today) {
    const sent = await sendWa({
      identityId,
      message: doneForTodayMessage(locale),
      idempotencyKey: `d6:gate:${evt.id}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }

  // Subject selection (spec Q5): student picks; skip the picker when only one
  // subject exists. Beta: single-subject set per day; auto-rotation rejected.
  const subjects = await subjectChoicesFor(active);
  if (subjects.length === 0) {
    const sent = await sendWa({
      identityId,
      message: notEnoughMessage(locale),
      idempotencyKey: `d6:nosubj:${evt.id}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }
  if (subjects.length > 1) {
    const ok = await upsertSession(identityId, {
      active_student_id: active.studentId,
      state: 'picking_subject',
      grade: active.grade,
      locale,
      context: session?.context ?? {},
    });
    if (!ok) return 'retry';
    const sent = await sendWa({
      identityId,
      message: subjectPickerMessage(locale, subjects, session?.subject ?? active.subject),
      idempotencyKey: `d6:pick:${evt.id}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }

  return composeAndServe(evt, identityId, active, session, subjects[0]);
}

// ─── Resume / expiry (spec (g)) ─────────────────────────────────────────────

/** Same IST day, set in flight → re-serve the current question (or retry submit). */
export async function handleDaily6Resume(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow,
): Promise<Daily6Outcome> {
  const total = session.d6_question_ids.length;
  if (session.d6_index >= total) {
    return submitDaily6(evt, identityId, active, session);
  }
  const questions = (session.context.d6_questions ?? []) as ServedQuestion[];
  const current = questions[session.d6_index];
  if (!current) {
    logger.warn('whatsapp_daily6: resume with missing question snapshot — abandoning set', {
      index: session.d6_index,
    });
    await clearD6(identityId, session.context, { keepDate: null });
    return startDaily6(evt, identityId, active, { ...session, state: 'idle', d6_date: null });
  }
  // Reset the per-question serve timestamp so timing reflects THIS serve.
  await upsertSession(identityId, {
    context: { ...session.context, d6_q_sent_at: new Date().toISOString() },
  });
  const sent = await sendWa({
    identityId,
    message: questionMessage(current, session.d6_index, total, active.locale),
    idempotencyKey: `d6:q:${session.d6_quiz_session_id}:${session.d6_index}:r${evt.id}`,
    caller: callerFor(evt.source),
  });
  return sent ? 'done' : 'retry';
}

/**
 * New IST day with a stale set: fully-answered sets still retry the submit up
 * to 168h after d6_served_at; PARTIAL sets are abandoned WITHOUT submitting
 * (never short p_responses — bkt_update already captured the learning), then
 * a fresh set is served.
 */
export async function handleDaily6Expiry(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow,
): Promise<Daily6Outcome> {
  const total = session.d6_question_ids.length;
  const servedAtMs = session.d6_served_at ? Date.parse(session.d6_served_at) : NaN;
  const withinStaleness =
    Number.isFinite(servedAtMs) && Date.now() - servedAtMs <= STALENESS_HOURS * 3_600_000;

  if (session.d6_index >= total && total > 0 && withinStaleness) {
    return submitDaily6(evt, identityId, active, session);
  }

  // Abandon without submit (partial set, or fully-answered beyond 168h).
  const cleared = await clearD6(identityId, session.context, { keepDate: null });
  if (!cleared) return 'retry';
  await sendWa({
    identityId,
    message: expiredMessage(active.locale),
    idempotencyKey: `d6:exp:${evt.id}`,
    caller: callerFor(evt.source),
  });
  return startDaily6(evt, identityId, active, {
    ...session,
    state: 'idle',
    d6_date: null,
    d6_question_ids: [],
    d6_index: 0,
    d6_responses: [],
  });
}

// ─── Answer flow (spec (d)) ─────────────────────────────────────────────────

/**
 * dev-5 (Phase-3 conformance, assessment): a tap on a STALE interactive list
 * card — an older, already-superseded Daily-6 question message; WhatsApp
 * never disables previously-sent lists — produces a genuinely NEW inbound
 * event, so it passes the `d6_last_event_id` dedup guard. Without this check
 * it would be silently applied to whatever question is CURRENTLY active
 * (session.d6_index), misgrading that question and shifting every
 * subsequent answer one slot out of alignment.
 *
 * This is the second, independent guard: `d6_last_event_id` catches SAME-
 * EVENT redelivery (webhook + drain retrying the identical inbound row);
 * this qIdx check catches a DIFFERENT event whose opcode targets a question
 * position that is no longer the live one. Neither grades, calls
 * bkt_update, nor advances d6_index — it nudges the student and re-serves
 * whatever question IS current via the same re-serve path as resume.
 */
async function handleStaleD6Tap(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow,
): Promise<Daily6Outcome> {
  const locale = active.locale;
  const nudgeSent = await sendWa({
    identityId,
    message: {
      type: 'text',
      body: t(
        locale,
        `That question has already moved on — here's your current one.`,
        'वह सवाल आगे बढ़ चुका है — यह रहा आपका मौजूदा सवाल।',
      ),
    },
    idempotencyKey: `d6:stale:${evt.id}`,
    caller: callerFor(evt.source),
  });
  if (!nudgeSent) return 'retry';
  return handleDaily6Resume(evt, identityId, active, session);
}

export async function handleDaily6Answer(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow | null,
): Promise<Daily6Outcome> {
  const locale = active.locale;
  if (!session || session.state !== 'daily6_active') {
    // Late/stray answer (set already submitted or never started) — ignore
    // (spec (g) position-check semantics). Terminal for this event.
    return 'done';
  }
  if (session.d6_date !== istDate()) {
    return handleDaily6Expiry(evt, identityId, active, session);
  }

  const total = session.d6_question_ids.length;
  let workingSession = session;

  const alreadyApplied = session.context.d6_last_event_id === evt.id;

  if (session.d6_index >= total) {
    // All answered — this inbound just retries the submit with the SAME key.
    return submitDaily6(evt, identityId, active, session);
  }

  if (!alreadyApplied) {
    const qIdx = Number.parseInt(evt.args.qIdx ?? '', 10);
    const answerIndex = Number.parseInt(evt.args.optIdx ?? '', 10);
    if (
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex > 3 ||
      !Number.isInteger(qIdx) ||
      qIdx < 0
    ) {
      return 'done'; // malformed opcode — ignore
    }

    // dev-5 (Phase-3 conformance, assessment, condition for approval): the
    // opcode's encoded question position MUST match the session's live
    // d6_index before grading. A mismatch means this tap targets a
    // stale/superseded question card — do NOT grade, do NOT advance.
    if (qIdx !== session.d6_index) {
      return handleStaleD6Tap(evt, identityId, active, session);
    }

    const idx = session.d6_index;
    const questionId = session.d6_question_ids[idx];
    const meta = ((session.context.d6_meta ?? []) as ComposedQuestion[])[idx] ?? null;
    const questions = (session.context.d6_questions ?? []) as ServedQuestion[];
    const current = questions[idx];

    // Grade against the per-session snapshot — NEVER live question_bank
    // (spec correction 4). SQL shuffle_map is 1-based: shuffle_map[d+1] ==
    // JS shuffleMap[d].
    const { data: shuffleRow, error: shuffleErr } = await supabaseAdmin
      .from('quiz_session_shuffles')
      .select('shuffle_map, correct_answer_index_snapshot')
      .eq('session_id', session.d6_quiz_session_id)
      .eq('question_id', questionId)
      .maybeSingle();
    if (shuffleErr || !shuffleRow) {
      logger.warn('whatsapp_daily6: shuffle snapshot missing', {
        error: shuffleErr?.message ?? 'no row',
      });
      return 'retry';
    }
    const shuffleMap = (shuffleRow as { shuffle_map: number[] }).shuffle_map ?? [];
    const correctSnapshot = (shuffleRow as { correct_answer_index_snapshot: number })
      .correct_answer_index_snapshot;
    const isCorrect =
      Array.isArray(shuffleMap) &&
      shuffleMap.length === 4 &&
      shuffleMap[answerIndex] === correctSnapshot;
    const correctDisplayedIndex =
      Array.isArray(shuffleMap) && shuffleMap.length === 4
        ? shuffleMap.findIndex((orig) => orig === correctSnapshot)
        : -1;

    // P3 timing source of truth (spec (c)): server-derived clamp(arrival −
    // d6_q_sent_at, 1, 600) seconds. The 1s floor is deliberate — do NOT
    // raise it to 3.
    const sentAtMs = Date.parse(String(session.context.d6_q_sent_at ?? ''));
    const rawSeconds = Number.isFinite(sentAtMs)
      ? Math.round((evt.receivedAtMs - sentAtMs) / 1000)
      : TIME_SPENT_MIN_S;
    const timeSpent = Math.min(TIME_SPENT_MAX_S, Math.max(TIME_SPENT_MIN_S, rawSeconds));

    // Per-question mastery update: bkt_update ONLY (spec correction 2 — never
    // record_adaptive_response). Failure is non-fatal for the practice flow.
    if (meta?.node_code) {
      const { error: bktErr } = await supabaseAdmin.rpc('bkt_update', {
        p_student_id: active.studentId, // R6: from resolveActiveStudent only
        p_node_code: meta.node_code,
        p_is_correct: isCorrect,
        p_response_time_ms: timeSpent * 1000,
      });
      if (bktErr) {
        logger.warn('whatsapp_daily6: bkt_update failed (continuing)', {
          error: bktErr.message,
        });
      }
      // TODO(deferred past beta, spec (d)): interleave-source items SHOULD
      // bump adaptive_mastery.interleave_count here.
    }

    const nextResponses = [
      ...session.d6_responses,
      { question_id: questionId, selected_displayed_index: answerIndex, time_spent: timeSpent },
    ];
    const nextIndex = idx + 1;
    const nowIso = new Date().toISOString();
    const ok = await upsertSession(identityId, {
      d6_responses: nextResponses,
      d6_index: nextIndex,
      context: {
        ...session.context,
        d6_q_sent_at: nowIso,
        d6_last_event_id: evt.id,
      },
    });
    if (!ok) return 'retry';
    workingSession = {
      ...session,
      d6_responses: nextResponses,
      d6_index: nextIndex,
      context: { ...session.context, d6_q_sent_at: nowIso, d6_last_event_id: evt.id },
    };

    // ONE combined feedback message (spec (d)).
    let feedback: string;
    if (isCorrect) {
      feedback = t(locale, '✅ Correct! Great going — keep it up.', '✅ सही! बहुत बढ़िया — ऐसे ही करते रहो।');
    } else {
      const letter = correctDisplayedIndex >= 0 ? LETTERS[correctDisplayedIndex] : '?';
      const correctText =
        correctDisplayedIndex >= 0
          ? current?.options_displayed?.[correctDisplayedIndex] ?? ''
          : '';
      const explanationSource =
        locale === 'hi' && (current?.explanation_hi ?? '').trim()
          ? (current?.explanation_hi as string)
          : current?.explanation ?? '';
      const explanation = truncateAtSentence(explanationSource);
      feedback =
        t(locale, `❌ The answer was ${letter}: ${correctText}`, `❌ सही जवाब था ${letter}: ${correctText}`) +
        (explanation ? `\n\n${explanation}` : '');
    }
    const fbSent = await sendWa({
      identityId,
      message: { type: 'text', body: feedback },
      idempotencyKey: `d6:fb:${session.d6_quiz_session_id}:${idx}`,
      caller: callerFor(evt.source),
    });
    if (!fbSent) return 'retry';
  }

  // Next question as its own interactive message, or submit after the last.
  const nextIdx = workingSession.d6_index;
  if (nextIdx < total) {
    const questions = (workingSession.context.d6_questions ?? []) as ServedQuestion[];
    const nextQ = questions[nextIdx];
    if (!nextQ) {
      logger.warn('whatsapp_daily6: next question snapshot missing — abandoning set', {
        index: nextIdx,
      });
      await clearD6(identityId, workingSession.context, { keepDate: null });
      return 'done';
    }
    const sent = await sendWa({
      identityId,
      message: questionMessage(nextQ, nextIdx, total, locale),
      idempotencyKey: `d6:q:${workingSession.d6_quiz_session_id}:${nextIdx}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }
  return submitDaily6(evt, identityId, active, workingSession);
}

// ─── Submit + closing summary (spec (e)/(h)) ────────────────────────────────

interface SubmitReturn {
  total: number;
  correct: number;
  score_percent: number;
  xp_earned: number;
  xp_capped?: boolean;
  flagged: boolean;
  idempotent_replay?: boolean;
}

async function submitDaily6(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow,
): Promise<Daily6Outcome> {
  const locale = active.locale;

  // 168h staleness cap (spec correction 1 / (g)): beyond it, abandon WITHOUT
  // submitting.
  const servedAtMs = session.d6_served_at ? Date.parse(session.d6_served_at) : NaN;
  if (!Number.isFinite(servedAtMs) || Date.now() - servedAtMs > STALENESS_HOURS * 3_600_000) {
    await clearD6(identityId, session.context, { keepDate: null });
    return 'done';
  }

  const responses = session.d6_responses;
  const totalServed = session.d6_question_ids.length;
  if (responses.length !== totalServed) {
    // Defensive: partial sets are NEVER submitted (spec correction 1). This
    // path is unreachable via the position machine; abandon rather than flag.
    logger.warn('whatsapp_daily6: refusing to submit partial set', {
      responses: responses.length,
      served: totalServed,
    });
    await clearD6(identityId, session.context, { keepDate: null });
    return 'done';
  }

  const pTime = responses.reduce((sum, r) => sum + (r.time_spent ?? 0), 0);
  const idempotencyKey = String(session.context.d6_idempotency_key ?? '') || null;

  // Exact mapping (spec (e)). The RPC's session-ownership check is untouched;
  // p_student_id comes ONLY from resolveActiveStudent (R6). No attemptMode.
  const { data, error } = await supabaseAdmin.rpc('submit_quiz_results_v2', {
    p_session_id: session.d6_quiz_session_id,
    p_student_id: active.studentId,
    p_subject: session.subject,
    p_grade: session.grade, // P5: STRING
    p_topic: null,
    p_chapter: null,
    p_responses: responses,
    p_time: pTime,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    // Retry on the next inbound / drain pass with the SAME key (spec (e)).
    logger.warn('whatsapp_daily6: submit_quiz_results_v2 failed (will retry with same key)', {
      error: error.message,
    });
    return 'retry';
  }
  const result = (data ?? {}) as SubmitReturn;

  // Streak read AFTER submit (spec (h)).
  let streakDays = 0;
  const { data: studentRow } = await supabaseAdmin
    .from('students')
    .select('streak_days')
    .eq('id', active.studentId)
    .maybeSingle();
  if (studentRow && typeof (studentRow as { streak_days?: number }).streak_days === 'number') {
    streakDays = (studentRow as { streak_days: number }).streak_days;
  }

  const meta = (session.context.d6_meta ?? []) as ComposedQuestion[];
  const footer = await buildMasteryFooter(active.studentId, meta, locale);

  // Clear d6_* but KEEP d6_date — it is the daily-gate marker (spec (c)).
  const cleared = await clearD6(identityId, session.context, {
    keepDate: session.d6_date,
  });
  if (!cleared) {
    // Idempotency key survives in the RPC's cache; a replay short-circuits.
    logger.warn('whatsapp_daily6: post-submit session clear failed');
  }

  // Closing summary — every number VERBATIM from the RPC return (spec (h)).
  const correctWord = t(locale, 'correct', 'सही');
  let xpPart: string;
  if (result.flagged) {
    xpPart = t(
      locale,
      '+0 XP — answered too fast to earn XP',
      '+0 XP — XP के लिए थोड़ा धीरे सोचकर जवाब दो',
    );
  } else {
    xpPart = `+${result.xp_earned ?? 0} XP`;
    if (result.xp_capped) {
      xpPart += t(locale, ' (daily XP limit reached)', ' (आज की XP सीमा पूरी)');
    }
  }
  const lines = [
    `🎯 ${result.correct}/${result.total} ${correctWord} · ${result.score_percent}% · ${xpPart}`,
  ];
  if (footer) lines.push(footer);
  lines.push(`🔥 Streak: ${streakDays} ${t(locale, 'days', 'दिन')}`);

  const sent = await sendWa({
    identityId,
    message: { type: 'text', body: lines.join('\n') },
    idempotencyKey: `d6:sum:${session.d6_quiz_session_id}`,
    caller: callerFor(evt.source),
  });
  // The submit is durable + idempotent; a summary-send failure retries the
  // event, and the replay path short-circuits via the RPC's idempotency cache.
  return sent ? 'done' : 'retry';
}

/**
 * Footer node (spec (h)): the node_code with the most questions in the set
 * (tie: first srs_due, else first in served order). before = compose-time
 * mastery_pct from d6_meta; after = adaptive_mastery.mastery_prob re-read
 * post-final-bkt_update; next review from next_review_at.
 */
async function buildMasteryFooter(
  studentId: string,
  meta: ComposedQuestion[],
  locale: Locale,
): Promise<string | null> {
  const withNodes = meta.filter((m) => m.node_code);
  if (withNodes.length === 0) return null;

  const counts = new Map<string, number>();
  for (const m of withNodes) {
    counts.set(m.node_code as string, (counts.get(m.node_code as string) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, c]) => c === maxCount).map(([n]) => n);
  let footerNode = tied[0];
  if (tied.length > 1) {
    const srsFirst = withNodes.find((m) => tied.includes(m.node_code as string) && m.source === 'srs_due');
    if (srsFirst) footerNode = srsFirst.node_code as string;
    else footerNode = withNodes.find((m) => tied.includes(m.node_code as string))!.node_code as string;
  }

  const nodeMeta = withNodes.find((m) => m.node_code === footerNode)!;
  const before = nodeMeta.mastery_pct_before;

  const { data } = await supabaseAdmin
    .from('adaptive_mastery')
    .select('mastery_prob, next_review_at')
    .eq('student_id', studentId)
    .eq('node_code', footerNode)
    .maybeSingle();
  const row = data as { mastery_prob?: number; next_review_at?: string | null } | null;
  const after =
    row && typeof row.mastery_prob === 'number' ? Math.round(row.mastery_prob * 100) : null;

  const title = nodeMeta.title ?? footerNode;
  const parts: string[] = [];
  if (before !== null && after !== null) parts.push(`${title}: ${before}% → ${after}%`);
  else if (after !== null) parts.push(`${title}: ${after}%`);
  else parts.push(title);

  if (row?.next_review_at) {
    parts.push(`${t(locale, 'Next review', 'अगला रिवीज़न')}: ${formatNextReview(row.next_review_at)}`);
  }
  return parts.join(' · ');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** IST weekday ("Thu") within 6 days, else "12 Aug" (spec (h)). */
export function formatNextReview(iso: string, now: Date = new Date()): string {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '';
  const istDayIndex = (d: Date): number =>
    Math.floor((d.getTime() + 330 * 60_000) / 86_400_000);
  const diffDays = istDayIndex(target) - istDayIndex(now);
  const shifted = istNow(target);
  if (diffDays <= 6) return WEEKDAYS[shifted.getUTCDay()];
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}`;
}

// ─── Menu / subject pick ────────────────────────────────────────────────────

async function handleMenu(evt: Daily6Event, identityId: string, locale: Locale): Promise<Daily6Outcome> {
  const sent = await sendWa({
    identityId,
    message: menuMessage(locale),
    idempotencyKey: `menu:${evt.id}`,
    caller: callerFor(evt.source),
  });
  return sent ? 'done' : 'retry';
}

async function handleSubjectPick(
  evt: Daily6Event,
  identityId: string,
  active: ActiveStudent,
  session: SessionRow | null,
): Promise<Daily6Outcome> {
  const subject = evt.args.subject ?? '';
  if (!subject) return 'done';
  const allowed = await subjectChoicesFor(active);
  if (!allowed.includes(subject)) {
    // Unknown / stale row id — re-offer the picker.
    const sent = await sendWa({
      identityId,
      message: subjectPickerMessage(active.locale, allowed, session?.subject ?? active.subject),
      idempotencyKey: `d6:repick:${evt.id}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }
  // Same daily gate applies on the pick path.
  const today = istDate();
  if (session?.state === 'daily6_active') {
    return session.d6_date === today
      ? handleDaily6Resume(evt, identityId, active, session)
      : handleDaily6Expiry(evt, identityId, active, session);
  }
  if (session?.d6_date === today) {
    const sent = await sendWa({
      identityId,
      message: doneForTodayMessage(active.locale),
      idempotencyKey: `d6:gate:${evt.id}`,
      caller: callerFor(evt.source),
    });
    return sent ? 'done' : 'retry';
  }
  return composeAndServe(evt, identityId, active, session, subject);
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Single entry point for both callers. Never throws; unexpected errors map
 * to 'retry' (the event row stays/bounces to 'pending' for the drain).
 */
export async function processDaily6Event(evt: Daily6Event): Promise<Daily6Outcome> {
  try {
    const identityId = await resolveIdentityId(evt.phoneHash);
    if (!identityId) {
      // No live identity → nothing to reply to and nothing to do. Terminal.
      return 'failed';
    }

    const active = await resolveActiveStudent(supabaseAdmin, identityId);
    const session = await loadSession(identityId);
    const locale: Locale = session?.locale === 'hi' ? 'hi' : 'en';

    if (!active) {
      // Live identity but no resolvable student (e.g. guardian-only phone).
      const sent = await sendWa({
        identityId,
        message: notLinkedMessage(locale),
        idempotencyKey: `d6:unlinked:${evt.id}`,
        caller: callerFor(evt.source),
      });
      return sent ? 'done' : 'retry';
    }

    switch (evt.intent) {
      case 'menu':
        return handleMenu(evt, identityId, active.locale);
      case 'subject_pick':
        return handleSubjectPick(evt, identityId, active, session);
      case 'd6_start':
        return startDaily6(evt, identityId, active, session);
      case 'd6_answer':
        return handleDaily6Answer(evt, identityId, active, session);
      default:
        return 'done';
    }
  } catch (err) {
    logger.error('whatsapp_daily6: unhandled processor error', {
      intent: evt.intent,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'retry';
  }
}

/**
 * Webhook after() wrapper: runs the processor and settles the event row.
 * done → 'done'; failed → 'failed'; retry → row LEFT 'pending' (the drain
 * cron claims it after its 45s staleness cutoff).
 */
export async function runDaily6EventFromWebhook(evt: Daily6Event): Promise<void> {
  const outcome = await processDaily6Event(evt);
  try {
    if (outcome === 'done') {
      await supabaseAdmin
        .from('whatsapp_inbound_events')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', evt.id);
    } else if (outcome === 'failed') {
      await supabaseAdmin
        .from('whatsapp_inbound_events')
        .update({
          status: 'failed',
          last_error: 'daily6_terminal',
          processed_at: new Date().toISOString(),
        })
        .eq('id', evt.id);
    }
    // 'retry': leave status='pending' — the drain is the retry mechanism.
  } catch (err) {
    logger.warn('whatsapp_daily6: event status settle failed', {
      eventId: evt.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
