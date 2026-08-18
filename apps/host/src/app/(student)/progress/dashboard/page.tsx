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

// Canonical XP ring (packages/ui/src/xp/XPProgressRing). It derives level /
// level-name / XP-in-level from the SAME @alfanumrik/lib/xp-config helpers
// this page's API route already uses, so every displayed number is identical
// to the server-computed one (P1/P2) — see the prop mapping at the call site.
const XPProgressRing = dynamic(
  () => import('@alfanumrik/ui/xp/XPProgressRing'),
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
    errorTitle: "Couldn't load your progress",
    errorBody: 'Something went wrong. Your data is safe — please try again.',
    retry: 'Retry',
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
    errorTitle: 'प्रगति लोड नहीं हो सकी',
    errorBody: 'कुछ गलत हो गया। आपका डेटा सुरक्षित है — फिर से कोशिश करें।',
    retry: 'फिर से कोशिश करो',
  },
} as const;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function EngagementDashboardPage() {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;

  const { data, error, isLoading, mutate } = useSWR<EngagementSnapshot>(
    '/api/student/engagement',
    fetcher,
    { refreshInterval: 60000 }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent mx-auto mb-3" />
          <p style={{ color: 'var(--text-3)' }}>{chrome.loading}</p>
        </div>
      </div>
    );
  }

  // Fetch failure — was previously indistinguishable from `isLoading` (both
  // took the loading branch), so a failed request spun the loader forever
  // instead of ever surfacing an honest error state.
  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-6">
        <div className="text-center max-w-sm" role="alert">
          <span className="text-4xl block mb-3" role="img" aria-label="Fox">🦊</span>
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
            {chrome.errorTitle}
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
            {chrome.errorBody}
          </p>
          <button
            onClick={() => mutate()}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-on-accent"
            style={{ background: 'var(--accent-warm-strong)' }}
          >
            🔄 {chrome.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>
        {chrome.title}
      </h1>

      {/* XP & Streak row — stacks on narrow mobile, side-by-side on wider */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>
            {chrome.xp}
          </h2>
          {/* data.xp.total is students.total_xp verbatim. The ring recomputes
              level = calculateLevel(total) and current/needed = xpToNextLevel(total),
              which is exactly how /api/student/engagement built data.xp.level and
              data.xp.xpInLevel — same helpers, same inputs, same numbers. It also
              localizes the level name (P7), which the previous ring did not. */}
          <XPProgressRing totalXp={data.xp.total} size="lg" isHi={isHi} />
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>
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
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-3)' }}>
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
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>
            {chrome.recentQuizzes}
          </h2>
          <div className="space-y-2">
            {data.recentQuizzes.slice(0, 10).map((q, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between py-1.5 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm capitalize" style={{ color: 'var(--text-2)' }}>
                    {q.subject}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
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
        <div className="text-center py-12" style={{ color: 'var(--text-3)' }}>
          <p className="text-lg">{chrome.noData}</p>
        </div>
      )}
    </div>
  );
}
