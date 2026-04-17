'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';

function t(isHi: boolean, en: string, hi: string): string { return isHi ? hi : en; }

interface Notification {
  id: string;
  title: string | null;
  body: string | null;
  notification_type: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  announcement: { icon: '📢', color: '#3B82F6' },
  exam_reminder: { icon: '📋', color: '#EAB308' },
  renewal_reminder_30: { icon: '🔔', color: '#F97316' },
  renewal_reminder_14: { icon: '🔔', color: '#EAB308' },
  renewal_reminder_7: { icon: '⚠️', color: '#EF4444' },
  seat_approaching_limit: { icon: '⚠️', color: '#EAB308' },
  score_notification: { icon: '🎯', color: '#22C55E' },
  streak_warning: { icon: '🔥', color: '#F97316' },
  default: { icon: '💬', color: '#6B7280' },
};

function timeAgo(date: string, isHi: boolean): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isHi ? 'अभी' : 'Just now';
  if (mins < 60) return isHi ? `${mins} मिनट पहले` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isHi ? `${hours} घंटे पहले` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return isHi ? 'कल' : 'Yesterday';
  return isHi ? `${days} दिन पहले` : `${days}d ago`;
}

interface Props {
  maxItems?: number;
}

/**
 * School-aware notification dropdown with real-time updates.
 * Shows bell icon with unread badge, dropdown panel with notification list.
 * Supports B2B school notification types (announcements, exams, etc.).
 */
export default function NotificationCenter({ maxItems = 10 }: Props) {
  const { authUserId, isHi } = useAuth();
  const { branding } = useTenant();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const primaryColor = branding.primaryColor;

  const fetchNotifications = useCallback(async () => {
    if (!authUserId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, notification_type, is_read, created_at')
      .eq('recipient_id', authUserId)
      .order('created_at', { ascending: false })
      .limit(maxItems);

    const items = (data || []) as Notification[];
    setNotifications(items);
    setUnreadCount(items.filter(n => !n.is_read).length);
    setLoading(false);
  }, [authUserId, maxItems]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Real-time subscription
  useEffect(() => {
    if (!authUserId) return;
    const channel = supabase
      .channel(`notifications:${authUserId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${authUserId}`,
      }, (payload) => {
        const newNotif = payload.new as Notification;
        setNotifications(prev => [newNotif, ...prev].slice(0, maxItems));
        setUnreadCount(prev => prev + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [authUserId, maxItems]);

  // Close on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id).eq('recipient_id', authUserId);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    if (!authUserId) return;
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('recipient_id', authUserId).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 20 }}
        aria-label={t(isHi, 'Notifications', 'सूचनाएँ')}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -4, background: '#EF4444',
            color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10,
            minWidth: 18, height: 18, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '0 4px',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 380, maxHeight: 480, background: '#fff', borderRadius: 12,
          border: '1px solid #e5e7eb', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          overflow: 'hidden', zIndex: 1000,
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {t(isHi, 'Notifications', 'सूचनाएँ')}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{ fontSize: 11, color: primaryColor, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {t(isHi, 'Mark all read', 'सभी पढ़ा हुआ करें')}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', maxHeight: 380 }} role="list">
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>
                {t(isHi, 'Loading...', 'लोड हो रहा है...')}
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>
                {t(isHi, 'No notifications', 'कोई सूचना नहीं')}
              </div>
            ) : (
              notifications.map(n => {
                const config = TYPE_CONFIG[n.notification_type || 'default'] || TYPE_CONFIG.default;
                const itemStyle: React.CSSProperties = {
                  padding: '12px 16px', borderBottom: '1px solid #f3f4f6',
                  cursor: n.is_read ? 'default' : 'pointer',
                  borderLeft: n.is_read ? '3px solid transparent' : `3px solid ${config.color}`,
                  background: n.is_read ? '#fff' : '#f8fafc',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  width: '100%', textAlign: 'left', font: 'inherit',
                };
                const content = (
                  <>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{config.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600, color: '#111' }}>
                        {n.title || t(isHi, 'Notification', 'सूचना')}
                      </div>
                      {n.body && (
                        <div style={{ fontSize: 12, color: '#666', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.body.length > 80 ? n.body.slice(0, 80) + '...' : n.body}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>
                        {timeAgo(n.created_at, isHi)}
                      </div>
                    </div>
                  </>
                );

                return n.is_read ? (
                  <div key={n.id} role="listitem" style={itemStyle}>
                    {content}
                  </div>
                ) : (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => markRead(n.id)}
                    style={itemStyle}
                  >
                    {content}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <Link
            href="/notifications"
            style={{
              display: 'block', padding: '10px 16px', borderTop: '1px solid #e5e7eb',
              textAlign: 'center', fontSize: 12, color: primaryColor, textDecoration: 'none',
            }}
          >
            {t(isHi, 'See all notifications', 'सभी सूचनाएँ देखें')}
          </Link>
        </div>
      )}
    </div>
  );
}
