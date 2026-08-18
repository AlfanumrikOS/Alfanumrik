/**
 * Monitoring event types — shared by log-event.ts and post-submit-telemetry.ts.
 * Mirror of apps/host/src/types/monitoring.ts but lib-native for packages/lib
 * type-check independence.
 */

export type LearningEventType =
  | 'quiz_attempt'
  | 'foxy_ask'
  | 'hint_used'
  | 'topic_opened'
  | 'session_start'
  | 'session_end'
  | 'mastery_updated'
  | 'solver_used';

export interface LearningEvent {
  id?: string;
  student_id: string;
  session_id: string;
  event_type: LearningEventType;
  topic_id?: string | null;
  question_id?: string | null;
  verb: string;
  object_type?: string | null;
  result?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  occurred_at?: string;
}

export interface SystemMetric {
  id?: string;
  metric_name: string;
  route?: string | null;
  value: number;
  tags?: Record<string, unknown> | null;
  recorded_at?: string;
}
