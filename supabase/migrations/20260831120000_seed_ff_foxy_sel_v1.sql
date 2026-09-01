-- Migration: 20260831120000_seed_ff_foxy_sel_v1.sql
-- Purpose: seed the feature flag `ff_foxy_sel_v1` (default OFF).
--   Gates an ADDITIVE "SEL MOMENT" section (buildSelSection in
--   packages/lib/src/foxy/prompt-sections.ts) that /api/foxy appends to the
--   EXISTING `cognitive_context_section` template variable on a TEACHING turn
--   where an OBSERVED academic-difficulty signal just appeared (the student
--   said in their own words they do not understand, or asked for a
--   re-explain/simplify for the 2nd time this session).
--
--   The section tells Foxy to OPEN with ONE <=25-word sentence that
--   acknowledges the WORK (never the person), restores agency, and points at
--   the small next step the pedagogy mode has ALREADY chosen — then teach
--   normally. It FORBIDS naming or guessing a feeling (same rule as Safety
--   Rail 9 / prohibited inferences, which remains the hard floor), FORBIDS
--   caving (no free answer, no skipped hint rung, no lowered Bloom target, no
--   coach-mode change), and FORBIDS self-authored crisis copy — the
--   safeguarding lane (Tier-1 screen -> Tier-2 classifier -> escalation) is the
--   ONLY surface allowed to produce that, because it alerts a real adult.
--
--   OFF = today's prompt byte-for-byte: buildSelSection is never called and the
--   composed cognitive_context_section is BYTE-IDENTICAL to today, so this seed
--   ships as a strict no-op until ops ramps it.
--
--   NO template text changed and NO PROMPT_REV bump: the section rides the
--   already-registered {{cognitive_context_section}} slot, and
--   `template_variables` is already part of the hashed gen_ctx cache tuple
--   (supabase/functions/grounded-answer/gen-ctx.ts), so cache keys rotate
--   automatically when the section appears or disappears.
--
--   P13: an SEL-bearing turn is per-student. The route adds `selSection !== ''`
--   to its `cognitiveSectionIsPersonal` predicate, so such a turn can never be
--   declared cache_scope='shared' and served to a different student.
--
-- Reader: apps/host/src/app/api/foxy/route.ts via isFeatureEnabled(
--   FOXY_SEL_FLAGS.V1, { role: 'student', userId }) inside a try/catch that
--   fails CLOSED (any read error -> OFF, i.e. today's behaviour). A missing row
--   is therefore SAFE, which is why this seed is guarded and idempotent rather
--   than required.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0.
-- Idempotent (ON CONFLICT DO NOTHING), to_regclass-guarded. PURE DATA SEED —
-- INSERTs one ROW into public.feature_flags. NO schema change: no new table,
-- no new column, no constraint or index change, no RLS change (P8 N/A — the
-- feature_flags table's existing RLS posture is untouched).
-- Owner: ai-engineer. Reviewers (P14): assessment (SEL content — curriculum
--   scope, age-appropriateness, affect/crisis prohibitions), testing.
--   Added: 2026-08-31.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_sel_v1';

DO $ff_foxy_sel_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_sel_v1', false, 0,
      'Foxy SEL moment: gates an additive "SEL MOMENT" prompt section appended to cognitive_context_section on a TEACHING turn where an observed academic-difficulty signal (explicit_confusion or repeated_hint) just transitioned from absent to present. Foxy opens with ONE <=25-word sentence acknowledging the WORK (never the person), restoring agency, and pointing at the next small step already chosen by the pedagogy mode, then teaches normally. Never names or guesses a feeling (Safety Rail 9 stays the hard floor), never caves on difficulty, and never writes crisis copy (the safeguarding lane owns that). Suppressed when the safeguarding Tier-2 classifier failed on the turn. Default OFF; ops/CEO own the ramp.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_sel_v1 seed (fresh DB).';
  END IF;
END $ff_foxy_sel_v1$;
