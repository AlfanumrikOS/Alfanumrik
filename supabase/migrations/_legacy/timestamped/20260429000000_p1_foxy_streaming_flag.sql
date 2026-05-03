-- Migration: 20260429000000_p1_foxy_streaming_flag.sql
-- Purpose: Register the `ff_foxy_streaming` feature flag for Phase 1.1.
--
-- When enabled, the /api/foxy route serves SSE streaming responses (when the
-- client opts in via `stream:true` body param). When disabled (default), the
-- route serves the existing blocking JSON response.
--
-- Operators can flip this flag in the super-admin console in <30s if streaming
-- misbehaves in production. Per-user opt-out is also available via
-- `localStorage.alfanumrik_foxy_stream = '0'`.
--
-- Idempotent — uses NOT EXISTS guard like the other ff_* flags.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_foxy_streaming') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_foxy_streaming', false,
            'Serve Foxy responses via SSE streaming (Anthropic streaming → /api/foxy → browser). '
            'When OFF, /api/foxy returns blocking JSON as before. Per-user opt-out via '
            'localStorage.alfanumrik_foxy_stream = "0".');
  END IF;
END $$;
