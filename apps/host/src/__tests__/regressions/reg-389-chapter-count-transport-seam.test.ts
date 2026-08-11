/**
 * REG-389 (companion) — the chapter-count TRANSPORT SEAM preserves the
 * three-valued contract end to end. `undefined` must survive the hop.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY A SEPARATE TEST FROM THE RENDER PIN
 * ═══════════════════════════════════════════════════════════════════════════
 * `reg-389-chapter-badge-honesty.test.tsx` proves the /learn page renders the
 * right thing GIVEN a chapter object. It mocks `getChaptersForSubject`, so it
 * cannot see the mapper in between — and the mapper is exactly where this
 * contract dies quietly.
 *
 * The RPC → route → client-helper → page chain has four hops and only the last
 * one has a visible symptom. A `?? 0` anywhere upstream produces a page that is
 * behaving CORRECTLY by its own contract (it received the number 0, so it
 * rendered a claim of zero) while showing the student a lie. Both sides can
 * have green tests and the pair still be broken — the same cross-file seam
 * failure class as REG-380.
 *
 * This was not hypothetical while writing it: at one point during this change
 * `getChaptersForSubject` mapped only `{chapter_number, title, title_hi,
 * verified_question_count}` and DROPPED `practice_ready_count` entirely, which
 * would have made the badge structurally unreachable — permanently silent
 * rather than wrong, but silent for a reason no test would have named.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════
 * `undefined` in  ->  `undefined` out   (unknown stays unknown)
 * `0`         in  ->  `0`         out   (a real zero is not erased either)
 * `n`         in  ->  `n`         out
 *
 * The asymmetry with `verified_question_count` is deliberate and is asserted:
 * that field KEEPS its `?? 0` coercion because it is back-compat surface that
 * nothing renders. Pinning the asymmetry is what stops a future tidy-up from
 * "harmonising" the three fields onto the coercing branch.
 *
 * DOES NOT PROVE: anything about the SQL that produces these columns (no
 * Postgres here — REG-388 pins the floor that defines practice_ready_count),
 * nor the server route's own mapping, which is a separate hop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// The pure client module, so the REAL helper in `@alfanumrik/lib/supabase`
// stays under test (same technique as supabase-read-result-contract.test.ts).
vi.mock('@alfanumrik/lib/supabase-client', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'in', 'single', 'maybeSingle'];
  return {
    supabase: {
      auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
      from: vi.fn(() => {
        const b: Record<string, unknown> = {};
        CHAIN.forEach((m) => { b[m] = vi.fn(() => b); });
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
        return b;
      }),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  };
});

import { getChaptersForSubject } from '@alfanumrik/lib/supabase';

/** Serve one `/api/student/chapters` body from the mocked transport. */
function serve(chapters: unknown[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ chapters }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('REG-389 seam: getChaptersForSubject preserves the three-valued count contract', () => {
  it('passes a positive practice_ready_count through unchanged', async () => {
    serve([{ chapter_number: 1, chapter_title: 'Number Systems', practice_ready_count: 12 }]);
    const res = await getChaptersForSubject('math', '8');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data[0].practice_ready_count).toBe(12);
  });

  it('keeps an ABSENT practice_ready_count as undefined — never coerced to 0', async () => {
    // THE CORE ASSERTION. A pre-migration database omits the column; the
    // server serialises it away; `undefined` here means UNKNOWN. `?? 0` at
    // this hop would hand the page a confident zero it has no basis for, and
    // the page — behaving correctly — would render "0 questions".
    serve([{ chapter_number: 1, chapter_title: 'Number Systems', verified_question_count: 40 }]);
    const res = await getChaptersForSubject('math', '8');
    expect(res.ok).toBe(true);
    const row = res.ok ? res.data[0] : null;
    expect(row!.practice_ready_count).toBeUndefined();
    // Stronger than `toBeUndefined()`: `0 ?? x` is 0, so a coercion would also
    // fail this, but so would a `null`. Pin the exact absence.
    expect(Object.prototype.hasOwnProperty.call(row, 'practice_ready_count')).toBe(true);
    expect(row!.practice_ready_count).not.toBe(0);
    expect(row!.practice_ready_count).not.toBeNull();
  });

  it('keeps a GENUINE 0 as 0 — the fix must not erase real zeroes either', async () => {
    // The opposite over-correction: mapping 0 to undefined would make a truly
    // empty chapter indistinguishable from an unknown one, losing the very
    // distinction this split created.
    serve([{ chapter_number: 1, chapter_title: 'Number Systems', practice_ready_count: 0 }]);
    const res = await getChaptersForSubject('math', '8');
    expect(res.ok && res.data[0].practice_ready_count).toBe(0);
    expect(res.ok && res.data[0].practice_ready_count).not.toBeUndefined();
  });

  it('applies the same contract to exam_ready_count (the SME-gated sibling)', async () => {
    serve([
      { chapter_number: 1, chapter_title: 'A', practice_ready_count: 9, exam_ready_count: 4 },
      { chapter_number: 2, chapter_title: 'B', practice_ready_count: 9 },
    ]);
    const res = await getChaptersForSubject('math', '8');
    expect(res.ok).toBe(true);
    const rows = res.ok ? res.data : [];
    expect(rows[0].exam_ready_count).toBe(4);
    expect(rows[1].exam_ready_count).toBeUndefined();
  });

  it('DELIBERATE ASYMMETRY: verified_question_count keeps its ?? 0 back-compat coercion', async () => {
    // Not an oversight. That field is legacy surface nothing renders, and its
    // consumers are typed non-optional. Pinning the asymmetry stops a future
    // "make these three consistent" refactor from moving the two honest fields
    // onto the coercing branch — which is the direction that reintroduces the
    // defect.
    serve([{ chapter_number: 1, chapter_title: 'Number Systems' }]);
    const res = await getChaptersForSubject('math', '8');
    const row = res.ok ? res.data[0] : null;
    expect(row!.verified_question_count).toBe(0);
    expect(row!.practice_ready_count).toBeUndefined();
  });

  it('a mixed page of chapters keeps each row independent', async () => {
    serve([
      { chapter_number: 1, chapter_title: 'A', practice_ready_count: 12 },
      { chapter_number: 2, chapter_title: 'B' },
      { chapter_number: 3, chapter_title: 'C', practice_ready_count: 0 },
    ]);
    const res = await getChaptersForSubject('math', '8');
    const counts = res.ok ? res.data.map((c) => c.practice_ready_count) : [];
    expect(counts).toEqual([12, undefined, 0]);
  });
});
