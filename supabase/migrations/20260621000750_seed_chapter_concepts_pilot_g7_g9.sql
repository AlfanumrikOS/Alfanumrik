-- Migration: 20260621000700_seed_chapter_concepts_pilot_g7_g9.sql
-- Purpose: PILOT — curated chapter_concepts rows for the Chapter Reader v2 deck,
--          derived from the already-ingested NCERT corpus (rag_content_chunks),
--          for GRADE 7 and GRADE 9 only, a few chapters each.
--
--          THIS IS A PILOT. It does NOT bulk-generate all grades and does NOT
--          touch any feature flag. ff_chapter_reader_v2 stays exactly as-is.
--
-- Scope (3 chapters, 2 grades, 2 core subjects):
--   - Grade 7 Science Ch 1  "The Ever-Evolving World of Science"        (4 concepts)
--   - Grade 7 Science Ch 3  "Electricity: Circuits and their Components" (4 concepts)
--   - Grade 9 Math    Ch 1  "Orienting Yourself: The Use of Coordinates" (4 concepts)
--
-- ─── MECHANISM ────────────────────────────────────────────────────────────────
--   Chosen: LLM SYNTHESIS (option b), human-reviewed for the pilot.
--
--   Deterministic aggregation (option a) was evaluated against the live corpus
--   and REJECTED for the following measured reasons:
--     * rag_content_chunks.concept is inconsistently populated: real+usable for
--       G7 science/english, but it is the running-header artifact
--       ("Curiosity | Textbook of Science | Grade 7") for most `content` chunks
--       and is fully NULL for G9 math/science.
--     * `qa` chunks are too short to clear the reader's 80-char explanation gate
--       (G7 sci ch1: of 5 real concepts, only 1 exceeded 80 chars; the rest were
--       22-65 char Q&A fragments).
--     * `content` chunks are raw OCR page dumps (1.6-3 kB) with artifacts
--       ("diff erent", "fi nd", tab-split words, math coordinate noise like
--       "67452") — unfit to show students unedited (P12 age-appropriate /
--       no-textbook-dump intent).
--   Grouping therefore yields < MIN_CONCEPTS (3) usable cards per chapter for
--   most chapters, so deterministic SQL assembly cannot satisfy
--   isUsableChapterDeck (src/lib/chapter-reader/get-concepts-from-table.ts).
--
--   The pilot rows below are NCERT-grounded (each card's facts trace to the
--   chunk_text of the cited rag_chunk source for that chapter), cleaned of OCR
--   artifacts, segmented into coherent concepts, and written bilingually. For
--   the pilot they are hand-curated to the EXACT shape the offline LLM
--   generation script will emit, so assessment can judge quality BEFORE any
--   bulk Claude spend is authorized. No unreviewed LLM output reaches students.
--
--   BULK (grades 6-12) MUST use the same LLM-synthesis mechanism via an
--   offline ai-engineer script (Claude Haiku + existing foxy safety rails +
--   post-processing) that emits a reviewed idempotent seed migration like this
--   one. Bulk requires P12 AI-safety sign-off + assessment correctness review.
--   See the report handed back with this migration.
--
-- ─── INVARIANTS ───────────────────────────────────────────────────────────────
--   P5 Grade format : grade is the STRING "7" / "9" (never integer).
--   P6 Quality      : every card has non-empty title (>=3 chars), explanation
--                     (>=80 chars), learning_objective; practice MCQs have
--                     exactly 4 options + correct_index in 0..3.
--   P7 Bilingual    : title_hi / explanation_hi / learning_objective_hi /
--                     example_content_hi populated (Devanagari).
--   P12 AI safety   : content is age-appropriate (grades 6-12), within CBSE
--                     scope, post-processed (not raw LLM / not raw OCR dump).
--
-- ─── IDEMPOTENCY ──────────────────────────────────────────────────────────────
--   ON CONFLICT (grade, subject, chapter_number, concept_number) DO UPDATE
--   (the table's uq_chapter_concepts_grade_subject_chapter_concept constraint).
--   Re-running refreshes the pilot rows in place; safe on prod (additive).
--
--   chapter_id (NOT NULL FK -> chapters) is resolved from public.chapters by
--   (grade, subject_code, chapter_number). On a fresh DB where a chapter row is
--   absent, that chapter's INSERT is skipped (the SELECT yields no rows) rather
--   than failing — the pilot is best-effort and depends on the chapters +
--   rag_content_chunks seeds being present (they exist on prod).
--
--   source = 'ncert_2025_pilot_llm' tags these rows so the pilot is
--   identifiable and reversible (DELETE WHERE source = 'ncert_2025_pilot_llm').

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- GRADE 7 · SCIENCE · CHAPTER 1 — The Ever-Evolving World of Science
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.chapter_concepts (
  grade, subject, chapter_number, chapter_title, chapter_id,
  concept_number, title, title_hi, slug,
  learning_objective, learning_objective_hi,
  explanation, explanation_hi,
  example_title, example_content, example_content_hi,
  key_formula,
  practice_question, practice_options, practice_correct_index, practice_explanation,
  difficulty, bloom_level, estimated_minutes, source
)
SELECT v.grade, v.subject, v.chapter_number, c.title, c.id,
       v.concept_number, v.title_en, v.title_hi, v.slug,
       v.lo_en, v.lo_hi, v.exp_en, v.exp_hi,
       v.ex_title, v.ex_en, v.ex_hi, v.formula,
       v.pq, v.popts, v.pidx, v.pexp,
       v.difficulty, v.bloom, v.minutes, 'ncert_2025_pilot_llm'
FROM public.chapters c
JOIN (VALUES
  ('7','science',1,1,
    'Science as a Way of Thinking','विज्ञान: सोचने का एक तरीका','g7-sci-1-science-as-thinking',
    'Explain that science is a continuous process of asking questions, observing, and finding reasons, not just a fixed set of facts.',
    'समझाएँ कि विज्ञान केवल तथ्यों का संग्रह नहीं, बल्कि प्रश्न पूछने, अवलोकन करने और कारण खोजने की एक सतत प्रक्रिया है।',
    'Science is not just a collection of facts to memorise; it is a way of thinking about the world. Scientists ask questions like "Why do events happen the way they do?" and "How do things work?", then observe carefully and look for patterns to explain what they see. This curious, questioning approach is what makes the world of science ever-evolving.',
    'विज्ञान केवल याद करने के तथ्यों का संग्रह नहीं है; यह दुनिया के बारे में सोचने का एक तरीका है। वैज्ञानिक "घटनाएँ इस तरह क्यों होती हैं?" और "चीज़ें कैसे काम करती हैं?" जैसे प्रश्न पूछते हैं, फिर ध्यान से अवलोकन करते हैं और जो देखते हैं उसे समझाने के लिए प्रतिरूप (पैटर्न) खोजते हैं। यही जिज्ञासु, प्रश्न पूछने वाला दृष्टिकोण विज्ञान की दुनिया को निरंतर विकसित बनाता है।',
    'Everyday curiosity','A simple paper plane once inspired real scientific study of flight — from early inventors watching bird wings to engineers designing aircraft today.',
    'एक साधारण कागज़ का हवाई जहाज़ कभी उड़ान के वास्तविक वैज्ञानिक अध्ययन की प्रेरणा बना — पक्षियों के पंख देखने वाले शुरुआती आविष्कारकों से लेकर आज विमान डिज़ाइन करने वाले इंजीनियरों तक।',
    NULL,
    'According to the chapter, science is best described as —',
    '["a fixed list of facts to memorise","a way of asking questions and finding reasons","only what is written in textbooks","experiments done only in laboratories"]'::jsonb,
    1,'Science is a process — a way of thinking that involves asking questions, observing, and explaining patterns, rather than a fixed set of facts.',
    1,'understand',6),

  ('7','science',1,2,
    'Observing Patterns in Nature','प्रकृति में प्रतिरूप देखना','g7-sci-1-patterns-in-nature',
    'Describe how recognising patterns in nature helps us make sense of the world and predict what may happen.',
    'वर्णन करें कि प्रकृति में प्रतिरूप पहचानना हमें दुनिया को समझने और यह अनुमान लगाने में कैसे मदद करता है कि आगे क्या हो सकता है।',
    'Much of science begins with noticing patterns — things that repeat or follow a rule. Day follows night, seasons return each year, and the same kind of seed grows into the same kind of plant. By spotting these repeating patterns in nature, we can explain why things happen and even predict what will happen next, which is a key part of thinking scientifically.',
    'अधिकांश विज्ञान प्रतिरूपों को देखने से शुरू होता है — ऐसी चीज़ें जो दोहराई जाती हैं या किसी नियम का पालन करती हैं। रात के बाद दिन आता है, हर साल ऋतुएँ लौटती हैं, और एक ही प्रकार का बीज एक ही प्रकार के पौधे में बदलता है। प्रकृति में इन दोहराए जाने वाले प्रतिरूपों को पहचानकर हम समझा सकते हैं कि चीज़ें क्यों होती हैं और यह भी अनुमान लगा सकते हैं कि आगे क्या होगा।',
    'A pattern you can see','Notice how the Moon changes shape in a regular cycle every month — that repeating pattern lets us predict the next full Moon.',
    'ध्यान दें कि चंद्रमा हर महीने एक नियमित चक्र में अपना आकार कैसे बदलता है — वह दोहराया जाने वाला प्रतिरूप हमें अगले पूर्णिमा का अनुमान लगाने देता है।',
    NULL,
    'Recognising a repeating pattern in nature mainly helps a scientist to —',
    '["memorise more facts","predict what is likely to happen next","avoid doing experiments","ignore observations"]'::jsonb,
    1,'Patterns repeat according to a rule, so spotting them lets us explain and predict events — a core scientific skill.',
    1,'understand',5),

  ('7','science',1,3,
    'Properties of Materials','पदार्थों के गुण','g7-sci-1-properties-of-materials',
    'Identify that materials have observable properties such as taste, and that these properties can change.',
    'पहचानें कि पदार्थों में स्वाद जैसे प्रेक्षणीय गुण होते हैं, और ये गुण बदल सकते हैं।',
    'Every material around us has properties we can observe, such as its taste, colour, or how it behaves with other things. For example, some fruits taste sour while others taste sweet — taste is a property we can sense directly. Studying such properties, and noticing how they change (like a turmeric stain changing colour with soap), helps us understand what materials are made of and how they react.',
    'हमारे आस-पास के हर पदार्थ में ऐसे गुण होते हैं जिन्हें हम देख या महसूस कर सकते हैं, जैसे उसका स्वाद, रंग, या वह दूसरी चीज़ों के साथ कैसे व्यवहार करता है। उदाहरण के लिए, कुछ फल खट्टे होते हैं तो कुछ मीठे — स्वाद एक ऐसा गुण है जिसे हम सीधे महसूस कर सकते हैं। ऐसे गुणों का अध्ययन करना, और यह देखना कि वे कैसे बदलते हैं (जैसे साबुन से हल्दी के दाग का रंग बदलना), हमें यह समझने में मदद करता है कि पदार्थ किससे बने हैं और कैसे अभिक्रिया करते हैं।',
    'Property in daily life','When a haldi (turmeric) stain on a school uniform is washed with soap, it turns red — a change that reveals a chemical property of turmeric.',
    'जब स्कूल यूनिफॉर्म पर लगे हल्दी के दाग को साबुन से धोया जाता है, तो वह लाल हो जाता है — यह बदलाव हल्दी के एक रासायनिक गुण को दर्शाता है।',
    NULL,
    'A haldi stain turning red when washed with soap is an example of a material''s —',
    '["shape only","observable property that can change","weight staying the same","price"]'::jsonb,
    1,'Taste, colour and how a material reacts (like turmeric changing colour with soap) are observable properties, and they can change.',
    1,'understand',5),

  ('7','science',1,4,
    'Exploration and Discovery','अन्वेषण और खोज','g7-sci-1-exploration-discovery',
    'Appreciate that scientific exploration is an ongoing journey of observation and discovery that builds on earlier work.',
    'सराहना करें कि वैज्ञानिक अन्वेषण अवलोकन और खोज की एक सतत यात्रा है जो पहले के कार्य पर आधारित होती है।',
    'Scientific exploration is not just about discovering brand-new facts — it is about a way of exploring the world that keeps building on what people learned before. Each generation observes, questions, and adds to earlier discoveries, so understanding grows over time. This is why science is described as ever-evolving: there is always more to explore and discover.',
    'वैज्ञानिक अन्वेषण केवल बिल्कुल नए तथ्य खोजने के बारे में नहीं है — यह दुनिया को खोजने का एक तरीका है जो पहले सीखी गई बातों पर लगातार आधारित होता रहता है। हर पीढ़ी अवलोकन करती है, प्रश्न पूछती है, और पहले की खोजों में जोड़ती है, इसलिए समझ समय के साथ बढ़ती जाती है। यही कारण है कि विज्ञान को निरंतर विकसित होने वाला कहा जाता है: खोजने और जानने के लिए हमेशा और भी कुछ रहता है।',
    'Building on the past','Studying how light behaves has given us a deep understanding of the universe — knowledge that grew step by step from many earlier observations.',
    'प्रकाश के व्यवहार का अध्ययन करने से हमें ब्रह्मांड की गहरी समझ मिली है — यह ज्ञान कई पुराने अवलोकनों से कदम-दर-कदम बढ़ा।',
    NULL,
    'Why is science called "ever-evolving"?',
    '["because facts never change","because each generation builds on earlier discoveries","because it is only about the past","because it has been fully completed"]'::jsonb,
    1,'Science keeps growing as new observations and questions build on what was discovered before, so understanding is never finished.',
    1,'understand',5)
) AS v(grade,subject,chapter_number,concept_number,
       title_en,title_hi,slug,lo_en,lo_hi,exp_en,exp_hi,
       ex_title,ex_en,ex_hi,formula,pq,popts,pidx,pexp,
       difficulty,bloom,minutes)
  ON c.grade = v.grade AND c.subject_code = v.subject AND c.chapter_number = v.chapter_number
ON CONFLICT (grade, subject, chapter_number, concept_number) DO UPDATE SET
  chapter_title = EXCLUDED.chapter_title, chapter_id = EXCLUDED.chapter_id,
  title = EXCLUDED.title, title_hi = EXCLUDED.title_hi, slug = EXCLUDED.slug,
  learning_objective = EXCLUDED.learning_objective, learning_objective_hi = EXCLUDED.learning_objective_hi,
  explanation = EXCLUDED.explanation, explanation_hi = EXCLUDED.explanation_hi,
  example_title = EXCLUDED.example_title, example_content = EXCLUDED.example_content,
  example_content_hi = EXCLUDED.example_content_hi, key_formula = EXCLUDED.key_formula,
  practice_question = EXCLUDED.practice_question, practice_options = EXCLUDED.practice_options,
  practice_correct_index = EXCLUDED.practice_correct_index, practice_explanation = EXCLUDED.practice_explanation,
  difficulty = EXCLUDED.difficulty, bloom_level = EXCLUDED.bloom_level,
  estimated_minutes = EXCLUDED.estimated_minutes, source = EXCLUDED.source,
  is_active = true, updated_at = now();

-- ───────────────────────────────────────────────────────────────────────────
-- GRADE 7 · SCIENCE · CHAPTER 3 — Electricity: Circuits and their Components
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.chapter_concepts (
  grade, subject, chapter_number, chapter_title, chapter_id,
  concept_number, title, title_hi, slug,
  learning_objective, learning_objective_hi,
  explanation, explanation_hi,
  example_title, example_content, example_content_hi,
  key_formula,
  practice_question, practice_options, practice_correct_index, practice_explanation,
  difficulty, bloom_level, estimated_minutes, source
)
SELECT v.grade, v.subject, v.chapter_number, c.title, c.id,
       v.concept_number, v.title_en, v.title_hi, v.slug,
       v.lo_en, v.lo_hi, v.exp_en, v.exp_hi,
       v.ex_title, v.ex_en, v.ex_hi, v.formula,
       v.pq, v.popts, v.pidx, v.pexp,
       v.difficulty, v.bloom, v.minutes, 'ncert_2025_pilot_llm'
FROM public.chapters c
JOIN (VALUES
  ('7','science',3,1,
    'Uses of Electricity in Daily Life','दैनिक जीवन में बिजली के उपयोग','g7-sci-3-uses-of-electricity',
    'List common uses of electricity at home and explain why it is important in everyday life.',
    'घर में बिजली के सामान्य उपयोगों की सूची बनाएँ और समझाएँ कि रोज़मर्रा के जीवन में यह क्यों महत्वपूर्ण है।',
    'Electricity powers a huge number of things we use every day. At home it lights our rooms, runs fans and refrigerators, charges phones, and helps cook food. Large hydroelectric power houses, such as the one at Bhakra Nangal Dam, use the force of falling water to generate the electricity that reaches our homes through wires. Looking around your own house is a good way to discover just how many devices depend on electricity.',
    'बिजली उन बहुत सारी चीज़ों को चलाती है जिन्हें हम रोज़ इस्तेमाल करते हैं। घर में यह कमरों को रोशन करती है, पंखे और रेफ्रिजरेटर चलाती है, फ़ोन चार्ज करती है, और खाना पकाने में मदद करती है। बड़े जलविद्युत बिजलीघर, जैसे भाखड़ा नांगल बाँध का बिजलीघर, गिरते पानी के बल से बिजली बनाते हैं जो तारों के ज़रिए हमारे घरों तक पहुँचती है। अपने घर के चारों ओर देखना यह जानने का अच्छा तरीका है कि कितने उपकरण बिजली पर निर्भर करते हैं।',
    'Electricity from water','At the Bhakra Nangal Dam hydroelectric power house, the force of falling water from the Sutlej river is used to generate electricity.',
    'भाखड़ा नांगल बाँध के जलविद्युत बिजलीघर में, सतलुज नदी के गिरते पानी के बल का उपयोग बिजली बनाने के लिए किया जाता है।',
    NULL,
    'At a hydroelectric power house like Bhakra Nangal, electricity is generated using the force of —',
    '["burning coal","falling water","blowing wind","sunlight only"]'::jsonb,
    1,'A hydroelectric power house uses the force of falling water (here, the Sutlej river) to generate electricity.',
    1,'understand',6),

  ('7','science',3,2,
    'What is an Electric Circuit?','विद्युत परिपथ क्या है?','g7-sci-3-electric-circuit',
    'Define an electric circuit and state that current flows only when the circuit forms a complete, closed path.',
    'विद्युत परिपथ की परिभाषा दें और बताएँ कि धारा तभी बहती है जब परिपथ एक पूर्ण, बंद पथ बनाता है।',
    'An electric circuit is a path along which electric current can flow. For a device like a bulb to work, the circuit must be complete — that is, there must be an unbroken path from one end of the cell, through the connecting wires and the device, and back to the other end of the cell. If the path is broken anywhere, the circuit is open and no current flows, so the bulb will not glow.',
    'विद्युत परिपथ वह पथ है जिसके साथ-साथ विद्युत धारा बह सकती है। बल्ब जैसे किसी उपकरण के काम करने के लिए, परिपथ का पूर्ण होना ज़रूरी है — यानी सेल के एक सिरे से, जोड़ने वाले तारों और उपकरण से होते हुए, सेल के दूसरे सिरे तक एक अटूट पथ होना चाहिए। यदि पथ कहीं भी टूट जाए, तो परिपथ खुला होता है और कोई धारा नहीं बहती, इसलिए बल्ब नहीं जलेगा।',
    'Complete vs broken path','When all the wires are joined end to end with the cell and bulb, the bulb glows; pull one wire loose and the bulb goes off because the path is broken.',
    'जब सभी तार सेल और बल्ब के साथ सिरे-से-सिरे जुड़े होते हैं, तो बल्ब जलता है; एक तार ढीला कर दें तो बल्ब बुझ जाता है क्योंकि पथ टूट जाता है।',
    NULL,
    'A bulb in a circuit will glow only when the circuit is —',
    '["open at one point","a complete, closed path","made of glass","very long"]'::jsonb,
    1,'Current flows only along a complete (closed) path; if the circuit is broken anywhere, no current flows and the bulb stays off.',
    2,'understand',6),

  ('7','science',3,3,
    'Conductors and Insulators','चालक और कुचालक','g7-sci-3-conductors-insulators',
    'Distinguish between conductors and insulators based on whether they allow electric current to pass.',
    'इस आधार पर चालक और कुचालक में अंतर करें कि वे विद्युत धारा को गुज़रने देते हैं या नहीं।',
    'Materials are grouped by how they behave with electric current. Conductors, such as most metals, let current pass through them easily, which is why connecting wires are made of metal. Insulators, such as plastic, rubber, and wood, do not let current pass through; this is why the outer covering of a wire is made of plastic to keep us safe. Testing different materials in a circuit shows which are conductors and which are insulators.',
    'पदार्थों को इस आधार पर समूहित किया जाता है कि वे विद्युत धारा के साथ कैसा व्यवहार करते हैं। चालक, जैसे अधिकांश धातुएँ, धारा को आसानी से गुज़रने देते हैं, इसीलिए जोड़ने वाले तार धातु के बने होते हैं। कुचालक, जैसे प्लास्टिक, रबड़ और लकड़ी, धारा को गुज़रने नहीं देते; इसीलिए तार का बाहरी आवरण प्लास्टिक का बनाया जाता है ताकि हम सुरक्षित रहें। परिपथ में विभिन्न पदार्थों का परीक्षण यह दिखाता है कि कौन चालक हैं और कौन कुचालक।',
    'Testing materials','Put a metal key into a circuit and the bulb glows (conductor); put a plastic scale in its place and the bulb stays off (insulator).',
    'परिपथ में एक धातु की चाबी रखें तो बल्ब जलता है (चालक); उसकी जगह एक प्लास्टिक का स्केल रखें तो बल्ब बुझा रहता है (कुचालक)।',
    NULL,
    'Which of these is an insulator (does NOT let current pass easily)?',
    '["copper wire","iron nail","plastic scale","aluminium foil"]'::jsonb,
    2,'Plastic is an insulator and does not let current pass; copper, iron and aluminium are metals, which are conductors.',
    2,'apply',6),

  ('7','science',3,4,
    'Components of a Circuit','परिपथ के घटक','g7-sci-3-circuit-components',
    'Name the main components of a simple electric circuit and state the function of each.',
    'एक साधारण विद्युत परिपथ के मुख्य घटकों के नाम बताएँ और प्रत्येक का कार्य बताएँ।',
    'A simple electric circuit is built from a few key components. The cell (or battery) is the source that pushes the current; the connecting wires carry the current around the circuit; a device such as a bulb uses the current to do something useful (here, give light); and a switch is used to open or close the circuit so we can turn the device on or off. Together these components form the complete path current needs to flow.',
    'एक साधारण विद्युत परिपथ कुछ मुख्य घटकों से बनता है। सेल (या बैटरी) वह स्रोत है जो धारा को धकेलता है; जोड़ने वाले तार धारा को परिपथ में चारों ओर ले जाते हैं; बल्ब जैसा उपकरण धारा का उपयोग कुछ उपयोगी करने (यहाँ, प्रकाश देने) के लिए करता है; और एक स्विच का उपयोग परिपथ को खोलने या बंद करने के लिए किया जाता है ताकि हम उपकरण को चालू या बंद कर सकें। मिलकर ये घटक वह पूर्ण पथ बनाते हैं जिसकी धारा को बहने के लिए आवश्यकता होती है।',
    'Role of a switch','A switch is like a gate in the path: closing it completes the circuit and the bulb glows; opening it breaks the path and the bulb goes off.',
    'स्विच पथ में एक द्वार की तरह है: इसे बंद करने पर परिपथ पूरा हो जाता है और बल्ब जलता है; इसे खोलने पर पथ टूट जाता है और बल्ब बुझ जाता है।',
    NULL,
    'In a simple circuit, the job of the switch is to —',
    '["produce the current","open or close the circuit","change plastic into metal","store water"]'::jsonb,
    1,'A switch opens or closes the circuit, which turns the device on or off by completing or breaking the path.',
    2,'understand',6)
) AS v(grade,subject,chapter_number,concept_number,
       title_en,title_hi,slug,lo_en,lo_hi,exp_en,exp_hi,
       ex_title,ex_en,ex_hi,formula,pq,popts,pidx,pexp,
       difficulty,bloom,minutes)
  ON c.grade = v.grade AND c.subject_code = v.subject AND c.chapter_number = v.chapter_number
ON CONFLICT (grade, subject, chapter_number, concept_number) DO UPDATE SET
  chapter_title = EXCLUDED.chapter_title, chapter_id = EXCLUDED.chapter_id,
  title = EXCLUDED.title, title_hi = EXCLUDED.title_hi, slug = EXCLUDED.slug,
  learning_objective = EXCLUDED.learning_objective, learning_objective_hi = EXCLUDED.learning_objective_hi,
  explanation = EXCLUDED.explanation, explanation_hi = EXCLUDED.explanation_hi,
  example_title = EXCLUDED.example_title, example_content = EXCLUDED.example_content,
  example_content_hi = EXCLUDED.example_content_hi, key_formula = EXCLUDED.key_formula,
  practice_question = EXCLUDED.practice_question, practice_options = EXCLUDED.practice_options,
  practice_correct_index = EXCLUDED.practice_correct_index, practice_explanation = EXCLUDED.practice_explanation,
  difficulty = EXCLUDED.difficulty, bloom_level = EXCLUDED.bloom_level,
  estimated_minutes = EXCLUDED.estimated_minutes, source = EXCLUDED.source,
  is_active = true, updated_at = now();

-- ───────────────────────────────────────────────────────────────────────────
-- GRADE 9 · MATH · CHAPTER 1 — Orienting Yourself: The Use of Coordinates
-- (Ganita Manjari, Grade 9, Part I)
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.chapter_concepts (
  grade, subject, chapter_number, chapter_title, chapter_id,
  concept_number, title, title_hi, slug,
  learning_objective, learning_objective_hi,
  explanation, explanation_hi,
  example_title, example_content, example_content_hi,
  key_formula,
  practice_question, practice_options, practice_correct_index, practice_explanation,
  difficulty, bloom_level, estimated_minutes, source
)
SELECT v.grade, v.subject, v.chapter_number, c.title, c.id,
       v.concept_number, v.title_en, v.title_hi, v.slug,
       v.lo_en, v.lo_hi, v.exp_en, v.exp_hi,
       v.ex_title, v.ex_en, v.ex_hi, v.formula,
       v.pq, v.popts, v.pidx, v.pexp,
       v.difficulty, v.bloom, v.minutes, 'ncert_2025_pilot_llm'
FROM public.chapters c
JOIN (VALUES
  ('9','math',1,1,
    'What is a Coordinate System?','निर्देशांक प्रणाली क्या है?','g9-math-1-coordinate-system',
    'Explain that a coordinate system is a framework that uses numbers to describe the exact location of a point.',
    'समझाएँ कि निर्देशांक प्रणाली एक ढाँचा है जो किसी बिंदु के सटीक स्थान को संख्याओं द्वारा बताती है।',
    'A system of coordinates is a structured framework — like the grid lines on a map or on graph paper — that lets us use numbers to describe the exact location of a point or object. Instead of saying "near the corner", we can give a precise pair of numbers that pins down the position. This idea of grid-based thinking has deep roots in Bhārat: the cities of the Sindhu-Sarasvatī Civilisation were laid out on precise North–South and East–West grids thousands of years ago.',
    'निर्देशांक प्रणाली एक संरचित ढाँचा है — मानचित्र या ग्राफ़ पेपर की ग्रिड रेखाओं की तरह — जो हमें किसी बिंदु या वस्तु के सटीक स्थान को संख्याओं द्वारा बताने देता है। "कोने के पास" कहने के बजाय, हम संख्याओं का एक सटीक युग्म दे सकते हैं जो स्थिति को निश्चित कर देता है। ग्रिड-आधारित सोच का यह विचार भारत में गहराई से निहित है: सिंधु-सरस्वती सभ्यता के नगर हज़ारों साल पहले सटीक उत्तर–दक्षिण और पूर्व–पश्चिम ग्रिडों पर बसाए गए थे।',
    'Grids around us','The streets in a planned city, or the squares on graph paper, form a grid — and any spot on that grid can be named by a pair of numbers.',
    'किसी नियोजित नगर की सड़कें, या ग्राफ़ पेपर के वर्ग, एक ग्रिड बनाते हैं — और उस ग्रिड पर किसी भी स्थान को संख्याओं के एक युग्म द्वारा नाम दिया जा सकता है।',
    NULL,
    'A coordinate system mainly allows us to —',
    '["measure temperature","describe the exact location of a point using numbers","weigh objects","tell the time"]'::jsonb,
    1,'A coordinate system is a framework that uses numbers (coordinates) to describe the exact location of a point.',
    1,'understand',7),

  ('9','math',1,2,
    'The Cartesian Plane: Axes and Origin','कार्तीय तल: अक्ष और मूलबिंदु','g9-math-1-cartesian-plane',
    'Identify the x-axis, y-axis, and origin of the 2-D Cartesian plane.',
    '2-विमीय कार्तीय तल के x-अक्ष, y-अक्ष और मूलबिंदु को पहचानें।',
    'The 2-D Cartesian plane is formed by two number lines that cross each other at right angles. The horizontal line is called the x-axis and the vertical line is called the y-axis. The point where they meet is the origin, written as (0, 0). These two axes divide the flat plane into four regions and give us a fixed reference, so that every point in the plane can be located with respect to the origin.',
    '2-विमीय कार्तीय तल दो संख्या रेखाओं से बनता है जो एक-दूसरे को समकोण पर काटती हैं। क्षैतिज रेखा को x-अक्ष और ऊर्ध्वाधर रेखा को y-अक्ष कहते हैं। जहाँ वे मिलती हैं वह बिंदु मूलबिंदु है, जिसे (0, 0) लिखा जाता है। ये दोनों अक्ष समतल को चार भागों में बाँटते हैं और हमें एक स्थिर संदर्भ देते हैं, ताकि तल के हर बिंदु को मूलबिंदु के सापेक्ष स्थित किया जा सके।',
    'Reading the axes','On graph paper, mark the point where the two dark lines cross — that is the origin (0, 0); the line going across is the x-axis and the line going up is the y-axis.',
    'ग्राफ़ पेपर पर, वह बिंदु अंकित करें जहाँ दो गहरी रेखाएँ काटती हैं — वही मूलबिंदु (0, 0) है; आर-पार जाने वाली रेखा x-अक्ष है और ऊपर जाने वाली रेखा y-अक्ष है।',
    'Origin = (0, 0)',
    'In the Cartesian plane, the point where the x-axis and y-axis meet is called the —',
    '["quadrant","origin","abscissa","ordinate"]'::jsonb,
    1,'The x-axis and y-axis intersect at the origin, which has coordinates (0, 0).',
    1,'understand',7),

  ('9','math',1,3,
    'Coordinates of a Point (x, y)','किसी बिंदु के निर्देशांक (x, y)','g9-math-1-coordinates-of-point',
    'Write the coordinates of a point as an ordered pair (x, y) and read a point''s position from them.',
    'किसी बिंदु के निर्देशांक को क्रमित युग्म (x, y) के रूप में लिखें और उनसे बिंदु की स्थिति पढ़ें।',
    'The position of any point in the plane is given by an ordered pair of numbers (x, y). The first number, x, tells how far the point is along the x-axis (left or right of the origin); the second number, y, tells how far it is along the y-axis (up or down). The order matters: (4, 2) is a different point from (2, 4). Points lying on the x-axis have the form (x, 0), and points on the y-axis have the form (0, y).',
    'तल में किसी भी बिंदु की स्थिति संख्याओं के एक क्रमित युग्म (x, y) द्वारा दी जाती है। पहली संख्या, x, बताती है कि बिंदु x-अक्ष के अनुदिश कितनी दूर है (मूलबिंदु के बाएँ या दाएँ); दूसरी संख्या, y, बताती है कि वह y-अक्ष के अनुदिश कितनी दूर है (ऊपर या नीचे)। क्रम महत्वपूर्ण है: (4, 2) बिंदु (2, 4) से भिन्न है। x-अक्ष पर स्थित बिंदुओं का रूप (x, 0) होता है, और y-अक्ष पर स्थित बिंदुओं का रूप (0, y) होता है।',
    'Plotting (4, 2)','To plot (4, 2), start at the origin, move 4 units right along the x-axis, then 2 units up parallel to the y-axis, and mark the point there.',
    '(4, 2) अंकित करने के लिए, मूलबिंदु से शुरू करें, x-अक्ष के अनुदिश 4 इकाई दाएँ जाएँ, फिर y-अक्ष के समानांतर 2 इकाई ऊपर जाएँ, और वहाँ बिंदु अंकित करें।',
    '(x, y): x along x-axis, y along y-axis',
    'A point lying on the x-axis always has coordinates of the form —',
    '["(0, y)","(x, 0)","(x, x)","(y, y)"]'::jsonb,
    1,'Every point on the x-axis has y = 0, so its coordinates are of the form (x, 0).',
    2,'apply',7),

  ('9','math',1,4,
    'Distance Between Two Points','दो बिंदुओं के बीच दूरी','g9-math-1-distance-between-points',
    'Use the distance formula to find the length of the segment joining two points in the plane.',
    'तल में दो बिंदुओं को जोड़ने वाले रेखाखंड की लंबाई ज्ञात करने के लिए दूरी सूत्र का उपयोग करें।',
    'Once points are described by coordinates, we can calculate the straight-line distance between them using numbers alone. For two points (x1, y1) and (x2, y2), the distance is the square root of the sum of the squares of the differences in their x-coordinates and y-coordinates. This is why, when a shape is reflected across an axis, its side lengths stay the same — the distances are preserved because the differences in coordinates are unchanged.',
    'जब बिंदुओं को निर्देशांकों द्वारा बताया जाता है, तो हम केवल संख्याओं का उपयोग करके उनके बीच की सीधी-रेखा दूरी की गणना कर सकते हैं। दो बिंदुओं (x1, y1) और (x2, y2) के लिए, दूरी उनके x-निर्देशांकों और y-निर्देशांकों के अंतरों के वर्गों के योग का वर्गमूल होती है। यही कारण है कि जब किसी आकृति को किसी अक्ष के सापेक्ष परावर्तित किया जाता है, तो उसकी भुजाओं की लंबाई समान रहती है — दूरियाँ संरक्षित रहती हैं क्योंकि निर्देशांकों के अंतर अपरिवर्तित रहते हैं।',
    'Distance from (0,0) to (3,4)','For (0, 0) and (3, 4): differences are 3 and 4, so distance = sqrt(3^2 + 4^2) = sqrt(9 + 16) = sqrt(25) = 5 units.',
    '(0, 0) और (3, 4) के लिए: अंतर 3 और 4 हैं, इसलिए दूरी = sqrt(3^2 + 4^2) = sqrt(9 + 16) = sqrt(25) = 5 इकाई।',
    'd = sqrt((x2 - x1)^2 + (y2 - y1)^2)',
    'The distance between the points (0, 0) and (3, 4) is —',
    '["3 units","4 units","5 units","7 units"]'::jsonb,
    2,'Using d = sqrt((x2-x1)^2 + (y2-y1)^2) = sqrt(9 + 16) = sqrt(25) = 5 units.',
    3,'apply',8)
) AS v(grade,subject,chapter_number,concept_number,
       title_en,title_hi,slug,lo_en,lo_hi,exp_en,exp_hi,
       ex_title,ex_en,ex_hi,formula,pq,popts,pidx,pexp,
       difficulty,bloom,minutes)
  ON c.grade = v.grade AND c.subject_code = v.subject AND c.chapter_number = v.chapter_number
ON CONFLICT (grade, subject, chapter_number, concept_number) DO UPDATE SET
  chapter_title = EXCLUDED.chapter_title, chapter_id = EXCLUDED.chapter_id,
  title = EXCLUDED.title, title_hi = EXCLUDED.title_hi, slug = EXCLUDED.slug,
  learning_objective = EXCLUDED.learning_objective, learning_objective_hi = EXCLUDED.learning_objective_hi,
  explanation = EXCLUDED.explanation, explanation_hi = EXCLUDED.explanation_hi,
  example_title = EXCLUDED.example_title, example_content = EXCLUDED.example_content,
  example_content_hi = EXCLUDED.example_content_hi, key_formula = EXCLUDED.key_formula,
  practice_question = EXCLUDED.practice_question, practice_options = EXCLUDED.practice_options,
  practice_correct_index = EXCLUDED.practice_correct_index, practice_explanation = EXCLUDED.practice_explanation,
  difficulty = EXCLUDED.difficulty, bloom_level = EXCLUDED.bloom_level,
  estimated_minutes = EXCLUDED.estimated_minutes, source = EXCLUDED.source,
  is_active = true, updated_at = now();

COMMIT;
