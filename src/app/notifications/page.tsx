'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStudentNotifications, supabase } from '@/lib/supabase';
import { Card, Button, LoadingFoxy, BottomNav } from '@/components/ui';

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
  achievement: { icon: '🏅', color: '#F5A623', label: 'Achievement', labelHi: 'उपलब्धि' },
  quiz_result: { icon: '⚡', color: '#D97706', label: 'Quiz', labelHi: 'क्विज़' },
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

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const data = await getStudentNotifications(student.id, 50);
      setNotifications(data?.notifications ?? []);
      setUnreadCount(data?.unread_count ?? 0);
    } catch (e) { console.error('Failed to load notifications:', e); setNotifications([]); }
    setLoading(false);
  }, [student]);

  useEffect(() => { if (student) load(); }, [student, load]);

  const markRead = async (id: string) => {
    try {
      await supabase.rpc('mark_notification_read', { p_notification_id: id });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch (e) { console.error('Failed to mark notification read:', e); }
  };

  const markAllRead = async () => {
    if (!student) return;
    try {
      await supabase.rpc('mark_all_notifications_read', { p_student_id: student.id });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
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
        {loading ? (
          <div className="text-center py-16">
            <div className="text-4xl animate-float mb-3">🔔</div>
            <p className="text-sm text-[var(--text-3)]">{isHi ? 'लोड हो रहा है...' : 'Loading notifications...'}</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🦊</div>
            <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'कोई नई सूचना नहीं' : 'All caught up!'}
            </h3>
            <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto mb-4">
              {isHi ? 'Foxy तुम्हें updates भेजता रहेगा — quiz दो, streak बनाओ!' : 'Foxy will send you updates — take quizzes, build your streak!'}
            </p>
            <Button onClick={() => router.push('/quiz')}>
              ⚡ {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
            </Button>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.label}>
              <p className="text-xs font-bold text-[var(--text-3)] mb-2 ml-1 uppercase tracking-wider">
                {isHi ? group.labelHi : group.label}
              </p>
              <div className="space-y-2">
                {group.items.map(n => {
                  const cfg = TYPE_CONFIG[n.type] || { icon: '📌', color: 'var(--text-3)', label: 'Update', labelHi: 'अपडेट' };
                  const isShareable = n.data?.shareable;

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
                          {cfg.icon}
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
                            {n.title}
                          </div>

                          {/* Body */}
                          <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed line-clamp-2" style={{ opacity: n.is_read ? 0.6 : 0.85 }}>
                            {n.body}
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
      <BottomNav />
    </div>
  );
}
