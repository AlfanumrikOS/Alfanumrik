'use client';

/**
 * PrincipalAiChat — the Principal AI Assistant chat workspace (Track 2 v1).
 *
 * Consumes /api/school-admin/ai-assistant:
 *   GET  → { success, sessions[], sessionId, messages[], degraded? }
 *   POST { message, session_id?, lang } → 200 { success, sessionId, response,
 *          model, abstainReason, quotaRemaining } | 429 { daily_limit_reached } |
 *          404 (flag off) | 403 (not principal) | 400 (bad body)
 *
 * Boundary discipline (frontend):
 *   - 100% presentation. Scoring / analytics / scope decisions live server-side;
 *     this component renders the route's text verbatim.
 *   - The assistant's polite abstain copy ALWAYS arrives in `response` — we render
 *     it plainly; `abstainReason` only drives styling + the degraded banner.
 *   - schoolId is NEVER sent (the route derives it from the session). We send only
 *     `message`, `session_id?`, and `lang` ('hi' when isHi else 'en').
 *   - Optimistic user bubble; on failure we keep the bubble and append the
 *     graceful assistant reply (the route always returns 200 with a polite reply).
 *   - P13: message content is never logged.
 *
 * States: loading · error · EMPTY (suggested starters) · streaming(sending) ·
 *   quota(429) · abstain · degraded. All distinct.
 *
 * A11y: the message list is an aria-live="polite" region so new assistant turns
 * are announced; 48px send target; focus-visible; prefers-reduced-motion respected
 * (CSS-only motion, the spinner degrades via the global reduced-motion rules).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import PrincipalAiMessage, { type PrincipalAiMessageModel } from './PrincipalAiMessage';
import PrincipalAiInput from './PrincipalAiInput';
import PrincipalAiStarters from './PrincipalAiStarters';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const API = '/api/school-admin/ai-assistant';

/** Reasons the route surfaces when the assistant declines / the feature is mid-setup. */
type AbstainReason = 'unavailable' | 'no_data' | string | null;

interface GetResponse {
  success?: boolean;
  sessions?: Array<{
    id: string;
    lang: string;
    message_count: number;
    last_message_at: string | null;
    created_at: string;
  }>;
  sessionId?: string | null;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model: string | null;
    abstain_reason: string | null;
    created_at: string;
  }>;
  degraded?: boolean;
}

interface PostResponse {
  success?: boolean;
  sessionId?: string | null;
  response?: string;
  model?: string | null;
  abstainReason?: AbstainReason;
  quotaRemaining?: number | null;
  error?: string;
}

let idSeq = 0;
function localId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now()}-${idSeq}`;
}

export default function PrincipalAiChat() {
  const { isHi } = useAuth();
  const lang = isHi ? 'hi' : 'en';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const [messages, setMessages] = useState<PrincipalAiMessageModel[]>([]);
  const [sessions, setSessions] = useState<NonNullable<GetResponse['sessions']>>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  const listEndRef = useRef<HTMLDivElement | null>(null);

  // ── Load history (latest session's messages) ──────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await authedFetch(API);
      if (!res.ok) {
        // 404 (flag off) / 403 (not principal) — the page gate normally prevents
        // mounting this, but treat any non-OK as an error surface here.
        setLoadError(true);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as GetResponse;
      const mapped: PrincipalAiMessageModel[] = (body.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        abstainReason: m.abstain_reason,
      }));
      setMessages(mapped);
      setSessions(body.sessions ?? []);
      setSessionId(body.sessionId ?? null);
      setDegraded(Boolean(body.degraded));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Auto-scroll to the newest message (CSS-only smooth; honoured by the browser's
  // reduced-motion setting at the platform level).
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending]);

  // ── Resume a prior session from the history dropdown ──────────────────────
  const resumeSession = useCallback(async (id: string) => {
    setSending(false);
    setLoading(true);
    setLoadError(false);
    try {
      // The GET endpoint returns the LATEST session's messages; to resume an older
      // one we simply set it as the active session id and clear the transcript —
      // the next turn POSTs with this session_id and the route threads it. (v1
      // keeps history light; a per-session fetch is a follow-up.)
      setSessionId(id);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Send a turn ───────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      if (sending || quotaExhausted) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      // Optimistic user bubble.
      const userMsg: PrincipalAiMessageModel = {
        id: localId('u'),
        role: 'user',
        content: trimmed,
        model: null,
        abstainReason: null,
      };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);

      try {
        const res = await authedFetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ message: trimmed, session_id: sessionId, lang }),
        });

        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as PostResponse;
          setQuotaExhausted(true);
          setQuotaRemaining(typeof body.quotaRemaining === 'number' ? body.quotaRemaining : 0);
          return;
        }

        if (!res.ok) {
          // 404/403/400 — surface a plain assistant-style notice (no PII, no log).
          setMessages((prev) => [
            ...prev,
            {
              id: localId('a'),
              role: 'assistant',
              content: tt(
                isHi,
                'Something went wrong. Please try again.',
                'कुछ गड़बड़ हुई। कृपया पुनः प्रयास करें।',
              ),
              model: null,
              abstainReason: 'unavailable',
            },
          ]);
          return;
        }

        const body = (await res.json()) as PostResponse;
        if (body.sessionId) setSessionId(body.sessionId);
        if (typeof body.quotaRemaining === 'number') {
          setQuotaRemaining(body.quotaRemaining);
          if (body.quotaRemaining <= 0) setQuotaExhausted(true);
        }
        // The route always returns a polite `response` (real answer OR abstain copy).
        setMessages((prev) => [
          ...prev,
          {
            id: localId('a'),
            role: 'assistant',
            content: body.response ?? '',
            model: body.model ?? null,
            abstainReason: body.abstainReason ?? null,
          },
        ]);
        // A POST abstain of 'unavailable' means the feature is mid-setup → degraded.
        if (body.abstainReason === 'unavailable') setDegraded(true);
      } catch {
        // Network failure — append a graceful assistant notice; keep the user bubble.
        setMessages((prev) => [
          ...prev,
          {
            id: localId('a'),
            role: 'assistant',
            content: tt(
              isHi,
              'The assistant is temporarily unreachable. Please try again in a moment.',
              'सहायक अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
            ),
            model: null,
            abstainReason: 'unavailable',
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [sending, quotaExhausted, sessionId, lang, isHi],
  );

  const isEmpty = !loading && !loadError && messages.length === 0;

  return (
    <div className="mx-auto flex h-[calc(100dvh-3rem)] max-w-3xl flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
        <div className="min-w-0">
          <h1
            className="text-lg font-bold text-[var(--text-1)]"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {tt(isHi, 'Principal Assistant', 'Principal सहायक')}
          </h1>
          <p className="text-xs text-[var(--text-3)]">
            {tt(
              isHi,
              'Plain-language analytics for your school',
              'आपके स्कूल के लिए सरल-भाषा एनालिटिक्स',
            )}
          </p>
        </div>

        {/* Session history — resume a prior conversation (optional, v1 light). */}
        {sessions.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="principal-ai-session" className="sr-only">
              {tt(isHi, 'Resume a session', 'पिछला सत्र फिर से खोलें')}
            </label>
            <select
              id="principal-ai-session"
              value={sessionId ?? ''}
              onChange={(e) => void resumeSession(e.target.value)}
              className="max-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)]"
            >
              {sessions.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {tt(isHi, 'Session', 'सत्र')} {sessions.length - i} · {s.message_count}{' '}
                  {tt(isHi, 'msgs', 'संदेश')}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* Degraded banner — GET degraded OR a POST 'unavailable' abstain. */}
      {degraded && (
        <div
          role="status"
          className="mx-4 mb-2 rounded-xl border px-3 py-2 text-xs text-[var(--text-1)]"
          style={{
            background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
            borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
          }}
        >
          {tt(
            isHi,
            'Assistant is being set up — your school’s data is not available yet.',
            'सहायक तैयार किया जा रहा है — आपके स्कूल का डेटा अभी उपलब्ध नहीं है।',
          )}
        </div>
      )}

      {/* Message list — aria-live so new assistant turns are announced. */}
      <div
        className="flex-1 overflow-y-auto px-4"
        aria-live="polite"
        aria-busy={sending}
        aria-label={tt(isHi, 'Conversation', 'बातचीत')}
      >
        {loading ? (
          <div className="space-y-3 py-4" aria-hidden="true">
            <div className="ml-auto h-10 w-2/3 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
            <div className="h-16 w-3/4 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
            <div className="ml-auto h-10 w-1/2 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
          </div>
        ) : loadError ? (
          <div className="py-12 text-center">
            <p className="mb-3 text-sm text-[var(--text-2)]">
              {tt(isHi, 'Couldn’t load the assistant.', 'सहायक लोड नहीं हो सका।')}
            </p>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="min-h-[44px] rounded-xl bg-[var(--purple)] px-4 py-2 text-sm font-semibold text-on-accent transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--purple)]"
            >
              {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </button>
          </div>
        ) : isEmpty ? (
          <PrincipalAiStarters isHi={isHi} disabled={sending || quotaExhausted} onPick={send} />
        ) : (
          <div className="space-y-3 py-4">
            {messages.map((m) => (
              <PrincipalAiMessage key={m.id} message={m} isHi={isHi} />
            ))}
            {sending && (
              <div className="flex justify-start" aria-hidden="true">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-3)]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-3)] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-3)] [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      {/* Quota notice (429) — shown above the input when the daily limit is hit. */}
      {quotaExhausted && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-2)]"
        >
          {tt(
            isHi,
            'You’ve reached today’s Principal Assistant limit. Please try again tomorrow.',
            'आपने आज की Principal Assistant सीमा पूरी कर ली है। कृपया कल पुनः प्रयास करें।',
          )}
          {typeof quotaRemaining === 'number' && (
            <span className="ml-1 font-semibold">
              ({tt(isHi, 'remaining', 'शेष')}: {Math.max(0, quotaRemaining)})
            </span>
          )}
        </div>
      )}

      {/* Composer */}
      {!loading && !loadError && (
        <PrincipalAiInput
          isHi={isHi}
          sending={sending}
          quotaExhausted={quotaExhausted}
          onSend={send}
        />
      )}
    </div>
  );
}
