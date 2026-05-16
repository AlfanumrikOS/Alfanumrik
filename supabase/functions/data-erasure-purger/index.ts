/**
 * data-erasure-purger — Alfanumrik Edge Function (Phase D.3 / DPDP §15).
 *
 * Stage 2 of the parent-initiated child-data erasure flow. Invoked every
 * 6 hours by pg_cron via pg_net.http_post (see migration
 * 20260527000007_data_erasure_cron.sql). Picks rows from
 * public.data_erasure_requests where `status='pending' AND purge_at <= now()`
 * and runs an ordered cascade DELETE per
 * docs/runbooks/per-school-backup-restore.md §7.
 *
 * Contract:
 *   POST {SUPABASE_URL}/functions/v1/data-erasure-purger
 *   Returns:
 *     200 { processed: N, errors: M, results: [...] }
 *     500 { error: '...' } on fatal startup failure
 *
 * Per-row flow:
 *   1. SELECT id, guardian_id, student_id FROM data_erasure_requests
 *      WHERE status='pending' AND purge_at <= now()
 *      ORDER BY purge_at ASC LIMIT 100
 *   2. For each row:
 *      a. UPDATE status='purging' (optimistic — re-check status='pending'
 *         in the WHERE clause so a concurrent tick can't double-process).
 *      b. Run cascade DELETE in cascade order. Each DELETE is its own
 *         statement (Supabase JS client has no transaction primitive) —
 *         we treat the sequence as a logical transaction and on any
 *         failure record `status=failed` + error_message + emit ops alert.
 *         A partially-cascaded row leaves orphan FK targets but the
 *         operation is restartable from the failed state (operator
 *         flips back to `pending` after fixing the root cause).
 *      c. UPDATE status='completed', processed_at=now(),
 *         and emit `parent.child_erasure_completed` to state_events.
 *
 * Idempotency:
 *   - The status filter at step 1 ensures completed/cancelled/failed rows
 *     are skipped.
 *   - Each DELETE is safe to re-run (DELETE on zero matching rows = 0
 *     rows). If a tick crashes mid-cascade, the next tick re-tries the
 *     row only if status was flipped back to `pending` by an operator.
 *
 * Failure semantics:
 *   - Per-row failures DO NOT abort the batch. The function continues
 *     processing other due rows so a single bad row doesn't block DPDP
 *     compliance for the queue.
 *   - The HTTP response always returns 200 with `processed` and `errors`
 *     counts. pg_cron observes the response body via pg_net but does not
 *     retry on 2xx; ops dashboards consume errors via audit_logs.
 *
 * Table availability:
 *   - Some tables in the cascade list may not exist on every environment
 *     (e.g. parental_consent from Phase D.1 hasn't shipped to staging).
 *     We probe each table once at startup via information_schema and
 *     log+skip absent ones rather than failing.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Cascade order — matches docs/runbooks/per-school-backup-restore.md §7
// inverse FK order. The last entry MUST be `students` so all FKs are
// cleared before the parent row is removed.
//
// `subQueryColumn` is the column on the dependent table to filter on.
// When the entry lists `subQueryColumn = 'actor_auth_user_id'` (audit_logs)
// or `recipient_id` (notifications), we resolve the auth_user_id from the
// students row first.
type CascadeEntry =
  | { table: string; column: 'student_id' }
  | { table: string; column: 'actor_auth_user_id_via_student' }
  | { table: string; column: 'recipient_id_via_student' }
  | { table: string; column: 'id'; isStudents: true }

const CASCADE_ORDER: readonly CascadeEntry[] = [
  // 1. Audit + notifications (keyed on auth_user_id of the student).
  { table: 'audit_logs',                column: 'actor_auth_user_id_via_student' },
  { table: 'notifications',             column: 'recipient_id_via_student' },
  // 2. Per-feature behavioural history.
  { table: 'foxy_chat_messages',        column: 'student_id' },
  { table: 'quiz_attempts',             column: 'student_id' },
  { table: 'quiz_sessions',             column: 'student_id' },
  { table: 'score_history',             column: 'student_id' },
  { table: 'student_learning_profiles', column: 'student_id' },
  { table: 'student_subscriptions',     column: 'student_id' },
  // 3. Relational links.
  { table: 'class_students',            column: 'student_id' },
  // Phase D.1 table — may not exist on staging.
  { table: 'parental_consent',          column: 'student_id' },
  { table: 'guardian_student_links',    column: 'student_id' },
  // 4. The student row itself — must come last.
  { table: 'students',                  column: 'id', isStudents: true },
]

interface ErasureRow {
  id: string
  guardian_id: string
  student_id: string
}

interface PerRowResult {
  request_id: string
  student_id: string
  status: 'completed' | 'failed' | 'skipped'
  rows_deleted?: Record<string, number>
  error?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID()
}

/** Probe whether `public.<table>` exists. Cached for the lifetime of the call. */
async function tableExists(sb: SupabaseClient, table: string): Promise<boolean> {
  const { data, error } = await sb
    .from('information_schema.tables' as never)
    .select('table_name')
    .eq('table_schema', 'public')
    .eq('table_name', table)
    .maybeSingle()
  if (error) {
    // information_schema reads should never error for service-role; log
    // and assume true so we attempt the DELETE (which will either succeed
    // or surface a clear error to the row-level catch).
    console.warn('data-erasure-purger: information_schema probe failed', {
      table,
      error: error.message,
    })
    return true
  }
  return Boolean(data)
}

/** Look up the auth_user_id for a given students.id. Returns null if not found. */
async function lookupAuthUserId(
  sb: SupabaseClient,
  studentId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('students')
    .select('auth_user_id')
    .eq('id', studentId)
    .maybeSingle()
  if (error) {
    console.warn('data-erasure-purger: auth_user_id lookup failed', {
      student_id: studentId,
      error: error.message,
    })
    return null
  }
  return (data as { auth_user_id: string | null } | null)?.auth_user_id ?? null
}

/**
 * Run a single DELETE step. Returns the row count deleted, or null if the
 * table doesn't exist (caller logs+skips).
 */
async function deleteStep(
  sb: SupabaseClient,
  entry: CascadeEntry,
  studentId: string,
  authUserId: string | null,
  presentTables: Set<string>,
): Promise<number | null> {
  if (!presentTables.has(entry.table)) {
    return null
  }
  let q
  if (entry.column === 'student_id' || (entry.column === 'id' && 'isStudents' in entry)) {
    const filterCol = entry.column === 'id' ? 'id' : 'student_id'
    q = sb.from(entry.table).delete({ count: 'exact' }).eq(filterCol, studentId)
  } else if (entry.column === 'actor_auth_user_id_via_student') {
    if (!authUserId) return 0
    q = sb.from(entry.table).delete({ count: 'exact' }).eq('actor_auth_user_id', authUserId)
  } else if (entry.column === 'recipient_id_via_student') {
    if (!authUserId) return 0
    q = sb.from(entry.table).delete({ count: 'exact' }).eq('recipient_id', authUserId)
  } else {
    throw new Error(`unknown cascade column: ${JSON.stringify(entry)}`)
  }
  const { error, count } = await q
  if (error) {
    throw new Error(`delete ${entry.table}: ${error.message}`)
  }
  return count ?? 0
}

/**
 * Emit `parent.child_erasure_completed` to state_events. Best-effort —
 * publish failures must NOT cause the row to be marked failed (the data
 * is already gone; we can't roll back).
 */
async function emitCompletedEvent(
  sb: SupabaseClient,
  row: ErasureRow,
  rowsDeleted: Record<string, number>,
  tenantId: string | null,
): Promise<void> {
  try {
    const eventId = uuid()
    await sb.from('state_events').insert({
      event_id: eventId,
      kind: 'parent.child_erasure_completed',
      actor_auth_user_id: row.guardian_id,
      tenant_id: tenantId,
      idempotency_key: `child_erasure_completed:${row.id}`,
      occurred_at: new Date().toISOString(),
      payload: {
        requestId: row.id,
        guardianId: row.guardian_id,
        studentId: row.student_id,
        rowsDeleted,
      },
    })
  } catch (err) {
    console.warn('data-erasure-purger: emit completed event failed', {
      request_id: row.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Best-effort ops alert via audit_logs. We can't insert into the table we
 * just deleted from, so we use auth_user_id=null which the school_id
 * trigger leaves at NULL — super-admin can still filter on action.
 */
async function emitFailedAuditAlert(
  sb: SupabaseClient,
  row: ErasureRow,
  errorMessage: string,
): Promise<void> {
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
        error: errorMessage.slice(0, 2000),
      },
      status: 'failure',
    })
  } catch (err) {
    console.error('data-erasure-purger: audit alert failed', {
      request_id: row.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Per-row orchestrator ───────────────────────────────────────────────────

async function processRow(
  sb: SupabaseClient,
  row: ErasureRow,
  presentTables: Set<string>,
): Promise<PerRowResult> {
  // Step 1 — claim the row by transitioning pending → purging with an
  // optimistic-lock WHERE clause. A second tick that arrives at the same
  // row will get count=0 and skip.
  const { data: claimed, error: claimErr } = await sb
    .from('data_erasure_requests')
    .update({ status: 'purging' })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id, school_id')
    .maybeSingle()
  if (claimErr) {
    return { request_id: row.id, student_id: row.student_id, status: 'failed', error: `claim: ${claimErr.message}` }
  }
  if (!claimed) {
    // Another tick raced us — that's fine, just skip.
    return { request_id: row.id, student_id: row.student_id, status: 'skipped' }
  }
  const tenantId = (claimed as { school_id: string | null }).school_id

  // Resolve auth_user_id before any DELETE that needs it. We do this BEFORE
  // the cascade so the actor/recipient filters resolve even though the
  // students row gets deleted last.
  const authUserId = await lookupAuthUserId(sb, row.student_id)

  // Step 2 — run the cascade. On any failure, mark failed + audit alert.
  const rowsDeleted: Record<string, number> = {}
  try {
    for (const entry of CASCADE_ORDER) {
      const n = await deleteStep(sb, entry, row.student_id, authUserId, presentTables)
      if (n === null) {
        // Table absent on this env — log and continue.
        console.log('data-erasure-purger: table absent, skipping', {
          request_id: row.id,
          table: entry.table,
        })
        continue
      }
      rowsDeleted[entry.table] = n
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await sb
      .from('data_erasure_requests')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 2000),
        processed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    await emitFailedAuditAlert(sb, row, msg)
    console.error('data-erasure-purger: row failed', {
      request_id: row.id,
      student_id: row.student_id,
      error: msg,
      rows_deleted_before_failure: rowsDeleted,
    })
    return { request_id: row.id, student_id: row.student_id, status: 'failed', error: msg, rows_deleted: rowsDeleted }
  }

  // Step 3 — mark completed, emit success event.
  const { error: updErr } = await sb
    .from('data_erasure_requests')
    .update({
      status: 'completed',
      error_message: null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  if (updErr) {
    // The data IS gone — but we couldn't mark the row. Surface as failed
    // for ops, even though no data leaks. The operator can mark the row
    // completed manually after inspection.
    const msg = `final update: ${updErr.message}`
    await emitFailedAuditAlert(sb, row, msg)
    return { request_id: row.id, student_id: row.student_id, status: 'failed', error: msg, rows_deleted: rowsDeleted }
  }

  await emitCompletedEvent(sb, row, rowsDeleted, tenantId)
  console.log('data-erasure-purger: row completed', {
    request_id: row.id,
    student_id: row.student_id,
    rows_deleted: rowsDeleted,
  })
  return { request_id: row.id, student_id: row.student_id, status: 'completed', rows_deleted: rowsDeleted }
}

// ── Tick orchestrator ──────────────────────────────────────────────────────

export interface TickResult {
  processed: number
  errors: number
  skipped: number
  results: PerRowResult[]
}

export async function runTick(sb: SupabaseClient): Promise<TickResult> {
  // Probe each table once. Concurrent probes via Promise.all to keep the
  // tick latency dominated by the DELETEs, not the introspection.
  const probes = await Promise.all(
    CASCADE_ORDER.map(async (e) => [e.table, await tableExists(sb, e.table)] as const),
  )
  const presentTables = new Set(probes.filter(([_, v]) => v).map(([t]) => t))

  const { data: due, error } = await sb
    .from('data_erasure_requests')
    .select('id, guardian_id, student_id')
    .eq('status', 'pending')
    .lte('purge_at', new Date().toISOString())
    .order('purge_at', { ascending: true })
    .limit(100)

  if (error) {
    throw new Error(`fetch due rows: ${error.message}`)
  }
  const rows = (due ?? []) as ErasureRow[]

  const results: PerRowResult[] = []
  for (const row of rows) {
    const r = await processRow(sb, row, presentTables)
    results.push(r)
  }
  return {
    processed: results.filter((r) => r.status === 'completed').length,
    errors: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  }
}

// ── HTTP entry ─────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({
        error: 'data-erasure-purger: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const start = performance.now()
  try {
    const result = await runTick(sb)
    const durationMs = Math.round(performance.now() - start)
    console.log('data-erasure-purger: tick complete', {
      processed: result.processed,
      errors: result.errors,
      skipped: result.skipped,
      duration_ms: durationMs,
    })
    return new Response(JSON.stringify({ ...result, duration_ms: durationMs }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('data-erasure-purger: fatal', { error: msg })
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
