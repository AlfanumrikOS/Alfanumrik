-- Leaderboard snapshots: one row per student, updated nightly by daily-cron.
CREATE TABLE IF NOT EXISTS public.leaderboard_snapshots (
  student_id   uuid        PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  grade        text        NOT NULL,
  total_xp     integer     NOT NULL DEFAULT 0,
  rank         integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_grade_xp
  ON public.leaderboard_snapshots (grade, total_xp DESC);

ALTER TABLE public.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read own leaderboard row"
  ON public.leaderboard_snapshots FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "Students read grade leaderboard"
  ON public.leaderboard_snapshots FOR SELECT TO authenticated
  USING (grade = (SELECT grade FROM public.students WHERE id = (SELECT auth.uid()) LIMIT 1));

CREATE POLICY "Service role full access leaderboard_snapshots"
  ON public.leaderboard_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
