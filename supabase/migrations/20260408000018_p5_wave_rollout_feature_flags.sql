-- P5: Wave rollout feature flags
-- Wave 1: Math & Science, Grades 6-12, 4 languages (en/hi/ta/te)
-- Wave 2: Full K-12 + JEE/NEET + 12 languages
-- Wave 3: Phygital centers + government contracts

ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS wave             integer  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_subjects  text[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_languages text[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS launch_date      date     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS metadata         jsonb    DEFAULT '{}';

INSERT INTO public.feature_flags (flag_name, is_enabled, rollout_percentage, wave, target_grades, target_subjects, target_languages, description)
VALUES
  ('wave1_launch',             true,  100, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'Wave 1 master gate: Math & Science Grades 6-12'),
  ('wave1_irt_personalization',true,  100, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'IRT theta adaptive difficulty (P4)'),
  ('wave1_affective_coaching', true,   50, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'Flow/fatigue coaching nudges (50% rollout)'),
  ('wave1_foxy_tutor',         true,  100, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi'],           'Foxy AI tutor Wave 1'),
  ('wave1_parent_digest',      true,  100, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'Daily parent digest (daily-cron)'),
  ('wave1_leaderboard',        false, 100, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'Grade leaderboard — enable when ≥50 students'),
  ('wave1_spaced_repetition',  true,  100, 1, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'Spaced repetition review cards'),
  ('wave2_jee_neet_prep',      false,   0, 2, ARRAY['11','12'],                      ARRAY['physics','chemistry','biology','math'], ARRAY['en','hi'], 'JEE/NEET prep mode'),
  ('wave2_all_subjects',       false,   0, 2, ARRAY['6','7','8','9','10','11','12'], ARRAY['history','geography','civics','economics','english','hindi'], ARRAY['en','hi'], 'Full subject expansion'),
  ('wave2_multilingual_12',    false,   0, 2, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te','kn','ml','mr','gu','bn','or','pa','ur'], '12 languages'),
  ('wave2_teacher_classroom',  false,   0, 2, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi'], 'Teacher classroom tools'),
  ('wave2_video_lessons',      false,   0, 2, ARRAY['6','7','8','9','10'],           ARRAY['math','science'],   ARRAY['en','hi'], 'Video lesson integration'),
  ('wave2_group_sessions',     false,   0, 2, ARRAY['8','9','10','11','12'],         ARRAY['math','science'],   ARRAY['en','hi'], 'Peer group sessions'),
  ('wave3_phygital_centers',   false,   0, 3, ARRAY['6','7','8','9','10','11','12'], ARRAY['math','science'],   ARRAY['en','hi','ta','te'], 'Physical Alfanumrik center integration'),
  ('wave3_govt_school_mode',   false,   0, 3, ARRAY['6','7','8','9','10'],           ARRAY['math','science','history','geography','civics'], ARRAY['en','hi','ta','te','kn','ml','mr','gu','bn','or','pa','ur'], 'Government school mode'),
  ('wave3_voice_tutor',        false,   0, 3, ARRAY['6','7','8','9','10'],           ARRAY['math','science'],   ARRAY['hi','ta','te','kn','ml'], 'Voice Foxy tutor for rural students')
ON CONFLICT (flag_name) DO UPDATE
  SET wave=EXCLUDED.wave, target_subjects=EXCLUDED.target_subjects,
      target_languages=EXCLUDED.target_languages, description=EXCLUDED.description, updated_at=now();

UPDATE public.feature_flags SET rollout_percentage=100, updated_at=now() WHERE flag_name='spaced_repetition';
