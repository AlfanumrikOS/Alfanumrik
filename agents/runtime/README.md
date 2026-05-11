# agents/runtime — mesh runtime (Phase β)

The runtime workers that drive the [agent mesh](../README.md). L4 `code_agent` ships as a **real** worker calling Anthropic via tool use; other layers (L1, L2, L6) remain stubs that exercise the contracts and substrate. Each stub is sized to be replaced one at a time without changing the surrounding wiring.

## What ships in this folder today

| File | What |
|---|---|
| `tick.ts` | One-shot orchestrator. Runs ONE cycle through all eight layers. |
| `env.ts` | Loads `.env.local` from repo root at tick entry. No dotenv dep. |
| `supabase.ts` | Service-role Supabase client + `ff_agent_mesh_v1` gate. |
| `anthropic.ts` | Minimal fetch wrapper for the Messages API + tool use (no SDK dep). |
| `sandbox.ts` | Path-scoped file ops. The firewall enforcing rubric §R2 (blast radius). |
| `worktree.ts` | Git worktree lifecycle: open (+ symlink node_modules), commit, diff-against-baseline, close. |
| `layers/l4-code-agent.ts` | Real L4 worker (sonnet). Agent loop with `list_files`/`read_file`/`write_file`/`finish` tools. |
| `layers/l6-critic.ts` | Real L6 worker (opus). One-shot call against diff + evals + rubric, decision via `submit_verdict` tool. Includes deterministic guards (blocking-eval override, Always-Escalate path override, R10.1 reasoning floor). |

## Run it

### Dry run (default) — no DB writes, no env vars required

```bash
npm run mesh:tick
```

Prints what would happen at each layer. Useful for sanity-checking the loop after editing prompts/contracts.

### Real run — writes to Supabase

```bash
# Requires:
#   - migration 20260511120000_agent_mesh_foundation.sql applied
#   - feature_flags.ff_agent_mesh_v1.is_enabled = true
#   - env vars: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

npm run mesh:tick -- --commit
```

Writes a row to `cycles`, one to `tasks`, one to `cycle_evaluations` (via the real `tenant_isolation` evaluator), then updates the cycle status. The full audit trail lives in those tables — read with `SELECT * FROM cycles ORDER BY created_at DESC LIMIT 1` etc.

### Override the goal

```bash
npm run mesh:tick -- --commit --goal "Reduce parent dashboard p95 latency below 800ms"
```

### Env setup (one-time)

The runtime expects `ANTHROPIC_API_KEY`, `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), and `SUPABASE_SERVICE_ROLE_KEY` in `process.env`. They live in Vercel — pull them once with:

```bash
vercel env pull .env.local --environment=development
```

The tick auto-loads `.env.local` on every run; no manual `export` needed after the pull. Existing `process.env` values win, so CI / one-off `KEY=… npm run …` still works.

### Real L4 + L6 (calls Anthropic — spends real tokens)

```bash
# Real L4 only (stub L6 critic):
npm run mesh:tick -- --commit --real-l4 --goal "Add a CHANGELOG.md entry for the mesh runtime"

# Real L4 + real L6 (the full LLM-mediated loop):
npm run mesh:tick -- --commit --real-l4 --real-l6 --goal "<your goal>"
```

Optional env: `MESH_GIT_AUTHOR` overrides the commit author (default: `"Alfanumrik Agent Mesh <mesh@alfanumrik.com>"`).

What happens:
1. L1 stub seeds a cycle row with your goal.
2. L2 stub creates one task with `agent_role='code_agent'` and a deliberately narrow `allowed_paths=['agents/runtime/**']`.
3. **Real L4** opens a git worktree at `.mesh-worktrees/<task-id-short>/`, calls Claude with the role prompt + the file tree, and lets the model use four tools (`list_files`, `read_file`, `write_file`, `finish`). Every file op is filtered through `sandbox.ts` — anything outside `allowed_paths` is rejected.
4. If files changed, the runtime commits them on a `auto/<cycle>/<role>/<task>` branch in the host repo. **It does not push.** The branch is yours to inspect/discard.
5. The worktree is removed after the task (the branch is preserved on the host repo for review).
6. L5 evaluators run against the worktree (or the host checkout — see [#known-limitations](#known-limitations)).
7. The L6 stub critic decides. For non-trivial real diffs you'll want the real L6 worker (next Phase β step); the stub's templated decision tree is best-effort only.

For the very first real run, use `--goal` text that the agent can satisfy with a no-op or near-no-op — the stub L2 still produces only one task with narrow `allowed_paths`. This is intentional: the safe surface to test the real L4 against is small.

## What each stub does (and what the real worker does/will do)

| Layer | Status | Behaviour |
|---|---|---|
| **L0 signal** | stub | none |
| **L1 meta** | stub | Hardcoded test goal (or `--goal` override) |
| **L2 task** | stub | Produces exactly one task with narrow `allowed_paths=['agents/runtime/**']` and the canonical 4 required evaluators |
| **L3 context** | stub | None — the L4 worker reads files on demand via the sandbox |
| **L4 swarm** | **real (code_agent, sonnet)** with `--real-l4` | Opens worktree, symlinks node_modules, calls Claude with role prompt + file tree, lets the model use 4 tools, commits diff locally. Other roles fall back to stub. |
| **L5 evals** | real (4 evaluators) | `unit_tests`, `type_check`, `lint`, `tenant_isolation`. Run inside the worktree when L4 is real, so they see the agent's diff. |
| **L6 critic** | **real (opus)** with `--real-l6` | One-shot Opus call against diff + evals + rubric, structured decision via `submit_verdict`. Deterministic post-guards override the model when needed: blocking-eval-fail → reject (R3.4); Always-Escalate path → escalate (R2/R4/R5); thin reasoning at risk_tier ≥ 2 → request_changes (R10.1). |
| **L7 deploy** | stub | Marks cycle `complete/shipped` or `aborted`. No real deploy. |
| **L8 evolve** | stub | None |

## Known limitations

- **Stub L2 caps the task to `allowed_paths=['agents/runtime/**']`.** Real L2 isn't shipped yet, so every `--real-l4` run can only touch the runtime folder. This is intentional Phase β safety — replace `l2_stub_decompose` when you want broader scope.
- **No PR is opened.** The agent commits locally; the human pushes/PRs manually.
- **Critic diff size limit: 2000 lines.** Diffs larger than that auto-escalate to a human reviewer without calling the model — the L6 prompt itself says it can't reliably review changes that big.

## Safety properties already in place

- **`--commit` is required** to write to the DB. Dry-run is the default — running with no flags can't corrupt state.
- **`--real-l4` requires `--commit`.** No point spending Anthropic tokens for a dry-run.
- **`ff_agent_mesh_v1` is checked first.** If the flag is OFF, the runtime refuses to run and prints why.
- **Env vars are validated at boot.** Missing creds (Supabase or Anthropic in `--real-l4` mode) → clear error, no silent no-op.
- **All writes go through `service_role`.** No end-user JWT is ever read or trusted.
- **`sandbox.ts` is the firewall.** Every L4 file op runs through `assertPathAllowed` + a realpath check that BOTH the target and the worktree root are realpath'd before comparison (catches Windows %TEMP% junctions and symlink escapes). Tested by 22 unit tests covering absolute paths, `../..` traversal, sneaky-`..`-into-forbidden, missing files, and listing filtration.
- **L4 has a hard turn limit** (`MAX_TURNS=30`) and **a token budget** (`TaskAssignment.max_tokens`) enforced on every loop iteration. A runaway agent aborts with `result='failed'` and a blocker note.
- **Files are read-capped at 200KB** to keep context bounded even if the agent asks for something huge.
- **No push, no PR open.** The runtime commits locally; pushing to the remote is always a human action.

## What is NOT safe yet

- The stub L4 cannot actually produce a change. If you replace it with a real agent before there are guardrails (rate limits, token budgets, branch isolation), the worker can run unbounded.
- The stub L6 does not catch sycophancy because there's no LLM to be sycophantic. The first real critic run needs the adversarial red-team agent already in place.
- The DB cleanup story is manual. If a cycle aborts mid-flight you have rows in `cycles` / `tasks` with `status='in_progress'`. There's no GC. Tracked as a Phase β follow-up.

## How to extend this

When the real worker for a layer is ready:

1. Implement the layer in its own module under `agents/runtime/layers/<name>.ts`.
2. Export the same shape as the corresponding stub function in `tick.ts`.
3. Replace the stub import in `tick.ts` with the real one.
4. Add tests under `src/__tests__/agents/runtime/`.
5. Do not change the contracts in `agents/contracts/` or the table shapes in the migration — those are the stable interface every layer relies on.

When adding a new evaluator:

1. Build it under `eval/<name>/` following the `tenant-isolation` pattern (wraps existing tooling, compares against a committed baseline, writes via `--task-id` / `--cycle-id`).
2. Add its slug to `agents/contracts/evaluation.schema.json`.
3. Extend the `l5_runEvaluators` switch in `tick.ts` to recognise it (until the real L5 worker replaces the switch with dynamic dispatch).
4. Update `agents/prompts/l2-task-orchestrator.md` evaluator-defaults table if it should be required for some roles.

## See also

- [agents/README.md](../README.md) — full mesh overview
- [agents/contracts/](../contracts/) — JSON Schemas for the hand-offs this runtime executes
- [agents/prompts/](../prompts/) — the prompts the stubs will be replaced by
- [governance/rubric.md](../../governance/rubric.md) — the law the L6 stub applies
- [supabase/migrations/20260511120000_agent_mesh_foundation.sql](../../supabase/migrations/20260511120000_agent_mesh_foundation.sql) — the substrate
