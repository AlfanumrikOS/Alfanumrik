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

export type AlertType =
  | 'consecutive_wrong'
  | 'session_gap'
  | 'mastery_declining'
  | 'high_hint_usage'
  | 'time_on_task_low';

export type AlertSeverity = 'watch' | 'act' | 'urgent';

export interface InterventionAlert {
  id?: string;
  student_id: string;
  topic_id?: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  trigger_data?: Record<string, unknown> | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SystemMetric {
  id?: string;
  metric_name: string;
  route?: string | null;
  value: number;
  tags?: Record<string, unknown> | null;
  recorded_at?: string;
}
