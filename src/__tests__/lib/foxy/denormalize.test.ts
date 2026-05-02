/**
 * Unit tests for src/lib/foxy/denormalize.ts
 *
 * Pins the denormalization contract used by /api/foxy/route.ts to populate
 * `foxy_chat_messages.content` from a structured FoxyResponse:
 *   - Title is the first line.
 *   - Step blocks are numbered "Step N: ..." starting at 1.
 *   - Math blocks are wrapped with `$$ ... $$` KaTeX delimiters.
 *   - Other text blocks (paragraph/answer/exam_tip/definition/example/question)
 *     emit their `text` field verbatim.
 *   - Output is capped at FOXY_DENORMALIZE_MAX_CHARS with an ellipsis.
 *
 * P12 (AI Safety): the denormalizer trusts its input -- validation MUST happen
 * upstream via FoxyResponseSchema.safeParse(). These tests exercise only the
 * already-validated happy path.
 */

import { describe, it, expect } from 'vitest';
import {
  denormalizeFoxyResponse,
  FOXY_DENORMALIZE_MAX_CHARS,
} from '@/lib/foxy/denormalize';
import type { FoxyResponse } from '@/lib/foxy/schema';

describe('denormalizeFoxyResponse', () => {
  it('emits title as the first line', () => {
    const payload: FoxyResponse = {
      title: 'Linear Equations',
      subject: 'math',
      blocks: [{ type: 'paragraph', text: 'A linear equation has degree 1.' }],
    };
    const out = denormalizeFoxyResponse(payload);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Linear Equations');
  });

  it('numbers step blocks starting at 1 in order', () => {
    const payload: FoxyResponse = {
      title: 'Solving 2x + 3 = 11',
      subject: 'math',
      blocks: [
        { type: 'step', text: 'Subtract 3 from both sides.' },
        { type: 'step', text: 'Divide both sides by 2.' },
        { type: 'answer', text: 'x = 4' },
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out).toContain('Step 1: Subtract 3 from both sides.');
    expect(out).toContain('Step 2: Divide both sides by 2.');
    expect(out).toContain('x = 4');
  });

  it('wraps math blocks with $$ ... $$ KaTeX delimiters', () => {
    const payload: FoxyResponse = {
      title: "Newton's Second Law",
      subject: 'science',
      blocks: [
        { type: 'definition', text: 'Force equals mass times acceleration.' },
        { type: 'math', latex: 'F = m \\cdot a' },
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out).toContain('$$ F = m \\cdot a $$');
  });

  it('emits non-math text blocks verbatim', () => {
    const payload: FoxyResponse = {
      title: 'Preamble',
      subject: 'sst',
      blocks: [
        { type: 'paragraph', text: 'India is a sovereign republic.' },
        { type: 'exam_tip', text: 'Remember the four pillars.' },
        { type: 'definition', text: 'Sovereign means independent.' },
        { type: 'example', text: 'Like a self-governing nation.' },
        { type: 'question', text: 'What does fraternity mean?' },
        { type: 'answer', text: 'A spirit of brotherhood.' },
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out).toContain('India is a sovereign republic.');
    expect(out).toContain('Remember the four pillars.');
    expect(out).toContain('Sovereign means independent.');
    expect(out).toContain('Like a self-governing nation.');
    expect(out).toContain('What does fraternity mean?');
    expect(out).toContain('A spirit of brotherhood.');
  });

  it('joins blocks with newlines (one block per line)', () => {
    const payload: FoxyResponse = {
      title: 'Title',
      subject: 'general',
      blocks: [
        { type: 'paragraph', text: 'First.' },
        { type: 'paragraph', text: 'Second.' },
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out.split('\n')).toEqual(['Title', 'First.', 'Second.']);
  });

  it('truncates output exceeding FOXY_DENORMALIZE_MAX_CHARS with an ellipsis', () => {
    // Build 6 paragraphs of 1800 chars each = ~10.8 KB raw. Each paragraph
    // size is below the schema's per-text 2000-char cap. Combined (with the
    // title + newlines) exceeds 8 KB so truncation must kick in.
    const longText = 'a'.repeat(1800);
    const payload: FoxyResponse = {
      title: 'Long',
      subject: 'general',
      blocks: Array.from({ length: 6 }, () => ({
        type: 'paragraph' as const,
        text: longText,
      })),
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out.length).toBeLessThanOrEqual(FOXY_DENORMALIZE_MAX_CHARS);
    // Ellipsis present at the end.
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate when output is under the cap', () => {
    const payload: FoxyResponse = {
      title: 'Short',
      subject: 'general',
      blocks: [{ type: 'paragraph', text: 'Tiny.' }],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out.endsWith('…')).toBe(false);
    expect(out).toBe('Short\nTiny.');
  });

  it('handles a mixed math-and-text payload deterministically', () => {
    const payload: FoxyResponse = {
      title: 'Solving 2x + 3 = 11',
      subject: 'math',
      blocks: [
        { type: 'step', text: 'Subtract 3.' },
        { type: 'math', latex: '2x = 8' },
        { type: 'step', text: 'Divide by 2.' },
        { type: 'math', latex: 'x = 4' },
        { type: 'answer', text: 'x = 4' },
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out).toBe(
      [
        'Solving 2x + 3 = 11',
        'Step 1: Subtract 3.',
        '$$ 2x = 8 $$',
        'Step 2: Divide by 2.',
        '$$ x = 4 $$',
        'x = 4',
      ].join('\n'),
    );
  });
});
