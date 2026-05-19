// supabase/functions/_shared/__tests__/redact-pii.test.ts
//
// C4.2b-ii (2026-05-20): unit tests for the text-based PII redactor used
// when writing into mol_shadow_text_buffer.
//
// What we verify:
//   1. Email detection across the common formats students paste.
//   2. Indian phone detection: +91, 91-prefix, with/without separator,
//      10-digit starting 6-9.
//   3. Razorpay ID detection: pay_, order_, rzp_, cust_, sub_, inv_ + 14+ alnum.
//   4. Empty `applied[]` and untouched text when no PII matches.
//   5. NO false positives on NCERT terms (proper nouns, chapter labels,
//      page numbers, marks, dates) — this is the intentional policy choice.
//   6. Stateful regex safety: calling the redactor 100x doesn't drift.
//   7. Multiple PII kinds in one string aggregate into applied[] correctly.
//
// The file lives at supabase/functions/_shared/__tests__/redact-pii.test.ts
// and is picked up by the vitest config's broad `src/**` include via no
// path mapping — we add it to the include list in vitest.config.ts.

import { describe, it, expect } from 'vitest';
import { redactPIIInText } from '../redact-pii.ts';

// ─── Email detection ─────────────────────────────────────────────────────────

describe('redactPIIInText — email', () => {
  it('redacts a plain email', () => {
    const r = redactPIIInText('contact me at alice@example.com please');
    expect(r.text).toBe('contact me at [REDACTED_EMAIL] please');
    expect(r.applied).toEqual(['email']);
  });

  it('redacts email with plus addressing', () => {
    const r = redactPIIInText('My email is alice+test@example.co.in');
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.applied).toContain('email');
  });

  it('redacts email with dots and digits', () => {
    const r = redactPIIInText('Send to first.last123@sub.example.org for help');
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.applied).toContain('email');
  });

  it('redacts multiple emails in one string', () => {
    const r = redactPIIInText('cc a@b.com and c@d.com on this');
    // Only one entry in applied[] (deduped per redactor, not per match)
    expect(r.applied).toEqual(['email']);
    expect(r.text).toBe('cc [REDACTED_EMAIL] and [REDACTED_EMAIL] on this');
  });
});

// ─── Indian phone detection ──────────────────────────────────────────────────

describe('redactPIIInText — Indian phone', () => {
  it('redacts +91 prefix with space', () => {
    const r = redactPIIInText('Call me at +91 9876543210 tomorrow');
    expect(r.text).toContain('[REDACTED_PHONE]');
    expect(r.applied).toContain('phone');
  });

  it('redacts +91 prefix with dash', () => {
    const r = redactPIIInText('Phone: +91-9876543210');
    expect(r.text).toContain('[REDACTED_PHONE]');
    expect(r.applied).toContain('phone');
  });

  it('redacts +91 prefix with no separator', () => {
    const r = redactPIIInText('My number is +919876543210 yes');
    expect(r.text).toContain('[REDACTED_PHONE]');
    expect(r.applied).toContain('phone');
  });

  it('redacts bare 10-digit Indian mobile starting with 6-9', () => {
    const r = redactPIIInText('Reach me at 9876543210');
    expect(r.text).toBe('Reach me at [REDACTED_PHONE]');
    expect(r.applied).toContain('phone');
  });

  it('redacts a 10-digit mobile starting 6 (lowest Indian-mobile prefix)', () => {
    const r = redactPIIInText('Backup: 6234567890');
    expect(r.text).toContain('[REDACTED_PHONE]');
    expect(r.applied).toContain('phone');
  });

  it('does NOT redact 5-digit short codes', () => {
    // These are common in NCERT questions (postal codes, marks)
    const r = redactPIIInText('PIN 110001 lives at this code');
    expect(r.applied).not.toContain('phone');
    expect(r.text).toBe('PIN 110001 lives at this code');
  });

  it('does NOT redact a 10-digit number starting with 1-5 (not an Indian mobile)', () => {
    // Aadhaar / account numbers / random digit blobs in word problems
    const r = redactPIIInText('Account number 1234567890 has the balance');
    expect(r.applied).not.toContain('phone');
  });
});

// ─── Razorpay ID detection ───────────────────────────────────────────────────

describe('redactPIIInText — Razorpay ID', () => {
  it('redacts pay_<id>', () => {
    const r = redactPIIInText('payment_id is pay_MK9hG3J2bRq8nA right now');
    expect(r.text).toContain('[REDACTED_PAYMENT_ID]');
    expect(r.applied).toContain('razorpay_id');
  });

  it('redacts order_<id>', () => {
    const r = redactPIIInText('See order_KX9bH4M1aPq7zB for the receipt');
    expect(r.text).toContain('[REDACTED_PAYMENT_ID]');
    expect(r.applied).toContain('razorpay_id');
  });

  it('redacts rzp_<id>', () => {
    const r = redactPIIInText('rzp_LpQ8nB2vJ9rH7mX errored');
    expect(r.text).toContain('[REDACTED_PAYMENT_ID]');
    expect(r.applied).toContain('razorpay_id');
  });

  it('redacts cust_<id>', () => {
    const r = redactPIIInText('cust_NX9mH4M2aPq7zB is the linked customer');
    expect(r.text).toContain('[REDACTED_PAYMENT_ID]');
    expect(r.applied).toContain('razorpay_id');
  });

  it('redacts sub_<id> and inv_<id>', () => {
    const r1 = redactPIIInText('sub_AB9mH4M2aPq7zB cancelled');
    expect(r1.applied).toContain('razorpay_id');
    const r2 = redactPIIInText('inv_CD9mH4M2aPq7zB issued');
    expect(r2.applied).toContain('razorpay_id');
  });

  it('does NOT redact ids shorter than 14 alnum chars (false-positive guard)', () => {
    // "pay_abc" is short; could be a word in the answer ("the pay_amount...")
    const r = redactPIIInText('pay_short and order_brief');
    expect(r.applied).not.toContain('razorpay_id');
  });
});

// ─── No false positives on NCERT content ─────────────────────────────────────

describe('redactPIIInText — NCERT content false-positive guards', () => {
  it('does NOT redact proper nouns ("Newton", "Sita", "Gandhi", "Akbar")', () => {
    // Documented intentional policy: name redaction is OFF because NCERT
    // content is full of proper nouns that ARE the curriculum.
    const r = redactPIIInText('Sir Isaac Newton studied gravity. Akbar was an emperor. Sita is a character in the Ramayana.');
    expect(r.applied).toEqual([]);
    expect(r.text).toContain('Newton');
    expect(r.text).toContain('Akbar');
    expect(r.text).toContain('Sita');
  });

  it('does NOT redact "Class 10" / "Chapter 5" / "Page 42"', () => {
    const r = redactPIIInText('Refer to Class 10, Chapter 5, Page 42 for context.');
    expect(r.applied).toEqual([]);
    expect(r.text).toBe('Refer to Class 10, Chapter 5, Page 42 for context.');
  });

  it('does NOT redact marks / scores ("scored 85/100")', () => {
    const r = redactPIIInText('The student scored 85/100 in the test.');
    expect(r.applied).toEqual([]);
  });

  it('does NOT redact dates in NCERT text ("1947", "2021-22")', () => {
    const r = redactPIIInText('India gained independence in 1947. The 2021-22 budget allocated ...');
    expect(r.applied).toEqual([]);
    expect(r.text).toContain('1947');
    expect(r.text).toContain('2021-22');
  });

  it('does NOT redact equations or LaTeX', () => {
    const r = redactPIIInText('Newton\'s second law: F = ma. KE = (1/2)mv^2.');
    expect(r.applied).toEqual([]);
  });
});

// ─── Empty / no-PII paths ────────────────────────────────────────────────────

describe('redactPIIInText — no PII', () => {
  it('returns empty applied[] for clean NCERT text', () => {
    const r = redactPIIInText('Photosynthesis is the process by which plants convert sunlight into chemical energy.');
    expect(r.applied).toEqual([]);
    expect(r.text).toBe('Photosynthesis is the process by which plants convert sunlight into chemical energy.');
  });

  it('handles empty string', () => {
    const r = redactPIIInText('');
    expect(r.applied).toEqual([]);
    expect(r.text).toBe('');
  });

  it('handles non-string defensively (returns empty string, empty applied)', () => {
    // Cast away the type to exercise the defensive runtime guard.
    // deno-lint-ignore no-explicit-any
    const r = redactPIIInText(null as unknown as string);
    expect(r.applied).toEqual([]);
    expect(r.text).toBe('');
  });
});

// ─── Combined PII in one string ──────────────────────────────────────────────

describe('redactPIIInText — combined patterns', () => {
  it('redacts email + phone in one string and aggregates applied[]', () => {
    const r = redactPIIInText('Reach me at alice@example.com or +91 9876543210.');
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.text).toContain('[REDACTED_PHONE]');
    expect(r.applied).toEqual(['email', 'phone']);
  });

  it('redacts all three patterns in one string', () => {
    const r = redactPIIInText(
      'Contact alice@example.com, phone 9876543210, payment pay_MK9hG3J2bRq8nA.',
    );
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.text).toContain('[REDACTED_PHONE]');
    expect(r.text).toContain('[REDACTED_PAYMENT_ID]');
    expect(r.applied).toEqual(['email', 'phone', 'razorpay_id']);
  });

  it('aggregates only redactors that actually fire (subset semantics)', () => {
    const r = redactPIIInText('email is a@b.com but no phone here');
    expect(r.applied).toEqual(['email']);
  });
});

// ─── Stateful regex safety ───────────────────────────────────────────────────
//
// The redactor uses `g`-flagged RegExp instances at module scope. Without the
// `lastIndex = 0` reset in the implementation, repeated calls could drift —
// .test() advances lastIndex on `g` regexes. We verify across 100 calls.

describe('redactPIIInText — stateful regex safety', () => {
  it('produces identical output across 100 repeated calls (no lastIndex drift)', () => {
    const input = 'contact alice@example.com please';
    let lastText = '';
    let lastApplied: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = redactPIIInText(input);
      if (i === 0) {
        lastText = r.text;
        lastApplied = r.applied;
      } else {
        expect(r.text).toBe(lastText);
        expect(r.applied).toEqual(lastApplied);
      }
    }
  });

  it('interleaved calls with mixed inputs each see correct redactor set', () => {
    const r1 = redactPIIInText('email a@b.com only');
    expect(r1.applied).toEqual(['email']);
    const r2 = redactPIIInText('phone +91 9876543210 only');
    expect(r2.applied).toEqual(['phone']);
    const r3 = redactPIIInText('clean text');
    expect(r3.applied).toEqual([]);
    const r4 = redactPIIInText('both alice@example.com and 9876543210');
    expect(r4.applied).toEqual(['email', 'phone']);
  });
});
