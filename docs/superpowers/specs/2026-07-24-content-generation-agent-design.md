# Spec: Content Generation Agent — NCERT-Grounded Structured Visual (GenAI Phase 5c)

- **Date**: 2026-07-24
- **Owner**: assessment (owns pedagogy/content correctness + the WHAT/HOW boundary). ai-engineer implements the grounded generation + `diagram_spec_v1` prompt template + registry flip; frontend renders (the `mermaid` block already renders via `FoxyStructuredRenderer`); testing writes tests; architect owns the flag seed and any registry-descriptor reconciliation.
- **Status**: SPEC ONLY. NO implementation in this slice — no TS, no tests, no migration, no flag seed, no prompt-template body. The gating flag `ff_content_generation_v1` does **not** yet exist in the registry (`packages/lib/src/flags/registries/foxy.ts` currently seeds only `ff_lesson_generation_v1`); adding it (default OFF) is an implementation-slice task, not this spec.
- **Registry id**: `content_generation` — already declared in `packages/lib/src/agents/registry.ts:199` but **as an admin bulk-gen consolidator** (`audience:'admin'`, `decides:'HOW'`, `mayWriteMastery:false`, `consumes:{modelGateway:true, studentMemory:false}`, `status:'planned'`, `capabilities:['generate_content','generate_questions']`). This student-facing, memory-reading diagram agent CONFLICTS with that descriptor (see §8 — the descriptor must be reconciled or a distinct id minted before the registry flip; assessment flags this, architect/ai-engineer decides).
- **Scope this increment**: exactly ONE artifact — a **single NCERT-grounded Mermaid DIAGRAM** (`artifactType:'diagram'`), reusing the sanctioned grounded pipeline and the EXISTING `mermaid` block renderer. Raster/image generation, raw SVG, multi-diagram, infographics/animations, and persistence are DEFERRED (§7).

This spec mirrors the just-shipped Phase-5b Lesson Generation Agent (`docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md`) — same grounded-or-abstain stance, same read-only posture, same ephemeral storage, same eval treatment. Where the lesson agent emits bilingual prose sections, this agent emits one validated Mermaid diagram spec.

---

## 0. Non-negotiable design stance

1. **HOW only, never WHAT.** The Content Generation agent decides only HOW to *visualize* a chapter the caller already chose — which diagram type (flowchart / mindmap / timeline), how many nodes, how it branches. It does NOT decide WHICH chapter/concept — the caller (adaptive engine / daily-rhythm / student navigation) supplies `subject` + `chapter`. Registry-encoded: `decides:'HOW'`.
2. **Writes NO mastery / progression.** `mayWriteMastery:false`. Zero writes to the 9 `FORBIDDEN_MASTERY_WRITE_TABLES`. When the registry entry flips to `status:'live'` with a real `entryPoint`, conformance invariant (e) — the `findMasteryWrites` static scan in `packages/lib/src/agents/registry.ts` — runs against the entry point. It reads memory; it writes nothing.
3. **NCERT-grounded, no free generation.** The diagram's nodes/edges/labels must come through `callGroundedAnswer` (RAG over `rag_content_chunks`, citations, confidence, abstain). **Only depict what is in the retrieved NCERT chunks; OMIT — never fabricate — any node that cannot be grounded.** Strict mode; abstain on low confidence reusing the EXISTING `STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` (0.75) from `packages/lib/src/grounding-config.ts`. No new thresholds.
4. **Two safety gates, in order (P12).** (a) The generated Mermaid **CODE** must pass the EXISTING `validateMermaidCode` injection/grammar gate (`packages/lib/src/foxy/schema.ts`) — allowlisted header, no `<script>`/`javascript:`/`click ` callback/`%%{init}` override of `htmlLabels`/`securityLevel`, ≤ `FOXY_MAX_MERMAID_CODE_LEN` (2000) chars. Invalid → drop/abstain, never render, **no raw-SVG fallback.** (b) Every human-readable **LABEL / title / caption** (and the whole `mermaidCode` string, whose node labels are user-facing) must pass `screenStudentFacingText` (age/toxicity, `packages/lib/src/ai/validation/output-screen.ts`). This is IN ADDITION to the grounded-answer Edge Function's own internal output screen — defense in depth for a student-facing generative surface.
5. **No new visualization primitive, Mermaid ONLY.** The client already renders `mermaid` blocks via `FoxyStructuredRenderer` (`securityLevel:'strict'`, `htmlLabels:false`). No image-gen provider exists (raster = CEO-approval boundary, deferred). No SVG sanitizer exists in the repo (raw SVG = prohibited, deferred). Diagram kinds are constrained to the v1 set (§2).
6. **Bilingual (P7).** `titleEn`/`titleHi` and `captionEn`/`captionHi` are ALWAYS both populated. The single `mermaidCode`'s in-diagram node labels are rendered in the student's requested `language`; a language toggle is a re-request (same convention Foxy uses). Technical terms (CBSE, XP, Bloom's, photosynthesis) are not translated. Dual-language-labels-in-one-diagram is a deferred option (§7).
7. **Flag-gated, additive, default OFF.** `ff_content_generation_v1` OFF = the endpoint serves NO generated diagram (disabled/404-style response) — a true no-op. No hot path is touched when OFF.

---

## 1. Inputs — `DiagramRequest`

The caller (post-auth, having already enforced `canAccessStudent`) supplies WHAT; the agent decides HOW. Mirrors `LessonRequest`.

| Field | Type | Meaning / source |
|---|---|---|
| `studentId` | `string` | `students.id`. Authorization is UPSTREAM (like `getStudentMemory`); the agent does not re-authorize. |
| `subject` | `string` | CBSE subject **code** (e.g. `math`, `science`, `physics`, `social_studies`, `history_sr`). Must be in the valid set for the grade (§6). No new subjects. |
| `grade` | `string` | **P5: STRING `"6"`..`"12"`, never int.** Validated against `VALID_GRADES`. |
| `chapter` | `{ chapterNumber: number; chapterTitle: string }` | The WHAT — supplied by the caller. Maps to the grounded `scope.chapter_number` / `scope.chapter_title`. |
| `artifactType` | `'diagram'` | LITERAL — the only value in this increment. |
| `diagramType?` | `'flowchart' \| 'mindmap' \| 'timeline'` | Optional caller **HOW hint**. When provided AND in the v1 set, it is HONORED (§2). When omitted, the agent selects from chapter content (§2.1). |
| `language` | `'en' \| 'hi'` | Drives the in-diagram node-label language; `titleEn/Hi` + `captionEn/Hi` are always both populated (P7). Sourced from `AuthContext.isHi`. |

The agent then reads (read-only, fail-soft) `getStudentMemory(studentId, { subject, grade, chapter })` — the Phase-2 unified memory — for the light adaptation signals in §2.2. Memory read failures degrade to empty and the diagram still generates (grounded, un-personalized), never throws.

---

## 2. Output — `DiagramSpec`

A single validated Mermaid diagram spec. Mirrors the abstain/meta shape of `LessonNotes`. **Single diagram only — multi-diagram is a later increment (§7).**

| Field | Type | Meaning |
|---|---|---|
| `abstained` | `boolean` | `true` when grounding could not support the diagram OR either safety gate failed (§3). When `true`, `mermaidCode` is empty/absent and `abstain` is populated. |
| `abstain?` | `{ reason: AbstainReason; suggestedAlternatives: SuggestedAlternative[]; messageEn; messageHi }` | Reuses the grounded-answer abstain shape verbatim. Student sees a safe "a diagram for this chapter isn't ready yet" envelope + suggested ready chapters. |
| `mermaidCode` | `string` | The validated Mermaid source. Leads with an allowlisted header, passes `validateMermaidCode`, ≤ 2000 chars. Empty/absent iff `abstained`. Renders as-is in the existing `mermaid` block. |
| `diagramKind` | `'flowchart' \| 'mindmap' \| 'timeline'` | The kind actually emitted (the Mermaid header token). Constrained to the v1 set even though `validateMermaidCode` allows more headers. |
| `titleEn` / `titleHi` | `string` | Bilingual diagram title (P7). Passes `screenStudentFacingText`. |
| `captionEn` / `captionHi` | `string` | Bilingual one-line caption / what the diagram shows (P7). Passes `screenStudentFacingText`. |
| `citations` | `Citation[]` | De-duped NCERT provenance (chapter/page) for the depicted nodes. ≥ 1 when not abstained. |
| `meta` | `{ traceId?; model?; tokens?; latency?; confidence? }` | From the grounded response `meta` + `confidence`. P13-safe — codes/enums only, no PII. |

> Note: unlike `LessonNotes` there is no per-section Bloom sequencing — a single diagram is one structural artifact, not an ordered pedagogy flow. Correctness for a diagram = grounded + curriculum-scoped + the right structure for the content, enforced by grounding (§3) and the diagram-type rule (§2.1), not by a Bloom ladder.

### 2.1 Diagram-type selection rule (HOW-only)

The caller may pass `diagramType`; when present and in the v1 set it is HONORED. When omitted, the agent picks from the chapter content using this heuristic (this is a *presentation* decision — it does not change WHICH chapter):

| Emit `diagramKind` | When the chapter content is fundamentally… | Typical CBSE examples |
|---|---|---|
| `flowchart` (Mermaid `flowchart`/`graph`) | a **process, cycle, cause→effect, or step sequence** — "how X works", a mechanism, an algorithm | water cycle, digestion, photosynthesis, reflex arc, how a bill becomes law, an algorithm's control flow |
| `mindmap` (Mermaid `mindmap`) | a **concept map / classification / branching hierarchy** — "types of", an overview of a chapter's subtopics | kinds of triangles, classification of matter, parts of speech, branches of government, chapter overview |
| `timeline` (Mermaid `timeline`) | a **chronological sequence of dated events** | the freedom struggle, French Revolution events, evolution of computing, a reign/dynasty sequence |

Selection is HOW-only: it chooses a lens on content the caller already fixed; it never substitutes a different chapter/concept. If a caller override is given but the grounded content doesn't populate that shape well, the override is still honored (it is a HOW hint) — the grounded chunks determine which nodes exist; ungroundable nodes are omitted. The v1 set is deliberately narrow; other `MERMAID_ALLOWED_HEADERS` (sequenceDiagram, classDiagram, stateDiagram, erDiagram, pie, journey, quadrantChart, gitGraph) are DEFERRED (§7) so the pedagogy of "when to use which visual" stays reviewable.

### 2.2 Memory adaptation (light — reuse existing bands, NO new thresholds)

`getStudentMemory` returns `cognitive` (`CognitiveContext`) + `preferences`. Only two signals adapt the diagram, and both change PRESENTATION density (like the lesson agent's `depth` → `max_tokens`), never mastery:

| Signal (source) | Band / value | HOW it changes the diagram |
|---|---|---|
| `cognitive.masteryLevel` (`'low' \| 'medium' \| 'high'` — already derived by the memory layer from the platform's 0.4/0.7 mastery anchors) | `low` | **Simpler / fewer nodes** — a smaller node budget, one level of branching, the core spine only. `medium`/`high` → richer, more branches, secondary detail. |
| `preferences.learningStyle` (`student_learning_profiles.learning_style`, e.g. `visual`) | `visual` | Lean **richer** — a slightly larger node budget / more descriptive labels, since the diagram is this student's preferred channel. Non-visual → keep it lean. |

The node-budget numbers are PRESENTATION parameters passed into the prompt (a max-node hint), analogous to `max_tokens`-by-`depth` in the lesson agent — they are **not** new mastery thresholds and do not re-derive mastery. `masteryLevel` is consumed verbatim. No numeric literal in this agent acts as a mastery gate.

---

## 3. Grounding + dual-safety pipeline (the sanctioned path)

Per `diagram` request, when `ff_content_generation_v1` is ON:

```
1. Validate DiagramRequest  (grade string ∈ VALID_GRADES; subject ∈ grade's valid set;
   artifactType='diagram'; diagramType — if present — ∈ {flowchart,mindmap,timeline}).
2. getStudentMemory(studentId, {subject, grade, chapter})  — read-only, fail-soft, DPDP erasure-guarded.
3. Decide HOW → diagramKind (§2.1: caller override else content heuristic) + node budget (§2.2).
4. Build template_variables (§3.1) and call callGroundedAnswer(...) ONCE  [§3.2].
5. If grounded === false  → ABSTAIN (surface abstain envelope + suggested_alternatives).  [§3.3]
   If grounded === true AND confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD (0.75) → ABSTAIN.
   Else parse the structured payload → { mermaidCode, diagramKind, titleEn/Hi, captionEn/Hi, citations }.
6. SAFETY GATE 1 (structure/injection): validateMermaidCode(mermaidCode).
      Non-null error  → ABSTAIN. NO raw-SVG fallback, NO re-prompt loop in v1. Also enforce
      diagramKind ∈ {flowchart,mindmap,timeline} (the first header token) — otherwise ABSTAIN.
7. SAFETY GATE 2 (age/toxicity): screenStudentFacingText(x, {grade, subject}) on
      titleEn, titleHi, captionEn, captionHi, AND the whole mermaidCode string
      (its node labels are user-facing text).
      Any safe:false (blocklist | screen_error) → ABSTAIN. Log CATEGORY-ONLY (P13), never the text.
8. Return DiagramSpec.
```

Both gates must pass; either failing → whole-diagram abstain (a diagram is atomic — there is no "drop one node and keep the rest" at the client, and silently editing generated Mermaid would break grounding provenance). Gate 1 runs before Gate 2 (no point screening structurally-invalid code).

### 3.1 New registered prompt template — `diagram_spec_v1`

- Add `'diagram_spec_v1'` to `REGISTERED_PROMPT_TEMPLATES` in BOTH `packages/lib/src/grounding-config.ts` and `supabase/functions/grounded-answer/config.ts` (kept in sync by the config-parity CI check). Owned by ai-engineer in the implementation slice; the template BODY is NOT written here.
- It must instruct the model to return a structured payload containing a Mermaid `mermaidCode` string that **(a) leads with the chosen v1 header (`flowchart`/`graph`, `mindmap`, or `timeline`), (b) depicts ONLY grounded nodes, (c) contains no `click`/`<script>`/`javascript:`/`%%{init}` constructs, (d) keeps node labels short and free of markdown/`$`-delimiters** — so the output survives `validateMermaidCode` on the first pass — plus `titleEn/Hi` and `captionEn/Hi`. The same structured-output discipline as `FOXY_STRUCTURED_OUTPUT_PROMPT`; the agent gets a parseable spec from ONE grounded call.
- `template_variables` (all strings, per the grounded contract): `grade`, `subject`, `chapter_suffix`, `board`, `diagram_kind` (`flowchart|mindmap|timeline`), `max_nodes` (presentation budget from §2.2), `learning_style`, `language`.

### 3.2 The grounded call (`callGroundedAnswer`)

- `caller`: a NEW `'diagram'` (or `'content'`) caller value added to the `Caller` type + `VALID_CALLERS` (both `grounding-config.ts` and the Deno `config.ts`, parity-checked) for clean attribution; reusing `'concept-engine'`/`'lesson'` is an acceptable zero-enum-change fallback. Downstream (ai-engineer/architect) decision.
- `student_id`: the student (personalization present — mastery band / learning style).
- `cache_scope`: **`'none'`** (the fail-closed default) — see §4.
- `scope`: `{ board:'CBSE', grade, subject_code: subject, chapter_number, chapter_title }`.
- `mode`: **`'strict'`** — student-facing generated content must ground or abstain (never soft-fall-back to general knowledge / fabricated nodes).
- `generation`: `{ model_preference:'auto', max_tokens` sized for one diagram (small), `temperature` low, `system_prompt_template:'diagram_spec_v1', template_variables }`.
- `retrieval`: `{ match_count: RAG_MATCH_COUNT (5) }` — no override.
- ONE call per diagram (single RAG retrieval) — respects the cost/latency budget and the spirit of the Foxy single-retrieval contract (REG-50).

### 3.3 Abstain behavior

Reuses the grounded thresholds — introduces none. Abstain when ANY of: (a) `grounded === false` (the strict pipeline already abstains on `no_chunks_retrieved` / `low_similarity` / `scope_mismatch` / `chapter_not_ready` / `upstream_error` / `circuit_open`); (b) `grounded === true` but `confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` (0.75); (c) Gate 1 `validateMermaidCode` returns an error or the header is outside the v1 set; (d) Gate 2 `screenStudentFacingText` returns `safe:false` on any field. On abstain, surface the grounded `suggested_alternatives` (ready chapters) and a bilingual safe message. **No raw-SVG / raster fallback** — abstain is the only failure mode.

### 3.4 Why abstain (not repair) on a bad Mermaid

Silently editing a model-produced Mermaid to make it pass `validateMermaidCode` would (a) risk depicting relationships the NCERT chunks don't support (breaking grounding provenance) and (b) reintroduce the class of "server rewrites generative content" risk. v1 chooses the safe, honest path: an invalid or unsafe diagram abstains and the student sees the ready-chapter alternatives. A bounded single re-prompt is a possible later optimization (§7), not v1.

---

## 4. Caching / storage decision

**Decision: ephemeral, no persistence in v1. `cache_scope:'none'`. No new table.** Identical rationale to the Phase-5b lesson agent.

Justification:
- The diagram injects per-student personalization (mastery band → node budget, learning style → density, requested `language`) into `template_variables`. The response-cache v2 contract requires `cache_scope:'shared'` to assert **no** per-student personalization; that assertion is FALSE here, so `cache_scope` MUST be `'none'` (fail-closed default) — no shared cache read, no shared cache write. A per-student generation-context key would differ per student → ~zero hit rate anyway. `'none'` is the honest, correct setting.
- Not persisting means: no new table, no migration, no new RLS surface, no PII-at-rest, no DPDP erasure obligation for generated diagram text, and no P8 boundary to design — keeping this slice maximally additive and low-risk. The diagram is rendered to the requesting student and held only in the client/session; regenerating is cheap (one small grounded call).
- **Deferred (later increment, needs architect):** a `generated_diagrams` table (RLS: student + linked parent + assigned teacher + admin; DPDP erasure; cache-key = student × chapter × diagramKind × adaptation-signature × prompt-rev) to enable history / offline / parent-share. Explicitly OUT of scope.

---

## 5. Eval treatment

- The Phase-4 `scoreResponse` sensor (`packages/lib/src/ai/eval/response-eval.ts`) CAN score this artifact from the same PII-free signals the grounded call already produces: `curriculum_alignment`, `hallucination_risk`, `age_appropriateness`, `toxicity`, `latency`, `cost`. `accuracy` / `learning_effectiveness` remain DEFERRED to the nightly Sonnet judge.
- **There is NO diagram-structural eval dimension.** Whether the Mermaid is *valid/renderable* is decided deterministically by `validateMermaidCode` at generation time (Gate 1), not by the eval harness — a rendered diagram is valid-by-construction because invalid ones abstain before ever reaching a student. `scoreResponse` NEVER blocks/alters the diagram; enforcement stays with the strict-mode abstain (§3.3) and the two safety gates (§3). `flagged` is a dashboard signal only.

---

## 6. CBSE scope guard (no new subjects, no new grades)

- **Grades 6–10** valid subject codes: `math`, `science`, `english`, `hindi`, `social_studies`.
- **Grades 11–12** valid subject codes: `physics`, `chemistry`, `biology`, `math`, `economics`, `accountancy`, `business_studies`, `political_science`, `history_sr`, `geography`, `english`, `computer_science`, `coding`.
- `DiagramRequest.subject` must be in the valid set for `DiagramRequest.grade`; otherwise reject before any grounded call. Grades are strings `"6"`..`"12"` (P5). Adding any NEW CBSE subject or grade is a product decision requiring CEO/architect approval — OUT of scope.

---

## 7. Scope guard + deferred artifacts

**In scope (this increment):** exactly ONE artifact — a single NCERT-grounded Mermaid `diagram`; **Mermaid ONLY** (no SVG, no raster); v1 kinds constrained to `flowchart` / `mindmap` / `timeline`; default-OFF `ff_content_generation_v1`; read-only (`mayWriteMastery:false`, zero forbidden-table writes, scanned by conformance invariant (e)); NCERT-grounded strict mode with abstain; TWO safety gates (`validateMermaidCode` + `screenStudentFacingText`); bilingual title/caption; student-self; existing CBSE subjects/grades only.

**Deferred (each a later increment):**
- **Raster / AI image generation** — needs an image-gen provider that does not exist → **CEO-approval boundary.** Not designed here.
- **Raw SVG output** — no SVG sanitizer exists in the repo → prohibited.
- Additional Mermaid kinds beyond the v1 three (sequenceDiagram, classDiagram, stateDiagram, erDiagram, pie, journey, quadrantChart, gitGraph).
- **Multi-diagram** per request (e.g. a diagram set for a chapter) and per-diagram independent grounding (>1 RAG retrieval).
- Dual-language node labels within a single diagram (bracketed EN/Hi) — v1 renders labels in the requested `language`, toggle = re-request.
- A bounded single re-prompt when Gate 1 fails (instead of straight abstain).
- `generated_diagrams` persistence + history/offline/parent-share (needs architect: schema, RLS, DPDP erasure).
- Infographics / animations.

---

## 8. Ownership / follow-ups (NOT in this slice)

| Piece | Owner |
|---|---|
| `diagram_spec_v1` prompt template body + structured-output contract (must emit `validateMermaidCode`-passing code) | **ai-engineer** (assessment reviews pedagogy/diagram-choice correctness) |
| Extend grounded-answer structured-parse gate to the `diagram`/`content` caller | **ai-engineer** |
| Add the new caller to `Caller` type + `VALID_CALLERS` (both files, config-parity) | **ai-engineer / architect** |
| Content Generation agent module + orchestration (grounded call, HOW selection, node budget, dual safety gates) | **ai-engineer + assessment** |
| API route (auth, `canAccessStudent`, flag gate, memory read, calls the agent) | **backend** |
| **Registry-descriptor reconciliation** — the existing `content_generation` entry is `audience:'admin'` / `studentMemory:false` / `status:'planned'`; this student-facing, memory-reading diagram agent needs the descriptor updated (audience `student`, `studentMemory:true`, add `format_content`, set `entryPoint` + `gatingFlag:'ff_content_generation_v1'`, flip `planned → live`) OR a distinct registry id minted. Triggers conformance invariant (e) `findMasteryWrites`. | **ai-engineer / architect** (assessment flags; §0) |
| Student-facing diagram UI (renders the existing `mermaid` block; abstain/suggested-alt state; bilingual title/caption) | **frontend** |
| `ff_content_generation_v1` seed migration (default OFF) + `feature-flag-matrix.json` entry | **architect** |
| Unit + E2E tests (abstain ladder, diagram-type selection, node-budget adaptation, BOTH safety gates incl. an injection payload → abstain, mastery-write scan, bilingual title/caption, Mermaid-fail → abstain not raw-SVG) | **testing** |
| Whether generated diagrams should persist (`generated_diagrams`) | **architect / CEO** (§4, deferred) |
| Raster/AI-image generation | **CEO** (§7, approval boundary) |
| Any new CBSE subject/grade | **CEO / architect** (§6, out of scope) |

**Review chain (P14):** learner-state / student-facing generative agent → assessment (this spec) → ai-engineer (implements) + frontend (renders) + testing (tests); architect for the flag seed + registry-descriptor reconciliation. No cross-agent notification is required for a spec-only slice.

Files: spec `docs/superpowers/specs/2026-07-24-content-generation-agent-design.md`. Reused building blocks (unchanged): `packages/lib/src/foxy/schema.ts` (`validateMermaidCode`, `MERMAID_ALLOWED_HEADERS`, `FOXY_MAX_MERMAID_CODE_LEN`), `packages/ui/src/foxy/FoxyStructuredRenderer.tsx` (`mermaid` block renderer, `securityLevel:'strict'`), `packages/lib/src/ai/grounded-client.ts` (`callGroundedAnswer`), `packages/lib/src/grounding-config.ts` (`STRICT_CONFIDENCE_ABSTAIN_THRESHOLD`, `REGISTERED_PROMPT_TEMPLATES`, `VALID_CALLERS`), `apps/host/src/lib/memory/student-memory.ts` (`getStudentMemory`), `packages/lib/src/ai/validation/output-screen.ts` (`screenStudentFacingText`), `packages/lib/src/ai/eval/response-eval.ts` (`scoreResponse`), `packages/lib/src/agents/registry.ts` (`content_generation` descriptor).
