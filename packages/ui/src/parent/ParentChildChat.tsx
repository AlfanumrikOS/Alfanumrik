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
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';

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
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #FDBA7433' }}>
      <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', margin: '0 0 4px' }}>
        &#x1F4AC; {t(isHi, 'Foxy Conversations', 'Foxy बातचीत')}
      </h4>
      <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 12px', lineHeight: 1.5 }}>
        {t(
          isHi,
          `${childName}'s conversations with Foxy. View only — you cannot send messages here.`,
          `${childName} की Foxy के साथ बातचीत। केवल देखने के लिए — आप यहाँ संदेश नहीं भेज सकते।`
        )}
      </p>

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '20px 8px', color: '#94A3B8' }}>
          <div
            style={{
              width: 26,
              height: 26,
              border: '3px solid #FDBA7444',
              borderTopColor: '#F97316',
              borderRadius: '50%',
              margin: '0 auto 8px',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span style={{ fontSize: 12 }}>{t(isHi, 'Loading conversation...', 'बातचीत लोड हो रही है...')}</span>
        </div>
      )}

      {/* Not-linked (403) */}
      {!loading && notLinked && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 10,
            padding: '14px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', margin: '0 0 2px' }}>
            {t(isHi, 'Not available', 'उपलब्ध नहीं')}
          </p>
          <p style={{ fontSize: 11, color: '#B91C1C', margin: 0, lineHeight: 1.4 }}>
            {t(
              isHi,
              'You need an approved link to view this conversation.',
              'इस बातचीत को देखने के लिए आपको एक स्वीकृत लिंक चाहिए।'
            )}
          </p>
        </div>
      )}

      {/* Error */}
      {!loading && !notLinked && error && messages.length === 0 && (
        <div style={{ textAlign: 'center', padding: '14px 8px' }}>
          <p style={{ fontSize: 12, color: '#DC2626', margin: '0 0 10px' }}>{error}</p>
          <button
            onClick={loadFirst}
            style={{
              padding: '7px 16px',
              backgroundColor: 'transparent',
              color: '#F97316',
              border: '1px solid #FDBA74',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !notLinked && !error && messages.length === 0 && (
        <div
          style={{
            borderRadius: 10,
            border: '1px dashed #FDBA7488',
            backgroundColor: '#FFF8F0',
            padding: '18px 14px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>&#x1F98A;</div>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#9A3412', margin: '0 0 2px' }}>
            {t(isHi, 'No conversations yet', 'अभी तक कोई बातचीत नहीं')}
          </p>
          <p style={{ fontSize: 11, color: '#B45309', margin: 0, lineHeight: 1.4 }}>
            {t(
              isHi,
              `When ${childName} chats with Foxy, the conversation will appear here.`,
              `जब ${childName} Foxy से बात करेगा, तो बातचीत यहाँ दिखाई देगी।`
            )}
          </p>
        </div>
      )}

      {/* Messages — rendered oldest→newest (the API is newest-first, so reverse) */}
      {!loading && messages.length > 0 && (
        <div
          style={{
            maxHeight: 340,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '4px 2px',
          }}
        >
          {/* Load-older control sits at the top (older messages are above). */}
          {hasMore && (
            <button
              onClick={loadOlder}
              disabled={loadingMore}
              style={{
                alignSelf: 'center',
                padding: '6px 14px',
                marginBottom: 4,
                backgroundColor: 'transparent',
                color: '#F97316',
                border: '1px solid #FDBA74',
                borderRadius: 14,
                fontSize: 11,
                fontWeight: 600,
                cursor: loadingMore ? 'default' : 'pointer',
                opacity: loadingMore ? 0.6 : 1,
                minHeight: 32,
              }}
            >
              {loadingMore
                ? t(isHi, 'Loading...', 'लोड हो रहा है...')
                : t(isHi, 'Load older messages', 'पुराने संदेश लोड करें')}
            </button>
          )}

          {[...messages].reverse().map((m) => {
            const isAssistant = m.role === 'assistant';
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isAssistant ? 'flex-start' : 'flex-end',
                }}
              >
                <div
                  style={{
                    maxWidth: '82%',
                    backgroundColor: isAssistant ? '#FFF3E0' : '#EFF6FF',
                    border: `1px solid ${isAssistant ? '#FDBA7455' : '#BFDBFE'}`,
                    borderRadius: 12,
                    borderTopLeftRadius: isAssistant ? 2 : 12,
                    borderTopRightRadius: isAssistant ? 12 : 2,
                    padding: '8px 12px',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      fontSize: 10,
                      fontWeight: 700,
                      color: isAssistant ? '#EA580C' : '#2563EB',
                      marginBottom: 2,
                    }}
                  >
                    {isAssistant ? 'Foxy' : childName}
                  </span>
                  <p
                    style={{
                      fontSize: 13,
                      color: '#1E293B',
                      margin: 0,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.text}
                  </p>
                </div>
                <span style={{ fontSize: 9, color: '#94A3B8', margin: '2px 4px 0' }}>
                  {formatTime(m.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Non-fatal error while messages already shown (e.g. load-older failure) */}
      {!loading && messages.length > 0 && error && (
        <p style={{ fontSize: 11, color: '#DC2626', textAlign: 'center', margin: '8px 0 0' }}>{error}</p>
      )}
    </div>
  );
}
