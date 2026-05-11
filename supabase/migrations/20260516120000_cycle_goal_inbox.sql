-- Migration: 20260516120000_cycle_goal_inbox.sql
-- Purpose: Adds the cycle_goal_inbox table — the queue the real L1
--          Meta-Orchestrator reads from to pick the next cycle goal.
--          Without this, L1 has no canonical source of "what to work
--          on next", and the runtime falls back to its hardcoded stub
--          goal (the no-op skeleton).
--
-- Workflow:
--   1. Humans (CEO, leads) INSERT rows into this table with status='pending'.
--   2. The L1 worker pulls the next pending row (oldest first within
--      its priority bucket), marks status='in_progress', and links it
--      to the new cycles row via cycle_id.
--   3. When the cycle ends (shipped, aborted, escalated), the L7 layer
--      updates status to match: shipped→done, aborted→abandoned,
--      escalate_to_human→needs_human.
--   4. L8 evolution may later INSERT new rows with signal_source='evolution'.
--
-- Priority: an integer; higher = more important. L1 picks the highest
-- priority pending row. Ties broken by created_at ASC (oldest first).
--
-- RLS policy stance:
--   - service_role: full access (matches the rest of the mesh substrate).
--   - super_admin: read + write (allow humans browsing Supabase Studio
--     to seed the inbox directly). Mirrors the lessons_learned pattern.
--   - everyone else: no access.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.cycle_goal_inbox CASCADE;

CREATE TABLE IF NOT EXISTS public.cycle_goal_inbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal            text        NOT NULL,
  goal_rationale  text,
  signal_source   text        NOT NULL DEFAULT 'ceo',
  priority        integer     NOT NULL DEFAULT 100,
  risk_tier_hint  smallint,
  target_metric   text,
  target_delta    numeric,
  tenant_scope    text        NOT NULL DEFAULT 'house',
  non_goals       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  constraints     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  deadline        timestamptz,
  status          text        NOT NULL DEFAULT 'pending',
  cycle_id        uuid                 REFERENCES public.cycles(id) ON DELETE SET NULL,
  picked_at       timestamptz,
  resolved_at     timestamptz,
  created_by      text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cgi_signal_source_allowed CHECK (
    signal_source IN ('ceo','feedback','evolution','incident','ad-hoc')
  ),
  CONSTRAINT cgi_status_allowed CHECK (
    status IN ('pending','in_progress','done','abandoned','needs_human')
  ),
  CONSTRAINT cgi_tenant_scope_allowed CHECK (
    tenant_scope IN ('house','pilot','all')
  ),
  CONSTRAINT cgi_priority_range CHECK (priority BETWEEN 0 AND 1000),
  CONSTRAINT cgi_risk_tier_range CHECK (
    risk_tier_hint IS NULL OR (risk_tier_hint BETWEEN 1 AND 5)
  ),
  CONSTRAINT cgi_picked_consistency CHECK (
    (status = 'pending' AND picked_at IS NULL AND cycle_id IS NULL) OR
    (status <> 'pending')
  )
);

COMMENT ON TABLE public.cycle_goal_inbox IS
  'Queue of pending cycle goals for the L1 Meta-Orchestrator. Higher '
  'priority wins; ties broken by oldest. Updated by L1 on pickup '
  'and by L7 on cycle end.';

-- L1 reads pending rows in priority+created_at order — index covers it.
CREATE INDEX IF NOT EXISTS idx_cgi_pending_queue
  ON public.cycle_goal_inbox (priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_cgi_status
  ON public.cycle_goal_inbox (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cgi_cycle
  ON public.cycle_goal_inbox (cycle_id)
  WHERE cycle_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_cgi_updated_at ON public.cycle_goal_inbox;
CREATE TRIGGER trg_cgi_updated_at
  BEFORE UPDATE ON public.cycle_goal_inbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cycle_goal_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.cycle_goal_inbox;
CREATE POLICY "service_role full access"
  ON public.cycle_goal_inbox
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
