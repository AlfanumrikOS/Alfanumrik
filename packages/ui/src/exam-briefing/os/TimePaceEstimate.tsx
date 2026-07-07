'use client';

/**
 * TimePaceEstimate — a per-question pace estimate for the selected exam in the
 * Alfa OS briefing hub (ff_test_os_v1, Tier 1 / presentation-only).
 *
 * Reads the EXISTING exam-engine cognitive timing model (getExamPresets +
 * calculateExamConfig) to derive a suggested questionCount / duration /
 * avg-seconds-per-question for the student's grade + subject. This is READ/CALL
 * only — no exam-timing change (P-invariant exam timer untouched); the engine
 * functions are called exactly as the live exam setup calls them. We use the
 * "full_exam" preset because it is the closest analogue to a real graded test.
 *
 * The card ALSO shows the student's own configured duration from their
 * exam_configs row (duration_minutes) so the two framings sit side by side.
 *
 * Numbers are encoded number + glyph (never colour alone — A11y). There is no
 * async fetch — all inputs are already loaded — so there is no loading/error
 * state; an unmapped grade still yields a valid estimate via engine defaults.
 */

import { Card } from '@alfanumrik/ui/ui';
import { getExamPresets, calculateExamConfig } from '@alfanumrik/lib/exam-engine';
import type { UpcomingExam } from './useUpcomingExams';

interface TimePaceEstimateProps {
  exam: UpcomingExam;
  grade: string | undefined; // P5: grades are strings
  isHi: boolean;
}

export default function TimePaceEstimate({ exam, grade, isHi }: TimePaceEstimateProps) {
  // P5: grade is a string. Fall back to '9' (engine also defaults sensibly).
  const g = grade && grade.length > 0 ? grade : '9';

  // Closest analogue to a real graded test. getExamPresets always returns the
  // full set; we pick 'full_exam' (falls back to the last preset defensively).
  const presets = getExamPresets(g, exam.subject);
  const preset = presets.find((p) => p.id === 'full_exam') ?? presets[presets.length - 1];
  const config = calculateExamConfig(preset, exam.subject, g);

  const avgSec = config.avgSecondsPerQuestion;
  const avgMin = Math.floor(avgSec / 60);
  const avgRemSec = avgSec % 60;
  const paceLabel =
    avgMin > 0
      ? isHi
        ? `${avgMin} मि ${avgRemSec} से/सवाल`
        : `${avgMin}m ${avgRemSec}s / question`
      : isHi
        ? `${avgSec} से/सवाल`
        : `${avgSec}s / question`;

  return (
    <section aria-label={isHi ? 'समय और गति' : 'Time & pace'}>
      <h2
        className="text-sm font-bold uppercase tracking-wider mb-3"
        style={{ color: 'var(--text-3)' }}
      >
        {isHi ? 'समय और गति' : 'Time & pace'}
      </h2>
      <Card accent="#0891B2">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat
            glyph="⏱"
            value={`${exam.duration_minutes}`}
            unit={isHi ? 'मिनट' : 'min'}
            label={isHi ? 'तुम्हारी अवधि' : 'Your duration'}
          />
          <Stat
            glyph="◷"
            value={paceLabel}
            label={isHi ? 'सुझाई गति' : 'Suggested pace'}
            wide
          />
          <Stat
            glyph="❓"
            value={`${config.questionCount}`}
            unit={isHi ? 'सवाल' : 'qs'}
            label={isHi ? 'सुझाए सवाल' : 'Suggested Qs'}
          />
        </div>
        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'सुझाई गई गति तुम्हारी कक्षा और विषय के लिए ब्लूम-आधारित समय मॉडल से है — यह एक मार्गदर्शक है, सख़्त नियम नहीं।'
            : 'The suggested pace comes from a Bloom-based timing model for your grade and subject — a guide, not a strict rule.'}
        </p>
      </Card>
    </section>
  );
}

function Stat({
  glyph,
  value,
  unit,
  label,
  wide,
}: {
  glyph: string;
  value: string;
  unit?: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span aria-hidden="true" className="text-base">{glyph}</span>
      <span
        className={`font-bold ${wide ? 'text-xs' : 'text-lg'}`}
        style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)' }}
      >
        {value}
        {unit && <span className="text-[11px] font-semibold ml-0.5" style={{ color: 'var(--text-3)' }}>{unit}</span>}
      </span>
      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{label}</span>
    </div>
  );
}
