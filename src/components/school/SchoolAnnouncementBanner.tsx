'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';

/**
 * SchoolAnnouncementBanner -- Shows the latest published announcement
 * for a B2B student's school.
 *
 * Data source: `school_announcements` table with RLS (students can only
 * read published, active announcements for their own school).
 *
 * Dismissible: stores dismissed announcement ID in localStorage so the
 * banner does not reappear until a new announcement is published.
 *
 * Returns null when:
 * - Student has no school (B2C)
 * - No active announcements
 * - The latest announcement was already dismissed
 */

/* ─── Types ─── */

interface Announcement {
  id: string;
  title: string;
  title_hi: string | null;
  body: string;
  body_hi: string | null;
  published_at: string;
}

interface SchoolAnnouncementBannerProps {
  isHi: boolean;
  /** Brand primary color from useTenant().branding.primaryColor */
  accentColor?: string;
}

/* ─── Constants ─── */

const DISMISS_KEY_PREFIX = 'dismissed_announcement_';
const SWR_DEDUP_MS = 60_000; // 1 minute

/* ─── Fetcher ─── */

async function fetchLatestAnnouncement(): Promise<Announcement | null> {
  const { data, error } = await supabase
    .from('school_announcements')
    .select('id, title, title_hi, body, body_hi, published_at')
    .eq('is_active', true)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as Announcement;
}

/* ─── Component ─── */

export default function SchoolAnnouncementBanner({
  isHi,
  accentColor = '#7C3AED',
}: SchoolAnnouncementBannerProps) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  const { data: announcement, isLoading } = useSWR(
    'school-announcement-latest',
    fetchLatestAnnouncement,
    {
      dedupingInterval: SWR_DEDUP_MS,
      revalidateOnFocus: false,
    },
  );

  // Check localStorage for dismissed state on mount
  useEffect(() => {
    if (!announcement) return;
    const key = `${DISMISS_KEY_PREFIX}${announcement.id}`;
    if (localStorage.getItem(key) === 'true') {
      setDismissed(announcement.id);
    }
  }, [announcement]);

  // Loading skeleton to prevent CLS
  if (isLoading) {
    return (
      <div className="w-full rounded-2xl animate-pulse" style={{ background: '#f3f4f6', height: 80 }} />
    );
  }

  // Nothing to show
  if (!announcement || dismissed === announcement?.id) {
    return null;
  }

  const title = isHi ? (announcement.title_hi || announcement.title) : announcement.title;
  const body = isHi ? (announcement.body_hi || announcement.body) : announcement.body;

  // Truncate body to ~120 chars for banner preview
  const bodyPreview = body.length > 120 ? body.slice(0, 117) + '...' : body;

  function handleDismiss() {
    const key = `${DISMISS_KEY_PREFIX}${announcement!.id}`;
    localStorage.setItem(key, 'true');
    setDismissed(announcement!.id);
  }

  return (
    <div
      className="w-full rounded-2xl p-4 relative"
      role="status"
      aria-label={isHi ? 'स्कूल की घोषणा' : 'School announcement'}
      style={{
        background: `${accentColor}08`,
        border: `1.5px solid ${accentColor}25`,
      }}
    >
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full transition-colors"
        style={{
          background: `${accentColor}10`,
          color: accentColor,
          minWidth: 44,
          minHeight: 44,
        }}
        aria-label={isHi ? 'बंद करें' : 'Dismiss'}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Content */}
      <div className="flex items-start gap-3 pr-8">
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
          style={{ background: `${accentColor}15`, color: accentColor }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M18 3H2a1 1 0 00-1 1v12a1 1 0 001 1h16a1 1 0 001-1V4a1 1 0 00-1-1zm-1 12H3V5h14v10z" />
            <path d="M5 7h10v1H5zm0 3h7v1H5z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          {/* Label */}
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: accentColor }}
          >
            {isHi ? 'स्कूल घोषणा' : 'SCHOOL ANNOUNCEMENT'}
          </span>

          {/* Title */}
          <h3
            className="text-sm font-bold mt-0.5 leading-snug"
            style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h3>

          {/* Body preview */}
          <p
            className="text-xs mt-1 leading-relaxed"
            style={{ color: 'var(--text-3)' }}
          >
            {bodyPreview}
          </p>

          {/* Timestamp */}
          <time
            className="text-[10px] mt-1.5 block"
            style={{ color: 'var(--text-4)' }}
            dateTime={announcement.published_at}
          >
            {formatRelativeDate(announcement.published_at, isHi)}
          </time>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function formatRelativeDate(isoDate: string, isHi: boolean): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) return isHi ? 'अभी' : 'Just now';
  if (hours < 24) return isHi ? `${hours} घंटे पहले` : `${hours}h ago`;
  if (days === 1) return isHi ? 'कल' : 'Yesterday';
  if (days < 7) return isHi ? `${days} दिन पहले` : `${days} days ago`;
  return new Date(isoDate).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
  });
}
