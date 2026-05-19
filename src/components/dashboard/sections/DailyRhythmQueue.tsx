'use client';

/**
 * Pedagogy v2 — Wave 1B
 * DailyRhythmQueue
 *
 * Top-of-feed dashboard component rendering today's 7-item rhythm queue:
 * 5 SRS reviews + 1 ZPD problem + 1 reflection. Fetches from
 * /api/rhythm/today which is server-gated by ff_pedagogy_v2_daily_rhythm
 * (returns 404 when off → component renders nothing). No client-side
 * flag check needed.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { trackDashboardCta } from '@/lib/posthog/dashboard-cta';

interface RhythmItem {
  kind: 'srs_review' | 'zpd_problem' | 'reflection';
  questionId?: string;
  topicId?: string;
  promptText?: string;
  promptTextHi?: string;
  isPadding?: boolean;
  productiveFailure?: boolean;
  workedExampleFirst?: boolean;
  problemFlavor?: string | null;
}

interface RhythmQueue {
  items: RhythmItem[];
  composedAtIso: string;
}

export default function DailyRhythmQueue() {
  const { isHi } = useAuth();
  const [queue, setQueue] = useState<RhythmQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/rhythm/today', { credentials: 'same-origin' });
        if (res.status === 404) {
          // Flag off, no profile, etc — render nothing.
          if (!cancelled) setQueue(null);
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError((body as { error?: string }).error || 'unknown');
          return;
        }
        const data: RhythmQueue = await res.json();
        if (!cancelled) setQueue(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div
        className="h-32 rounded-3xl animate-pulse mb-4"
        style={{ background: 'var(--surface-2)' }}
        aria-hidden="true"
      />
    );
  }
  if (error || !queue) return null;

  const srs = queue.items.filter((i) => i.kind === 'srs_review' && !i.isPadding);
  const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
  const reflection = queue.items.find((i) => i.kind === 'reflection');

  const reflectionText = reflection
    ? (isHi ? (reflection.promptTextHi || reflection.promptText) : reflection.promptText)
    : null;

  return <RhythmQueueBody isHi={isHi} srs={srs} zpd={zpd} reflection={reflection} reflectionText={reflectionText} />;
}

interface RhythmQueueBodyProps {
  isHi: boolean;
  srs: RhythmItem[];
  zpd: RhythmItem | undefined;
  reflection: RhythmItem | undefined;
  reflectionText: string | null | undefined;
}

interface DiveStateLite {
  state: 'open' | 'completed';
  weeklyStreakCount: number;
}

interface SynthesisStateLite {
  isoMonth: string;
  daysSinceCreated: number;
}

function RhythmQueueBody({ isHi, srs, zpd, reflection, reflectionText }: RhythmQueueBodyProps) {
  const [diveState, setDiveState] = useState<DiveStateLite | null>(null);
  const [synthesisState, setSynthesisState] = useState<SynthesisStateLite | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dive/state', { credentials: 'same-origin' });
        if (cancelled) return;
        if (!res.ok) {
          // 404 (flag off) or any other error: render no dive CTA. Silent.
          setDiveState(null);
          return;
        }
        const data = await res.json() as { state: 'open' | 'completed'; weeklyStreakCount: number };
        if (!cancelled) setDiveState({ state: data.state, weeklyStreakCount: data.weeklyStreakCount });
      } catch {
        if (!cancelled) setDiveState(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pedagogy v2 Wave 3 — recent-synthesis CTA. Shows the link when a
  // monthly_synthesis_runs row was created within the past 7 days. Renders
  // nothing on 404 (flag off) or no_synthesis_yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/synthesis/state', { credentials: 'same-origin' });
        if (cancelled) return;
        if (!res.ok) { setSynthesisState(null); return; }
        const data = await res.json() as
          | { state: 'no_synthesis_yet' }
          | { state: 'ready'; row: { synthesisMonth: string; createdAt: string } };
        if (data.state !== 'ready') { setSynthesisState(null); return; }
        const created = new Date(data.row.createdAt);
        const days = Math.floor((Date.now() - created.getTime()) / 86_400_000);
        if (days >= 0 && days <= 7) {
          setSynthesisState({ isoMonth: data.row.synthesisMonth, daysSinceCreated: days });
        } else {
          setSynthesisState(null);
        }
      } catch {
        if (!cancelled) setSynthesisState(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section
      className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-orange-50 p-5 mb-4"
      data-testid="daily-rhythm-queue"
    >
      <header className="mb-3">
        <h2 className="text-lg font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'आज का 15-मिनट का रिदम' : "Today's 15-minute rhythm"}
        </h2>
        <p className="text-xs text-purple-700">
          {isHi ? '5 दोहराव · 1 चुनौती · 1 रिफ्लेक्शन' : '5 reviews · 1 challenge · 1 reflection'}
        </p>
      </header>

      <ol className="space-y-2 text-sm">
        <li className="flex items-center justify-between">
          <span className="text-purple-900">
            {isHi ? 'स्पेस्ड रिव्यू' : 'Spaced reviews'}
            {' · '}
            <span className="font-semibold">{srs.length}/5</span>
          </span>
          <Link
            href="/quiz?mode=srs"
            className="text-purple-700 underline font-medium"
            data-testid="rhythm-srs-cta"
            onClick={() => {
              trackDashboardCta({
                section: 'daily_rhythm_queue',
                action: 'srs_review',
                destination: '/quiz?mode=srs',
              });
            }}
          >
            {isHi ? 'शुरू करो' : 'Start'}
          </Link>
        </li>

        {zpd && zpd.kind === 'zpd_problem' && (
          <li className="flex items-center justify-between">
            <span className="text-purple-900">
              {zpd.workedExampleFirst
                ? (isHi ? 'गाइडेड चुनौती' : 'Guided challenge')
                : (isHi ? 'ZPD चुनौती' : 'ZPD challenge')}
            </span>
            <Link
              href={zpd.questionId && !zpd.questionId.startsWith('__') ? `/quiz?qid=${encodeURIComponent(zpd.questionId)}` : '/quiz'}
              className="text-purple-700 underline font-medium"
              data-testid="rhythm-zpd-cta"
              onClick={() => {
                // `questionId` is a uuid (not PII) but we still don't emit
                // it — destination keeps it as a query string for routing,
                // and PostHog gets only the route prefix when the URL is
                // captured via $pageview. Action key carries the variant.
                trackDashboardCta({
                  section: 'daily_rhythm_queue',
                  action: zpd.workedExampleFirst ? 'zpd_guided' : 'zpd_challenge',
                  destination: '/quiz',
                });
              }}
            >
              {isHi ? 'खोलो' : 'Open'}
            </Link>
          </li>
        )}

        {synthesisState && (
          <li className="flex items-center justify-between" data-testid="rhythm-synthesis-cta">
            <span className="text-purple-900">
              {isHi ? 'मासिक सारांश तैयार' : 'Monthly synthesis ready'}
              {' · '}
              <span className="font-semibold">{synthesisState.isoMonth}</span>
            </span>
            <Link
              href="/synthesis"
              className="text-purple-700 underline font-medium"
              onClick={() => {
                trackDashboardCta({
                  section: 'daily_rhythm_queue',
                  action: 'synthesis_view',
                  destination: '/synthesis',
                });
              }}
            >
              {isHi ? 'देखो' : 'View'}
            </Link>
          </li>
        )}

        {diveState && (
          <li className="flex items-center justify-between" data-testid="rhythm-dive-cta">
            <span className="text-purple-900">
              {isHi ? 'इस सप्ताह की डाइव' : "This week's dive"}
              {diveState.state === 'completed' && (
                <>
                  {' · '}
                  <span className="font-semibold">
                    {isHi ? `✓ हो गई · ${diveState.weeklyStreakCount}-सप्ताह की लय` : `✓ done · ${diveState.weeklyStreakCount}-week rhythm`}
                  </span>
                </>
              )}
            </span>
            <Link
              href="/dive"
              className="text-purple-700 underline font-medium"
              onClick={() => {
                // `weeklyStreakCount` is intentionally NOT emitted — that's
                // a learner-state datum that belongs in identify() cohort
                // properties, not on a click event.
                trackDashboardCta({
                  section: 'daily_rhythm_queue',
                  action: diveState.state === 'completed' ? 'dive_view_completed' : 'dive_start',
                  destination: '/dive',
                });
              }}
            >
              {diveState.state === 'completed'
                ? (isHi ? 'देखो' : 'View')
                : (isHi ? 'शुरू करो' : 'Start')}
            </Link>
          </li>
        )}

        {reflection && reflectionText && (
          <li>
            <details className="group">
              <summary className="cursor-pointer flex items-center justify-between text-purple-900">
                <span>{isHi ? 'रिफ्लेक्शन' : 'Reflection'}</span>
                <span className="text-purple-700 underline text-xs">
                  {isHi ? 'खोलो' : 'Open'}
                </span>
              </summary>
              <div
                className="mt-2 p-3 rounded-lg bg-white text-purple-900 text-sm leading-relaxed"
                data-testid="rhythm-reflection-prompt"
              >
                {reflectionText}
              </div>
            </details>
          </li>
        )}
      </ol>
    </section>
  );
}
