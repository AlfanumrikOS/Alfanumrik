'use client';

/**
 * PercentileBandCard — U10 replacement for the old absolute-rank block on the
 * student leaderboard. Renders a band label + encouraging copy; NEVER shows an
 * absolute numeric rank. Bilingual (P7). The band is served by
 * /api/v1/leaderboard/me.
 *
 * P13 no PII in logs; the card takes no student identifiers.
 */

/**
 * The full band union. This MUST stay a superset of every value
 * `bandFromPercentile()` in `apps/host/src/app/api/v1/leaderboard/me/route.ts`
 * can emit (`top_1 | top_10 | top_25 | middle | bottom_25`) PLUS the legacy
 * labels the RPC's own `band` column may carry (`top_50 | keep_going`).
 * `top_1`, `middle` and `bottom_25` were missing here and crashed the whole
 * leaderboard page (SEV1) — see the totality note on `resolveBand` below.
 */
export type PercentileBand =
  | 'top_1'
  | 'top_10'
  | 'top_25'
  | 'top_50'
  | 'middle'
  | 'bottom_25'
  | 'keep_going';

const COPY: Record<PercentileBand, { en: string; hi: string; accent: string; emoji: string }> = {
  top_1: {
    en: "You're in the top 1% — outstanding work!",
    hi: 'तुम टॉप 1% में हो — शानदार काम!',
    accent: 'var(--accent-warm)',
    emoji: '👑',
  },
  top_10: {
    en: "You're in the top 10%! Keep the streak alive.",
    hi: 'तुम टॉप 10% में हो! लगे रहो।',
    accent: '#FFD700',
    emoji: '🏆',
  },
  top_25: {
    en: 'Top 25% — climbing fast!',
    hi: 'टॉप 25% — तेज़ी से आगे!',
    accent: '#C0C0C0',
    emoji: '🥈',
  },
  top_50: {
    en: 'Top half — keep pushing!',
    hi: 'टॉप आधे में — लगे रहो!',
    accent: '#CD7F32',
    emoji: '🥉',
  },
  middle: {
    en: 'Right in the mix — one more quiz moves you up.',
    hi: 'तुम मुकाबले में हो — एक और क्विज़ तुम्हें ऊपर ले जाएगी।',
    accent: 'var(--purple)',
    emoji: '📈',
  },
  bottom_25: {
    en: 'Every quiz counts — your next one moves the needle.',
    hi: 'हर क्विज़ मायने रखती है — अगली क्विज़ से फ़र्क पड़ेगा।',
    accent: 'var(--purple)',
    emoji: '💪',
  },
  keep_going: {
    en: 'Every quiz counts — keep going!',
    hi: 'हर क्विज़ मायने रखती है — लगे रहो!',
    accent: 'var(--purple)',
    emoji: '💪',
  },
};

const TITLE: Record<PercentileBand, { en: string; hi: string }> = {
  top_1: { en: "You're in the top 1%!", hi: 'तुम टॉप 1% में हो!' },
  top_10: { en: "You're in the top 10%!", hi: 'तुम टॉप 10% में हो!' },
  top_25: { en: 'Top 25%', hi: 'टॉप 25%' },
  top_50: { en: 'Top half', hi: 'टॉप आधे में' },
  middle: { en: 'In the mix', hi: 'मुकाबले में' },
  bottom_25: { en: 'Just getting started', hi: 'अभी शुरुआत है' },
  keep_going: { en: 'Keep going!', hi: 'लगे रहो!' },
};

/** Band used when the caller hands us `undefined`, `null`, or a label we
 *  don't know. A presentational card must never be able to throw and take a
 *  whole page's error boundary with it. */
const FALLBACK_BAND: PercentileBand = 'keep_going';

function resolveBand(band: unknown): PercentileBand {
  return typeof band === 'string' && Object.prototype.hasOwnProperty.call(COPY, band)
    ? (band as PercentileBand)
    : FALLBACK_BAND;
}

export function PercentileBandCard({
  band,
  isHi,
}: {
  /** Widened past `PercentileBand` on purpose: the wire value is a free-form
   *  string from the RPC's `band` column, so the card owns the narrowing. */
  band?: PercentileBand | string | null;
  isHi: boolean;
}) {
  const resolved = resolveBand(band);
  const copy = COPY[resolved];
  const title = TITLE[resolved];
  return (
    <div
      data-testid="percentile-band-card"
      data-band={resolved}
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
        {copy.emoji}
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
