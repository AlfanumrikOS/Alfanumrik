'use client';

/**
 * /parent/messages — Phase C.3
 *
 * Teacher↔parent messaging surface (parent side). Mirrors the teacher
 * page shape but in the orange-on-white parent palette and re-using
 * the parent permission set.
 *
 * Backed by:
 *   - GET  /api/parent/messages/threads
 *   - GET  /api/parent/messages/threads/[id]/messages   (marks read)
 *   - POST /api/parent/messages
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
  teacher_name: string | null;
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
  if (!res.ok) throw new Error(`parent-messages.fetch_failed:${res.status}`);
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

function ParentMessagesContent() {
  const { isHi } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const selectedFromUrl = searchParams?.get('thread') ?? null;
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: threadsData, mutate: mutateThreads } = useSWR<ThreadsResponse>(
    '/api/parent/messages/threads',
    fetcher,
    { refreshInterval: LIST_POLL_MS, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const threads = useMemo(() => threadsData?.threads ?? [], [threadsData?.threads]);

  const selectedThreadId = useMemo(() => {
    if (selectedFromUrl && threads.some((t) => t.id === selectedFromUrl)) return selectedFromUrl;
    if (draftThreadId && threads.some((t) => t.id === draftThreadId)) return draftThreadId;
    return threads[0]?.id ?? null;
  }, [selectedFromUrl, draftThreadId, threads]);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? null;

  const { data: messagesData, mutate: mutateMessages } = useSWR<MessagesResponse>(
    selectedThreadId ? `/api/parent/messages/threads/${selectedThreadId}/messages` : null,
    fetcher,
    { refreshInterval: PANEL_POLL_MS, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const messages = messagesData?.messages ?? [];

  const selectThread = useCallback((id: string) => {
    setDraftThreadId(id);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('thread', id);
    router.replace(`/parent/messages?${params.toString()}`);
  }, [router, searchParams]);

  useEffect(() => {
    if (selectedThreadId) mutateThreads();
  }, [selectedThreadId, mutateThreads]);

  const handleSend = useCallback(async () => {
    const body = draftBody.trim();
    if (!body || !selectedThread || sending) return;
    setSending(true);
    setErrorMsg(null);
    try {
      const res = await authedFetch('/api/parent/messages', {
        method: 'POST',
        body: JSON.stringify({ thread_id: selectedThread.id, body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Send failed' }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setDraftBody('');
      await Promise.all([mutateMessages(), mutateThreads()]);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [draftBody, selectedThread, sending, mutateMessages, mutateThreads]);

  return (
    <div className="flex h-dvh w-full flex-col bg-orange-50/30 text-slate-900 md:flex-row">
      <aside
        className={`flex w-full flex-col border-r border-orange-200/60 bg-white md:w-80 md:flex-shrink-0 ${
          selectedThreadId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <header className="border-b border-orange-200/60 p-4">
          <h1 className="text-base font-semibold">{tt(isHi, 'Messages', 'संदेश')}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {tt(isHi, "Talk to your child's teachers", 'अपने बच्चे के शिक्षकों से बात करें')}
          </p>
        </header>
        <ul className="flex-1 divide-y divide-orange-100 overflow-y-auto">
          {threads.length === 0 ? (
            <li className="p-6 text-center text-sm text-slate-500">
              {tt(isHi, 'No conversations yet.', 'अभी तक कोई बातचीत नहीं।')}
            </li>
          ) : (
            threads.map((t) => {
              const isActive = t.id === selectedThreadId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => selectThread(t.id)}
                    className={`flex w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-orange-50 ${
                      isActive ? 'bg-orange-100/60' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {t.teacher_name || tt(isHi, 'Teacher', 'शिक्षक')}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {relativeTime(t.last_message_at, isHi)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {t.student_name ? `${tt(isHi, 'For', 'के लिए')} ${t.student_name}` : ''}
                      </span>
                      {t.unread_count > 0 && (
                        <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-semibold text-white">
                          {t.unread_count > 99 ? '99+' : t.unread_count}
                        </span>
                      )}
                    </div>
                    {t.last_message_preview && (
                      <p className="line-clamp-2 text-xs text-slate-600">{t.last_message_preview}</p>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <section className={`flex flex-1 flex-col ${selectedThreadId ? 'flex' : 'hidden md:flex'}`}>
        {selectedThread ? (
          <>
            <header className="flex items-center justify-between border-b border-orange-200/60 bg-white p-4">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setDraftThreadId(null);
                    const params = new URLSearchParams(searchParams?.toString() ?? '');
                    params.delete('thread');
                    router.replace(`/parent/messages${params.toString() ? `?${params}` : ''}`);
                  }}
                  className="mr-2 text-xs text-orange-700 hover:underline md:hidden"
                >
                  ← {tt(isHi, 'Back', 'वापस')}
                </button>
                <h2 className="text-base font-semibold">
                  {selectedThread.teacher_name || tt(isHi, 'Teacher', 'शिक्षक')}
                </h2>
                {selectedThread.student_name && (
                  <p className="text-xs text-slate-500">
                    {tt(isHi, 'For', 'के लिए')} {selectedThread.student_name}
                  </p>
                )}
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  {tt(isHi, 'No messages yet.', 'अभी तक कोई संदेश नहीं।')}
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_role === 'guardian';
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                          mine
                            ? 'rounded-br-md bg-orange-500 text-white'
                            : 'rounded-bl-md bg-white text-slate-900 shadow-sm ring-1 ring-orange-100'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <div className={`mt-1 text-[10px] ${mine ? 'text-orange-100' : 'text-slate-500'}`}>
                          {relativeTime(m.created_at, isHi)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              className="border-t border-orange-200/60 bg-white p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              {errorMsg && (
                <p className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{errorMsg}</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  className="min-h-[44px] flex-1 resize-none rounded-md border border-orange-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-orange-500 focus:outline-none"
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
                  className="rounded-md bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? tt(isHi, 'Sending…', 'भेज रहे…') : tt(isHi, 'Send', 'भेजें')}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
            {tt(isHi, 'Select a conversation.', 'एक बातचीत चुनें।')}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ParentMessagesPage() {
  return (
    <Suspense>
      <ParentMessagesContent />
    </Suspense>
  );
}
