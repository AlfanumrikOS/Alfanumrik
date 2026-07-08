import type { SupabaseClient } from '@supabase/supabase-js';

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
  { table: 'audit_logs', column: 'actor_auth_user_id_via_student' },
  { table: 'notifications', column: 'recipient_id_via_student' },
  { table: 'foxy_chat_messages', column: 'student_id' },
  { table: 'quiz_attempts', column: 'student_id' },
  { table: 'quiz_sessions', column: 'student_id' },
  { table: 'score_history', column: 'student_id' },
  { table: 'student_learning_profiles', column: 'student_id' },
  { table: 'student_subscriptions', column: 'student_id' },
  { table: 'class_students', column: 'student_id' },
  { table: 'parental_consent', column: 'student_id' },
  { table: 'guardian_student_links', column: 'student_id' },
  { table: 'students', column: 'id', isStudents: true },
];

function classifyFailure(message: string, rowsDeleted?: Record<string, number>): FailureClassification {
  const msg = message.toLowerCase();
  const partial = Object.values(rowsDeleted ?? {}).some((n) => n > 0);
  if (msg.includes('foreign key') || msg.includes('violates') || msg.includes('orphan')) return 'orphan-risk';
  if (partial) return 'partial';
  if (msg.includes('timeout') || msg.includes('connection') || msg.includes('temporar') || msg.includes('rate limit')) return 'retryable';
  return 'permanent';
}

function normalizeRpcData(data: unknown): { status: ErasureResultStatus; rows_deleted: Record<string, number>; dry_run: boolean } {
  const record = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
  const rowsDeleted = (record.rows_deleted && typeof record.rows_deleted === 'object') ? record.rows_deleted as Record<string, number> : {};
  return {
    status: record.status === 'dry_run' ? 'dry_run' : 'completed',
    rows_deleted: rowsDeleted,
    dry_run: record.dry_run === true,
  };
}

async function writeAuditEvent(sb: SupabaseClient, action: string, row: ErasureRow, details: Record<string, unknown>, status: 'success' | 'failure' = 'success') {
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
    // Immutable audit is primarily enforced by the transaction-safe RPC. This
    // fallback is best-effort for tests/older databases during rolling deploys.
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
    await sb.from('state_events').insert({ event_id: uuid(), kind: 'parent.child_erasure_completed', actor_auth_user_id: row.guardian_id, tenant_id: (data as Record<string, unknown> | null)?.school_id ?? null, idempotency_key: `child_erasure_completed:${row.id}`, occurred_at: now().toISOString(), payload: { requestId: row.id, guardianId: row.guardian_id, studentId: row.student_id, rowsDeleted: normalized.rows_deleted } });
  } catch {}
  await writeAuditEvent(sb, 'data_erasure.purge_completed', row, { rows_deleted: normalized.rows_deleted, dry_run: false });
  return { request_id: row.id, student_id: row.student_id, status: 'completed', rows_deleted: normalized.rows_deleted };
}

export async function runErasureTick(sb: SupabaseClient, presentTables: Set<string>, now: () => Date = () => new Date(), uuid: () => string = () => crypto.randomUUID(), options: PurgeOptions = {}): Promise<TickResult> {
  const { data: due, error } = await sb.from('data_erasure_requests').select('id, guardian_id, student_id').eq('status', 'pending').lte('purge_at', now().toISOString()).order('purge_at', { ascending: true }).limit(100);
  if (error) throw new Error(`fetch due rows: ${error.message}`);
  const results: PerRowResult[] = [];
  for (const row of (due ?? []) as ErasureRow[]) results.push(await processErasureRow(sb, row, presentTables, now, uuid, options));
  return { processed: results.filter((r) => r.status === 'completed').length, errors: results.filter((r) => r.status === 'failed').length, skipped: results.filter((r) => r.status === 'skipped').length, dry_run: results.filter((r) => r.status === 'dry_run').length, results };
}
