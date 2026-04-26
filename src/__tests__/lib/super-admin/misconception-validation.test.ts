/**
 * Unit tests for src/lib/super-admin/misconception-validation.ts
 * Locks down the input contract for the misconception curator API.
 *
 * Why this matters (Phase 3 moat plan):
 *   The /api/super-admin/misconceptions endpoint is the editorial team's
 *   only write path into question_misconceptions. A bad input contract
 *   causes either silently-ignored field drift (e.g. unicode-only labels
 *   that pass as "string" but break Foxy rendering) or curator fatigue
 *   from cryptic 500s. These tests pin the boundary so any future
 *   loosening shows up here first.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCuratePayload,
  MISCONCEPTION_CODE_REGEX,
  VALIDATION_ERRORS,
} from '@/lib/super-admin/misconception-validation';

const validBase = () => ({
  question_id: '00000000-0000-0000-0000-000000000001',
  distractor_index: 2,
  misconception_code: 'confuses_mass_with_weight',
  misconception_label: 'Student treats mass and weight as the same quantity.',
});

describe('validateCuratePayload — happy paths', () => {
  it('accepts a minimal valid payload', () => {
    const v = validateCuratePayload(validBase());
    expect(typeof v).toBe('object');
    if (typeof v !== 'object') return;
    expect(v.misconception_code).toBe('confuses_mass_with_weight');
    expect(v.distractor_index).toBe(2);
  });

  it('trims label whitespace', () => {
    const v = validateCuratePayload({
      ...validBase(),
      misconception_label: '   Student error.   ',
    });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.misconception_label).toBe('Student error.');
  });

  it('accepts optional Hindi label', () => {
    const v = validateCuratePayload({
      ...validBase(),
      misconception_label_hi: 'द्रव्यमान और भार में भ्रम',
    });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.misconception_label_hi).toBe('द्रव्यमान और भार में भ्रम');
  });

  it('passes through optional remediation pointers', () => {
    const v = validateCuratePayload({
      ...validBase(),
      remediation_chunk_id: 'chunk-uuid-1',
      remediation_concept_id: 'concept-uuid-1',
    });
    if (typeof v !== 'object') throw new Error('expected object');
    expect(v.remediation_chunk_id).toBe('chunk-uuid-1');
    expect(v.remediation_concept_id).toBe('concept-uuid-1');
  });
});

describe('validateCuratePayload — rejection cases', () => {
  it('rejects null body', () => {
    expect(validateCuratePayload(null)).toBe('body_not_object');
    expect(validateCuratePayload(undefined)).toBe('body_not_object');
    expect(validateCuratePayload('string body')).toBe('body_not_object');
  });

  it('rejects short / missing question_id', () => {
    expect(validateCuratePayload({ ...validBase(), question_id: '' })).toBe('question_id_invalid');
    expect(validateCuratePayload({ ...validBase(), question_id: 'short' })).toBe('question_id_invalid');
    expect(validateCuratePayload({ ...validBase(), question_id: 123 })).toBe('question_id_invalid');
  });

  it('rejects out-of-range distractor_index', () => {
    expect(validateCuratePayload({ ...validBase(), distractor_index: -1 })).toBe('distractor_index_invalid');
    expect(validateCuratePayload({ ...validBase(), distractor_index: 4 })).toBe('distractor_index_invalid');
    expect(validateCuratePayload({ ...validBase(), distractor_index: 1.5 })).toBe('distractor_index_invalid');
    expect(validateCuratePayload({ ...validBase(), distractor_index: '2' })).toBe('distractor_index_invalid');
  });

  it('rejects malformed misconception_code', () => {
    const cases = [
      'Bad-Caps',           // capitals
      'starts_with_number',  // (this passes — starts with letter)
      '99_digits_first',     // starts with digit
      'sp ace',              // space
      'sym!ol',              // disallowed punct
      'a',                   // too short
      '',                    // empty
    ];
    expect(validateCuratePayload({ ...validBase(), misconception_code: cases[0] })).toBe('misconception_code_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_code: cases[2] })).toBe('misconception_code_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_code: cases[3] })).toBe('misconception_code_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_code: cases[4] })).toBe('misconception_code_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_code: cases[5] })).toBe('misconception_code_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_code: cases[6] })).toBe('misconception_code_invalid');
  });

  it('rejects too-short or too-long labels', () => {
    expect(validateCuratePayload({ ...validBase(), misconception_label: 'abcd' })).toBe('misconception_label_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_label: 'a'.repeat(201) })).toBe('misconception_label_invalid');
  });

  it('rejects non-string Hindi label', () => {
    expect(validateCuratePayload({ ...validBase(), misconception_label_hi: 123 })).toBe('misconception_label_hi_invalid');
    expect(validateCuratePayload({ ...validBase(), misconception_label_hi: 'a'.repeat(201) })).toBe('misconception_label_hi_invalid');
  });
});

describe('VALIDATION_ERRORS / MISCONCEPTION_CODE_REGEX exports', () => {
  it('exposes the error code constants for cross-module assertions', () => {
    expect(VALIDATION_ERRORS).toContain('body_not_object');
    expect(VALIDATION_ERRORS).toContain('misconception_code_invalid');
    expect(VALIDATION_ERRORS.length).toBe(6);
  });

  it('regex accepts canonical codes', () => {
    expect(MISCONCEPTION_CODE_REGEX.test('confuses_mass_with_weight')).toBe(true);
    expect(MISCONCEPTION_CODE_REGEX.test('off-by-one')).toBe(true);
    expect(MISCONCEPTION_CODE_REGEX.test('a23')).toBe(true);
  });
});
