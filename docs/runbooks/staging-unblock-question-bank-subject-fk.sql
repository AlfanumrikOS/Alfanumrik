-- ============================================================================
-- Staging unblock: comprehensive public.subjects seed
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
--   The pg_dump baseline (00000000000000_baseline_from_prod.sql) ships
--   public.subjects SCHEMA-ONLY. Prod's rows came from the archived legacy
--   governance seed (_legacy/timestamped/20260415000004_subject_governance_seed.sql),
--   which `supabase db push` SKIPS because it only applies files at the
--   immediate supabase/migrations/ root.
--
--   Result: staging.subjects is born empty, and the root migration backlog
--   hits subjects-FK walls one INSERT at a time:
--     - grade_subject_map.subject_code   -> subjects.code
--     - plan_subject_access.subject_code -> subjects.code
--     - question_bank.subject            -> subjects.code
--     - chapters.subject_code            -> subjects.code
--     - student_subject_enrollment.subject_code -> subjects.code
--
--   A partial seed of 5 core subjects advanced the sync ~22 migrations, then
--   it failed applying 20260528000010_extend_g11_12_stream_subjects_cbse.sql
--   (grade 11/12 CBSE stream electives) with FK 23503.
--
-- WHAT THIS SEEDS
--   The COMPLETE canonical subject set so staging mirrors prod in one shot:
--     - 17 core/elective subjects from the legacy governance seed
--     - 7 grade-11/12 stream electives that prod gained out-of-band (applied
--       directly to prod via MCP, never captured in a committed migration):
--         informatics_practices, health_fitness, psychology, fine_arts,
--         sociology, home_science  (+ economics, sanskrit, math,
--         computer_science already covered by the legacy set).
--
--   Column list + values for the 17 legacy rows are VERBATIM from
--   20260415000004_subject_governance_seed.sql. The 7 stream-elective rows are
--   reconstructed canonically (subject_kind = 'cbse_elective', the only valid
--   non-core/-platform value per subjects_subject_kind_check) with English
--   names matching the RAG normalization CASE maps in the baseline and
--   sensible Hindi names + display_order continuing the elective band (4xx).
--
-- IDEMPOTENT: ON CONFLICT (code) DO NOTHING — safe to re-run, and safe over
-- the 5 rows already seeded on staging (they are simply skipped).
--
-- Read-only on prod. Apply ONLY to staging (and any fresh project that starts
-- from the schema-only baseline).
-- ============================================================================

BEGIN;

INSERT INTO public.subjects
  (code, name, name_hi, icon, color, subject_kind, is_active, display_order)
VALUES
  -- ── 17 canonical rows (verbatim from legacy governance seed) ──────────────
  ('math',                 'Math',                 'गणित',             '🧮', '#F97316', 'cbse_core',         true, 10),
  ('science',              'Science',              'विज्ञान',           '🔬', '#10B981', 'cbse_core',         true, 20),
  ('english',              'English',              'अंग्रेज़ी',          '📘', '#3B82F6', 'cbse_core',         true, 30),
  ('hindi',                'Hindi',                'हिंदी',             '📕', '#EF4444', 'cbse_core',         true, 40),
  ('social_studies',       'Social Studies',       'सामाजिक विज्ञान',   '🌏', '#8B5CF6', 'cbse_core',         true, 50),
  ('physics',              'Physics',              'भौतिक विज्ञान',     '⚛️', '#0EA5E9', 'cbse_core',         true, 110),
  ('chemistry',            'Chemistry',            'रसायन विज्ञान',     '⚗️', '#14B8A6', 'cbse_core',         true, 120),
  ('biology',              'Biology',              'जीव विज्ञान',       '🧬', '#22C55E', 'cbse_core',         true, 130),
  ('economics',            'Economics',            'अर्थशास्त्र',       '💹', '#F59E0B', 'cbse_core',         true, 210),
  ('accountancy',          'Accountancy',          'लेखा-शास्त्र',      '📊', '#DC2626', 'cbse_core',         true, 220),
  ('business_studies',     'Business Studies',     'व्यवसाय अध्ययन',    '💼', '#1D4ED8', 'cbse_core',         true, 230),
  ('history_sr',           'History',              'इतिहास',            '🏛️', '#B45309', 'cbse_core',         true, 310),
  ('geography',            'Geography',            'भूगोल',             '🗺️', '#059669', 'cbse_core',         true, 320),
  ('political_science',    'Political Science',    'राजनीति विज्ञान',   '⚖️', '#6D28D9', 'cbse_core',         true, 330),
  ('computer_science',     'Computer Science',     'कंप्यूटर विज्ञान',   '💻', '#7C3AED', 'cbse_elective',     true, 410),
  ('sanskrit',             'Sanskrit',             'संस्कृत',           '🪔', '#A16207', 'cbse_elective',     true, 420),
  ('coding',               'Coding',               'कोडिंग',           '👨‍💻', '#E11D48', 'platform_elective', true, 510),

  -- ── 7 grade-11/12 stream electives (needed by 20260528000010) ─────────────
  ('informatics_practices','Informatics Practices','सूचना विज्ञान',     '🖥️', '#0891B2', 'cbse_elective',     true, 430),
  ('psychology',           'Psychology',           'मनोविज्ञान',        '🧠', '#DB2777', 'cbse_elective',     true, 440),
  ('sociology',            'Sociology',            'समाजशास्त्र',       '👥', '#9333EA', 'cbse_elective',     true, 450),
  ('fine_arts',            'Fine Arts',            'ललित कला',          '🎨', '#F43F5E', 'cbse_elective',     true, 460),
  ('home_science',         'Home Science',         'गृह विज्ञान',       '🏠', '#65A30D', 'cbse_elective',     true, 470),
  ('health_fitness',       'Health & Physical Education', 'स्वास्थ्य एवं शारीरिक शिक्षा', '🏃', '#0D9488', 'cbse_elective', true, 480)
ON CONFLICT (code) DO NOTHING;

COMMIT;
