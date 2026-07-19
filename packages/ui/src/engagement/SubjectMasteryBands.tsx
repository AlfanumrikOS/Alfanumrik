'use client';

/**
 * SubjectMasteryBands — Per-subject mastery progress bars with color bands.
 */

import React, { memo } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface SubjectMasteryBandsProps {
  subjects: Array<{
    subject: string;
    averageMastery: number;
    topicsTotal: number;
    topicsMastered: number;
  }>;
}

const CHROME = {
  en: { mastered: 'mastered', of: 'of' },
  hi: { mastered: 'पूर्ण', of: 'में से' },
} as const;

const SUBJECT_COLORS: Record<string, string> = {
  math: 'bg-orange-500',
  science: 'bg-green-500',
  sst: 'bg-purple-500',
  english: 'bg-blue-500',
};

const SUBJECT_BG: Record<string, string> = {
  math: 'bg-orange-100 dark:bg-orange-900/30',
  science: 'bg-green-100 dark:bg-green-900/30',
  sst: 'bg-purple-100 dark:bg-purple-900/30',
  english: 'bg-blue-100 dark:bg-blue-900/30',
};

export const SubjectMasteryBands = memo(function SubjectMasteryBands({
  subjects,
}: SubjectMasteryBandsProps) {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;

  if (subjects.length === 0) return null;

  return (
    <div className="space-y-3">
      {subjects.map((s) => (
        <div key={s.subject}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium capitalize text-gray-700 dark:text-gray-300">
              {s.subject}
            </span>
            <span className="text-xs text-gray-500">
              {s.topicsMastered} {chrome.of} {s.topicsTotal} {chrome.mastered}
            </span>
          </div>
          <div
            className={`h-2.5 rounded-full ${SUBJECT_BG[s.subject] || 'bg-gray-200 dark:bg-gray-700'}`}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${SUBJECT_COLORS[s.subject] || 'bg-gray-500'}`}
              style={{ width: `${Math.min(s.averageMastery, 100)}%` }}
            />
          </div>
          <div className="text-right text-xs text-gray-400 mt-0.5">
            {s.averageMastery}%
          </div>
        </div>
      ))}
    </div>
  );
});
