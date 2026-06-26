-- Migration: 20260624000100_seed_cbse_syllabus_manifest.sql
-- Purpose: Seed the complete CBSE curriculum chapter manifest for grades 6-12
--          into cbse_syllabus so the grounded-answer pipeline abstain logic has
--          a complete chapter registry. All rows start as rag_status='missing';
--          the generate-embeddings + verification pipeline promotes them to
--          'partial' or 'ready'. The trg_cbse_syllabus_normalize_display trigger
--          fires on INSERT and will replace the subject_display placeholder with
--          the proper display name from the subjects master table.
--
-- Idempotent: ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING
-- RLS: cbse_syllabus already has RLS + policies from the baseline migration.
--      This migration is DATA ONLY — no schema changes.
--
-- Coverage: 16 subject codes × applicable grades per NCERT 2025 edition
--   Grade 6-12: math, english
--   Grade 6-10: science, hindi, social_studies
--   Grade 6-8:  coding
--   Grade 9-12: computer_science
--   Grade 11-12: physics, chemistry, biology, economics, accountancy,
--                business_studies, political_science, history_sr, geography
--
-- Approximate total rows: ~660 chapters across all grade×subject combinations.

INSERT INTO public.cbse_syllabus
  (board, grade, subject_code, subject_display, chapter_number, chapter_title, rag_status, is_in_scope)
VALUES

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 6 — MATH (Ganita Prakash 2024, 14 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','6','math','math',1,'Patterns in Mathematics','missing',true),
('CBSE','6','math','math',2,'Lines and Angles','missing',true),
('CBSE','6','math','math',3,'Number Play','missing',true),
('CBSE','6','math','math',4,'Data Handling and Presentation','missing',true),
('CBSE','6','math','math',5,'Prime Time','missing',true),
('CBSE','6','math','math',6,'Perimeter and Area','missing',true),
('CBSE','6','math','math',7,'Fractions','missing',true),
('CBSE','6','math','math',8,'Playing with Constructions','missing',true),
('CBSE','6','math','math',9,'Symmetry','missing',true),
('CBSE','6','math','math',10,'The Other Side of Zero','missing',true),
('CBSE','6','math','math',11,'Ratio and Proportion','missing',true),
('CBSE','6','math','math',12,'Arithmetic Operations on Fractions','missing',true),
('CBSE','6','math','math',13,'Easy Ways to Multiply and Divide','missing',true),
('CBSE','6','math','math',14,'Algebra','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 7 — MATH (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','7','math','math',1,'Integers','missing',true),
('CBSE','7','math','math',2,'Fractions and Decimals','missing',true),
('CBSE','7','math','math',3,'Data Handling','missing',true),
('CBSE','7','math','math',4,'Simple Equations','missing',true),
('CBSE','7','math','math',5,'Lines and Angles','missing',true),
('CBSE','7','math','math',6,'The Triangles and Its Properties','missing',true),
('CBSE','7','math','math',7,'Comparing Quantities','missing',true),
('CBSE','7','math','math',8,'Rational Numbers','missing',true),
('CBSE','7','math','math',9,'Perimeter and Area','missing',true),
('CBSE','7','math','math',10,'Algebraic Expressions','missing',true),
('CBSE','7','math','math',11,'Exponents and Powers','missing',true),
('CBSE','7','math','math',12,'Symmetry','missing',true),
('CBSE','7','math','math',13,'Visualising Solid Shapes','missing',true),
('CBSE','7','math','math',14,'Congruence of Triangles','missing',true),
('CBSE','7','math','math',15,'Practical Geometry','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 8 — MATH (14 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','8','math','math',1,'Rational Numbers','missing',true),
('CBSE','8','math','math',2,'Linear Equations in One Variable','missing',true),
('CBSE','8','math','math',3,'Understanding Quadrilaterals','missing',true),
('CBSE','8','math','math',4,'Data Handling','missing',true),
('CBSE','8','math','math',5,'Squares and Square Roots','missing',true),
('CBSE','8','math','math',6,'Cubes and Cube Roots','missing',true),
('CBSE','8','math','math',7,'Comparing Quantities','missing',true),
('CBSE','8','math','math',8,'Algebraic Expressions and Identities','missing',true),
('CBSE','8','math','math',9,'Mensuration','missing',true),
('CBSE','8','math','math',10,'Exponents and Powers','missing',true),
('CBSE','8','math','math',11,'Direct and Inverse Proportions','missing',true),
('CBSE','8','math','math',12,'Factorisation','missing',true),
('CBSE','8','math','math',13,'Introduction to Graphs','missing',true),
('CBSE','8','math','math',14,'Playing with Numbers','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 9 — MATH (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','9','math','math',1,'Number Systems','missing',true),
('CBSE','9','math','math',2,'Polynomials','missing',true),
('CBSE','9','math','math',3,'Coordinate Geometry','missing',true),
('CBSE','9','math','math',4,'Linear Equations in Two Variables','missing',true),
('CBSE','9','math','math',5,'Introduction to Euclid''s Geometry','missing',true),
('CBSE','9','math','math',6,'Lines and Angles','missing',true),
('CBSE','9','math','math',7,'Triangles','missing',true),
('CBSE','9','math','math',8,'Quadrilaterals','missing',true),
('CBSE','9','math','math',9,'Circles','missing',true),
('CBSE','9','math','math',10,'Heron''s Formula','missing',true),
('CBSE','9','math','math',11,'Surface Areas and Volumes','missing',true),
('CBSE','9','math','math',12,'Statistics','missing',true),
('CBSE','9','math','math',13,'Probability','missing',true),
('CBSE','9','math','math',14,'Areas of Parallelograms and Triangles','missing',true),
('CBSE','9','math','math',15,'Constructions','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 10 — MATH (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','10','math','math',1,'Real Numbers','missing',true),
('CBSE','10','math','math',2,'Polynomials','missing',true),
('CBSE','10','math','math',3,'Pair of Linear Equations in Two Variables','missing',true),
('CBSE','10','math','math',4,'Quadratic Equations','missing',true),
('CBSE','10','math','math',5,'Arithmetic Progressions','missing',true),
('CBSE','10','math','math',6,'Triangles','missing',true),
('CBSE','10','math','math',7,'Coordinate Geometry','missing',true),
('CBSE','10','math','math',8,'Introduction to Trigonometry','missing',true),
('CBSE','10','math','math',9,'Some Applications of Trigonometry','missing',true),
('CBSE','10','math','math',10,'Circles','missing',true),
('CBSE','10','math','math',11,'Areas Related to Circles','missing',true),
('CBSE','10','math','math',12,'Surface Areas and Volumes','missing',true),
('CBSE','10','math','math',13,'Statistics','missing',true),
('CBSE','10','math','math',14,'Probability','missing',true),
('CBSE','10','math','math',15,'Constructions','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — MATH (16 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','math','math',1,'Sets','missing',true),
('CBSE','11','math','math',2,'Relations and Functions','missing',true),
('CBSE','11','math','math',3,'Trigonometric Functions','missing',true),
('CBSE','11','math','math',4,'Complex Numbers and Quadratic Equations','missing',true),
('CBSE','11','math','math',5,'Linear Inequalities','missing',true),
('CBSE','11','math','math',6,'Permutations and Combinations','missing',true),
('CBSE','11','math','math',7,'Binomial Theorem','missing',true),
('CBSE','11','math','math',8,'Sequences and Series','missing',true),
('CBSE','11','math','math',9,'Straight Lines','missing',true),
('CBSE','11','math','math',10,'Conic Sections','missing',true),
('CBSE','11','math','math',11,'Introduction to Three Dimensional Geometry','missing',true),
('CBSE','11','math','math',12,'Limits and Derivatives','missing',true),
('CBSE','11','math','math',13,'Statistics','missing',true),
('CBSE','11','math','math',14,'Probability','missing',true),
('CBSE','11','math','math',15,'Mathematical Reasoning','missing',true),
('CBSE','11','math','math',16,'Principle of Mathematical Induction','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — MATH (13 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','math','math',1,'Relations and Functions','missing',true),
('CBSE','12','math','math',2,'Inverse Trigonometric Functions','missing',true),
('CBSE','12','math','math',3,'Matrices','missing',true),
('CBSE','12','math','math',4,'Determinants','missing',true),
('CBSE','12','math','math',5,'Continuity and Differentiability','missing',true),
('CBSE','12','math','math',6,'Application of Derivatives','missing',true),
('CBSE','12','math','math',7,'Integrals','missing',true),
('CBSE','12','math','math',8,'Application of Integrals','missing',true),
('CBSE','12','math','math',9,'Differential Equations','missing',true),
('CBSE','12','math','math',10,'Vector Algebra','missing',true),
('CBSE','12','math','math',11,'Three Dimensional Geometry','missing',true),
('CBSE','12','math','math',12,'Linear Programming','missing',true),
('CBSE','12','math','math',13,'Probability','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 6 — SCIENCE (Curiosity 2024, 15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','6','science','science',1,'The Wonderful World of Science','missing',true),
('CBSE','6','science','science',2,'Diversity in the Living World','missing',true),
('CBSE','6','science','science',3,'Mindful Eating: A Path to a Healthy Body','missing',true),
('CBSE','6','science','science',4,'Exploring Magnets','missing',true),
('CBSE','6','science','science',5,'Measurement of Length and Motion','missing',true),
('CBSE','6','science','science',6,'Materials Around Us','missing',true),
('CBSE','6','science','science',7,'Temperature and Its Measurement','missing',true),
('CBSE','6','science','science',8,'A Journey Through States of Matter','missing',true),
('CBSE','6','science','science',9,'Methods of Separation in Everyday Life','missing',true),
('CBSE','6','science','science',10,'Living Creatures: Exploring Their Characteristics','missing',true),
('CBSE','6','science','science',11,'Nature''s Treasures','missing',true),
('CBSE','6','science','science',12,'Beyond Earth','missing',true),
('CBSE','6','science','science',13,'Shadows and Reflections','missing',true),
('CBSE','6','science','science',14,'Electric Circuits: A Beginning','missing',true),
('CBSE','6','science','science',15,'Plants: The Nature''s Wonders','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 7 — SCIENCE (Curiosity 2025, 18 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','7','science','science',1,'Nutrition in Plants','missing',true),
('CBSE','7','science','science',2,'Nutrition in Animals','missing',true),
('CBSE','7','science','science',3,'Heat and Temperature','missing',true),
('CBSE','7','science','science',4,'Acids, Bases and Salts','missing',true),
('CBSE','7','science','science',5,'Physical and Chemical Changes','missing',true),
('CBSE','7','science','science',6,'Respiration in Organisms','missing',true),
('CBSE','7','science','science',7,'Transportation in Animals and Plants','missing',true),
('CBSE','7','science','science',8,'Reproduction in Plants','missing',true),
('CBSE','7','science','science',9,'Motion and Time','missing',true),
('CBSE','7','science','science',10,'Electric Current and Its Effects','missing',true),
('CBSE','7','science','science',11,'Light','missing',true),
('CBSE','7','science','science',12,'Forests: Our Lifeline','missing',true),
('CBSE','7','science','science',13,'Wastewater Story','missing',true),
('CBSE','7','science','science',14,'Soil','missing',true),
('CBSE','7','science','science',15,'Fibre to Fabric','missing',true),
('CBSE','7','science','science',16,'Weather, Climate and Adaptations of Animals to Climate','missing',true),
('CBSE','7','science','science',17,'Water: A Precious Resource','missing',true),
('CBSE','7','science','science',18,'Winds, Storms and Cyclones','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 8 — SCIENCE (18 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','8','science','science',1,'Crop Production and Management','missing',true),
('CBSE','8','science','science',2,'Microorganisms: Friend and Foe','missing',true),
('CBSE','8','science','science',3,'Synthetic Fibres and Plastics','missing',true),
('CBSE','8','science','science',4,'Materials: Metals and Non-Metals','missing',true),
('CBSE','8','science','science',5,'Coal and Petroleum','missing',true),
('CBSE','8','science','science',6,'Combustion and Flame','missing',true),
('CBSE','8','science','science',7,'Conservation of Plants and Animals','missing',true),
('CBSE','8','science','science',8,'Cell: Structure and Functions','missing',true),
('CBSE','8','science','science',9,'Reproduction in Animals','missing',true),
('CBSE','8','science','science',10,'Reaching the Age of Adolescence','missing',true),
('CBSE','8','science','science',11,'Force and Pressure','missing',true),
('CBSE','8','science','science',12,'Friction','missing',true),
('CBSE','8','science','science',13,'Sound','missing',true),
('CBSE','8','science','science',14,'Chemical Effects of Electric Current','missing',true),
('CBSE','8','science','science',15,'Some Natural Phenomena','missing',true),
('CBSE','8','science','science',16,'Light','missing',true),
('CBSE','8','science','science',17,'Stars and the Solar System','missing',true),
('CBSE','8','science','science',18,'Pollution of Air and Water','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 9 — SCIENCE (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','9','science','science',1,'Matter in Our Surroundings','missing',true),
('CBSE','9','science','science',2,'Is Matter Around Us Pure','missing',true),
('CBSE','9','science','science',3,'Atoms and Molecules','missing',true),
('CBSE','9','science','science',4,'Structure of the Atom','missing',true),
('CBSE','9','science','science',5,'The Fundamental Unit of Life','missing',true),
('CBSE','9','science','science',6,'Tissues','missing',true),
('CBSE','9','science','science',7,'Motion','missing',true),
('CBSE','9','science','science',8,'Force and Laws of Motion','missing',true),
('CBSE','9','science','science',9,'Gravitation','missing',true),
('CBSE','9','science','science',10,'Work and Energy','missing',true),
('CBSE','9','science','science',11,'Sound','missing',true),
('CBSE','9','science','science',12,'Improvement in Food Resources','missing',true),
('CBSE','9','science','science',13,'Why Do We Fall Ill','missing',true),
('CBSE','9','science','science',14,'Natural Resources','missing',true),
('CBSE','9','science','science',15,'Diversity in Living Organisms','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 10 — SCIENCE (16 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','10','science','science',1,'Chemical Reactions and Equations','missing',true),
('CBSE','10','science','science',2,'Acids, Bases and Salts','missing',true),
('CBSE','10','science','science',3,'Metals and Non-metals','missing',true),
('CBSE','10','science','science',4,'Carbon and Its Compounds','missing',true),
('CBSE','10','science','science',5,'Periodic Classification of Elements','missing',true),
('CBSE','10','science','science',6,'Life Processes','missing',true),
('CBSE','10','science','science',7,'Control and Coordination','missing',true),
('CBSE','10','science','science',8,'How Do Organisms Reproduce','missing',true),
('CBSE','10','science','science',9,'Heredity and Evolution','missing',true),
('CBSE','10','science','science',10,'Light: Reflection and Refraction','missing',true),
('CBSE','10','science','science',11,'The Human Eye and the Colourful World','missing',true),
('CBSE','10','science','science',12,'Electricity','missing',true),
('CBSE','10','science','science',13,'Magnetic Effects of Electric Current','missing',true),
('CBSE','10','science','science',14,'Sources of Energy','missing',true),
('CBSE','10','science','science',15,'Our Environment','missing',true),
('CBSE','10','science','science',16,'Sustainable Management of Natural Resources','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 6 — ENGLISH (Honeysuckle, 10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','6','english','english',1,'Who Did Patrick''s Homework?','missing',true),
('CBSE','6','english','english',2,'How the Dog Found Himself a New Master!','missing',true),
('CBSE','6','english','english',3,'Taro''s Reward','missing',true),
('CBSE','6','english','english',4,'An Indian-American Woman in Space: Kalpana Chawla','missing',true),
('CBSE','6','english','english',5,'A Different Kind of School','missing',true),
('CBSE','6','english','english',6,'Who I Am','missing',true),
('CBSE','6','english','english',7,'Fair Play','missing',true),
('CBSE','6','english','english',8,'A Game of Chance','missing',true),
('CBSE','6','english','english',9,'Desert Animals','missing',true),
('CBSE','6','english','english',10,'The Banyan Tree','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 7 — ENGLISH (Honeycomb, 10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','7','english','english',1,'Three Questions','missing',true),
('CBSE','7','english','english',2,'A Gift of Chappals','missing',true),
('CBSE','7','english','english',3,'Gopal and the Hilsa Fish','missing',true),
('CBSE','7','english','english',4,'The Ashes That Made Trees Bloom','missing',true),
('CBSE','7','english','english',5,'Quality','missing',true),
('CBSE','7','english','english',6,'Expert Detectives','missing',true),
('CBSE','7','english','english',7,'The Invention of Vita-Wonk','missing',true),
('CBSE','7','english','english',8,'Fire: Friend and Foe','missing',true),
('CBSE','7','english','english',9,'A Bicycle in Good Repair','missing',true),
('CBSE','7','english','english',10,'The Story of Cricket','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 8 — ENGLISH (Honeydew, 10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','8','english','english',1,'The Best Christmas Present in the World','missing',true),
('CBSE','8','english','english',2,'The Tsunami','missing',true),
('CBSE','8','english','english',3,'Glimpses of the Past','missing',true),
('CBSE','8','english','english',4,'Bepin Choudhury''s Lapse of Memory','missing',true),
('CBSE','8','english','english',5,'The Summit Within','missing',true),
('CBSE','8','english','english',6,'This Is Jody''s Fawn','missing',true),
('CBSE','8','english','english',7,'A Visit to Cambridge','missing',true),
('CBSE','8','english','english',8,'A Short Monsoon Diary','missing',true),
('CBSE','8','english','english',9,'The Great Stone Face I','missing',true),
('CBSE','8','english','english',10,'The Great Stone Face II','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 9 — ENGLISH (Beehive, 11 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','9','english','english',1,'The Fun They Had','missing',true),
('CBSE','9','english','english',2,'The Sound of Music','missing',true),
('CBSE','9','english','english',3,'The Little Girl','missing',true),
('CBSE','9','english','english',4,'A Truly Beautiful Mind','missing',true),
('CBSE','9','english','english',5,'The Snake and the Mirror','missing',true),
('CBSE','9','english','english',6,'My Childhood','missing',true),
('CBSE','9','english','english',7,'Packing','missing',true),
('CBSE','9','english','english',8,'Reach for the Top','missing',true),
('CBSE','9','english','english',9,'The Bond of Love','missing',true),
('CBSE','9','english','english',10,'Kathmandu','missing',true),
('CBSE','9','english','english',11,'If I Were You','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 10 — ENGLISH (First Flight, 11 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','10','english','english',1,'A Letter to God','missing',true),
('CBSE','10','english','english',2,'Nelson Mandela: Long Walk to Freedom','missing',true),
('CBSE','10','english','english',3,'Two Stories About Flying','missing',true),
('CBSE','10','english','english',4,'From the Diary of Anne Frank','missing',true),
('CBSE','10','english','english',5,'The Hundred Dresses I','missing',true),
('CBSE','10','english','english',6,'The Hundred Dresses II','missing',true),
('CBSE','10','english','english',7,'Glimpses of India','missing',true),
('CBSE','10','english','english',8,'Mijbil the Otter','missing',true),
('CBSE','10','english','english',9,'Madam Rides the Bus','missing',true),
('CBSE','10','english','english',10,'The Sermon at Benares','missing',true),
('CBSE','10','english','english',11,'The Proposal','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — ENGLISH (Hornbill + Snapshots, 10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','english','english',1,'The Portrait of a Lady','missing',true),
('CBSE','11','english','english',2,'We''re Not Afraid to Die… if We Can All Be Together','missing',true),
('CBSE','11','english','english',3,'Discovering Tut: the Saga Continues','missing',true),
('CBSE','11','english','english',4,'Landscape of the Soul','missing',true),
('CBSE','11','english','english',5,'The Ailing Planet: the Green Movement''s Role','missing',true),
('CBSE','11','english','english',6,'The Browning Version','missing',true),
('CBSE','11','english','english',7,'The Adventure','missing',true),
('CBSE','11','english','english',8,'Silk Road','missing',true),
('CBSE','11','english','english',9,'The Summer of the Beautiful White Horse (Snapshots)','missing',true),
('CBSE','11','english','english',10,'The Address (Snapshots)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — ENGLISH (Flamingo + Vistas, 10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','english','english',1,'The Last Lesson','missing',true),
('CBSE','12','english','english',2,'Lost Spring','missing',true),
('CBSE','12','english','english',3,'Deep Water','missing',true),
('CBSE','12','english','english',4,'The Rattrap','missing',true),
('CBSE','12','english','english',5,'Indigo','missing',true),
('CBSE','12','english','english',6,'Poets and Pancakes','missing',true),
('CBSE','12','english','english',7,'The Interview','missing',true),
('CBSE','12','english','english',8,'Going Places','missing',true),
('CBSE','12','english','english',9,'The Tiger King (Vistas)','missing',true),
('CBSE','12','english','english',10,'Journey to the End of the Earth (Vistas)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 6 — HINDI (Vasant Bhag 1, 17 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','6','hindi','hindi',1,'वह चिड़िया जो','missing',true),
('CBSE','6','hindi','hindi',2,'बचपन','missing',true),
('CBSE','6','hindi','hindi',3,'नादान दोस्त','missing',true),
('CBSE','6','hindi','hindi',4,'चाँद से थोड़ी सी गप्पें','missing',true),
('CBSE','6','hindi','hindi',5,'अक्षरों का महत्व','missing',true),
('CBSE','6','hindi','hindi',6,'पार नज़र के','missing',true),
('CBSE','6','hindi','hindi',7,'साथी हाथ बढ़ाना','missing',true),
('CBSE','6','hindi','hindi',8,'ऐसे-ऐसे','missing',true),
('CBSE','6','hindi','hindi',9,'टिकट एलबम','missing',true),
('CBSE','6','hindi','hindi',10,'झाँसी की रानी','missing',true),
('CBSE','6','hindi','hindi',11,'जो देखकर भी नहीं देखते','missing',true),
('CBSE','6','hindi','hindi',12,'संसार पुस्तक है','missing',true),
('CBSE','6','hindi','hindi',13,'मैं सबसे छोटी होऊं','missing',true),
('CBSE','6','hindi','hindi',14,'लोकगीत','missing',true),
('CBSE','6','hindi','hindi',15,'नौकर','missing',true),
('CBSE','6','hindi','hindi',16,'वन के मार्ग में','missing',true),
('CBSE','6','hindi','hindi',17,'साँस-साँस में बाँस','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 7 — HINDI (Vasant Bhag 2, 15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','7','hindi','hindi',1,'हम पंछी उन्मुक्त गगन के','missing',true),
('CBSE','7','hindi','hindi',2,'दादी माँ','missing',true),
('CBSE','7','hindi','hindi',3,'हिमालय की बेटियाँ','missing',true),
('CBSE','7','hindi','hindi',4,'कठपुतली','missing',true),
('CBSE','7','hindi','hindi',5,'मीठाईवाला','missing',true),
('CBSE','7','hindi','hindi',6,'रक्त और हमारा शरीर','missing',true),
('CBSE','7','hindi','hindi',7,'पापा खो गए','missing',true),
('CBSE','7','hindi','hindi',8,'शाम - एक किसान','missing',true),
('CBSE','7','hindi','hindi',9,'चिड़िया की बच्ची','missing',true),
('CBSE','7','hindi','hindi',10,'अपूर्व अनुभव','missing',true),
('CBSE','7','hindi','hindi',11,'रहीम के दोहे','missing',true),
('CBSE','7','hindi','hindi',12,'कंचा','missing',true),
('CBSE','7','hindi','hindi',13,'एक तिनका','missing',true),
('CBSE','7','hindi','hindi',14,'खानपान की बदलती तस्वीर','missing',true),
('CBSE','7','hindi','hindi',15,'नीलकंठ','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 8 — HINDI (Vasant Bhag 3, 17 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','8','hindi','hindi',1,'ध्वनि','missing',true),
('CBSE','8','hindi','hindi',2,'लाख की चूड़ियाँ','missing',true),
('CBSE','8','hindi','hindi',3,'बस की यात्रा','missing',true),
('CBSE','8','hindi','hindi',4,'दीवानों की हस्ती','missing',true),
('CBSE','8','hindi','hindi',5,'चिट्ठियों की अनूठी दुनिया','missing',true),
('CBSE','8','hindi','hindi',6,'भगवान के डाकिए','missing',true),
('CBSE','8','hindi','hindi',7,'क्या निराश हुआ जाए','missing',true),
('CBSE','8','hindi','hindi',8,'यह सबसे कठिन समय नहीं','missing',true),
('CBSE','8','hindi','hindi',9,'कबीर की साखियाँ','missing',true),
('CBSE','8','hindi','hindi',10,'कामचोर','missing',true),
('CBSE','8','hindi','hindi',11,'जब सिनेमा ने बोलना सीखा','missing',true),
('CBSE','8','hindi','hindi',12,'सुदामा चरित','missing',true),
('CBSE','8','hindi','hindi',13,'जहाँ पहिया है','missing',true),
('CBSE','8','hindi','hindi',14,'अकबरी लोटा','missing',true),
('CBSE','8','hindi','hindi',15,'सूर के पद','missing',true),
('CBSE','8','hindi','hindi',16,'पानी की कहानी','missing',true),
('CBSE','8','hindi','hindi',17,'बाज और साँप','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 9 — HINDI (Kshitij Bhag 1 + Sparsh + Sanchayan, 18 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','9','hindi','hindi',1,'दो बैलों की कथा (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',2,'ल्हासा की ओर (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',3,'उपभोक्तावाद की संस्कृति (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',4,'साँवले सपनों की याद (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',5,'नाना साहब की पुत्री देवी मैना को भस्म कर दिया गया (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',6,'प्रेमचंद के फटे जूते (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',7,'मेरे बचपन के दिन (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',8,'एक कुत्ता और एक मैना (Kshitij)','missing',true),
('CBSE','9','hindi','hindi',9,'साखियाँ एवं सबद (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',10,'वाख (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',11,'सवैये (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',12,'कैदी और कोकिला (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',13,'ग्राम श्री (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',14,'चंद्र गहना से लौटती बेर (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',15,'मेघ आए (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',16,'यमराज की दिशा (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',17,'बच्चे काम पर जा रहे हैं (Kshitij Kavya)','missing',true),
('CBSE','9','hindi','hindi',18,'दुःख का अधिकार (Sparsh)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 10 — HINDI (Kshitij Bhag 2 + Sparsh + Sanchayan, 18 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','10','hindi','hindi',1,'सूरदास के पद (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',2,'राम-लक्ष्मण-परशुराम संवाद (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',3,'देव के सवैये और कवित्त (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',4,'आत्मकथ्य (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',5,'उत्साह और अट नहीं रही (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',6,'यह दंतुरहित मुस्कान और फसल (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',7,'छाया मत छूना (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',8,'कन्यादान (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',9,'संगतकार (Kshitij)','missing',true),
('CBSE','10','hindi','hindi',10,'नेताजी का चश्मा (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',11,'बालगोबिन भगत (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',12,'लखनवी अंदाज़ (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',13,'मानवीय करुणा की दिव्या चमक (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',14,'एक कहानी यह भी (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',15,'स्त्री शिक्षा के विरोधी कुतर्कों का खंडन (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',16,'नौबतखाने में इबादत (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',17,'संस्कृति (Kshitij Gadya)','missing',true),
('CBSE','10','hindi','hindi',18,'माता का अँचल (Sparsh)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 6 — SOCIAL STUDIES (Exploring Society: India and Beyond, 9 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','6','social_studies','social_studies',1,'Locating Places on Earth','missing',true),
('CBSE','6','social_studies','social_studies',2,'Globe and Maps','missing',true),
('CBSE','6','social_studies','social_studies',3,'Landforms and Life','missing',true),
('CBSE','6','social_studies','social_studies',4,'When, Where and How','missing',true),
('CBSE','6','social_studies','social_studies',5,'India, That Is Bharat','missing',true),
('CBSE','6','social_studies','social_studies',6,'The Beginnings of Indian Civilisation','missing',true),
('CBSE','6','social_studies','social_studies',7,'India''s Cultural Roots','missing',true),
('CBSE','6','social_studies','social_studies',8,'Unity in Diversity: States and Union Territories','missing',true),
('CBSE','6','social_studies','social_studies',9,'Urban Livelihoods','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 7 — SOCIAL STUDIES (9 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','7','social_studies','social_studies',1,'Tracing Changes Through a Thousand Years','missing',true),
('CBSE','7','social_studies','social_studies',2,'New Kings and Kingdoms','missing',true),
('CBSE','7','social_studies','social_studies',3,'The Delhi Sultans','missing',true),
('CBSE','7','social_studies','social_studies',4,'The Mughal Empire','missing',true),
('CBSE','7','social_studies','social_studies',5,'Environment','missing',true),
('CBSE','7','social_studies','social_studies',6,'Inside Our Earth','missing',true),
('CBSE','7','social_studies','social_studies',7,'Our Changing Earth','missing',true),
('CBSE','7','social_studies','social_studies',8,'On Equality','missing',true),
('CBSE','7','social_studies','social_studies',9,'Role of the Government in Health','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 8 — SOCIAL STUDIES (History/Geography/Civics/Economics combined, 28 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
-- History: Our Pasts III (10 chapters)
('CBSE','8','social_studies','social_studies',1,'How, When and Where (History)','missing',true),
('CBSE','8','social_studies','social_studies',2,'From Trade to Territory: The Company Establishes Power (History)','missing',true),
('CBSE','8','social_studies','social_studies',3,'Ruling the Countryside (History)','missing',true),
('CBSE','8','social_studies','social_studies',4,'Tribals, Dikus and the Vision of a Golden Age (History)','missing',true),
('CBSE','8','social_studies','social_studies',5,'When People Rebel: 1857 and After (History)','missing',true),
('CBSE','8','social_studies','social_studies',6,'Weavers, Iron Smelters and Factory Owners (History)','missing',true),
('CBSE','8','social_studies','social_studies',7,'Civilising the "Native", Educating the Nation (History)','missing',true),
('CBSE','8','social_studies','social_studies',8,'Women, Caste and Reform (History)','missing',true),
('CBSE','8','social_studies','social_studies',9,'The Making of the National Movement: 1870s–1947 (History)','missing',true),
('CBSE','8','social_studies','social_studies',10,'India After Independence (History)','missing',true),
-- Geography: Resources and Development (6 chapters)
('CBSE','8','social_studies','social_studies',11,'Resources (Geography)','missing',true),
('CBSE','8','social_studies','social_studies',12,'Land, Soil, Water, Natural Vegetation and Wildlife Resources (Geography)','missing',true),
('CBSE','8','social_studies','social_studies',13,'Mineral and Power Resources (Geography)','missing',true),
('CBSE','8','social_studies','social_studies',14,'Agriculture (Geography)','missing',true),
('CBSE','8','social_studies','social_studies',15,'Industries (Geography)','missing',true),
('CBSE','8','social_studies','social_studies',16,'Human Resources (Geography)','missing',true),
-- Civics: Social and Political Life III (9 chapters)
('CBSE','8','social_studies','social_studies',17,'The Indian Constitution (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',18,'Understanding Secularism (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',19,'Why Do We Need a Parliament? (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',20,'Understanding Laws (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',21,'Judiciary (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',22,'Understanding Our Criminal Justice System (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',23,'Understanding Marginalisation (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',24,'Confronting Marginalisation (Civics)','missing',true),
('CBSE','8','social_studies','social_studies',25,'Public Facilities (Civics)','missing',true),
-- Economics: Social and Economic Life (3 chapters)
('CBSE','8','social_studies','social_studies',26,'The Story of Village Palampur (Economics)','missing',true),
('CBSE','8','social_studies','social_studies',27,'People as Resource (Economics)','missing',true),
('CBSE','8','social_studies','social_studies',28,'Poverty as a Challenge (Economics)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 9 — SOCIAL STUDIES (27 chapters across 4 books)
-- ═══════════════════════════════════════════════════════════════════════════
-- History: India and the Contemporary World I (5 chapters)
('CBSE','9','social_studies','social_studies',1,'The French Revolution (History)','missing',true),
('CBSE','9','social_studies','social_studies',2,'Socialism in Europe and the Russian Revolution (History)','missing',true),
('CBSE','9','social_studies','social_studies',3,'Nazism and the Rise of Hitler (History)','missing',true),
('CBSE','9','social_studies','social_studies',4,'Forest Society and Colonialism (History)','missing',true),
('CBSE','9','social_studies','social_studies',5,'Pastoralists in the Modern World (History)','missing',true),
-- Geography: Contemporary India I (6 chapters)
('CBSE','9','social_studies','social_studies',6,'India: Size and Location (Geography)','missing',true),
('CBSE','9','social_studies','social_studies',7,'Physical Features of India (Geography)','missing',true),
('CBSE','9','social_studies','social_studies',8,'Drainage (Geography)','missing',true),
('CBSE','9','social_studies','social_studies',9,'Climate (Geography)','missing',true),
('CBSE','9','social_studies','social_studies',10,'Natural Vegetation and Wildlife (Geography)','missing',true),
('CBSE','9','social_studies','social_studies',11,'Population (Geography)','missing',true),
-- Civics: Democratic Politics I (5 chapters)
('CBSE','9','social_studies','social_studies',12,'What is Democracy? Why Democracy? (Civics)','missing',true),
('CBSE','9','social_studies','social_studies',13,'Constitutional Design (Civics)','missing',true),
('CBSE','9','social_studies','social_studies',14,'Electoral Politics (Civics)','missing',true),
('CBSE','9','social_studies','social_studies',15,'Working of Institutions (Civics)','missing',true),
('CBSE','9','social_studies','social_studies',16,'Democratic Rights (Civics)','missing',true),
-- Economics: Understanding Economic Development I (5 chapters)
('CBSE','9','social_studies','social_studies',17,'The Story of Village Palampur (Economics)','missing',true),
('CBSE','9','social_studies','social_studies',18,'People as Resource (Economics)','missing',true),
('CBSE','9','social_studies','social_studies',19,'Poverty as a Challenge (Economics)','missing',true),
('CBSE','9','social_studies','social_studies',20,'Food Security in India (Economics)','missing',true),
-- Disaster Management (5 chapters — integrated)
('CBSE','9','social_studies','social_studies',21,'A Disaster: Tsunami (Disaster Mgmt)','missing',true),
('CBSE','9','social_studies','social_studies',22,'Safe Construction Practices (Disaster Mgmt)','missing',true),
('CBSE','9','social_studies','social_studies',23,'Survival Skills (Disaster Mgmt)','missing',true),
('CBSE','9','social_studies','social_studies',24,'Alternate Communication Systems (Disaster Mgmt)','missing',true),
('CBSE','9','social_studies','social_studies',25,'Community Based Disaster Management (Disaster Mgmt)','missing',true),
-- Additional chapters to reach 27
('CBSE','9','social_studies','social_studies',26,'Clothing: A Social History (History)','missing',true),
('CBSE','9','social_studies','social_studies',27,'Peasants and Farmers (History)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 10 — SOCIAL STUDIES (26 chapters across 4 books)
-- ═══════════════════════════════════════════════════════════════════════════
-- History: India and the Contemporary World II (5 chapters)
('CBSE','10','social_studies','social_studies',1,'The Rise of Nationalism in Europe (History)','missing',true),
('CBSE','10','social_studies','social_studies',2,'Nationalism in India (History)','missing',true),
('CBSE','10','social_studies','social_studies',3,'The Making of a Global World (History)','missing',true),
('CBSE','10','social_studies','social_studies',4,'The Age of Industrialisation (History)','missing',true),
('CBSE','10','social_studies','social_studies',5,'Print Culture and the Modern World (History)','missing',true),
-- Geography: Contemporary India II (7 chapters)
('CBSE','10','social_studies','social_studies',6,'Resources and Development (Geography)','missing',true),
('CBSE','10','social_studies','social_studies',7,'Forest and Wildlife Resources (Geography)','missing',true),
('CBSE','10','social_studies','social_studies',8,'Water Resources (Geography)','missing',true),
('CBSE','10','social_studies','social_studies',9,'Agriculture (Geography)','missing',true),
('CBSE','10','social_studies','social_studies',10,'Minerals and Energy Resources (Geography)','missing',true),
('CBSE','10','social_studies','social_studies',11,'Manufacturing Industries (Geography)','missing',true),
('CBSE','10','social_studies','social_studies',12,'Lifelines of National Economy (Geography)','missing',true),
-- Civics: Democratic Politics II (8 chapters)
('CBSE','10','social_studies','social_studies',13,'Power Sharing (Civics)','missing',true),
('CBSE','10','social_studies','social_studies',14,'Federalism (Civics)','missing',true),
('CBSE','10','social_studies','social_studies',15,'Gender, Religion and Caste (Civics)','missing',true),
('CBSE','10','social_studies','social_studies',16,'Political Parties (Civics)','missing',true),
('CBSE','10','social_studies','social_studies',17,'Outcomes of Democracy (Civics)','missing',true),
('CBSE','10','social_studies','social_studies',18,'Challenges to Democracy (Civics)','missing',true),
-- Economics: Understanding Economic Development II (5 chapters)
('CBSE','10','social_studies','social_studies',19,'Development (Economics)','missing',true),
('CBSE','10','social_studies','social_studies',20,'Sectors of the Indian Economy (Economics)','missing',true),
('CBSE','10','social_studies','social_studies',21,'Money and Credit (Economics)','missing',true),
('CBSE','10','social_studies','social_studies',22,'Globalisation and the Indian Economy (Economics)','missing',true),
('CBSE','10','social_studies','social_studies',23,'Consumer Rights (Economics)','missing',true),
-- Disaster Management (3 chapters)
('CBSE','10','social_studies','social_studies',24,'Hazards: Types and Consequences (Disaster Mgmt)','missing',true),
('CBSE','10','social_studies','social_studies',25,'National Disaster Management Framework (Disaster Mgmt)','missing',true),
('CBSE','10','social_studies','social_studies',26,'School Safety Plan (Disaster Mgmt)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 6 — CODING (8 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','6','coding','coding',1,'Introduction to Computers','missing',true),
('CBSE','6','coding','coding',2,'Introduction to Scratch','missing',true),
('CBSE','6','coding','coding',3,'Sequences and Loops','missing',true),
('CBSE','6','coding','coding',4,'Conditionals','missing',true),
('CBSE','6','coding','coding',5,'Functions and Events','missing',true),
('CBSE','6','coding','coding',6,'Introduction to Python','missing',true),
('CBSE','6','coding','coding',7,'Working with Data','missing',true),
('CBSE','6','coding','coding',8,'Problem Solving and Algorithms','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 7 — CODING (9 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','7','coding','coding',1,'Digital Literacy and Internet Safety','missing',true),
('CBSE','7','coding','coding',2,'Advanced Scratch Programming','missing',true),
('CBSE','7','coding','coding',3,'Python Basics: Variables and Data Types','missing',true),
('CBSE','7','coding','coding',4,'Python: Control Structures','missing',true),
('CBSE','7','coding','coding',5,'Python: Functions','missing',true),
('CBSE','7','coding','coding',6,'Python: Lists and Strings','missing',true),
('CBSE','7','coding','coding',7,'Introduction to Web Design (HTML)','missing',true),
('CBSE','7','coding','coding',8,'Introduction to Databases','missing',true),
('CBSE','7','coding','coding',9,'Computational Thinking and Problem Solving','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 8 — CODING (10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','8','coding','coding',1,'Cybersecurity Fundamentals','missing',true),
('CBSE','8','coding','coding',2,'Python: Object-Oriented Concepts','missing',true),
('CBSE','8','coding','coding',3,'Python: File Handling','missing',true),
('CBSE','8','coding','coding',4,'Web Development: CSS and JavaScript Basics','missing',true),
('CBSE','8','coding','coding',5,'Spreadsheets and Data Analysis','missing',true),
('CBSE','8','coding','coding',6,'Introduction to Artificial Intelligence','missing',true),
('CBSE','8','coding','coding',7,'Working with APIs','missing',true),
('CBSE','8','coding','coding',8,'Introduction to App Development','missing',true),
('CBSE','8','coding','coding',9,'Robotics and IoT Basics','missing',true),
('CBSE','8','coding','coding',10,'Project: Solve a Real-World Problem','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 9 — COMPUTER SCIENCE (12 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','9','computer_science','computer_science',1,'Computer System','missing',true),
('CBSE','9','computer_science','computer_science',2,'Number System','missing',true),
('CBSE','9','computer_science','computer_science',3,'Emerging Trends','missing',true),
('CBSE','9','computer_science','computer_science',4,'Problem Solving','missing',true),
('CBSE','9','computer_science','computer_science',5,'Introduction to Python','missing',true),
('CBSE','9','computer_science','computer_science',6,'Flow of Control','missing',true),
('CBSE','9','computer_science','computer_science',7,'Functions','missing',true),
('CBSE','9','computer_science','computer_science',8,'Strings','missing',true),
('CBSE','9','computer_science','computer_science',9,'List and Tuples','missing',true),
('CBSE','9','computer_science','computer_science',10,'Dictionary and Sets','missing',true),
('CBSE','9','computer_science','computer_science',11,'Societal Impacts','missing',true),
('CBSE','9','computer_science','computer_science',12,'Cyber Safety and Ethics','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 10 — COMPUTER SCIENCE (12 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','10','computer_science','computer_science',1,'Computer Networks','missing',true),
('CBSE','10','computer_science','computer_science',2,'Database Concepts','missing',true),
('CBSE','10','computer_science','computer_science',3,'Structured Query Language (SQL)','missing',true),
('CBSE','10','computer_science','computer_science',4,'Advanced Python: Sorting and Searching','missing',true),
('CBSE','10','computer_science','computer_science',5,'Exception Handling and File Handling','missing',true),
('CBSE','10','computer_science','computer_science',6,'Stack','missing',true),
('CBSE','10','computer_science','computer_science',7,'Queue','missing',true),
('CBSE','10','computer_science','computer_science',8,'Interface of Python with SQL','missing',true),
('CBSE','10','computer_science','computer_science',9,'Cybersecurity and Ethics','missing',true),
('CBSE','10','computer_science','computer_science',10,'Open Source Concepts','missing',true),
('CBSE','10','computer_science','computer_science',11,'Python Libraries for Data Science','missing',true),
('CBSE','10','computer_science','computer_science',12,'Project Work and Case Studies','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — COMPUTER SCIENCE (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','computer_science','computer_science',1,'Computer Systems','missing',true),
('CBSE','11','computer_science','computer_science',2,'Encoding Schemes and Number System','missing',true),
('CBSE','11','computer_science','computer_science',3,'Emerging Trends','missing',true),
('CBSE','11','computer_science','computer_science',4,'Introduction to Problem Solving','missing',true),
('CBSE','11','computer_science','computer_science',5,'Getting Started with Python','missing',true),
('CBSE','11','computer_science','computer_science',6,'Flow of Control','missing',true),
('CBSE','11','computer_science','computer_science',7,'Functions','missing',true),
('CBSE','11','computer_science','computer_science',8,'Strings','missing',true),
('CBSE','11','computer_science','computer_science',9,'Lists','missing',true),
('CBSE','11','computer_science','computer_science',10,'Tuples and Dictionaries','missing',true),
('CBSE','11','computer_science','computer_science',11,'Sorting','missing',true),
('CBSE','11','computer_science','computer_science',12,'Exception Handling and File I/O','missing',true),
('CBSE','11','computer_science','computer_science',13,'Stack','missing',true),
('CBSE','11','computer_science','computer_science',14,'Societal Impacts and Digital Footprints','missing',true),
('CBSE','11','computer_science','computer_science',15,'Introduction to Artificial Intelligence','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — COMPUTER SCIENCE (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','computer_science','computer_science',1,'Python Revision Tour I','missing',true),
('CBSE','12','computer_science','computer_science',2,'Python Revision Tour II','missing',true),
('CBSE','12','computer_science','computer_science',3,'Working with Functions','missing',true),
('CBSE','12','computer_science','computer_science',4,'Using Python Libraries','missing',true),
('CBSE','12','computer_science','computer_science',5,'File Handling','missing',true),
('CBSE','12','computer_science','computer_science',6,'Database Management','missing',true),
('CBSE','12','computer_science','computer_science',7,'Structured Query Language (SQL)','missing',true),
('CBSE','12','computer_science','computer_science',8,'Interface of Python with SQL','missing',true),
('CBSE','12','computer_science','computer_science',9,'Computer Networks','missing',true),
('CBSE','12','computer_science','computer_science',10,'Cybersecurity and Legal Issues','missing',true),
('CBSE','12','computer_science','computer_science',11,'Data Communication and Network Devices','missing',true),
('CBSE','12','computer_science','computer_science',12,'Security Aspects','missing',true),
('CBSE','12','computer_science','computer_science',13,'Recursion','missing',true),
('CBSE','12','computer_science','computer_science',14,'Queue','missing',true),
('CBSE','12','computer_science','computer_science',15,'Project Work','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — PHYSICS (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','physics','physics',1,'Physical World','missing',true),
('CBSE','11','physics','physics',2,'Units and Measurements','missing',true),
('CBSE','11','physics','physics',3,'Motion in a Straight Line','missing',true),
('CBSE','11','physics','physics',4,'Motion in a Plane','missing',true),
('CBSE','11','physics','physics',5,'Laws of Motion','missing',true),
('CBSE','11','physics','physics',6,'Work, Energy and Power','missing',true),
('CBSE','11','physics','physics',7,'System of Particles and Rotational Motion','missing',true),
('CBSE','11','physics','physics',8,'Gravitation','missing',true),
('CBSE','11','physics','physics',9,'Mechanical Properties of Solids','missing',true),
('CBSE','11','physics','physics',10,'Mechanical Properties of Fluids','missing',true),
('CBSE','11','physics','physics',11,'Thermal Properties of Matter','missing',true),
('CBSE','11','physics','physics',12,'Thermodynamics','missing',true),
('CBSE','11','physics','physics',13,'Kinetic Theory','missing',true),
('CBSE','11','physics','physics',14,'Oscillations','missing',true),
('CBSE','11','physics','physics',15,'Waves','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — PHYSICS (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','physics','physics',1,'Electric Charges and Fields','missing',true),
('CBSE','12','physics','physics',2,'Electrostatic Potential and Capacitance','missing',true),
('CBSE','12','physics','physics',3,'Current Electricity','missing',true),
('CBSE','12','physics','physics',4,'Moving Charges and Magnetism','missing',true),
('CBSE','12','physics','physics',5,'Magnetism and Matter','missing',true),
('CBSE','12','physics','physics',6,'Electromagnetic Induction','missing',true),
('CBSE','12','physics','physics',7,'Alternating Current','missing',true),
('CBSE','12','physics','physics',8,'Electromagnetic Waves','missing',true),
('CBSE','12','physics','physics',9,'Ray Optics and Optical Instruments','missing',true),
('CBSE','12','physics','physics',10,'Wave Optics','missing',true),
('CBSE','12','physics','physics',11,'Dual Nature of Radiation and Matter','missing',true),
('CBSE','12','physics','physics',12,'Atoms','missing',true),
('CBSE','12','physics','physics',13,'Nuclei','missing',true),
('CBSE','12','physics','physics',14,'Semiconductor Electronics: Materials, Devices and Simple Circuits','missing',true),
('CBSE','12','physics','physics',15,'Communication Systems','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — CHEMISTRY (14 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','chemistry','chemistry',1,'Some Basic Concepts of Chemistry','missing',true),
('CBSE','11','chemistry','chemistry',2,'Structure of Atom','missing',true),
('CBSE','11','chemistry','chemistry',3,'Classification of Elements and Periodicity in Properties','missing',true),
('CBSE','11','chemistry','chemistry',4,'Chemical Bonding and Molecular Structure','missing',true),
('CBSE','11','chemistry','chemistry',5,'Thermodynamics','missing',true),
('CBSE','11','chemistry','chemistry',6,'Equilibrium','missing',true),
('CBSE','11','chemistry','chemistry',7,'Redox Reactions','missing',true),
('CBSE','11','chemistry','chemistry',8,'Organic Chemistry: Some Basic Principles and Techniques','missing',true),
('CBSE','11','chemistry','chemistry',9,'Hydrocarbons','missing',true),
('CBSE','11','chemistry','chemistry',10,'The s-Block Elements','missing',true),
('CBSE','11','chemistry','chemistry',11,'The p-Block Elements (Groups 13 and 14)','missing',true),
('CBSE','11','chemistry','chemistry',12,'Environmental Chemistry','missing',true),
('CBSE','11','chemistry','chemistry',13,'States of Matter','missing',true),
('CBSE','11','chemistry','chemistry',14,'Hydrogen','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — CHEMISTRY (16 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','chemistry','chemistry',1,'The Solid State','missing',true),
('CBSE','12','chemistry','chemistry',2,'Solutions','missing',true),
('CBSE','12','chemistry','chemistry',3,'Electrochemistry','missing',true),
('CBSE','12','chemistry','chemistry',4,'Chemical Kinetics','missing',true),
('CBSE','12','chemistry','chemistry',5,'Surface Chemistry','missing',true),
('CBSE','12','chemistry','chemistry',6,'General Principles and Processes of Isolation of Elements','missing',true),
('CBSE','12','chemistry','chemistry',7,'The p-Block Elements','missing',true),
('CBSE','12','chemistry','chemistry',8,'The d and f Block Elements','missing',true),
('CBSE','12','chemistry','chemistry',9,'Coordination Compounds','missing',true),
('CBSE','12','chemistry','chemistry',10,'Haloalkanes and Haloarenes','missing',true),
('CBSE','12','chemistry','chemistry',11,'Alcohols, Phenols and Ethers','missing',true),
('CBSE','12','chemistry','chemistry',12,'Aldehydes, Ketones and Carboxylic Acids','missing',true),
('CBSE','12','chemistry','chemistry',13,'Amines','missing',true),
('CBSE','12','chemistry','chemistry',14,'Biomolecules','missing',true),
('CBSE','12','chemistry','chemistry',15,'Polymers','missing',true),
('CBSE','12','chemistry','chemistry',16,'Chemistry in Everyday Life','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — BIOLOGY (22 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','biology','biology',1,'The Living World','missing',true),
('CBSE','11','biology','biology',2,'Biological Classification','missing',true),
('CBSE','11','biology','biology',3,'Plant Kingdom','missing',true),
('CBSE','11','biology','biology',4,'Animal Kingdom','missing',true),
('CBSE','11','biology','biology',5,'Morphology of Flowering Plants','missing',true),
('CBSE','11','biology','biology',6,'Anatomy of Flowering Plants','missing',true),
('CBSE','11','biology','biology',7,'Structural Organisation in Animals','missing',true),
('CBSE','11','biology','biology',8,'Cell: The Unit of Life','missing',true),
('CBSE','11','biology','biology',9,'Biomolecules','missing',true),
('CBSE','11','biology','biology',10,'Cell Cycle and Cell Division','missing',true),
('CBSE','11','biology','biology',11,'Photosynthesis in Higher Plants','missing',true),
('CBSE','11','biology','biology',12,'Respiration in Plants','missing',true),
('CBSE','11','biology','biology',13,'Plant Growth and Development','missing',true),
('CBSE','11','biology','biology',14,'Breathing and Exchange of Gases','missing',true),
('CBSE','11','biology','biology',15,'Body Fluids and Circulation','missing',true),
('CBSE','11','biology','biology',16,'Excretory Products and Their Elimination','missing',true),
('CBSE','11','biology','biology',17,'Locomotion and Movement','missing',true),
('CBSE','11','biology','biology',18,'Neural Control and Coordination','missing',true),
('CBSE','11','biology','biology',19,'Chemical Coordination and Integration','missing',true),
('CBSE','11','biology','biology',20,'Transport in Plants','missing',true),
('CBSE','11','biology','biology',21,'Mineral Nutrition','missing',true),
('CBSE','11','biology','biology',22,'Digestion and Absorption','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — BIOLOGY (16 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','biology','biology',1,'Sexual Reproduction in Flowering Plants','missing',true),
('CBSE','12','biology','biology',2,'Human Reproduction','missing',true),
('CBSE','12','biology','biology',3,'Reproductive Health','missing',true),
('CBSE','12','biology','biology',4,'Principles of Inheritance and Variation','missing',true),
('CBSE','12','biology','biology',5,'Molecular Basis of Inheritance','missing',true),
('CBSE','12','biology','biology',6,'Evolution','missing',true),
('CBSE','12','biology','biology',7,'Human Health and Disease','missing',true),
('CBSE','12','biology','biology',8,'Microbes in Human Welfare','missing',true),
('CBSE','12','biology','biology',9,'Biotechnology: Principles and Processes','missing',true),
('CBSE','12','biology','biology',10,'Biotechnology and Its Applications','missing',true),
('CBSE','12','biology','biology',11,'Organisms and Populations','missing',true),
('CBSE','12','biology','biology',12,'Ecosystem','missing',true),
('CBSE','12','biology','biology',13,'Biodiversity and Conservation','missing',true),
('CBSE','12','biology','biology',14,'Environmental Issues','missing',true),
('CBSE','12','biology','biology',15,'Strategies for Enhancement in Food Production','missing',true),
('CBSE','12','biology','biology',16,'Genetics and Genomics (Emerging Trends)','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — ECONOMICS (Indian Economic Development + Statistics, 20 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
-- Part A: Statistics for Economics (9 chapters)
('CBSE','11','economics','economics',1,'Introduction to Statistics','missing',true),
('CBSE','11','economics','economics',2,'Collection of Data','missing',true),
('CBSE','11','economics','economics',3,'Organisation of Data','missing',true),
('CBSE','11','economics','economics',4,'Presentation of Data','missing',true),
('CBSE','11','economics','economics',5,'Measures of Central Tendency','missing',true),
('CBSE','11','economics','economics',6,'Measures of Dispersion','missing',true),
('CBSE','11','economics','economics',7,'Correlation','missing',true),
('CBSE','11','economics','economics',8,'Index Numbers','missing',true),
('CBSE','11','economics','economics',9,'Use of Statistical Tools','missing',true),
-- Part B: Indian Economic Development (11 chapters)
('CBSE','11','economics','economics',10,'Indian Economy on the Eve of Independence','missing',true),
('CBSE','11','economics','economics',11,'Indian Economy 1950-1990','missing',true),
('CBSE','11','economics','economics',12,'Liberalisation, Privatisation and Globalisation','missing',true),
('CBSE','11','economics','economics',13,'Poverty','missing',true),
('CBSE','11','economics','economics',14,'Human Capital Formation in India','missing',true),
('CBSE','11','economics','economics',15,'Rural Development','missing',true),
('CBSE','11','economics','economics',16,'Employment: Growth, Informalisation and Other Issues','missing',true),
('CBSE','11','economics','economics',17,'Infrastructure','missing',true),
('CBSE','11','economics','economics',18,'Environment and Sustainable Development','missing',true),
('CBSE','11','economics','economics',19,'Comparative Development Experiences of India with Its Neighbours','missing',true),
('CBSE','11','economics','economics',20,'Economic Development Experiences of India: A Comparison with China and Pakistan','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — ECONOMICS (Introductory Macro + Micro, 14 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
-- Part A: Introductory Microeconomics (7 chapters)
('CBSE','12','economics','economics',1,'Introduction to Microeconomics','missing',true),
('CBSE','12','economics','economics',2,'Consumer Equilibrium and Demand','missing',true),
('CBSE','12','economics','economics',3,'Producer Behaviour and Supply','missing',true),
('CBSE','12','economics','economics',4,'Forms of Market and Price Determination','missing',true),
('CBSE','12','economics','economics',5,'Market Equilibrium','missing',true),
('CBSE','12','economics','economics',6,'Non-Competitive Markets','missing',true),
('CBSE','12','economics','economics',7,'Government Intervention in Markets','missing',true),
-- Part B: Introductory Macroeconomics (7 chapters)
('CBSE','12','economics','economics',8,'Introduction to Macroeconomics and National Income Accounting','missing',true),
('CBSE','12','economics','economics',9,'Money and Banking','missing',true),
('CBSE','12','economics','economics',10,'Determination of Income and Employment','missing',true),
('CBSE','12','economics','economics',11,'Government Budget and the Economy','missing',true),
('CBSE','12','economics','economics',12,'Open Economy Macroeconomics: Balance of Payments','missing',true),
('CBSE','12','economics','economics',13,'Foreign Exchange Rate','missing',true),
('CBSE','12','economics','economics',14,'Economic Policies and Their Impacts','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — ACCOUNTANCY (Financial Accounting Parts I & II, 15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','accountancy','accountancy',1,'Introduction to Accounting','missing',true),
('CBSE','11','accountancy','accountancy',2,'Theory Base of Accounting','missing',true),
('CBSE','11','accountancy','accountancy',3,'Recording of Transactions I','missing',true),
('CBSE','11','accountancy','accountancy',4,'Recording of Transactions II','missing',true),
('CBSE','11','accountancy','accountancy',5,'Bank Reconciliation Statement','missing',true),
('CBSE','11','accountancy','accountancy',6,'Trial Balance and Rectification of Errors','missing',true),
('CBSE','11','accountancy','accountancy',7,'Depreciation, Provisions and Reserves','missing',true),
('CBSE','11','accountancy','accountancy',8,'Bill of Exchange','missing',true),
('CBSE','11','accountancy','accountancy',9,'Financial Statements I','missing',true),
('CBSE','11','accountancy','accountancy',10,'Financial Statements II','missing',true),
('CBSE','11','accountancy','accountancy',11,'Accounts from Incomplete Records','missing',true),
('CBSE','11','accountancy','accountancy',12,'Applications of Computers in Accounting','missing',true),
('CBSE','11','accountancy','accountancy',13,'Computerised Accounting System','missing',true),
('CBSE','11','accountancy','accountancy',14,'Structuring Database for Accounting','missing',true),
('CBSE','11','accountancy','accountancy',15,'Accounting Software Package: Tally','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — ACCOUNTANCY (10 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','accountancy','accountancy',1,'Accounting for Partnership: Basic Concepts','missing',true),
('CBSE','12','accountancy','accountancy',2,'Reconstitution of Partnership Firm: Admission of a Partner','missing',true),
('CBSE','12','accountancy','accountancy',3,'Reconstitution of Partnership Firm: Retirement and Death of a Partner','missing',true),
('CBSE','12','accountancy','accountancy',4,'Dissolution of Partnership Firm','missing',true),
('CBSE','12','accountancy','accountancy',5,'Accounting for Share Capital','missing',true),
('CBSE','12','accountancy','accountancy',6,'Issue and Redemption of Debentures','missing',true),
('CBSE','12','accountancy','accountancy',7,'Financial Statements of a Company','missing',true),
('CBSE','12','accountancy','accountancy',8,'Analysis of Financial Statements','missing',true),
('CBSE','12','accountancy','accountancy',9,'Accounting Ratios','missing',true),
('CBSE','12','accountancy','accountancy',10,'Cash Flow Statement','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — BUSINESS STUDIES (12 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','11','business_studies','business_studies',1,'Nature and Purpose of Business','missing',true),
('CBSE','11','business_studies','business_studies',2,'Forms of Business Organisation','missing',true),
('CBSE','11','business_studies','business_studies',3,'Public, Private and Global Enterprises','missing',true),
('CBSE','11','business_studies','business_studies',4,'Business Services','missing',true),
('CBSE','11','business_studies','business_studies',5,'Emerging Modes of Business','missing',true),
('CBSE','11','business_studies','business_studies',6,'Social Responsibilities of Business and Business Ethics','missing',true),
('CBSE','11','business_studies','business_studies',7,'Formation of a Company','missing',true),
('CBSE','11','business_studies','business_studies',8,'Sources of Business Finance','missing',true),
('CBSE','11','business_studies','business_studies',9,'Small Business and Entrepreneurship','missing',true),
('CBSE','11','business_studies','business_studies',10,'Internal Trade','missing',true),
('CBSE','11','business_studies','business_studies',11,'International Business I','missing',true),
('CBSE','11','business_studies','business_studies',12,'International Business II','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — BUSINESS STUDIES (12 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','business_studies','business_studies',1,'Nature and Significance of Management','missing',true),
('CBSE','12','business_studies','business_studies',2,'Principles of Management','missing',true),
('CBSE','12','business_studies','business_studies',3,'Business Environment','missing',true),
('CBSE','12','business_studies','business_studies',4,'Planning','missing',true),
('CBSE','12','business_studies','business_studies',5,'Organising','missing',true),
('CBSE','12','business_studies','business_studies',6,'Staffing','missing',true),
('CBSE','12','business_studies','business_studies',7,'Directing','missing',true),
('CBSE','12','business_studies','business_studies',8,'Controlling','missing',true),
('CBSE','12','business_studies','business_studies',9,'Financial Management','missing',true),
('CBSE','12','business_studies','business_studies',10,'Financial Markets','missing',true),
('CBSE','12','business_studies','business_studies',11,'Marketing Management','missing',true),
('CBSE','12','business_studies','business_studies',12,'Consumer Protection','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — POLITICAL SCIENCE (20 chapters, 2 books)
-- ═══════════════════════════════════════════════════════════════════════════
-- Book 1: Political Theory (10 chapters)
('CBSE','11','political_science','political_science',1,'Political Theory: An Introduction','missing',true),
('CBSE','11','political_science','political_science',2,'Freedom','missing',true),
('CBSE','11','political_science','political_science',3,'Equality','missing',true),
('CBSE','11','political_science','political_science',4,'Social Justice','missing',true),
('CBSE','11','political_science','political_science',5,'Rights','missing',true),
('CBSE','11','political_science','political_science',6,'Citizenship','missing',true),
('CBSE','11','political_science','political_science',7,'Nationalism','missing',true),
('CBSE','11','political_science','political_science',8,'Secularism','missing',true),
('CBSE','11','political_science','political_science',9,'Peace','missing',true),
('CBSE','11','political_science','political_science',10,'Development','missing',true),
-- Book 2: Indian Constitution at Work (10 chapters)
('CBSE','11','political_science','political_science',11,'Constitution: Why and How?','missing',true),
('CBSE','11','political_science','political_science',12,'Rights in the Indian Constitution','missing',true),
('CBSE','11','political_science','political_science',13,'Election and Representation','missing',true),
('CBSE','11','political_science','political_science',14,'Executive','missing',true),
('CBSE','11','political_science','political_science',15,'Legislature','missing',true),
('CBSE','11','political_science','political_science',16,'Judiciary','missing',true),
('CBSE','11','political_science','political_science',17,'Federalism','missing',true),
('CBSE','11','political_science','political_science',18,'Local Governments','missing',true),
('CBSE','11','political_science','political_science',19,'Constitution as a Living Document','missing',true),
('CBSE','11','political_science','political_science',20,'The Philosophy of the Constitution','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — POLITICAL SCIENCE (20 chapters, 2 books)
-- ═══════════════════════════════════════════════════════════════════════════
-- Book 1: Contemporary World Politics (9 chapters)
('CBSE','12','political_science','political_science',1,'The Cold War Era','missing',true),
('CBSE','12','political_science','political_science',2,'The End of Bipolarity','missing',true),
('CBSE','12','political_science','political_science',3,'US Hegemony in World Politics','missing',true),
('CBSE','12','political_science','political_science',4,'Alternative Centres of Power','missing',true),
('CBSE','12','political_science','political_science',5,'Contemporary South Asia','missing',true),
('CBSE','12','political_science','political_science',6,'International Organisations','missing',true),
('CBSE','12','political_science','political_science',7,'Security in the Contemporary World','missing',true),
('CBSE','12','political_science','political_science',8,'Environment and Natural Resources','missing',true),
('CBSE','12','political_science','political_science',9,'Globalisation','missing',true),
-- Book 2: Politics in India since Independence (9 chapters)
('CBSE','12','political_science','political_science',10,'Challenges of Nation Building','missing',true),
('CBSE','12','political_science','political_science',11,'Era of One-Party Dominance','missing',true),
('CBSE','12','political_science','political_science',12,'Politics of Planned Development','missing',true),
('CBSE','12','political_science','political_science',13,'India''s External Relations','missing',true),
('CBSE','12','political_science','political_science',14,'Challenges to and Restoration of the Congress System','missing',true),
('CBSE','12','political_science','political_science',15,'The Crisis of Democratic Order','missing',true),
('CBSE','12','political_science','political_science',16,'Rise of Popular Movements','missing',true),
('CBSE','12','political_science','political_science',17,'Regional Aspirations','missing',true),
('CBSE','12','political_science','political_science',18,'Recent Developments in Indian Politics','missing',true),
-- Supplementary chapters to reach 20
('CBSE','12','political_science','political_science',19,'Party System and Political Parties in India','missing',true),
('CBSE','12','political_science','political_science',20,'Democratic Participation and Political Culture','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — HISTORY (history_sr) — Themes in World History (11 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
-- NOTE: All chapters start as 'missing'. Ch 8 (Confrontation of Cultures, which
-- includes French Revolution context) is the chapter most likely absent from the
-- RAG corpus; its 'missing' status will trigger the abstain mechanism correctly.
('CBSE','11','history_sr','history_sr',1,'From the Beginning of Time','missing',true),
('CBSE','11','history_sr','history_sr',2,'Writing and City Life','missing',true),
('CBSE','11','history_sr','history_sr',3,'An Empire Across Three Continents','missing',true),
('CBSE','11','history_sr','history_sr',4,'The Central Islamic Lands','missing',true),
('CBSE','11','history_sr','history_sr',5,'Nomadic Empires','missing',true),
('CBSE','11','history_sr','history_sr',6,'Three Ways of Being the World','missing',true),
('CBSE','11','history_sr','history_sr',7,'Changing Cultural Traditions','missing',true),
('CBSE','11','history_sr','history_sr',8,'Confrontation of Cultures','missing',true),
('CBSE','11','history_sr','history_sr',9,'The Industrial Revolution','missing',true),
('CBSE','11','history_sr','history_sr',10,'Displacing Indigenous Peoples','missing',true),
('CBSE','11','history_sr','history_sr',11,'Paths to Modernisation','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — HISTORY (history_sr) — Themes in Indian History Parts I-III (15 chapters)
-- ═══════════════════════════════════════════════════════════════════════════
('CBSE','12','history_sr','history_sr',1,'Bricks, Beads and Bones: The Harappan Civilisation','missing',true),
('CBSE','12','history_sr','history_sr',2,'Kings, Farmers and Towns: Early States and Economies','missing',true),
('CBSE','12','history_sr','history_sr',3,'Kinship, Caste and Class: Early Societies','missing',true),
('CBSE','12','history_sr','history_sr',4,'Thinkers, Beliefs and Buildings: Cultural Developments','missing',true),
('CBSE','12','history_sr','history_sr',5,'Through the Eyes of Travellers: Perceptions of Society','missing',true),
('CBSE','12','history_sr','history_sr',6,'Bhakti-Sufi Traditions: Changes in Religious Beliefs and Devotional Texts','missing',true),
('CBSE','12','history_sr','history_sr',7,'An Imperial Capital: Vijayanagara','missing',true),
('CBSE','12','history_sr','history_sr',8,'Peasants, Zamindars and the State: Agrarian Society and the Mughal Empire','missing',true),
('CBSE','12','history_sr','history_sr',9,'Kings and Chronicles: The Mughal Courts','missing',true),
('CBSE','12','history_sr','history_sr',10,'Colonialism and the Countryside: Exploring Official Archives','missing',true),
('CBSE','12','history_sr','history_sr',11,'Rebels and the Raj: The Revolt of 1857 and Its Representations','missing',true),
('CBSE','12','history_sr','history_sr',12,'Colonial Cities: Urbanisation, Planning and Architecture','missing',true),
('CBSE','12','history_sr','history_sr',13,'Mahatma Gandhi and the Nationalist Movement: Civil Disobedience and Beyond','missing',true),
('CBSE','12','history_sr','history_sr',14,'Understanding Partition: Politics, Memories, Experiences','missing',true),
('CBSE','12','history_sr','history_sr',15,'Framing the Constitution: The Beginning of a New Era','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 11 — GEOGRAPHY (24 chapters, 2 books)
-- ═══════════════════════════════════════════════════════════════════════════
-- Book 1: Fundamentals of Physical Geography (16 chapters)
('CBSE','11','geography','geography',1,'Geography as a Discipline','missing',true),
('CBSE','11','geography','geography',2,'The Origin and Evolution of the Earth','missing',true),
('CBSE','11','geography','geography',3,'Interior of the Earth','missing',true),
('CBSE','11','geography','geography',4,'Distribution of Oceans and Continents','missing',true),
('CBSE','11','geography','geography',5,'Minerals and Rocks','missing',true),
('CBSE','11','geography','geography',6,'Geomorphic Processes','missing',true),
('CBSE','11','geography','geography',7,'Landforms and Their Evolution','missing',true),
('CBSE','11','geography','geography',8,'Composition and Structure of Atmosphere','missing',true),
('CBSE','11','geography','geography',9,'Solar Radiation, Heat Balance and Temperature','missing',true),
('CBSE','11','geography','geography',10,'Atmospheric Circulation and Weather Systems','missing',true),
('CBSE','11','geography','geography',11,'Water in the Atmosphere','missing',true),
('CBSE','11','geography','geography',12,'World Climate and Climate Change','missing',true),
('CBSE','11','geography','geography',13,'Water (Oceans)','missing',true),
('CBSE','11','geography','geography',14,'Movements of Ocean Water','missing',true),
('CBSE','11','geography','geography',15,'Life on the Earth','missing',true),
('CBSE','11','geography','geography',16,'Biodiversity and Conservation','missing',true),
-- Book 2: India: Physical Environment (8 chapters)
('CBSE','11','geography','geography',17,'India: Location','missing',true),
('CBSE','11','geography','geography',18,'Structure and Physiography','missing',true),
('CBSE','11','geography','geography',19,'Drainage System','missing',true),
('CBSE','11','geography','geography',20,'Climate','missing',true),
('CBSE','11','geography','geography',21,'Natural Vegetation','missing',true),
('CBSE','11','geography','geography',22,'Soils','missing',true),
('CBSE','11','geography','geography',23,'Natural Hazards and Disasters','missing',true),
('CBSE','11','geography','geography',24,'Map Skills and Practical Work','missing',true),

-- ═══════════════════════════════════════════════════════════════════════════
-- GRADE 12 — GEOGRAPHY (23 chapters, 2 books)
-- ═══════════════════════════════════════════════════════════════════════════
-- Book 1: Fundamentals of Human Geography (12 chapters)
('CBSE','12','geography','geography',1,'Human Geography: Nature and Scope','missing',true),
('CBSE','12','geography','geography',2,'The World Population: Distribution, Density and Growth','missing',true),
('CBSE','12','geography','geography',3,'Population Composition','missing',true),
('CBSE','12','geography','geography',4,'Human Development','missing',true),
('CBSE','12','geography','geography',5,'Primary Activities','missing',true),
('CBSE','12','geography','geography',6,'Secondary Activities','missing',true),
('CBSE','12','geography','geography',7,'Tertiary and Quaternary Activities','missing',true),
('CBSE','12','geography','geography',8,'Transport and Communication','missing',true),
('CBSE','12','geography','geography',9,'International Trade','missing',true),
('CBSE','12','geography','geography',10,'Human Settlements','missing',true),
('CBSE','12','geography','geography',11,'Migration: Types, Causes and Consequences','missing',true),
('CBSE','12','geography','geography',12,'Land Resources and Agriculture','missing',true),
-- Book 2: India: People and Economy (11 chapters)
('CBSE','12','geography','geography',13,'Population: Distribution, Density, Growth and Composition (India)','missing',true),
('CBSE','12','geography','geography',14,'Migration: Types, Causes and Consequences (India)','missing',true),
('CBSE','12','geography','geography',15,'Human Development (India)','missing',true),
('CBSE','12','geography','geography',16,'Human Settlements (India)','missing',true),
('CBSE','12','geography','geography',17,'Land Resources and Agriculture (India)','missing',true),
('CBSE','12','geography','geography',18,'Water Resources (India)','missing',true),
('CBSE','12','geography','geography',19,'Mineral and Energy Resources (India)','missing',true),
('CBSE','12','geography','geography',20,'Manufacturing Industries (India)','missing',true),
('CBSE','12','geography','geography',21,'Planning and Sustainable Development in Indian Context','missing',true),
('CBSE','12','geography','geography',22,'Transport and Communication (India)','missing',true),
('CBSE','12','geography','geography',23,'International Trade (India)','missing',true)

ON CONFLICT (board, grade, subject_code, chapter_number) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Post-seed: trigger recompute_subject_content_readiness_daily if available.
-- Non-fatal: skipped on environments where the helper does not yet exist.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  PERFORM public.recompute_subject_content_readiness_daily();
EXCEPTION
  WHEN others THEN
    NULL; -- function absent or errored; non-fatal
END;
$$;

-- Verification (run manually after applying this migration):
-- SELECT grade, subject_code, COUNT(*) AS chapter_count
-- FROM cbse_syllabus
-- WHERE board = 'CBSE'
-- GROUP BY grade, subject_code
-- ORDER BY grade::int, subject_code;
--
-- Expected totals per subject (approximate):
--   math:              6+7+8+9+10+11+12 = 14+15+14+15+15+16+13 = 102
--   science:           6+7+8+9+10       = 15+18+18+15+16       =  82
--   english:           6..12            = 10+10+10+11+11+10+10 =  72
--   hindi:             6..10            = 17+15+17+18+18        =  85
--   social_studies:    6..10            = 9+9+28+27+26          =  99
--   coding:            6..8             = 8+9+10                =  27
--   computer_science:  9..12            = 12+12+15+15           =  54
--   physics:           11+12            = 15+15                 =  30
--   chemistry:         11+12            = 14+16                 =  30
--   biology:           11+12            = 22+16                 =  38
--   economics:         11+12            = 20+14                 =  34
--   accountancy:       11+12            = 15+10                 =  25
--   business_studies:  11+12            = 12+12                 =  24
--   political_science: 11+12            = 20+20                 =  40
--   history_sr:        11+12            = 11+15                 =  26
--   geography:         11+12            = 24+23                 =  47
--
-- Grand total: 102+82+72+85+99+27+54+30+30+38+34+25+24+40+26+47 = 815 rows
-- (subject to ON CONFLICT DO NOTHING skipping any rows already seeded)
