-- Migration: 20260523100000_scheduled_actions_phase_3c.sql
-- Purpose: Phase 3c of ADR-001 (The Learner Loop). Introduces the
--          scheduled_actions projection table — the durable per-day /
--          per-week / per-month slot for the resolver's answer.
--
-- Strategic context: docs/architecture/ADR-001-learner-loop-unification.md
--
-- Why a projection table (not just compute on read):
--   1. Stability — Future PR can switch from "resolve fresh every call"
--      to "pin per day" without touching the consumers (they just read
--      the table). Phase 3c writes the latest resolver answer; the
--      semantics of "should we overwrite within a day or pin once?"
--      becomes a flag-controlled decision in a future PR.
--   2. Historical query — "What did Foxy recommend for this student
--      last Tuesday?" becomes a single SELECT. Useful for the agent
--      mesh's L8 attribution evaluator and for parent reports.
--   3. Manual pins — A teacher's "I want this assignment to be the
--      next action for Class 9A today" becomes a row with
--      source='teacher_override' that the read endpoint surfaces
--      ahead of the scheduler row.
--   4. Multi-slot — Today's recommendation is rank=0; rank=1..N enables
--      "if you have more time" follow-ons in Phase 4+.
--
-- Phase 3c MVP: rank=0 only. Write-through from /api/learner/next.
-- DO UPDATE on conflict — overwrite-within-day semantics. Future PR
-- can flip to DO NOTHING for pin-once-per-day stability.
--
-- RLS:
--   - service_role full access (the route writes via supabaseAdmin).
--   - students SELECT own rows (Phase 4+ may add a client-side view).
--   - everyone else: no access. Teachers/parents read via server
--     resolvers using service_role.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.scheduled_actions CASCADE;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_scheduled_actions_v1';

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduled_actions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  horizon         text        NOT NULL,
  -- IST start-of-day (for daily), start-of-ISO-week-Monday (for weekly),
  -- or first-of-month (for monthly). Stored as a `date` so the read
  -- query can use a simple equality filter.
  day_bucket      date        NOT NULL,
  -- 0 for the primary slot; 1..N for "if you have more time" follow-ons.
  -- Capped at 15 to keep the index sane; the resolver only ever writes 0.
  rank            smallint    NOT NULL DEFAULT 0,
  -- Closed-set in code (LearnerAction['kind']); free-form here so we can
  -- ship new action kinds without a migration. The action_payload jsonb
  -- carries the full LearnerAction body.
  action_kind     text        NOT NULL,
  action_payload  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Who put this row here. 'scheduler' = the resolver wrote it;
  -- 'manual_pin' / 'teacher_override' = a human (teacher / parent /
  -- super-admin) pinned a specific action. The read endpoint surfaces
  -- overrides ahead of scheduler rows.
  source          text        NOT NULL DEFAULT 'scheduler',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_actions_horizon_check
    CHECK (horizon IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT scheduled_actions_rank_range
    CHECK (rank >= 0 AND rank < 16),
  CONSTRAINT scheduled_actions_source_check
    CHECK (source IN ('scheduler', 'manual_pin', 'teacher_override')),
  -- The slot is uniquely keyed by (student, horizon, day, rank).
  -- Upserts target this constraint.
  CONSTRAINT scheduled_actions_slot_unique
    UNIQUE (student_id, horizon, day_bucket, rank)
);

COMMENT ON TABLE public.scheduled_actions IS
  'Per-student durable slots for the Learner Loop''s resolved action. '
  'One row per (student, horizon, day_bucket, rank). Written by '
  '/api/learner/next (scheduler) and (future) teacher/parent override '
  'endpoints. Read by /api/learner/scheduled and consumed by the '
  'dashboard hero + study-plan TodayLoopCard.';

-- Hot path: read today's slots for a learner ordered by rank.
CREATE INDEX IF NOT EXISTS idx_scheduled_actions_student_horizon_day
  ON public.scheduled_actions (student_id, horizon, day_bucket DESC, rank);

-- Cleanup-friendly: expired rows can be vacuumed by a future cron.
CREATE INDEX IF NOT EXISTS idx_scheduled_actions_expires
  ON public.scheduled_actions (expires_at)
  WHERE completed_at IS NULL;

-- ── 2. updated_at trigger ───────────────────────────────────────────
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

DROP TRIGGER IF EXISTS trg_scheduled_actions_updated_at ON public.scheduled_actions;
CREATE TRIGGER trg_scheduled_actions_updated_at
  BEFORE UPDATE ON public.scheduled_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.scheduled_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.scheduled_actions;
CREATE POLICY "service_role full access"
  ON public.scheduled_actions
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Students can read their own slots (future client-side view).
DROP POLICY IF EXISTS "student read own" ON public.scheduled_actions;
CREATE POLICY "student read own"
  ON public.scheduled_actions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

-- ── 4. Feature flag seed ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_scheduled_actions_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_scheduled_actions_v1',
      false,
      0,
      'Gates the write-through from /api/learner/next into '
      'public.scheduled_actions, and the read path on GET '
      '/api/learner/scheduled. When OFF, both surfaces no-op '
      '(write does nothing; read returns 404). Phase 3c of ADR-001 '
      'substrate-only; UI consumers are wired in a follow-on. '
      'Independent of ff_learner_loop_v1 and ff_learner_loop_dashboard_v1 '
      'so the projection can be warmed up before any consumer reads it. '
      'Owner: principal-architect.'
    );
  END IF;
END $$;
