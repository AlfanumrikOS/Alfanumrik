/**
 * /api/foxy — `foxy_chat_messages` write seam.
 *
 * WHY THIS FILE EXISTS (incident 2026-08-24, "Foxy persisted zero messages
 * for 21 days"):
 *
 * Every one of the seven `foxy_chat_messages` write sites in this route
 * family was written as
 *
 *     try {
 *       const { data } = await supabaseAdmin.from('foxy_chat_messages').insert([...]);
 *       if (data) { ... }
 *     } catch (e) { console.warn(...) }
 *
 * `supabase-js` does NOT throw on a rejected write — it resolves with
 * `{ data: null, error }`. So the `catch` was unreachable for the failure
 * mode that actually happens (constraint violation, missing column /
 * PGRST204 schema-cache miss, RLS denial, FK violation), `if (data)` was
 * simply false, and the turn proceeded exactly as if the write had
 * succeeded. Nothing was logged. Nothing alerted. Message volume went to
 * zero and stayed there for three weeks.
 *
 * Every write to `foxy_chat_messages` MUST now go through this module.
 *
 * P13 (privacy): the failure log carries NO message text, no answer text, no
 * name/email/phone. Only: stage label, session/student UUIDs, row count,
 * roles being written, the PostgREST/Postgres error `code`, and the
 * constraint/column NAME parsed out of the driver message. The raw driver
 * `message`/`details`/`hint` strings are deliberately NOT logged — Postgres
 * embeds the failing row's values in `DETAIL` on NOT NULL / CHECK / unique
 * violations, which would leak the student's message straight into the logs.
 *
 * P4-style resilience: nothing in here throws. A telemetry or logging failure
 * must never break the student's answer.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSystemMetric } from '@alfanumrik/lib/monitoring/log-event';

/** Where in the turn the write happened — the alert dimension. */
export type FoxyPersistStage =
  | 'pre_insert'
  | 'grounded_insert'
  | 'grounded_update'
  | 'grounded_update_fallback_insert'
  | 'abstain_insert'
  | 'abstain_update'
  | 'safety_blocked_update'
  | 'safety_blocked_insert'
  | 'streaming_insert'
  | 'streaming_update'
  | 'streaming_update_fallback_insert'
  | 'legacy_insert'
  | 'math_insert'
  | 'curriculum_out_of_scope_insert'
  | 'safeguarding_insert';

export interface FoxyPersistContext {
  stage: FoxyPersistStage;
  sessionId: string;
  studentId: string;
}

/** PII-free classification of a supabase-js / PostgREST error. */
export interface ClassifiedPersistError {
  /** PostgREST (`PGRST###`) or Postgres SQLSTATE (`23502`, `42501`, ...). */
  code: string | null;
  /** Constraint NAME only — e.g. `structured_role_check`. Never a value. */
  constraint: string | null;
  /** Column NAME only — e.g. `pending`. Never a value. */
  column: string | null;
  /** Coarse, alertable bucket. */
  kind:
    | 'not_null_violation'
    | 'check_violation'
    | 'foreign_key_violation'
    | 'unique_violation'
    | 'rls_denied'
    | 'undefined_column'
    | 'schema_cache_miss'
    | 'threw'
    | 'unknown';
}

interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const SQLSTATE_KIND: Record<string, ClassifiedPersistError['kind']> = {
  '23502': 'not_null_violation',
  '23503': 'foreign_key_violation',
  '23505': 'unique_violation',
  '23514': 'check_violation',
  '42501': 'rls_denied',
  '42703': 'undefined_column',
  // PostgREST: row-level security / JWT rejection surfaces as 42501 too.
  PGRST204: 'schema_cache_miss',
  PGRST301: 'rls_denied',
};

/**
 * Extract only structural identifiers (constraint name, column name, code)
 * from a driver error. Deliberately does NOT return the raw message.
 */
export function classifyPersistError(err: unknown): ClassifiedPersistError {
  if (err instanceof Error && !(err as unknown as PostgrestErrorLike).code) {
    return { code: null, constraint: null, column: null, kind: 'threw' };
  }
  const e = (err ?? {}) as PostgrestErrorLike;
  const code = typeof e.code === 'string' && e.code.length > 0 ? e.code : null;
  // Search message + details + hint for the NAMES only. The regexes capture
  // bare SQL identifiers ([A-Za-z0-9_]) — they can never capture a quoted
  // student value, which would contain spaces/punctuation.
  const haystack = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`;
  const constraint =
    /constraint\s+"([A-Za-z0-9_]+)"/.exec(haystack)?.[1]
    ?? /violates\s+[a-z-]+\s+constraint\s+"?([A-Za-z0-9_]+)"?/.exec(haystack)?.[1]
    ?? null;
  const column =
    /column\s+"([A-Za-z0-9_]+)"/.exec(haystack)?.[1]
    // PGRST204: Could not find the 'pending' column of 'foxy_chat_messages'
    ?? /find the '([A-Za-z0-9_]+)' column/.exec(haystack)?.[1]
    ?? null;

  let kind: ClassifiedPersistError['kind'] = (code && SQLSTATE_KIND[code]) || 'unknown';
  if (kind === 'unknown' && /row-level security/i.test(haystack)) kind = 'rls_denied';

  return { code, constraint, column, kind };
}

/**
 * The single alertable failure line for any `foxy_chat_messages` write.
 *
 * Emits BOTH a structured `logger.error` (log search / Sentry) and a
 * `system_metrics` counter (`foxy_message_persist_failure`) so ops can alert
 * on the rate without log parsing. Never throws.
 */
export function logFoxyPersistFailure(
  ctx: FoxyPersistContext,
  err: unknown,
  extra: { rowCount?: number; roles?: string[]; messageId?: string | null } = {},
): void {
  try {
    const classified = classifyPersistError(err);
    logger.error('foxy.message_persist_failed', {
      // P13: UUIDs, enums, counts, and SQL identifier NAMES only.
      stage: ctx.stage,
      table: 'foxy_chat_messages',
      foxySessionId: ctx.sessionId,
      studentId: ctx.studentId,
      messageId: extra.messageId ?? null,
      rowCount: extra.rowCount ?? null,
      roles: extra.roles ?? null,
      errorCode: classified.code,
      errorKind: classified.kind,
      constraint: classified.constraint,
      column: classified.column,
    });
    void logSystemMetric({
      metric_name: 'foxy_message_persist_failure',
      route: '/api/foxy',
      value: 1,
      tags: {
        stage: ctx.stage,
        code: classified.code ?? 'none',
        kind: classified.kind,
      },
    });
  } catch {
    // Logging must never break the student's answer (P4-style resilience).
  }
}

export interface FoxyMessageRow {
  session_id: string;
  student_id: string;
  role: 'user' | 'assistant';
  content: string;
  [key: string]: unknown;
}

export interface InsertResult {
  /** Inserted rows (`id`, `role`) when the write succeeded, else null. */
  rows: Array<{ id: string; role: string }> | null;
  /** True when the write did NOT land. Callers must branch on this. */
  failed: boolean;
}

/**
 * INSERT `foxy_chat_messages` rows, surfacing the driver `error` instead of
 * discarding it. Never throws.
 */
export async function insertFoxyMessages(
  rows: FoxyMessageRow[],
  ctx: FoxyPersistContext,
): Promise<InsertResult> {
  try {
    const { data, error } = await supabaseAdmin
      .from('foxy_chat_messages')
      .insert(rows)
      .select('id, role');
    if (error) {
      logFoxyPersistFailure(ctx, error, {
        rowCount: rows.length,
        roles: rows.map((r) => r.role),
      });
      return { rows: null, failed: true };
    }
    const inserted = (data ?? []) as Array<{ id: string; role: string }>;
    if (inserted.length === 0) {
      // A 0-row return with no error means the write silently did nothing
      // (e.g. an RLS WITH CHECK that filtered every row). Treat as failure.
      logFoxyPersistFailure(ctx, { code: 'ZERO_ROWS', message: 'insert returned no rows' }, {
        rowCount: rows.length,
        roles: rows.map((r) => r.role),
      });
      return { rows: null, failed: true };
    }
    return { rows: inserted, failed: false };
  } catch (thrown) {
    logFoxyPersistFailure(ctx, thrown, {
      rowCount: rows.length,
      roles: rows.map((r) => r.role),
    });
    return { rows: null, failed: true };
  }
}

/** Convenience: the assistant row id out of an insert result. */
export function assistantIdOf(result: InsertResult): string | null {
  return result.rows?.find((r) => r.role === 'assistant')?.id ?? null;
}

/**
 * UPDATE a single `foxy_chat_messages` row, surfacing the driver `error`.
 * Never throws.
 */
export async function updateFoxyMessage(
  messageId: string,
  patch: Record<string, unknown>,
  ctx: FoxyPersistContext,
): Promise<{ failed: boolean }> {
  try {
    const { error } = await supabaseAdmin
      .from('foxy_chat_messages')
      .update(patch)
      .eq('id', messageId);
    if (error) {
      logFoxyPersistFailure(ctx, error, { messageId });
      return { failed: true };
    }
    return { failed: false };
  } catch (thrown) {
    logFoxyPersistFailure(ctx, thrown, { messageId });
    return { failed: true };
  }
}

/**
 * Resolve a pre-inserted `pending=true` assistant row to its final content.
 *
 * If the UPDATE is rejected — which is exactly what a `BEFORE UPDATE`
 * immutability guard on `foxy_chat_messages` would do — fall back to
 * INSERTing the assistant turn so the student's answer still materialises
 * instead of being lost behind a permanently-pending placeholder.
 *
 * Returns the id of the row that now holds the assistant turn, or null when
 * both the UPDATE and the fallback INSERT failed (both are logged).
 */
export async function finalizeAssistantTurn(args: {
  assistantId: string;
  patch: Record<string, unknown>;
  /** Full row used if the UPDATE is rejected and we must INSERT instead. */
  fallbackRow: FoxyMessageRow;
  updateStage: FoxyPersistStage;
  fallbackStage: FoxyPersistStage;
  sessionId: string;
  studentId: string;
}): Promise<string | null> {
  const { failed } = await updateFoxyMessage(args.assistantId, args.patch, {
    stage: args.updateStage,
    sessionId: args.sessionId,
    studentId: args.studentId,
  });
  if (!failed) return args.assistantId;

  const fallback = await insertFoxyMessages([args.fallbackRow], {
    stage: args.fallbackStage,
    sessionId: args.sessionId,
    studentId: args.studentId,
  });
  return assistantIdOf(fallback) ?? fallback.rows?.[0]?.id ?? null;
}
