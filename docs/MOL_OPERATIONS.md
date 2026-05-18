# MOL Operations Runbook

## Daily checks

1. Open Super-admin → Platform health → MOL panel.
2. Verify the 24h table:
   - p95 latency < 2000ms (single), < 3500ms (hybrid).
   - Fallback rate < 2%.
   - Total cost trend within ±15% of yesterday.

Or from the CLI:
```bash
tsx scripts/mol-cost-report.ts --hours=24
```

## Rollout playbook

**Initial canary** (after staging green):
1. Set `ff_mol_enabled.rollout_percentage = 1` in admin UI.
2. Watch the cohort for 4 hours. Look for: p95 spike, fallback rate spike, user complaints.
3. If clean: ramp to 10% → 25% → 50% → 100% in 12-hour windows.

**Backout**:
- One toggle: `ff_mol_enabled.is_enabled = false`. Legacy path resumes immediately (5-min cache TTL).
- No code rollback needed.

## Alerts

| Condition                                 | Action |
|-------------------------------------------|--------|
| Fallback rate > 5% over 1h                | Check provider status pages. If one provider is down, the breaker should already be routing around it — verify with `select provider, count(*) from mol_request_logs where created_at > now() - interval '1 hour' group by 1`. |
| p95 latency > 4000ms                      | Likely upstream slowdown. Reduce `max_tokens` temporarily (env override) or shift to faster model. |
| Daily cost > ₹2000 (10x baseline)         | Check for runaway loop or dropped prompt-caching. Top offenders: `tsx scripts/mol-cost-report.ts --hours=24`. |
| Circuit breaker OPEN > 5 min              | Manual reset: redeploy the Edge function (workers restart, breaker state is per-worker). |

## Adding a new provider

1. Create `supabase/functions/_shared/mol/providers/<name>.ts` implementing `ModelProvider`.
2. Add `<name>` entries to `PRICING` in `telemetry.ts` AND to `model_pricing` migration.
3. Add `<name>` to the `providers` map in `index.ts`.
4. Extend `router.ts` `BASE_MATRIX` if it should be a primary anywhere.
5. Add the API key env var to Supabase Edge secrets.
6. Add a test stub mirroring `providers-anthropic.test.ts`.

## Updating prices

1. Update `model_pricing` rows via migration (do not UPDATE in-place — migration trail is the audit).
2. Update `PRICING` constant in `telemetry.ts` to match.
3. Ship both in one PR.

## Debugging a single bad answer

The student's response carries `request_id`. Lookup:
```sql
select * from public.mol_request_logs where request_id = '<id>';
select * from public.ai_tutor_logs where mol_request_id = '<id>';
```
Cross-reference the prompt by joining the chat session.

## Cost-cap behavior

When `ff_mol_cost_cap_inr` is enabled (`rollout_percentage` field is overloaded as the ₹ cap value), the router refuses to use premium models if the projected cost (rough estimate from input length × output cap × output price) exceeds the cap. The fallback provider/model is used instead. Logged in `failure_chain` as `<provider>:cost_cap`.
