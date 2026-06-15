CREATE TABLE IF NOT EXISTS public.intervention_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.curriculum_topics(id),
  alert_type text NOT NULL CHECK (alert_type IN (
    'consecutive_wrong','session_gap','mastery_declining',
    'high_hint_usage','time_on_task_low'
  )),
  severity text NOT NULL CHECK (severity IN ('watch','act','urgent')),
  trigger_data jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intervention_alerts_student
  ON public.intervention_alerts (student_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_intervention_alerts_severity
  ON public.intervention_alerts (severity, created_at DESC);

ALTER TABLE public.intervention_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teachers_intervention_alerts_select" ON public.intervention_alerts;
CREATE POLICY "teachers_intervention_alerts_select"
  ON public.intervention_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = (SELECT auth.uid())
        AND r.name IN ('teacher','admin','super_admin')
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  );

DROP POLICY IF EXISTS "teachers_intervention_alerts_update" ON public.intervention_alerts;
CREATE POLICY "teachers_intervention_alerts_update"
  ON public.intervention_alerts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = (SELECT auth.uid())
        AND r.name IN ('teacher','admin','super_admin')
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  );
