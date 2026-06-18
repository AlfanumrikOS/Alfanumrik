/**
 * data-erasure-purger -- Alfanumrik Edge Function (Phase D.3 / DPDP S15).
 *
 * Stage 2 of the parent-initiated child-data erasure flow. Invoked every
 * 6 hours by pg_cron via pg_net.http_post (see migration
 * 20260527000007_data_erasure_cron.sql). Picks rows from
 * public.data_erasure_requests where status=pending AND purge_at <= now()
 * and executes the cascade via the execute_data_erasure_purge RPC (atomic
 * transaction-safe, idempotent, supports dry-run mode).
 *
 * Auth:
 *   verifyInternalCronRequest from _shared/security/internal-cron-auth.ts
 *   (same pattern as daily-cron, adaptive-remediation worker).
 *   Fail-closed: auth validated BEFORE any DB I/O.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditInternalCronInvocation, internalCronUnauthorizedResponse, verifyInternalCronRequest } from '../_shared/security/internal-cron-auth.ts'

export type FailureClassification = 'retryable' | 'permanent' | 'partial' | 'orphan-risk';
export type ErasureResultStatus = 'completed' | 'failed' | 'skipped' | 'dry_run';

export interface ErasureRow { id: string; guardian_id: string; student_id: string }
export interface PurgeOptions { dryRun?: boolean }
export interface PerRowResult { request_id: string; student_id: string; status: ErasureResultStatus; rows_deleted?: Record<string, number>; error?: string; failure_classification?: FailureClassification }
export interface TickResult { processed: number; errors: number; skipped: number; dry_run: number; results: PerRowResult[] }

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

export function classifyFailure(message: string, rowsDeleted?: Record<string, number>): FailureClassification {
  const msg = message.toLowerCase();
  const partial = Object.values(rowsDeleted ?? {}).some((n) => n > 0);
  if (msg.includes('foreign key') || msg.includes('violates') || msg.includes('orphan')) return 'orphan-risk';
  if (partial) return 'partial';
  if (msg.includes('timeout') || msg.includes('connection') || msg.includes('temporar') || msg.includes('rate limit')) return 'retryable';
  return 'permanent';
}

export function normalizeRpcData(data: unknown): { status: ErasureResultStatus; rows_deleted: Record<string, number>; dry_run: boolean } {
  const record = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
  const rowsDeleted = (record.rows_deleted && typeof record.rows_deleted === 'object') ? record.rows_deleted as Record<string, number> : {};
  return {
    status: record.status === 'dry_run' ? 'dry_run' : 'completed',
    rows_deleted: rowsDeleted,
    dry_run: record.dry_run === true,
  };
}

export async function writeAuditEvent(sb: SupabaseClient, action: string, row: ErasureRow, details: Record<string, unknown>, status: 'success' | 'failure' = 'success') {
  try {
    await sb.from('audit_logs').insert({
      auth_user_id: null,
      action,
      resource_type: 'data_erasure_request',
      resource_id: row.id,
      details: { request_id: row.id, student_id: row.student_id, guardian_id: row.guardian_id, ...details },
      status,
    });
  } catch {
    // Best-effort fallback; immutable audit enforced by transaction-safe RPC.
  }
}

export async function processErasureRow(
  sb: SupabaseClient,
  row: ErasureRow,
  _presentTables: Set<string>,
  now: () => Date = () => new Date(),
  uuid: () => string = () => crypto.randomUUID(),
  options: PurgeOptions = {},
): Promise<PerRowResult> {
  const dryRun = options.dryRun === true;
  await writeAuditEvent(sb, dryRun ? 'data_erasure.dry_run_started' : 'data_erasure.purge_started', row, { dry_run: dryRun, occurred_at: now().toISOString() });

  const { data, error } = await sb.rpc('execute_data_erasure_purge', {
    p_request_id: row.id,
    p_dry_run: dryRun,
    p_operator_event_id: uuid(),
  });

  if (error) {
    const msg = error.message ?? String(error);
    const classification = classifyFailure(msg);
    await writeAuditEvent(sb, 'data_erasure.failed', row, { error: msg.slice(0, 2000), failure_classification: classification, dry_run: dryRun }, 'failure');
    return { request_id: row.id, student_id: row.student_id, status: 'failed', error: msg, failure_classification: classification };
  }

  const normalized = normalizeRpcData(data);
  if (normalized.status === 'dry_run') {
    await writeAuditEvent(sb, 'data_erasure.dry_run_completed', row, { rows_deleted: normalized.rows_deleted, dry_run: true });
    return { request_id: row.id, student_id: row.student_id, status: 'dry_run', rows_deleted: normalized.rows_deleted };
  }

  try {
    await sb.from('state_events').insert({
      event_id: uuid(),
      kind: 'parent.child_erasure_completed',
      actor_auth_user_id: row.guardian_id,
      tenant_id: (data as Record<string, unknown> | null)?.school_id ?? null,
      idempotency_key: `child_erasure_completed:${row.id}`,
      occurred_at: now().toISOString(),
      payload: { requestId: row.id, guardianId: row.guardian_id, studentId: row.student_id, rowsDeleted: normalized.rows_deleted },
    });
  } catch { /* best-effort */ }

  await writeAuditEvent(sb, 'data_erasure.purge_completed', row, { rows_deleted: normalized.rows_deleted, dry_run: false });
  return { request_id: row.id, student_id: row.student_id, status: 'completed', rows_deleted: normalized.rows_deleted };
}

export async function runErasureTick(
  sb: SupabaseClient,
  presentTables: Set<string>,
  now: () => Date = () => new Date(),
  uuid: () => string = () => crypto.randomUUID(),
  options: PurgeOptions = {},
): Promise<TickResult> {
  const { data: due, error } = await sb
    .from('data_erasure_requests')
    .select('id, guardian_id, student_id')
    .eq('status', 'pending')
    .lte('purge_at', now().toISOString())
    .order('purge_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(`fetch due rows: ${error.message}`);

  const results: PerRowResult[] = [];
  for (const row of (due ?? []) as ErasureRow[]) {
    results.push(await processErasureRow(sb, row, presentTables, now, uuid, options));
  }
  return {
    processed: results.filter((r) => r.status === 'completed').length,
    errors: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    dry_run: results.filter((r) => r.status === 'dry_run').length,
    results,
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ error: 'data-erasure-purger: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }

  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const authStarted = performance.now()
  const bodyText = await req.text()
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  const auth = await verifyInternalCronRequest({ req, route: 'data-erasure-purger', sb, requestId, bodyText })
  if (!auth.ok) {
    await auditInternalCronInvocation({ sb, route: 'data-erasure-purger', requestId, started: authStarted, auth, statusCode: auth.status })
    return internalCronUnauthorizedResponse(auth)
  }
  await auditInternalCronInvocation({ sb, route: 'data-erasure-purger', requestId, started: authStarted, auth, statusCode: 200 })

  let body: Record<string, unknown> = {}
  try {
    body = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })
  }
  const dryRun = body.dry_run === true || new URL(req.url).searchParams.get('dry_run') === 'true'

  const start = performance.now()
  try {
    const result = await runErasureTick(
      sb,
      new Set(CASCADE_ORDER.map((e) => e.table)),
      () => new Date(),
      () => crypto.randomUUID(),
      { dryRun },
    )
    const durationMs = Math.round(performance.now() - start)
    console.log('data-erasure-purger: tick complete', {
      processed: result.processed,
      errors: result.errors,
      skipped: result.skipped,
      dry_run: result.dry_run,
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
