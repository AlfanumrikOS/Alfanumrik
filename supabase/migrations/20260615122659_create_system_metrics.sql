CREATE TABLE IF NOT EXISTS public.system_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name text NOT NULL,
  route text,
  value numeric NOT NULL,
  tags jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_name_time
  ON public.system_metrics (metric_name, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_metrics_route_time
  ON public.system_metrics (route, recorded_at DESC);

ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/super_admin only
DROP POLICY IF EXISTS "admin_system_metrics_select" ON public.system_metrics;
CREATE POLICY "admin_system_metrics_select"
  ON public.system_metrics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = (SELECT auth.uid())
        AND r.name IN ('admin','super_admin')
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  );

-- No INSERT policy: service_role bypasses RLS and is the only writer.
-- Authenticated clients must NOT write system_metrics directly.
