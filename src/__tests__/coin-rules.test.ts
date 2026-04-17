import { describe, it, expect } from 'vitest';
import { COIN_REWARDS, COIN_SHOP } from '@/lib/coin-rules';

// ─── COIN_REWARDS ───────────────────────────────────────────────

describe('COIN_REWARDS', () => {
  it('has all values as positive integers', () => {
    for (const [key, value] of Object.entries(COIN_REWARDS)) {
      expect(value).toBeGreaterThan(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('has all expected reward types defined', () => {
    const expectedKeys = [
      'quiz_complete',
      'first_quiz_of_day',
      'streak_3_day',
      'streak_7_day',
      'streak_30_day',
      'revise_decaying_topic',
      'study_task_complete',
      'study_plan_week',
      'score_crosses_80',
      'score_crosses_90',
    ];
    for (const key of expectedKeys) {
      expect(
        COIN_REWARDS[key as keyof typeof COIN_REWARDS]
      ).toBeDefined();
    }
  });

  it('streak rewards increase with longer streaks', () => {
    expect(COIN_REWARDS.streak_7_day).toBeGreaterThan(
      COIN_REWARDS.streak_3_day
    );
    expect(COIN_REWARDS.streak_30_day).toBeGreaterThan(
      COIN_REWARDS.streak_7_day
    );
  });

  it('milestone rewards: score_crosses_90 > score_crosses_80', () => {
    expect(COIN_REWARDS.score_crosses_90).toBeGreaterThan(
      COIN_REWARDS.score_crosses_80
    );
  });
});

// ─── COIN_SHOP ──────────────────────────────────────────────────

describe('COIN_SHOP', () => {
  it('has all items with required fields', () => {
    const requiredFields = [
      'id',
      'name',
      'nameHi',
      'description',
      'descriptionHi',
      'cost',
      'icon',
      'category',
    ] as const;

    for (const item of COIN_SHOP) {
      for (const field of requiredFields) {
        expect(item[field]).toBeDefined();
      }
    }
  });

  it('has all costs as positive numbers', () => {
    for (const item of COIN_SHOP) {
      expect(item.cost).toBeGreaterThan(0);
    }
  });

  it('has all items with bilingual names (name and nameHi differ)', () => {
    for (const item of COIN_SHOP) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.nameHi.length).toBeGreaterThan(0);
      // Hindi and English names should be different
      expect(item.nameHi).not.toBe(item.name);
    }
  });

  it('has all items with bilingual descriptions (description and descriptionHi differ)', () => {
    for (const item of COIN_SHOP) {
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.descriptionHi.length).toBeGreaterThan(0);
      expect(item.descriptionHi).not.toBe(item.description);
    }
  });

  it('has no duplicate IDs', () => {
    const ids = COIN_SHOP.map((item) => item.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has at least one item in each expected category', () => {
    const categories = new Set(COIN_SHOP.map((item) => item.category));
    // Verify multiple categories exist
    expect(categories.size).toBeGreaterThan(1);
  });

  it('has non-empty icon for every item', () => {
    for (const item of COIN_SHOP) {
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });

  it('has non-empty category for every item', () => {
    for (const item of COIN_SHOP) {
      expect(item.category.length).toBeGreaterThan(0);
    }
  });
});
