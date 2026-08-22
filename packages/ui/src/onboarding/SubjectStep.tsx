'use client';

import { useMemo } from 'react';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';

/**
 * SubjectStep — during onboarding, lets the student pick their subjects within
 * the subjects the subjects service says they're allowed.
 *
 * It still HONOURS a `max_subjects` cap when one is supplied (disabling further
 * picks with a live counter), but no B2C plan supplies one any more: every plan
 * has `max_subjects` NULL since migration 20260814000018, so `maxSubjects` is
 * null and the counter reads a plain "N selected". The cap branch is retained
 * for a future server-supplied limit, not for the four consumer tiers.
 */

interface SubjectStepProps {
  value: string[];
  onChange: (next: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  isHi: boolean;
  /** Plan-driven cap. `null` means unlimited. */
  maxSubjects: number | null;
}

/**
 * Fallback map used when the caller can't yet read max_subjects from the server.
 *
 * ALL NULL SINCE 2026-08-11, AND THAT IS THE POINT. This map read
 * `free: 2, starter: 4` while `subscription_plans.max_subjects` IS NULL on all
 * four plans (migration 20260814000018) — so a free student picking subjects in
 * onboarding was disabled at 2 and shown "Plan limit reached — upgrade to add
 * more subjects" for a limit the server does not enforce. The fallback must
 * mirror the DB, and the DB caps nothing.
 *
 * This is the CONSERVATIVE direction only when it matches the server: the real
 * cap still lives server-side (`/api/student/preferences` surfaces the RPC's
 * `max_subjects_exceeded`), so nothing is over-granted by removing a stale
 * client guess.
 *
 * Pinned by apps/host/src/__tests__/plan-subject-count-copy-guard.test.ts.
 */
export const PLAN_SUBJECT_CAPS: Record<string, number | null> = {
  free: null,
  starter: null,
  pro: null,
  unlimited: null,
};

export default function SubjectStep({
  value,
  onChange,
  onNext,
  onBack,
  isHi,
  maxSubjects,
}: SubjectStepProps) {
  const { unlocked: allowedSubjects, isLoading } = useAllowedSubjects();

  const capReached = maxSubjects !== null && value.length >= maxSubjects;

  const counterText = useMemo(() => {
    if (maxSubjects === null) {
      return isHi ? `${value.length} चयनित` : `${value.length} selected`;
    }
    return isHi
      ? `${value.length} / ${maxSubjects} चयनित`
      : `${value.length} of ${maxSubjects} selected`;
  }, [value.length, maxSubjects, isHi]);

  const toggle = (code: string) => {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
      return;
    }
    if (capReached) return; // hard cap — disabled buttons shouldn't fire, this is belt+suspenders
    onChange([...value, code]);
  };

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'अपने विषय चुनें' : 'Choose your subjects'}
        </h2>
        <p className="text-xs text-[var(--text-3)] mt-1">{counterText}</p>
      </div>

      {isLoading && allowedSubjects.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--text-3)]">
          {isHi ? 'विषय लोड हो रहे हैं…' : 'Loading subjects…'}
        </div>
      ) : allowedSubjects.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--text-3)]">
          {isHi
            ? 'कोई विषय उपलब्ध नहीं। व्यवस्थापक से संपर्क करें।'
            : 'No subjects available yet. Please contact support.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {allowedSubjects.map((s) => {
            const selected = value.includes(s.code);
            const disabled = !selected && capReached;
            return (
              <button
                key={s.code}
                onClick={() => toggle(s.code)}
                disabled={disabled}
                aria-pressed={selected}
                className="p-3 rounded-xl text-left flex items-center gap-2 transition-all active:scale-[0.97] disabled:opacity-40"
                style={{
                  background: selected ? `${s.color}12` : 'var(--surface-2)',
                  border: `1.5px solid ${selected ? s.color : 'var(--border)'}`,
                }}
              >
                <span className="text-lg">{s.icon}</span>
                <span className="text-sm font-semibold" style={{ color: selected ? s.color : 'var(--text-2)' }}>
                  {isHi ? s.nameHi || s.name : s.name}
                </span>
                {selected && (
                  <span className="ml-auto text-xs" style={{ color: s.color }} aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {capReached && (
        <p className="mt-3 text-[11px] text-[var(--text-3)] text-center">
          {/* No longer an upsell. The old copy read "upgrade to add more
              subjects", promising a subject unlock that no paid plan actually
              grants (every plan already has every subject). This branch only
              renders if a server-supplied cap exists, so it now just states
              the fact. */}
          {isHi
            ? 'आपने अपनी योजना की अधिकतम सीमा चुन ली है'
            : 'You have selected the maximum for your plan'}
        </p>
      )}

      <button
        type="button"
        disabled={value.length === 0}
        onClick={onNext}
        className="w-full mt-6 py-3 rounded-xl text-sm font-bold text-on-accent transition-all disabled:opacity-40"
        style={{ background: 'var(--accent-warm-strong)' }}
      >
        {isHi ? 'आगे बढ़ो' : 'Continue'}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="w-full mt-2 text-sm text-[var(--text-3)] py-2"
      >
        {isHi ? '← वापस जाओ' : '← Go back'}
      </button>
    </div>
  );
}
