'use client';

/**
 * SubjectHeader — subject name + overall readiness ring for the Alfa OS
 * Subjects hub (ff_subjects_os_v1, Tier 1 / presentation-only).
 *
 * Reuses the existing `useSubjectReadiness` summary (Exam-Ready 360° RPC). It
 * computes NO mastery — `overallReadiness()` only re-buckets engine counts.
 * Readiness is encoded by glyph + numeric % + label, never colour alone
 * (WCAG 1.4.1). Bilingual via isHi.
 *
 * States: loading (skeleton), error (distinct from empty), empty (no signal).
 */

import { MasteryRing, Skeleton } from '@/components/ui';
import { overallReadiness, bucketMeta } from './readiness-map';

interface SubjectHeaderProps {
  subjectName: string;
  subjectIcon?: string;
  subjectColor?: string;
  summary: { ready: number; almost: number; building: number; not_yet: number } | null;
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

export default function SubjectHeader({
  subjectName,
  subjectIcon = '📚',
  subjectColor = 'var(--orange)',
  summary,
  isLoading,
  error,
  isHi,
}: SubjectHeaderProps) {
  if (isLoading && !summary) {
    return (
      <header className="flex items-center gap-4 rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <Skeleton width={64} height={64} rounded="rounded-full" />
        <div className="flex-1">
          <Skeleton width="60%" height={18} className="mb-2" />
          <Skeleton width="40%" height={12} />
        </div>
      </header>
    );
  }

  const { bucket, percent, total } = summary
    ? overallReadiness(summary)
    : { bucket: 'not_yet' as const, percent: 0, total: 0 };
  const meta = bucketMeta(bucket, isHi);

  return (
    <header
      className="flex items-center gap-4 rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <MasteryRing
        value={percent}
        size={64}
        strokeWidth={6}
        color={subjectColor}
      >
        <span className="text-xl" aria-hidden="true">{subjectIcon}</span>
      </MasteryRing>

      <div className="flex-1 min-w-0">
        <h1
          className="text-lg font-bold truncate"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
        >
          {subjectName}
        </h1>
        {error && !summary ? (
          <p className="text-xs mt-0.5" style={{ color: 'var(--orange)' }} role="status">
            {isHi
              ? 'तैयारी की स्थिति अभी लोड नहीं हो पाई।'
              : "Couldn't load readiness right now."}
          </p>
        ) : total === 0 ? (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'पहला अध्याय शुरू करो — तैयारी यहाँ दिखेगी।'
              : 'Start a chapter — readiness shows here.'}
          </p>
        ) : (
          <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <span aria-hidden="true" style={{ color: meta.color }}>{meta.glyph}</span>
            <span>{meta.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
              · {percent}% {isHi ? 'तैयार' : 'ready'}
            </span>
          </p>
        )}
      </div>
    </header>
  );
}
