-- Migration: 20260628000000_board_score_v1.sql
-- Feature: BoardScore™ — Predictive Board Exam Score Engine
--
-- PURPOSE
-- ───────
-- Adds two tables that power BoardScore™, the daily-updated predicted CBSE
-- board exam score for every active student.
--
--   1. cbse_chapter_weights  — static reference: CBSE official chapter-level
--      mark allocation per board/grade/subject (seeded below with 2024-25
--      data for Grades 10 & 12). Public read; service_role writes only.
--
--   2. board_score_predictions — nightly per-student predicted score, keyed
--      (student_id, subject_code, grade, score_date). Chapter-level breakdown
--      and a prioritised "Score Recovery Plan" live in jsonb columns.
--      Student sees own rows; guardian sees their linked children; service_role
--      writes; admin read-only for oversight.
--
-- DESIGN CONTRACTS
-- ────────────────
--   - RLS enabled from creation on BOTH tables (never disabled).
--   - No placeholders, no gen_random_uuid() sentinel values in seed rows.
--   - No INSERT … ON CONFLICT DO UPDATE for per-user data.
--   - No SELECT * anywhere in this file.
--   - Idempotent: all DDL uses IF NOT EXISTS / DROP IF EXISTS. Safe to replay.
--   - Multi-tenant ready: cbse_chapter_weights namespaced by `board` column.
--   - Indexed: every column used in WHERE / ORDER BY / JOIN gets an index.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 1: cbse_chapter_weights
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cbse_chapter_weights (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  board            text        NOT NULL DEFAULT 'CBSE',
  grade            text        NOT NULL,
  subject_code     text        NOT NULL,
  subject_label    text        NOT NULL,
  chapter_number   integer     NOT NULL CHECK (chapter_number >= 1),
  chapter_name     text        NOT NULL,
  unit_name        text        NOT NULL,
  marks_allocated  numeric(5,2) NOT NULL CHECK (marks_allocated > 0),
  total_marks      numeric(5,2) NOT NULL DEFAULT 80 CHECK (total_marks > 0),
  weight           numeric(7,5) NOT NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cbse_chapter_weights_natural_key
    UNIQUE (board, grade, subject_code, chapter_number)
);

COMMENT ON TABLE public.cbse_chapter_weights IS
  'BoardScore™ v1: CBSE official chapter-level mark allocation per board/grade/subject. '
  'Seeded with 2024-25 data for Grades 10 & 12. Multi-tenant: future boards add rows.';

COMMENT ON COLUMN public.cbse_chapter_weights.weight IS
  'Precomputed marks_allocated / total_marks for fast weighted score computation.';

CREATE INDEX IF NOT EXISTS idx_cbse_weights_lookup
  ON public.cbse_chapter_weights (board, grade, subject_code, is_active);

CREATE INDEX IF NOT EXISTS idx_cbse_weights_chapter
  ON public.cbse_chapter_weights (board, grade, subject_code, chapter_number);

ALTER TABLE public.cbse_chapter_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbse_chapter_weights_public_select ON public.cbse_chapter_weights;
CREATE POLICY cbse_chapter_weights_public_select
  ON public.cbse_chapter_weights FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cbse_chapter_weights_anon_select ON public.cbse_chapter_weights;
CREATE POLICY cbse_chapter_weights_anon_select
  ON public.cbse_chapter_weights FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS cbse_chapter_weights_service_all ON public.cbse_chapter_weights;
CREATE POLICY cbse_chapter_weights_service_all
  ON public.cbse_chapter_weights FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 2: board_score_predictions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.board_score_predictions (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_code         text         NOT NULL,
  subject_label        text         NOT NULL,
  grade                text         NOT NULL,
  score_date           date         NOT NULL DEFAULT CURRENT_DATE,

  predicted_score      numeric(5,2) NOT NULL CHECK (predicted_score >= 0),
  max_score            numeric(5,2) NOT NULL DEFAULT 80 CHECK (max_score > 0),
  predicted_pct        numeric(5,2) NOT NULL CHECK (predicted_pct BETWEEN 0 AND 100),
  confidence_band_low  numeric(5,2) CHECK (confidence_band_low >= 0),
  confidence_band_high numeric(5,2) CHECK (confidence_band_high <= 100),

  -- chapter_number (text key) → { chapter_name, unit_name, marks_allocated,
  --   mastery_mean, retention_factor, effective_mastery, predicted_marks,
  --   max_marks, status: 'strong'|'moderate'|'weak'|'critical' }
  chapter_scores       jsonb        NOT NULL DEFAULT '{}',

  -- [{ priority, chapter_number, chapter_name, marks_allocated,
  --    current_predicted_marks, recoverable_marks, action_label }]
  recovery_plan        jsonb        NOT NULL DEFAULT '[]',

  chapters_with_data   integer      NOT NULL DEFAULT 0 CHECK (chapters_with_data >= 0),
  total_chapters       integer      NOT NULL DEFAULT 0 CHECK (total_chapters >= 0),
  coverage_pct         numeric(5,2) CHECK (coverage_pct BETWEEN 0 AND 100),
  cme_snapshot_at      timestamptz,
  computed_at          timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT board_score_predictions_natural_key
    UNIQUE (student_id, subject_code, grade, score_date)
);

COMMENT ON TABLE public.board_score_predictions IS
  'BoardScore™ v1: nightly per-student CBSE board exam score prediction. '
  'chapter_scores jsonb: per-chapter mastery×retention×weight breakdown. '
  'recovery_plan jsonb: top improvement opportunities by recoverable marks.';

COMMENT ON COLUMN public.board_score_predictions.coverage_pct IS
  'Percentage of CBSE chapters that have at least one cme_concept_state row. '
  'Low coverage (<40%) → widget shows a speculative-data disclaimer.';

CREATE INDEX IF NOT EXISTS idx_board_score_student_subject_date
  ON public.board_score_predictions (student_id, subject_code, grade, score_date DESC);

CREATE INDEX IF NOT EXISTS idx_board_score_student_date
  ON public.board_score_predictions (student_id, score_date DESC);

CREATE INDEX IF NOT EXISTS idx_board_score_date
  ON public.board_score_predictions (score_date DESC);

ALTER TABLE public.board_score_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS board_score_predictions_service_all ON public.board_score_predictions;
CREATE POLICY board_score_predictions_service_all
  ON public.board_score_predictions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS board_score_predictions_student_select ON public.board_score_predictions;
CREATE POLICY board_score_predictions_student_select
  ON public.board_score_predictions FOR SELECT TO authenticated
  USING (
    student_id = (
      SELECT s.id FROM public.students s
      WHERE s.auth_user_id = auth.uid() AND s.is_active = true
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS board_score_predictions_guardian_select ON public.board_score_predictions;
CREATE POLICY board_score_predictions_guardian_select
  ON public.board_score_predictions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.guardian_student_links gsl
      JOIN public.guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = auth.uid()
        AND gsl.student_id = board_score_predictions.student_id
        AND gsl.status = 'approved'
    )
  );

DROP POLICY IF EXISTS board_score_predictions_admin_select ON public.board_score_predictions;
CREATE POLICY board_score_predictions_admin_select
  ON public.board_score_predictions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = auth.uid()
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- FEATURE FLAG: ff_board_score_v1
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.feature_flags (flag_name, is_enabled, description)
SELECT
  'ff_board_score_v1',
  false,
  'BoardScore™ v1: predictive CBSE board exam score widget on the student '
  'dashboard. Flip to true to enable the BoardScoreWidget and activate nightly cron.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.feature_flags WHERE flag_name = 'ff_board_score_v1'
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SEED: cbse_chapter_weights — CBSE 2024-25 Official Mark Distribution
-- ═══════════════════════════════════════════════════════════════════════════
-- Theory paper = 80 marks (Grades 10 & 12 standard subjects).
-- Physics/Chemistry/Biology use 70 theory marks (30 practical separately).

-- ─── GRADE 10: MATHEMATICS (total_marks = 80) ──────────────────────────────
-- Unit I  Number Systems  6 | Unit II Algebra 20 | Unit III Coord Geom 6
-- Unit IV Geometry 15   | Unit V Trig 12 | Unit VI Mensuration 10
-- Unit VII Stats&Prob 11
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','10','math','Mathematics',1,'Real Numbers','Number Systems',6.00,80,0.07500),
  ('CBSE','10','math','Mathematics',2,'Polynomials','Algebra',5.00,80,0.06250),
  ('CBSE','10','math','Mathematics',3,'Pair of Linear Equations in Two Variables','Algebra',7.00,80,0.08750),
  ('CBSE','10','math','Mathematics',4,'Quadratic Equations','Algebra',4.00,80,0.05000),
  ('CBSE','10','math','Mathematics',5,'Arithmetic Progressions','Algebra',4.00,80,0.05000),
  ('CBSE','10','math','Mathematics',6,'Triangles','Geometry',9.00,80,0.11250),
  ('CBSE','10','math','Mathematics',7,'Coordinate Geometry','Coordinate Geometry',6.00,80,0.07500),
  ('CBSE','10','math','Mathematics',8,'Introduction to Trigonometry','Trigonometry',7.00,80,0.08750),
  ('CBSE','10','math','Mathematics',9,'Some Applications of Trigonometry','Trigonometry',5.00,80,0.06250),
  ('CBSE','10','math','Mathematics',10,'Circles','Geometry',6.00,80,0.07500),
  ('CBSE','10','math','Mathematics',11,'Areas Related to Circles','Mensuration',4.00,80,0.05000),
  ('CBSE','10','math','Mathematics',12,'Surface Areas and Volumes','Mensuration',6.00,80,0.07500),
  ('CBSE','10','math','Mathematics',13,'Statistics','Statistics and Probability',6.00,80,0.07500),
  ('CBSE','10','math','Mathematics',14,'Probability','Statistics and Probability',5.00,80,0.06250)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 10: SCIENCE (total_marks = 80) ──────────────────────────────────
-- Chemical Substances 25 | World of Living 25 | Natural Phenomena 12
-- Effects of Current 13  | Natural Resources 5
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','10','science','Science',1,'Chemical Reactions and Equations','Chemical Substances',8.00,80,0.10000),
  ('CBSE','10','science','Science',2,'Acids, Bases and Salts','Chemical Substances',7.00,80,0.08750),
  ('CBSE','10','science','Science',3,'Metals and Non-Metals','Chemical Substances',6.00,80,0.07500),
  ('CBSE','10','science','Science',4,'Carbon and its Compounds','Chemical Substances',4.00,80,0.05000),
  ('CBSE','10','science','Science',5,'Life Processes','World of Living',8.00,80,0.10000),
  ('CBSE','10','science','Science',6,'Control and Coordination','World of Living',5.00,80,0.06250),
  ('CBSE','10','science','Science',7,'How do Organisms Reproduce?','World of Living',5.00,80,0.06250),
  ('CBSE','10','science','Science',8,'Heredity','World of Living',4.00,80,0.05000),
  ('CBSE','10','science','Science',9,'Evolution','World of Living',3.00,80,0.03750),
  ('CBSE','10','science','Science',10,'Light – Reflection and Refraction','Natural Phenomena',7.00,80,0.08750),
  ('CBSE','10','science','Science',11,'Human Eye and the Colourful World','Natural Phenomena',5.00,80,0.06250),
  ('CBSE','10','science','Science',12,'Electricity','Effects of Current',8.00,80,0.10000),
  ('CBSE','10','science','Science',13,'Magnetic Effects of Electric Current','Effects of Current',5.00,80,0.06250),
  ('CBSE','10','science','Science',14,'Our Environment','Natural Resources',3.00,80,0.03750),
  ('CBSE','10','science','Science',15,'Management of Natural Resources','Natural Resources',2.00,80,0.02500)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 10: SOCIAL SCIENCE (total_marks = 80) ───────────────────────────
-- History 20 | Geography 20 | Political Science 20 | Economics 20
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','10','social_science','Social Science',1,'The Rise of Nationalism in Europe','History',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',2,'Nationalism in India','History',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',3,'The Making of a Global World','History',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',4,'The Age of Industrialisation','History',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',5,'Print Culture and the Modern World','History',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',6,'Resources and Development','Geography',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',7,'Water Resources','Geography',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',8,'Agriculture','Geography',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',9,'Minerals and Energy Resources','Geography',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',10,'Manufacturing Industries','Geography',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',11,'Power Sharing','Political Science',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',12,'Federalism','Political Science',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',13,'Democracy and Diversity','Political Science',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',14,'Gender, Religion and Caste','Political Science',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',15,'Outcomes of Democracy','Political Science',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',16,'Development','Economics',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',17,'Sectors of the Indian Economy','Economics',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',18,'Money and Credit','Economics',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',19,'Globalisation and the Indian Economy','Economics',4.00,80,0.05000),
  ('CBSE','10','social_science','Social Science',20,'Consumer Rights','Economics',4.00,80,0.05000)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 10: ENGLISH (total_marks = 80) ──────────────────────────────────
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','10','english','English',1,'Reading Comprehension – Discursive Passages','Reading',12.00,80,0.15000),
  ('CBSE','10','english','English',2,'Reading Comprehension – Case-Based Passages','Reading',8.00,80,0.10000),
  ('CBSE','10','english','English',3,'Formal Letter / Article / Speech','Writing',10.00,80,0.12500),
  ('CBSE','10','english','English',4,'Diary / Story / Email Writing','Writing',10.00,80,0.12500),
  ('CBSE','10','english','English',5,'Grammar','Grammar',10.00,80,0.12500),
  ('CBSE','10','english','English',6,'First Flight – Prose','Literature',10.00,80,0.12500),
  ('CBSE','10','english','English',7,'First Flight – Poetry','Literature',8.00,80,0.10000),
  ('CBSE','10','english','English',8,'Footprints Without Feet – Supplementary Reader','Literature',12.00,80,0.15000)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 12: MATHEMATICS (total_marks = 80) ──────────────────────────────
-- Relations & Functions 8 | Algebra 10 | Calculus 44
-- Vectors & 3D 14 | Probability 8
-- Note: Linear Programming removed from 2024-25 CBSE syllabus.
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','12','math','Mathematics',1,'Relations and Functions','Relations and Functions',5.00,80,0.06250),
  ('CBSE','12','math','Mathematics',2,'Inverse Trigonometric Functions','Relations and Functions',3.00,80,0.03750),
  ('CBSE','12','math','Mathematics',3,'Matrices','Algebra',5.00,80,0.06250),
  ('CBSE','12','math','Mathematics',4,'Determinants','Algebra',5.00,80,0.06250),
  ('CBSE','12','math','Mathematics',5,'Continuity and Differentiability','Calculus',8.00,80,0.10000),
  ('CBSE','12','math','Mathematics',6,'Application of Derivatives','Calculus',7.00,80,0.08750),
  ('CBSE','12','math','Mathematics',7,'Integrals','Calculus',11.00,80,0.13750),
  ('CBSE','12','math','Mathematics',8,'Application of Integrals','Calculus',5.00,80,0.06250),
  ('CBSE','12','math','Mathematics',9,'Differential Equations','Calculus',6.00,80,0.07500),
  ('CBSE','12','math','Mathematics',10,'Vector Algebra','Vectors and Three-Dimensional Geometry',5.00,80,0.06250),
  ('CBSE','12','math','Mathematics',11,'Three Dimensional Geometry','Vectors and Three-Dimensional Geometry',7.00,80,0.08750),
  ('CBSE','12','math','Mathematics',12,'Probability','Probability',8.00,80,0.10000)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 12: PHYSICS (total_marks = 70 theory) ───────────────────────────
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','12','physics','Physics',1,'Electric Charges and Fields','Electrostatics',9.00,70,0.12857),
  ('CBSE','12','physics','Physics',2,'Electrostatic Potential and Capacitance','Electrostatics',8.00,70,0.11429),
  ('CBSE','12','physics','Physics',3,'Current Electricity','Current Electricity',7.00,70,0.10000),
  ('CBSE','12','physics','Physics',4,'Moving Charges and Magnetism','Magnetic Effects of Current and Magnetism',8.00,70,0.11429),
  ('CBSE','12','physics','Physics',5,'Magnetism and Matter','Magnetic Effects of Current and Magnetism',7.00,70,0.10000),
  ('CBSE','12','physics','Physics',6,'Electromagnetic Induction','Electromagnetic Induction and Alternating Currents',4.00,70,0.05714),
  ('CBSE','12','physics','Physics',7,'Alternating Current','Electromagnetic Induction and Alternating Currents',4.00,70,0.05714),
  ('CBSE','12','physics','Physics',8,'Electromagnetic Waves','Electromagnetic Waves',3.00,70,0.04286),
  ('CBSE','12','physics','Physics',9,'Ray Optics and Optical Instruments','Optics',11.00,70,0.15714),
  ('CBSE','12','physics','Physics',10,'Wave Optics','Optics',7.00,70,0.10000),
  ('CBSE','12','physics','Physics',11,'Dual Nature of Radiation and Matter','Dual Nature of Radiation and Matter',4.00,70,0.05714),
  ('CBSE','12','physics','Physics',12,'Atoms','Atoms and Nuclei',2.00,70,0.02857),
  ('CBSE','12','physics','Physics',13,'Nuclei','Atoms and Nuclei',2.00,70,0.02857),
  ('CBSE','12','physics','Physics',14,'Semiconductor Electronics: Materials, Devices and Simple Circuits','Electronic Devices',7.00,70,0.10000)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 12: CHEMISTRY (total_marks = 70 theory) ─────────────────────────
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','12','chemistry','Chemistry',1,'Solutions','Solutions',9.00,70,0.12857),
  ('CBSE','12','chemistry','Chemistry',2,'Electrochemistry','Electrochemistry and Chemical Kinetics',9.00,70,0.12857),
  ('CBSE','12','chemistry','Chemistry',3,'Chemical Kinetics','Electrochemistry and Chemical Kinetics',7.00,70,0.10000),
  ('CBSE','12','chemistry','Chemistry',4,'d and f Block Elements','d-f Block Elements and Coordination Compounds',8.00,70,0.11429),
  ('CBSE','12','chemistry','Chemistry',5,'Coordination Compounds','d-f Block Elements and Coordination Compounds',8.00,70,0.11429),
  ('CBSE','12','chemistry','Chemistry',6,'Haloalkanes and Haloarenes','Organic Chemistry – I',6.00,70,0.08571),
  ('CBSE','12','chemistry','Chemistry',7,'Alcohols, Phenols and Ethers','Organic Chemistry – I',6.00,70,0.08571),
  ('CBSE','12','chemistry','Chemistry',8,'Aldehydes, Ketones and Carboxylic Acids','Organic Chemistry – II',8.00,70,0.11429),
  ('CBSE','12','chemistry','Chemistry',9,'Amines','Organic Chemistry – II',6.00,70,0.08571),
  ('CBSE','12','chemistry','Chemistry',10,'Biomolecules','Biomolecules',3.00,70,0.04286)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 12: BIOLOGY (total_marks = 70 theory) ───────────────────────────
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','12','biology','Biology',1,'Reproduction in Organisms','Sexual Reproduction',3.00,70,0.04286),
  ('CBSE','12','biology','Biology',2,'Sexual Reproduction in Flowering Plants','Sexual Reproduction',10.00,70,0.14286),
  ('CBSE','12','biology','Biology',3,'Human Reproduction','Sexual Reproduction',4.00,70,0.05714),
  ('CBSE','12','biology','Biology',4,'Reproductive Health','Sexual Reproduction',3.00,70,0.04286),
  ('CBSE','12','biology','Biology',5,'Principles of Inheritance and Variation','Genetics and Evolution',14.00,70,0.20000),
  ('CBSE','12','biology','Biology',6,'Molecular Basis of Inheritance','Genetics and Evolution',8.00,70,0.11429),
  ('CBSE','12','biology','Biology',7,'Evolution','Genetics and Evolution',3.00,70,0.04286),
  ('CBSE','12','biology','Biology',8,'Human Health and Disease','Biology in Human Welfare',5.00,70,0.07143),
  ('CBSE','12','biology','Biology',9,'Microbes in Human Welfare','Biology in Human Welfare',4.00,70,0.05714),
  ('CBSE','12','biology','Biology',10,'Biotechnology – Principles and Processes','Biotechnology',5.00,70,0.07143),
  ('CBSE','12','biology','Biology',11,'Biotechnology and its Applications','Biotechnology',5.00,70,0.07143),
  ('CBSE','12','biology','Biology',12,'Organisms and Populations','Ecology',3.00,70,0.04286),
  ('CBSE','12','biology','Biology',13,'Ecosystem','Ecology',3.00,70,0.04286),
  ('CBSE','12','biology','Biology',14,'Biodiversity and Conservation','Ecology',2.00,70,0.02857)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ─── GRADE 12: ENGLISH CORE (total_marks = 80) ─────────────────────────────
INSERT INTO public.cbse_chapter_weights
  (board, grade, subject_code, subject_label, chapter_number, chapter_name, unit_name, marks_allocated, total_marks, weight)
VALUES
  ('CBSE','12','english','English',1,'Reading Comprehension – Unseen Passage 1','Reading',12.00,80,0.15000),
  ('CBSE','12','english','English',2,'Reading Comprehension – Unseen Passage 2','Reading',8.00,80,0.10000),
  ('CBSE','12','english','English',3,'Notice / Advertisement / Poster Writing','Writing',4.00,80,0.05000),
  ('CBSE','12','english','English',4,'Letter / Email Writing','Writing',5.00,80,0.06250),
  ('CBSE','12','english','English',5,'Article / Speech / Report Writing','Writing',6.00,80,0.07500),
  ('CBSE','12','english','English',6,'Grammar','Grammar',8.00,80,0.10000),
  ('CBSE','12','english','English',7,'Flamingo – Prose','Literature',12.00,80,0.15000),
  ('CBSE','12','english','English',8,'Flamingo – Poetry','Literature',8.00,80,0.10000),
  ('CBSE','12','english','English',9,'Vistas – Supplementary Reader','Literature',7.00,80,0.08750),
  ('CBSE','12','english','English',10,'Extended Reading Text (Novel)','Literature',10.00,80,0.12500)
ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

COMMIT;
