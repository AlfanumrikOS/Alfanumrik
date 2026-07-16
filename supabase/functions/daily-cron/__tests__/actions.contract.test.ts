import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts'
import { createDailyCronActions } from '../actions.ts'

Deno.test('daily-cron actions preserve names and expose auth/audit/metric labels', async () => {
  const names = [
    'streaks_reset','leaderboard_entries','parent_digests_sent','task_queue_rows_deleted','health_snapshot',
    'education_intelligence_rollup','ml_retrain_new_responses','performance_scores_recalculated','challenges_generated',
    'streaks_managed','lab_completions_logged','contract_reminders_sent','contracts_expired','contract_grace_audited',
    'monthly_synthesis_triggered','adaptive_remediation_triggered','foxy_expectations_expired','mol_shadow_pairs_graded',
    'purge_principal_ai','verification_delivery_checked',
  ] as const
  // `as unknown as` — the test intentionally exercises a SUBSET of the action
  // names; newer Deno/TS versions reject the direct cast (TS2352). Runtime
  // behavior is unchanged: createDailyCronActions maps over Object.keys.
  const runners = Object.fromEntries(names.map((name, index) => [name, () => Promise.resolve(index)])) as unknown as Parameters<typeof createDailyCronActions>[0]
  const actions = createDailyCronActions(runners)
  assertEquals(actions.map((action) => action.name), [...names])
  for (const action of actions) {
    assertEquals(action.requiresInternalCronAuth, true)
    assertEquals(action.auditLabel, action.name)
    assertEquals(action.metricLabel, action.name)
  }
  assertEquals(await actions[0].run({ sb: {} as never }), 0)
})
