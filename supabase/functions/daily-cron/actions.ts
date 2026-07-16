import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type DailyCronClient = ReturnType<typeof createClient>
export type DailyCronActionName =
  | 'streaks_reset'
  | 'leaderboard_entries'
  | 'parent_digests_sent'
  | 'task_queue_rows_deleted'
  | 'health_snapshot'
  | 'education_intelligence_rollup'
  | 'ml_retrain_new_responses'
  | 'performance_scores_recalculated'
  | 'challenges_generated'
  | 'streaks_managed'
  | 'lab_completions_logged'
  | 'contract_reminders_sent'
  | 'contracts_expired'
  | 'contract_grace_audited'
  | 'monthly_synthesis_triggered'
  | 'adaptive_remediation_triggered'
  | 'webhook_deliveries_dispatched'
  | 'foxy_expectations_expired'
  | 'mol_shadow_pairs_graded'
  | 'purge_principal_ai'
  | 'first_quiz_nudges_sent'
  | 'twin_snapshots_built'
  | 'coverage_audit_triggered'
  | 'question_bank_verify_triggered'
  | 'verification_delivery_checked'

export interface DailyCronActionContext {
  sb: DailyCronClient
}

export interface DailyCronAction {
  readonly name: DailyCronActionName
  readonly auditLabel: DailyCronActionName
  readonly metricLabel: DailyCronActionName
  readonly requiresInternalCronAuth: true
  run(ctx: DailyCronActionContext): Promise<number>
}

type DailyCronActionRunner = (sb: DailyCronClient) => Promise<number>
export type DailyCronActionRunners = Record<DailyCronActionName, DailyCronActionRunner>

export function createDailyCronActions(runners: DailyCronActionRunners): DailyCronAction[] {
  return (Object.keys(runners) as DailyCronActionName[]).map((name) => ({
    name,
    auditLabel: name,
    metricLabel: name,
    requiresInternalCronAuth: true,
    run: ({ sb }) => runners[name](sb),
  }))
}

export function recordDailyCronActionMetric(action: DailyCronAction, startedAtMs: number, status: 'fulfilled' | 'rejected'): void {
  console.log(JSON.stringify({
    event: 'daily_cron_action_metric',
    action: action.metricLabel,
    audit_label: action.auditLabel,
    status,
    elapsed_ms: Date.now() - startedAtMs,
  }))
}
