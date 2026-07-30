/**
 * WhatsApp phone helpers — unit tests (P13-sensitive).
 *
 * Covers `packages/lib/src/whatsapp/phone.ts`:
 *   - normalizeWaPhone(): `whatsapp:` prefix strip, WaId digits form, E.164
 *     validation via the canonical isValidE164 (whatsapp-templates.ts).
 *   - hashPhone(): peppered HMAC-SHA256 — deterministic, pepper-sensitive.
 *   - redactPhone: re-export identity with the canonical module.
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { normalizeWaPhone, hashPhone, redactPhone } from '@alfanumrik/lib/whatsapp/phone';
import { redactPhone as canonicalRedactPhone } from '@alfanumrik/lib/whatsapp-templates';

describe('normalizeWaPhone', () => {
  it('strips the whatsapp: prefix from a Twilio From address', () => {
    expect(normalizeWaPhone('whatsapp:+919876543210')).toBe('+919876543210');
  });

  it('is case-insensitive on the whatsapp: prefix', () => {
    expect(normalizeWaPhone('WhatsApp:+919876543210')).toBe('+919876543210');
    expect(normalizeWaPhone('WHATSAPP:+919876543210')).toBe('+919876543210');
  });

  it('trims surrounding whitespace, including after the prefix', () => {
    expect(normalizeWaPhone('  whatsapp:+919876543210  ')).toBe('+919876543210');
    expect(normalizeWaPhone('whatsapp: +919876543210')).toBe('+919876543210');
  });

  it('passes an already-E.164 number through unchanged', () => {
    expect(normalizeWaPhone('+919876543210')).toBe('+919876543210');
  });

  it('accepts the WaId digits form (no + / no prefix) and prepends +', () => {
    // Pinned actual behavior: bare E.164 digits are treated as a WaId.
    expect(normalizeWaPhone('919876543210')).toBe('+919876543210');
  });

  it('accepts a whatsapp:-prefixed WaId digits form', () => {
    expect(normalizeWaPhone('whatsapp:919876543210')).toBe('+919876543210');
  });

  it('rejects digit strings with a leading zero (not E.164)', () => {
    expect(normalizeWaPhone('0987654321')).toBeNull();
  });

  it('rejects numbers that are too short or too long', () => {
    expect(normalizeWaPhone('123456')).toBeNull(); // 6 digits — below E.164 floor here
    expect(normalizeWaPhone('+1234567890123456')).toBeNull(); // 16 digits — above max
  });

  it('rejects non-numeric garbage and empty input', () => {
    expect(normalizeWaPhone('whatsapp:banana')).toBeNull();
    expect(normalizeWaPhone('not-a-phone')).toBeNull();
    expect(normalizeWaPhone('')).toBeNull();
  });

  it('rejects numbers with internal spaces (strict E.164)', () => {
    expect(normalizeWaPhone('whatsapp:+91 98765 43210')).toBeNull();
  });
});

describe('hashPhone', () => {
  const PHONE = '+919876543210';
  const PEPPER = 'test-pepper-secret';

  it('is deterministic for the same phone + pepper', () => {
    expect(hashPhone(PHONE, PEPPER)).toBe(hashPhone(PHONE, PEPPER));
  });

  it('matches an independently computed HMAC-SHA256 hex digest', () => {
    const expected = crypto.createHmac('sha256', PEPPER).update(PHONE, 'utf8').digest('hex');
    expect(hashPhone(PHONE, PEPPER)).toBe(expected);
  });

  it('is pepper-sensitive (different pepper → different hash)', () => {
    expect(hashPhone(PHONE, PEPPER)).not.toBe(hashPhone(PHONE, 'another-pepper'));
  });

  it('is phone-sensitive (different phone → different hash)', () => {
    expect(hashPhone(PHONE, PEPPER)).not.toBe(hashPhone('+919876543211', PEPPER));
  });

  it('emits 64 lowercase hex chars (SHA-256)', () => {
    expect(hashPhone(PHONE, PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains the raw phone digits verbatim (P13 sanity)', () => {
    expect(hashPhone(PHONE, PEPPER)).not.toContain('9876543210');
  });
});

describe('redactPhone re-export', () => {
  it('is the SAME function object as the canonical whatsapp-templates export', () => {
    // Re-export must stay an alias, not a fork — P13 redaction has one home.
    expect(redactPhone).toBe(canonicalRedactPhone);
  });

  it('redacts to the documented +91****3210 shape', () => {
    expect(redactPhone('+919876543210')).toBe('+91****3210');
  });

  it('collapses short/empty input to ***', () => {
    expect(redactPhone('')).toBe('***');
    expect(redactPhone('+91123')).toBe('***');
  });
});
