import { describe, it, expect } from 'vitest';
import {
  SUBJECT_ROTATION,
  getSubjectForDay,
  CHALLENGE_COINS,
  STREAK_MILESTONES,
  GRACE_PERIOD_DAYS,
  ZPD_DIFFICULTY,
  getDifficultyForZPD,
  getMercyDaysForGrade,
  STREAK_VISIBILITY_THRESHOLD,
  type DayConfig,
  type ChallengeDifficulty,
  type StreakMilestone,
} from '@/lib/challenge-config';

/**
 * Daily Challenge Configuration Tests
 *
 * Tests all constants, rotation logic, ZPD difficulty mapping,
 * mercy day rules, and streak milestone structure.
 */

// ---- SUBJECT_ROTATION ----

describe('SUBJECT_ROTATION', () => {
  it('has entries for all 7 days of the week (0-6)', () => {
    for (let day = 0; day <= 6; day++) {
      expect(SUBJECT_ROTATION[day]).toBeDefined();
    }
  });

  it('Sunday (0) is mixed with labelEn and labelHi', () => {
    const sunday = SUBJECT_ROTATION[0];
    expect(sunday.subject).toBe('mixed');
    expect(sunday.mixed).toBe(true);
    expect(sunday.labelEn).toBeTruthy();
    expect(sunday.labelHi).toBeTruthy();
  });

  it('Monday (1) is math', () => {
    expect(SUBJECT_ROTATION[1].subject).toBe('math');
  });

  it('Tuesday (2) is science', () => {
    expect(SUBJECT_ROTATION[2].subject).toBe('science');
  });

  it('Wednesday (3) is english', () => {
    expect(SUBJECT_ROTATION[3].subject).toBe('english');
  });

  it('Thursday (4) is social_studies', () => {
    expect(SUBJECT_ROTATION[4].subject).toBe('social_studies');
  });

  it('Friday (5) is math', () => {
    expect(SUBJECT_ROTATION[5].subject).toBe('math');
  });

  it('Saturday (6) is personalized', () => {
    const saturday = SUBJECT_ROTATION[6];
    expect(saturday.personalized).toBe(true);
    expect(saturday.labelEn).toBeTruthy();
    expect(saturday.labelHi).toBeTruthy();
  });

  it('every DayConfig has both labelEn and labelHi (bilingual P7)', () => {
    for (let day = 0; day <= 6; day++) {
      const config = SUBJECT_ROTATION[day];
      expect(config.labelEn).toBeTruthy();
      expect(config.labelHi).toBeTruthy();
    }
  });
});

// ---- getSubjectForDay ----

describe('getSubjectForDay', () => {
  it('returns "mixed" for Sunday (0)', () => {
    expect(getSubjectForDay(0)).toBe('mixed');
  });

  it('returns "math" for Monday (1)', () => {
    expect(getSubjectForDay(1)).toBe('math');
  });

  it('returns "science" for Tuesday (2)', () => {
    expect(getSubjectForDay(2)).toBe('science');
  });

  it('returns "english" for Wednesday (3)', () => {
    expect(getSubjectForDay(3)).toBe('english');
  });

  it('returns "social_studies" for Thursday (4)', () => {
    expect(getSubjectForDay(4)).toBe('social_studies');
  });

  it('returns "math" for Friday (5)', () => {
    expect(getSubjectForDay(5)).toBe('math');
  });

  it('returns null for Saturday (6) — personalized', () => {
    expect(getSubjectForDay(6)).toBeNull();
  });
});

// ---- CHALLENGE_COINS ----

describe('CHALLENGE_COINS', () => {
  it('has correct solve value', () => {
    expect(CHALLENGE_COINS.solve).toBe(15);
  });

  it('has correct streak_7_bonus', () => {
    expect(CHALLENGE_COINS.streak_7_bonus).toBe(25);
  });

  it('has correct streak_30_bonus', () => {
    expect(CHALLENGE_COINS.streak_30_bonus).toBe(100);
  });

  it('has correct streak_100_bonus', () => {
    expect(CHALLENGE_COINS.streak_100_bonus).toBe(500);
  });
});

// ---- STREAK_MILESTONES ----

describe('STREAK_MILESTONES', () => {
  it('has exactly 3 milestones', () => {
    expect(STREAK_MILESTONES).toHaveLength(3);
  });

  it('first milestone is 7-day bronze', () => {
    const m = STREAK_MILESTONES[0];
    expect(m.days).toBe(7);
    expect(m.badgeId).toBe('bronze_7');
    expect(m.badgeIcon).toContain('\u{1F949}'); // bronze medal emoji
    expect(m.coins).toBe(25);
    expect(m.badgeLabel).toBeTruthy();
    expect(m.badgeLabelHi).toBeTruthy();
  });

  it('second milestone is 30-day silver', () => {
    const m = STREAK_MILESTONES[1];
    expect(m.days).toBe(30);
    expect(m.badgeId).toBe('silver_30');
    expect(m.badgeIcon).toContain('\u{1F948}'); // silver medal emoji
    expect(m.coins).toBe(100);
    expect(m.badgeLabel).toBeTruthy();
    expect(m.badgeLabelHi).toBeTruthy();
  });

  it('third milestone is 100-day gold', () => {
    const m = STREAK_MILESTONES[2];
    expect(m.days).toBe(100);
    expect(m.badgeId).toBe('gold_100');
    expect(m.badgeIcon).toContain('\u{1F947}'); // gold medal emoji
    expect(m.coins).toBe(500);
    expect(m.badgeLabel).toBeTruthy();
    expect(m.badgeLabelHi).toBeTruthy();
  });

  it('milestone coins match CHALLENGE_COINS streak bonuses', () => {
    expect(STREAK_MILESTONES[0].coins).toBe(CHALLENGE_COINS.streak_7_bonus);
    expect(STREAK_MILESTONES[1].coins).toBe(CHALLENGE_COINS.streak_30_bonus);
    expect(STREAK_MILESTONES[2].coins).toBe(CHALLENGE_COINS.streak_100_bonus);
  });
});

// ---- GRACE_PERIOD_DAYS ----

describe('GRACE_PERIOD_DAYS', () => {
  it('is 3', () => {
    expect(GRACE_PERIOD_DAYS).toBe(3);
  });
});

// ---- ZPD_DIFFICULTY ----

describe('ZPD_DIFFICULTY', () => {
  it('has 4 bands', () => {
    expect(ZPD_DIFFICULTY).toHaveLength(4);
  });

  it('low band: zpd <= 0.4, 4 cards, 0 distractors', () => {
    const low = ZPD_DIFFICULTY[0];
    expect(low.maxZpd).toBe(0.4);
    expect(low.cardCount).toBe(4);
    expect(low.distractorCount).toBe(0);
    expect(low.band).toBe('low');
  });

  it('medium band: zpd <= 0.7, 5 cards, 0 distractors', () => {
    const med = ZPD_DIFFICULTY[1];
    expect(med.maxZpd).toBe(0.7);
    expect(med.cardCount).toBe(5);
    expect(med.distractorCount).toBe(0);
    expect(med.band).toBe('medium');
  });

  it('high band: zpd <= 0.9, 5 cards, 1 distractor', () => {
    const high = ZPD_DIFFICULTY[2];
    expect(high.maxZpd).toBe(0.9);
    expect(high.cardCount).toBe(5);
    expect(high.distractorCount).toBe(1);
    expect(high.band).toBe('high');
  });

  it('expert band: zpd <= 1.0, 5 cards, 2 distractors', () => {
    const expert = ZPD_DIFFICULTY[3];
    expect(expert.maxZpd).toBe(1.0);
    expect(expert.cardCount).toBe(5);
    expect(expert.distractorCount).toBe(2);
    expect(expert.band).toBe('expert');
  });
});

// ---- getDifficultyForZPD ----

describe('getDifficultyForZPD', () => {
  it('returns low band for zpd = 0.0', () => {
    const d = getDifficultyForZPD(0.0);
    expect(d.band).toBe('low');
    expect(d.cardCount).toBe(4);
    expect(d.distractorCount).toBe(0);
  });

  it('returns low band for zpd = 0.4', () => {
    const d = getDifficultyForZPD(0.4);
    expect(d.band).toBe('low');
  });

  it('returns medium band for zpd = 0.41', () => {
    const d = getDifficultyForZPD(0.41);
    expect(d.band).toBe('medium');
  });

  it('returns medium band for zpd = 0.7', () => {
    const d = getDifficultyForZPD(0.7);
    expect(d.band).toBe('medium');
  });

  it('returns high band for zpd = 0.71', () => {
    const d = getDifficultyForZPD(0.71);
    expect(d.band).toBe('high');
  });

  it('returns high band for zpd = 0.9', () => {
    const d = getDifficultyForZPD(0.9);
    expect(d.band).toBe('high');
  });

  it('returns expert band for zpd = 0.91', () => {
    const d = getDifficultyForZPD(0.91);
    expect(d.band).toBe('expert');
  });

  it('returns expert band for zpd = 1.0', () => {
    const d = getDifficultyForZPD(1.0);
    expect(d.band).toBe('expert');
  });

  it('clamps negative zpd to low band', () => {
    const d = getDifficultyForZPD(-0.5);
    expect(d.band).toBe('low');
  });

  it('clamps zpd above 1.0 to expert band', () => {
    const d = getDifficultyForZPD(1.5);
    expect(d.band).toBe('expert');
  });
});

// ---- getMercyDaysForGrade ----

describe('getMercyDaysForGrade', () => {
  it('grade "6" gets 2 mercy days', () => {
    expect(getMercyDaysForGrade('6')).toBe(2);
  });

  it('grade "7" gets 2 mercy days', () => {
    expect(getMercyDaysForGrade('7')).toBe(2);
  });

  it('grade "8" gets 1 mercy day', () => {
    expect(getMercyDaysForGrade('8')).toBe(1);
  });

  it('grade "9" gets 1 mercy day', () => {
    expect(getMercyDaysForGrade('9')).toBe(1);
  });

  it('grade "10" gets 1 mercy day', () => {
    expect(getMercyDaysForGrade('10')).toBe(1);
  });

  it('grade "11" gets 1 mercy day', () => {
    expect(getMercyDaysForGrade('11')).toBe(1);
  });

  it('grade "12" gets 1 mercy day', () => {
    expect(getMercyDaysForGrade('12')).toBe(1);
  });

  it('unknown grade defaults to 1 mercy day', () => {
    expect(getMercyDaysForGrade('99')).toBe(1);
  });

  it('accepts string grades only (P5 compliance)', () => {
    // Grades are always strings, never integers
    expect(getMercyDaysForGrade('6')).toBe(2);
    expect(getMercyDaysForGrade('12')).toBe(1);
  });
});

// ---- STREAK_VISIBILITY_THRESHOLD ----

describe('STREAK_VISIBILITY_THRESHOLD', () => {
  it('is 3', () => {
    expect(STREAK_VISIBILITY_THRESHOLD).toBe(3);
  });
});
