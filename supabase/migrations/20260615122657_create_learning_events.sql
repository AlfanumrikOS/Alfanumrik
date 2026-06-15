-- IMPORTANT: student_id stores auth.uid() (auth.users.id), NOT students.id
-- Sessions 2+ must insert auth.uid() or FK + RLS will reject the write

CREATE TABLE IF NOT EXISTS public.learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'quiz_attempt','foxy_ask','hint_used','topic_opened',
    'session_start','session_end','mastery_updated','solver_used'
  )),
  topic_id uuid REFERENCES public.curriculum_topics(id),
  question_id uuid REFERENCES public.question_bank(id),
  verb text NOT NULL,
  object_type text,
  result jsonb,
  context jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_events_student_time
  ON public.learning_events (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_topic_type
  ON public.learning_events (topic_id, event_type);
CREATE INDEX IF NOT EXISTS idx_learning_events_session
  ON public.learning_events (session_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_type_time
  ON public.learning_events (event_type, occurred_at DESC);

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

-- Students: read and insert own rows only
DROP POLICY IF EXISTS "students_own_learning_events_select" ON public.learning_events;
CREATE POLICY "students_own_learning_events_select"
  ON public.learning_events FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "students_own_learning_events_insert" ON public.learning_events;
CREATE POLICY "students_own_learning_events_insert"
  ON public.learning_events FOR INSERT
  WITH CHECK (student_id = auth.uid());

-- No UPDATE or DELETE policies — table is append-only
