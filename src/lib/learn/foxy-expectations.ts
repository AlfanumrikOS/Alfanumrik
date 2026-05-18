/**
 * Foxy Pending Expectations — Phase 3 of Foxy conversation continuity (2026-05-18).
 *
 * THE MOAT.
 *
 * "Structured education shall be saved in memory" — CEO directive verbatim.
 *
 * Problem this solves: students report Foxy "asks a question and when they
 * answer, it doesn't relate." Phase 1 (#848) fixed silent session resets.
 * Phase 2 (parallel PR) fixes native multi-turn history wiring. Phase 3 —
 * this module — adds first-class server state: "Foxy just asked X, the
 * student's next reply is answering X". Even if either of Phase 1/2
 * degrades, the open question stays anchored server-side and gets re-
 * injected into the next prompt as an ANSWERING_NOW block.
 *
 * Data shape: foxy_pending_expectations rows (see migration
 * 20260528000013_foxy_pending_expectations.sql).
 *
 * Public API
 * ──────────
 *   extractExpectation(assistantText, opts)   → ExtractedExpectation | null
 *   writeExpectation(supabase, params)        → Promise<string | null>  (row id)
 *   loadOpenExpectation(supabase, sessionId)  → Promise<OpenExpectation | null>
 *   markExpectationAnswered(supabase, id, messageId)  → Promise<void>
 *   markExpectationAbandoned(supabase, id)            → Promise<void>
 *   buildExpectationPromptSection(exp)        → string  (for template var)
 *
 * Everything is best-effort. Every DB op is wrapped in try/catch by the
 * caller; reads return null on error, writes log and swallow.
 *
 * Flag gate: caller checks ff_foxy_pending_expectations_v1 before invoking
 * any of these. This module itself has no flag awareness — it is a pure
 * library.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExpectationKind =
  | 'mcq'
  | 'open'
  | 'recall'
  | 'solve'
  | 'explain'
  | 'choose_topic';

export interface ExtractedExpectation {
  kind: ExpectationKind;
  text: string;
  meta: Record<string, unknown>;
}

export interface OpenExpectation extends ExtractedExpectation {
  id: string;
  session_id: string;
  student_id: string;
  subject: string;
  grade: string;
  chapter: string | null;
  topic_id: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  created_at: string;
  expires_at: string;
  asked_message_id: string | null;
}

export interface WriteExpectationParams {
  sessionId: string;
  studentId: string;
  expectation: ExtractedExpectation;
  subject: string;
  grade: string;            // P5: string, never integer
  chapter?: string | null;
  topicId?: string | null;
  bloomLevel?: string | null;
  difficulty?: string | null;
  askedMessageId?: string | null;
}

/**
 * Loose-typed structured assistant payload. Mirrors a subset of FoxyResponse
 * (src/lib/foxy/schema.ts) without importing the full Zod schema — keeps the
 * extractor lightweight and unit-testable in isolation.
 */
export interface StructuredAssistantPayload {
  question?: {
    text?: string;
    kind?: string;
    options?: Array<{ text?: string; label?: string } | string>;
  } | null;
  blocks?: Array<{
    kind?: string;
    text?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface ExtractOptions {
  /**
   * Optional structured payload from grounded-answer. When the assistant
   * returns a structured `question` block, we prefer that over heuristic
   * extraction from the rendered text — it's already canonicalized.
   */
  structured?: StructuredAssistantPayload | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_EXPECTATION_TEXT_LEN = 500;

// Patterns Foxy uses for closing questions per the prompt template:
//   "-> Now you try: ..."  (CHECK question)
//   "-> What would happen if..."  (STRETCH/SCAFFOLD)
// We treat any line beginning with "-> " as a strong candidate.
const ARROW_PROMPT_RE = /^->\s+(.+?)\s*\??$/m;

// Generic "ends in question mark" matcher — fallback when no "->" prefix.
const TRAILING_QUESTION_RE = /([^.!?]*\?)\s*$/m;

// MCQ option signature. Foxy sometimes writes options inline:
//   "A) 12  B) 14  C) 18  D) 20"
// We accept upper or lower, with `)`, `.`, or `:` separators.
const MCQ_OPTION_LINE_RE = /(?:^|\s)\(?([A-Da-d])\)?[\.\):\s]+([^A-Da-d\n]{1,80})/g;

// "Choose a topic" / menu signature. Foxy frequently offers a list:
//   "Pick one: photosynthesis, respiration, transpiration"
//   "Which would you like? 1) X 2) Y 3) Z"
const CHOOSE_TOPIC_RE = /\b(pick one|choose one|which (?:would you like|topic|sub-?topic)|let'?s start with|where would you like to start)\b/i;

// Solve signature — numeric/computational expectation.
const SOLVE_RE = /\b(calculate|compute|solve|find the (?:value|answer|result)|how many|what is the (?:sum|product|difference|area|volume|speed|distance|force))\b/i;

// Recall signature — definition/fact lookup.
const RECALL_RE = /\b(define|what (?:does|do|is)|name the|list the|state the|recall|tell me)\b/i;

// Explain signature — reasoning/why.
const EXPLAIN_RE = /\b(why|explain|how does|how would you|justify|reason)\b/i;

// ─── extractExpectation ──────────────────────────────────────────────────────

/**
 * Pull the "what Foxy is asking" out of an assistant reply.
 *
 * Strategy:
 *   1. If the structured payload carries an explicit `question` block, use
 *      it. That's the most trustworthy source.
 *   2. Otherwise, scan the rendered text:
 *      a. Prefer a line starting with "-> " (Foxy's closing-question marker
 *         per the foxy_tutor_v1 prompt).
 *      b. Fall back to the last `?`-terminated sentence.
 *   3. Classify the kind from regex signatures on the question text and
 *      surrounding context.
 *   4. If no question signal at all, return null.
 *
 * Returns null when no question was asked (e.g., a pure abstain / safety
 * redirect / statement-only reply).
 */
export function extractExpectation(
  assistantText: string,
  opts: ExtractOptions = {},
): ExtractedExpectation | null {
  // ── Path 1: structured payload (preferred) ────────────────────────────
  const structured = opts.structured;
  if (structured && typeof structured === 'object') {
    const q = structured.question;
    if (q && typeof q === 'object' && typeof q.text === 'string' && q.text.trim().length > 0) {
      const text = truncate(q.text.trim(), MAX_EXPECTATION_TEXT_LEN);
      const kind = normalizeKind(q.kind, text, assistantText);
      const meta: Record<string, unknown> = {};
      if (Array.isArray(q.options) && q.options.length > 0) {
        meta.options = q.options
          .map((o) => {
            if (typeof o === 'string') return o;
            if (o && typeof o === 'object') {
              return (o.text ?? o.label ?? '').toString();
            }
            return '';
          })
          .filter((s) => s.length > 0);
      }
      meta.source = 'structured';
      return { kind, text, meta };
    }
  }

  // ── Path 2: heuristic text scan ───────────────────────────────────────
  const raw = (assistantText ?? '').trim();
  if (!raw) return null;

  // 2a. "-> " closing-question marker — Foxy's primary signal.
  let candidate: string | null = null;
  const arrowMatches = [...raw.matchAll(/^->\s+(.+?)\s*$/gm)];
  if (arrowMatches.length > 0) {
    // Multi-question reply: prefer the LAST arrow prompt — that's the one
    // Foxy actually wants answered. Earlier "-> " lines are usually
    // worked-example checkpoints.
    candidate = arrowMatches[arrowMatches.length - 1][1].trim();
  } else {
    // 2b. Trailing `?` sentence — accept only if reply has at least one `?`.
    if (raw.includes('?')) {
      const trailing = TRAILING_QUESTION_RE.exec(raw);
      if (trailing) {
        candidate = trailing[1].trim();
      } else {
        // Multi-line: find the last sentence ending in `?` anywhere.
        const allQuestions = raw.match(/[^.!?\n]*\?/g);
        if (allQuestions && allQuestions.length > 0) {
          candidate = allQuestions[allQuestions.length - 1].trim();
        }
      }
    }
  }

  if (!candidate) return null;

  // Strip leading list markers, dashes, etc.
  candidate = candidate.replace(/^[\-\*\d\.\)\s>]+/, '').trim();
  if (!candidate) return null;

  const text = truncate(candidate, MAX_EXPECTATION_TEXT_LEN);
  const kind = normalizeKind(undefined, text, raw);

  const meta: Record<string, unknown> = { source: 'heuristic' };

  // Look for MCQ options anywhere in the reply (not just the question line),
  // because Foxy often puts options on a separate line above the "-> "
  // closing prompt.
  if (kind === 'mcq') {
    const options = extractMcqOptions(raw);
    if (options.length >= 2) {
      meta.options = options;
    } else {
      // Demote: no actual options visible. Treat as open question.
      return { kind: 'open', text, meta: { source: 'heuristic', demoted_from: 'mcq' } };
    }
  }

  return { kind, text, meta };
}

// ─── kind classification ─────────────────────────────────────────────────────

function normalizeKind(
  hintedKind: string | undefined,
  questionText: string,
  fullReply: string,
): ExpectationKind {
  // Trust explicit hint when valid.
  if (hintedKind) {
    const norm = hintedKind.toLowerCase().trim();
    if (
      norm === 'mcq' ||
      norm === 'open' ||
      norm === 'recall' ||
      norm === 'solve' ||
      norm === 'explain' ||
      norm === 'choose_topic'
    ) {
      return norm;
    }
  }

  const combined = `${questionText}\n${fullReply}`;

  // Choose-topic / menu signal trumps everything else — those replies often
  // include "?" but aren't really questions in the answer-this sense.
  if (CHOOSE_TOPIC_RE.test(combined)) return 'choose_topic';

  // MCQ signal: at least 2 option labels visible (A/B/C/D or 1/2/3/4).
  // Cheap pre-check: only count when we see at least 2 option markers.
  const optionMarkers = (fullReply.match(/(?:^|\s)\(?[A-Da-d1-4]\)?[\.\)]\s/g) || []).length;
  if (optionMarkers >= 2) return 'mcq';

  // Solve > Recall > Explain ordering: solve is most specific.
  if (SOLVE_RE.test(questionText)) return 'solve';
  if (RECALL_RE.test(questionText)) return 'recall';
  if (EXPLAIN_RE.test(questionText)) return 'explain';

  return 'open';
}

function extractMcqOptions(reply: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  // Reset the regex (it's stateful with /g flag).
  const re = new RegExp(MCQ_OPTION_LINE_RE.source, 'g');
  while ((m = re.exec(reply)) !== null) {
    const label = m[1].toUpperCase();
    if (seen.has(label)) continue;
    const text = m[2].trim().replace(/\s+/g, ' ');
    if (text.length === 0) continue;
    out.push(`${label}) ${text}`);
    seen.add(label);
    if (out.length >= 6) break;  // hard cap, shouldn't happen
  }
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

// ─── writeExpectation ────────────────────────────────────────────────────────

/**
 * INSERT one open expectation. Best-effort: returns the new row id on
 * success, null on any error (caller logs and continues).
 *
 * Uses a `SupabaseClient` (typically supabaseAdmin from /api/foxy so writes
 * bypass RLS).
 */
export async function writeExpectation(
  supabase: SupabaseClient,
  params: WriteExpectationParams,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('foxy_pending_expectations')
      .insert({
        session_id: params.sessionId,
        student_id: params.studentId,
        expectation_kind: params.expectation.kind,
        expectation_text: params.expectation.text,
        expectation_meta: params.expectation.meta ?? {},
        subject: params.subject,
        grade: params.grade,                                  // P5: string
        chapter: params.chapter ?? null,
        topic_id: params.topicId ?? null,
        bloom_level: params.bloomLevel ?? null,
        difficulty: params.difficulty ?? null,
        asked_message_id: params.askedMessageId ?? null,
        // status / created_at / expires_at use DB defaults
      })
      .select('id')
      .single();

    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[foxy-expectations] write failed:', error.message);
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[foxy-expectations] write threw:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ─── loadOpenExpectation ─────────────────────────────────────────────────────

/**
 * Read the most recent OPEN expectation for a session. Returns null when:
 *   - no open expectations exist
 *   - the read fails (best-effort — never blocks the request)
 *
 * Hot path on every Foxy turn when the flag is on, so the
 * `foxy_pending_expectations_session_open_idx` partial index serves this.
 */
export async function loadOpenExpectation(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<OpenExpectation | null> {
  try {
    const { data, error } = await supabase
      .from('foxy_pending_expectations')
      .select(
        'id, session_id, student_id, expectation_kind, expectation_text, expectation_meta, ' +
          'subject, grade, chapter, topic_id, bloom_level, difficulty, ' +
          'created_at, expires_at, asked_message_id',
      )
      .eq('session_id', sessionId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[foxy-expectations] load failed:', error.message);
      return null;
    }
    if (!data) return null;

    // Supabase's generated select() typings narrow to GenericStringError
    // when the column list is a string literal we haven't typed. Cast
    // through `unknown` to a plain record shape — we already null-checked.
    const row = data as unknown as {
      id: string;
      session_id: string;
      student_id: string;
      expectation_kind: string;
      expectation_text: string;
      expectation_meta: Record<string, unknown> | null;
      subject: string;
      grade: string;
      chapter: string | null;
      topic_id: string | null;
      bloom_level: string | null;
      difficulty: string | null;
      created_at: string;
      expires_at: string;
      asked_message_id: string | null;
    };

    return {
      id: row.id,
      session_id: row.session_id,
      student_id: row.student_id,
      kind: row.expectation_kind as ExpectationKind,
      text: row.expectation_text,
      meta: row.expectation_meta ?? {},
      subject: row.subject,
      grade: row.grade,
      chapter: row.chapter ?? null,
      topic_id: row.topic_id ?? null,
      bloom_level: row.bloom_level ?? null,
      difficulty: row.difficulty ?? null,
      created_at: row.created_at,
      expires_at: row.expires_at,
      asked_message_id: row.asked_message_id ?? null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[foxy-expectations] load threw:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ─── lifecycle markers ───────────────────────────────────────────────────────

/**
 * Student answered → close the loop.
 */
export async function markExpectationAnswered(
  supabase: SupabaseClient,
  expectationId: string,
  answeredMessageId: string | null,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('foxy_pending_expectations')
      .update({
        status: 'answered',
        answered_at: new Date().toISOString(),
        answered_message_id: answeredMessageId,
      })
      .eq('id', expectationId)
      .eq('status', 'open');  // race-safe: only flip if still open

    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[foxy-expectations] mark-answered failed:', error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[foxy-expectations] mark-answered threw:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Foxy moved on without resolving the prior expectation (e.g., the student
 * changed topics, or Foxy reset to a new question without acknowledging the
 * answer). Marks the prior row as abandoned so analytics can flag the
 * pattern.
 */
export async function markExpectationAbandoned(
  supabase: SupabaseClient,
  expectationId: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('foxy_pending_expectations')
      .update({ status: 'abandoned' })
      .eq('id', expectationId)
      .eq('status', 'open');

    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[foxy-expectations] mark-abandoned failed:', error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[foxy-expectations] mark-abandoned threw:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─── buildExpectationPromptSection ───────────────────────────────────────────

/**
 * Render the ANSWERING_NOW prompt block. Returns an empty string when
 * `exp` is null — the foxy_tutor_v1 template treats missing variables as
 * empty (see prompts/index.ts resolveTemplate).
 */
export function buildExpectationPromptSection(exp: OpenExpectation | null): string {
  if (!exp) return '';

  const lines: string[] = [
    '## ANSWERING_NOW (read carefully — this is what the student is responding to)',
    'On your previous turn you asked the student:',
    `  "${exp.text.replace(/"/g, '\\"')}"`,
    `Expected answer kind: ${exp.kind}`,
  ];

  const options = Array.isArray((exp.meta as Record<string, unknown>).options)
    ? ((exp.meta as Record<string, unknown>).options as unknown[])
    : null;
  if (options && options.length > 0) {
    const rendered = options
      .filter((o): o is string => typeof o === 'string' && o.length > 0)
      .join('; ');
    if (rendered.length > 0) {
      lines.push(`Options offered: ${rendered}`);
    }
  }

  lines.push(
    '',
    'Evaluate the student\'s current message AS AN ANSWER TO THE QUESTION ABOVE.',
    'Do NOT start a new topic until the current expectation is resolved.',
    'If the answer is correct, acknowledge it concisely ("Correct!" / "Bilkul sahi!") then move forward.',
    'If the answer is wrong or partial, gently surface the misconception and re-prompt.',
    'If the student\'s message clearly ignores the question (e.g., asks something unrelated), briefly re-anchor: "Quick check — you were on: [restate question]. Want to stay on this or switch?"',
  );

  return lines.join('\n');
}

// ─── small helpers exported for tests ────────────────────────────────────────

export const __test = {
  truncate,
  extractMcqOptions,
  normalizeKind,
};
