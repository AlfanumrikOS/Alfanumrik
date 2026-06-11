'use client';

/**
 * StartExamCTA — the primary handoff out of the Alfa OS briefing hub
 * (ff_test_os_v1, Tier 1 / presentation-only) into the EXISTING exam runtime.
 *
 * No engine change. The primary CTA deep-links to the existing exam-mode quiz
 * runtime for this exam_configs row — `/quiz?mode=exam&exam_id=<id>` — which is
 * exactly the handoff the live /exams page uses (src/app/exams/page.tsx:559).
 * A secondary link points at the existing CBSE mock-paper catalog (/exams),
 * from which a paper opens the existing /exams/mock/[paperId] runner. Both are
 * plain navigations into surfaces that already exist; the scoring/XP/anti-cheat
 * /exam-timing pipelines are never touched.
 */

import type { UpcomingExam } from './useUpcomingExams';

interface StartExamCTAProps {
  exam: UpcomingExam;
  isHi: boolean;
}

export default function StartExamCTA({ exam, isHi }: StartExamCTAProps) {
  // EXISTING handoff — verified in src/app/exams/page.tsx:559.
  const examModeHref = `/quiz?mode=exam&exam_id=${encodeURIComponent(exam.id)}`;

  return (
    <section aria-label={isHi ? 'परीक्षा शुरू करो' : 'Start exam'} className="flex flex-col gap-2">
      <a
        href={examModeHref}
        className="inline-flex items-center justify-center gap-2 rounded-2xl text-base font-bold transition-transform duration-150 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          minHeight: 56,
          background: 'var(--orange, #E8581C)',
          color: '#fff',
          boxShadow: 'var(--shadow-md)',
        }}
        aria-label={
          isHi
            ? `${exam.exam_name} परीक्षा मोड में शुरू करो`
            : `Start ${exam.exam_name} in exam mode`
        }
      >
        <span aria-hidden="true">▶</span>
        {isHi ? 'परीक्षा मोड शुरू करो' : 'Start exam mode'}
      </a>

      <a
        href="/exams"
        className="inline-flex items-center justify-center gap-1.5 rounded-2xl text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          minHeight: 48,
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          color: 'var(--text-1)',
        }}
        aria-label={isHi ? 'मॉक पेपर देखो' : 'Browse mock papers'}
      >
        📄 {isHi ? 'मॉक पेपर देखो' : 'Browse mock papers'}
        <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}
