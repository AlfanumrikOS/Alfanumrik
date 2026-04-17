'use client';

import useSWR from 'swr';
import { supabase } from '@/lib/supabase';

/**
 * UpcomingExamCard -- Shows the next 3 upcoming school exams.
 *
 * Data source: `school_exams` table with RLS (students can only
 * read scheduled/active exams for their own school).
 *
 * Urgency styling:
 * - Red border + background if < 24 hours away
 * - Yellow/amber if < 3 days
 * - Green/teal otherwise
 *
 * Returns null if no upcoming exams (B2C students or no scheduled exams).
 */

/* ─── Types ─── */

interface SchoolExam {
  id: string;
  title: string;
  subject: string;
  grade: string; // P5: always string "6"-"12"
  start_time: string;
  end_time: string;
  duration_minutes: number;
  question_count: number;
}

interface UpcomingExamCardProps {
  isHi: boolean;
  /** Brand primary color from useTenant().branding.primaryColor */
  accentColor?: string;
}

/* ─── Constants ─── */

const SWR_DEDUP_MS = 60_000;
const HOURS_24 = 24 * 60 * 60 * 1000;
const DAYS_3 = 3 * 24 * 60 * 60 * 1000;

/* ─── Urgency colors ─── */

interface UrgencyTheme {
  bg: string;
  border: string;
  badge: string;
  badgeText: string;
}

function getUrgency(startTime: string): UrgencyTheme {
  const ms = new Date(startTime).getTime() - Date.now();

  if (ms < HOURS_24) {
    return {
      bg: 'rgba(220,38,38,0.04)',
      border: 'rgba(220,38,38,0.25)',
      badge: 'rgba(220,38,38,0.1)',
      badgeText: '#DC2626',
    };
  }
  if (ms < DAYS_3) {
    return {
      bg: 'rgba(217,119,6,0.04)',
      border: 'rgba(217,119,6,0.2)',
      badge: 'rgba(217,119,6,0.1)',
      badgeText: '#D97706',
    };
  }
  return {
    bg: 'rgba(22,163,74,0.04)',
    border: 'rgba(22,163,74,0.15)',
    badge: 'rgba(22,163,74,0.1)',
    badgeText: '#16A34A',
  };
}

/* ─── Fetcher ─── */

async function fetchUpcomingExams(): Promise<SchoolExam[]> {
  const { data, error } = await supabase
    .from('school_exams')
    .select('id, title, subject, grade, start_time, end_time, duration_minutes, question_count')
    .in('status', ['scheduled', 'active'])
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(3);

  if (error || !data) return [];
  return data as SchoolExam[];
}

/* ─── Component ─── */

export default function UpcomingExamCard({ isHi, accentColor = '#7C3AED' }: UpcomingExamCardProps) {
  const { data: exams, isLoading } = useSWR(
    'school-upcoming-exams',
    fetchUpcomingExams,
    {
      dedupingInterval: SWR_DEDUP_MS,
      revalidateOnFocus: false,
    },
  );

  // Loading skeleton to prevent CLS
  if (isLoading) {
    return (
      <div className="w-full rounded-2xl animate-pulse" style={{ background: '#f3f4f6', height: 72 }} />
    );
  }

  // Nothing to show
  if (!exams || exams.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📝</span>
        <h3
          className="text-sm font-bold"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'आगामी परीक्षाएं' : 'Upcoming Exams'}
        </h3>
        <span
          className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${accentColor}10`, color: accentColor }}
        >
          {exams.length}
        </span>
      </div>

      {/* Exam list */}
      <div className="flex flex-col gap-2.5">
        {exams.map((exam) => (
          <ExamRow key={exam.id} exam={exam} isHi={isHi} />
        ))}
      </div>
    </div>
  );
}

/* ─── Individual exam row ─── */

function ExamRow({ exam, isHi }: { exam: SchoolExam; isHi: boolean }) {
  const urgency = getUrgency(exam.start_time);
  const countdown = formatCountdown(exam.start_time, isHi);
  const dateStr = formatExamDate(exam.start_time, isHi);
  const timeStr = formatExamTime(exam.start_time, isHi);

  return (
    <div
      className="rounded-xl p-3.5 transition-all"
      style={{
        background: urgency.bg,
        border: `1px solid ${urgency.border}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Left: exam details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Subject badge */}
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
              style={{ background: urgency.badge, color: urgency.badgeText }}
            >
              {exam.subject}
            </span>
            {/* Grade P5: always string */}
            <span
              className="text-[10px]"
              style={{ color: 'var(--text-4)' }}
            >
              {isHi ? `कक्षा ${exam.grade}` : `Grade ${exam.grade}`}
            </span>
          </div>

          {/* Title */}
          <h4
            className="text-sm font-semibold mt-1 leading-snug"
            style={{ color: 'var(--text-1)' }}
          >
            {exam.title}
          </h4>

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M6 1a5 5 0 100 10A5 5 0 006 1zm0 9a4 4 0 110-8 4 4 0 010 8zm.5-6H5v3.5l2.5 1.5.5-.82-2-1.18V4z" />
              </svg>
              {exam.duration_minutes} {isHi ? 'मिनट' : 'min'}
            </span>
            <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M10 2H8V1H4v1H2a1 1 0 00-1 1v7a1 1 0 001 1h8a1 1 0 001-1V3a1 1 0 00-1-1zM5 2h2v1H5V2zm5 8H2V4h8v6zM4 5h1v1H4zm0 2h1v1H4zm2-2h1v1H6zm0 2h1v1H6zm2-2h1v1H8z" />
              </svg>
              {exam.question_count} {isHi ? 'सवाल' : 'Q'}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {dateStr} &middot; {timeStr}
            </span>
          </div>
        </div>

        {/* Right: countdown badge */}
        <div
          className="flex-shrink-0 text-center px-2.5 py-1.5 rounded-lg"
          style={{ background: urgency.badge }}
        >
          <div
            className="text-xs font-bold whitespace-nowrap"
            style={{ color: urgency.badgeText }}
          >
            {countdown}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Formatting Helpers ─── */

function formatCountdown(isoDate: string, isHi: boolean): string {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms < 0) return isHi ? 'अभी' : 'Now';

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) {
    const mins = Math.max(1, Math.floor(ms / (1000 * 60)));
    return isHi ? `${mins} मि.` : `${mins}m`;
  }
  if (hours < 24) return isHi ? `${hours} घं.` : `${hours}h`;
  if (days === 1) return isHi ? 'कल' : 'Tomorrow';
  return isHi ? `${days} दिन` : `${days}d`;
}

function formatExamDate(isoDate: string, isHi: boolean): string {
  return new Date(isoDate).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function formatExamTime(isoDate: string, isHi: boolean): string {
  return new Date(isoDate).toLocaleTimeString(isHi ? 'hi-IN' : 'en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
