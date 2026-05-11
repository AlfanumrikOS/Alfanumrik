-- Migration: 20260511120000_agent_mesh_foundation.sql
-- Purpose: Phase α of the multi-agent build/evolve mesh. Introduces the six
--          tables that form the state substrate the agent mesh coordinates
--          through. No agent runtime is shipped here — this migration only
--          lays the persistence layer so the agents (defined in /agents/) have
--          a single source of truth to read/write through the existing
--          supabase-admin client.
--
-- The eight conceptual layers (L0 signal → L8 evolution) and the agent roster
-- are documented in /agents/README.md. This migration concerns only the
-- durable state behind layers L1, L2, L5, L6, L7, L8.
--
-- Tables (all under public, all RLS-enabled, all service_role only by
-- default — agents NEVER receive user JWTs; they run server-side and write
-- through service_role only):
--
--   cycles            One row per build/evolve cycle. Owns the cycle goal,
--                     budget, status, and links to the originating signal.
--   tasks             DAG of work inside a cycle. parent_task_id supports
--                     decomposition; one row per agent assignment.
--   cycle_evaluations Evaluator verdicts attached to tasks. Multiple rows per
--                     task (one per evaluator: tests, learning-eval, perf, …).
--   lessons_learned   Semantic memory. Atomic claims distilled from outcomes;
--                     consulted by the Context Manager on every future cycle.
--   outcome_metrics   Per-cycle, per-tenant before/after deltas with
--                     statistical-significance flag. Drives causal attribution.
--   agent_prompts     Versioned prompts for every agent role. win_rate is
--                     written by the Evolution Agent; retired_at is set when
--                     a successor variant is promoted.
--
-- Design choices:
--   - Status values are CHECK-constrained text rather than enums. Mirrors the
--     project's preference (e.g. tenant_modules.module_key) for code-owned
--     vocabularies that can ship without a DB migration. The allowed set is
--     small, documented inline, and validated at the call site.
--   - All bodies of agent reasoning (plans, diffs, eval evidence) live in jsonb
--     or in external storage referenced by URL. The DB stores structure, not
--     prose, so the tables stay queryable.
--   - cycle_id is denormalised onto tasks, cycle_evaluations, outcome_metrics
--     to keep the most common queries ("everything for cycle X") a single
--     indexed lookup. The integrity constraint on tasks.cycle_id covers the
--     rest.
--   - lessons_learned and agent_prompts have no cycle_id because they are
--     cross-cycle artefacts. lessons_learned references the originating cycle
--     via source_cycle_id (nullable — some lessons come from humans/audits).
--
-- RLS policy stance:
--   - service_role: full access on every table. This is the ONLY role with
--     access. The agent runtime uses supabase-admin (service_role) exclusively.
--   - authenticated/anon: no access. There is no end-user surface for these
--     tables; a future internal CEO dashboard will read via a server-only
--     route that already runs as service_role.
--   - super_admin RLS bypass is intentionally NOT added here. Even super_admin
--     users browsing the DB directly would have no reason to mutate cycle
--     state, and locking writes to service_role prevents accidental corruption
--     of an in-flight cycle from a Studio session.
--
-- This migration creates the tables, indexes, triggers, RLS policies, and
-- seeds the gating feature flag ff_agent_mesh_v1 = OFF. It seeds NO rows in
-- the agent tables themselves; the first cycle is created by the L1 runtime
-- once the flag is enabled.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.outcome_metrics    CASCADE;
--   DROP TABLE IF EXISTS public.cycle_evaluations  CASCADE;
--   DROP TABLE IF EXISTS public.tasks              CASCADE;
--   DROP TABLE IF EXISTS public.lessons_learned    CASCADE;
--   DROP TABLE IF EXISTS public.agent_prompts      CASCADE;
--   DROP TABLE IF EXISTS public.cycles             CASCADE;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_agent_mesh_v1';

-- ── 0. set_updated_at lookup (defensive — matches the tenant_modules pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

-- ── 1. cycles ───────────────────────────────────────────────────────
-- One row per build/evolve cycle. The L1 Meta-Orchestrator writes the goal +
-- budget; the L2 Task Orchestrator transitions status as the cycle progresses.
CREATE TABLE IF NOT EXISTS public.cycles (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal              text        NOT NULL,
  goal_rationale    text,
  signal_source     text,                       -- 'ceo' | 'feedback' | 'evolution' | 'incident' | 'ad-hoc'
  status            text        NOT NULL DEFAULT 'planning',
  risk_tier         smallint    NOT NULL DEFAULT 2,
  budget_tokens     integer     NOT NULL DEFAULT 2000000,
  tokens_spent      integer     NOT NULL DEFAULT 0,
  target_metric     text,                       -- e.g. 'teacher_dashboard_weekly_active'
  target_delta      numeric,                    -- e.g. 0.30 for +30%
  goal_full         jsonb       NOT NULL DEFAULT '{}'::jsonb,
                                                -- The complete CycleGoal payload (matches
                                                -- /agents/contracts/cycle-goal.schema.json).
                                                -- Promoted columns above are denormalised
                                                -- copies for indexing; goal_full is the
                                                -- source of truth for fields like
                                                -- non_goals, constraints, tenant_scope,
                                                -- lessons_to_respect, deadline.
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  ended_reason      text,                       -- 'shipped' | 'aborted' | 'budget' | 'escalated'
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cycles_status_allowed CHECK (
    status IN ('planning','executing','evaluating','reviewing','shipping','complete','aborted')
  ),
  CONSTRAINT cycles_risk_tier_range CHECK (risk_tier BETWEEN 1 AND 5),
  CONSTRAINT cycles_budget_nonneg   CHECK (budget_tokens >= 0 AND tokens_spent >= 0),
  CONSTRAINT cycles_ended_consistency CHECK (
    (ended_at IS NULL  AND ended_reason IS NULL) OR
    (ended_at IS NOT NULL AND ended_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.cycles IS
  'Build/evolve cycles. One row per Cycle Goal. Status values are owned by '
  'agents/prompts/l2-task-orchestrator.md; risk_tier (1=copy/UI, 5=schema/'
  'pedagogy/policy) is owned by agents/prompts/l6-critic.md.';

CREATE INDEX IF NOT EXISTS idx_cycles_status_started
  ON public.cycles (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cycles_open
  ON public.cycles (started_at DESC)
  WHERE ended_at IS NULL;

DROP TRIGGER IF EXISTS trg_cycles_updated_at ON public.cycles;
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON public.cycles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. tasks ────────────────────────────────────────────────────────
-- The DAG of work inside a cycle. parent_task_id supports L2's decomposition;
-- a NULL parent_task_id is a top-level epic. agent_role is the execution-swarm
-- role that owns the task (see /agents/README.md §4 for the roster).
CREATE TABLE IF NOT EXISTS public.tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        uuid        NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  parent_task_id  uuid                 REFERENCES public.tasks(id)  ON DELETE CASCADE,
  agent_role      text        NOT NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'queued',
  branch          text,                          -- git branch the agent is working on
  pr_url          text,                          -- GitHub PR once opened
  inputs          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  outputs         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  blocker_note    text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_agent_role_format CHECK (
    agent_role ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT tasks_status_allowed CHECK (
    status IN ('queued','in_progress','blocked','succeeded','failed','cancelled')
  ),
  CONSTRAINT tasks_completed_consistency CHECK (
    (completed_at IS NULL) OR (status IN ('succeeded','failed','cancelled'))
  ),
  CONSTRAINT tasks_no_self_parent CHECK (parent_task_id IS DISTINCT FROM id)
);

COMMENT ON TABLE public.tasks IS
  'Per-cycle task DAG. agent_role values are owned by /agents/README.md; '
  'allowed values are not enforced at the DB layer so new agents can ship '
  'without a migration.';

CREATE INDEX IF NOT EXISTS idx_tasks_cycle_status
  ON public.tasks (cycle_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_open
  ON public.tasks (cycle_id, agent_role)
  WHERE status IN ('queued','in_progress','blocked');

CREATE INDEX IF NOT EXISTS idx_tasks_parent
  ON public.tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. cycle_evaluations ────────────────────────────────────────────
-- Evaluator verdicts on tasks. Multiple rows per task — one per evaluator.
-- The L6 Critic reads these to decide approve/reject. `blocking` lets a
-- specific evaluator's failure short-circuit the critic's decision (e.g.
-- tenant-isolation failures are always blocking).
CREATE TABLE IF NOT EXISTS public.cycle_evaluations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid        NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  task_id       uuid        NOT NULL REFERENCES public.tasks(id)  ON DELETE CASCADE,
  evaluator     text        NOT NULL,
  verdict       text        NOT NULL,
  blocking      boolean     NOT NULL DEFAULT true,
  evidence_url  text,                          -- link to test report / eval run
  evidence      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes         text,
  evaluated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cycle_evaluations_evaluator_format CHECK (
    evaluator ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT cycle_evaluations_verdict_allowed CHECK (
    verdict IN ('pass','fail','warn','skipped')
  ),
  CONSTRAINT cycle_evaluations_unique_per_task UNIQUE (task_id, evaluator)
);

COMMENT ON TABLE public.cycle_evaluations IS
  'Evaluator verdicts attached to tasks. Evaluator slugs (unit_tests, '
  'learning_eval, tenant_isolation, accessibility, red_team, …) are owned '
  'by /agents/contracts/evaluation.schema.json.';

CREATE INDEX IF NOT EXISTS idx_cycle_evaluations_cycle
  ON public.cycle_evaluations (cycle_id, verdict);

CREATE INDEX IF NOT EXISTS idx_cycle_evaluations_failing
  ON public.cycle_evaluations (cycle_id)
  WHERE verdict = 'fail' AND blocking = true;

-- ── 4. lessons_learned ──────────────────────────────────────────────
-- Semantic memory. Atomic claims distilled from outcomes. Read by the Context
-- Manager on every cycle to gate Pedagogy/Content/UX decisions. Writes are
-- gated by the L6 Critic + a human reviewer (enforced in application code;
-- the DB stays permissive within service_role so the critic can write).
CREATE TABLE IF NOT EXISTS public.lessons_learned (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_cycle_id   uuid                 REFERENCES public.cycles(id) ON DELETE SET NULL,
  claim             text        NOT NULL,
  applies_when      text        NOT NULL,            -- scoping predicate in plain prose
  evidence          jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- array of {kind,url,note}
  confidence        text        NOT NULL DEFAULT 'low',
  retired_at        timestamptz,
  retired_reason    text,
  approved_by       text,                            -- human approver id/email
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessons_learned_confidence_allowed CHECK (
    confidence IN ('low','medium','high')
  ),
  CONSTRAINT lessons_learned_retired_consistency CHECK (
    (retired_at IS NULL AND retired_reason IS NULL) OR
    (retired_at IS NOT NULL AND retired_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.lessons_learned IS
  'Semantic memory. Atomic claims like "Hindi-medium learners in grades 6-8 '
  'disengage when feedback uses Sanskrit-loaded vocabulary." Writes require '
  'critic + human approval (enforced in application code, not DB).';

CREATE INDEX IF NOT EXISTS idx_lessons_learned_active
  ON public.lessons_learned (confidence, created_at DESC)
  WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lessons_learned_source_cycle
  ON public.lessons_learned (source_cycle_id)
  WHERE source_cycle_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_lessons_learned_updated_at ON public.lessons_learned;
CREATE TRIGGER trg_lessons_learned_updated_at
  BEFORE UPDATE ON public.lessons_learned
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. outcome_metrics ──────────────────────────────────────────────
-- Per-cycle, per-tenant before/after deltas on the target metric. Drives
-- causal attribution by the L8 Outcome Analyst. school_id is nullable so we
-- can record global cohort-level outcomes too (e.g. a Cusiosense-house-only
-- canary that didn't touch a tenant). statistically_significant is set by
-- the analyst, not the DB.
CREATE TABLE IF NOT EXISTS public.outcome_metrics (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                    uuid        NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  school_id                   uuid                 REFERENCES public.schools(id) ON DELETE SET NULL,
  metric                      text        NOT NULL,
  before_value                numeric,
  after_value                 numeric,
  delta                       numeric    GENERATED ALWAYS AS (after_value - before_value) STORED,
  window_before               tstzrange,
  window_after                tstzrange,
  sample_size_before          integer,
  sample_size_after           integer,
  statistically_significant   boolean,
  significance_method         text,             -- 'synthetic_control' | 'pre_post' | 'ab_test' | 'none'
  notes                       text,
  recorded_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outcome_metrics_metric_format CHECK (
    metric ~ '^[a-z][a-z0-9_]{0,127}$'
  ),
  CONSTRAINT outcome_metrics_sample_nonneg CHECK (
    (sample_size_before IS NULL OR sample_size_before >= 0) AND
    (sample_size_after  IS NULL OR sample_size_after  >= 0)
  )
);

COMMENT ON TABLE public.outcome_metrics IS
  'Per-cycle, per-tenant outcome attribution. delta is computed; the '
  'analyst is responsible for setting statistically_significant + '
  'significance_method honestly.';

CREATE INDEX IF NOT EXISTS idx_outcome_metrics_cycle
  ON public.outcome_metrics (cycle_id, metric);

CREATE INDEX IF NOT EXISTS idx_outcome_metrics_school
  ON public.outcome_metrics (school_id, metric, recorded_at DESC)
  WHERE school_id IS NOT NULL;

-- ── 6. agent_prompts ────────────────────────────────────────────────
-- Versioned prompts for every agent role. The Evolution Agent forks a prompt
-- by inserting a new row with the same agent_role and a higher version; it
-- runs in shadow mode (is_active=false) until win_rate beats the live prompt,
-- then promotes by flipping is_active and setting retired_at on the old row.
CREATE TABLE IF NOT EXISTS public.agent_prompts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role      text        NOT NULL,
  version         integer     NOT NULL,
  prompt_text     text        NOT NULL,
  model_hint      text,                           -- 'opus' | 'sonnet' | 'haiku'
  is_active       boolean     NOT NULL DEFAULT false,
  shadow_mode     boolean     NOT NULL DEFAULT true,
  win_rate        numeric,                        -- 0..1, written by Evolution Agent
  sample_size     integer     NOT NULL DEFAULT 0,
  created_by      text,                           -- 'human:<email>' | 'agent:evolution'
  notes           text,
  retired_at      timestamptz,
  retired_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_prompts_role_format CHECK (
    agent_role ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT agent_prompts_version_positive CHECK (version > 0),
  CONSTRAINT agent_prompts_winrate_range CHECK (
    win_rate IS NULL OR (win_rate >= 0 AND win_rate <= 1)
  ),
  CONSTRAINT agent_prompts_unique_version UNIQUE (agent_role, version),
  CONSTRAINT agent_prompts_retired_consistency CHECK (
    (retired_at IS NULL AND retired_reason IS NULL) OR
    (retired_at IS NOT NULL AND retired_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.agent_prompts IS
  'Versioned prompts per agent_role. The source of truth for prompt TEXT '
  'lives in /agents/prompts/<role>.md (git-tracked, reviewable); this table '
  'snapshots them at activation so a running cycle is reproducible even '
  'after the file is edited.';

-- Only ONE active, non-shadow prompt per agent_role at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_prompts_active_per_role
  ON public.agent_prompts (agent_role)
  WHERE is_active = true AND shadow_mode = false AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_prompts_role_version
  ON public.agent_prompts (agent_role, version DESC);

DROP TRIGGER IF EXISTS trg_agent_prompts_updated_at ON public.agent_prompts;
CREATE TRIGGER trg_agent_prompts_updated_at
  BEFORE UPDATE ON public.agent_prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 7. RLS ──────────────────────────────────────────────────────────
-- service_role only. There is no end-user surface for these tables; any
-- internal dashboard reads via a server-only route running as service_role.
ALTER TABLE public.cycles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons_learned   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_prompts     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cycles','tasks','cycle_evaluations',
    'lessons_learned','outcome_metrics','agent_prompts'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "service_role full access" ON public.%I',
      t
    );
    EXECUTE format(
      'CREATE POLICY "service_role full access" ON public.%I '
      'AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- ── 8. Feature flag seed ────────────────────────────────────────────
-- Default OFF. Flipping this ON enables the L0→L1 signal intake worker and
-- lets the runtime create cycles. With the flag OFF the tables exist and are
-- readable but no agent code creates rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_agent_mesh_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_agent_mesh_v1',
      false,
      0,
      'Gates the multi-agent build/evolve mesh (Phase α). When ON, the L1 '
      'Meta-Orchestrator can create rows in public.cycles and the rest of '
      'the agent runtime activates. When OFF, the substrate tables exist '
      'but are inert. Owner: principal-architect. See /agents/README.md '
      'and /governance/rubric.md.'
    );
  END IF;
END $$;
