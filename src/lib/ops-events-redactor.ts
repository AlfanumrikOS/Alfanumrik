/**
 * Re-export the shared PII redactor for Next.js consumption.
 *
 * The canonical implementation lives in supabase/functions/_shared/redact-pii.ts
 * so both Next.js and Deno Edge Functions share the same redaction logic.
 */
export { redactPII } from '../../supabase/functions/_shared/redact-pii';