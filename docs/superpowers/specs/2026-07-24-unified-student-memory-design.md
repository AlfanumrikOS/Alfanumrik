# Unified Student Memory — Read-API Contract (Phase 2, GenAI Architecture)

- **Status:** SPEC (assessment-issued). No implementation in this document.
- **Owner:** assessment (P14 learner-state rules). ai-engineer implements against this spec.
- **Date:** 2026-07-24
- **Flag:** `ff_unified_memory_v1` (default OFF). OFF = today's per-reader behavior, byte-identical.
- **Scope:** A single read-model, `StudentMemory`, that **wraps** the three existing Foxy-family learner-state readers. It invents **no new mastery math** and **no new thresholds**.

---

## 0. Design stance (non-negotiable)

1. **Wrap, do not re-derive.** `getStudentMemory` calls the three existing loaders and composes their outputs. It never re-implements BKT/BKT-band/decay/misconception math. If a number is not already produced by an existing reader or an existing exported constant, it does not appear here.
2. **Read-only context.** Nothing in this API can write a mastery, progression, XP, or gap surface. It is prompt context only (see §6).
3. **Fail-soft, never throw.** Any sub-read failure degrades that slice to empty; the whole call never rejects into the caller.
4. **PII-clean rendered output.** The rendered prompt block mirrors the existing twin / long-memory renderers: counts + enum codes + editor-curated labels + name-scrubbed free text only. No names, emails, phones, or raw UUIDs in rendered text.
5. **Authorization is upstream.** `getStudentMemory` assumes `canAccessStudent` already passed. It does not authorize.

---

## 1. The `StudentMemory` composite read-model

`StudentMemory` is a **composition** of the three existing sub-types. It re-uses them by reference — it does **not** flatten or redefine their fields, so mastery math stays in exactly one place.

```
StudentMemory {
  // ── identity keys (see §5 for the seam) ──
  studentId: string                       // students.id — the Foxy-family key
  subject: string                         // subject code, lowercase (e.g. "physics")
  grade: string                           // P5: STRING "6".."12", never int
  chapter: string | null                  // chapter label/number, or null (subject-wide)

  // ── mastery (from CognitiveContext) ──
  cognitive: CognitiveContext             // whole object, by composition

  // ── longitudinal / retention-decay / episodic (from TwinContext) ──
  twin: TwinContext | null                // null when ff_digital_twin_v1 OFF or no snapshot

  // ── cross-session ~30d memory (from LongMemorySnapshot) ──
  longMemory: LongMemorySnapshot          // EMPTY_LONG_MEMORY when unavailable

  // ── preferences (see §1.5) ──
  preferences: StudentPreferences

  // ── flags for callers ──
  isEmpty: boolean                        // true when every slice is empty
}
```

### 1.1 Field-by-field source map

Grouped as the task requires. Every field cites its source reader (and its underlying table). **No field is newly computed here** — each is projected verbatim from an existing reader's output.

#### Group A — Mastery (weak/strong topics, masteryLevel, loSkills)
| StudentMemory path | Source reader → field | Underlying table | Type |
|---|---|---|---|
| `cognitive.weakTopics` | `loadCognitiveContext` → `weakTopics` | `concept_mastery` (mastery_probability < 0.6) | `{title, mastery(0-100), attempts}[]` |
| `cognitive.strongTopics` | `loadCognitiveContext` → `strongTopics` | `concept_mastery` (mastery_probability ≥ 0.8) | `{title, mastery(0-100)}[]` |
| `cognitive.masteryLevel` | `loadCognitiveContext` → `masteryLevel` | derived avg over `concept_mastery` | `'low' \| 'medium' \| 'high'` |
| `cognitive.loSkills` | `loadCognitiveContext` → `loSkills` | `student_skill_state` ⋈ `learning_objectives` | `{loCode, loStatement, pKnow, pSlip, theta}[]` |
| `cognitive.nextAction` | `loadCognitiveContext` → `nextAction` (pure `deriveNextAction`) | derived over above | `{actionType, conceptName, reason} \| null` |

#### Group B — Retention / decay (revisionDue, decayedTopics)
| StudentMemory path | Source reader → field | Underlying table | Type |
|---|---|---|---|
| `cognitive.revisionDue` | `loadCognitiveContext` → `revisionDue` | `concept_mastery.next_review_at ≤ now()` (SM-2) | `{title, lastReviewed, mastery(0-100)}[]` |
| `twin.decayedTopics` | `buildTwinContext` → `decayedTopics` | `learner_twin_snapshots.decay_state` | `{topicId, retention(0..1)}[]` |

#### Group C — Errors / misconceptions (recentErrors, dominantErrorTypes, misconceptions)
| StudentMemory path | Source reader → field | Underlying table | Type |
|---|---|---|---|
| `cognitive.recentErrors` | `loadCognitiveContext` → `recentErrors` | `cme_error_log` (30d) | `{errorType, count}[]` |
| `cognitive.recentMisconceptions` | `loadCognitiveContext` → `recentMisconceptions` | `quiz_responses` ⋈ `question_misconceptions` (30d) | `{code, label, count, remediationText}[]` |
| `cognitive.knowledgeGaps` | `loadCognitiveContext` → `knowledgeGaps` | `knowledge_gaps` (is_resolved=false) | `{target, prerequisite, gapType}[]` |
| `twin.dominantErrorTypes` | `buildTwinContext` → `dominantErrorTypes` | `learner_twin_snapshots.dominant_error_types` | `string[]` (enum codes) |
| `twin.misconceptionClusterCount` | `buildTwinContext` → `misconceptionClusterCount` | `learner_twin_snapshots.misconception_cluster_ids` | `number` |
| `longMemory.top_misconceptions` | `loadLongMemorySnapshot` → `top_misconceptions` | projected from `cognitive.recentMisconceptions` labels | `string[]` (curated labels) |

#### Group D — Longitudinal (twin highlights, cohortPercentile, synthesis summary)
| StudentMemory path | Source reader → field | Underlying table | Type |
|---|---|---|---|
| `twin.weakTopics` | `buildTwinContext` → `weakTopics` | `learner_twin_snapshots.mastery_by_topic` | `{topicId, mastery(0..1)}[]` |
| `twin.highlights` | `buildTwinContext` → `highlights` | `learner_twin_memory` | `{summaryCode, topicId\|null}[]` |
| `twin.cohortPercentile` | `buildTwinContext` → `cohortPercentile` | `learner_twin_snapshots.cohort_percentile` | `number(0-100) \| null` |
| `longMemory.synthesis_month` | `loadLongMemorySnapshot` → `synthesis_month` | `monthly_synthesis_runs` | `string \| null` |
| `longMemory.synthesis_summary` | `loadLongMemorySnapshot` → `synthesis_summary` | `monthly_synthesis_runs.summary_text_en` (scrubbed, ≤500 chars) | `string \| null` |
| `longMemory.high_concepts` | `loadLongMemorySnapshot` → `high_concepts` | `concept_mastery` (≥ 0.8) | `string[]` (≤3) |
| `longMemory.low_concepts` | `loadLongMemorySnapshot` → `low_concepts` | `concept_mastery` (< 0.6) | `string[]` (≤3) |

#### Group E — Preferences (§1.5)
| StudentMemory path | Source | Underlying column | Type |
|---|---|---|---|
| `preferences.learningStyle` | `student_learning_profiles` | `learning_style` (nullable) | `string \| null` |
| `preferences.preferredExplanationDepth` | `student_learning_profiles` | `preferred_explanation_depth` (nullable; see §1.5 note) | `string \| null` |

#### Group F — Identity keys
| StudentMemory path | Source | Type |
|---|---|---|
| `studentId` | caller input (`students.id`) | `string` |
| `subject` | caller input | `string` |
| `grade` | caller input | `string` (P5) |
| `chapter` | caller input | `string \| null` |

### 1.5 Preferences sub-type

```
StudentPreferences {
  learningStyle: string | null              // student_learning_profiles.learning_style
  preferredExplanationDepth: string | null  // student_learning_profiles.preferred_explanation_depth
}

EMPTY_PREFERENCES = { learningStyle: null, preferredExplanationDepth: null }
```

- These are **advisory hints only** — they shape HOW Foxy explains (tone/depth), never WHAT it asserts about mastery.
- **Verification note for ai-engineer:** `learning_style` exists on the profile row (see `packages/lib/src/types.ts`). `preferred_explanation_depth` must be confirmed to exist on `student_learning_profiles` before reading it. If the column does not exist, `preferredExplanationDepth` stays `null` (never invent a value, never add a migration under this spec — a preferences column is out of scope for Phase 2 and would need architect). Preferences are the ONLY optional slice; their absence must not degrade the other four slices.

### 1.6 Reuse of existing sub-types — no redefinition

`CognitiveContext`, `TwinContext`, and `LongMemorySnapshot` are imported from their existing homes and embedded whole:
- `CognitiveContext` / `EMPTY_COGNITIVE_CONTEXT` — `apps/host/src/app/api/foxy/_lib/constants.ts`
- `TwinContext` — `packages/lib/src/learn/build-twin-context.ts`
- `LongMemorySnapshot` / `EMPTY_LONG_MEMORY` — `packages/lib/src/learn/foxy-long-memory.ts`

The unified module must **not** re-declare these shapes or re-implement their producers. It is a thin composer + a DPDP guard + a renderer.

---

## 2. `getStudentMemory` contract

```
getStudentMemory(
  sb: SupabaseClient,                    // service-role client (see precondition)
  studentId: string,                     // students.id
  opts: { subject: string; grade: string; chapter?: string | null }
): Promise<StudentMemory>
```

### 2.1 Precondition (document explicitly)
- **`canAccessStudent(authUserId, studentId)` MUST have been enforced UPSTREAM by the caller** (the API route / server action), following the established REG-121 pattern: *authorize on the user-JWT boundary, then read with the service-role client.* `getStudentMemory` does **not** re-authorize and does **not** accept an `authUserId`. Passing an unauthorized `studentId` is a caller bug, not something this function guards.

### 2.2 Composition & fail-soft semantics
- Calls the three loaders (Cognitive is always loaded; Twin only when `ff_digital_twin_v1` is ON, preserving its existing gating; Long-Memory only when `ff_foxy_long_memory_v1` is ON, preserving its existing gating). The unified flag `ff_unified_memory_v1` gates the **composition + DPDP guard path**, not the individual pre-existing readers' own flags.
- **Each slice fails independently.** A thrown/failed cognitive read → `EMPTY_COGNITIVE_CONTEXT`; failed twin → `null`; failed long-memory → `EMPTY_LONG_MEMORY`; failed preferences → `EMPTY_PREFERENCES`. The composer wraps every sub-read so one failure never voids the others and **never propagates as a rejection** to the caller.
- `isEmpty === true` iff `cognitive === EMPTY_COGNITIVE_CONTEXT`-equivalent AND `twin` is null/`isEmpty` AND `longMemory` equals `EMPTY_LONG_MEMORY` AND `preferences` equals `EMPTY_PREFERENCES`.
- **Determinism of composition:** the composer adds no ordering/rounding/threshold logic of its own. Ordering, caps, and rounding are exactly what each existing reader already produces.

### 2.3 Flag behavior
- `ff_unified_memory_v1` **OFF** (default): callers use today's per-reader paths directly. `getStudentMemory` is not on any hot path. Behavior is **byte-identical** to today for every existing surface.
- `ff_unified_memory_v1` **ON**: callers may switch to `getStudentMemory`, which produces the composed model **plus** the DPDP erasure-pending guard (§3) — that guard is the one new observable behavior the flag introduces.

---

## 3. DPDP erasure-pending guard (new privacy behavior gated by the flag)

**Rule:** If the student has an **in-flight erasure** row, `getStudentMemory` MUST return **fully empty** memory. For this increment the guard scopes to the memory data `getStudentMemory` actually sources — the **three wired slices** (cognitive, twin, long-memory) plus the misconception sub-read and preferences: none of that mastery, retention, misconception, longitudinal, synthesis-summary, or preference data may flow into any AI prompt for a student who is mid-erasure.

> **Scope caveat (single-proof-consumer increment).** `teachingDirectorSection` (Foxy route, gated by `ff_foxy_teaching_director_v1`) is NOT sourced from `getStudentMemory` and is therefore NOT covered by this guard. When both `ff_unified_memory_v1` and `ff_foxy_teaching_director_v1` are ON, a mid-erasure student's teaching directive can still reach the prompt. This is a known residual gap that closes when the teaching director is brought under `getStudentMemory`.
>
> **Rollout gate:** `ff_unified_memory_v1` MUST NOT be enabled in production until `teachingDirectorSection` is either unified-sourced (under `getStudentMemory`) or independently erasure-suppressed. Until then the flag stays OFF outside dev/test.
>
> **Residual edge (a) — DB-read-then-discard.** Because the proof consumer INJECTS the already-loaded sub-contexts, an erased student's cognitive/twin/long-memory rows are still DB-read *before* the unified block runs; the guard then suppresses them from the prompt so they are never sent to Claude nor logged. This is an inefficiency / defense-in-depth footnote only — no erased-student data reaches an AI prompt or a log — and it disappears once the readers move fully behind `getStudentMemory`.

**How (exact check):**
- Query `public.data_erasure_requests` for `student_id = <studentId>` with `status IN ('pending','purging')`.
  - `pending` = inside the 7-day grace window; `purging` = cron cascade in progress. Both mean "erasure is in flight — stop surfacing this learner's history."
  - `cancelled` / `completed` / `failed` do **not** trip the guard (`cancelled` = the student is active again; `completed` = the rows are already gone so the sub-reads return empty naturally; `failed` = ops-handled, out of scope for this read guard).
- If any such row exists → return the canonical empty value:
  ```
  { studentId, subject, grade, chapter,
    cognitive: EMPTY_COGNITIVE_CONTEXT,
    twin: null,
    longMemory: EMPTY_LONG_MEMORY,
    preferences: EMPTY_PREFERENCES,
    isEmpty: true }
  ```
  and **skip all sub-reads** (do not even query the learner-state tables).
- **Fail-closed:** if the `data_erasure_requests` check itself errors, treat it as "guard tripped" and return empty. A privacy guard must never fail open. (This is the deliberate asymmetry vs. §2.2: sub-reads fail *soft* to empty; the erasure check fails *closed* to empty — both directions land on "empty," so the safe outcome is the same.)

**Why this lives here:** there is NO soft "erased" flag on the student row (erasure is destructive via the two-stage `data_erasure_requests` + cron cascade, per migration `20260527000006`). During the `pending`/`purging` window the learner-state rows still physically exist, so without this guard they would leak into prompts. This guard is the memory-layer enforcement of that window and is the primary new behavior `ff_unified_memory_v1` gates.

---

## 4. PII / P13 rules for rendered output

The unified renderer (call it `renderStudentMemorySection(mem) → string`) MUST mirror the existing renderers' discipline exactly:

1. **Counts + codes + curated labels only.** Reuse the existing renderers as the building blocks:
   - `renderTwinPromptSection(mem.twin)` — already counts/codes only; never emits raw topic UUIDs.
   - `buildLongMemoryPromptSection(mem.longMemory)` — concept titles, curated misconception labels, and **already-scrubbed** synthesis text.
   - The cognitive slice's rendering (existing prompt-section builders) — concept titles + counts.
2. **No raw identifiers in rendered text.** Topic UUIDs (`twin.weakTopics[].topicId`, `twin.highlights[].topicId`) are structural fields for callers; they MUST NOT appear in the rendered prompt block. The twin renderer already surfaces counts instead of UUIDs — keep that.
3. **`scrubStudentName` applies to any free-text summary.** The only free text is `longMemory.synthesis_summary`, which `loadLongMemorySnapshot` already scrubs via `scrubStudentName` and truncates to 500 chars. The unified renderer MUST NOT bypass that path or render any un-scrubbed free text. If a future slice adds free text, it passes through `scrubStudentName` first.
4. **No names / emails / phones / UUIDs** anywhere in the rendered output. Cohort percentile keeps its existing "calibration only — NEVER disclose to the student" guardrail from the twin renderer.
5. **Logging:** follow the existing convention — never log `studentId` paired with concept titles / misconception codes / labels; counts-only info logs; no `studentId` at `warn` level for slice failures.

---

## 5. The `student_id ↔ auth_user_id` / `concept_mastery ↔ learner_mastery` seam

There are **two parallel learner-state substrates** in the platform, and they are **NOT merged**:

| Family | Identity key | Mastery table | Readers |
|---|---|---|---|
| **Foxy family** (this spec) | `student_id` (`students.id`) | `concept_mastery`, `student_skill_state`, `learner_twin_snapshots`, `monthly_synthesis_runs` | `loadCognitiveContext`, `buildTwinContext`, `loadLongMemorySnapshot` |
| **Pulse family** (out of scope) | `auth_user_id` | `learner_mastery` | `packages/lib/src/pulse/pulse-server.ts` |

- **Phase 2 decision:** the Unified Student Memory API keys **exclusively on `student_id`** and reads **only the Foxy-family** substrate (`concept_mastery` et al.). It does **NOT** read `learner_mastery` and does **NOT** accept or resolve `auth_user_id`.
- **Explicitly deferred:** reconciling the Foxy `concept_mastery`/`student_id` substrate with the Pulse `learner_mastery`/`auth_user_id` substrate is a **later phase**. No one should assume `StudentMemory` reflects Pulse mastery, nor that the two mastery numbers agree — they are computed differently (BKT p_know vs. accuracy-as-mastery proxy) on different keys.
- **Guard for implementers:** do not "helpfully" join `learner_mastery` into this model. Doing so silently merges two substrates that have never been reconciled and would produce contradictory mastery signals in one prompt.

---

## 6. WHAT / HOW boundary — read-only, observability is not authority

- **The memory API is READ-ONLY context.** It returns a snapshot for prompt assembly. Nothing in `StudentMemory` — and nothing an LLM does with it — can write a mastery, progression, XP, gap, or review-schedule surface. There is no write path in this contract.
- **Observability events are not write authority.** `learner.learning_action`, `learner.struggle_observed`, and `learner.turn_classified` (declared in `packages/lib/src/state/events/registry.ts`) are **observability-only** by binding contract: their schemas already carry the assessment-issued warning that *no subscriber may consume them to write ANY mastery surface* (`concept_mastery`, `cme_concept_state`, `student_skill_state`, `knowledge_gaps`, `learner_mastery`, `cme_error_log`, `quiz_sessions`). The unified memory API neither emits nor consumes these to mutate state. Mastery is written only by the graded quiz path (`atomic_quiz_profile_update` RPC, P1/P4) and the CME/BKT/SM-2 update pipeline — never by Foxy, never by this read-model, never by an LLM turn.

---

## 7. Mastery thresholds — reuse only, no new magic numbers

Every threshold used anywhere in this composite already exists and is imported from its owning module. Implementers MUST reuse these and MUST NOT introduce new literals.

| Threshold | Value | Source of truth |
|---|---|---|
| Twin weak-topic mastery floor | `PULSE_THRESHOLDS.at_risk_mastery` (0.4) | `BLOCKED_PREREQUISITE_RULES.mastery_floor` in `packages/lib/src/learn/adaptive-loops-rules.ts` |
| Twin decay/retention floor | 0.5 | `BLOCKED_PREREQUISITE_RULES.decay_floor` (= cognitive-engine `shouldRetest` threshold) |
| Long-memory high-mastery cut | 0.8 | `loadLongMemorySnapshot` (`foxy-long-memory.ts`) |
| Long-memory low-mastery cut | 0.6 | `loadLongMemorySnapshot` (`foxy-long-memory.ts`) |
| Cognitive weak-topic cut | mastery_probability < 0.6 | `loadCognitiveContext` / cognitive-engine band (`isWeak`) |
| Cognitive strong-topic cut | mastery_probability ≥ 0.8 | `loadCognitiveContext` / cognitive-engine band (`isStrong`) |
| Cognitive masteryLevel bands | avg < 0.4 → low; < 0.7 → medium; else high | `loadCognitiveContext` |
| next-action re-teach trigger | ≥ 3 conceptual errors | `deriveNextAction` (`cognitive-context.ts`) |
| next-action practice/mastered cuts | 0.6 / 0.85 | `deriveNextAction` (`cognitive-context.ts`) |
| Chapter-progression mastered cut | 0.6 | `loadChapterTopicProgress` (`TOPIC_MASTERED_THRESHOLD`) |
| Retention prediction | `predictRetention(daysSinceStudy, strength)` | `packages/lib/src/cognitive-engine.ts` |

**Rule:** the unified composer contributes **zero** new thresholds. If a reviewer finds a numeric literal governing mastery/decay/misconception logic inside the unified module, that is a spec violation (P2/learner-state) — reject.

---

## 8. Flag summary

- `ff_unified_memory_v1` — **default OFF.**
  - OFF: today's per-reader behavior, byte-identical; no `data_erasure_requests` guard on the read path (each pre-existing reader keeps its own current behavior and its own flag).
  - ON: `getStudentMemory` composition path is live, including the §3 DPDP erasure-pending guard.
- This spec does **not** author the flag registry entry, the migration, TS implementation, or tests — those are downstream (ops seeds the flag OFF; ai-engineer implements; testing writes assertions). Registering the flag and wiring it is out of this document's scope.

---

## 9. Review-chain note (P14)

This is a learner-state rules change (assessment-owned). Downstream reviewers per the learner-state chain: **ai-engineer** (implements the composer, renderer, and DPDP guard against this contract), **frontend** (only if any surface renders memory), **testing** (asserts fail-soft, erasure-guard fail-closed, PII-clean render, threshold-reuse, and flag-OFF byte-identity). No P1–P6 formula changes; no user approval gate triggered. The DPDP erasure guard is additive privacy hardening.
