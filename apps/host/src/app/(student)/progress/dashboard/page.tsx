'use client';

/**
 * Student Engagement Dashboard — visible progress tracking surface.
 *
 * Fetches engagement snapshot via SWR (60s revalidation) and renders:
 * XP/level ring, streak counter, per-subject mastery, recent quiz scores.
 *
 * Feature-flagged: ff_engagement_dashboard_v1 (default OFF).
 */

import React from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import type { EngagementSnapshot } from '@/app/api/student/engagement/route';

const XPProgressRing = dynamic(
  () => import('@alfanumrik/ui/engagement/XPProgressRing').then((m) => m.XPProgressRing),
  { ssr: false }
);
const StreakFlame = dynamic(
  () => import('@alfanumrik/ui/engagement/StreakFlame').then((m) => m.StreakFlame),
  { ssr: false }
);
const MasteryRadar = dynamic(
  () => import('@alfanumrik/ui/engagement/MasteryRadar').then((m) => m.MasteryRadar),
  { ssr: false }
);
const SubjectMasteryBands = dynamic(
  () => import('@alfanumrik/ui/engagement/SubjectMasteryBands').then((m) => m.SubjectMasteryBands),
  { ssr: false }
);

const CHROME = {
  en: {
    title: 'My Progress',
    xp: 'XP & Level',
    streak: 'Study Streak',
    mastery: 'Subject Mastery',
    recentQuizzes: 'Recent Quizzes',
    noData: 'Start learning to see your progress here!',
    loading: 'Loading your progress...',
    score: 'Score',
    date: 'Date',
  },
  hi: {
    title: 'मेरी प्रगति',
    xp: 'XP और स्तर',
    streak: 'अध्ययन स्ट्रीक',
    mastery: 'विषय दक्षता',
    recentQuizzes: 'हाल की क्विज़',
    noData: 'सीखना शुरू करें और अपनी प्रगति यहाँ देखें!',
    loading: 'आपकी प्रगति लोड हो रही है...',
    score: 'स्कोर',
    date: 'तारीख',
  },
} as const;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function EngagementDashboardPage() {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;

  const { data, isLoading } = useSWR<EngagementSnapshot>(
    '/api/student/engagement',
    fetcher,
    { refreshInterval: 60000 }
  );

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent mx-auto mb-3" />
          <p className="text-gray-500">{chrome.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
        {chrome.title}
      </h1>

      {/* XP & Streak row — stacks on narrow mobile, side-by-side on wider */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {chrome.xp}
          </h2>
          <XPProgressRing
            xpInLevel={data.xp.xpInLevel}
            xpToNext={data.xp.xpToNext}
            level={data.xp.level}
            levelName={data.xp.levelName}
          />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {chrome.streak}
          </h2>
          <StreakFlame
            current={data.streak.current}
            best={data.streak.best}
          />
        </div>
      </div>

      {/* Subject Mastery */}
      {data.subjectMastery.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
            {chrome.mastery}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <MasteryRadar subjects={data.subjectMastery} />
            <SubjectMasteryBands subjects={data.subjectMastery} />
          </div>
        </div>
      )}

      {/* Recent Quizzes */}
      {data.recentQuizzes.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {chrome.recentQuizzes}
          </h2>
          <div className="space-y-2">
            {data.recentQuizzes.slice(0, 10).map((q, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm capitalize text-gray-700 dark:text-gray-300">
                    {q.subject}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(q.date).toLocaleDateString()}
                  </span>
                </div>
                <span
                  className={`text-sm font-medium ${
                    q.score >= 80
                      ? 'text-green-600'
                      : q.score >= 50
                        ? 'text-yellow-600'
                        : 'text-red-500'
                  }`}
                >
                  {q.score}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {data.subjectMastery.length === 0 && data.recentQuizzes.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">{chrome.noData}</p>
        </div>
      )}
    </div>
  );
}
