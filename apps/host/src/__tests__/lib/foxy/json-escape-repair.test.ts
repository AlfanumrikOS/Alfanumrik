/**
 * Unit + regression tests for `repairIllegalJsonEscapes` — the pre-parse
 * repair of illegal JSON escapes in Foxy structured output (2026-07-20
 * production incident: prompts showed single-backslash LaTeX inside JSON
 * strings, the model imitated them, JSON.parse threw at the first
 * math-bearing block, and the truncation-rescue path silently dropped every
 * block after it — students got a problem restatement with no solution while
 * telemetry recorded success; 19/29 math turns in 48h).
 *
 * Contract pinned here (see the module header for the full policy):
 *   1. Legal escapes (\n \t \b \f \r \" \\ \/ \uXXXX) preserved byte-for-byte.
 *   2. Illegal escapes inside string literals (`\(`, `\[`, `\p`, ...) doubled.
 *   3. Legal-escape-HEADED LaTeX commands (`\times`, `\neq`, `\frac`, ...)
 *      doubled via the math-command arbiter, word-bounded.
 *   4. Nothing outside string literals is ever touched.
 *   5. Idempotent.
 *   6. The repaired payload of today's failure shape parses AND validates as
 *      a full FoxyResponse — no block loss.
 */

import { describe, it, expect } from 'vitest';

import {
  repairIllegalJsonEscapes,
  JSON_REPAIR_MATH_COMMANDS,
  JSON_REPAIR_EXTRA_COMMANDS,
} from '@alfanumrik/lib/foxy/json-escape-repair';
import {
  FoxyResponseSchema,
  rescueFromTruncatedJson,
  wrapAsParagraph,
} from '@alfanumrik/lib/foxy/schema';

describe('repairIllegalJsonEscapes — legal escapes preserved byte-for-byte', () => {
  it.each([
    ['newline', '{"a":"line1\\nline2"}'],
    ['tab', '{"a":"col1\\tcol2"}'],
    ['escaped quote', '{"a":"say \\"hi\\""}'],
    ['escaped backslash', '{"a":"C:\\\\path"}'],
    ['forward slash', '{"a":"a\\/b"}'],
    ['unicode', '{"a":"\\u0041\\u00e9"}'],
    ['backspace + formfeed + cr', '{"a":"\\b\\f\\r"}'],
    ['already-doubled LaTeX', '{"a":"\\\\( \\\\frac{1}{2} \\\\)"}'],
  ])('%s untouched', (_name, input) => {
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repaired).toBe(input);
    expect(repairCount).toBe(0);
    // And it stays valid JSON.
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  it('genuine control escapes followed by non-command letters stay control escapes', () => {
    // `\t` + "cell" (no arbiter match) is a real tab; `\n` + "ame" a real newline.
    const input = '{"a":"col1\\tcell","b":"first\\name"}';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repaired).toBe(input);
    expect(repairCount).toBe(0);
    const decoded = JSON.parse(repaired);
    expect(decoded.a).toBe('col1\tcell');
    expect(decoded.b).toBe('first\name');
  });
});

describe('repairIllegalJsonEscapes — illegal LaTeX escapes repaired inside strings', () => {
  it('repairs \\( \\) \\[ \\] delimiters', () => {
    const input = '{"text":"Solve \\( x^2 \\) and \\[ y \\]."}';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repairCount).toBe(4);
    const decoded = JSON.parse(repaired);
    expect(decoded.text).toBe('Solve \\( x^2 \\) and \\[ y \\].');
  });

  it('repairs illegal-head commands (\\pi, \\sqrt, \\cdot, \\lambda)', () => {
    const input = '{"latex":"\\pi r^2 + \\sqrt{x} \\cdot \\lambda"}';
    const { repaired } = repairIllegalJsonEscapes(input);
    const decoded = JSON.parse(repaired);
    expect(decoded.latex).toBe('\\pi r^2 + \\sqrt{x} \\cdot \\lambda');
  });

  it('repairs legal-escape-headed commands via the arbiter (\\times, \\neq, \\frac, \\theta, \\boxed)', () => {
    const input =
      '{"text":"\\frac{1}{2} \\times 4 \\neq 3, angle \\theta, answer \\boxed{2}"}';
    const { repaired } = repairIllegalJsonEscapes(input);
    const decoded = JSON.parse(repaired);
    expect(decoded.text).toBe(
      '\\frac{1}{2} \\times 4 \\neq 3, angle \\theta, answer \\boxed{2}',
    );
  });

  it('word boundary: \\franchise (not a command... but \\f is a legal escape head) stays; \\fracX stays', () => {
    // `\franchise`: head `\f` is a LEGAL escape and "ranchise" does not
    // complete an allowlisted command ("frac" requires a word boundary and is
    // followed by more letters here) — preserved as formfeed + "ranchise".
    const input = '{"a":"a\\franchise","b":"a\\fracXY"}';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repaired).toBe(input);
    expect(repairCount).toBe(0);
  });

  it('repairs \\u NOT followed by 4 hex digits (\\underline) but preserves \\uXXXX', () => {
    const input = '{"a":"\\underline{x}","b":"\\u0041"}';
    const { repaired } = repairIllegalJsonEscapes(input);
    const decoded = JSON.parse(repaired);
    expect(decoded.a).toBe('\\underline{x}');
    expect(decoded.b).toBe('A');
  });

  it('repairs \\rightleftharpoons (chemistry equilibrium, \\r head, extras list)', () => {
    const input = '{"latex":"N_2 + 3H_2 \\rightleftharpoons 2NH_3"}';
    const decoded = JSON.parse(repairIllegalJsonEscapes(input).repaired);
    expect(decoded.latex).toBe('N_2 + 3H_2 \\rightleftharpoons 2NH_3');
  });
});

describe('repairIllegalJsonEscapes — \\not (C1, NCERT Class 11 Sets)', () => {
  it('repairs under-escaped \\not\\subset inside a JSON string', () => {
    // Payload as the model emits it: {"latex":"A \not\subset B"} — the `\n`
    // head is a legal escape (arbitrated via `not`), the `\s` is illegal.
    const input = '{"latex":"A \\not\\subset B"}';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repairCount).toBe(2);
    const decoded = JSON.parse(repaired);
    expect(decoded.latex).toBe('A \\not\\subset B');
  });

  it('\\notin still resolves as notin, not not+in (alternation ordering)', () => {
    const input = '{"latex":"x \\notin A"}';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repairCount).toBe(1);
    const decoded = JSON.parse(repaired);
    expect(decoded.latex).toBe('x \\notin A');
  });

  it('word boundary: \\notime / \\notebook stay genuine newlines (no arbiter match)', () => {
    // "not" inside "notime"/"notebook" is followed by a letter → the boundary
    // rejects it; "notin" does not complete either. Preserved byte-for-byte.
    const input = '{"a":"line\\notime","b":"see\\notebook"}';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repaired).toBe(input);
    expect(repairCount).toBe(0);
    const decoded = JSON.parse(repaired);
    expect(decoded.a).toBe('line\notime');
    expect(decoded.b).toBe('see\notebook');
  });

  it('\\nu (Greek) is not shadowed by not/notin', () => {
    const input = '{"latex":"frequency \\nu = 5"}';
    const decoded = JSON.parse(repairIllegalJsonEscapes(input).repaired);
    expect(decoded.latex).toBe('frequency \\nu = 5');
  });
});

describe('repairIllegalJsonEscapes — scope and purity', () => {
  it('never touches backslashes OUTSIDE string literals', () => {
    const input = '{\\frac "a": "ok"} \\times';
    const { repaired, repairCount } = repairIllegalJsonEscapes(input);
    expect(repaired).toBe(input);
    expect(repairCount).toBe(0);
  });

  it('is idempotent', () => {
    const input = '{"text":"\\( 9 \\times 4 \\) = 36 and \\frac{1}{2}"}';
    const once = repairIllegalJsonEscapes(input);
    const twice = repairIllegalJsonEscapes(once.repaired);
    expect(twice.repaired).toBe(once.repaired);
    expect(twice.repairCount).toBe(0);
  });

  it('never throws on garbage / truncated input (trailing backslash)', () => {
    for (const junk of ['', '\\', '{"a":"x\\', 'not json \\q at all', '"unterminated \\( str']) {
      expect(() => repairIllegalJsonEscapes(junk)).not.toThrow();
    }
  });

  it('returns the input reference unchanged when there is no backslash', () => {
    const input = '{"a":"plain"}';
    expect(repairIllegalJsonEscapes(input).repaired).toBe(input);
  });
});

describe('regression — 2026-07-20 production failure shape', () => {
  // Real-world shape: first block is clean prose, block 2 carries
  // under-escaped inline math. Before the fix, JSON.parse threw at block 2 and
  // rescue salvaged ONLY block 1 (a restatement with no solution) while
  // reporting ok=true.
  const RAW =
    '{"title":"Multiplying Numbers","subject":"math","blocks":[' +
    '{"type":"paragraph","text":"Chalo, let us multiply step by step."},' +
    '{"type":"step","label":"Calculation","text":"We compute \\( 9 \\times 4 \\) = 36."},' +
    '{"type":"math","label":"Result","latex":"9 \\times 4 = 36"},' +
    '{"type":"answer","text":"The product is 36."}' +
    ']}';

  it('raw payload is NOT valid JSON (reproduces the bug premise)', () => {
    expect(() => JSON.parse(RAW)).toThrow();
  });

  it('repair makes the WHOLE envelope parse and validate — no block loss', () => {
    const { repaired, repairCount } = repairIllegalJsonEscapes(RAW);
    expect(repairCount).toBeGreaterThan(0);
    const parsed = JSON.parse(repaired);
    const result = FoxyResponseSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocks).toHaveLength(4);
      expect(result.data.blocks[1].text).toContain('\\( 9 \\times 4 \\)');
      expect(result.data.blocks[2].latex).toBe('9 \\times 4 = 36');
      expect(result.data.blocks[3].text).toBe('The product is 36.');
    }
  });

  it('rescueFromTruncatedJson now recovers the FULL envelope (repair runs before the truncation walk)', () => {
    const rescued = rescueFromTruncatedJson(RAW);
    expect(rescued).not.toBeNull();
    expect(rescued?.blocks).toHaveLength(4);
  });

  it('math in the FIRST block no longer collapses to the Tier-3 apology', () => {
    // Worst pre-fix case: the very first block carried math → rescue found NO
    // valid slice → wrapAsParagraph fell to the bilingual "answer got cut off"
    // fallback even though the model wrote a complete answer.
    const firstBlockMath =
      '{"title":"Fractions","subject":"math","blocks":[' +
      '{"type":"definition","text":"In \\( \\frac{3}{4} \\), 3 is the numerator."},' +
      '{"type":"math","latex":"\\frac{3}{4} = 0.75"}' +
      ']}';
    const wrapped = wrapAsParagraph(firstBlockMath, { subject: 'math' });
    expect(wrapped.blocks).toHaveLength(2);
    expect(wrapped.blocks[0].text).toContain('\\( \\frac{3}{4} \\)');
    expect(JSON.stringify(wrapped)).not.toContain('answer got cut off');
  });

  it('TRUE truncation still goes through rescue (repair does not mask it)', () => {
    // Cut mid-string in block 3: repair cannot fix structure; rescue must
    // salvage blocks 1-2 (both now repairable) and drop the partial tail.
    const truncated =
      '{"title":"Multiplying Numbers","subject":"math","blocks":[' +
      '{"type":"paragraph","text":"Chalo, let us multiply step by step."},' +
      '{"type":"step","text":"We compute \\( 9 \\times 4 \\) = 36."},' +
      '{"type":"math","latex":"9 \\ti';
    expect(() => JSON.parse(repairIllegalJsonEscapes(truncated).repaired)).toThrow();
    const rescued = rescueFromTruncatedJson(truncated);
    expect(rescued).not.toBeNull();
    expect(rescued?.blocks).toHaveLength(2);
    expect(rescued?.blocks[1].text).toContain('\\( 9 \\times 4 \\)');
  });
});

describe('arbiter list sanity', () => {
  it('extras are exactly the documented JSON-repair-only commands', () => {
    expect(JSON_REPAIR_EXTRA_COMMANDS).toEqual(['boxed', 'rightleftharpoons']);
  });

  it('math-command list is non-trivial and contains the incident commands', () => {
    for (const cmd of ['frac', 'times', 'neq', 'sqrt', 'pi', 'text', 'not', 'notin']) {
      expect(JSON_REPAIR_MATH_COMMANDS).toContain(cmd);
    }
  });

  it('begin is deliberately absent everywhere (deferred — see module comment)', () => {
    expect(JSON_REPAIR_MATH_COMMANDS).not.toContain('begin');
    expect(JSON_REPAIR_EXTRA_COMMANDS).not.toContain('begin');
  });
});
