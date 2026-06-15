# `compute_post_quiz_action` Redesign — Design Doc

> Status: DESIGN ONLY. This document is the instruction set for a future session that
> will rewrite the `compute_post_quiz_action` RPC against the **current** schema
> (`00000000000000_baseline_from_prod.sql`). It contains NO `CREATE FUNCTION` and NO
> full SQL body — only the contract, the schema mismatches, and a skeleton of the
> corrected query logic. Do not implement from this doc without first running the
> pre-redesign verification checklist (Section 5) and routing the threshold decisions
> through the assessment agent (Section 4).

Author: ai-engineer
Date: 2026-06-15
Owning agent: ai-engineer (implementation) · assessment (threshold correctness review)

---

## Background: why this rewrite is needed

The legacy function lived in
`supabase/migrations/_legacy/timestamped/20260405000002_post_quiz_cme_action.sql`
(CREATE at line 57). That migration is in the archived `_legacy/` chain and is **not
applied** by `supabase db push` (CLI only applies files at the immediate
`supabase/migrations/` root). As a result the baseline (`00000000000000_baseline_from_prod.sql`)
has **two callers** of `compute_post_quiz_action` (line 7556 in `submit_quiz_results`,
line 7858 in `submit_quiz_results_v2`) but **no surviving CREATE for the function
itself**. On a fresh project the function does not exist; on prod it exists only as a
historical artifact written against tables that have since been renamed/replaced.

The legacy body was written against `chapter_topics` / `chapters` — neither relationship
matches the current schema. A `grep` of the baseline for `chapter_topics` returns **0
matches**: the table no longer exists. The function must be rewritten against
`curriculum_topics` + `cme_concept_state`.

---

## 1. Purpose & return contract

### Purpose
Given a student who has just finished a quiz, decide the single best **next action** for
that student in the quiz's subject + grade, and name the specific concept to act on.
This is a best-effort recommendation surfaced post-quiz; it is NOT part of scoring, XP,
or any product invariant. (See Section 2 — it is error-isolated.)

### Signature (unchanged — callers depend on it)
```
compute_post_quiz_action(
  p_student_id UUID,
  p_subject    TEXT,   -- subjects.code (e.g. 'math', 'science')
  p_grade      TEXT    -- grade string "6".."12" (P5: grades are strings, never int)
)
RETURNS TABLE(
  action_type  TEXT,
  concept_id   UUID,
  topic_title  TEXT,
  reason       TEXT
)
```

### Field meanings
| Field | Type | Meaning |
|---|---|---|
| `action_type` | TEXT | One of the 6 enumerated actions: `remediate`, `revise`, `teach`, `practice`, `challenge`, `exam_prep`. The caller maps this into `quiz_sessions.cme_next_action`. |
| `concept_id` | UUID | The `curriculum_topics.id` the action targets. NULL when there is no mastery data for the student in this subject+grade (the `exam_prep` safe-default branch). Caller maps into `quiz_sessions.cme_next_concept_id`. |
| `topic_title` | TEXT | Human-readable `curriculum_topics.title` of the target concept. **Returned but unused by both callers** — kept in the contract for parity / potential future use / direct callers. |
| `reason` | TEXT | Short bilingual-safe-ish English rationale string (e.g. "Mastery at 42%. More practice needed to build fluency."). Caller maps into `quiz_sessions.cme_reason`. NOTE: legacy reasons are English-only; see Open Questions (Section 6) re: P7 bilingual posture. |

The function returns **exactly one row** in every branch (including the
no-data default). It never returns zero rows or multiple rows.

---

## 2. Caller integration

Both `submit_quiz_results` (v1, legacy callsite) and `submit_quiz_results_v2`
(current path, baseline lines 7854-7867) consume the return identically:

```sql
-- CME: best-effort post-quiz action (error-isolated).
BEGIN
  SELECT ca.action_type, ca.concept_id, ca.reason
    INTO v_cme_action, v_cme_concept_id, v_cme_reason
    FROM compute_post_quiz_action(p_student_id, p_subject, p_grade) ca;

  UPDATE quiz_sessions
     SET cme_next_action     = v_cme_action,
         cme_next_concept_id = v_cme_concept_id,
         cme_reason          = v_cme_reason
   WHERE id = v_quiz_session_id;
EXCEPTION WHEN OTHERS THEN
  NULL;   -- CME failure degrades silently; quiz result is already saved.
END;
```

Mapping:
- `action_type`  → `quiz_sessions.cme_next_action`
- `concept_id`   → `quiz_sessions.cme_next_concept_id`
- `reason`       → `quiz_sessions.cme_reason`
- `topic_title`  → **ignored** (not SELECTed by either caller)

Critical integration properties the rewrite MUST preserve:
1. **Error isolation.** The call sits inside `BEGIN … EXCEPTION WHEN OTHERS THEN NULL`.
   A broken or schema-drifted `compute_post_quiz_action` can never fail a quiz
   submission — it only fails to enrich `quiz_sessions` with a recommendation. This is
   why the missing/broken function on prod has been silent: every call throws, the
   exception swallows it, and the three `cme_*` columns stay NULL. The rewrite restores
   the enrichment without changing this safety contract.
2. **Same 3-column SELECT shape.** Callers `SELECT ca.action_type, ca.concept_id,
   ca.reason` — the column NAMES and ORDER in the RETURNS TABLE must stay
   `action_type, concept_id, topic_title, reason`. Do not reorder.
3. **SECURITY DEFINER.** The function is invoked from inside `submit_quiz_results*`
   (themselves SECURITY DEFINER). It reads `concept_mastery` / `cme_concept_state` /
   `curriculum_topics` / `subjects` on behalf of the student; keep `SECURITY DEFINER`
   and `SET search_path = public` so RLS does not block the read inside the definer
   chain.
4. The three `quiz_sessions` columns (`cme_next_action TEXT`, `cme_next_concept_id UUID`,
   `cme_reason TEXT`) and the partial index `idx_quiz_sessions_cme_action` already exist
   in prod (added by the legacy migration). The rewrite touches the FUNCTION only — no
   column DDL needed. (Verify they exist in the baseline before assuming — Section 5.)

---

## 3. The 4 schema mismatches and where each target now lives

The ai-engineer review found the legacy body references four objects/columns that do
not exist in the current schema. Corrected mapping:

| # | Legacy reference | Status in current schema | Corrected target | Evidence |
|---|---|---|---|---|
| 1 | `chapter_topics` (joined as `ct`, `ct.id = cm.topic_id`, `ct.title`) | **Removed.** `grep chapter_topics` on baseline = 0 matches. | `curriculum_topics` (`id`, `title`). `concept_mastery.topic_id` is a real FK to `curriculum_topics(id)`. | FK at baseline line 18925: `concept_mastery_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES curriculum_topics(id)`. `curriculum_topics` CREATE at line 10870 (has `id`, `title`). |
| 2 | `chapters` JOIN hop (`ch.id = ct.chapter_id`, then `s.id = ch.subject_id`, filters `ch.grade = p_grade`) | The `chapters` table still exists (line 10321) but the topic→chapter relationship does not — `curriculum_topics` has **no `chapter_id`**. The grade + chapter live ON the topic row. | Drop the `chapters` hop entirely. Join `curriculum_topics.subject_id → subjects.id` directly. Filter grade with `curriculum_topics.grade = p_grade`. (Chapter, if ever needed, is `curriculum_topics.chapter_number`, an `integer` on the same row.) | `curriculum_topics` (line 10870) has `subject_id uuid NOT NULL`, `grade text NOT NULL`, `chapter_number integer`. No `chapter_id` column exists on it. |
| 3 | `cm.error_count_conceptual` (read from `concept_mastery`) | `concept_mastery` has **no** `error_count_conceptual` column. | `cme_concept_state.error_count_conceptual` (`integer DEFAULT 0`). | `concept_mastery` CREATE (line 10661) has no error-count columns. `cme_concept_state` (line 10456) has `error_count_conceptual`, `error_count_procedural`, `error_count_careless`. |
| 4 | `cm.current_retention` (read from `concept_mastery`) | `concept_mastery` has **no** `current_retention` column. | `cme_concept_state.current_retention` (`double precision DEFAULT 0.3`). | `concept_mastery` (line 10661) carries SM-2 / BKT fields (`p_know`, `ease_factor`, `mastery_probability`) but no `current_retention`. `cme_concept_state` (line 10456) has `current_retention` plus `retention_half_life`, `last_practiced_at`, `mastery_mean`. |

### Key consequence: the data now lives in TWO tables
The legacy function read **everything** from one table (`concept_mastery` aliased `cm`).
In the current schema the signals are split:
- **`concept_mastery`** (per `student_id` + `topic_id`, UNIQUE at line 15216;
  `topic_id` → `curriculum_topics.id`) — BKT/SM-2 state: `mastery_probability` (float),
  `mastery_level` (text band), ease factor, review schedule. This is what
  `update_concept_mastery_bkt` writes per question inside `submit_quiz_results*`.
- **`cme_concept_state`** (per `student_id` + `concept_id`, UNIQUE at line 15136;
  `concept_id` is **semantically a `curriculum_topics.id`** — confirmed by the
  cme-engine Edge Function, which loads `curriculum_topics` as the concept catalog and
  joins `cme_concept_state.concept_id → curriculum_topics.id`, see
  `supabase/functions/cme-engine/index.ts` lines 429, 480-497, 552-558). This table
  holds the richer CME signals: `mastery_mean`, `current_retention`,
  `error_count_conceptual/procedural/careless`, `max_difficulty_succeeded`,
  `retention_half_life`, `last_practiced_at`.

NOTE — `concept_id` on `cme_concept_state` has a UNIQUE(student_id, concept_id) key but
**no declared FK** to `curriculum_topics` in the baseline. The join is correct by
convention/usage, not by a DB constraint. The redesign must LEFT JOIN defensively (a
`cme_concept_state` row could in principle point at a `curriculum_topics.id` that is
inactive or soft-deleted). Confirm during implementation (Section 5, item 7).

### Two valid table strategies for the rewrite (decide during implementation)
- **(A) Single source — `cme_concept_state` only.** All four corrected signals
  (`mastery_mean`, `current_retention`, `error_count_conceptual`) live here, plus the
  join to `curriculum_topics` for `title` + subject/grade filter. Simplest; matches the
  cme-engine's own model. Risk: a brand-new student who has done one quiz has
  `concept_mastery` rows (written by `update_concept_mastery_bkt`) but may NOT yet have
  `cme_concept_state` rows (those are written by the separate cme-engine "process"
  endpoint, not by `submit_quiz_results`). That student would fall through to the
  `exam_prep` no-data default even though they have mastery data.
- **(B) Join both — `concept_mastery` for the mastery band, `cme_concept_state` for
  error/retention.** `concept_mastery` is the table actually populated by the quiz
  submission path, so it is the reliable mastery source post-quiz; `cme_concept_state`
  supplies the conceptual-error and retention signals when present (LEFT JOIN, treat
  absent as 0 / neutral). More faithful to "what does the student know right now," but
  requires reconciling `concept_mastery.mastery_probability` (float) vs
  `cme_concept_state.mastery_mean` (float) as the mastery scalar.

Recommendation to carry into implementation: **lean toward (B)** because
`concept_mastery` is the table guaranteed-populated by the very submission that triggers
this call. But this is a correctness/coverage decision — **route to assessment** before
finalizing, because it changes which students get which recommendation.

---

## 4. Proposed new query logic — SKELETON ONLY

This is a step outline / pseudo-SQL, NOT a function body. The decision tree is carried
over from the legacy function (priority-ordered, first match wins). **Every numeric
threshold below is a placeholder copied from the legacy body and MUST be re-validated by
the assessment agent against the current cognitive-model rules** (`src/lib/cognitive-engine.ts`,
`PULSE_THRESHOLDS`, BKT mastery bands) before implementation. Do not treat these numbers
as authoritative.

```
INPUT: p_student_id, p_subject (subjects.code), p_grade ("6".."12")

-- Resolve the subject_id once (subjects.code = p_subject).
-- All topic reads are scoped to: curriculum_topics.subject_id = <that id>
--   AND curriculum_topics.grade = p_grade
--   AND curriculum_topics.is_active = true AND deleted_at IS NULL
-- Join concept_mastery / cme_concept_state to curriculum_topics.id.

PRIORITY 1 — remediate  (deep conceptual misunderstanding)
  candidate = topic where cme_concept_state.error_count_conceptual >= 3   -- THRESHOLD: re-validate
  order by error_count_conceptual DESC, mastery ASC
  if found:
    action_type = 'remediate'
    reason = "Deep conceptual gaps detected (N conceptual errors)..."
    RETURN

PRIORITY 2 — revise  (was learned, retention decayed)
  candidate = topic where cme_concept_state.current_retention < 0.5       -- THRESHOLD: re-validate
                      AND mastery > 0.4                                    -- THRESHOLD: re-validate
  order by current_retention ASC
  if found:
    action_type = 'revise'
    reason = "Retention dropped to X% despite prior mastery..."
    RETURN

PRIORITY 3-6 — classify the WEAKEST topic by mastery band
  candidate = topic with MIN mastery (across the student's topics in subject+grade)
  if NO candidate (no mastery rows at all):
    action_type = 'exam_prep', concept_id = NULL, topic_title = NULL
    reason = "No mastery data available for this subject..."
    RETURN
  else classify by mastery scalar m:
    m < 0.30  -> 'teach'      "needs teaching from scratch"     -- BANDS: re-validate
    m < 0.60  -> 'practice'   "more practice to build fluency"
    m < 0.85  -> 'challenge'  "ready for harder problems"
    else      -> 'exam_prep'  "all topics above 85% mastery"
  RETURN (one row)
```

Mapping of the decision tree onto the corrected tables:
- `error_count_conceptual` → `cme_concept_state.error_count_conceptual`
- `current_retention` → `cme_concept_state.current_retention`
- mastery scalar → `concept_mastery.mastery_probability` (strategy B) OR
  `cme_concept_state.mastery_mean` (strategy A) — pick one, document it, keep it
  consistent across all priorities. Legacy used
  `COALESCE(mastery_level::float, mastery_probability, 0)` — note `mastery_level` is a
  TEXT band (`'not_started'`, etc.), so `::float` of it is wrong/legacy-buggy; the
  rewrite should NOT cast the text band to float. Use the numeric column.
- `title` / `topic_title` → `curriculum_topics.title`
- subject filter → `subjects.code = p_subject` via `curriculum_topics.subject_id`
- grade filter → `curriculum_topics.grade = p_grade`

ASSESSMENT REVIEW GATE (P12 / domain 22-24): the band cutoffs (0.30 / 0.60 / 0.85), the
conceptual-error threshold (3), the retention cutoff (0.5), and the
"forgetting-but-known" mastery floor (0.4) are cognitive-model rules, not AI-engineering
choices. The ai-engineer implements the query; **assessment must confirm these
thresholds still match the documented mastery bands and ZPD rules** before the rewrite
ships. If the current cognitive engine uses different bands, the SQL must follow the
engine, not this skeleton.

---

## 5. Pre-redesign verification checklist

Run every check below against the **current** baseline (and live staging if available)
BEFORE writing the function. Each must pass.

- [ ] **1. `curriculum_topics` exists** with columns: `id uuid`, `title text`,
      `subject_id uuid`, `grade text`, `chapter_number integer`, `is_active boolean`,
      `deleted_at timestamptz`. (Baseline line 10870.)
- [ ] **2. `concept_mastery` exists** with columns: `student_id uuid`, `topic_id uuid`,
      `mastery_probability double precision`, `mastery_level text`. Confirm it does NOT
      have `error_count_conceptual` or `current_retention` (mismatches 3 & 4).
      (Baseline line 10661.)
- [ ] **3. FK `concept_mastery.topic_id → curriculum_topics.id`** exists
      (`concept_mastery_topic_id_fkey`, baseline line 18925) — confirms mismatch #1
      target.
- [ ] **4. `cme_concept_state` exists** with columns: `student_id uuid`,
      `concept_id uuid`, `mastery_mean double precision`,
      `current_retention double precision`, `error_count_conceptual integer`,
      `retention_half_life`, `last_practiced_at`. (Baseline line 10456.) Confirm the
      UNIQUE(student_id, concept_id) key (line 15136).
- [ ] **5. `subjects.code` exists** (`subjects` CREATE line 14123, `code text NOT NULL`)
      — this is what `p_subject` matches.
- [ ] **6. `chapter_topics` does NOT exist** (expected: `grep` → 0 matches). If it
      reappears, the rename story changed and this doc is stale.
- [ ] **7. Confirm whether `cme_concept_state.concept_id` has a declared FK to
      `curriculum_topics`.** Baseline shows NONE (only UNIQUE key). Decide LEFT vs INNER
      JOIN accordingly; LEFT JOIN with active/not-deleted filter is the safe default.
- [ ] **8. Confirm the three `quiz_sessions.cme_*` columns + index exist** in the
      baseline (`cme_next_action TEXT`, `cme_next_concept_id UUID`, `cme_reason TEXT`,
      `idx_quiz_sessions_cme_action`). If the baseline does NOT carry them (they were
      added by the un-applied legacy migration), the rewrite migration must add them
      first (idempotent `ADD COLUMN … EXCEPTION WHEN duplicate_column`).
- [ ] **9. Confirm both callers still SELECT `action_type, concept_id, reason`** (not
      `topic_title`) — baseline lines 7556 and 7858. The RETURNS TABLE order must stay
      `action_type, concept_id, topic_title, reason`.
- [ ] **10. Confirm which table the quiz path actually populates per question.**
      `submit_quiz_results*` calls `update_concept_mastery_bkt` (writes `concept_mastery`).
      Verify whether it also writes `cme_concept_state`. This decides strategy A vs B in
      Section 3 (coverage for fresh students).
- [ ] **11. Assessment sign-off on the thresholds in Section 4** recorded before
      implementation (P12 + domain 22-24 review gate).

---

## 6. Open questions / risks

1. **Strategy A vs B (which table is the mastery source).** Section 3 lays out the
   trade-off. If `submit_quiz_results*` does NOT write `cme_concept_state`, strategy A
   silently returns `exam_prep` for every just-onboarded student (no `cme_concept_state`
   rows yet) — a regression vs the legacy intent. Resolve via checklist item 10 +
   assessment.

2. **`concept_id` is not a constrained FK.** `cme_concept_state.concept_id` maps to
   `curriculum_topics.id` by usage only. A stale/soft-deleted topic id could surface as
   a recommendation. Mitigate with `is_active = true AND deleted_at IS NULL` on the join
   and LEFT JOIN semantics.

3. **`mastery_probability` (float, 0-1) vs `mastery_mean` (float, default 0.3) vs
   `mastery_level` (TEXT band).** Three different "mastery" representations across the
   two tables. The legacy `mastery_level::float` cast is a bug (it casts a text band).
   The rewrite must pick ONE numeric scalar and the bands in Section 4 must be calibrated
   to whichever is chosen. Assessment owns this calibration.

4. **Thresholds are unverified placeholders.** Every cutoff in Section 4 is inherited
   from a function written against a now-defunct schema. They may predate the current
   cognitive-model rules. Treat them as suspect until assessment confirms.

5. **P7 bilingual `reason`.** Legacy `reason` strings are English-only. The current
   product invariant P7 requires Hindi/English parity on user-facing text. If
   `cme_reason` is ever rendered to a student, the rewrite (or the consuming UI) needs a
   bilingual story. Today both callers store it but the consuming UI surface is unclear —
   flag to frontend/assessment if `cme_reason` is student-visible.

6. **Silent degradation has hidden the breakage.** Because the call is wrapped in
   `EXCEPTION WHEN OTHERS THEN NULL`, prod has been quietly NOT populating
   `cme_next_action` for an unknown period. Any analytics/dashboards reading
   `quiz_sessions.cme_*` have been seeing NULLs. After the rewrite, downstream consumers
   will suddenly start receiving values — verify no consumer treats "always NULL" as a
   baseline assumption (ops/analytics check).

7. **No regression catalog entry today.** This RPC is not pinned by any REG-* entry.
   Recommend the testing agent add a catalog entry once rewritten: the error-isolation
   contract (Section 2, property 1) is the load-bearing invariant — a future schema drift
   must never be able to fail a quiz submission through this path.

---

## Required review chain for the eventual rewrite
- **ai-engineer** implements the function (RAG/retrieval-adjacent CME logic — domain owner).
- **assessment** reviews/validates all thresholds and the mastery-source choice
  (Section 4 gate, Section 6 items 1, 3, 4).
- **testing** adds a regression catalog entry pinning the error-isolation contract
  (Section 6 item 7).
- This is an "AI tutor / learner-state" change → per P14, assessment + testing review is
  mandatory before merge.
