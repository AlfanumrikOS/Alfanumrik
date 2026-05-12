-- Migration: 20260512070624_backfill_g7_math_ch1_concepts_v2.sql
-- Purpose:    Backfill 6 publication-quality concepts for Grade 7 Math Chapter 1
--             ("Large Numbers Around Us" / Ganita Prakash) into `chapter_concepts`.
--             Companion to ff_chapter_reader_v2 — once the flag is on, the
--             learn page renders these curated rows instead of RAG chunks.
--
-- Phantom-timestamp reconcile (2026-05-12, post PR #749):
--   This file was originally committed as
--   supabase/migrations/20260512065503_backfill_g7_math_ch1_concepts.sql in
--   PR #749. The first MCP apply attempt hit a NOT NULL violation on the
--   chapter_id FK; the second attempt (named "..._v2") succeeded and prod's
--   schema_migrations now records version 20260512070624 + name
--   "backfill_g7_math_ch1_concepts_v2". Renamed here so the CLI sees an
--   exact local-vs-remote match.
--
-- Environment note: the UPDATE-by-id and INSERTs hardcode prod UUIDs
-- (d7c541b8-… for the existing concept row, ff1ac0e2-… for the chapter FK).
-- On staging/dev those ids don't exist so the INSERT will fail with an FK
-- violation — that's why `Sync Migrations to Staging` shows red. Staging
-- backfill is a separate ticket; do NOT rewrite this file to be
-- environment-agnostic, as that would re-apply different SQL to prod
-- where the data is already settled.
--
-- Pilot:      Grade 7 maths is the demo chapter the CEO screenshotted on
--             2026-05-12 (was rendering as raw textbook dump).
--
-- Approach:   UPDATE the single existing (mismatched) row and INSERT 5 new
--             rows for concept_numbers 2..6. The existing row had
--             title="Operations on Integers" — wrong chapter entirely; we
--             rewrite it as concept 1 of the real "Large Numbers" chapter.
--             We do NOT delete because FK refs from concept_mastery /
--             student_concept_state may exist; updating-in-place preserves
--             any historical pointers to that row.
--
-- Idempotency: Re-running this migration is safe. The UPDATE is keyed by the
--             well-known existing id; if a future run inserts the same five
--             concept_numbers a second time the page will display duplicates,
--             so do not re-run live. CI pipelines apply each migration once.
--
-- Spec: docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md

-- ── 0. Ensure the chapters.title_hi is populated ─────────────────────────
UPDATE public.chapters
SET title_hi = 'हमारे चारों ओर बड़ी संख्याएँ',
    quality_status = 'deck_ready_v2'
WHERE subject_code = 'math'
  AND grade = '7'
  AND chapter_number = 1;

-- ── 1. Rewrite the broken existing row (concept 1) ───────────────────────
UPDATE public.chapter_concepts
SET
  chapter_title = 'Large Numbers Around Us',
  concept_number = 1,
  title = 'What is a Lakh?',
  title_hi = 'एक लाख क्या है?',
  slug = 'what-is-a-lakh',
  learning_objective = 'Understand that 1 lakh = 1,00,000 and recognise lakhs as the next Indian place value after ten thousands.',
  learning_objective_hi = 'समझें कि 1 लाख = 1,00,000 और लाख दस-हज़ार के बाद का अगला भारतीय स्थानीय मान है।',
  explanation =
    'A lakh is the Indian unit for one hundred thousand. We write it as 1,00,000 — placing a comma after the leftmost digit and another two digits later. The character "lakh" expresses huge counts compactly: instead of saying "one hundred thousand rupees" we say "one lakh rupees". Lakhs appear constantly in everyday life — populations of small towns, prices of cars, total marks in board exams. The leap from 99,999 to 1,00,000 is one extra digit but a 10x larger quantity. Whether a lakh feels "big" or "small" depends on what you are counting.',
  explanation_hi =
    '"लाख" भारतीय गणना प्रणाली में एक सौ हज़ार के लिए शब्द है। हम इसे 1,00,000 लिखते हैं — सबसे बाएँ अंक के बाद एक अल्पविराम और फिर दो अंक के बाद दूसरा अल्पविराम। "एक लाख रुपए" कहना "एक सौ हज़ार रुपए" से सरल है। छोटे शहरों की जनसंख्या, गाड़ी की क़ीमत, और बोर्ड परीक्षा के कुल अंक — हर जगह लाख दिखता है। 99,999 से 1,00,000 तक एक अंक की छलाँग में मात्रा 10 गुना बढ़ जाती है।',
  example_content =
    'Roxie: "I had one lakh varieties of rice — that is a lot." Estu: "But the Ahmedabad cricket stadium seats more than a lakh people in a small area." Both are right — a lakh feels enormous when counting things you can hold, and small when measuring a packed crowd.',
  example_content_hi =
    'रॉक्सी: "मेरे पास एक लाख क़िस्म के चावल थे — यह बहुत है।" एस्तु: "पर अहमदाबाद के क्रिकेट स्टेडियम में एक लाख से अधिक लोग छोटी सी जगह में बैठते हैं।" दोनों सही हैं — संदर्भ के अनुसार लाख बड़ा या छोटा लग सकता है।',
  key_formula = '1 lakh = 1,00,000 = 10 × 10,000',
  practice_question = 'Which number is exactly one lakh?',
  practice_options = '["A) 10,000","B) 1,00,000","C) 10,00,000","D) 1,000"]'::jsonb,
  practice_correct_index = 1,
  practice_explanation = 'One lakh is written as 1,00,000 — a 1 followed by five zeros with a comma after the leading digit. (A) is ten thousand, (C) is ten lakh, (D) is one thousand.',
  difficulty = 1,
  bloom_level = 'understand',
  estimated_minutes = 4,
  is_active = true,
  updated_at = now()
WHERE id = 'd7c541b8-6746-4de7-bab5-626abae89a4b';

-- ── 2. Insert concepts 2..6 ──────────────────────────────────────────────
INSERT INTO public.chapter_concepts (
  grade, subject, chapter_number, chapter_title, concept_number,
  title, title_hi, slug,
  learning_objective, learning_objective_hi,
  explanation, explanation_hi,
  example_content, example_content_hi,
  key_formula,
  practice_question, practice_options, practice_correct_index, practice_explanation,
  difficulty, bloom_level, estimated_minutes,
  is_active, source, created_at, updated_at
) VALUES
-- Concept 2: Indian place value system
('7', 'math', 1, 'Large Numbers Around Us', 2,
 'The Indian Place Value System',
 'भारतीय स्थानीय मान प्रणाली',
 'indian-place-value-system',
 'Read and write numbers up to crores using the Indian place values: ones, tens, hundreds, thousands, ten-thousands, lakhs, ten-lakhs, crores.',
 'भारतीय स्थानीय मानों (इकाई, दहाई, सैकड़ा, हज़ार, दस-हज़ार, लाख, दस-लाख, करोड़) का उपयोग करके करोड़ तक की संख्याएँ पढ़ें और लिखें।',
 'The Indian system groups digits as 3-2-2 from the right: hundreds-tens-ones, then ten-thousands and thousands, then ten-lakhs and lakhs, then crores and ten-crores. Commas separate the groups, so 1,23,45,678 reads "one crore twenty-three lakh forty-five thousand six hundred seventy-eight". Each step left is 10x the previous. The pattern repeats: after every two digits, a new "level" begins — thousand → lakh → crore. This is why Indian-system commas are placed differently from the International system you may see online.',
 'भारतीय प्रणाली में अंकों को दाएँ से 3-2-2 के समूहों में रखा जाता है: सौ-दस-इकाई, फिर दस-हज़ार और हज़ार, फिर दस-लाख और लाख, फिर करोड़ और दस-करोड़। 1,23,45,678 को "एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर" पढ़ा जाता है। हर दो अंक के बाद नया स्तर शुरू होता है — हज़ार → लाख → करोड़।',
 'Write the number 1,23,45,678 in words. Reading from the leftmost comma: 1 → one crore. 23 → twenty-three lakh. 45 → forty-five thousand. 678 → six hundred seventy-eight. So: one crore twenty-three lakh forty-five thousand six hundred seventy-eight.',
 '1,23,45,678 को शब्दों में लिखें। बाएँ से पढ़ते हुए: 1 → एक करोड़, 23 → तेईस लाख, 45 → पैंतालीस हज़ार, 678 → छह सौ अठहत्तर। यानी: एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर।',
 '1 crore = 100 lakh = 1,00,00,000',
 'In the Indian system, how is 4567890 written with commas?',
 '["A) 4,567,890","B) 45,67,890","C) 456,7890","D) 4,5,67,890"]'::jsonb,
 1,
 'The Indian system groups digits 3-2-2 from the right: 890 (hundreds-tens-ones), 67 (thousands), 45 (lakhs). So 4567890 becomes 45,67,890 — "forty-five lakh sixty-seven thousand eight hundred ninety". (A) is the International system; (C) and (D) split incorrectly.',
 2, 'apply', 5,
 true, 'manual_backfill', now(), now()),

-- Concept 3: Reading 5-7 digit numbers
('7', 'math', 1, 'Large Numbers Around Us', 3,
 'Reading 5-7 Digit Numbers',
 '5-7 अंकों की संख्याएँ पढ़ना',
 'reading-5-7-digit-numbers',
 'Read aloud and write in words any 5, 6, or 7 digit number using the Indian place value system.',
 'भारतीय स्थानीय मान प्रणाली से 5, 6, या 7 अंकों की किसी भी संख्या को बोलकर पढ़ें और शब्दों में लिखें।',
 'To read a large number, first place the commas correctly: 3-2-2 from the right. Then read each group with its place name. A 5-digit number like 67,890 is "sixty-seven thousand eight hundred ninety". A 6-digit like 1,45,200 is "one lakh forty-five thousand two hundred". A 7-digit like 12,30,000 is "twelve lakh thirty thousand". Notice how the Indian system flows naturally for Indian-context quantities — populations, salaries, prices.',
 'बड़ी संख्या पढ़ने के लिए पहले अल्पविराम दाएँ से 3-2-2 क्रम में रखें। फिर हर समूह को उसके स्थान-नाम के साथ पढ़ें। 5 अंकों की 67,890 — "सड़सठ हज़ार आठ सौ नब्बे"। 6 अंकों की 1,45,200 — "एक लाख पैंतालीस हज़ार दो सौ"। 7 अंकों की 12,30,000 — "बारह लाख तीस हज़ार"।',
 'Read 5,04,085 in words. Group: 5,04,085 → 5 lakh, 04 thousand, 085. Words: "five lakh four thousand eighty-five". The zero in 04 thousand is silent — we don''t say "zero thousand". Same for the leading zero in 085, but the 85 itself is "eighty-five".',
 '5,04,085 को शब्दों में पढ़ें। समूह: 5 लाख, 04 हज़ार, 085। शब्द: "पाँच लाख चार हज़ार पचासी"। 04 का शून्य मौन है।',
 NULL,
 'Read the number 27,30,000 in words.',
 '["A) Two lakh seventy-three thousand","B) Twenty-seven lakh thirty thousand","C) Two crore seventy-three lakh","D) Twenty-seven thousand thirty"]'::jsonb,
 1,
 'Group 27,30,000 as 27 lakh + 30 thousand + 000 = twenty-seven lakh thirty thousand. (A) drops a digit, (C) over-reads the leftmost group as crore, (D) misreads it as thousands.',
 2, 'apply', 5,
 true, 'manual_backfill', now(), now()),

-- Concept 4: Comparing Large Numbers
('7', 'math', 1, 'Large Numbers Around Us', 4,
 'Comparing Large Numbers',
 'बड़ी संख्याओं की तुलना',
 'comparing-large-numbers',
 'Compare two large numbers by counting digits first, then comparing digit-by-digit from the left.',
 'दो बड़ी संख्याओं की तुलना करें — पहले अंकों की संख्या गिनें, फिर बाएँ से एक-एक अंक मिलाएँ।',
 'Comparing large numbers has two steps. STEP 1 — count the digits. The number with more digits is always larger; 1,00,000 > 99,999 because 6 digits > 5 digits. STEP 2 — if both have the same digit count, compare from the leftmost digit. 4,56,789 vs 4,55,999: same digit count (6); the lakh digit is 4 in both; the ten-thousand digit is 5 in both; the thousand digit is 6 vs 5 — so 4,56,789 is larger. You never need to compare every digit — stop as soon as one differs.',
 'बड़ी संख्याओं की तुलना दो चरणों में करें। चरण 1: अंकों की गिनती करें। अधिक अंक वाली संख्या हमेशा बड़ी होती है। 1,00,000 > 99,999 क्योंकि 6 अंक > 5 अंक। चरण 2: अगर अंक बराबर हैं, तो बाएँ से एक-एक अंक मिलाएँ। पहला अंतर तय करता है कौन बड़ी है।',
 'Which is larger: 8,40,000 or 8,39,999? Both have 6 digits. Leftmost digit: 8=8. Next: 4 vs 3 → 4 > 3, so 8,40,000 is larger. We don''t need to look at the last four digits.',
 'कौन बड़ी है: 8,40,000 या 8,39,999? दोनों में 6 अंक हैं। बाएँ से: 8=8, फिर 4 vs 3 → 4 > 3, इसलिए 8,40,000 बड़ी है। अंतिम चार अंकों को देखने की ज़रूरत नहीं।',
 NULL,
 'Which of these numbers is the largest?',
 '["A) 9,99,999","B) 10,00,000","C) 1,09,999","D) 9,99,099"]'::jsonb,
 1,
 'Count digits first: A=6, B=7, C=6, D=6. B has 7 digits — therefore largest. (B) is "ten lakh", just one more than (A) "nine lakh ninety-nine thousand nine hundred ninety-nine".',
 2, 'analyze', 5,
 true, 'manual_backfill', now(), now()),

-- Concept 5: International system
('7', 'math', 1, 'Large Numbers Around Us', 5,
 'The International System: Million and Billion',
 'अंतर्राष्ट्रीय प्रणाली: मिलियन और बिलियन',
 'international-system-million-billion',
 'Recognise the International (Million/Billion) system and convert between it and the Indian system.',
 'अंतर्राष्ट्रीय प्रणाली (मिलियन/बिलियन) को पहचानें और भारतीय प्रणाली के साथ रूपांतरण करें।',
 'The International system used in most of the world groups digits as 3-3-3 from the right: thousand → million → billion. 1 million = 10,00,000 in the Indian system = ten lakh. 1 billion = 1,00,00,00,000 = one hundred crore (or arab). Tech-company valuations, world population, and most global news use this system. You will see commas placed every three digits: 1,000,000 (one million) instead of 10,00,000. Both systems describe the SAME quantity — only the grouping differs. Practise switching mentally when you read about cricket-stadium attendance (lakhs) vs YouTube subscriber counts (millions).',
 'अंतर्राष्ट्रीय प्रणाली में अंकों को दाएँ से 3-3-3 के समूहों में रखा जाता है: हज़ार → मिलियन → बिलियन। 1 मिलियन = 10,00,000 = दस लाख। 1 बिलियन = 1,00,00,00,000 = सौ करोड़ (या अरब)। दोनों प्रणालियाँ एक ही मात्रा का वर्णन करती हैं — केवल समूह बनाने का तरीका अलग है। 1,000,000 (अंतर्राष्ट्रीय) और 10,00,000 (भारतीय) — मात्रा वही है।',
 'A YouTube channel has 5 million subscribers. How many is that in the Indian system? 5 million = 5 × 10,00,000 = 50,00,000 = fifty lakh. So 5 million subscribers = 50 lakh subscribers.',
 'एक यूट्यूब चैनल के 5 मिलियन सब्सक्राइबर हैं। भारतीय प्रणाली में कितने? 5 मिलियन = 5 × 10,00,000 = 50,00,000 = पचास लाख। यानी 5 मिलियन = 50 लाख सब्सक्राइबर।',
 '1 million = 10 lakh; 1 billion = 100 crore',
 'India''s population is about 1.4 billion. About how many crore is that?',
 '["A) 14 crore","B) 140 crore","C) 1,400 crore","D) 14,000 crore"]'::jsonb,
 1,
 '1 billion = 100 crore. So 1.4 billion = 1.4 × 100 = 140 crore. India crossing 140 crore (1.4 billion) was widely reported in 2023. (A) confuses million with crore; (C) and (D) over-multiply.',
 2, 'apply', 6,
 true, 'manual_backfill', now(), now()),

-- Concept 6: Estimation
('7', 'math', 1, 'Large Numbers Around Us', 6,
 'Estimating with Large Numbers',
 'बड़ी संख्याओं का अनुमान',
 'estimating-with-large-numbers',
 'Use rounding to estimate sums, differences, and products of large numbers without exact calculation.',
 'सटीक गणना के बिना बड़ी संख्याओं का जोड़, घटाव और गुणन का अनुमान लगाने के लिए राउंडिंग का प्रयोग करें।',
 'When numbers get large, exact arithmetic is slow and sometimes unnecessary. Estimation gives a "close enough" answer fast. The trick is to ROUND each number to a convenient nearby value before computing. 4,87,234 + 3,12,891 ≈ 5,00,000 + 3,00,000 = 8,00,000 (the real answer is 8,00,125 — our estimate was off by 125, or less than 0.02%). For multiplication, round both factors: 412 × 287 ≈ 400 × 300 = 1,20,000. Estimation is how engineers, scientists, and shopkeepers sanity-check exact answers — if your calculator says 412 × 287 = 12,000, you know it''s wrong without re-doing the math.',
 'बड़ी संख्याओं के साथ सटीक गणना धीमी और कई बार अनावश्यक होती है। अनुमान तेज़ और काफ़ी "क़रीबी" उत्तर देता है। हर संख्या को पास के सुविधाजनक मान पर राउंड करें फिर गणना करें। 4,87,234 + 3,12,891 ≈ 5,00,000 + 3,00,000 = 8,00,000 (असली उत्तर 8,00,125 — अंतर 0.02% से कम)। गुणन के लिए: 412 × 287 ≈ 400 × 300 = 1,20,000।',
 'A school has 4,860 students this year and 5,170 students next year. About how many in total? Round: 4,860 ≈ 5,000 and 5,170 ≈ 5,000. Estimate: 5,000 + 5,000 = 10,000 students. The exact answer is 10,030 — our estimate is 0.3% off, perfectly fine for planning chairs or buses.',
 'एक स्कूल में इस साल 4,860 छात्र और अगले साल 5,170 छात्र हैं। कुल लगभग कितने? राउंड: 4,860 ≈ 5,000 और 5,170 ≈ 5,000। अनुमान: 5,000 + 5,000 = 10,000 छात्र। असली उत्तर 10,030 — अनुमान 0.3% सटीक।',
 NULL,
 'Estimate 6,12,000 + 3,89,500 using rounding to the nearest lakh.',
 '["A) 9,00,000","B) 10,00,000","C) 11,00,000","D) 8,00,000"]'::jsonb,
 1,
 'Round each to the nearest lakh: 6,12,000 ≈ 6,00,000 (closer to 6 lakh than 7 lakh) and 3,89,500 ≈ 4,00,000 (closer to 4 lakh than 3 lakh). Estimate: 6,00,000 + 4,00,000 = 10,00,000 (ten lakh). The exact answer 10,01,500 confirms.',
 2, 'evaluate', 6,
 true, 'manual_backfill', now(), now());
