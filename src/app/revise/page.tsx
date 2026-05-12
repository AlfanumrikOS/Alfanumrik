'use client';

/**
 * /revise — the first-class destination for decayed-topic revisits.
 *
 * Phase 4 of ADR-001 (The Learner Loop). The Loop's resolver dispatches
 * revise_decayed_topic actions here; the QuizResults Re-read CTA
 * dispatches here too. The page renders:
 *
 *   1. An optional "from quiz" header card (when ?from=quiz with a
 *      subject + chapter pair) deep-linking the student back to the
 *      chapter they just got wrong in Read mode. This works even when
 *      the chapter is NOT in the decayed stack (the student just got it
 *      wrong; it's not necessarily decayed-by-time, but they want a
 *      re-read).
 *
 *   2. The decayed-topic stack — every chapter where mastery >=
 *      REVISE_MIN_MASTERY (0.6) AND last-touched > the retention window
 *      for that mastery. Sorted most-stale-first. Each card shows the
 *      recommended modality button (read / explainer / worked-example).
 *
 *   3. Empty state when the resolver returns no decayed topics —
 *      a celebratory "you're caught up on revisions" card with a CTA
 *      back to /learn for the curious-browse case.
 *
 * Gating: ff_revise_route_v1. When OFF, the page redirects to /dashboard
 * (the resolver isn't dispatching here yet, so a hit is from a stale
 * link or someone typing the URL directly).
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Card, LoadingFoxy, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

interface ReviseStackItem {
  subjectCode: string;
  chapterNumber: number;
  mastery: number;
  daysSinceLastTouch: number;
  recommendedModality: 'read' | 'explainer' | 'worked-example';
  url: string;
}

interface ReviseStackResponse {
  schemaVersion: 1;
  resolvedAt: string;
  items: ReviseStackItem[];
}

const MODALITY_LABELS: Record<
  ReviseStackItem['recommendedModality'],
  { en: string; hi: string; icon: string; tint: string }
> = {
  'read': {
    en: 'Read the chapter',
    hi: 'अध्याय पढ़ो',
    icon: '📖',
    tint: '#6366F1',
  },
  'explainer': {
    en: 'See an explainer',
    hi: 'समझाओ',
    icon: '💡',
    tint: '#D97706',
  },
  'worked-example': {
    en: 'Walk through a worked example',
    hi: 'हल किया उदाहरण देखो',
    icon: '✏️',
    tint: '#16A34A',
  },
};

const SUBJECT_HI: Record<string, string> = {
  math: 'गणित',
  mathematics: 'गणित',
  science: 'विज्ञान',
  physics: 'भौतिकी',
  chemistry: 'रसायन',
  biology: 'जीव विज्ञान',
  english: 'अंग्रेज़ी',
  hindi: 'हिंदी',
  history: 'इतिहास',
  geography: 'भूगोल',
  civics: 'नागरिक शास्त्र',
};

function subjectLabel(code: string, isHi: boolean): string {
  if (isHi && SUBJECT_HI[code.toLowerCase()]) return SUBJECT_HI[code.toLowerCase()];
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export default function RevisePage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromQuizSubject = searchParams.get('subject');
  const fromQuizChapter = searchParams.get('chapter');
  const fromSource = searchParams.get('from');
  const hasDeepLink =
    fromSource === 'quiz' &&
    typeof fromQuizSubject === 'string' &&
    fromQuizSubject.length > 0 &&
    typeof fromQuizChapter === 'string' &&
    /^\d{1,3}$/.test(fromQuizChapter);

  const [items, setItems] = useState<ReviseStackItem[] | null>(null);
  const [routeAvailable, setRouteAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/learner/revise-stack', {
          credentials: 'same-origin',
        });
        if (res.status === 404) {
          if (cancelled) return;
          // Differentiate "flag off → redirect" from "no decayed topics".
          // Body contains { error: 'not_found' } for flag-off (and a few
          // other codes); a 404 with body.error in
          // ['no_decayed_topics','no_student_profile'] means the route IS
          // enabled but the student just has nothing to revise.
          const body = await res.json().catch(() => ({} as { error?: string }));
          if (body.error === 'not_found') {
            // Flag off — redirect to dashboard (the page shouldn't be
            // reachable when the resolver isn't dispatching here).
            setRouteAvailable(false);
            router.replace('/dashboard');
            return;
          }
          setRouteAvailable(true);
          setItems([]);
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setRouteAvailable(true);
            setItems([]);
          }
          return;
        }
        const data: ReviseStackResponse = await res.json();
        if (!cancelled) {
          setRouteAvailable(true);
          setItems(data.items);
        }
      } catch {
        if (!cancelled) {
          setRouteAvailable(true);
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [student, router]);

  if (isLoading || !student || routeAvailable === false) return <LoadingFoxy />;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header
        className="page-header"
        style={{
          background: 'rgba(251,248,244,0.88)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="app-container py-3">
          <h1
            className="text-lg font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            🔁 {isHi ? 'पुनरावलोकन' : 'Revise'}
          </h1>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {isHi
              ? 'जो सीखा है उसे फिर से ताज़ा करो'
              : "Topics worth a second look — keep what you've learned fresh"}
          </p>
        </div>
      </header>

      <main className="app-container py-5 space-y-4">
        <SectionErrorBoundary section="Revise">
          {/* Deep-link from quiz */}
          {hasDeepLink && (
            <Card accent="var(--orange, #E8581C)" className="!p-4" data-testid="revise-from-quiz-card">
              <p
                className="text-[11px] font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--text-3)' }}
              >
                {isHi ? 'क्विज़ से' : 'From your quiz'}
              </p>
              <p className="font-semibold text-sm md:text-base">
                {subjectLabel(fromQuizSubject as string, isHi)} ·{' '}
                {isHi
                  ? `अध्याय ${fromQuizChapter}`
                  : `Chapter ${fromQuizChapter}`}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-1">
                {isHi
                  ? 'जो सवाल गलत हुए, उनका जवाब इस अध्याय में है'
                  : 'The wrong answers from your quiz live in this chapter'}
              </p>
              <button
                onClick={() =>
                  router.push(
                    `/learn/${encodeURIComponent(fromQuizSubject as string)}/${fromQuizChapter}?mode=read&from=revise`,
                  )
                }
                className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
                style={{ background: 'var(--orange, #E8581C)' }}
                data-testid="revise-from-quiz-cta"
              >
                📖 {isHi ? 'अध्याय दोबारा पढ़ो' : 'Re-read this chapter'} →
              </button>
            </Card>
          )}

          {/* Stack header */}
          {items && items.length > 0 && (
            <div className="px-1">
              <p
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}
              >
                {isHi ? 'इन्हें फिर से देखो' : 'Topics worth a second look'}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {isHi
                  ? `${items.length} अध्याय — कुछ समय पहले मज़बूत थे, अब थोड़ा फीका`
                  : `${items.length} chapter${items.length === 1 ? '' : 's'} — strong before, fading a little`}
              </p>
            </div>
          )}

          {/* Stack */}
          {loading ? (
            <LoadingFoxy />
          ) : items && items.length > 0 ? (
            items.map((item) => {
              const m = MODALITY_LABELS[item.recommendedModality];
              return (
                <Card
                  key={`${item.subjectCode}-${item.chapterNumber}`}
                  className="!p-4"
                  data-testid="revise-stack-card"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: `${m.tint}15`, color: m.tint }}
                    >
                      {m.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm md:text-base truncate">
                        {subjectLabel(item.subjectCode, isHi)} ·{' '}
                        {isHi
                          ? `अध्याय ${item.chapterNumber}`
                          : `Chapter ${item.chapterNumber}`}
                      </p>
                      <p className="text-xs text-[var(--text-3)] mt-0.5">
                        {isHi
                          ? `${item.daysSinceLastTouch} दिन — पिछली मास्ट्री ${Math.round(item.mastery * 100)}%`
                          : `${item.daysSinceLastTouch} days · was at ${Math.round(item.mastery * 100)}% mastery`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(item.url)}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
                    style={{ background: m.tint }}
                    data-testid="revise-stack-card-cta"
                  >
                    {m.icon} {isHi ? m.hi : m.en} →
                  </button>
                </Card>
              );
            })
          ) : (
            // Empty state — nothing decayed. Celebratory + redirect-to-learn CTA.
            !hasDeepLink && (
              <Card className="!p-6 text-center" data-testid="revise-empty-state">
                <div className="text-5xl mb-3">🎉</div>
                <p
                  className="font-bold text-base mb-1"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {isHi
                    ? 'सब कुछ ताज़ा है!'
                    : "You're all caught up!"}
                </p>
                <p className="text-sm text-[var(--text-3)] mb-4">
                  {isHi
                    ? 'अभी कोई पुराना अध्याय फीका नहीं हुआ है। नया कुछ सीखें?'
                    : 'No decayed chapters to revisit right now. Want to learn something new?'}
                </p>
                <button
                  onClick={() => router.push('/learn')}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
                  style={{ background: 'var(--orange, #E8581C)' }}
                >
                  📚 {isHi ? 'विषय देखो' : 'Browse subjects'}
                </button>
              </Card>
            )
          )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
