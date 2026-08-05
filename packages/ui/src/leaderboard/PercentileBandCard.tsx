'use client';

/**
 * PercentileBandCard — U10 replacement for the old absolute-rank block on the
 * student leaderboard. Renders a band label + encouraging copy; NEVER shows an
 * absolute numeric rank. Bilingual (P7). The band is served by
 * /api/v1/leaderboard/me.
 *
 * P13 no PII in logs; the card takes no student identifiers.
 */

export type PercentileBand = 'top_10' | 'top_25' | 'top_50' | 'keep_going';

const COPY: Record<PercentileBand, { en: string; hi: string; accent: string }> = {
  top_10: {
    en: "You're in the top 10%! Keep the streak alive.",
    hi: 'तुम टॉप 10% में हो! लगे रहो।',
    accent: '#FFD700',
  },
  top_25: {
    en: 'Top 25% — climbing fast!',
    hi: 'टॉप 25% — तेज़ी से आगे!',
    accent: '#C0C0C0',
  },
  top_50: {
    en: 'Top half — keep pushing!',
    hi: 'टॉप आधे में — लगे रहो!',
    accent: '#CD7F32',
  },
  keep_going: {
    en: 'Every quiz counts — keep going!',
    hi: 'हर क्विज़ मायने रखती है — लगे रहो!',
    accent: 'var(--purple)',
  },
};

const TITLE: Record<PercentileBand, { en: string; hi: string }> = {
  top_10: { en: "You're in the top 10%!", hi: 'तुम टॉप 10% में हो!' },
  top_25: { en: 'Top 25%', hi: 'टॉप 25%' },
  top_50: { en: 'Top half', hi: 'टॉप आधे में' },
  keep_going: { en: 'Keep going!', hi: 'लगे रहो!' },
};

export function PercentileBandCard({
  band,
  isHi,
}: {
  band: PercentileBand;
  isHi: boolean;
}) {
  const copy = COPY[band];
  const title = TITLE[band];
  return (
    <div
      data-testid="percentile-band-card"
      data-band={band}
      className="rounded-2xl p-5 flex items-center gap-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
        borderLeft: `4px solid ${copy.accent}`,
      }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shrink-0"
        style={{ background: 'color-mix(in srgb, var(--purple) 12%, transparent)' }}
        aria-hidden="true"
      >
        {band === 'top_10' ? '🏆' : band === 'top_25' ? '🥈' : band === 'top_50' ? '🥉' : '💪'}
      </div>
      <div className="min-w-0">
        <h3
          className="text-lg font-bold m-0 font-heading"
          style={{ color: 'var(--text-1)' }}
        >
          {isHi ? title.hi : title.en}
        </h3>
        <p className="text-[13px] mt-0.5 m-0" style={{ color: 'var(--text-2)' }}>
          {isHi ? copy.hi : copy.en}
        </p>
      </div>
    </div>
  );
}

export default PercentileBandCard;
