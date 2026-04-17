// supabase/functions/grounded-answer/trace.ts
// Trace row writer for grounded_ai_traces.
//
// Single responsibility: every pipeline path (grounded or abstain) writes
// exactly one row. This is the observability + quality-audit backbone for
// the service. Spec §5.4 and §6.4.
//
// Privacy invariant (P13):
//   - We never store the full query. Only a 200-char preview with emails,
//     phones, and token-like strings stripped out.
//   - query_hash is sha256(normalized(query)) so we can still count repeats
//     and compare across sessions without recovering PII.
//   - See cbse_syllabus migration comment: full student text lives only in
//     foxy_chat_messages (student-RLS).

import type { Caller, AbstainReason } from './types.ts';

export interface TraceRow {
  caller: Caller;
  student_id: string | null;
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query_hash: string;
  query_preview: string;
  embedding_model: string | null;
  retrieved_chunk_ids: string[];
  top_similarity: number | null;
  chunk_count: number;
  claude_model: string | null;
  prompt_template_id: string;
  prompt_hash: string | null;
  grounded: boolean;
  abstain_reason: AbstainReason | null;
  confidence: number | null;
  answer_length: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  client_reported_issue_id: null;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/**
 * Insert one grounded_ai_traces row.
 * Returns the inserted trace_id on success. On failure, returns a v4-style
 * placeholder uuid and logs a warn — callers must not fail the request
 * because the trace insert failed.
 */
export async function writeTrace(sb: SupabaseLike, row: TraceRow): Promise<string> {
  try {
    const { data, error } = await sb
      .from('grounded_ai_traces')
      .insert(row)
      .select('id')
      .single();

    if (error || !data?.id) {
      console.warn(`trace: insert failed — ${error?.message ?? 'no data'}`);
      return placeholderUuid();
    }
    return data.id as string;
  } catch (err) {
    console.warn(`trace: insert threw — ${String(err)}`);
    return placeholderUuid();
  }
}

/** Lowercase + trim + collapse whitespace. Stable input for hashQuery. */
export function normalizeQuery(q: string): string {
  return (q ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** sha256 of normalizeQuery(q). Returns "sha256:<hex>". */
export async function hashQuery(q: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeQuery(q));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

// Privacy redaction patterns. Run in order; each replaces the matched
// token with a neutral placeholder so we can still count redactions if we
// ever want to add a metric later. Placeholders are short so the 200-char
// budget is not devoured by one long email.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone: 10+ digits optionally separated by space/dash/dot, with optional +CC.
const PHONE_PATTERN = /\+?\d[\d\s.\-]{8,}\d/g;
// Token-like: 24+ chars of letters/digits/_/- (catches API keys, JWTs).
const TOKEN_PATTERN = /[A-Za-z0-9_-]{24,}/g;

/**
 * First 200 chars, with emails/phones/tokens redacted per P13.
 * Must be safe to write to grounded_ai_traces.query_preview and show to
 * admins reviewing traces.
 */
export function redactPreview(q: string): string {
  const raw = (q ?? '').slice(0, 200);
  return raw
    .replace(EMAIL_PATTERN, '[email]')
    .replace(PHONE_PATTERN, '[phone]')
    .replace(TOKEN_PATTERN, '[token]');
}

/**
 * RFC 4122 v4-shaped placeholder used when a real insert fails. Not a real
 * trace_id — admins filtering on this prefix can find orphaned responses.
 */
function placeholderUuid(): string {
  // crypto.randomUUID is available in Deno + modern browsers.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `00000000-${crypto.randomUUID().slice(9)}`;
  }
  // Deterministic fallback — should never trigger on Deno edge runtime.
  return '00000000-0000-4000-8000-000000000000';
}