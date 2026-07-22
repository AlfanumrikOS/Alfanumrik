-- Migration: 20260722103000_support_tickets_related_entity.sql
-- Purpose: Phase 8 item 8.10 — pre-stage structured trigger-record references
-- for the new Loops-B/C automated-escalation dispute + Monthly Synthesis
-- content-concern support categories, before Loops B/C reach a production pilot.
--
-- Adds a nullable (related_entity_type, related_entity_id) pair to
-- support_tickets so a support agent can pull the EXACT trigger record a
-- dispute is about:
--   - automated_escalation_dispute -> adaptive_interventions.id
--   - synthesis_content_concern    -> monthly_synthesis_runs.id
--
-- P13: this is an ID-ONLY reference. No student PII is denormalised onto the
-- ticket — support resolves the record from the id through RLS-scoped admin
-- tooling. The `category` column itself stays free TEXT (matches the existing
-- table, where only `priority` carries a CHECK); category validity is enforced
-- in the intake route (apps/host/src/app/api/support/tickets/route.ts) and the
-- shared constant packages/lib/src/support/ticket-categories.ts.
--
-- Additive only: two nullable columns + one pairing CHECK + one partial index.
-- No data migration, no destructive DDL, no RLS change (the existing
-- support_tickets SELECT/INSERT policies already cover the whole row).
-- Idempotent: ADD COLUMN IF NOT EXISTS + drop-then-recreate the CHECK, so
-- re-running this file is safe.

BEGIN;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS related_entity_type text,
  ADD COLUMN IF NOT EXISTS related_entity_id uuid;

-- related_entity_type is constrained to the known structured-reference types,
-- and the two columns are null together or non-null together (a type with no
-- id, or an id with no type, is meaningless).
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_related_entity_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_related_entity_check
  CHECK (
    (related_entity_type IS NULL AND related_entity_id IS NULL)
    OR (
      related_entity_type IN ('adaptive_intervention', 'monthly_synthesis_run')
      AND related_entity_id IS NOT NULL
    )
  );

-- Support investigating a dispute fork pulls tickets BY the disputed record.
CREATE INDEX IF NOT EXISTS idx_support_tickets_related_entity
  ON public.support_tickets (related_entity_type, related_entity_id)
  WHERE related_entity_id IS NOT NULL;

COMMENT ON COLUMN public.support_tickets.related_entity_type IS
  'Structured trigger-record type for escalation/synthesis disputes: adaptive_intervention (-> adaptive_interventions.id) or monthly_synthesis_run (-> monthly_synthesis_runs.id). NULL for ordinary tickets. ID-only reference (P13).';
COMMENT ON COLUMN public.support_tickets.related_entity_id IS
  'UUID of the disputed trigger record (see related_entity_type). No PII — an id only (P13).';

COMMIT;
