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
  // Phase A Loop A — adaptive-remediation timeline accents (paired with icon
  // + text at every call site; never colour-alone).
  remediation: '#F97316', // brand orange — Foxy stepped in
  recovered: '#16A34A', // green — comeback verified
  escalated: '#F59E0B', // amber — a human was pulled in
  // Phase A Loops B & C — engagement (inactivity) + concentration accents.
  // Same a11y contract: every accent rides an icon + text pair, never colour-alone.
  nudged: '#7C3AED', // purple (brand) — a warm "come back" nudge
  returned: '#16A34A', // green — the learner came back (celebratory)
  concentration: '#DC2626', // red — a whole subject is at risk (escalated to a human)
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
 *
 * `variant` shifts TONE per lens (student = encouraging first-person;
 * parent = warm + actionable; teacher/principal = triage language). The
 * optional `accent` is a presentation hint for the icon chip — always paired
 * with the icon + text, never colour-alone.
 */
export function timelineLine(
  kind: string,
  summary: Record<string, string | number | boolean | null>,
  isHi: boolean,
  variant: PulseVariant = 'student',
): { icon: string; text: string; accent?: string } {
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

    // ── Phase A Loop A — adaptive remediation (system.* actor) ──────────────
    // Payload fields ride the generic whitelist (subjectCode/chapterNumber).
    // Copy is variant-aware: student = encouraging, parent/teacher = actionable.
    case 'system.remediation_injected': {
      const self = variant === 'student';
      const chEn = chapter != null ? ` for Chapter ${chapter}` : '';
      const chHi = chapter != null ? `अध्याय ${chapter} के लिए ` : '';
      return {
        icon: '🦊',
        accent: PULSE_COLORS.remediation,
        text: self
          ? tp(isHi, `Foxy added extra practice${chEn}`, `Foxy ने ${chHi}अतिरिक्त अभ्यास जोड़ा`)
          : variant === 'parent'
            ? tp(
                isHi,
                `Extra practice was added${chEn}${subjLabel} — the app is on it`,
                `${chHi}अतिरिक्त अभ्यास जोड़ा गया${subjLabel} — ऐप इस पर काम कर रहा है`,
              )
            : tp(
                isHi,
                `Auto-practice assigned${chLabel}${subjLabel} — recovery being tracked`,
                `स्वतः अभ्यास सौंपा गया${chLabel}${subjLabel} — रिकवरी पर नज़र है`,
              ),
      };
    }
    case 'system.remediation_recovered': {
      const self = variant === 'student';
      return {
        icon: '🎉',
        accent: PULSE_COLORS.recovered,
        text: self
          ? chapter != null
            ? tp(isHi, `You recovered Chapter ${chapter} 🎉`, `तुमने अध्याय ${chapter} फिर से पक्का कर लिया 🎉`)
            : tp(isHi, 'You recovered a tricky chapter 🎉', 'तुमने एक मुश्किल अध्याय फिर से पक्का कर लिया 🎉')
          : variant === 'parent'
            ? tp(
                isHi,
                `Chapter${chapter != null ? ` ${chapter}` : ''}${subjLabel} recovered after extra practice 🎉`,
                `अतिरिक्त अभ्यास के बाद${chapter != null ? ` अध्याय ${chapter}` : ' अध्याय'}${subjLabel} की पकड़ लौट आई 🎉`,
              )
            : tp(
                isHi,
                `Mastery recovered${chLabel}${subjLabel} — no action needed`,
                `महारत लौट आई${chLabel}${subjLabel} — किसी कार्रवाई की ज़रूरत नहीं`,
              ),
      };
    }
    case 'system.remediation_escalated': {
      const self = variant === 'student';
      // `escalatedTo` is not in the timeline whitelist today; branch when
      // present, degrade to neutral copy when absent (never claim the wrong
      // helper for a B2C student).
      const escalatedTo =
        typeof summary.escalatedTo === 'string' ? summary.escalatedTo : null;
      let text: string;
      if (self) {
        text =
          escalatedTo === 'teacher'
            ? tp(
                isHi,
                `Your teacher was asked to help with Chapter ${chapter ?? '—'}`,
                `अध्याय ${chapter ?? '—'} में मदद के लिए आपके शिक्षक से कहा गया`,
              )
            : escalatedTo === 'parent'
              ? tp(
                  isHi,
                  `We asked your family to help with Chapter ${chapter ?? '—'}`,
                  `अध्याय ${chapter ?? '—'} में साथ देने के लिए हमने आपके परिवार को बताया`,
                )
              : tp(
                  isHi,
                  `Foxy arranged extra help for Chapter ${chapter ?? '—'}`,
                  `Foxy ने अध्याय ${chapter ?? '—'} के लिए अतिरिक्त मदद की व्यवस्था की`,
                );
      } else if (variant === 'parent') {
        text = tp(
          isHi,
          `Your child needs your support with Chapter ${chapter ?? '—'}${subjLabel} — a short revision together will help`,
          `अध्याय ${chapter ?? '—'}${subjLabel} में आपके बच्चे को आपके साथ की ज़रूरत है — साथ बैठकर छोटा रिवीज़न बहुत मदद करेगा`,
        );
      } else {
        text = tp(
          isHi,
          `Needs intervention${chLabel}${subjLabel} — auto-practice didn't recover mastery`,
          `हस्तक्षेप चाहिए${chLabel}${subjLabel} — स्वतः अभ्यास से महारत नहीं लौटी`,
        );
      }
      return { icon: '🤝', accent: PULSE_COLORS.escalated, text };
    }

    // ── Phase A Loop B — inactivity / re-engagement (system.* actor) ────────
    // Subject-less (Loop B uses an `_inactivity` sentinel subject server-side;
    // the timeline never surfaces it). Tone: student = warm "we missed you",
    // parent = supportive + actionable. No chapter, no subject in the copy.
    case 'system.engagement_nudged': {
      const self = variant === 'student';
      return {
        icon: '👋',
        accent: PULSE_COLORS.nudged,
        text: self
          ? tp(
              isHi,
              "Foxy noticed you've been away — come back, we missed you!",
              'Foxy ने देखा कि तुम कुछ दिनों से नहीं आए — वापस आ जाओ, हमें तुम्हारी याद आई!',
            )
          : variant === 'parent'
            ? tp(
                isHi,
                "Your child hasn't studied in a few days — a little nudge from you would help them restart",
                'आपका बच्चा कुछ दिनों से नहीं पढ़ा — आपका थोड़ा प्रोत्साहन उसे फिर से शुरू करने में मदद करेगा',
              )
            : tp(
                isHi,
                'Student has gone quiet — a re-engagement nudge was sent',
                'विद्यार्थी कुछ दिनों से निष्क्रिय है — वापस लाने के लिए एक रिमाइंडर भेजा गया',
              ),
      };
    }
    case 'system.engagement_returned': {
      const self = variant === 'student';
      return {
        icon: '🎉',
        accent: PULSE_COLORS.returned,
        text: self
          ? tp(
              isHi,
              'Welcome back — you picked your learning right back up! 🎉',
              'वापसी पर स्वागत है — तुमने अपनी पढ़ाई फिर से शुरू कर दी! 🎉',
            )
          : variant === 'parent'
            ? tp(
                isHi,
                'Good news — your child is back and learning again 🎉',
                'खुशखबरी — आपका बच्चा वापस आ गया और फिर से पढ़ने लगा 🎉',
              )
            : tp(
                isHi,
                'Student returned and resumed activity — no action needed',
                'विद्यार्थी वापस आ गया और गतिविधि फिर से शुरू की — किसी कार्रवाई की ज़रूरत नहीं',
              ),
      };
    }
    case 'system.engagement_escalated': {
      const self = variant === 'student';
      // `escalatedTo` is 'parent' | null (Loop B never escalates to a teacher).
      // When absent from the whitelisted summary, degrade to neutral framing —
      // never claim a family was told when we can't confirm it.
      const escalatedTo =
        typeof summary.escalatedTo === 'string' ? summary.escalatedTo : null;
      let text: string;
      if (self) {
        text =
          escalatedTo === 'parent'
            ? tp(
                isHi,
                "It's been a while — we let your family know so they can cheer you back",
                'काफ़ी समय हो गया — हमने तुम्हारे परिवार को बताया ताकि वे तुम्हें वापस लाने में साथ दें',
              )
            : tp(
                isHi,
                "It's been a while — come back whenever you're ready, we're here",
                'काफ़ी समय हो गया — जब भी तैयार हो वापस आ जाना, हम यहीं हैं',
              );
      } else if (variant === 'parent') {
        text = tp(
          isHi,
          "Your child hasn't studied in several days — a short session together today would really help them restart",
          'आपका बच्चा कई दिनों से नहीं पढ़ा — आज साथ बैठकर एक छोटा सत्र उसे फिर से शुरू करने में बहुत मदद करेगा',
        );
      } else {
        text = tp(
          isHi,
          "Student stayed inactive past the nudge window — the family was alerted",
          'रिमाइंडर के बाद भी विद्यार्थी निष्क्रिय रहा — परिवार को सूचित किया गया',
        );
      }
      return { icon: '🏠', accent: PULSE_COLORS.escalated, text };
    }

    // ── Phase A Loop C — at-risk concentration (system.* actor) ─────────────
    // Subject-scoped, immediate escalation to a human. `subjectCode` +
    // `chapterNumber` ride the generic whitelist; `escalatedTo` needs the
    // per-kind whitelist (see pulse-server gap report).
    case 'system.concentration_escalated': {
      const self = variant === 'student';
      const escalatedTo =
        typeof summary.escalatedTo === 'string' ? summary.escalatedTo : null;
      const subj = subject ?? tp(isHi, 'a subject', 'एक विषय');
      let text: string;
      if (self) {
        text =
          escalatedTo === 'teacher'
            ? tp(
                isHi,
                `Foxy asked your teacher to help with ${subj}`,
                `Foxy ने ${subj} में मदद के लिए आपके शिक्षक से कहा`,
              )
            : escalatedTo === 'parent'
              ? tp(
                  isHi,
                  `Foxy let your family know ${subj} needs some focus`,
                  `Foxy ने आपके परिवार को बताया कि ${subj} पर ध्यान देने की ज़रूरत है`,
                )
              : tp(
                  isHi,
                  `${subj} needs some real focus — Foxy arranged extra help`,
                  `${subj} पर पूरा ध्यान चाहिए — Foxy ने अतिरिक्त मदद की व्यवस्था की`,
                );
      } else if (variant === 'parent') {
        text = tp(
          isHi,
          `${subj} is becoming a weak area for your child — sitting with them on it this week would help a lot`,
          `${subj} आपके बच्चे के लिए कमज़ोर क्षेत्र बनता जा रहा है — इस हफ़्ते साथ बैठकर देखना बहुत मदद करेगा`,
        );
      } else {
        text = tp(
          isHi,
          `${subj} flagged at-risk (multiple weak chapters) — assigned for your attention`,
          `${subj} जोखिम में चिह्नित (कई कमज़ोर अध्याय) — आपके ध्यान के लिए सौंपा गया`,
        );
      }
      return { icon: '🆘', accent: PULSE_COLORS.concentration, text };
    }
    case 'system.concentration_resolved': {
      const self = variant === 'student';
      const subj = subject ?? tp(isHi, 'a subject', 'एक विषय');
      return {
        icon: '🎉',
        accent: PULSE_COLORS.recovered,
        text: self
          ? tp(
              isHi,
              `Great work — ${subj} is back on track! 🎉`,
              `बहुत बढ़िया — ${subj} फिर से पटरी पर है! 🎉`,
            )
          : variant === 'parent'
            ? tp(
                isHi,
                `${subj} is no longer a weak area — your child turned it around 🎉`,
                `${subj} अब कमज़ोर क्षेत्र नहीं रहा — आपके बच्चे ने इसे संभाल लिया 🎉`,
              )
            : tp(
                isHi,
                `${subj} recovered out of the at-risk band — no action needed`,
                `${subj} जोखिम स्तर से बाहर आ गया — किसी कार्रवाई की ज़रूरत नहीं`,
              ),
      };
    }
    case 'system.concentration_reescalated': {
      const self = variant === 'student';
      const escalatedTo =
        typeof summary.escalatedTo === 'string' ? summary.escalatedTo : null;
      const subj = subject ?? tp(isHi, 'a subject', 'एक विषय');
      let text: string;
      if (self) {
        text = tp(
          isHi,
          `${subj} still needs focus — Foxy is keeping the extra help going`,
          `${subj} पर अभी और ध्यान चाहिए — Foxy अतिरिक्त मदद जारी रखे हुए है`,
        );
      } else if (variant === 'parent') {
        text = tp(
          isHi,
          `${subj} is still a weak area — it would really help to keep working on it together`,
          `${subj} अब भी कमज़ोर क्षेत्र है — साथ मिलकर इस पर काम जारी रखना बहुत मदद करेगा`,
        );
      } else {
        text =
          escalatedTo === 'teacher'
            ? tp(
                isHi,
                `${subj} is still at-risk — re-flagged for your attention`,
                `${subj} अब भी जोखिम में है — आपके ध्यान के लिए फिर से चिह्नित`,
              )
            : tp(
                isHi,
                `${subj} is still at-risk after the window — a follow-up was sent`,
                `${subj} अवधि के बाद भी जोखिम में — एक फ़ॉलो-अप भेजा गया`,
              );
      }
      return { icon: '🔁', accent: PULSE_COLORS.concentration, text };
    }

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
