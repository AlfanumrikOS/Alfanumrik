'use client';

/**
 * ExamBriefingHub — orchestrator for the Alfa OS pre-test BRIEFING hub
 * (ff_test_os_v1, Tier 1 / presentation-only), mounted at the NEW
 * /exam-briefing route. Renders ONLY when the flag resolves ON (the page gates
 * this; OFF → notFound()).
 *
 * Composition over reuse — the sections read the existing client read of
 * exam_configs + exam_chapters (useUpcomingExams) plus the existing
 * subject/chapter readiness readers and the exam-engine pace calculator. No DB
 * schema, no new RPC, no scoring/XP/anti-cheat/exam-timing change. Cosmic-LIGHT
 * + data-role="student" is activated via useCosmicLightSurface while mounted.
 * Bilingual via isHi.
 *
 *   1. UpcomingExamsList → student's active exam_configs (select one to brief)
 *   2. ReadinessBriefing → overall readiness ring + per-chapter readiness chips
 *   3. PredictedScoreCard → DISPLAY-ONLY predicted estimate (labeled, caveated)
 *   4. WeakChaptersFocus → not_yet/building chapters → /learn or /quiz deep-links
 *   5. TimePaceEstimate  → duration / time-per-question from calculateExamConfig
 *   6. StartExamCTA      → primary handoff into the EXISTING exam runtime
 *
 * The per-exam detail sections (2-6) are lazy-loaded (P10) so the first paint
 * (the exam list) stays light. The flag-OFF path never mounts this, so none of
 * this bundle ships there.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useCosmicLightSurface } from '@/lib/use-cosmic-light-surface';
import { Skeleton } from '@/components/ui';
import UpcomingExamsList from './UpcomingExamsList';
import { useUpcomingExams, type UpcomingExam } from './useUpcomingExams';

const sectionLoading = () => <Skeleton height={140} rounded="rounded-2xl" />;
const ReadinessBriefing = dynamic(() => import('./ReadinessBriefing'), {
  ssr: false,
  loading: sectionLoading,
});
const PredictedScoreCard = dynamic(() => import('./PredictedScoreCard'), {
  ssr: false,
  loading: sectionLoading,
});
const WeakChaptersFocus = dynamic(() => import('./WeakChaptersFocus'), {
  ssr: false,
  loading: sectionLoading,
});
const TimePaceEstimate = dynamic(() => import('./TimePaceEstimate'), {
  ssr: false,
  loading: sectionLoading,
});
const StartExamCTA = dynamic(() => import('./StartExamCTA'), {
  ssr: false,
  loading: sectionLoading,
});

interface ExamBriefingHubProps {
  studentId: string | undefined;
  grade: string | undefined; // P5: grades are strings
  isHi: boolean;
}

export default function ExamBriefingHub({ studentId, grade, isHi }: ExamBriefingHubProps) {
  // Activate Cosmic-LIGHT + student palette while mounted; restores on unmount.
  useCosmicLightSurface(true);

  const { exams, isLoading, error } = useUpcomingExams(studentId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select the soonest upcoming exam once data lands (exams are ordered by
  // exam_date asc). Keeps a valid selection if the chosen exam disappears.
  useEffect(() => {
    if (!exams || exams.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && exams.some((e) => e.id === prev)) return prev;
      return exams[0].id;
    });
  }, [exams]);

  const selected: UpcomingExam | null =
    (exams && selectedId && exams.find((e) => e.id === selectedId)) || null;

  return (
    <main
      className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5"
      style={{ background: 'var(--bg, transparent)' }}
    >
      <header>
        <h1
          className="text-lg font-bold"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'परीक्षा ब्रीफ़िंग' : 'Exam Briefing'}
        </h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'परीक्षा से पहले अपनी तैयारी देखो — यह तुम्हारा प्लान है, गारंटी नहीं।'
            : 'Check your readiness before the test — a plan, not a guarantee.'}
        </p>
      </header>

      <UpcomingExamsList
        exams={exams}
        isLoading={isLoading}
        error={error}
        selectedId={selectedId}
        onSelect={setSelectedId}
        isHi={isHi}
      />

      {/* Per-exam briefing sections render only once an exam is selected. */}
      {selected && (
        <>
          <ReadinessBriefing exam={selected} isHi={isHi} />
          <PredictedScoreCard exam={selected} isHi={isHi} />
          <WeakChaptersFocus exam={selected} isHi={isHi} />
          <TimePaceEstimate exam={selected} grade={grade} isHi={isHi} />
          <StartExamCTA exam={selected} isHi={isHi} />
        </>
      )}
    </main>
  );
}
