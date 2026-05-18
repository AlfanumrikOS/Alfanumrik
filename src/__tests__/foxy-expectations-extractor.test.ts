/**
 * Phase 3 of Foxy continuity (2026-05-18) — extractor contract tests.
 *
 * Pins the SHAPE of `extractExpectation` for 20 hand-curated assistant
 * replies. Mix of MCQ / open / recall / solve / explain / choose_topic /
 * statement-only / multi-question shapes.
 *
 * For multi-question replies the extractor prefers the LAST `-> ` arrow
 * prompt — that's the one Foxy actually wants answered (earlier "-> " lines
 * are usually worked-example checkpoints).
 */

import { describe, it, expect } from 'vitest';
import {
  extractExpectation,
  type ExpectationKind,
} from '@/lib/learn/foxy-expectations';

interface Case {
  name: string;
  input: string;
  structured?: Parameters<typeof extractExpectation>[1] extends infer O
    ? O extends { structured?: infer S }
      ? S
      : never
    : never;
  expectKind: ExpectationKind | null;     // null = expect extractor to return null
  expectTextIncludes?: string;
  expectMcqOptions?: boolean;
}

const CASES: Case[] = [
  // ── 1. MCQ with options on separate lines ─────────────────────────────
  {
    name: 'mcq with A/B/C/D options',
    input:
      'Photosynthesis happens in chloroplasts.\n\n' +
      'A) Mitochondria\nB) Chloroplasts\nC) Nucleus\nD) Cell wall\n\n' +
      '-> Which one is correct?',
    expectKind: 'mcq',
    expectTextIncludes: 'correct',
    expectMcqOptions: true,
  },
  // ── 2. MCQ with options on the same line ──────────────────────────────
  {
    name: 'mcq inline options',
    input: 'Pick the right answer. A) 12 B) 14 C) 18 D) 20\n-> Which one?',
    expectKind: 'mcq',
    expectMcqOptions: true,
  },
  // ── 3. Plain open question (single ?) ─────────────────────────────────
  {
    name: 'open question with -> marker',
    input:
      '### Step 1: Newton\'s First Law\n\n' +
      'An object stays at rest unless a force acts on it.\n\n' +
      '-> Can you give one example from your daily life?',
    expectKind: 'open',
    expectTextIncludes: 'example',
  },
  // ── 4. Recall question (define) ───────────────────────────────────────
  {
    name: 'recall - define',
    input: '-> Define photosynthesis in one sentence.',
    expectKind: 'recall',
    expectTextIncludes: 'photosynthesis',
  },
  // ── 5. Solve question (calculate) ─────────────────────────────────────
  {
    name: 'solve - calculate',
    input:
      'A car covers 60 km in 2 hours.\n\n-> Calculate its average speed.',
    expectKind: 'solve',
    expectTextIncludes: 'speed',
  },
  // ── 6. Explain question (why) ─────────────────────────────────────────
  {
    name: 'explain - why',
    input: '-> Why does ice float on water?',
    expectKind: 'explain',
    expectTextIncludes: 'ice',
  },
  // ── 7. Choose-topic menu ──────────────────────────────────────────────
  {
    name: 'choose_topic - menu',
    input:
      'Great! We can explore several directions.\n' +
      'Pick one: photosynthesis, respiration, or transpiration.\n' +
      '-> Which would you like to start with?',
    expectKind: 'choose_topic',
  },
  // ── 8. Multi-question reply: prefer the LAST -> arrow prompt ──────────
  {
    name: 'multi-question - last arrow wins',
    input:
      '-> First, can you tell me what force means?\n' +
      'Good. Now consider a ball rolling on grass.\n' +
      '-> Now you try: what stops the ball, friction or gravity?',
    expectKind: 'open',
    expectTextIncludes: 'friction or gravity',
  },
  // ── 9. Statement-only reply (no question) → null ──────────────────────
  {
    name: 'statement only - no question',
    input:
      '### Step 1\n\nNewton\'s First Law says objects resist change in motion.\n\n' +
      '### Step 2\n\nThis property is called inertia.',
    expectKind: null,
  },
  // ── 10. Safety-redirect (no question expected from student) ───────────
  {
    name: 'safety redirect statement-only',
    input:
      'Bilkul, that\'s outside Class 9 Physics. Let\'s come back to Newton\'s Laws — we were on Step 2.',
    expectKind: null,
  },
  // ── 11. Trailing ? but no -> marker ───────────────────────────────────
  {
    name: 'trailing question fallback',
    input: 'Photosynthesis happens in chloroplasts. Can you name another organelle?',
    expectKind: 'open',
    expectTextIncludes: 'organelle',
  },
  // ── 12. MCQ with numeric labels (1/2/3/4) ─────────────────────────────
  {
    name: 'mcq numeric labels',
    input:
      'Which planet is largest?\n' +
      '1) Earth  2) Jupiter  3) Mars  4) Mercury\n' +
      '-> Pick one.',
    // We classify on the "Pick one" phrasing AND option markers; either
    // mcq or choose_topic is acceptable. Test only that it's not 'open'.
    expectKind: 'choose_topic',
  },
  // ── 13. Structured payload preferred over heuristic ───────────────────
  {
    name: 'structured payload preferred',
    input: 'Some rendered text not matching any question shape.',
    structured: {
      question: {
        text: 'What is the SI unit of force?',
        kind: 'recall',
      },
    },
    expectKind: 'recall',
    expectTextIncludes: 'SI unit',
  },
  // ── 14. Structured with options array → mcq ───────────────────────────
  {
    name: 'structured payload with options',
    input: '',
    structured: {
      question: {
        text: 'Which of the following is a vector quantity?',
        kind: 'mcq',
        options: [
          { text: 'A) Mass' },
          { text: 'B) Velocity' },
          { text: 'C) Time' },
          { text: 'D) Distance' },
        ],
      },
    },
    expectKind: 'mcq',
    expectMcqOptions: true,
  },
  // ── 15. Long question text gets truncated ─────────────────────────────
  {
    name: 'long question text truncated',
    input:
      '-> ' +
      'Imagine you are designing an experiment to test whether the rate of '.repeat(20) +
      'photosynthesis varies with light intensity. How would you set it up?',
    expectKind: 'open',
  },
  // ── 16. Hindi-Devanagari question ─────────────────────────────────────
  {
    name: 'hindi devanagari question',
    input: '-> क्या आप इसे और सरल तरीके से समझ सकते हैं?',
    expectKind: 'open',
  },
  // ── 17. Question with embedded math ───────────────────────────────────
  {
    name: 'math expression in question',
    input: '-> Calculate the value of $\\int_0^1 x^2 dx$.',
    expectKind: 'solve',
    expectTextIncludes: 'Calculate',
  },
  // ── 18. Empty reply → null ────────────────────────────────────────────
  {
    name: 'empty reply',
    input: '',
    expectKind: null,
  },
  // ── 19. Whitespace-only reply → null ──────────────────────────────────
  {
    name: 'whitespace only',
    input: '   \n\n\n  ',
    expectKind: null,
  },
  // ── 20. Mcq-shaped phrasing ("which of these") but no visible options →
  //         falls through to 'open' because there are no A/B/C/D markers
  //         and no menu-language signal in the question.
  {
    name: 'mcq phrasing but no options listed - falls to open',
    input: '-> Which of these is true about photosynthesis?',
    expectKind: 'open',
  },
];

describe('extractExpectation', () => {
  it.each(CASES)('case $name', ({ input, structured, expectKind, expectTextIncludes, expectMcqOptions }) => {
    const result = extractExpectation(input, structured ? { structured } : {});

    if (expectKind === null) {
      expect(result).toBeNull();
      return;
    }

    expect(result).not.toBeNull();
    expect(result!.kind).toBe(expectKind);
    expect(result!.text).toBeTruthy();
    expect(result!.text.length).toBeLessThanOrEqual(500);

    if (expectTextIncludes) {
      expect(result!.text.toLowerCase()).toContain(expectTextIncludes.toLowerCase());
    }
    if (expectMcqOptions) {
      const options = (result!.meta as { options?: unknown[] }).options;
      expect(Array.isArray(options)).toBe(true);
      expect((options as unknown[]).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('truncates long question text to <= 500 chars with ellipsis', () => {
    const long = '-> ' + 'a'.repeat(2000) + '?';
    const r = extractExpectation(long);
    expect(r).not.toBeNull();
    expect(r!.text.length).toBeLessThanOrEqual(500);
    expect(r!.text.endsWith('…')).toBe(true);
  });

  it('falls back to last trailing-? sentence when no -> marker present', () => {
    const input =
      'The kinetic energy depends on mass and velocity. ' +
      'Can you write the formula?';
    const r = extractExpectation(input);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('formula');
  });

  it('structured.question.text wins even if rendered text has a question', () => {
    const r = extractExpectation('-> Some heuristic question?', {
      structured: { question: { text: 'Canonical structured Q', kind: 'recall' } },
    });
    expect(r).not.toBeNull();
    expect(r!.text).toBe('Canonical structured Q');
    expect(r!.kind).toBe('recall');
    expect((r!.meta as Record<string, unknown>).source).toBe('structured');
  });

  it('returns null when structured payload exists but has no question', () => {
    const r = extractExpectation('Just a statement.', {
      structured: { blocks: [{ kind: 'text', text: 'hi' }] },
    });
    expect(r).toBeNull();
  });
});
