-- Migration: 20260528000012_foxy_chat_messages_pending.sql
-- Purpose: Phase 2 of the Foxy continuity fix (2026-05-18).
--   Adds a `pending` boolean to foxy_chat_messages so the BFF can insert
--   an assistant row BEFORE the LLM call returns (RC4 in the continuity
--   plan: streaming path persists only on done; if the stream dies the
--   user message is also lost). After this column lands, the BFF persists
--   user + pending-assistant rows synchronously, then UPDATEs the assistant
--   row to set content + pending=false on completion. If the call fails,
--   both rows stay in place; UI can render a "Foxy is thinking..." affordance
--   based on the pending state.
--
-- DOWN (manual): ALTER TABLE public.foxy_chat_messages DROP COLUMN pending;

ALTER TABLE public.foxy_chat_messages
  ADD COLUMN IF NOT EXISTS pending boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS foxy_chat_messages_pending_idx
  ON public.foxy_chat_messages (session_id, created_at DESC)
  WHERE pending = true;

COMMENT ON COLUMN public.foxy_chat_messages.pending IS
  'TRUE while a row is awaiting LLM completion. Assistant rows are inserted with pending=true before the API call; UPDATEd to pending=false + content on success. Phase 2 of Foxy continuity fix.';

-- Feature flag: gates the Phase 2 behavior (native conversation_turns +
-- persist-before-LLM). Default OFF preserves legacy verbatim.
INSERT INTO public.feature_flags (
  flag_name, is_enabled, rollout_percentage, description, created_at, updated_at
) VALUES (
  'ff_foxy_native_turns_v1',
  false, 0,
  'Phase 2 Foxy continuity: pass conversation history to grounded-answer as native Anthropic messages[] (conversation_turns variable) instead of JSON-stringified inside a single user message (history_messages). Also persist user + pending-assistant rows before the LLM call so partial failures do not lose state. OFF = legacy string-interpolation + post-call persistence.',
  now(), now()
) ON CONFLICT (flag_name) DO NOTHING;
