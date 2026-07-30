// Diagnostic cold-start bilingual copy (P7) — mobile mirror of
// `packages/lib/src/diagnostic/copy.ts`.
//
// The SERVER already sends fully-substituted bilingual `{en, hi}` objects on
// every new `/api/diagnostic/start` state (`message`, `headline`, `cta`,
// `alternatives[].label`, `short_form_message`, `setup_reassurance`). These
// constants exist ONLY as offline/degraded fallbacks for when a payload omits
// a field — the server copy always wins when present.
//
// Strings are reproduced VERBATIM from `copy.ts`. Do not paraphrase, and keep
// technical / CBSE terms (Foxy, Science, Commerce, Humanities, CBSE, XP)
// untranslated inside the Hindi variant.
library;

import '../../data/models/diagnostic_models.dart';

class DiagnosticCopy {
  DiagnosticCopy._();

  /// §7.1 — shown when `quality_tier === 'short_form'`.
  static const DiagnosticBilingual shortFormBanner = DiagnosticBilingual(
    en: 'We could only find {count} good questions for this subject right now, '
        'so this check is shorter than usual. Your result still counts.',
    hi: 'अभी इस विषय के लिए हमें केवल {count} अच्छे प्रश्न मिले, इसलिए यह जाँच '
        'सामान्य से छोटी है। आपका परिणाम फिर भी गिना जाएगा।',
  );

  /// §7.2 — shown when `content_insufficient === true`.
  static const DiagnosticBilingual insufficientHeadline = DiagnosticBilingual(
    en: "This subject isn't ready yet",
    hi: 'यह विषय अभी तैयार नहीं है',
  );

  static const DiagnosticBilingual insufficientBody = DiagnosticBilingual(
    en: "We don't have enough good questions for Class {grade} {subject} to give "
        "you an honest starting point. We'd rather tell you than waste your time. "
        "Here's what you can do right now:",
    hi: 'कक्षा {grade} {subject} के लिए हमारे पास इतने अच्छे प्रश्न नहीं हैं कि हम '
        'आपका सही शुरुआती स्तर बता सकें। आपका समय बर्बाद करने से बेहतर है कि हम '
        'आपको सच बता दें। अभी आप यह कर सकते हैं:',
  );

  /// §7.3a — fallback CTA: take the diagnostic in another subject.
  static const DiagnosticBilingual ctaOtherSubject = DiagnosticBilingual(
    en: 'Take the check in {subject} instead',
    hi: 'इसके बजाय {subject} की जाँच करें',
  );

  /// §7.3b — fallback CTA: guided lesson.
  static const DiagnosticBilingual ctaGuidedLesson = DiagnosticBilingual(
    en: 'Start with a guided lesson',
    hi: 'गाइडेड पाठ से शुरू करें',
  );

  /// §7.3c — fallback CTA: Foxy. Unconditional server-side, so `alternatives`
  /// is never empty; kept here for the degraded client-built fallback.
  static const DiagnosticBilingual ctaFoxy = DiagnosticBilingual(
    en: 'Ask Foxy anything',
    hi: 'Foxy से कुछ भी पूछें',
  );

  /// §7.4 — grades 11-12 with `students.stream IS NULL` and zero unlocked
  /// subjects.
  static const DiagnosticBilingual streamHeadline = DiagnosticBilingual(
    en: 'Pick your stream first',
    hi: 'पहले अपनी स्ट्रीम चुनें',
  );

  static const DiagnosticBilingual streamBody = DiagnosticBilingual(
    en: "Class {grade} subjects depend on your stream. Choose Science, Commerce "
        "or Humanities and we'll set up your check.",
    hi: 'कक्षा {grade} के विषय आपकी स्ट्रीम पर निर्भर करते हैं। Science, Commerce '
        'या Humanities चुनें, फिर हम आपकी जाँच तैयार कर देंगे।',
  );

  static const DiagnosticBilingual streamCta = DiagnosticBilingual(
    en: 'Choose stream',
    hi: 'स्ट्रीम चुनें',
  );

  /// §7.5c — setup-screen reassurance so the recalibrated (lower) scores don't
  /// read as failure.
  static const DiagnosticBilingual setupReassurance = DiagnosticBilingual(
    en: "Some of these are meant to be hard — that's how we find your level. "
        'Getting them wrong costs you nothing.',
    hi: 'इनमें से कुछ प्रश्न जानबूझकर कठिन हैं — इसी से हमें आपका स्तर पता चलता है। '
        'गलत होने पर कुछ नहीं घटेगा।',
  );

  // ── Mobile-only surfaces (no web equivalent) ──────────────────────────────

  /// The setup picker resolved zero unlocked subjects from the governance
  /// endpoint. Not a crash and not a spinner — a calm, actionable stop.
  static const DiagnosticBilingual noSubjectsHeadline = DiagnosticBilingual(
    en: 'No subjects available yet',
    hi: 'अभी कोई विषय उपलब्ध नहीं है',
  );

  static const DiagnosticBilingual noSubjectsBody = DiagnosticBilingual(
    en: "We couldn't find any subjects unlocked for your account. Ask Foxy in the "
        'meantime, or check your plan.',
    hi: 'आपके खाते के लिए हमें कोई विषय अनलॉक नहीं मिला। तब तक Foxy से पूछें, या '
        'अपना plan देखें।',
  );

  static const DiagnosticBilingual subjectsLoadFailed = DiagnosticBilingual(
    en: "We couldn't load your subjects. Check your connection and try again.",
    hi: 'हम आपके विषय लोड नहीं कर सके। अपना कनेक्शन जाँचें और फिर कोशिश करें।',
  );

  /// `/api/diagnostic/start` §4 G3: when the student's profile carries a valid
  /// grade, the SERVER uses it and silently ignores the picked one. Say so
  /// rather than letting the student believe they changed anything.
  static const DiagnosticBilingual gradeOverrideNote = DiagnosticBilingual(
    en: 'Your account is enrolled in Class {grade}, so the check will use that '
        'class and the subjects unlocked for it.',
    hi: 'आपका खाता कक्षा {grade} में है, इसलिए जाँच उसी कक्षा और उसके लिए अनलॉक '
        'विषयों पर होगी।',
  );

  static const DiagnosticBilingual lockedSubjectNote = DiagnosticBilingual(
    en: 'Locked on your current plan',
    hi: 'आपके मौजूदा plan में लॉक है',
  );

  static const DiagnosticBilingual retry = DiagnosticBilingual(
    en: 'Try again',
    hi: 'फिर कोशिश करें',
  );

  static const DiagnosticBilingual backToSetup = DiagnosticBilingual(
    en: 'Pick a different subject',
    hi: 'दूसरा विषय चुनें',
  );

  static const DiagnosticBilingual viewPlans = DiagnosticBilingual(
    en: 'See plans',
    hi: 'Plans देखें',
  );

  /// Generic, honest fallback when the server returns a 200 with
  /// `diagnostic: null` in a shape this build does not recognise. Prevents the
  /// unknown-state path from degrading into a dead end.
  static const DiagnosticBilingual unknownStopHeadline = DiagnosticBilingual(
    en: "We can't start this check right now",
    hi: 'हम अभी यह जाँच शुरू नहीं कर सकते',
  );

  static const DiagnosticBilingual unknownStopBody = DiagnosticBilingual(
    en: 'Nothing is wrong with your answers — this subject just is not ready. '
        'Try another subject, or ask Foxy.',
    hi: 'आपके उत्तरों में कोई गड़बड़ी नहीं है — यह विषय अभी तैयार नहीं है। दूसरा विषय '
        'आज़माएँ, या Foxy से पूछें।',
  );

  // ── Server error codes → bilingual copy (P7) ──────────────────────────────
  //
  // `/api/diagnostic/{start,complete}` error bodies carry an English-only
  // `error` string plus a stable `code`. Map the codes we know so a Hindi user
  // never sees raw English; fall back to the server string for unknown codes
  // (visible-but-English beats silent).
  static const Map<String, DiagnosticBilingual> _errorsByCode = {
    'INVALID_GRADE': DiagnosticBilingual(
      en: 'Pick a class between 6 and 12 to start the check.',
      hi: 'जाँच शुरू करने के लिए कक्षा 6 से 12 के बीच चुनें।',
    ),
    'INVALID_SUBJECT': DiagnosticBilingual(
      en: 'Pick a subject to start the check.',
      hi: 'जाँच शुरू करने के लिए एक विषय चुनें।',
    ),
    'CHAPTER_NOT_SUPPORTED': DiagnosticBilingual(
      en: 'This check covers the whole subject, not a single chapter.',
      hi: 'यह जाँच पूरे विषय की होती है, किसी एक अध्याय की नहीं।',
    ),
    'NO_STUDENT': DiagnosticBilingual(
      en: 'We could not find your student profile. Please sign in again.',
      hi: 'हमें आपकी student प्रोफ़ाइल नहीं मिली। कृपया दोबारा साइन इन करें।',
    ),
    'SYLLABUS_ERROR': DiagnosticBilingual(
      en: 'We could not load the syllabus. Please try again.',
      hi: 'हम पाठ्यक्रम लोड नहीं कर सके। कृपया फिर कोशिश करें।',
    ),
    'QUESTIONS_ERROR': DiagnosticBilingual(
      en: 'We could not load the questions. Please try again.',
      hi: 'हम प्रश्न लोड नहीं कर सके। कृपया फिर कोशिश करें।',
    ),
    'SESSION_CREATE_ERROR': DiagnosticBilingual(
      en: 'We could not start the check. Please try again.',
      hi: 'हम जाँच शुरू नहीं कर सके। कृपया फिर कोशिश करें।',
    ),
    'SESSION_NOT_FOUND': DiagnosticBilingual(
      en: 'This check has expired. Please start a new one.',
      hi: 'यह जाँच समाप्त हो चुकी है। कृपया नई शुरू करें।',
    ),
    'ALREADY_COMPLETED': DiagnosticBilingual(
      en: 'You have already completed this check.',
      hi: 'आप यह जाँच पहले ही पूरी कर चुके हैं।',
    ),
    'MISSING_SESSION_ID': DiagnosticBilingual(
      en: 'Missing check session. Please start again.',
      hi: 'जाँच सत्र नहीं मिला। कृपया फिर से शुरू करें।',
    ),
    'MISSING_RESPONSES': DiagnosticBilingual(
      en: 'No answers were recorded. Please start again.',
      hi: 'कोई उत्तर दर्ज नहीं हुआ। कृपया फिर से शुरू करें।',
    ),
    'INSERT_ERROR': DiagnosticBilingual(
      en: 'We could not save your answers. Please try again.',
      hi: 'हम आपके उत्तर सहेज नहीं सके। कृपया फिर कोशिश करें।',
    ),
    'INTERNAL_ERROR': DiagnosticBilingual(
      en: 'Something went wrong on our side. Please try again.',
      hi: 'हमारी तरफ़ कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।',
    ),
    'INVALID_BODY': DiagnosticBilingual(
      en: 'Something went wrong on our side. Please try again.',
      hi: 'हमारी तरफ़ कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।',
    ),
    // 422 subject-governance denial. The route returns
    // `{ error: <governance code>, subject, reason, allowed }` — the codes
    // below are the ones `validateSubjectWrite` can emit.
    'SUBJECT_NOT_ALLOWED': DiagnosticBilingual(
      en: 'This subject is not part of your class or plan. Pick another one.',
      hi: 'यह विषय आपकी कक्षा या plan में नहीं है। कोई दूसरा चुनें।',
    ),
    'SUBJECT_LOCKED': DiagnosticBilingual(
      en: 'This subject is locked on your current plan.',
      hi: 'यह विषय आपके मौजूदा plan में लॉक है।',
    ),
    // Client-side sentinels (never sent by the server).
    'CONNECTION_ERROR': DiagnosticBilingual(
      en: 'Connection problem. Check your network and try again.',
      hi: 'कनेक्शन में समस्या है। अपना नेटवर्क जाँचें और फिर कोशिश करें।',
    ),
    'GENERIC_ERROR': DiagnosticBilingual(
      en: 'Could not start the check. Please try again.',
      hi: 'जाँच शुरू नहीं हो सकी। कृपया फिर कोशिश करें।',
    ),
  };

  /// Sentinel keys the repository puts on `ApiFailure.message`. The UI resolves
  /// them back to bilingual copy via [errorFor] — see [resolveError].
  static const String connectionErrorKey = 'CONNECTION_ERROR';
  static const String genericErrorKey = 'GENERIC_ERROR';

  /// The repository puts either a known error CODE or a raw English server
  /// message on `ApiFailure.message` (P13: never a student identifier). This
  /// turns that single string back into bilingual copy: a recognised code maps
  /// to translated copy, anything else is shown verbatim in both languages
  /// (visible-but-English beats a silent swallow).
  static DiagnosticBilingual resolveError(String key) =>
      errorFor(key, serverMessage: key);

  static const DiagnosticBilingual genericError = DiagnosticBilingual(
    en: 'Could not start the check. Please try again.',
    hi: 'जाँच शुरू नहीं हो सकी। कृपया फिर कोशिश करें।',
  );

  static const DiagnosticBilingual connectionError = DiagnosticBilingual(
    en: 'Connection problem. Check your network and try again.',
    hi: 'कनेक्शन में समस्या है। अपना नेटवर्क जाँचें और फिर कोशिश करें।',
  );

  /// Resolve a server error `code` to bilingual copy. Unknown codes fall back
  /// to [serverMessage] (English on both sides — visible beats silent) and then
  /// to [genericError].
  static DiagnosticBilingual errorFor(String? code, {String? serverMessage}) {
    final mapped = code == null ? null : _errorsByCode[code];
    if (mapped != null) return mapped;
    if (serverMessage != null && serverMessage.trim().isNotEmpty) {
      return DiagnosticBilingual(en: serverMessage, hi: serverMessage);
    }
    return genericError;
  }
}
