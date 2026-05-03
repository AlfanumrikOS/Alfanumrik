-- Migration: student_daily_usage table + increment RPC
-- Tracks per-student, per-feature daily usage for enforcement

CREATE TABLE IF NOT EXISTS public.student_daily_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,          -- 'foxy_chat', 'foxy_tts', etc.
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, feature, usage_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_usage_student_date
  ON public.student_daily_usage (student_id, usage_date);

-- RLS: students can only read/write their own usage
ALTER TABLE public.student_daily_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_usage_select ON public.student_daily_usage
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY student_usage_insert ON public.student_daily_usage
  FOR INSERT WITH CHECK (auth.uid() = student_id);

CREATE POLICY student_usage_update ON public.student_daily_usage
  FOR UPDATE USING (auth.uid() = student_id);

-- Service role can do everything (for edge functions / API routes)
CREATE POLICY service_usage_all ON public.student_daily_usage
  FOR ALL USING (auth.role() = 'service_role');

-- Atomic increment RPC (upserts row if first usage today)
CREATE OR REPLACE FUNCTION public.increment_daily_usage(
  p_student_id UUID,
  p_feature TEXT,
  p_usage_date DATE DEFAULT CURRENT_DATE
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.student_daily_usage (student_id, feature, usage_date, usage_count)
  VALUES (p_student_id, p_feature, p_usage_date, 1)
  ON CONFLICT (student_id, feature, usage_date)
  DO UPDATE SET
    usage_count = student_daily_usage.usage_count + 1,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-cleanup: delete rows older than 90 days (called by daily-cron)
CREATE OR REPLACE FUNCTION public.cleanup_old_usage() RETURNS VOID AS $$
BEGIN
  DELETE FROM public.student_daily_usage
  WHERE usage_date < CURRENT_DATE - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
