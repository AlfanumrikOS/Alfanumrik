'use client';

/**
 * PredictedScoreCard — a DISPLAY-ONLY predicted-score ESTIMATE for the selected
 * exam in the Alfa OS briefing hub (ff_test_os_v1, Tier 1 / presentation-only).
 *
 * The number comes from getPredictedScoreEstimate — a verbatim COPY of the
 * /exams page's getPredictedScore weighted-mastery formula (see
 * briefing-helpers.ts for provenance). It is NOT a scoring/XP/anti-cheat change
 * (P1/P2/P3 untouched) and it must NEVER be presented as a guaranteed or actual
 * score. The card is explicitly labeled "Predicted (estimate)" / "अनुमानित"
 * with a confidence caveat so a student can never mistake it for a result.
 *
 * The estimate is encoded as number + glyph (◷ = estimate marker), never colour
 * alone (A11y).
 *
 * States: empty (no chapters with weightage/mastery to estimate from →
 * informational, NOT an error). There is no async fetch here — the estimate is
 * computed purely from the already-loaded exam's chapters — so there is no
 * loading or error state to render for this section.
 */

import { Card } from '@/components/ui';
import {
  getPredictedScoreEstimate,
  getPredictionConfidence,
  type PredictionConfidence,
} from './briefing-helpers';
import type { UpcomingExam } from './useUpcomingExams';

interface PredictedScoreCardProps {
  exam: UpcomingExam;
  isHi: boolean;
}

const CONFIDENCE_META: Record<
  PredictionConfidence,
  { en: string; hi: string; glyph: string }
> = {
  good:     { en: 'Good confidence',     hi: 'अच्छा भरोसा',  glyph: '●●●' },
  moderate: { en: 'Moderate confidence', hi: 'मध्यम भरोसा',  glyph: '●●○' },
  low:      { en: 'Low confidence',      hi: 'कम भरोसा',     glyph: '●○○' },
};

export default function PredictedScoreCard({ exam, isHi }: PredictedScoreCardProps) {
  const chapters = exam.exam_chapters ?? [];
  const hasEvidence = chapters.some((c) => c.weightage_marks > 0 || c.mastery_percent > 0);

  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'अनुमानित स्कोर' : 'Predicted score'}
    </h2>
  );

  if (!hasEvidence) {
    return (
      <section aria-label={isHi ? 'अनुमानित स्कोर' : 'Predicted score'}>
        {heading}
        {/* EMPTY — informational (not an error): muted text + dashed border. */}
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'अभी अनुमान लगाने के लिए पर्याप्त डेटा नहीं — कुछ अध्याय अभ्यास करो तो अनुमान दिखेगा।'
            : 'Not enough data to estimate yet — practise a few chapters and an estimate will appear.'}
        </div>
      </section>
    );
  }

  const predicted = getPredictedScoreEstimate(chapters, exam.total_marks);
  const confidence = getPredictionConfidence(chapters);
  const conf = CONFIDENCE_META[confidence];
  const pct = exam.total_marks > 0 ? Math.round((predicted / exam.total_marks) * 100) : 0;

  return (
    <section aria-label={isHi ? 'अनुमानित स्कोर' : 'Predicted score'}>
      {heading}
      <Card accent="#7C3AED">
        {/* Estimate label — UNMISTAKABLE: this is a prediction, not a result. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold mb-3"
          style={{ background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.25)', color: '#7C3AED' }}
        >
          <span aria-hidden="true">◷</span>
          {isHi ? 'अनुमानित (अनुमान)' : 'Predicted (estimate)'}
        </span>

        <div className="flex items-end gap-2">
          <span
            className="text-4xl font-bold leading-none"
            style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)' }}
          >
            {predicted}
          </span>
          <span className="text-base font-semibold mb-0.5" style={{ color: 'var(--text-3)' }}>
            / {exam.total_marks}
          </span>
          <span
            className="text-xs font-semibold mb-1 ml-1"
            style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}
          >
            (≈{pct}%)
          </span>
        </div>

        {/* sr-only restatement so assistive tech hears "estimate" with the number. */}
        <span className="sr-only">
          {isHi
            ? `अनुमानित स्कोर लगभग ${predicted}, कुल ${exam.total_marks} में से। यह सिर्फ़ एक अनुमान है, गारंटी नहीं।`
            : `Predicted score about ${predicted} out of ${exam.total_marks}. This is only an estimate, not a guarantee.`}
        </span>

        {/* Confidence caveat — number + glyph, never colour alone. */}
        <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <span aria-hidden="true" style={{ letterSpacing: '0.05em' }}>{conf.glyph}</span>
          <span>{isHi ? conf.hi : conf.en}</span>
        </p>

        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'यह अनुमान तुम्हारी अध्याय-वार महारत और अंक-भार पर आधारित है। यह असली अंक नहीं — सिर्फ़ एक मार्गदर्शक है जो अभ्यास से बेहतर होता है।'
            : 'This estimate is based on your per-chapter mastery and the exam’s weightage. It is not your actual marks — just a guide that improves as you practise.'}
        </p>
      </Card>
    </section>
  );
}
