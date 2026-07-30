/**
 * ALFANUMRIK — Diagnostic cold-start student-facing copy (P7).
 *
 * Single source of truth for every string introduced by
 * `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md` §7.
 * Copy is reproduced VERBATIM from the spec — do not paraphrase.
 *
 * AC-33/34/35 assert against this constant:
 *  - every entry has a non-empty `en` and a non-empty `hi`
 *  - every `hi` contains at least one Devanagari codepoint
 *  - technical / CBSE terms (Foxy, Science, Commerce, Humanities, CBSE, XP)
 *    stay untranslated inside the Hindi variant
 *  - no component or route hardcodes these strings
 *
 * `{placeholders}` are substituted at render time via `fillCopy()`.
 */

export interface BilingualString {
  en: string;
  hi: string;
}

/** §7.1 — shown when `quality_tier === 'short_form'`. */
export const DIAGNOSTIC_SHORT_FORM_BANNER: BilingualString = {
  en: 'We could only find {count} good questions for this subject right now, so this check is shorter than usual. Your result still counts.',
  hi: 'अभी इस विषय के लिए हमें केवल {count} अच्छे प्रश्न मिले, इसलिए यह जाँच सामान्य से छोटी है। आपका परिणाम फिर भी गिना जाएगा।',
};

/** §7.2 — shown when `content_insufficient === true`. */
export const DIAGNOSTIC_INSUFFICIENT_HEADLINE: BilingualString = {
  en: "This subject isn't ready yet",
  hi: 'यह विषय अभी तैयार नहीं है',
};

export const DIAGNOSTIC_INSUFFICIENT_BODY: BilingualString = {
  en: "We don't have enough good questions for Class {grade} {subject} to give you an honest starting point. We'd rather tell you than waste your time. Here's what you can do right now:",
  hi: 'कक्षा {grade} {subject} के लिए हमारे पास इतने अच्छे प्रश्न नहीं हैं कि हम आपका सही शुरुआती स्तर बता सकें। आपका समय बर्बाद करने से बेहतर है कि हम आपको सच बता दें। अभी आप यह कर सकते हैं:',
};

/** §7.3a — fallback CTA: take the diagnostic in another subject. */
export const DIAGNOSTIC_CTA_OTHER_SUBJECT: BilingualString = {
  en: 'Take the check in {subject} instead',
  hi: 'इसके बजाय {subject} की जाँच करें',
};

/** §7.3b — fallback CTA: guided lesson. */
export const DIAGNOSTIC_CTA_GUIDED_LESSON: BilingualString = {
  en: 'Start with a guided lesson',
  hi: 'गाइडेड पाठ से शुरू करें',
};

/** §7.3c — fallback CTA: Foxy. Unconditional, so `alternatives` is never empty. */
export const DIAGNOSTIC_CTA_FOXY: BilingualString = {
  en: 'Ask Foxy anything',
  hi: 'Foxy से कुछ भी पूछें',
};

/** §7.4 — grades 11-12 with `students.stream IS NULL` and zero unlocked subjects. */
export const DIAGNOSTIC_STREAM_HEADLINE: BilingualString = {
  en: 'Pick your stream first',
  hi: 'पहले अपनी स्ट्रीम चुनें',
};

export const DIAGNOSTIC_STREAM_BODY: BilingualString = {
  en: "Class {grade} subjects depend on your stream. Choose Science, Commerce or Humanities and we'll set up your check.",
  hi: 'कक्षा {grade} के विषय आपकी स्ट्रीम पर निर्भर करते हैं। Science, Commerce या Humanities चुनें, फिर हम आपकी जाँच तैयार कर देंगे।',
};

export const DIAGNOSTIC_STREAM_CTA: BilingualString = {
  en: 'Choose stream',
  hi: 'स्ट्रीम चुनें',
};

/** §7.5c — setup-screen reassurance so the recalibrated (lower) scores don't read as failure. */
export const DIAGNOSTIC_SETUP_REASSURANCE: BilingualString = {
  en: "Some of these are meant to be hard — that's how we find your level. Getting them wrong costs you nothing.",
  hi: 'इनमें से कुछ प्रश्न जानबूझकर कठिन हैं — इसी से हमें आपका स्तर पता चलता है। गलत होने पर कुछ नहीं घटेगा।',
};

/**
 * Every string in §7, keyed. AC-33 iterates this map, so any new copy MUST be
 * registered here rather than inlined at a call site.
 */
export const DIAGNOSTIC_COPY = {
  shortFormBanner: DIAGNOSTIC_SHORT_FORM_BANNER,
  insufficientHeadline: DIAGNOSTIC_INSUFFICIENT_HEADLINE,
  insufficientBody: DIAGNOSTIC_INSUFFICIENT_BODY,
  ctaOtherSubject: DIAGNOSTIC_CTA_OTHER_SUBJECT,
  ctaGuidedLesson: DIAGNOSTIC_CTA_GUIDED_LESSON,
  ctaFoxy: DIAGNOSTIC_CTA_FOXY,
  streamHeadline: DIAGNOSTIC_STREAM_HEADLINE,
  streamBody: DIAGNOSTIC_STREAM_BODY,
  streamCta: DIAGNOSTIC_STREAM_CTA,
  setupReassurance: DIAGNOSTIC_SETUP_REASSURANCE,
} as const;

export type DiagnosticCopyKey = keyof typeof DIAGNOSTIC_COPY;

/**
 * Substitute `{placeholder}` tokens in both language variants at once.
 * Unknown tokens are left untouched so a missing value is visible, not silent.
 */
export function fillCopy(
  copy: BilingualString,
  values: Record<string, string | number>,
): BilingualString {
  const apply = (s: string) =>
    s.replace(/\{(\w+)\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
    );
  return { en: apply(copy.en), hi: apply(copy.hi) };
}
