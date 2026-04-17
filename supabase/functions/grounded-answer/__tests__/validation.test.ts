// supabase/functions/grounded-answer/__tests__/validation.test.ts
// Deno test runner (not Vitest). Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies the request validator rejects malformed inputs with a specific
// field error, and accepts a fully-formed request.

import { assertEquals, assertExists } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { validateRequest } from '../validators.ts';

function validRequest() {
  return {
    caller: 'foxy',
    student_id: null,
    query: 'What is photosynthesis?',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 6,
      chapter_title: 'Life Processes',
    },
    mode: 'soft',
    generation: {
      model_preference: 'auto',
      max_tokens: 1024,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: { match_count: 5 },
    timeout_ms: 20000,
  };
}

Deno.test('rejects missing caller', () => {
  const { error } = validateRequest({
    student_id: 'x',
    query: 'q',
    scope: { grade: '10' },
    // deno-lint-ignore no-explicit-any
  } as any);
  assertExists(error);
  assertEquals(error!.field, 'caller');
});

Deno.test('rejects unknown caller', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body as any).caller = 'bogus';
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'caller');
});

Deno.test('rejects invalid grade', () => {
  const body = validRequest();
  body.scope.grade = '5';
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'scope.grade');
});

Deno.test('rejects integer grade (invariant P5 — grades are strings)', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body.scope as any).grade = 10;
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'scope.grade');
});

Deno.test('rejects non-CBSE board', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body.scope as any).board = 'ICSE';
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'scope.board');
});

Deno.test('rejects empty query', () => {
  const body = validRequest();
  body.query = '   ';
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'query');
});

Deno.test('rejects unknown prompt template', () => {
  const body = validRequest();
  body.generation.system_prompt_template = 'definitely_not_registered_v9';
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'generation.system_prompt_template');
});

Deno.test('rejects timeout below lower bound', () => {
  const body = validRequest();
  body.timeout_ms = 500;
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'timeout_ms');
});

Deno.test('rejects timeout above upper bound', () => {
  const body = validRequest();
  body.timeout_ms = 200_000;
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'timeout_ms');
});

Deno.test('rejects temperature above 1', () => {
  const body = validRequest();
  body.generation.temperature = 1.5;
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'generation.temperature');
});

Deno.test('rejects match_count out of range', () => {
  const body = validRequest();
  body.retrieval.match_count = 0;
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'retrieval.match_count');
});

Deno.test('rejects invalid model_preference', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body.generation as any).model_preference = 'gpt4';
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'generation.model_preference');
});

Deno.test('rejects non-object body', () => {
  const { error } = validateRequest(null);
  assertExists(error);
  assertEquals(error!.field, 'body');
});

Deno.test('accepts a valid request', () => {
  const { error, request } = validateRequest(validRequest());
  assertEquals(error, null);
  assertExists(request);
  assertEquals(request!.caller, 'foxy');
  assertEquals(request!.scope.grade, '10');
});

Deno.test('accepts null chapter_number (subject-wide query)', () => {
  const body = validRequest();
  body.scope.chapter_number = null;
  body.scope.chapter_title = null;
  const { error, request } = validateRequest(body);
  assertEquals(error, null);
  assertExists(request);
  assertEquals(request!.scope.chapter_number, null);
});

Deno.test('accepts retrieve_only flag', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body as any).retrieve_only = true;
  const { error, request } = validateRequest(body);
  assertEquals(error, null);
  assertEquals(request!.retrieve_only, true);
});

Deno.test('accepts min_similarity_override within range', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body.retrieval as any).min_similarity_override = 0.6;
  const { error } = validateRequest(body);
  assertEquals(error, null);
});

Deno.test('rejects min_similarity_override out of range', () => {
  const body = validRequest();
  // deno-lint-ignore no-explicit-any
  (body.retrieval as any).min_similarity_override = 1.5;
  const { error } = validateRequest(body);
  assertExists(error);
  assertEquals(error!.field, 'retrieval.min_similarity_override');
});