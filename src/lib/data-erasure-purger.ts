/**
 * src/lib/data-erasure-purger.ts — pure, testable core for the
 * data-erasure-purger Edge Function.
 *
 * Phase D.3 (DPDP §15). The Deno-side function at
 * `supabase/functions/data-erasure-purger/index.ts` mirrors this logic line
 * for line — but Deno can't import from `src/`, so this file exists only to
 * make the orchestrator unit-testable from vitest. Both files use the same
 * cascade order; keep them in sync.
 *
 * The Edge Function file is the source of truth for production; this file
 * is the source of truth for what we test.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// Cascade order — matches docs/runbooks/per-school-backup-restore.md §7
// inverse FK order. The last entry MUST be `students`.
//
// `column` tags how the filter resolves:
//   - 'student_id' → table has a direct student_id FK.
//   - 'actor_auth_user_id_via_student' → table is audit_logs; we resolve
//     auth_user_id from the students row first.
//   - 'recipient_id_via_student' → notifications; recipient_id is the
//     student's auth_user_id.
//   - 'id' + isStudents → the students row itself.
export type CascadeEntry =
  | { table: string; column: 'student_id' }
  | { table: string; column: 'actor_auth_user_id_via_student' }
  | { table: string; column: 'recipient_id_via_student' }
  | { table: string; column: 'id'; isStudents: true };

export const CASCADE_ORDER: readonly CascadeEntry[] = [
  { table: 'audit_logs',                column: 'actor_auth_user_id_via_student' },
  { table: 'notifications',             column: 'recipient_id_via_student' },
  { table: 'foxy_chat_messages',        column: 'student_id' },
  { table: 'quiz_attempts',             column: 'student_id' },
  { table: 'quiz_sessions',             column: 'student_id' },
  { table: 'score_history',             column: 'student_id' },
  { table: 'student_learning_profiles', column: 'student_id' },
  { table: 'student_subscriptions',     column: 'student_id' },
  { table: 'class_students',            column: 'student_id' },
  { table: 'parental_consent',          column: 'student_id' },
  { table: 'guardian_student_links',    column: 'student_id' },
  { table: 'students',                  column: 'id', isStudents: true },
];

export interface ErasureRow {
  id: string;
  guardian_id: string;
  student_id: string;
}

export interface PerRowResult {
  request_id: string;
  student_id: string;
  status: 'completed' | 'failed' | 'skipped';
  rows_deleted?: Record<string, number>;
  error?: string;
}

export interface TickResult {
  processed: number;
  errors: number;
  skipped: number;
  results: PerRowResult[];
}

// ── Per-step DELETE ────────────────────────────────────────────────────

export async function runDeleteStep(
  sb: SupabaseClient,
  entry: CascadeEntry,
  studentId: string,
  authUserId: string | null,
  presentTables: Set<string>,
): Promise<number | null> {
  if (!presentTables.has(entry.table)) return null;
  let q;
  if (entry.column === 'student_id' || (entry.column === 'id' && 'isStudents' in entry)) {
    const filterCol = entry.column === 'id' ? 'id' : 'student_id';
    q = sb.from(entry.table).delete({ count: 'exact' }).eq(filterCol, studentId);
  } else if (entry.column === 'actor_auth_user_id_via_student') {
    if (!authUserId) return 0;
    q = sb.from(entry.table).delete({ count: 'exact' }).eq('actor_auth_user_id', authUserId);
  } else if (entry.column === 'recipient_id_via_student') {
    if (!authUserId) return 0;
    q = sb.from(entry.table).delete({ count: 'exact' }).eq('recipient_id', authUserId);
  } else {
    throw new Error(`unknown cascade column: ${JSON.stringify(entry)}`);
  }
  const { error, count } = await q;
  if (error) throw new Error(`delete ${entry.table}: ${error.message}`);
  return count ?? 0;
}

// ── Per-row orchestrator ──────────────────────────────────────────────

/**
 * Process a single erasure row. The function takes the Supabase client
 * as an argument so the tests can pass an in-memory mock. Pure-ish:
 * the only effects are on `sb`.
 *
 * Steps:
 *   1. Claim the row (pending → purging) via optimistic-lock UPDATE.
 *   2. Resolve auth_user_id (needed for audit_logs + notifications).
 *   3. Run cascade DELETEs in order. On any failure → status=failed +
 *      error_message + audit alert.
 *   4. Mark completed + emit success event.
 */
export async function processErasureRow(
  sb: SupabaseClient,
  row: ErasureRow,
  presentTables: Set<string>,
  now: () => Date = () => new Date(),
  uuid: () => string = () => crypto.randomUUID(),
): Promise<PerRowResult> {
  // Step 1 — claim.
  const { data: claimed, error: claimErr } = await sb
    .from('data_erasure_requests')
    .update({ status: 'purging' })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id, school_id')
    .maybeSingle();
  if (claimErr) {
    return { request_id: row.id, student_id: row.student_id, status: 'failed', error: `claim: ${claimErr.message}` };
  }
  if (!claimed) {
    return { request_id: row.id, student_id: row.student_id, status: 'skipped' };
  }
  const tenantId = (claimed as { school_id: string | null }).school_id;

  // Step 2 — auth_user_id lookup.
  let authUserId: string | null = null;
  try {
    const { data, error } = await sb
      .from('students')
      .select('auth_user_id')
      .eq('id', row.student_id)
      .maybeSingle();
    if (!error) {
      authUserId = (data as { auth_user_id: string | null } | null)?.auth_user_id ?? null;
    }
  } catch {
    // Non-fatal — actor/recipient steps will short-circuit on null.
  }

  // Step 3 — cascade.
  const rowsDeleted: Record<string, number> = {};
  try {
    for (const entry of CASCADE_ORDER) {
      const n = await runDeleteStep(sb, entry, row.student_id, authUserId, presentTables);
      if (n === null) continue; // absent table
      rowsDeleted[entry.table] = n;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb
      .from('data_erasure_requests')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 2000),
        processed_at: now().toISOString(),
      })
      .eq('id', row.id);
    // Best-effort audit alert.
    try {
      await sb.from('audit_logs').insert({
        auth_user_id: null,
        action: 'data_erasure.failed',
        resource_type: 'data_erasure_request',
        resource_id: row.id,
        details: {
          request_id: row.id,
          student_id: row.student_id,
          guardian_id: row.guardian_id,
          error: msg.slice(0, 2000),
        },
        status: 'failure',
      });
    } catch {
      /* swallow — primary failure already recorded */
    }
    return {
      request_id: row.id,
      student_id: row.student_id,
      status: 'failed',
      error: msg,
      rows_deleted: rowsDeleted,
    };
  }

  // Step 4 — mark completed.
  const { error: updErr } = await sb
    .from('data_erasure_requests')
    .update({
      status: 'completed',
      error_message: null,
      processed_at: now().toISOString(),
    })
    .eq('id', row.id);
  if (updErr) {
    const msg = `final update: ${updErr.message}`;
    return { request_id: row.id, student_id: row.student_id, status: 'failed', error: msg, rows_deleted: rowsDeleted };
  }

  // Step 5 — emit completed event (best-effort).
  try {
    await sb.from('state_events').insert({
      event_id: uuid(),
      kind: 'parent.child_erasure_completed',
      actor_auth_user_id: row.guardian_id,
      tenant_id: tenantId,
      idempotency_key: `child_erasure_completed:${row.id}`,
      occurred_at: now().toISOString(),
      payload: {
        requestId: row.id,
        guardianId: row.guardian_id,
        studentId: row.student_id,
        rowsDeleted,
      },
    });
  } catch {
    /* swallow — data already gone, observability event is non-load-bearing */
  }

  return {
    request_id: row.id,
    student_id: row.student_id,
    status: 'completed',
    rows_deleted: rowsDeleted,
  };
}

/** Top-level tick: select due rows, process each. Public for tests. */
export async function runErasureTick(
  sb: SupabaseClient,
  presentTables: Set<string>,
  now: () => Date = () => new Date(),
  uuid: () => string = () => crypto.randomUUID(),
): Promise<TickResult> {
  const { data: due, error } = await sb
    .from('data_erasure_requests')
    .select('id, guardian_id, student_id')
    .eq('status', 'pending')
    .lte('purge_at', now().toISOString())
    .order('purge_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(`fetch due rows: ${error.message}`);
  const rows = (due ?? []) as ErasureRow[];
  const results: PerRowResult[] = [];
  for (const row of rows) {
    results.push(await processErasureRow(sb, row, presentTables, now, uuid));
  }
  return {
    processed: results.filter((r) => r.status === 'completed').length,
    errors: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  };
}
