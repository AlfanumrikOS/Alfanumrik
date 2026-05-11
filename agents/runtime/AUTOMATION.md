# Mesh Automation — daily autonomous cycles

The mesh runs autonomously via a GitHub Actions cron. Each scheduled run:

1. Pulls latest `main`
2. Verifies the kill switch ([mesh-automation.enabled](../../mesh-automation.enabled)) is present
3. Loads required secrets from GitHub Actions
4. Runs `npm run mesh:tick -- --commit --real-l1 --real-l2 --real-l4 --real-l6`
5. Uploads logs/worktree artifacts for 14 days

Cycles fire at **02:00 UTC daily** (07:30 IST). Adjust the cron expression in [`.github/workflows/mesh-cron.yml`](../../.github/workflows/mesh-cron.yml).

## Components

- **Cron**: `.github/workflows/mesh-cron.yml`
- **Kill switch**: `mesh-automation.enabled` (delete + push to disable)
- **Goal queue**: `public.cycle_goal_inbox` Supabase table — seed it for L1 to pick from
- **L1 worker**: `agents/runtime/layers/l1-meta.ts` (rule-based pick from inbox)
- **L2 worker**: `agents/runtime/layers/l2-orchestrator.ts` (Sonnet call with structured `submit_task` tool)
- **L4 worker**: `agents/runtime/layers/l4-code-agent.ts` (already shipped — Sonnet code_agent)
- **L6 worker**: `agents/runtime/layers/l6-critic.ts` (already shipped — Opus critic)

## One-time setup (do this once before enabling)

### 1. Apply the cycle_goal_inbox migration

The migration ships at [`supabase/migrations/20260516120000_cycle_goal_inbox.sql`](../../supabase/migrations/20260516120000_cycle_goal_inbox.sql). Apply it to your staging Supabase via the SQL editor (paste the file contents → Run).

### 2. Add GitHub Actions secrets

Settings → Secrets and variables → Actions → New repository secret. Add all three:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `STAGING_SUPABASE_URL` | `https://gzpxqklxwzishrkiaatd.supabase.co` |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | The `service_role` secret from staging Supabase → Settings → API |

### 3. Verify locally (optional but recommended)

```bash
cd Alfanumrik-repo
# .env.local must have staging credentials (see agents/runtime/README.md)
# Insert a test goal:
# (use the staging Supabase SQL editor)
# INSERT INTO cycle_goal_inbox (goal, priority, signal_source) VALUES
#   ('Test goal: add a simple comment to agents/runtime/README.md', 100, 'ceo');
npm run mesh:tick -- --commit --real-l1 --real-l2 --real-l4 --real-l6
```

This should pull your test goal from the inbox, hand it to L2 for decomposition, run L4 against a worktree, evaluate, and critique. The cycle ends with `aborted` (since the codebase has pre-existing L5 failures), but the full audit trail lands in `cycles` / `tasks` / `cycle_evaluations`.

### 4. Trigger the workflow manually

GitHub → Actions → "Mesh Autonomous Cron" → Run workflow. Verify it runs to completion. Once happy, the daily cron will fire on its own.

## Seeding the goal inbox

Goals are rows in `cycle_goal_inbox`. Insert via Supabase SQL editor:

```sql
INSERT INTO cycle_goal_inbox (
  goal, goal_rationale, signal_source, priority,
  risk_tier_hint, tenant_scope, non_goals, constraints,
  created_by
) VALUES (
  'Add a "Last seen" badge to the teacher avatar row.',
  'Pilot teachers requested at-a-glance presence indication. NPS 3/5.',
  'feedback',
  300,        -- higher priority than the default 100
  2,          -- non-schema code change
  'pilot',
  '["Do not change the avatar size", "Do not add a notification dot"]'::jsonb,
  '["Hindi parity required if the badge has text"]'::jsonb,
  'ceo@alfanumrik.com'
);
```

The next cron tick (or a manual `mesh:tick` run) picks this up.

## Kill switch (disable automation immediately)

```bash
# In the Alfanumrik repo:
git rm mesh-automation.enabled
git commit -m "ops: disable mesh automation cron"
git push
```

The next cron run sees the missing file, logs a warning, and exits cleanly. **No tokens spent.**

To re-enable: restore the file (`git revert` the disable commit, or recreate it).

## Cost & safety

- **Daily**: one cycle/day. No-op cycles ≈ $0.20–0.50. Real code cycles ≈ $0.50–$3.
- **Concurrency**: the workflow uses a `mesh-cron` concurrency group so multiple cron runs can't overlap.
- **Timeout**: 30 minutes per cycle, hard cap.
- **Staging only**: secrets point at staging Supabase, never prod.
- **Kill switch**: removing `mesh-automation.enabled` halts everything within one cron interval.
- **Per-cycle token budget**: enforced by L4 (`task.max_tokens`) — runaway agents abort.
- **Inbox-empty short-circuit**: if no pending goals, L1 returns null and the cycle exits before any LLM call.

## What an autonomous cycle looks like end-to-end

```
L0 cron fires at 02:00 UTC
 │
L1 (real) → pulls highest-priority pending goal from cycle_goal_inbox
 │         → marks status=in_progress, links cycle_id
 │
L2 (real, Sonnet) → reads CycleGoal + role prompt
 │                → calls submit_task with structured TaskAssignment
 │                → deterministic guards merge forbidden_paths defaults
 │
L3 (n/a — L4 reads files on demand via sandbox)
 │
L4 (real, Sonnet) → opens worktree, lists files, reads context,
 │                → writes any necessary changes via path-scoped tools
 │                → calls finish with structured summary
 │
L5 (real, in worktree) → unit_tests, type_check, lint, tenant_isolation
 │                     → writes verdicts to cycle_evaluations
 │
L6 (real, Opus) → reads diff + evals + rubric
 │              → calls submit_verdict with decision + reasoning
 │              → deterministic guards may override (R3.4, R2.*, R10.1)
 │
L7 → marks cycle complete (approve) or aborted (anything else)
   → resolves inbox row (done | needs_human | abandoned)
```

## What is NOT done yet (Phase γ scope)

- **L7 deploy automation**: cycles ending in `approve` mark `cycle.status='complete'` but don't actually push/merge/deploy. A human still ships the branch.
- **L3 Context Manager**: L4 reads files on demand; there's no curated context layer yet.
- **L8 Evolution**: lessons_learned isn't written automatically. Outcome attribution lives in the contract but no worker computes it yet.
- **Multi-task DAG decomposition**: L2 produces one task per cycle. Complex goals should be split into multiple inbox entries.
- **Pre-existing repo health**: `unit_tests` / `type_check` / `lint` evaluators fail on `main` for reasons unrelated to the mesh (vitest config import, tsc errors, ESLint config). Until these are fixed, every cycle ends in `reject` and the mesh never actually ships code.

## Audit trail

Everything is queryable from staging Supabase:

```sql
-- Latest cycle and its task:
SELECT id, goal, status, ended_reason, ended_at FROM cycles ORDER BY started_at DESC LIMIT 1;
SELECT * FROM tasks WHERE cycle_id = '<id>';
SELECT evaluator, verdict, notes FROM cycle_evaluations WHERE cycle_id = '<id>';

-- All goals the inbox has produced cycles for:
SELECT i.goal, i.status AS inbox_status, c.status AS cycle_status, c.ended_reason
FROM cycle_goal_inbox i LEFT JOIN cycles c ON c.id = i.cycle_id
ORDER BY i.created_at DESC LIMIT 20;
```
