import { NextRequest, NextResponse } from 'next/server';
import { getBackupHealthView, runBackupHealthCheck } from '@alfanumrik/lib/data-platform';

/**
 * GET /api/super-admin/governance/health
 * Returns current governance health status (backup, data quality, policies).
 * Requires super-admin authorization (handled by middleware).
 */
export async function GET(_request: NextRequest) {
  const results: Record<string, unknown> = {};

  try {
    results.backup = await getBackupHealthView();
  } catch (e) {
    results.backup = { error: (e as Error).message };
  }

  // Trigger a live health check
  try {
    const live = await runBackupHealthCheck();
    results.backup_live_check = live;
  } catch (e) {
    results.backup_live_check = { error: (e as Error).message };
  }

  return NextResponse.json(results);
}
