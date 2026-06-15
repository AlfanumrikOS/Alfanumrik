ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS consecutive_wrong integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.concept_mastery.consecutive_wrong IS
  'Count of consecutive incorrect answers on this topic. Reset to 0 on any correct answer. Used for SPEC-3 intervention alerts.';
