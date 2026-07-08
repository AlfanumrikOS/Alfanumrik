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
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import { Button, IconButton, EmptyState } from '@alfanumrik/ui/ui/primitives';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import QuickRecallSection from '@alfanumrik/ui/refresh/QuickRecallSection';
import ChapterRefreshSection from '@alfanumrik/ui/refresh/ChapterRefreshSection';
import RetentionTestsSection from '@alfanumrik/ui/refresh/RetentionTestsSection';
import BuildYourOwnDeckSection from '@alfanumrik/ui/refresh/BuildYourOwnDeckSection';

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
        style={{
          background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="app-container py-3 flex items-center gap-3">
          <IconButton
            variant="ghost"
            size="sm"
            label={isHi ? 'वापस डैशबोर्ड' : 'Back to dashboard'}
            icon={<span aria-hidden="true">←</span>}
            onClick={() => router.push('/dashboard')}
          />
          <div>
            <h1 className="text-fluid-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              🔁 {isHi ? 'ताज़ा करो' : 'Refresh'}
            </h1>
            <p className="mt-0.5 text-fluid-xs text-muted-foreground">
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

          <SectionErrorBoundary section="Refresh:BuildYourOwnDeck">
            <BuildYourOwnDeckSection
              onCardCreated={() => {
                // Re-fetch Section A so the new card count refreshes.
                // Cheap hack: bump a key on the QuickRecallSection. Easier
                // workaround until SWR is wired: do a full page refresh.
                window.location.reload();
              }}
            />
          </SectionErrorBoundary>

          {/* All-empty nudge — only renders when Section A has loaded and
              reports 0 cards. (B + C auto-hide so we don't need their
              counts.) Supportive "all caught up" framing, no harsh copy. */}
          {sectionACount === 0 && (
            <div data-testid="refresh-empty-state">
              <EmptyState
                icon={<span>✨</span>}
                title={isHi ? 'अभी सब कुछ ताज़ा है — शाबाश!' : "You're all caught up — nice work!"}
                description={
                  isHi
                    ? 'अभी दोहराने को कुछ नहीं। क्विज़ खेलो — या नीचे अपना कार्ड जोड़ो।'
                    : 'Nothing to refresh right now. Take a quiz — or add your own card below.'
                }
                action={
                  <Button
                    variant="primary"
                    onClick={() => router.push('/quiz')}
                    leadingIcon={<span>⚡</span>}
                  >
                    {isHi ? 'क्विज़ खेलो' : 'Take a Quiz'}
                  </Button>
                }
              />
            </div>
          )}
        </SectionErrorBoundary>
      </main>

      
    </div>
  );
}
