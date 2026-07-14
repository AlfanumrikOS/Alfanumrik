import { describe, it, expect } from 'vitest';
import {
  coerceBloom,
  coerceMisconception,
  coerceStruggle,
  coerceIntent,
} from '@alfanumrik/lib/foxy/perception';

/**
 * Foxy Perception (Phase 1C) — coercion PARITY pin (Condition 2).
 *
 * The perception classifier validates the model output TWICE (defence-in-depth):
 *   - Python: `_coerce` in python/services/ai/business/foxy_perception/classifier.py
 *   - TS:     coerceBloom / coerceMisconception / coerceStruggle / coerceIntent
 *             in packages/lib/src/foxy/perception.ts
 *
 * If the two layers ever drift, one language could emit an enum/code the other
 * would have dropped. This suite pins the TS half against the EXACT shapes the
 * Python `test_coerce_*` tests assert (python/tests/unit/
 * test_foxy_perception_classifier.py) so any drift on the TS side fails here and
 * the Python side is guarded by its mirror tests. Each row below is annotated
 * with its Python counterpart; keep the two in lock-step.
 *
 * A note on the regex `$` divergence: JS `$` (no /m) does NOT match before a
 * trailing "\n", while Python `re.match(..., "$")` DOES — but BOTH coercers strip
 * the input before the regex runs, so a trailing newline is gone before matching.
 * The `'sign_error\n' → 'sign_error'` row pins that strip-then-match order.
 */

describe('coerceBloom — parity with Python _coerce (bloom_level)', () => {
  // test_coerce_normalizes_bloom_to_lowercase
  it('normalizes a valid verb to lowercase', () => {
    expect(coerceBloom('APPLY')).toBe('apply');
    expect(coerceBloom('  Understand  ')).toBe('understand');
  });
  // test_coerce_drops_unknown_bloom
  it('drops an unknown verb to null', () => {
    expect(coerceBloom('synthesize')).toBeNull();
  });
  // isinstance(bloom, str) guard
  it('drops a non-string to null', () => {
    expect(coerceBloom(123)).toBeNull();
    expect(coerceBloom(undefined)).toBeNull();
    expect(coerceBloom(null)).toBeNull();
  });
});

describe('coerceMisconception — parity with Python _coerce (misconception_code)', () => {
  // test_coerce_keeps_valid_misconception_code
  it('keeps a valid ontology code', () => {
    expect(coerceMisconception('sign_error')).toBe('sign_error');
  });
  // strip-then-match: trailing newline is stripped before the regex on BOTH sides
  it('keeps a valid code after stripping surrounding whitespace/newline', () => {
    expect(coerceMisconception('sign_error\n')).toBe('sign_error');
    expect(coerceMisconception('  sign_error  ')).toBe('sign_error');
  });
  // test_coerce_drops_free_text_misconception
  it('drops free-text (space-bearing / uppercase-leading) codes to null', () => {
    expect(coerceMisconception('The student thinks minus minus is minus')).toBeNull();
    expect(coerceMisconception('Sign_Error')).toBeNull(); // leading uppercase fails ^[a-z]
  });
  // test_coerce_drops_none_string_misconception
  it('drops the sentinel strings and empties to null', () => {
    expect(coerceMisconception('none')).toBeNull();
    expect(coerceMisconception('NONE')).toBeNull();
    expect(coerceMisconception('null')).toBeNull();
    expect(coerceMisconception('')).toBeNull();
  });
  // isinstance(mis, str) guard
  it('drops a non-string to null', () => {
    expect(coerceMisconception(42)).toBeNull();
    expect(coerceMisconception(undefined)).toBeNull();
  });
});

describe('coerceStruggle — parity with Python _coerce (struggle_signal)', () => {
  // test_coerce_unknown_struggle_becomes_none
  it('maps an unknown signal to none', () => {
    expect(coerceStruggle('panicking')).toBe('none');
  });
  // test_coerce_valid_struggle_kept
  it('keeps a valid signal (case-insensitively)', () => {
    expect(coerceStruggle('repeated_wrong')).toBe('repeated_wrong');
    expect(coerceStruggle('REPEATED_WRONG')).toBe('repeated_wrong');
  });
  // isinstance(struggle, str) guard → 'none'
  it('maps a non-string / missing to none', () => {
    expect(coerceStruggle(1)).toBe('none');
    expect(coerceStruggle(undefined)).toBe('none');
  });
});

describe('coerceIntent — parity with Python _coerce (intent)', () => {
  // test_coerce_intent_snake_cased_and_bounded
  it('snake_cases and lowercases a spaced label', () => {
    expect(coerceIntent('  Check The Answer  ')).toBe('check_the_answer');
  });
  // test_coerce_empty_intent_defaults_unknown
  it('defaults empty / missing / non-string to unknown', () => {
    expect(coerceIntent('')).toBe('unknown');
    expect(coerceIntent('   ')).toBe('unknown');
    expect(coerceIntent(undefined)).toBe('unknown');
    expect(coerceIntent(123)).toBe('unknown');
  });
  // bounded to 64 chars (TS slice / Python t[:64]) AFTER the whitespace→_ replace
  it('bounds the label to 64 characters after normalization', () => {
    const long = `${'a'.repeat(40)} ${'b'.repeat(40)}`; // 81 chars → "aaa…_bbb…"
    const out = coerceIntent(long);
    expect(out.length).toBe(64);
    expect(out.startsWith(`${'a'.repeat(40)}_`)).toBe(true);
  });
});
