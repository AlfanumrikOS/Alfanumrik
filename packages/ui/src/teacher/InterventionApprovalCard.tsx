'use client';

/**
 * InterventionApprovalCard — K4/K7 "Suggested interventions" panel row.
 *
 * The server (teacher-dashboard `get_in_the_moment_alerts`) proposes a tiered
 * intervention: tier1 (small nudge), tier2 (focused practice), tier3 (concept
 * re-teach), each with a student list and a recommended action. The teacher
 * approves the recommended tier, overrides to a different tier, or dismisses —
 * with a reason code. The action fires `record_intervention_decision`; the
 * server owns the decision persistence.
 *
 * PRESENTATION + one POST. No scoring/mastery math. P7 bilingual. P13 no PII
 * in client logs.
 */

import { useState } from 'react';

export type InterventionTier = 'tier1' | 'tier2' | 'tier3';

export interface InterventionTierRow {
  tier: InterventionTier;
  students: Array<{ id: string; name: string }>;
  recommended_action: string;
}

export interface InterventionSuggestion {
  intervention_id: string;
  concept_code?: string;
  concept_title?: string;
  recommended_tier: InterventionTier;
  tiers: InterventionTierRow[];
}

export type InterventionReasonCode =
  | 'too_easy'
  | 'too_hard'
  | 'timing'
  | 'knows_student'
  | 'other';

export interface InterventionDecision {
  intervention_id: string;
  decision: 'approved' | 'overridden' | 'dismissed';
  chosen_tier?: InterventionTier;
  reason_code: InterventionReasonCode;
}

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const TIER_LABEL: Record<InterventionTier, { en: string; hi: string }> = {
  tier1: { en: 'Tier 1 · Nudge', hi: 'टियर 1 · संकेत' },
  tier2: { en: 'Tier 2 · Practice', hi: 'टियर 2 · अभ्यास' },
  tier3: { en: 'Tier 3 · Re-teach', hi: 'टियर 3 · पुनः पढ़ाएं' },
};

const REASON_LABEL: Record<InterventionReasonCode, { en: string; hi: string }> = {
  too_easy: { en: 'Too easy for these students', hi: 'इन छात्रों के लिए बहुत आसान' },
  too_hard: { en: 'Too hard right now', hi: 'अभी बहुत कठिन' },
  timing: { en: 'Bad timing', hi: 'गलत समय' },
  knows_student: { en: 'I know these students', hi: 'मैं इन छात्रों को जानती/जानता हूँ' },
  other: { en: 'Other', hi: 'अन्य' },
};

export function InterventionApprovalCard({
  suggestion,
  isHi,
  onDecision,
  busy,
}: {
  suggestion: InterventionSuggestion;
  isHi: boolean;
  onDecision: (d: InterventionDecision) => void | Promise<void>;
  busy?: boolean;
}) {
  const [reasonPickerFor, setReasonPickerFor] =
    useState<null | { mode: 'override' | 'dismiss'; tier?: InterventionTier }>(null);
  const [chosenReason, setChosenReason] =
    useState<InterventionReasonCode>('other');

  const submit = (
    decision: InterventionDecision['decision'],
    reason_code: InterventionReasonCode,
    chosen_tier?: InterventionTier,
  ) => {
    void onDecision({
      intervention_id: suggestion.intervention_id,
      decision,
      chosen_tier,
      reason_code,
    });
    setReasonPickerFor(null);
  };

  return (
    <div
      data-testid="intervention-approval-card"
      className="rounded-xl p-3 border-l-[3px]"
      style={{
        background: 'var(--surface-2)',
        borderLeftColor: 'var(--orange)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold m-0" style={{ color: 'var(--text-1)' }}>
            {suggestion.concept_title ?? suggestion.concept_code ??
              t(isHi, 'Suggested intervention', 'सुझाया गया हस्तक्षेप')}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {t(isHi, 'Recommended', 'सुझाव')}:{' '}
            {TIER_LABEL[suggestion.recommended_tier][isHi ? 'hi' : 'en']}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {suggestion.tiers.map((row) => {
          const isRec = row.tier === suggestion.recommended_tier;
          return (
            <div
              key={row.tier}
              className="rounded-md p-2 text-[12px] flex items-center gap-2"
              style={{
                background: isRec
                  ? 'color-mix(in srgb, var(--orange) 12%, transparent)'
                  : 'var(--surface-1)',
                border: '1px solid var(--border)',
              }}
            >
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {TIER_LABEL[row.tier][isHi ? 'hi' : 'en']}
              </span>
              <span
                className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold text-white"
                style={{ background: 'var(--purple)' }}
              >
                {row.students.length}
              </span>
              <span className="flex-1 truncate" style={{ color: 'var(--text-3)' }}>
                {row.recommended_action}
              </span>
            </div>
          );
        })}
      </div>

      {reasonPickerFor == null ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5 justify-end">
          <button
            type="button"
            onClick={() =>
              submit('approved', 'other', suggestion.recommended_tier)
            }
            disabled={busy}
            data-testid="intervention-approve-btn"
            className="py-1 px-2.5 rounded-md text-[11px] font-semibold border-none cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--success, #059669)', color: 'white' }}
          >
            {t(isHi, 'Approve', 'स्वीकार करें')}
          </button>
          <button
            type="button"
            onClick={() => setReasonPickerFor({ mode: 'override' })}
            disabled={busy}
            data-testid="intervention-override-btn"
            className="py-1 px-2.5 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
            }}
          >
            {t(isHi, 'Change tier', 'टियर बदलें')}
          </button>
          <button
            type="button"
            onClick={() => setReasonPickerFor({ mode: 'dismiss' })}
            disabled={busy}
            data-testid="intervention-dismiss-btn"
            className="py-1 px-2.5 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--danger, #DC2626)',
              border: '1px solid var(--danger, #DC2626)',
            }}
          >
            {t(isHi, 'Dismiss', 'खारिज करें')}
          </button>
        </div>
      ) : (
        <div
          data-testid="intervention-reason-picker"
          className="mt-2.5 rounded-md p-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-[11px] uppercase tracking-wide font-bold m-0 mb-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            {t(isHi, 'Reason', 'कारण')}
          </p>
          <select
            value={chosenReason}
            onChange={(e) =>
              setChosenReason(e.target.value as InterventionReasonCode)
            }
            className="w-full rounded-md text-[12px] py-1 px-2 outline-none mb-2"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            {(Object.keys(REASON_LABEL) as InterventionReasonCode[]).map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r][isHi ? 'hi' : 'en']}
              </option>
            ))}
          </select>
          {reasonPickerFor.mode === 'override' && (
            <div className="flex flex-wrap gap-1 mb-2">
              {suggestion.tiers.map((row) => (
                <button
                  key={row.tier}
                  type="button"
                  onClick={() => submit('overridden', chosenReason, row.tier)}
                  disabled={busy}
                  className="py-1 px-2 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                  style={{
                    background: 'var(--purple)',
                    color: 'white',
                    border: 'none',
                  }}
                >
                  {TIER_LABEL[row.tier][isHi ? 'hi' : 'en']}
                </button>
              ))}
            </div>
          )}
          {reasonPickerFor.mode === 'dismiss' && (
            <button
              type="button"
              onClick={() => submit('dismissed', chosenReason)}
              disabled={busy}
              className="py-1 px-2.5 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--danger, #DC2626)', color: 'white', border: 'none' }}
            >
              {t(isHi, 'Confirm dismiss', 'खारिज करना पक्का')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setReasonPickerFor(null)}
            className="ml-1 py-1 px-2 rounded-md text-[11px] font-semibold cursor-pointer"
            style={{
              background: 'transparent',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
            }}
          >
            {t(isHi, 'Cancel', 'रद्द')}
          </button>
        </div>
      )}
    </div>
  );
}

export default InterventionApprovalCard;
