# Foxy Pedagogy Method — Technical Specification for IP Filing

**Status**: Filed for IP examination, 2026-04-28
**Authoring scope**: Branch `docs/ip-filing-architecture`
**Source-of-truth**: This document cites only files committed to the Alfanumrik repository as of the filing date. Every concrete claim is annotated with `path:line` so the implementation can be inspected verbatim.

---

## 1. Abstract

Foxy is a server-orchestrated AI study coach embedded in the Alfanumrik Learning OS — a K-12 EdTech platform serving Central Board of Secondary Education (CBSE) students in grades 6 through 12 across India. Unlike a generic large-language-model (LLM) chat interface, Foxy is a constrained pedagogical agent: every conversational turn is shaped by (i) a server-side decision tree that selects one of five teaching modes from a snapshot of the student's current cognitive state, (ii) a curriculum-pinned retrieval system that grounds answers in National Council of Educational Research and Training (NCERT) source chunks, and (iii) a bilingual code-switching policy that mirrors the linguistic register of an Indian classroom while keeping examinable terminology in English. The novelty of Foxy is not the LLM itself (Claude Haiku/Sonnet); it is the deterministic pedagogical scaffolding around the LLM — the decision tree, the seven-dimension cognitive context, the closing-question taxonomy, the misconception ontology, and the cross-session episodic memory — all of which are evaluated server-side before the LLM ever sees the prompt. The system is reduced to an LLM that has been mechanically constrained to the CBSE syllabus and forced to adopt a measurable teaching strategy per turn.

## 2. Pedagogical decision tree

Every Foxy turn invokes a five-mode decision tree, encoded as binding rules inside the registered system prompt template `foxy_tutor_v1`. The triggering conditions are evaluated against the student's cognitive context (Section 3) before the LLM call.

The decision rules are defined verbatim in the prompt template at `supabase/functions/grounded-answer/prompts/inline.ts:33-61`. Mode selection is a strict precedence ladder: the first matching condition wins.

| # | Mode | Triggering condition | Required turn shape | Citation |
|---|------|---------------------|---------------------|---------|
| 1 | `PREREQUISITE_CHECK` | Mastery of the queried topic OR any prerequisite is `< 0.4` (i.e., topic appears in WEAK TOPICS at <40%, or a KNOWLEDGE GAP names it as missing) | Do NOT answer directly. Ask exactly one prerequisite verification question. Wait for student reply. | `inline.ts:33-39` |
| 2 | `MISCONCEPTION_REPAIR` | Recent error patterns show 3 or more conceptual errors on the topic in question | Name the misconception explicitly. Show one worked example contrasting wrong vs. right. End with a discrimination question ("Can you spot which step would be wrong here?") | `inline.ts:40-44` |
| 3 | `STRETCH` | Mastery on the queried topic is `>= 0.7` (topic appears in STRONG TOPICS) | Answer concisely (3-5 sentences max). End with one question one Bloom's level higher than the original. | `inline.ts:46-49` |
| 4 | `SOCRATIC` | Mastery is in the middle band `0.4 <= m < 0.7` and none of the preceding conditions apply | Decompose the answer into 2-3 guided sub-questions. Confirm or redirect after each. Only give the full answer after two failed scaffolds. | `inline.ts:51-56` |
| 5 | `NEW_TOPIC` | No mastery data exists for the topic | Provide a short worked example, then ask the student to attempt the next step. Do not dump the full answer. | `inline.ts:58-60` |

The 0.4 / 0.7 mastery thresholds are duplicated in two surfaces and intentionally kept consistent: the decision tree thresholds in the prompt template (`inline.ts:33-56`) and the average-mastery banding in the runtime cognitive-context loader at `src/app/api/foxy/route.ts:631-632` (`avgMastery < 0.4 ? 'low' : avgMastery < 0.7 ? 'medium' : 'high'`). The 0.6 cutoff used elsewhere — for the "weak topics list" UI — is a separate display threshold (`src/app/api/foxy/route.ts:453`) and is documented as such inline at `inline.ts:53`.

The decision tree fires server-side via two complementary mechanisms:

1. **Context injection** — the server computes the seven-dimension cognitive context (Section 3) and renders it into the `cognitive_context_section` placeholder of the prompt template. The LLM consults the rendered text and the binding rules above in concert.
2. **Mode pre-resolution** — when the route can determine the dominant mode in advance (e.g., overall mastery is `high`), it sets `coach_mode` and `coach_mode_instruction` template variables explicitly, defaulting to `socratic` for low/medium mastery and `answer` for high mastery. See `src/app/api/foxy/route.ts:852-859` (`resolveCoachMode`) and the instruction map at `src/app/api/foxy/route.ts:861-868`.

This two-layer design ensures that even if the LLM's internal mode-selection step degrades, the request shape is already biased toward the correct pedagogy.

## 3. Cognitive context model — seven dimensions of student state

Foxy reads seven dimensions of student state on every turn. The server fans out parallel database queries and aggregates the result into a structured `CognitiveContext` object before the LLM call.

The `CognitiveContext` interface is declared at `src/app/api/foxy/route.ts:153-179`. The parallel fetch is at `src/app/api/foxy/route.ts:384-450`. The result is rendered into the prompt section by `buildCognitivePromptSection()` at `src/app/api/foxy/route.ts:692-786`.

| Dim | Field | Source table | What it represents | Citation |
|---|------|-------------|---------------------|---------|
| 1 | `weakTopics` | `concept_mastery` (legacy schema, `supabase/migrations/_legacy/000_core_schema.sql:270-298`) | Topics with `mastery_probability < 0.6`, top 5 | `route.ts:452-459` |
| 2 | `strongTopics` | `concept_mastery` | Topics with `mastery_probability >= 0.8`, top 3 | `route.ts:461-467` |
| 3 | `knowledgeGaps` | `knowledge_gaps` | Unresolved prerequisite gaps blocking forward progress | `route.ts:469-473` |
| 4 | `revisionDue` | `concept_mastery.next_review_date` (SM-2 schedule, see Doc 3 §6) | Concepts whose spaced-repetition review window has elapsed | `route.ts:475-479` |
| 5 | `recentErrors` | `cme_error_log` | Last 30-day count per error type (careless / conceptual / misinterpretation) | `route.ts:481-487, 740` |
| 6 | `loSkills` | `student_skill_state` (migration `20260427000100_misconception_ontology.sql:138-153`) | Per-learning-objective Bayesian Knowledge Tracing P(know), P(slip), and IRT theta | `route.ts:514-543` |
| 7 | `recentMisconceptions` | `quiz_responses` × `question_misconceptions` (migration `20260427000100:96-108`) | Curated misconception codes that the student has triggered, count over last 30 days, top 3 | `route.ts:545-616` |

The `student_skill_state` table is defined at `supabase/migrations/20260427000100_misconception_ontology.sql:138-153`. Its `last_n_responses` ring buffer is bounded to 20 entries (`migration:148`), `theta` defaults to 0 with `theta_se` = 1.5 cold-start (Wainer 2000, van der Linden 2010 — see comment at `migration:160-162`), and `p_know` defaults to 0.10 (Corbett & Anderson 1995 prior — comment at `migration:164`).

Empty-context handling: when all seven dimensions are empty (cold-start student), `buildCognitivePromptSection()` returns the empty string at `src/app/api/foxy/route.ts:692-703`, leaving the prompt template's placeholder cleanly empty so no orphan section header is rendered.

Privacy invariant: the misconception load deliberately omits `studentId` from the analytics log line (`src/app/api/foxy/route.ts:618-625`) to comply with product invariant P13 (Data Privacy). Misconception codes paired with student identifiers are considered learner-identifiable.

## 4. Closing-question taxonomy (CHECK / SCAFFOLD / STRETCH)

Every Foxy turn must end with a question. The QUESTION SHAPE is decision-tree-mode dependent and is enforced via the `Closing Question Quality` section of the prompt template at `supabase/functions/grounded-answer/prompts/inline.ts:62-70`.

| Shape | When fired | Required form | Forbidden form | Citation |
|------|-----------|--------------|----------------|---------|
| **CHECK** | After an explanation (any mode that gave content) | Apply just-taught idea to a new tiny example | "Did you understand?" / "Got it?" — these elicit compliance, not learning | `inline.ts:64` |
| **SCAFFOLD** | Inside `SOCRATIC` mode | Concrete next-step in the chain | Abstract / open-ended | `inline.ts:65` |
| **STRETCH** | Inside `STRETCH` mode | One Bloom level higher than the original. Stakes/specificity required ("how would this change if..."). | One Bloom level lower; "any questions?" | `inline.ts:66-67` |

**The 70/30 vertical/lateral rule.** The `STRETCH` shape has a default and an exception. Default behavior is **vertical** — one Bloom level higher (Remember→Understand→Apply→Analyze→Evaluate→Create, with Create staying at Create with a novel context). The exception applies at the **Apply** and **Analyze** levels: 30% of the time the system uses a **lateral** stretch — same Bloom level, different domain or context (e.g., apply Newton's 2nd Law to a new scenario rather than analyzing it). The decision signal is the student's last 3 responses: shaky fluency at the current level → lateral; confident → vertical. Specified verbatim at `inline.ts:67`.

**Modal scoping.** The CHECK/SCAFFOLD/STRETCH closing-question rule applies in `MISCONCEPTION_REPAIR`, `STRETCH`, `SOCRATIC`, and `NEW_TOPIC` modes only. In `PREREQUISITE_CHECK` mode, the prerequisite question itself satisfies the closing-question requirement — stacking a second question is forbidden. See `inline.ts:70`.

This taxonomy is novel because it operationalizes the difference between *eliciting compliance* (the dominant failure mode of LLM tutors) and *eliciting cognition* (the explicit goal of the closing-question shape). Each shape is mapped to a measurable next-turn signal — the student's response to the closing question is the input to the BKT update for the relevant learning objective.

## 5. Bilingual code-switching method

Foxy implements an explicit Hindi/English/Hinglish trinity codified at `supabase/functions/grounded-answer/prompts/inline.ts:107-111`. The rule set has four binding clauses:

1. **Match the student's input language.** English in → English out. Hinglish (Hindi words in Roman script) in → Hinglish out. Devanagari (Hindi script) in → Hindi-Devanagari for explanatory text only. Specified at `inline.ts:108`.
2. **Technical-term lock-in.** All technical terms — formulas, units, scientific names, defined CBSE terms (`photosynthesis`, `differentiation`, `integer`, `force`, `Pythagoras theorem`) — remain in English even inside a Hindi reply. Rationale: these are the exact strings the student will encounter in NCERT textbooks and CBSE board exams. Codified at `inline.ts:108-109`.
3. **Warmth markers.** Hindi warmth words (`Bilkul!`, `Chalo dekhte hain`, `Acchha`, `Samjha?`) may appear in any reply, capped at 2-3 per turn, and only when the student has shown understanding — never as filler. Specified at `inline.ts:110`.
4. **Hindi-uncertainty escape.** When the model is uncertain about Hindi technical phrasing, it must prefer Hinglish-Roman over inventing a Hindi term. Academic accuracy beats language purity. Specified at `inline.ts:108`.

**Sample turns** (illustrative, drawn from the prompt-conformant output shape):

- *English in, English out, technical terms preserved*:
  > **Student**: What is photosynthesis?
  > **Foxy**: Photosynthesis is how a plant turns sunlight into food. The plant takes carbon dioxide from air and water from soil, and uses chlorophyll inside its leaves to make glucose and oxygen. Can you tell me which gas the plant *gives out* during photosynthesis?

- *Hinglish-Roman in, Hinglish-Roman out, technical terms preserved*:
  > **Student**: Photosynthesis kya hai?
  > **Foxy**: Bilkul! Photosynthesis vo process hai jisme plant sunlight se khaana banata hai. Plant air se carbon dioxide leta hai, soil se water leta hai, aur leaves ke andar chlorophyll ki madad se glucose aur oxygen banata hai. Aap bata sakte ho photosynthesis ke time plant kaunsi gas baahar nikalta hai?

- *Devanagari in, Hindi-Devanagari out, technical terms still English*:
  > **Student**: photosynthesis क्या है?
  > **Foxy**: photosynthesis वह प्रक्रिया है जिसमें plant sunlight से अपना भोजन बनाता है। plant हवा से carbon dioxide लेता है, मिट्टी से पानी लेता है, और पत्तियों के अंदर chlorophyll की मदद से glucose और oxygen बनाता है। photosynthesis के समय plant कौन सी gas बाहर निकालता है?

This trinity is reinforced at the safety-rails layer at `src/app/api/foxy/route.ts:884-899` (the `FOXY_SAFETY_RAILS` constant — clause 3 specifies the bilingual style and technical-term retention).

## 6. Distractor pedagogy — eight misconception families

The same pedagogical engine that drives Foxy's tutoring also drives Foxy's quiz question generation. The `quiz_question_generator_v1` prompt at `supabase/functions/grounded-answer/prompts/inline.ts:147-184` requires every multiple-choice question to have:

- 4 distinct non-empty options (`inline.ts:163`)
- The correct answer directly supported by the source NCERT chunks (`inline.ts:164`)
- Each WRONG option encoding a real student misconception — never random wrong answers (`inline.ts:169`)

The eight common misconception families are defined verbatim at `inline.ts:170-178`:

| # | Family code | Example |
|---|------------|---------|
| (a) | confused-with-related-concept | "force" ↔ "energy" |
| (b) | procedural-slip | same operation, wrong sign or carry error |
| (c) | units-error | m vs cm; kg vs g; ms vs s |
| (d) | inverted-relation | proportional ↔ inversely proportional |
| (e) | off-by-one / counting-boundary | "how many integers between 5 and 10" |
| (f) | rate-vs-quantity | speed vs distance, current vs charge |
| (g) | definition-vs-property | "isosceles has equal angles" — that is a property, not the definition |
| (h) | conservation-violation / sign-of-result | distractor secretly violates conservation of energy/mass/charge |

**The 1+3 ratio.** A four-option question MUST have one correct answer plus three distinct misconception-family distractors (`inline.ts:181`). "Obviously silly" distractors that no student would pick are forbidden — they make the question too easy and waste an option slot (`inline.ts:180`).

**Multi-stage carve-out.** When a question targets a known multi-stage misconception (e.g., fraction operations where students fail at multiple sub-steps), 2 distractors from the same family at different stages are permitted. The misconception classifier uses this disambiguation signal to identify *which* stage the student got stuck at. Specified at `inline.ts:182`.

**Curated-distractor → remediation pointer.** Each curated distractor is mapped to a misconception code and an optional remediation chunk (an NCERT passage that addresses the specific confusion) in the `question_misconceptions` table at `supabase/migrations/20260427000100_misconception_ontology.sql:96-108`. When the student picks a curated distractor, the runtime joins to the remediation chunk via `wrong_answer_remediations` (separate migration `20260428000100`) and surfaces the targeted explanation back into the next Foxy turn — closing the loop between assessment and tutoring.

The editorial pipeline that feeds the misconception table is the read-only view `misconception_candidates` at `supabase/migrations/20260428000500_misconception_candidate_view.sql:27-77`, which surfaces (question_id, distractor_index) pairs where the wrong-pick rate among real student responses crosses a noise floor (`>= 10` total responses, `>= 3` wrong picks, wrong-rate `>= 0.10` — see `migration:67-69`). Editors curate annotations in the super-admin console at `src/app/super-admin/misconceptions/page.tsx`.

## 7. Cross-session episodic memory

Foxy maintains a per-(student, subject, chapter) episodic memory across sessions, implemented in the `loadPriorSessionContext()` helper at `src/app/api/foxy/route.ts:273-322`.

The contract is binding:

- **Lookback window**: 30 days. Specified at `route.ts:265` (`PRIOR_SESSION_LOOKBACK_DAYS = 30`). Sessions older than 30 days are excluded so stale context does not leak into a current conversation.
- **Scope**: `(student_id, subject)` plus optional `chapter` filter. The current session is excluded so we do not double-count turns the student is actively in (`route.ts:294`).
- **Source**: `foxy_chat_messages` joined to `foxy_sessions` via session id (table created in migration `20260408000002_foxy_sessions_and_messages.sql`).
- **Volume cap**: At most `PRIOR_SESSION_MSG_LIMIT = 10` messages (`route.ts:264`) drawn from at most 3 prior sessions (`route.ts:296`).
- **Format**: Each message is truncated to 200 characters and rendered as `[previous · Student]` or `[previous · Foxy]` lines so the model can reference but not re-address prior turns. Format defined at `route.ts:329-341` (`buildPriorSessionPromptSection`).
- **Failure mode**: Best-effort. If the database call throws, the route logs `foxy_prior_session_context_failed` and proceeds with empty memory. Episodic memory never blocks the response. Specified at `route.ts:314-321`.
- **Prompt placeholder**: Rendered into `{{previous_session_context}}` of `foxy_tutor_v1`. The placeholder defaults to empty string if the caller did not pass it (`supabase/functions/grounded-answer/pipeline.ts:653-654`), so older clients and non-Foxy callers never see an orphan section header.

This is novel because it gives an LLM-based tutor *long-running* per-relationship memory without requiring a chat history of unbounded length to be replayed in every prompt. The 30-day window is a deliberate forgetting horizon: it matches the lookback window for `recentErrors` (Section 3, dim 5) and `recentMisconceptions` (dim 7) so all student-state signals share a temporal frame.

## 8. Why this is novel

Foxy's defensible novelty is the *deterministic pedagogical scaffolding around the LLM*, not the LLM itself. The system design forces a generic conversational model into a measurable, curriculum-pinned, age-appropriate teaching strategy. The comparisons below are made against the products' publicly-described behavior as of the filing date.

### 8.1 Versus generic LLM tutors (e.g., ChatGPT-as-tutor)

Three technical differences:

1. **Server-side decision tree before the LLM call.** A consumer using ChatGPT as a tutor receives whatever shape the model decides on. Foxy resolves the pedagogy mode (`PREREQUISITE_CHECK` / `MISCONCEPTION_REPAIR` / `STRETCH` / `SOCRATIC` / `NEW_TOPIC`) before the LLM ever sees the prompt — the binding rules at `inline.ts:33-61` are evaluated against the student's mastery state at `route.ts:631-632` and `route.ts:1401`.
2. **Curriculum-pinned retrieval** (Doc 2). Generic LLM tutors answer from training-data knowledge, which is not pinned to a specific board's syllabus. Foxy's retrieval system pins every chunk to `source = 'ncert_2025'` at the SQL layer (`supabase/migrations/20260428000000_match_rag_chunks_ncert_rrf.sql:127`) — a chunk physically cannot leak from a different curriculum.
3. **Closing-question shape enforcement.** ChatGPT's tutoring style is statistical: it sometimes ends with a question, sometimes with a summary. Foxy's prompt rules at `inline.ts:62-70` make the closing question *mandatory* and shape-specific (CHECK vs. SCAFFOLD vs. STRETCH), and the 70/30 vertical/lateral STRETCH rule is a deterministic policy, not a stylistic preference.

### 8.2 Versus flash-card SaaS (Quizlet, Anki)

Three technical differences:

1. **Conversational vs. card-based.** Flash-card products serve fixed cards. Foxy generates per-turn pedagogy from the *combination* of student state and free-form student question — there is no static unit of content.
2. **Bayesian Knowledge Tracing per learning objective.** Anki uses a heuristic SM-2 spacing on cards (we use SM-2 too — see Doc 3 §6 — but for **review scheduling** of mastered concepts, not for selection-of-next-item). Foxy adds a per-LO BKT layer (`student_skill_state.p_know`, `p_slip` — `migration 20260427000100:142-145`) that drives both the decision-tree mode selection and the question-difficulty selection.
3. **Misconception ontology.** Anki cards have no concept of *which misconception* a wrong answer reveals. Foxy's `question_misconceptions` table maps each curated distractor to a named misconception code and a remediation pointer (`migration 20260427000100:96-108`), and the runtime aggregates a per-student `recentMisconceptions` view that drives the `MISCONCEPTION_REPAIR` mode of the decision tree.

### 8.3 Versus Indian competitors (BYJU'S, Vedantu, Unacademy)

Three technical differences:

1. **Server-orchestrated AI tutor vs. video-led pedagogy.** BYJU'S is anchored in pre-recorded video lessons; Vedantu and Unacademy are anchored in live tuition with human teachers. Foxy is a real-time, pure-AI tutor where the pedagogy is determined per turn by deterministic rules. There is no equivalent published mechanism in the Indian K-12 market for runtime mode selection from student state.
2. **NCERT-grounded RAG with strict mode and abstain.** Indian competitors that use AI primarily use generic LLM responses or static FAQ banks. Foxy's retrieval system has a **strict mode** that *abstains* with `chapter_not_ready`, `no_supporting_chunks`, `low_similarity`, `scope_mismatch`, or `circuit_open` instead of guessing — see the abstain branches at `supabase/functions/grounded-answer/pipeline.ts:447, 591, 609, 629, 705, 719, 735`. Refusing to answer when grounded chunks are insufficient is a deliberate quality choice; competitors typically optimize for response rate.
3. **Bilingual code-switching with technical-term lock-in.** Hinglish UX in Indian EdTech is usually marketing copy plus free-form chat in either language. Foxy's policy is enforceable at the prompt level (`inline.ts:107-111`) and is paired with a curriculum-pinned vocabulary contract: every defined CBSE term remains in English so the student's exam exposure is preserved. This rule is strict: if the model is uncertain about Hindi phrasing, it must fall back to Hinglish-Roman rather than invent a Hindi term (`inline.ts:108`). No published Indian EdTech product specifies this contract at the system-prompt level.

---

## Appendix A — Map of files referenced in this document

| Concept | File | Lines |
|---------|------|------|
| Prompt template (decision tree, closing-question, bilingual, distractor pedagogy) | `supabase/functions/grounded-answer/prompts/inline.ts` | 14-184 |
| Pipeline orchestrator (mode resolution, context injection) | `supabase/functions/grounded-answer/pipeline.ts` | 429-760 |
| Cognitive context loader | `src/app/api/foxy/route.ts` | 153-688 |
| Coach-mode resolver | `src/app/api/foxy/route.ts` | 852-868 |
| Episodic memory loader | `src/app/api/foxy/route.ts` | 264-341 |
| Cognitive prompt section builder | `src/app/api/foxy/route.ts` | 692-786 |
| Misconception ontology schema | `supabase/migrations/20260427000100_misconception_ontology.sql` | 23-236 |
| Misconception candidate view | `supabase/migrations/20260428000500_misconception_candidate_view.sql` | 27-77 |
| Foxy safety rails | `src/app/api/foxy/route.ts` | 884-899 |

## Appendix B — Glossary

- **BKT (Bayesian Knowledge Tracing)**: Probabilistic model of student knowledge with four parameters: P(L0) prior, P(T) learn rate, P(slip), P(guess). See Doc 3 §3.
- **Bloom's taxonomy**: Six-level cognitive hierarchy (Remember → Understand → Apply → Analyze → Evaluate → Create). Used in this document for the STRETCH closing-question rule.
- **CBSE**: Central Board of Secondary Education, the national-level board of education in India for grades 1-12.
- **NCERT**: National Council of Educational Research and Training. Publishes the textbooks for the CBSE curriculum.
- **Mastery**: For the purposes of the decision tree, the probability `mastery_probability ∈ [0,1]` from `concept_mastery`. For the per-LO decision (newer surface), `p_know ∈ [0,1]` from `student_skill_state`.
- **Misconception**: A reproducible wrong-answer pattern. Encoded as `misconception_code` (e.g., `confuses_mass_with_weight`) in `question_misconceptions`.
