// eval/rag/harness/scrub.ts
//
// B1 retrieval-quality eval harness — Task 4: second-pass PII scrub wrapper
// (spec §7) + the canonical sha256 helper for trace-mined query text (B3).
//
// This module is offline tooling. It is NEVER imported by production / client
// code (enforced by the Task 8 import-boundary test). It performs no I/O — it
// is a pure transform over strings.
//
// ── Why a SECOND scrub pass (defense in depth) ───────────────────────────────
// The trace tables (`grounded_ai_traces.query_preview`, `retrieval_traces.
// query_text`) are ALREADY P13-scrubbed at write time (preview ≤100/200 chars,
// sha256, no full text). B1 runs `redactPIIInText()` over any mined text ANYWAY
// as a belt-and-suspenders second pass before it can ever land in harness
// memory or a committed fixture preview.
//
// ── The DEFAULT is sha256-only (B3) ──────────────────────────────────────────
// The shared text redactor `redactPIIInText()` strips email + Indian-phone +
// Razorpay-ID patterns but DELIBERATELY does NOT strip names (NCERT proper
// nouns like "Newton" / "Gandhi" / "Akbar" ARE the curriculum — a name-regex
// would shred them). Because a free-form query CAN contain a student's name the
// redactor will not catch, trace-mined query TEXT defaults to `query_sha256`-
// only storage; a scrubbed preview is retained ONLY where the caller has
// determined the text is provably PII-free. `trace-mining.ts` wires that rule.

import { createHash } from 'crypto';

import {
  redactPIIInText,
  type TextRedactionResult,
} from '../../../supabase/functions/_shared/redact-pii';

/**
 * Second-pass scrub over `redactPIIInText()` (the SINGLE source of truth for
 * free-form PII redaction — email + Indian-phone + Razorpay-ID). We re-export
 * the result shape unchanged so callers can persist `applied[]` for audit.
 *
 * This is intentionally a thin wrapper, NOT a re-implementation: the regexes,
 * the Indian-phone 6-9 leading-digit anchor, and the name-NOT-stripped policy
 * all live in `redact-pii.ts`. Centralising here gives the harness one import
 * surface and a clear seam to add harness-specific guards later without
 * touching the shared redactor.
 */
export function scrubText(s: string): TextRedactionResult {
  return redactPIIInText(s);
}

/**
 * Canonical SHA-256 hex digest of free-form query text — the `query_sha256`
 * identity (B3). Lowercase 64-hex, matching the production convention
 * (`crypto.subtle.digest('SHA-256', ...)` hex-joined in the Edge runtime, and
 * the `retrieval_traces.query_sha256` column comment: "SHA-256 hex of original
 * full query text").
 *
 * IMPORTANT: hash the ORIGINAL text, never a redacted preview — the sha256 is a
 * stable analytics identifier that must agree with the value already persisted
 * in `retrieval_traces.query_sha256`.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
