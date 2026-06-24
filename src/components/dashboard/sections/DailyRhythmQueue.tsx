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
 * Phase A Loop A (adaptive remediation): items[] may additionally carry
 * `kind: 'remediation_review'` cards (severity-ordered, positions 5..7,
 * server-gated by ff_adaptive_remediation_v1 — flag OFF ⇒ the kind never
 * appears). Rendered as warm, Foxy-framed orange cards between the SRS row
 * and the ZPD row, mirroring the lane's position in the API contract.
 * Unknown/future kinds are ignored by the filters below (default-safe).
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 * Spec: docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { trackDashboardCta } from '@/lib/posthog/dashboard-cta';

interface RhythmItem {
  kind: 'srs_review' | 'zpd_problem' | 'reflection' | 'remediation_review';
  questionId?: string;
  topicId?: string;
  promptText?: string;
  promptTextHi?: string;
  isPadding?: boolean;
  productiveFailure?: boolean;
  workedExampleFirst?: boolean;
  problemFlavor?: string | null;
  // Phase A Loop A — remediation_review fields (frozen /api/rhythm/today contract)
  subjectCode?: string;
  chapterNumber?: number;
  interventionId?: string;
  priority?: number;
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
        className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-orange-50 p-5 mb-4"
        aria-hidden="true"
      >
        <div className="h-4 w-1/2 bg-purple-200/60 rounded-full mb-4 animate-pulse" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-white/50 rounded-2xl mb-2 animate-pulse" />
        ))}
      </div>
    );
  }
  if (error || !queue) return null;

  const srs = queue.items.filter((i) => i.kind === 'srs_review' && !i.isPadding);
  const zpd = queue.items.find((i) => i.kind === 'zpd_problem');
  const reflection = queue.items.find((i) => i.kind === 'reflection');
  // Phase A Loop A — remediation lane (server already severity-orders these;
  // require the routing fields so a malformed card can never produce a dead link).
  const remediation = queue.items.filter(
    (i) =>
      i.kind === 'remediation_review' &&
      typeof i.subjectCode === 'string' &&
      i.subjectCode.length > 0 &&
      typeof i.chapterNumber === 'number',
  );

  const reflectionText = reflection
    ? (isHi ? (reflection.promptTextHi || reflection.promptText) : reflection.promptText)
    : null;

  return (
    <RhythmQueueBody
      isHi={isHi}
      srs={srs}
      zpd={zpd}
      remediation={remediation}
      reflection={reflection}
      reflectionText={reflectionText}
    />
  );
}

interface RhythmQueueBodyProps {
  isHi: boolean;
  srs: RhythmItem[];
  zpd: RhythmItem | undefined;
  remediation: RhythmItem[];
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

function RhythmQueueBody({ isHi, srs, zpd, remediation, reflection, reflectionText }: RhythmQueueBodyProps) {
  const [diveState, setDiveState] = useState<DiveStateLite | null>(null);
  const [synthesisState, setSynthesisState] = useState<SynthesisStateLite | null>(null);
  const [reflOpen, setReflOpen] = useState(false);

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
          {remediation.length > 0 && (
            <span className="font-semibold text-orange-700">
              {isHi
                ? ` · ${remediation.length} Foxy बूस्ट`
                : ` · ${remediation.length} Foxy boost${remediation.length > 1 ? 's' : ''}`}
            </span>
          )}
        </p>
      </header>

      <ol className="space-y-2 text-sm">
        <li
          className="flex items-center gap-3 rounded-2xl p-3"
          style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(124,58,237,0.1)' }}
        >
          <span
            className="text-lg w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(124,58,237,0.08)' }}
            aria-hidden="true"
          >
            🔄
          </span>
          <span className="flex-1 text-sm font-semibold text-purple-900">
            {isHi ? 'स्पेस्ड रिव्यू' : 'Spaced reviews'}
            {' · '}
            <span className="font-bold">{srs.length}/5</span>
          </span>
          <Link
            href="/quiz?mode=srs"
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-white shrink-0"
            style={{ background: '#7C3AED' }}
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

        {/* Phase A Loop A — adaptive-remediation lane (after SRS, before ZPD:
            warm-up → targeted repair → stretch). Warm Foxy framing, never
            punitive (P12 note: static copy, nothing generated). Whole card is
            the tap target (≥44px), keyboard-focusable with a visible ring. */}
        {remediation.map((item, idx) => {
          const ch = item.chapterNumber as number;
          const subject = item.subjectCode as string;
          const headline = isHi
            ? `Foxy ने देखा कि अध्याय ${ch} थोड़ा मुश्किल लगा — चलो इसे पक्का करें`
            : `Foxy noticed Chapter ${ch} got tricky — let's strengthen it`;
          const href = `/quiz?subject=${encodeURIComponent(subject)}&chapter=${ch}`;
          return (
            <li key={item.interventionId || `remediation-${subject}-${ch}-${idx}`}>
              <Link
                href={href}
                className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-3 min-h-[44px] transition-transform active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                data-testid="rhythm-remediation-card"
                aria-label={
                  isHi
                    ? `${headline} — अभ्यास शुरू करो`
                    : `${headline} — start practice`
                }
                onClick={() => {
                  // interventionId is a uuid (not PII) but is intentionally NOT
                  // emitted — same posture as the ZPD questionId above.
                  trackDashboardCta({
                    section: 'daily_rhythm_queue',
                    action: 'remediation_review',
                    destination: '/quiz',
                  });
                }}
              >
                <span className="text-lg leading-none mt-0.5" aria-hidden="true">🦊</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-orange-900 leading-snug">
                    {headline}
                  </span>
                  <span className="block text-[11px] text-orange-700 mt-0.5">
                    {subject} · {isHi ? `अध्याय ${ch}` : `Ch. ${ch}`}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0">
                  {typeof item.priority === 'number' && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-orange-500 text-white"
                      data-testid="rhythm-remediation-priority"
                    >
                      {isHi ? `प्राथमिकता ${item.priority}` : `Priority ${item.priority}`}
                    </span>
                  )}
                  <span className="text-sm text-orange-700 underline font-medium">
                    {isHi ? 'मज़बूत करो' : 'Strengthen'}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}

        {zpd && zpd.kind === 'zpd_problem' && (
          <li
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(124,58,237,0.1)' }}
          >
            <span
              className="text-lg w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(124,58,237,0.08)' }}
              aria-hidden="true"
            >
              ⚡
            </span>
            <span className="flex-1 text-sm font-semibold text-purple-900">
              {zpd.workedExampleFirst
                ? (isHi ? 'गाइडेड चुनौती' : 'Guided challenge')
                : (isHi ? 'ZPD चुनौती' : 'ZPD challenge')}
            </span>
            <Link
              href={zpd.questionId && !zpd.questionId.startsWith('__') ? `/quiz?qid=${encodeURIComponent(zpd.questionId)}` : '/quiz'}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-white shrink-0"
              style={{ background: '#7C3AED' }}
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
          <li
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(124,58,237,0.1)' }}
            data-testid="rhythm-synthesis-cta"
          >
            <span
              className="text-lg w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(124,58,237,0.08)' }}
              aria-hidden="true"
            >
              📝
            </span>
            <span className="flex-1 text-sm font-semibold text-purple-900">
              {isHi ? 'मासिक सारांश तैयार' : 'Monthly synthesis ready'}
              {' · '}
              <span className="font-bold">{synthesisState.isoMonth}</span>
            </span>
            <Link
              href="/synthesis"
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-white shrink-0"
              style={{ background: '#7C3AED' }}
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
          <li
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(124,58,237,0.1)' }}
            data-testid="rhythm-dive-cta"
          >
            <span
              className="text-lg w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(124,58,237,0.08)' }}
              aria-hidden="true"
            >
              📚
            </span>
            <span className="flex-1 text-sm font-semibold text-purple-900">
              {isHi ? 'इस सप्ताह की डाइव' : "This week's dive"}
              {diveState.state === 'completed' && (
                <>
                  {' · '}
                  <span className="font-bold">
                    {isHi ? `✓ हो गई · ${diveState.weeklyStreakCount}-सप्ताह की लय` : `✓ done · ${diveState.weeklyStreakCount}-week rhythm`}
                  </span>
                </>
              )}
            </span>
            <Link
              href="/dive"
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-white shrink-0"
              style={{ background: '#7C3AED' }}
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
            <button
              onClick={() => setReflOpen(r => !r)}
              className="w-full flex items-center gap-3 rounded-2xl p-3 text-left"
              style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(124,58,237,0.1)' }}
              aria-expanded={reflOpen}
            >
              <span
                className="text-lg w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(124,58,237,0.08)' }}
                aria-hidden="true"
              >
                🪞
              </span>
              <span className="flex-1 text-sm font-semibold text-purple-900">
                {isHi ? 'रिफ्लेक्शन' : 'Reflection'}
              </span>
              <span
                className="text-purple-400 text-xs transition-transform duration-200 shrink-0"
                style={{ transform: reflOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                aria-hidden="true"
              >
                ▼
              </span>
            </button>
            {reflOpen && (
              <div
                className="mt-2 mx-1 p-4 rounded-xl bg-white text-purple-900 text-sm leading-relaxed"
                data-testid="rhythm-reflection-prompt"
              >
                {reflectionText}
              </div>
            )}
          </li>
        )}
      </ol>
    </section>
  );
}
