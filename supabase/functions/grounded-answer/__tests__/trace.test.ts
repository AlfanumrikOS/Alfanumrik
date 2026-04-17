// supabase/functions/grounded-answer/__tests__/trace.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Covers the privacy-critical helpers in trace.ts:
//   - normalizeQuery: whitespace + case canonicalization
//   - hashQuery: deterministic sha256:<hex> output, insensitive to case
//   - redactPreview: 200-char cap + email/phone/token stripping (P13)
//   - writeTrace: returns inserted id on success; placeholder on failure

import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  hashQuery,
  normalizeQuery,
  redactPreview,
  writeTrace,
  type TraceRow,
} from '../trace.ts';

function baseRow(): TraceRow {
  return {
    caller: 'foxy',
    student_id: null,
    grade: '10',
    subject_code: 'science',
    chapter_number: 1,
    query_hash: 'sha256:deadbeef',
    query_preview: 'test',
    embedding_model: 'voyage-3',
    retrieved_chunk_ids: [],
    top_similarity: 0.9,
    chunk_count: 3,
    claude_model: null,
    prompt_template_id: 'foxy_tutor_v1',
    prompt_hash: null,
    grounded: true,
    abstain_reason: null,
    confidence: 0.8,
    answer_length: 100,
    input_tokens: 50,
    output_tokens: 60,
    latency_ms: 1234,
    client_reported_issue_id: null,
  };
}

Deno.test('normalizeQuery lowercases + collapses whitespace', () => {
  assertEquals(normalizeQuery('  Hello   World  '), 'hello world');
  assertEquals(normalizeQuery('WHAT IS\n\tphotosynthesis?'), 'what is photosynthesis?');
});

Deno.test('normalizeQuery handles empty/whitespace-only', () => {
  assertEquals(normalizeQuery(''), '');
  assertEquals(normalizeQuery('   '), '');
});

Deno.test('hashQuery is deterministic across case + whitespace variations', async () => {
  const a = await hashQuery('What is Photosynthesis?');
  const b = await hashQuery('  what is photosynthesis?  ');
  assertEquals(a, b);
  // Format: sha256:<64 hex chars>
  assert(a.startsWith('sha256:'));
  assertEquals(a.length, 'sha256:'.length + 64);
});

Deno.test('hashQuery differs for different queries', async () => {
  const a = await hashQuery('photosynthesis');
  const b = await hashQuery('respiration');
  assertNotEquals(a, b);
});

Deno.test('redactPreview caps at 200 chars', () => {
  const long = 'a'.repeat(500);
  assertEquals(redactPreview(long).length, 200);
});

Deno.test('redactPreview strips emails', () => {
  const out = redactPreview('contact me at student@example.com about the quiz');
  assert(!out.includes('student@example.com'));
  assert(out.includes('[email]'));
});

Deno.test('redactPreview strips phone numbers', () => {
  const out = redactPreview('call +91 98765 43210 for help');
  assert(!out.includes('98765 43210'));
  assert(out.includes('[phone]'));
});

Deno.test('redactPreview strips token-like strings', () => {
  const out = redactPreview('my api key is sk-ant-1234567890abcdefGHIJKLmnopqrst');
  assert(out.includes('[token]'));
  assert(!out.includes('sk-ant-1234567890abcdefGHIJKL'));
});

Deno.test('redactPreview leaves normal academic text alone', () => {
  const q = 'What is the difference between photosynthesis and respiration?';
  assertEquals(redactPreview(q), q);
});

Deno.test('writeTrace returns inserted id on success', async () => {
  const stub = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: () =>
                  Promise.resolve({
                    data: { id: '11111111-2222-3333-4444-555555555555' },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  };
  const id = await writeTrace(stub, baseRow());
  assertEquals(id, '11111111-2222-3333-4444-555555555555');
});

Deno.test('writeTrace returns placeholder uuid on DB error (never throws)', async () => {
  const stub = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: 'network down' },
                  }),
              };
            },
          };
        },
      };
    },
  };
  const id = await writeTrace(stub, baseRow());
  // Placeholder is a v4-shaped string with leading zero block.
  assert(id.startsWith('00000000-'));
  assertEquals(id.length, 36);
});

Deno.test('writeTrace returns placeholder uuid when insert throws', async () => {
  const stub = {
    from() {
      return {
        insert() {
          throw new Error('boom');
        },
      };
    },
  };
  const id = await writeTrace(stub, baseRow());
  assert(id.startsWith('00000000-'));
});