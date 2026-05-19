/**
 * Shared PII redactor — single source of truth for both Next.js and Deno runtimes.
 *
 * Used by:
 * - src/lib/ops-events-redactor.ts (re-exports for Next.js / Vitest)
 * - src/lib/logger.ts (structured logging)
 * - supabase/functions/_shared/ops-events.ts (Deno Edge Functions)
 *
 * Enforces product invariant P13 (Data Privacy):
 *   No PII in client-side logs or Sentry events.
 */

// SENSITIVE_KEYS — keys whose value gets replaced with '[REDACTED]' anywhere
// in the payload (top-level or nested). The set spans three threat surfaces:
//
//   1. Auth/credential surface — passwords, tokens, API keys, service-role
//      keys, auth/cookie headers. Privacy-policy claim: Section 11 ("PII
//      redaction in logs — passwords, tokens, emails, phone numbers, and
//      API keys are stripped from server logs and Sentry events").
//
//   2. Identity surface — email, phone, parent_phone, full_name, name,
//      school_name, school_address, address. Section 7.1 claims Sentry
//      events are PII-redacted; Section 14.1 claims AI prompts never carry
//      PII; DPDP Act Section 9 + general data-minimization for minors.
//      Added 2026-05-05 (D7 follow-up #4 — closes Sentry server/edge gap
//      that previously only redacted email/phone but let full_name,
//      school_name, parent_phone leak through extra/contexts).
//
//   3. Payment surface — Razorpay signatures, full card data, UPI handles.
//      Section 2.6 ("We do NOT store full card numbers, CVV, UPI PINs")
//      and P11. Without these here, a stack trace serialised through
//      `extra` could ship a card-number string to Sentry. Added 2026-05-05.
//
// Membership is checked via `key.toLowerCase()` — keep all entries lowercase.
// Adding to this set is always safe (more redaction, never less). Removing
// from this set requires audit.
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  // Auth / credentials
  'password', 'token', 'secret',
  'api_key', 'apikey', 'access_token', 'refresh_token',
  'service_role_key', 'authorization', 'cookie', 'set-cookie', 'x-api-key',
  // Identity (added 2026-05-05 — D7 follow-up #4 privacy-policy alignment)
  // NOTE: bare `name` and `ip` are NOT included — they collide with too many
  // legitimate fields (event_name, subject_name, ip-related metrics). The
  // PostHog wrapper adds those to its own narrower deny list because PostHog
  // sees a closed set of well-known event payloads.
  'email', 'phone', 'parent_phone', 'mobile_number',
  'full_name', 'first_name', 'last_name',
  'school_name', 'school_address',
  // Payment surface (added 2026-05-05 — D7 follow-up #4)
  // Section 2.6 of the privacy policy: "We do NOT store full card numbers,
  // CVV, UPI PINs, or net-banking credentials." A stack trace that
  // serialises a payment payload through Sentry's `extra` MUST not leak any
  // of these. The PostHog wrapper has parity coverage in EVENT_PROPERTY_PII_KEYS.
  'razorpay_signature', 'razorpay_webhook_signature',
  'card_number', 'card_cvv', 'card_expiry', 'card_holder',
  'upi_id', 'vpa', 'upi_pin',
  // NOTE: `ip_address` is INTENTIONALLY NOT in this base set. The audit log
  // (src/lib/audit.ts) writes ip_address to the audit_logs table for security
  // forensics — that is an admin-only RLS-restricted table and is a documented
  // exception to the in-flight redaction posture. The vectors we care about
  // are handled at the surface layer:
  //   - Sentry: user.ip_address is dropped in beforeSend (sentry.server/edge)
  //   - PostHog: disableGeoip + EVENT_PROPERTY_PII_KEYS includes ip_address
  //   - Anthropic: never sent (no IP fields in AI prompt construction)
]);

const REDACTED = '[REDACTED]';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function redactPII(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[Circular]';
    seen.add(v as object);

    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : walk(val);
      }
      return out;
    }
    return v;
  }

  return walk(value);
}

// ─── Text-based PII redaction (C4.2b-ii) ────────────────────────────────────
//
// `redactPII` above operates on OBJECT KEYS (the in-flight redaction posture
// for Sentry / PostHog / logger). For the MOL shadow grader we also need to
// redact PII inside FREE-FORM TEXT — student questions, baseline answers,
// and shadow answers stored in mol_shadow_text_buffer can contain emails or
// phone numbers even when the surrounding payload had no PII-keyed fields.
//
// Three patterns are redacted:
//   1. Email  — RFC-ish; we accept the common subset NCERT students paste.
//   2. Phone  — Indian mobile pattern: optional `+91` prefix, optional
//               separator, 10 digits starting 6-9. We deliberately do NOT
//               match arbitrary 10-digit numbers (e.g. PIN codes, marks)
//               by anchoring the leading digit to 6-9.
//   3. Razorpay ID — `pay_...`, `order_...`, `rzp_...`, `cust_...`, `sub_...`,
//               `inv_...` followed by 14+ alphanumerics. Matches Razorpay's
//               documented ID format.
//
// We do NOT redact names. NCERT content (history, biology, civics) contains
// thousands of proper nouns that ARE the curriculum ("Newton", "Sita",
// "Gandhi", "Akbar") and a name-regex would shred them. Documented as an
// intentional policy in the mol_shadow_text_buffer migration.

export interface TextRedactionResult {
  /** The text with all matched PII replaced by sentinel tokens. */
  text: string;
  /** Which redactors actually fired on this input. Subset of ['email', 'phone', 'razorpay_id']. */
  applied: string[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Indian mobile pattern. Optional +91 / 91 prefix with optional space/dash
// separator, then 10 digits starting 6-9. The `\b` word boundary on the
// trailing side prevents matching the first 10 digits of a longer numeric
// blob (Aadhaar, account number, etc).
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/g;
// Razorpay ID pattern. Matches `pay_`, `order_`, `rzp_`, `cust_`, `sub_`,
// `inv_` prefix followed by 14+ alphanumerics. Razorpay IDs are normally
// 14-20 chars after the prefix.
const RZP_ID_RE = /\b(pay|order|rzp|cust|sub|inv)_[A-Za-z0-9]{14,}\b/g;

/**
 * Redact email / Indian-phone / Razorpay-ID patterns from free-form text.
 * Returns the redacted text and the set of redactor labels that fired (so
 * callers can persist `redaction_applied[]` for audit).
 *
 * Performance: three `.replace()` passes; negligible at MOL message sizes
 * (sub-microsecond for typical 1-4 KB texts). Safe to call from hot paths.
 *
 * Used by:
 *   - supabase/functions/_shared/mol/telemetry.ts:recordShadowText
 *     (writes redacted text into mol_shadow_text_buffer).
 *
 * NOT used by:
 *   - Anywhere logging to Sentry / PostHog — those rely on `redactPII`
 *     above, which redacts BY KEY. Mixing the two would double-redact
 *     and risk noisy diffs in payloads.
 */
export function redactPIIInText(s: string): TextRedactionResult {
  // Defensive null / non-string handling — callers should pass strings, but
  // a runtime guard keeps the contract stable if a caller forgets.
  if (typeof s !== 'string' || s.length === 0) {
    return { text: typeof s === 'string' ? s : '', applied: [] };
  }

  const applied: string[] = [];
  let out = s;

  // Each regex has the `g` flag; resetting via .test() can leave lastIndex
  // mid-string for subsequent calls. We reset to 0 before each detection
  // pass so the test+replace pair is deterministic across invocations.
  EMAIL_RE.lastIndex = 0;
  if (EMAIL_RE.test(out)) {
    applied.push('email');
    out = out.replace(EMAIL_RE, '[REDACTED_EMAIL]');
  }

  PHONE_RE.lastIndex = 0;
  if (PHONE_RE.test(out)) {
    applied.push('phone');
    out = out.replace(PHONE_RE, '[REDACTED_PHONE]');
  }

  RZP_ID_RE.lastIndex = 0;
  if (RZP_ID_RE.test(out)) {
    applied.push('razorpay_id');
    out = out.replace(RZP_ID_RE, '[REDACTED_PAYMENT_ID]');
  }

  return { text: out, applied };
}