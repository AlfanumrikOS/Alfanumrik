// today_copy.dart — bilingual copy resolver + deep-link helper for the mobile
// "Today" home. This is the Dart twin of web's `src/lib/today/copy.ts`,
// `render.ts`, and `icon-map.ts`.
//
// The `/v2` `TodayQueueItem` render contract carries only i18n KEYS
// (`labelKey` = `today.item.<type>.label`, `subtitleKey` = `…subtitle`) plus
// `iconHint`. This module turns a key + `isHi` into a user-visible string (P7).
// No Hindi/English strings live in the widgets — they all route through
// [todayCopy] / [resolveItemCopy], exactly as the web surface routes
// everything through `todayCopy(...)`.
//
// Strings are copied VERBATIM from the approved Wave A copy deck
// (`src/lib/today/copy.ts`) — do not paraphrase. Technical terms (XP, CBSE,
// Bloom's, ZPD) are intentionally NOT translated.

import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';

import '../../../data/models/subject.dart';

/// A single bilingual copy entry.
class _CopyEntry {
  final String en;
  final String hi;
  const _CopyEntry(this.en, this.hi);
}

/// The full copy table. Keys mirror the web contract: shared `today.*` keys
/// plus `today.item.<type>.{label,subtitle}` for each of the 9 item types.
const Map<String, _CopyEntry> _copy = {
  // ── Shared chrome ──────────────────────────────────────────────
  'today.heading': _CopyEntry('Today', 'आज'),
  'today.focus': _CopyEntry("Today's focus", 'आज का फोकस'),
  'today.minutesBadge': _CopyEntry('~{n} min', '~{n} मिनट'),
  'today.empty': _CopyEntry(
    "You're all caught up. Start a free practice?",
    'आप पूरी तरह तैयार हैं। एक मुफ़्त अभ्यास शुरू करें?',
  ),

  // ── Item: resume_in_progress ───────────────────────────────────
  'today.item.resume_in_progress.label': _CopyEntry(
    'Pick up where you left off',
    'जहाँ छोड़ा था वहाँ से शुरू करें',
  ),
  'today.item.resume_in_progress.subtitle': _CopyEntry(
    'Continue your {subject} session',
    'अपना {subject} सेशन जारी रखें',
  ),

  // ── Item: cold_start_diagnostic ────────────────────────────────
  'today.item.cold_start_diagnostic.label': _CopyEntry(
    'Find your starting point',
    'अपनी शुरुआत खोजें',
  ),
  'today.item.cold_start_diagnostic.subtitle': _CopyEntry(
    'A quick diagnostic to personalise your path',
    'आपकी राह तय करने के लिए एक छोटा डायग्नॉस्टिक',
  ),

  // ── Item: srs_due ──────────────────────────────────────────────
  'today.item.srs_due.label': _CopyEntry('Reviews due', 'रिवीज़न बाकी है'),
  'today.item.srs_due.subtitle': _CopyEntry(
    '{dueCount} cards ready to review',
    '{dueCount} कार्ड रिवीज़न के लिए तैयार',
  ),

  // ── Item: revise_decayed_topic ─────────────────────────────────
  'today.item.revise_decayed_topic.label': _CopyEntry(
    'Refresh a topic',
    'एक टॉपिक दोहराएँ',
  ),
  'today.item.revise_decayed_topic.subtitle': _CopyEntry(
    '{subject} · last studied {days} days ago',
    '{subject} · {days} दिन पहले पढ़ा',
  ),

  // ── Item: weak_topic_zpd ───────────────────────────────────────
  'today.item.weak_topic_zpd.label': _CopyEntry(
    "Today's challenge",
    'आज की चुनौती',
  ),
  'today.item.weak_topic_zpd.subtitle': _CopyEntry(
    'Practice {subject} at your level',
    'अपने स्तर पर {subject} का अभ्यास',
  ),

  // ── Item: continue_lesson ──────────────────────────────────────
  'today.item.continue_lesson.label': _CopyEntry(
    'Continue your lesson',
    'अपना पाठ जारी रखें',
  ),
  'today.item.continue_lesson.subtitle': _CopyEntry(
    '{subject} · {progress}% complete',
    '{subject} · {progress}% पूरा',
  ),

  // ── Item: weekly_dive_due ──────────────────────────────────────
  'today.item.weekly_dive_due.label': _CopyEntry(
    'Weekly Curiosity Dive',
    'साप्ताहिक जिज्ञासा गोता',
  ),
  'today.item.weekly_dive_due.subtitle': _CopyEntry(
    "Explore something you're curious about",
    'जो आपको दिलचस्प लगे उसे खोजें',
  ),

  // ── Item: monthly_synthesis_due ────────────────────────────────
  'today.item.monthly_synthesis_due.label': _CopyEntry(
    'Your monthly summary is ready',
    'आपका मासिक सारांश तैयार है',
  ),
  'today.item.monthly_synthesis_due.subtitle': _CopyEntry(
    "See how far you've come this month",
    'देखें इस महीने आप कितना आगे बढ़े',
  ),

  // ── Item: practice_weakest ─────────────────────────────────────
  'today.item.practice_weakest.label': _CopyEntry(
    'Practice your weakest topic',
    'अपना कमज़ोर टॉपिक अभ्यास करें',
  ),
  'today.item.practice_weakest.subtitle': _CopyEntry(
    'Strengthen {subject}',
    '{subject} मजबूत करें',
  ),
};

/// Interpolate `{token}` placeholders from [vars]. Missing tokens are left
/// as-is (matches web's `interpolate`); a supplied value (including 0) is
/// substituted.
String _interpolate(String template, Map<String, Object>? vars) {
  if (vars == null) return template;
  return template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) {
    final token = m.group(1)!;
    final value = vars[token];
    return value == null ? m.group(0)! : value.toString();
  });
}

/// Resolve a copy key into a bilingual, interpolated string.
///
/// Unknown keys return the key itself — a loud, visible failure so a missing
/// translation can't hide. Mirrors web `todayCopy`.
String todayCopy(String key, bool isHi, [Map<String, Object>? vars]) {
  final entry = _copy[key];
  if (entry == null) return key;
  return _interpolate(isHi ? entry.hi : entry.en, vars);
}

/// Maps the resolver's opaque `iconHint` strings to emoji glyphs — the Dart
/// twin of web's `icon-map.ts`. Keeps Today visually consistent with the
/// emoji-based design language already used across the app and adds zero
/// asset weight. Unknown hints fall back to a neutral spark glyph.
const Map<String, String> _iconByHint = {
  'play-resume': '▶️',
  'compass': '🧭',
  'cards-stack': '🗂️',
  'refresh-book': '🔁',
  'target': '🎯',
  'book-open': '📖',
  'telescope': '🔭',
  'scroll': '📜',
};

/// Resolve an `iconHint` to its emoji glyph; neutral fallback for unknowns.
String todayIcon(String iconHint) => _iconByHint[iconHint] ?? '✨';

/// Read a `meta` value out of the built_value `BuiltMap<String, JsonObject?>`
/// the generated DTO carries, returning the raw Dart value (String / num /
/// bool) or null.
Object? _metaValue(BuiltMap<String, JsonObject?>? meta, String key) {
  if (meta == null) return null;
  final jsonObj = meta[key];
  return jsonObj?.value;
}

/// Resolve a subject CODE (from `item.meta.subjectCode`) to its bilingual
/// display name using the canonical allowed-subjects list. Falls back to a
/// generic word when the code is absent/unknown, so subtitles never render a
/// raw `{subject}` token or an internal code. Mirrors web `resolveSubjectName`.
String _resolveSubjectName(
  Object? subjectCode,
  List<Subject> subjects,
  bool isHi,
) {
  if (subjectCode is String && subjectCode.isNotEmpty) {
    for (final s in subjects) {
      if (s.code == subjectCode) return isHi ? s.nameHi : s.name;
    }
  }
  return isHi ? 'अपने विषय' : 'your subject';
}

/// Build the `{subject}`/`{dueCount}`/`{days}`/`{progress}` interpolation vars
/// for a queue item from its `meta`. Absent fields are simply not added.
/// Mirrors web `varsForItem`.
Map<String, Object> _varsForItem(
  TodayQueueItem item,
  List<Subject> subjects,
  bool isHi,
) {
  final meta = item.meta;
  final vars = <String, Object>{
    'subject': _resolveSubjectName(_metaValue(meta, 'subjectCode'), subjects, isHi),
  };
  final dueCount = _metaValue(meta, 'dueCount');
  if (dueCount is num) vars['dueCount'] = dueCount.toInt();
  final days = _metaValue(meta, 'daysSinceLastTouch');
  if (days is num) vars['days'] = days.toInt();
  final progress = _metaValue(meta, 'progressPct');
  if (progress is num) vars['progress'] = progress.round();
  return vars;
}

/// Resolved, ready-to-render copy for a single Today item.
class ResolvedItemCopy {
  final String label;
  final String subtitle;

  /// Pre-formatted "~N min" badge.
  final String minutesBadge;

  /// Emoji glyph for the item's `iconHint`.
  final String icon;

  const ResolvedItemCopy({
    required this.label,
    required this.subtitle,
    required this.minutesBadge,
    required this.icon,
  });
}

/// Resolve a queue item's label, subtitle, minutes badge, and icon into final
/// bilingual strings. The one entry point the Today widgets use. Mirrors web
/// `resolveItemCopy`.
ResolvedItemCopy resolveItemCopy(
  TodayQueueItem item,
  List<Subject> subjects,
  bool isHi,
) {
  final vars = _varsForItem(item, subjects, isHi);
  return ResolvedItemCopy(
    label: todayCopy(item.labelKey, isHi, vars),
    subtitle: todayCopy(item.subtitleKey, isHi, vars),
    minutesBadge: todayCopy('today.minutesBadge', isHi, {'n': item.estMinutes}),
    icon: todayIcon(item.iconHint),
  );
}
