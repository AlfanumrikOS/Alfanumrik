/**
 * ALFANUMRIK — WhatsApp phone-number helpers (P13-sensitive)
 *
 * Plaintext phone numbers live ONLY in `whatsapp_identities` (service-role
 * only). Every other table, log line, and event references `phone_hash` —
 * a peppered HMAC-SHA256, because the Indian mobile E.164 space (~10^10)
 * is brute-forceable in seconds if hashed unpeppered.
 *
 * Log phones exclusively through `redactPhone` (re-exported below).
 */

import crypto from 'crypto';
import { isValidE164, redactPhone } from '../whatsapp-templates';

export { redactPhone };

/**
 * Normalize a Twilio WhatsApp address to bare E.164.
 *
 * Accepts:
 *   - `whatsapp:+919876543210` (Twilio From/To format)
 *   - `+919876543210` (already E.164)
 *   - `919876543210` (WaId format — E.164 digits, no `+` or prefix)
 *
 * Returns the `+`-prefixed E.164 string, or null when the input does not
 * validate via the canonical `isValidE164` (reused from whatsapp-templates —
 * do not duplicate that regex).
 */
export function normalizeWaPhone(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (/^whatsapp:/i.test(s)) {
    s = s.slice('whatsapp:'.length).trim();
  }
  if (!s.startsWith('+') && /^[1-9]\d{6,14}$/.test(s)) {
    s = `+${s}`;
  }
  return isValidE164(s) ? s : null;
}

/**
 * Peppered phone hash — the cross-table join key for all WhatsApp tables
 * except `whatsapp_identities`.
 *
 * @param phoneE164 `+`-prefixed E.164 number (normalize first).
 * @param pepper    WHATSAPP_PHONE_PEPPER secret. Never hash without it.
 * @returns lowercase hex HMAC-SHA256.
 */
export function hashPhone(phoneE164: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(phoneE164, 'utf8').digest('hex');
}
