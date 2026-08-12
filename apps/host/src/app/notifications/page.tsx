'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getStudentNotifications, supabase } from '@alfanumrik/lib/supabase';
import { logger } from '@alfanumrik/lib/logger';
import { Card, Button, LoadingFoxy, EmptyState } from '@alfanumrik/ui/ui';
import { toast } from '@alfanumrik/ui/ui/toast';

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string; labelHi: string }> = {
  streak_risk: { icon: '🔥', color: '#DC2626', label: 'Streak Alert', labelHi: 'स्ट्रीक अलर्ट' },
  streak_milestone: { icon: '🔥', color: '#F5A623', label: 'Streak', labelHi: 'स्ट्रीक' },
  review_due: { icon: '🔄', color: '#0891B2', label: 'Review', labelHi: 'रिव्यू' },
  rank_update: { icon: '📊', color: '#7C3AED', label: 'Rank', labelHi: 'रैंक' },
  competition_live: { icon: '🏆', color: '#16A34A', label: 'Competition', labelHi: 'प्रतियोगिता' },
  daily_progress: { icon: '🎯', color: '#E8581C', label: 'Daily Goal', labelHi: 'दैनिक लक्ष्य' },
  plan_reminder: { icon: '📅', color: '#7C3AED', label: 'Study Plan', labelHi: 'अध्ययन योजना' },
  foxy_motivation: { icon: '🦊', color: '#E8581C', label: 'Foxy', labelHi: 'फॉक्सी' },
  xp_milestone: { icon: '⭐', color: '#F5A623', label: 'Milestone', labelHi: 'उपलब्धि' },
  parent_daily_report: { icon: '👨‍👩‍👧', color: '#16A34A', label: 'Parent', labelHi: 'अभिभावक' },
  // Parent → child "cheer" (Wave D, ff_parent_encourage_v1). The per-cheer emoji
  // comes from data.icon (cheer-catalog preset); this is just the type label +
  // accent color. Both render fine through the generic feed item below.
  parent_cheer: { icon: '👏', color: '#EC4899', label: 'From Family', labelHi: 'परिवार से' },
  achievement: { icon: '🏅', color: '#F5A623', label: 'Achievement', labelHi: 'उपलब्धि' },
  quiz_result: { icon: '⚡', color: '#D97706', label: 'Quiz', labelHi: 'क्विज़' },
  // Support ticket owner notifications (operator reply / resolution) — En in
  // title/body; Hindi rides data.title_hi / data.body_hi per the house pattern.
  support_ticket_reply: { icon: '💬', color: '#0891B2', label: 'Support', labelHi: 'सहायता' },
  support_ticket_resolved: { icon: '✅', color: '#16A34A', label: 'Support', labelHi: 'सहायता' },
  // Phase A Loop A — adaptive remediation (En in title/body; Hindi rides
  // data.title_hi / data.body_hi per the house pattern — rendered below).
  remediation_assigned: { icon: '🦊', color: '#E8581C', label: 'Extra Practice', labelHi: 'अतिरिक्त अभ्यास' },
  remediation_recovered: { icon: '🎉', color: '#16A34A', label: 'Comeback', labelHi: 'वापसी' },
  remediation_escalated: { icon: '🤝', color: '#F59E0B', label: 'Extra Help', labelHi: 'अतिरिक्त मदद' },
  // Phase A Loop B — inactivity / re-engagement (En in title/body; Hindi rides
  // data.title_hi / data.body_hi per the house pattern — rendered below).
  reengagement_nudge: { icon: '👋', color: '#7C3AED', label: 'Come Back', labelHi: 'वापस आओ' },
  reengagement_returned: { icon: '🎉', color: '#16A34A', label: 'Welcome Back', labelHi: 'वापसी' },
  reengagement_escalated: { icon: '🏠', color: '#F59E0B', label: 'Family Alert', labelHi: 'परिवार अलर्ट' },
  // Phase A Loop C — at-risk concentration (subject-level escalation).
  concentration_escalated: { icon: '🆘', color: '#DC2626', label: 'Subject At Risk', labelHi: 'विषय जोखिम में' },
  concentration_resolved: { icon: '🎉', color: '#16A34A', label: 'Back on Track', labelHi: 'फिर पटरी पर' },
  concentration_reescalated: { icon: '🔁', color: '#DC2626', label: 'Still At Risk', labelHi: 'अब भी जोखिम में' },
  // First-quiz nudge — sent by daily-cron to students who completed onboarding
  // but never took a quiz. Deep-link: /diagnostic.
  first_quiz_nudge: { icon: '🚀', color: '#E8581C', label: 'Get Started', labelHi: 'शुरू करो' },
  // Loop B engagement — streak about to break (daily-cron early-warning nudge).
  streak_at_risk: { icon: '🔥', color: '#EF4444', label: 'Streak at Risk', labelHi: 'स्ट्रीक खतरे में' },
  // Loop D — blocked-prerequisite (Digital Twin + Knowledge Graph Slice 1,
  // ff_digital_twin_v1). Frontend readiness only — the flag is still OFF.
  // Assessment sign-off (2026-07-21): labels reframed from deficit language
  // ("Foundation Gap" / "Foundation Fixed") to the same growth-mindset,
  // action-oriented register as Loop A's remediation labels ("Extra
  // Practice" / "Extra Help") — this is a routine daily-rhythm card, not an
  // escalation, so it should not borrow "at risk"/gap severity language.
  prerequisite_blocked: { icon: '🔗', color: '#F59E0B', label: 'Foundation Boost', labelHi: 'नींव अभ्यास' },
  prerequisite_resolved: { icon: '✅', color: '#16A34A', label: 'Foundation Ready', labelHi: 'नींव तैयार' },
};

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

function timeAgo(dateStr: string, isHi: boolean): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isHi ? 'अभी' : 'Just now';
  if (mins < 60) return isHi ? `${mins} मिनट पहले` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isHi ? `${hrs} घंटे पहले` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return isHi ? 'कल' : 'Yesterday';
  if (days < 7) return isHi ? `${days} दिन पहले` : `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function groupNotifications(notifs: Notification[]): { label: string; labelHi: string; items: Notification[] }[] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups: { label: string; labelHi: string; items: Notification[] }[] = [
    { label: 'Today', labelHi: 'आज', items: [] },
    { label: 'Yesterday', labelHi: 'कल', items: [] },
    { label: 'Earlier', labelHi: 'पहले', items: [] },
  ];
  notifs.forEach(n => {
    const d = new Date(n.created_at).toDateString();
    if (d === today) groups[0].items.push(n);
    else if (d === yesterday) groups[1].items.push(n);
    else groups[2].items.push(n);
  });
  return groups.filter(g => g.items.length > 0);
}

export default function NotificationsPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // getStudentNotifications used to resolve `{ unread_count: 0, notifications: [] }`
  // for BOTH a genuine empty inbox and a failed RPC, and the `catch` below it
  // was dead code (supabase.rpc() resolves, it does not reject). Net effect: a
  // 500 rendered "No notifications yet" — the same lie /progress told with
  // "No knowledge gaps detected!". The helper now returns ServiceResult, so the
  // two outcomes are structurally different and this function must pick one.
  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setFetchError(null);
    const result = await getStudentNotifications(student.id, 50);
    if (!result.ok) {
      // P13: reason string only — no student id, no row payload.
      logger.warn('notifications: get_student_notifications failed', { reason: result.error });
      // Last-known-good is preserved on purpose: a failed REFRESH must not
      // blank a list the student is already reading. On a first load there is
      // nothing to preserve, the list stays empty, and the error card renders
      // INSTEAD of the "No notifications yet" empty state (never alongside it).
      setFetchError(isHi ? 'सूचनाएं लोड नहीं हो सकीं' : 'Failed to load notifications');
      setLoading(false);
      return;
    }
    setNotifications(result.data.notifications ?? []);
    setUnreadCount(result.data.unread_count ?? 0);
    setLoading(false);
  }, [student, isHi]);

  useEffect(() => { if (student) load(); }, [student, load]);

  // supabase.rpc() resolves with { data, error } — it does NOT reject on a
  // server/RLS failure, so the `error` field has to be inspected explicitly.
  // Applying the optimistic local update without checking it would show the
  // student a read notification (and a decremented badge) that the server
  // never actually recorded.
  //
  // Failure feedback is IDENTICAL in shape to markAllRead below (same
  // try/throw/catch, same logger.warn + toast.error pair, same bilingual copy
  // register). It used to return silently, so the row stayed unread with no
  // explanation — correct, but inconsistent with the sibling path that does
  // toast. One pattern, both paths.
  const markRead = async (id: string) => {
    try {
      const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id });
      if (error) throw new Error(error.message);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch (e) {
      // Local state is deliberately left untouched — the row stays visibly
      // unread rather than faking a write the server rejected.
      logger.warn('notifications: mark_notification_read failed', {
        reason: e instanceof Error ? e.message : 'unknown error',
      });
      toast.error(
        isHi
          ? 'सूचना पढ़ी हुई मार्क नहीं हो सकी। फिर से कोशिश करो।'
          : "Couldn't mark that as read. Please try again.",
      );
    }
  };

  // Explicit user action — a silent no-op reads as a broken button, so a
  // failure is surfaced to the student (bilingual, P7) instead of swallowed.
  const markAllRead = async () => {
    if (!student) return;
    try {
      const { error } = await supabase.rpc('mark_all_notifications_read', { p_student_id: student.id });
      if (error) throw new Error(error.message);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (e) {
      logger.warn('notifications: mark_all_notifications_read failed', {
        reason: e instanceof Error ? e.message : 'unknown error',
      });
      toast.error(
        isHi
          ? 'सब पढ़ा हुआ मार्क नहीं हो सका। फिर से कोशिश करो।'
          : "Couldn't mark all as read. Please try again.",
      );
    }
  };

  const handleTap = (n: Notification) => {
    if (!n.is_read) markRead(n.id);
    const action = n.data?.action;
    if (action && typeof action === 'string') router.push(action);
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const groups = groupNotifications(notifications);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              🔔 {isHi ? 'सूचनाएँ' : 'Notifications'}
            </h1>
            {unreadCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-bold text-white" style={{ background: '#DC2626' }}>
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs font-semibold" style={{ color: 'var(--orange)' }}>
              {isHi ? 'सब पढ़ा' : 'Mark all read'}
            </button>
          )}
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
        {fetchError && (
          <div
            role="alert"
            className="mx-4 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 flex items-center gap-2"
          >
            <span aria-hidden="true">⚠️</span>
            <span>{fetchError}</span>
            {/* min-h/min-w pinned locally: the bare underlined link laid out
                well under the 44px touch floor (WCAG 2.5.8) this repo requires
                — the same measurement miss #1485 caught on /progress at 42px.
                inline-flex centres the label so the extra box is padding. */}
            <button
              onClick={() => load()}
              className="ml-auto inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 text-red-700 underline"
            >
              {isHi ? 'पुनः प्रयास' : 'Retry'}
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-center py-16">
            <div className="text-4xl animate-float mb-3">🔔</div>
            <p className="text-sm text-[var(--text-3)]">{isHi ? 'लोड हो रहा है...' : 'Loading notifications...'}</p>
          </div>
        ) : notifications.length === 0 ? (
          /* "No notifications yet" is a CLAIM about this student's inbox, so it
             is gated on a settled, successful read. When fetchError is set the
             error card above is the whole answer — the reassuring copy must be
             absent, not merely accompanied. */
          fetchError ? null : (
            <EmptyState
              icon="🔔"
              title={isHi ? 'अभी तक कोई सूचना नहीं' : 'No notifications yet'}
              description={isHi ? 'क्विज़ लो और हम तुम्हें अपडेट करते रहेंगे' : 'Start quizzing and we\'ll keep you updated'}
              action={
                <Button onClick={() => router.push('/quiz')}>
                  ⚡ {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
                </Button>
              }
            />
          )
        ) : (
          groups.map(group => (
            <div key={group.label}>
              <p className="text-xs font-bold text-[var(--text-3)] mb-2 ml-1 uppercase tracking-wider">
                {isHi ? group.labelHi : group.label}
              </p>
              <div className="space-y-2">
                {group.items.map(n => {
                  const cfg = TYPE_CONFIG[n.type] || { icon: '📌', color: 'var(--text-3)', label: 'Update', labelHi: 'अपडेट' };
                  // Prefer a per-notification emoji from data.icon when supplied
                  // (e.g. parent_cheer carries the chosen cheer-catalog icon);
                  // otherwise fall back to the type's default icon.
                  const displayIcon = typeof n.data?.icon === 'string' && n.data.icon ? n.data.icon : cfg.icon;
                  const isShareable = n.data?.shareable;
                  // P7 — Hindi copy rides data.title_hi / data.body_hi (the
                  // notifications table has no top-level *_hi columns). Falls
                  // back to the En title/body when the row predates this.
                  const displayTitle =
                    isHi && typeof n.data?.title_hi === 'string' && n.data.title_hi ? n.data.title_hi : n.title;
                  const displayBody =
                    isHi && typeof n.data?.body_hi === 'string' && n.data.body_hi ? n.data.body_hi : n.body;

                  return (
                    <button
                      key={n.id}
                      onClick={() => handleTap(n)}
                      className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98] relative overflow-hidden"
                      style={{
                        background: n.is_read ? 'var(--surface-1)' : `${cfg.color}06`,
                        border: `1px solid ${n.is_read ? 'var(--border)' : cfg.color + '25'}`,
                      }}
                    >
                      {/* Unread indicator */}
                      {!n.is_read && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ background: cfg.color }} />
                      )}

                      <div className="flex items-start gap-3 pl-1">
                        {/* Icon */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                          style={{ background: `${cfg.color}12` }}
                        >
                          {displayIcon}
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Type badge + time */}
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
                              {isHi ? cfg.labelHi : cfg.label}
                            </span>
                            <span className="text-[10px] text-[var(--text-3)] flex-shrink-0 ml-2">
                              {timeAgo(n.created_at, isHi)}
                            </span>
                          </div>

                          {/* Title */}
                          <div className="text-sm font-semibold leading-snug" style={{ opacity: n.is_read ? 0.7 : 1 }}>
                            {displayTitle}
                          </div>

                          {/* Body */}
                          <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed line-clamp-2" style={{ opacity: n.is_read ? 0.6 : 0.85 }}>
                            {displayBody}
                          </p>

                          {/* Action hint */}
                          <div className="flex items-center gap-2 mt-2">
                            {n.data?.action && (
                              <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>
                                {isHi ? 'टैप करो →' : 'Tap to open →'}
                              </span>
                            )}
                            {isShareable && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}12`, color: cfg.color }}>
                                {isHi ? '📱 शेयर करो' : '📱 Shareable'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </main>
      
    </div>
  );
}
