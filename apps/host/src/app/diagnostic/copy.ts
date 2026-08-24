/**
 * /diagnostic — the page's copy table.
 *
 * Why this module exists: the diagnostic cold-start spec
 * (`docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md`,
 * §7 + AC-35) requires that no student-facing string introduced by that spec
 * is hardcoded inside a component. Everything the page renders comes from
 * here so the bilingual oracles (AC-33/AC-34) can table-drive over one export.
 *
 * ─── SINGLE SOURCE OF TRUTH FOR §7 ────────────────────────────────────────
 * The spec §7 strings are NOT defined here. They live in
 * `packages/lib/src/diagnostic/copy.ts` and are RE-EXPORTED below under this
 * page's key names. That module is also what `/api/diagnostic/start` imports,
 * so the server-sent copy and the client's offline fallback are the same
 * bytes by construction and cannot drift.
 *
 * `mobile/lib/core/constants/diagnostic_copy.dart` is a third, hand-kept
 * transcription of the same strings (mobile agent owns it). It cannot import
 * TypeScript, so it stays a copy — verified byte-for-byte against the lib
 * module on 2026-07-29. If you change a §7 string in the lib module, tell the
 * mobile agent.
 *
 * What IS defined here: page-local chrome (labels, placeholders, error copy,
 * result encouragement) that has no server or mobile counterpart.
 *
 * P7: every entry carries BOTH `en` and `hi`. Technical / CBSE terms — CBSE,
 * XP, Bloom's, Foxy, Science, Commerce, Humanities — are deliberately NOT
 * translated, per the constitution.
 */

import {
  DIAGNOSTIC_CTA_FOXY,
  DIAGNOSTIC_CTA_GUIDED_LESSON,
  DIAGNOSTIC_CTA_OTHER_SUBJECT,
  DIAGNOSTIC_INSUFFICIENT_BODY,
  DIAGNOSTIC_INSUFFICIENT_HEADLINE,
  DIAGNOSTIC_SETUP_REASSURANCE,
  DIAGNOSTIC_SHORT_FORM_BANNER,
  DIAGNOSTIC_STREAM_BODY,
  DIAGNOSTIC_STREAM_CTA,
  DIAGNOSTIC_STREAM_HEADLINE,
  type BilingualString,
} from '@alfanumrik/lib/diagnostic/copy';
import { DIAGNOSTIC_PLACEMENT_THRESHOLDS } from '@alfanumrik/lib/diagnostic/placement';

/**
 * Structural alias of the shared `BilingualString`. Kept as a named export
 * because the page and its tests import `Bilingual`; aliasing rather than
 * redeclaring means there is one type, not two lookalikes.
 */
export type Bilingual = BilingualString;

export const DIAGNOSTIC_COPY = {
  // ── Setup screen ────────────────────────────────────────────────
  gradeLabel: {
    en: 'Grade',
    hi: 'कक्षा',
  },
  /** Grade is display-only when the profile already carries one (spec G3). */
  gradeFromProfile: {
    en: 'From your profile',
    hi: 'आपकी प्रोफ़ाइल से',
  },
  gradeValue: {
    en: 'Class {grade}',
    hi: 'कक्षा {grade}',
  },
  gradeSelectPlaceholder: {
    en: 'Select grade...',
    hi: 'कक्षा चुनें...',
  },
  gradeSelectAria: {
    en: 'Select grade',
    hi: 'कक्षा चुनें',
  },
  subjectLabel: {
    en: 'Subject',
    hi: 'विषय',
  },
  subjectsLoading: {
    en: 'Loading your subjects...',
    hi: 'आपके विषय लोड हो रहे हैं...',
  },
  subjectsError: {
    en: 'We could not load your subjects. Check your connection and try again.',
    hi: 'हम आपके विषय लोड नहीं कर सके। अपना कनेक्शन जाँचें और फिर कोशिश करें।',
  },
  retry: {
    en: 'Try again',
    hi: 'फिर कोशिश करें',
  },
  subjectsEmptyTitle: {
    en: 'No subjects available yet',
    hi: 'अभी कोई विषय उपलब्ध नहीं है',
  },
  subjectsEmptyBody: {
    en: 'Your subject list is empty right now. Ask Foxy anything in the meantime, or check back shortly.',
    hi: 'अभी आपकी विषय सूची खाली है। तब तक Foxy से कुछ भी पूछें, या थोड़ी देर बाद देखें।',
  },
  /** Locked subjects are shown, never hidden (matches /learn LockedCard). */
  lockedReason: {
    en: 'Unlock with an upgrade',
    hi: 'अपग्रेड पर अनलॉक करो',
  },
  lockedAction: {
    en: 'Upgrade to unlock',
    hi: 'अपग्रेड करो',
  },
  chooseSubjectError: {
    en: 'Please choose a subject.',
    hi: 'कृपया एक विषय चुनें।',
  },
  chooseGradeError: {
    en: 'Please choose your grade.',
    hi: 'कृपया अपनी कक्षा चुनें।',
  },
  startFailed: {
    en: 'Could not start diagnostic. Please try again.',
    hi: 'डायग्नोस्टिक शुरू नहीं हो सका। कृपया पुनः प्रयास करें।',
  },
  connectionError: {
    en: 'Connection error. Please try again.',
    hi: 'कनेक्शन त्रुटि। कृपया पुनः प्रयास करें।',
  },
  /** 422 subject_not_allowed — governance said no (grade / stream / plan). */
  subjectNotAllowed: {
    en: 'That subject is not available on your grade or plan. Please pick another one.',
    hi: 'यह विषय आपकी कक्षा या प्लान पर उपलब्ध नहीं है। कृपया दूसरा चुनें।',
  },
  submitFailed: {
    en: 'Could not save your results. Please try again.',
    hi: 'आपके परिणाम सहेजे नहीं जा सके। कृपया पुनः प्रयास करें।',
  },

  // ── Spec §7 — RE-EXPORTED, never restated ───────────────────────
  // These ten entries are owned by `@alfanumrik/lib/diagnostic/copy` (the
  // module `/api/diagnostic/start` imports). Aliasing them here keeps the
  // page's call sites stable without creating a second place a §7 string can
  // be edited. To reword any of them, edit the lib module — and expect an
  // assessment review (P14: learner-state copy) plus a note to mobile.
  /** §7.5c — setup-screen reassurance. */
  reassurance: DIAGNOSTIC_SETUP_REASSURANCE,
  /** §7.1 — short-form banner. */
  shortFormBanner: DIAGNOSTIC_SHORT_FORM_BANNER,
  /** §7.2 — content-insufficient screen. */
  insufficientHeadline: DIAGNOSTIC_INSUFFICIENT_HEADLINE,
  insufficientBody: DIAGNOSTIC_INSUFFICIENT_BODY,
  /** §7.3a-c — fallback CTA labels. */
  altOtherSubject: DIAGNOSTIC_CTA_OTHER_SUBJECT,
  altGuidedLesson: DIAGNOSTIC_CTA_GUIDED_LESSON,
  altFoxy: DIAGNOSTIC_CTA_FOXY,
  /** §7.4 — stream not selected. */
  streamHeadline: DIAGNOSTIC_STREAM_HEADLINE,
  streamBody: DIAGNOSTIC_STREAM_BODY,
  streamCta: DIAGNOSTIC_STREAM_CTA,

  // ── §7.5b — recalibrated result encouragement (80 / 50) ─────────
  // Thresholds move in lockstep with /api/diagnostic/complete's
  // recommended_difficulty cutoffs so the badge, the message and the
  // recommendation can never disagree.
  resultStrong: {
    en: 'Great work! You have a strong foundation.',
    hi: 'शानदार! तुम इस विषय में अच्छे हो।',
  },
  resultMid: {
    en: 'Good start! A bit more practice will help.',
    hi: 'ठीक है! थोड़ा अभ्यास और करो।',
  },
  resultLow: {
    en: "Let's build a stronger foundation together.",
    hi: 'चलो मिलकर बेसिक्स मजबूत करते हैं।',
  },

  // ── Phase 5 — per-question answer review (CEO defect #4) ────────
  // "Student shall also know why was the answer incorrect." Until 2026-08-24
  // the diagnostic never told the student that an answer was even wrong, let
  // alone why — `explanation` / `explanation_hi` were on the wire from
  // /api/diagnostic/start and simply never rendered.
  reviewHeading: {
    en: 'Review your answers',
    hi: 'अपने जवाब देखें',
  },
  reviewSubheadingWrong: {
    en: 'Here is why each answer was marked the way it was.',
    hi: 'यहाँ देखो हर जवाब ऐसा क्यों माना गया।',
  },
  reviewAllCorrect: {
    en: 'You got every question right. Read the explanations to lock it in.',
    hi: 'तुमने हर सवाल सही किया। व्याख्या पढ़कर इसे पक्का करो।',
  },
  reviewYourAnswer: {
    en: 'Your answer',
    hi: 'तुम्हारा जवाब',
  },
  reviewCorrectAnswer: {
    en: 'Correct answer',
    hi: 'सही जवाब',
  },
  reviewNotAnswered: {
    en: 'Not answered',
    hi: 'जवाब नहीं दिया',
  },
  reviewCorrectBadge: {
    en: 'Correct',
    hi: 'सही',
  },
  reviewIncorrectBadge: {
    en: 'Incorrect',
    hi: 'गलत',
  },
  reviewWhyLabel: {
    en: 'Why',
    hi: 'क्यों',
  },
  /** Honest fallback — a question_bank row with no explanation (P6 gap). */
  reviewNoExplanation: {
    en: 'No explanation is available for this question yet.',
    hi: 'इस सवाल की व्याख्या अभी उपलब्ध नहीं है।',
  },

  /**
   * C2 low-confidence placement. The server already forces 'medium' and skips
   * both the topic analysis and the mastery seed after a < 3s/question run;
   * this tells the student why their result looks thin instead of letting a
   * disarmed default masquerade as a real recommendation.
   */
  lowConfidenceNote: {
    en: 'You moved through this very quickly, so we have not used it to set your level or to pick your topics. Take it again at your own pace for a real placement.',
    hi: 'तुमने यह बहुत तेजी से पूरा किया, इसलिए हमने इससे तुम्हारा स्तर या topics तय नहीं किए। असली placement के लिए इसे आराम से दोबारा दो।',
  },

  // ── Shared navigation ───────────────────────────────────────────
  goBack: {
    en: 'Go back',
    hi: 'वापस जाएं',
  },
} as const;

export type DiagnosticCopyKey = keyof typeof DIAGNOSTIC_COPY;

/**
 * Resolve a bilingual entry and substitute `{placeholder}` tokens.
 * Uses split/join rather than RegExp so a placeholder value containing
 * regex metacharacters (a subject name, say) can never corrupt the output.
 */
export function t(
  entry: Bilingual,
  isHi: boolean,
  vars?: Record<string, string | number>,
): string {
  let out = isHi ? entry.hi : entry.en;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.split(`{${key}}`).join(String(value));
    }
  }
  return out;
}

/**
 * §7.5a/§7.5b boundaries. Exported so the results screen and any test
 * asserting badge/message/recommendation coherence read the SAME numbers.
 * Derived by assessment from the 5/6/4 blueprint's expected-score curve —
 * do not change without an assessment review.
 *
 * NOT independent numbers any more: these are an ALIAS of the server's
 * `DIAGNOSTIC_PLACEMENT_THRESHOLDS` (`@alfanumrik/lib/diagnostic/placement`),
 * which `/api/diagnostic/complete` uses to pick `recommended_difficulty`. They
 * were previously two literals written twice with nothing asserting they
 * agreed; the client's encouragement badge could silently contradict the
 * server's recommendation. One export now feeds both. `strong` is the server's
 * `hard` cut, `mid` is its `medium` cut — the key names differ only because
 * this side names the *tone*, not the placement.
 */
export const RESULT_THRESHOLDS = {
  strong: DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard,
  mid: DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium,
} as const;

/**
 * Default label used when the API omits `label` on an alternative.
 *
 * A `Map`, not an object literal: the lookup key is `alt.kind`, which arrives
 * over the wire in the API response. As a plain object, `kind: 'toString'` would
 * resolve to an inherited FUNCTION, which `?? C.altFoxy` does NOT catch (a
 * function is not nullish) — that non-Bilingual value would then reach `t()` and
 * render as blank/garbled UI. `Map.get` returns `Bilingual | undefined`, so the
 * `??` fallback is the only path for anything unrecognised.
 */
export const ALTERNATIVE_FALLBACK_LABEL = new Map<string, Bilingual>([
  ['other_subject', DIAGNOSTIC_COPY.altOtherSubject],
  ['guided_lesson', DIAGNOSTIC_COPY.altGuidedLesson],
  ['foxy', DIAGNOSTIC_COPY.altFoxy],
]);
