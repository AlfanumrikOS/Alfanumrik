'use client';

/**
 * TodaysMission — the PRIMARY hero of the Alfa OS dashboard (ff_student_os_v1).
 *
 * Decision-first design: this is the single dominant CTA on the page. It wraps
 * the existing <DailyRhythmQueue> (which fetches /api/v2/today via /api/rhythm/
 * today and is itself server-gated by ff_pedagogy_v2_daily_rhythm). When the
 * rhythm queue has nothing to render (flag off / no queue), this card falls
 * back to a "Begin today's lesson" CTA pointing at the student's next topic so
 * the hero is never empty.
 *
 * No engine logic here — the rhythm queue owns its own data + CTAs. This only
 * supplies the editorial chrome + fallback. Bilingual via isHi.
 */

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { CurriculumTopic } from '@/lib/types';

// DailyRhythmQueue is below-the-engine and pulls KaTeX-free but still
// non-trivial markup; lazy-load it so the hero shell paints first (P10).
const DailyRhythmQueue = dynamic(
  () => import('@/components/dashboard/sections/DailyRhythmQueue'),
  { ssr: false, loading: () => null },
);

interface TodaysMissionProps {
  isHi: boolean;
  studentName: string;
  grade: string | null | undefined;
  subjectCode: string;
  todaysTopic: CurriculumTopic | undefined;
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function TodaysMission({
  isHi,
  studentName,
  grade,
  subjectCode,
  todaysTopic,
}: TodaysMissionProps) {
  const router = useRouter();
  const firstName = studentName.split(' ')[0] || studentName;

  const beginLesson = () => {
    if (todaysTopic) {
      router.push(`/learn/${subjectCode}/${todaysTopic.chapter_number ?? 1}`);
    } else {
      router.push('/learn');
    }
  };

  return (
    <section
      className="os-mission rounded-3xl p-5 md:p-6 relative overflow-hidden"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
      }}
      aria-label={isHi ? 'आज का मिशन' : "Today's mission"}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-[0.14em] mb-1.5"
        style={{ color: 'var(--orange, #E8581C)' }}
      >
        <span aria-hidden="true" className="streak-flame mr-1.5">●</span>
        {isHi ? 'आज का मिशन' : "Today's mission"}
        {grade && (
          <>
            {' · '}
            {isHi ? `कक्षा ${grade}` : `Class ${grade}`}
          </>
        )}
      </p>

      <h1
        className="text-xl md:text-2xl font-extrabold leading-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
      >
        {todaysTopic?.title
          ? todaysTopic.title
          : isHi
            ? `चलो शुरू करें, ${firstName}`
            : `Let's get going, ${firstName}`}
      </h1>

      {/* Primary surface: the existing rhythm queue, rendered as the mission
          body. It self-suppresses when there's no queue. */}
      <div className="mt-4">
        <DailyRhythmQueue />
      </div>

      {/* Always-present primary CTA — the single dominant action. */}
      <button
        type="button"
        onClick={beginLesson}
        className="mt-2 inline-flex items-center justify-center gap-2 w-full md:w-auto px-6 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          background: 'linear-gradient(135deg, var(--orange, #E8581C), #C9831A)',
          minHeight: 48,
        }}
      >
        <span>
          {todaysTopic
            ? isHi
              ? `पाठ शुरू करो · ${capitalize(subjectCode)}`
              : `Begin lesson · ${capitalize(subjectCode)}`
            : isHi
              ? 'आज का पाठ चुनो'
              : "Pick today's lesson"}
        </span>
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
