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

The thresholds below apply to **student-facing traffic** (`surface` IS NOT NULL — foxy, quiz, solver, ocr). See the Phase 1A admin-functions table below for admin-traffic thresholds.

| Condition                                 | Action |
|-------------------------------------------|--------|
| Fallback rate > 5% over 1h                | Check provider status pages. If one provider is down, the breaker should already be routing around it — verify with `select provider, count(*) from mol_request_logs where created_at > now() - interval '1 hour' group by 1`. |
| p95 latency > 4000ms                      | Likely upstream slowdown. Reduce `max_tokens` temporarily (env override) or shift to faster model. |
| Daily cost > ₹2000 (10x baseline)         | Check for runaway loop or dropped prompt-caching. Top offenders: `tsx scripts/mol-cost-report.ts --hours=24`. |
| Circuit breaker OPEN > 5 min              | Manual reset: redeploy the Edge function (workers restart, breaker state is per-worker). |

### Alerts — Phase 1A admin functions (`ff_mol_admin_functions_v1`)

Scope: rows in `mol_request_logs` where `task_type IN ('quiz_generation','concept_explanation','explanation','evaluation')` AND `surface IS NULL` (the admin namespace).

| Condition | Action |
|---|---|
| Anthropic-fallback rate > 10% over 1h (per function) | OpenAI degradation. Check OpenAI status page. If sustained > 30 min, flip the kill switch (see "Rollback for Phase 1A admin functions"). 10% threshold is higher than the 5% student-path threshold because admin workloads tolerate provider hiccups (async, retriable). |
| Anthropic-fallback rate > 25% over 15m (any function) | Hard alarm — OpenAI likely down for our key. Flip kill switch immediately, do not wait. |
| p95 latency > 8000ms for `quiz_generation` or `evaluation` (1h window) | Admin generation jobs are long-form; 4000ms threshold doesn't apply. Investigate model overload or prompt-cache miss. |
| p95 latency > 4000ms for `concept_explanation` or `explanation` (1h window) | Short-form admin calls — same threshold as student path. |
| Daily admin-function cost > ₹250 | Phase 1A baseline target is ~₹100-150/day (85-90% saving vs ~₹1200 Haiku equivalent). ₹250 = something is wrong (loop, dropped prompt-cache, or fallback storm to Haiku). Old ₹2000 threshold is now stale and will never fire for admin traffic. |
| `ff_mol_admin_functions_v1` flips to disabled unexpectedly | Audit trail check — who toggled it and why. The flag is the kill switch, but unexpected flips during an incident need a paper trail. |

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

> **Until C4 lands (current state, 2026-05-18 onward)**: `mol_request_logs.request_id`
> is a synthetic UUID minted per MOL call and is NOT the same as the
> `grounded_ai_traces.id` (trace_id) that the UI surfaces to support staff. To
> correlate a student-reported issue to its MOL log row, fuzzy-match on
> `(student_id, created_at ± 5 seconds, surface)`. A direct JOIN will become
> available once C4 adds a `trace_id` column to `mol_request_logs`.

## Cost-cap behavior

When `ff_mol_cost_cap_inr` is enabled (`rollout_percentage` field is overloaded as the ₹ cap value), the router refuses to use premium models if the projected cost (rough estimate from input length × output cap × output price) exceeds the cap. The fallback provider/model is used instead. Logged in `failure_chain` as `<provider>:cost_cap`.

## Functions routed through MoL (Phase 1A — 2026-05-24)

The OpenAI cost-reduction initiative migrated the following admin-only / async Edge Functions from direct `fetch('https://api.anthropic.com/v1/messages', ...)` to `generateResponse()`. All six force OpenAI gpt-4o-mini as the primary via `config.preferred_provider: 'openai'`; Claude Haiku auto-falls-back via the existing router chain. Each preserves its existing content-validation step AFTER the MoL call (P6 / P12 invariants are not relaxed).

| Function | task_type | Trigger | P6 validator |
|---|---|---|---|
| `bulk-question-gen` (legacy single-pass + oracle grader) | `quiz_generation` / `evaluation` | admin POST | `isValidQuestion` + `validateCandidate` |
| `bulk-non-mcq-gen` | `quiz_generation` | admin POST | `isValidQuestion(qType)` per SA/LA |
| `generate-concepts` | `concept_explanation` | admin x-admin-key POST | `parseConceptsResponse` |
| `generate-answers` | `explanation` | admin x-admin-key POST | `parseAnswerResponse` |
| `extract-ncert-questions` | `quiz_generation` | admin x-admin-key POST | `parseExtractedQuestions` |
| `parent-report-generator` | `evaluation` | parent JWT POST (1/day rate-limited) | `buildFallbackReport` template fallback if MoL or JSON parse fails |

Telemetry lives in `mol_request_logs` keyed by the synthetic admin namespace `admin-<function>-<grade>-<subject>` (or the real `student_id` for parent-report-generator). Cost saving: ~85–90% per call vs Haiku 4.5 baseline.

Known minor drift: the legacy path forced `temperature: 0.3` (factual generation, P12). MoL providers default to `temperature: 0.7`. Acceptable because all six callers run their own post-LLM validators that reject malformed/off-shape output. Tracked for follow-up — add `config.temperature_override` to `GenerateRequest` so factual paths can opt back to 0.3.

## Rollback for Phase 1A admin functions

The Phase 1A migration routes 6 admin/async Edge Functions through MoL with OpenAI primary. To rollback INSTANTLY (no redeploy) if OpenAI is producing bad output:

```sql
update public.feature_flags
   set is_enabled = false,
       metadata = metadata || jsonb_build_object('kill_switch', true, 'enabled', false),
       updated_at = now()
 where flag_name = 'ff_mol_admin_functions_v1';
```

After the 5-minute flag cache TTL, all 6 functions revert to direct Anthropic-API calls (Claude Haiku 4.5). Functions affected:
- bulk-question-gen
- bulk-non-mcq-gen
- generate-concepts
- generate-answers
- extract-ncert-questions
- parent-report-generator

Re-enable by reversing the update (`is_enabled=true, metadata.kill_switch=false, metadata.enabled=true`):

```sql
update public.feature_flags
   set is_enabled = true,
       metadata = metadata || jsonb_build_object('kill_switch', false, 'enabled', true),
       updated_at = now()
 where flag_name = 'ff_mol_admin_functions_v1';
```

Kill-switch precedence (highest first), implemented in `supabase/functions/_shared/mol/admin-rollback-flag.ts`:
1. `metadata.kill_switch === true` → legacy path
2. `typeof metadata.enabled === 'boolean'` → that value
3. else → `is_enabled` column

Defensive default: on any flag-read failure (Supabase unreachable, JSON parse error, etc.) the helper returns `false` — i.e. legacy path. This means a flag-service outage temporarily costs us OpenAI savings but NEVER routes to OpenAI when ops thinks the switch is off.

Note: this is independent of the older per-function rollback technique (revert the file or change `config.preferred_provider`). The flag is the preferred control because it ships instantly and uniformly across all 6 functions. File reverts remain as a Plan B for permanent rollback.
