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
 *   {subject}   — bilingual subject display name (caller resolves the code)
 *   {dueCount}  — number of due SRS cards
 *   {days}      — days since a topic was last studied
 *   {progress}  — lesson completion percentage (no % sign in the token)
 *   {n}         — generic numeric (used by the minutes badge)
 *
 * `deepLinkToHref` is the SINGLE place a parsed `TodayDeepLink` ({route, params})
 * becomes a URL string. Components never hand-build query strings.
 */

import type { TodayDeepLink } from '@/lib/today/types';

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
  'today.heading':      { en: 'Today',            hi: 'आज' },
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
    en: '{subject} · last studied {days} days ago',
    hi: '{subject} · {days} दिन पहले पढ़ा',
  },

  // ── Item: weak_topic_zpd ───────────────────────────────────────
  'today.item.weak_topic_zpd.label': {
    en: "Today's challenge",
    hi: 'आज की चुनौती',
  },
  'today.item.weak_topic_zpd.subtitle': {
    en: 'Practice {subject} at your level',
    hi: 'अपने स्तर पर {subject} का अभ्यास',
  },

  // ── Item: continue_lesson ──────────────────────────────────────
  'today.item.continue_lesson.label': {
    en: 'Continue your lesson',
    hi: 'अपना पाठ जारी रखें',
  },
  'today.item.continue_lesson.subtitle': {
    en: '{subject} · {progress}% complete',
    hi: '{subject} · {progress}% पूरा',
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
    en: 'Strengthen {subject}',
    hi: '{subject} मजबूत करें',
  },
};

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
