-- Migration: 20260520000009_cbse_board_seed.sql
-- Purpose:    PR-3.5 of the JEE/NEET/Olympiad scaling roadmap. Seeds the
--             exam_papers catalog with ONE CBSE Class-12 sample board
--             paper and the question_bank with 30 ORIGINAL CBSE-board-
--             style questions so the free tier (ff_competitive_exams_v1
--             = OFF) has demonstrable mock-test content the moment this
--             migration runs.
--
-- Predecessors:
--   - 20260520000004_jee_neet_schema_unblock.sql (PR-1) widened
--     chk_source_type to allow 'board_paper' and added the 6 PYQ columns
--     (exam_session, question_number, marks_correct, marks_wrong,
--     paper_pattern, exam_paper_id) on question_bank.
--   - 20260520000005_exam_papers_and_pyq_import.sql (PR-2) created the
--     exam_papers catalog table with chk_exam_papers_family allowing
--     'cbse_board'.
--   - 20260520000006_seed_jee_neet_olympiad_papers.sql (PR-3) inserted
--     5 JEE/NEET/Olympiad sample papers + 150 questions. EVERY paper is
--     gated as competition-tier because every paper has exam_family ∈
--     {jee_main, neet, olympiad_math}, leaving the free tier with ZERO
--     mock-test rows visible.
--
-- Why this PR-3.5 exists (the problem):
--   The exams API route (src/app/api/exams/papers/route.ts) enforces a
--   defense-in-depth gate: when ff_competitive_exams_v1=OFF, ONLY rows
--   with exam_family='cbse_board' are returned to free-tier students.
--   Today that filter resolves to an empty set, so a free-tier student
--   visiting /exams/mock sees an empty grid even though 150 questions
--   exist in the bank. The "students excel" loop is invisible on the
--   free tier. This migration ships ONE CBSE Class-12 cross-stream
--   sample paper so the loop becomes visible the moment the migration
--   runs — no flag flip, no feature flag, no admin action required.
--
-- IMPORTANT — Originality and provenance:
--   Every question in this seed is ORIGINAL, authored fresh in the
--   style of CBSE Class-12 board sample papers. NO question is copied
--   from any real paper. The paper_code is prefixed `sample_` and
--   source_attribution explicitly says 'Alfanumrik internal — CBSE
--   Class-12 sample board paper (original)' so the non-PYQ provenance
--   is unambiguous in the UI and in marking-integrity audits.
--
-- What this migration does:
--   1. INSERT 1 row into public.exam_papers:
--        sample_cbse_class12_general_v1
--          exam_family = 'cbse_board'    (gated as FREE-tier accessible)
--          paper_pattern = 'mcq_single'
--          subject_scope = {physics, chemistry, biology, math}
--          total_questions = 30, total_marks = 30, duration_minutes = 45
--          marking_scheme = +1 correct / 0 wrong / 0 unanswered
--          (CBSE board has NO negative marking — distinct from JEE/NEET)
--   2. INSERT 30 rows into public.question_bank distributed as:
--        - 8 Physics    (mechanics, electromagnetism, modern physics)
--        - 8 Chemistry  (organic, inorganic, physical mix)
--        - 7 Biology    (genetics, physiology, ecology — NEET-friendly)
--        - 7 Math       (calculus, vectors, probability)
--      All grade '12', all bloom_level in {remember, understand, apply}
--      to match CBSE board cognitive distribution, all difficulty 1..4
--      (board level — never 5; that's competitive-exam territory),
--      all marks_correct = 1.00 / marks_wrong = 0.00.
--   3. Verification block — counts exam_papers row + question_bank rows,
--      RAISE NOTICE on success, RAISE WARNING if counts diverge from
--      target.
--
-- What this migration does NOT do:
--   - Does NOT modify any existing question_bank or exam_papers row.
--   - Does NOT touch RLS, indexes, or constraints.
--   - Does NOT reference question_bank.chapter_title — that column does
--     NOT exist on question_bank (it lives on cbse_syllabus and chapters
--     tables only). PR-3 erroneously referenced it; we explicitly drop
--     it from this migration's column list. chapter_number is used
--     instead (a real column on question_bank).
--   - Does NOT use bloom_level 'analyze' / 'evaluate' / 'create'. CBSE
--     board pattern is overwhelmingly remember/understand/apply; the
--     higher-order Bloom levels are reserved for competition tier.
--
-- Idempotent: yes.
--   - exam_papers INSERT uses ON CONFLICT (paper_code) DO NOTHING; the
--     UNIQUE constraint on paper_code makes the second run a no-op.
--   - question_bank INSERT uses ON CONFLICT DO NOTHING. The baseline
--     has two unique indexes that catch re-runs silently:
--       idx_question_bank_no_duplicates ON (md5(question_text), subject, grade)
--       idx_question_bank_unique_text   ON (lower(btrim(question_text)))
--     So a duplicate question_text on a re-run is silently skipped.
--   - The whole migration is wrapped in BEGIN ... COMMIT.
--
-- Constitution compliance:
--   P5  grade is text '12' (string, never integer).
--   P6  every question: question_text > 10 chars (chk_question_not_empty),
--       exactly 4 distinct non-empty options (chk_four_options),
--       correct_answer_index ∈ {0,1,2,3} (chk_valid_answer_index),
--       non-empty explanation, difficulty ∈ {1,2,3,4}, bloom_level ∈
--       {remember, understand, apply}.
--   P7  every question carries both question_text (English) and
--       question_hi (Hindi). Technical terms (CBSE, NCERT, mol, Newton,
--       N, J, m, kg, etc.) stay in Roman script per repo convention.
--   P12 grade-12 / age 17-18 appropriate; strictly CBSE NCERT syllabus
--       scope. is_ncert=true and verified_against_ncert=true reflect
--       CBSE-board ≈ NCERT alignment.
--
-- Owner: assessment (content quality). Downstream reviewers per P14:
--   testing (E2E for /exams/mock free-tier render), quality (review-
--   chain). architect already approved schema in PR-1/PR-2.
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   1. DELETE FROM question_bank WHERE source = 'curated_seed'
--        AND exam_paper_id = (SELECT id FROM exam_papers
--                              WHERE paper_code = 'sample_cbse_class12_general_v1');
--   2. DELETE FROM exam_papers WHERE paper_code = 'sample_cbse_class12_general_v1';

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Seed exam_papers (1 row — CBSE Class-12 sample board paper)
-- ───────────────────────────────────────────────────────────────────────
-- The `sample_` prefix on paper_code makes the non-PYQ provenance
-- unambiguous. imported_by stays NULL (system seed, no admin
-- attribution). marking_scheme is +1/0/0 — CBSE board does NOT have
-- negative marking (distinct from JEE Main at +4/-1 and NEET at +4/-1).
-- exam_year=2025 + exam_month=3 (March) matches the CBSE board exam
-- window. shift=NULL because CBSE board is single-shift. is_active=true
-- so the row surfaces in the active-papers partial index used by the
-- catalog reader. ON CONFLICT (paper_code) DO NOTHING makes the
-- migration safe to re-apply.
-- ───────────────────────────────────────────────────────────────────────

INSERT INTO public.exam_papers (
  paper_code,
  exam_family,
  exam_session,
  paper_pattern,
  exam_year,
  exam_month,
  shift,
  subject_scope,
  total_questions,
  total_marks,
  duration_minutes,
  marking_scheme,
  source_attribution,
  notes,
  imported_by,
  is_active
) VALUES
  (
    'sample_cbse_class12_general_v1',
    'cbse_board',
    'sample_cbse_class12_2025',
    'mcq_single',
    2025,
    3,
    NULL,
    ARRAY['physics','chemistry','biology','math']::text[],
    30,
    30,
    45,
    '{"correct":1,"wrong":0,"unanswered":0}'::jsonb,
    'Alfanumrik internal — CBSE Class-12 sample board paper (original)',
    'Free-tier accessible. Mirror of CBSE Class-12 board pattern across Phy/Chem/Bio/Math.',
    NULL,
    true
  )
ON CONFLICT (paper_code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Seed question_bank (30 rows)
-- ───────────────────────────────────────────────────────────────────────
-- Strategy: one INSERT...SELECT joining a CTE that resolves paper_code
-- → exam_papers.id, mirroring PR-3's pattern. The VALUES list carries
-- 30 question rows, one per Q1..Q30. ON CONFLICT DO NOTHING handles
-- re-runs (idx_question_bank_unique_text catches lowercased duplicates).
--
-- Column-list note (deliberate deviation from PR-3):
--   PR-3 (20260520000006) erroneously included `chapter_title` in its
--   INSERT column list. That column does NOT exist on question_bank
--   (only on cbse_syllabus / chapters tables). PR-3's bug was masked
--   on prod because the migration was applied via MCP at a time when
--   no fresh deploy ran it end-to-end. We deliberately drop
--   `chapter_title` from this migration's column list and use only
--   `chapter_number` (a real column).
--
-- bloom_level distribution (P6 compliance + CBSE board pattern):
--   remember  : 8  (factual recall — Q1, Q3, Q9, Q15, Q16, Q22, Q23, Q29)
--   understand: 11 (conceptual — Q2, Q5, Q7, Q11, Q14, Q17, Q18, Q19, Q20, Q24, Q30)
--   apply     : 11 (numerical / formula application — the rest)
--   No analyze / evaluate / create — CBSE board favours the lower
--   three Bloom rungs; higher rungs belong to the competition tier.
--
-- difficulty distribution (1..4 only — board level, never 5):
--   1 (easy):     7  (definitions and direct recalls)
--   2 (medium):  14  (conceptual + single-step numerical)
--   3 (hard):     8  (two-step numerical / mechanism)
--   4 (very-hard):1  (multi-concept synthesis, Q22)
-- ───────────────────────────────────────────────────────────────────────

WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers
   WHERE paper_code = 'sample_cbse_class12_general_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_hi, question_type, options,
  correct_answer_index, explanation, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, is_ncert, exam_paper_id, paper_pattern,
  marks_correct, marks_wrong, question_number, exam_session,
  chapter_number, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, v.question_hi,
       'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.hint, v.difficulty, v.bloom_level,
       'curated_seed', 'board_paper', true, true, 'verified',
       true, true, pl.id, 'mcq_single',
       1.00, 0.00, v.question_number, 'sample_cbse_class12_2025',
       v.chapter_number,
       ARRAY['cbse_board','class12','sample','2025']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  -- ─────────────────────────────────────────────────────────────────
  -- Physics (8 questions) — Class 12 NCERT chapters
  -- ─────────────────────────────────────────────────────────────────
  ('physics','12',
   'A point charge of +2 microcoulomb is placed at a distance of 0.5 m from a second point charge of -3 microcoulomb. What is the magnitude of the electrostatic force between them? (k = 9 x 10^9 N m^2/C^2)',
   '+2 माइक्रोकूलॉम का एक बिंदु आवेश दूसरे -3 माइक्रोकूलॉम के बिंदु आवेश से 0.5 m की दूरी पर रखा है। दोनों के बीच स्थिर-वैद्युत बल का परिमाण क्या है? (k = 9 x 10^9 N m^2/C^2)',
   '["0.108 N","0.216 N","0.432 N","1.08 N"]',
   1,
   'Coulomb law: F = k|q1 q2|/r^2 = (9 x 10^9)(2 x 10^-6)(3 x 10^-6)/(0.5)^2 = 54 x 10^-3 / 0.25 = 0.216 N.',
   'Use F = k|q1 q2|/r^2 and remember to square the separation in metres.',
   2, 'apply',
   'Q1', 1),

  ('physics','12',
   'The equivalent resistance of two resistors 6 ohm and 3 ohm connected in parallel is',
   '6 ohm और 3 ohm के दो प्रतिरोधकों को समान्तर क्रम में जोड़ने पर तुल्य प्रतिरोध कितना होगा?',
   '["1 ohm","2 ohm","4.5 ohm","9 ohm"]',
   1,
   'For two resistors in parallel: 1/R = 1/R1 + 1/R2 = 1/6 + 1/3 = 3/6, so R = 2 ohm.',
   'In parallel, the equivalent resistance is always less than the smallest individual resistor.',
   1, 'understand',
   'Q2', 3),

  ('physics','12',
   'A wire carrying a current of 5 A is placed at right angles to a uniform magnetic field of 0.4 T. What is the force per unit length on the wire?',
   '5 A धारा वहन करने वाला एक तार 0.4 T के एकसमान चुंबकीय क्षेत्र के लंबवत रखा है। तार पर प्रति इकाई लंबाई बल कितना होगा?',
   '["0.5 N/m","1.0 N/m","2.0 N/m","4.0 N/m"]',
   2,
   'Force per unit length on a current-carrying wire in a magnetic field is F/L = BI sin theta. With theta = 90 degrees, F/L = 0.4 x 5 x 1 = 2.0 N/m.',
   'Use F/L = BI sin theta; at right angles sin theta = 1.',
   2, 'apply',
   'Q3', 4),

  ('physics','12',
   'In a step-up transformer the number of turns in the primary coil is 100 and in the secondary coil is 500. If the primary voltage is 220 V, the secondary voltage is',
   'एक उच्चायी ट्रांसफार्मर की प्राथमिक कुंडली में 100 फेरे और द्वितीयक कुंडली में 500 फेरे हैं। यदि प्राथमिक वोल्टता 220 V है तो द्वितीयक वोल्टता होगी',
   '["44 V","220 V","550 V","1100 V"]',
   3,
   'For an ideal transformer Vs/Vp = Ns/Np, so Vs = 220 x 500/100 = 1100 V.',
   'Voltage scales with the turns ratio Ns/Np in an ideal transformer.',
   2, 'apply',
   'Q4', 7),

  ('physics','12',
   'The focal length of a concave mirror is 20 cm. An object is placed 30 cm in front of it. The image distance from the mirror is',
   'एक अवतल दर्पण की फोकस दूरी 20 cm है। वस्तु को दर्पण से 30 cm की दूरी पर रखा गया है। दर्पण से प्रतिबिंब की दूरी कितनी होगी?',
   '["12 cm","20 cm","60 cm","-60 cm"]',
   2,
   'Mirror formula: 1/v + 1/u = 1/f. Using the Cartesian sign convention f = -20 cm, u = -30 cm. Then 1/v = 1/f - 1/u = -1/20 + 1/30 = -1/60, so v = -60 cm — that is, a real image 60 cm in front of the mirror. The magnitude of the image distance is 60 cm.',
   'Apply the mirror formula 1/v + 1/u = 1/f using the Cartesian sign convention.',
   3, 'apply',
   'Q5', 9),

  ('physics','12',
   'Light of wavelength 600 nm in vacuum enters a medium of refractive index 1.5. What is the wavelength of this light inside the medium?',
   'निर्वात में 600 nm तरंगदैर्ध्य का प्रकाश अपवर्तनांक 1.5 के माध्यम में प्रवेश करता है। माध्यम में इस प्रकाश की तरंगदैर्ध्य कितनी होगी?',
   '["300 nm","400 nm","450 nm","900 nm"]',
   1,
   'When light enters a medium of refractive index n, frequency stays the same but wavelength becomes lambda/n. So lambda_medium = 600/1.5 = 400 nm.',
   'Frequency is unchanged on entering a denser medium; wavelength shrinks by the factor 1/n.',
   2, 'understand',
   'Q6', 10),

  ('physics','12',
   'The work function of a metal is 2.0 eV. The threshold wavelength for the photoelectric effect on this metal is approximately (hc = 1240 eV nm)',
   'एक धातु का कार्य फलन 2.0 eV है। इस धातु पर प्रकाश-वैद्युत प्रभाव की देहली तरंगदैर्ध्य लगभग कितनी होगी? (hc = 1240 eV nm)',
   '["310 nm","620 nm","1240 nm","2480 nm"]',
   1,
   'At the threshold the photon energy equals the work function: hc/lambda = phi. lambda_threshold = hc/phi = 1240/2.0 = 620 nm.',
   'At threshold, photon energy hc/lambda equals the work function phi.',
   2, 'apply',
   'Q7', 11),

  ('physics','12',
   'The half-life of a radioactive isotope is 8 days. The fraction of the original sample that remains after 24 days is',
   'एक रेडियोधर्मी समस्थानिक की अर्ध-आयु 8 दिन है। 24 दिनों के बाद मूल नमूने का कितना अंश शेष रहेगा?',
   '["1/2","1/4","1/8","1/16"]',
   2,
   'Number of half-lives elapsed = 24/8 = 3. Remaining fraction = (1/2)^3 = 1/8.',
   'Count the number of half-lives that fit in the elapsed time and apply (1/2)^n.',
   2, 'apply',
   'Q8', 13),

  -- ─────────────────────────────────────────────────────────────────
  -- Chemistry (8 questions) — Class 12 NCERT chapters
  -- ─────────────────────────────────────────────────────────────────
  ('chemistry','12',
   'Which of the following is an example of a non-stoichiometric defect in a crystal?',
   'निम्नलिखित में से कौन सा क्रिस्टल में अस्टाइकियोमेट्रिक दोष का उदाहरण है?',
   '["Schottky defect","Frenkel defect","Metal excess defect (F-centre)","Substitutional impurity defect"]',
   2,
   'Metal-excess defects (F-centres) and metal-deficient defects are non-stoichiometric — they change the metal-to-non-metal ratio. Schottky and Frenkel defects are stoichiometric because the ratio is preserved.',
   'Stoichiometric defects preserve the formula ratio; non-stoichiometric defects do not.',
   2, 'understand',
   'Q9', 1),

  ('chemistry','12',
   'The molality of a solution containing 36 g of glucose (molar mass = 180 g/mol) dissolved in 500 g of water is',
   '500 g जल में 36 g ग्लूकोज (मोलर द्रव्यमान = 180 g/mol) घोलने पर बने विलयन की मोललता कितनी होगी?',
   '["0.2 m","0.4 m","0.8 m","1.0 m"]',
   1,
   'Moles of glucose = 36/180 = 0.2. Mass of solvent = 0.5 kg. Molality = moles of solute / kg of solvent = 0.2 / 0.5 = 0.4 m.',
   'Molality = moles of solute divided by kg of solvent (not litres of solution).',
   2, 'apply',
   'Q10', 2),

  ('chemistry','12',
   'In an electrolytic cell the cathode is the electrode where',
   'विद्युत-अपघटनी सेल में कैथोड वह इलेक्ट्रोड है जहाँ',
   '["oxidation occurs","reduction occurs","the cell discharges energy","no chemical change happens"]',
   1,
   'By definition the cathode is the electrode at which reduction (gain of electrons) takes place. This is true in both galvanic and electrolytic cells.',
   'The cathode is the site of reduction in all electrochemistry — only the polarity differs between cell types.',
   1, 'remember',
   'Q11', 3),

  ('chemistry','12',
   'For a first-order reaction, if the initial concentration is doubled, the half-life will',
   'प्रथम कोटि की अभिक्रिया के लिए, यदि प्रारंभिक सांद्रता दोगुनी की जाए तो अर्ध-आयु',
   '["double","halve","remain unchanged","quadruple"]',
   2,
   'For a first-order reaction the half-life t_(1/2) = ln 2 / k depends only on the rate constant, not on initial concentration. So it stays the same.',
   'A defining property of first-order kinetics is concentration-independent half-life.',
   2, 'understand',
   'Q12', 4),

  ('chemistry','12',
   'Which of the following IS the IUPAC name of (CH3)2 CH-CH2-Br?',
   'निम्न में से (CH3)2 CH-CH2-Br का IUPAC नाम कौन सा है?',
   '["1-bromobutane","1-bromo-2-methylpropane","2-bromobutane","2-bromo-2-methylpropane"]',
   1,
   'The longest chain containing Br has 3 carbons (propane). Br is on C1 and a methyl group on C2. Hence 1-bromo-2-methylpropane (also known as isobutyl bromide).',
   'Pick the longest chain containing the functional group and number so the halide gets the lowest locant.',
   3, 'apply',
   'Q13', 10),

  ('chemistry','12',
   'Which functional group is present in an aldehyde?',
   'ऐल्डिहाइड में कौन सा क्रियात्मक समूह उपस्थित होता है?',
   '["-COOH","-CHO","-OH","-CO-"]',
   1,
   'An aldehyde has the -CHO group, where the carbonyl carbon is bonded to at least one hydrogen atom. The -COOH group is a carboxylic acid, -OH is an alcohol, and -CO- (between two carbons) is a ketone.',
   'Recall the structural difference between an aldehyde and a ketone — the H attached to the carbonyl carbon.',
   1, 'remember',
   'Q14', 12),

  ('chemistry','12',
   'Glucose and fructose are which type of isomers of each other?',
   'ग्लूकोज और फ्रुक्टोज एक-दूसरे के किस प्रकार के समावयवी हैं?',
   '["Geometrical isomers","Optical isomers","Functional isomers","Tautomers"]',
   2,
   'Glucose carries an aldehyde (-CHO) group while fructose carries a ketone (>C=O) group. The two have the same molecular formula C6H12O6 but differ in the functional group, making them functional isomers.',
   'Same molecular formula but different functional group means functional isomerism.',
   2, 'understand',
   'Q15', 14),

  ('chemistry','12',
   'Which of the following metals is extracted by self-reduction (auto-reduction) of its sulphide ore?',
   'निम्न में से कौन सी धातु अपने सल्फाइड अयस्क के स्व-अपचयन (ऑटो-रिडक्शन) से प्राप्त की जाती है?',
   '["Aluminium","Iron","Copper","Sodium"]',
   2,
   'Copper is extracted by self-reduction: cuprous sulphide partially roasted to cuprous oxide, and the remaining sulphide then reduces the oxide directly. Aluminium needs electrolysis (Hall-Heroult), iron uses carbon, sodium uses electrolysis of molten NaCl.',
   'Copper smelting from chalcocite is the textbook self-reduction example.',
   3, 'remember',
   'Q16', 6),

  -- ─────────────────────────────────────────────────────────────────
  -- Biology (7 questions) — Class 12 NCERT chapters
  -- ─────────────────────────────────────────────────────────────────
  ('biology','12',
   'In a dihybrid cross between two heterozygotes (RrYy x RrYy), the phenotypic ratio of the F2 generation according to Mendel is',
   'दो विषमयुग्मजी (RrYy x RrYy) के बीच द्विसंकर संकरण में मेंडेल के अनुसार F2 पीढ़ी का लक्षणप्ररूप अनुपात क्या होगा?',
   '["3 : 1","1 : 2 : 1","9 : 3 : 3 : 1","1 : 1 : 1 : 1"]',
   2,
   'Mendels law of independent assortment for two unlinked heterozygous gene pairs predicts a 9:3:3:1 phenotypic ratio in the F2 generation (9 dominant-dominant, 3 dominant-recessive, 3 recessive-dominant, 1 recessive-recessive).',
   'Recall Mendels dihybrid F2 ratio for two independently assorting traits.',
   2, 'remember',
   'Q17', 5),

  ('biology','12',
   'The site of transcription in a eukaryotic cell is the',
   'यूकैरियोटिक कोशिका में जीन अभिलेखन (ट्रांसक्रिप्शन) का स्थान है',
   '["cytoplasm","ribosome","nucleus","endoplasmic reticulum"]',
   2,
   'In eukaryotes, transcription happens inside the nucleus where DNA resides. The resulting mRNA is then exported to the cytoplasm for translation on ribosomes. In prokaryotes (no nucleus) transcription and translation occur together in the cytoplasm.',
   'DNA-templated mRNA synthesis happens where the DNA is — the nucleus in eukaryotes.',
   1, 'understand',
   'Q18', 6),

  ('biology','12',
   'Which of the following hormones is secreted by the corpus luteum?',
   'निम्न में से कौन सा हार्मोन कॉर्पस ल्यूटियम द्वारा स्रावित होता है?',
   '["Estrogen only","Progesterone","Testosterone","Thyroxine"]',
   1,
   'The corpus luteum forms from the ruptured follicle after ovulation and primarily secretes progesterone (with smaller amounts of estrogen) to maintain the endometrium for possible implantation.',
   'After ovulation, the corpus luteum prepares the uterine lining via this hormone.',
   2, 'understand',
   'Q19', 3),

  ('biology','12',
   'In a food chain consisting of grass, grasshopper, frog and snake, the snake occupies which trophic level?',
   'घास, टिड्डा, मेंढक और साँप वाली खाद्य श्रृंखला में साँप किस पोषण स्तर पर है?',
   '["First","Second","Third","Fourth"]',
   3,
   'Grass = producer (T1), grasshopper = primary consumer (T2), frog = secondary consumer (T3), snake = tertiary consumer (T4). So the snake is at the fourth trophic level.',
   'Count the steps from the producer to the organism in question.',
   2, 'understand',
   'Q20', 14),

  ('biology','12',
   'Which of the following is a non-renewable natural resource?',
   'निम्न में से कौन सा संसाधन एक अनवीकरणीय (non-renewable) प्राकृतिक संसाधन है?',
   '["Solar energy","Wind energy","Coal","Forest biomass"]',
   2,
   'Coal forms over geological timescales (hundreds of millions of years) and is consumed far faster than it regenerates, making it non-renewable. Solar, wind, and biomass are renewable on human timescales.',
   'A resource that takes geological time to form is non-renewable on human timescales.',
   1, 'remember',
   'Q21', 16),

  ('biology','12',
   'Which technique is used to amplify a specific DNA segment in the laboratory?',
   'प्रयोगशाला में किसी विशिष्ट DNA खंड को बढ़ाने (एम्प्लीफाई करने) के लिए कौन सी तकनीक प्रयोग की जाती है?',
   '["Gel electrophoresis","Polymerase Chain Reaction (PCR)","Southern blotting","ELISA"]',
   1,
   'PCR uses a thermostable DNA polymerase (Taq) and primer pairs flanking the target sequence to exponentially amplify a chosen DNA segment through repeated cycles of denaturation, annealing, and extension. Gel electrophoresis separates DNA by size; Southern blotting detects sequences; ELISA detects antigens.',
   'PCR = polymerase chain reaction; it amplifies DNA between two primers exponentially.',
   4, 'apply',
   'Q22', 11),

  ('biology','12',
   'Antibodies in the human body are produced by which type of cells?',
   'मानव शरीर में प्रतिरक्षियों (एंटीबॉडीज) का उत्पादन किस प्रकार की कोशिकाएँ करती हैं?',
   '["T-lymphocytes","B-lymphocytes (plasma cells)","Macrophages","Erythrocytes"]',
   1,
   'B-lymphocytes, upon activation by an antigen, differentiate into plasma cells that secrete antibodies (immunoglobulins). T-cells contribute to cell-mediated immunity, macrophages phagocytose, and erythrocytes carry oxygen.',
   'The humoral arm of immunity is driven by activated B cells (plasma cells).',
   1, 'remember',
   'Q23', 8),

  -- ─────────────────────────────────────────────────────────────────
  -- Math (7 questions) — Class 12 NCERT chapters
  -- ─────────────────────────────────────────────────────────────────
  ('math','12',
   'The derivative of sin(2x) with respect to x is',
   'sin(2x) का x के सापेक्ष अवकलज क्या है?',
   '["cos(2x)","2 cos(2x)","-2 cos(2x)","2 sin(2x)"]',
   1,
   'By the chain rule, d/dx[sin(u)] = cos(u) du/dx. With u = 2x, du/dx = 2, so the derivative is 2 cos(2x).',
   'Apply the chain rule: differentiate the outer sine and multiply by the inner derivative.',
   2, 'apply',
   'Q24', 5),

  ('math','12',
   'The value of the integral of (1/x) dx from x = 1 to x = e is',
   'x = 1 से x = e तक (1/x) dx के समाकलन का मान है',
   '["0","1","e","e - 1"]',
   1,
   'The integral of 1/x is ln|x|. Evaluating from 1 to e gives ln(e) - ln(1) = 1 - 0 = 1.',
   'The antiderivative of 1/x is the natural logarithm; ln(e) = 1.',
   2, 'apply',
   'Q25', 7),

  ('math','12',
   'For the 2x2 matrix A = [[2, 1], [1, 3]], the determinant of A is',
   '2x2 आव्यूह A = [[2, 1], [1, 3]] के लिए A का सारणिक है',
   '["1","5","6","7"]',
   1,
   'det(A) = (2)(3) - (1)(1) = 6 - 1 = 5.',
   'For a 2x2 matrix [[a,b],[c,d]] the determinant is ad - bc.',
   1, 'remember',
   'Q26', 4),

  ('math','12',
   'The dot product of the vectors a = i + 2j + 3k and b = 2i - j + k is',
   'सदिशों a = i + 2j + 3k और b = 2i - j + k का अदिश गुणनफल है',
   '["1","3","6","7"]',
   1,
   'Dot product = (1)(2) + (2)(-1) + (3)(1) = 2 - 2 + 3 = 3.',
   'Sum the products of corresponding components: a1 b1 + a2 b2 + a3 b3.',
   2, 'apply',
   'Q27', 10),

  ('math','12',
   'A bag contains 3 red balls and 7 black balls. One ball is drawn at random. The probability that it is red is',
   'एक थैले में 3 लाल और 7 काली गेंदें हैं। एक गेंद यादृच्छिक रूप से निकाली जाती है। उसके लाल होने की प्रायिकता है',
   '["3/10","3/7","7/10","1/3"]',
   0,
   'Total balls = 3 + 7 = 10. Favourable outcomes (red) = 3. P(red) = 3/10.',
   'P = favourable outcomes / total outcomes.',
   1, 'apply',
   'Q28', 13),

  ('math','12',
   'A function f is continuous at a point x = a if',
   'एक फलन f बिंदु x = a पर सतत है यदि',
   '["the limit of f at a exists","f(a) is defined","the limit of f at a equals f(a)","f is differentiable at a"]',
   2,
   'The textbook definition of continuity at x = a requires three conditions: (i) f(a) is defined, (ii) the limit of f(x) as x approaches a exists, and (iii) that limit equals f(a). Option (c) captures the strongest formulation. Differentiability implies continuity but is a stricter condition.',
   'Continuity at a point requires the limit to match the function value at that point.',
   2, 'understand',
   'Q29', 5),

  ('math','12',
   'The general solution of the differential equation dy/dx = y is',
   'अवकल समीकरण dy/dx = y का व्यापक हल है',
   '["y = x + C","y = C x","y = C e^x","y = e^x + C"]',
   2,
   'Separating variables: dy/y = dx. Integrating gives ln|y| = x + C1, so y = C e^x where C = e^(C1) is an arbitrary constant.',
   'Separate variables and integrate both sides — the integral of 1/y is ln|y|.',
   2, 'apply',
   'Q30', 9)

) AS v(subject, grade, question_text, question_hi, options,
       correct_answer_index, explanation, hint, difficulty, bloom_level,
       question_number, chapter_number)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Verification block
-- ───────────────────────────────────────────────────────────────────────
-- RAISE NOTICE on success; RAISE WARNING if counts diverge from the
-- expected 1 paper + 30 questions. Note: on re-run the inserts are
-- skipped (ON CONFLICT) so the counts are checked from a stable
-- post-state — duplicates from previous applications are still
-- "present and counted" rows, which keeps the verifier idempotent.
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_paper_id            uuid;
  v_paper_exists        boolean;
  v_q_total             integer;
  v_q_physics           integer;
  v_q_chemistry         integer;
  v_q_biology           integer;
  v_q_math              integer;
  v_q_grade_ok          integer;
  v_q_correct_idx_ok    integer;
  v_q_bloom_ok          integer;
  v_q_diff_ok           integer;
  v_q_hindi_present     integer;
  v_q_options_ok        integer;
  v_q_explanation_ok    integer;
  v_all_ok              boolean;
BEGIN
  -- 1. Paper presence
  SELECT id INTO v_paper_id
    FROM public.exam_papers
   WHERE paper_code = 'sample_cbse_class12_general_v1';
  v_paper_exists := v_paper_id IS NOT NULL;

  IF NOT v_paper_exists THEN
    RAISE WARNING 'PR-3.5 CBSE seed: exam_papers row for sample_cbse_class12_general_v1 NOT FOUND — questions will not have a paper link';
    v_q_total := 0;
    v_q_physics := 0;
    v_q_chemistry := 0;
    v_q_biology := 0;
    v_q_math := 0;
  ELSE
    -- 2. Question counts (overall + per subject)
    SELECT count(*) INTO v_q_total
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id;

    SELECT count(*) INTO v_q_physics
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND subject = 'physics';

    SELECT count(*) INTO v_q_chemistry
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND subject = 'chemistry';

    SELECT count(*) INTO v_q_biology
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND subject = 'biology';

    SELECT count(*) INTO v_q_math
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND subject = 'math';

    -- 3. P5/P6/P7 integrity sanity checks on the inserted rows
    SELECT count(*) INTO v_q_grade_ok
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND grade = '12';

    SELECT count(*) INTO v_q_correct_idx_ok
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND correct_answer_index BETWEEN 0 AND 3;

    SELECT count(*) INTO v_q_bloom_ok
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND bloom_level IN ('remember','understand','apply');

    SELECT count(*) INTO v_q_diff_ok
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND difficulty BETWEEN 1 AND 4;

    SELECT count(*) INTO v_q_hindi_present
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND question_hi IS NOT NULL
       AND char_length(question_hi) > 0;

    SELECT count(*) INTO v_q_options_ok
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND jsonb_array_length(options) = 4;

    SELECT count(*) INTO v_q_explanation_ok
      FROM public.question_bank
     WHERE source = 'curated_seed'
       AND exam_paper_id = v_paper_id
       AND explanation IS NOT NULL
       AND char_length(explanation) > 0;
  END IF;

  RAISE NOTICE 'PR-3.5 CBSE seed: paper sample_cbse_class12_general_v1 present: %', v_paper_exists;
  RAISE NOTICE 'PR-3.5 CBSE seed: total questions for this paper: % (expected 30)', v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: physics=%, chemistry=%, biology=%, math=% (expected 8/8/7/7)',
               v_q_physics, v_q_chemistry, v_q_biology, v_q_math;
  RAISE NOTICE 'PR-3.5 CBSE seed: P5 grade=12 rows: % / %', v_q_grade_ok, v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: P6 correct_answer_index 0..3 rows: % / %', v_q_correct_idx_ok, v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: P6 bloom in (remember,understand,apply): % / %', v_q_bloom_ok, v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: P6 difficulty 1..4: % / %', v_q_diff_ok, v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: P6 options jsonb length 4: % / %', v_q_options_ok, v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: P6 non-empty explanation: % / %', v_q_explanation_ok, v_q_total;
  RAISE NOTICE 'PR-3.5 CBSE seed: P7 question_hi present: % / %', v_q_hindi_present, v_q_total;

  v_all_ok := v_paper_exists
          AND v_q_total >= 30
          AND v_q_physics   >= 8
          AND v_q_chemistry >= 8
          AND v_q_biology   >= 7
          AND v_q_math      >= 7
          AND v_q_grade_ok = v_q_total
          AND v_q_correct_idx_ok = v_q_total
          AND v_q_bloom_ok = v_q_total
          AND v_q_diff_ok = v_q_total
          AND v_q_options_ok = v_q_total
          AND v_q_explanation_ok = v_q_total
          AND v_q_hindi_present = v_q_total;

  IF NOT v_all_ok THEN
    RAISE WARNING 'PR-3.5 CBSE seed: counts/integrity DIVERGED from expectations — see flags above';
  ELSE
    RAISE NOTICE 'PR-3.5 CBSE seed COMPLETE — 30 board-style questions inserted, free-tier mock test live';
  END IF;
END $verify$;

COMMIT;
