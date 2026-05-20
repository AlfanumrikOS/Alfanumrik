-- Migration: 20260529000000_alfabot_v1.sql
-- Purpose: AlfaBot v1 — landing-page chat bot for unauthenticated visitors at /welcome.
--          Creates sessions/messages/leads/KB-chunks/denylist tables, RLS (service-role-only),
--          KB retrieval RPC, ops view, and 3 feature-flag seed rows. All flags default OFF
--          except the streaming kill switch (default ON; flipping OFF disables SSE).
--
-- Model: OpenAI gpt-4o-mini (per CEO directive 2026-05-19). Schema is model-agnostic;
--        provenance is captured per-message via alfabot_messages.model.
--
-- Retention:
--   alfabot_sessions/alfabot_messages — 30-day TTL via daily-cron purgeAlfabotSessions (PR 2).
--   alfabot_leads                     — indefinite (consent given, explicit retention).
--   alfabot_kb_chunks                 — service-lifetime (marketing copy embeddings).
--   alfabot_denylist                  — service-lifetime (ops-managed blocklist).
--
-- DOWN (manual, ops-only — never run automatically):
--   DROP VIEW IF EXISTS public.v_alfabot_daily_stats;
--   DROP FUNCTION IF EXISTS public.match_alfabot_kb_chunks(vector, text, text, int);
--   DROP TABLE IF EXISTS public.alfabot_denylist;
--   DROP TABLE IF EXISTS public.alfabot_kb_chunks;
--   DROP TABLE IF EXISTS public.alfabot_leads;
--   DROP TABLE IF EXISTS public.alfabot_messages;
--   DROP TABLE IF EXISTS public.alfabot_sessions;
--   DELETE FROM public.feature_flags WHERE flag_name IN
--     ('ff_alfabot_v1','ff_alfabot_lead_capture_v1','ff_alfabot_streaming');

-- =====================================================================
-- Extensions (vector already created in baseline; idempotent re-assert)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================================
-- Tables
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.alfabot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('parent','student','teacher','school')),
  lang TEXT NOT NULL CHECK (lang IN ('en','hi')),
  ip_hash TEXT,
  user_agent_hash TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count INT NOT NULL DEFAULT 0,
  rate_limit_hit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alfabot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.alfabot_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  sources JSONB,
  tokens_used INT,
  latency_ms INT,
  degraded_mode BOOLEAN NOT NULL DEFAULT false,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alfabot_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.alfabot_sessions(id) ON DELETE SET NULL,
  audience TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  name TEXT,
  role_or_designation TEXT,
  school_name TEXT,
  consent_at TIMESTAMPTZ NOT NULL,
  consent_text TEXT NOT NULL,
  webhook_delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alfabot_kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT[] NOT NULL DEFAULT ARRAY['all'],
  lang TEXT NOT NULL CHECK (lang IN ('en','hi')),
  content TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT false,
  embedding vector(1024),
  source_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alfabot_kb_chunks_section_lang_uq UNIQUE (section_id, lang)
);

CREATE TABLE IF NOT EXISTS public.alfabot_denylist (
  anon_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Table comments (consumed by PR 2 daily-cron purge step + ops audit)
-- =====================================================================
COMMENT ON TABLE public.alfabot_sessions  IS 'AlfaBot v1 — 30-day TTL via daily-cron purgeAlfabotSessions step';
COMMENT ON TABLE public.alfabot_messages  IS 'AlfaBot v1 — purged by ON DELETE CASCADE when session purged';
COMMENT ON TABLE public.alfabot_leads     IS 'AlfaBot v1 — retained indefinitely, consent given';
COMMENT ON TABLE public.alfabot_kb_chunks IS 'AlfaBot v1 — public marketing copy embeddings, service-role-only';
COMMENT ON TABLE public.alfabot_denylist  IS 'AlfaBot v1 — ops-managed anon_id blocklist';

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_alfabot_sessions_anon          ON public.alfabot_sessions(anon_id);
CREATE INDEX IF NOT EXISTS idx_alfabot_sessions_last_msg      ON public.alfabot_sessions(last_message_at);
CREATE INDEX IF NOT EXISTS idx_alfabot_messages_session       ON public.alfabot_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alfabot_leads_created          ON public.alfabot_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_alfabot_kb_chunks_section      ON public.alfabot_kb_chunks(section_id);
CREATE INDEX IF NOT EXISTS idx_alfabot_kb_chunks_embedding    ON public.alfabot_kb_chunks USING hnsw (embedding vector_cosine_ops);

-- =====================================================================
-- RLS — every table is service-role-only.
-- Service role bypasses RLS by design; anon + authenticated are explicitly
-- denied (USING false, WITH CHECK false) so even leaked anon keys cannot
-- read/write any AlfaBot row. This is the canonical no-anon pattern in
-- this codebase (see 20260527000010_synthetic_monitor_results.sql).
--
-- Pattern matrix (P8):
--   - Student reads own:        N/A (no student_id; visitor-keyed)
--   - Parent reads linked:      N/A
--   - Teacher reads assigned:   N/A
--   - Admin (service role):     bypass RLS implicitly; service role only
-- =====================================================================

ALTER TABLE public.alfabot_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alfabot_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alfabot_leads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alfabot_kb_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alfabot_denylist  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alfabot_sessions' AND policyname = 'alfabot_sessions_no_anon'
  ) THEN
    CREATE POLICY alfabot_sessions_no_anon ON public.alfabot_sessions
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alfabot_messages' AND policyname = 'alfabot_messages_no_anon'
  ) THEN
    CREATE POLICY alfabot_messages_no_anon ON public.alfabot_messages
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alfabot_leads' AND policyname = 'alfabot_leads_no_anon'
  ) THEN
    CREATE POLICY alfabot_leads_no_anon ON public.alfabot_leads
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alfabot_kb_chunks' AND policyname = 'alfabot_kb_chunks_no_anon'
  ) THEN
    CREATE POLICY alfabot_kb_chunks_no_anon ON public.alfabot_kb_chunks
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alfabot_denylist' AND policyname = 'alfabot_denylist_no_anon'
  ) THEN
    CREATE POLICY alfabot_denylist_no_anon ON public.alfabot_denylist
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- =====================================================================
-- Ops view — daily session / message / rate-limit stats.
-- Reads through alfabot_sessions, which is service-role-only by RLS, so
-- this view is implicitly service-role-only as well (no SECURITY DEFINER
-- needed; the underlying table policies are the security boundary).
-- =====================================================================
CREATE OR REPLACE VIEW public.v_alfabot_daily_stats AS
  SELECT
    date_trunc('day', last_message_at) AS day,
    COUNT(*)                            AS sessions,
    SUM(message_count)                  AS messages,
    COUNT(*) FILTER (WHERE rate_limit_hit) AS rate_limited_sessions
  FROM public.alfabot_sessions
  GROUP BY 1
  ORDER BY 1 DESC;

COMMENT ON VIEW public.v_alfabot_daily_stats IS 'AlfaBot v1 — service-role-only via the underlying table policies.';

-- =====================================================================
-- KB retrieval RPC — used by the Edge Function in PR 2.
-- STABLE (no writes), SECURITY INVOKER (default), service-role-only.
-- Audience filter is OR-style: a chunk tagged ['all'] OR containing the
-- caller's audience matches.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.match_alfabot_kb_chunks(
  query_embedding vector(1024),
  match_audience TEXT,
  match_lang TEXT,
  match_count INT DEFAULT 4
) RETURNS TABLE (
  id UUID,
  section_id TEXT,
  title TEXT,
  content TEXT,
  canonical BOOLEAN,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    k.id,
    k.section_id,
    k.title,
    k.content,
    k.canonical,
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM public.alfabot_kb_chunks k
  WHERE (match_audience = ANY(k.audience) OR 'all' = ANY(k.audience))
    AND k.lang = match_lang
    AND k.embedding IS NOT NULL
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE EXECUTE ON FUNCTION public.match_alfabot_kb_chunks(vector, text, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_alfabot_kb_chunks(vector, text, text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_alfabot_kb_chunks(vector, text, text, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_alfabot_kb_chunks(vector, text, text, int) TO service_role;

-- =====================================================================
-- Feature flags — match existing feature_flags table shape.
-- Columns used: flag_name, is_enabled, rollout_percentage, description,
-- target_environments (TEXT[]), created_at, updated_at.
-- Unique constraint is on flag_name (see 20260528000005 for precedent).
-- =====================================================================
INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  target_environments,
  created_at,
  updated_at
)
VALUES
  (
    'ff_alfabot_v1',
    false,
    0,
    'AlfaBot landing-page chat bot (OpenAI gpt-4o-mini). Master kill switch — when OFF, /welcome renders the static landing page only.',
    ARRAY['staging','production']::TEXT[],
    now(),
    now()
  ),
  (
    'ff_alfabot_lead_capture_v1',
    false,
    0,
    'AlfaBot opt-in lead capture form (email/phone + explicit consent). Independent of ff_alfabot_v1 — chat can run without lead capture.',
    ARRAY['staging','production']::TEXT[],
    now(),
    now()
  ),
  (
    'ff_alfabot_streaming',
    true,
    100,
    'AlfaBot SSE streaming responses (kill switch). Default ON; flip OFF to force full-response mode if SSE degrades.',
    ARRAY['staging','production']::TEXT[],
    now(),
    now()
  )
ON CONFLICT (flag_name) DO NOTHING;
