-- ────────────────────────────────────────────────────────────────
-- Migration: 20260904150000_backfill_grounded_trace_governance_trigger.sql
-- Purpose:   Backfill public.log_grounded_trace_to_governance() and its
--            trigger trg_grounded_trace_to_governance (on
--            public.grounded_ai_traces) into the migration chain. Both are
--            live in production and actively firing -- confirmed via
--            pg_proc/pg_trigger and by ai_governance_log carrying rows as
--            recent as 2026-09-03 -- but neither the function nor the
--            trigger appears in ANY migration file (verified: zero matches
--            across the full chain, including the baseline). The table
--            they write into, public.ai_governance_log, IS already in
--            00000000000000_baseline_from_prod.sql (table, PK, index, RLS
--            enable, and its 2 policies aigl_read/aigl_service_insert all
--            present) -- only this function+trigger pair was missing.
--
-- Background:
--   Found while cross-referencing the `unused_index` advisor category
--   against real application-code usage (see migration 20260904140000's
--   header). ai_governance_log initially looked like dead/orphaned
--   infrastructure (zero direct code references, no migration-visible
--   writer), which would have been a mistake to act on: it is a live,
--   currently-growing AI-provenance audit trail (grounded vs. abstained vs.
--   ungrounded, RAG-chunk vs. model-only, per student), driven entirely by
--   this trigger on grounded_ai_traces (itself a heavily-used, properly
--   migrated table). It just has no admin UI surfacing it yet, and its own
--   write path had never been captured in the migration chain -- the same
--   migration-chain-vs-production drift pattern found repeatedly elsewhere
--   in this session (RLS policies, function grants), here for a
--   trigger/function pair instead.
--
-- Fix approach:
--   Re-create the function (CREATE OR REPLACE is naturally idempotent) and
--   the trigger (DROP TRIGGER IF EXISTS + CREATE TRIGGER, since Postgres has
--   no CREATE TRIGGER IF NOT EXISTS). Both statements below are byte-for-byte
--   what `pg_get_functiondef` / `pg_get_triggerdef` returned from the live
--   production function/trigger -- this is a pure no-op on prod (same
--   definition re-applied) and a restorative create on any fresh
--   environment (CI's local-PG17 migration-integration job, a new project).
--
-- Refs: PR #1740/#1741 (unused_index dead-code cross-reference), this
--   session's 2026-09-04 P2-5 database hygiene work.
-- ────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.log_grounded_trace_to_governance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  insert into public.ai_governance_log (
    id,
    function_name,
    ai_action,
    source_of_truth,
    graph_node_used,
    question_bank_used,
    ai_generated_content,
    student_id,
    created_at
  )
  values (
    gen_random_uuid(),
    'grounded-answer',
    case
      when new.grounded is true then 'answer_generated'
      when new.abstain_reason is not null then 'answer_abstained'
      else 'answer_attempted'
    end,
    case
      when new.grounded_from_chunks is true then 'rag_chunks'
      when new.grounded is true then 'grounded_model'
      else coalesce(new.abstain_reason, 'ungrounded')
    end,
    coalesce(new.caller, 'unknown'),
    coalesce(new.chunk_count, 0) > 0,
    true,
    new.student_id,
    coalesce(new.created_at, now())
  );

  return new;
end;
$function$;

COMMENT ON FUNCTION public.log_grounded_trace_to_governance() IS
  'AFTER INSERT trigger on grounded_ai_traces; writes one ai_governance_log row per grounded-answer attempt (generated/abstained/attempted, RAG-chunk vs. model-only provenance). Backfilled into the migration chain 2026-09-04 -- was live in production since before this repo''s baseline snapshot but never captured in any migration file.';

DROP TRIGGER IF EXISTS trg_grounded_trace_to_governance ON public.grounded_ai_traces;

CREATE TRIGGER trg_grounded_trace_to_governance
  AFTER INSERT ON public.grounded_ai_traces
  FOR EACH ROW EXECUTE FUNCTION public.log_grounded_trace_to_governance();

COMMENT ON TRIGGER trg_grounded_trace_to_governance ON public.grounded_ai_traces IS
  'Backfilled into the migration chain 2026-09-04 -- pre-existing live production trigger, previously unmigrated. See log_grounded_trace_to_governance() comment.';

COMMIT;
