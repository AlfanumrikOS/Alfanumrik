/**
 * Parent → Child Cheer Catalog (Wave D — "D-encourage").
 *
 * A "cheer" is a small, preset-keyed encouragement a parent sends to a linked
 * child. Messages are NEVER free text — a parent picks one of the curated
 * presets below by its `message_key`. This is a hard product-safety boundary:
 *
 *   - P12 (AI safety / content safety): no unfiltered, parent-authored text
 *     ever reaches a child. Every cheer is a fixed, age-appropriate string.
 *   - P13 (data privacy): presets contain NO PII — no names, no contact info,
 *     no school. They are generic, warm, and reusable across all children.
 *   - P7 (bilingual UI): every preset ships an English and a Hindi variant so
 *     the child's notification can render in their preferred language.
 *
 * Tone: warm, encouraging, and appropriate for CBSE grades 6-12. Short enough
 * to fit a notification title + body. No pressure / no shaming language.
 *
 * The `cheer_type` maps onto the `parent_cheers.cheer_type` CHECK constraint
 * ('generic' | 'streak' | 'quiz' | 'effort' | 'milestone'). The `message_key`
 * is what gets persisted; the rendered strings are server-derived from this
 * catalog at send time, so the wording can be improved later without a data
 * migration.
 */

/** The cheer categories, mirroring the parent_cheers.cheer_type CHECK. */
export type CheerType = 'generic' | 'streak' | 'quiz' | 'effort' | 'milestone';

/** A single preset cheer. All strings are fixed and contain no PII. */
export interface CheerPreset {
  /** Maps onto parent_cheers.cheer_type. */
  cheerType: CheerType;
  /** Notification title — English. */
  titleEn: string;
  /** Notification title — Hindi. */
  titleHi: string;
  /** Notification body — English. */
  bodyEn: string;
  /** Notification body — Hindi. */
  bodyHi: string;
  /** A short emoji/icon hint for the UI. */
  icon: string;
}

/**
 * The fixed catalog of cheers, keyed by `message_key`.
 *
 * IMPORTANT: keys are part of the stored data contract (parent_cheers.message_key)
 * — renaming a key is a breaking change. Adding a new key is safe. Removing a key
 * is safe for new sends but historical rows will fall back to DEFAULT on render.
 */
export const CHEER_PRESETS: Record<string, CheerPreset> = {
  great_work: {
    cheerType: 'generic',
    titleEn: 'Great work! 🌟',
    titleHi: 'शाबाश! 🌟',
    bodyEn: 'Your family is proud of the effort you are putting in. Keep it up!',
    bodyHi: 'आपका परिवार आपकी मेहनत पर गर्व करता है। ऐसे ही करते रहो!',
    icon: '🌟',
  },
  keep_going: {
    cheerType: 'generic',
    titleEn: 'Keep going! 💪',
    titleHi: 'आगे बढ़ते रहो! 💪',
    bodyEn: 'Every little step counts. You are doing better than you think.',
    bodyHi: 'हर छोटा कदम मायने रखता है। तुम सोच से बेहतर कर रहे हो।',
    icon: '💪',
  },
  so_proud: {
    cheerType: 'generic',
    titleEn: 'So proud of you! ❤️',
    titleHi: 'तुम पर बहुत गर्व है! ❤️',
    bodyEn: 'Someone at home noticed how hard you are working. Well done!',
    bodyHi: 'घर पर किसी ने देखा कि तुम कितनी मेहनत कर रहे हो। बहुत बढ़िया!',
    icon: '❤️',
  },
  effort_counts: {
    cheerType: 'effort',
    titleEn: 'Your effort counts! ✨',
    titleHi: 'तुम्हारी मेहनत मायने रखती है! ✨',
    bodyEn: 'Trying your best is what matters most. We see your hard work.',
    bodyHi: 'अपना सर्वश्रेष्ठ देना सबसे ज़रूरी है। हम तुम्हारी मेहनत देख रहे हैं।',
    icon: '✨',
  },
  streak_star: {
    cheerType: 'streak',
    titleEn: 'Streak star! 🔥',
    titleHi: 'स्ट्रीक स्टार! 🔥',
    bodyEn: 'Showing up every day is a real superpower. Keep the streak alive!',
    bodyHi: 'हर दिन सीखना एक असली सुपरपावर है। अपनी स्ट्रीक बनाए रखो!',
    icon: '🔥',
  },
  quiz_champion: {
    cheerType: 'quiz',
    titleEn: 'Quiz champion! 🏆',
    titleHi: 'क्विज़ चैंपियन! 🏆',
    bodyEn: 'Awesome work on your quizzes. Your practice is paying off!',
    bodyHi: 'क्विज़ में शानदार काम। तुम्हारी मेहनत रंग ला रही है!',
    icon: '🏆',
  },
  big_milestone: {
    cheerType: 'milestone',
    titleEn: 'What a milestone! 🎉',
    titleHi: 'क्या उपलब्धि है! 🎉',
    bodyEn: 'You reached something special today. Celebrate it — you earned it!',
    bodyHi: 'आज तुमने कुछ खास हासिल किया। जश्न मनाओ — यह तुमने कमाया है!',
    icon: '🎉',
  },
  believe_in_you: {
    cheerType: 'generic',
    titleEn: 'We believe in you! 🌈',
    titleHi: 'हमें तुम पर विश्वास है! 🌈',
    bodyEn: 'No matter how today went, tomorrow is a fresh start. You can do this!',
    bodyHi: 'आज जैसा भी रहा, कल एक नई शुरुआत है। तुम यह कर सकते हो!',
    icon: '🌈',
  },
};

/** The default cheer used when no key (or an absent key) is supplied. */
export const DEFAULT_MESSAGE_KEY = 'great_work';

/** Type guard: is `k` a known, served preset key? */
export function isValidMessageKey(k: string | null | undefined): k is string {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(CHEER_PRESETS, k);
}

/**
 * Resolve a preset by key. Returns `null` for unknown keys so callers can
 * decide whether to reject (present-but-unknown) or fall back to the default.
 */
export function getPreset(k: string | null | undefined): CheerPreset | null {
  if (!isValidMessageKey(k)) return null;
  return CHEER_PRESETS[k];
}
