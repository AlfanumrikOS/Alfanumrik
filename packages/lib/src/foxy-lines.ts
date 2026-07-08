/**
 * Foxy Personality Lines — short, human reactions for quiz feedback and sessions.
 * Bilingual (en/hi). Never mocking, always encouraging.
 */

interface FoxyLine {
  en: string;
  hi: string;
}

// Correct answer — escalates with streak
const CORRECT_LINES: FoxyLine[][] = [
  // Streak 1 (single correct)
  [
    { en: 'Nice!', hi: 'बढ़िया!' },
    { en: 'Got it!', hi: 'सही!' },
    { en: 'Right on.', hi: 'बिल्कुल सही।' },
  ],
  // Streak 2-3
  [
    { en: "You're rolling!", hi: 'चलते रहो!' },
    { en: 'Keep it going!', hi: 'बस ऐसे ही!' },
    { en: 'Solid.', hi: 'जबरदस्त।' },
  ],
  // Streak 4-5
  [
    { en: 'On fire!', hi: 'आग लगा दी!' },
    { en: 'Unstoppable!', hi: 'रोक नहीं सकते!' },
    { en: 'You really know this.', hi: 'तुम्हें ये अच्छे से आता है।' },
  ],
  // Streak 6+
  [
    { en: 'Incredible streak!', hi: 'शानदार सिलसिला!' },
    { en: 'Foxy is impressed.', hi: 'Foxy प्रभावित है।' },
    { en: "You're mastering this.", hi: 'तुम इसमें माहिर हो रहे हो।' },
  ],
];

// Wrong answer — compassionate, never mocking
const WRONG_LINES: FoxyLine[][] = [
  // First wrong
  [
    { en: "Close! Let's see why.", hi: "करीब! चलो देखते हैं क्यों।" },
    { en: 'Not quite — check this.', hi: 'बिल्कुल नहीं — ये देखो।' },
    { en: "Tricky one. Here's the key.", hi: 'मुश्किल था। ये रहा जवाब।' },
  ],
  // Repeated wrong
  [
    { en: "It's okay, you're learning.", hi: 'कोई बात नहीं, सीख रहे हो।' },
    { en: "Don't worry — this is how it works.", hi: 'चिंता मत करो — ऐसे ही सीखते हैं।' },
    { en: 'Every mistake teaches something.', hi: 'हर गलती कुछ सिखाती है।' },
  ],
];

// Session complete
const SESSION_COMPLETE_LINES: FoxyLine[] = [
  { en: 'Great session! You showed up, and that matters.', hi: 'बढ़िया सत्र! तुमने मेहनत की, यही मायने रखता है।' },
  { en: "You're getting stronger every time.", hi: 'हर बार तुम और मज़बूत हो रहे हो।' },
  { en: "Proud of you. Let's keep this going.", hi: 'तुम पर गर्व है। ऐसे ही चलते रहो।' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getCorrectLine(streak: number, isHi: boolean): string {
  const tier = streak <= 1 ? 0 : streak <= 3 ? 1 : streak <= 5 ? 2 : 3;
  const line = pick(CORRECT_LINES[tier]);
  return isHi ? line.hi : line.en;
}

export function getWrongLine(wrongStreak: number, isHi: boolean): string {
  const tier = wrongStreak <= 1 ? 0 : 1;
  const line = pick(WRONG_LINES[tier]);
  return isHi ? line.hi : line.en;
}

export function getSessionCompleteLine(isHi: boolean): string {
  const line = pick(SESSION_COMPLETE_LINES);
  return isHi ? line.hi : line.en;
}
