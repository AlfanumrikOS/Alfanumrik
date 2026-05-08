// supabase/functions/grounded-answer/__tests__/wrap-as-paragraph.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Locks in the May-2026 production fix: wrapAsParagraph must NEVER produce
// a paragraph block whose text is JSON-shaped (the "raw JSON in chat
// bubble" regression). Also exercises rescueFromTruncatedJson and
// extractTextFieldsFromBrokenJson directly.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  extractTextFieldsFromBrokenJson,
  rescueFromTruncatedJson,
  wrapAsParagraph,
} from '../structured-schema.ts';

const validResponse = {
  title: 'Onion as Olfactory Indicator',
  subject: 'science' as const,
  blocks: [
    { type: 'paragraph' as const, text: 'An olfactory indicator changes smell with acid/base.' },
    { type: 'step' as const, label: 'Step 1', text: 'Take a fresh onion bulb.' },
    { type: 'step' as const, label: 'Step 2', text: 'Add base solution to one tube.' },
    { type: 'answer' as const, text: 'Onion smell disappears in base, persists in acid.' },
  ],
};

// ── wrapAsParagraph: NEVER leak JSON ─────────────────────────────────────

Deno.test('wrapAsParagraph: rescues truncated JSON instead of leaking it', () => {
  // Simulate the prod regression: Haiku emitted valid JSON but max_tokens
  // cut after the 3rd block, leaving an unclosed array.
  const truncated =
    '{"title":"Onion as Olfactory Indicator","subject":"science","blocks":[' +
    '{"type":"paragraph","text":"An olfactory indicator changes smell."},' +
    '{"type":"step","label":"Step 1","text":"Take a fresh onion bulb."},' +
    '{"type":"step","label":"Step 2","text":"Observe';

  const result = wrapAsParagraph(truncated);

  // Must not contain raw JSON syntax in any block text
  for (const block of result.blocks) {
    if (block.type === 'paragraph' && block.text) {
      assertFalse(block.text.startsWith('{'), `block.text leaks JSON: ${block.text.slice(0, 80)}`);
      assertFalse(block.text.includes('"blocks"'), 'block.text contains JSON keys');
      assertFalse(block.text.includes('"title":'), 'block.text contains JSON keys');
    }
  }

  // Must have recovered the 2 complete blocks
  assert(result.blocks.length >= 2, `expected >= 2 rescued blocks, got ${result.blocks.length}`);
});

Deno.test('wrapAsParagraph: rescues fenced ```json with truncation', () => {
  const fenced =
    '```json\n' +
    '{"title":"Test","subject":"science","blocks":[' +
    '{"type":"paragraph","text":"Complete block."},' +
    '{"type":"paragraph","text":"Truncated';

  const result = wrapAsParagraph(fenced);

  assertFalse(
    result.blocks[0].text!.includes('```'),
    'rescued blocks must not contain markdown fences',
  );
  assertFalse(
    result.blocks[0].text!.startsWith('{'),
    'rescued blocks must not contain raw JSON',
  );
});

Deno.test('wrapAsParagraph: extracts text fields from severely broken JSON', () => {
  // Truncation cut INSIDE a string — rescueFromTruncatedJson can't help,
  // but extractTextFieldsFromBrokenJson should pull the human content.
  const broken =
    '{"title":"Q","subject":"science","blocks":[' +
    '{"type":"paragraph","text":"First sentence here."},' +
    '{"type":"paragraph","text":"Second sentence here."},' +
    '{"type":"paragraph","text":"Third sentence cut off mid';

  const result = wrapAsParagraph(broken);

  // No JSON syntax should leak
  for (const block of result.blocks) {
    assertFalse(block.text!.startsWith('{'));
    assertFalse(block.text!.includes('"text":'));
  }
  // Should have recovered at least the first 2 complete sentences
  const allText = result.blocks.map((b) => b.text).join(' ');
  assertStringIncludes(allText, 'First sentence here.');
  assertStringIncludes(allText, 'Second sentence here.');
});

Deno.test('wrapAsParagraph: friendly fallback when nothing can be recovered', () => {
  // Total garbage that still smells like JSON (starts with `{`)
  const garbage = '{this is not really json {{{ broken';
  const result = wrapAsParagraph(garbage);

  assertEquals(result.blocks.length, 1);
  const text = result.blocks[0].text!;
  assertFalse(text.startsWith('{'), 'fallback must not be raw JSON');
  // Bilingual fallback message — both languages present so EN + HI students
  // get a coherent error.
  assertStringIncludes(text.toLowerCase(), 'cut off');
  assertStringIncludes(text.toLowerCase(), 'sawal');
});

Deno.test('wrapAsParagraph: legacy prose path still works (paragraph splitting)', () => {
  // Genuine prose input — not JSON-shaped. Must use the legacy split-on-blank-lines path.
  const prose =
    'First paragraph about photosynthesis.\n\n' +
    'Second paragraph about chlorophyll.\n\n' +
    'Third paragraph about light absorption.';

  const result = wrapAsParagraph(prose);

  assertEquals(result.blocks.length, 3);
  assertEquals(result.blocks[0].text, 'First paragraph about photosynthesis.');
  assertEquals(result.blocks[2].text, 'Third paragraph about light absorption.');
});

Deno.test('wrapAsParagraph: empty input returns the "taking a break" message', () => {
  const result = wrapAsParagraph('');
  assertEquals(result.blocks.length, 1);
  assertStringIncludes(result.blocks[0].text!, 'short break');
});

Deno.test('wrapAsParagraph: subject hint is preserved on rescue', () => {
  const truncated =
    '{"title":"Test","subject":"general","blocks":[' +
    '{"type":"paragraph","text":"Complete block."},' +
    '{"type":"paragraph","text":"Truncated';

  const result = wrapAsParagraph(truncated, { subject: 'science' });
  assertEquals(result.subject, 'science');
});

// ── rescueFromTruncatedJson direct tests ─────────────────────────────────

Deno.test('rescueFromTruncatedJson: returns intact response unchanged', () => {
  const intact = JSON.stringify(validResponse);
  const result = rescueFromTruncatedJson(intact);
  assert(result !== null);
  assertEquals(result!.title, validResponse.title);
  assertEquals(result!.blocks.length, 4);
});

Deno.test('rescueFromTruncatedJson: trims trailing partial block', () => {
  const partial =
    '{"title":"T","subject":"science","blocks":[' +
    '{"type":"paragraph","text":"Complete one."},' +
    '{"type":"paragraph","text":"Complete two."},' +
    '{"type":"paragraph","text":"In progres';

  const result = rescueFromTruncatedJson(partial);
  assert(result !== null, 'rescue should succeed');
  assertEquals(result!.blocks.length, 2, 'should recover 2 complete blocks');
});

Deno.test('rescueFromTruncatedJson: returns null for non-JSON input', () => {
  assertEquals(rescueFromTruncatedJson('hello world'), null);
  assertEquals(rescueFromTruncatedJson(''), null);
});

Deno.test('rescueFromTruncatedJson: handles ```json fence with truncation', () => {
  const fenced =
    '```json\n{"title":"T","subject":"science","blocks":[' +
    '{"type":"paragraph","text":"Complete one."},' +
    '{"type":"paragraph","text":"Cut';

  const result = rescueFromTruncatedJson(fenced);
  assert(result !== null);
  assertEquals(result!.blocks.length, 1);
});

Deno.test('rescueFromTruncatedJson: returns null when no slice validates', () => {
  // Schema-invalid (missing required fields) — rescue must NOT downgrade
  // validation just to recover something.
  const bad = '{"title":"x"';
  assertEquals(rescueFromTruncatedJson(bad), null);
});

// ── extractTextFieldsFromBrokenJson direct tests ─────────────────────────

Deno.test('extractTextFieldsFromBrokenJson: pulls all text fields in order', () => {
  const broken =
    '{"blocks":[' +
    '{"type":"paragraph","text":"First."},' +
    '{"type":"step","text":"Second."},' +
    '{"type":"answer","text":"Third';

  const fields = extractTextFieldsFromBrokenJson(broken);
  assertEquals(fields, ['First.', 'Second.']);
});

Deno.test('extractTextFieldsFromBrokenJson: decodes JSON escapes', () => {
  const input = '{"blocks":[{"text":"Line one\\nLine two"}]}';
  const fields = extractTextFieldsFromBrokenJson(input);
  assertEquals(fields, ['Line one\nLine two']);
});

Deno.test('extractTextFieldsFromBrokenJson: skips empty/whitespace-only values', () => {
  const input = '{"blocks":[{"text":"   "},{"text":"Real content."}]}';
  const fields = extractTextFieldsFromBrokenJson(input);
  assertEquals(fields, ['Real content.']);
});

Deno.test('extractTextFieldsFromBrokenJson: returns empty array for non-string input', () => {
  // @ts-expect-error: testing runtime guard
  assertEquals(extractTextFieldsFromBrokenJson(null), []);
  assertEquals(extractTextFieldsFromBrokenJson(''), []);
});
