import { NextRequest, NextResponse } from 'next/server';
import { runDataQualityChecks, runBackupHealthCheck } from '@alfanumrik/lib/data-platform';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';

/**
 * GET /api/cron/governance-health
 * Daily governance health check: data quality + backup verification.
 * Called by Vercel cron (vercel.json cron schedule).
 * Requires CRON_SECRET header.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  // Fail-closed CRON_SECRET gate (house pattern) BEFORE any DB I/O.
  if (!verifyCronAuth(request).ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = { checked_at: new Date().toISOString() };

  // Run data quality checks
  try {
    const qualityResults = await runDataQualityChecks();
    const failures = qualityResults.filter(r => r.result === 'fail');
    results.data_quality = {
      total_checks: qualityResults.length,
      failures: failures.length,
      critical: failures.filter(f => f.severity === 'CRITICAL').length,
      high: failures.filter(f => f.severity === 'HIGH').length,
      details: failures.map(f => ({ check: f.check_name, detail: f.detail, severity: f.severity })),
    };
  } catch (e) {
    results.data_quality = { error: (e as Error).message };
  }

  // Run backup health check
  try {
    const backupHealth = await runBackupHealthCheck();
    results.backup = backupHealth;
  } catch (e) {
    results.backup = { error: (e as Error).message };
  }

  // Run vacuous policy detection
  try {
    const { detectVacuousOwnPolicies } = await import('@alfanumrik/lib/data-platform');
    const vacuousPolicies = await detectVacuousOwnPolicies();
    results.vacuous_policies = {
      count: vacuousPolicies.length,
      policies: vacuousPolicies.map(p => `${p.table_name}.${p.policy_name} (${p.policy_cmd})`),
    };
  } catch (e) {
    results.vacuous_policies = { error: (e as Error).message };
  }

  // Check for unclassified tables
  try {
    const { getUnclassifiedTables } = await import('@alfanumrik/lib/data-platform');
    const unclassified = await getUnclassifiedTables();
    results.unclassified_tables = {
      count: unclassified.length,
      tables: unclassified.slice(0, 50).map(t => `${t.table_name} (${t.column_count} cols)`),
    };
  } catch (e) {
    results.unclassified_tables = { error: (e as Error).message };
  }

  // Enforce retention (P1-3): archive audit_logs, then bounded DELETE on the
  // allow-list tables. Each table is isolated by runRetentionEnforcement so one
  // failure reports here without aborting the run.
  try {
    const { runRetentionEnforcement } = await import('@alfanumrik/lib/data-platform');
    const retentionResults = await runRetentionEnforcement();
    results.retention = {
      total_archived: retentionResults.reduce((acc, r) => acc + r.archived, 0),
      total_deleted: retentionResults.reduce((acc, r) => acc + r.deleted, 0),
      errors: retentionResults.filter(r => r.error).map(r => ({ table: r.table, error: r.error })),
      tables: retentionResults.map(r => ({
        table: r.table,
        method: r.method,
        archived: r.archived,
        deleted: r.deleted,
        ...(r.error ? { error: r.error } : {}),
      })),
    };
  } catch (e) {
    results.retention = { error: (e as Error).message };
  }

  // Job-health heartbeat (house pattern): a successful run — including one
  // that reports findings — writes the registered last-success metric.
  await recordCronJobHealth({
    path: '/api/cron/governance-health',
    metric: 'ops.cron.governance_health.last_success_at',
    source: 'cron/governance-health',
    durationMs: Date.now() - startedAt,
    context: { checked_at: results.checked_at as string },
  });

  return NextResponse.json(results);
}
