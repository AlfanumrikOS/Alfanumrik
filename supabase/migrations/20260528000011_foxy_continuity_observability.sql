-- Migration: 20260528000011_foxy_continuity_observability.sql
-- Purpose: Phase 1 of the Foxy conversation-continuity fix (2026-05-18).
--   (a) Seed ff_foxy_session_reactivate_v1 — default OFF. When flipped ON,
--       /api/foxy/route.ts: resolveSession() reactivates idle sessions
--       (no more silent resets after the 4h idle cutoff) and explicitly
--       validates subject + chapter + mode match.
--   (b) Create the public.foxy_continuity_health_7d view for the super-admin
--       dashboard. Surfaces empty sessions and "flash" sessions (created
--       then died within 5 seconds — proxy for silent-reset rate before
--       the fix is rolled out 100%).
--
-- DOWN (manual):
--   DELETE FROM public.feature_flags WHERE flag_name = 'ff_foxy_session_reactivate_v1';
--   DROP VIEW IF EXISTS public.foxy_continuity_health_7d;

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  created_at,
  updated_at
)
VALUES (
  'ff_foxy_session_reactivate_v1',
  false,
  0,
  'Phase 1 Foxy continuity: reactivate idle sessions instead of silently creating new empty ones. When ON, /api/foxy resolveSession reuses an existing session as long as (subject, chapter, mode) still match, regardless of idle duration. OFF = legacy 4h-idle-filter behavior.',
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;

CREATE OR REPLACE VIEW public.foxy_continuity_health_7d AS
SELECT
  date_trunc('day', s.created_at)              AS day,
  count(*)                                      AS total_sessions,
  count(*) FILTER (WHERE s.messages_count = 0)  AS empty_sessions,
  count(*) FILTER (
    WHERE s.last_active_at - s.created_at < interval '5 seconds'
  )                                             AS flash_sessions,
  round(avg(s.messages_count)::numeric, 2)      AS avg_messages_per_session,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY s.messages_count) AS p50_messages
FROM (
  SELECT fs.id, fs.created_at, fs.last_active_at, count(fcm.id) AS messages_count
  FROM public.foxy_sessions fs
  LEFT JOIN public.foxy_chat_messages fcm ON fcm.session_id = fs.id
  WHERE fs.created_at >= now() - interval '7 days'
  GROUP BY fs.id, fs.created_at, fs.last_active_at
) s
GROUP BY 1
ORDER BY 1 DESC;

-- View follows underlying table RLS (mol_request_logs pattern). super-admin
-- dashboard reads via service-role on the BFF route.
GRANT SELECT ON public.foxy_continuity_health_7d TO authenticated;

COMMENT ON VIEW public.foxy_continuity_health_7d IS
  'Per-day rollup of Foxy session health, last 7 days. flash_sessions counts sessions that died within 5s of creation — proxy for the silent-reset rate the Phase 1 fix targets. Pre-fix baseline: TBD. Post-fix target: near-zero.';
