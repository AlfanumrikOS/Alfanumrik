# OQ-5: The `node_code` ↔ `topic_id` Bridge

**Status:** DESIGN PROPOSAL — doc only. No SQL, no migration, no code change in this artifact.
**Owner:** architect (schema/RLS). Requires **user approval** before any implementing migration (additive schema change touching curriculum / learner-state tables).
**Blocks:** SPEC-3 (quiz consecutive-wrong intervention alert).
**Date:** 2026-06-15

---

## 1. Problem statement — why SPEC-3 is blocked

SPEC-3 wants to raise an `intervention_alerts` row when a student answers wrong on
the same topic enough times in a row. The consecutive-wrong counter lives on
`adaptive_mastery.consecutive_wrong`, which is keyed by `node_code` (text). But
`intervention_alerts.topic_id` is a `curriculum_topics.id` (uuid). There is
currently **no reliable join** from one to the other.

The blocker is already documented inline in the SPEC-3 implementation, which
deliberately *skips* the consecutive-wrong path rather than guess an attribution:

> `src/lib/quiz/post-submit-telemetry.ts:287-311` — "OQ-5: adaptive_mastery is keyed
> by node_code (text), NOT topic_id … the adaptive_mastery.consecutive_wrong path is
> skipped and no alert is inserted from it." A mis-attributed `intervention_alerts.topic_id`
> is judged worse than none, so SPEC-3 ships defensively until this bridge exists.

### The four schema facts (cited)

| # | Fact | Source |
|---|---|---|
| F1 | `adaptive_mastery` is keyed by `node_code text NOT NULL` and carries `consecutive_wrong integer` (the SPEC-3 signal). It has **no** `topic_id` column. | `supabase/migrations/00000000000000_baseline_from_prod.sql:9417` (node_code), `:9428` (consecutive_wrong) |
| F2 | `learning_graph` carries `node_code text NOT NULL` but **no** `topic_id` and **no** FK to `curriculum_topics`. It anchors to curriculum only by `(subject_code, grade, chapter_number)`. | baseline `:11856` (node_code), `:11861-11863` (subject_code/grade/chapter_number) |
| F3 | `curriculum_topics` is keyed by `id uuid` (the value `intervention_alerts.topic_id` needs) and carries `(subject_id uuid, grade, chapter_number)` — but **no** `node_code`. | baseline `:10871` (id), `:10872` (subject_id), `:10881` (grade), `:10883` (chapter_number) |
| F4 | `question_bank` carries `topic_id uuid` **and** a separate `concept_code text` — but **no** `node_code`. Its `topic_id` is nullable. | baseline `:2127` (topic_id), `:2155` (concept_code) |

Net: no table in the graph holds both a `node_code` and a `curriculum_topics.id`,
so there is no key to join `adaptive_mastery.consecutive_wrong` to a topic.

---

## 2. What `node_code` actually is, what `topic_id` is, and why they don't join

### `node_code` — a derived, chapter-grained string

`node_code` is **not** an opaque id. It is a deterministic string composed from
subject + grade + chapter, generated at write time:

```
node_code := LOWER(subject) || '_' || grade || '_ch' || chapter_number
```

— `supabase/migrations/20260505155947_backfill_bkt_mastery_all_sessions.sql:48`
(the BKT mastery backfill that populates `adaptive_mastery`). Example: `math_8_ch5`.

Two consequences flow from this:

1. **node_code is chapter-grained, not topic-grained.** One `node_code` represents
   an entire `(subject, grade, chapter)` — i.e. the same granularity as a row in
   the `chapters` table (`baseline:10321`, keyed by `subject_id`/`subject_code` +
   `grade` + `chapter_number`). A single chapter contains *many* `curriculum_topics`
   rows (`curriculum_topics` has `parent_topic_id` and `chapter_number` — multiple
   topics per chapter). So `node_code → curriculum_topics.id` is inherently **one-to-many**,
   not one-to-one.

2. **`learning_graph` already keys off the same node_code string.** The existing
   `generate_at_risk_alerts` RPC does `JOIN public.learning_graph lg ON lg.node_code = am.node_code`
   (`baseline:3937`) and even reads `am.consecutive_wrong >= 2` to raise a *regression*
   alert. So a node_code → learning_graph join is a live, working convention today —
   but `learning_graph` carries no `topic_id` to forward (F2).

### `topic_id` — a uuid identity into `curriculum_topics`

`topic_id` is `curriculum_topics.id` (uuid, F3). It is the canonical, fine-grained
unit the topic-facing surfaces speak: `concept_mastery.topic_id` (F-adjacent,
`baseline:10664`), `question_bank.topic_id` (F4), `chat_sessions.topic_id`
(`baseline:10351`), and the proposed `intervention_alerts.topic_id`.

### Why they don't join

- **Granularity mismatch.** node_code = a chapter; topic_id = a topic *inside* a
  chapter. Even a perfect node_code → chapter resolution yields a *set* of topic_ids,
  not one.
- **No shared column.** node_code lives on `adaptive_mastery` + `learning_graph`;
  topic_id lives on `curriculum_topics` + `question_bank` + `concept_mastery`. The
  only overlap is the indirect `(subject, grade, chapter_number)` triple — and even
  that requires reconciling `subject` (node_code's `LOWER(subject)` text fragment) →
  `subjects.code` (`baseline:14125`) → `curriculum_topics.subject_id` (uuid).

### Existing precedent worth noting

`at_risk_alerts` — the platform's *current* alert table — sidesteps the whole problem
by storing **`node_code text`** directly (`baseline:9940`), never a topic_id. SPEC-3's
choice to introduce `intervention_alerts.topic_id` is the thing that *creates* the OQ-5
gap; the prior generation of alerts never needed a topic_id.

---

## 3. Options

### Option A — add `learning_graph.topic_id` column + backfill

Add a nullable `topic_id uuid REFERENCES curriculum_topics(id)` to `learning_graph`,
backfill it, and at SPEC-3 read-time go `adaptive_mastery.node_code → learning_graph.node_code → learning_graph.topic_id`.

- **Schema change:** `ALTER TABLE learning_graph ADD COLUMN topic_id uuid` (additive,
  nullable, idempotent). One FK. Optional index on `(node_code)` already implied by
  existing joins.
- **Backfill feasibility:** **Poor / lossy.** node_code is chapter-grained but
  `learning_graph` rows are *node*-grained (node_type can be concept/skill/etc. with
  `parent_code`). To set a single `topic_id` per learning_graph row you must pick one
  `curriculum_topics` row per `(subject_code→subject_id, grade, chapter_number)` —
  but there are many topics per chapter (F3). There is no column today expressing
  "which topic does this learning_graph node correspond to," so the backfill would
  have to **guess** (e.g. first topic by `display_order`). That reintroduces exactly
  the mis-attribution the SPEC-3 author refused.
- **RLS impact:** None new — `learning_graph` is public-read (`lg_read … USING (true)`,
  `baseline:21340`) and `curriculum_topics` is public-read (`topics_read_all … USING (true)`,
  `baseline:22486`). Adding a column to a public-read table changes nothing.
- **Accuracy risk:** **High.** The column would assert a 1:1 node→topic mapping that
  the data does not actually have. Wrong topic_id on a teacher/parent-visible alert is
  a P13-adjacent trust defect.

### Option B — dedicated bridge table `node_topic_map`

Create `node_topic_map (node_code text, topic_id uuid, …)` with rows authored/curated
explicitly, and join through it.

- **Schema change:** new table + RLS (public-read mirrors `learning_graph`/`curriculum_topics`,
  service-role write) + FK to `curriculum_topics` + index on `node_code`. Must follow
  the migration template (RLS in same migration, idempotent).
- **Backfill feasibility:** **Honest but expensive.** Lets you model the *true*
  one-to-many (one node_code → N topic rows) or a curated *primary* topic per node_code.
  But the seed data must be *authored* — there is no source column to derive it from
  today (same root cause as A). This is a content-curation task, not a SQL backfill.
- **RLS impact:** New table → must ship student/parent/teacher read pattern. Since the
  map is reference data (not per-student), public-read `USING (true)` matching the two
  curriculum tables is the correct posture; no per-student policy needed. No service-role
  key exposure.
- **Accuracy risk:** **Low if curated, but high latency to value.** Accurate only after
  someone populates it; until then SPEC-3 stays blocked. Highest correctness ceiling,
  slowest to ship.

### Option C — derive `topic_id` at read-time by parsing `node_code`

No schema change. At SPEC-3 read-time, parse `node_code` (`split on '_'` →
`subject`, `grade`, `chXX`), resolve `subject → subjects.code → subject_id`, then
`SELECT id FROM curriculum_topics WHERE subject_id = ? AND grade = ? AND chapter_number = ?`.

- **Schema change:** **None.** Pure read-side logic (or a `SECURITY INVOKER` helper RPC).
- **Backfill feasibility:** N/A (nothing to backfill).
- **RLS impact:** None if done as `SECURITY INVOKER` against public-read curriculum
  tables. A `SECURITY DEFINER` resolver would require a justifying SQL comment per the
  rejection rules — avoid it; not needed here.
- **Accuracy risk:** **High — the granularity mismatch is unsolved.** The WHERE clause
  returns **N rows** (every topic in the chapter), not one. You'd still have to pick one
  arbitrarily (e.g. `ORDER BY display_order LIMIT 1`) → same mis-attribution as A.
  Also brittle: node_code's `LOWER(subject)` fragment is the *quiz_session subject string*,
  which is not guaranteed byte-equal to `subjects.code` (one is derived from
  `quiz_sessions.subject`, the other is the canonical code) — a parse/normalize seam
  that can silently miss.

### Option D — re-key the SPEC-3 signal off `concept_mastery` instead

`concept_mastery` is already keyed by `topic_id uuid` (`baseline:10664`) — no bridge
needed. If its counters could express "consecutive wrong," SPEC-3 reads it directly.

- **Schema change:** depends. Reading existing columns = none. But see the blocker below.
- **Backfill feasibility:** N/A for reads.
- **RLS impact:** `concept_mastery` is student-scoped (`concept_mastery_own … student_id = get_my_student_id()`,
  `baseline:20804`) plus guardian/teacher read (`cm_readonly_others`, `baseline:20670`) —
  exactly the visibility an alert needs. **Best RLS fit of all four options.**
- **Accuracy risk / BLOCKER:** **`concept_mastery` has `consecutive_correct` only —
  there is NO `consecutive_wrong` column** (`baseline:10678` is the only `consecutive_*`
  on the table; compare `adaptive_mastery` which has *both* at `:9427-9428`). So the
  SPEC-3 signal does not exist on `concept_mastery` today. Making D viable would itself
  require an additive schema change (`ADD COLUMN consecutive_wrong`) **plus** rewiring the
  BKT update RPC (`update_concept_mastery`-style at `baseline:8481`) to maintain it on
  every attempt — a behavior change in the learner-state hot path, which pulls in
  assessment as a mandatory reviewer (learner-state rules) and is far heavier than a
  pure architect schema change.

---

## 4. Recommendation

**Recommended: a two-step path — ship D's column long-term, but treat the granularity
truth as the gating decision.** Concretely:

1. **Short term (unblock honestly): keep SPEC-3 defensive OR adopt Option B's *primary-topic*
   shape, never A or C as a silent best-guess.** The SPEC-3 author's instinct is correct:
   a wrong topic_id on a teacher/parent-facing alert is worse than no alert. Options A and
   C both *manufacture* a 1:1 mapping the data does not have, so both are **rejected** as
   the primary mechanism.

2. **Preferred long-term: Option D (add `concept_mastery.consecutive_wrong`)** because it
   is the only option where (a) the key is *already* `topic_id` at the right granularity,
   (b) the RLS posture already matches alert visibility (student + guardian + teacher), and
   (c) there is no lossy bridge to maintain. The cost is real — it is a learner-state hot-path
   change, not a pure architect change — so it requires assessment co-review and user approval.

3. **If D's hot-path change is deemed too invasive this pass: Option B (`node_topic_map`)
   with a *curated primary topic_id per node_code* (one row per node_code, the
   chapter's anchor/intro topic), explicitly marked as chapter-level attribution in the
   alert payload** so the UI never implies topic-precision it doesn't have.

Rationale for rejecting A and C as primaries: both rely on `ORDER BY display_order LIMIT 1`
(or equivalent) to collapse a one-to-many into one, which is the exact mis-attribution
the SPEC-3 author refused. The granularity mismatch (node_code = chapter, topic_id = topic)
is the real OQ-5 problem; no amount of column-adding or string-parsing dissolves it — it can
only be resolved by either (D) moving the signal to the topic-grained table, or (B) curating
the chapter→primary-topic choice as authored data.

### Verification steps required before implementing (any option)

1. **Confirm the granularity claim against live data:** `SELECT subject_id, grade, chapter_number, count(*) FROM curriculum_topics GROUP BY 1,2,3 HAVING count(*) > 1` — verify chapters really do hold multiple topics (expected: yes). If most chapters have exactly one topic, A/C become far less lossy and the calculus changes.
2. **Confirm node_code subject fragment ↔ `subjects.code` parity:** sample `SELECT DISTINCT split_part(node_code,'_',1) FROM adaptive_mastery` vs `SELECT lower(code) FROM subjects` — measure the miss rate before trusting any parse-based resolution (Option C's hidden failure mode).
3. **Confirm `learning_graph` node_code coverage:** `SELECT count(*) FROM adaptive_mastery am LEFT JOIN learning_graph lg ON lg.node_code = am.node_code WHERE lg.id IS NULL` — measure how many `adaptive_mastery` rows have no `learning_graph` row at all (affects A and any node_code-routed option).
4. **For D specifically:** audit every writer of `concept_mastery` (`baseline:8481` and siblings) to enumerate where `consecutive_wrong` would need maintenance; get assessment sign-off that incrementing it does not perturb the SM-2 / BKT math.
5. **Decide and document the alert granularity contract:** is `intervention_alerts.topic_id` allowed to be chapter-anchored (a representative topic) or must it be the exact failed topic? This product decision determines whether B's "primary topic" is acceptable.
6. **User approval gate:** every viable option is an additive schema change on curriculum / learner-state tables. Per CLAUDE.md (User Approval Required For: RBAC/migrations/invariants) and the architect rejection rules, the implementing migration must be user-approved before merge. D additionally invokes the assessment review chain (learner-state rules).

---

## 5. Open questions

- **OQ-5a (granularity contract):** Must SPEC-3 attribute to the exact failed *topic*, or
  is *chapter-level* attribution acceptable for the consecutive-wrong alert? This single
  answer collapses the option space: chapter-level → B/A become acceptable; topic-level →
  only D (with real per-topic wrong tracking) is correct.
- **OQ-5b (signal source of truth):** Should consecutive-wrong be a *property of the topic*
  (concept_mastery, Option D) going forward, deprecating the chapter-grained
  `adaptive_mastery.consecutive_wrong` for intervention purposes? If yes, D is strategically
  aligned, not just tactically convenient.
- **OQ-5c (curation ownership):** If Option B, who authors and maintains `node_topic_map`
  (assessment / content QA)? Reference data with no derivation source needs an owner.
- **OQ-5d (subject-string canonicalization):** node_code embeds `LOWER(quiz_sessions.subject)`,
  not `subjects.code`. Is there a guaranteed normalization between the two, or is there latent
  drift (e.g. `"social_science"` vs `"sst"`)? Affects A, B-backfill, and C.
- **OQ-5e (interaction with `at_risk_alerts`):** The existing `at_risk_alerts` already raises a
  node_code-keyed `regression` alert at `consecutive_wrong >= 2` (`baseline:3937`). Does
  SPEC-3's `intervention_alerts` duplicate, supersede, or complement it? If `at_risk_alerts`'
  node_code convention is acceptable for teachers, SPEC-3 could store `node_code` too and skip
  the bridge entirely (re-scoping OQ-5 out of existence).
