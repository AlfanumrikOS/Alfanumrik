'use client';

/**
 * ExperimentCelebration
 * ─────────────────────────────────────────────────────────────
 * Post-experiment reward overlay for STEM Lab.
 *
 * Receives the JSONB return value of the `complete_experiment` RPC and
 * renders coin breakdown, lab streak, and (when present) viva score.
 *
 * Display rules — DO NOT change without assessment review:
 *   - Coin numbers come from the RPC return value, never recomputed in UI.
 *   - Coin labels (Base / Viva / First Today / Streak) are presentation
 *     strings only; the underlying values live in `coin-rules.ts` and the
 *     RPC, which are the single sources of truth.
 *   - Streak "New Personal Best" only when `streak.is_new_record` is true
 *     AND current > 1 (server already enforces this).
 *
 * P7 — bilingual via `isHi` prop (no hardcoded text).
 * P10 — page-routed via dynamic() import in the parent so the bundle is
 *       only paid by users who actually finish a lab.
 * P13 — no PII rendered, no PII logged.
 *
 * Accessibility:
 *   - role="dialog" aria-modal="true" with labelled heading
 *   - Focus trapped to the modal while open; restored on close
 *   - Escape key closes
 *   - Min tap target 44px on all CTAs
 */

import { useEffect, useRef, useCallback, useState } from 'react';

/* ─── Types ────────────────────────────────────────────────── */

export type ConclusionTier = 'weak' | 'developing' | 'proficient' | 'strong';

export interface ConclusionGrading {
  scores: { r1: number; r2: number; r3: number; r4: number };
  total: number;
  tier: ConclusionTier;
  feedback_en: string;
  feedback_hi: string;
  coins_awarded: number;
  graded_at?: string;
}

export interface ExperimentCelebrationResult {
  /** Optional observation row id; required for AI conclusion grading (Tier 3 R10). */
  observationId?: string | null;
  coinsAwarded: number;
  coinsUncapped: number;
  capped: boolean;
  breakdown: {
    base: number;
    viva_bonus: number;
    first_today: number;
    streak_bonus: number;
  };
  streak: {
    current: number;
    longest: number;
    is_new_record: boolean;
  };
  coinBalance: number;
  viva: {
    score: number | null;
    max: number | null;
    perfect: boolean;
  };
}

export interface ExperimentCelebrationProps {
  result: ExperimentCelebrationResult;
  experimentTitle: string;
  isGuided: boolean;
  onClose: () => void;
  onNextLab?: () => void;
  isHi: boolean;
}

/* ─── Component ────────────────────────────────────────────── */

export default function ExperimentCelebration({
  result,
  experimentTitle,
  isGuided,
  onClose,
  onNextLab,
  isHi,
}: ExperimentCelebrationProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const continueBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  /* ── Conclusion grading state (Tier 3 R10) ── */
  const [gradingState, setGradingState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [grading, setGrading] = useState<ConclusionGrading | null>(null);
  const [bonusCoins, setBonusCoins] = useState<number>(0);
  const animatedBalance = result.coinBalance + bonusCoins;

  /* ── Fire-and-forget grading call ──
     Runs once, only when:
       - we actually have an observation_id
       - the experiment was guided (showVivaSection check below)
     A failure silently hides the section — never disrupts celebration.
  */
  useEffect(() => {
    const observationId = result.observationId;
    const isGuidedWithViva =
      isGuided && result.viva.max !== null && (result.viva.max ?? 0) > 0;
    if (!observationId || !isGuidedWithViva) return;

    let cancelled = false;
    setGradingState('loading');

    fetch('/api/student/grade-conclusion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ observation_id: observationId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`http_${res.status}`);
        return res.json();
      })
      .then((data: { success?: boolean; grading?: ConclusionGrading; coins_awarded?: number }) => {
        if (cancelled) return;
        if (!data?.success || !data?.grading) {
          setGradingState('error');
          return;
        }
        setGrading(data.grading);
        setBonusCoins(typeof data.coins_awarded === 'number' ? data.coins_awarded : 0);
        setGradingState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setGradingState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [result.observationId, isGuided, result.viva.max]);

  /* ── Focus trap + restore + Escape handler ── */
  useEffect(() => {
    previousFocusRef.current = (typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null);

    // Move focus into dialog
    continueBtnRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  /* ── Derived values ── */
  const heroEmoji = result.viva.perfect ? '🎉' : '🔬';
  const showViva =
    result.viva.max !== null && result.viva.max !== undefined && result.viva.max > 0;
  const vivaPct =
    showViva && result.viva.score !== null && result.viva.max
      ? Math.round((result.viva.score / result.viva.max) * 100)
      : 0;
  /* Viva ring tint via semantic tokens (green / gold / red) using color-mix
     so the ring reads on-brand. Presentation only — thresholds unchanged. */
  const vivaRingToken =
    vivaPct >= 80 ? 'var(--green)' : vivaPct >= 50 ? 'var(--gold)' : 'var(--red)';

  /* ── i18n labels (literals — DO NOT machine translate) ── */
  const L = {
    youCompleted: isHi ? 'आपने पूरा किया' : 'You completed',
    coins: (n: number) => (isHi ? `+${n} सिक्के` : `+${n} coins`),
    labStreak: isHi ? 'लैब स्ट्रीक' : 'Lab Streak',
    days: isHi ? 'दिन' : 'days',
    newRecord: isHi ? 'नया रिकॉर्ड!' : 'New Personal Best!',
    capReached: isHi
      ? 'आज की सीमा पूरी — कल और कमाएं'
      : 'Daily cap reached — earn more tomorrow',
    continueBtn: isHi ? 'जारी रखें' : 'Continue',
    tryAnother: isHi ? 'एक और लैब आज़माएं' : 'Try another lab',
    vivaScore: isHi ? 'मौखिक स्कोर' : 'Viva Score',
    base: isHi ? 'बेस' : 'Base',
    viva: isHi ? 'वाइवा' : 'Viva',
    firstToday: isHi ? 'आज पहला' : 'First Today',
    streak: isHi ? 'स्ट्रीक' : 'Streak',
    coinBalance: isHi ? 'सिक्के शेष' : 'Coin Balance',
    rewardEarned: isHi ? 'इनाम मिला' : 'Reward Earned',
    guided: isHi ? 'गाइडेड प्रयोग' : 'Guided Experiment',
    simple: isHi ? 'सिमुलेशन' : 'Simulation',
    foxyReading: isHi
      ? '🦊 फॉक्सी आपका निष्कर्ष पढ़ रहे हैं...'
      : '🦊 Foxy is reading your conclusion...',
    conclusionScore: isHi ? 'निष्कर्ष स्कोर' : 'Conclusion Score',
    bonusCoins: (n: number) => (isHi ? `+${n} बोनस सिक्के` : `+${n} bonus coins`),
    tierLabel: (t: ConclusionTier): string => {
      if (isHi) {
        return t === 'strong' ? 'शानदार काम!'
          : t === 'proficient' ? 'बहुत अच्छा!'
          : t === 'developing' ? 'अच्छा प्रयास!'
          : 'अगली बार और बेहतर!';
      }
      return t === 'strong' ? 'Strong work!'
        : t === 'proficient' ? 'Proficient!'
        : t === 'developing' ? 'Developing — keep going!'
        : 'Keep practicing!';
    },
  };

  /* ── Breakdown chips (only render non-zero) ──
     Semantic-token tints via color-mix: base→warm, viva→purple,
     firstToday→teal, streak→gold. Values come from the RPC, never recomputed. */
  const chips: Array<{ label: string; value: number; token: string }> = [];
  if (result.breakdown.base > 0) {
    chips.push({ label: L.base, value: result.breakdown.base, token: 'var(--accent-warm)' });
  }
  if (result.breakdown.viva_bonus > 0) {
    chips.push({ label: L.viva, value: result.breakdown.viva_bonus, token: 'var(--purple)' });
  }
  if (result.breakdown.first_today > 0) {
    chips.push({ label: L.firstToday, value: result.breakdown.first_today, token: 'var(--teal)' });
  }
  if (result.breakdown.streak_bonus > 0) {
    chips.push({ label: L.streak, value: result.breakdown.streak_bonus, token: 'var(--gold)' });
  }

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm animate-fade-in p-0 sm:p-4"
    >
      {/* Confetti burst — pure CSS, no library */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {[
          { e: '✨', l: '12%', d: '0s' },
          { e: '🎊', l: '22%', d: '.15s' },
          { e: '⭐', l: '38%', d: '.05s' },
          { e: '✨', l: '55%', d: '.25s' },
          { e: '🎉', l: '72%', d: '.1s' },
          { e: '⭐', l: '85%', d: '.2s' },
        ].map((p, i) => (
          <span
            key={i}
            className="absolute text-2xl confetti-piece"
            style={{
              left: p.l,
              top: '-10%',
              animationDelay: p.d,
            }}
          >
            {p.e}
          </span>
        ))}
        <style>{`
          @keyframes confettiFall {
            0%   { transform: translateY(0)    rotate(0deg);   opacity: 1; }
            100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
          }
          .confetti-piece {
            animation: confettiFall 1.8s cubic-bezier(.4,.05,.6,1) forwards;
          }
        `}</style>
      </div>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="celebration-title"
        className="relative w-full sm:max-w-md md:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto animate-scale-in"
        style={{ border: '2px solid color-mix(in srgb, var(--accent-warm) 22%, transparent)' }}
      >
        {/* ── Hero — warm wash via the stable warm channel ── */}
        <div
          className="px-5 pt-6 pb-4 sm:px-7 sm:pt-8 text-center rounded-t-3xl"
          style={{ background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent-warm) 9%, white), white)' }}
        >
          <div className="text-5xl sm:text-6xl mb-3 select-none" aria-hidden="true">
            {heroEmoji}
          </div>
          <p
            className="text-[11px] uppercase tracking-wider font-semibold mb-1"
            style={{ color: 'var(--accent-warm)' }}
          >
            {isGuided ? L.guided : L.simple}
          </p>
          <h2
            id="celebration-title"
            className="text-lg sm:text-xl font-bold text-gray-900 font-[Sora] leading-snug"
          >
            {L.youCompleted}:{' '}
            <span style={{ color: 'var(--accent-warm)' }}>{experimentTitle}</span>
          </h2>
        </div>

        {/* ── Coin reward card — refined warm-tinted panel, gold coin total ── */}
        <div className="px-5 sm:px-7 pt-2">
          <div
            className="rounded-2xl p-4 sm:p-5"
            style={{
              background: 'color-mix(in srgb, var(--accent-warm) 7%, white)',
              border: '1px solid color-mix(in srgb, var(--accent-warm) 20%, transparent)',
            }}
          >
            <p
              className="text-[11px] uppercase tracking-wider font-semibold mb-1 text-center"
              style={{ color: 'var(--accent-warm)' }}
            >
              {L.rewardEarned}
            </p>
            <p
              className="text-3xl sm:text-4xl font-bold text-center font-[Sora]"
              style={{ color: 'var(--gold)' }}
            >
              <span aria-hidden="true">🪙</span> {L.coins(result.coinsAwarded)}
            </p>

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {chips.map((c) => (
                  <span
                    key={c.label}
                    className="text-[11px] px-2 py-1 rounded-full font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${c.token} 14%, transparent)`,
                      color: `color-mix(in srgb, ${c.token} 78%, black)`,
                    }}
                  >
                    {c.label} +{c.value}
                  </span>
                ))}
              </div>
            )}

            {result.capped && (
              <p className="mt-3 text-[11px] text-gray-500 text-center italic">
                {L.capReached}
              </p>
            )}
          </div>
        </div>

        {/* ── Lab streak card — warm streak wash, gold→warm "new best" badge ── */}
        <div className="px-5 sm:px-7 pt-3">
          <div
            className="relative rounded-2xl p-4 flex items-center gap-3"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 9%, white), color-mix(in srgb, var(--accent-warm) 8%, white))',
              border: '1px solid color-mix(in srgb, var(--accent-warm) 20%, transparent)',
            }}
          >
            <div className="text-3xl sm:text-4xl flex-shrink-0" aria-hidden="true">
              🔥
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[11px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--accent-warm)' }}
              >
                {L.labStreak}
              </p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 font-[Sora]">
                {result.streak.current} {L.days}
              </p>
            </div>
            {result.streak.is_new_record && result.streak.current > 1 && (
              <span
                className="ml-2 text-[10px] sm:text-xs px-2 py-1 rounded-full font-bold text-white shadow-md whitespace-nowrap"
                style={{ background: 'linear-gradient(to right, var(--gold), var(--accent-warm))' }}
              >
                {L.newRecord}
              </span>
            )}
          </div>
        </div>

        {/* ── Viva score (only if applicable) ── */}
        {showViva && (
          <div className="px-5 sm:px-7 pt-3">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
              <div
                className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-full ring-4 flex items-center justify-center font-bold text-base sm:text-lg"
                style={{
                  // @ts-expect-error -- CSS custom property for Tailwind ring color
                  '--tw-ring-color': `color-mix(in srgb, ${vivaRingToken} 55%, transparent)`,
                  background: `color-mix(in srgb, ${vivaRingToken} 10%, white)`,
                  color: `color-mix(in srgb, ${vivaRingToken} 78%, black)`,
                }}
                aria-label={`${L.vivaScore} ${vivaPct} percent`}
              >
                {vivaPct}%
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                  {L.vivaScore}
                </p>
                <p className="text-base sm:text-lg font-semibold text-gray-900">
                  {result.viva.score}/{result.viva.max}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Foxy conclusion grading (Tier 3 R10) ── */}
        {gradingState !== 'idle' && gradingState !== 'error' && (
          <div className="px-5 sm:px-7 pt-3">
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--purple) 8%, white), color-mix(in srgb, var(--accent-warm) 7%, white))',
                border: '1px solid color-mix(in srgb, var(--purple) 22%, transparent)',
              }}
            >
              {gradingState === 'loading' && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-sm text-center font-medium animate-pulse"
                  style={{ color: 'color-mix(in srgb, var(--purple) 78%, black)' }}
                >
                  {L.foxyReading}
                </p>
              )}
              {gradingState === 'ready' && grading && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className="text-2xl">🦊</span>
                      <div className="min-w-0">
                        <p
                          className="text-sm font-bold font-[Sora] truncate"
                          style={{ color: 'color-mix(in srgb, var(--purple) 82%, black)' }}
                        >
                          {L.tierLabel(grading.tier)}
                        </p>
                        <p
                          className="text-[11px] uppercase tracking-wider font-semibold"
                          style={{ color: 'color-mix(in srgb, var(--purple) 70%, black)' }}
                        >
                          {L.conclusionScore}: {grading.total}/12
                        </p>
                      </div>
                    </div>
                    {bonusCoins > 0 && (
                      <span
                        className="text-xs px-2.5 py-1 rounded-full font-bold text-white shadow whitespace-nowrap"
                        style={{ background: 'var(--gold)' }}
                      >
                        🪙 {L.bonusCoins(bonusCoins)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 leading-snug">
                    {isHi ? grading.feedback_hi : grading.feedback_en}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Coin balance ── */}
        <div className="px-5 sm:px-7 pt-3">
          <p className="text-[11px] text-gray-400 text-center">
            {L.coinBalance}:{' '}
            <span
              className="font-semibold transition-all duration-500"
              style={{ color: bonusCoins > 0 ? 'var(--gold)' : '#4B5563' }}
            >
              🪙 {animatedBalance}
            </span>
          </p>
        </div>

        {/* ── CTAs ── */}
        <div className="px-5 sm:px-7 pt-4 pb-6 sm:pb-7 flex flex-col gap-2">
          <button
            ref={continueBtnRef}
            onClick={onClose}
            className="w-full py-3 text-white rounded-xl text-sm font-semibold transition-all active:scale-[0.98] min-h-[44px]"
            style={{
              background: 'linear-gradient(135deg, var(--accent-warm), var(--accent-warm-strong))',
              boxShadow: '0 4px 18px rgb(var(--accent-warm-rgb) / 0.28)',
            }}
          >
            {L.continueBtn}
          </button>
          {onNextLab && (
            <button
              onClick={onNextLab}
              className="w-full py-3 bg-white rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] min-h-[44px]"
              style={{
                color: 'var(--accent-warm)',
                border: '2px solid color-mix(in srgb, var(--accent-warm) 22%, transparent)',
              }}
            >
              {L.tryAnother}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
