// cheer_presets.dart — the mobile mirror of the web Parent→Child cheer catalog
// (`src/lib/parent/cheer-catalog.ts`, "Wave D — D-encourage").
//
// A "cheer" is a small, PRESET-keyed encouragement a parent sends to a linked
// child. Messages are NEVER free text — the parent picks one of the curated
// presets below by its `messageKey`, and that key (NOT the rendered string) is
// what `POST /v2/parent/encourage` persists. The server re-derives the rendered
// notification copy from the authoritative web catalog at send time.
//
// ┌─ SYNC CONTRACT ───────────────────────────────────────────────────────────┐
// │ This list MUST stay in sync with `src/lib/parent/cheer-catalog.ts`.        │
// │ The `messageKey` values are the cross-surface contract (they map onto      │
// │ `parent_cheers.message_key` and are validated server-side by               │
// │ `isValidMessageKey`). Renaming a key is a BREAKING change; adding a key is │
// │ safe. The label strings here are the MOBILE picker copy only — the actual  │
// │ notification the child receives is rendered server-side from the web       │
// │ catalog, so the wording here is advisory and need not be byte-identical,   │
// │ but it SHOULD track the web `titleEn`/`titleHi` so the picker matches what │
// │ the child will see. There are exactly 8 keys (great_work, keep_going,      │
// │ so_proud, effort_counts, streak_star, quiz_champion, big_milestone,        │
// │ believe_in_you).                                                           │
// └────────────────────────────────────────────────────────────────────────────┘
//
// Product invariants honoured here:
//   • P12 (content safety): no free text — only the 8 fixed, age-appropriate
//     presets below can ever be sent.
//   • P13 (privacy): presets contain NO PII — generic, reusable across all
//     children. The encourage call sends only { student_id, message_key }.
//   • P7 (bilingual): every preset carries an English and a Hindi label so the
//     picker renders in the parent's language.

/// A single mobile cheer preset. [messageKey] is the wire contract; the rest is
/// picker presentation. [titleEn] / [titleHi] mirror the web catalog's
/// `titleEn` / `titleHi`.
class CheerPreset {
  /// The `message_key` sent to `POST /v2/parent/encourage`. Part of the stored
  /// data contract (`parent_cheers.message_key`) — do NOT rename.
  final String messageKey;

  /// Picker label — English (mirrors web `titleEn`).
  final String titleEn;

  /// Picker label — Hindi (mirrors web `titleHi`).
  final String titleHi;

  /// A short emoji/icon hint for the picker (mirrors web `icon`).
  final String icon;

  const CheerPreset({
    required this.messageKey,
    required this.titleEn,
    required this.titleHi,
    required this.icon,
  });

  /// Resolve the picker label for the given language.
  String title(bool isHi) => isHi ? titleHi : titleEn;
}

/// The fixed catalog of 8 cheers, in display order. Mirrors `CHEER_PRESETS` in
/// `src/lib/parent/cheer-catalog.ts` (same 8 keys, same icons, titles tracked).
const List<CheerPreset> kCheerPresets = [
  CheerPreset(
    messageKey: 'great_work',
    titleEn: 'Great work! 🌟',
    titleHi: 'शाबाश! 🌟',
    icon: '🌟',
  ),
  CheerPreset(
    messageKey: 'keep_going',
    titleEn: 'Keep going! 💪',
    titleHi: 'आगे बढ़ते रहो! 💪',
    icon: '💪',
  ),
  CheerPreset(
    messageKey: 'so_proud',
    titleEn: 'So proud of you! ❤️',
    titleHi: 'तुम पर बहुत गर्व है! ❤️',
    icon: '❤️',
  ),
  CheerPreset(
    messageKey: 'effort_counts',
    titleEn: 'Your effort counts! ✨',
    titleHi: 'तुम्हारी मेहनत मायने रखती है! ✨',
    icon: '✨',
  ),
  CheerPreset(
    messageKey: 'streak_star',
    titleEn: 'Streak star! 🔥',
    titleHi: 'स्ट्रीक स्टार! 🔥',
    icon: '🔥',
  ),
  CheerPreset(
    messageKey: 'quiz_champion',
    titleEn: 'Quiz champion! 🏆',
    titleHi: 'क्विज़ चैंपियन! 🏆',
    icon: '🏆',
  ),
  CheerPreset(
    messageKey: 'big_milestone',
    titleEn: 'What a milestone! 🎉',
    titleHi: 'क्या उपलब्धि है! 🎉',
    icon: '🎉',
  ),
  CheerPreset(
    messageKey: 'believe_in_you',
    titleEn: 'We believe in you! 🌈',
    titleHi: 'हमें तुम पर विश्वास है! 🌈',
    icon: '🌈',
  ),
];

/// The default cheer key (mirrors web `DEFAULT_MESSAGE_KEY`). The server also
/// falls back to this when no key is supplied; the mobile picker always sends an
/// explicit key, so this is only a defensive default.
const String kDefaultCheerKey = 'great_work';
