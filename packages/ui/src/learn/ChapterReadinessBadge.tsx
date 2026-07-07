'use client';

/**
 * ChapterReadinessBadge — Phase 3 of "Exam-Ready 360°".
 *
 * Compact pill that sits next to a chapter title in the /learn chapter list.
 * Shows the level icon + 1-2 word label. Uses the subject-readiness map
 * passed from the parent so we don't issue N HTTP requests when a student
 * opens a subject — the parent issues ONE call to /api/v1/subject-readiness
 * via useSubjectReadiness() and looks up by chapter_number.
 *
 * Hides itself when no readiness is found for this chapter (chapter newly
 * added, or API hasn't loaded yet) to avoid empty visual noise.
 */

import { memo } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import type { ChapterReadinessLevel } from '@alfanumrik/lib/useChapterReadiness';

export interface ChapterReadinessBadgeProps {
  level: ChapterReadinessLevel | null | undefined;
}

interface BadgeStyle {
  fg: string;
  bg: string;
  icon: string;
  labelEn: string;
  labelHi: string;
}

// Cosmic-aware semantic tokens (no hardcoded status hex). bg is a soft
// color-mix tint of the same token so the pill adapts across light + cosmic.
const BADGE_STYLES: Record<ChapterReadinessLevel, BadgeStyle> = {
  ready:    { fg: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 12%, var(--surface-1))', icon: '✅', labelEn: 'Ready',    labelHi: 'तैयार' },
  almost:   { fg: 'var(--teal)',  bg: 'color-mix(in srgb, var(--teal) 12%, var(--surface-1))',  icon: '⚡', labelEn: 'Almost',   labelHi: 'लगभग' },
  building: { fg: 'var(--gold)',  bg: 'color-mix(in srgb, var(--gold) 14%, var(--surface-1))',  icon: '🛠', labelEn: 'Building', labelHi: 'बन रहा' },
  not_yet:  { fg: 'var(--red)',   bg: 'color-mix(in srgb, var(--red) 10%, var(--surface-1))',   icon: '🌱', labelEn: 'New',      labelHi: 'नया' },
};

function ChapterReadinessBadgeInner({ level }: ChapterReadinessBadgeProps) {
  const { isHi } = useAuth();

  if (!level) return null;

  const style = BADGE_STYLES[level];
  if (!style) return null;

  return (
    <span
      data-testid={`chapter-readiness-badge-${level}`}
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{
        background: style.bg,
        color: style.fg,
        border: `1px solid color-mix(in srgb, ${style.fg} 25%, transparent)`,
      }}
    >
      <span aria-hidden="true">{style.icon}</span>
      {isHi ? style.labelHi : style.labelEn}
    </span>
  );
}

export const ChapterReadinessBadge = memo(ChapterReadinessBadgeInner);
export default ChapterReadinessBadge;
