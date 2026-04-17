// supabase/functions/grounded-answer/validators.ts
// Request validation for the grounded-answer Edge Function.
// Single responsibility: reject malformed requests with a specific field error
// so callers (and the trace log) can pinpoint what was wrong. No I/O here.

import { VALID_CALLERS, REGISTERED_PROMPT_TEMPLATES } from './config.ts';
import type { GroundedRequest } from './types.ts';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_MODES = ['strict', 'soft'];
const VALID_MODEL_PREFERENCES = ['haiku', 'sonnet', 'auto'];

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  error: ValidationError | null;
  request?: GroundedRequest;
}

export function validateRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { error: { field: 'body', message: 'not an object' } };
  }

  // deno-lint-ignore no-explicit-any
  const b = body as any;

  if (!b.caller || !VALID_CALLERS.includes(b.caller)) {
    return { error: { field: 'caller', message: 'invalid' } };
  }

  if (b.student_id !== null && typeof b.student_id !== 'string') {
    return { error: { field: 'student_id', message: 'must be string or null' } };
  }

  if (typeof b.query !== 'string' || b.query.trim() === '') {
    return { error: { field: 'query', message: 'required' } };
  }

  if (!b.scope || typeof b.scope !== 'object') {
    return { error: { field: 'scope', message: 'required' } };
  }
  if (b.scope.board !== 'CBSE') {
    return { error: { field: 'scope.board', message: 'must be CBSE' } };
  }
  if (!VALID_GRADES.includes(b.scope.grade)) {
    return { error: { field: 'scope.grade', message: 'invalid' } };
  }
  if (typeof b.scope.subject_code !== 'string' || b.scope.subject_code.trim() === '') {
    return { error: { field: 'scope.subject_code', message: 'required' } };
  }
  if (
    b.scope.chapter_number !== null &&
    (typeof b.scope.chapter_number !== 'number' || !Number.isInteger(b.scope.chapter_number))
  ) {
    return { error: { field: 'scope.chapter_number', message: 'must be integer or null' } };
  }
  if (b.scope.chapter_title !== null && typeof b.scope.chapter_title !== 'string') {
    return { error: { field: 'scope.chapter_title', message: 'must be string or null' } };
  }

  if (!VALID_MODES.includes(b.mode)) {
    return { error: { field: 'mode', message: 'invalid' } };
  }

  if (!b.generation || typeof b.generation !== 'object') {
    return { error: { field: 'generation', message: 'required' } };
  }
  if (!VALID_MODEL_PREFERENCES.includes(b.generation.model_preference)) {
    return { error: { field: 'generation.model_preference', message: 'invalid' } };
  }
  if (
    typeof b.generation.max_tokens !== 'number' ||
    b.generation.max_tokens < 1 ||
    b.generation.max_tokens > 8192
  ) {
    return { error: { field: 'generation.max_tokens', message: 'out of range [1, 8192]' } };
  }
  if (
    typeof b.generation.temperature !== 'number' ||
    b.generation.temperature < 0 ||
    b.generation.temperature > 1
  ) {
    return { error: { field: 'generation.temperature', message: 'out of range [0, 1]' } };
  }
  if (
    !b.generation.system_prompt_template ||
    !REGISTERED_PROMPT_TEMPLATES.includes(b.generation.system_prompt_template)
  ) {
    return {
      error: { field: 'generation.system_prompt_template', message: 'unknown template' },
    };
  }
  if (
    !b.generation.template_variables ||
    typeof b.generation.template_variables !== 'object'
  ) {
    return { error: { field: 'generation.template_variables', message: 'required object' } };
  }

  if (!b.retrieval || typeof b.retrieval !== 'object') {
    return { error: { field: 'retrieval', message: 'required' } };
  }
  if (
    typeof b.retrieval.match_count !== 'number' ||
    b.retrieval.match_count < 1 ||
    b.retrieval.match_count > 20
  ) {
    return { error: { field: 'retrieval.match_count', message: 'out of range [1, 20]' } };
  }
  if (
    b.retrieval.min_similarity_override !== undefined &&
    (typeof b.retrieval.min_similarity_override !== 'number' ||
      b.retrieval.min_similarity_override < 0 ||
      b.retrieval.min_similarity_override > 1)
  ) {
    return {
      error: { field: 'retrieval.min_similarity_override', message: 'out of range [0, 1]' },
    };
  }

  if (b.retrieve_only !== undefined && typeof b.retrieve_only !== 'boolean') {
    return { error: { field: 'retrieve_only', message: 'must be boolean' } };
  }

  if (typeof b.timeout_ms !== 'number' || b.timeout_ms < 1000 || b.timeout_ms > 120000) {
    return { error: { field: 'timeout_ms', message: 'out of range [1000, 120000]' } };
  }

  return { error: null, request: b as GroundedRequest };
}