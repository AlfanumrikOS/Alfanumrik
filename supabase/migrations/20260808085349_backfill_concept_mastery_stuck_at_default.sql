-- Fix: 54 concept_mastery rows were bulk-written (seed/backfill on 2026-08-05) with
-- real attempts/correct_attempts but never recomputed through the BKT RPC, so
-- mastery_probability/p_know were left at the raw column default (0.1), which the
-- dashboard/report RPCs read as "10% mastery" regardless of actual performance --
-- same pattern as the documented prior BKT incident. mastery_mean on these same rows
-- holds a real value derived from actual accuracy (verified: tracks correct_attempts/
-- attempts). This one-time backfill copies mastery_mean forward into
-- mastery_probability/p_know only for rows still sitting at the untouched default
-- with real attempt data, and recomputes mastery_level from the corrected value so
-- it's consistent with the same thresholds update_mastery_bkt uses.
update concept_mastery
set
  mastery_probability = mastery_mean::double precision,
  p_know = mastery_mean::double precision,
  mastery_level = case
    when mastery_mean >= 0.95 then 'mastered'
    when mastery_mean >= 0.75 then 'proficient'
    when mastery_mean >= 0.50 then 'familiar'
    when mastery_mean >= 0.20 then 'developing'
    else 'not_started'
  end,
  updated_at = now()
where mastery_probability = 0.1
  and p_know = 0.1
  and attempts > 0
  and mastery_mean is not null;
