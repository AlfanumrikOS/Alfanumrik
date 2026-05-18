-- 20260518000004_mol_feature_flags.sql
-- All MOL flags default OFF. Promote via admin UI; rollout_percentage controls canary.

insert into public.feature_flags
  (flag_name, is_enabled, target_environments, rollout_percentage, description)
values
  ('ff_mol_enabled',          false, array['production','staging'], 0,
   'Master switch: route generation calls through the Model Orchestration Layer.'),
  ('ff_mol_openai_default',   false, array['production','staging'], 0,
   'Force OpenAI as primary for teaching tasks (explanation, step_by_step, quiz_generation).'),
  ('ff_mol_hybrid_mode_v1',   false, array['production','staging'], 0,
   'Enable two-pass hybrid mode (Claude reasoning → OpenAI simplify) for doubt_solving.'),
  ('ff_mol_cost_cap_inr',     false, array['production','staging'], 100,
   'Soft cost cap per request (₹). When enabled, MOL refuses to use premium models if projected cost > cap.')
on conflict (flag_name) do nothing;
