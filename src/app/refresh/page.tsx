'use client';

/**
 * /refresh — consolidated review surface (replaces /review + /revise).
 *
 * Three stacked sections:
 *   A. Quick Recall      — 5 due SM-2 flashcards
 *   B. Chapter Refresh   — decayed-chapter stack
 *   C. Retention Tests   — pending retention quizzes
 *
 * (Section D "Build Your Own Deck" is added in Phase 3 of the plan.)
 *
 * Each section auto-hides when empty. When ALL three are empty, the page
 * shows a single nudge directing the student to /learn or /quiz.
 *
 * Behind feature flag ff_study_menu_v2. Old /review and /revise routes
 * remain functional until Phase 6 of the rollout. ?tab=flashcards|chapters
 * deep-link param smooth-scrolls to that section on mount.
 *
 * Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { LoadingFoxy, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import QuickRecallSection from '@/components/refresh/QuickRecallSection';
import ChapterRefreshSection from '@/components/refresh/ChapterRefreshSection';
import RetentionTestsSection from '@/components/refresh/RetentionTestsSection';

export default function RefreshPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sectionACount, setSectionACount] = useState<number | null>(null);
  const sectionARef = useRef<HTMLDivElement | null>(null);
  const sectionBRef = useRef<HTMLDivElement | null>(null);

  // Auth + onboarding redirects (same pattern as /review and /revise today).
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && student && !student.onboarding_completed) {
      router.replace('/onboarding');
    }
  }, [isLoading, isLoggedIn, student, router]);

  // Smooth-scroll to deep-linked section on mount.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'flashcards' && sectionARef.current) {
      sectionARef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'chapters' && sectionBRef.current) {
      sectionBRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  if (isLoading || !student) return <LoadingFoxy />;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header
        className="page-header"
        style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="app-container py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              🔁 {isHi ? 'ताज़ा करो' : 'Refresh'}
            </h1>
            <p className="text-xs text-[var(--text-3)] mt-0.5">
              {isHi ? 'जो सीखा है उसे फिर से ताज़ा करो' : "Keep what you've learned fresh"}
            </p>
          </div>
        </div>
      </header>

      <main className="app-container py-5 space-y-6 max-w-2xl mx-auto">
        <SectionErrorBoundary section="Refresh">
          <div ref={sectionARef}>
            <SectionErrorBoundary section="Refresh:QuickRecall">
              <QuickRecallSection onLoaded={setSectionACount} />
            </SectionErrorBoundary>
          </div>

          <div ref={sectionBRef}>
            <SectionErrorBoundary section="Refresh:ChapterRefresh">
              <ChapterRefreshSection />
            </SectionErrorBoundary>
          </div>

          <SectionErrorBoundary section="Refresh:RetentionTests">
            <RetentionTestsSection />
          </SectionErrorBoundary>

          {/* All-empty nudge — only renders when Section A has loaded and
              reports 0 cards. (B + C auto-hide so we don't need their
              counts.) Once Section D ships this falls back to D's tip. */}
          {sectionACount === 0 && (
            <div className="text-center py-10" data-testid="refresh-empty-state">
              <div className="text-5xl mb-3">✨</div>
              <p className="text-sm font-semibold text-[var(--text-2)] mb-1">
                {isHi ? 'अभी कुछ ताज़ा करने को नहीं' : 'Nothing to refresh right now'}
              </p>
              <p className="text-xs text-[var(--text-3)] mb-5">
                {isHi
                  ? 'क्विज़ खेलो — नए कार्ड अपने आप बनेंगे।'
                  : 'Take a quiz — new cards will be created automatically.'}
              </p>
              <button
                onClick={() => router.push('/quiz')}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: 'var(--orange, #E8581C)' }}
              >
                ⚡ {isHi ? 'क्विज़ खेलो' : 'Take a Quiz'}
              </button>
            </div>
          )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
