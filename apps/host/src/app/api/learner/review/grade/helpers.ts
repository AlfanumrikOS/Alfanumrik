const EASE_FLOOR = 1.3;
const EASE_CEIL = 3.0;
const INTERVAL_CAP_DAYS = 365;
const STREAK_CAP = 100;

export interface Sm2Input {
  easeFactor: number;
  intervalDays: number;
  streak: number;
  quality: 0 | 3 | 4 | 5;
}

export interface Sm2Output {
  easeFactor: number;
  intervalDays: number;
  streak: number;
}

export function applySm2(input: Sm2Input): Sm2Output {
  let newEase = input.easeFactor + (0.1 - (5 - input.quality) * (0.08 + (5 - input.quality) * 0.02));
  if (newEase < EASE_FLOOR) newEase = EASE_FLOOR;
  if (newEase > EASE_CEIL) newEase = EASE_CEIL;

  let newInterval = input.intervalDays;
  let newStreak = input.streak;

  if (input.quality < 3) {
    newInterval = 1;
    newStreak = 0;
  } else {
    if (input.streak === 0) newInterval = 1;
    else if (input.streak === 1) newInterval = 6;
    else newInterval = Math.round(input.intervalDays * newEase);
    newStreak = input.streak + 1;
  }

  if (newInterval > INTERVAL_CAP_DAYS) newInterval = INTERVAL_CAP_DAYS;
  if (newStreak > STREAK_CAP) newStreak = STREAK_CAP;

  return { easeFactor: newEase, intervalDays: newInterval, streak: newStreak };
}

export function coerceSource(
  raw: string | null,
): 'quiz_wrong_answer' | 'foxy_chat' | 'study_plan' {
  if (raw === 'quiz_wrong_answer' || raw === 'foxy_chat' || raw === 'study_plan') {
    return raw;
  }
  return 'study_plan';
}

export function parseChapterNumber(title: string | null): number | null {
  if (!title) return null;
  const match = title.match(/(?:chapter\s+)?(\d{1,3})\b/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
