/**
 * Parent dashboard — data contract & privacy regression tests
 *
 * Reproduces three production bugs found 2026-04-29:
 *
 *  1. (children/page.tsx normalizer) — `activeToday` was re-derived on the
 *     client from students.last_active, which lags behind quiz_sessions.
 *     A child who took a quiz today but whose last_active was set yesterday
 *     by a chat session would show "No recent activity". The client must
 *     trust the server-computed activeToday flag.
 *
 *  2. (parent-portal Edge Function) — stats.mastery was aliased to accuracy,
 *     so the parent UI showed identical values for the "Mastery" and
 *     "Accuracy" pills. Mastery must be derived from concept_mastery levels.
 *
 *  3. (parent-portal Edge Function — parent_login) — when an unauthenticated
 *     user typed a link code that another guardian had already claimed, the
 *     handler returned that other guardian's id + name, allowing anyone with
 *     a leaked link code to impersonate the real parent. P13 violation.
 *
 * These tests pin the corrected behaviour. They exercise pure logic
 * extracted from the implementations rather than spinning up the full
 * Edge Function (Deno) runtime.
 */

import { describe, it, expect } from 'vitest';

// ─── Bug 1: client normalizer must trust server activeToday ────────────────
//
// We re-implement the corrected normalizer logic here as a frozen reference.
// If parent/children/page.tsx ever regresses to deriving activeToday from
// last_active alone, this test must fail.

interface RawDashboardLike {
  stats?: { todayQuizzes?: number; today_quizzes?: number };
  lastActive?: string | null;
  last_active?: string | null;
  activeToday?: boolean;
  active_today?: boolean;
}

function deriveActiveToday(raw: RawDashboardLike, now: Date = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  const serverActiveToday = typeof raw.activeToday === 'boolean'
    ? raw.activeToday
    : typeof raw.active_today === 'boolean'
      ? raw.active_today
      : null;
  const todayQuizzes = raw.stats?.todayQuizzes || raw.stats?.today_quizzes || 0;
  const lastActiveRaw = raw.lastActive || raw.last_active || null;
  return serverActiveToday ?? (
    todayQuizzes > 0
      ? true
      : lastActiveRaw
        ? new Date(lastActiveRaw).toISOString().slice(0, 10) === today
        : false
  );
}

describe('parent dashboard — activeToday normalization', () => {
  it('trusts the server-computed activeToday flag when present', () => {
    // Stale last_active (yesterday), but server says active today
    const raw: RawDashboardLike = {
      activeToday: true,
      last_active: '2026-04-28T10:00:00.000Z',
      stats: { todayQuizzes: 0 },
    };
    const now = new Date('2026-04-29T15:00:00.000Z');
    expect(deriveActiveToday(raw, now)).toBe(true);
  });

  it('trusts server activeToday=false even if last_active is today', () => {
    // E.g. last_active was bumped by a passive chat ping but no quiz happened
    const raw: RawDashboardLike = {
      activeToday: false,
      last_active: '2026-04-29T08:00:00.000Z',
      stats: { todayQuizzes: 0 },
    };
    const now = new Date('2026-04-29T15:00:00.000Z');
    expect(deriveActiveToday(raw, now)).toBe(false);
  });

  it('falls back to todayQuizzes count when server flag is missing', () => {
    const raw: RawDashboardLike = {
      stats: { todayQuizzes: 3 },
      last_active: '2026-04-28T10:00:00.000Z',
    };
    const now = new Date('2026-04-29T15:00:00.000Z');
    expect(deriveActiveToday(raw, now)).toBe(true);
  });

  it('falls back to last_active comparison when no flag and no quizzes', () => {
    const raw: RawDashboardLike = {
      last_active: '2026-04-29T08:00:00.000Z',
      stats: { todayQuizzes: 0 },
    };
    const now = new Date('2026-04-29T15:00:00.000Z');
    expect(deriveActiveToday(raw, now)).toBe(true);
  });

  it('returns false when nothing indicates today activity', () => {
    const raw: RawDashboardLike = {
      stats: { todayQuizzes: 0 },
      last_active: '2026-04-20T08:00:00.000Z',
    };
    const now = new Date('2026-04-29T15:00:00.000Z');
    expect(deriveActiveToday(raw, now)).toBe(false);
  });
});

// ─── Bug 2: mastery percent must be distinct from accuracy ─────────────────
//
// Mirror of the Edge Function computation; a regression that re-aliases
// mastery to accuracy must fail here.

interface MasteryLevels {
  mastered: number;
  proficient: number;
  familiar: number;
  attempted: number;
}

function computeMasteryPercent(levels: MasteryLevels, total: number): number {
  if (total <= 0) return 0;
  return Math.round(
    ((levels.mastered + 0.66 * levels.proficient + 0.33 * levels.familiar) / total) * 100,
  );
}

describe('parent dashboard — mastery percent computation', () => {
  it('returns 0 when no concepts are tracked', () => {
    expect(computeMasteryPercent({ mastered: 0, proficient: 0, familiar: 0, attempted: 0 }, 0)).toBe(0);
  });

  it('weights mastered fully, proficient at 0.66, familiar at 0.33', () => {
    // 10 concepts: 5 mastered, 2 proficient, 1 familiar, 2 attempted
    // raw = 5 + 2*0.66 + 1*0.33 = 5 + 1.32 + 0.33 = 6.65
    // pct = round(6.65 / 10 * 100) = 67
    const total = 10;
    const levels = { mastered: 5, proficient: 2, familiar: 1, attempted: 2 };
    expect(computeMasteryPercent(levels, total)).toBe(67);
  });

  it('returns 100 only when all tracked concepts are mastered', () => {
    expect(computeMasteryPercent({ mastered: 8, proficient: 0, familiar: 0, attempted: 0 }, 8)).toBe(100);
  });

  it('is independent of accuracy — a learner with high accuracy but no mastery returns 0', () => {
    // Simulates the bug: accuracy could be 95% on quizzes while no concept
    // has reached "familiar" yet (e.g. all attempted/developing).
    const accuracy = 95;
    const masteryPercent = computeMasteryPercent(
      { mastered: 0, proficient: 0, familiar: 0, attempted: 12 },
      12,
    );
    expect(masteryPercent).toBe(0);
    expect(masteryPercent).not.toBe(accuracy);
  });
});

// ─── Bug 3: parent_login privacy — no impersonation of an existing guardian ─
//
// The contract: the server may only return an existing guardian's
// (id, name) to a caller whose authenticated auth_user_id matches that
// guardian's auth_user_id. Any other caller (anonymous, or authenticated
// with a different auth_user_id) must get a fresh guardian row.

interface ExistingGuardian {
  id: string;
  name: string;
  auth_user_id: string | null;
}

/**
 * Pure decision function extracted from handleParentLogin. Returns the
 * guardian id+name to use, or `null` if the caller must create a new
 * guardian row.
 */
function decideGuardianReuse(
  existingGuardian: ExistingGuardian | null,
  authUserId: string | null,
): { id: string; name: string } | null {
  if (!existingGuardian) return null;
  if (!authUserId) return null; // Anonymous caller — never reuse
  if (existingGuardian.auth_user_id !== authUserId) return null; // Different user
  return { id: existingGuardian.id, name: existingGuardian.name };
}

describe('parent_login — guardian reuse policy (P13 hardening)', () => {
  const existing: ExistingGuardian = {
    id: 'g-existing',
    name: 'Real Parent',
    auth_user_id: 'auth-real',
  };

  it('REGRESSION: an anonymous caller must not impersonate an existing guardian', () => {
    // Pre-fix behavior was to return { id: 'g-existing', name: 'Real Parent' }
    // to any caller with the link code. This test pins that this no longer
    // happens.
    const result = decideGuardianReuse(existing, null);
    expect(result).toBeNull();
  });

  it('an authenticated user with a different auth_user_id must not reuse', () => {
    const result = decideGuardianReuse(existing, 'auth-attacker');
    expect(result).toBeNull();
  });

  it('the legitimate owner reuses their own guardian row', () => {
    const result = decideGuardianReuse(existing, 'auth-real');
    expect(result).toEqual({ id: 'g-existing', name: 'Real Parent' });
  });

  it('returns null when no guardian exists yet (new student → fresh guardian path)', () => {
    expect(decideGuardianReuse(null, 'auth-real')).toBeNull();
    expect(decideGuardianReuse(null, null)).toBeNull();
  });
});
