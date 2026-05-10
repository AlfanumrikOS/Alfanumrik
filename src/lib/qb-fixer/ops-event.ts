import { logOpsEvent } from '@/lib/ops-events';
import type { SweepResult } from './types';

export async function logSweepComplete(result: SweepResult, sweepId: string): Promise<void> {
  await logOpsEvent({
    category: 'qb_fixer',
    source: 'fix-failed-questions',
    severity: result.errors > 0 ? 'warning' : 'info',
    message: 'sweep_complete',
    context: { sweep_id: sweepId, ...result },
  });
}
