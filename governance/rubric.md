# Critic Rubric — Alfanumrik Agent Mesh

**Version:** v1.0.0
**Owner:** principal-architect + CEO (joint sign-off required for changes)
**Read by:** L6 Critic, on every decision. The `rubric_version` is stamped into every `CriticVerdict` for replay/audit.

This rubric is the law the Critic applies. It grows monotonically. Clauses can be added or strengthened freely; weakening or retiring a clause requires a written justification in the PR and human approval.

Clause IDs are stable. Never renumber. Retired clauses keep their ID with a `RETIRED:` marker so old verdicts remain interpretable.

---

## R1 — Truthfulness

- **R1.1** The `summary` in a `CompletedTask` must accurately describe the diff. Drift between prose and code is `reject`, not `request_changes`.
- **R1.2** Every claim in the `summary` ("this fixes X", "this is covered by tests") must be verifiable in the diff. No fabricated tests, no fabricated docs.
- **R1.3** If the agent says it consulted a `lessons_learned` claim, the relevant `lesson_id` must appear in `lessons_applied`. Empty `lessons_applied` on a pedagogy/content task is a `request_changes`.

## R2 — Blast-radius firewall

- **R2.1** Only `schema_agent` may edit `supabase/migrations/**`. Any other role doing so is `reject` regardless of test results.
- **R2.2** No agent may edit `/agents/prompts/**`, `/agents/contracts/**`, or `/governance/**` except `evolution_agent`, and even then only with `escalate_to_human`.
- **R2.3** No agent may flip a feature flag from `is_enabled=false` to `is_enabled=true` for any tenant other than the Cusiosense house tenant without `escalate_to_human`.
- **R2.4** Files outside `allowed_paths` in a `TaskAssignment` are an automatic `reject` even if the change looks reasonable.

## R3 — Tenant isolation

- **R3.1** Every new SQL query that selects from a tenant-scoped table must filter by `school_id` (or equivalent tenant key). The Critic must read the query and confirm.
- **R3.2** New RLS policies must include an explicit `TO <role>` clause. `USING (true)` without role scoping is `reject`.
- **R3.3** Service-role keys may not appear in client code, even temporarily. Any import of `supabase-admin` in `src/components/**` or `src/app/**/page.tsx` is `reject`.
- **R3.4** `tenant_isolation` evaluator failures are always blocking, regardless of `risk_tier`. There is no scenario in which the Critic approves over a failing `tenant_isolation` verdict.

## R4 — Pedagogy & learner safety

- **R4.1** Changes to adaptive logic, mastery thresholds, difficulty curves, or hint phrasing always `escalate_to_human` to `pedagogy_lead`.
- **R4.2** Learner-facing copy that references emotions, abilities, or socio-economic status must be reviewed by `pedagogy_lead` even if `red_team` passes.
- **R4.3** A `learning_eval` warn on a content change is treated as a fail. Children are not synthetic learners; a confused synthetic learner is a real signal.
- **R4.4** No agent may write to `lessons_learned` directly. Only the L8 flow, with human approval, may insert rows.
- **R4.5** AI features the learner can trigger (`foxy-tutor`, `ncert-solver`, `cme-engine`, etc.) ship behind a per-tenant feature flag for at least one canary tenant before broader rollout.

## R5 — Compliance (India-specific)

- **R5.1** Any change that collects, stores, or processes personal data must cite the DPDP Act basis (consent vs. legitimate interest) in the `summary`. Missing citation = `request_changes`.
- **R5.2** Age-gating: features intended for grades 6–8 vs. 9–12 must specify the audience in `summary`. Default audience is "no audience claim", which is allowed only for non-learner-facing changes.
- **R5.3** Razorpay / billing changes always `escalate_to_human` to `ceo`. There is no `risk_tier` low enough to bypass.
- **R5.4** Pre-debit / mandate communications must follow `docs/runbooks/rbi-pre-debit-compliance.md` exactly. Any deviation = `reject`.

## R6 — Reversibility

- **R6.1** Every PR must be revertable by a single `git revert` without manual cleanup. PRs that bundle schema migrations with code in a way that makes revert dangerous are `request_changes`.
- **R6.2** Migrations must include a DOWN comment block (matches the house style in `supabase/migrations/`). Missing DOWN = `request_changes`.
- **R6.3** Feature flags default to `is_enabled=false` on insert. Migrations that ship a flag in the ON state are `reject` unless the flag is explicitly a kill switch.

## R7 — Honest scope

- **R7.1** "Minor refactor" / "cleanup" / "improve quality" are not acceptable goals or summaries in this system. Every change ships in service of a stated `CycleGoal`. If a refactor is incidental, the `summary` must say why it was needed and stay under ~50 lines; otherwise split it out.
- **R7.2** Adding features, abstractions, or future-proofing not required by the `CycleGoal` is `request_changes`. The mesh ships what was asked for, not what could be built.
- **R7.3** Tests that exercise behaviour outside the `CycleGoal` are fine; tests added "for coverage" with no behavioural claim are `request_changes`.

## R8 — Observability

- **R8.1** New user-facing surfaces must emit PostHog events with names matching the project's tracking-plan conventions (see `.telemetry/tracking-plan.yaml` if present, otherwise `docs/posthog-integration.md`). Missing instrumentation on a new surface = `request_changes`.
- **R8.2** New Edge Functions must register in Sentry. Missing Sentry init = `request_changes`.
- **R8.3** The `outcome_metrics` row for the cycle must reference a metric the new code actually emits, or a pre-existing one we already track. Phantom metrics = `reject`.

## R9 — Cost discipline

- **R9.1** Cycles that exceed `budget_tokens` automatically `abort`. The Critic does not approve a final task for an over-budget cycle without `escalate_to_human`.
- **R9.2** New LLM calls added to the runtime path (not the build pipeline) must declare the model tier and an upper-bound cost-per-call estimate in the `summary`.

## R10 — Sycophancy & self-checks

- **R10.1** A `reasoning` shorter than ~200 words on a `risk_tier ≥ 2` task is suspicious by default. The next critic version inspecting the audit log will downgrade this critic's `win_rate`.
- **R10.2** "Looks good" / "LGTM" / "no issues found" without specifics is a critic failure. The Evolution Agent flags rubrics of this shape during prompt evolution.
- **R10.3** Approving over a blocking failure is a P0 incident. The Critic prompt is force-rotated and a postmortem cycle opens automatically.

---

## Versioning

| Version | Date | Author | Change |
|---|---|---|---|
| v1.0.0 | 2026-05-11 | principal-architect | Initial rubric for Phase α of the agent mesh. |

### How to change this rubric

1. Open a PR editing this file. Increment the version. Add a row to the version table with the rationale.
2. The PR is itself reviewed by L6 Critic (recursive, fine) and ALWAYS `escalate_to_human` per R2.2.
3. CEO + principal-architect sign-off required. Linked from the version row.
4. After merge, `agents/prompts/l6-critic.md` is unchanged; it references the rubric file by path and reads the head version at decision time. The CriticVerdict records `rubric_version` so prior decisions remain interpretable.
