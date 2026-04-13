-- Migration: 20260413160000_foxy_cognitive_columns.sql
-- Purpose: Add cognitive tracking columns to foxy_sessions so the Foxy AI tutor
--          can record whether CME cognitive context was loaded and which CME
--          action was active during each session. These columns support the
--          Foxy Cognitive Engine integration (adaptive tutoring).
--
-- Tables modified: foxy_sessions (3 new columns)
-- No new tables, no RLS changes (existing policies cover these columns).

-- Track which concepts were discussed during the session
ALTER TABLE foxy_sessions ADD COLUMN IF NOT EXISTS concepts_discussed TEXT[] DEFAULT '{}';

-- The last CME action type that was active when Foxy responded
ALTER TABLE foxy_sessions ADD COLUMN IF NOT EXISTS last_cme_action TEXT;

-- Whether cognitive context (mastery, gaps, errors) was successfully loaded
ALTER TABLE foxy_sessions ADD COLUMN IF NOT EXISTS cognitive_context_loaded BOOLEAN DEFAULT false;