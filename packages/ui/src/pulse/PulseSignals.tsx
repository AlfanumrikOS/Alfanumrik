'use client';

// src/components/pulse/PulseSignals.tsx
//
// The three Pulse signals (inactivity / mastery-cliff / at-risk-concentration)
// rendered as clear, colour-coded chips. Each chip pairs a COLOUR with an ICON
// and a TEXT label so a signal is never communicated by colour alone
// (accessibility). The verdicts are read verbatim from the frozen contract
// (`PulseResponse.signals`); this component computes no signal math.
//
// P7 bilingual via `isHi`. `variant` shifts tone (encouraging for students,
// actionable for teacher/principal) — see pulse-copy.ts.

import type { PulseSignals as PulseSignalsType } from '@alfanumrik/lib/pulse/types';
import {
  inactivityToken,
  masteryCliffToken,
  concentrationToken,
  tp,
  type PulseVariant,
} from './pulse-copy';

interface PulseSignalsProps {
  signals: PulseSignalsType;
  isHi: boolean;
  variant: PulseVariant;
  /** Compact mode (smaller chips, no detail line) for dense list rows. */
  compact?: boolean;
}

function SignalChip({
  icon,
  label,
  color,
  detail,
  compact,
}: {
  icon: string;
  label: string;
  color: string;
  detail?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
        style={{ background: `${color}14`, border: `1px solid ${color}33`, color }}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </span>
    );
  }
  return (
    <div
      className="rounded-xl px-3 py-2.5 flex items-start gap-2"
      style={{ background: `${color}0F`, border: `1px solid ${color}2E` }}
    >
      <span className="text-base leading-none mt-0.5" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold" style={{ color }}>
          {label}
        </div>
        {detail && (
          <div className="text-[11px] text-[var(--text-3)] mt-0.5 leading-snug">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PulseSignals({
  signals,
  isHi,
  variant,
  compact = false,
}: PulseSignalsProps) {
  const inact = inactivityToken(signals.inactivity.verdict, isHi, variant);
  const cliff = masteryCliffToken(signals.masteryCliff.verdict, isHi, variant);
  const conc = concentrationToken(
    signals.atRiskConcentration.worstBand,
    isHi,
    variant,
  );

  // Detail lines (full mode only) — derived from contract counts, no new math.
  const totalAtRisk = signals.atRiskConcentration.totalAtRiskChapters;
  const concDetail =
    totalAtRisk > 0
      ? tp(
          isHi,
          `${totalAtRisk} chapter${totalAtRisk === 1 ? '' : 's'} below the at-risk line`,
          `${totalAtRisk} अध्याय जोखिम रेखा से नीचे`,
        )
      : tp(isHi, 'All chapters above the at-risk line', 'सभी अध्याय जोखिम रेखा से ऊपर');

  const cliffDetail =
    signals.masteryCliff.verdict === 'flagged' && signals.masteryCliff.worstSubject
      ? tp(
          isHi,
          `Biggest drop in ${signals.masteryCliff.worstSubject}`,
          `सबसे बड़ी गिरावट ${signals.masteryCliff.worstSubject} में`,
        )
      : undefined;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5" role="list" aria-label={isHi ? 'पल्स संकेत' : 'Pulse signals'}>
        <span role="listitem">
          <SignalChip icon={inact.icon} label={inact.label} color={inact.color} compact />
        </span>
        <span role="listitem">
          <SignalChip icon={cliff.icon} label={cliff.label} color={cliff.color} compact />
        </span>
        <span role="listitem">
          <SignalChip icon={conc.icon} label={conc.label} color={conc.color} compact />
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="list" aria-label={isHi ? 'पल्स संकेत' : 'Pulse signals'}>
      <div role="listitem">
        <SignalChip icon={inact.icon} label={inact.label} color={inact.color} />
      </div>
      <div role="listitem">
        <SignalChip icon={cliff.icon} label={cliff.label} color={cliff.color} detail={cliffDetail} />
      </div>
      <div role="listitem">
        <SignalChip icon={conc.icon} label={conc.label} color={conc.color} detail={concDetail} />
      </div>
    </div>
  );
}
