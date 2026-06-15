/**
 * Unit tests for src/lib/foxy/schema.ts
 *
 * Locks down the canonical Foxy structured-response contract:
 *   - Valid payloads per subject (math, science, sst, english, general).
 *   - Math blocks require non-empty `latex` and forbid `text` / `$` delimiters.
 *   - Non-math blocks require non-empty `text` and forbid `latex`.
 *   - Subject rules (math expects math blocks, science caps math, sst/english
 *     forbid math).
 *   - Whole-payload byte cap.
 *   - `wrapAsParagraph` produces a schema-valid response from arbitrary input.
 *
 * P12 (AI Safety): this schema is the gate that rejects malformed model output
 * before it reaches a student. These tests pin its rejection surface.
 */

import { describe, it, expect } from 'vitest';
import {
  FoxyResponseSchema,
  validateSubjectRules,
  wrapAsParagraph,
  FOXY_MAX_PAYLOAD_BYTES,
  FOXY_FALLBACK_MAX_BLOCKS,
  FOXY_STRUCTURED_OUTPUT_PROMPT,
  type FoxyResponse,
} from '@/lib/foxy/schema';

describe('FoxyResponseSchema -- valid payloads', () => {
  it('accepts a valid math response', () => {
    const payload: FoxyResponse = {
      title: 'Solving 2x + 3 = 11',
      subject: 'math',
      blocks: [
        { type: 'step', label: 'Step 1', text: 'Subtract 3 from both sides.' },
        { type: 'math', latex: '2x = 8' },
        { type: 'answer', text: 'x = 4' },
      ],
    };
    const result = FoxyResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('accepts a valid science response with one math block', () => {
    const payload: FoxyResponse = {
      title: "Newton's Second Law",
      subject: 'science',
      blocks: [
        { type: 'definition', label: 'Definition', text: 'F equals m times a.' },
        { type: 'paragraph', text: 'It links force, mass, and acceleration.' },
        { type: 'math', latex: 'F = m \\cdot a' },
        { type: 'example', text: 'A 2 kg ball at 3 m/s^2 needs 6 N of force.' },
      ],
    };
    const result = FoxyResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    // 1 math out of 4 blocks = 25% <= 30%, accepted.
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('accepts a valid SST response', () => {
    const payload: FoxyResponse = {
      title: 'Preamble of the Constitution',
      subject: 'sst',
      blocks: [
        { type: 'paragraph', text: 'India is a sovereign, socialist, secular, democratic republic.' },
        { type: 'exam_tip', text: 'Remember Justice, Liberty, Equality, Fraternity.' },
      ],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(true);
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('accepts a valid English response', () => {
    const payload: FoxyResponse = {
      title: 'Nouns vs Pronouns',
      subject: 'english',
      blocks: [
        { type: 'definition', label: 'Noun', text: 'A noun names a person, place, or thing.' },
        { type: 'example', text: "In 'Riya read her book', 'Riya' is a noun." },
      ],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(true);
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('accepts Hindi text in fields (P7 bilingual)', () => {
    const payload: FoxyResponse = {
      title: 'संविधान की प्रस्तावना',
      subject: 'sst',
      blocks: [
        { type: 'paragraph', text: 'भारत एक संप्रभु, समाजवादी, धर्मनिरपेक्ष गणराज्य है।' },
      ],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(true);
  });
});

describe('FoxyResponseSchema -- block-level rejections', () => {
  it('rejects math block missing latex', () => {
    const payload = {
      title: 'Bad math',
      subject: 'math',
      blocks: [{ type: 'math' }],
    };
    const result = FoxyResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects math block with empty latex', () => {
    const payload = {
      title: 'Bad math',
      subject: 'math',
      blocks: [{ type: 'math', latex: '   ' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects math block containing $ delimiters', () => {
    const payload = {
      title: 'Bad math',
      subject: 'math',
      blocks: [{ type: 'math', latex: '$x = 4$' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects math block containing $$ delimiters', () => {
    const payload = {
      title: 'Bad math',
      subject: 'math',
      blocks: [{ type: 'math', latex: '$$x = 4$$' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects math block that also includes text', () => {
    const payload = {
      title: 'Bad math',
      subject: 'math',
      blocks: [{ type: 'math', latex: 'x = 4', text: 'four' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects paragraph block with empty text after trim', () => {
    const payload = {
      title: 'Empty paragraph',
      subject: 'general',
      blocks: [{ type: 'paragraph', text: '   ' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects paragraph block missing text', () => {
    const payload = {
      title: 'Missing text',
      subject: 'general',
      blocks: [{ type: 'paragraph' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects non-math block that includes a latex field', () => {
    const payload = {
      title: 'Stray latex',
      subject: 'general',
      blocks: [{ type: 'paragraph', text: 'hello', latex: 'x = 1' }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects text exceeding max length', () => {
    const payload = {
      title: 'Long text',
      subject: 'general',
      blocks: [{ type: 'paragraph', text: 'a'.repeat(2001) }],
    };
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
  });
});

describe('FoxyResponseSchema -- response-level rejections', () => {
  it('rejects empty blocks array', () => {
    expect(
      FoxyResponseSchema.safeParse({
        title: 'Empty',
        subject: 'general',
        blocks: [],
      }).success
    ).toBe(false);
  });

  it('rejects more than 50 blocks', () => {
    const blocks = Array.from({ length: 51 }, () => ({
      type: 'paragraph' as const,
      text: 'hello',
    }));
    expect(
      FoxyResponseSchema.safeParse({
        title: 'Too many',
        subject: 'general',
        blocks,
      }).success
    ).toBe(false);
  });

  it('rejects empty title', () => {
    expect(
      FoxyResponseSchema.safeParse({
        title: '',
        subject: 'general',
        blocks: [{ type: 'paragraph', text: 'hi' }],
      }).success
    ).toBe(false);
  });

  it('rejects unknown subject', () => {
    expect(
      FoxyResponseSchema.safeParse({
        title: 'X',
        subject: 'physics',
        blocks: [{ type: 'paragraph', text: 'hi' }],
      }).success
    ).toBe(false);
  });

  it('rejects oversized payload (> 16 KB)', () => {
    // 50 blocks * ~1900 chars ~= 95 KB > 16 KB cap.
    const blocks = Array.from({ length: 50 }, () => ({
      type: 'paragraph' as const,
      text: 'a'.repeat(1900),
    }));
    const result = FoxyResponseSchema.safeParse({
      title: 'Too big',
      subject: 'general',
      blocks,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = JSON.stringify(result.error.issues);
      expect(msg).toContain(`${FOXY_MAX_PAYLOAD_BYTES}`);
    }
  });
});

describe('validateSubjectRules', () => {
  it('warns (does not reject) when math subject has no math blocks', () => {
    const payload: FoxyResponse = {
      title: 'Math without math',
      subject: 'math',
      blocks: [{ type: 'paragraph', text: 'Just words.' }],
    };
    const result = validateSubjectRules(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings && result.warnings.length).toBeGreaterThan(0);
    }
  });

  it('rejects sst with single math block (ratio 1.0 > 20%)', () => {
    // 1 math out of 1 block = 100% > 20%.
    const payload: FoxyResponse = {
      title: 'SST one math block',
      subject: 'sst',
      blocks: [{ type: 'math', latex: 'x = 1' }],
    };
    const result = validateSubjectRules(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/sst/);
    }
  });

  it('rejects sst when math blocks exceed 20% (1 of 4 = 25%)', () => {
    // 1 math out of 4 blocks = 25% > 20%.
    const payload: FoxyResponse = {
      title: 'SST 25% math',
      subject: 'sst',
      blocks: [
        { type: 'paragraph', text: 'Sectors of the economy include primary, secondary, tertiary.' },
        { type: 'math', latex: 'growth = (V_2 - V_1) / V_1 \\times 100' },
        { type: 'paragraph', text: 'India shifted from agrarian to service-led.' },
        { type: 'paragraph', text: 'Tertiary now dominates GDP share.' },
      ],
    };
    const result = validateSubjectRules(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/sst/);
    }
  });

  it('accepts sst with at most 20% math blocks (1 of 5 = 20%)', () => {
    // 1 math out of 5 blocks = 20% (== cap, strict `>` does not reject).
    // CBSE Class 10 Economics: growth-rate formula in a Sectors lesson.
    const payload: FoxyResponse = {
      title: 'Sectoral growth rate',
      subject: 'sst',
      blocks: [
        { type: 'paragraph', text: 'Growth rate measures change in sectoral output year-on-year.' },
        { type: 'definition', label: 'Growth rate', text: 'Percentage change between two periods.' },
        { type: 'math', latex: 'growth = (V_2 - V_1) / V_1 \\times 100' },
        { type: 'example', text: 'If GDP rises from 100 to 108, growth is 8%.' },
        { type: 'exam_tip', text: 'CBSE expects you to show the formula and one calculation.' },
      ],
    };
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('accepts pure-prose sst with zero math blocks', () => {
    // Unchanged behavior: 0 math out of N is always within cap.
    const payload: FoxyResponse = {
      title: 'Preamble of the Constitution',
      subject: 'sst',
      blocks: [
        { type: 'paragraph', text: 'India is a sovereign, socialist, secular, democratic republic.' },
        { type: 'exam_tip', text: 'Remember Justice, Liberty, Equality, Fraternity.' },
      ],
    };
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('rejects english with any math block', () => {
    const payload: FoxyResponse = {
      title: 'English with math',
      subject: 'english',
      blocks: [
        { type: 'paragraph', text: 'Grammar note.' },
        { type: 'math', latex: 'x = 1' },
      ],
    };
    expect(validateSubjectRules(payload).ok).toBe(false);
  });

  it('rejects science when math blocks exceed 30%', () => {
    // 2 math out of 4 blocks = 50% > 30%.
    const payload: FoxyResponse = {
      title: 'Too much math',
      subject: 'science',
      blocks: [
        { type: 'paragraph', text: 'Intro.' },
        { type: 'math', latex: 'F = m a' },
        { type: 'math', latex: 'p = m v' },
        { type: 'paragraph', text: 'Conclusion.' },
      ],
    };
    const result = validateSubjectRules(payload);
    expect(result.ok).toBe(false);
  });

  it('accepts science with at most 30% math blocks', () => {
    // 1 math out of 4 = 25% <= 30%.
    const payload: FoxyResponse = {
      title: 'Balanced science',
      subject: 'science',
      blocks: [
        { type: 'paragraph', text: 'Intro.' },
        { type: 'math', latex: 'F = m a' },
        { type: 'paragraph', text: 'Mid.' },
        { type: 'paragraph', text: 'End.' },
      ],
    };
    expect(validateSubjectRules(payload).ok).toBe(true);
  });

  it('imposes no extra rules on general subject', () => {
    const payload: FoxyResponse = {
      title: 'General',
      subject: 'general',
      blocks: [
        { type: 'paragraph', text: 'Anything goes.' },
        { type: 'math', latex: 'x = 1' },
      ],
    };
    expect(validateSubjectRules(payload).ok).toBe(true);
  });
});

describe('wrapAsParagraph', () => {
  it('produces a schema-valid response from a simple string', () => {
    const out = wrapAsParagraph('Hello there.\n\nThis is the second paragraph.', {
      title: 'Foxy says hi',
      subject: 'general',
    });
    expect(out.title).toBe('Foxy says hi');
    expect(out.subject).toBe('general');
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0]).toEqual({ type: 'paragraph', text: 'Hello there.' });
    expect(out.blocks[1]).toEqual({
      type: 'paragraph',
      text: 'This is the second paragraph.',
    });
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('falls back to a friendly message when input is empty', () => {
    const out = wrapAsParagraph('', {});
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0].text).toMatch(/break/i);
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('uses default title when none provided', () => {
    const out = wrapAsParagraph('hello');
    expect(out.title).toBe('Foxy');
    expect(out.subject).toBe('general');
  });

  it('truncates and folds extra paragraphs into the final block', () => {
    const paras = Array.from(
      { length: FOXY_FALLBACK_MAX_BLOCKS + 5 },
      (_, i) => `Para ${i}`
    );
    const out = wrapAsParagraph(paras.join('\n\n'));
    expect(out.blocks).toHaveLength(FOXY_FALLBACK_MAX_BLOCKS);
    // Last block should contain the folded tail (Para 29 + remainder).
    const last = out.blocks[FOXY_FALLBACK_MAX_BLOCKS - 1];
    expect(last.type).toBe('paragraph');
    expect(last.text).toContain(`Para ${FOXY_FALLBACK_MAX_BLOCKS - 1}`);
    expect(last.text).toContain(`Para ${FOXY_FALLBACK_MAX_BLOCKS + 4}`);
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('clamps an oversized title to 120 chars', () => {
    const out = wrapAsParagraph('hello', { title: 'x'.repeat(500) });
    expect(out.title.length).toBeLessThanOrEqual(120);
  });

  // ── JSON-leak prevention (May 2026 prod regression) ──
  // wrapAsParagraph used to dump raw JSON text into a paragraph block when
  // Claude's structured output truncated mid-block. The Foxy chat bubble
  // then rendered the literal `{"title":"…","blocks":[…` to students.
  // These tests lock in the rescue + extraction + friendly-fallback path.

  it('rescues truncated JSON instead of leaking it as paragraph text', () => {
    const truncated =
      '{"title":"Onion as Olfactory Indicator","subject":"science","blocks":[' +
      '{"type":"paragraph","text":"An olfactory indicator changes smell."},' +
      '{"type":"step","label":"Step 1","text":"Take a fresh onion bulb."},' +
      '{"type":"step","label":"Step 2","text":"Observe';

    const out = wrapAsParagraph(truncated);

    for (const block of out.blocks) {
      if (block.type === 'paragraph' && block.text) {
        expect(block.text.startsWith('{')).toBe(false);
        expect(block.text).not.toContain('"blocks"');
        expect(block.text).not.toContain('"title":');
      }
    }
    expect(out.blocks.length).toBeGreaterThanOrEqual(2);
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('rescues fenced ```json with truncation', () => {
    const fenced =
      '```json\n' +
      '{"title":"T","subject":"science","blocks":[' +
      '{"type":"paragraph","text":"Complete block."},' +
      '{"type":"paragraph","text":"Truncated';

    const out = wrapAsParagraph(fenced);
    expect(out.blocks[0].text).not.toContain('```');
    expect(out.blocks[0].text!.startsWith('{')).toBe(false);
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('falls back to extracted text fields when rescue fails', () => {
    // Truncation cut INSIDE a string — rescueFromTruncatedJson can't recover
    // a valid structure but text-extraction should pull human content.
    const broken =
      '{"title":"Q","subject":"science","blocks":[' +
      '{"type":"paragraph","text":"First sentence here."},' +
      '{"type":"paragraph","text":"Second sentence here."},' +
      '{"type":"paragraph","text":"Third sentence cut off mid';

    const out = wrapAsParagraph(broken);
    for (const block of out.blocks) {
      expect(block.text!.startsWith('{')).toBe(false);
      expect(block.text).not.toContain('"text":');
    }
    const allText = out.blocks.map((b) => b.text).join(' ');
    expect(allText).toContain('First sentence here.');
    expect(allText).toContain('Second sentence here.');
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('emits a friendly bilingual fallback when nothing recoverable', () => {
    const out = wrapAsParagraph('{this is not really json {{{ broken');
    expect(out.blocks).toHaveLength(1);
    const text = out.blocks[0].text!;
    expect(text.startsWith('{')).toBe(false);
    expect(text.toLowerCase()).toContain('cut off');
    expect(text.toLowerCase()).toContain('sawal');
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('preserves caller subject hint on rescued JSON', () => {
    const truncated =
      '{"title":"T","subject":"general","blocks":[' +
      '{"type":"paragraph","text":"Complete block."},' +
      '{"type":"paragraph","text":"Truncated';

    const out = wrapAsParagraph(truncated, { subject: 'science' });
    expect(out.subject).toBe('science');
  });
});

describe('FOXY_STRUCTURED_OUTPUT_PROMPT', () => {
  it('forbids markdown EMPHASIS, keeps JSON-only / no-fences, and ALLOWS inline math', () => {
    // (a) JSON-only contract, no markdown fences — unchanged.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/Return ONLY valid JSON/i);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/no markdown fences/i);

    // (b) Markdown EMPHASIS is forbidden (new contract wording). The prior
    // blanket "Markdown is FORBIDDEN" was narrowed: only emphasis is banned,
    // because inline math (a backslash-escape syntax) is now ALLOWED in text.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/Markdown emphasis is FORBIDDEN/i);
    // The concrete emphasis tokens are still called out as banned.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('"**"');
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('"__"');

    // (c) Inline math `\( ... \)` is now EXPLICITLY allowed inside text fields.
    // The template literal escapes each backslash, so the constant contains a
    // single literal backslash before "(" / "[". Assert the allow-statement and
    // the delimiter form the prompt actually instructs the model to use.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/INLINE MATH inside "text" fields IS ALLOWED/i);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('\\( ... \\)');
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('\\[ ... \\]');
    // And it must still steer the model AWAY from "$" delimiters toward the
    // backslash form (the normalizer canonicalises any stray "$" anyway).
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/Do NOT use "\$" or "\$\$" delimiters/i);
  });

  it('includes a few-shot example for each subject', () => {
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/"subject":"math"/);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/"subject":"science"/);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/"subject":"sst"/);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/"subject":"english"/);
  });

  it('mentions bilingual contract and untranslated technical terms', () => {
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/CBSE/);
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/Hindi/i);
  });
});
