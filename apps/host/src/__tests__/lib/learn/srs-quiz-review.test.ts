/**
 * Foxy North-Star Phase 0 — shared SRS quiz-review helpers
 * (packages/lib/src/learn/srs-quiz-review.ts).
 *
 * Pins:
 *   F2 — srsQualityForResponse maps outcomes onto the ONLY quality values
 *        /api/learner/review/grade accepts ({0,3,4,5}, zod-pinned in the
 *        route): correct → 5/4 by speed (<10s), wrong → ALWAYS 0. SM-2
 *        counts quality >= 3 as successful recall, so the auto-mapper must
 *        never emit 3 for a wrong answer (3 stays in the union only because
 *        the flashcard UI legitimately sends it).
 *   F2 — gradeSrsCardsFireAndForget POSTs QuickRecallSection's EXACT request
 *        contract ({ cardId, quality }, same-origin) once per card, skips
 *        unmapped questions, and never throws on fetch failure.
 *   F3 — selectSrsReviewSet: single-subject selection (explicit filter wins,
 *        else earliest-due card's subject), source_id dedupe, cap — the same
 *        function feeding BOTH the quiz content and the dashboard lane count.
 *   F4 — fetchTopicMasteryByQuestionId: batched question→topic→mastery map;
 *        questions with no mastery row are ABSENT (callers apply the explicit
 *        0.5 fallback); any client failure degrades to {}.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  srsQualityForResponse,
  gradeSrsCardsFireAndForget,
  selectSrsReviewSet,
  fetchTopicMasteryByQuestionId,
  fetchSrsDueQuizCards,
  type SrsDueCard,
} from '@alfanumrik/lib/learn/srs-quiz-review';

// ─── F2: quality mapping ──────────────────────────────────────────────

describe('srsQualityForResponse (F2 quality mapping)', () => {
  it('correct fast (<10s) → 5', () => {
    expect(srsQualityForResponse(true, 4)).toBe(5);
    expect(srsQualityForResponse(true, 9)).toBe(5);
  });
  it('correct slow (>=10s) → 4', () => {
    expect(srsQualityForResponse(true, 10)).toBe(4);
    expect(srsQualityForResponse(true, 120)).toBe(4);
  });
  it('wrong → ALWAYS 0 (Forgot), regardless of speed — never 3', () => {
    expect(srsQualityForResponse(false, 0)).toBe(0);
    expect(srsQualityForResponse(false, 4)).toBe(0);
    expect(srsQualityForResponse(false, 5)).toBe(0);
    expect(srsQualityForResponse(false, 60)).toBe(0);
  });
  it('only ever emits the endpoint-accepted set {0,3,4,5}; wrong never emits quality >= 3 (SM-2 successful recall)', () => {
    for (let t = 0; t < 30; t++) {
      expect([0, 3, 4, 5]).toContain(srsQualityForResponse(true, t));
      expect(srsQualityForResponse(false, t)).toBe(0);
    }
  });
});

// ─── F2: fire-and-forget grade POSTs ──────────────────────────────────

describe('gradeSrsCardsFireAndForget (F2 grade loop close)', () => {
  it('POSTs QuickRecallSection\'s exact request contract per mapped card', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    gradeSrsCardsFireAndForget({
      cardIdByQuestionId: { q1: 'card-1', q2: 'card-2' },
      responses: [
        { question_id: 'q1', is_correct: true, time_spent: 4 },   // → 5
        { question_id: 'q2', is_correct: false, time_spent: 12 }, // wrong → always 0
        { question_id: 'q3', is_correct: true, time_spent: 4 },   // unmapped → skipped
      ],
      fetchImpl,
    });

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.url).toBe('/api/learner/review/grade');
      expect(c.init.method).toBe('POST');
      expect(c.init.credentials).toBe('same-origin');
      expect(c.init.headers).toEqual({ 'Content-Type': 'application/json' });
    }
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ cardId: 'card-1', quality: 5 });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ cardId: 'card-2', quality: 0 });
  });

  it('grades each card at most once and swallows fetch failures (fire-and-forget)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    expect(() =>
      gradeSrsCardsFireAndForget({
        cardIdByQuestionId: { q1: 'card-1', q1dup: 'card-1' },
        responses: [
          { question_id: 'q1', is_correct: true, time_spent: 3 },
          { question_id: 'q1dup', is_correct: false, time_spent: 3 },
        ],
        fetchImpl,
      }),
    ).not.toThrow();
    // card-1 mapped from two question ids → still a single grade call.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Let the rejected promise settle — the .catch() must have swallowed it.
    await new Promise((r) => setTimeout(r, 0));
  });
});

// ─── F3: review-set selection (count/content agreement) ───────────────

describe('selectSrsReviewSet (F3 count/content agreement)', () => {
  const cards: SrsDueCard[] = [
    { id: 'c1', source_id: 'q1', subject: 'science' },
    { id: 'c2', source_id: 'q2', subject: 'math' },
    { id: 'c3', source_id: 'q1', subject: 'science' }, // dup question
    { id: 'c4', source_id: 'q3', subject: 'science' },
    { id: 'c5', source_id: null, subject: 'science' }, // unresolvable
  ];

  it('uses the earliest-due card\'s subject when no filter is given, dedupes source_ids, maps first card per question', () => {
    const set = selectSrsReviewSet(cards, { cap: 10 });
    expect(set.subject).toBe('science');
    expect(set.questionIds).toEqual(['q1', 'q3']);
    expect(set.cardIdByQuestionId).toEqual({ q1: 'c1', q3: 'c4' });
  });

  it('honors an explicit subject filter', () => {
    const set = selectSrsReviewSet(cards, { subject: 'math', cap: 10 });
    expect(set.subject).toBe('math');
    expect(set.questionIds).toEqual(['q2']);
  });

  it('caps the selection (dashboard lane cap = 5, quiz cap = question count)', () => {
    const many: SrsDueCard[] = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      source_id: `q${i}`,
      subject: 'science',
    }));
    expect(selectSrsReviewSet(many, { cap: 5 }).questionIds).toHaveLength(5);
    expect(selectSrsReviewSet(many, { cap: 10 }).questionIds).toHaveLength(9);
  });

  it('returns an empty set when no subject can be derived', () => {
    const set = selectSrsReviewSet([{ id: 'c1', source_id: 'q1', subject: null }], { cap: 5 });
    expect(set.subject).toBeNull();
    expect(set.questionIds).toEqual([]);
  });
});

// ─── Shared query + F4 mastery lookup (mock supabase chain) ───────────

function makeChainClient(dataByTable: Record<string, unknown[]>) {
  const filters: Record<string, unknown[][]> = {};
  return {
    filters,
    client: {
      from: (table: string) => {
        filters[table] = filters[table] ?? [];
        const chain: Record<string, unknown> = {};
        const self = (name: string) =>
          (...args: unknown[]) => {
            filters[table].push([name, ...args]);
            return chain;
          };
        for (const m of ['select', 'eq', 'in', 'not', 'lte', 'order', 'limit']) {
          chain[m] = self(m);
        }
        (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(resolve);
        return chain;
      },
    },
  };
}

describe('fetchSrsDueQuizCards (shared due query)', () => {
  it('applies the quiz deep-link\'s exact due filter set', async () => {
    const { client, filters } = makeChainClient({
      spaced_repetition_cards: [{ id: 'c1', source_id: 'q1', subject: 'science' }],
    });
    const cards = await fetchSrsDueQuizCards(client, 'stu-1');
    expect(cards).toEqual([{ id: 'c1', source_id: 'q1', subject: 'science' }]);

    const applied = filters.spaced_repetition_cards.map((f) => f.slice(0, 2));
    expect(applied).toContainEqual(['select', 'id, source_id, subject']);
    expect(applied).toContainEqual(['eq', 'student_id']);
    expect(applied).toContainEqual(['eq', 'is_active']);
    expect(applied).toContainEqual(['eq', 'source']);
    expect(applied).toContainEqual(['not', 'source_id']);
    expect(applied).toContainEqual(['lte', 'next_review_date']);
    // Full-arg pins for the value-bearing filters.
    expect(filters.spaced_repetition_cards).toContainEqual(['eq', 'source', 'quiz_wrong_answer']);
    expect(filters.spaced_repetition_cards).toContainEqual(['eq', 'is_active', true]);
    expect(filters.spaced_repetition_cards).toContainEqual(['limit', 50]);
  });
});

describe('fetchTopicMasteryByQuestionId (F4)', () => {
  it('maps question → topic → mastery; questions without a mastery row are ABSENT (0.5 fallback is the caller\'s)', async () => {
    const { client } = makeChainClient({
      question_bank: [
        { id: 'q1', topic_id: 't1' },
        { id: 'q2', topic_id: 't2' },
        { id: 'q3', topic_id: null }, // no topic → never in the map
      ],
      concept_mastery: [{ topic_id: 't1', mastery_probability: 0.62 }],
    });
    const map = await fetchTopicMasteryByQuestionId(client, 'stu-1', ['q1', 'q2', 'q3']);
    expect(map).toEqual({ q1: 0.62 });
    // Caller-side contract: absent entries fall back to exactly 0.5.
    expect(map['q2'] ?? 0.5).toBe(0.5);
    expect(map['q3'] ?? 0.5).toBe(0.5);
  });

  it('returns {} on any client failure (never blocks quiz start)', async () => {
    const broken = { from: () => { throw new Error('boom'); } };
    await expect(fetchTopicMasteryByQuestionId(broken, 'stu-1', ['q1'])).resolves.toEqual({});
  });

  it('returns {} for an empty question list without touching the client', async () => {
    const from = vi.fn();
    await expect(fetchTopicMasteryByQuestionId({ from }, 'stu-1', [])).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
});
