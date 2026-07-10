import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export interface CronJobHealthInput {
  path: string;
  metric: string;
  source: string;
  durationMs: number;
  requestId?: string | null;
  context?: Record<string, unknown>;
}

export async function recordCronJobHealth(input: CronJobHealthInput): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('ops_events').insert({
      occurred_at: new Date().toISOString(),
      category: 'job_health',
      source: input.source,
      severity: 'info',
      message: 'Cron job completed successfully',
      context: {
        ...(input.context ?? {}),
        metric: input.metric,
        path: input.path,
        duration_ms: input.durationMs,
      },
      request_id: input.requestId ?? null,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'production',
    });

    if (error) {
      console.warn('[cron-job-health] insert failed', {
        error: error.message,
        source: input.source,
        metric: input.metric,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[cron-job-health] writer threw', { error: String(error) });
    return false;
  }
}
