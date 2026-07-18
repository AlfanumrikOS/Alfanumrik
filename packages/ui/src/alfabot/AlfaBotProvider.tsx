'use client';

/**
 * AlfaBotProvider — React Context for the landing-page chat widget.
 *
 * State model (PR 3 of the AlfaBot feature):
 *   - isOpen / messages / isStreaming / error           ── chat lifecycle
 *   - audience / lang                                   ── reflects landing-v2 role/lang
 *   - rateLimitedUntil                                  ── set when the route 429s
 *   - sessionId                                         ── minted by the route on first turn
 *   - langNudgeDismissed                                ── sessionStorage-persisted
 *
 * Persistence:
 *   We persist the conversation array to sessionStorage (P13 — no
 *   localStorage). Max 20 messages. Cleared on `clearConversation()` and
 *   automatically dropped when the tab closes (sessionStorage scope).
 *
 * Audience / lang mirroring:
 *   The WelcomeV2 context owns the canonical role + lang for the landing
 *   page. AlfaBot reads them on mount, and `setAudience()` calls back into
 *   WelcomeV2's `setRole()` so the surrounding strip + hero stay in sync.
 *
 * Open events:
 *   When `open(source)` fires we capture `seconds_since_pageload` from a
 *   ref minted on mount and ship the bucketed counter to PostHog.
 *
 * Bundle posture (P10):
 *   This file ships in the LAUNCHER chunk (small). The heavyweight
 *   AlfaBotPanel is lazy-loaded by the launcher only on first open. The
 *   client helper (`askAlfabot`) is also in the panel chunk — never in the
 *   launcher chunk — to keep the unopened-page weight near zero.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AlfabotAudience,
  AlfabotLang,
  AlfabotResponse,
  AlfabotErrorResponse,
} from '@alfanumrik/lib/alfabot/types';
import { askAlfabot } from '@alfanumrik/lib/alfabot/client';
import { track } from '@alfanumrik/lib/posthog/client';
import { useWelcomeV2, type Role } from '@alfanumrik/ui/landing/WelcomeV2Context';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlfabotRole = 'user' | 'assistant' | 'system';

/**
 * Which subview the panel is rendering. Default 'chat'. 'inquiry' swaps the
 * chat body for the Submit-your-query form; the launcher / header stay put.
 */
export type AlfabotView = 'chat' | 'inquiry';

export interface AlfabotChatMessage {
  id: string;
  role: AlfabotRole;
  /** Plain-text content. Markdown / HTML is stripped defensively before render. */
  content: string;
  /** KB sources count (assistant only — set on final meta). */
  sourcesUsed?: number;
  /** True while the bot is still streaming this assistant message. */
  isStreaming?: boolean;
  /** Closed-set abstain reason if the bot politely refused. */
  abstainReason?: AlfabotResponse['abstainReason'];
}

interface AlfabotContextValue {
  // Reactive state
  isOpen: boolean;
  messages: AlfabotChatMessage[];
  isStreaming: boolean;
  error: string | null;
  audience: AlfabotAudience;
  lang: AlfabotLang;
  rateLimitedUntil: Date | null;
  sessionId: string | null;
  langNudgeDismissed: boolean;
  langNudgeVisible: boolean;
  /** Char-count seed for the input — set by `prefillInput()` and cleared on send. */
  prefilled: string | null;
  /** Which subview the panel is rendering. */
  view: AlfabotView;

  // Actions
  open: (source: 'bubble' | 'speech_tail' | 'faq_link' | 'prefill') => void;
  close: (via: 'close_button' | 'escape_key' | 'outside_click' | 'mobile_menu') => void;
  sendMessage: (text: string, via?: 'typed' | 'starter_chip' | 'prefill' | 'faq_link') => Promise<void>;
  setAudience: (a: AlfabotAudience, source?: 'header' | 'starter') => void;
  dismissLangNudge: () => void;
  acceptLangNudge: () => void;
  clearConversation: () => void;
  prefillInput: (text: string) => void;
  clearPrefilled: () => void;
  /** Switch the panel body to the Submit-your-query form. */
  openInquiry: (source?: 'escape_hatch' | 'starter_chip' | 'rate_limit_banner') => void;
  /** Switch the panel body back to the chat view. */
  closeInquiry: () => void;
}

const Ctx = createContext<AlfabotContextValue | null>(null);

export function useAlfaBot(): AlfabotContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useAlfaBot must be called inside <AlfaBotProvider>');
  }
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SESSION_KEY = 'alfabot-conversation';
const LANG_NUDGE_KEY = 'alfabot-lang-nudge-dismissed';
const MAX_PERSISTED_MESSAGES = 20;

function welcomeRoleToAudience(role: Role): AlfabotAudience {
  return role; // role and AlfabotAudience share the same enum strings.
}

function genId(): string {
  // crypto.randomUUID is available in modern browsers; fall back to a tiny
  // hex string when unavailable (very old Safari). We never persist this
  // beyond the session so collisions are inconsequential.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `m_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Defensive markdown / HTML stripping (P12 — plain text only). */
function stripFormatting(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')      // HTML tags
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')  // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/__([^_]+)__/g, '$1')     // bold
    .replace(/\*([^*]+)\*/g, '$1')     // italic
    .replace(/_([^_]+)_/g, '$1');      // italic
}

function lengthBucket(s: string): 'short' | 'medium' | 'long' {
  const len = s.length;
  if (len < 80) return 'short';
  if (len < 240) return 'medium';
  return 'long';
}

function devanagariRatio(s: string): number {
  if (!s) return 0;
  const total = s.length;
  let hits = 0;
  for (let i = 0; i < total; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0x0900 && code <= 0x097f) hits += 1;
  }
  return total === 0 ? 0 : hits / total;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AlfaBotProvider({ children }: { children: ReactNode }) {
  const welcome = useWelcomeV2();

  // The audience/lang mirrored from landing-v2; users can change audience via
  // the header link, in which case we propagate the change BACK to landing-v2.
  const [audience, setAudienceState] = useState<AlfabotAudience>(welcomeRoleToAudience(welcome.role));
  const lang: AlfabotLang = welcome.lang;

  // Keep mirrored audience in sync if landing-v2's role changes externally.
  useEffect(() => {
    setAudienceState(welcomeRoleToAudience(welcome.role));
  }, [welcome.role]);

  // Chat state
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AlfabotChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<Date | null>(null);
  const [langNudgeDismissed, setLangNudgeDismissed] = useState(false);
  const [langNudgeVisible, setLangNudgeVisible] = useState(false);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const [view, setView] = useState<AlfabotView>('chat');

  // For PostHog "seconds_since_pageload" + per-open message_count.
  const pageMountedAt = useRef<number>(Date.now());
  const openedAt = useRef<number | null>(null);

  // Track the last user message text for lang-nudge detection. We deliberately
  // never include this in any analytics payload.
  const lastUserMessage = useRef<string>('');

  // ─── Hydration: session storage ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { messages?: AlfabotChatMessage[]; sessionId?: string | null };
        if (Array.isArray(parsed.messages)) {
          setMessages(parsed.messages.slice(-MAX_PERSISTED_MESSAGES));
        }
        if (typeof parsed.sessionId === 'string') {
          setSessionId(parsed.sessionId);
        }
      }
      const dismissed = sessionStorage.getItem(LANG_NUDGE_KEY);
      if (dismissed === '1') setLangNudgeDismissed(true);
    } catch {
      /* sessionStorage unavailable / parse error — start fresh */
    }
  }, []);

  // ─── Persist conversation on every change ────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ messages: trimmed, sessionId }));
    } catch {
      /* quota / private mode — silently drop */
    }
  }, [messages, sessionId]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const open = useCallback(
    (source: 'bubble' | 'speech_tail' | 'faq_link' | 'prefill') => {
      if (isOpen) return;
      setIsOpen(true);
      openedAt.current = Date.now();
      const seconds = Math.round((Date.now() - pageMountedAt.current) / 1000);
      track('alfabot_opened', {
        source,
        audience,
        language: lang,
        seconds_since_pageload: seconds,
      });
    },
    [isOpen, audience, lang],
  );

  const close = useCallback(
    (via: 'close_button' | 'escape_key' | 'outside_click' | 'mobile_menu') => {
      if (!isOpen) return;
      setIsOpen(false);
      track('alfabot_closed', {
        via,
        audience,
        language: lang,
        message_count: messages.length,
      });
      openedAt.current = null;
    },
    [isOpen, audience, lang, messages.length],
  );

  const setAudience = useCallback(
    (a: AlfabotAudience, source: 'header' | 'starter' = 'header') => {
      if (a === audience) return;
      const prev = audience;
      setAudienceState(a);
      // Mirror into landing-v2 so the rest of the page stays consistent.
      welcome.setRole(a);
      track('alfabot_audience_switched', { from_audience: prev, to_audience: a, source });
    },
    [audience, welcome],
  );

  const dismissLangNudge = useCallback(() => {
    setLangNudgeDismissed(true);
    setLangNudgeVisible(false);
    try {
      sessionStorage.setItem(LANG_NUDGE_KEY, '1');
    } catch {
      /* noop */
    }
    track('alfabot_lang_nudge_accepted', { audience, language: lang, action: 'dismissed' });
  }, [audience, lang]);

  const acceptLangNudge = useCallback(() => {
    if (lang !== 'hi') welcome.toggleLang();
    setLangNudgeVisible(false);
    setLangNudgeDismissed(true);
    try {
      sessionStorage.setItem(LANG_NUDGE_KEY, '1');
    } catch {
      /* noop */
    }
    track('alfabot_lang_nudge_accepted', { audience, language: lang, action: 'accepted' });
  }, [audience, lang, welcome]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    setRateLimitedUntil(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* noop */
    }
  }, []);

  const prefillInput = useCallback((text: string) => {
    setPrefilled(text);
  }, []);

  const clearPrefilled = useCallback(() => {
    setPrefilled(null);
  }, []);

  const openInquiry = useCallback(
    (source: 'escape_hatch' | 'starter_chip' | 'rate_limit_banner' = 'escape_hatch') => {
      setView('inquiry');
      track('alfabot_inquiry_opened', {
        audience,
        language: lang,
        source,
      });
    },
    [audience, lang],
  );

  const closeInquiry = useCallback(() => {
    setView('chat');
  }, []);

  // ─── sendMessage — core chat call ─────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string, via: 'typed' | 'starter_chip' | 'prefill' | 'faq_link' = 'typed') => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isStreaming) return;
      if (rateLimitedUntil && rateLimitedUntil.getTime() > Date.now()) return;

      // Optimistically append the user message and a placeholder assistant
      // message that will be filled by streaming tokens.
      const userMsgId = genId();
      const assistantMsgId = genId();
      lastUserMessage.current = trimmed;
      const userMsgIndex = messages.length;

      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: 'user', content: trimmed },
        { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true },
      ]);
      setIsStreaming(true);
      setError(null);

      track('alfabot_message_sent', {
        audience,
        language: lang,
        via,
        length_bucket: lengthBucket(trimmed),
        message_index: userMsgIndex,
      });

      const startedAt = Date.now();
      await askAlfabot(
        {
          message: trimmed,
          audience,
          lang,
          ...(sessionId ? { sessionId } : {}),
        },
        {
          onToken: (delta) => {
            const sanitized = stripFormatting(delta);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.id === assistantMsgId) {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + sanitized,
                };
              }
              return next;
            });
          },
          onDone: (final) => {
            setIsStreaming(false);
            setSessionId(final.sessionId);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.id === assistantMsgId) {
                next[next.length - 1] = {
                  ...last,
                  content: stripFormatting(final.response || last.content),
                  isStreaming: false,
                  sourcesUsed: final.sourcesUsed,
                  abstainReason: final.abstainReason,
                };
              }
              return next;
            });

            // Lang nudge: if the user typed in Devanagari but UI is EN, prompt.
            const ratio = devanagariRatio(lastUserMessage.current);
            if (
              lang === 'en' &&
              !langNudgeDismissed &&
              ratio >= 0.3
            ) {
              setLangNudgeVisible(true);
              track('alfabot_lang_nudge_shown', {
                audience,
                language: lang,
                devanagari_ratio: Math.round(ratio * 100) / 100,
              });
            }

            track('alfabot_message_received', {
              audience,
              language: lang,
              abstain_reason: final.abstainReason,
              sources_used: final.sourcesUsed ?? 0,
              degraded_mode: final.degradedMode,
              latency_ms: Date.now() - startedAt,
            });
          },
          onError: (err: AlfabotErrorResponse | { error: 'network_error'; detail?: string }) => {
            setIsStreaming(false);
            const errKey = err.error;
            // Replace the empty streaming assistant bubble with a friendly
            // error message so the user never sees a blank bubble. Previously
            // we just popped it, leaving the user confused about what happened.
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.id === assistantMsgId && last.isStreaming) {
                const fallbackContent = last.content.trim().length > 0
                  ? last.content // Keep partial text if any tokens arrived
                  : lang === 'hi'
                    ? 'मुझे अभी जवाब देने में दिक्कत हो रही है। कृपया फिर से कोशिश करें, या hello@alfanumrik.com पर हमसे संपर्क करें।'
                    : 'I had trouble responding just now. Please try again, or reach us at hello@alfanumrik.com.';
                next[next.length - 1] = {
                  ...last,
                  content: fallbackContent,
                  isStreaming: false,
                  abstainReason: 'upstream_failed' as AlfabotResponse['abstainReason'],
                };
              }
              return next;
            });

            if (errKey === 'rate_limited' || errKey === 'session_max') {
              const resetAt =
                'resetAt' in err && typeof err.resetAt === 'string' ? new Date(err.resetAt) : null;
              if (resetAt && !Number.isNaN(resetAt.getTime())) {
                setRateLimitedUntil(resetAt);
              } else {
                // Fallback: assume 60s if the server didn't tell us.
                setRateLimitedUntil(new Date(Date.now() + 60_000));
              }
              const scope = 'scope' in err && err.scope ? err.scope : 'burst';
              const resetIn = resetAt ? Math.max(0, Math.round((resetAt.getTime() - Date.now()) / 1000)) : null;
              track('alfabot_rate_limited', {
                audience,
                language: lang,
                scope: scope as 'burst' | 'day' | 'ip' | 'session_max' | 'lead',
                reset_in_seconds: resetIn,
              });
              setError(null); // Use the rate-limit banner instead of a generic error.
              return;
            }

            // Other errors — set a friendly fallback message.
            setError(errKey);
            track('alfabot_error_shown', {
              audience,
              language: lang,
              error: errKey as
                | 'network_error'
                | 'upstream_failed'
                | 'invalid_input'
                | 'denied'
                | 'not_found',
            });
          },
        },
      );
    },
    [audience, lang, isStreaming, rateLimitedUntil, sessionId, messages.length, langNudgeDismissed],
  );

  // ─── Listen for FAQ prefill events ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text?: string }>;
      const text = ce.detail?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      prefillInput(text);
      open('faq_link');
    };
    window.addEventListener('alfabot:prefill', handler as EventListener);
    return () => window.removeEventListener('alfabot:prefill', handler as EventListener);
  }, [open, prefillInput]);

  // ─── Listen for landing mobile-menu open events (close-on-overlay) ───────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      if (isOpen) close('mobile_menu');
    };
    window.addEventListener('welcome-v2:mobile-menu-open', handler);
    return () => window.removeEventListener('welcome-v2:mobile-menu-open', handler);
  }, [isOpen, close]);

  // ─── Esc key closes ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close('escape_key');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const value = useMemo<AlfabotContextValue>(
    () => ({
      isOpen,
      messages,
      isStreaming,
      error,
      audience,
      lang,
      rateLimitedUntil,
      sessionId,
      langNudgeDismissed,
      langNudgeVisible,
      prefilled,
      view,
      open,
      close,
      sendMessage,
      setAudience,
      dismissLangNudge,
      acceptLangNudge,
      clearConversation,
      prefillInput,
      clearPrefilled,
      openInquiry,
      closeInquiry,
    }),
    [
      isOpen,
      messages,
      isStreaming,
      error,
      audience,
      lang,
      rateLimitedUntil,
      sessionId,
      langNudgeDismissed,
      langNudgeVisible,
      prefilled,
      view,
      open,
      close,
      sendMessage,
      setAudience,
      dismissLangNudge,
      acceptLangNudge,
      clearConversation,
      prefillInput,
      clearPrefilled,
      openInquiry,
      closeInquiry,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
