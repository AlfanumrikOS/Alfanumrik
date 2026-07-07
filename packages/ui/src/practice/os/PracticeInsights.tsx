'use client';

/**
 * PracticeInsights — average past quiz score + simple error-type and Bloom's
 * bars for the Alfa OS Practice Center (ff_practice_os_v1, Tier 1+ /
 * presentation-only).
 *
 * Reads `stats.avgScore`, `errorPatterns`, and `bloomDistribution` from GET
 * /api/practice/history (backend-owned). `avgScore` is a REAL average of past
 * quiz scores (server-computed) — shown VERBATIM, never recomputed, and clearly
 * labelled as an average quiz score. The bars re-present server-provided counts;
 * no scoring/XP/mastery math happens here.
 *
 * Bloom's level names (remember/understand/apply/analyze/evaluate/create) are
 * technical terms and are NOT translated even when isHi (P7 exception).
 *
 * Bars encode their value as a number + the bar length (never colour alone).
 *
 * States: loading (skeleton), error (visually DISTINCT from empty). errorPatterns
 * and bloomDistribution each get their OWN graceful empty state when their array
 * is empty (per the brief).
 */

import { Skeleton } from '@alfanumrik/ui/ui';
import type { PracticeErrorPattern, PracticeBloomRow } from './usePracticeHistory';

interface PracticeInsightsProps {
  avgScore: number | undefined;
  errorPatterns: PracticeErrorPattern[];
  bloomDistribution: PracticeBloomRow[];
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
  isHi: boolean;
}

/** Friendly bilingual label for a known error-pattern type code. */
function errorTypeLabel(type: string, isHi: boolean): string {
  const map: Record<string, { en: string; hi: string }> = {
    conceptual: { en: 'Conceptual', hi: 'अवधारणात्मक' },
    careless: { en: 'Careless', hi: 'लापरवाही' },
    computational: { en: 'Computational', hi: 'गणनात्मक' },
    misread: { en: 'Misread question', hi: 'प्रश्न ग़लत पढ़ा' },
    incomplete: { en: 'Incomplete', hi: 'अधूरा' },
    guessing: { en: 'Guessing', hi: 'अनुमान' },
  };
  const hit = map[type.toLowerCase()];
  if (hit) return isHi ? hit.hi : hit.en;
  // Unknown code — humanise it without translating an unknown term.
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
}

function Bar({
  label,
  value,
  max,
  glyph,
  color,
  ariaLabel,
}: {
  label: string;
  value: number;
  max: number;
  glyph?: string;
  color: string;
  ariaLabel: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <li className="flex items-center gap-3" aria-label={ariaLabel}>
      <span className="w-28 shrink-0 text-xs font-medium truncate" style={{ color: 'var(--text-2)' }}>
        {glyph && <span aria-hidden="true" className="mr-1">{glyph}</span>}
        {label}
      </span>
      <span
        className="flex-1 h-2.5 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
        aria-hidden="true"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(4, pct)}%`, background: color }}
        />
      </span>
      <span
        className="w-8 shrink-0 text-right text-xs font-bold"
        style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}
      >
        {value}
      </span>
    </li>
  );
}

export default function PracticeInsights({
  avgScore,
  errorPatterns,
  bloomDistribution,
  isLoading,
  error,
  hasData,
  isHi,
}: PracticeInsightsProps) {
  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'अभ्यास की अंतर्दृष्टि' : 'Practice insights'}
    </h2>
  );

  if (isLoading && !hasData) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'अंतर्दृष्टि लोड हो रही है' : 'Loading insights'}>
        {heading}
        <Skeleton height={140} rounded="rounded-2xl" />
      </section>
    );
  }

  if (error && !hasData) {
    return (
      <section aria-label={isHi ? 'अभ्यास की अंतर्दृष्टि' : 'Practice insights'}>
        {heading}
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'अंतर्दृष्टि अभी लोड नहीं हो पाई।'
            : "Couldn't load your insights right now."}
        </div>
      </section>
    );
  }

  const avg = typeof avgScore === 'number' ? avgScore : 0;
  const errorMax = errorPatterns.reduce((m, e) => Math.max(m, e.count), 0);
  const bloomMax = bloomDistribution.reduce((m, b) => Math.max(m, b.attempted), 0);

  return (
    <section aria-label={isHi ? 'अभ्यास की अंतर्दृष्टि' : 'Practice insights'}>
      {heading}

      <div
        className="rounded-2xl p-4 flex flex-col gap-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        {/* Average past quiz score — verbatim, labelled, number-forward. */}
        <div
          className="flex items-center justify-between"
          aria-label={
            isHi ? `औसत क्विज़ स्कोर ${avg} प्रतिशत` : `Average quiz score ${avg} percent`
          }
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>
            {isHi ? 'औसत क्विज़ स्कोर' : 'Average quiz score'}
          </span>
          <span className="flex items-baseline gap-1">
            <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
              {avg >= 80 ? '★' : avg >= 50 ? '◑' : '○'}
            </span>
            <span
              className="text-2xl font-extrabold"
              style={{
                color: 'var(--text-1)',
                fontVariantNumeric: 'tabular-nums',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {avg}%
            </span>
          </span>
        </div>

        {/* Error patterns */}
        <div>
          <h3 className="text-xs font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            {isHi ? 'सामान्य ग़लतियाँ' : 'Common mistakes'}
          </h3>
          {errorPatterns.length === 0 ? (
            <div
              className="rounded-xl p-3 text-center text-xs"
              style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
            >
              {isHi
                ? 'अभी कोई ग़लती का पैटर्न नहीं — अच्छा संकेत!'
                : 'No mistake patterns yet — a good sign!'}
            </div>
          ) : (
            <ul className="space-y-2">
              {errorPatterns.map((e) => {
                const label = errorTypeLabel(e.type, isHi);
                return (
                  <Bar
                    key={e.type}
                    label={label}
                    value={e.count}
                    max={errorMax}
                    color="var(--orange, #E8581C)"
                    ariaLabel={
                      isHi
                        ? `${label}: ${e.count} बार`
                        : `${label}: ${e.count} time${e.count === 1 ? '' : 's'}`
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>

        {/* Bloom's distribution — level names are NOT translated (P7 exception). */}
        <div>
          <h3 className="text-xs font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            {isHi ? "Bloom's स्तर (प्रयास)" : "Bloom's levels (attempted)"}
          </h3>
          {bloomDistribution.length === 0 ? (
            <div
              className="rounded-xl p-3 text-center text-xs"
              style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
            >
              {isHi
                ? "अभी कोई Bloom's डेटा नहीं — कुछ अभ्यास करो।"
                : "No Bloom's data yet — practise a little."}
            </div>
          ) : (
            <ul className="space-y-2">
              {bloomDistribution.map((b) => (
                <Bar
                  key={b.bloomLevel}
                  /* bloomLevel is a technical term — not translated. */
                  label={b.bloomLevel}
                  value={b.attempted}
                  max={bloomMax}
                  color="var(--purple, #7C3AED)"
                  ariaLabel={
                    isHi
                      ? `${b.bloomLevel}: ${b.attempted} प्रयास, ${b.correct} सही`
                      : `${b.bloomLevel}: ${b.attempted} attempted, ${b.correct} correct`
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
