'use client';

/**
 * ParentChildChat — read-only parent view of a child's Foxy AI conversation.
 *
 * Phase 2B portal remediation (CEO-approved P13 exposure). Renders inside the
 * expanded child card on /parent/children. Consumes:
 *   GET /api/parent/children/[student_id]/chat?limit=&before=
 *     → { success, data: { student_id, messages:[{id,role,text,created_at,session_id}]
 *         (newest-first), page:{limit, has_more, next_before} } }
 *
 * Pagination is keyset: the API returns messages newest-first; "Load older"
 * passes the returned `next_before` as `before` and APPENDS the older page.
 *
 * P13 — sensitive child data:
 *   - READ-ONLY. There is no compose box; a parent cannot send on the child's
 *     behalf.
 *   - No message text is logged, tracked, or sent to analytics from this
 *     component. Nothing is persisted client-side beyond React state.
 *   - The fetch only fires while the host card is expanded (`enabled`), and the
 *     server enforces the parent↔child ownership boundary (canAccessStudent)
 *     plus an RLS-scoped read. A 403 shows a neutral "not linked" notice with
 *     no payload.
 *
 * Presentation rebuilt on canonical primitives (Phase 10) — token-only. All
 * fetch/pagination/boundary logic is byte-intact.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';
import { Button, Alert, EmptyState } from '@alfanumrik/ui/ui/primitives';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const PAGE_LIMIT = 30;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
  session_id: string;
}

interface ChatResponse {
  success: boolean;
  data?: {
    student_id: string;
    messages: ChatMessage[];
    page: { limit: number; has_more: boolean; next_before: string | null };
  };
  error?: string;
}

async function authedFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* anonymous — server returns 401/403 */
  }
  return fetch(url, { headers });
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ParentChildChat({
  childId,
  childName,
  enabled,
  isHi,
}: {
  childId: string;
  childName: string;
  enabled: boolean;
  isHi: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notLinked, setNotLinked] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  // Guard so we only auto-load the first page once per expansion.
  const loadedOnceRef = useRef(false);

  const buildUrl = useCallback(
    (before: string | null) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (before) params.set('before', before);
      return `/api/parent/children/${encodeURIComponent(childId)}/chat?${params.toString()}`;
    },
    [childId],
  );

  // Initial (newest) page.
  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotLinked(false);
    try {
      const res = await authedFetch(buildUrl(null));
      if (res.status === 403) {
        setNotLinked(true);
        setMessages([]);
        setHasMore(false);
        setNextBefore(null);
        return;
      }
      if (res.status === 401) {
        setError(t(isHi, 'Please sign in again.', 'कृपया दोबारा साइन इन करें।'));
        return;
      }
      const json = (await res.json().catch(() => ({}))) as ChatResponse;
      if (!res.ok || !json.success || !json.data) {
        setError(t(isHi, 'Could not load the conversation.', 'बातचीत लोड नहीं हो सकी।'));
        return;
      }
      setMessages(json.data.messages);
      setHasMore(json.data.page.has_more);
      setNextBefore(json.data.page.next_before);
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया दोबारा कोशिश करें।'));
    } finally {
      setLoading(false);
    }
  }, [buildUrl, isHi]);

  // Older pages (keyset) — APPEND to the existing list.
  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await authedFetch(buildUrl(nextBefore));
      const json = (await res.json().catch(() => ({}))) as ChatResponse;
      if (!res.ok || !json.success || !json.data) {
        setError(t(isHi, 'Could not load older messages.', 'पुराने संदेश लोड नहीं हो सके।'));
        return;
      }
      setMessages((prev) => [...prev, ...json.data!.messages]);
      setHasMore(json.data.page.has_more);
      setNextBefore(json.data.page.next_before);
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया दोबारा कोशिश करें।'));
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, nextBefore, loadingMore, isHi]);

  // Lazy: only fetch once the host card is expanded. Reset the guard when
  // collapsed so re-expanding refetches the latest.
  useEffect(() => {
    if (enabled && !loadedOnceRef.current) {
      loadedOnceRef.current = true;
      loadFirst();
    }
    if (!enabled) {
      loadedOnceRef.current = false;
    }
  }, [enabled, loadFirst]);

  return (
    <div className="mt-4 border-t border-surface-3 pt-3.5">
      <h4 className="mb-1 text-sm font-semibold text-foreground">
        💬 {t(isHi, 'Foxy Conversations', 'Foxy बातचीत')}
      </h4>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        {t(
          isHi,
          `${childName}'s conversations with Foxy. View only — you cannot send messages here.`,
          `${childName} की Foxy के साथ बातचीत। केवल देखने के लिए — आप यहाँ संदेश नहीं भेज सकते।`,
        )}
      </p>

      {/* Loading state */}
      {loading && (
        <div className="px-2 py-5 text-center text-muted-foreground">
          <div
            className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-[3px] border-surface-3 border-t-primary"
            aria-hidden="true"
          />
          <span className="text-xs">{t(isHi, 'Loading conversation...', 'बातचीत लोड हो रही है...')}</span>
        </div>
      )}

      {/* Not-linked (403) */}
      {!loading && notLinked && (
        <Alert tone="danger" title={t(isHi, 'Not available', 'उपलब्ध नहीं')}>
          {t(
            isHi,
            'You need an approved link to view this conversation.',
            'इस बातचीत को देखने के लिए आपको एक स्वीकृत लिंक चाहिए।',
          )}
        </Alert>
      )}

      {/* Error */}
      {!loading && !notLinked && error && messages.length === 0 && (
        <div className="px-2 py-3.5 text-center">
          <Alert tone="danger" className="mb-2.5">
            {error}
          </Alert>
          <Button size="sm" variant="secondary" onClick={loadFirst}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !notLinked && !error && messages.length === 0 && (
        <EmptyState
          compact
          icon={<span aria-hidden="true">🦊</span>}
          title={t(isHi, 'No conversations yet', 'अभी तक कोई बातचीत नहीं')}
          description={t(
            isHi,
            `When ${childName} chats with Foxy, the conversation will appear here.`,
            `जब ${childName} Foxy से बात करेगा, तो बातचीत यहाँ दिखाई देगी।`,
          )}
        />
      )}

      {/* Messages — rendered oldest→newest (the API is newest-first, so reverse) */}
      {!loading && messages.length > 0 && (
        <div className="flex max-h-[340px] flex-col gap-2 overflow-y-auto px-0.5 py-1">
          {/* Load-older control sits at the top (older messages are above). */}
          {hasMore && (
            <div className="mb-1 self-center">
              <Button size="sm" variant="secondary" onClick={loadOlder} loading={loadingMore} disabled={loadingMore}>
                {loadingMore
                  ? t(isHi, 'Loading...', 'लोड हो रहा है...')
                  : t(isHi, 'Load older messages', 'पुराने संदेश लोड करें')}
              </Button>
            </div>
          )}

          {[...messages].reverse().map((m) => {
            const isAssistant = m.role === 'assistant';
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
              >
                <div
                  className={`max-w-[82%] rounded-xl border border-surface-3 bg-surface-2 px-3 py-2 ${
                    isAssistant ? 'rounded-tl-sm' : 'rounded-tr-sm'
                  }`}
                >
                  <span
                    className={`mb-0.5 block text-2xs font-bold ${
                      isAssistant ? 'text-primary' : 'text-info'
                    }`}
                  >
                    {isAssistant ? 'Foxy' : childName}
                  </span>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                    {m.text}
                  </p>
                </div>
                <span className="mx-1 mt-0.5 text-2xs text-muted-foreground">
                  {formatTime(m.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Non-fatal error while messages already shown (e.g. load-older failure) */}
      {!loading && messages.length > 0 && error && (
        <p className="mt-2 text-center text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
