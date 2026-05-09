'use client';

/**
 * Pedagogy v2 — Wave 3 Task 5
 * <SynthesisRitual/> — the "month complete" ritual UI.
 *
 * Renders:
 *   - Month label as the header
 *   - Three mastery-delta tiles (mastered, improved, regressed)
 *   - Chapters-touched list
 *   - Weekly artifact count + chapter mock summary
 *   - The Claude-generated bilingual summary text (whichever language
 *     matches AuthContext.isHi)
 *
 * Props are exactly the SynthesisRow shape from /api/synthesis/state.
 * No fetching here — the parent page owns IO.
 */
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import type { SynthesisBundle } from '@/lib/learn/monthly-synthesis-orchestrator';

export interface SynthesisRitualProps {
  synthesisMonth: string;
  bundle: SynthesisBundle;
  summaryTextEn: string;
  summaryTextHi: string;
}

export default function SynthesisRitual({
  synthesisMonth, bundle, summaryTextEn, summaryTextHi,
}: SynthesisRitualProps) {
  const { isHi } = useAuth();
  const md = bundle.masteryDelta;
  const summary = isHi ? (summaryTextHi || summaryTextEn) : summaryTextEn;

  return (
    <section
      className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-orange-50 p-5"
      data-testid="synthesis-ritual"
    >
      <header className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-purple-700">
          {isHi ? 'मासिक सारांश' : 'Monthly Synthesis'}
        </p>
        <h2 className="text-xl font-bold text-purple-900 mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>
          {synthesisMonth}
        </h2>
      </header>

      {/* Mastery delta tiles */}
      <div className="grid grid-cols-3 gap-2 mb-4" data-testid="synthesis-mastery-tiles">
        <DeltaTile
          label={isHi ? 'महारत' : 'Mastered'}
          value={md.topicsMastered}
          color="#16A34A"
        />
        <DeltaTile
          label={isHi ? 'सुधार' : 'Improved'}
          value={md.topicsImproved}
          color="#7C3AED"
        />
        <DeltaTile
          label={isHi ? 'पीछे गए' : 'Regressed'}
          value={md.topicsRegressed}
          color="#DC2626"
        />
      </div>

      {/* Chapters touched */}
      {md.chaptersTouched.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700 mb-1">
            {isHi ? 'इस महीने के अध्याय' : 'Chapters touched'}
          </p>
          <ul className="text-xs text-purple-900 space-y-0.5">
            {md.chaptersTouched.slice(0, 6).map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-purple-500">•</span>
                <span>{c}</span>
              </li>
            ))}
            {md.chaptersTouched.length > 6 && (
              <li className="text-purple-600 italic">
                {isHi
                  ? `+ ${md.chaptersTouched.length - 6} और`
                  : `+ ${md.chaptersTouched.length - 6} more`}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Weekly artifact count */}
      <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
        <InfoTile
          label={isHi ? 'साप्ताहिक डाइव' : 'Weekly dives'}
          value={`${bundle.weeklyArtifactIds.length}/4`}
        />
        {bundle.chapterMockSummary && (
          <InfoTile
            label={isHi ? 'मॉक प्रश्न' : 'Mock questions'}
            value={String(bundle.chapterMockSummary.totalQuestions)}
          />
        )}
      </div>

      {bundle.weeklyArtifactIds.length > 0 && (
        <Link
          href="/dive/history"
          className="inline-block text-xs text-purple-700 underline mb-4"
        >
          {isHi ? 'इस महीने की डाइव डायरी देखो →' : 'Open this month\'s dive journal →'}
        </Link>
      )}

      {/* Claude-generated summary */}
      <div className="mt-4 pt-4 border-t border-purple-200">
        <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700 mb-2">
          {isHi ? 'इस महीने का सारांश' : 'This month at a glance'}
        </p>
        {summary && summary.trim().length > 0 ? (
          <p
            className="text-sm leading-relaxed text-[var(--text-2)] whitespace-pre-wrap"
            data-testid="synthesis-summary-text"
          >
            {summary}
          </p>
        ) : (
          <p
            className="text-xs text-purple-600 italic"
            data-testid="synthesis-summary-pending"
          >
            {isHi
              ? 'सारांश तैयार हो रहा है — कुछ ही पल में…'
              : 'Generating your summary — refresh in a moment…'}
          </p>
        )}
      </div>
    </section>
  );
}

function DeltaTile(props: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-2xl bg-white p-3 text-center"
      style={{ border: `1px solid ${props.color}33` }}
    >
      <div className="text-2xl font-bold" style={{ color: props.color, fontFamily: 'var(--font-display)' }}>
        {props.value}
      </div>
      <div className="text-[10px] text-[var(--text-3)] mt-0.5">{props.label}</div>
    </div>
  );
}

function InfoTile(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2" style={{ border: '1px solid rgba(124,58,237,0.15)' }}>
      <div className="text-[10px] text-[var(--text-3)] mb-0.5">{props.label}</div>
      <div className="text-sm font-semibold text-purple-900">{props.value}</div>
    </div>
  );
}
