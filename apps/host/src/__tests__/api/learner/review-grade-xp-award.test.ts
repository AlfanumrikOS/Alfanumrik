/**
 * /api/learner/review/grade — review_graded XP award path (Foxy North-Star
 * Phase 3).
 *
 * Pins:
 *   - award fires ONLY for quality >= 3 AND pre-update interval_days >= 1
 *   - amount/cap come from XP_RULES (mocked here — P2: no literals in route)
 *   - reference id `review_<cardId>_<newTotalReviews>`
 *   - dailyCategory 'retention', source 'review_graded'
 *   - FIRE-AND-FORGET: a rejecting award never breaks the 200 grade response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({
    authorized: true,
    userId: '00000000-0000-0000-0000-0000000000u1'.slice(0, 36),
    studentId: 'student-1',
  })),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Event publish is not under test — no-op it (it is already best-effort).
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

// P2 contract keys (assessment lane) — mocked so this test pins the CALL
// SITE wiring (amount/cap flow from XP_RULES) independent of the real values.
vi.mock('@alfanumrik/lib/xp-config', () => ({
  XP_RULES: {
    review_graded_xp: 2,
    review_graded_daily_cap: 20,
  },
}));

const awardMock = vi.fn(async () => 2);
vi.mock('@alfanumrik/lib/xp-award', () => ({
  awardXpCapped: (...args: unknown[]) => awardMock(...(args as [])),
}));

// supabaseAdmin: card read (select chain → maybeSingle) + card update chain.
const cardHolder: { row: Record<string, unknown> | null } = { row: null };
const updateResult: { error: { message: string } | null } = { error: null };

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'spaced_repetition_cards') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: cardHolder.row, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: updateResult.error })),
          })),
        };
      }
      // students tenant lookup in the publish block
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { school_id: null }, error: null })),
          })),
        })),
      };
    }),
  },
}));

import { POST } from '@/app/api/learner/review/grade/route';

// RFC-4122-valid v4 UUID — the route's zod schema uses strict .uuid(),
// which rejects all-zero fixture UUIDs under Zod v4.
const CARD_ID = '2f9d4c6e-8a1b-4c3d-9e5f-6a7b8c9d0e1f';

function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD_ID,
    student_id: 'student-1',
    subject: 'math',
    chapter_title: 'Chapter 4: Fractions',
    ease_factor: 2.5,
    interval_days: 6,
    streak: 2,
    repetition_count: 4,
    total_reviews: 4,
    correct_reviews: 3,
    source: 'quiz_wrong_answer',
    ...overrides,
  };
}

function mkReq(quality: number): NextRequest {
  return new NextRequest('http://localhost/api/learner/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId: CARD_ID, quality }),
  });
}

beforeEach(() => {
  awardMock.mockClear();
  awardMock.mockResolvedValue(2);
  cardHolder.row = baseCard();
  updateResult.error = null;
});

describe('review/grade → review_graded XP award', () => {
  it('quality 4 on an interval>=1 card → awards with XP_RULES amount/cap + review_ ref', async () => {
    const res = await POST(mkReq(4));
    expect(res.status).toBe(200);
    expect(awardMock).toHaveBeenCalledOnce();
    const [, opts] = awardMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(opts).toMatchObject({
      studentId: 'student-1',
      source: 'review_graded',
      amount: 2,          // XP_RULES.review_graded_xp (mocked) — never a route literal
      dailyCap: 20,       // XP_RULES.review_graded_daily_cap
      dailyCategory: 'retention',
      referenceId: `review_${CARD_ID}_5`, // total_reviews 4 → 5
    });
    // P13: metadata is counts-only.
    expect(Object.keys(opts.metadata as Record<string, unknown>).sort()).toEqual([
      'previousIntervalDays', 'quality', 'totalReviews',
    ]);
  });

  it('quality 0 (forgot) → NO award', async () => {
    const res = await POST(mkReq(0));
    expect(res.status).toBe(200);
    expect(awardMock).not.toHaveBeenCalled();
  });

  it('interval_days 0 (fresh card) → NO award even on quality 5', async () => {
    cardHolder.row = baseCard({ interval_days: 0 });
    const res = await POST(mkReq(5));
    expect(res.status).toBe(200);
    expect(awardMock).not.toHaveBeenCalled();
  });

  it('failed card UPDATE → NO award (award only after a successful write)', async () => {
    updateResult.error = { message: 'boom' };
    const res = await POST(mkReq(4));
    expect(res.status).toBe(500);
    expect(awardMock).not.toHaveBeenCalled();
  });

  it('a hung award NEVER blocks the grade response (fire-and-forget, not awaited)', async () => {
    // awardXpCapped itself never rejects in prod (it resolves null on any
    // failure). Pin the non-blocking property: even an award that NEVER
    // settles must not delay the 200.
    awardMock.mockImplementation(() => new Promise(() => { /* never settles */ }));
    const res = await POST(mkReq(4));
    expect(res.status).toBe(200); // responded while the award is still pending
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(awardMock).toHaveBeenCalledOnce();
  });
});
