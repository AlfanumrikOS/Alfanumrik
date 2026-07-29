import { describe, it, expect } from 'vitest';
import {
  selectDiagnosticForm,
  screenCandidates,
  tier0Violation,
  arrangeByTemplate,
  DIAGNOSTIC_BLUEPRINT,
  DIAGNOSTIC_BAND_TEMPLATE,
  DIAGNOSTIC_QUESTION_COUNT,
  DIAGNOSTIC_SHORT_FORM_FLOOR,
  DIAGNOSTIC_BLOOM_LEVELS,
  DIAGNOSTIC_HOTS_LEVELS,
  DIAGNOSTIC_SOURCE_TYPES,
  DIAGNOSTIC_FAILED_VERIFICATION_STATES,
  VALID_DIAGNOSTIC_GRADES,
  type DiagnosticCandidate,
} from '@alfanumrik/lib/diagnostic/blueprint';
import { validateQuestion } from '@alfanumrik/lib/quiz-assembler';
import { irtProbCorrect, BLOOM_LEVELS } from '@alfanumrik/lib/cognitive-engine';

/**
 * Cold-start diagnostic form selector — pure-module oracles.
 *
 * Implements the testable half of
 * `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md` §8:
 * AC-1..AC-5 (blueprint + information), AC-6..AC-10 (verification gate),
 * AC-11/AC-12 (scope), AC-24 (never-degraded property test), AC-25..AC-27
 * (Bloom's).
 *
 * The selector is deliberately DB-free, so every assertion here is a real
 * behavioural pin with no mocking of business logic (only fixtures).
 *
 * P5: `grade` is a string throughout. P13: every fixture id is synthetic.
 */

// ── Fixture builders ──────────────────────────────────────────────────────────

const GRADE = '9';
const SUBJECT = 'math';
const CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8];

let idCounter = 0;

function makeItem(over: Partial<DiagnosticCandidate> = {}): DiagnosticCandidate {
  idCounter++;
  const band = (over.difficulty as number) ?? 1;
  return {
    id: `synthetic-q-${idCounter}`,
    question_text: `Synthetic CBSE item ${idCounter}: which of these values satisfies the equation?`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: idCounter % 4,
    explanation:
      'Substituting each option into the equation shows only one balances both sides.',
    difficulty: band,
    bloom_level: 'understand',
    chapter_number: CHAPTERS[idCounter % CHAPTERS.length],
    verification_state: 'verified',
    is_verified: true,
    content_status: 'published',
    question_type: 'mcq',
    question_type_v2: 'mcq',
    source_type: 'ncert_exercise',
    is_active: true,
    deleted_at: null,
    grade: GRADE,
    subject: SUBJECT,
    irt_a: null,
    irt_b: null,
    irt_calibration_n: 0,
    ...over,
  };
}

/**
 * A comfortably-supplied pool: `per` items per band, cycling Bloom levels and
 * chapters so the strict Rung-0 Bloom + chapter-spread constraints are all
 * satisfiable.
 */
function makePool(per = 24, over: Partial<DiagnosticCandidate> = {}): DiagnosticCandidate[] {
  const out: DiagnosticCandidate[] = [];
  const blooms = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
  for (const band of [1, 2, 3]) {
    for (let i = 0; i < per; i++) {
      out.push(
        makeItem({
          difficulty: band,
          bloom_level: blooms[(i + band) % blooms.length],
          chapter_number: CHAPTERS[i % CHAPTERS.length],
          ...over,
        })
      );
    }
  }
  return out;
}

function select(candidates: DiagnosticCandidate[], seed = 'seed-alpha') {
  return selectDiagnosticForm({
    candidates,
    inScopeChapters: CHAPTERS,
    grade: GRADE,
    subject: SUBJECT,
    seed,
  });
}

function bands(form: { questions: DiagnosticCandidate[] }): number[] {
  return form.questions.map((q) => q.difficulty as number);
}

// ══════════════════════════════════════════════════════════════════════════════
// §8.1 Blueprint
// ══════════════════════════════════════════════════════════════════════════════

describe('diagnostic blueprint — §8.1 form shape', () => {
  it('AC-1: a well-supplied pool yields exactly 15 items with band counts {1:5, 2:6, 3:4}', () => {
    const form = select(makePool());
    expect(form.questions.length).toBe(DIAGNOSTIC_QUESTION_COUNT);
    expect(form.blueprint).toEqual({ easy: 5, medium: 6, hard: 4 });
    expect(DIAGNOSTIC_BLUEPRINT).toEqual({ easy: 5, medium: 6, hard: 4 });
  });

  it('AC-2: the served band sequence equals the fixed positional template at Rung 0', () => {
    const form = select(makePool());
    expect(form.rung).toBe(0);
    expect(bands(form)).toEqual([...DIAGNOSTIC_BAND_TEMPLATE]);
    // The template itself is the spec's E E M M H M E H M M H E M H E.
    expect([...DIAGNOSTIC_BAND_TEMPLATE]).toEqual([1, 1, 2, 2, 3, 2, 1, 3, 2, 2, 3, 1, 2, 3, 1]);
  });

  it('AC-2: the template also holds at Rung 1 (all-legacy_unverified pool)', () => {
    const form = select(makePool(24, { verification_state: 'legacy_unverified', is_verified: false }));
    expect(form.rung).toBe(1);
    expect(bands(form)).toEqual([...DIAGNOSTIC_BAND_TEMPLATE]);
  });

  it('AC-3: two different seeds over the same pool give different item sequences, both satisfying AC-1/AC-2', () => {
    const pool = makePool();
    const a = select(pool, 'seed-alpha');
    const b = select(pool, 'seed-beta-different');

    expect(a.questions.map((q) => q.id)).not.toEqual(b.questions.map((q) => q.id));
    for (const form of [a, b]) {
      expect(form.blueprint).toEqual({ easy: 5, medium: 6, hard: 4 });
      expect(bands(form)).toEqual([...DIAGNOSTIC_BAND_TEMPLATE]);
    }
  });

  it('AC-3: the same seed is deterministic (a re-run reproduces the identical form)', () => {
    const pool = makePool();
    expect(select(pool, 'stable').questions.map((q) => q.id)).toEqual(
      select(pool, 'stable').questions.map((q) => q.id)
    );
  });

  it('AC-5: positions 1, 2 and 15 are easy, and no two adjacent positions are both hard', () => {
    const seq = bands(select(makePool()));
    expect(seq[0]).toBe(1);
    expect(seq[1]).toBe(1);
    expect(seq[seq.length - 1]).toBe(1);
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i] === 3 && seq[i - 1] === 3, `adjacent hard at ${i - 1}/${i}`).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8.1 AC-4 — the INFORMATION oracle. This is the whole point of the blueprint.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Reference SE(θ) implementation, built on the platform's OWN `irtProbCorrect`
 * (3PL, D=1.7, a=1.0, c=0.25) — not a re-derivation.
 *
 * b = (difficulty − 2) × 1.5 → easy −1.5, medium 0.0, hard +1.5, matching the
 * spec §1.2 table and the `irt_difficulty` proxy seed.
 *
 *   I(θ) = D²a²·((P−c)²/(1−c)²)·((1−P)/P)      SE(θ) = 1/√ΣI(θ)
 */
const D = 1.7;
const A = 1.0;
const C = 0.25;

function itemInformation(theta: number, difficultyBand: number): number {
  const p = irtProbCorrect(theta, difficultyBand, A, C);
  if (p <= C || p >= 1) return 0;
  return D * D * A * A * (((p - C) ** 2) / ((1 - C) ** 2)) * ((1 - p) / p);
}

function standardError(theta: number, formBands: number[]): number {
  const info = formBands.reduce((sum, band) => sum + itemInformation(theta, band), 0);
  return info > 0 ? 1 / Math.sqrt(info) : Number.POSITIVE_INFINITY;
}

describe('diagnostic blueprint — AC-4 information oracle', () => {
  /** The PRE-FIX form: `ORDER BY difficulty ASC LIMIT 15` = 15 easy items. */
  const LEGACY_ALL_EASY_FORM = Array.from({ length: 15 }, () => 1);

  it('AC-4: the 5/6/4 form has SE(theta=+1.5) < 1.0', () => {
    const form = select(makePool());
    const se = standardError(1.5, bands(form));
    expect(se).toBeLessThan(1.0);
  });

  it('AC-4 NEGATIVE FIXTURE: the old all-easy 15/0/0 form FAILS the same assertion', () => {
    const legacySe = standardError(1.5, LEGACY_ALL_EASY_FORM);
    // This is the regression that must never silently return. If someone
    // reintroduces `ORDER BY difficulty ASC LIMIT 15`, the served form becomes
    // this shape and the assertion above breaks.
    expect(legacySe).toBeGreaterThan(1.0);
    // Sanity-check against the spec §1.2 table value of ~2.26.
    expect(legacySe).toBeGreaterThan(1.5);
  });

  it('AC-4: the blueprint beats the legacy form by a wide margin at the top of the scale', () => {
    const specSe = standardError(1.5, [...DIAGNOSTIC_BAND_TEMPLATE]);
    const legacySe = standardError(1.5, LEGACY_ALL_EASY_FORM);
    expect(specSe).toBeLessThan(legacySe / 2);
  });

  it('AC-4: SE stays under 1.0 across the whole reported range [-2, +2]', () => {
    const seq = bands(select(makePool()));
    for (const theta of [-2, -1, 0, 1, 1.5, 2]) {
      expect(standardError(theta, seq), `SE(${theta})`).toBeLessThan(1.0);
    }
  });

  it('AC-4: the selector NEVER returns an all-one-band form from a supplied pool', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const seq = bands(select(makePool(), seed));
      expect(new Set(seq).size).toBeGreaterThanOrEqual(3);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8.2 Verification gate
// ══════════════════════════════════════════════════════════════════════════════

describe('diagnostic blueprint — §8.2 Tier-0 verification gate', () => {
  /** One violating override per predicate. */
  const VIOLATIONS: Array<[string, Partial<DiagnosticCandidate>]> = [
    ['V1 is_active=false', { is_active: false }],
    ['V2 soft-deleted', { deleted_at: '2026-01-01T00:00:00Z' }],
    ['V3 draft content_status', { content_status: 'draft' }],
    ['V4 wrong grade', { grade: '7' }],
    ['V4 integer grade (P5)', { grade: 9 as unknown as string }],
    ['V5 wrong subject', { subject: 'science' }],
    ['V6 non-MCQ', { question_type_v2: 'short_answer' }],
    ['V7 three options (P6)', { options: ['A', 'B', 'C'] }],
    ['V8 empty option (P6)', { options: ['A', '', 'C', 'D'] }],
    ['V8 duplicate options (P6)', { options: ['Same', 'Same', 'Same', 'Other'] }],
    ['V9 answer index out of range (P6)', { correct_answer_index: 4 }],
    ['V10 text too short (P6)', { question_text: 'Too short' }],
    ['V11 template marker (P6)', { question_text: 'Compute {{value}} for the given expression now' }],
    ['V12 empty explanation (P6)', { explanation: '' }],
    ['V13 difficulty out of band', { difficulty: 9 }],
    ['V14 non-canonical bloom', { bloom_level: 'memorise' }],
    ['V15 verification_state=failed', { verification_state: 'failed' }],
    ['V15 verification_state=failed_fix_in_flight', { verification_state: 'failed_fix_in_flight' }],
    ['V15 verification_state=failed_unfixable', { verification_state: 'failed_unfixable' }],
    ['V16 competition source_type', { source_type: 'jee_archive' }],
    ['V17 off-syllabus chapter', { chapter_number: 999 }],
  ];

  for (const [label, override] of VIOLATIONS) {
    it(`AC-6: rejects ${label} at every rung`, () => {
      const poison = makeItem({ ...override, id: 'POISON-ROW' });
      // Rung 0 (verified pool), Rung 1 (legacy pool) and a starved pool that is
      // forced down the ladder all get the same poisoned row injected.
      const pools: Array<[string, DiagnosticCandidate[]]> = [
        ['rung0', [poison, ...makePool()]],
        ['rung1', [poison, ...makePool(24, { verification_state: 'legacy_unverified' })]],
        ['degraded', [poison, ...makePool(5, { verification_state: 'pending' })]],
      ];
      for (const [name, pool] of pools) {
        const form = select(pool);
        expect(
          form.questions.some((q) => q.id === 'POISON-ROW'),
          `${label} leaked at ${name}`
        ).toBe(false);
      }
    });
  }

  it('AC-7: a `failed` row is excluded even when it is the ONLY item that could fill the blueprint', () => {
    // 4 hard items are needed; supply 3 clean + 1 `failed`.
    const pool = [
      ...makePool(20, {}).filter((q) => q.difficulty !== 3),
      ...Array.from({ length: 3 }, () => makeItem({ difficulty: 3 })),
      makeItem({ difficulty: 3, verification_state: 'failed', id: 'FAILED-ROW' }),
    ];
    const form = select(pool);
    expect(form.questions.some((q) => q.id === 'FAILED-ROW')).toBe(false);
    // Degradation is the correct outcome — never inclusion.
    expect(form.rung).toBeGreaterThan(0);
  });

  it('AC-8: an all-legacy_unverified pool produces Rung 1 / quality_tier "standard" with 15 items, not an empty result', () => {
    const form = select(makePool(24, { verification_state: 'legacy_unverified', is_verified: false }));
    expect(form.rung).toBe(1);
    expect(form.qualityTier).toBe('standard');
    expect(form.questions.length).toBe(15);
  });

  it('AC-9: every returned item passes the REAL validateQuestion() from quiz-assembler', () => {
    const form = select(makePool());
    for (const q of form.questions) {
      const { valid, reason } = validateQuestion(q);
      expect(valid, `${q.id}: ${reason}`).toBe(true);
    }
  });

  it('AC-10: no duplicate ids in the returned form even when the pool contains duplicates', () => {
    const pool = makePool();
    const dupes = [...pool, ...pool.slice(0, 20)]; // simulate the 3-band-query overlap
    const form = select(dupes);
    expect(new Set(form.questions.map((q) => q.id)).size).toBe(form.questions.length);
  });

  it('the failed-verification family is exactly the three "disproved" states', () => {
    expect([...DIAGNOSTIC_FAILED_VERIFICATION_STATES]).toEqual([
      'failed',
      'failed_fix_in_flight',
      'failed_unfixable',
    ]);
  });

  it('V16 source allow-list carries only CBSE-board tiers (no competition archives)', () => {
    const allowed = new Set<string>(DIAGNOSTIC_SOURCE_TYPES);
    for (const banned of ['jee_archive', 'neet_archive', 'olympiad', 'pyq', 'board_paper', 'curated']) {
      expect(allowed.has(banned), banned).toBe(false);
    }
  });

  it('screenCandidates attributes each rejection to the predicate that fired', () => {
    const { eligible, rejections } = screenCandidates(
      [makeItem({ content_status: 'draft' }), makeItem({ difficulty: 1 })],
      { grade: GRADE, subject: SUBJECT, inScopeChapters: new Set(CHAPTERS) }
    );
    expect(eligible.length).toBe(1);
    expect(rejections.V3).toBe(1);
  });

  it('tier0Violation returns null for a clean row', () => {
    expect(
      tier0Violation(makeItem(), {
        grade: GRADE,
        subject: SUBJECT,
        inScopeChapters: new Set(CHAPTERS),
      })
    ).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8.3 Scope + P5
// ══════════════════════════════════════════════════════════════════════════════

describe('diagnostic blueprint — §8.3 scope', () => {
  it('AC-11: an item whose chapter is absent from the syllabus set is never returned', () => {
    const pool = [...makePool(), makeItem({ chapter_number: 42, id: 'OFF-SYLLABUS' })];
    const form = selectDiagnosticForm({
      candidates: pool,
      inScopeChapters: CHAPTERS, // 42 is NOT here
      grade: GRADE,
      subject: SUBJECT,
      seed: 'scope',
    });
    expect(form.questions.some((q) => q.id === 'OFF-SYLLABUS')).toBe(false);
  });

  it('AC-11: an empty in-scope chapter set yields Rung 4, never an off-syllabus form', () => {
    const form = selectDiagnosticForm({
      candidates: makePool(),
      inScopeChapters: [],
      grade: GRADE,
      subject: SUBJECT,
      seed: 'no-scope',
    });
    expect(form.rung).toBe(4);
    expect(form.questions.length).toBe(0);
    expect(form.reason).toBe('too_few_chapters');
  });

  it('AC-12: Rung 0-1 forms span >= 5 distinct chapters with <= 3 items per chapter', () => {
    for (const seed of ['c1', 'c2', 'c3']) {
      const form = select(makePool(), seed);
      expect(form.rung).toBeLessThanOrEqual(1);
      expect(form.chapterCount).toBeGreaterThanOrEqual(5);

      const perChapter = new Map<number, number>();
      for (const q of form.questions) {
        const ch = q.chapter_number as number;
        perChapter.set(ch, (perChapter.get(ch) ?? 0) + 1);
      }
      for (const [ch, n] of perChapter) {
        expect(n, `chapter ${ch}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('P5 / AC-15: VALID_DIAGNOSTIC_GRADES is exactly the strings "6".."12"', () => {
    expect([...VALID_DIAGNOSTIC_GRADES]).toEqual(['6', '7', '8', '9', '10', '11', '12']);
    for (const g of VALID_DIAGNOSTIC_GRADES) {
      expect(typeof g).toBe('string');
      expect(g).toMatch(/^(6|7|8|9|10|11|12)$/);
    }
  });

  it('P5: a numeric grade on a candidate row is rejected by V4 even when it "equals" the request', () => {
    expect(
      tier0Violation(makeItem({ grade: 9 as unknown as string }), {
        grade: '9',
        subject: SUBJECT,
        inScopeChapters: new Set(CHAPTERS),
      })
    ).toBe('V4');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8.5 Ladder + AC-24 never-degraded property test
// ══════════════════════════════════════════════════════════════════════════════

describe('diagnostic blueprint — §8.5 ladder', () => {
  it('AC-19 Rung 0: a verified pool yields quality_tier "verified" and 15 items', () => {
    const form = select(makePool());
    expect(form.rung).toBe(0);
    expect(form.qualityTier).toBe('verified');
    expect(form.questions.length).toBe(15);
  });

  it('AC-19 Rung 1: a pending/legacy pool yields "standard" and 15 items', () => {
    const form = select(makePool(24, { verification_state: 'pending', is_verified: false }));
    expect(form.rung).toBe(1);
    expect(form.qualityTier).toBe('standard');
    expect(form.questions.length).toBe(15);
  });

  it('AC-19 Rung 4: an empty pool yields rung 4, zero questions and a reason', () => {
    const form = select([]);
    expect(form.rung).toBe(4);
    expect(form.qualityTier).toBe('insufficient');
    expect(form.questions.length).toBe(0);
    expect(form.blueprint).toEqual({ easy: 0, medium: 0, hard: 0 });
    expect(form.reason).toBe('too_few_items');
  });

  it('AC-19 Rung 4: a pool with no hard items degrades rather than serving an all-easy form', () => {
    const pool = makePool(30).filter((q) => q.difficulty !== 3);
    const form = select(pool);
    expect(form.rung).toBe(4);
    expect(form.reason).toBe('no_hard_items');
    expect(form.questions.length).toBe(0);
  });

  it('AC-19 Rung 4: a pool with no HOTS items degrades', () => {
    const pool = makePool(30, { bloom_level: 'remember' });
    const form = select(pool);
    expect(form.rung).toBe(4);
    expect(form.questions.length).toBe(0);
  });

  it('short forms never go below the floor of 10 items', () => {
    for (const per of [4, 5, 6, 7]) {
      const form = select(makePool(per));
      if (form.rung === 4) continue;
      expect(form.questions.length).toBeGreaterThanOrEqual(DIAGNOSTIC_SHORT_FORM_FLOOR);
      expect(form.questions.length).toBeLessThanOrEqual(DIAGNOSTIC_QUESTION_COUNT);
    }
  });

  it('AC-24: across 500 randomly-shaped pools, every SERVED form has >=1 hard, >=1 HOTS and 0 Tier-0 violators', () => {
    let seed = 424242;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const hots = new Set<string>(DIAGNOSTIC_HOTS_LEVELS);
    const ctx = { grade: GRADE, subject: SUBJECT, inScopeChapters: new Set(CHAPTERS) };

    let served = 0;
    let rung4 = 0;

    for (let n = 0; n < 500; n++) {
      const pool: DiagnosticCandidate[] = [];
      for (const band of [1, 2, 3]) {
        const count = Math.floor(rand() * 14); // 0..13 per band
        for (let i = 0; i < count; i++) {
          pool.push(
            makeItem({
              difficulty: band,
              bloom_level: DIAGNOSTIC_BLOOM_LEVELS[Math.floor(rand() * 6)],
              chapter_number: CHAPTERS[Math.floor(rand() * CHAPTERS.length)],
              verification_state: rand() < 0.5 ? 'verified' : 'legacy_unverified',
            })
          );
        }
      }

      const form = select(pool, `prop-${n}`);
      if (form.rung === 4) {
        rung4++;
        expect(form.questions.length).toBe(0);
        continue;
      }
      served++;
      expect(form.questions.some((q) => q.difficulty === 3), `n=${n}: no hard item`).toBe(true);
      expect(
        form.questions.some((q) => hots.has(String(q.bloom_level))),
        `n=${n}: no HOTS item`
      ).toBe(true);
      for (const q of form.questions) {
        expect(tier0Violation(q, ctx), `n=${n} item ${q.id}`).toBeNull();
        expect(validateQuestion(q).valid, `n=${n} item ${q.id}`).toBe(true);
      }
    }

    // The property test is only meaningful if both branches were exercised.
    expect(served).toBeGreaterThan(0);
    expect(rung4).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8.6 Bloom's
// ══════════════════════════════════════════════════════════════════════════════

describe("diagnostic blueprint — §8.6 Bloom's spread", () => {
  function bucketCounts(form: { questions: DiagnosticCandidate[] }) {
    const hots = new Set<string>(DIAGNOSTIC_HOTS_LEVELS);
    const b = { remember: 0, understand: 0, apply: 0, hots: 0 };
    const levels = new Map<string, number>();
    for (const q of form.questions) {
      const lvl = String(q.bloom_level);
      levels.set(lvl, (levels.get(lvl) ?? 0) + 1);
      if (lvl === 'remember') b.remember++;
      else if (lvl === 'understand') b.understand++;
      else if (lvl === 'apply') b.apply++;
      else if (hots.has(lvl)) b.hots++;
    }
    return { b, levels };
  }

  it('AC-25: Rung 0-1 respects remember[2,5], understand[3,6], apply[3,6], HOTS[2,5], >=4 distinct levels, <=6 per level', () => {
    for (const seed of ['b1', 'b2', 'b3']) {
      const form = select(makePool(), seed);
      expect(form.rung).toBeLessThanOrEqual(1);
      const { b, levels } = bucketCounts(form);
      expect(b.remember).toBeGreaterThanOrEqual(2);
      expect(b.remember).toBeLessThanOrEqual(5);
      expect(b.understand).toBeGreaterThanOrEqual(3);
      expect(b.understand).toBeLessThanOrEqual(6);
      expect(b.apply).toBeGreaterThanOrEqual(3);
      expect(b.apply).toBeLessThanOrEqual(6);
      expect(b.hots).toBeGreaterThanOrEqual(2);
      expect(b.hots).toBeLessThanOrEqual(5);
      expect(levels.size).toBeGreaterThanOrEqual(4);
      for (const n of levels.values()) expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('AC-26: degraded rungs still keep >=3 distinct levels, >=1 HOTS and remember <= 50%', () => {
    // A pool too thin for Rung 0-1 but servable at Rung 2/3.
    const form = select(makePool(6));
    if (form.rung === 4) return; // covered by the ladder block
    expect(form.rung).toBeGreaterThanOrEqual(2);
    const { b, levels } = bucketCounts(form);
    expect(levels.size).toBeGreaterThanOrEqual(3);
    expect(b.hots).toBeGreaterThanOrEqual(1);
    expect(b.remember).toBeLessThanOrEqual(Math.floor(form.questions.length * 0.5));
  });

  it('AC-27: every returned bloom_level is canonical, and the constant order matches cognitive-engine BLOOM_LEVELS', () => {
    expect([...DIAGNOSTIC_BLOOM_LEVELS]).toEqual([...BLOOM_LEVELS]);
    const canonical = new Set<string>(DIAGNOSTIC_BLOOM_LEVELS);
    for (const q of select(makePool()).questions) {
      expect(canonical.has(String(q.bloom_level)), String(q.bloom_level)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('diagnostic blueprint — arrangeByTemplate contract', () => {
  it('returns null (so the caller falls back) when band counts are not exactly 5/6/4', () => {
    const wrong = [
      ...Array.from({ length: 5 }, () => makeItem({ difficulty: 1 })),
      ...Array.from({ length: 5 }, () => makeItem({ difficulty: 2 })),
      ...Array.from({ length: 5 }, () => makeItem({ difficulty: 3 })),
    ];
    expect(arrangeByTemplate(wrong, () => 0.5)).toBeNull();
  });

  it('places every selected item exactly once when counts are 5/6/4', () => {
    const ok = [
      ...Array.from({ length: 5 }, () => makeItem({ difficulty: 1 })),
      ...Array.from({ length: 6 }, () => makeItem({ difficulty: 2 })),
      ...Array.from({ length: 4 }, () => makeItem({ difficulty: 3 })),
    ];
    const arranged = arrangeByTemplate(ok, () => 0.5);
    expect(arranged).not.toBeNull();
    expect(arranged!.length).toBe(15);
    expect(new Set(arranged!.map((q) => q.id)).size).toBe(15);
    expect(arranged!.map((q) => q.difficulty)).toEqual([...DIAGNOSTIC_BAND_TEMPLATE]);
  });
});
