-- supabase/seed.sql
BEGIN;

-- Ensure canonical subjects exist with Hindi names and subject_kind
INSERT INTO subjects (code, name, name_hi, icon, color, subject_kind, is_active, display_order) VALUES
  ('math',              'Math',              'गणित',            '🧮', '#F97316', 'cbse_core',         true, 10),
  ('science',           'Science',           'विज्ञान',          '🔬', '#10B981', 'cbse_core',         true, 20),
  ('english',           'English',           'अंग्रेज़ी',         '📘', '#3B82F6', 'cbse_core',         true, 30),
  ('hindi',             'Hindi',             'हिंदी',            '📕', '#EF4444', 'cbse_core',         true, 40),
  ('social_studies',    'Social Studies',    'सामाजिक विज्ञान',  '🌏', '#8B5CF6', 'cbse_core',         true, 50),
  ('physics',           'Physics',           'भौतिक विज्ञान',    '⚛️', '#0EA5E9', 'cbse_core',         true, 110),
  ('chemistry',         'Chemistry',         'रसायन विज्ञान',    '⚗️', '#14B8A6', 'cbse_core',         true, 120),
  ('biology',           'Biology',           'जीव विज्ञान',      '🧬', '#22C55E', 'cbse_core',         true, 130),
  ('economics',         'Economics',         'अर्थशास्त्र',      '💹', '#F59E0B', 'cbse_core',         true, 210),
  ('accountancy',       'Accountancy',       'लेखा-शास्त्र',     '📊', '#DC2626', 'cbse_core',         true, 220),
  ('business_studies',  'Business Studies',  'व्यवसाय अध्ययन',   '💼', '#1D4ED8', 'cbse_core',         true, 230),
  ('history_sr',        'History',           'इतिहास',           '🏛️', '#B45309', 'cbse_core',         true, 310),
  ('geography',         'Geography',         'भूगोल',            '🗺️', '#059669', 'cbse_core',         true, 320),
  ('political_science', 'Political Science', 'राजनीति विज्ञान',  '⚖️', '#6D28D9', 'cbse_core',         true, 330),
  ('computer_science',  'Computer Science',  'कंप्यूटर विज्ञान',  '💻', '#7C3AED', 'cbse_elective',     true, 410),
  ('sanskrit',          'Sanskrit',          'संस्कृत',          '🪔', '#A16207', 'cbse_elective',     true, 420),
  ('coding',            'Coding',            'कोडिंग',          '👨‍💻', '#E11D48', 'platform_elective', true, 510)
ON CONFLICT (code) DO UPDATE SET
  name_hi      = EXCLUDED.name_hi,
  subject_kind = EXCLUDED.subject_kind;

-- ─── Phase 3 / M7: server-authoritative allowed-subject policy ──────────────
-- Alfanumrik is restricted to Mathematics + Science across all grades:
--   Grades 6-10  → math, science
--   Grades 11-12 → math, physics, chemistry, biology
--                  (presented in the UI as ONE "Science" choice grouped with
--                   Mathematics; there is no `science` row at 11-12)
-- The KEEP-SET below is the SAME set as migration
-- 20260814000007_subject_catalogue_restrict_math_science.sql. This statement
-- exists so a FRESH environment (local `supabase db reset`, CI live-DB tests,
-- a new staging project, DR) lands in the restricted state even though the
-- INSERT above still seeds the full historical catalogue.
--
-- Must be written as `NOT IN (keep-set)`, never `IN (removal-list)`:
-- public.subjects on prod holds codes this file never declares
-- (informatics_practices, health_fitness, psychology, fine_arts, sociology,
-- home_science — see 20260528000010). An enumerated removal list leaves them
-- live. Deriving is_active from the keep-set covers every present and future
-- code automatically.
--
-- grade_subject_map and plan_subject_access are NOT seeded in this file; the
-- migration chain is their seed, so their restriction lives in
-- 20260814000008 (grade map). plan_subject_access is deliberately unchanged
-- pending CEO pricing approval — see the M3 hold note in 20260814000007.
--
-- Idempotent: the WHERE clause makes a re-run a zero-row no-op, and it is a
-- single statement so the keep-set is declared exactly once.
WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
)
UPDATE subjects s
   SET is_active = (s.code IN (SELECT k.code FROM keep k))
 WHERE s.is_active IS DISTINCT FROM (s.code IN (SELECT k.code FROM keep k));

COMMIT;
