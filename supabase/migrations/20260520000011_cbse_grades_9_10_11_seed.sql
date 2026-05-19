-- Migration: 20260520000011_cbse_grades_9_10_11_seed.sql
-- Purpose:    Fills the grade-9, grade-10, grade-11 mock-test gap. PR-3.5
--             (20260520000009) seeded ONE CBSE Class-12 sample paper with
--             30 questions. Class-9, Class-10 and Class-11 students still
--             see an empty grid at /exams/mock because the defense-in-depth
--             gate in src/app/api/exams/papers/route.ts returns only rows
--             with exam_family='cbse_board' to the free tier and zero such
--             rows existed for grades 9/10/11.
--
-- Predecessors:
--   - 20260520000004 (PR-1): widened chk_source_type to allow 'board_paper'
--     and added the 6 PYQ-tracking columns on question_bank.
--   - 20260520000005 (PR-2): created public.exam_papers with
--     chk_exam_papers_family allowing 'cbse_board' + paper_pattern enum
--     including 'mcq_single'.
--   - 20260520000009 (PR-3.5): seeded sample_cbse_class12_general_v1 + 30
--     questions. This migration mirrors that file's CTE/INSERT pattern,
--     idempotency model and verification block exactly, scaled to three
--     papers and 90 questions.
--
-- What this migration does:
--   1. INSERT 3 rows into public.exam_papers (ON CONFLICT (paper_code) DO
--      NOTHING):
--        sample_cbse_class9_general_v1   — Class-9 Science+Math, 30 Q
--        sample_cbse_class10_general_v1  — Class-10 Science+Math, 30 Q
--        sample_cbse_class11_general_v1  — Class-11 Phy/Chem/Bio/Math, 30 Q
--      All three: exam_family='cbse_board' (FREE-tier accessible),
--      paper_pattern='mcq_single', marking +1/0/0 (CBSE board has NO
--      negative marking), is_active=true.
--   2. INSERT 90 rows into public.question_bank distributed as:
--        - Class 9  (subject='science' or 'math', grade='9'):
--            8 Physics-flavoured Science, 8 Chemistry-flavoured Science,
--            7 Biology-flavoured Science, 7 Math.
--          (CBSE Class 9 uses ONE combined 'science' subject code per
--          curriculum convention; chapter context is in chapter_number +
--          explanation + tags.)
--        - Class 10 (subject='science' or 'math', grade='10'):
--            8 Physics-flavoured Science, 8 Chemistry-flavoured Science,
--            7 Biology-flavoured Science, 7 Math.
--        - Class 11 (subject='physics'/'chemistry'/'biology'/'math',
--                    grade='11'):
--            8 Physics, 8 Chemistry, 7 Biology, 7 Math.
--          (Class 11 introduces the separate stream subjects per CBSE.)
--      All bloom_level in {remember, understand, apply} — board pattern.
--      All difficulty 1..4 (never 5; that's competition tier).
--      All marks_correct=1.00 / marks_wrong=0.00.
--   3. Verification block — counts the 3 papers + 30/30/30 question rows,
--      asserts P5/P6/P7 invariants on every inserted row, RAISE NOTICE on
--      success, RAISE WARNING if counts/integrity diverge.
--
-- What this migration does NOT do:
--   - Does NOT modify any existing question_bank or exam_papers row.
--   - Does NOT touch RLS, indexes or constraints.
--   - Does NOT reference question_bank.chapter_title — that column does
--     NOT exist on question_bank (it lives on cbse_syllabus / chapters
--     tables only). Mirrors PR-3.5's deliberate omission. chapter_number
--     is used instead (a real column) and the explanation text carries
--     the chapter context for forensic readability.
--   - Does NOT insert into the legacy English-only columns alone — every
--     row carries question_hi + explanation_hi (P7 compliance).
--   - Does NOT use bloom_level 'analyze'/'evaluate'/'create'. CBSE board
--     is overwhelmingly remember/understand/apply at grades 9-11; the
--     higher Bloom rungs are reserved for competition tier and senior
--     synthesis work.
--
-- Originality and provenance:
--   Every question in this seed is ORIGINAL, authored in the style of
--   CBSE Class-9, Class-10 and Class-11 sample papers. NO question is
--   copied from any real board paper or licensed source. paper_code is
--   prefixed `sample_` and source_attribution explicitly says
--   "Alfanumrik internal — CBSE Class-N sample paper (original)" so the
--   non-PYQ provenance is unambiguous in the UI and in marking-integrity
--   audits.
--
-- Idempotent: yes.
--   - exam_papers INSERT uses ON CONFLICT (paper_code) DO NOTHING.
--   - question_bank INSERT uses ON CONFLICT DO NOTHING; the baseline's
--     idx_question_bank_no_duplicates (md5(question_text), subject, grade)
--     and idx_question_bank_unique_text (lower(btrim(question_text)))
--     catch text-level duplicates silently.
--   - The whole migration is wrapped in BEGIN ... COMMIT.
--
-- Constitution compliance:
--   P5  grade is text '9' / '10' / '11' (string, never integer).
--   P6  every question: question_text > 10 chars (chk_question_not_empty),
--       exactly 4 distinct non-empty options (chk_four_options),
--       correct_answer_index in {0,1,2,3} (chk_valid_answer_index),
--       non-empty explanation, difficulty in {1,2,3,4}, bloom_level in
--       {remember, understand, apply}.
--   P7  every question carries question_text + question_hi + explanation
--       + explanation_hi. Technical terms (CBSE, NCERT, mol, Newton, N,
--       J, m, kg, V, A, ohm) stay Roman script per repo convention.
--   P12 grade-9 (ages 14-15), grade-10 (15-16), grade-11 (16-17)
--       appropriate; strictly CBSE NCERT syllabus scope. is_ncert=true
--       and verified_against_ncert=true reflect CBSE-board ≈ NCERT
--       alignment.
--
-- Owner: assessment (content quality). Downstream reviewers per P14:
--   testing (E2E for /exams/mock free-tier render on grades 9/10/11),
--   quality (review-chain).
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   1. DELETE FROM question_bank WHERE source = 'curated_seed'
--        AND exam_paper_id IN (
--              SELECT id FROM exam_papers
--               WHERE paper_code IN (
--                 'sample_cbse_class9_general_v1',
--                 'sample_cbse_class10_general_v1',
--                 'sample_cbse_class11_general_v1'
--               )
--        );
--   2. DELETE FROM exam_papers
--      WHERE paper_code IN (
--        'sample_cbse_class9_general_v1',
--        'sample_cbse_class10_general_v1',
--        'sample_cbse_class11_general_v1'
--      );

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Seed exam_papers (3 rows — Class 9 / 10 / 11 sample board papers)
-- ───────────────────────────────────────────────────────────────────────
-- The `sample_` prefix on paper_code makes the non-PYQ provenance
-- unambiguous. imported_by stays NULL (system seed, no admin
-- attribution). marking_scheme is +1/0/0 — CBSE board does NOT have
-- negative marking. exam_year=2025 + exam_month=3 (March) matches the
-- CBSE board exam window. shift=NULL (CBSE board is single-shift).
-- is_active=true so the rows surface in the active-papers partial index
-- used by the catalog reader. ON CONFLICT (paper_code) DO NOTHING makes
-- the migration safe to re-apply.
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
    'sample_cbse_class9_general_v1',
    'cbse_board',
    'sample_cbse_class9_2025',
    'mcq_single',
    2025,
    3,
    NULL,
    ARRAY['science','math']::text[],
    30,
    30,
    45,
    '{"correct":1,"wrong":0,"unanswered":0}'::jsonb,
    'Alfanumrik internal — CBSE Class-9 sample paper (original)',
    'Free-tier accessible. Class-9 CBSE pattern across Science (Phy/Chem/Bio mix) + Math.',
    NULL,
    true
  ),
  (
    'sample_cbse_class10_general_v1',
    'cbse_board',
    'sample_cbse_class10_2025',
    'mcq_single',
    2025,
    3,
    NULL,
    ARRAY['science','math']::text[],
    30,
    30,
    45,
    '{"correct":1,"wrong":0,"unanswered":0}'::jsonb,
    'Alfanumrik internal — CBSE Class-10 sample paper (original)',
    'Free-tier accessible. Class-10 CBSE board pattern across Science (Phy/Chem/Bio mix) + Math.',
    NULL,
    true
  ),
  (
    'sample_cbse_class11_general_v1',
    'cbse_board',
    'sample_cbse_class11_2025',
    'mcq_single',
    2025,
    3,
    NULL,
    ARRAY['physics','chemistry','biology','math']::text[],
    30,
    30,
    45,
    '{"correct":1,"wrong":0,"unanswered":0}'::jsonb,
    'Alfanumrik internal — CBSE Class-11 sample paper (original)',
    'Free-tier accessible. Class-11 CBSE pattern across separate stream subjects (Phy/Chem/Bio/Math).',
    NULL,
    true
  )
ON CONFLICT (paper_code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2a. Seed question_bank — Class 9 (30 rows)
-- ───────────────────────────────────────────────────────────────────────
-- CBSE Class-9 uses a single 'science' subject code (combined Phy+Chem+
-- Bio) per curriculum convention. Distribution:
--   - 8 Physics-flavoured Science (motion, force, gravitation,
--     work-energy-power, sound)
--   - 8 Chemistry-flavoured Science (matter in surroundings, is matter
--     pure, atoms and molecules, structure of atom)
--   - 7 Biology-flavoured Science (cell, tissues, why do we fall ill,
--     natural resources)
--   - 7 Math (number systems, polynomials, coordinate geometry, linear
--     equations in two variables, triangles, surface areas & volumes)
-- ───────────────────────────────────────────────────────────────────────

WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers
   WHERE paper_code = 'sample_cbse_class9_general_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_hi, question_type, options,
  correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, is_ncert, exam_paper_id, paper_pattern,
  marks_correct, marks_wrong, question_number, exam_session,
  chapter_number, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, v.question_hi,
       'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.explanation_hi, v.hint,
       v.difficulty, v.bloom_level,
       'curated_seed', 'board_paper', true, true, 'verified',
       true, true, pl.id, 'mcq_single',
       1.00, 0.00, v.question_number, 'sample_cbse_class9_2025',
       v.chapter_number,
       ARRAY['cbse_board','class9','sample','2025']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  -- ─────────────────────────────────────────────────────────────────
  -- Class 9 Science — Physics flavour (8 questions)
  -- Chapters: Motion (8), Force & Laws of Motion (9), Gravitation (10),
  --           Work & Energy (11), Sound (12)
  -- ─────────────────────────────────────────────────────────────────
  ('science','9',
   'A car travels 60 km in the first hour and 40 km in the second hour. What is its average speed over the two hours?',
   'एक कार पहले घंटे में 60 km और दूसरे घंटे में 40 km चलती है। दो घंटे में उसकी औसत चाल क्या है?',
   '["40 km/h","50 km/h","60 km/h","100 km/h"]',
   1,
   'Average speed = total distance / total time = (60 + 40) km / 2 h = 100 / 2 = 50 km/h. (Chapter 8: Motion)',
   'औसत चाल = कुल दूरी / कुल समय = (60 + 40) km / 2 h = 50 km/h। (अध्याय 8: गति)',
   'Add the two distances, then divide by the total time.',
   1, 'apply',
   'Q1', 8),

  ('science','9',
   'An object moving in a straight line covers equal distances in equal intervals of time. The object is said to be in',
   'एक वस्तु सीधी रेखा में बराबर समय अंतरालों में बराबर दूरियाँ तय करती है। यह वस्तु',
   '["uniform motion","non-uniform motion","circular motion","oscillatory motion"]',
   0,
   'Uniform motion is defined as motion in which equal distances are covered in equal intervals of time. (Chapter 8: Motion)',
   'एकसमान गति की परिभाषा है — बराबर समय अंतरालों में बराबर दूरियाँ तय करना। (अध्याय 8: गति)',
   'Recall the textbook definition of uniform motion.',
   1, 'remember',
   'Q2', 8),

  ('science','9',
   'Newton''s first law of motion is also called',
   'न्यूटन के गति के पहले नियम को कहा जाता है',
   '["law of acceleration","law of inertia","law of action and reaction","law of gravitation"]',
   1,
   'Newton''s first law states that a body remains at rest or in uniform motion unless acted upon by a net external force. Because it captures the property of inertia, it is also called the law of inertia. (Chapter 9: Force and Laws of Motion)',
   'न्यूटन का पहला नियम कहता है कि शुद्ध बाह्य बल लगे बिना वस्तु विरामावस्था या एकसमान गति में रहती है। यह जड़त्व का गुण व्यक्त करता है, इसलिए इसे जड़त्व का नियम भी कहते हैं। (अध्याय 9)',
   'The first law talks about a body resisting change in its state of motion.',
   1, 'remember',
   'Q3', 9),

  ('science','9',
   'A force of 20 N acts on an object of mass 5 kg. The acceleration produced is',
   '5 kg द्रव्यमान की वस्तु पर 20 N का बल लगाया जाता है। उत्पन्न त्वरण है',
   '["0.25 m/s^2","2 m/s^2","4 m/s^2","100 m/s^2"]',
   2,
   'By Newton''s second law F = ma, so a = F/m = 20 / 5 = 4 m/s^2. (Chapter 9: Force and Laws of Motion)',
   'न्यूटन के दूसरे नियम F = ma से, a = F/m = 20 / 5 = 4 m/s^2। (अध्याय 9)',
   'Use a = F/m.',
   1, 'apply',
   'Q4', 9),

  ('science','9',
   'The value of acceleration due to gravity on the surface of the Earth is approximately',
   'पृथ्वी की सतह पर गुरुत्वीय त्वरण का लगभग मान है',
   '["1.6 m/s^2","6.7 m/s^2","9.8 m/s^2","98 m/s^2"]',
   2,
   'The standard value of g near the Earth''s surface is approximately 9.8 m/s^2 (often rounded to 10 m/s^2 in numericals). 1.6 m/s^2 is the value on the Moon. (Chapter 10: Gravitation)',
   'पृथ्वी की सतह के पास g का मानक मान लगभग 9.8 m/s^2 होता है (अभ्यास प्रश्नों में 10 m/s^2 तक पूर्णांकित)। 1.6 m/s^2 चंद्रमा का मान है। (अध्याय 10)',
   'Recall the standard value of g near the Earth''s surface.',
   1, 'remember',
   'Q5', 10),

  ('science','9',
   'A body of mass 2 kg is lifted to a height of 5 m. The work done against gravity is (take g = 10 m/s^2)',
   '2 kg द्रव्यमान की वस्तु को 5 m की ऊँचाई तक उठाया जाता है। गुरुत्व के विरुद्ध किया गया कार्य है (g = 10 m/s^2)',
   '["10 J","25 J","100 J","1000 J"]',
   2,
   'Work done against gravity W = mgh = 2 x 10 x 5 = 100 J. (Chapter 11: Work and Energy)',
   'गुरुत्व के विरुद्ध कार्य W = mgh = 2 x 10 x 5 = 100 J। (अध्याय 11)',
   'Use W = mgh; mass in kg, height in m, g in m/s^2.',
   2, 'apply',
   'Q6', 11),

  ('science','9',
   'The SI unit of power is',
   'शक्ति का SI मात्रक है',
   '["joule","watt","newton","pascal"]',
   1,
   'Power is the rate of doing work; the SI unit is the watt, defined as 1 joule per second. (Chapter 11: Work and Energy)',
   'शक्ति कार्य करने की दर है; इसका SI मात्रक watt है, जो 1 joule प्रति second के बराबर है। (अध्याय 11)',
   'Power = work done per unit time.',
   1, 'remember',
   'Q7', 11),

  ('science','9',
   'Sound travels fastest through',
   'ध्वनि सबसे तेज़ी से किस माध्यम में चलती है?',
   '["vacuum","air","water","steel"]',
   3,
   'Sound is a mechanical wave and requires a medium. It travels fastest through solids (where particles are closely packed), slower in liquids, slower still in gases, and not at all in vacuum. So steel — a solid — gives the highest speed of sound among the options. (Chapter 12: Sound)',
   'ध्वनि एक यांत्रिक तरंग है और इसे माध्यम चाहिए। यह ठोसों में सबसे तेज़, द्रवों में कम और गैसों में और भी कम चलती है; निर्वात में बिल्कुल नहीं। इसलिए steel (ठोस) में चाल सबसे अधिक है। (अध्याय 12)',
   'Closely packed particles transmit vibrations faster — think solid vs liquid vs gas.',
   1, 'understand',
   'Q8', 12),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 9 Science — Chemistry flavour (8 questions)
  -- Chapters: Matter in Our Surroundings (1), Is Matter Around Us Pure (2),
  --           Atoms and Molecules (3), Structure of the Atom (4)
  -- ─────────────────────────────────────────────────────────────────
  ('science','9',
   'The process by which a solid changes directly into a gas without passing through the liquid state is called',
   'जिस प्रक्रिया में ठोस सीधे गैस में बदलता है, द्रव अवस्था से होकर नहीं, उसे कहते हैं',
   '["evaporation","sublimation","condensation","melting"]',
   1,
   'Sublimation is the direct conversion of a solid into a gas without going through the liquid state. Common examples are camphor, naphthalene, and dry ice. (Chapter 1: Matter in Our Surroundings)',
   'उर्ध्वपातन वह प्रक्रिया है जिसमें ठोस द्रव अवस्था में आए बिना सीधे गैस बन जाता है। कपूर, नैफ्थलीन और शुष्क बर्फ सामान्य उदाहरण हैं। (अध्याय 1)',
   'Camphor and naphthalene are textbook examples of this process.',
   1, 'remember',
   'Q9', 1),

  ('science','9',
   'Which of the following is a mixture?',
   'निम्न में से कौन सा एक मिश्रण है?',
   '["Water","Carbon dioxide","Air","Sodium chloride"]',
   2,
   'Air is a mixture of gases (nitrogen, oxygen, argon, carbon dioxide and others) in variable proportions, so it is a mixture. Water, carbon dioxide and sodium chloride are compounds with fixed composition. (Chapter 2: Is Matter Around Us Pure)',
   'वायु अनेक गैसों (नाइट्रोजन, ऑक्सीजन, आर्गन, कार्बन डाइऑक्साइड आदि) का मिश्रण है, इसलिए यह मिश्रण है। शेष तीन यौगिक हैं जिनकी संरचना निश्चित है। (अध्याय 2)',
   'Mixtures have variable composition; compounds have a fixed one.',
   1, 'understand',
   'Q10', 2),

  ('science','9',
   'The Tyndall effect can be used to distinguish a colloidal solution from',
   'टिंडल प्रभाव की सहायता से कोलाइडी विलयन को अलग किया जा सकता है',
   '["a suspension","a true solution","another colloid","a mixture of two colloids"]',
   1,
   'A true (homogeneous) solution does not scatter a beam of light because its particle size (less than 1 nm) is too small. A colloid scatters light visibly — this is the Tyndall effect — so it can be distinguished from a true solution. (Chapter 2: Is Matter Around Us Pure)',
   'वास्तविक (समांगी) विलयन के कणों का आकार अत्यंत छोटा होने से उसमें प्रकाश का प्रकीर्णन नहीं होता। कोलाइड में प्रकीर्णन होता है — यही टिंडल प्रभाव है — इसलिए इसे वास्तविक विलयन से अलग पहचाना जा सकता है। (अध्याय 2)',
   'True solutions do not scatter light; colloids do.',
   2, 'understand',
   'Q11', 2),

  ('science','9',
   'The law of conservation of mass was proposed by',
   'द्रव्यमान संरक्षण का नियम किसने प्रतिपादित किया?',
   '["John Dalton","Antoine Lavoisier","Joseph Proust","Niels Bohr"]',
   1,
   'Antoine Lavoisier proposed the law of conservation of mass, which states that mass is neither created nor destroyed in a chemical reaction. Dalton gave atomic theory, Proust gave the law of definite proportions, and Bohr gave the atomic model. (Chapter 3: Atoms and Molecules)',
   'द्रव्यमान संरक्षण का नियम Antoine Lavoisier ने दिया था — रासायनिक अभिक्रिया में द्रव्यमान न तो उत्पन्न होता है, न नष्ट। Dalton ने परमाणु सिद्धांत, Proust ने निश्चित अनुपात का नियम, और Bohr ने परमाणु मॉडल दिया। (अध्याय 3)',
   'The same chemist also pioneered modern chemical nomenclature.',
   1, 'remember',
   'Q12', 3),

  ('science','9',
   'How many moles are present in 36 g of water? (Molar mass of water = 18 g/mol)',
   '36 g जल में कितने मोल उपस्थित हैं? (जल का मोलर द्रव्यमान = 18 g/mol)',
   '["0.5 mol","1 mol","2 mol","4 mol"]',
   2,
   'Number of moles = mass / molar mass = 36 / 18 = 2 mol. (Chapter 3: Atoms and Molecules)',
   'मोलों की संख्या = द्रव्यमान / मोलर द्रव्यमान = 36 / 18 = 2 mol। (अध्याय 3)',
   'Moles = mass divided by molar mass.',
   2, 'apply',
   'Q13', 3),

  ('science','9',
   'The atomic number of an element equals the number of',
   'किसी तत्व का परमाणु क्रमांक बराबर होता है',
   '["protons in the nucleus","neutrons in the nucleus","protons plus neutrons","electrons in the outermost shell"]',
   0,
   'The atomic number is defined as the number of protons in the nucleus of an atom of that element. In a neutral atom, this also equals the number of electrons. (Chapter 4: Structure of the Atom)',
   'किसी तत्व का परमाणु क्रमांक उस तत्व के परमाणु के नाभिक में मौजूद प्रोटॉनों की संख्या है। उदासीन परमाणु में यह इलेक्ट्रॉनों की संख्या के बराबर भी होती है। (अध्याय 4)',
   'Atomic number = proton count.',
   1, 'remember',
   'Q14', 4),

  ('science','9',
   'The maximum number of electrons that the third shell (M-shell) of an atom can accommodate is',
   'किसी परमाणु के तीसरे कक्ष (M-शेल) में अधिकतम कितने इलेक्ट्रॉन रह सकते हैं?',
   '["2","8","18","32"]',
   2,
   'Maximum number of electrons in the n-th shell is 2n^2. For n = 3, this is 2 x 9 = 18. (Chapter 4: Structure of the Atom)',
   'n-वें कक्ष में अधिकतम इलेक्ट्रॉनों की संख्या 2n^2 होती है। n = 3 के लिए यह 2 x 9 = 18 है। (अध्याय 4)',
   'Apply 2n^2 with n = 3.',
   2, 'apply',
   'Q15', 4),

  ('science','9',
   'An isotope of an element has the same number of ___ but a different number of ___.',
   'किसी तत्व के समस्थानिकों में ___ की संख्या समान होती है, लेकिन ___ की संख्या भिन्न होती है।',
   '["protons; electrons","protons; neutrons","neutrons; protons","electrons; protons"]',
   1,
   'Isotopes are atoms of the same element (same atomic number = same proton count) but with different mass numbers (different neutron count). (Chapter 4: Structure of the Atom)',
   'समस्थानिक एक ही तत्व के परमाणु होते हैं (समान परमाणु क्रमांक = समान प्रोटॉन संख्या) लेकिन उनकी द्रव्यमान संख्या भिन्न होती है (न्यूट्रॉन संख्या भिन्न)। (अध्याय 4)',
   'Same element = same protons; different mass = different neutrons.',
   2, 'understand',
   'Q16', 4),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 9 Science — Biology flavour (7 questions)
  -- Chapters: The Fundamental Unit of Life (5), Tissues (6),
  --           Why Do We Fall Ill (13), Natural Resources (14)
  -- ─────────────────────────────────────────────────────────────────
  ('science','9',
   'The cell organelle responsible for protein synthesis is the',
   'प्रोटीन संश्लेषण के लिए ज़िम्मेदार कोशिकांग है',
   '["mitochondrion","ribosome","Golgi apparatus","lysosome"]',
   1,
   'Ribosomes are the sites of protein synthesis in the cell. Mitochondria produce ATP, the Golgi apparatus packages and dispatches proteins, and lysosomes carry out intracellular digestion. (Chapter 5: The Fundamental Unit of Life)',
   'राइबोसोम कोशिका में प्रोटीन संश्लेषण का स्थान हैं। माइटोकॉन्ड्रिया ATP बनाते हैं, गॉल्जी उपकरण प्रोटीनों की पैकेजिंग और प्रेषण करता है, और लाइसोसोम कोशिकीय पाचन करते हैं। (अध्याय 5)',
   'It''s the smallest organelle but the protein factory.',
   1, 'remember',
   'Q17', 5),

  ('science','9',
   'Which of the following statements about a plant cell and an animal cell is correct?',
   'पादप कोशिका और जंतु कोशिका के बारे में निम्न में से कौन-सा कथन सही है?',
   '["Both have a cell wall","Both have plastids","Plant cells have a cell wall; animal cells do not","Animal cells have a large central vacuole"]',
   2,
   'A cell wall (cellulose) is unique to plant cells; animal cells lack it. Plastids (including chloroplasts) are also exclusive to plant cells. Animal cells typically have many small vacuoles rather than a single large central one. (Chapter 5: The Fundamental Unit of Life)',
   'कोशिका भित्ति (सेलुलोज़ की) केवल पादप कोशिका में होती है। प्लास्टिड भी केवल पादप कोशिका में पाए जाते हैं। जंतु कोशिका में आमतौर पर अनेक छोटी रिक्तिकाएँ होती हैं, एक बड़ी केंद्रीय रिक्तिका नहीं। (अध्याय 5)',
   'Cellulose wall is the textbook plant-vs-animal differentiator.',
   2, 'understand',
   'Q18', 5),

  ('science','9',
   'Which type of plant tissue provides mechanical support and is composed of dead cells with lignified walls?',
   'किस पादप ऊतक की कोशिकाएँ मृत और लिग्निनयुक्त दीवारों वाली होती हैं, और जो यांत्रिक सहायता प्रदान करती हैं?',
   '["Parenchyma","Collenchyma","Sclerenchyma","Xylem parenchyma"]',
   2,
   'Sclerenchyma cells are dead at maturity, have thick lignified walls, and give plants mechanical strength. Parenchyma stores food, collenchyma provides flexible support in young stems, and xylem parenchyma stores starch. (Chapter 6: Tissues)',
   'स्क्लेरेन्काइमा की कोशिकाएँ परिपक्व होने पर मृत हो जाती हैं, उनकी दीवारें लिग्निनयुक्त मोटी होती हैं, और ये पौधे को यांत्रिक सहायता देती हैं। (अध्याय 6)',
   'Dead + lignified = mechanical strength.',
   2, 'understand',
   'Q19', 6),

  ('science','9',
   'Striated muscles (skeletal muscles) are',
   'रेखित पेशियाँ (कंकाल पेशियाँ) होती हैं',
   '["involuntary and uninucleate","involuntary and multinucleate","voluntary and uninucleate","voluntary and multinucleate"]',
   3,
   'Skeletal (striated) muscles are under our conscious control (voluntary) and their fibres are multinucleate. Smooth muscles are involuntary and uninucleate; cardiac muscles are involuntary and uninucleate (with intercalated discs). (Chapter 6: Tissues)',
   'कंकाल (रेखित) पेशियाँ हमारे चेतन नियंत्रण में होती हैं (ऐच्छिक) और उनकी रेशे बहुनाभिकीय होती हैं। चिकनी पेशियाँ अनैच्छिक और एकनाभिकीय; हृदय पेशियाँ अनैच्छिक और एकनाभिकीय (अंतर्वेशित बिंबों के साथ) होती हैं। (अध्याय 6)',
   'You decide when to flex your bicep — that''s the voluntary clue.',
   2, 'understand',
   'Q20', 6),

  ('science','9',
   'Which of the following diseases is caused by a virus?',
   'निम्न में से कौन सा रोग वायरस से होता है?',
   '["Typhoid","Tuberculosis","AIDS","Malaria"]',
   2,
   'AIDS is caused by the Human Immunodeficiency Virus (HIV). Typhoid and tuberculosis are bacterial; malaria is caused by a protozoan parasite (Plasmodium). (Chapter 13: Why Do We Fall Ill)',
   'AIDS, मानव इम्यूनो डेफ़िशिएंसी वायरस (HIV) से होता है। टायफ़ॉइड और क्षय रोग जीवाणुजन्य हैं; मलेरिया एक प्रोटोज़ोआ परजीवी (प्लाज़्मोडियम) से होता है। (अध्याय 13)',
   'Match each disease to its causative organism.',
   1, 'remember',
   'Q21', 13),

  ('science','9',
   'Of the following gases, which one constitutes the largest fraction of the Earth''s atmosphere by volume?',
   'निम्नलिखित में से कौन सी गैस पृथ्वी के वायुमंडल में आयतन के अनुसार सबसे अधिक है?',
   '["Oxygen","Nitrogen","Carbon dioxide","Argon"]',
   1,
   'The Earth''s atmosphere is about 78% nitrogen, 21% oxygen, 0.93% argon, and 0.04% carbon dioxide by volume. So nitrogen is the largest component. (Chapter 14: Natural Resources)',
   'पृथ्वी के वायुमंडल में आयतन के अनुसार लगभग 78% नाइट्रोजन, 21% ऑक्सीजन, 0.93% आर्गन और 0.04% कार्बन डाइऑक्साइड है। अतः नाइट्रोजन सबसे अधिक है। (अध्याय 14)',
   'Roughly 78% of the air around you is this gas.',
   1, 'remember',
   'Q22', 14),

  ('science','9',
   'The role of the ozone layer in the upper atmosphere is to',
   'ऊपरी वायुमंडल में ओजोन परत का कार्य है',
   '["produce oxygen for breathing","absorb harmful ultraviolet radiation from the Sun","trap heat to warm the Earth","provide nitrogen to plants"]',
   1,
   'The stratospheric ozone (O3) layer absorbs most of the Sun''s harmful ultraviolet radiation, protecting living organisms from DNA damage and skin cancer. It does not produce respirable oxygen, nor is it primarily responsible for greenhouse warming. (Chapter 14: Natural Resources)',
   'समताप मंडल की ओजोन (O3) परत सूर्य की हानिकारक पराबैंगनी विकिरण को अवशोषित करती है, जिससे जीवों का DNA और त्वचा सुरक्षित रहती है। यह सांस लेने योग्य ऑक्सीजन नहीं बनाती और न ही ग्रीनहाउस वार्मिंग का मुख्य कारण है। (अध्याय 14)',
   'Think UV protection, not breathing.',
   2, 'understand',
   'Q23', 14),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 9 Math (7 questions)
  -- Chapters: Number Systems (1), Polynomials (2), Coordinate Geometry (3),
  --           Linear Equations in Two Variables (4), Triangles (7),
  --           Surface Areas and Volumes (13)
  -- ─────────────────────────────────────────────────────────────────
  ('math','9',
   'Which of the following is an irrational number?',
   'निम्न में से कौन-सी संख्या अपरिमेय (irrational) है?',
   '["0.25","22/7","sqrt(2)","-3"]',
   2,
   'A number is irrational if it cannot be written as a ratio p/q of integers with q ≠ 0. sqrt(2) cannot be expressed in this form, so it is irrational. 0.25 = 1/4, 22/7, and -3 = -3/1 are all rational. (Chapter 1: Number Systems)',
   'अपरिमेय संख्या वह है जिसे पूर्णांकों p और q के अनुपात p/q (q ≠ 0) के रूप में नहीं लिखा जा सकता। sqrt(2) इस रूप में नहीं लिखी जा सकती, अतः यह अपरिमेय है। शेष तीनों परिमेय हैं। (अध्याय 1)',
   'A number whose decimal expansion is non-terminating and non-recurring is irrational.',
   1, 'remember',
   'Q24', 1),

  ('math','9',
   'If p(x) = x^2 - 5x + 6, then p(2) equals',
   'यदि p(x) = x^2 - 5x + 6 है, तो p(2) का मान है',
   '["0","2","4","6"]',
   0,
   'Substitute x = 2: p(2) = 4 - 10 + 6 = 0. So x = 2 is a zero of the polynomial. (Chapter 2: Polynomials)',
   'x = 2 रखने पर: p(2) = 4 - 10 + 6 = 0। अतः x = 2 इस बहुपद का शून्यक है। (अध्याय 2)',
   'Substitute x = 2 into the polynomial.',
   1, 'apply',
   'Q25', 2),

  ('math','9',
   'The point (3, -4) lies in which quadrant of the Cartesian plane?',
   'कार्तीय तल में बिंदु (3, -4) किस चतुर्थांश में है?',
   '["First","Second","Third","Fourth"]',
   3,
   'In quadrant IV, x is positive and y is negative. The point (3, -4) has x > 0 and y < 0, so it lies in the fourth quadrant. (Chapter 3: Coordinate Geometry)',
   'चतुर्थांश IV में x धनात्मक और y ऋणात्मक होता है। बिंदु (3, -4) में x > 0 और y < 0 है, अतः यह चौथे चतुर्थांश में स्थित है। (अध्याय 3)',
   'Check the signs of x and y to identify the quadrant.',
   1, 'apply',
   'Q26', 3),

  ('math','9',
   'The graph of the linear equation 2x + 3y = 12 cuts the x-axis at the point',
   'रैखिक समीकरण 2x + 3y = 12 का आरेख x-अक्ष को किस बिंदु पर काटता है?',
   '["(0, 4)","(4, 0)","(6, 0)","(0, 6)"]',
   2,
   'The x-axis means y = 0. Substituting y = 0: 2x = 12, so x = 6. The point of intersection with the x-axis is (6, 0). (Chapter 4: Linear Equations in Two Variables)',
   'x-अक्ष पर y = 0 होता है। y = 0 रखने पर: 2x = 12, अतः x = 6। x-अक्ष से प्रतिच्छेद बिंदु (6, 0) है। (अध्याय 4)',
   'On the x-axis, the y-coordinate is zero.',
   2, 'apply',
   'Q27', 4),

  ('math','9',
   'In a triangle, the sum of any two sides is always',
   'किसी त्रिभुज में, किन्हीं दो भुजाओं का योग सदैव होता है',
   '["less than the third side","equal to the third side","greater than the third side","equal to twice the third side"]',
   2,
   'The triangle inequality states that the sum of the lengths of any two sides of a triangle is greater than the length of the third side. (Chapter 7: Triangles)',
   'त्रिभुज असमिका कहती है कि त्रिभुज की किन्हीं दो भुजाओं की लंबाइयों का योग तीसरी भुजा की लंबाई से बड़ा होता है। (अध्याय 7)',
   'Recall the triangle inequality.',
   1, 'remember',
   'Q28', 7),

  ('math','9',
   'In a right-angled triangle, if the lengths of the two legs are 3 cm and 4 cm, the length of the hypotenuse is',
   'समकोण त्रिभुज की दो भुजाएँ 3 cm और 4 cm हैं, तो कर्ण की लंबाई होगी',
   '["5 cm","6 cm","7 cm","12 cm"]',
   0,
   'By the Pythagoras theorem, hypotenuse^2 = 3^2 + 4^2 = 9 + 16 = 25, so the hypotenuse = sqrt(25) = 5 cm. This is the classic 3-4-5 triple. (Chapter 7: Triangles)',
   'पाइथागोरस प्रमेय से कर्ण^2 = 3^2 + 4^2 = 9 + 16 = 25, अतः कर्ण = sqrt(25) = 5 cm। यह सुप्रसिद्ध 3-4-5 त्रिक है। (अध्याय 7)',
   'Apply h^2 = a^2 + b^2.',
   2, 'apply',
   'Q29', 7),

  ('math','9',
   'The volume of a cube of edge 4 cm is',
   '4 cm भुजा वाले एक घन का आयतन है',
   '["12 cm^3","16 cm^3","48 cm^3","64 cm^3"]',
   3,
   'Volume of a cube = (edge length)^3 = 4^3 = 64 cm^3. (Chapter 13: Surface Areas and Volumes)',
   'घन का आयतन = (भुजा)^3 = 4^3 = 64 cm^3। (अध्याय 13)',
   'Cube it.',
   1, 'apply',
   'Q30', 13)

) AS v(subject, grade, question_text, question_hi, options,
       correct_answer_index, explanation, explanation_hi, hint,
       difficulty, bloom_level,
       question_number, chapter_number)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2b. Seed question_bank — Class 10 (30 rows)
-- ───────────────────────────────────────────────────────────────────────
-- CBSE Class-10 uses a single 'science' subject code (combined Phy+Chem+
-- Bio). Distribution:
--   - 8 Physics-flavoured Science (light reflection/refraction, human eye,
--     electricity, magnetic effects of current)
--   - 8 Chemistry-flavoured Science (chemical reactions and equations,
--     acids/bases/salts, metals & non-metals, carbon and its compounds)
--   - 7 Biology-flavoured Science (life processes, control & coordination,
--     reproduction, heredity)
--   - 7 Math (real numbers, polynomials, quadratic equations, trigonometry,
--     circles, probability)
-- ───────────────────────────────────────────────────────────────────────

WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers
   WHERE paper_code = 'sample_cbse_class10_general_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_hi, question_type, options,
  correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, is_ncert, exam_paper_id, paper_pattern,
  marks_correct, marks_wrong, question_number, exam_session,
  chapter_number, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, v.question_hi,
       'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.explanation_hi, v.hint,
       v.difficulty, v.bloom_level,
       'curated_seed', 'board_paper', true, true, 'verified',
       true, true, pl.id, 'mcq_single',
       1.00, 0.00, v.question_number, 'sample_cbse_class10_2025',
       v.chapter_number,
       ARRAY['cbse_board','class10','sample','2025']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  -- ─────────────────────────────────────────────────────────────────
  -- Class 10 Science — Physics flavour (8 questions)
  -- Chapters: Light – Reflection and Refraction (10), Human Eye and
  --           Colourful World (11), Electricity (12), Magnetic Effects
  --           of Electric Current (13)
  -- ─────────────────────────────────────────────────────────────────
  ('science','10',
   'A concave mirror has a focal length of 15 cm. An object is placed 30 cm in front of it. The image formed will be',
   'एक अवतल दर्पण की फोकस दूरी 15 cm है। वस्तु को इसके सामने 30 cm की दूरी पर रखा जाता है। बनने वाला प्रतिबिंब होगा',
   '["Virtual, erect, magnified","Real, inverted, same size","Real, inverted, magnified","Virtual, erect, same size"]',
   1,
   'When the object is at 2f (= 2 x 15 = 30 cm), the image is formed at 2f on the same side — real, inverted, and the same size as the object. This is a standard case for a concave mirror. (Chapter 10: Light – Reflection and Refraction)',
   'जब वस्तु 2f (= 2 x 15 = 30 cm) पर हो, तो प्रतिबिंब उसी ओर 2f पर बनता है — वास्तविक, उल्टा और वस्तु के बराबर आकार का। यह अवतल दर्पण का मानक प्रकरण है। (अध्याय 10)',
   'Compare the object distance with f and 2f.',
   3, 'apply',
   'Q1', 10),

  ('science','10',
   'The refractive index of glass with respect to air is 1.5. The speed of light in glass is approximately (speed of light in air c = 3 x 10^8 m/s)',
   'काँच का वायु के सापेक्ष अपवर्तनांक 1.5 है। काँच में प्रकाश की चाल लगभग है (वायु में प्रकाश की चाल c = 3 x 10^8 m/s)',
   '["1.5 x 10^8 m/s","2 x 10^8 m/s","3 x 10^8 m/s","4.5 x 10^8 m/s"]',
   1,
   'Refractive index n = c / v, so v = c / n = (3 x 10^8) / 1.5 = 2 x 10^8 m/s. (Chapter 10: Light – Reflection and Refraction)',
   'अपवर्तनांक n = c / v, अतः v = c / n = (3 x 10^8) / 1.5 = 2 x 10^8 m/s। (अध्याय 10)',
   'Use v = c / n.',
   2, 'apply',
   'Q2', 10),

  ('science','10',
   'The image formed on the retina of a normal human eye is',
   'सामान्य मानव नेत्र के रेटिना (दृष्टिपटल) पर बनने वाला प्रतिबिंब होता है',
   '["real and inverted","real and erect","virtual and inverted","virtual and erect"]',
   0,
   'The eye lens is convex; it forms a real, inverted, diminished image on the retina. The brain re-orients the inverted image so we perceive the world upright. (Chapter 11: Human Eye and Colourful World)',
   'नेत्र का लेंस उत्तल होता है; यह रेटिना पर वास्तविक, उल्टा और छोटा प्रतिबिंब बनाता है। मस्तिष्क उल्टे प्रतिबिंब को सीधा करके दर्शाता है। (अध्याय 11)',
   'A convex lens forms what kind of image of a distant object?',
   1, 'understand',
   'Q3', 11),

  ('science','10',
   'A person who cannot see distant objects clearly is suffering from',
   'जो व्यक्ति दूर की वस्तुओं को स्पष्ट नहीं देख पाता, वह किस दृष्टि-दोष से ग्रस्त है?',
   '["hypermetropia (long-sightedness)","myopia (short-sightedness)","presbyopia","astigmatism"]',
   1,
   'Myopia (short-sightedness) is the inability to see distant objects clearly because the image is formed in front of the retina. It is corrected with a concave (diverging) lens. (Chapter 11: Human Eye and Colourful World)',
   'मायोपिया (निकट-दृष्टि) में दूर की वस्तुएँ स्पष्ट नहीं दिखतीं क्योंकि प्रतिबिंब रेटिना के सामने बनता है। इसे अवतल (अपसारी) लेंस से ठीक किया जाता है। (अध्याय 11)',
   'Short-sighted = sees nearby objects fine but blurry far away.',
   1, 'remember',
   'Q4', 11),

  ('science','10',
   'The equivalent resistance of two resistors of 4 ohm and 12 ohm connected in series is',
   '4 ohm और 12 ohm के दो प्रतिरोधक श्रेणी (series) क्रम में जुड़े हैं। तुल्य प्रतिरोध है',
   '["3 ohm","8 ohm","16 ohm","48 ohm"]',
   2,
   'Resistors in series add: R_eq = R1 + R2 = 4 + 12 = 16 ohm. (Chapter 12: Electricity)',
   'श्रेणी क्रम में प्रतिरोध जुड़ते हैं: R_तुल्य = R1 + R2 = 4 + 12 = 16 ohm। (अध्याय 12)',
   'Series resistors add directly.',
   1, 'apply',
   'Q5', 12),

  ('science','10',
   'A bulb is rated 60 W at 220 V. The current drawn by the bulb at this voltage is approximately',
   'एक बल्ब पर 220 V पर 60 W अंकित है। इस वोल्टता पर बल्ब द्वारा खींची गई धारा लगभग है',
   '["0.27 A","0.55 A","2.7 A","3.7 A"]',
   0,
   'Power P = VI gives I = P / V = 60 / 220 = 0.273 A, approximately 0.27 A. (Chapter 12: Electricity)',
   'P = VI से I = P / V = 60 / 220 = 0.273 A, लगभग 0.27 A। (अध्याय 12)',
   'Use I = P / V.',
   2, 'apply',
   'Q6', 12),

  ('science','10',
   'The direction of the magnetic field produced by a straight current-carrying conductor is given by',
   'सीधे धारा-वहन चालक से उत्पन्न चुंबकीय क्षेत्र की दिशा किस नियम से ज्ञात की जाती है?',
   '["Fleming''s left-hand rule","Fleming''s right-hand rule","Maxwell''s right-hand thumb rule","Lenz''s law"]',
   2,
   'Maxwell''s right-hand thumb rule (curl rule) gives the direction of the magnetic field around a straight current-carrying conductor: thumb along current, curled fingers along the field. Fleming''s rules apply to force / induced current, not field direction. (Chapter 13: Magnetic Effects of Electric Current)',
   'मैक्सवेल का दाएँ हाथ का अंगूठा नियम (कर्ल नियम) सीधे धारा-वहन चालक के चारों ओर चुंबकीय क्षेत्र की दिशा बताता है: अंगूठा धारा की दिशा में, मुड़ी उँगलियाँ क्षेत्र की दिशा में। फ्लेमिंग के नियम बल / प्रेरित धारा के लिए हैं। (अध्याय 13)',
   'The thumb-along-current, fingers-along-field rule.',
   2, 'remember',
   'Q7', 13),

  ('science','10',
   'A magnetic field is produced around a current-carrying conductor. If the current is doubled while the distance from the wire is unchanged, the magnetic field at that point will',
   'एक धारा-वहन चालक के चारों ओर चुंबकीय क्षेत्र बनता है। यदि तार से दूरी अपरिवर्तित रखते हुए धारा दोगुनी कर दी जाए, तो उस बिंदु पर चुंबकीय क्षेत्र',
   '["become half","stay the same","double","become four times"]',
   2,
   'For a long straight conductor, the magnetic field at a fixed point is directly proportional to the current (B is proportional to I). Doubling I doubles B at that point. (Chapter 13: Magnetic Effects of Electric Current)',
   'सीधे लंबे चालक के लिए, स्थिर बिंदु पर चुंबकीय क्षेत्र धारा के अनुक्रमानुपाती होता है (B ∝ I)। धारा दोगुनी करने पर B भी दोगुना हो जाता है। (अध्याय 13)',
   'For a long straight wire, B is proportional to I at a fixed distance.',
   2, 'understand',
   'Q8', 13),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 10 Science — Chemistry flavour (8 questions)
  -- Chapters: Chemical Reactions and Equations (1), Acids, Bases and
  --           Salts (2), Metals and Non-metals (3), Carbon and Its
  --           Compounds (4)
  -- ─────────────────────────────────────────────────────────────────
  ('science','10',
   'The reaction Zn + CuSO4 -> ZnSO4 + Cu is an example of',
   'अभिक्रिया Zn + CuSO4 -> ZnSO4 + Cu किसका उदाहरण है?',
   '["combination reaction","decomposition reaction","displacement reaction","double displacement reaction"]',
   2,
   'Zinc is more reactive than copper and displaces it from copper sulphate solution. This is a single displacement reaction. (Chapter 1: Chemical Reactions and Equations)',
   'जिंक, कॉपर से अधिक अभिक्रियाशील है और इसे कॉपर सल्फेट विलयन से विस्थापित कर देता है। यह विस्थापन अभिक्रिया का उदाहरण है। (अध्याय 1)',
   'A more reactive metal pushing a less reactive one out is called what?',
   1, 'understand',
   'Q9', 1),

  ('science','10',
   'When a strip of copper is dipped in silver nitrate solution, the solution slowly turns blue. The blue colour is due to',
   'जब कॉपर की पट्टी सिल्वर नाइट्रेट विलयन में डाली जाती है, तो विलयन धीरे-धीरे नीला हो जाता है। यह नीला रंग किसके कारण है?',
   '["formation of silver ions","formation of copper(II) ions","formation of nitrate ions","precipitation of silver"]',
   1,
   'Copper displaces silver from silver nitrate: Cu + 2 AgNO3 -> Cu(NO3)2 + 2 Ag. The Cu(NO3)2 in solution contains Cu^2+ ions, which give the characteristic blue colour. Silver metal separates out as a grey deposit. (Chapter 1: Chemical Reactions and Equations)',
   'कॉपर सिल्वर को विस्थापित करता है: Cu + 2 AgNO3 -> Cu(NO3)2 + 2 Ag। विलयन में Cu(NO3)2 के Cu^2+ आयन नीला रंग देते हैं। सिल्वर धात्विक रूप में अलग हो जाता है। (अध्याय 1)',
   'What ion in solution is blue?',
   2, 'understand',
   'Q10', 1),

  ('science','10',
   'When an acid reacts with a metal, the gas usually evolved is',
   'जब अम्ल किसी धातु से अभिक्रिया करता है, तो सामान्यतः कौन सी गैस निकलती है?',
   '["oxygen","hydrogen","carbon dioxide","chlorine"]',
   1,
   'Metals reacting with dilute acids displace hydrogen, e.g. Zn + 2 HCl -> ZnCl2 + H2. The evolved gas burns with a pop sound, confirming hydrogen. (Chapter 2: Acids, Bases and Salts)',
   'धातुओं और तनु अम्ल की अभिक्रिया में हाइड्रोजन गैस निकलती है, जैसे Zn + 2 HCl -> ZnCl2 + H2। यह गैस पॉप ध्वनि के साथ जलती है। (अध्याय 2)',
   'Pop-sound test confirms which gas?',
   1, 'remember',
   'Q11', 2),

  ('science','10',
   'A neutral solution has a pH of',
   'किसी उदासीन विलयन का pH मान होता है',
   '["less than 7","equal to 7","greater than 7","between 5 and 6"]',
   1,
   'On the pH scale, pH = 7 is neutral, pH < 7 is acidic, and pH > 7 is basic. Pure water at 25 degrees Celsius has pH = 7. (Chapter 2: Acids, Bases and Salts)',
   'pH पैमाने पर pH = 7 उदासीन, pH < 7 अम्लीय और pH > 7 क्षारीय होता है। 25 डिग्री सेल्सियस पर शुद्ध जल का pH = 7 है। (अध्याय 2)',
   'Recall the neutral value on the pH scale.',
   1, 'remember',
   'Q12', 2),

  ('science','10',
   'In the reactivity series, which of the following metals is the most reactive?',
   'सक्रियता श्रेणी में निम्न में से सबसे अधिक अभिक्रियाशील धातु कौन सी है?',
   '["Iron","Zinc","Copper","Potassium"]',
   3,
   'In the activity series the order (most to least reactive) for these metals is: K > Zn > Fe > Cu. Potassium is the most reactive and reacts vigorously even with cold water. (Chapter 3: Metals and Non-metals)',
   'सक्रियता श्रेणी में इन धातुओं का क्रम (सबसे अधिक से कम अभिक्रियाशील): K > Zn > Fe > Cu। पोटैशियम सबसे अधिक अभिक्रियाशील है और ठंडे जल से भी प्रबल अभिक्रिया करता है। (अध्याय 3)',
   'Which alkali metal from the options reacts even with cold water?',
   2, 'remember',
   'Q13', 3),

  ('science','10',
   'Which of the following metals is the best conductor of electricity?',
   'निम्न में से कौन सी धातु विद्युत की सबसे अच्छी चालक है?',
   '["Copper","Iron","Aluminium","Silver"]',
   3,
   'Silver is the best conductor of electricity (resistivity ~ 1.59 x 10^-8 ohm m), followed by copper. Copper is used in domestic wiring because it is cheaper than silver. (Chapter 3: Metals and Non-metals)',
   'विद्युत का सबसे अच्छा चालक चांदी (silver) है (प्रतिरोधकता ~ 1.59 x 10^-8 ohm m), उसके बाद कॉपर आता है। कॉपर को घरेलू वायरिंग में सस्ता होने के कारण इस्तेमाल किया जाता है। (अध्याय 3)',
   'It''s a precious metal and the best electrical conductor.',
   1, 'remember',
   'Q14', 3),

  ('science','10',
   'The general formula of an alkane is',
   'ऐल्केन (alkane) का सामान्य सूत्र है',
   '["CnH2n","CnH2n+2","CnH2n-2","CnHn"]',
   1,
   'Alkanes are saturated hydrocarbons with only single C-C bonds, and the general formula is CnH(2n+2). Alkenes have one double bond and the formula CnH2n; alkynes have one triple bond and CnH(2n-2). (Chapter 4: Carbon and Its Compounds)',
   'ऐल्केन संतृप्त हाइड्रोकार्बन हैं जिनमें केवल एकल C-C बंध होते हैं और इनका सामान्य सूत्र CnH(2n+2) है। ऐल्कीन के लिए CnH2n और ऐल्काइन के लिए CnH(2n-2)। (अध्याय 4)',
   'Saturated hydrocarbons take this general form.',
   2, 'remember',
   'Q15', 4),

  ('science','10',
   'Which of the following compounds contains a carboxylic acid functional group?',
   'निम्न में से किस यौगिक में कार्बोक्सिलिक अम्ल का क्रियात्मक समूह उपस्थित है?',
   '["CH3-CH2-OH","CH3-CHO","CH3-COOH","CH3-O-CH3"]',
   2,
   'CH3-COOH (acetic acid / ethanoic acid) contains the -COOH carboxylic acid group. CH3-CH2-OH is an alcohol, CH3-CHO is an aldehyde, CH3-O-CH3 is an ether. (Chapter 4: Carbon and Its Compounds)',
   'CH3-COOH (एसीटिक अम्ल / इथेनोइक अम्ल) में -COOH कार्बोक्सिलिक अम्ल समूह होता है। शेष क्रमशः ऐल्कोहल, ऐल्डिहाइड और ईथर हैं। (अध्याय 4)',
   'The functional group is -COOH.',
   1, 'understand',
   'Q16', 4),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 10 Science — Biology flavour (7 questions)
  -- Chapters: Life Processes (5), Control and Coordination (6), How Do
  --           Organisms Reproduce (7), Heredity (8)
  -- ─────────────────────────────────────────────────────────────────
  ('science','10',
   'Which of the following processes in plants converts sunlight into chemical energy?',
   'पौधों में निम्न में से कौन सी प्रक्रिया सूर्य के प्रकाश को रासायनिक ऊर्जा में बदलती है?',
   '["respiration","transpiration","photosynthesis","translocation"]',
   2,
   'Photosynthesis is the process by which green plants use sunlight, water and carbon dioxide to make glucose and oxygen, converting light energy into chemical energy. (Chapter 5: Life Processes)',
   'प्रकाश-संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे सूर्य के प्रकाश, जल और कार्बन डाइऑक्साइड से ग्लूकोज़ और ऑक्सीजन बनाते हैं — अर्थात् प्रकाश ऊर्जा को रासायनिक ऊर्जा में बदलते हैं। (अध्याय 5)',
   'Light energy + CO2 + H2O -> ?',
   1, 'remember',
   'Q17', 5),

  ('science','10',
   'In humans, the exchange of gases (oxygen and carbon dioxide) between blood and air occurs in the',
   'मानव में रक्त और वायु के बीच (ऑक्सीजन और कार्बन डाइऑक्साइड का) विनिमय कहाँ होता है?',
   '["trachea","bronchi","alveoli","diaphragm"]',
   2,
   'Alveoli are the tiny thin-walled air sacs in the lungs where gas exchange occurs by diffusion: O2 moves from alveolar air into blood, and CO2 moves from blood into alveolar air. (Chapter 5: Life Processes)',
   'अल्वियोलाई (कूपिकाएँ) फेफड़ों में पतली दीवार वाली छोटी वायु थैलियाँ हैं जहाँ विसरण द्वारा गैस विनिमय होता है: O2 कूपिकीय वायु से रक्त में और CO2 रक्त से कूपिकीय वायु में जाती है। (अध्याय 5)',
   'Tiny grape-like sacs at the end of the bronchioles.',
   2, 'understand',
   'Q18', 5),

  ('science','10',
   'The gap between two neurons across which a nerve impulse is transmitted is called',
   'दो न्यूरॉनों के बीच का वह अंतराल जिसके आर-पार तंत्रिका आवेग संचरित होता है, कहलाता है',
   '["axon","dendrite","synapse","myelin sheath"]',
   2,
   'A synapse is the small gap between the axon terminal of one neuron and the dendrite of the next. The impulse is transmitted across by neurotransmitter chemicals. (Chapter 6: Control and Coordination)',
   'सिनैप्स एक न्यूरॉन के अक्षतंतु के सिरे और अगले न्यूरॉन के डेन्ड्राइट के बीच का छोटा अंतराल है। न्यूरोट्रांसमीटर रसायनों द्वारा आवेग का संचरण होता है। (अध्याय 6)',
   'Neurotransmitters cross this gap.',
   1, 'remember',
   'Q19', 6),

  ('science','10',
   'Which of the following is a method of asexual reproduction?',
   'निम्न में से कौन सी अलैंगिक जनन की एक विधि है?',
   '["pollination","fertilisation","budding","gamete fusion"]',
   2,
   'Budding (seen in Hydra and yeast) is an asexual method in which a new individual grows out of a bud on the parent. Pollination, fertilisation and gamete fusion are part of sexual reproduction. (Chapter 7: How Do Organisms Reproduce)',
   'मुकुलन (Hydra और यीस्ट में पाया जाता है) अलैंगिक जनन की विधि है जिसमें जनक के शरीर पर मुकुल से नया जीव विकसित होता है। शेष विकल्प लैंगिक जनन के भाग हैं। (अध्याय 7)',
   'Hydra and yeast are the textbook examples.',
   1, 'remember',
   'Q20', 7),

  ('science','10',
   'Mendel chose pea plants for his experiments because they',
   'मेंडल ने अपने प्रयोगों के लिए मटर के पौधे को चुना क्योंकि',
   '["are large in size","have a long life cycle","show clearly contrasting traits and a short life cycle","produce only seeds, never flowers"]',
   2,
   'Mendel chose Pisum sativum (garden pea) because it shows several pairs of clearly contrasting traits (round/wrinkled seeds, tall/dwarf plants etc.), has a relatively short life cycle, and is easy to cross-pollinate by hand. (Chapter 8: Heredity)',
   'मेंडल ने मटर (Pisum sativum) को चुना क्योंकि इसमें स्पष्ट विरोधी लक्षण-युग्म (गोल/झुर्रीदार बीज, लंबा/बौना पौधा आदि) हैं, इसकी जीवन-चक्र अवधि कम है और इसका कृत्रिम परागण आसान है। (अध्याय 8)',
   'Why is the pea plant a model genetics organism?',
   2, 'understand',
   'Q21', 8),

  ('science','10',
   'In humans, a child''s sex is determined by',
   'मानव में किसी संतान का लिंग किस से निर्धारित होता है?',
   '["the mother''s X chromosome","the father''s sex chromosome (X or Y)","environmental factors","random chance unrelated to chromosomes"]',
   1,
   'Human females are XX and males are XY. The mother always contributes an X chromosome; the father contributes either X (girl) or Y (boy). So the sex of the child depends on which sex chromosome the father contributes. (Chapter 8: Heredity)',
   'मानव में स्त्रियाँ XX और पुरुष XY होते हैं। माँ हमेशा X देती है; पिता X (कन्या) या Y (पुत्र) देता है। अतः संतान का लिंग पिता द्वारा दिए गए लिंग गुणसूत्र पर निर्भर करता है। (अध्याय 8)',
   'X or Y comes from the father.',
   2, 'understand',
   'Q22', 8),

  ('science','10',
   'A pure tall pea plant (TT) is crossed with a pure dwarf pea plant (tt). The phenotype of the F1 generation will be',
   'शुद्ध लंबा मटर का पौधा (TT) शुद्ध बौने मटर (tt) से संकरित किया जाता है। F1 पीढ़ी का लक्षणप्ररूप होगा',
   '["all tall","all dwarf","50% tall, 50% dwarf","75% tall, 25% dwarf"]',
   0,
   'Each F1 plant inherits T from the tall parent and t from the dwarf parent, producing the heterozygous Tt. Since T (tall) is dominant over t (dwarf), all F1 plants are tall. (Chapter 8: Heredity)',
   'प्रत्येक F1 पौधा लंबे जनक से T और बौने जनक से t प्राप्त करता है, जिससे विषमयुग्मजी Tt बनता है। T (लंबा) t (बौना) पर प्रभावी है, इसलिए सभी F1 पौधे लंबे होंगे। (अध्याय 8)',
   'Dominance of T over t — what comes through in the F1?',
   2, 'apply',
   'Q23', 8),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 10 Math (7 questions)
  -- Chapters: Real Numbers (1), Polynomials (2), Quadratic Equations (4),
  --           Trigonometry (8), Circles (10), Probability (15)
  -- ─────────────────────────────────────────────────────────────────
  ('math','10',
   'The HCF of 12 and 18 is',
   '12 और 18 का म.स.प. (HCF) है',
   '["2","3","6","36"]',
   2,
   '12 = 2^2 x 3; 18 = 2 x 3^2. HCF = 2^1 x 3^1 = 6. (Chapter 1: Real Numbers)',
   '12 = 2^2 x 3; 18 = 2 x 3^2। HCF = 2^1 x 3^1 = 6। (अध्याय 1)',
   'Take the lowest power of each common prime factor.',
   1, 'apply',
   'Q24', 1),

  ('math','10',
   'The sum of the zeroes of the polynomial p(x) = x^2 - 5x + 6 is',
   'बहुपद p(x) = x^2 - 5x + 6 के शून्यकों का योग है',
   '["-5","5","6","-6"]',
   1,
   'For a quadratic ax^2 + bx + c, the sum of the zeroes is -b/a. Here a = 1, b = -5, so the sum is -(-5)/1 = 5. (Chapter 2: Polynomials)',
   'द्विघात ax^2 + bx + c के लिए शून्यकों का योग -b/a होता है। यहाँ a = 1, b = -5, अतः योग = -(-5)/1 = 5। (अध्याय 2)',
   'Sum of zeroes = -b/a.',
   2, 'apply',
   'Q25', 2),

  ('math','10',
   'The discriminant of the quadratic equation 2x^2 - 4x + 1 = 0 is',
   'द्विघात समीकरण 2x^2 - 4x + 1 = 0 का विविक्तकर (discriminant) है',
   '["0","4","8","12"]',
   2,
   'For ax^2 + bx + c = 0 the discriminant is b^2 - 4ac. Here a = 2, b = -4, c = 1, so D = (-4)^2 - 4(2)(1) = 16 - 8 = 8. (Chapter 4: Quadratic Equations)',
   'ax^2 + bx + c = 0 के लिए विविक्तकर b^2 - 4ac होता है। यहाँ a = 2, b = -4, c = 1, अतः D = 16 - 8 = 8। (अध्याय 4)',
   'Apply b^2 - 4ac.',
   2, 'apply',
   'Q26', 4),

  ('math','10',
   'The value of sin 30 degrees + cos 60 degrees is',
   'sin 30 अंश + cos 60 अंश का मान है',
   '["1/2","1","sqrt(3)/2","2"]',
   1,
   'sin 30 degrees = 1/2 and cos 60 degrees = 1/2. Sum = 1/2 + 1/2 = 1. (Chapter 8: Introduction to Trigonometry)',
   'sin 30 = 1/2 और cos 60 = 1/2। योग = 1/2 + 1/2 = 1। (अध्याय 8)',
   'Recall the standard table values at 30 and 60 degrees.',
   1, 'remember',
   'Q27', 8),

  ('math','10',
   'A tangent to a circle touches the circle at',
   'किसी वृत्त की स्पर्श रेखा वृत्त को स्पर्श करती है',
   '["zero points","exactly one point","exactly two points","infinitely many points"]',
   1,
   'By definition, a tangent to a circle is a straight line that touches the circle at exactly one point — the point of contact. A secant cuts the circle at two points. (Chapter 10: Circles)',
   'परिभाषा के अनुसार, स्पर्श रेखा वृत्त को ठीक एक बिंदु पर — स्पर्श बिंदु पर — स्पर्श करती है। छेदक रेखा दो बिंदुओं पर काटती है। (अध्याय 10)',
   'Tangent vs secant: count the points of intersection.',
   1, 'remember',
   'Q28', 10),

  ('math','10',
   'A die is rolled once. The probability of getting an even number is',
   'एक पासे को एक बार फेंका जाता है। सम (even) संख्या आने की प्रायिकता है',
   '["1/6","1/3","1/2","2/3"]',
   2,
   'Even outcomes on a fair die: {2, 4, 6}, that is 3 outcomes out of 6. P(even) = 3 / 6 = 1/2. (Chapter 15: Probability)',
   'पासे पर सम संख्याएँ {2, 4, 6} हैं — 6 में से 3 परिणाम। P(सम) = 3 / 6 = 1/2। (अध्याय 15)',
   'Count even faces over total faces.',
   1, 'apply',
   'Q29', 15),

  ('math','10',
   'If tan A = 1, then the value of A (in degrees) where 0 degrees <= A <= 90 degrees is',
   'यदि tan A = 1, तो 0 अंश <= A <= 90 अंश के बीच A का मान (अंशों में) है',
   '["0","30","45","60"]',
   2,
   'tan 45 degrees = 1 from the standard trigonometric values, so A = 45 degrees. (Chapter 8: Introduction to Trigonometry)',
   'मानक त्रिकोणमितीय मानों से tan 45 = 1, अतः A = 45 अंश। (अध्याय 8)',
   'Recall tan(45 degrees).',
   1, 'remember',
   'Q30', 8)

) AS v(subject, grade, question_text, question_hi, options,
       correct_answer_index, explanation, explanation_hi, hint,
       difficulty, bloom_level,
       question_number, chapter_number)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2c. Seed question_bank — Class 11 (30 rows)
-- ───────────────────────────────────────────────────────────────────────
-- Class 11 introduces separate stream subjects per the CBSE curriculum:
-- Physics, Chemistry, Biology, Math are distinct subject codes (no longer
-- combined as 'science'). Distribution:
--   - 8 Physics (motion in a straight line, laws of motion, work-energy-
--     power, gravitation, thermodynamics)
--   - 8 Chemistry (basic concepts, atomic structure, periodic
--     classification, chemical bonding)
--   - 7 Biology (cell, biomolecules, plant physiology, human physiology
--     – digestion)
--   - 7 Math (sets, relations and functions, trigonometry, complex
--     numbers, sequences and series, straight lines)
-- ───────────────────────────────────────────────────────────────────────

WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers
   WHERE paper_code = 'sample_cbse_class11_general_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_hi, question_type, options,
  correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, is_ncert, exam_paper_id, paper_pattern,
  marks_correct, marks_wrong, question_number, exam_session,
  chapter_number, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, v.question_hi,
       'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.explanation_hi, v.hint,
       v.difficulty, v.bloom_level,
       'curated_seed', 'board_paper', true, true, 'verified',
       true, true, pl.id, 'mcq_single',
       1.00, 0.00, v.question_number, 'sample_cbse_class11_2025',
       v.chapter_number,
       ARRAY['cbse_board','class11','sample','2025']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  -- ─────────────────────────────────────────────────────────────────
  -- Class 11 Physics (8 questions)
  -- Chapters: Motion in a Straight Line (3), Laws of Motion (5),
  --           Work, Energy and Power (6), Gravitation (8),
  --           Thermodynamics (12)
  -- ─────────────────────────────────────────────────────────────────
  ('physics','11',
   'A car starts from rest and accelerates uniformly at 2 m/s^2 for 5 seconds. The final velocity is',
   'एक कार विरामावस्था से प्रारंभ होकर 5 सेकंड तक 2 m/s^2 के एकसमान त्वरण से चलती है। अंतिम वेग है',
   '["2 m/s","5 m/s","10 m/s","25 m/s"]',
   2,
   'Using v = u + at with u = 0, a = 2 m/s^2, t = 5 s: v = 0 + 2 x 5 = 10 m/s. (Chapter 3: Motion in a Straight Line)',
   'v = u + at में u = 0, a = 2 m/s^2, t = 5 s: v = 0 + 2 x 5 = 10 m/s। (अध्याय 3)',
   'Use v = u + at with u = 0.',
   1, 'apply',
   'Q1', 3),

  ('physics','11',
   'The slope of a position-time graph for a body moving with uniform velocity represents',
   'एकसमान वेग से चलने वाले पिंड के स्थिति-समय आरेख का ढाल किसको दर्शाता है?',
   '["acceleration","velocity","displacement","time"]',
   1,
   'On a position-time graph, the slope equals d(position)/d(time), which is by definition the velocity. A straight (non-vertical) line indicates uniform velocity. (Chapter 3: Motion in a Straight Line)',
   'स्थिति-समय आरेख का ढाल d(स्थिति)/d(समय) के बराबर होता है, जो परिभाषा से वेग है। सीधी (अनऊर्ध्व) रेखा एकसमान वेग दर्शाती है। (अध्याय 3)',
   'd(position)/d(time) = ?',
   1, 'understand',
   'Q2', 3),

  ('physics','11',
   'A constant force of 10 N acts on a 2 kg block resting on a frictionless surface. The acceleration of the block is',
   '2 kg के एक खंड पर, जो घर्षणरहित सतह पर रखा है, 10 N का स्थिर बल लगता है। खंड का त्वरण है',
   '["0.2 m/s^2","2 m/s^2","5 m/s^2","20 m/s^2"]',
   2,
   'By Newton''s second law a = F/m = 10 / 2 = 5 m/s^2. (Chapter 5: Laws of Motion)',
   'न्यूटन के दूसरे नियम से a = F/m = 10 / 2 = 5 m/s^2। (अध्याय 5)',
   'Use a = F/m.',
   1, 'apply',
   'Q3', 5),

  ('physics','11',
   'Newton''s third law of motion states that',
   'न्यूटन का गति का तीसरा नियम कहता है कि',
   '["force is the rate of change of momentum","every action has an equal and opposite reaction","an object in motion stays in motion","force equals mass times acceleration"]',
   1,
   'Newton''s third law: to every action there is an equal and opposite reaction. The first option restates the second law, the third paraphrases the first law, the fourth is F = ma. (Chapter 5: Laws of Motion)',
   'न्यूटन का तीसरा नियम: प्रत्येक क्रिया के बराबर और विपरीत प्रतिक्रिया होती है। पहला विकल्प दूसरे नियम का रूप है, तीसरा पहले नियम का, चौथा F = ma है। (अध्याय 5)',
   'Action-reaction pairs.',
   1, 'remember',
   'Q4', 5),

  ('physics','11',
   'A block of mass 2 kg is moved through a horizontal distance of 5 m by applying a constant horizontal force of 10 N. The work done on the block by this force is',
   '2 kg द्रव्यमान के एक खंड पर 10 N का स्थिर क्षैतिज बल लगाकर उसे 5 m की क्षैतिज दूरी तक ले जाया जाता है। बल द्वारा किया गया कार्य है',
   '["10 J","20 J","50 J","100 J"]',
   2,
   'Work W = F d cos theta. Force is parallel to displacement (theta = 0), so W = 10 x 5 x 1 = 50 J. (Chapter 6: Work, Energy and Power)',
   'कार्य W = F d cos theta। बल और विस्थापन समान दिशा में (theta = 0), अतः W = 10 x 5 x 1 = 50 J। (अध्याय 6)',
   'Use W = F d cos theta; here theta = 0.',
   2, 'apply',
   'Q5', 6),

  ('physics','11',
   'The kinetic energy of an object of mass 4 kg moving with a speed of 10 m/s is',
   '4 kg द्रव्यमान की वस्तु 10 m/s की चाल से चल रही है। उसकी गतिज ऊर्जा है',
   '["20 J","40 J","100 J","200 J"]',
   3,
   'KE = (1/2) m v^2 = (1/2) x 4 x 100 = 200 J. (Chapter 6: Work, Energy and Power)',
   'KE = (1/2) m v^2 = (1/2) x 4 x 100 = 200 J। (अध्याय 6)',
   'Use KE = (1/2) m v^2.',
   2, 'apply',
   'Q6', 6),

  ('physics','11',
   'According to Newton''s law of gravitation, the force between two point masses is inversely proportional to',
   'न्यूटन के गुरुत्वाकर्षण नियम के अनुसार, दो बिंदु-द्रव्यमानों के बीच बल किसके व्युत्क्रमानुपाती होता है?',
   '["the distance between them","the square of the distance between them","the cube of the distance between them","the sum of their masses"]',
   1,
   'F = G m1 m2 / r^2. The force is inversely proportional to the square of the distance between the masses. (Chapter 8: Gravitation)',
   'F = G m1 m2 / r^2। बल द्रव्यमानों के बीच की दूरी के वर्ग के व्युत्क्रमानुपाती होता है। (अध्याय 8)',
   'It''s an inverse-square law.',
   1, 'remember',
   'Q7', 8),

  ('physics','11',
   'The first law of thermodynamics is essentially a statement of',
   'ऊष्मागतिकी का पहला नियम मूलतः किसका कथन है?',
   '["conservation of momentum","conservation of energy","conservation of mass","increase of entropy"]',
   1,
   'The first law of thermodynamics, dU = dQ - dW, is a restatement of energy conservation for systems exchanging heat and work. The increase of entropy refers to the second law. (Chapter 12: Thermodynamics)',
   'ऊष्मागतिकी का पहला नियम, dU = dQ - dW, ऊष्मा और कार्य के विनिमय वाले निकायों के लिए ऊर्जा संरक्षण का कथन है। एन्ट्रॉपी वृद्धि दूसरा नियम है। (अध्याय 12)',
   'It links heat, work and internal energy.',
   2, 'understand',
   'Q8', 12),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 11 Chemistry (8 questions)
  -- Chapters: Some Basic Concepts of Chemistry (1), Structure of Atom (2),
  --           Classification of Elements and Periodicity (3),
  --           Chemical Bonding and Molecular Structure (4)
  -- ─────────────────────────────────────────────────────────────────
  ('chemistry','11',
   'The number of moles of CO2 produced when 0.5 mol of CaCO3 is completely decomposed by heating is',
   '0.5 mol CaCO3 को गर्म करके पूर्णतः अपघटित करने पर बनने वाले CO2 के मोलों की संख्या है',
   '["0.25 mol","0.5 mol","1.0 mol","2.0 mol"]',
   1,
   'CaCO3 -> CaO + CO2. The 1:1 stoichiometry means 0.5 mol CaCO3 yields 0.5 mol CO2. (Chapter 1: Some Basic Concepts of Chemistry)',
   'CaCO3 -> CaO + CO2। 1:1 स्टॉइकियोमेट्री से 0.5 mol CaCO3 से 0.5 mol CO2 बनेगी। (अध्याय 1)',
   'Balanced equation gives the mole ratio directly.',
   2, 'apply',
   'Q9', 1),

  ('chemistry','11',
   'How many atoms are present in 1 mole of any element? (Avogadro number = 6.022 x 10^23)',
   'किसी भी तत्व के 1 मोल में कितने परमाणु होते हैं? (Avogadro संख्या = 6.022 x 10^23)',
   '["6.022 x 10^23","12.044 x 10^23","3.011 x 10^23","1.022 x 10^22"]',
   0,
   'One mole of any substance contains Avogadro number (6.022 x 10^23) of particles by definition. (Chapter 1: Some Basic Concepts of Chemistry)',
   'किसी भी पदार्थ के एक मोल में परिभाषा से Avogadro संख्या (6.022 x 10^23) कण होते हैं। (अध्याय 1)',
   'Recall the definition of a mole.',
   1, 'remember',
   'Q10', 1),

  ('chemistry','11',
   'According to the Bohr model of the hydrogen atom, the electron in the n = 2 orbit has energy',
   'हाइड्रोजन परमाणु के Bohr मॉडल के अनुसार, n = 2 कक्षा में इलेक्ट्रॉन की ऊर्जा है',
   '["-13.6 eV","-6.8 eV","-3.4 eV","-1.51 eV"]',
   2,
   'Bohr model energy: E_n = -13.6 / n^2 eV. For n = 2, E_2 = -13.6 / 4 = -3.4 eV. (Chapter 2: Structure of Atom)',
   'Bohr मॉडल में E_n = -13.6 / n^2 eV। n = 2 के लिए E_2 = -13.6 / 4 = -3.4 eV। (अध्याय 2)',
   'Use E_n = -13.6 / n^2 eV.',
   2, 'apply',
   'Q11', 2),

  ('chemistry','11',
   'The maximum number of electrons in a p-subshell is',
   'p-उपकोश में अधिकतम कितने इलेक्ट्रॉन समा सकते हैं?',
   '["2","6","10","14"]',
   1,
   'A p-subshell has 3 orbitals (px, py, pz), each holding 2 electrons, giving a maximum of 6 electrons. (Chapter 2: Structure of Atom)',
   'p-उपकोश में 3 कक्षक (px, py, pz) होते हैं, प्रत्येक में 2 इलेक्ट्रॉन, अर्थात अधिकतम 6 इलेक्ट्रॉन। (अध्याय 2)',
   '3 orbitals x 2 electrons each.',
   1, 'remember',
   'Q12', 2),

  ('chemistry','11',
   'Across a period in the modern periodic table, the atomic radius generally',
   'आधुनिक आवर्त सारणी में किसी आवर्त (period) में बाएँ से दाएँ जाने पर परमाणु त्रिज्या सामान्यतः',
   '["increases","decreases","first decreases then increases","remains the same"]',
   1,
   'Across a period (left to right), the effective nuclear charge increases while electrons are added to the same shell. The stronger pull on the same-shell electrons reduces the atomic radius. (Chapter 3: Classification of Elements and Periodicity)',
   'किसी आवर्त में बाएँ से दाएँ जाने पर प्रभावी नाभिकीय आवेश बढ़ता है जबकि इलेक्ट्रॉन उसी कक्ष में जुड़ते हैं। इससे उसी कक्ष के इलेक्ट्रॉनों पर अधिक खिंचाव पड़ता है और परमाणु त्रिज्या घटती है। (अध्याय 3)',
   'Effective nuclear charge pulls electrons closer.',
   2, 'understand',
   'Q13', 3),

  ('chemistry','11',
   'Which of the following has the highest first ionisation enthalpy?',
   'निम्न में से किसका प्रथम आयनन एन्थैल्पी सबसे अधिक है?',
   '["Li","Na","K","Cs"]',
   0,
   'In Group 1, ionisation enthalpy decreases down the group because the outermost electron is farther from the nucleus and more shielded. So Li (Period 2) has the highest first ionisation enthalpy among the four. (Chapter 3: Classification of Elements and Periodicity)',
   'समूह 1 में नीचे जाने पर आयनन एन्थैल्पी घटती है क्योंकि सबसे बाहर का इलेक्ट्रॉन नाभिक से दूर और अधिक परिरक्षित होता है। इसलिए Li (आवर्त 2) की प्रथम आयनन एन्थैल्पी सबसे अधिक है। (अध्याय 3)',
   'Down Group 1, ionisation enthalpy decreases.',
   2, 'understand',
   'Q14', 3),

  ('chemistry','11',
   'According to VSEPR theory, the shape of the CH4 molecule is',
   'VSEPR सिद्धांत के अनुसार CH4 अणु का आकार है',
   '["linear","trigonal planar","tetrahedral","octahedral"]',
   2,
   'CH4 has 4 bond pairs and no lone pairs around the central carbon. By VSEPR, the four electron pairs arrange themselves tetrahedrally with bond angles of about 109.5 degrees. (Chapter 4: Chemical Bonding and Molecular Structure)',
   'CH4 में केंद्रीय कार्बन पर 4 बंध युग्म और कोई एकाकी युग्म नहीं है। VSEPR के अनुसार चार इलेक्ट्रॉन युग्म चतुष्फलकीय रूप में लगभग 109.5 अंश के बंध कोण के साथ व्यवस्थित होते हैं। (अध्याय 4)',
   '4 bond pairs + 0 lone pairs gives this shape.',
   1, 'remember',
   'Q15', 4),

  ('chemistry','11',
   'Which of the following bonds is the strongest?',
   'निम्न में से कौन सा बंध सबसे प्रबल है?',
   '["a single covalent C-C bond","a double covalent C=C bond","a triple covalent C ≡ C bond","a hydrogen bond"]',
   2,
   'Bond strength generally increases with bond order. A triple bond (3 shared pairs) is stronger than a double or single bond between the same atoms. A hydrogen bond is a weak intermolecular interaction, much weaker than any covalent bond. (Chapter 4: Chemical Bonding and Molecular Structure)',
   'समान परमाणुओं के बीच बंध की प्रबलता बंध-कोटि बढ़ने पर बढ़ती है। त्रिबंध (3 साझा युग्म) एकल या द्विबंध से प्रबल होता है। हाइड्रोजन बंध एक कमजोर अंतर-आण्विक अंतःक्रिया है, किसी भी सहसंयोजी बंध से बहुत कमजोर। (अध्याय 4)',
   'Higher bond order = stronger bond between the same atoms.',
   2, 'understand',
   'Q16', 4),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 11 Biology (7 questions)
  -- Chapters: Cell – The Unit of Life (8), Biomolecules (9), Photosynthesis
  --           in Higher Plants (13), Digestion and Absorption (16)
  -- ─────────────────────────────────────────────────────────────────
  ('biology','11',
   'The powerhouse of the cell is the',
   'कोशिका का ऊर्जा-गृह (powerhouse) है',
   '["nucleus","mitochondrion","ribosome","Golgi apparatus"]',
   1,
   'Mitochondria are called the powerhouse of the cell because they generate most of the cell''s ATP through oxidative phosphorylation. (Chapter 8: Cell – The Unit of Life)',
   'माइटोकॉन्ड्रिया को कोशिका का ऊर्जा-गृह कहा जाता है क्योंकि ऑक्सीकारक फॉस्फोरिलेशन द्वारा कोशिका का अधिकांश ATP यहीं बनता है। (अध्याय 8)',
   'ATP is generated here.',
   1, 'remember',
   'Q17', 8),

  ('biology','11',
   'Which of the following is NOT a property of prokaryotic cells?',
   'निम्न में से कौन सा गुण प्रोकैरियोटिक कोशिकाओं का नहीं है?',
   '["absence of a membrane-bound nucleus","absence of membrane-bound organelles","presence of a true nucleus enclosed by a nuclear envelope","presence of 70S ribosomes"]',
   2,
   'Prokaryotic cells (bacteria, archaea) lack a membrane-bound nucleus and have nucleoid DNA instead. They also lack membrane-bound organelles and have 70S ribosomes. A true membrane-enclosed nucleus is a defining feature of eukaryotes. (Chapter 8: Cell – The Unit of Life)',
   'प्रोकैरियोटिक कोशिकाओं (बैक्टीरिया, आर्किया) में झिल्लीयुक्त केन्द्रक नहीं होता; उनके स्थान पर न्यूक्लियॉइड DNA होता है। इनमें झिल्लीयुक्त कोशिकांग नहीं होते और 70S राइबोसोम होते हैं। झिल्ली से घिरा सच्चा केन्द्रक यूकैरियोट्स का लक्षण है। (अध्याय 8)',
   'A real nuclear envelope is a eukaryotic feature.',
   2, 'understand',
   'Q18', 8),

  ('biology','11',
   'The monomer unit of a protein is',
   'प्रोटीन की एकक (monomer) इकाई है',
   '["a nucleotide","a fatty acid","an amino acid","a monosaccharide"]',
   2,
   'Proteins are polymers of amino acids joined by peptide bonds. Nucleotides build nucleic acids, fatty acids build lipids, and monosaccharides build carbohydrates. (Chapter 9: Biomolecules)',
   'प्रोटीन पेप्टाइड बंधों से जुड़े अमीनो अम्लों के बहुलक हैं। न्यूक्लियोटाइड न्यूक्लिक अम्ल, फैटी अम्ल लिपिड और मोनोसैकेराइड कार्बोहाइड्रेट बनाते हैं। (अध्याय 9)',
   'Peptide bonds join these monomers.',
   1, 'remember',
   'Q19', 9),

  ('biology','11',
   'The site of the light reactions of photosynthesis in a chloroplast is the',
   'हरित-लवक में प्रकाश-संश्लेषण की प्रकाश-अभिक्रियाओं का स्थान है',
   '["stroma","thylakoid membrane","outer membrane","intermembrane space"]',
   1,
   'Light reactions occur on the thylakoid membranes, where chlorophyll absorbs light to drive electron transport and ATP/NADPH production. The Calvin cycle (dark reactions) occurs in the stroma. (Chapter 13: Photosynthesis in Higher Plants)',
   'प्रकाश-अभिक्रियाएँ थायलैकोइड झिल्लियों पर होती हैं, जहाँ क्लोरोफिल प्रकाश को अवशोषित करके इलेक्ट्रॉन परिवहन और ATP / NADPH का निर्माण करता है। केल्विन चक्र (अंधकार-अभिक्रियाएँ) स्ट्रोमा में होता है। (अध्याय 13)',
   'Chlorophyll lives on these membranes.',
   2, 'understand',
   'Q20', 13),

  ('biology','11',
   'The end-products of photosynthesis in green plants are',
   'हरे पौधों में प्रकाश-संश्लेषण के अंत-उत्पाद हैं',
   '["carbon dioxide and water","glucose and oxygen","glucose and carbon dioxide","oxygen and water"]',
   1,
   'The net equation is 6 CO2 + 6 H2O -> C6H12O6 + 6 O2. So the products are glucose and oxygen; CO2 and H2O are reactants. (Chapter 13: Photosynthesis in Higher Plants)',
   'शुद्ध समीकरण: 6 CO2 + 6 H2O -> C6H12O6 + 6 O2। उत्पाद ग्लूकोज़ और ऑक्सीजन हैं; CO2 और H2O अभिकारक हैं। (अध्याय 13)',
   'Recall the overall photosynthesis equation.',
   1, 'remember',
   'Q21', 13),

  ('biology','11',
   'In the human alimentary canal, protein digestion begins in the',
   'मानव पाचन नली में प्रोटीन का पाचन कहाँ से प्रारंभ होता है?',
   '["mouth","stomach","small intestine","large intestine"]',
   1,
   'Salivary amylase digests carbohydrates in the mouth. Protein digestion starts in the stomach, where pepsin (active form of pepsinogen, at acidic pH from HCl) hydrolyses proteins to peptides. (Chapter 16: Digestion and Absorption)',
   'मुख में लार-एमाइलेस कार्बोहाइड्रेट का पाचन करता है। प्रोटीन का पाचन पेट में प्रारंभ होता है, जहाँ HCl के अम्लीय pH पर पेप्सिनोजेन से सक्रिय हुआ पेप्सिन प्रोटीनों को पेप्टाइडों में जल-अपघटित करता है। (अध्याय 16)',
   'Pepsin under acidic pH does this.',
   2, 'understand',
   'Q22', 16),

  ('biology','11',
   'Bile, which emulsifies fats during digestion, is secreted by the',
   'पाचन के समय वसा का पायसीकरण (emulsification) करने वाला पित्त किसके द्वारा स्रावित होता है?',
   '["pancreas","liver","gall bladder","small intestine"]',
   1,
   'Bile is produced by the liver, stored and concentrated in the gall bladder, and released into the small intestine via the bile duct. It emulsifies fats into small droplets so lipase can act efficiently. (Chapter 16: Digestion and Absorption)',
   'पित्त यकृत (liver) द्वारा बनाया जाता है, पित्ताशय (gall bladder) में संग्रहीत और सांद्र होता है, और पित्त नलिका द्वारा छोटी आँत में आता है। यह वसा का पायसीकरण करके लाइपेज की क्रिया को आसान बनाता है। (अध्याय 16)',
   'Produced by one organ, stored in another.',
   2, 'remember',
   'Q23', 16),

  -- ─────────────────────────────────────────────────────────────────
  -- Class 11 Math (7 questions)
  -- Chapters: Sets (1), Relations and Functions (2), Trigonometric
  --           Functions (3), Complex Numbers and Quadratic Equations (5),
  --           Sequences and Series (9), Straight Lines (10)
  -- ─────────────────────────────────────────────────────────────────
  ('math','11',
   'If A = {1, 2, 3} and B = {3, 4, 5}, then A intersection B is',
   'यदि A = {1, 2, 3} और B = {3, 4, 5} है, तो A सर्वनिष्ठ B (intersection) है',
   '["{1, 2}","{3}","{1, 2, 3, 4, 5}","{4, 5}"]',
   1,
   'A intersection B is the set of elements common to both A and B. Only 3 appears in both sets, so A intersection B = {3}. (Chapter 1: Sets)',
   'A सर्वनिष्ठ B में A और B दोनों में उपस्थित अवयव होते हैं। केवल 3 दोनों में है, अतः A सर्वनिष्ठ B = {3}। (अध्याय 1)',
   'Take only elements that appear in both sets.',
   1, 'apply',
   'Q24', 1),

  ('math','11',
   'If f(x) = 2x + 3, then f(4) equals',
   'यदि f(x) = 2x + 3 है, तो f(4) का मान है',
   '["7","8","11","14"]',
   2,
   'Substitute x = 4: f(4) = 2(4) + 3 = 8 + 3 = 11. (Chapter 2: Relations and Functions)',
   'x = 4 रखने पर: f(4) = 2(4) + 3 = 8 + 3 = 11। (अध्याय 2)',
   'Substitute and evaluate.',
   1, 'apply',
   'Q25', 2),

  ('math','11',
   'The value of sin^2(theta) + cos^2(theta) for any real theta is',
   'किसी भी वास्तविक theta के लिए sin^2(theta) + cos^2(theta) का मान है',
   '["0","1","theta","2"]',
   1,
   'The fundamental Pythagorean identity is sin^2(theta) + cos^2(theta) = 1 for all real theta. (Chapter 3: Trigonometric Functions)',
   'मूल पाइथागोरियन सर्वसमिका: सभी वास्तविक theta के लिए sin^2(theta) + cos^2(theta) = 1। (अध्याय 3)',
   'Recall the most fundamental trig identity.',
   1, 'remember',
   'Q26', 3),

  ('math','11',
   'The modulus of the complex number z = 3 + 4i is',
   'सम्मिश्र संख्या z = 3 + 4i का मापांक है',
   '["3","4","5","7"]',
   2,
   '|z| = sqrt(a^2 + b^2) = sqrt(3^2 + 4^2) = sqrt(9 + 16) = sqrt(25) = 5. (Chapter 5: Complex Numbers and Quadratic Equations)',
   '|z| = sqrt(a^2 + b^2) = sqrt(9 + 16) = sqrt(25) = 5। (अध्याय 5)',
   '|z| = sqrt(a^2 + b^2).',
   1, 'apply',
   'Q27', 5),

  ('math','11',
   'The sum of the first 10 positive integers (1 + 2 + 3 + ... + 10) is',
   'पहली 10 धनात्मक पूर्णांक संख्याओं का योग (1 + 2 + 3 + ... + 10) है',
   '["45","50","55","100"]',
   2,
   'Sum of the first n positive integers is n(n + 1)/2. For n = 10: 10 x 11 / 2 = 55. (Chapter 9: Sequences and Series)',
   'पहली n धनात्मक पूर्णांक संख्याओं का योग n(n + 1)/2 होता है। n = 10 के लिए: 10 x 11 / 2 = 55। (अध्याय 9)',
   'Use n(n + 1)/2.',
   1, 'apply',
   'Q28', 9),

  ('math','11',
   'The slope of the line joining the points (2, 3) and (4, 7) is',
   '(2, 3) और (4, 7) बिंदुओं को मिलाने वाली रेखा का ढाल है',
   '["1","2","3","4"]',
   1,
   'Slope m = (y2 - y1) / (x2 - x1) = (7 - 3) / (4 - 2) = 4 / 2 = 2. (Chapter 10: Straight Lines)',
   'ढाल m = (y2 - y1) / (x2 - x1) = (7 - 3) / (4 - 2) = 4 / 2 = 2। (अध्याय 10)',
   'Use m = (y2 - y1)/(x2 - x1).',
   2, 'apply',
   'Q29', 10),

  ('math','11',
   'The equation of a straight line with slope 2 passing through the origin is',
   'मूल बिंदु से गुजरने वाली, ढाल 2 की सीधी रेखा का समीकरण है',
   '["y = 2","y = 2x","y = x + 2","y = x - 2"]',
   1,
   'A line through the origin with slope m has the equation y = mx. With m = 2, the equation is y = 2x. (Chapter 10: Straight Lines)',
   'मूल बिंदु से गुजरने वाली, ढाल m की रेखा का समीकरण y = mx होता है। m = 2 के लिए: y = 2x। (अध्याय 10)',
   'Through the origin: y = mx.',
   1, 'apply',
   'Q30', 10)

) AS v(subject, grade, question_text, question_hi, options,
       correct_answer_index, explanation, explanation_hi, hint,
       difficulty, bloom_level,
       question_number, chapter_number)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Verification block
-- ───────────────────────────────────────────────────────────────────────
-- RAISE NOTICE on success; RAISE WARNING if counts or P5/P6/P7 sanity
-- counts diverge from the expected 3 papers + 90 questions (30/30/30 per
-- paper). On re-run the inserts are skipped (ON CONFLICT) so the counts
-- are checked from a stable post-state — the verifier remains idempotent.
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_papers_present     integer;
  v_paper9_id          uuid;
  v_paper10_id         uuid;
  v_paper11_id         uuid;
  v_q9_total           integer;
  v_q10_total          integer;
  v_q11_total          integer;
  v_q_grade_ok         integer;
  v_q_total_all        integer;
  v_q_correct_idx_ok   integer;
  v_q_bloom_ok         integer;
  v_q_diff_ok          integer;
  v_q_hindi_present    integer;
  v_q_exp_hindi_present integer;
  v_q_options_ok       integer;
  v_q_explanation_ok   integer;
  v_q9_science_phy     integer;
  v_q9_science_chem    integer;
  v_q9_science_bio     integer;
  v_q9_math            integer;
  v_q10_science_phy    integer;
  v_q10_science_chem   integer;
  v_q10_science_bio    integer;
  v_q10_math           integer;
  v_q11_physics        integer;
  v_q11_chemistry      integer;
  v_q11_biology        integer;
  v_q11_math           integer;
  v_all_ok             boolean;
BEGIN
  -- 1. Paper presence (3 papers expected)
  SELECT count(*) INTO v_papers_present
    FROM public.exam_papers
   WHERE paper_code IN (
     'sample_cbse_class9_general_v1',
     'sample_cbse_class10_general_v1',
     'sample_cbse_class11_general_v1'
   );

  SELECT id INTO v_paper9_id  FROM public.exam_papers WHERE paper_code = 'sample_cbse_class9_general_v1';
  SELECT id INTO v_paper10_id FROM public.exam_papers WHERE paper_code = 'sample_cbse_class10_general_v1';
  SELECT id INTO v_paper11_id FROM public.exam_papers WHERE paper_code = 'sample_cbse_class11_general_v1';

  -- 2. Per-paper question counts (30 each expected)
  SELECT count(*) INTO v_q9_total
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper9_id;

  SELECT count(*) INTO v_q10_total
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper10_id;

  SELECT count(*) INTO v_q11_total
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper11_id;

  -- 3. Per-paper subject breakdown (Class 9/10 use 'science' + 'math';
  --    Class 11 uses separate physics/chemistry/biology/math). The
  --    'flavour' is recorded only in question_text + chapter_number for
  --    Class 9/10, so we can only verify the science vs math split there.
  SELECT count(*) INTO v_q9_science_phy
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper9_id
     AND subject = 'science' AND question_number IN ('Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8');
  SELECT count(*) INTO v_q9_science_chem
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper9_id
     AND subject = 'science' AND question_number IN ('Q9','Q10','Q11','Q12','Q13','Q14','Q15','Q16');
  SELECT count(*) INTO v_q9_science_bio
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper9_id
     AND subject = 'science' AND question_number IN ('Q17','Q18','Q19','Q20','Q21','Q22','Q23');
  SELECT count(*) INTO v_q9_math
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper9_id
     AND subject = 'math';

  SELECT count(*) INTO v_q10_science_phy
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper10_id
     AND subject = 'science' AND question_number IN ('Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8');
  SELECT count(*) INTO v_q10_science_chem
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper10_id
     AND subject = 'science' AND question_number IN ('Q9','Q10','Q11','Q12','Q13','Q14','Q15','Q16');
  SELECT count(*) INTO v_q10_science_bio
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper10_id
     AND subject = 'science' AND question_number IN ('Q17','Q18','Q19','Q20','Q21','Q22','Q23');
  SELECT count(*) INTO v_q10_math
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper10_id
     AND subject = 'math';

  SELECT count(*) INTO v_q11_physics
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper11_id AND subject = 'physics';
  SELECT count(*) INTO v_q11_chemistry
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper11_id AND subject = 'chemistry';
  SELECT count(*) INTO v_q11_biology
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper11_id AND subject = 'biology';
  SELECT count(*) INTO v_q11_math
    FROM public.question_bank
   WHERE source = 'curated_seed' AND exam_paper_id = v_paper11_id AND subject = 'math';

  -- 4. Aggregate P5/P6/P7 integrity checks across all 90 rows
  v_q_total_all := v_q9_total + v_q10_total + v_q11_total;

  SELECT count(*) INTO v_q_grade_ok
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND grade IN ('9','10','11');

  SELECT count(*) INTO v_q_correct_idx_ok
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND correct_answer_index BETWEEN 0 AND 3;

  SELECT count(*) INTO v_q_bloom_ok
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND bloom_level IN ('remember','understand','apply');

  SELECT count(*) INTO v_q_diff_ok
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND difficulty BETWEEN 1 AND 4;

  SELECT count(*) INTO v_q_hindi_present
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND question_hi IS NOT NULL
     AND char_length(question_hi) > 0;

  SELECT count(*) INTO v_q_exp_hindi_present
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND explanation_hi IS NOT NULL
     AND char_length(explanation_hi) > 0;

  SELECT count(*) INTO v_q_options_ok
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND jsonb_array_length(options) = 4;

  SELECT count(*) INTO v_q_explanation_ok
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND exam_paper_id IN (v_paper9_id, v_paper10_id, v_paper11_id)
     AND explanation IS NOT NULL
     AND char_length(explanation) > 0;

  -- 5. Report
  RAISE NOTICE 'CBSE 9/10/11 seed: exam_papers present: % (expected 3)', v_papers_present;
  RAISE NOTICE 'CBSE 9/10/11 seed: total questions class9=%, class10=%, class11=% (expected 30/30/30)',
               v_q9_total, v_q10_total, v_q11_total;
  RAISE NOTICE 'CBSE 9 split: science-phy=%, science-chem=%, science-bio=%, math=% (expected 8/8/7/7)',
               v_q9_science_phy, v_q9_science_chem, v_q9_science_bio, v_q9_math;
  RAISE NOTICE 'CBSE 10 split: science-phy=%, science-chem=%, science-bio=%, math=% (expected 8/8/7/7)',
               v_q10_science_phy, v_q10_science_chem, v_q10_science_bio, v_q10_math;
  RAISE NOTICE 'CBSE 11 split: physics=%, chemistry=%, biology=%, math=% (expected 8/8/7/7)',
               v_q11_physics, v_q11_chemistry, v_q11_biology, v_q11_math;
  RAISE NOTICE 'CBSE 9/10/11 seed: P5 grade in {9,10,11} rows: % / %', v_q_grade_ok, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P6 correct_answer_index 0..3: % / %', v_q_correct_idx_ok, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P6 bloom in (remember,understand,apply): % / %', v_q_bloom_ok, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P6 difficulty 1..4: % / %', v_q_diff_ok, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P6 options jsonb length 4: % / %', v_q_options_ok, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P6 non-empty explanation: % / %', v_q_explanation_ok, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P7 question_hi present: % / %', v_q_hindi_present, v_q_total_all;
  RAISE NOTICE 'CBSE 9/10/11 seed: P7 explanation_hi present: % / %', v_q_exp_hindi_present, v_q_total_all;

  v_all_ok := v_papers_present = 3
          AND v_q9_total  >= 30
          AND v_q10_total >= 30
          AND v_q11_total >= 30
          AND v_q9_science_phy   >= 8 AND v_q9_science_chem   >= 8
          AND v_q9_science_bio   >= 7 AND v_q9_math           >= 7
          AND v_q10_science_phy  >= 8 AND v_q10_science_chem  >= 8
          AND v_q10_science_bio  >= 7 AND v_q10_math          >= 7
          AND v_q11_physics      >= 8 AND v_q11_chemistry     >= 8
          AND v_q11_biology      >= 7 AND v_q11_math          >= 7
          AND v_q_grade_ok       = v_q_total_all
          AND v_q_correct_idx_ok = v_q_total_all
          AND v_q_bloom_ok       = v_q_total_all
          AND v_q_diff_ok        = v_q_total_all
          AND v_q_options_ok     = v_q_total_all
          AND v_q_explanation_ok = v_q_total_all
          AND v_q_hindi_present  = v_q_total_all
          AND v_q_exp_hindi_present = v_q_total_all;

  IF NOT v_all_ok THEN
    RAISE WARNING 'CBSE 9/10/11 seed: counts/integrity DIVERGED from expectations — see flags above';
  ELSE
    RAISE NOTICE 'CBSE grades 9-11 seed COMPLETE — 90 questions across 3 papers';
  END IF;
END $verify$;

COMMIT;
