/**
 * /api/foxy — M4 extracted session + history helpers.
 *
 * H1 REFACTOR Step 4 (behavior-preserving). These functions were lifted
 * verbatim out of `src/app/api/foxy/route.ts`. They perform service-role
 * Supabase I/O on the `foxy_sessions` / `foxy_chat_messages` tables (session
 * get-or-create with flag-gated idle/reactivate semantics, recent-history
 * load, and prior-session context assembly) plus a best-effort
 * `ai.foxy_session_started` event publish on new-session creation. The route
 * imports them and uses them identically at the same call sites — zero
 * behavior change. `resolveSession` is re-exported from `route.ts` (its
 * historical public test surface) so the existing unit tests still resolve it
 * there. The session idle/resume decision, history ordering/limit, and the
 * foxy_session_started publish payload are byte-identical to the originals
 * (pinned by foxy-resolve-session, foxy-session-started, and the route
 * characterization tests). Shared constants/types (ChatMessage,
 * mapFoxyModeToEventMode) live in `./constants`; chapter parsing lives in
 * `@alfanumrik/lib/foxy/chapter-parser` — this module imports rather than redefines.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';
import { randomUUID } from 'node:crypto';
import { parseFoxyChapterNumber } from '@alfanumrik/lib/foxy/chapter-parser';
import { mapFoxyModeToEventMode, type ChatMessage } from './constants';

// ─── Constants ──────────────────────────────────────────────────────────────

// Phase 2.4: bumped from 6 → 20 turns. Anthropic prompt caching
// (cache_control: ephemeral) is applied to the system prompt + first ~10
// turns so input cost stays roughly flat despite the longer history.
// Phase 2 of Foxy continuity fix (2026-05-18): bumped to 30 to capture full
// Socratic rounds without scrolling original framing off. With native
// conversation_turns flagged on, the grounded-answer service will pass these
// to Claude as `messages[]` rather than string-interpolating them.
const MAX_HISTORY_TURNS = 30;
// Phase 1 of Foxy continuity fix (2026-05-18): bumped 30 → 240 (4 hours).
// 30 min was destroying session history every time a student paused to read a
// long explanation, take a bathroom break, or think carefully. 4h covers a
// school day + after-school study + network reconnections. The stricter
// "never silently reset, even after 4h" semantics live behind
// ff_foxy_session_reactivate_v1 in resolveSession().
const SESSION_IDLE_MINUTES = 240;

// ─── Helper: get or create session ───────────────────────────────────────────

/* @internal Exported for unit testing only — do NOT import from app code. */
export async function resolveSession(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null,
  mode: string,
  providedSessionId: string | null,
  /**
   * ADR-001 Phase 2d — when a NEW session row is INSERTed, the function
   * publishes ai.foxy_session_started on the state_events bus. These
   * two extra inputs are the event envelope's actorAuthUserId + tenantId.
   * Best-effort, gated by ff_event_bus_v1 inside publishEvent — never
   * blocks session creation. The session_completed event is intentionally
   * NOT published from this code path (no clean session-end trigger in
   * the current product surface). A follow-on will add a session-end
   * sweeper or explicit close endpoint.
   */
  authUserId: string,
  schoolId: string | null,
): Promise<string> {
  if (providedSessionId) {
    // Phase 1 (2026-05-18): flag-gated reactivation semantics. When ON, we
    // load the session WITHOUT the idle filter and reuse it as long as the
    // pedagogy context (subject + chapter + mode) still matches. This is
    // the structural fix for RC1 in the Foxy continuity plan — silent
    // session resets after the idle cutoff destroyed student-perceived
    // history. The OLD path (flag OFF) is kept verbatim except for the
    // new silent_reset telemetry line so we can measure RC1 in prod.
    const reactivateMode = await isFeatureEnabled('ff_foxy_session_reactivate_v1', {
      role: 'student',
      userId: authUserId,
    });

    if (reactivateMode) {
      // NEW path: never silently reset; explicit context-change check.
      const { data: existing } = await supabaseAdmin
        .from('foxy_sessions')
        .select('id, subject, chapter, mode, last_active_at')
        .eq('id', providedSessionId)
        .eq('student_id', studentId)
        .single();

      if (existing) {
        const ctxMatches =
          existing.subject === subject
          && (existing.chapter || null) === (chapter || null)
          && existing.mode === mode;
        const idleMs = Date.now() - new Date(existing.last_active_at).getTime();

        if (ctxMatches) {
          if (idleMs > SESSION_IDLE_MINUTES * 60 * 1000) {
            logger.info('foxy.session.reactivated_after_idle', {
              foxySessionId: providedSessionId,
              studentId,
              idleDurationMs: idleMs,
            });
          }
          await supabaseAdmin
            .from('foxy_sessions')
            .update({ last_active_at: new Date().toISOString() })
            .eq('id', providedSessionId);
          return providedSessionId;
        }

        // Context mismatch — student switched subject / chapter / mode mid-conversation.
        // This is a legitimate new-session boundary; log it for product analytics.
        logger.info('foxy.session.context_changed', {
          foxySessionId: providedSessionId,
          studentId,
          oldContext: {
            subject: existing.subject,
            chapter: existing.chapter,
            mode: existing.mode,
          },
          newContext: { subject, chapter, mode },
        });
        // fall through to new-session create below
      } else {
        // Session row not found at all (deleted? wrong tenant?) — log so we can
        // distinguish from idle-filter exclusion.
        logger.warn('foxy.session.silent_reset', {
          providedSessionId,
          studentId,
          reason: 'session_not_found',
        });
        // fall through to new-session create below
      }
    } else {
      // OLD path (flag OFF): idle filter behavior. Kept verbatim except for
      // the new silent_reset telemetry on the fall-through case.
      const cutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin
        .from('foxy_sessions')
        .select('id')
        .eq('id', providedSessionId)
        .eq('student_id', studentId)
        .gte('last_active_at', cutoff)
        .single();

      if (existing) {
        await supabaseAdmin
          .from('foxy_sessions')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', providedSessionId);
        return providedSessionId;
      }

      // Phase 1 observability: log every case where the client sent a
      // sessionId but the OLD path is about to create a new session. This
      // is the silent_reset signal we never had before. Measurable in
      // PostHog; should drop to near-zero once ff_foxy_session_reactivate_v1
      // is rolled out to 100%.
      logger.warn('foxy.session.silent_reset', {
        providedSessionId,
        studentId,
        reason: 'idle_filter_excluded',
      });
    }
  }

  const { data: newSession, error } = await supabaseAdmin
    .from('foxy_sessions')
    .insert({
      student_id: studentId,
      subject,
      grade,
      chapter: chapter || null,
      mode,
      last_active_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !newSession) {
    throw new Error(`Failed to create Foxy session: ${error?.message}`);
  }

  // ADR-001 Phase 2d — publish ai.foxy_session_started for the brand-new
  // session row. Best-effort; failures log and continue.
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'ai.foxy_session_started',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: authUserId,
      tenantId: schoolId,
      idempotencyKey: `foxy_session_started:${newSession.id}`,
      payload: {
        foxySessionId: newSession.id,
        subjectCode: subject ? subject.toLowerCase() : null,
        chapterNumber: parseFoxyChapterNumber(chapter),
        mode: mapFoxyModeToEventMode(mode),
      },
    });
  } catch (err) {
    logger.warn('foxy.resolveSession: publishEvent ai.foxy_session_started failed', {
      foxySessionId: newSession.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return newSession.id;
}

// ─── Helper: load recent conversation history ─────────────────────────────────

export async function loadHistory(sessionId: string): Promise<ChatMessage[]> {
  // Phase 2 of Foxy continuity fix (2026-05-18): exclude rows still awaiting
  // their LLM completion (pending=true). The new persist-before-LLM path
  // inserts a pending assistant row before the model call returns; if the
  // call dies the row stays in place so the UI can render a "Foxy is
  // thinking..." affordance, but it MUST NOT enter the next turn's prompt
  // as if it were a real assistant response.
  //
  // The migration (20260528000012) sets DEFAULT false NOT NULL so every
  // existing row evaluates `pending=false`. We additionally guard against
  // the rare case where this code runs on an env that hasn't applied the
  // migration yet (e.g., a fresh dev DB) — the predicate will fail with
  // "column does not exist" and we fall back to the legacy unfiltered
  // query so chat keeps working.
  const { data: messages, error } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .eq('pending', false)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_TURNS * 2);

  if (error) {
    logger.warn('foxy_load_history_pending_filter_failed', {
      sessionId,
      error: error.message,
    });
    const { data: fallback } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_TURNS * 2);
    if (!fallback || fallback.length === 0) return [];
    return (fallback as ChatMessage[]).reverse();
  }

  if (!messages || messages.length === 0) return [];
  return (messages as ChatMessage[]).reverse();
}

// ─── Helper: load prior-session context (Task 1.3) ───────────────────────────
// Last 6-10 messages from PRIOR sessions on the same (student, subject,
// chapter) tuple. We exclude the current session so we don't double-count
// turns the student is actively in. Returns at most PRIOR_SESSION_MSG_LIMIT
// turn snippets (a snippet is a [user → assistant] pair compressed to
// content previews, 200 chars each).
//
// Phase 1.3 cheap-path: no Haiku summarization. We inject the raw last few
// turns as `[previous: …]` snippets in the prompt template. If this proves
// too noisy, Phase 2 can add a Haiku summary step here.
const PRIOR_SESSION_MSG_LIMIT = 10;
const PRIOR_SESSION_LOOKBACK_DAYS = 30;

export interface PriorSessionTurn {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export async function loadPriorSessionContext(
  studentId: string,
  subject: string,
  grade: string,
  currentSessionId: string,
  chapter: string | null,
): Promise<PriorSessionTurn[]> {
  void grade; // session-row scoping (subject + chapter) is sufficient for now
  try {
    // Find prior session ids for this student / subject / chapter (if known).
    // We look back 30 days so we don't drag in stale sessions from months ago.
    const lookbackIso = new Date(
      Date.now() - PRIOR_SESSION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    let sessionsQuery = supabaseAdmin
      .from('foxy_sessions')
      .select('id')
      .eq('student_id', studentId)
      .eq('subject', subject)
      .gte('last_active_at', lookbackIso)
      .neq('id', currentSessionId)
      .order('last_active_at', { ascending: false })
      .limit(3);
    if (chapter) sessionsQuery = sessionsQuery.eq('chapter', chapter);

    const { data: priorSessions } = await sessionsQuery;
    if (!priorSessions || priorSessions.length === 0) return [];

    const priorSessionIds = priorSessions.map((s: any) => s.id);

    const { data: priorMessages } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('role, content, created_at')
      .in('session_id', priorSessionIds)
      .order('created_at', { ascending: false })
      .limit(PRIOR_SESSION_MSG_LIMIT);

    if (!priorMessages || priorMessages.length === 0) return [];
    // Reverse to chronological order so the prompt reads forward in time.
    return (priorMessages as PriorSessionTurn[]).reverse();
  } catch (err) {
    logger.warn('foxy_prior_session_context_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
      subject,
    });
    return [];
  }
}

/**
 * Format prior-session turns into a prompt section. Each turn is truncated to
 * 200 chars to keep the prompt bounded. Empty array → empty string (template
 * handles missing cleanly).
 */
export function buildPriorSessionPromptSection(turns: PriorSessionTurn[]): string {
  if (turns.length === 0) return '';
  const lines = turns.map((t) => {
    const speaker = t.role === 'user' ? 'Student' : 'Foxy';
    const content = (t.content ?? '').slice(0, 200).replace(/\s+/g, ' ').trim();
    return `[previous · ${speaker}] ${content}`;
  });
  return [
    '## PREVIOUS CONVERSATION (recent prior sessions on this subject/chapter)',
    'Use this only as context — do not address the previous turns directly. The student\'s current question is in the user message.',
    ...lines,
  ].join('\n');
}
