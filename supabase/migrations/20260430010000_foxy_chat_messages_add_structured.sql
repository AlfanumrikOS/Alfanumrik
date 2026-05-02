-- Migration: 20260430010000_foxy_chat_messages_add_structured.sql
-- Purpose: Add a nullable `structured` JSONB column to foxy_chat_messages so the
--          new structured-block schema (FoxyResponse) can be persisted alongside
--          the existing denormalized `content TEXT` column. The TEXT column is
--          retained as the human-readable rendering for legacy reads, search,
--          and the renderer's backwards-compat fallback when `structured IS NULL`.
-- Scope: Additive only. No data is rewritten; no RLS changes (existing policies
--        on foxy_chat_messages cover the new column automatically — RLS is
--        row-level, not column-level, and we are not changing visibility).
-- Reference: See src/lib/foxy/schema.ts for the FoxyResponse Zod schema.

-- ============================================================================
-- 1. Add nullable JSONB column
-- ============================================================================
-- Only assistant rows will populate `structured`. User rows stay NULL.
-- Historical assistant rows persisted before this migration also stay NULL;
-- the renderer falls back to `content TEXT` for those.

ALTER TABLE public.foxy_chat_messages
  ADD COLUMN IF NOT EXISTS structured JSONB;

-- ============================================================================
-- 2. CHECK constraint: structured payload only allowed on assistant rows
-- ============================================================================
-- User messages cannot have a structured payload. NULL is always allowed
-- (user rows + legacy assistant rows). Wrapped in DO block so the migration
-- is safe to apply twice.

DO $$ BEGIN
  ALTER TABLE public.foxy_chat_messages
    ADD CONSTRAINT structured_role_check
    CHECK (structured IS NULL OR role = 'assistant');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- ============================================================================
-- 3. Column comment (schema source-of-truth pointer)
-- ============================================================================

COMMENT ON COLUMN public.foxy_chat_messages.structured IS
  'Structured FoxyResponse payload — see src/lib/foxy/schema.ts. NULL for legacy rows persisted before the structured-rendering migration; renderer falls back to content TEXT in that case.';

-- ============================================================================
-- 4. Indexing note (intentionally NO index for now)
-- ============================================================================
-- A GIN index on `structured` is intentionally omitted: current read patterns
-- always filter by session_id (existing idx_foxy_messages_session covers that)
-- and load the full structured payload as part of the row, never via JSONB
-- containment / path predicates. Add a GIN index when a query pattern emerges
-- that filters on a JSONB key (e.g., block-type analytics, source citations).
