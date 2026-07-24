# Spec: Lesson Generation Agent (GenAI Phase 5b)

- **Date**: 2026-07-24
- **Owner**: assessment (owns lesson / pedagogy correctness + the WHAT/HOW learner-state boundary). ai-engineer implements the grounded generation + prompt template; frontend renders; testing writes tests; architect owns the flag seed.
- **Status**: SPEC ONLY. NO implementation in this slice — no TS, no tests, no migration, no flag seed, no prompt-template body. The gating flag `ff_lesson_generation_v1` already exists in the registry as **default OFF** (`packages/lib/src/flags/registries/foxy.ts:361`); this spec does not add it.
- **Registry id**: `lesson` — already declared in `packages/lib/src/agents/registry.ts:172` as `status:'planned'`, `audience:'student'`, `decides:'HOW'`, `mayWriteMastery:false`, `capabilities:['format_content','assemble_prompt','select_pedagogy']`, `consumes:{modelGateway:true, studentMemory:true}`. This is the **first student-facing GENERATIVE agent**.
- **Scope this increment**: exactly ONE artifact — **personalized chapter lesson notes / revision notes** (`artifactType:'lesson_notes'`), reusing the sanctioned NCERT-grounded pipeline. Comic lessons, worksheets, mind-maps, and video scripts are DEFERRED (§7).

---

## 0. Non-negotiable design stance

1. **HOW only, never WHAT.** The Lesson agent decides only HOW to present a chapter the caller already chose (format, depth, analogy, worked-example-first vs. Socratic, which misconceptions to call out). It does NOT decide WHICH chapter/concept — the caller (adaptive engine / daily-rhythm orchestrator / student navigation) supplies `subject` + `chapter`. Registry-encoded: `decides:'HOW'`.
2. **Writes NO mastery / progression.** `mayWriteMastery:false`. The lesson agent's source must contain **zero** writes to the 9 `FORBIDDEN_MASTERY_WRITE_TABLES` (`concept_mastery`, `learner_mastery`, `cme_concept_state`, `student_skill_state`, `knowledge_gaps`, `cme_error_log`, `bloom_progression`, `adaptive_mastery`, `student_learning_profiles`). Because the agent flips to `status:'live'`, conformance invariant (e) — the `findMasteryWrites` static scan in `packages/lib/src/agents/registry.ts` — will run against its entry point. It reads memory; it writes nothing.
3. **NCERT-grounded, no free generation.** Every surfaced sentence must come through `callGroundedAnswer` (RAG over `rag_content_chunks`, citations, confidence, abstain). No ungrounded LLM prose reaches a student. Strict mode; **abstain on low confidence reusing the existing thresholds** — `STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` (0.75), `SOFT_CONFIDENCE_BANNER_THRESHOLD` (0.6) from `packages/lib/src/grounding-config.ts`. No new thresholds.
4. **Deterministic safety backstop (P12).** Every rendered field (EN and Hindi) passes `screenStudentFacingText` (`packages/lib/src/ai/validation/output-screen.ts`) at the node layer, on top of the grounded-answer service's own internal output screen — defense in depth.
5. **No new mastery math, no new thresholds.** Adaptation reuses the EXISTING bands: `CognitiveContext.masteryLevel` enum (`'low'|'medium'|'high'`) and the `MASTERY_BUILDING_MAX` (0.4) / `MASTERY_SECURE_MIN` (0.7) / `MASTERY_ZPD_CEILING` (0.85) anchors from `cognitive-engine.ts`, and the `LESSON_STEPS` flow. Bloom's stays the fixed six-level ordered enum.
6. **Bilingual (P7).** Every human-readable field carries EN + Hindi. Technical terms (CBSE, XP, Bloom's, photosynthesis) are not translated.
7. **Flag-gated, additive, default OFF.** `ff_lesson_generation_v1` OFF = the endpoint serves NO generated lesson (disabled/404-style response) — a true no-op. No hot path is touched when OFF.

---

## 1. Inputs — `LessonRequest`

The caller (post-auth, having already enforced `canAccessStudent`) supplies WHAT; the agent decides HOW.

| Field | Type | Meaning / source |
|---|---|---|
| `studentId` | `string` | `students.id`. Authorization is UPSTREAM (like `getStudentMemory`); the agent does not re-authorize. |
| `subject` | `string` | CBSE subject **code** (e.g. `math`, `science`, `physics`, `social_studies`). Must be in the valid set for the grade (§6). No new subjects. |
| `grade` | `string` | **P5: STRING `"6"`..`"12"`, never int.** Validated against `VALID_GRADES`. |
| `chapter` | `{ chapterNumber: number \| null; chapterTitle: string \| null }` | The WHAT — supplied by the caller. Maps directly to the grounded `scope.chapter_number` / `scope.chapter_title`. |
| `artifactType` | `'lesson_notes'` | LITERAL — the only value in this increment. Deferred types listed in §7. |
| `targetBloom?` | `'remember'\|'understand'\|'apply'\|'analyze'\|'evaluate'\|'create'` | Optional anchor for challenge level. Ordered enum; misspelling/reorder is a rejection. When omitted, the agent derives an anchor from mastery band (§2). |
| `depth?` | `'brief'\|'standard'\|'deep'` | Optional length/scaffolding hint. When omitted, derived from `preferences.preferredExplanationDepth`, else `'standard'`. |
| `language` | `'en'\|'hi'` | Drives the primary rendered language; both language fields are always populated (P7). Sourced from `AuthContext.isHi`. |

The agent then reads (read-only, fail-soft) `getStudentMemory(studentId, { subject, grade, chapter })` — the Phase-2 unified memory — for the adaptation signals in §2. Memory read failures degrade to empty and the lesson still generates (grounded, un-personalized), never throws.

---

## 2. Output — `LessonNotes`

A structured, multi-section artifact. Each content section is grounded (carries `Citation[]`) and bilingual. Sections map onto the existing `LESSON_STEPS` flow (`hook → visualization → guided_examples → active_recall → application → spaced_revision`) — no new pedagogy invented.

| Field | Type | Meaning |
|---|---|---|
| `studentId` / `subject` / `grade` / `chapter` | pass-through | `grade` STRING (P5). |
| `artifactType` | `'lesson_notes'` | Echo. |
| `abstained` | `boolean` | `true` when grounding could not support the lesson (§3). When `true`, `sections` is empty and `abstain` is populated. |
| `abstain?` | `{ reason: AbstainReason; suggestedAlternatives: SuggestedAlternative[]; messageEn; messageHi }` | Reuses the grounded-answer abstain shape verbatim. Student sees a safe "notes for this chapter aren't ready yet" envelope + suggested ready chapters. |
| `sections` | `LessonSection[]` | Ordered, adapted set (§2.1). Empty iff `abstained`. |
| `adaptationApplied` | `{ masteryBand: 'low'\|'medium'\|'high'; misconceptionsTargeted: string[]; style: string\|null; depth: 'brief'\|'standard'\|'deep'; bloomAnchor: BloomLevel }` | Observability record of the HOW decision — codes/enums only, no PII. Lets `scoreResponse` and dashboards audit adaptation. |
| `citationsAll` | `Citation[]` | De-duped union of every section's citations (chapter/page provenance). |
| `meta` | `{ traceId; claudeModel; tokensUsed; latencyMs; confidence }` | From the grounded response `meta` + `confidence`. P13-safe. |

### 2.1 `LessonSection` shape

Each section: `{ kind; headingEn; headingHi; bodyEn; bodyHi; citations: Citation[]; bloomLevel: BloomLevel }`. The `kind` set for `lesson_notes`:

| `kind` | LESSON_STEP source | Content | Adapted by |
|---|---|---|---|
| `hook` | `hook` | 1–2 line curiosity/real-life hook for the chapter. | present always; tone by `learningStyle`. |
| `core_concepts` | `visualization` + `guided_examples` | The chapter's key concepts, each with a worked example. | low mastery → **worked-example-first**, more steps; high mastery → concise + enrichment. |
| `misconception_callouts` | (Eedi-style, from `recentMisconceptions`) | ONE targeted callout per the student's top misconceptions — names it gently, contrasts wrong vs. right, grounded. | present ONLY if `cognitive.recentMisconceptions` non-empty; seeded by each item's `remediationText` but content still NCERT-grounded. |
| `active_recall` | `active_recall` | 2–3 recall questions (predict-before-reveal framing). | count/difficulty scales with mastery band. |
| `application` | `application` | 1–2 CBSE board-style application items. | included for `medium`/`high`; softened/optional for `low`. |
| `revision_summary` | `spaced_revision` | Key points, formulas, common mistakes. | always present; the "revision notes" core. |

`BloomLevel` is the fixed ordered enum `remember < understand < apply < analyze < evaluate < create`. Section `bloomLevel` values progress non-decreasingly across the artifact (hook/core = remember/understand, examples/recall = understand/apply, application = apply/analyze), anchored/capped by `targetBloom` and mastery band (§2.2). Bloom's progression stays sequential.

---

## 2.2 Adaptation — memory → lesson shape (reuse existing bands, NO new thresholds)

`getStudentMemory` returns `cognitive` (`CognitiveContext`), `preferences`, `twin`, `longMemory`. Mapping:

| Signal (source) | Band / value | HOW it changes the lesson |
|---|---|---|
| `cognitive.masteryLevel` (enum `'low'`) — the platform's `< MASTERY_BUILDING_MAX` (0.4) region | **low** | Worked-example-**first** `core_concepts`; more scaffolding steps; simpler analogies; `bloomAnchor` held at `remember`/`understand`; `application` softened/optional. |
| `cognitive.masteryLevel` (`'medium'`) — the ZPD sweet spot between 0.4 and `MASTERY_SECURE_MIN`/`MASTERY_ZPD_CEILING` | **medium** | Balanced: concept → example → recall → application; `bloomAnchor` up to `apply`. |
| `cognitive.masteryLevel` (`'high'`) — `>= MASTERY_SECURE_MIN` (0.7) | **high** | Challenge/enrichment: concise concepts, harder application, stretch questions; `bloomAnchor` up to `analyze`/`evaluate`; fewer scaffolds. |
| `cognitive.recentMisconceptions` `[{code,label,count,remediationText}]` (top 3) | non-empty | Emit one `misconception_callouts` section item per misconception, seeded from `remediationText`, contrasting wrong vs. right — grounded. Recorded in `adaptationApplied.misconceptionsTargeted` (codes only). |
| `cognitive.weakTopics` / `knowledgeGaps` | present | Bias `core_concepts` emphasis toward the weak/prerequisite topic within the chapter (still HOW — it re-orders emphasis, does not change WHICH chapter). |
| `preferences.learningStyle` (`student_learning_profiles.learning_style`, e.g. `visual`/`balanced`) | non-null | Tone + analogy channel (visual analogy vs. narrative). Advisory only — never asserts mastery. |
| `preferences.preferredExplanationDepth` (`preferred_explanation_depth`, e.g. `short`/`medium`/`deep`) | non-null | Maps to `depth` when `LessonRequest.depth` omitted → controls section length / max_tokens. |
| `longMemory` / `twin` | present | Optional continuity flavor (e.g. "last month you found X tricky") — grounded/scrubbed via the existing per-slice renderers; never overrides the chapter WHAT. |

All bands and personas are REUSED. The agent introduces no numeric literal that acts as a threshold. The `low/medium/high` decision is `cognitive.masteryLevel` verbatim (already derived by the memory layer from the 0.4/0.7 anchors); the agent does not re-derive mastery.

---

## 3. Grounding + safety pipeline (the sanctioned path)

Per `lesson_notes` request, when `ff_lesson_generation_v1` is ON:

```
1. Validate LessonRequest  (grade string ∈ VALID_GRADES; subject ∈ grade's valid set; artifactType='lesson_notes').
2. getStudentMemory(studentId, {subject, grade, chapter})  — read-only, fail-soft, DPDP erasure-guarded.
3. Decide HOW → adaptationApplied (mastery band, misconceptions, style, depth, bloomAnchor)  [§2.2].
4. Build template_variables (§3.1) and call callGroundedAnswer(...) ONCE  [§3.2].
5. If grounded === false  → ABSTAIN (surface abstain envelope + suggested_alternatives).  [§3.3]
   If grounded === true AND confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD (0.75) → ABSTAIN.
   Else parse the structured multi-section payload into LessonSection[] + citations.
6. NODE-SIDE BACKSTOP: run screenStudentFacingText on EVERY rendered field (headingEn/Hi, bodyEn/Hi)  [§3.4].
   Any section returning safe:false → drop it and replace with the safe-abstain envelope for that section;
   if the whole lesson is unsafe → whole-lesson abstain. Log CATEGORY-ONLY (P13), never the text.
7. Return LessonNotes.
```

### 3.1 New registered prompt template — `lesson_notes_v1`

- Add `'lesson_notes_v1'` to `REGISTERED_PROMPT_TEMPLATES` (both `packages/lib/src/grounding-config.ts` and `supabase/functions/grounded-answer/config.ts` — kept in sync by the config-parity CI check). Owned by ai-engineer in the implementation slice; NOT written here.
- It extends the existing teaching-template family (`foxy_tutor_teach_v1`), producing a **structured JSON multi-section lesson** (the same structured-output discipline as `FOXY_STRUCTURED_OUTPUT_PROMPT`) so the agent gets a parseable `LessonSection[]` from ONE grounded call.
- `template_variables` (all strings, per the grounded contract): `grade`, `subject`, `chapter_suffix`, `board`, `mastery_band` (`low|medium|high`), `depth` (`brief|standard|deep`), `learning_style`, `bloom_anchor`, `misconception_list` (labels + remediation seeds, PII-free), `section_plan` (which `kind`s to emit for this band), `language`.

### 3.2 The grounded call (`callGroundedAnswer`)

- `caller`: a NEW `'lesson'` caller value added to the `Caller` type + `VALID_CALLERS` (both files, parity-checked). Preferred over reusing `'concept-engine'` for clean attribution/observability; reusing `'concept-engine'` is an acceptable zero-enum-change fallback. Downstream (ai-engineer/architect) decision.
- `student_id`: the student (personalization present).
- `cache_scope`: **`'none'`** (the fail-closed default) — see §5. Lesson notes are per-student personalized, so shared caching is prohibited.
- `scope`: `{ board:'CBSE', grade, subject_code: subject, chapter_number, chapter_title }`.
- `mode`: **`'strict'`** — student-facing generated content must ground or abstain (never soft-fall-back to general knowledge).
- `generation`: `{ model_preference:'auto', max_tokens` scaled by `depth`, `temperature` low, `system_prompt_template:'lesson_notes_v1', template_variables }`.
- `retrieval`: `{ match_count: RAG_MATCH_COUNT (5) }` — no override.
- ONE call per lesson (single RAG retrieval) — respects the cost/latency budget and the spirit of the Foxy single-retrieval contract (REG-50). Per-section grounding is a DEFERRED optimization (§7).

### 3.3 Abstain behavior

Reuses the grounded thresholds — introduces none. Abstain (whole lesson) when EITHER: (a) `grounded === false` (the strict pipeline already abstains on `no_chunks_retrieved` / `low_similarity` / `scope_mismatch` / `chapter_not_ready` / `upstream_error` / `circuit_open`), OR (b) `grounded === true` but `confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` (0.75). On abstain, surface the grounded `suggested_alternatives` (ready chapters) and a bilingual safe message. A `misconception_callouts` item that individually can't be grounded is dropped (not fabricated), not the whole lesson.

### 3.4 Node-side safety backstop

`screenStudentFacingText(text, { grade, subject })` runs on every rendered field. It hard-blocks only word-boundary profanity/slurs/self-harm/injection tokens (safe for CBSE vocabulary like class/shell/sexual-reproduction). `safe:false` (`blocklist` or `screen_error`) → section dropped/replaced; category-only telemetry, never the text (P13). This is IN ADDITION to the grounded-answer Edge Function's own internal output screen — defense in depth for the first student-facing generative surface.

---

## 4. Quality guardrails — what makes a lesson "good"

A `lesson_notes` artifact is acceptable only if ALL hold:

1. **Accurate** — every section grounded from retrieved NCERT chunks (`groundedFromChunks:true`, citations present); confidence ≥ 0.75 or abstain.
2. **Curriculum-aligned** — passes the grade/subject scope gate; `subject` in the grade's valid set; stays within the requested chapter.
3. **Grounded / cited** — every content section carries ≥ 1 `Citation`; ungroundable sections are dropped, never fabricated.
4. **Age-appropriate** — passes `screenStudentFacingText` on all EN + Hindi fields; tone appropriate for grades 6–12.
5. **Adapted** — `adaptationApplied` reflects the student's mastery band, misconceptions, and preferences (not a generic chapter dump).
6. **Bilingual** — EN + Hindi populated for every human-readable field (P7).
7. **Bloom-consistent** — section `bloomLevel`s use the correct spelling and non-decreasing order, anchored by mastery band / `targetBloom`.

**Observability (not enforcement):** the Phase-4 `scoreResponse` sensor (`packages/lib/src/ai/eval/response-eval.ts`) can score this artifact from the same PII-free signals the grounded call already produces — `curriculum_alignment`, `hallucination_risk`, `age_appropriateness`, `toxicity`, `latency`, `cost`, plus `difficulty_fit` from mastery. `accuracy` and `learning_effectiveness` remain DEFERRED to the nightly Sonnet judge. `scoreResponse` NEVER blocks/alters the lesson — enforcement stays with the grounded strict-mode abstain (§3.3) and the `screenStudentFacingText` backstop (§3.4). `flagged` is a dashboard signal only.

---

## 5. Caching / storage decision

**Decision: ephemeral, no persistence in v1. `cache_scope:'none'`. No `generated_lessons` table.**

Justification:
- Lesson notes inject per-student personalization (mastery band, misconceptions, learning style, depth) into `template_variables`. The response-cache v2 contract requires `cache_scope:'shared'` to assert **no** per-student personalization; that assertion is FALSE here, so `cache_scope` MUST be `'none'` (the fail-closed default) — no shared cache read, no shared cache write. Even if we tried to cache, the per-student generation-context key would differ per student → ~zero hit rate. `'none'` is the honest, correct setting.
- Not persisting server-side means: no new table, no migration, no new RLS surface, no PII-at-rest, no DPDP erasure obligation for generated lesson text, and no P8 boundary to design — keeping this slice maximally additive and low-risk. The generated lesson is rendered to the requesting student and held only in the client/session; regenerating is cheap relative to the risk of a persisted per-student content store.
- **Deferred (later increment, needs architect):** a `generated_lessons` table (RLS: student + linked parent + assigned teacher + admin; DPDP erasure coverage; cache-key = student × chapter × adaptation-signature × prompt-rev) to enable history, offline access, and parent-share. Explicitly OUT of scope here.

---

## 6. CBSE scope guard (no new subjects, no new grades)

- **Grades 6–10** valid subject codes: `math`, `science`, `english`, `hindi`, `social_studies`.
- **Grades 11–12** valid subject codes: `physics`, `chemistry`, `biology`, `math`, `economics`, `accountancy`, `business_studies`, `political_science`, `history_sr`, `geography`, `english`, `computer_science`, `coding`.
- `LessonRequest.subject` must be in the valid set for `LessonRequest.grade`; otherwise reject before any grounded call. Grades are strings `"6"`..`"12"` (P5). Adding any NEW CBSE subject or grade is a product decision requiring CEO/architect approval — OUT of scope.

---

## 7. Scope guard + deferred artifacts

**In scope (this increment):** ONE artifact `lesson_notes`; default-OFF flag `ff_lesson_generation_v1`; read-only (`mayWriteMastery:false`, zero forbidden-table writes, scanned by conformance invariant (e)); NCERT-grounded strict mode with abstain; bilingual; existing CBSE subjects/grades only.

**Deferred (each a later increment):**
- Comic lessons, worksheets, mind-maps, video scripts (other `artifactType`s).
- Per-section independent grounding (>1 RAG retrieval) for tighter per-section citations.
- `generated_lessons` persistence table + history/offline/parent-share (needs architect: schema, RLS, DPDP erasure).
- Multi-chapter / cross-chapter lesson synthesis (would touch the WHAT boundary — needs explicit design).

---

## 8. Ownership / follow-ups (NOT in this slice)

| Piece | Owner |
|---|---|
| `lesson_notes_v1` prompt template body + structured-output contract | **ai-engineer** (assessment reviews pedagogy/correctness) |
| Extend grounded-answer structured-parse gate to the `lesson` caller | **ai-engineer** |
| Add `'lesson'` to `Caller` type + `VALID_CALLERS` (both files, config-parity) | **ai-engineer / architect** |
| Lesson agent module + orchestration (grounded call, adaptation, node-side backstop) | **ai-engineer + assessment** |
| API route (auth, `canAccessStudent`, flag gate, memory read, calls the agent) | **backend** |
| Registry flip `planned → live` + `entryPoint` + `gatingFlag:'ff_lesson_generation_v1'` | **ai-engineer** (triggers conformance invariant (e) `findMasteryWrites` scan) |
| Student-facing lesson-notes UI (bilingual render, abstain/suggested-alt states, citations) | **frontend** |
| `ff_lesson_generation_v1` seed migration (default OFF) | **architect** |
| Unit + E2E tests (abstain ladder, adaptation mapping, safety backstop, mastery-write scan, bilingual, Bloom order) | **testing** |
| Whether generated lessons should persist (`generated_lessons`) | **architect / CEO** (§5, deferred) |
| Any new CBSE subject/grade | **CEO / architect** (§6, out of scope) |

**Review chain (P14):** learner-state / student-facing generative agent → assessment (this spec) → ai-engineer (implements) + frontend (renders) + testing (tests); architect for the flag seed. No cross-agent notification is required for a spec-only slice.

Files: spec `docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md`. Reused building blocks (unchanged): `packages/lib/src/ai/grounded-client.ts`, `packages/lib/src/grounding-config.ts`, `apps/host/src/lib/memory/student-memory.ts`, `packages/lib/src/cognitive-engine.ts` (`LESSON_STEPS`, mastery anchors), `packages/lib/src/ai/validation/output-screen.ts`, `packages/lib/src/ai/eval/response-eval.ts`, `packages/lib/src/agents/registry.ts` (`lesson` descriptor), `packages/lib/src/flags/registries/foxy.ts` (`ff_lesson_generation_v1`).
