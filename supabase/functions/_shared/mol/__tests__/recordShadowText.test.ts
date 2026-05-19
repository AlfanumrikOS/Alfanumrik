// supabase/functions/_shared/mol/__tests__/recordShadowText.test.ts
//
// C4.2b-ii (2026-05-20) — unit tests for the recordShadowText helper.
//
// recordShadowText:
//   1. PII-redacts all five text fields BEFORE insert.
//   2. Aggregates the redaction labels from every redacted field, dedupes,
//      sorts them, persists the result to redaction_applied[].
//   3. Inserts one row into mol_shadow_text_buffer via the service-role
//      supabase client. Fire-and-forget; never throws.
//   4. Handles shadow_system_prompt=null (the C4.2a prompt-parity default).
//
// Mocking strategy: vi.mock the supabase client constructor so we can
// inspect what .from('mol_shadow_text_buffer').insert(...) receives.

// @ts-ignore — stub Deno before module import; telemetry.ts reads Deno.env
// at load time.
globalThis.Deno = { env: { get: (_k: string) => '' } };

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the insert payload via a spy that the mocked supabase client uses.
const insertSpy = vi.fn(async (_row: Record<string, unknown>) => ({
  data: null,
  error: null,
}));

// Mock supabase-js so client().from('mol_shadow_text_buffer').insert(...)
// routes to our spy. The shape mirrors the real chain enough for the
// helper's single-shot insert.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => {
  return {
    createClient: () => ({
      from: (_table: string) => ({
        insert: (row: Record<string, unknown>) => ({
          then: (
            onFulfilled: (v: { data: null; error: null }) => unknown,
          ) => {
            insertSpy(row);
            return Promise.resolve(onFulfilled({ data: null, error: null }));
          },
        }),
      }),
    }),
  };
});

import { recordShadowText, type ShadowTextPayload } from '../telemetry.ts';

beforeEach(() => {
  insertSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function payload(overrides: Partial<ShadowTextPayload> = {}): ShadowTextPayload {
  return {
    baseline_request_id: 'baseline-uuid',
    shadow_request_id: 'shadow-uuid',
    question_text: 'What is photosynthesis?',
    baseline_system_prompt: 'You are Foxy, a CBSE tutor for Class 8 Science.',
    shadow_system_prompt: null,
    baseline_response_text: 'Photosynthesis is the process by which plants make food.',
    shadow_response_text: 'Plants use sunlight to convert CO2 and H2O into glucose.',
    ...overrides,
  };
}

// ─── Basic insert shape ──────────────────────────────────────────────────────

describe('recordShadowText — insert shape', () => {
  it('writes one row with all six text fields + redaction_applied', async () => {
    recordShadowText(payload());

    // The .then handler runs synchronously in our mock to capture the call;
    // a microtask flush ensures the floating insert promise has resolved.
    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.baseline_request_id).toBe('baseline-uuid');
    expect(row.shadow_request_id).toBe('shadow-uuid');
    expect(row.question_text).toBe('What is photosynthesis?');
    expect(row.baseline_system_prompt).toBe('You are Foxy, a CBSE tutor for Class 8 Science.');
    expect(row.shadow_system_prompt).toBeNull();
    expect(row.baseline_response_text).toContain('Photosynthesis');
    expect(row.shadow_response_text).toContain('Plants use sunlight');
    expect(row.redaction_applied).toEqual([]);
  });

  it('passes shadow_system_prompt through when non-null', async () => {
    recordShadowText(payload({
      shadow_system_prompt: 'You are OpenAI Foxy, a CBSE tutor for Class 8 Science.',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.shadow_system_prompt).toBe('You are OpenAI Foxy, a CBSE tutor for Class 8 Science.');
  });
});

// ─── PII redaction at write time ─────────────────────────────────────────────

describe('recordShadowText — PII redaction', () => {
  it('redacts email in question_text and stamps "email" in redaction_applied', async () => {
    recordShadowText(payload({
      question_text: 'My email is alice@example.com — please respond there.',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.question_text).toContain('[REDACTED_EMAIL]');
    expect(row.question_text).not.toContain('alice@example.com');
    expect(row.redaction_applied).toContain('email');
  });

  it('redacts Indian phone in baseline_response_text', async () => {
    recordShadowText(payload({
      baseline_response_text: 'Call me at +91 9876543210 for more help with the chapter.',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.baseline_response_text).toContain('[REDACTED_PHONE]');
    expect(row.redaction_applied).toContain('phone');
  });

  it('redacts Razorpay ID in shadow_response_text', async () => {
    recordShadowText(payload({
      shadow_response_text: 'Refund tracked under pay_MK9hG3J2bRq8nA in our records.',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.shadow_response_text).toContain('[REDACTED_PAYMENT_ID]');
    expect(row.redaction_applied).toContain('razorpay_id');
  });

  it('aggregates redactors across multiple fields, dedupes and sorts', async () => {
    recordShadowText(payload({
      question_text: 'email a@b.com',
      baseline_response_text: 'phone 9876543210',
      shadow_response_text: 'another phone 9876543211 and email c@d.com',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    // Dedupes within a field AND across fields, sorted alphabetically.
    expect(row.redaction_applied).toEqual(['email', 'phone']);
  });

  it('preserves NCERT proper nouns (Newton, Sita) — no false positives', async () => {
    recordShadowText(payload({
      question_text: 'Who discovered the laws of motion?',
      baseline_response_text: 'Sir Isaac Newton discovered the three laws of motion. Sita is a character in the Ramayana.',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.baseline_response_text).toContain('Newton');
    expect(row.baseline_response_text).toContain('Sita');
    expect(row.redaction_applied).toEqual([]);
  });

  it('redacts PII inside both system prompts (when non-null) and aggregates labels', async () => {
    recordShadowText(payload({
      baseline_system_prompt: 'Foxy support contact: ops@alfanumrik.com',
      shadow_system_prompt: 'Reach the shadow team at shadow-ops@alfanumrik.com',
    }));

    await Promise.resolve();
    await Promise.resolve();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.baseline_system_prompt).toContain('[REDACTED_EMAIL]');
    expect(row.shadow_system_prompt).toContain('[REDACTED_EMAIL]');
    expect(row.redaction_applied).toEqual(['email']);
  });
});

// ─── Fire-and-forget contract ────────────────────────────────────────────────

describe('recordShadowText — fire-and-forget', () => {
  it('returns void synchronously', () => {
    const ret = recordShadowText(payload());
    expect(ret).toBeUndefined();
  });

  it('does not throw when the underlying insert rejects', () => {
    // Reconfigure the spy to simulate a network rejection on this call.
    insertSpy.mockImplementationOnce(() => {
      throw new Error('synthetic network error');
    });

    expect(() => recordShadowText(payload())).not.toThrow();
  });

  it('does not throw on empty texts (defensive — empty rows are still inserted)', () => {
    // The defensive redactor in redact-pii.ts returns ''/[] for empty input.
    expect(() => recordShadowText(payload({
      question_text: '',
      baseline_response_text: '',
      shadow_response_text: '',
    }))).not.toThrow();
  });
});
