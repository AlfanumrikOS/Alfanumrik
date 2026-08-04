-- Migration: 20260806000300_data_erasure_requests_scope.sql
-- Purpose: Foxy North-Star Phase 1 (T2 What-Foxy-remembers screen + student
--          self-access DPDP entry, approval A3) — add an additive, nullable
--          `scope` JSONB column to public.data_erasure_requests so an erasure
--          request can target a MEMORY LAYER (scoped erasure) instead of the
--          whole account.
--
-- ─── Semantics ────────────────────────────────────────────────────────────────
--   scope IS NULL  -> full-account erasure. EXACTLY today's behavior: every
--                     existing row and every request written by the current
--                     parent-initiated DPDP flow (20260527000006) has scope
--                     NULL, so this migration changes nothing in flight.
--   scope NOT NULL -> scoped erasure (student-facing memory screen, T2):
--                     { "layer": "preferences" | "long_memory" | "twin" | "cognitive",
--                       "subject": "<subject_code>"   -- OPTIONAL narrowing }
--                     The scoped purge path (later Phase 1 PR) erases only the
--                     named memory layer (optionally per subject) and leaves
--                     the account intact.
--
-- ─── Deliberate fail-closed interaction with isErasurePending ─────────────────
--   packages/lib/src/memory/erasure-guard.ts::isErasurePending matches ANY
--   in-flight row (status IN ('pending','purging')) for the student — it does
--   NOT inspect scope. That is DELIBERATE and stays: while ANY erasure (full or
--   scoped) is in flight, the unified-memory read path serves fully-empty
--   memory rather than risk surfacing a layer the student asked to erase. A
--   privacy guard over-suppressing during a short purge window is the correct
--   failure direction; it must never fail open (same asymmetry as the guard's
--   error handling). Scope-aware narrowing of the guard, if ever wanted, is a
--   separate reviewed change — NOT implied by this column.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (T2: "remove = per-item erasure THROUGH existing memory/erasure-guard.ts
--        + DPDP flow extended student-facing"; approval A3 APPROVED 2026-08-05).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). ADDITIVE ONLY: nullable, no default
-- backfill, no CHECK rewrite of existing rows, no RLS change (the table keeps
-- its 20260527000006 posture: guardian-own + school-admin SELECT, service-role
-- writes). Safe to replay everywhere.
--
-- Owner: architect. Added: 2026-08-05.

ALTER TABLE public.data_erasure_requests
  ADD COLUMN IF NOT EXISTS scope jsonb NULL;

COMMENT ON COLUMN public.data_erasure_requests.scope IS
  'NULL = full-account erasure (today''s behavior, all pre-existing rows). Non-null = scoped erasure: {"layer": "preferences"|"long_memory"|"twin"|"cognitive", "subject": optional subject_code}. isErasurePending deliberately matches ANY in-flight row regardless of scope (fail-closed).';
