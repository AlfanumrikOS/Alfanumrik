# eval/_lib — shared evaluator patterns

Shared library code for L5 evaluators. Two patterns are codified here today:

## 1. Command wrapper (this directory ships it)

[`command-evaluator.ts`](./command-evaluator.ts) — turns any "run this command and check the exit code" into a contract-shaped `EvaluationVerdict`. Used by:

- [eval/unit-tests/](../unit-tests) — wraps `npm test`
- [eval/type-check/](../type-check) — wraps `tsc --noEmit`
- [eval/lint/](../lint) — wraps `eslint src/`
- (future: `bundle_size`, perf budgets, parity checks)

To add a new command-wrapped evaluator, the thin script is ~10 lines:

```typescript
// eval/my-evaluator/run.ts
import { runCommandEvaluator } from '../_lib/command-evaluator';

void runCommandEvaluator({
  evaluator: 'my_evaluator',
  command: 'npm',
  args: ['run', 'my-check'],
  blocking: true,
});
```

Then:
1. Add `'my_evaluator'` to the `evaluator` enum in [`agents/contracts/evaluation.schema.json`](../../agents/contracts/evaluation.schema.json).
2. Add an `eval:my-evaluator` script to `package.json`.
3. Add the slug to the `EVALUATOR_SCRIPTS` map in [`agents/runtime/tick.ts`](../../agents/runtime/tick.ts).
4. Decide which `agent_role` defaults should require it ([`agents/prompts/l2-task-orchestrator.md`](../../agents/prompts/l2-task-orchestrator.md) table).

## 2. Baseline-diff (sibling pattern, separate file per evaluator)

When an evaluator scans the whole codebase and you only want to fail on **regressions** vs. a committed baseline, follow the [`eval/tenant-isolation/`](../tenant-isolation) pattern instead. It has its own `baseline.json` and the verdict logic compares current findings against that.

The two patterns share these contract guarantees:

- Verdict shape matches [`agents/contracts/evaluation.schema.json`](../../agents/contracts/evaluation.schema.json).
- Opt-in mesh write via `--task-id <uuid> --cycle-id <uuid>` (requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars).
- `--json` for machine-readable verdict to stdout.
- Exit codes: `0` pass/warn · `1` fail · `2` internal error.

## Why a shared library, not bespoke scripts

The L6 critic reads `cycle_evaluations` rows by `(task_id, evaluator)` and applies the rubric. If every evaluator emitted a slightly different shape, the critic would need special-casing logic and the audit trail would lose comparability. Forcing all evaluators through the same contract keeps the critic prompt simple and the substrate queryable.
