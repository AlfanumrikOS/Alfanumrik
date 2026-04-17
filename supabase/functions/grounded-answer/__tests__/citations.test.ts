// supabase/functions/grounded-answer/__tests__/citations.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies [N] reference parsing:
//   - matching refs resolve to chunk metadata
//   - out-of-range refs are silently skipped
//   - duplicate refs collapse to one Citation
//   - excerpt truncates to 200 chars

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { extractCitations } from '../citations.ts';
import type { RetrievedChunk } from '../retrieval.ts';

function buildChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    content: 'Photosynthesis converts sunlight into chemical energy.',
    chapter_number: 1,
    chapter_title: 'Life Processes',
    page_number: 12,
    similarity: 0.88,
    media_url: null,
    media_description: null,
    ...overrides,
  };
}

Deno.test('answer with [1] and [2] + 3 chunks → 2 citations', () => {
  const chunks = [
    buildChunk({ id: 'c1', chapter_number: 1, chapter_title: 'Ch One' }),
    buildChunk({ id: 'c2', chapter_number: 2, chapter_title: 'Ch Two' }),
    buildChunk({ id: 'c3', chapter_number: 3, chapter_title: 'Ch Three' }),
  ];
  const answer = 'Photosynthesis [1] requires sunlight [2] to occur.';
  const citations = extractCitations(answer, chunks);
  assertEquals(citations.length, 2);
  assertEquals(citations[0].index, 1);
  assertEquals(citations[0].chunk_id, 'c1');
  assertEquals(citations[1].index, 2);
  assertEquals(citations[1].chunk_id, 'c2');
});

Deno.test('answer with [4] but only 3 chunks → out-of-range skipped', () => {
  const chunks = [
    buildChunk({ id: 'c1' }),
    buildChunk({ id: 'c2' }),
    buildChunk({ id: 'c3' }),
  ];
  const answer = 'First fact [1]. Second fact [4].';
  const citations = extractCitations(answer, chunks);
  assertEquals(citations.length, 1);
  assertEquals(citations[0].index, 1);
});

Deno.test('duplicate refs [1] [1] → one citation with index 1', () => {
  const chunks = [buildChunk({ id: 'c1' })];
  const answer = 'Fact one [1] and fact one again [1].';
  const citations = extractCitations(answer, chunks);
  assertEquals(citations.length, 1);
  assertEquals(citations[0].index, 1);
});

Deno.test('excerpt truncates to 200 chars with ellipsis', () => {
  const longContent = 'A'.repeat(500);
  const chunks = [buildChunk({ id: 'c1', content: longContent })];
  const answer = 'See [1].';
  const citations = extractCitations(answer, chunks);
  assertEquals(citations.length, 1);
  // 200 chars of content + ellipsis
  assertEquals(citations[0].excerpt.length, 201);
  assertEquals(citations[0].excerpt.endsWith('…'), true);
});

Deno.test('excerpt under 200 chars is returned verbatim (no ellipsis)', () => {
  const chunks = [buildChunk({ id: 'c1', content: 'Short content.' })];
  const answer = 'See [1].';
  const citations = extractCitations(answer, chunks);
  assertEquals(citations[0].excerpt, 'Short content.');
  assertEquals(citations[0].excerpt.includes('…'), false);
});

Deno.test('empty answer → no citations', () => {
  const chunks = [buildChunk({ id: 'c1' })];
  assertEquals(extractCitations('', chunks).length, 0);
});

Deno.test('empty chunks → no citations even if refs exist', () => {
  assertEquals(extractCitations('See [1] [2] [3].', []).length, 0);
});

Deno.test('answer with no [N] refs → no citations', () => {
  const chunks = [buildChunk({ id: 'c1' })];
  assertEquals(extractCitations('No citations here.', chunks).length, 0);
});

Deno.test('ref order in output follows first-occurrence order in answer', () => {
  const chunks = [
    buildChunk({ id: 'c1' }),
    buildChunk({ id: 'c2' }),
    buildChunk({ id: 'c3' }),
  ];
  // [3] appears before [1] in the text — output should reflect reading order.
  const answer = 'Point three [3]. Point one [1]. Point two [2].';
  const citations = extractCitations(answer, chunks);
  assertEquals(citations.length, 3);
  assertEquals(citations[0].index, 3);
  assertEquals(citations[1].index, 1);
  assertEquals(citations[2].index, 2);
});

Deno.test('citation carries chapter + page + media metadata', () => {
  const chunks = [
    buildChunk({
      id: 'c-xyz',
      content: 'Plants produce oxygen as a byproduct.',
      chapter_number: 6,
      chapter_title: 'Life Processes',
      page_number: 103,
      similarity: 0.91,
      media_url: 'https://cdn.example/ch6-fig1.png',
    }),
  ];
  const [citation] = extractCitations('Plants release oxygen [1].', chunks);
  assertEquals(citation.chunk_id, 'c-xyz');
  assertEquals(citation.chapter_number, 6);
  assertEquals(citation.chapter_title, 'Life Processes');
  assertEquals(citation.page_number, 103);
  assertEquals(citation.similarity, 0.91);
  assertEquals(citation.media_url, 'https://cdn.example/ch6-fig1.png');
});

Deno.test('[0] is not a valid 1-indexed reference', () => {
  // Defensive: defend against a model emitting "[0]" which would break
  // 1-indexed addressing (and chunks[-1] via the arithmetic would wrap
  // in JS, pointing to… nothing sane). Drop it.
  const chunks = [buildChunk({ id: 'c1' })];
  const citations = extractCitations('See [0].', chunks);
  assertEquals(citations.length, 0);
});