'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { Button, DataState, MetricTrust, PageHeader, ProgressBar, StatusBadge, Surface, type MetricTrustProps } from '@alfanumrik/ui/v3';
import { useParentV3Scope } from './ParentV3Shell';

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`request:${response.status}`);
  return response.json() as Promise<T>;
}

function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError(null);
    authedJson<T>(path)
      .then((value) => { if (active) { setData(value); setRetrievedAt(new Date().toISOString()); } })
      .catch(() => { if (active) setError('unavailable'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, path]);
  return { data, loading, error, retrievedAt, retry: () => setAttempt((value) => value + 1) };
}

interface GlanceResponse {
  data?: {
    child?: { name: string | null; grade: string | null };
    snapshot?: {
      sessions_this_week: number | null;
      streak_days: number | null;
      accuracy: number | null;
      avg_score: number | null;
      time_minutes: number | null;
    };
    moments?: { highlights: string[]; concerns: string[]; suggestion: string | null };
  };
}

function Metric({ label, value, suffix, trust }: { label: string; value: number | null | undefined; suffix?: string; trust: MetricTrustProps }) {
  return (
    <Surface className="min-w-0 p-4">
      <p className="text-sm text-secondary-ink">{label}</p>
      <p className="mt-1 text-2xl font-bold text-deep-ink">{value == null ? '—' : `${value}${suffix ?? ''}`}</p>
      <MetricTrust {...trust} />
    </Surface>
  );
}

function ParentDataBoundary({ children }: { children: (data: GlanceResponse['data'], retrievedAt: string | null) => React.ReactNode }) {
  const { childId, loading: scopeLoading, error: scopeError, retry: retryScope } = useParentV3Scope();
  const resource = useResource<GlanceResponse>(childId ? `/api/v2/parent/glance?student_id=${encodeURIComponent(childId)}` : null);
  if (scopeLoading || resource.loading) return <DataState state="loading" title="Loading your child's learning status" />;
  if (scopeError) return <DataState state="error" title={scopeError} action={<Button onClick={retryScope}>Try again</Button>} />;
  if (!childId) return <DataState state="empty" title="No linked child" description="Link a child to see progress and the learning plan." />;
  if (resource.error || !resource.data?.data) {
    return <DataState state="error" title="Learning status is temporarily unavailable" description="Your child's selection has been preserved." action={<Button onClick={resource.retry}>Try again</Button>} />;
  }
  return <>{children(resource.data.data, resource.retrievedAt)}</>;
}

export function ParentV3Home() {
  const { isHi } = useAuth();
  const { childId } = useParentV3Scope();
  return (
    <div className="space-y-5">
      <PageHeader title={isHi ? 'आज की स्थिति' : 'Is your child on track?'} description={isHi ? 'प्रगति समझें और अगला सही कदम चुनें।' : 'Understand progress and choose one useful next step.'} />
      <ParentDataBoundary>{(data, retrievedAt) => {
        const snapshot = data?.snapshot;
        const concern = data?.moments?.concerns?.[0] ?? null;
        const highlight = data?.moments?.highlights?.[0] ?? null;
        const evidenceHref = childId ? `/parent/progress?childId=${encodeURIComponent(childId)}` : '/parent/progress';
        const trustBase = { source: 'Parent glance read model', freshness: null, retrievedAt: retrievedAt ? new Date(retrievedAt).toLocaleString('en-IN') : null, evidenceHref, locale: isHi ? 'hi' as const : 'en' as const };
        return (
          <>
            <Surface className="p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <StatusBadge tone={concern ? 'warning' : highlight ? 'success' : 'neutral'}>{concern ? 'Needs attention' : highlight ? 'No current concern' : 'Waiting for learning evidence'}</StatusBadge>
                  <h2 className="mt-3 text-xl font-bold text-deep-ink">{data?.child?.name ?? 'Your child'}</h2>
                  <p className="mt-1 max-w-2xl text-secondary-ink">{concern ?? highlight ?? 'Complete a learning session to establish the current status.'}</p>
                  <MetricTrust {...trustBase} definition="Needs attention when the governed parent glance returns a current concern; otherwise the latest highlight is shown without inferring a composite score." />
                </div>
                <Link className="v3-button v3-button--primary" href={childId ? `/parent/plan?childId=${childId}` : '/parent/plan'}>Review the plan</Link>
              </div>
            </Surface>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="Quiz sessions this week" value={snapshot?.sessions_this_week} trust={{ ...trustBase, definition: 'Quiz sessions recorded in the current weekly activity summary.' }} />
              <Metric label="Learning streak" value={snapshot?.streak_days} suffix=" days" trust={{ ...trustBase, definition: 'Current consecutive learning-day streak reported for the selected child.' }} />
              <Metric label="Accuracy" value={snapshot?.accuracy} suffix="%" trust={{ ...trustBase, definition: 'Accuracy returned by the selected child’s governed dashboard aggregation.' }} />
              <Metric label="Time learned" value={snapshot?.time_minutes} suffix=" min" trust={{ ...trustBase, definition: 'Recorded learning minutes returned by the selected child’s dashboard aggregation.' }} />
            </div>
            <Surface className="p-5">
              <h2 className="text-base font-bold text-deep-ink">What you can do</h2>
              <p className="mt-2 text-secondary-ink">{data?.moments?.suggestion ?? 'Encourage one short learning session and review progress afterwards.'}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="v3-button v3-button--primary" href={childId ? `/parent/progress?childId=${childId}` : '/parent/progress'}>View progress</Link>
                <Link className="v3-button v3-button--secondary" href={childId ? `/parent/messages?childId=${childId}` : '/parent/messages'}>Contact teacher</Link>
              </div>
            </Surface>
          </>
        );
      }}</ParentDataBoundary>
    </div>
  );
}

export function ParentV3Progress() {
  const { isHi } = useAuth();
  return (
    <div className="space-y-5">
      <PageHeader title="Progress" description="Mastery, effort and the next action—in plain language." />
      <ParentDataBoundary>{(data, retrievedAt) => {
        const accuracy = data?.snapshot?.accuracy;
        return (
          <>
            <Surface className="p-5">
              <div className="flex items-end justify-between gap-4">
                <div><p className="text-sm text-secondary-ink">Accuracy</p><p className="mt-1 text-3xl font-bold">{accuracy == null ? '—' : `${accuracy}%`}</p></div>
                <StatusBadge tone={accuracy == null ? 'neutral' : accuracy >= 70 ? 'success' : 'warning'}>{accuracy == null ? 'No evidence yet' : accuracy >= 70 ? 'Building securely' : 'Practice recommended'}</StatusBadge>
              </div>
              <div className="mt-4">{accuracy == null ? <p className="text-secondary-ink" aria-label="Accuracy unavailable">—</p> : <ProgressBar value={accuracy} label="Accuracy" showValue />}</div>
              <MetricTrust locale={isHi ? 'hi' : 'en'} source="Parent glance read model" definition="Accuracy returned by the selected child’s governed dashboard aggregation." freshness={null} retrievedAt={retrievedAt ? new Date(retrievedAt).toLocaleString('en-IN') : null} />
            </Surface>
            <div className="grid gap-3 md:grid-cols-2">
              <Surface className="p-5"><h2 className="font-bold">Going well</h2><ul className="mt-3 space-y-2 text-secondary-ink">{data?.moments?.highlights?.length ? data.moments.highlights.map((item) => <li key={item}>• {item}</li>) : <li>—</li>}</ul></Surface>
              <Surface className="p-5"><h2 className="font-bold">Needs support</h2><ul className="mt-3 space-y-2 text-secondary-ink">{data?.moments?.concerns?.length ? data.moments.concerns.map((item) => <li key={item}>• {item}</li>) : <li>—</li>}</ul></Surface>
            </div>
          </>
        );
      }}</ParentDataBoundary>
    </div>
  );
}

interface CalendarResponse { data?: { events?: Array<{ id?: string; date: string; type: string; title: string; subtitle?: string }> } }

export function ParentV3Plan() {
  const { childId, loading: scopeLoading } = useParentV3Scope();
  const resource = useResource<CalendarResponse>(childId ? `/api/parent/calendar?student_id=${encodeURIComponent(childId)}` : null);
  return (
    <div className="space-y-5">
      <PageHeader title="Learning plan" description="Upcoming assignments, school assessments and recent learning activity." />
      {scopeLoading || resource.loading ? <DataState state="loading" title="Loading the plan" /> : resource.error ? <DataState state="error" title="The plan is temporarily unavailable" action={<Button onClick={resource.retry}>Try again</Button>} /> : !(resource.data?.data?.events?.length) ? <DataState state="empty" title="No upcoming plan items" description="There are no scheduled assignments or assessments in this period." /> : (
        <div className="space-y-3">{resource.data.data.events.map((event) => <Surface key={event.id ?? `${event.type}:${event.date}:${event.title}`} className="flex items-start gap-4 p-4"><div className="min-w-[5rem] text-sm font-semibold">{new Date(event.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div><div><StatusBadge tone="info">{event.type.replace('_', ' ')}</StatusBadge><h2 className="mt-2 font-bold">{event.title}</h2>{event.subtitle && <p className="mt-1 text-sm text-secondary-ink">{event.subtitle}</p>}</div></Surface>)}</div>
      )}
    </div>
  );
}

interface ThreadsResponse { threads?: Array<{ id: string; teacher_name: string | null; student_name: string | null; subject: string | null; last_message_preview: string | null; unread_count: number }> }
interface MessagesResponse { messages?: Array<{ id: string; sender_role: 'teacher' | 'guardian'; body: string; created_at: string }> }

export function ParentV3Messages() {
  const { childId } = useParentV3Scope();
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = childId ? `/api/parent/messages/threads?student_id=${encodeURIComponent(childId)}` : '/api/parent/messages/threads';
  const resource = useResource<ThreadsResponse>(path);
  const threads = useMemo(() => resource.data?.threads ?? [], [resource.data?.threads]);
  const requestedThread = searchParams?.get('thread') ?? null;
  const selectedThread = threads.find((thread) => thread.id === requestedThread) ?? threads[0] ?? null;
  const messages = useResource<MessagesResponse>(selectedThread ? `/api/parent/messages/threads/${encodeURIComponent(selectedThread.id)}/messages` : null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  const selectThread = (threadId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('thread', threadId);
    if (childId) next.set('childId', childId);
    router.replace(`/parent/messages?${next.toString()}`, { scroll: false });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !selectedThread || sending) return;
    setSending(true);
    setSendError(false);
    try {
      await authedJson('/api/parent/messages', { method: 'POST', body: JSON.stringify({ thread_id: selectedThread.id, body }) });
      setDraft('');
      messages.retry();
      resource.retry();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Messages" description="Conversations with your child's teachers." />
      {resource.loading ? <DataState state="loading" title="Loading messages" /> : resource.error ? <DataState state="error" title="Messages are temporarily unavailable" action={<Button onClick={resource.retry}>Try again</Button>} /> : threads.length === 0 ? <DataState state="empty" title="No conversations yet" description="Teacher conversations will appear here." /> : (
        <div className="grid min-h-[32rem] gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <Surface padding="none" className="overflow-hidden"><div className="divide-y divide-border">{threads.map((thread) => <button type="button" key={thread.id} onClick={() => selectThread(thread.id)} aria-current={thread.id === selectedThread?.id ? 'true' : undefined} className="flex w-full items-center justify-between gap-3 p-4 text-left"><div className="min-w-0"><h2 className="truncate font-bold">{thread.teacher_name ?? 'Teacher'}</h2><p className="mt-1 truncate text-sm text-secondary-ink">{thread.subject ?? thread.student_name ?? 'Conversation'}</p><p className="mt-2 truncate text-sm">{thread.last_message_preview ?? 'Open conversation'}</p></div>{thread.unread_count > 0 && <StatusBadge tone="info">{thread.unread_count} new</StatusBadge>}</button>)}</div></Surface>
          <Surface className="flex min-h-[28rem] flex-col p-4">
            <div className="border-b border-border pb-3"><h2 className="font-bold">{selectedThread?.teacher_name ?? 'Teacher'}</h2><p className="text-sm text-secondary-ink">{selectedThread?.subject ?? selectedThread?.student_name ?? 'Conversation'}</p></div>
            <div className="flex-1 space-y-3 overflow-y-auto py-4" aria-live="polite">{messages.loading ? <DataState state="loading" compact title="Loading conversation" /> : messages.error ? <DataState state="error" compact title="Conversation unavailable" action={<Button onClick={messages.retry}>Try again</Button>} /> : !(messages.data?.messages?.length) ? <DataState state="empty" compact title="No messages yet" /> : messages.data.messages.map((message) => <div key={message.id} className={`max-w-[85%] rounded-xl p-3 ${message.sender_role === 'guardian' ? 'ml-auto bg-orange-soft' : 'bg-surface-sunken'}`}><p className="text-sm">{message.body}</p><p className="mt-1 text-xs text-secondary-ink">{new Date(message.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p></div>)}</div>
            {sendError && <p role="alert" className="mb-2 text-sm text-danger">Message was not sent. Please try again.</p>}
            <form className="flex gap-2 border-t border-border pt-3" onSubmit={(event) => { event.preventDefault(); void send(); }}><label className="v3-sr-only" htmlFor="parent-v3-message">Message</label><input id="parent-v3-message" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} className="min-h-12 flex-1 rounded-xl border border-border bg-surface px-3 text-base" placeholder="Write a message" maxLength={2000} /><Button type="submit" loading={sending} disabled={!draft.trim()}>Send</Button></form>
          </Surface>
        </div>
      )}
    </div>
  );
}

export function ParentV3Settings() {
  const { childId } = useParentV3Scope();
  const suffix = childId ? `?childId=${encodeURIComponent(childId)}` : '';
  return <div className="space-y-5"><PageHeader title="Settings" description="Manage your parent profile, notifications, consent and support." /><div className="grid gap-3 sm:grid-cols-2">{[
    { href: '/parent/profile', title: 'Parent profile', description: 'Account and communication preferences.' },
    { href: '/parent/notifications', title: 'Notifications', description: 'Learning and school updates.' },
    { href: '/parent/consent', title: 'Privacy & consent', description: 'Review active child-data consent.' },
    { href: '/parent/support', title: 'Help & support', description: 'Get help with the parent experience.' },
  ].map((item) => <Link key={item.href} href={`${item.href}${suffix}`}><Surface className="h-full p-5"><h2 className="font-bold">{item.title}</h2><p className="mt-2 text-sm text-secondary-ink">{item.description}</p></Surface></Link>)}</div></div>;
}
