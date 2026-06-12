// src/components/pulse/pulse-copy.ts
//
// Student Pulse — bilingual copy + presentation tokens (P7).
//
// PURE presentation layer for the Pulse components. It maps the FROZEN contract
// verdicts/statuses (`PulseStatus`, `InactivityVerdict`, `MasteryCliffVerdict`,
// `ConcentrationBand`) onto friendly Hindi/English labels, an accessible colour,
// and a short icon. It computes NO signal math — that lives in
// `src/lib/pulse/signals.ts` (server-owned). It only RENDERS what the contract
// already decided.
//
// Rules honoured here:
//   - P7: every learner-facing string has a Hi + En form. Technical terms (XP,
//     CBSE, Bloom's) are NOT translated.
//   - Accessibility: colour is ALWAYS paired with a text label and an icon, so a
//     signal is never communicated by colour alone.
//   - Brand: status/signal colours use the platform tokens (orange #F97316,
//     purple #7C3AED) plus the standard semantic green/amber/red used across the
//     existing progress + command-center surfaces.
//
// `variant` lets a lens shift TONE without changing the underlying verdict:
//   - 'student'   → encouraging, first-person ("You're on a roll!").
//   - 'parent'    → warm third-person about the child.
//   - 'teacher' / 'principal' → neutral, actionable triage language.

import type {
  PulseStatus,
  InactivityVerdict,
  MasteryCliffVerdict,
  ConcentrationBand,
} from '@/lib/pulse/types';

export type PulseVariant = 'student' | 'parent' | 'teacher' | 'principal';

/** Pick the Hi or En string. Tiny local helper mirroring the page-level `tt`. */
export const tp = (isHi: boolean, en: string, hi: string): string => (isHi ? hi : en);

// ── Brand / semantic colour tokens (hex so they work in inline styles + SVG) ──
export const PULSE_COLORS = {
  thriving: '#16A34A', // green
  steady: '#7C3AED', // purple (brand)
  watch: '#F59E0B', // amber
  at_risk: '#DC2626', // red
  unknown: '#64748B', // slate
  // signal-specific accents
  ok: '#16A34A',
  grace: '#F59E0B',
  broken: '#DC2626',
  flagged: '#DC2626',
  none: '#16A34A',
  low: '#F59E0B',
  medium: '#EA580C',
  high: '#DC2626',
} as const;

// ════════════════════════════════════════════════════════════════════════════
// STATUS (the one coarse badge)
// ════════════════════════════════════════════════════════════════════════════

interface LabelToken {
  /** Short, accessible label (paired with colour + icon, never colour-alone). */
  label: string;
  color: string;
  /** Decorative icon (aria-hidden at the call site). */
  icon: string;
}

export function statusToken(
  status: PulseStatus,
  isHi: boolean,
  variant: PulseVariant = 'student',
): LabelToken {
  const self = variant === 'student';
  switch (status) {
    case 'thriving':
      return {
        color: PULSE_COLORS.thriving,
        icon: '🌟',
        label: self
          ? tp(isHi, 'Thriving', 'शानदार')
          : tp(isHi, 'Thriving', 'शानदार'),
      };
    case 'steady':
      return {
        color: PULSE_COLORS.steady,
        icon: '🙂',
        label: tp(isHi, 'Steady', 'स्थिर'),
      };
    case 'watch':
      return {
        color: PULSE_COLORS.watch,
        icon: '👀',
        label: tp(isHi, 'Keep an eye', 'ध्यान दें'),
      };
    case 'at_risk':
      return {
        color: PULSE_COLORS.at_risk,
        icon: '⚠️',
        label: tp(isHi, 'Needs attention', 'ध्यान चाहिए'),
      };
    case 'unknown':
    default:
      return {
        color: PULSE_COLORS.unknown,
        icon: '🌱',
        label: self
          ? tp(isHi, 'Just getting started', 'अभी शुरुआत है')
          : tp(isHi, 'Not enough data yet', 'अभी पर्याप्त डेटा नहीं'),
      };
  }
}

/** One-line, tone-aware sub-headline for the status card. */
export function statusBlurb(
  status: PulseStatus,
  isHi: boolean,
  variant: PulseVariant,
): string {
  const self = variant === 'student';
  switch (status) {
    case 'thriving':
      return self
        ? tp(isHi, "You're on a roll — keep it up!", 'तुम बढ़िया कर रहे हो — ऐसे ही जारी रखो!')
        : tp(isHi, 'Learning consistently with no risk signals.', 'लगातार सीख रहे हैं, कोई जोखिम संकेत नहीं।');
    case 'steady':
      return self
        ? tp(isHi, 'Solid progress. One small thing to watch.', 'अच्छी प्रगति। एक छोटी बात पर नज़र रखो।')
        : tp(isHi, 'Steady progress with one minor signal.', 'एक छोटे संकेत के साथ स्थिर प्रगति।');
    case 'watch':
      return self
        ? tp(isHi, "Let's get back on track today.", 'आज फिर से पटरी पर लौटें।')
        : tp(isHi, 'A meaningful signal is forming — worth a look.', 'एक अहम संकेत बन रहा है — देखने लायक।');
    case 'at_risk':
      return self
        ? tp(isHi, 'A quick session today will help a lot.', 'आज एक छोटा सत्र बहुत मदद करेगा।')
        : tp(isHi, 'A strong risk signal is active — act soon.', 'एक मज़बूत जोखिम संकेत सक्रिय है — जल्दी कार्रवाई करें।');
    case 'unknown':
    default:
      return self
        ? tp(isHi, 'Take a quiz and your Pulse will light up.', 'एक क्विज़ लो और तुम्हारा Pulse चमक उठेगा।')
        : tp(isHi, "Not enough recent activity to read a Pulse.", 'Pulse पढ़ने के लिए पर्याप्त हाल की गतिविधि नहीं।');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SIGNAL 1 — INACTIVITY
// ════════════════════════════════════════════════════════════════════════════

export function inactivityToken(
  verdict: InactivityVerdict,
  isHi: boolean,
  variant: PulseVariant,
): LabelToken {
  const self = variant === 'student';
  switch (verdict) {
    case 'ok':
      return {
        color: PULSE_COLORS.ok,
        icon: '🔥',
        label: self
          ? tp(isHi, 'Active today', 'आज सक्रिय')
          : tp(isHi, 'Active today', 'आज सक्रिय'),
      };
    case 'at_risk':
      return {
        color: PULSE_COLORS.grace,
        icon: '⏳',
        label: self
          ? tp(isHi, 'Study today to keep your streak', 'स्ट्रीक बचाने के लिए आज पढ़ो')
          : tp(isHi, 'Streak at risk (grace day)', 'स्ट्रीक जोखिम में (छूट का दिन)'),
      };
    case 'broken':
      return {
        color: PULSE_COLORS.broken,
        icon: '💤',
        label: self
          ? tp(isHi, 'Streak paused — restart today', 'स्ट्रीक रुकी — आज फिर शुरू करो')
          : tp(isHi, 'Inactive 2+ days', '2+ दिन से निष्क्रिय'),
      };
    case 'never':
      return {
        color: PULSE_COLORS.unknown,
        icon: '🌱',
        label: self
          ? tp(isHi, 'No activity yet', 'अभी कोई गतिविधि नहीं')
          : tp(isHi, 'No activity recorded', 'कोई गतिविधि दर्ज नहीं'),
      };
    case 'unknown':
    default:
      return {
        color: PULSE_COLORS.unknown,
        icon: '❔',
        label: tp(isHi, 'Activity unknown', 'गतिविधि अज्ञात'),
      };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SIGNAL 2 — MASTERY CLIFF
// ════════════════════════════════════════════════════════════════════════════

export function masteryCliffToken(
  verdict: MasteryCliffVerdict,
  isHi: boolean,
  variant: PulseVariant,
): LabelToken {
  const self = variant === 'student';
  switch (verdict) {
    case 'flagged':
      return {
        color: PULSE_COLORS.flagged,
        icon: '📉',
        label: self
          ? tp(isHi, 'A topic slipped — revise it', 'एक टॉपिक कमज़ोर हुआ — दोहराओ')
          : tp(isHi, 'Mastery dropped', 'महारत गिरी'),
      };
    case 'none':
      return {
        color: PULSE_COLORS.none,
        icon: '📈',
        label: self
          ? tp(isHi, 'Mastery holding steady', 'महारत स्थिर है')
          : tp(isHi, 'No mastery drop', 'महारत में गिरावट नहीं'),
      };
    case 'unknown':
    default:
      return {
        color: PULSE_COLORS.unknown,
        icon: '❔',
        label: tp(isHi, 'Not enough history', 'पर्याप्त इतिहास नहीं'),
      };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SIGNAL 3 — AT-RISK CONCENTRATION
// ════════════════════════════════════════════════════════════════════════════

export function concentrationToken(
  band: ConcentrationBand,
  isHi: boolean,
  variant: PulseVariant,
): LabelToken {
  const self = variant === 'student';
  switch (band) {
    case 'high':
      return {
        color: PULSE_COLORS.high,
        icon: '🧱',
        label: self
          ? tp(isHi, 'A subject needs real focus', 'एक विषय पर पूरा ध्यान चाहिए')
          : tp(isHi, 'High at-risk cluster', 'उच्च जोखिम समूह'),
      };
    case 'medium':
      return {
        color: PULSE_COLORS.medium,
        icon: '🪨',
        label: self
          ? tp(isHi, 'A weak spot is forming', 'एक कमज़ोर क्षेत्र बन रहा है')
          : tp(isHi, 'Forming at-risk cluster', 'बनता जोखिम समूह'),
      };
    case 'low':
      return {
        color: PULSE_COLORS.low,
        icon: '🔸',
        label: self
          ? tp(isHi, 'A chapter or two to brush up', 'एक-दो अध्याय दोहराने हैं')
          : tp(isHi, 'A few weak chapters', 'कुछ कमज़ोर अध्याय'),
      };
    case 'none':
    default:
      return {
        color: PULSE_COLORS.none,
        icon: '✅',
        label: self
          ? tp(isHi, 'No big weak spots', 'कोई बड़ा कमज़ोर क्षेत्र नहीं')
          : tp(isHi, 'No at-risk cluster', 'कोई जोखिम समूह नहीं'),
      };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TIMELINE — humanise a `state_events.kind` into a readable line
// ════════════════════════════════════════════════════════════════════════════

/**
 * Map a timeline entry `kind` (+ its whitelisted non-PII summary) to a short,
 * human-readable bilingual line. Unknown kinds degrade to a clean fallback so
 * the timeline never shows a raw event name to a learner.
 */
export function timelineLine(
  kind: string,
  summary: Record<string, string | number | boolean | null>,
  isHi: boolean,
): { icon: string; text: string } {
  const subject =
    typeof summary.subject === 'string'
      ? summary.subject
      : typeof summary.subjectCode === 'string'
        ? summary.subjectCode
        : null;
  const chapter =
    typeof summary.chapter === 'number'
      ? summary.chapter
      : typeof summary.chapterNumber === 'number'
        ? summary.chapterNumber
        : null;
  const score = typeof summary.score === 'number' ? summary.score : null;
  const subjLabel = subject ? ` · ${subject}` : '';
  const chLabel =
    chapter != null ? ` ${tp(isHi, 'Ch.', 'अध्याय')} ${chapter}` : '';

  switch (kind) {
    case 'learner.quiz_completed':
      return {
        icon: '📝',
        text:
          score != null
            ? tp(isHi, `Completed a quiz — ${score}%${subjLabel}`, `क्विज़ पूरी की — ${score}%${subjLabel}`)
            : tp(isHi, `Completed a quiz${subjLabel}`, `क्विज़ पूरी की${subjLabel}`),
      };
    case 'learner.mastery_changed':
      return {
        icon: '🎯',
        text: tp(
          isHi,
          `Mastery updated${subjLabel}${chLabel}`,
          `महारत अपडेट हुई${subjLabel}${chLabel}`,
        ),
      };
    case 'learner.streak_extended':
      return {
        icon: '🔥',
        text: tp(isHi, 'Extended a learning streak', 'सीखने की स्ट्रीक बढ़ाई'),
      };
    case 'learner.lesson_completed':
      return {
        icon: '📘',
        text: tp(isHi, `Finished a lesson${subjLabel}`, `एक पाठ पूरा किया${subjLabel}`),
      };
    case 'learner.review_completed':
      return {
        icon: '🔁',
        text: tp(isHi, 'Completed a revision session', 'एक रिवीज़न सत्र पूरा किया'),
      };
    case 'learner.foxy_session':
      return {
        icon: '🦊',
        text: tp(isHi, 'Learned with Foxy', 'Foxy के साथ सीखा'),
      };
    default:
      // Clean, non-PII fallback: humanise the trailing kind segment.
      return {
        icon: '•',
        text: tp(isHi, 'Learning activity', 'सीखने की गतिविधि'),
      };
  }
}

/** Relative "x ago" time, bilingual, from an ISO timestamp. */
export function timeAgo(iso: string, isHi: boolean): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return tp(isHi, 'recently', 'हाल ही में');
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return tp(isHi, 'just now', 'अभी');
  if (mins < 60) return tp(isHi, `${mins}m ago`, `${mins} मि. पहले`);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return tp(isHi, `${hrs}h ago`, `${hrs} घं. पहले`);
  const days = Math.floor(hrs / 24);
  if (days < 30) return tp(isHi, `${days}d ago`, `${days} दिन पहले`);
  const months = Math.floor(days / 30);
  return tp(isHi, `${months}mo ago`, `${months} माह पहले`);
}

/** Format a 0..1 mastery fraction as a whole-percent string, or a dash. */
export function masteryPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}
