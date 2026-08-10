/**
 * src/lib/today/copy.ts — bilingual copy resolver + deep-link helper for the
 * "Today" home (Consumer Minimalism Wave A).
 *
 * The render contract (`src/lib/today/types.ts`) carries only i18n KEYS
 * (`labelKey` = `today.item.<type>.label`, `subtitleKey` = `…subtitle`). This
 * module turns a key + `isHi` into a user-visible string (P7). No English /
 * Hindi strings live in components — they all route through `todayCopy(...)`.
 *
 * Technical terms (XP, CBSE, Bloom's, ZPD) are intentionally NOT translated.
 *
 * Interpolation tokens supported in the strings below:
 *   {subject}      — bilingual subject display name (caller resolves the code)
 *   {chapterTitle} — chapter title suffix, e.g. " · Nutrition in Plants" (caller builds suffix)
 *   {dueCount}     — number of due SRS cards
 *   {days}         — days since a topic was last studied
 *   {progress}     — lesson completion percentage (no % sign in the token)
 *   {chapter}      — chapter number (integer, used by new_topic subtitle)
 *   {n}            — generic numeric (used by the minutes badge)
 *
 * `deepLinkToHref` is the SINGLE place a parsed `TodayDeepLink` ({route, params})
 * becomes a URL string. Components never hand-build query strings.
 *
 * ── Phase 4 (2026-08-11): recommendation-reason copy ──────────────────────
 * The resolver emits 12 opaque machine `reason` strings
 * (`state/learner-loop/types.ts`). They are TELEMETRY IDENTIFIERS, never
 * student-visible text. `todayReasonCopy()` below is the ONLY place a machine
 * reason becomes learner-facing language, and it can only ever produce one of
 * the six approved phrases:
 *
 *   Review due · Continue where you stopped · Build this prerequisite ·
 *   Teacher assigned · Prepare for your test · Ready for the next concept
 *
 * Hard rule: no internal vocabulary may reach a student. IRT, BKT, DKT, CME,
 * SRS, ZPD, theta, "decay", "probability", "confidence", "fatigue", and
 * "cognitive load" must never appear in any string in this file. An unknown
 * reason resolves to `null` (render nothing) rather than falling through to
 * the raw key — the `todayCopy` "return the key" behaviour is a useful loud
 * failure for a missing translation, but it would leak `decay_above_threshold`
 * onto a child's screen.
 */

import type { TodayDeepLink } from '@alfanumrik/lib/today/types';

/** A single bilingual copy entry. */
interface CopyEntry {
  en: string;
  hi: string;
}

/**
 * The full copy table. Keys mirror the contract: shared `today.*` keys plus
 * `today.item.<type>.{label,subtitle}` for each of the 9 item types.
 *
 * Strings are verbatim from the approved Wave A copy deck — do not paraphrase.
 */
const COPY: Record<string, CopyEntry> = {
  // ── Shared chrome ──────────────────────────────────────────────
  'today.heading':      { en: 'What should I learn now?', hi: 'मुझे अभी क्या सीखना चाहिए?' },
  'today.focus':        { en: "Today's focus",    hi: 'आज का फोकस' },
  'today.minutesBadge': { en: '~{n} min',         hi: '~{n} मिनट' },
  'today.empty':        {
    en: "You're all caught up. Start a free practice?",
    hi: 'आप पूरी तरह तैयार हैं। एक मुफ़्त अभ्यास शुरू करें?',
  },

  // ── Item: resume_in_progress ───────────────────────────────────
  'today.item.resume_in_progress.label': {
    en: 'Pick up where you left off',
    hi: 'जहाँ छोड़ा था वहाँ से शुरू करें',
  },
  'today.item.resume_in_progress.subtitle': {
    en: 'Continue your {subject} session',
    hi: 'अपना {subject} सेशन जारी रखें',
  },

  // ── Item: cold_start_diagnostic ────────────────────────────────
  'today.item.cold_start_diagnostic.label': {
    en: 'Find your starting point',
    hi: 'अपनी शुरुआत खोजें',
  },
  'today.item.cold_start_diagnostic.subtitle': {
    en: 'A quick diagnostic to personalise your path',
    hi: 'आपकी राह तय करने के लिए एक छोटा डायग्नॉस्टिक',
  },

  // ── Item: teacher_remediation (Phase 3A Wave A) ────────────────
  // Tagged "from your teacher" by the card chrome; this copy is the title +
  // subtitle below the tag. Subtitle interpolates {subject} when an anchor
  // resolved (general remediation falls back to the generic subject word).
  'today.item.teacher_remediation.label': {
    en: 'Your teacher assigned this',
    hi: 'तुम्हारे शिक्षक ने यह दिया है',
  },
  'today.item.teacher_remediation.subtitle': {
    en: 'Practice {subject} — your teacher picked this for you',
    hi: '{subject} का अभ्यास — तुम्हारे शिक्षक ने यह चुना है',
  },
  'today.item.teacher_remediation.fromTeacher': {
    en: 'From your teacher',
    hi: 'तुम्हारे शिक्षक से',
  },

  // ── Item: srs_due ──────────────────────────────────────────────
  'today.item.srs_due.label': {
    en: 'Reviews due',
    hi: 'रिवीज़न बाकी है',
  },
  'today.item.srs_due.subtitle': {
    en: '{dueCount} cards ready to review',
    hi: '{dueCount} कार्ड रिवीज़न के लिए तैयार',
  },

  // ── Item: revise_decayed_topic ─────────────────────────────────
  'today.item.revise_decayed_topic.label': {
    en: 'Refresh a topic',
    hi: 'एक टॉपिक दोहराएँ',
  },
  'today.item.revise_decayed_topic.subtitle': {
    en: '{subject}{chapterTitle} · last studied {days} days ago',
    hi: '{subject}{chapterTitle} · {days} दिन पहले पढ़ा',
  },

  // ── Item: weak_topic_zpd ───────────────────────────────────────
  'today.item.weak_topic_zpd.label': {
    en: "Today's challenge",
    hi: 'आज की चुनौती',
  },
  'today.item.weak_topic_zpd.subtitle': {
    en: 'Practice {subject}{chapterTitle} at your level',
    hi: 'अपने स्तर पर {subject}{chapterTitle} का अभ्यास',
  },

  // ── Item: continue_lesson ──────────────────────────────────────
  'today.item.continue_lesson.label': {
    en: 'Continue your lesson',
    hi: 'अपना पाठ जारी रखें',
  },
  'today.item.continue_lesson.subtitle': {
    en: '{subject}{chapterTitle} · {progress}% complete',
    hi: '{subject}{chapterTitle} · {progress}% पूरा',
  },

  // ── Item: weekly_dive_due ──────────────────────────────────────
  'today.item.weekly_dive_due.label': {
    en: 'Weekly Curiosity Dive',
    hi: 'साप्ताहिक जिज्ञासा गोता',
  },
  'today.item.weekly_dive_due.subtitle': {
    en: "Explore something you're curious about",
    hi: 'जो आपको दिलचस्प लगे उसे खोजें',
  },

  // ── Item: monthly_synthesis_due ────────────────────────────────
  'today.item.monthly_synthesis_due.label': {
    en: 'Your monthly summary is ready',
    hi: 'आपका मासिक सारांश तैयार है',
  },
  'today.item.monthly_synthesis_due.subtitle': {
    en: "See how far you've come this month",
    hi: 'देखें इस महीने आप कितना आगे बढ़े',
  },

  // ── Item: practice_weakest ─────────────────────────────────────
  'today.item.practice_weakest.label': {
    en: 'Practice your weakest topic',
    hi: 'अपना कमज़ोर टॉपिक अभ्यास करें',
  },
  'today.item.practice_weakest.subtitle': {
    en: 'Strengthen {subject}{chapterTitle}',
    hi: '{subject}{chapterTitle} मजबूत करें',
  },

  // ── Item: new_topic ────────────────────────────────────────────
  'today.item.new_topic.label': {
    en: 'Start new topic',
    hi: 'नया विषय शुरू करो',
  },
  'today.item.new_topic.subtitle': {
    en: 'Begin {subject} · Chapter {chapter}',
    hi: '{subject} शुरू करो · अध्याय {chapter}',
  },

  // ── Phase 4: recommendation reasons ────────────────────────────
  // The SIX approved learner-facing phrases. Every one of the resolver's 12
  // machine reasons maps into exactly one of these (see REASON_TO_COPY_KEY).
  // Never add an entry here that names an internal model or metric.
  'today.reason.label':         { en: 'Why this',                    hi: 'यह क्यों' },
  'today.reason.review':        { en: 'Review due',                  hi: 'रिवीज़न बाकी है' },
  'today.reason.continue':      { en: 'Continue where you stopped',  hi: 'जहाँ छोड़ा था वहीं से जारी रखो' },
  'today.reason.prerequisite':  { en: 'Build this prerequisite',     hi: 'यह बुनियाद मज़बूत करो' },
  'today.reason.teacher':       { en: 'Teacher assigned',            hi: 'शिक्षक ने दिया है' },
  'today.reason.exam':          { en: 'Prepare for your test',       hi: 'अपनी परीक्षा की तैयारी करो' },
  'today.reason.nextConcept':   { en: 'Ready for the next concept',  hi: 'अगले टॉपिक के लिए तैयार' },

  // ── Phase 4: activity-type labels (closed set, one per TodayItemType) ──
  // The "what kind of work is this" line on the primary card. A fixed
  // vocabulary of student words — no internal taxonomy.
  'today.activity.resume_in_progress':    { en: 'Unfinished session', hi: 'अधूरा सेशन' },
  'today.activity.cold_start_diagnostic': { en: 'Quick check',        hi: 'छोटी जाँच' },
  'today.activity.teacher_remediation':   { en: 'Practice',           hi: 'अभ्यास' },
  'today.activity.srs_due':               { en: 'Revision cards',     hi: 'रिवीज़न कार्ड' },
  'today.activity.revise_decayed_topic':  { en: 'Re-read',            hi: 'दोबारा पढ़ो' },
  'today.activity.weak_topic_zpd':        { en: 'Practice',           hi: 'अभ्यास' },
  'today.activity.continue_lesson':       { en: 'Lesson',             hi: 'पाठ' },
  'today.activity.new_topic':             { en: 'New chapter',        hi: 'नया अध्याय' },
  'today.activity.weekly_dive_due':       { en: 'Explore',            hi: 'खोजो' },
  'today.activity.monthly_synthesis_due': { en: 'Monthly summary',    hi: 'मासिक सारांश' },
  'today.activity.practice_weakest':      { en: 'Practice',           hi: 'अभ्यास' },

  // ── Phase 4: primary card chrome ───────────────────────────────
  'today.primary.eyebrow':       { en: 'Start here',      hi: 'यहाँ से शुरू करो' },
  'today.primary.cta.start':     { en: 'Start',           hi: 'शुरू करो' },
  'today.primary.cta.continue':  { en: 'Continue',        hi: 'जारी रखो' },
  'today.primary.status.inProgress': { en: 'In progress', hi: 'चल रहा है' },
  'today.primary.status.partway':    { en: '{progress}% done', hi: '{progress}% हो गया' },
  'today.primary.status.notStarted': { en: 'Not started', hi: 'शुरू नहीं हुआ' },
  'today.primary.subjectLabel':  { en: 'Subject',         hi: 'विषय' },
  'today.primary.conceptLabel':  { en: 'Topic',           hi: 'टॉपिक' },

  // ── Phase 4: plan ──────────────────────────────────────────────
  'today.plan.heading': { en: "Today's plan", hi: 'आज की योजना' },

  // ── Phase 4: the single most urgent reminder ───────────────────
  'today.reminder.exam':          { en: 'Test {day} · {title}',                       hi: 'परीक्षा {day} · {title}' },
  'today.reminder.exam.cta':      { en: 'Revise',                                     hi: 'दोहराओ' },
  'today.reminder.streak':        { en: 'Practise today to keep your {days}-day streak', hi: 'अपनी {days} दिन की स्ट्रीक बचाने के लिए आज अभ्यास करो' },
  'today.reminder.unread':        { en: '{count} new updates for you',                hi: 'तुम्हारे लिए {count} नए अपडेट' },
  'today.reminder.unread.one':    { en: '1 new update for you',                       hi: 'तुम्हारे लिए 1 नया अपडेट' },
  'today.reminder.unread.cta':    { en: 'Open',                                       hi: 'खोलो' },

  // ── Phase 4: the single weekly progress statement ──────────────
  // Only numbers with a reliable source appear here: `current_streak` and
  // `total_xp` from the AuthContext snapshot. XP is explicitly labelled
  // "total" because the snapshot carries no weekly aggregate — we do not
  // present an all-time number as a weekly one.
  'today.progress.streak':   { en: "You've practised {days} days in a row.", hi: 'तुमने लगातार {days} दिन अभ्यास किया है।' },
  'today.progress.streakOne':{ en: "You've practised 1 day in a row.",       hi: 'तुमने 1 दिन अभ्यास किया है।' },
  'today.progress.noStreak': { en: 'No streak yet — one session today starts it.', hi: 'अभी कोई स्ट्रीक नहीं — आज एक सेशन से शुरुआत हो जाएगी।' },
  'today.progress.xpTotal':  { en: '{xp} XP total', hi: 'कुल {xp} XP' },

  // ── Phase 4: contextual Foxy entry ─────────────────────────────
  'today.foxy.subject': { en: 'Stuck on {subject}? Ask Foxy.', hi: '{subject} में अटक गए? Foxy से पूछो।' },
  'today.foxy.generic': { en: 'Stuck on something? Ask Foxy.', hi: 'कहीं अटक गए? Foxy से पूछो।' },
  'today.foxy.cta':     { en: 'Ask Foxy',                      hi: 'Foxy से पूछो' },

  // ── Phase 4: states ────────────────────────────────────────────
  // Honest-failure voice, matching the Phase 3 SubjectsUnavailable pattern:
  // a load failure explicitly denies the "you lost something" reading.
  'today.state.loading':          { en: 'Loading your plan',  hi: 'तुम्हारी योजना लोड हो रही है' },
  'today.state.stale':            { en: 'Showing your earlier plan while we refresh it.', hi: 'नई योजना आने तक पिछली योजना दिख रही है।' },
  'today.state.error.title':      { en: "Couldn't load your plan",  hi: 'तुम्हारी योजना लोड नहीं हो सकी' },
  'today.state.error.body':       { en: "Nothing has been lost — your progress is safe. Please try again.", hi: 'कुछ भी नहीं गया — तुम्हारी प्रगति सुरक्षित है। दोबारा कोशिश करो।' },
  'today.state.error.cta':        { en: 'Try again', hi: 'फिर से कोशिश करो' },
  'today.state.offline.title':    { en: "You're offline", hi: 'तुम ऑफ़लाइन हो' },
  'today.state.offline.body':     { en: "Your plan needs a connection. It'll load the moment you're back online.", hi: 'योजना के लिए कनेक्शन चाहिए। ऑनलाइन आते ही यह लोड हो जाएगी।' },
  'today.state.offline.cta':      { en: 'Try again', hi: 'फिर से कोशिश करो' },
  'today.state.insufficient.title': { en: "We don't know your level yet", hi: 'हमें अभी तुम्हारा स्तर नहीं पता' },
  'today.state.insufficient.body':  { en: 'Answer a few questions and your plan starts building itself.', hi: 'कुछ सवालों के जवाब दो, तुम्हारी योजना अपने आप बनने लगेगी।' },
  'today.state.insufficient.cta':   { en: 'Find my starting point', hi: 'मेरी शुरुआत खोजो' },
  'today.state.locked.title':     { en: 'Your plan is turned off right now', hi: 'तुम्हारी योजना अभी बंद है' },
  'today.state.locked.body':      { en: "This isn't switched on for your account yet. Nothing is lost — your dashboard still has everything.", hi: 'यह अभी तुम्हारे खाते के लिए चालू नहीं है। कुछ भी नहीं गया — डैशबोर्ड पर सब कुछ मौजूद है।' },
  'today.state.locked.cta':       { en: 'Go to dashboard', hi: 'डैशबोर्ड पर जाओ' },
  'today.state.complete.title':   { en: 'Done for today', hi: 'आज का काम पूरा' },
  'today.state.complete.body':    { en: "You've finished everything on today's plan.", hi: 'आज की योजना का सारा काम पूरा हो गया।' },
  'today.state.complete.cta':     { en: 'Practise anyway', hi: 'फिर भी अभ्यास करो' },
  'today.empty.cta':              { en: 'Start free practice', hi: 'मुफ़्त अभ्यास शुरू करो' },
};

/**
 * The reason → approved-phrase map. THE single place a machine `reason`
 * becomes student language.
 *
 * Every one of the resolver's 12 reasons is listed. Grouping rationale:
 *   - `decay_above_threshold` and `month_end_default` both land on
 *     "Review due" — a topic going stale and a month-end look-back are both
 *     "come back to something you already met". The word "decay" itself is
 *     forbidden student-side.
 *   - `todays_zpd` and `weakest_topic_practice` both land on "Build this
 *     prerequisite" — both point at the weakest chapter. "ZPD" never ships.
 *   - `no_signals_yet`, `unstarted_chapter_available` and `sunday_default`
 *     land on "Ready for the next concept" — all three are "here is the next
 *     new thing", whether it's the very first one or the weekly explore slot.
 *
 * "Prepare for your test" is the sixth approved phrase. NO resolver reason
 * produces it (the loop has no exam-driven branch), so it is not in this map
 * — it is emitted by the exam reminder, which reads the real exam schedule.
 * Mapping a resolver reason onto it would be a fabricated justification.
 */
const REASON_TO_COPY_KEY: Record<string, string> = {
  live_session:                'today.reason.continue',
  in_progress_lesson:          'today.reason.continue',
  reviews_stacking:            'today.reason.review',
  reviews_due_today:           'today.reason.review',
  decay_above_threshold:       'today.reason.review',
  month_end_default:           'today.reason.review',
  teacher_assigned:            'today.reason.teacher',
  todays_zpd:                  'today.reason.prerequisite',
  weakest_topic_practice:      'today.reason.prerequisite',
  no_signals_yet:              'today.reason.nextConcept',
  unstarted_chapter_available: 'today.reason.nextConcept',
  sunday_default:              'today.reason.nextConcept',
};

/**
 * Resolve a machine `reason` into one of the six approved learner-facing
 * phrases, or `null` when the reason is unknown to this map.
 *
 * `null` is a DELIBERATE contract: an unmapped reason (a resolver branch added
 * without updating this table) renders no reason line at all. It must never
 * degrade into printing the raw identifier — see the module header.
 */
export function todayReasonCopy(reason: string, isHi: boolean): string | null {
  const key = REASON_TO_COPY_KEY[reason];
  if (!key) return null;
  return todayCopy(key, isHi);
}

/** The exam reminder's reason phrase — the sixth approved phrase, sourced
 *  from the real exam schedule rather than from a resolver reason. */
export function todayExamReasonCopy(isHi: boolean): string {
  return todayCopy('today.reason.exam', isHi);
}

/**
 * Interpolate `{token}` placeholders from `vars`. Missing tokens are left
 * as-is only if a value isn't supplied; a supplied value (including 0) is
 * substituted. This keeps subtitles graceful when, e.g., `meta` lacks a
 * subject — the caller passes a fallback subject string rather than leaving
 * `{subject}` raw.
 */
function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = vars[token];
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolve a copy key into a bilingual, interpolated string.
 *
 * @param key   A `today.*` copy key (label/subtitle/shared).
 * @param isHi  AuthContext language toggle.
 * @param vars  Interpolation values for `{subject}`/`{dueCount}`/`{days}`/
 *              `{progress}`/`{n}`.
 *
 * Unknown keys return the key itself — a loud, visible failure that a missing
 * translation can't hide behind. Callers should never depend on this path.
 */
export function todayCopy(
  key: string,
  isHi: boolean,
  vars?: Record<string, string | number>,
): string {
  const entry = COPY[key];
  if (!entry) return key;
  return interpolate(isHi ? entry.hi : entry.en, vars);
}

/**
 * Turn a parsed `TodayDeepLink` ({route, params}) into a navigable URL string.
 *
 * The single source of URL assembly for the Today surface — components pass
 * the result straight to `router.push(...)` / an `href`. Params are appended
 * as a querystring in stable insertion order; an empty/absent params object
 * yields just the route.
 */
export function deepLinkToHref(deepLink: TodayDeepLink): string {
  const { route, params } = deepLink;
  if (!params) return route;
  const entries = Object.entries(params);
  if (entries.length === 0) return route;
  const qs = new URLSearchParams();
  for (const [key, value] of entries) {
    qs.set(key, String(value));
  }
  return `${route}?${qs.toString()}`;
}
