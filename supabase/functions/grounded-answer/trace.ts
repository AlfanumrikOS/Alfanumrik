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
import type { ConfidenceV2Source } from './confidence-v2.ts';
// 2026-09-02 (§5 data-integrity fix): a failed grounded_ai_traces insert used
// to be a console.warn and a placeholder uuid — invisible unless someone was
// tailing this exact Edge Function's stdout. logOpsEvent writes into the same
// ops_events table this repo's alert pipeline already watches.
import { logOpsEvent } from '../_shared/ops-events.ts';

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
  /** API-shape discriminator (true = answer returned, false = abstain). */
  grounded: boolean;
  /**
   * Honest signal: true when the answer was produced from retrieved NCERT
   * chunks (strict-mode passed grounding-check OR soft-mode answered with
   * chunks present and no "general knowledge" escape prefix). False when
   * soft-mode fell back to general CBSE knowledge or no chunks were
   * retrieved. Null on abstain rows (no answer to evaluate). Audit
   * 2026-05-10: backed by grounded_ai_traces.grounded_from_chunks column.
   */
  grounded_from_chunks: boolean | null;
  abstain_reason: AbstainReason | null;
  /** LIVE confidence (v1). This is the ONLY value any gate reads. Unchanged. */
  confidence: number | null;
  /**
   * SHADOW confidence (v2) — recorded, never compared. See confidence-v2.ts.
   * null when no chunk carried a relevance signal, or on pre-retrieval
   * abstains (which is distinguishable from 'none' via confidence_v2_source
   * being null rather than 'none').
   */
  confidence_v2?: number | null;
  /** Which relevance signal produced confidence_v2. Keeps scales unpoolable. */
  confidence_v2_source?: ConfidenceV2Source | null;
  /** Top chunk's ABSOLUTE cosine (migration 20260727130000). Shadow only. */
  top_cosine_similarity?: number | null;
  /**
   * How many of the top-3 chunks contributed a signal to the average behind
   * confidence_v2 (0-3). WITHOUT this, confidence_v2 is uninterpretable: a
   * top-3 average over 1 signal and over 3 signals are very different numbers.
   * Null whenever confidence_v2 is null. Shadow only.
   */
  signal_coverage?: number | null;
  answer_length: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  client_reported_issue_id: null;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/**
 * SHADOW-ONLY columns added by migration 20260727130100. They are pure
 * instrumentation — nothing reads them at runtime.
 *
 * If the Edge Function is deployed AHEAD of the migration these columns do not
 * exist yet and PostgREST rejects the whole insert (PGRST204), which would
 * silently destroy the trace row and hand callers a placeholder trace_id. That
 * would be a real behaviour change, so the writer retries ONCE without them —
 * but ONLY on a missing-column error (see isMissingShadowColumnError). Net
 * effect: with the migration applied, identical to a plain insert plus the
 * shadow values; without it, byte-identical to the pre-instrumentation
 * behaviour; on any OTHER failure, also byte-identical (no extra write).
 */
const SHADOW_TRACE_COLUMNS = [
  'confidence_v2',
  'confidence_v2_source',
  'top_cosine_similarity',
  'signal_coverage',
] as const;

function stripShadowColumns(row: TraceRow): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  for (const key of SHADOW_TRACE_COLUMNS) delete copy[key];
  return copy;
}

/** Any shadow column named inside an error message. */
const SHADOW_COLUMN_NAME_PATTERN = new RegExp(SHADOW_TRACE_COLUMNS.join('|'));
/** Phrases PostgREST/Postgres use for "that column is not there". */
const MISSING_COLUMN_PHRASE = /schema cache|does not exist|unknown column|no such column/i;
/**
 * A constraint failure NAMES the column too — e.g. the vocabulary CHECK added
 * by this very migration is called `grounded_ai_traces_confidence_v2_source_chk`.
 * That is a genuine rejection of the VALUE, not a missing column: retrying
 * without the shadow keys would write a row that silently lost real data and
 * would mask a defect we need to see.
 */
const CONSTRAINT_PHRASE = /constraint|violates|out of range|overflow|invalid input/i;

/**
 * True ONLY for "the shadow columns are not in the schema yet".
 *
 * Deliberately narrow. An unconditional retry-on-any-error has three costs:
 *   (a) if the first insert actually COMMITTED and the client merely lost the
 *       response, the retry writes a DUPLICATE trace row — a failure mode that
 *       did not exist before the instrumentation;
 *   (b) a genuine non-column failure (the source CHECK, a numeric overflow, an
 *       RLS denial) gets masked AND misattributed to a missing migration;
 *   (c) every failed insert doubles the round-trip, and on the streaming path
 *       that write is awaited in front of the metadata frame.
 */
function isMissingShadowColumnError(
  error: { code?: unknown; message?: unknown } | null | undefined,
): boolean {
  if (!error) return false;
  const message = typeof error.message === 'string' ? error.message : '';
  if (CONSTRAINT_PHRASE.test(message)) return false;
  // PGRST204 is PostgREST's dedicated "column not found in the schema cache"
  // code. It is raised BEFORE anything is written, so a retry cannot duplicate.
  if (error.code === 'PGRST204') return true;
  return SHADOW_COLUMN_NAME_PATTERN.test(message) && MISSING_COLUMN_PHRASE.test(message);
}

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
      // Shadow-column fallback (see SHADOW_TRACE_COLUMNS). Attempted ONLY when
      // (i) the row actually carried shadow keys AND (ii) the error is a
      // missing-column signal. Every other failure — including "no error but no
      // id" — takes the byte-identical pre-instrumentation path: one insert,
      // one warn, a placeholder id. See isMissingShadowColumnError.
      const carriedShadow = SHADOW_TRACE_COLUMNS.some((k) => k in row);
      if (carriedShadow && isMissingShadowColumnError(error)) {
        const retry = await sb
          .from('grounded_ai_traces')
          .insert(stripShadowColumns(row))
          .select('id')
          .single();
        if (retry && !retry.error && retry.data?.id) {
          console.warn(
            'trace: shadow confidence columns not present in the schema cache — ' +
              'inserted without them',
          );
          return retry.data.id as string;
        }
      }
      const msg = error?.message ?? 'no data';
      console.warn(`trace: insert failed — ${msg}`);
      // Awaited: writeTrace is itself always awaited by its callers, so this
      // adds no new fire-and-forget surface — it's on the same critical path
      // the console.warn above already was.
      await logOpsEvent({
        category: 'ai',
        source: 'grounded_ai_traces',
        severity: 'error',
        message: `grounded_ai_traces insert failed: ${msg}`,
        subjectType: 'grounded_ai_traces_row',
        context: {
          caller: row.caller,
          grade: row.grade,
          subject_code: row.subject_code,
          grounded: row.grounded,
          error: msg,
        },
      });
      return placeholderUuid();
    }
    return data.id as string;
  } catch (err) {
    const msg = String(err);
    console.warn(`trace: insert threw — ${msg}`);
    await logOpsEvent({
      category: 'ai',
      source: 'grounded_ai_traces',
      severity: 'error',
      message: `grounded_ai_traces insert threw: ${msg}`,
      subjectType: 'grounded_ai_traces_row',
      context: { caller: row.caller, error: msg },
    });
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
    .replace(TOKEN_PATTERN, '[token]')
    .replace(PHONE_PATTERN, '[phone]');
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