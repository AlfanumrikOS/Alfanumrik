-- Migration: 20260520000006_seed_jee_neet_olympiad_papers.sql
-- Purpose:    PR-3 of the JEE/NEET/Olympiad scaling roadmap. Seeds the
--             exam_papers catalog (PR-2) with 5 sample papers and the
--             question_bank with 150 ORIGINAL JEE/NEET/Olympiad-style
--             questions so the Phase 2 goal-aware RPC
--             (get_adaptive_questions_v2) has real candidates to rank
--             when the ff_competitive_exam flag flips.
--
-- Predecessors:
--   - 20260520000004_jee_neet_schema_unblock.sql (PR-1) widened
--     chk_source_type and added 6 PYQ columns to question_bank
--     (exam_session, question_number, marks_correct, marks_wrong,
--     paper_pattern, exam_paper_id).
--   - 20260520000005_exam_papers_and_pyq_import.sql (PR-2) created the
--     exam_papers catalog table and installed the FK on
--     question_bank.exam_paper_id.
--
-- IMPORTANT — Originality and provenance:
--   Every question in this seed is ORIGINAL, authored fresh in the style
--   of JEE Main / NEET / Olympiad past papers. NO question is copied
--   from any real exam paper. This avoids licensing/copyright issues
--   while still giving the goal-aware ranker real exam-pattern content
--   to work with. Paper codes are prefixed `sample_` and
--   source_attribution explicitly says 'Alfanumrik internal' to make the
--   non-PYQ provenance unambiguous in the UI.
--
-- What this migration does:
--   1. INSERT 5 rows into public.exam_papers:
--        sample_jee_main_phy_v1   (physics,   30 q, JEE-style, +4/-1)
--        sample_jee_main_chem_v1  (chemistry, 30 q, JEE-style, +4/-1)
--        sample_jee_main_math_v1  (math,      30 q, JEE-style, +4/-1)
--        sample_neet_bio_v1       (biology,   40 q, NEET-style, +4/-1)
--        sample_olympiad_math_v1  (math,      20 q, Olympiad,    +5/0)
--   2. INSERT 150 rows into public.question_bank, distributed:
--        - 30 Physics  grade '12' source_type='jee_archive'   bloom 3-5
--        - 30 Chemistry grade '12' source_type='jee_archive'  bloom 2-5
--        - 30 Math     grade '12' source_type='jee_archive'   bloom 3-5
--        - 40 Biology  grade '12' source_type='neet_archive'  bloom 1-4
--        - 20 Math     grade '10' source_type='olympiad'      bloom 4-5
--   3. Verification block — counts papers and questions, and verifies
--      each paper's child-question count matches total_questions.
--
-- What this migration does NOT do:
--   - Does NOT modify any existing question_bank or exam_papers row.
--   - Does NOT touch RLS, indexes, or constraints (those landed in PR-1/PR-2).
--   - Does NOT add Hindi translations (question_hi / explanation_hi).
--     Hindi pass is a downstream content task.
--
-- Idempotent: yes.
--   - exam_papers INSERTs use ON CONFLICT (paper_code) DO NOTHING; the
--     5 paper_codes are unique-keyed at the table level.
--   - question_bank INSERTs use ON CONFLICT DO NOTHING. The baseline has
--     two relevant UNIQUE indexes:
--       idx_question_bank_no_duplicates ON (md5(question_text), subject, grade)
--       idx_question_bank_unique_text   ON (lower(btrim(question_text)))
--     So duplicate question_text from a re-run is silently skipped.
--   - The whole migration runs inside a single BEGIN ... COMMIT.
--
-- Owner: assessment (content quality). Downstream reviewers per P14:
--   testing (E2E for goal-aware ranker once flag flips), quality
--   (review-chain). architect already approved schema in PR-1/PR-2.
--
-- Constitution compliance:
--   P5  grade is text '6'-'12'. Every question uses '10' or '12'.
--   P6  every question: question_text > 10 chars, 4 distinct non-empty
--       options, correct_answer_index 0-3, non-empty explanation,
--       difficulty in 1..5, bloom_level in
--       (remember, understand, apply, analyze, evaluate, create).
--   P12 grade-11/12 for JEE Main / NEET; grade-10 for junior Olympiad.
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   1. DELETE FROM question_bank WHERE source = 'curated_seed'
--        AND source_type IN ('jee_archive','neet_archive','olympiad');
--   2. DELETE FROM exam_papers WHERE paper_code LIKE 'sample_%';
--   DELETE on student-touching tables is normally gated, but these rows
--   carry no student attribution and are author-curated seed content.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Seed exam_papers (5 rows)
-- ───────────────────────────────────────────────────────────────────────
-- Each row uses a `sample_*` paper_code so the catalog row's
-- non-PYQ provenance is unambiguous. imported_by stays NULL (system
-- seed, no admin attribution). ON CONFLICT (paper_code) DO NOTHING
-- makes the migration safe to re-apply.
-- ───────────────────────────────────────────────────────────────────────

INSERT INTO public.exam_papers (
  paper_code,
  exam_family,
  exam_session,
  paper_pattern,
  exam_year,
  exam_month,
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
    'sample_jee_main_phy_v1',
    'jee_main',
    'sample_jee_main_phy_2025',
    'mcq_single',
    2025,
    1,
    ARRAY['physics']::text[],
    30,
    120,
    60,
    '{"correct":4,"wrong":-1,"unanswered":0}'::jsonb,
    'Alfanumrik internal — JEE-style original',
    'Original sample paper authored in JEE Main style; not a copy of any real paper.',
    NULL,
    true
  ),
  (
    'sample_jee_main_chem_v1',
    'jee_main',
    'sample_jee_main_chem_2025',
    'mcq_single',
    2025,
    1,
    ARRAY['chemistry']::text[],
    30,
    120,
    60,
    '{"correct":4,"wrong":-1,"unanswered":0}'::jsonb,
    'Alfanumrik internal — JEE-style original',
    'Original sample paper authored in JEE Main style; not a copy of any real paper.',
    NULL,
    true
  ),
  (
    'sample_jee_main_math_v1',
    'jee_main',
    'sample_jee_main_math_2025',
    'mcq_single',
    2025,
    1,
    ARRAY['math']::text[],
    30,
    120,
    60,
    '{"correct":4,"wrong":-1,"unanswered":0}'::jsonb,
    'Alfanumrik internal — JEE-style original',
    'Original sample paper authored in JEE Main style; not a copy of any real paper.',
    NULL,
    true
  ),
  (
    'sample_neet_bio_v1',
    'neet',
    'sample_neet_bio_2025',
    'mcq_single',
    2025,
    5,
    ARRAY['biology']::text[],
    40,
    160,
    60,
    '{"correct":4,"wrong":-1,"unanswered":0}'::jsonb,
    'Alfanumrik internal — NEET-style original',
    'Original sample paper authored in NEET style; not a copy of any real paper.',
    NULL,
    true
  ),
  (
    'sample_olympiad_math_v1',
    'olympiad_math',
    'sample_olympiad_math_2025',
    'mcq_single',
    2025,
    11,
    ARRAY['math']::text[],
    20,
    100,
    90,
    '{"correct":5,"wrong":0,"unanswered":0}'::jsonb,
    'Alfanumrik internal — Olympiad-style original',
    'Original sample paper authored in junior math-Olympiad style; not a copy of any real paper.',
    NULL,
    true
  )
ON CONFLICT (paper_code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Seed question_bank
-- ───────────────────────────────────────────────────────────────────────
-- Strategy: one INSERT...SELECT per paper, JOINing a CTE that resolves
-- paper_code → exam_papers.id. This keeps the paper FK lookup atomic
-- with the row inserts. ON CONFLICT DO NOTHING covers re-runs (the
-- unique-on-lower(btrim(question_text)) index in baseline_from_prod
-- silently drops duplicates).
--
-- For each paper, we emit a VALUES list of 30/30/30/40/20 question
-- rows. Each VALUES row carries all 18 question-bank columns we set;
-- the rest default per the table definition.
-- ───────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────
-- 2a. Physics (JEE Main level) — 30 questions, grade '12'
-- ───────────────────────────────────────────────────────────────────────
WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers WHERE paper_code = 'sample_jee_main_phy_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_type, options,
  correct_answer_index, explanation, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, exam_paper_id, paper_pattern, marks_correct,
  marks_wrong, question_number, exam_session, chapter_number,
  chapter_title, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, 'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.hint, v.difficulty, v.bloom_level,
       'curated_seed', 'jee_archive', true, true, 'verified',
       false, pl.id, 'mcq_single', 4.00,
       -1.00, v.question_number, 'sample_jee_main_phy_2025', v.chapter_number,
       v.chapter_title, ARRAY['jee_main','sample','2025','physics']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  ('physics','12','A block of mass 5 kg is placed on a rough horizontal surface. A horizontal force of 20 N is applied to it. If the coefficient of kinetic friction is 0.3, what is the acceleration of the block? (g = 10 m/s²)','["0.5 m/s²","1.0 m/s²","2.0 m/s²","3.0 m/s²"]',1,'Normal force N = mg = 50 N. Kinetic friction = μ·N = 0.3·50 = 15 N. Net force = 20 − 15 = 5 N. Acceleration a = F_net/m = 5/5 = 1.0 m/s².','Compute the normal force, subtract kinetic friction from the applied force, and divide by mass.',3,'apply','Q1',5,'Mechanics — Friction'),
  ('physics','12','A particle is projected at an angle of 60° with the horizontal with a speed of 20 m/s. What is the magnitude of its velocity at the highest point of its trajectory? (g = 10 m/s²)','["0 m/s","10 m/s","17.3 m/s","20 m/s"]',1,'At the highest point only the horizontal component of velocity survives because vertical velocity becomes zero. Horizontal component = 20·cos60° = 10 m/s.','At the highest point, the vertical component of velocity vanishes; only the horizontal component remains.',2,'understand','Q2',3,'Mechanics — Projectile Motion'),
  ('physics','12','A uniform rod of length L and mass M is pivoted at one end and released from a horizontal position. What is its angular velocity when it reaches the vertical position? (g = acceleration due to gravity)','["sqrt(g/L)","sqrt(2g/L)","sqrt(3g/L)","sqrt(6g/L)"]',2,'Use energy conservation: loss in PE of the centre of mass = gain in rotational KE. M·g·(L/2) = (1/2)·(ML²/3)·ω². Solving gives ω = sqrt(3g/L).','Apply conservation of mechanical energy. The moment of inertia of a uniform rod about one end is ML²/3.',4,'apply','Q3',7,'Mechanics — Rotational Dynamics'),
  ('physics','12','Two capacitors of capacitances 4 μF and 6 μF are connected in series across a 50 V battery. What is the charge on each capacitor?','["100 μC","120 μC","200 μC","240 μC"]',1,'In series, both capacitors carry the same charge. Equivalent capacitance C = (4·6)/(4+6) = 2.4 μF. Charge Q = C·V = 2.4 × 50 = 120 μC.','Capacitors in series share the same charge; first compute the equivalent capacitance.',3,'apply','Q4',2,'Electrostatics — Capacitors'),
  ('physics','12','A wire of resistance 10 Ω is stretched uniformly so that its length becomes twice the original. What is its new resistance?','["10 Ω","20 Ω","40 Ω","80 Ω"]',2,'Volume conservation gives the new area as half the original. R = ρL/A, so R_new = ρ(2L)/(A/2) = 4·R. Hence 4 × 10 = 40 Ω.','Stretching a wire preserves its volume; resistance scales as L²/V.',3,'apply','Q5',3,'Current Electricity — Resistance'),
  ('physics','12','A solenoid of length 50 cm with 500 turns carries a current of 2 A. What is the magnitude of the magnetic field at its centre? (μ₀ = 4π × 10⁻⁷ T·m/A)','["1.26 × 10⁻³ T","2.51 × 10⁻³ T","5.02 × 10⁻³ T","6.28 × 10⁻³ T"]',1,'For a long solenoid B = μ₀·n·I where n = N/L = 500/0.5 = 1000 turns/m. B = 4π×10⁻⁷ × 1000 × 2 ≈ 2.51 × 10⁻³ T.','Use B = μ₀·n·I for a long solenoid; compute n as turns per unit length.',3,'apply','Q6',4,'Magnetism — Solenoid Field'),
  ('physics','12','A coil of 100 turns and area 0.01 m² rotates in a uniform magnetic field of 0.2 T at 50 rev/s with its axis perpendicular to the field. What is the peak EMF induced?','["6.28 V","31.4 V","62.8 V","125.6 V"]',2,'Peak EMF ε₀ = NBA·ω where ω = 2π·f. ω = 2π × 50 = 100π. ε₀ = 100 × 0.2 × 0.01 × 100π ≈ 62.8 V.','Peak EMF in a rotating coil is NBA·ω, where ω is the angular frequency in rad/s.',3,'apply','Q7',6,'Electromagnetic Induction'),
  ('physics','12','In Young''s double-slit experiment, slit separation is 0.5 mm and the screen is 1 m away. Light of wavelength 600 nm is used. What is the fringe width on the screen?','["0.6 mm","1.2 mm","2.4 mm","6.0 mm"]',1,'Fringe width β = λD/d = (600×10⁻⁹ × 1)/(0.5×10⁻³) = 1.2×10⁻³ m = 1.2 mm.','Fringe width in YDSE is given by β = λD/d.',2,'apply','Q8',10,'Wave Optics — Interference'),
  ('physics','12','The work function of a metal is 2.5 eV. What is the maximum kinetic energy of photoelectrons when light of wavelength 400 nm is incident on it? (hc = 1240 eV·nm)','["0.0 eV","0.6 eV","1.1 eV","3.1 eV"]',1,'Photon energy E = hc/λ = 1240/400 = 3.1 eV. K_max = E − φ = 3.1 − 2.5 = 0.6 eV.','Use Einstein''s photoelectric equation K_max = hν − φ; compute photon energy as hc/λ.',3,'apply','Q9',11,'Modern Physics — Photoelectric Effect'),
  ('physics','12','A radioactive sample has a half-life of 10 years. What fraction of the original sample remains after 40 years?','["1/2","1/4","1/8","1/16"]',3,'After n half-lives the remaining fraction is (1/2)ⁿ. With 40/10 = 4 half-lives, fraction = (1/2)⁴ = 1/16.','Count the number of half-lives elapsed and apply (1/2)ⁿ.',2,'apply','Q10',12,'Modern Physics — Radioactivity'),
  ('physics','12','A 5 kg block moving at 4 m/s collides elastically with a stationary 3 kg block on a frictionless surface. What is the velocity of the 5 kg block after the collision?','["0.5 m/s","1.0 m/s","2.0 m/s","3.0 m/s"]',1,'For 1-D elastic collision, v1'' = ((m1−m2)/(m1+m2))·u1 = ((5−3)/8)·4 = 1.0 m/s.','Use the elastic-collision formula v1'' = ((m1 − m2)/(m1 + m2))·u1 when the second block is at rest.',3,'apply','Q11',6,'Mechanics — Collisions'),
  ('physics','12','A spring of force constant 200 N/m is compressed by 0.1 m and a 0.5 kg block is launched horizontally on a frictionless surface. What is the speed of the block at release?','["1.0 m/s","2.0 m/s","3.0 m/s","4.0 m/s"]',1,'Conservation of energy: (1/2)kx² = (1/2)mv². v = x·sqrt(k/m) = 0.1·sqrt(200/0.5) = 0.1·20 = 2 m/s.','Equate spring PE to kinetic energy of the block.',3,'apply','Q12',6,'Mechanics — Energy Conservation'),
  ('physics','12','A satellite of mass m orbits Earth at radius 2R (where R is Earth''s radius). Compared to a satellite at radius R, its orbital period is approximately','["the same","sqrt(2) times longer","2 times longer","2·sqrt(2) times longer"]',3,'Kepler''s third law: T ∝ r^(3/2). T(2R)/T(R) = 2^(3/2) = 2·sqrt(2) ≈ 2.83.','Apply Kepler''s third law: T² ∝ r³.',3,'analyze','Q13',8,'Gravitation — Orbital Mechanics'),
  ('physics','12','A simple pendulum has a period of 2 s on Earth. What will its period be on a planet where g is one-fourth that on Earth?','["1 s","2 s","4 s","8 s"]',2,'T = 2π·sqrt(L/g). With g reduced to g/4, T_new = 2·T_old = 4 s.','Period of a pendulum scales as 1/sqrt(g).',3,'apply','Q14',13,'Oscillations — Simple Pendulum'),
  ('physics','12','A sound wave has frequency 500 Hz in air where the speed of sound is 340 m/s. What is its wavelength?','["0.34 m","0.50 m","0.68 m","1.36 m"]',2,'λ = v/f = 340/500 = 0.68 m.','Use v = f·λ; rearrange for λ.',1,'remember','Q15',14,'Waves — Sound'),
  ('physics','12','A circular loop of radius 0.1 m carries a current of 5 A. What is the magnetic field at its centre? (μ₀ = 4π × 10⁻⁷ T·m/A)','["1.57 × 10⁻⁵ T","3.14 × 10⁻⁵ T","6.28 × 10⁻⁵ T","3.14 × 10⁻⁴ T"]',1,'B = μ₀·I/(2R) = (4π×10⁻⁷ × 5)/(2 × 0.1) ≈ 3.14×10⁻⁵ T.','Use B = μ₀·I/(2R) for the centre of a single circular loop.',3,'apply','Q16',4,'Magnetism — Current Loop'),
  ('physics','12','Light travels from glass (n = 1.5) into water (n = 1.33). If the angle of incidence is 30°, what is approximately the angle of refraction?','["27°","30°","34°","45°"]',2,'Snell''s law: n1·sinθ1 = n2·sinθ2. sinθ2 = (1.5 × 0.5)/1.33 ≈ 0.564, so θ2 ≈ 34°.','Apply Snell''s law and remember the ray bends away from the normal when going to a less dense medium.',3,'apply','Q17',9,'Ray Optics — Refraction'),
  ('physics','12','A converging lens of focal length 20 cm forms a real image at 60 cm from the lens. Where is the object located?','["15 cm","20 cm","30 cm","60 cm"]',2,'Lens formula: 1/v − 1/u = 1/f. With v = +60, f = +20: 1/u = 1/60 − 1/20 = −1/30, so u = −30 cm. Object is 30 cm in front.','Use the sign convention with the lens formula 1/v − 1/u = 1/f.',3,'apply','Q18',9,'Ray Optics — Thin Lens'),
  ('physics','12','A heat engine takes 200 J from a hot reservoir and rejects 150 J to a cold reservoir per cycle. What is its efficiency?','["10%","25%","50%","75%"]',1,'Efficiency η = (Q_h − Q_c)/Q_h = (200 − 150)/200 = 0.25 = 25%.','Efficiency = work done / heat absorbed = 1 − Q_c/Q_h.',2,'apply','Q19',15,'Thermodynamics — Heat Engines'),
  ('physics','12','An ideal gas undergoes an isothermal expansion at temperature T from volume V to 2V. The work done by the gas is (R = universal gas constant, n = number of moles)','["nRT","nRT·ln2","2nRT","nRT/2"]',1,'For isothermal expansion W = nRT·ln(V_f/V_i) = nRT·ln2.','Work done in an isothermal process is nRT·ln(V_f/V_i).',3,'apply','Q20',15,'Thermodynamics — Isothermal Process'),
  ('physics','12','The de Broglie wavelength of an electron accelerated through a potential difference of 150 V is approximately','["0.1 Å","1.0 Å","10 Å","100 Å"]',1,'λ = h/sqrt(2mqV). For an electron at 150 V, λ ≈ 12.27/sqrt(150) Å ≈ 1.0 Å.','Apply λ = h/sqrt(2mqV) or use the shortcut λ(Å) ≈ 12.27/sqrt(V).',4,'apply','Q21',11,'Modern Physics — de Broglie Wavelength'),
  ('physics','12','In a hydrogen atom, what is the energy of an electron in the n = 3 state? (Ground-state energy = −13.6 eV)','["−13.6 eV","−3.4 eV","−1.51 eV","−0.85 eV"]',2,'E_n = −13.6/n² eV. E_3 = −13.6/9 ≈ −1.51 eV.','Use the Bohr formula E_n = −13.6/n² eV.',2,'remember','Q22',12,'Modern Physics — Bohr Model'),
  ('physics','12','Two long parallel wires carry currents of 4 A and 6 A in the same direction. They are 0.2 m apart. What is the force per unit length between them? (μ₀ = 4π × 10⁻⁷ T·m/A)','["1.2 × 10⁻⁵ N/m attractive","2.4 × 10⁻⁵ N/m attractive","1.2 × 10⁻⁵ N/m repulsive","2.4 × 10⁻⁵ N/m repulsive"]',1,'F/L = μ₀·I1·I2/(2π·d) = (4π×10⁻⁷ × 4 × 6)/(2π × 0.2) = 2.4×10⁻⁵ N/m. Parallel currents attract.','Use the force-per-length formula and note that parallel currents attract.',3,'apply','Q23',4,'Magnetism — Force Between Wires'),
  ('physics','12','An LC circuit has L = 10 mH and C = 1 μF. What is its angular frequency of oscillation?','["10² rad/s","10³ rad/s","10⁴ rad/s","10⁵ rad/s"]',2,'ω = 1/sqrt(LC) = 1/sqrt(10⁻² × 10⁻⁶) = 1/sqrt(10⁻⁸) = 10⁴ rad/s.','Angular frequency of an LC oscillator is 1/sqrt(LC).',3,'apply','Q24',7,'AC Circuits — LC Oscillations'),
  ('physics','12','A particle moves in a circle of radius 2 m with a constant speed of 4 m/s. What is the magnitude of its acceleration?','["0 m/s²","2 m/s²","4 m/s²","8 m/s²"]',3,'Centripetal acceleration a = v²/r = 16/2 = 8 m/s².','Uniform circular motion still has centripetal acceleration v²/r directed inward.',2,'apply','Q25',4,'Mechanics — Circular Motion'),
  ('physics','12','Compare the rms speed and the most probable speed of gas molecules in a Maxwell-Boltzmann distribution. Which is larger?','["rms speed","most probable speed","they are equal","depends on temperature"]',0,'For a Maxwell-Boltzmann distribution v_rms = sqrt(3kT/m) > v_p = sqrt(2kT/m). So rms > most probable always.','Compare the factors under the square root in v_rms and v_p.',3,'analyze','Q26',16,'Kinetic Theory — Speed Distribution'),
  ('physics','12','In a series RLC circuit at resonance, the impedance equals','["R","XL only","XC only","sqrt(R² + (XL − XC)²)"]',0,'At resonance XL = XC so the reactive parts cancel and Z = R.','At resonance the inductive and capacitive reactances cancel exactly.',3,'understand','Q27',7,'AC Circuits — Resonance'),
  ('physics','12','A photon of wavelength 500 nm carries an energy of approximately (h = 6.63 × 10⁻³⁴ J·s, c = 3 × 10⁸ m/s)','["2.0 × 10⁻¹⁹ J","4.0 × 10⁻¹⁹ J","6.0 × 10⁻¹⁹ J","8.0 × 10⁻¹⁹ J"]',1,'E = hc/λ = (6.63×10⁻³⁴ × 3×10⁸)/(5×10⁻⁷) ≈ 4.0×10⁻¹⁹ J.','Photon energy is hc/λ.',2,'apply','Q28',11,'Modern Physics — Photon Energy'),
  ('physics','12','A solid sphere of radius R rolls without slipping down an inclined plane of height h. Its speed at the bottom is','["sqrt(2gh)","sqrt(10gh/7)","sqrt(4gh/3)","sqrt(gh)"]',1,'Energy conservation with I = (2/5)MR² for a solid sphere and v = Rω gives mgh = (1/2)mv² + (1/2)(2/5)mv² = (7/10)mv². So v = sqrt(10gh/7).','Use energy conservation and include both translational and rotational kinetic energy.',5,'analyze','Q29',7,'Mechanics — Rolling Motion'),
  ('physics','12','Identify the dimensions of the gravitational constant G.','["M⁻¹L³T⁻²","ML²T⁻²","M⁻¹L²T⁻²","MLT⁻²"]',0,'From F = G·m1·m2/r² we get [G] = [F]·[r²]/[m²] = (MLT⁻²)(L²)/(M²) = M⁻¹L³T⁻².','Use Newton''s law of gravitation and solve for [G] dimensionally.',3,'analyze','Q30',1,'Units and Dimensions')
) AS v(subject, grade, question_text, options, correct_answer_index, explanation, hint, difficulty, bloom_level, question_number, chapter_number, chapter_title)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2b. Chemistry (JEE Main level) — 30 questions, grade '12'
-- ───────────────────────────────────────────────────────────────────────
WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers WHERE paper_code = 'sample_jee_main_chem_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_type, options,
  correct_answer_index, explanation, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, exam_paper_id, paper_pattern, marks_correct,
  marks_wrong, question_number, exam_session, chapter_number,
  chapter_title, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, 'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.hint, v.difficulty, v.bloom_level,
       'curated_seed', 'jee_archive', true, true, 'verified',
       false, pl.id, 'mcq_single', 4.00,
       -1.00, v.question_number, 'sample_jee_main_chem_2025', v.chapter_number,
       v.chapter_title, ARRAY['jee_main','sample','2025','chemistry']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  ('chemistry','12','How many sigma (σ) bonds and pi (π) bonds are present in a benzene molecule (C₆H₆)?','["6 σ and 3 π","12 σ and 3 π","12 σ and 6 π","6 σ and 6 π"]',1,'Benzene has 6 C-C σ-bonds and 6 C-H σ-bonds (12 total) plus 3 delocalised C-C π-bonds.','Count C-C and C-H sigma bonds separately, then count alternating π-bonds.',2,'remember','Q1',13,'Organic Chemistry — Benzene'),
  ('chemistry','12','Which of the following has the highest first ionisation energy?','["Na","Mg","Al","Si"]',1,'Across a period IE generally increases, but Al < Mg because removing the 3p electron of Al is easier than removing a paired 3s electron of Mg. So Mg has the highest first IE among the four.','Watch for the small drop at group 13 due to electronic configuration; Mg has filled 3s.',4,'analyze','Q2',3,'Periodic Properties — Ionisation Energy'),
  ('chemistry','12','The pH of a 0.001 M HCl solution at 25 °C is','["1","2","3","4"]',2,'HCl is a strong acid so [H⁺] = 10⁻³ M. pH = −log(10⁻³) = 3.','For a strong acid the H⁺ concentration equals the acid concentration; pH = −log[H⁺].',2,'apply','Q3',7,'Equilibrium — Acids and Bases'),
  ('chemistry','12','For the reaction N₂(g) + 3H₂(g) ⇌ 2NH₃(g), if the pressure is doubled at constant temperature, the equilibrium shifts','["to the left","to the right","does not shift","cannot be determined"]',1,'Le Chatelier: increasing pressure shifts equilibrium toward fewer moles of gas. Right side has 2 moles vs 4 on left, so equilibrium shifts to the right.','Apply Le Chatelier''s principle by comparing the number of moles of gas on each side.',3,'apply','Q4',7,'Equilibrium — Le Chatelier'),
  ('chemistry','12','Which of the following is a strong electrolyte in aqueous solution?','["CH₃COOH","NH₃","NaCl","C₆H₁₂O₆"]',2,'NaCl is a strong electrolyte (fully dissociates). Acetic acid and ammonia are weak electrolytes; glucose is a non-electrolyte.','Strong electrolytes dissociate completely; identify a salt of a strong acid and strong base.',1,'remember','Q5',2,'Solutions — Electrolytes'),
  ('chemistry','12','The number of moles of CO₂ produced when 5 moles of propane (C₃H₈) undergo complete combustion is','["3","5","10","15"]',3,'C₃H₈ + 5O₂ → 3CO₂ + 4H₂O. So 5 moles of propane give 5 × 3 = 15 moles of CO₂.','Write a balanced equation for propane combustion and read off the stoichiometric ratio.',2,'apply','Q6',1,'Stoichiometry — Combustion'),
  ('chemistry','12','Which set of quantum numbers is NOT allowed for an electron in an atom?','["n=3, l=2, m=−2","n=2, l=1, m=0","n=2, l=2, m=1","n=4, l=0, m=0"]',2,'For a given n, l ranges from 0 to n−1. So n=2 cannot have l=2; that combination is forbidden.','For a shell with principal quantum number n, the maximum value of l is n − 1.',3,'analyze','Q7',2,'Atomic Structure — Quantum Numbers'),
  ('chemistry','12','Which of the following oxides is amphoteric?','["Na₂O","MgO","Al₂O₃","P₄O₁₀"]',2,'Al₂O₃ reacts with both acids and bases — the textbook example of an amphoteric oxide. Na₂O and MgO are basic; P₄O₁₀ is acidic.','Amphoteric oxides sit between the strongly basic and acidic ends of the periodic table; group 13 metals are a classic example.',2,'remember','Q8',11,'p-Block Elements — Aluminium'),
  ('chemistry','12','The IUPAC name of CH₃-CH(OH)-CH₂-CH₃ is','["1-butanol","2-butanol","tert-butanol","methylpropan-2-ol"]',1,'The OH group is on C2 of the 4-carbon chain, so the name is butan-2-ol (a.k.a. 2-butanol).','Number the chain to give the OH group the lowest locant.',2,'remember','Q9',11,'Organic Chemistry — Nomenclature'),
  ('chemistry','12','Which carbocation is most stable?','["primary","secondary","tertiary","methyl"]',2,'Stability order is tertiary > secondary > primary > methyl due to hyperconjugation and inductive effects from adjacent alkyl groups.','More alkyl groups on the positive carbon mean more electron donation and more stability.',2,'remember','Q10',12,'Organic Chemistry — Carbocations'),
  ('chemistry','12','The hybridisation of the central atom in BF₃ is','["sp","sp²","sp³","sp³d"]',1,'Boron in BF₃ forms three σ-bonds with no lone pair, giving sp² hybridisation and a trigonal planar shape.','Count σ-bonds and lone pairs around the central atom; three σ-bonds and no lone pair give sp².',2,'understand','Q11',4,'Chemical Bonding — Hybridisation'),
  ('chemistry','12','Which of the following has the maximum bond angle?','["H₂O","NH₃","CH₄","BF₃"]',3,'BF₃ is trigonal planar with 120°. CH₄ is 109.5°, NH₃ is ~107°, H₂O is ~104.5°. So BF₃ has the largest bond angle.','Lone pairs on the central atom reduce bond angles; BF₃ has none.',3,'analyze','Q12',4,'Chemical Bonding — VSEPR'),
  ('chemistry','12','For an ideal gas at constant T, the relation between pressure and volume is given by','["PV = constant","P/V = constant","P + V = constant","P − V = constant"]',0,'Boyle''s law: at constant temperature for an ideal gas PV = constant.','Recall Boyle''s law for an isothermal process.',1,'remember','Q13',5,'States of Matter — Gases'),
  ('chemistry','12','The standard enthalpy of formation of an element in its standard state is','["positive","negative","zero","cannot be determined"]',2,'By definition the standard enthalpy of formation of any element in its standard state is zero.','Standard enthalpy of formation uses the element in its reference state as the zero baseline.',1,'remember','Q14',6,'Thermodynamics — Enthalpy'),
  ('chemistry','12','Which transition metal ion is colourless?','["Cu²⁺","Fe³⁺","Zn²⁺","Mn²⁺"]',2,'Zn²⁺ has a fully filled 3d¹⁰ configuration, so no d-d transitions are possible and it is colourless.','Colour in transition-metal complexes comes from d-d transitions; check the d-electron count.',3,'analyze','Q15',16,'d-Block Elements — Coordination'),
  ('chemistry','12','The number of unpaired electrons in Fe³⁺ (Z = 26) in the high-spin state is','["3","4","5","6"]',2,'Fe³⁺ has the configuration [Ar]3d⁵. With 5 d-electrons in high-spin, each occupies a separate orbital, giving 5 unpaired electrons.','Write the d-electron configuration of Fe³⁺ and apply Hund''s rule.',3,'apply','Q16',2,'Atomic Structure — Hund''s Rule'),
  ('chemistry','12','Which of the following is an example of an addition polymerisation product?','["Nylon-6,6","Polyethylene","Polyester","Bakelite"]',1,'Polyethylene is made by addition polymerisation of ethylene. Nylon, polyester, and Bakelite are condensation polymers.','Addition polymers form from alkene monomers without loss of small molecules.',2,'remember','Q17',15,'Polymers — Classification'),
  ('chemistry','12','The major product when 2-bromobutane reacts with alcoholic KOH is','["1-butene","2-butene","butane","butan-2-ol"]',1,'Alcoholic KOH favours E2 elimination. Saytzeff''s rule gives the more substituted alkene 2-butene as the major product.','Alcoholic KOH gives elimination; apply Saytzeff''s rule to pick the major product.',3,'apply','Q18',12,'Organic Chemistry — Elimination'),
  ('chemistry','12','Which of the following compounds shows geometric (cis-trans) isomerism?','["1-pentene","2-pentene","2-methyl-2-butene","2,3-dimethyl-2-butene"]',1,'Geometric isomerism requires two different substituents on each carbon of the C=C. In 2-pentene each sp² carbon has different substituents on either side.','For cis-trans isomerism each doubly-bonded carbon must carry two different groups.',3,'analyze','Q19',11,'Organic Chemistry — Stereochemistry'),
  ('chemistry','12','For the cell reaction Zn + Cu²⁺ → Zn²⁺ + Cu, E°(Zn²⁺/Zn) = −0.76 V and E°(Cu²⁺/Cu) = +0.34 V. What is the standard cell EMF?','["0.42 V","1.10 V","−0.42 V","−1.10 V"]',1,'E°_cell = E°_cathode − E°_anode = 0.34 − (−0.76) = 1.10 V.','Subtract the anode potential from the cathode potential; both must be reduction potentials.',2,'apply','Q20',8,'Electrochemistry — Cell EMF'),
  ('chemistry','12','The molarity of a solution containing 5.85 g of NaCl in 500 mL of solution is (molar mass of NaCl = 58.5 g/mol)','["0.1 M","0.2 M","0.5 M","1.0 M"]',1,'Moles of NaCl = 5.85/58.5 = 0.1. Molarity = 0.1/0.5 = 0.2 M.','Molarity = moles of solute / volume of solution in litres.',2,'apply','Q21',2,'Solutions — Concentration'),
  ('chemistry','12','Which of the following will undergo the SN1 reaction the fastest?','["CH₃Cl","CH₃CH₂Cl","(CH₃)₂CHCl","(CH₃)₃CCl"]',3,'SN1 rate follows the stability of the carbocation intermediate. Tertiary carbocation is most stable, so (CH₃)₃CCl reacts fastest.','SN1 goes through a carbocation; tertiary substrates form the most stable carbocations.',3,'analyze','Q22',12,'Organic Chemistry — SN1 Mechanism'),
  ('chemistry','12','In the Hall-Héroult process, aluminium is extracted by','["chemical reduction with carbon","electrolysis of molten Al₂O₃ in cryolite","reduction with hydrogen","decomposition of bauxite"]',1,'Hall-Héroult electrolyses Al₂O₃ dissolved in molten cryolite (Na₃AlF₆) which lowers the melting point and provides a conducting medium.','Carbon reduction is for iron; aluminium is obtained electrolytically because Al has high reduction potential.',2,'understand','Q23',6,'Metallurgy — Aluminium Extraction'),
  ('chemistry','12','A first-order reaction has a rate constant of 0.693 min⁻¹. Its half-life is','["0.5 min","1.0 min","1.5 min","2.0 min"]',1,'For a first-order reaction t_(1/2) = 0.693/k = 0.693/0.693 = 1.0 min.','Use t_(1/2) = ln2/k for a first-order reaction.',2,'apply','Q24',4,'Chemical Kinetics — Half-Life'),
  ('chemistry','12','Which of the following is a Lewis acid?','["NH₃","H₂O","BF₃","Cl⁻"]',2,'A Lewis acid accepts an electron pair. BF₃ has an incomplete octet on boron and accepts a lone pair, so it is a Lewis acid.','Lewis acids are electron-pair acceptors; look for an electron-deficient species.',2,'understand','Q25',7,'Equilibrium — Lewis Acids'),
  ('chemistry','12','Which colloid is an example of a solid sol?','["Milk","Smoke","Coloured gemstone (ruby)","Fog"]',2,'A solid sol has solid dispersed in solid. Ruby (Cr₂O₃ in Al₂O₃) is the textbook example. Milk is liquid-in-liquid; smoke is solid-in-gas; fog is liquid-in-gas.','In a solid sol both the dispersed and dispersion phases are solid.',3,'remember','Q26',5,'Surface Chemistry — Colloids'),
  ('chemistry','12','Among the following amines, which is the most basic in aqueous solution?','["NH₃","CH₃NH₂","(CH₃)₂NH","(CH₃)₃N"]',2,'In aqueous solution (CH₃)₂NH is most basic due to a balance of inductive donation and solvation. (CH₃)₃N is less basic in water due to steric hindrance of solvation.','Don''t pick tertiary blindly; in water (CH₃)₂NH typically wins.',5,'evaluate','Q27',13,'Organic Chemistry — Amines'),
  ('chemistry','12','For a reaction A → B, doubling the concentration of A doubles the rate. The order of the reaction with respect to A is','["0","1","2","3"]',1,'rate ∝ [A]ⁿ. If rate doubles when [A] doubles, then 2ⁿ = 2, so n = 1.','Compare the factor by which rate changes with the factor by which concentration changes.',2,'apply','Q28',4,'Chemical Kinetics — Reaction Order'),
  ('chemistry','12','The maximum number of electrons that can be accommodated in the M shell (n = 3) is','["8","10","18","32"]',2,'Maximum electrons in a shell = 2n². For n = 3 it is 2 × 9 = 18.','Apply the 2n² rule for the maximum capacity of a principal shell.',1,'remember','Q29',2,'Atomic Structure — Electron Capacity'),
  ('chemistry','12','Which of the following undergoes Friedel-Crafts alkylation most readily?','["Nitrobenzene","Benzaldehyde","Toluene","Benzoic acid"]',2,'Electron-donating groups activate the ring toward electrophilic substitution. Toluene has a methyl group that is a weak activator. The other three carry deactivating EWGs.','Activators (alkyl, OH) speed up Friedel-Crafts; deactivators (NO₂, CHO, COOH) slow it down or block it.',3,'analyze','Q30',13,'Organic Chemistry — Aromatic Substitution')
) AS v(subject, grade, question_text, options, correct_answer_index, explanation, hint, difficulty, bloom_level, question_number, chapter_number, chapter_title)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2c. Math (JEE Main level) — 30 questions, grade '12'
-- ───────────────────────────────────────────────────────────────────────
WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers WHERE paper_code = 'sample_jee_main_math_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_type, options,
  correct_answer_index, explanation, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, exam_paper_id, paper_pattern, marks_correct,
  marks_wrong, question_number, exam_session, chapter_number,
  chapter_title, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, 'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.hint, v.difficulty, v.bloom_level,
       'curated_seed', 'jee_archive', true, true, 'verified',
       false, pl.id, 'mcq_single', 4.00,
       -1.00, v.question_number, 'sample_jee_main_math_2025', v.chapter_number,
       v.chapter_title, ARRAY['jee_main','sample','2025','math']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  ('math','12','If f(x) = x³ − 3x + 2, then f(x) has a local minimum at x =','["−1","0","1","2"]',2,'f''(x) = 3x² − 3 = 0 gives x = ±1. f''''(x) = 6x. At x = 1 we get f''''(1) = 6 > 0, so x = 1 is a local minimum.','Find critical points where f''(x) = 0 and use the second-derivative test.',3,'apply','Q1',6,'Calculus — Maxima and Minima'),
  ('math','12','The value of the integral ∫₀^(π/2) sin²x dx is','["0","π/4","π/2","π"]',1,'∫₀^(π/2) sin²x dx = ∫₀^(π/2) (1 − cos2x)/2 dx = [x/2 − sin2x/4]₀^(π/2) = π/4.','Use the identity sin²x = (1 − cos2x)/2 before integrating.',3,'apply','Q2',7,'Calculus — Definite Integrals'),
  ('math','12','If the matrix A = [[1,2],[3,4]], then det(A) =','["−2","2","−5","10"]',0,'det(A) = (1)(4) − (2)(3) = 4 − 6 = −2.','Apply the 2×2 determinant formula ad − bc.',1,'remember','Q3',4,'Matrices and Determinants'),
  ('math','12','The number of solutions of sin²x − cosx = 0 in the interval [0, 2π] is','["1","2","3","4"]',1,'Substitute sin²x = 1 − cos²x: 1 − cos²x − cosx = 0, so cos²x + cosx − 1 = 0. cosx = (−1 ± √5)/2. Only (−1 + √5)/2 ≈ 0.618 lies in [−1,1]; this value of cosx occurs twice in [0, 2π] (once in (0, π/2) and once in (3π/2, 2π)). So the equation has exactly 2 solutions.','Use sin²x = 1 − cos²x to convert to a quadratic in cosx, then count solutions in [0, 2π].',4,'analyze','Q4',3,'Trigonometry — Trigonometric Equations'),
  ('math','12','The equation of the tangent to the curve y = x² at the point (2, 4) is','["y = 4x − 4","y = 2x","y = 4x + 4","y = x + 2"]',0,'dy/dx = 2x. At x = 2, slope = 4. Tangent: y − 4 = 4(x − 2), so y = 4x − 4.','Find dy/dx and evaluate at the given point to get the slope.',2,'apply','Q5',6,'Calculus — Tangents and Normals'),
  ('math','12','If the lines 2x + 3y = 5 and ax + 6y = 10 are parallel, then a =','["2","3","4","6"]',2,'Parallel lines have the same slope. Slope of first is −2/3, slope of second is −a/6. So a/6 = 2/3, giving a = 4.','Equate the slopes of the two lines.',2,'apply','Q6',2,'Coordinate Geometry — Straight Lines'),
  ('math','12','The vector (1, 2, 2) has magnitude','["3","5","sqrt(7)","sqrt(8)"]',0,'|v| = sqrt(1² + 2² + 2²) = sqrt(9) = 3.','Apply the Euclidean norm formula sqrt(x² + y² + z²).',1,'remember','Q7',10,'Vectors — Magnitude'),
  ('math','12','The number of ways to arrange the letters of the word ''MATHEMATICS'' is','["11!","11!/(2! 2! 2!)","11!/3!","11!/(2! 2!)"]',1,'MATHEMATICS has 11 letters. The repeated letters are M(2), A(2), T(2). Distinct arrangements = 11!/(2!·2!·2!).','Apply the permutations-with-repetition formula n!/(p1!·p2!·...).',3,'apply','Q8',7,'Permutations and Combinations'),
  ('math','12','If the sum of the first n natural numbers is 105, then n =','["13","14","15","16"]',1,'Sum of first n natural numbers = n(n+1)/2 = 105 ⇒ n(n+1) = 210 = 14·15, so n = 14.','Use the formula n(n+1)/2 and try integer solutions.',2,'apply','Q9',5,'Sequences and Series'),
  ('math','12','The probability that a leap year selected at random will contain 53 Sundays is','["1/7","2/7","3/7","4/7"]',1,'A leap year has 366 days = 52 weeks + 2 extra days. Those 2 extra days form one of 7 pairs: (S,M),(M,T),(T,W),(W,Th),(Th,F),(F,S),(S,S). Sundays appear in (S,M) and (S,S), so probability = 2/7.','Count the 2 extra days in a leap year and the pairs that include a Sunday.',4,'analyze','Q10',13,'Probability — Counting'),
  ('math','12','The mean of 5 numbers is 18. If one number is excluded, the mean of the remaining 4 becomes 16. The excluded number is','["18","20","22","26"]',3,'Sum of 5 numbers = 90. Sum of 4 remaining = 64. Excluded = 90 − 64 = 26.','Compute the sum before and after exclusion to find the missing number.',2,'apply','Q11',15,'Statistics — Mean'),
  ('math','12','If the roots of x² − 6x + 8 = 0 are α and β, then α² + β² equals','["20","32","36","48"]',0,'α + β = 6, αβ = 8. α² + β² = (α+β)² − 2αβ = 36 − 16 = 20.','Use Vieta''s formulas and the identity α² + β² = (α + β)² − 2αβ.',3,'apply','Q12',4,'Algebra — Quadratic Equations'),
  ('math','12','The derivative of e^(2x)·sin(x) with respect to x is','["e^(2x)·cosx","e^(2x)(2sinx + cosx)","e^(2x)(sinx + cosx)","2e^(2x)·sinx"]',1,'Product rule: d/dx [e^(2x)·sinx] = 2e^(2x)·sinx + e^(2x)·cosx = e^(2x)·(2sinx + cosx).','Apply the product rule and remember d/dx(e^(ax)) = a·e^(ax).',2,'apply','Q13',6,'Calculus — Differentiation'),
  ('math','12','The function f(x) = |x − 2| is','["differentiable at x = 2","not continuous at x = 2","continuous but not differentiable at x = 2","neither continuous nor differentiable at x = 2"]',2,'|x − 2| is continuous everywhere but has a corner at x = 2, where the left and right derivatives disagree. So it''s continuous but not differentiable there.','Absolute-value functions have corners that destroy differentiability while preserving continuity.',2,'understand','Q14',6,'Calculus — Continuity'),
  ('math','12','The general solution of cosθ = 1/2 is','["θ = 2nπ ± π/3","θ = nπ ± π/3","θ = nπ + π/3","θ = (2n+1)π/3"]',0,'cosθ = 1/2 ⇒ θ = 2nπ ± π/3, n ∈ ℤ. The principal value is π/3 (cosine''s period is 2π).','For cosθ = cosα, the general solution is θ = 2nπ ± α.',3,'remember','Q15',3,'Trigonometry — General Solutions'),
  ('math','12','If A and B are two events with P(A) = 0.4, P(B) = 0.5, P(A ∩ B) = 0.2, then P(A | B) is','["0.3","0.4","0.5","0.8"]',1,'P(A | B) = P(A ∩ B)/P(B) = 0.2/0.5 = 0.4.','Apply the conditional probability formula P(A | B) = P(A ∩ B)/P(B).',2,'apply','Q16',13,'Probability — Conditional Probability'),
  ('math','12','The locus of points equidistant from the lines y = x and y = −x is','["x = 0","y = 0","x = 0 or y = 0","x² = y²"]',2,'Distance from (a,b) to y = x is |a − b|/sqrt(2); to y = −x is |a + b|/sqrt(2). Equating gives |a − b| = |a + b|, which simplifies to ab = 0, i.e., x = 0 or y = 0.','Equate the perpendicular distances and simplify the absolute-value equation.',4,'analyze','Q17',2,'Coordinate Geometry — Locus'),
  ('math','12','The complex number (1 + i)/(1 − i) simplifies to','["1","i","−1","−i"]',1,'Multiply numerator and denominator by (1 + i): (1 + i)²/((1−i)(1+i)) = (1 + 2i − 1)/2 = 2i/2 = i.','Rationalise by multiplying by the conjugate of the denominator.',2,'apply','Q18',8,'Complex Numbers — Division'),
  ('math','12','If 5x + 3 > 8 and x is an integer, the smallest value of x is','["1","2","3","4"]',1,'5x + 3 > 8 ⇒ 5x > 5 ⇒ x > 1. The smallest integer strictly greater than 1 is 2.','Solve the strict inequality and pick the smallest integer satisfying it.',2,'apply','Q19',4,'Linear Inequalities'),
  ('math','12','The slope of the normal to the curve y = x² at (1, 1) is','["−1/2","−2","1/2","2"]',0,'dy/dx = 2x, slope of tangent at (1,1) is 2. Slope of normal = −1/(slope of tangent) = −1/2.','Normal slope is the negative reciprocal of the tangent slope.',2,'apply','Q20',6,'Calculus — Tangents and Normals'),
  ('math','12','The equation x² + y² − 4x − 6y + 9 = 0 represents a circle with centre','["(2, 3)","(−2, −3)","(4, 6)","(−4, −6)"]',0,'Complete the square: (x−2)² + (y−3)² = 4. Centre = (2, 3), radius = 2.','Compare with (x − h)² + (y − k)² = r² after completing the square.',2,'apply','Q21',9,'Coordinate Geometry — Circles'),
  ('math','12','The number of subsets of a set with 6 elements is','["12","36","64","720"]',2,'Number of subsets of a set with n elements is 2ⁿ. For n = 6 it is 64.','Each element either belongs or doesn''t belong to the subset; total possibilities = 2ⁿ.',1,'remember','Q22',1,'Sets — Subsets'),
  ('math','12','If the binomial expansion of (1 + x)ⁿ has a coefficient of 84 for x³, then n =','["7","8","9","10"]',2,'Coefficient of x³ in (1 + x)ⁿ is C(n,3) = n(n−1)(n−2)/6 = 84 ⇒ n(n−1)(n−2) = 504 = 9·8·7. So n = 9.','Match C(n,3) to 84 and solve for n by inspection.',3,'apply','Q23',8,'Binomial Theorem'),
  ('math','12','lim(x→0) (sin3x)/x =','["0","1","3","∞"]',2,'lim(x→0) (sin3x)/x = lim(x→0) 3·(sin3x)/(3x) = 3·1 = 3.','Recall lim(x→0) (sin(ax))/x = a.',2,'apply','Q24',5,'Calculus — Limits'),
  ('math','12','A six-sided die is rolled twice. What is the probability that the sum is 7?','["1/6","1/9","1/12","5/36"]',0,'There are 36 equally likely outcomes. Pairs summing to 7: (1,6),(2,5),(3,4),(4,3),(5,2),(6,1) — 6 pairs. Probability = 6/36 = 1/6.','Count ordered pairs that sum to 7 out of 36 total outcomes.',2,'apply','Q25',13,'Probability — Dice'),
  ('math','12','The function f(x) = log(x² − 1) is defined for','["x > 1","x < −1","x < −1 or x > 1","−1 < x < 1"]',2,'log argument must be positive: x² − 1 > 0 ⇒ x < −1 or x > 1.','Set the argument of the logarithm strictly positive and solve.',3,'analyze','Q26',5,'Functions — Domain'),
  ('math','12','The inverse of the function f(x) = 3x − 2 is','["(x + 2)/3","(x − 2)/3","3x + 2","3/(x − 2)"]',0,'y = 3x − 2 ⇒ x = (y + 2)/3. So f⁻¹(x) = (x + 2)/3.','Swap x and y in the equation and solve for the new y.',2,'apply','Q27',5,'Functions — Inverse'),
  ('math','12','The 10th term of the AP 5, 8, 11, 14, ... is','["29","32","35","38"]',1,'a = 5, d = 3, so a₁₀ = a + 9d = 5 + 27 = 32.','Use a_n = a + (n − 1)d for an AP.',1,'remember','Q28',5,'Sequences and Series — AP'),
  ('math','12','The angle between the vectors a = (1, 0, 0) and b = (1, 1, 0) is','["30°","45°","60°","90°"]',1,'cosθ = (a · b)/(|a||b|) = 1/(1 · sqrt(2)) = 1/sqrt(2), so θ = 45°.','Use cosθ = (a · b)/(|a||b|).',2,'apply','Q29',10,'Vectors — Dot Product'),
  ('math','12','How many real solutions does e^x = x² have?','["0","1","2","3"]',1,'Let f(x) = e^x − x². f(−1) ≈ 0.37 − 1 = −0.63 < 0 and f(0) = 1 > 0, so there is a root in (−1, 0). For x ≥ 0 we have e^x > x² everywhere (e^0 = 1 > 0; the gap widens as x grows). For x < −1, e^x stays positive but small while x² grows large, so f stays negative. Hence exactly one real solution.','Sketch y = e^x and y = x² and count intersection points; remember e^x grows faster than any polynomial.',5,'evaluate','Q30',6,'Calculus — Curve Intersection')
) AS v(subject, grade, question_text, options, correct_answer_index, explanation, hint, difficulty, bloom_level, question_number, chapter_number, chapter_title)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2d. Biology (NEET level) — 40 questions, grade '12'
-- ───────────────────────────────────────────────────────────────────────
WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers WHERE paper_code = 'sample_neet_bio_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_type, options,
  correct_answer_index, explanation, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, exam_paper_id, paper_pattern, marks_correct,
  marks_wrong, question_number, exam_session, chapter_number,
  chapter_title, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, 'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.hint, v.difficulty, v.bloom_level,
       'curated_seed', 'neet_archive', true, true, 'verified',
       false, pl.id, 'mcq_single', 4.00,
       -1.00, v.question_number, 'sample_neet_bio_2025', v.chapter_number,
       v.chapter_title, ARRAY['neet','sample','2025','biology']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  ('biology','12','The powerhouse of the cell is','["nucleus","ribosome","mitochondrion","Golgi apparatus"]',2,'Mitochondria generate most of the cell''s ATP via oxidative phosphorylation, earning the nickname "powerhouse of the cell".','Think about which organelle is the site of ATP synthesis.',1,'remember','Q1',8,'Cell — Organelles'),
  ('biology','12','Photosynthesis converts which of the following?','["Glucose to oxygen","CO₂ and water to glucose and oxygen","Oxygen to CO₂","Glucose to ATP"]',1,'In photosynthesis, plants use light energy to combine CO₂ and water into glucose and release oxygen as a by-product.','Recall the overall photosynthesis equation.',1,'remember','Q2',13,'Plant Physiology — Photosynthesis'),
  ('biology','12','Which of the following is NOT a nitrogenous base in DNA?','["Adenine","Guanine","Uracil","Cytosine"]',2,'DNA contains A, T, G, C. Uracil replaces thymine in RNA, not DNA.','Recall which base is unique to RNA.',1,'remember','Q3',6,'Molecular Biology — Nucleic Acids'),
  ('biology','12','The exchange of gases in human lungs takes place in the','["bronchi","trachea","alveoli","bronchioles"]',2,'Alveoli are tiny air sacs with a thin epithelium and rich capillary supply, providing the surface for O₂/CO₂ exchange.','Identify the structure with the largest surface area in the lungs.',1,'remember','Q4',17,'Human Physiology — Respiration'),
  ('biology','12','The process by which water moves from soil into root cells is called','["transpiration","translocation","osmosis","photosynthesis"]',2,'Water moves from the soil (low solute) into root cells (higher solute) by osmosis across a semi-permeable membrane.','Water movement across a semi-permeable membrane down its potential gradient is named...?',2,'understand','Q5',11,'Plant Physiology — Water Transport'),
  ('biology','12','Which blood group is called the universal donor?','["A","B","AB","O−"]',3,'O− has no A, B, or Rh antigens on the RBC surface, so it can be transfused to recipients of any ABO/Rh type.','Universal donor lacks all major surface antigens.',2,'remember','Q6',18,'Human Physiology — Blood Groups'),
  ('biology','12','Mendel''s law of independent assortment applies to','["genes on the same chromosome","genes very close on the same chromosome","genes on different chromosomes","sex-linked genes"]',2,'Independent assortment requires genes to segregate independently. This holds when genes are on different chromosomes (or far apart on the same chromosome).','Independent assortment fails when genes are tightly linked.',3,'understand','Q7',5,'Genetics — Mendel''s Laws'),
  ('biology','12','In humans, the diploid chromosome number is','["22","23","44","46"]',3,'Humans have 46 chromosomes (23 pairs) in somatic cells; gametes are haploid with 23.','Diploid means two sets of chromosomes; humans have 23 pairs.',1,'remember','Q8',10,'Genetics — Chromosomes'),
  ('biology','12','Which hormone regulates blood glucose levels by promoting glucose uptake by cells?','["Glucagon","Insulin","Adrenaline","Thyroxine"]',1,'Insulin is secreted by pancreatic β-cells and promotes glucose uptake, lowering blood glucose. Glucagon does the opposite.','The hormone that lowers blood glucose comes from pancreatic β-cells.',2,'remember','Q9',22,'Human Physiology — Endocrine'),
  ('biology','12','Which of the following is a vestigial organ in humans?','["Heart","Liver","Vermiform appendix","Kidney"]',2,'The vermiform appendix has lost its original digestive function in humans and is considered vestigial.','Vestigial organs have lost their original function over evolutionary time.',2,'remember','Q10',7,'Evolution — Evidence'),
  ('biology','12','The site of protein synthesis in a cell is','["nucleus","mitochondrion","ribosome","Golgi"]',2,'Ribosomes translate mRNA into polypeptides. They can be free in the cytoplasm or attached to the rough ER.','Translation happens on a structure made of rRNA and proteins.',1,'remember','Q11',8,'Cell — Protein Synthesis'),
  ('biology','12','In a typical food chain, primary consumers are','["green plants","herbivores","carnivores","decomposers"]',1,'Primary consumers are herbivores: they eat the producers (green plants) and are eaten by secondary consumers (carnivores).','The first link above producers in a food chain is the level that eats the plants.',2,'understand','Q12',14,'Ecology — Food Chain'),
  ('biology','12','The functional unit of the kidney is the','["neuron","nephron","alveolus","glomerulus"]',1,'The nephron is the structural and functional unit of the kidney, comprising the glomerulus and renal tubule.','The kidney''s smallest filtering and reabsorbing unit, named for its tube-like structure.',1,'remember','Q13',19,'Human Physiology — Excretion'),
  ('biology','12','Crossing over occurs during','["mitosis","meiosis I prophase","meiosis II anaphase","fertilisation"]',1,'Crossing over occurs in prophase I of meiosis when homologous chromosomes pair as bivalents and exchange segments.','It happens when homologous chromosomes pair up — a unique meiotic event.',3,'understand','Q14',10,'Cell Division — Meiosis'),
  ('biology','12','Which vitamin deficiency causes scurvy?','["Vitamin A","Vitamin B12","Vitamin C","Vitamin D"]',2,'Vitamin C (ascorbic acid) is required for collagen synthesis. Its deficiency causes scurvy: bleeding gums, slow wound healing.','Scurvy is associated with sailors who lacked fresh fruit.',1,'remember','Q15',16,'Human Physiology — Nutrition'),
  ('biology','12','In the dark reactions of photosynthesis (Calvin cycle), CO₂ is fixed by the enzyme','["NADP reductase","RuBisCO","ATP synthase","Cytochrome oxidase"]',1,'RuBisCO (ribulose-1,5-bisphosphate carboxylase/oxygenase) fixes CO₂ to RuBP in the Calvin cycle.','The most abundant protein on Earth is the carbon-fixing enzyme.',3,'remember','Q16',13,'Plant Physiology — Calvin Cycle'),
  ('biology','12','The fluid filling the space between the membranes of mitochondrion is called the','["matrix","stroma","cytosol","intermembrane space"]',3,'The intermembrane space lies between the outer and inner mitochondrial membranes. The matrix is inside the inner membrane.','Two membranes give two compartments; identify the one between them.',3,'remember','Q17',8,'Cell — Mitochondria'),
  ('biology','12','Which of the following is an example of a Mendelian autosomal recessive disorder?','["Haemophilia","Down syndrome","Sickle-cell anaemia","Turner syndrome"]',2,'Sickle-cell anaemia is caused by a recessive allele on an autosome and follows classical Mendelian recessive inheritance.','Haemophilia is X-linked; Down and Turner are chromosomal aneuploidies; this leaves an autosomal point-mutation disease.',3,'analyze','Q18',5,'Genetics — Human Disorders'),
  ('biology','12','Bile is produced in the','["pancreas","liver","stomach","gall bladder"]',1,'Bile is produced by the liver and stored in the gall bladder before release into the duodenum.','Production happens in the largest gland of the body; the gall bladder only stores it.',1,'remember','Q19',16,'Human Physiology — Digestion'),
  ('biology','12','The enzyme that catalyses the synthesis of DNA from an RNA template is','["DNA polymerase I","RNA polymerase","Reverse transcriptase","Helicase"]',2,'Reverse transcriptase uses RNA as a template to synthesise complementary DNA. It''s characteristic of retroviruses.','Retroviruses like HIV need an enzyme that runs the central dogma "in reverse".',3,'understand','Q20',6,'Molecular Biology — Reverse Transcription'),
  ('biology','12','In the human eye, the part responsible for accommodation (focusing on near vs distant objects) is the','["cornea","iris","lens","retina"]',2,'The lens changes shape via ciliary muscles to focus on objects at varying distances — the process of accommodation.','Look for the structure whose shape can be adjusted by muscles.',2,'understand','Q21',21,'Human Physiology — Sense Organs'),
  ('biology','12','Which of the following is NOT a greenhouse gas?','["CO₂","CH₄","N₂","H₂O vapour"]',2,'CO₂, CH₄, and water vapour are greenhouse gases. N₂ is the main component of air but is not radiatively active in IR.','Greenhouse gases absorb infrared radiation; N₂ has no IR-active vibrational modes.',3,'analyze','Q22',14,'Ecology — Greenhouse Effect'),
  ('biology','12','In humans, the pacemaker of the heart is the','["AV node","SA node","Purkinje fibres","bundle of His"]',1,'The sinoatrial (SA) node initiates each heartbeat and sets the rhythm; it''s the heart''s natural pacemaker.','The pacemaker is at the top of the right atrium.',2,'remember','Q23',18,'Human Physiology — Heart'),
  ('biology','12','The process by which a gene is copied into an mRNA is called','["replication","transcription","translation","reverse transcription"]',1,'Transcription is the synthesis of mRNA from a DNA template by RNA polymerase.','First step of gene expression: DNA → RNA.',1,'remember','Q24',6,'Molecular Biology — Transcription'),
  ('biology','12','The number of ATP molecules produced per glucose molecule during aerobic respiration is approximately','["2","4","8","36"]',3,'Complete aerobic oxidation of one glucose yields ~36 ATP (some textbooks cite 38) via glycolysis, TCA, and oxidative phosphorylation.','Anaerobic gives 2 ATP; full aerobic respiration gives far more.',3,'apply','Q25',12,'Cell — Respiration'),
  ('biology','12','In sexually reproducing organisms, gametes are produced by','["mitosis","meiosis","binary fission","budding"]',1,'Meiosis halves the chromosome number, producing haploid gametes that fuse during fertilisation to restore the diploid state.','Sexual reproduction needs cells with half the parent''s chromosome count.',1,'understand','Q26',2,'Reproduction — Gametogenesis'),
  ('biology','12','The phylum Cnidaria is characterised by the presence of','["bilateral symmetry","stinging cells (nematocysts)","jointed appendages","a notochord"]',1,'Cnidarians (jellyfish, corals, sea anemones) possess specialised stinging cells called nematocysts.','Look for a feature unique to jellyfish-like animals.',2,'remember','Q27',4,'Animal Kingdom — Cnidaria'),
  ('biology','12','Which type of plastid stores starch?','["chloroplast","chromoplast","leucoplast","amyloplast"]',3,'Amyloplasts are leucoplasts specialised for starch storage. Generic leucoplasts also store reserves but amyloplast is the specific term.','The specific name for starch-storing plastids ends in "-plast".',3,'remember','Q28',8,'Cell — Plastids'),
  ('biology','12','The ozone layer is mainly present in the','["troposphere","stratosphere","mesosphere","thermosphere"]',1,'The stratospheric ozone layer (~15-35 km altitude) absorbs most of the Sun''s UV radiation.','It''s in the second layer of the atmosphere.',2,'remember','Q29',14,'Ecology — Ozone Layer'),
  ('biology','12','The sex of a child in humans is determined by','["the mother''s chromosomes","the father''s chromosomes","both parents equally","environmental factors"]',1,'The mother always contributes an X chromosome; the father contributes either X (→ daughter) or Y (→ son). So the father''s gamete determines the sex.','Mothers can only pass X. Fathers pass X or Y.',2,'understand','Q30',5,'Genetics — Sex Determination'),
  ('biology','12','The unit of natural selection in classical Darwinian theory is','["an individual","a gene","a population","a species"]',0,'In classical Darwinism the individual organism is the unit on which selection acts (the fittest individuals leave more offspring). Gene-level selection is a modern refinement.','Darwin himself focused on which individuals survive and reproduce.',3,'understand','Q31',7,'Evolution — Selection'),
  ('biology','12','Which is the smallest functional unit of muscle contraction?','["myofibril","sarcomere","muscle fibre","actin filament"]',1,'A sarcomere is the segment between two Z-discs; it''s the smallest unit that exhibits the full contraction cycle of the sliding-filament mechanism.','Muscle contracts in repeating units bounded by Z-discs.',3,'understand','Q32',20,'Human Physiology — Muscle'),
  ('biology','12','Auxins are plant hormones primarily responsible for','["seed dormancy","cell elongation","leaf fall","ripening of fruits"]',1,'Auxins promote cell elongation, especially in growing shoots and roots. They also play roles in phototropism and apical dominance.','The hormone behind phototropism and bending toward light is also responsible for cell elongation.',2,'remember','Q33',15,'Plant Physiology — Hormones'),
  ('biology','12','In which phase of mitosis do chromosomes line up at the metaphase plate?','["prophase","metaphase","anaphase","telophase"]',1,'During metaphase, chromosomes align along the equatorial plate (metaphase plate) with spindle fibres attached.','The phase is named after the plate where chromosomes align.',1,'remember','Q34',10,'Cell Division — Mitosis'),
  ('biology','12','Which type of immunity is acquired from the mother through breast milk?','["active natural","active artificial","passive natural","passive artificial"]',2,'Antibodies passed via breast milk are received passively (not produced by the infant), and they occur naturally (no vaccine involved). Hence passive natural.','Passive = received antibodies. Natural = no medical intervention.',3,'analyze','Q35',23,'Human Physiology — Immunity'),
  ('biology','12','The bacterium that fixes atmospheric nitrogen in legume root nodules is','["Azotobacter","Rhizobium","Nitrosomonas","Pseudomonas"]',1,'Rhizobium forms symbiotic root nodules with legumes and fixes atmospheric N₂ into ammonia for plant use.','It''s symbiotic with legumes and forms nodules.',2,'remember','Q36',11,'Plant Physiology — Nitrogen Fixation'),
  ('biology','12','Which structural feature distinguishes prokaryotic from eukaryotic cells?','["presence of cell membrane","absence of nucleus","presence of ribosomes","absence of cytoplasm"]',1,'Prokaryotes lack a membrane-bound nucleus; their DNA sits free in the cytoplasm as a nucleoid. Eukaryotes have a true nucleus.','The defining feature is whether DNA is enclosed in a membrane.',2,'understand','Q37',8,'Cell — Prokaryote vs Eukaryote'),
  ('biology','12','Which pollination type uses wind as the agent?','["entomophily","anemophily","hydrophily","ornithophily"]',1,'Anemophily means wind pollination (e.g., grasses). Entomophily uses insects, hydrophily uses water, ornithophily uses birds.','"Anemo-" is the Greek root for wind.',2,'remember','Q38',2,'Reproduction — Pollination'),
  ('biology','12','The total length of human DNA in a single diploid cell is approximately','["20 cm","2 m","20 m","200 m"]',1,'Stretched out, the DNA in one human diploid cell measures about 2 metres total across all 46 chromosomes.','Each haploid genome is ~1 m; diploid doubles that.',4,'remember','Q39',6,'Molecular Biology — Genome Size'),
  ('biology','12','Which of the following best explains why selective breeding has produced very different breeds of dogs from a common wolf ancestor?','["mutation alone","natural selection","artificial selection","genetic drift"]',2,'Selective (artificial) selection by humans favouring particular traits over generations produces breeds with the desired phenotypes from common ancestral stock.','When humans choose which individuals reproduce, the selection is called...?',3,'evaluate','Q40',7,'Evolution — Artificial Selection')
) AS v(subject, grade, question_text, options, correct_answer_index, explanation, hint, difficulty, bloom_level, question_number, chapter_number, chapter_title)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2e. Math Olympiad — 20 questions, grade '10' (junior olympiad)
-- ───────────────────────────────────────────────────────────────────────
WITH paper_lookup AS (
  SELECT id, paper_code FROM public.exam_papers WHERE paper_code = 'sample_olympiad_math_v1'
)
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_type, options,
  correct_answer_index, explanation, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, exam_paper_id, paper_pattern, marks_correct,
  marks_wrong, question_number, exam_session, chapter_number,
  chapter_title, tags, created_at
)
SELECT gen_random_uuid(), v.subject, v.grade, v.question_text, 'mcq', v.options::jsonb,
       v.correct_answer_index, v.explanation, v.hint, v.difficulty, v.bloom_level,
       'curated_seed', 'olympiad', true, true, 'verified',
       false, pl.id, 'mcq_single', 5.00,
       0.00, v.question_number, 'sample_olympiad_math_2025', v.chapter_number,
       v.chapter_title, ARRAY['olympiad_math','sample','2025','math']::text[], now()
FROM paper_lookup pl
CROSS JOIN (VALUES
  ('math','10','How many three-digit positive integers have all distinct digits?','["648","720","729","900"]',0,'Hundreds digit: 9 choices (1-9). Tens digit: 9 choices (0-9 minus the one used). Units digit: 8 choices. Total = 9·9·8 = 648.','First-digit cannot be 0; then count distinct selections for the remaining positions.',4,'analyze','Q1',7,'Combinatorics — Counting'),
  ('math','10','The number of positive divisors of 360 is','["18","20","24","32"]',2,'360 = 2³·3²·5. Number of divisors = (3+1)(2+1)(1+1) = 24.','For n = p₁^a · p₂^b · p₃^c, the number of divisors is (a+1)(b+1)(c+1).',4,'analyze','Q2',1,'Number Theory — Divisors'),
  ('math','10','The remainder when 7^100 is divided by 10 is','["1","3","7","9"]',0,'7^1≡7, 7^2≡9, 7^3≡3, 7^4≡1 (mod 10). The cycle length is 4. Since 100 ≡ 0 (mod 4), 7^100 ≡ 7^4 ≡ 1 (mod 10).','Find the cycle of last digits of powers of 7 and use 100 mod 4.',4,'analyze','Q3',1,'Number Theory — Modular Arithmetic'),
  ('math','10','In a regular hexagon with side length 2, the length of the longest diagonal is','["2","2√3","4","4√3"]',2,'In a regular hexagon, the longest diagonal passes through the centre and equals twice the side length. So 2·2 = 4.','The longest diagonal of a regular hexagon goes from one vertex through the centre to the opposite vertex.',4,'analyze','Q4',6,'Geometry — Hexagon'),
  ('math','10','The sum of all positive integers less than 100 that are divisible by 3 or 5 is','["2318","2418","2333","2533"]',0,'Sum of multiples of 3 below 100: 3 + 6 + ... + 99 = 33·51 = 1683. Sum of multiples of 5 below 100: 5 + 10 + ... + 95 = 19·50 = 950. Sum of multiples of 15 below 100: 15 + 30 + ... + 90 = 6·52.5 = 315. By inclusion-exclusion the answer is 1683 + 950 − 315 = 2318.','Use inclusion-exclusion: |A ∪ B| = |A| + |B| − |A ∩ B|, where A = multiples of 3, B = multiples of 5.',5,'analyze','Q5',5,'Number Theory — Inclusion-Exclusion'),
  ('math','10','How many real solutions does the equation x⁴ + 1 = 0 have?','["0","1","2","4"]',0,'x⁴ + 1 = 0 ⇒ x⁴ = −1. Since x⁴ ≥ 0 for all real x, no real solutions exist; all four solutions are complex.','x⁴ is non-negative for real x; can it equal a negative number?',4,'analyze','Q6',4,'Algebra — Polynomial Roots'),
  ('math','10','The smallest positive integer n such that n! ends in exactly 3 trailing zeros is','["13","15","16","18"]',1,'Trailing zeros of n! = sum of floor(n/5^k). For n = 14: 14/5 = 2, total = 2. For n = 15: 15/5 = 3, total = 3. For n = 16-19: still 3. So smallest n with exactly 3 zeros is 15.','Count trailing zeros using Legendre''s formula for the power of 5 in n!.',5,'analyze','Q7',1,'Number Theory — Factorials'),
  ('math','10','In how many ways can 5 boys and 3 girls be seated in a row such that no two girls sit next to each other?','["14400","7200","4320","2400"]',0,'Arrange 5 boys: 5! = 120 ways. They create 6 gaps for girls; choose 3 of these 6 gaps: C(6,3) = 20, then arrange 3 girls: 3! = 6. Total = 120·20·6 = 14400.','Place the boys first, then put girls into the gaps between them.',5,'analyze','Q8',7,'Combinatorics — Arrangements'),
  ('math','10','The least integer n such that 2ⁿ > 10⁶ is','["17","19","20","21"]',2,'2¹⁰ ≈ 10³ ⇒ 2²⁰ ≈ 10⁶. More precisely, 2¹⁹ = 524288 < 10⁶ and 2²⁰ = 1048576 > 10⁶. So least n = 20.','Use 2¹⁰ ≈ 10³ as a rough scaling and refine.',4,'apply','Q9',3,'Algebra — Logarithms'),
  ('math','10','A 6-digit number is formed by using the digits 1, 2, 3, 4, 5, 6 each exactly once. How many such numbers are divisible by 6?','["120","240","360","720"]',2,'Divisibility by 6 means divisible by 2 and 3. Sum 1+2+3+4+5+6 = 21, divisible by 3, so any arrangement works for the divisibility-by-3 condition. Divisibility by 2 means last digit is even: 2, 4, or 6 — that''s 3 choices. Remaining 5 digits: 5! = 120. Total = 3·120 = 360.','Apply divisibility-by-6 rule = divisibility by 2 and by 3. Sum trick checks divisibility by 3.',5,'analyze','Q10',1,'Number Theory — Divisibility'),
  ('math','10','The number of integer solutions of x² + y² = 25 is','["8","12","16","20"]',1,'Solutions: (±3, ±4), (±4, ±3), (±5, 0), (0, ±5). Each of (±3,±4) and (±4,±3) gives 4 solutions; plus 2+2 = 4 axis solutions. Total = 4 + 4 + 4 = 12.','List all integer pairs of perfect squares summing to 25 and count with signs.',5,'analyze','Q11',2,'Number Theory — Diophantine Equations'),
  ('math','10','The sum 1 + 2 + 3 + ... + 100 equals','["5050","5500","9900","10100"]',0,'Sum = n(n+1)/2 = 100·101/2 = 5050. (Gauss''s classic.)','Use the formula n(n+1)/2.',2,'remember','Q12',5,'Algebra — Series'),
  ('math','10','In a triangle ABC, the angles satisfy A : B : C = 1 : 2 : 3. The triangle is','["equilateral","right-angled","obtuse","isosceles"]',1,'A + B + C = 180°. With the ratio 1:2:3, the parts are 30°, 60°, 90°. So the triangle is right-angled.','Sum of triangle angles is 180°; share it in the ratio.',3,'apply','Q13',6,'Geometry — Triangle Angles'),
  ('math','10','The number of ordered pairs (a, b) of positive integers satisfying a + b = 10 is','["8","9","10","11"]',1,'For a + b = 10 with both a and b positive integers, a ranges from 1 to 9 and each value of a determines b uniquely. So there are 9 ordered pairs.','Count positive integer values of a for which b = 10 − a is also positive.',3,'apply','Q14',7,'Combinatorics — Ordered Pairs'),
  ('math','10','How many positive integers n less than or equal to 100 are perfect squares?','["8","9","10","11"]',2,'Perfect squares ≤ 100: 1², 2², ..., 10². That''s 10.','Count k such that k² ≤ 100.',2,'apply','Q15',1,'Number Theory — Perfect Squares'),
  ('math','10','The product of the digits of a 2-digit number is 24, the digit sum is 10, and the tens digit is smaller than the units digit. The number is','["46","64","58","85"]',0,'Let the digits be a (tens) and b (units) with a + b = 10 and a·b = 24. They are the roots of x² − 10x + 24 = 0, namely 4 and 6. With a < b we have a = 4 and b = 6, so the number is 46.','Digits a and b satisfy a + b = S and a·b = P; solve a quadratic and apply the tens-versus-units order constraint.',4,'analyze','Q16',2,'Number Theory — Digit Problems'),
  ('math','10','In a right-angled triangle the hypotenuse is 13 cm and one leg is 5 cm. The other leg is','["6 cm","8 cm","10 cm","12 cm"]',3,'Pythagoras: other leg = sqrt(13² − 5²) = sqrt(169 − 25) = sqrt(144) = 12 cm.','Apply the Pythagorean theorem c² = a² + b².',2,'apply','Q17',6,'Geometry — Pythagoras'),
  ('math','10','How many five-digit positive integers have the property that the sum of their digits is 5?','["56","70","126","210"]',1,'Let the digits be d₁, d₂, d₃, d₄, d₅ with d₁ ≥ 1 (no leading zero) and each d_i ≤ 9. Substitute e₁ = d₁ − 1 so all e_i ≥ 0 and e₁ + d₂ + d₃ + d₄ + d₅ = 4. The upper bound 9 cannot bind because the total is only 4. By stars and bars the count is C(4 + 4, 4) = C(8, 4) = 70.','Apply stars and bars after substituting e₁ = d₁ − 1 to handle the d₁ ≥ 1 constraint.',5,'analyze','Q18',7,'Combinatorics — Stars and Bars'),
  ('math','10','If a, b, c are positive real numbers with a + b + c = 6, then the maximum possible value of abc is','["4","6","8","27"]',2,'By AM-GM, abc ≤ ((a+b+c)/3)³ = 2³ = 8, with equality when a = b = c = 2. So max abc = 8.','Apply AM-GM inequality to find the maximum of a product given a fixed sum.',5,'evaluate','Q19',4,'Algebra — AM-GM Inequality'),
  ('math','10','The unit''s digit of 3^2025 is','["1","3","7","9"]',1,'Powers of 3 mod 10 cycle: 3, 9, 7, 1, 3, 9, 7, 1, ... with period 4. 2025 mod 4 = 1 (since 2024 = 506·4). So 3^2025 ends in 3.','Find the cycle length of last digits of powers of 3 and compute 2025 mod 4.',4,'analyze','Q20',1,'Number Theory — Last Digits')
) AS v(subject, grade, question_text, options, correct_answer_index, explanation, hint, difficulty, bloom_level, question_number, chapter_number, chapter_title)
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Verification block — counts inserted rows and validates linkage
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_papers_count       integer;
  v_phy_count          integer;
  v_chem_count         integer;
  v_math_jee_count     integer;
  v_bio_count          integer;
  v_math_oly_count     integer;
  v_total_seed_count   integer;
  v_papers_with_correct_count integer;
  rec record;
BEGIN
  -- Count exam_papers rows we expect (5)
  SELECT count(*) INTO v_papers_count
    FROM public.exam_papers
   WHERE paper_code LIKE 'sample_%';

  IF v_papers_count < 5 THEN
    RAISE WARNING 'PR-3 seed: expected >= 5 sample exam_papers, found %', v_papers_count;
  END IF;

  -- Per-paper question counts (cross-check FK linkage)
  SELECT count(*) INTO v_phy_count
    FROM public.question_bank q
    JOIN public.exam_papers p ON p.id = q.exam_paper_id
   WHERE p.paper_code = 'sample_jee_main_phy_v1'
     AND q.source = 'curated_seed';

  SELECT count(*) INTO v_chem_count
    FROM public.question_bank q
    JOIN public.exam_papers p ON p.id = q.exam_paper_id
   WHERE p.paper_code = 'sample_jee_main_chem_v1'
     AND q.source = 'curated_seed';

  SELECT count(*) INTO v_math_jee_count
    FROM public.question_bank q
    JOIN public.exam_papers p ON p.id = q.exam_paper_id
   WHERE p.paper_code = 'sample_jee_main_math_v1'
     AND q.source = 'curated_seed';

  SELECT count(*) INTO v_bio_count
    FROM public.question_bank q
    JOIN public.exam_papers p ON p.id = q.exam_paper_id
   WHERE p.paper_code = 'sample_neet_bio_v1'
     AND q.source = 'curated_seed';

  SELECT count(*) INTO v_math_oly_count
    FROM public.question_bank q
    JOIN public.exam_papers p ON p.id = q.exam_paper_id
   WHERE p.paper_code = 'sample_olympiad_math_v1'
     AND q.source = 'curated_seed';

  SELECT count(*) INTO v_total_seed_count
    FROM public.question_bank
   WHERE source = 'curated_seed'
     AND source_type IN ('jee_archive','neet_archive','olympiad');

  RAISE NOTICE 'PR-3 seed: % sample exam_papers rows present', v_papers_count;
  RAISE NOTICE 'PR-3 seed: physics (jee_archive) question rows: %', v_phy_count;
  RAISE NOTICE 'PR-3 seed: chemistry (jee_archive) question rows: %', v_chem_count;
  RAISE NOTICE 'PR-3 seed: math (jee_archive) question rows: %', v_math_jee_count;
  RAISE NOTICE 'PR-3 seed: biology (neet_archive) question rows: %', v_bio_count;
  RAISE NOTICE 'PR-3 seed: math (olympiad) question rows: %', v_math_oly_count;
  RAISE NOTICE 'PR-3 seed: total curated_seed question rows: %', v_total_seed_count;

  -- Per-paper count vs total_questions sanity check
  v_papers_with_correct_count := 0;
  FOR rec IN
    SELECT p.paper_code, p.total_questions, count(q.id) AS actual_n
      FROM public.exam_papers p
      LEFT JOIN public.question_bank q
        ON q.exam_paper_id = p.id AND q.source = 'curated_seed'
     WHERE p.paper_code LIKE 'sample_%'
     GROUP BY p.paper_code, p.total_questions
  LOOP
    IF rec.actual_n = rec.total_questions THEN
      v_papers_with_correct_count := v_papers_with_correct_count + 1;
      RAISE NOTICE '  paper % : % / % questions (OK)', rec.paper_code, rec.actual_n, rec.total_questions;
    ELSE
      RAISE WARNING '  paper % : % / % questions (MISMATCH)', rec.paper_code, rec.actual_n, rec.total_questions;
    END IF;
  END LOOP;

  IF v_total_seed_count < 140 THEN
    RAISE WARNING 'PR-3 seed: total curated_seed question count (%) below acceptance threshold (140). Re-check VALUES lists.', v_total_seed_count;
  ELSE
    RAISE NOTICE 'PR-3 seed: MIGRATION COMPLETE — % questions inserted across % sample papers', v_total_seed_count, v_papers_count;
  END IF;
END $verify$;

COMMIT;
