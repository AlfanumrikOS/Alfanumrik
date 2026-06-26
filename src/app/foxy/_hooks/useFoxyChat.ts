/**
 * useFoxyChat — Foxy chat state + streaming protocol hook.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 3: extract chat state + streaming into a hook
 *
 * MOVED VERBATIM from `src/app/foxy/page.tsx` (no behavior changes):
 *   - `shouldUseStreaming()` — per-user opt-out via localStorage
 *   - `callFoxyTutor()`     — non-streaming JSON branch (POST /api/foxy)
 *   - `callFoxyTutorStream()` — SSE streaming branch with JSON-fallback
 *   - `messages` / `chatSessionId` / `loading` state
 *   - the `nextMessageId` monotonic counter
 *   - the `sendMessage` core (streaming + JSON branches, image base64,
 *     anti-double-bubble guard, structured payload stamping, persisted
 *     messageId stamping for B'-5 Phase 2 feedback wiring)
 *
 * Cross-cutting page effects (foxyState animation, TTS auto-speak, daily
 * usage modal, conversation list refresh, lesson-step advance, sound
 * effects) are NOT moved into the hook — they're kept in foxy/page.tsx
 * and dispatched via the optional callbacks on `sendMessage`. This keeps
 * the hook narrow (chat protocol only) and avoids dragging unrelated
 * concerns into the streaming path.
 *
 * The streaming protocol talks to /api/foxy directly via fetch; it does
 * NOT use SUPABASE_URL/SUPABASE_ANON_KEY (those imports remain in page.tsx
 * for any future use, but neither helper here references them).
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  GroundingStatus,
  AbstainReason,
  SuggestedAlternative,
} from '@/components/foxy/ChatBubble';
import type { FoxyResponse } from '@/lib/foxy/schema';
import type { ChatMessage, StreamingCallbacks, QuizMeWire } from '../_lib/foxy-types';

/* ══════════════════════════════════════════════════════════════
   STREAMING — Phase 1.1
   ══════════════════════════════════════════════════════════════ */

/** Per-user opt-out: localStorage.alfanumrik_foxy_stream = '0'.
 *  Default: streaming on (when ff_foxy_streaming is also enabled server-side). */
export function shouldUseStreaming(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = window.localStorage.getItem('alfanumrik_foxy_stream');
    return v !== '0';
  } catch {
    return true;
  }
}

/**
 * Calls /api/foxy (non-streaming JSON branch). Returns a normalized response
 * shape carrying the reply text, session id, grounding metadata, the
 * validated structured payload (when produced), and persistence info.
 * On HTTP errors returns a friendly localized fallback message — never
 * throws. Behavior mirrors the original `callFoxyTutor` from page.tsx.
 */
export async function callFoxyTutor(params: Record<string, any> & { language?: string }) {
  const isHi = params.language === 'hi';
  try {
    let accessToken: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token ?? null;
    } catch { /* proceed without token — cookie fallback in authorizeRequest */ }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch('/api/foxy', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        message:   params.message,
        subject:   params.subject,
        grade:     params.grade,
        chapter:   params.chapter   ?? null,
        board:     params.board     ?? null,
        sessionId: params.session_id ?? null,
        mode:      params.mode      ?? 'learn',
        ...(typeof params.intent === 'string' ? { intent: params.intent } : {}),
        ...(typeof params.coachDirective === 'string' ? { coachDirective: params.coachDirective } : {}),
        ...(params.image_base64 ? {
          image_base64: params.image_base64,
          image_media_type: params.image_media_type ?? 'image/jpeg',
        } : {}),
      }),
    });

    if (!res.ok) {
      let errBody: Record<string, unknown> | null = null;
      try { errBody = await res.json(); } catch { /* not JSON */ }

      if (errBody) {
        console.error('[Foxy] API error', {
          status: res.status,
          error: errBody.error,
          diag: errBody._diag,
        });
      }

      if (res.status === 401) {
        return {
          reply: isHi
            ? 'सेशन समाप्त हो गया। कृपया फिर से साइन इन करें।'
            : 'Session expired. Please sign in again.',
          xp_earned: 0,
          session_id: null,
        };
      }
      if (res.status === 403) {
        const errCode = (errBody?.code as string) ?? '';
        if (errCode === 'PERMISSION_DENIED' || errCode === 'NO_ROLES') {
          return {
            reply: isHi
              ? 'फॉक्सी पेड प्लान पर उपलब्ध है। अपग्रेड करें और AI ट्यूटर से चैट करें!'
              : 'Foxy is available on paid plans. Upgrade to chat with your AI tutor!',
            xp_earned: 0,
            session_id: null,
          };
        }
        return {
          reply: isHi
            ? 'पहुँच अस्वीकृत। कृपया सहायता से संपर्क करें।'
            : 'Access denied. Please contact support.',
          xp_earned: 0,
          session_id: null,
        };
      }
      if (res.status === 429) {
        return {
          reply: (errBody?.error as string) || (isHi
            ? 'आज के सारे संदेश इस्तेमाल हो गए। जारी रखने के लिए अपग्रेड करें!'
            : "You've used all your messages for today. Upgrade to continue!"),
          xp_earned: 0,
          session_id: null,
          limitReached: true,
        };
      }
      if (res.status === 503) {
        return {
          reply: isHi
            ? 'फॉक्सी अभी अस्थायी रूप से उपलब्ध नहीं है। एक मिनट बाद कोशिश करें।'
            : 'Foxy is temporarily unavailable. Please try again in a minute.',
          xp_earned: 0,
          session_id: null,
        };
      }
      return {
        reply: isHi
          ? 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।'
          : 'Something went wrong. Please try again.',
        xp_earned: 0,
        session_id: null,
      };
    }

    const data = await res.json();
    return {
      reply:      data.response || (isHi ? 'मुझे इसके बारे में सोचने दो...' : 'Let me think about that...'),
      xp_earned:  0,
      session_id: data.sessionId || null,
      quota:      data.quotaRemaining,
      upgradePrompt: data.upgradePrompt || null,
      groundingStatus:        data.groundingStatus as GroundingStatus | undefined,
      traceId:                data.traceId as string | undefined,
      abstainReason:          data.abstainReason as AbstainReason | undefined,
      suggestedAlternatives:  data.suggestedAlternatives as SuggestedAlternative[] | undefined,
      groundedFromChunks:     typeof data.groundedFromChunks === 'boolean' ? data.groundedFromChunks : false,
      citationsCount:         typeof data.citationsCount === 'number' ? data.citationsCount : 0,
      structured:             (data.structured as FoxyResponse | undefined) ?? undefined,
      badgeState:             (data.badgeState as ('verified' | 'check_manually' | 'none' | 'out_of_scope') | undefined) ?? undefined,
      messageId:              typeof data.messageId === 'string' ? data.messageId : null,
      // Part B1: evidential "Quiz me" contract (present only on a quiz_me turn).
      quizMe:                 (data.quizMe as QuizMeWire | undefined) ?? undefined,
    };
  } catch (err) {
    console.error('[Foxy] Network error:', err);
    return {
      reply: isHi
        ? 'कनेक्शन की समस्या। अपना नेटवर्क जाँचें और फिर कोशिश करें!'
        : 'Connection issue. Check your network and try again!',
      xp_earned: 0,
      session_id: null,
    };
  }
}

/**
 * Stream a Foxy response. POSTs to /api/foxy with stream:true and consumes
 * the SSE response body. Invokes callbacks as events arrive. Returns a
 * promise that resolves when the stream closes (cleanly OR with error).
 *
 * Compatibility: if the server doesn't honor `stream:true`, the response
 * will be JSON. Falls back to the non-streaming path internally — caller's
 * onDone is still invoked once with the full response.
 */
export async function callFoxyTutorStream(
  payload: Record<string, any>,
  callbacks: StreamingCallbacks,
): Promise<void> {
  let accessToken: string | null = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  } catch { /* fall back to cookie */ }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch('/api/foxy', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!res.ok) {
    callbacks.onError?.({ reason: `http-${res.status}` });
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    try {
      const data = await res.json();
      if (data?.sessionId) callbacks.onSession?.(data.sessionId);
      if (data?.groundingStatus === 'hard-abstain') {
        callbacks.onAbstain?.({
          abstainReason: (data?.abstainReason || 'upstream_error') as AbstainReason,
          suggestedAlternatives: Array.isArray(data?.suggestedAlternatives) ? data.suggestedAlternatives : [],
          traceId: data?.traceId,
        });
        return;
      }
      if (typeof data?.response === 'string' && data.response.length > 0) {
        callbacks.onText(data.response);
      }
      callbacks.onDone({
        tokensUsed: data?.tokensUsed ?? 0,
        latencyMs: 0,
        groundedFromChunks: data?.groundedFromChunks === true,
        citationsCount: typeof data?.citationsCount === 'number' ? data.citationsCount : 0,
        claudeModel: data?.meta?.claude_model || data?.claudeModel || '',
        structured: (data?.structured as FoxyResponse | undefined) ?? undefined,
        badgeState: (data?.badgeState as ('verified' | 'check_manually' | 'none' | 'out_of_scope') | undefined) ?? undefined,
      });
      if (typeof data?.messageId === 'string' && data.messageId.length > 0) {
        callbacks.onPersisted?.({ messageId: data.messageId });
      }
    } catch {
      callbacks.onError?.({ reason: 'non-stream-parse-failed' });
    }
    return;
  }

  if (!res.body) {
    callbacks.onError?.({ reason: 'empty-body' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let citationsCount = 0;
  let metadataTraceId: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      const eventName = eventLine.slice(7).trim();
      let parsed: any = null;
      try { parsed = JSON.parse(dataLine.slice(6)); } catch { continue; }

      if (eventName === 'session') {
        if (parsed?.sessionId) callbacks.onSession?.(parsed.sessionId);
      } else if (eventName === 'metadata') {
        metadataTraceId = parsed?.traceId;
        if (Array.isArray(parsed?.citations)) citationsCount = parsed.citations.length;
        callbacks.onMetadata?.({
          groundingStatus: (parsed?.groundingStatus || 'grounded') as GroundingStatus,
          traceId: parsed?.traceId,
          confidence: parsed?.confidence,
          citationsCount,
        });
      } else if (eventName === 'text') {
        if (typeof parsed?.delta === 'string') callbacks.onText(parsed.delta);
      } else if (eventName === 'done') {
        callbacks.onDone({
          tokensUsed: typeof parsed?.tokensUsed === 'number' ? parsed.tokensUsed : 0,
          latencyMs: typeof parsed?.latencyMs === 'number' ? parsed.latencyMs : 0,
          groundedFromChunks: parsed?.groundedFromChunks === true,
          citationsCount,
          claudeModel: typeof parsed?.claudeModel === 'string' ? parsed.claudeModel : '',
          structured: (parsed?.structured as FoxyResponse | undefined) ?? undefined,
          badgeState: (parsed?.badgeState as ('verified' | 'check_manually' | 'none' | 'out_of_scope') | undefined) ?? undefined,
        });
      } else if (eventName === 'persisted') {
        if (typeof parsed?.messageId === 'string' && parsed.messageId.length > 0) {
          callbacks.onPersisted?.({ messageId: parsed.messageId });
        }
      } else if (eventName === 'abstain') {
        callbacks.onAbstain?.({
          abstainReason: (parsed?.abstainReason || 'upstream_error') as AbstainReason,
          suggestedAlternatives: Array.isArray(parsed?.suggestedAlternatives) ? parsed.suggestedAlternatives : [],
          traceId: parsed?.traceId || metadataTraceId,
        });
      } else if (eventName === 'error') {
        callbacks.onError?.({
          reason: typeof parsed?.reason === 'string' ? parsed.reason : 'unknown',
          traceId: parsed?.traceId || metadataTraceId,
        });
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   useFoxyChat — chat state + sendMessage orchestration
   ══════════════════════════════════════════════════════════════ */

/**
 * Per-call hooks that the page wires into cross-cutting concerns (foxy
 * face animation, TTS, conversation list refresh, daily-limit modal, etc).
 * All optional — `sendMessage` works without any of them.
 */
export interface SendMessageHooks {
  onStart?: () => void;
  onComplete?: (info: {
    reply?: string;
    usedStreaming: boolean;
    /** True when the answer was actually produced from retrieved NCERT chunks
     *  (server's honest "grounded" signal). False on abstain / soft-mode /
     *  legacy responses. Phase 0 Fix 0.5. */
    groundedFromChunks?: boolean;
    /** NCERT citation count (only meaningful when groundedFromChunks). */
    citationsCount?: number;
  }) => void;
  onLimitReached?: (replyMessage: string) => void;
  onUpgradePromptText?: (msg: string) => void;
  onSessionId?: (sessionId: string) => void;
  onTutorReplyAdded?: (info: { reply: string; xpEarned: number; usedStreaming: boolean }) => void;
}

/**
 * The full payload to ship to /api/foxy. The page composes this from its
 * subject/grade/topic state on every call — keeps the hook ignorant of
 * that state model.
 */
/**
 * Phase 1 post-answer learning actions: the optional re-teach / quiz directive
 * the client appends when re-sending the SAME prior question. Maps 1:1 to the
 * server's `coachDirective` enum on POST /api/foxy.
 *   'simplify' → simpler re-explanation
 *   'example'  → one worked example
 *   'quiz_me'  → exactly one oracle-gated inline MCQ (server FORCES blocking)
 */
export type CoachDirective = 'simplify' | 'example' | 'quiz_me';

export interface FoxySendPayload {
  message: string;
  augmentedMessage?: string;     // image-OCR fallback message
  imageFile?: File | null;
  imageBase64?: string;
  imageMediaType?: string;
  studentId?: string;
  studentName?: string;
  grade: string;
  subject: string;
  language: string;
  mode: string;
  topicId?: string | null;
  topicTitle?: string | null;
  chapter?: string | null;
  selectedChapters?: string | null;
  intent?: string;
  /**
   * Phase 1 learning-action re-teach/quiz directive. When set, the SAME prior
   * question is re-sent with this directive so a fresh, directive-shaped Foxy
   * bubble appears. `quiz_me` is forced down the non-streaming JSON branch
   * because the server returns a blocking JSON response (single oracle-gated
   * MCQ) for it.
   */
  coachDirective?: CoachDirective;
}

/** Body for the learning-action telemetry endpoint. */
export interface LearningActionInput {
  /** Persisted DB uuid of the assistant message (ChatMessage.persistedMessageId). */
  messageId: string;
  actionType: 'got_it' | 'explain_simpler' | 'show_example' | 'quiz_me' | 'save';
  sessionId?: string | null;
  conceptId?: string | null;
  subjectCode?: string | null;
  chapterNumber?: number | null;
}

/**
 * Part B1 — input for the evidential grade call (POST /api/foxy/quiz-answer).
 * `attemptId` is client-generated (uuid) and serves as the idempotency key.
 */
export interface SubmitQuizAnswerInput {
  servedItemId: string;
  chosenIndex: number;        // 0..3
  attemptId: string;          // client-generated uuid (idempotency key)
  responseTimeMs: number;     // time from item shown to answer
}

/**
 * Part B1 — normalized result of the evidential grade call. Never throws: a
 * network/parse failure resolves to { ok:false, error:'network' } so the UI
 * can offer a non-blocking retry. Server error codes are surfaced verbatim
 * so the renderer can localise the message (P7).
 */
export type SubmitQuizAnswerResult =
  | {
      ok: true;
      correct: boolean;
      correctIndex: number;
      mastery: { conceptId: string; masteryMean: number; attempts: number; mastered: boolean };
    }
  | {
      ok: false;
      /** Stable error code the UI maps to a bilingual message. */
      error:
        | 'already_answered'   // 409
        | 'too_fast'           // 422
        | 'not_evidential'     // 422 / 404 not_found
        | 'unauthenticated'    // 401
        | 'bad_request'        // 400
        | 'network';           // fetch threw / 500 / unknown
    };

export interface UseFoxyChatResult {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  chatSessionId: string | null;
  setChatSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  xpGained: number;
  setXpGained: React.Dispatch<React.SetStateAction<number>>;
  nextMessageId: () => number;
  clearMessages: () => void;
  sendMessage: (payload: FoxySendPayload, hooks?: SendMessageHooks) => Promise<void>;
  /**
   * Phase 1 learning actions: fire-and-await the non-evidential telemetry
   * endpoint POST /api/foxy/learning-action. Best-effort — resolves to true on
   * a recorded action, false on any failure (the UI never blocks on it). Reuses
   * the same Bearer/cookie auth construction as the chat protocol.
   */
  recordLearningAction: (input: LearningActionInput) => Promise<boolean>;
  /**
   * Part B1 — grade an evidential "Quiz me" answer through the sanctioned
   * mastery pipeline (POST /api/foxy/quiz-answer). Only call this when the
   * served item is evidential (quizMe.evidential === true). Never throws;
   * resolves to a normalized result the renderer maps to a bilingual state.
   */
  submitQuizAnswer: (input: SubmitQuizAnswerInput) => Promise<SubmitQuizAnswerResult>;
}

/**
 * Manages chat messages, session id, loading flag, and the `sendMessage`
 * function that orchestrates the streaming + JSON branches end-to-end.
 *
 * The hook is intentionally narrow — cross-cutting reactions (foxy face,
 * TTS, usage limits) are dispatched through `SendMessageHooks` callbacks
 * so the page module can react without leaking unrelated state into the
 * chat protocol.
 */
export function useFoxyChat(): UseFoxyChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [xpGained, setXpGained] = useState(0);

  // Monotonic message-id counter — avoids Date.now() collision when two
  // setMessages pushes happen in the same ms (user msg + optimistic tutor).
  const messageIdCounterRef = useRef(0);
  const nextMessageId = useCallback(() => {
    messageIdCounterRef.current += 1;
    return Date.now() * 1000 + messageIdCounterRef.current;
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setChatSessionId(null);
    setXpGained(0);
  }, []);

  // Phase 1 learning actions — non-evidential telemetry. Best-effort: never
  // throws, returns false on any failure. Reuses the same Bearer/cookie auth
  // construction as callFoxyTutor so it works behind authorizeRequest.
  const recordLearningAction = useCallback(async (input: LearningActionInput): Promise<boolean> => {
    if (!input?.messageId) return false;
    try {
      let accessToken: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token ?? null;
      } catch { /* cookie fallback in authorizeRequest */ }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

      const res = await fetch('/api/foxy/learning-action', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          messageId: input.messageId,
          actionType: input.actionType,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.conceptId ? { conceptId: input.conceptId } : {}),
          ...(input.subjectCode ? { subjectCode: input.subjectCode } : {}),
          ...(typeof input.chapterNumber === 'number' ? { chapterNumber: input.chapterNumber } : {}),
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Part B1 — evidential grade call. Mirrors the Bearer/cookie auth
  // construction used by callFoxyTutor / recordLearningAction so it works
  // behind authorizeRequest. Never throws: returns a normalized result the
  // MCQ renderer maps to a bilingual state. The SERVER is authoritative for
  // grading, the 3s floor, idempotency, and the mastery move.
  const submitQuizAnswer = useCallback(
    async (input: SubmitQuizAnswerInput): Promise<SubmitQuizAnswerResult> => {
      try {
        let accessToken: string | null = null;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          accessToken = session?.access_token ?? null;
        } catch { /* cookie fallback in authorizeRequest */ }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

        const res = await fetch('/api/foxy/quiz-answer', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            served_item_id: input.servedItemId,
            chosen_index: input.chosenIndex,
            attempt_id: input.attemptId,
            response_time_ms: input.responseTimeMs,
          }),
        });

        let body: Record<string, unknown> | null = null;
        try { body = await res.json(); } catch { /* may be empty */ }

        if (res.ok && body?.ok === true) {
          const mastery = (body.mastery ?? {}) as Record<string, unknown>;
          return {
            ok: true,
            correct: body.correct === true,
            correctIndex: typeof body.correct_index === 'number' ? body.correct_index : -1,
            mastery: {
              conceptId: typeof mastery.concept_id === 'string' ? mastery.concept_id : '',
              masteryMean: typeof mastery.mastery_mean === 'number' ? mastery.mastery_mean : 0,
              attempts: typeof mastery.attempts === 'number' ? mastery.attempts : 0,
              mastered: mastery.mastered === true,
            },
          };
        }

        // Map server status/error codes → stable UI codes (P7-localised by caller).
        const serverError = typeof body?.error === 'string' ? body.error : '';
        if (res.status === 401) return { ok: false, error: 'unauthenticated' };
        if (res.status === 400) return { ok: false, error: 'bad_request' };
        if (res.status === 409 || serverError === 'already_answered') {
          return { ok: false, error: 'already_answered' };
        }
        if (res.status === 422 && serverError === 'too_fast') {
          return { ok: false, error: 'too_fast' };
        }
        // 422 not_evidential, or 404 (served_item_not_found / not_found /
        // no_student_profile) → the item cannot move mastery this turn.
        if (
          serverError === 'not_evidential' ||
          serverError === 'served_item_not_found' ||
          serverError === 'not_found' ||
          serverError === 'no_student_profile'
        ) {
          return { ok: false, error: 'not_evidential' };
        }
        // 500 / unknown → non-blocking retry path.
        return { ok: false, error: 'network' };
      } catch {
        return { ok: false, error: 'network' };
      }
    },
    [],
  );

  const sendMessage = useCallback(async (
    payload: FoxySendPayload,
    hooks?: SendMessageHooks,
  ): Promise<void> => {
    const { language } = payload;
    const text = payload.message;
    const image = payload.imageFile ?? null;

    if (!text.trim() && !image) return;

    // Client-side length limit matching server-side MAX_MESSAGE_LENGTH
    if (text.length > 1000) {
      setMessages((p) => [...p, {
        id: nextMessageId(),
        role: 'tutor',
        content: language === 'hi'
          ? 'संदेश बहुत लंबा है! कृपया 1000 अक्षरों से कम रखें।'
          : 'Message too long! Please keep it under 1,000 characters.',
        timestamp: new Date().toISOString(),
      }]);
      return;
    }

    hooks?.onStart?.();

    let imagePreviewUrl: string | undefined;
    if (image) {
      imagePreviewUrl = URL.createObjectURL(image);
      setMessages((p) => [...p, {
        id: nextMessageId(),
        role: 'student',
        content: text || (language === 'hi' ? 'फ़ोटो अपलोड की' : 'Uploaded photo'),
        timestamp: new Date().toISOString(),
        imageUrl: imagePreviewUrl,
      }]);
      setLoading(true);
    } else {
      setMessages((p) => [...p, {
        id: nextMessageId(),
        role: 'student',
        content: text,
        timestamp: new Date().toISOString(),
      }]);
      setLoading(true);
    }

    try {
      const foxyParams: Record<string, any> = {
        message: payload.augmentedMessage ?? text,
        student_id: payload.studentId || '',
        student_name: payload.studentName || 'Student',
        grade: payload.grade,
        subject: payload.subject,
        language: payload.language,
        mode: payload.mode,
        topic_id: payload.topicId || null,
        topic_title: payload.topicTitle || null,
        chapter: payload.chapter || null,
        session_id: chatSessionId,
        selected_chapters: payload.selectedChapters || null,
      };
      if (payload.intent) foxyParams.intent = payload.intent;
      if (payload.coachDirective) foxyParams.coachDirective = payload.coachDirective;
      if (payload.imageBase64) {
        foxyParams.image_base64 = payload.imageBase64;
        foxyParams.image_media_type = payload.imageMediaType || 'image/jpeg';
      }

      // "Quiz me" forces the non-streaming JSON branch: the server returns a
      // BLOCKING JSON response (single oracle-gated MCQ) for coachDirective
      // 'quiz_me', so SSE would never carry the structured payload.
      const forceBlocking = payload.coachDirective === 'quiz_me';

      // ── Streaming branch ─────────────────────────────────────────────
      if (shouldUseStreaming() && !payload.imageBase64 && !forceBlocking) {
        let streamGroundedFromChunks = false;
        let streamCitationsCount = 0;
        const tutorBubbleId = nextMessageId();
        setMessages((p) => [...p, {
          id: tutorBubbleId,
          role: 'tutor',
          content: '',
          timestamp: new Date().toISOString(),
        }]);

        let pendingDelta = '';
        let flushScheduled = false;
        const flushDelta = () => {
          if (!pendingDelta) { flushScheduled = false; return; }
          const toAppend = pendingDelta;
          pendingDelta = '';
          flushScheduled = false;
          setMessages((p) => p.map((m) =>
            m.id === tutorBubbleId ? { ...m, content: m.content + toAppend } : m,
          ));
        };
        const scheduleFlush = () => {
          if (flushScheduled) return;
          flushScheduled = true;
          setTimeout(flushDelta, 50);
        };

        try {
          await callFoxyTutorStream(foxyParams, {
            onSession: (sid) => {
              if (sid) {
                setChatSessionId(sid);
                hooks?.onSessionId?.(sid);
              }
            },
            onMetadata: (meta) => {
              setMessages((p) => p.map((m) =>
                m.id === tutorBubbleId
                  ? { ...m, groundingStatus: meta.groundingStatus, traceId: meta.traceId }
                  : m,
              ));
            },
            onText: (delta) => {
              pendingDelta += delta;
              scheduleFlush();
            },
            onPersisted: (info) => {
              setMessages((p) => p.map((m) =>
                m.id === tutorBubbleId
                  ? { ...m, persistedMessageId: info.messageId }
                  : m,
              ));
            },
            onDone: (info) => {
              streamGroundedFromChunks = info.groundedFromChunks === true;
              streamCitationsCount = info.citationsCount;
              flushDelta();
              setMessages((p) => p.map((m) => {
                if (m.id !== tutorBubbleId) return m;
                let next: ChatMessage = m;
                if (info.structured) {
                  next = { ...next, structured: info.structured };
                }
                // Display-only SymPy badge state (server-computed). Stamp only
                // when present; absent leaves the bubble byte-identical to today.
                if (info.badgeState) {
                  next = { ...next, badgeState: info.badgeState };
                }
                if (next.content && next.content.length > 0) return next;
                if (next.groundingStatus === 'hard-abstain') return next;
                if (info.groundedFromChunks === true) return next;
                return {
                  ...next,
                  content: language === 'hi'
                    ? 'मैं अभी जवाब नहीं दे सका। फिर से कोशिश करें या दूसरा chapter चुनें।'
                    : "I couldn't generate a response right now. Try rephrasing or pick a different chapter.",
                };
              }));
            },
            onAbstain: (info) => {
              flushDelta();
              setMessages((p) => p.map((m) =>
                m.id === tutorBubbleId
                  ? {
                      ...m,
                      content: '',
                      groundingStatus: 'hard-abstain' as GroundingStatus,
                      abstainReason: info.abstainReason,
                      suggestedAlternatives: info.suggestedAlternatives,
                      traceId: info.traceId,
                    }
                  : m,
              ));
            },
            onError: (info) => {
              void info;
              flushDelta();
              setMessages((p) => p.map((m) =>
                m.id === tutorBubbleId
                  ? {
                      ...m,
                      content: m.content || (language === 'hi'
                        ? 'ओह! कृपया फिर कोशिश करें।'
                        : 'Oops! Please try again.'),
                    }
                  : m,
              ));
            },
          });
        } catch (streamErr) {
          flushDelta();
          console.warn('[foxy] stream error:', streamErr);
          setMessages((p) => p.map((m) =>
            m.id === tutorBubbleId && !m.content
              ? {
                  ...m,
                  content: language === 'hi'
                    ? 'ओह! कृपया फिर कोशिश करें।'
                    : 'Oops! Please try again.',
                }
              : m,
          ));
        }

        setLoading(false);
        hooks?.onComplete?.({
          usedStreaming: true,
          groundedFromChunks: streamGroundedFromChunks,
          citationsCount: streamCitationsCount,
        });
        return;
      }
      // ── End streaming branch ────────────────────────────────────────

      const resp = await callFoxyTutor(foxyParams);
      if (resp.limitReached) {
        setMessages((p) => [...p, {
          id: nextMessageId(),
          role: 'tutor',
          content: resp.reply,
          timestamp: new Date().toISOString(),
        }]);
        setLoading(false);
        hooks?.onLimitReached?.(resp.reply);
        hooks?.onComplete?.({ reply: resp.reply, usedStreaming: false });
        return;
      }
      setMessages((p) => [...p, {
        id: nextMessageId(),
        role: 'tutor',
        content: resp.reply,
        timestamp: new Date().toISOString(),
        xp: resp.xp_earned,
        groundingStatus: resp.groundingStatus,
        traceId: resp.traceId,
        abstainReason: resp.abstainReason,
        suggestedAlternatives: resp.suggestedAlternatives,
        structured: resp.structured,
        badgeState: resp.badgeState,
        persistedMessageId: resp.messageId ?? undefined,
        // Part B1: stamp the evidential contract so the MCQ renderer knows
        // whether answering moves mastery (evidential) or is practice-only.
        quizMe: resp.quizMe,
      }]);
      if (resp.upgradePrompt) {
        const up = resp.upgradePrompt;
        const promptMsg = language === 'hi' ? up.messageHi : up.message;
        setMessages((p) => [...p, {
          id: nextMessageId(),
          role: 'tutor',
          content: `💡 ${promptMsg}`,
          timestamp: new Date().toISOString(),
        }]);
        hooks?.onUpgradePromptText?.(promptMsg);
      }
      if (resp.xp_earned > 0) setXpGained((p: number) => p + resp.xp_earned);
      if (resp.session_id) {
        setChatSessionId(resp.session_id);
        hooks?.onSessionId?.(resp.session_id);
      }
      hooks?.onTutorReplyAdded?.({
        reply: resp.reply,
        xpEarned: resp.xp_earned,
        usedStreaming: false,
      });
      hooks?.onComplete?.({
        reply: resp.reply,
        usedStreaming: false,
        groundedFromChunks: resp.groundedFromChunks === true,
        citationsCount: typeof resp.citationsCount === 'number' ? resp.citationsCount : 0,
      });
    } catch {
      setMessages((p) => [...p, {
        id: nextMessageId(),
        role: 'tutor',
        content: language === 'hi' ? 'ओह! कृपया फिर कोशिश करें।' : 'Oops! Please try again.',
        timestamp: new Date().toISOString(),
      }]);
      hooks?.onComplete?.({ usedStreaming: false });
    }
    setLoading(false);
  }, [chatSessionId, nextMessageId]);

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    chatSessionId,
    setChatSessionId,
    xpGained,
    setXpGained,
    nextMessageId,
    clearMessages,
    sendMessage,
    recordLearningAction,
    submitQuizAnswer,
  };
}
