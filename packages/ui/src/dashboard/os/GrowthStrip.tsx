'use client';

/**
 * GrowthStrip — the "What improved" surface (Phase 3a). Sits directly under the
 * primary action and answers "am I getting better?" with the SINGLE strongest
 * POSITIVE signal available. Growth-mindset framing only: it NEVER renders a
 * negative delta — when nothing positive exists yet it shows an encouraging
 * effort line instead.
 *
 * Read-only presentation over existing, engine-decided values:
 *   - mastered-topic count  ← countBuckets(useMasteryOverview) (classification
 *                              of engine mastery levels — NOT a recomputation)
 *   - streak / total XP     ← server values (students.streak_days / xp_total)
 *                              passed down; never client-counted (P1/P2).
 *
 * Priority (first positive wins): mastered > 0 → streak ≥ 2 → XP > 0 → effort.
 * Token-only + canonical primitives (Card + Badge). Bilingual via `isHi` (P7).
 */

import { useMasteryOverview } from '@alfanumrik/lib/swr';
import { countBuckets, type MasteryOverviewRow } from '@alfanumrik/lib/dashboard/mastery-buckets';
import { Card, CardBody, Badge } from '@alfanumrik/ui/ui/primitives';
import type { Tone } from '@alfanumrik/ui/ui/primitives';

interface GrowthStripProps {
  isHi: boolean;
  studentId: string | undefined;
  /** Server value (students.streak_days) — never client-counted. */
  streak: number;
  /** Server value (students.xp_total) — never client-summed. */
  totalXp: number;
}

interface GrowthSignal {
  tone: Tone;
  glyph: string;
  label: string;
  text: string;
}

export default function GrowthStrip({ isHi, studentId, streak, totalXp }: GrowthStripProps) {
  const { data } = useMasteryOverview(studentId);
  const rows = (data as MasteryOverviewRow[] | undefined) ?? [];
  const mastered = countBuckets(rows).mastered;

  let signal: GrowthSignal;
  if (mastered > 0) {
    signal = {
      tone: 'success',
      glyph: '✓',
      label: isHi ? 'बढ़त' : 'Growth',
      text: isHi
        ? `तुमने अब तक ${mastered} ${mastered === 1 ? 'विषय' : 'विषयों'} में महारत पाई — शानदार गति!`
        : `You've mastered ${mastered} topic${mastered === 1 ? '' : 's'} so far — great momentum!`,
    };
  } else if (streak >= 2) {
    signal = {
      tone: 'warning',
      glyph: '🔥',
      label: isHi ? 'लय' : 'Streak',
      text: isHi
        ? `${streak} दिन की लय — इसे जारी रखो!`
        : `${streak}-day streak — keep it alive!`,
    };
  } else if (totalXp > 0) {
    signal = {
      tone: 'warning',
      glyph: '⚡',
      label: 'XP',
      text: isHi
        ? `अब तक ${totalXp.toLocaleString('en-IN')} XP कमाए — हर कदम मायने रखता है।`
        : `${totalXp.toLocaleString('en-IN')} XP earned so far — every step counts.`,
    };
  } else {
    signal = {
      tone: 'info',
      glyph: '🌱',
      label: isHi ? 'शुरुआत' : 'Start',
      text: isHi
        ? 'हर विशेषज्ञ ने यहीं से शुरुआत की थी — आज पहला कदम बढ़ाओ।'
        : 'Every expert started right here — take your first step today.',
    };
  }

  return (
    <Card variant="flat" aria-label={isHi ? 'तुम्हारी बढ़त' : 'What improved'}>
      <CardBody className="flex items-center gap-3 py-3">
        <span aria-hidden="true" className="text-fluid-2xl">
          {signal.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <Badge tone={signal.tone} variant="soft">
            {signal.label}
          </Badge>
          <p className="mt-1 text-fluid-sm font-semibold text-foreground">{signal.text}</p>
        </div>
      </CardBody>
    </Card>
  );
}
