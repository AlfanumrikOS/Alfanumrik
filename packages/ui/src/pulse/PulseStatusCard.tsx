'use client';

// src/components/pulse/PulseStatusCard.tsx
//
// The headline Pulse card: one coarse status badge + a small stat strip
// (XP / level / streak / last-active / live-session). The STATUS is read
// verbatim from the frozen contract (`PulseResponse.status`); the optional
// vitals (xp/level/streak/lastActiveLabel/liveSession) are passed in by the
// host surface — for the SELF lens these come from AuthContext's snapshot, for
// other lenses they may be omitted (the card degrades gracefully and never
// fabricates numbers).
//
// P7 bilingual via `isHi`. Accessible: status is colour + icon + text (never
// colour-alone). No scoring/XP math here — values are displayed verbatim.

import type { PulseResponse } from '@alfanumrik/lib/pulse/types';
import {
  statusToken,
  statusBlurb,
  inactivityToken,
  type PulseVariant,
} from './pulse-copy';

export interface PulseVitals {
  /** Total XP (server value, displayed verbatim). */
  xp?: number | null;
  /** Level name/number (server-derived; displayed verbatim). */
  level?: string | number | null;
  /** Current streak in days (server value). */
  streakDays?: number | null;
  /** Whether the learner is in a live session right now (host-provided). */
  liveSession?: boolean;
}

interface PulseStatusCardProps {
  pulse: PulseResponse;
  isHi: boolean;
  variant: PulseVariant;
  /** Optional headline name (e.g. the child/student name for non-self lenses). */
  displayName?: string;
  /** Optional vitals strip (XP/level/streak/live). Omitted ⇒ those tiles hide. */
  vitals?: PulseVitals;
}

function Vital({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center text-center min-w-0">
      <span className="text-lg leading-none" aria-hidden="true">
        {icon}
      </span>
      <span
        className="text-base font-bold mt-0.5 tabular-nums truncate max-w-full"
        style={{ color }}
      >
        {value}
      </span>
      <span className="text-[10px] text-[var(--text-3)] mt-0.5">{label}</span>
    </div>
  );
}

export default function PulseStatusCard({
  pulse,
  isHi,
  variant,
  displayName,
  vitals,
}: PulseStatusCardProps) {
  const st = statusToken(pulse.status, isHi, variant);
  const blurb = statusBlurb(pulse.status, isHi, variant);
  const inact = inactivityToken(pulse.signals.inactivity.verdict, isHi, variant);

  const days = pulse.signals.inactivity.daysSinceActive;
  const lastActiveLabel =
    pulse.signals.inactivity.verdict === 'ok'
      ? (isHi ? 'आज' : 'Today')
      : pulse.signals.inactivity.verdict === 'never'
        ? '—'
        : days != null
          ? isHi
            ? `${days} दिन पहले`
            : `${days}d ago`
          : '—';

  const showXp = vitals?.xp != null;
  const showLevel = vitals?.level != null && vitals.level !== '';
  const showStreak = vitals?.streakDays != null;

  return (
    <section
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: 'var(--surface-1, #fff)',
        border: `1px solid ${st.color}33`,
        boxShadow: 'var(--shadow-md)',
      }}
      aria-label={isHi ? 'पल्स स्थिति' : 'Pulse status'}
    >
      {/* accent glow in the status colour */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at top right, ${st.color}22 0%, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {displayName && (
              <p className="text-sm font-semibold text-[var(--text-2)] truncate">
                {displayName}
              </p>
            )}
            <h3
              className="text-lg font-bold mt-0.5"
              style={{ fontFamily: 'var(--font-display)', color: st.color }}
            >
              <span aria-hidden="true">{st.icon}</span> {st.label}
            </h3>
            <p className="text-xs text-[var(--text-2)] mt-1 leading-relaxed max-w-prose">
              {blurb}
            </p>
          </div>

          {/* Live-session pill (only when explicitly true) */}
          {vitals?.liveSession && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold shrink-0"
              style={{ background: '#16A34A18', color: '#16A34A', border: '1px solid #16A34A33' }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: '#16A34A' }}
                aria-hidden="true"
              />
              {isHi ? 'अभी ऑनलाइन' : 'Live now'}
            </span>
          )}
        </div>

        {/* Vitals strip */}
        <div
          className="grid gap-2 mt-3 pt-3"
          style={{
            borderTop: '1px solid var(--border, #e5e7eb)',
            gridTemplateColumns: `repeat(${
              2 + (showXp ? 1 : 0) + (showLevel ? 1 : 0) + (showStreak ? 1 : 0)
            }, minmax(0, 1fr))`,
          }}
        >
          {showXp && (
            <Vital
              icon="⭐"
              label="XP"
              value={Number(vitals!.xp).toLocaleString()}
              color="#F97316"
            />
          )}
          {showLevel && (
            <Vital
              icon="🏅"
              label={isHi ? 'स्तर' : 'Level'}
              value={String(vitals!.level)}
              color="#7C3AED"
            />
          )}
          {showStreak && (
            <Vital
              icon="🔥"
              label={isHi ? 'स्ट्रीक' : 'Streak'}
              value={`${vitals!.streakDays}${isHi ? '' : 'd'}`}
              color="#DC2626"
            />
          )}
          <Vital
            icon={inact.icon}
            label={isHi ? 'अंतिम सक्रिय' : 'Last active'}
            value={lastActiveLabel}
            color={inact.color}
          />
          <Vital
            icon="🩺"
            label={isHi ? 'पल्स' : 'Pulse'}
            value={st.label}
            color={st.color}
          />
        </div>
      </div>
    </section>
  );
}
