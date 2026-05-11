# tenant_isolation — L5 Evaluator

The first concrete evaluator wired into the [agent mesh](../../agents/README.md). Today it also works standalone as a CI gate. Tomorrow, when the mesh runtime ships, it will additionally write its verdict to `public.cycle_evaluations` for the L6 Critic to read.

## What it does

Reuses the mature static heuristic in [`scripts/audit-tenant-isolation.ts`](../../scripts/audit-tenant-isolation.ts) (which classifies every `src/app/api/**/route.ts` into SAFE / REVIEW / NO_TENANT_SCOPING / NO_AUTH) and turns the result into an [`EvaluationVerdict`](../../agents/contracts/evaluation.schema.json) keyed against a checked-in baseline.

A finding is a **regression** if either:

- A new route lands in anything worse than `SAFE`, OR
- An existing route moves to a strictly worse bucket than the baseline records.

Severity order: `SAFE < REVIEW < NO_TENANT_SCOPING < NO_AUTH`.

The evaluator is **always blocking** ([governance/rubric.md §R3.4](../../governance/rubric.md)). A `fail` verdict means the change cannot be approved, period.

## Why a baseline

The underlying audit reports findings against the entire API surface. On a fresh run there are already legacy REVIEW/NO_AUTH rows. Failing CI on those would block every PR. The baseline ([`baseline.json`](./baseline.json)) is the "known accepted today" snapshot — only deltas worse than the baseline fail.

## Usage

```bash
# CI mode — no mesh write, just a verdict + exit code.
npm run eval:tenant-isolation

# JSON to stdout (for piping into the runtime later).
npm run eval:tenant-isolation -- --json

# Regenerate the baseline after a deliberate cleanup or new public-by-design
# route. Review the diff carefully before committing.
npm run eval:tenant-isolation:baseline

# Mesh mode — writes a row to public.cycle_evaluations and returns the same
# verdict. Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
npx tsx eval/tenant-isolation/run.ts \
  --task-id  <task uuid> \
  --cycle-id <cycle uuid>
```

Exit codes: `0` pass/warn · `1` fail · `2` internal error.

## First-run bootstrap

The committed `baseline.json` starts as `[]`. The first time anyone runs the evaluator, every non-SAFE route in the audit shows up as a regression. To onboard:

1. Run `npm run eval:tenant-isolation:baseline` to write the current state into `baseline.json`.
2. Read the diff. **Every route in there is a decision the team is implicitly accepting.** If a NO_AUTH appears, decide whether to fix it now or accept it explicitly.
3. Commit `baseline.json`. From now on, only **new** regressions fail the gate.

## Acceptance criteria for changes to `baseline.json`

The baseline is **moat-critical** — it is the "what we accept" snapshot. Per [rubric R2.2](../../governance/rubric.md) any edit to it is `escalate_to_human`. Reviewers must check that:

- No route moves from a stricter bucket to a looser one without an accompanying code fix.
- New entries with bucket ≠ SAFE include a justification in the PR description.
- The diff is the output of `--regenerate-baseline`, not hand-edited.

## How this hooks into the agent mesh

1. **L2 Task Orchestrator** adds `tenant_isolation` to a task's `evaluators_required` (already the default for every role — see `agents/prompts/l2-task-orchestrator.md`).
2. **L4 execution agent** completes the task, opens a PR, marks `tasks.status = 'succeeded'`.
3. **CI runs this evaluator** with `--task-id` and `--cycle-id`. The verdict is upserted into `cycle_evaluations` (the unique constraint `(task_id, evaluator)` makes re-runs idempotent).
4. **L6 Critic** reads `cycle_evaluations` for the task. If `verdict='fail' AND blocking=true`, the critic decision is `reject` — no exceptions (rubric R3.4).

When the runtime is not yet enabled (Phase α), step 3 reduces to "CI runs the evaluator and the build fails on regression" — useful immediately, no mesh required.

## What this evaluator does NOT do

- **Does not validate RLS policies in migrations.** A separate `schema_isolation` evaluator should cover that for `schema_agent` tasks. Open follow-up.
- **Does not catch tenant leakage inside Edge Functions.** The audit only walks `src/app/api/**`. Edge Functions need their own evaluator.
- **Does not parse SQL in helper files.** A query that scopes by `school_id` deep inside an imported helper looks like "no tenant scoping" in the heuristic — manage via the EXPLICIT_WAIVERS list in the audit script, not by relaxing this evaluator.

These are deliberate Phase α scope cuts. The Critic's prompt already escalates schema and AI-surface changes to humans, which covers the gap.

## See also

- [governance/rubric.md §R3](../../governance/rubric.md)
- [agents/contracts/evaluation.schema.json](../../agents/contracts/evaluation.schema.json)
- [agents/prompts/l6-critic.md](../../agents/prompts/l6-critic.md)
- [scripts/audit-tenant-isolation.ts](../../scripts/audit-tenant-isolation.ts)
