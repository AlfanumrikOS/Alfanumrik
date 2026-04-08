-- P5: alert_rules + platform_health_snapshots + record_platform_health_snapshot RPC
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('latency','error_rate','quota','db','auth','payment','content','ml')),
  metric_query text NOT NULL,
  warn_threshold numeric,
  critical_threshold numeric,
  unit text DEFAULT 'count',
  is_active boolean NOT NULL DEFAULT true,
  notify_channels text[] DEFAULT ARRAY['slack','email'],
  runbook_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  dau integer DEFAULT 0,
  quiz_sessions_24h integer DEFAULT 0,
  avg_score_24h numeric(5,2) DEFAULT 0,
  foxy_chats_24h integer DEFAULT 0,
  new_signups_24h integer DEFAULT 0,
  active_subscriptions integer DEFAULT 0,
  irt_updates_24h integer DEFAULT 0,
  leaderboard_students integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_platform_health_snapshot_at ON public.platform_health_snapshots (snapshot_at DESC);
ALTER TABLE public.alert_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read alert_rules" ON public.alert_rules FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.auth_user_id=(SELECT auth.uid()) AND r.name='admin' AND ur.is_active=true));
CREATE POLICY "Service role full access alert_rules" ON public.alert_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read health snapshots" ON public.platform_health_snapshots FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.auth_user_id=(SELECT auth.uid()) AND r.name='admin' AND ur.is_active=true));
CREATE POLICY "Service role full access health snapshots" ON public.platform_health_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Alert rules seeded in application migration (see 000019 applied migration)
