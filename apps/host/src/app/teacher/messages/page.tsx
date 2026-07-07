'use client';

/**
 * /teacher/messages — Phase C.3
 *
 * Teacher↔parent messaging surface (teacher side).
 *   - Left: thread list (newest first, unread badge per row).
 *   - Right: message panel for the selected thread.
 *   - Compose row at the bottom of the message panel.
 *   - Mobile: thread list and message panel stack; selecting a thread
 *     pushes the panel into view.
 *   - Bilingual (en/hi) via useAuth().isHi.
 *
 * Backed by:
 *   - GET  /api/teacher/messages/threads
 *   - GET  /api/teacher/messages/threads/[id]/messages   (marks read)
 *   - POST /api/teacher/messages
 *
 * Polling at 15s for the active thread, 30s for the thread list.
 */

import { useState, useCallback, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';

const LIST_POLL_MS = 30_000;
const PANEL_POLL_MS = 15_000;

interface ThreadRow {
  id: string;
  teacher_id: string;
  guardian_id: string;
  student_id: string;
  school_id: string | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  guardian_name: string | null;
  student_name: string | null;
  last_message_preview: string | null;
  last_message_sender_role: 'teacher' | 'guardian' | null;
  unread_count: number;
}
interface MessageRow {
  id: string;
  thread_id: string;
  sender_role: 'teacher' | 'guardian';
  sender_auth_user_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
interface ThreadsResponse {
  success: boolean;
  threads: ThreadRow[];
  unreadTotal: number;
  error?: string;
}
interface MessagesResponse {
  success: boolean;
  messages: MessageRow[];
  nextCursor: string | null;
  error?: string;
}

async function authedFetch(url: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* anonymous */ }
  return fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`teacher-messages.fetch_failed:${res.status}`);
  return res.json() as Promise<T>;
};

function tt(isHi: boolean, en: string, hi: string) {
  return isHi ? hi : en;
}

function relativeTime(iso: string, isHi: boolean): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return tt(isHi, 'just now', 'अभी');
  if (min < 60) return tt(isHi, `${min}m ago`, `${min} मि पूर्व`);
  const hr = Math.floor(min / 60);
  if (hr < 24) return tt(isHi, `${hr}h ago`, `${hr} घं पूर्व`);
  const day = Math.floor(hr / 24);
  if (day < 7) return tt(isHi, `${day}d ago`, `${day} दिन पूर्व`);
  return new Date(iso).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
}

function TeacherMessagesContent() {
  const { isHi } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Selected thread comes from ?thread=<id>; falls back to the first thread.
  // For a brand-new conversation, the caller may pass ?student=<id> (and
  // optionally ?guardian=<id> to disambiguate when the student has multiple
  // approved guardians). We render an "Inline compose" mode that POSTs to
  // create the thread on the first send.
  const selectedFromUrl = searchParams?.get('thread') ?? null;
  const composeGuardianId = searchParams?.get('guardian') ?? null;
  const composeStudentId  = searchParams?.get('student') ?? null;
  const inComposeMode = Boolean(composeStudentId && !selectedFromUrl);
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Thread list ──
  const { data: threadsData, mutate: mutateThreads } = useSWR<ThreadsResponse>(
    '/api/teacher/messages/threads',
    fetcher,
    { refreshInterval: LIST_POLL_MS, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  // Stabilise threads identity so dependent hooks don't re-run on every fetch.
  const threads = useMemo(() => threadsData?.threads ?? [], [threadsData?.threads]);

  // Resolve the active thread id (URL → state → first row).
  const selectedThreadId = useMemo(() => {
    if (selectedFromUrl && threads.some((t) => t.id === selectedFromUrl)) return selectedFromUrl;
    if (draftThreadId && threads.some((t) => t.id === draftThreadId)) return draftThreadId;
    return threads[0]?.id ?? null;
  }, [selectedFromUrl, draftThreadId, threads]);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? null;

  // ── Message panel ──
  const { data: messagesData, mutate: mutateMessages } = useSWR<MessagesResponse>(
    selectedThreadId ? `/api/teacher/messages/threads/${selectedThreadId}/messages` : null,
    fetcher,
    { refreshInterval: PANEL_POLL_MS, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const messages = messagesData?.messages ?? [];

  // Sync URL when user picks a different thread (deep-linkable).
  const selectThread = useCallback((id: string) => {
    setDraftThreadId(id);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('thread', id);
    router.replace(`/teacher/messages?${params.toString()}`);
  }, [router, searchParams]);

  // Re-fetch threads when the URL thread param changes so the unread badge
  // for the active thread drops immediately after read marking.
  useEffect(() => {
    if (selectedThreadId) mutateThreads();
  }, [selectedThreadId, mutateThreads]);

  const handleSend = useCallback(async () => {
    const body = draftBody.trim();
    if (!body || sending) return;
    // Allow send if either a thread is selected OR we have a compose target.
    if (!selectedThread && !inComposeMode) return;
    setSending(true);
    setErrorMsg(null);
    try {
      const payload: Record<string, unknown> = { body };
      if (selectedThread) {
        payload.thread_id = selectedThread.id;
      } else {
        // guardian_id is optional — when absent, the API resolves the
        // student's primary approved guardian server-side.
        payload.student_id  = composeStudentId;
        if (composeGuardianId) payload.guardian_id = composeGuardianId;
      }
      const res = await authedFetch('/api/teacher/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Send failed' }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { thread_id?: string };
      setDraftBody('');
      await Promise.all([mutateMessages(), mutateThreads()]);
      // After creating, jump to the resulting thread (cleans up the compose URL).
      if (inComposeMode && j.thread_id) {
        router.replace(`/teacher/messages?thread=${j.thread_id}`);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [
    draftBody,
    selectedThread,
    sending,
    inComposeMode,
    composeGuardianId,
    composeStudentId,
    mutateMessages,
    mutateThreads,
    router,
  ]);

  return (
    <div className="flex h-dvh w-full flex-col bg-[var(--surface-2)] text-[var(--text-1)] md:flex-row">
      {/* Thread list */}
      <aside
        className={`flex w-full flex-col border-r border-[var(--surface-3)] md:w-80 md:flex-shrink-0 ${
          selectedThreadId || inComposeMode ? 'hidden md:flex' : 'flex'
        }`}
      >
        <header className="border-b border-[var(--surface-3)] p-4">
          <h1 className="text-base font-semibold">{tt(isHi, 'Messages', 'संदेश')}</h1>
          <p className="mt-0.5 text-xs text-[var(--text-3)]">
            {tt(isHi, 'Conversations with parents', 'अभिभावकों से बातचीत')}
          </p>
        </header>
        <ul className="flex-1 divide-y divide-[var(--surface-3)] overflow-y-auto">
          {threads.length === 0 ? (
            <li className="p-6 text-center text-sm text-[var(--text-3)]">
              {tt(isHi, 'No conversations yet. Visit a student page to start one.', 'अभी तक कोई बातचीत नहीं। शुरू करने के लिए छात्र पृष्ठ पर जाएँ।')}
            </li>
          ) : (
            threads.map((t) => {
              const isActive = t.id === selectedThreadId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => selectThread(t.id)}
                    className={`flex w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-[var(--surface-2)] ${
                      isActive ? 'bg-[var(--surface-2)]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {t.guardian_name || tt(isHi, 'Parent', 'अभिभावक')}
                      </span>
                      <span className="shrink-0 text-[12px] text-[var(--text-3)]">
                        {relativeTime(t.last_message_at, isHi)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-[var(--text-3)]">
                        {t.student_name ? `→ ${t.student_name}` : ''}
                      </span>
                      {t.unread_count > 0 && (
                        <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold text-on-accent">
                          {t.unread_count > 99 ? '99+' : t.unread_count}
                        </span>
                      )}
                    </div>
                    {t.last_message_preview && (
                      <p className="line-clamp-2 text-xs text-[var(--text-3)]">{t.last_message_preview}</p>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {/* Message panel */}
      <section
        className={`flex flex-1 flex-col ${selectedThreadId || inComposeMode ? 'flex' : 'hidden md:flex'}`}
      >
        {inComposeMode && !selectedThread ? (
          <>
            <header className="border-b border-[var(--surface-3)] p-4">
              <h2 className="text-base font-semibold">
                {tt(isHi, 'New message to parent', 'अभिभावक को नया संदेश')}
              </h2>
              <p className="text-xs text-[var(--text-3)]">
                {tt(isHi, 'Your first message will create the conversation.', 'आपका पहला संदेश बातचीत शुरू कर देगा।')}
              </p>
            </header>
            <div className="flex-1" />
            <form
              className="border-t border-[var(--surface-3)] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              {errorMsg && (
                <p className="mb-2 rounded-md bg-[var(--red-soft)] px-2 py-1 text-xs text-[var(--danger)]">{errorMsg}</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  className="min-h-[44px] flex-1 resize-none rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:border-[var(--orange)] focus:outline-none"
                  rows={3}
                  maxLength={4000}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  placeholder={tt(isHi, 'Type your first message…', 'अपना पहला संदेश लिखें…')}
                  disabled={sending}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={sending || draftBody.trim().length === 0}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-on-accent transition-opacity hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? tt(isHi, 'Sending…', 'भेज रहे…') : tt(isHi, 'Send', 'भेजें')}
                </button>
              </div>
            </form>
          </>
        ) : selectedThread ? (
          <>
            <header className="flex items-center justify-between border-b border-[var(--surface-3)] p-4">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setDraftThreadId(null);
                    const params = new URLSearchParams(searchParams?.toString() ?? '');
                    params.delete('thread');
                    router.replace(`/teacher/messages${params.toString() ? `?${params}` : ''}`);
                  }}
                  className="mr-2 text-xs text-[var(--text-3)] hover:text-[var(--text-1)] md:hidden"
                >
                  ← {tt(isHi, 'Back', 'वापस')}
                </button>
                <h2 className="text-base font-semibold">
                  {selectedThread.guardian_name || tt(isHi, 'Parent', 'अभिभावक')}
                </h2>
                {selectedThread.student_name && (
                  <p className="text-xs text-[var(--text-3)]">
                    {tt(isHi, 'Re:', 'विषय:')} {selectedThread.student_name}
                  </p>
                )}
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--text-3)]">
                  {tt(isHi, 'No messages yet — say hello.', 'अभी तक कोई संदेश नहीं — नमस्ते कहें।')}
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_role === 'teacher';
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                          mine
                            ? 'rounded-br-md bg-primary text-on-accent'
                            : 'rounded-bl-md bg-[var(--surface-2)] text-[var(--text-1)]'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <div className={`mt-1 text-[12px] ${mine ? 'text-[var(--surface-2)]' : 'text-[var(--text-3)]'}`}>
                          {relativeTime(m.created_at, isHi)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              className="border-t border-[var(--surface-3)] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              {errorMsg && (
                <p className="mb-2 rounded-md bg-[var(--red-soft)] px-2 py-1 text-xs text-[var(--danger)]">{errorMsg}</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  className="min-h-[44px] flex-1 resize-none rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:border-[var(--orange)] focus:outline-none"
                  rows={2}
                  maxLength={4000}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  placeholder={tt(isHi, 'Type a message…', 'संदेश लिखें…')}
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={sending || draftBody.trim().length === 0}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-on-accent transition-opacity hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? tt(isHi, 'Sending…', 'भेज रहे…') : tt(isHi, 'Send', 'भेजें')}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--text-3)]">
            {tt(isHi, 'Select a conversation from the left.', 'बाईं ओर से एक बातचीत चुनें।')}
          </div>
        )}
      </section>
    </div>
  );
}

export default function TeacherMessagesPage() {
  return (
    <Suspense>
      <TeacherMessagesContent />
    </Suspense>
  );
}
