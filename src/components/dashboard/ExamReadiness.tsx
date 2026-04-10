'use client';

import { useRouter } from 'next/navigation';
import { MasteryRing, Button } from '@/components/ui';
import { calculateBoardExamScore } from '@/lib/cognitive-engine';

/**
 * ExamReadiness — Compact board exam prediction card.
 * Shows predicted CBSE grade (A1-D) based on quiz accuracy.
 * Requires >= 10 quizzes for meaningful prediction.
 * Assessment owns the scoring formula (calculateBoardExamScore).
 */

interface ExamReadinessProps {
  accuracy: number;   // 0-100, derived from correct/total ratio
  totalQuizzes: number;
  isHi: boolean;
  grade: string;      // student grade "6"-"12"
}

const MIN_QUIZZES = 10;

/** Map board exam grade to ring color */
function gradeColor(grade: string): string {
  switch (grade) {
    case 'A1':
    case 'A2':
      return 'var(--green)';
    case 'B1':
      return '#3B82F6'; // blue-500
    case 'B2':
    case 'C1':
      return 'var(--orange)';
    default:
      return '#DC2626'; // red
  }
}

export default function ExamReadiness({ accuracy, totalQuizzes, isHi, grade }: ExamReadinessProps) {
  const router = useRouter();
  const hasEnoughData = totalQuizzes >= MIN_QUIZZES;

  // Not enough data state
  if (!hasEnoughData) {
    return (
      <div
        className="w-full rounded-2xl p-4 text-center"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
        }}
      >
        <div className="text-sm text-[var(--text-3)]">
          {isHi
            ? `अपनी परीक्षा तैयारी देखने के लिए ${MIN_QUIZZES - totalQuizzes} और क्विज़ दो`
            : `Take ${MIN_QUIZZES - totalQuizzes} more quiz${MIN_QUIZZES - totalQuizzes !== 1 ? 'zes' : ''} to see your exam readiness`}
        </div>
      </div>
    );
  }

  const examScore = calculateBoardExamScore(
    Math.round((accuracy / 100) * 100), // correct out of 100 baseline
    100
  );
  const color = gradeColor(examScore.grade);

  return (
    <div
      className="w-full rounded-2xl p-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <MasteryRing value={accuracy} size={52} strokeWidth={4} color={color}>
          <span className="text-xs font-bold" style={{ color, fontFamily: 'var(--font-display)' }}>
            {examScore.grade}
          </span>
        </MasteryRing>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'परीक्षा तैयारी' : 'Exam Readiness'}
          </div>
          <div className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-2">
            {isHi ? examScore.messageHi : examScore.message}
          </div>
        </div>
      </div>

      {/* CTA for weaker students (B2 and below) */}
      {['B2', 'C1', 'D'].includes(examScore.grade) && (
        <Button
          variant="soft"
          size="sm"
          color={color}
          fullWidth
          onClick={() => router.push('/learn')}
        >
          {isHi ? 'कमज़ोर topics अभ्यास करो' : 'Practice weak topics'}
        </Button>
      )}
    </div>
  );
}
