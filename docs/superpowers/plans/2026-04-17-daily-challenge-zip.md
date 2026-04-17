# Daily Challenge (Concept Chain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LinkedIn-Zip-inspired daily curriculum-aligned Concept Chain game that students unlock by studying first, with streak mechanics, social visibility, and Foxy Coins rewards — driving daily habit formation while teaching real CBSE concepts.

**Architecture:** Effort gate (study first) unlocks a daily drag-to-sequence puzzle shared across each grade with ZPD-personalized difficulty. Three reward layers: Foxy Coins (tangible), Performance Score behavioral signal (meaningful), class challenge board + WhatsApp sharing (social). AI generates daily chains via Edge Function; nightly cron manages streaks.

**Tech Stack:** Next.js 16 App Router, React 18, Tailwind 3.4, Supabase Postgres + RLS, Deno Edge Functions, Claude Haiku (chain generation), vanilla JS drag-and-drop (no library — P10 bundle budget).

**Spec:** `docs/superpowers/specs/2026-04-17-daily-challenge-zip-design.md`

**Important codebase notes:**
- Grades are STRINGS `"6"` through `"12"` — never integers (P5)
- All user-facing text must be bilingual via `isHi` prop (P7)
- Client Supabase from `@/lib/supabase` (respects RLS). Never import `supabase-admin` in client code (P8)
- Existing `src/components/challenge/ChallengeMode.tsx` is quiz-battles (different feature) — our new files go alongside it
- Existing `src/lib/share.ts` has `shareResult()` for WhatsApp — reuse it
- Existing `src/lib/coin-rules.ts` has `COIN_REWARDS` — extend it
- Existing `src/lib/cognitive-engine.ts` has `calculateZPD()` — reuse it

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `src/lib/challenge-config.ts` | Constants: subject rotation, coin rewards, streak rules, ZPD-to-difficulty mapping, grace period |
| `src/lib/challenge-streak.ts` | Pure functions: streak increment, break, mercy logic, milestone detection, badge award |
| `src/lib/challenge-engine.ts` | Pure functions: chain validation, ordering check, distractor detection, hint logic, difficulty selection |
| `src/__tests__/challenge-config.test.ts` | Tests for config constants |
| `src/__tests__/challenge-streak.test.ts` | Tests for streak logic |
| `src/__tests__/challenge-engine.test.ts` | Tests for game engine logic |
| `src/components/challenge/ConceptChain.tsx` | Core game: drag-drop cards, check answer, hints, celebration |
| `src/components/challenge/DailyChallengeCard.tsx` | Dashboard widget: locked/unlocked, today's topic, streak |
| `src/components/challenge/StreakBadge.tsx` | Flame icon + day count + milestone badges |
| `src/components/challenge/ClassChallengeBoard.tsx` | Class board: who solved, sorted by streak |
| `src/components/challenge/ShareResultCard.tsx` | Shareable result card (WhatsApp-optimized) |
| `src/app/challenge/page.tsx` | Full page: game + results + class board + streak history |
| `supabase/migrations/20260417000001_daily_challenge_system.sql` | 3 tables + RLS + indexes |
| `supabase/functions/generate-daily-challenge/index.ts` | Nightly AI chain generation Edge Function |

### Modified Files

| File | Change |
|---|---|
| `src/lib/coin-rules.ts` | Add `challenge_solve`, `challenge_streak_7`, `challenge_streak_30`, `challenge_streak_100` to COIN_REWARDS |
| `src/app/dashboard/page.tsx` | Import and render DailyChallengeCard widget |
| `src/app/leaderboard/page.tsx` | Add "Streaks" tab |
| `src/app/profile/page.tsx` | Add StreakBadge + milestone badges |
| `supabase/functions/daily-cron/index.ts` | Add streak management step |
| `mobile/lib/core/constants/coin_rules.dart` | Sync challenge coin values |

---

## Task 1: Challenge Configuration Constants + Tests

**Files:**
- Create: `src/lib/challenge-config.ts`
- Create: `src/__tests__/challenge-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/challenge-config.test.ts
import { describe, it, expect } from 'vitest';
import {
  SUBJECT_ROTATION,
  CHALLENGE_COINS,
  STREAK_MILESTONES,
  GRACE_PERIOD_DAYS,
  ZPD_DIFFICULTY,
  getSubjectForDay,
  getDifficultyForZPD,
  getMercyDaysForGrade,
  STREAK_VISIBILITY_THRESHOLD,
} from '@/lib/challenge-config';

describe('SUBJECT_ROTATION', () => {
  it('covers all 7 days (0=Sunday through 6=Saturday)', () => {
    for (let d = 0; d <= 6; d++) {
      expect(SUBJECT_ROTATION[d]).toBeDefined();
      expect(SUBJECT_ROTATION[d].subject).toBeTruthy();
    }
  });

  it('assigns Math on Monday(1) and Friday(5)', () => {
    expect(SUBJECT_ROTATION[1].subject).toBe('math');
    expect(SUBJECT_ROTATION[5].subject).toBe('math');
  });

  it('marks Saturday(6) as personalized', () => {
    expect(SUBJECT_ROTATION[6].personalized).toBe(true);
  });

  it('marks Sunday(0) as fun/mixed', () => {
    expect(SUBJECT_ROTATION[0].mixed).toBe(true);
  });
});

describe('getSubjectForDay', () => {
  it('returns fixed subject for weekdays', () => {
    expect(getSubjectForDay(1)).toBe('math'); // Monday
    expect(getSubjectForDay(2)).toBe('science'); // Tuesday
  });

  it('returns null for Saturday (needs personalization)', () => {
    expect(getSubjectForDay(6)).toBeNull();
  });

  it('returns "mixed" for Sunday', () => {
    expect(getSubjectForDay(0)).toBe('mixed');
  });
});

describe('CHALLENGE_COINS', () => {
  it('awards 15 coins per solve', () => {
    expect(CHALLENGE_COINS.solve).toBe(15);
  });

  it('has positive values for all streak milestones', () => {
    expect(CHALLENGE_COINS.streak_7_bonus).toBe(25);
    expect(CHALLENGE_COINS.streak_30_bonus).toBe(100);
    expect(CHALLENGE_COINS.streak_100_bonus).toBe(500);
  });
});

describe('STREAK_MILESTONES', () => {
  it('defines 3 milestones at days 7, 30, 100', () => {
    expect(STREAK_MILESTONES).toHaveLength(3);
    expect(STREAK_MILESTONES.map(m => m.days)).toEqual([7, 30, 100]);
  });

  it('each milestone has a badge id and coin bonus', () => {
    for (const m of STREAK_MILESTONES) {
      expect(m.badgeId).toBeTruthy();
      expect(m.coins).toBeGreaterThan(0);
    }
  });
});

describe('GRACE_PERIOD_DAYS', () => {
  it('is 3 days for new users', () => {
    expect(GRACE_PERIOD_DAYS).toBe(3);
  });
});

describe('getDifficultyForZPD', () => {
  it('returns 4 cards, 0 distractors for low ZPD', () => {
    const d = getDifficultyForZPD(0.3);
    expect(d.cardCount).toBe(4);
    expect(d.distractorCount).toBe(0);
  });

  it('returns 5 cards, 0 distractors for medium ZPD', () => {
    const d = getDifficultyForZPD(0.5);
    expect(d.cardCount).toBe(5);
    expect(d.distractorCount).toBe(0);
  });

  it('returns 5 cards, 1 distractor for high ZPD', () => {
    const d = getDifficultyForZPD(0.8);
    expect(d.cardCount).toBe(5);
    expect(d.distractorCount).toBe(1);
  });

  it('returns 5 cards, 2 distractors for expert ZPD', () => {
    const d = getDifficultyForZPD(0.95);
    expect(d.cardCount).toBe(5);
    expect(d.distractorCount).toBe(2);
  });

  it('clamps ZPD to [0, 1]', () => {
    expect(getDifficultyForZPD(-0.5).cardCount).toBe(4);
    expect(getDifficultyForZPD(1.5).distractorCount).toBe(2);
  });
});

describe('getMercyDaysForGrade', () => {
  it('gives 2 mercy days for grades 6-7', () => {
    expect(getMercyDaysForGrade('6')).toBe(2);
    expect(getMercyDaysForGrade('7')).toBe(2);
  });

  it('gives 1 mercy day for grades 8-12', () => {
    for (const g of ['8', '9', '10', '11', '12']) {
      expect(getMercyDaysForGrade(g)).toBe(1);
    }
  });

  it('defaults to 1 for unknown grades (P5: string)', () => {
    expect(getMercyDaysForGrade('13')).toBe(1);
  });
});

describe('STREAK_VISIBILITY_THRESHOLD', () => {
  it('is 3 days (streak not shown publicly below this)', () => {
    expect(STREAK_VISIBILITY_THRESHOLD).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/challenge-config.test.ts`
Expected: FAIL — module `@/lib/challenge-config` not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/challenge-config.ts
/**
 * ALFANUMRIK — Daily Challenge Configuration
 *
 * Constants for the Concept Chain daily challenge system.
 * Subject rotation, coin rewards, streak rules, ZPD-to-difficulty mapping.
 *
 * IMPORTANT: Grades are STRINGS "6" through "12" (Product Invariant P5).
 */

// ─── Subject Rotation ───────────────────────────────────

export interface DayConfig {
  subject: string;
  personalized?: boolean;
  mixed?: boolean;
  labelEn: string;
  labelHi: string;
}

/** Day-of-week (0=Sunday) to subject mapping. */
export const SUBJECT_ROTATION: Record<number, DayConfig> = {
  0: { subject: 'mixed', mixed: true, labelEn: 'Fun Mix', labelHi: 'मज़ेदार मिक्स' },
  1: { subject: 'math', labelEn: 'Math', labelHi: 'गणित' },
  2: { subject: 'science', labelEn: 'Science', labelHi: 'विज्ञान' },
  3: { subject: 'english', labelEn: 'English / Hindi', labelHi: 'अंग्रेज़ी / हिंदी' },
  4: { subject: 'social_studies', labelEn: 'Social Studies', labelHi: 'सामाजिक विज्ञान' },
  5: { subject: 'math', labelEn: 'Math', labelHi: 'गणित' },
  6: { subject: 'weakest', personalized: true, labelEn: 'Your Weak Subject', labelHi: 'तुम्हारा कमज़ोर विषय' },
} as const;

/**
 * Get the subject for a given day of week.
 * Returns null for Saturday (personalized — caller must resolve via cognitive engine).
 * Returns 'mixed' for Sunday.
 */
export function getSubjectForDay(dayOfWeek: number): string | null {
  const config = SUBJECT_ROTATION[dayOfWeek];
  if (!config) return 'math'; // fallback
  if (config.personalized) return null;
  return config.subject;
}

// ─── Coin Rewards ───────────────────────────────────────

export const CHALLENGE_COINS = {
  solve: 15,
  streak_7_bonus: 25,
  streak_30_bonus: 100,
  streak_100_bonus: 500,
} as const;

// ─── Streak Milestones ──────────────────────────────────

export interface StreakMilestone {
  days: number;
  badgeId: string;
  badgeLabel: string;
  badgeLabelHi: string;
  badgeIcon: string;
  coins: number;
}

export const STREAK_MILESTONES: readonly StreakMilestone[] = [
  { days: 7, badgeId: 'bronze_7', badgeLabel: 'Bronze Streak', badgeLabelHi: 'कांस्य स्ट्रीक', badgeIcon: '🥉', coins: 25 },
  { days: 30, badgeId: 'silver_30', badgeLabel: 'Silver Streak', badgeLabelHi: 'रजत स्ट्रीक', badgeIcon: '🥈', coins: 100 },
  { days: 100, badgeId: 'gold_100', badgeLabel: 'Gold Streak', badgeLabelHi: 'स्वर्ण स्ट्रीक', badgeIcon: '🥇', coins: 500 },
] as const;

// ─── Grace Period ───────────────────────────────────────

/** New users get this many days of ungated access. */
export const GRACE_PERIOD_DAYS = 3 as const;

// ─── ZPD Difficulty Mapping ─────────────────────────────

export interface ChallengeDifficulty {
  cardCount: number;
  distractorCount: number;
  band: 'low' | 'medium' | 'high' | 'expert';
}

export const ZPD_DIFFICULTY: readonly { maxZPD: number; difficulty: ChallengeDifficulty }[] = [
  { maxZPD: 0.4, difficulty: { cardCount: 4, distractorCount: 0, band: 'low' } },
  { maxZPD: 0.7, difficulty: { cardCount: 5, distractorCount: 0, band: 'medium' } },
  { maxZPD: 0.9, difficulty: { cardCount: 5, distractorCount: 1, band: 'high' } },
  { maxZPD: 1.0, difficulty: { cardCount: 5, distractorCount: 2, band: 'expert' } },
] as const;

/**
 * Map a student's ZPD mastery (0-1) to challenge difficulty.
 */
export function getDifficultyForZPD(zpd: number): ChallengeDifficulty {
  const clamped = Math.max(0, Math.min(1, zpd));
  for (const tier of ZPD_DIFFICULTY) {
    if (clamped <= tier.maxZPD) return { ...tier.difficulty };
  }
  return { cardCount: 5, distractorCount: 2, band: 'expert' };
}

// ─── Streak Mercy ───────────────────────────────────────

/** Grades 6-7 get 2 mercy days/week; 8-12 get 1. */
export function getMercyDaysForGrade(grade: string): number {
  return grade === '6' || grade === '7' ? 2 : 1;
}

/** Streak is not displayed publicly until this threshold. */
export const STREAK_VISIBILITY_THRESHOLD = 3 as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/challenge-config.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/challenge-config.ts src/__tests__/challenge-config.test.ts
git commit -m "feat(challenge): add daily challenge configuration constants + tests"
```

---

## Task 2: Challenge Engine (Game Logic) + Tests

**Files:**
- Create: `src/lib/challenge-engine.ts`
- Create: `src/__tests__/challenge-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/challenge-engine.test.ts
import { describe, it, expect } from 'vitest';
import {
  checkChainOrder,
  countMisplacedCards,
  selectCardsForStudent,
  applyHint,
  type ChainCard,
  type ChallengeData,
} from '@/lib/challenge-engine';

const SAMPLE_CHAIN: ChainCard[] = [
  { id: '1', text: 'Ingestion', textHi: 'अंतर्ग्रहण', position: 0 },
  { id: '2', text: 'Digestion', textHi: 'पाचन', position: 1 },
  { id: '3', text: 'Absorption', textHi: 'अवशोषण', position: 2 },
  { id: '4', text: 'Assimilation', textHi: 'स्वांगीकरण', position: 3 },
  { id: '5', text: 'Excretion', textHi: 'उत्सर्जन', position: 4 },
];

const SAMPLE_DISTRACTORS: ChainCard[] = [
  { id: 'd1', text: 'Photosynthesis', textHi: 'प्रकाश संश्लेषण', position: -1 },
  { id: 'd2', text: 'Transpiration', textHi: 'वाष्पोत्सर्जन', position: -1 },
];

describe('checkChainOrder', () => {
  it('returns true for correct order', () => {
    expect(checkChainOrder(['1', '2', '3', '4', '5'], SAMPLE_CHAIN)).toBe(true);
  });

  it('returns false for incorrect order', () => {
    expect(checkChainOrder(['2', '1', '3', '4', '5'], SAMPLE_CHAIN)).toBe(false);
  });

  it('ignores distractor IDs in the submission', () => {
    expect(checkChainOrder(['1', '2', '3', '4', '5'], SAMPLE_CHAIN)).toBe(true);
  });
});

describe('countMisplacedCards', () => {
  it('returns 0 for correct order', () => {
    expect(countMisplacedCards(['1', '2', '3', '4', '5'], SAMPLE_CHAIN)).toBe(0);
  });

  it('returns 2 when two cards are swapped', () => {
    expect(countMisplacedCards(['2', '1', '3', '4', '5'], SAMPLE_CHAIN)).toBe(2);
  });

  it('returns total count when fully reversed', () => {
    expect(countMisplacedCards(['5', '4', '3', '2', '1'], SAMPLE_CHAIN)).toBe(4);
  });
});

describe('selectCardsForStudent', () => {
  const challenge: ChallengeData = {
    baseChain: SAMPLE_CHAIN,
    distractors: SAMPLE_DISTRACTORS,
  };

  it('returns 4 cards for low difficulty (no distractors)', () => {
    const result = selectCardsForStudent(challenge, { cardCount: 4, distractorCount: 0, band: 'low' });
    expect(result.cards).toHaveLength(4);
    expect(result.correctOrder).toHaveLength(4);
    expect(result.distractorIds).toHaveLength(0);
  });

  it('returns 5 cards for medium difficulty', () => {
    const result = selectCardsForStudent(challenge, { cardCount: 5, distractorCount: 0, band: 'medium' });
    expect(result.cards).toHaveLength(5);
    expect(result.distractorIds).toHaveLength(0);
  });

  it('returns 6 cards (5 + 1 distractor) for high difficulty', () => {
    const result = selectCardsForStudent(challenge, { cardCount: 5, distractorCount: 1, band: 'high' });
    expect(result.cards).toHaveLength(6);
    expect(result.distractorIds).toHaveLength(1);
  });

  it('returns 7 cards (5 + 2 distractors) for expert difficulty', () => {
    const result = selectCardsForStudent(challenge, { cardCount: 5, distractorCount: 2, band: 'expert' });
    expect(result.cards).toHaveLength(7);
    expect(result.distractorIds).toHaveLength(2);
  });

  it('shuffles cards (not in original order)', () => {
    // Run multiple times to check shuffling happens
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const result = selectCardsForStudent(challenge, { cardCount: 5, distractorCount: 0, band: 'medium' });
      orders.add(result.cards.map(c => c.id).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('applyHint', () => {
  it('locks the first unlocked card in correct position', () => {
    const cardIds = ['3', '1', '2', '4', '5'];
    const lockedIds: string[] = [];
    const result = applyHint(cardIds, SAMPLE_CHAIN, lockedIds);
    expect(result.lockedIds).toContain('1');
    expect(result.newOrder[0]).toBe('1');
  });

  it('locks the next card if first is already locked', () => {
    const cardIds = ['1', '3', '2', '4', '5'];
    const lockedIds = ['1'];
    const result = applyHint(cardIds, SAMPLE_CHAIN, lockedIds);
    expect(result.lockedIds).toContain('2');
  });

  it('returns unchanged if all cards already locked', () => {
    const cardIds = ['1', '2', '3', '4', '5'];
    const lockedIds = ['1', '2', '3', '4', '5'];
    const result = applyHint(cardIds, SAMPLE_CHAIN, lockedIds);
    expect(result.lockedIds).toEqual(lockedIds);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/challenge-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/challenge-engine.ts
/**
 * ALFANUMRIK — Concept Chain Game Engine
 *
 * Pure functions for the daily Concept Chain challenge.
 * No side effects, no database calls.
 */

import type { ChallengeDifficulty } from './challenge-config';

// ─── Types ──────────────────────────────────────────────

export interface ChainCard {
  id: string;
  text: string;
  textHi: string;
  /** Position in the correct order (0-based). -1 for distractors. */
  position: number;
}

export interface ChallengeData {
  baseChain: ChainCard[];
  distractors: ChainCard[];
}

export interface StudentChallenge {
  cards: ChainCard[];
  correctOrder: string[];
  distractorIds: string[];
}

export interface HintResult {
  newOrder: string[];
  lockedIds: string[];
}

// ─── Order Checking ─────────────────────────────────────

/**
 * Check if the submitted card order matches the correct chain.
 * Only considers non-distractor cards (position >= 0).
 */
export function checkChainOrder(submittedIds: string[], baseChain: ChainCard[]): boolean {
  const correctIds = baseChain
    .filter(c => c.position >= 0)
    .sort((a, b) => a.position - b.position)
    .map(c => c.id);
  const nonDistractorSubmission = submittedIds.filter(id =>
    baseChain.some(c => c.id === id && c.position >= 0)
  );
  return nonDistractorSubmission.join(',') === correctIds.join(',');
}

/**
 * Count how many cards are NOT in their correct position.
 * Used for "X cards are in the wrong place" feedback.
 */
export function countMisplacedCards(submittedIds: string[], baseChain: ChainCard[]): number {
  const correctIds = baseChain
    .filter(c => c.position >= 0)
    .sort((a, b) => a.position - b.position)
    .map(c => c.id);
  const nonDistractor = submittedIds.filter(id =>
    baseChain.some(c => c.id === id && c.position >= 0)
  );
  let misplaced = 0;
  for (let i = 0; i < Math.min(nonDistractor.length, correctIds.length); i++) {
    if (nonDistractor[i] !== correctIds[i]) misplaced++;
  }
  return misplaced;
}

// ─── Card Selection ─────────────────────────────────────

/**
 * Select and shuffle cards for a student based on their difficulty level.
 * - Low: first N cards from base chain, no distractors
 * - Medium: full base chain, no distractors
 * - High/Expert: full base chain + N distractors
 */
export function selectCardsForStudent(
  challenge: ChallengeData,
  difficulty: ChallengeDifficulty
): StudentChallenge {
  // Select base cards (take first cardCount from the ordered chain)
  const baseCards = challenge.baseChain
    .filter(c => c.position >= 0)
    .sort((a, b) => a.position - b.position)
    .slice(0, difficulty.cardCount);

  const correctOrder = baseCards.map(c => c.id);

  // Select distractors
  const distractors = challenge.distractors.slice(0, difficulty.distractorCount);
  const distractorIds = distractors.map(d => d.id);

  // Combine and shuffle
  const allCards = [...baseCards, ...distractors];
  const shuffled = shuffleArray(allCards);

  return { cards: shuffled, correctOrder, distractorIds };
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Hints ──────────────────────────────────────────────

/**
 * Apply a hint: lock the next correct card in position.
 * Returns updated card order with the locked card in its correct spot.
 */
export function applyHint(
  currentOrder: string[],
  baseChain: ChainCard[],
  alreadyLocked: string[]
): HintResult {
  const correctIds = baseChain
    .filter(c => c.position >= 0)
    .sort((a, b) => a.position - b.position)
    .map(c => c.id);

  // Find the first card in correct order that isn't locked yet
  const nextToLock = correctIds.find(id => !alreadyLocked.includes(id));
  if (!nextToLock) {
    return { newOrder: currentOrder, lockedIds: [...alreadyLocked] };
  }

  // Build new order: place locked cards first in correct positions
  const newLocked = [...alreadyLocked, nextToLock];
  const remaining = currentOrder.filter(id => !newLocked.includes(id));

  const newOrder: string[] = [];
  let remainingIdx = 0;
  for (let i = 0; i < currentOrder.length; i++) {
    if (i < correctIds.length && newLocked.includes(correctIds[i])) {
      newOrder.push(correctIds[i]);
    } else {
      if (remainingIdx < remaining.length) {
        newOrder.push(remaining[remainingIdx++]);
      }
    }
  }
  // Append any remaining
  while (remainingIdx < remaining.length) {
    newOrder.push(remaining[remainingIdx++]);
  }

  return { newOrder, lockedIds: newLocked };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/challenge-engine.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/challenge-engine.ts src/__tests__/challenge-engine.test.ts
git commit -m "feat(challenge): add Concept Chain game engine with ordering, hints, difficulty"
```

---

## Task 3: Streak Logic (Pure Functions) + Tests

**Files:**
- Create: `src/lib/challenge-streak.ts`
- Create: `src/__tests__/challenge-streak.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/challenge-streak.test.ts
import { describe, it, expect } from 'vitest';
import {
  processStreakDay,
  checkMercyEligibility,
  detectMilestones,
  shouldShowStreak,
  type StreakState,
} from '@/lib/challenge-streak';

const baseState: StreakState = {
  currentStreak: 5,
  bestStreak: 10,
  lastChallengeDate: '2026-04-16',
  mercyDaysUsedThisWeek: 0,
  mercyWeekStart: '2026-04-14',
  badges: [],
};

describe('processStreakDay', () => {
  it('increments streak for consecutive day', () => {
    const result = processStreakDay(baseState, '2026-04-17', '9');
    expect(result.currentStreak).toBe(6);
    expect(result.lastChallengeDate).toBe('2026-04-17');
  });

  it('breaks streak if 2+ days missed and no mercy available', () => {
    const state = { ...baseState, mercyDaysUsedThisWeek: 1 };
    const result = processStreakDay(state, '2026-04-19', '9'); // skipped 2 days
    expect(result.currentStreak).toBe(1);
  });

  it('preserves streak via mercy day (1 day missed, mercy available)', () => {
    const result = processStreakDay(baseState, '2026-04-18', '9'); // skipped 1 day
    expect(result.currentStreak).toBe(6);
    expect(result.mercyDaysUsedThisWeek).toBe(1);
  });

  it('updates bestStreak when current exceeds it', () => {
    const state = { ...baseState, currentStreak: 10, bestStreak: 10 };
    const result = processStreakDay(state, '2026-04-17', '9');
    expect(result.bestStreak).toBe(11);
  });

  it('resets mercy counter on new week', () => {
    const state = { ...baseState, mercyWeekStart: '2026-04-07', mercyDaysUsedThisWeek: 1 };
    const result = processStreakDay(state, '2026-04-17', '9');
    expect(result.mercyDaysUsedThisWeek).toBe(0);
  });

  it('gives grade 6 students 2 mercy days', () => {
    const state = { ...baseState, mercyDaysUsedThisWeek: 1 };
    const result = processStreakDay(state, '2026-04-18', '6'); // 1 day missed, 1 mercy used
    expect(result.currentStreak).toBe(6); // mercy still available (2 allowed for grade 6)
  });

  it('does not double-count same day', () => {
    const result = processStreakDay(baseState, '2026-04-16', '9'); // same day
    expect(result.currentStreak).toBe(5); // unchanged
  });
});

describe('checkMercyEligibility', () => {
  it('returns true when mercy days remaining', () => {
    expect(checkMercyEligibility(0, 1, '9')).toBe(true);
  });

  it('returns false when mercy days exhausted for grade 9', () => {
    expect(checkMercyEligibility(1, 1, '9')).toBe(false); // 1 used, 1 allowed
  });

  it('returns true for grade 6 with 1 used (2 allowed)', () => {
    expect(checkMercyEligibility(1, 1, '6')).toBe(true);
  });
});

describe('detectMilestones', () => {
  it('returns bronze milestone at day 7', () => {
    const milestones = detectMilestones(6, 7, []);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].badgeId).toBe('bronze_7');
  });

  it('does not re-award existing badges', () => {
    const milestones = detectMilestones(6, 7, ['bronze_7']);
    expect(milestones).toHaveLength(0);
  });

  it('returns silver milestone at day 30', () => {
    const milestones = detectMilestones(29, 30, ['bronze_7']);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].badgeId).toBe('silver_30');
  });

  it('returns gold milestone at day 100', () => {
    const milestones = detectMilestones(99, 100, ['bronze_7', 'silver_30']);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].badgeId).toBe('gold_100');
  });

  it('returns empty if no milestone crossed', () => {
    const milestones = detectMilestones(3, 4, []);
    expect(milestones).toHaveLength(0);
  });
});

describe('shouldShowStreak', () => {
  it('returns false for streak below threshold', () => {
    expect(shouldShowStreak(2)).toBe(false);
  });

  it('returns true for streak at threshold', () => {
    expect(shouldShowStreak(3)).toBe(true);
  });

  it('returns true for streak above threshold', () => {
    expect(shouldShowStreak(15)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/challenge-streak.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/challenge-streak.ts
/**
 * ALFANUMRIK — Challenge Streak Logic
 *
 * Pure functions for managing daily challenge streaks.
 * Handles mercy days, milestones, grade-sensitive rules.
 *
 * IMPORTANT: Grades are STRINGS (P5).
 */

import { STREAK_MILESTONES, STREAK_VISIBILITY_THRESHOLD, getMercyDaysForGrade, type StreakMilestone } from './challenge-config';

// ─── Types ──────────────────────────────────────────────

export interface StreakState {
  currentStreak: number;
  bestStreak: number;
  lastChallengeDate: string | null; // ISO date string YYYY-MM-DD
  mercyDaysUsedThisWeek: number;
  mercyWeekStart: string | null; // ISO date string
  badges: string[]; // badge IDs already earned
}

// ─── Core Logic ─────────────────────────────────────────

/**
 * Process a streak day: increment, break, or mercy.
 * Returns the updated streak state.
 */
export function processStreakDay(
  state: StreakState,
  todayStr: string,
  grade: string
): StreakState {
  const today = new Date(todayStr);
  const newState = { ...state, badges: [...state.badges] };

  // Same day — no change
  if (state.lastChallengeDate === todayStr) return newState;

  // Check if mercy week needs reset (Monday = start of week)
  const weekStart = getWeekStart(today);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  if (!state.mercyWeekStart || weekStartStr !== state.mercyWeekStart) {
    newState.mercyDaysUsedThisWeek = 0;
    newState.mercyWeekStart = weekStartStr;
  }

  if (!state.lastChallengeDate) {
    // First ever challenge
    newState.currentStreak = 1;
    newState.lastChallengeDate = todayStr;
    newState.bestStreak = Math.max(1, state.bestStreak);
    return newState;
  }

  const lastDate = new Date(state.lastChallengeDate);
  const daysDiff = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff === 1) {
    // Consecutive day — increment
    newState.currentStreak = state.currentStreak + 1;
  } else if (daysDiff === 2) {
    // Missed 1 day — check mercy
    const maxMercy = getMercyDaysForGrade(grade);
    if (newState.mercyDaysUsedThisWeek < maxMercy) {
      newState.currentStreak = state.currentStreak + 1;
      newState.mercyDaysUsedThisWeek += 1;
    } else {
      // No mercy left — break streak
      newState.currentStreak = 1;
    }
  } else if (daysDiff <= 0) {
    // Same day or future — no change
    return newState;
  } else {
    // Missed 2+ days — streak broken
    newState.currentStreak = 1;
  }

  newState.lastChallengeDate = todayStr;
  newState.bestStreak = Math.max(newState.currentStreak, state.bestStreak);

  return newState;
}

/**
 * Check if a student is eligible for a mercy day.
 */
export function checkMercyEligibility(
  mercyUsedThisWeek: number,
  daysMissed: number,
  grade: string
): boolean {
  if (daysMissed !== 1) return false;
  return mercyUsedThisWeek < getMercyDaysForGrade(grade);
}

// ─── Milestones ─────────────────────────────────────────

/**
 * Detect newly crossed milestones.
 * Returns milestones that were just crossed (previousStreak < milestone <= newStreak)
 * and not already in the badges array.
 */
export function detectMilestones(
  previousStreak: number,
  newStreak: number,
  existingBadges: string[]
): StreakMilestone[] {
  return STREAK_MILESTONES.filter(
    m => previousStreak < m.days && newStreak >= m.days && !existingBadges.includes(m.badgeId)
  );
}

/**
 * Should the streak be shown publicly? Only above threshold.
 */
export function shouldShowStreak(streak: number): boolean {
  return streak >= STREAK_VISIBILITY_THRESHOLD;
}

// ─── Helpers ────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sunday
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/challenge-streak.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/challenge-streak.ts src/__tests__/challenge-streak.test.ts
git commit -m "feat(challenge): add streak logic with mercy days, milestones, grade sensitivity"
```

---

## Task 4: Database Migration

**Files:**
- Create: `supabase/migrations/20260417000001_daily_challenge_system.sql`

- [ ] **Step 1: Write the migration**

Create the migration with 3 tables (`daily_challenges`, `challenge_attempts`, `challenge_streaks`), RLS policies, and indexes. Follow the exact pattern from the existing `20260416000001_performance_score_system.sql` migration for RLS guards (DO $$ BEGIN / IF NOT EXISTS / END $$).

Key requirements:
- All `grade` columns are `TEXT` (P5)
- RLS enabled on all 3 tables
- Student reads own rows (via `students.auth_user_id = auth.uid()`)
- Parent reads linked child's rows (via `guardian_student_links`)
- Teacher reads assigned class students (via `class_students`)
- `UNIQUE(grade, challenge_date)` on daily_challenges
- `UNIQUE(student_id, challenge_id)` on challenge_attempts (prevents double-solving)
- `student_id` is PRIMARY KEY on challenge_streaks (one streak per student)

- [ ] **Step 2: Verify migration file is valid SQL**

Run: `head -20 supabase/migrations/20260417000001_daily_challenge_system.sql`
Expected: valid SQL with CREATE TABLE statements

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417000001_daily_challenge_system.sql
git commit -m "feat(challenge): add daily_challenges, challenge_attempts, challenge_streaks tables"
```

---

## Task 5: Update Coin Rules

**Files:**
- Modify: `src/lib/coin-rules.ts`
- Modify: `mobile/lib/core/constants/coin_rules.dart`

- [ ] **Step 1: Add challenge coin rewards to coin-rules.ts**

Add these entries to the existing `COIN_REWARDS` object:
```typescript
  challenge_solve:        15,
  challenge_streak_7:     25,
  challenge_streak_30:   100,
  challenge_streak_100:  500,
```

- [ ] **Step 2: Sync to mobile coin_rules.dart**

Add matching constants to the `CoinRewards` class in `mobile/lib/core/constants/coin_rules.dart`:
```dart
  static const int challengeSolve = 15;
  static const int challengeStreak7 = 25;
  static const int challengeStreak30 = 100;
  static const int challengeStreak100 = 500;
```

- [ ] **Step 3: Run existing coin-rules tests**

Run: `npx vitest run src/__tests__/coin-rules.test.ts`
Expected: ALL PASS (new keys don't break existing tests)

- [ ] **Step 4: Commit**

```bash
git add src/lib/coin-rules.ts mobile/lib/core/constants/coin_rules.dart
git commit -m "feat(challenge): add challenge coin rewards to web + mobile"
```

---

## Task 6: ConceptChain Game Component

**Files:**
- Create: `src/components/challenge/ConceptChain.tsx`

- [ ] **Step 1: Build the core game component**

The ConceptChain component handles:
- Rendering draggable/tappable cards in a vertical list
- Drag-and-drop reordering (vanilla JS `onDragStart`/`onDragOver`/`onDrop`)
- Tap-tap-swap fallback (first tap selects, second tap swaps)
- "Check Answer" button → calls `checkChainOrder()` from challenge-engine
- Incorrect feedback → highlights misplaced cards, Foxy voice line
- Hint button (after 2 failures) → calls `applyHint()`, locks a card
- Correct celebration → Foxy animation, show explanation, award coins
- Move counter display (non-competitive)
- Locked card visual state (hint-locked cards get a checkmark + dimmed drag)
- Bilingual card text via `isHi` prop

Props interface:
```typescript
interface ConceptChainProps {
  cards: ChainCard[];
  correctOrder: string[];
  distractorIds: string[];
  explanation: string;
  explanationHi: string;
  isHi: boolean;
  onSolved: (moves: number, hintsUsed: number, distractorsExcluded: number) => void;
}
```

Key implementation notes:
- Use `useState` for card order, move count, hint count, failure count, locked IDs, solved state
- Drag-and-drop: use `draggable` attribute + `onDragStart`/`onDragOver`/`onDrop` events (no library)
- Tap-swap: `onClick` toggles selection state, second click swaps
- Cards have: colored left border, text (en/hi), drag handle icon, locked indicator
- Distractor cards look identical to real cards (student must figure out which don't belong)
- After solving: show green celebration state, bilingual explanation, coins earned
- Sounds: use existing `playSound('correct')` / `playSound('incorrect')` from `@/lib/sounds`
- Foxy lines: use existing `onCorrectAnswer()` / `onWrongAnswer()` from `@/lib/feedback-engine`

- [ ] **Step 2: Verify it renders without errors**

Import into a test page or storybook with sample data. Verify drag-and-drop works on desktop, tap-swap works on mobile viewport.

- [ ] **Step 3: Commit**

```bash
git add src/components/challenge/ConceptChain.tsx
git commit -m "feat(challenge): add ConceptChain drag-and-drop game component"
```

---

## Task 7: Supporting UI Components

**Files:**
- Create: `src/components/challenge/DailyChallengeCard.tsx`
- Create: `src/components/challenge/StreakBadge.tsx`
- Create: `src/components/challenge/ClassChallengeBoard.tsx`
- Create: `src/components/challenge/ShareResultCard.tsx`

- [ ] **Step 1: Build DailyChallengeCard (dashboard widget)**

Shows on dashboard:
- Locked state: lock icon, "Complete a quiz to unlock today's challenge", today's subject
- Unlocked state: play button, topic name, current streak flame
- Solved state: checkmark, score summary, "Solved!" badge
- Fetches today's challenge status from `daily_challenges` + `challenge_attempts`

Props:
```typescript
interface DailyChallengeCardProps {
  studentId: string;
  grade: string;
  isHi: boolean;
  isUnlocked: boolean;
  streak: number;
}
```

- [ ] **Step 2: Build StreakBadge**

Compact component showing: flame emoji + day count + optional milestone badge icons.
- Below STREAK_VISIBILITY_THRESHOLD: show nothing (or "Start a streak!")
- At/above threshold: "🔥 12" with orange text
- With milestones: "🔥 32 🥉🥈" (shows earned badges inline)

Props: `{ streak: number; badges: string[]; isHi: boolean; size?: 'sm' | 'md' | 'lg' }`

- [ ] **Step 3: Build ClassChallengeBoard**

Fetches from `challenge_attempts` + `challenge_streaks` for the student's grade:
- List of students who solved today, sorted by streak length
- Each row: avatar, name, streak flame, "Solved" badge
- Bottom: "X of Y students solved today. Class avg streak: Z"
- Only shows solvers — never names non-solvers

Props: `{ grade: string; studentId: string; challengeId: string; isHi: boolean }`

- [ ] **Step 4: Build ShareResultCard**

Generates a shareable image-like card:
- Green check squares for chain length
- "Solved in N moves"
- "Day X" streak
- "alfanumrik.com/challenge" URL
- "Share" button uses `shareResult()` from `@/lib/share.ts`
- WhatsApp-optimized text message fallback

Props: `{ chainLength: number; moves: number; streak: number; subject: string; date: string; isHi: boolean }`

- [ ] **Step 5: Commit**

```bash
git add src/components/challenge/DailyChallengeCard.tsx src/components/challenge/StreakBadge.tsx src/components/challenge/ClassChallengeBoard.tsx src/components/challenge/ShareResultCard.tsx
git commit -m "feat(challenge): add dashboard card, streak badge, class board, share card components"
```

---

## Task 8: Challenge Page (`/challenge`)

**Files:**
- Create: `src/app/challenge/page.tsx`

- [ ] **Step 1: Build the full challenge page**

This page is the main game experience. It has several states:

**State 1 — Locked (gate not passed)**
- Shows today's subject and topic
- Message: "Complete a quiz or Foxy session to unlock today's challenge"
- Link to `/foxy` or `/quiz`
- Current streak display

**State 2 — Unlocked (ready to play)**
- Fetches today's challenge from `daily_challenges` table (WHERE grade = student.grade AND challenge_date = today)
- Calls `getDifficultyForZPD()` with student's current mastery to determine card count
- Calls `selectCardsForStudent()` to prepare shuffled cards
- Renders `ConceptChain` component

**State 3 — Solved**
- Shows celebration + `ShareResultCard`
- Shows `ClassChallengeBoard`
- Shows streak history (last 7 days: solved/missed/mercy)
- "Come back tomorrow!" message

**State 4 — No challenge available**
- Fallback: "Today's challenge is being prepared. Check back soon!"
- This handles edge case where AI generation failed and no fallback exists

Data flow:
1. On mount: check if student has completed effort gate today (query `daily_activity` or `quiz_sessions` for today)
2. Check 3-day grace period (student `created_at` within last 3 days → always unlocked)
3. Fetch today's challenge
4. Fetch student's challenge_streaks
5. Fetch student's challenge_attempts for today (check if already solved)
6. On solve: insert into `challenge_attempts`, update `challenge_streaks` via streak logic, award coins via `award_coins` RPC

- [ ] **Step 2: Verify page renders in all 4 states**

Test manually:
- New user (< 3 days old): should see unlocked state
- User who hasn't done a quiz today: should see locked state
- User who completed a quiz: should see unlocked/playable state
- User who already solved today: should see solved state

- [ ] **Step 3: Commit**

```bash
git add src/app/challenge/page.tsx
git commit -m "feat(challenge): add /challenge page with full game flow"
```

---

## Task 9: Dashboard Integration

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add DailyChallengeCard to dashboard**

Read the existing dashboard page. Add:
1. Import `DailyChallengeCard` from `@/components/challenge/DailyChallengeCard`
2. Add state for unlock status (check if student has completed effort gate today)
3. Add state for streak (fetch from `challenge_streaks`)
4. Render `DailyChallengeCard` in the dashboard — position it prominently (after ScoreHero, before subject scores)
5. The card links to `/challenge` on click

- [ ] **Step 2: Verify dashboard renders with challenge card**

Check loading, empty (no streak yet), locked, and unlocked states all display correctly.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(challenge): wire DailyChallengeCard into student dashboard"
```

---

## Task 10: Generate Daily Challenge Edge Function

**Files:**
- Create: `supabase/functions/generate-daily-challenge/index.ts`
- Modify: `supabase/functions/daily-cron/index.ts`

- [ ] **Step 1: Create the Edge Function**

Deno runtime. Called by daily-cron at 11 PM IST (or directly via HTTP for testing).

Logic:
1. Determine tomorrow's date and day-of-week
2. For each grade "6" through "12":
   a. Get subject from `getSubjectForDay()` (Saturday = skip, personalized at query time)
   b. Pick a chapter from the CBSE syllabus (query `chapters` table for the subject + grade)
   c. Build a prompt for Claude Haiku:
      ```
      Generate a concept chain for Grade {grade}, Subject {subject}, Chapter {chapter}.
      Create exactly 5 items that must be arranged in a specific logical order.
      Also create 3 distractor items that are plausible but do NOT belong in the chain.
      For each item, provide:
      - id: a short unique identifier
      - text: English text
      - textHi: Hindi translation
      - position: 0-4 for chain items (in correct order), -1 for distractors
      Also provide:
      - explanation: 2-3 sentence explanation of why this order is correct (English)
      - explanationHi: Same explanation in Hindi
      Return as JSON.
      ```
   d. Call Claude Haiku via existing AI infrastructure (`supabase/functions/_shared/`)
   e. Validate response: exactly 5 chain items with positions 0-4, 3 distractors with position -1, non-empty text, explanation present
   f. Upsert into `daily_challenges` table
3. Log results: "Generated challenges for 7 grades"

- [ ] **Step 2: Add to daily-cron**

Add a new step in the existing `daily-cron/index.ts` steps array:
```typescript
['challenges_generated', () => generateDailyChallenges(sb)],
```

The function calls the generate-daily-challenge Edge Function or runs the logic inline (preferred for simplicity — avoid HTTP roundtrip).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-daily-challenge/index.ts supabase/functions/daily-cron/index.ts
git commit -m "feat(challenge): add AI chain generation Edge Function + daily-cron integration"
```

---

## Task 11: Streak Management in Daily Cron

**Files:**
- Modify: `supabase/functions/daily-cron/index.ts`

- [ ] **Step 1: Add streak break detection**

Add a new step to daily-cron that runs after challenge generation:

1. Query all `challenge_streaks` where `last_challenge_date < yesterday AND current_streak > 0`
2. For each: check mercy eligibility (query student's grade, mercy days used this week)
3. If mercy available: do nothing (streak preserved, mercy counted when they next solve)
4. If no mercy: set `current_streak = 0`
5. Log: "Processed X streaks: Y broken, Z mercy-preserved"

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/daily-cron/index.ts
git commit -m "feat(challenge): add nightly streak break detection to daily-cron"
```

---

## Task 12: Leaderboard + Profile Integration

**Files:**
- Modify: `src/app/leaderboard/page.tsx`
- Modify: `src/app/profile/page.tsx`

- [ ] **Step 1: Add "Streaks" tab to leaderboard**

Read existing leaderboard page. Add:
1. New tab: `'streaks'` alongside existing `'ranks' | 'compete' | 'fame' | 'titles'`
2. Tab label: "Streaks" / "स्ट्रीक"
3. Content: fetch `challenge_streaks` for the student's grade (via RLS)
4. Display as ranked list sorted by `current_streak` DESC
5. Each row: rank medal/number, student name, StreakBadge, "Day X" label
6. Only show students with streak >= STREAK_VISIBILITY_THRESHOLD

- [ ] **Step 2: Add StreakBadge to profile page**

Read existing profile page. Add:
1. Import StreakBadge
2. Fetch student's `challenge_streaks` row
3. Display StreakBadge + best streak + milestone badges
4. Position: near the level/score display area

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "leaderboard|profile|challenge" || echo "No errors"`
Expected: No errors in modified files

- [ ] **Step 4: Commit**

```bash
git add src/app/leaderboard/page.tsx src/app/profile/page.tsx
git commit -m "feat(challenge): add Streaks tab to leaderboard + streak badge on profile"
```

---

## Task 13: Teacher Portal — Class Challenge View

**Files:**
- Modify: `src/app/teacher/page.tsx`

- [ ] **Step 1: Add challenge participation section**

Read existing teacher page. Add a section showing:
1. Today's challenge participation for each class
2. Fetch from `challenge_attempts` joined with `challenge_streaks` for the teacher's assigned students
3. Display: "X of Y students solved today's challenge"
4. Show class average streak
5. List top 5 streakers in the class
6. Bilingual labels via `isHi`

- [ ] **Step 2: Commit**

```bash
git add src/app/teacher/page.tsx
git commit -m "feat(challenge): add class challenge participation to teacher portal"
```

---

## Task 14: Full Test Suite Run + Quality Gate

**Files:** None (verification only)

- [ ] **Step 1: Run all new challenge tests**

Run: `npx vitest run src/__tests__/challenge-config.test.ts src/__tests__/challenge-engine.test.ts src/__tests__/challenge-streak.test.ts`
Expected: ALL PASS

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass (2700+ tests)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors

- [ ] **Step 4: Lint new files**

Run: `npx eslint src/lib/challenge-config.ts src/lib/challenge-engine.ts src/lib/challenge-streak.ts src/components/challenge/*.tsx src/app/challenge/page.tsx`
Expected: 0 errors

- [ ] **Step 5: Final commit + push**

```bash
git push origin feat/performance-score-system
```
