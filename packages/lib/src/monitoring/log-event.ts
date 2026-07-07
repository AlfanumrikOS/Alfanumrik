/**
 * Monitoring event logger — fire-and-forget.
 * Never throws. Errors are console-logged only.
 *
 * CRITICAL: learning_events.student_id must be auth.uid() (auth.users.id),
 * NOT students.id. Callers must pass the authenticated user's auth UUID.
 */
import type { LearningEvent, SystemMetric } from '@/types/monitoring';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export async function logLearningEvent(
  event: Omit<LearningEvent, 'id' | 'occurred_at'>
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('learning_events')
      .insert({
        ...event,
        occurred_at: new Date().toISOString(),
      });
    if (error) {
      console.error('[monitoring:learning_event]', {
        event_type: event.event_type,
        student_id: event.student_id,
        error: error.message,
        code: error.code,
      });
    }
  } catch (e) {
    console.error('[monitoring:learning_event:fatal]', e);
    // Never re-throw — monitoring must not break the learning flow
  }
}

export async function logSystemMetric(
  metric: Omit<SystemMetric, 'id' | 'recorded_at'>
): Promise<void> {
  try {
    if (!metric.metric_name || metric.metric_name.trim() === '') {
      console.error('[monitoring:metric] metric_name is required');
      return;
    }
    const { error } = await supabaseAdmin
      .from('system_metrics')
      .insert({
        ...metric,
        recorded_at: new Date().toISOString(),
      });
    if (error) {
      console.error('[monitoring:system_metric]', {
        metric_name: metric.metric_name,
        error: error.message,
      });
    }
  } catch (e) {
    console.error('[monitoring:metric:fatal]', e);
  }
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
