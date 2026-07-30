# Diagnostic Cold-Start Correctness — Assessment Spec

**Status**: DEFINED (assessment). Not implemented.
**Owner**: assessment (this document is the source of truth for correct behavior).
**Implementers**: backend (`/api/diagnostic/start`, `/api/diagnostic/complete`), frontend (`/diagnostic` page), testing (oracles in §8), ai-engineer (only if the pool-fill path is later routed through `quiz-generator`).
**Date**: 2026-07-29
**Touches invariants**: P5 (grade strings), P6 (question quality), P7 (bilingual). **Does NOT touch P1 or P2** — the diagnostic remains XP-neutral and `score_percent` keeps `Math.round((correct / total) * 100)` verbatim.

---

## 0. Why this exists

`/api/diagnostic/start` currently selects:

```
FROM question_bank
WHERE grade = $grade AND subject = $subject AND is_active = true
ORDER BY difficulty ASC
LIMIT 15
```

`question_bank.difficulty` is an **integer** (`DEFAULT 1`), where 1=easy / 2=medium / 3=hard (confirmed by `packages/lib/src/supabase.ts:1424` `diffMap` and by the `irt_difficulty` proxy seed in `20260622100000_seed_irt_difficulty_proxy.sql`, which maps `1 → -1.0, 2 → 0.0, 3 → +1.0`). So `ORDER BY difficulty ASC LIMIT 15` deterministically serves **the 15 easiest rows in the entire subject**, unverified content included, with no chapter spread and no Bloom's spread.

Three consequences, all of which were visible in the failed school demo:

1. **It yields almost no information.** Under the platform's own 3PL model (`cognitive-engine.ts:911-935`, D=1.7, a=1.0, c=0.25, b=(d−2)·1.5), a 15-item all-easy form has a standard error of **2.26 at θ=+1.5 and 3.45 at θ=+2** — i.e. it cannot distinguish a good student from an excellent one at all. Expected raw score at θ=+0.5 is **14.6/15 (98%)**; at θ=+1.5 it is **14.9/15 (100%)**. The form ceilings out for anyone at or above average.
2. **It downstream-corrupts the placement.** `/api/diagnostic/complete` maps `score_percent ≥ 70 → recommended_difficulty: 'hard'`. Because the form ceilings, essentially *every* student is placed at `hard`. The placement signal is noise.
3. **It is a hard dead end for grades 11-12.** `resolve-next-action.ts:605-616` routes every zero-mastery student — all grades — to `/diagnostic`, but `VALID_DIAGNOSTIC_GRADES = ['6'..'10']` in both the route (line 22) and the page (line 75). A Class 11 student's very first CTA returns HTTP 400.

---

## 1. Selection rule — the blueprint

### 1.1 Target form

A cold-start diagnostic is a **15-item fixed-form stratified placement test**, not an adaptive test. Blueprint:

| Band | `question_bank.difficulty` | Count | Share |
|---|---|---|---|
| easy | `1` | **5** | 33% |
| medium | `2` | **6** | 40% |
| hard | `3` | **4** | 27% |
| **total** | | **15** | 100% |

**This is the exact target. `5 / 6 / 4` is the spec; it is not a suggestion.**

### 1.2 IRT justification

Using the platform's own 3PL parameters (D=1.7, a=1.0, c=0.25; b = −1.5 / 0.0 / +1.5 for difficulty 1/2/3), test information `I(θ) = D²a²·((P−c)²/(1−c)²)·((1−P)/P)`, and standard error `SE(θ) = 1/√ΣI(θ)`:

| Blueprint | SE(−2) | SE(−1) | SE(0) | SE(+1) | SE(+1.5) | SE(+2) | worst SE on [−2,+2] |
|---|---|---|---|---|---|---|---|
| **current** 15/0/0 | 0.48 | 0.40 | 0.68 | 1.49 | 2.26 | **3.45** | **3.45** |
| **spec** 5/6/4 | 0.82 | 0.60 | 0.54 | 0.59 | 0.61 | 0.69 | **0.82** |
| alt 5/7/3 | 0.82 | 0.59 | 0.51 | 0.59 | 0.65 | 0.76 | 0.82 |
| alt 4/7/4 | 0.91 | 0.63 | 0.52 | 0.56 | 0.60 | 0.68 | 0.91 |
| alt 5/5/5 | 0.82 | 0.61 | 0.57 | 0.58 | 0.58 | 0.64 | 0.82 |

`5/6/4` cuts the worst-case standard error from **3.45 → 0.82**, a **4.2×** improvement, and specifically fixes the above-average blind spot: SE at θ=+1.5 falls from 2.26 to 0.61 (**3.7×**). `5/7/3` is marginally flatter at the middle but degrades faster at the top (SE 0.76 vs 0.69 at θ=+2), which is exactly the failure mode we are fixing — so `5/6/4` wins.

Expected `score_percent` under `5/6/4` (a healthy monotone spread, no ceiling):

| θ | −2 | −1.5 | −1 | −0.5 | 0 | +0.5 | +1 | +1.5 | +2 |
|---|---|---|---|---|---|---|---|---|---|
| **5/6/4** | 34 | 40 | 47 | 56 | **65** | 73 | 81 | 88 | 93 |
| current 15/0/0 | 47 | 63 | 78 | 88 | **95** | 98 | 99 | 100 | 100 |

A purely minimax-optimal spread over the 3 coarse bands is `7/3/5` (worst SE 0.70), but it is bimodal — it under-samples the middle where most CBSE students actually sit and it *feels* erratic to a 12-year-old. `5/6/4` gives up 0.12 of worst-case SE for a monotone, motivating ramp and near-alignment with the house content target (30/50/20, `.claude/skills/cbse-learning-rules`).

### 1.3 Item sequencing (fixed positional template)

Difficulty band by position — **this exact template**, so the felt experience is a ramp, not a wall:

| Pos | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Band | E | E | M | M | **H** | M | E | **H** | M | M | **H** | E | M | **H** | E |

Properties this template guarantees, all of which are assertable:
- Positions 1-2 are easy → every student answers something correctly early.
- The first hard item lands at position 5 → an above-average student meets a discriminating item within the first third.
- No two hard items are adjacent → no discouragement cliff.
- Position 15 is easy → the form ends on a success.

Within a band, item order is randomized per session (seeded by `diagnostic_assessments.id`) so two students do not get the identical form.

### 1.4 Item ranking inside a band

Given the candidate pool for a band, rank and take the top N by:

1. `verification_state = 'verified'` first, then `'legacy_unverified'`, then `'pending'`. (`'failed' | 'failed_fix_in_flight' | 'failed_unfixable'` are excluded outright — see §2.)
2. `is_verified = true` before `is_verified = false`.
3. `irt_calibration_n >= 30` before uncalibrated (per the column comment on `irt_a`: "Trust only when `irt_calibration_n >= 30`"). When calibrated, prefer the item whose `irt_b` is closest to the band anchor (−1.0 / 0.0 / +1.0), and prefer higher `irt_a` (discrimination) among ties.
4. `source_type` order: `ncert_exercise` > `ncert_intext` > `ncert_example` > `cbse_style` > `practice`.
5. Chapter-spread constraint (§3.2) applied as a hard cap during the take.
6. Random tie-break.

### 1.5 What this is NOT (deliberate scope limits)

- **Not** a computerized adaptive test. 15 fixed items, one round-trip, no per-item server call. A 2-stage routing design (stage 1 = 6 items → route to easy/medium/hard stage-2 module) is the right v2 and is explicitly deferred; do not build it in this wave.
- **Not** XP-bearing. The diagnostic awards zero XP today and **must continue to award zero XP**. Making the form harder must never read as an XP penalty. P2 is untouched.
- **Not** a chapter mastery test. See §3.

---

## 2. Verification gate

### 2.1 Tier-0 predicates — HARD, never relaxed at any rung

Every question served in a diagnostic MUST satisfy all of the following. These are SQL-expressible and belong in the `question_bank` query itself, not in post-filtering:

| # | Predicate | Rationale |
|---|---|---|
| V1 | `is_active = true` | existing |
| V2 | `deleted_at IS NULL` | soft-delete respect (`20260622060000`) |
| V3 | `content_status = 'published'` | draft/review/archived content is not student-facing (`question_bank_content_status_check`) |
| V4 | `grade = $grade` where `$grade` is a **string** in `'6'..'12'` | **P5** |
| V5 | `subject = lower($subject)` | existing |
| V6 | `question_type_v2 = 'mcq'` | a diagnostic must be auto-scorable with zero grader ambiguity. `short_answer`/`long_answer`/`case_based` are out of scope for cold start. |
| V7 | `jsonb_array_length(options) = 4` | **P6** (also enforced by `chk_four_options`) |
| V8 | all 4 options non-empty after trim, and `>= 3 distinct` | **P6** (matches `validateQuestion` in `quiz-assembler.ts`) |
| V9 | `correct_answer_index BETWEEN 0 AND 3` | **P6** (also `chk_valid_answer_index`) |
| V10 | `length(btrim(question_text)) >= 15` | **P6**, matches `quiz-assembler.ts:64` |
| V11 | `question_text NOT LIKE '%{{%' AND question_text NOT LIKE '%[BLANK]%'` | **P6** |
| V12 | `explanation IS NOT NULL AND length(btrim(explanation)) >= 20` | **P6**, matches `quiz-assembler.ts:121` |
| V13 | `difficulty IN (1, 2, 3)` | blueprint requires a real band; `NULL`/other = unassignable |
| V14 | `bloom_level IN ('remember','understand','apply','analyze','evaluate','create')` | **P6** + §6 |
| V15 | `verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')` | a question the NCERT verifier **disproved** must never be a new student's first impression of the product |
| V16 | `source_type IN ('ncert_intext','ncert_exercise','ncert_example','cbse_style','practice')` | excludes the competition tiers (`jee_archive`, `neet_archive`, `olympiad`, `pyq`) added by `20260520000004`, which share the same `subject`+`grade` pool. Same allow-list the mock-test RPC uses (`20260722097000`). |
| V17 | chapter is in the student's syllabus — see §3.1 | scope |
| V18 | no duplicate `question_bank.id` within one diagnostic | **P6** |

### 2.2 Reuse, do not reimplement, the text-quality screen

After the SQL fetch and before serving, every candidate MUST pass `validateQuestion()` from `packages/lib/src/quiz-assembler.ts` unchanged. That function already carries the platform's garbage-text patterns ("unrelated topic", "which of the following best describes the main topic…"), garbage-option patterns ("physical education", "art and craft"), and unreliable-explanation patterns ("does not match any option", "none of the options"). Backend MUST import it, not duplicate its rules. Any item it rejects is dropped and the ladder in §5 refills.

### 2.3 Is `verification_state = 'verified'` a hard filter? — **NO, it is a rung, not a floor**

**Position: `verification_state = 'verified'` is REQUIRED at Rung 0 and RELAXED at Rung 1. `is_verified = true` is a ranking preference only, never a filter.**

Reasoning:

- `question_bank.verification_state` defaults to `'legacy_unverified'` and `is_verified` defaults to `false`. Both defaults mean "nobody has checked this yet" — **not** "this is bad." A hard filter on either would reject the entire pre-verifier corpus.
- Making it a hard floor converts a *quality* problem into an *availability* problem: instead of a mediocre diagnostic we would ship a 404 for most subjects. That is strictly worse for the hero CTA.
- V15 already removes the genuinely dangerous rows (verifier **disproved** them). The gap between "verified good" and "never checked" is a confidence gap; the gap between "never checked" and "proven wrong" is a correctness gap. Only the second is a hard filter.

**Expected pool impact — MUST BE MEASURED BEFORE IMPLEMENTATION.** I could not query production. Backend/ops must run the following and attach the output to the implementation PR; if Rung 0 (`verified` only) cannot fill `5/6/4` for the top-10 grade×subject pairs by volume, that is expected and Rung 1 carries the load:

```sql
SELECT grade, subject,
       count(*) FILTER (WHERE difficulty = 1) AS easy,
       count(*) FILTER (WHERE difficulty = 2) AS medium,
       count(*) FILTER (WHERE difficulty = 3) AS hard,
       count(*) FILTER (WHERE verification_state = 'verified')          AS verified,
       count(*) FILTER (WHERE verification_state = 'legacy_unverified') AS legacy,
       count(*) FILTER (WHERE is_verified)                              AS sme_verified,
       count(DISTINCT chapter_number)                                   AS chapters,
       count(DISTINCT bloom_level)                                      AS blooms,
       count(*)                                                         AS total
FROM question_bank
WHERE is_active AND deleted_at IS NULL AND content_status = 'published'
  AND question_type_v2 = 'mcq'
  AND verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')
  AND source_type IN ('ncert_intext','ncert_exercise','ncert_example','cbse_style','practice')
GROUP BY grade, subject
ORDER BY grade, subject;
```

**Column-semantics flag (see §9):** `is_verified`, `verification_state`, and `verified_against_ncert` are three separate columns whose relationship is not documented anywhere I could find. This spec deliberately gates on `verification_state` (the documented state machine, per its `COMMENT ON COLUMN`) and treats `is_verified` as a preference only. If ops/architect determine `is_verified` is the authoritative SME gate, that changes §1.4 ranking priority 2 into a Rung-0 requirement — come back to me before making that change.

---

## 3. Scope

### 3.1 Position: **whole subject, restricted to the student's in-scope syllabus. NOT term-scoped, NOT chapter-scoped.**

Rules:

- **S1.** `chapter_number` MUST match a row in `cbse_syllabus` for `(board='CBSE', grade=$grade, subject_code=$subject)` with `is_in_scope = true`. Items with `chapter_number IS NULL`, or a chapter outside the student's syllabus, are excluded.
- **S2.** No term filter. **Term boundaries are not modeled in this schema** — I grepped `cbse_syllabus` and the surrounding curriculum tables and there is no `term` column (the only `term` column in the DB is on `hpc_records`, a report-card table). A term-scoped diagnostic is currently un-implementable without a schema change, and I am not requesting one.
- **S3.** The caller does **not** pass a chapter. `/api/diagnostic/start` MUST reject a `chapter` parameter if one is ever added — a chapter-scoped assessment is a quiz, not a diagnostic, and belongs on `/quiz`.

### 3.2 Chapter spread (hard constraint at Rung 0-2)

- At most **3 of 15** items from any single `chapter_number`.
- At least **5 distinct chapters** represented.
- Prefer earlier chapters for the easy band and later chapters for the hard band where the pool allows (CBSE chapter order is roughly a difficulty gradient) — a preference, not a filter.

### 3.3 Pedagogical justification

The diagnostic's job is **placement**, not mastery measurement. A cold-start student has no mastery signal at all (`state.mastery.length === 0`), so the only useful output is "where in this subject do you sit, and which chapters look weak." That requires breadth. A term- or chapter-scoped diagnostic answers a question nobody asked at cold start and fails outright for the two most common real-world cases: a mid-year joiner, and a student who is behind the current term.

### 3.4 Relationship to `quiz-assembler`'s strict-chapter rule — no conflict

`quiz-assembler.ts` removed its Rung 3 because silently swapping the chapter **the student explicitly picked** is a quiz-integrity violation. The diagnostic caller picks **no chapter**, so subject-wide selection is the honest, requested scope — there is nothing to silently swap. The equivalent integrity rule for a diagnostic is S1: never serve a chapter outside the student's own grade+subject syllabus. Both rules say the same thing: *serve exactly the scope the student asked for, or fail loudly.*

---

## 4. Grade coverage

### Position: **(a) SUPPORT grades 11 and 12.** Do not redirect them away from `/diagnostic`.

Rationale — every piece of the substrate already exists; the only thing blocking senior students is a five-element hardcoded array in two files:

- `question_bank`'s own constraint already admits them: `chk_question_bank_grade_p5 CHECK (grade IN ('6'..'12'))`.
- `cbse_syllabus_grade_check` already admits `'11'`/`'12'`.
- `students.stream` already exists (`students_stream_check`: `'science' | 'commerce' | 'humanities'`, nullable).
- `/api/diagnostic/start` **already** calls `validateSubjectWrite(student.id, subject)` → `get_available_subjects(p_student_id)`, which is already grade × stream × plan aware and backed by `grade_subject_map` (which itself has a `stream` column and a `(grade, subject_code, stream)` unique index). **Stream handling is already solved server-side; nothing new is needed.**
- The alternative — routing 11-12 away from `/diagnostic` — would mean a senior student's first CTA is a lesson or a quiz with no placement signal at all. Grades 11-12 are the highest-ARPU, highest-stakes cohort (board year, JEE/NEET adjacency). They need placement *more*, not less.

### Required changes

| ID | Rule |
|---|---|
| **G1** | `VALID_DIAGNOSTIC_GRADES = ['6','7','8','9','10','11','12']` — string literals (**P5**), in `apps/host/src/app/api/diagnostic/start/route.ts` **and** `apps/host/src/app/diagnostic/page.tsx`. |
| **G2** | The page's hardcoded `SUBJECT_OPTIONS` map (`page.tsx:77-101`) MUST be deleted and replaced by a fetch of `get_available_subjects` for the logged-in student. It is stream-aware and plan-aware; the hardcoded map is neither and cannot be extended to 11-12 without duplicating the stream matrix client-side. |
| **G3** | Grade is read from `students.grade` and is **display-only / non-editable** on the diagnostic setup screen when the profile already carries one. The current free grade picker lets a Class 11 student self-select "Class 8" and get an off-syllabus diagnostic. |
| **G4** | Grade 11/12 with `students.stream IS NULL`: **do not 400.** Call `get_available_subjects` anyway. If it returns ≥1 unlocked subject, proceed normally. If it returns 0 unlocked subjects, return the structured "pick your stream" response in §7.4 with a CTA to the stream-selection surface. |
| **G5** | The subject a student picks is authoritative for the diagnostic; `validateSubjectWrite`'s existing 422 (`subject_not_allowed`, reason `grade` \| `plan`) is retained unchanged. |

### Secondary CBSE-alignment defect found (flagging, not fixing here)

`page.tsx` offers `physics` / `chemistry` / `biology` as separate subjects for **grades 9 and 10**. Per `.claude/skills/cbse-learning-rules`, grades 6-10 use a single `science` code; `physics`/`chemistry`/`biology` are grade 11-12 codes. Either the skill doc or `grade_subject_map` is wrong. G2 makes this moot for the diagnostic (the governance RPC becomes the single source), but **ops/assessment should reconcile `grade_subject_map` against the CBSE skill doc separately.** Do not "fix" it inside this wave by editing the skill doc.

---

## 5. Insufficient-pool ladder

Target **15**. Absolute floor **10**. Never pad, never silently shorten without telling the student.

### 5.1 The ladder

| Rung | Relaxation | Must still hold | `quality_tier` in response |
|---|---|---|---|
| **0** | none | Tier-0 (§2.1) + `validateQuestion` + `verification_state = 'verified'` + blueprint exactly 5/6/4 + ≥5 chapters + ≤3/chapter + Bloom's §6.1 | `verified` |
| **1** | admit `verification_state IN ('verified','legacy_unverified','pending')` | everything else from Rung 0, unchanged. Rank verified-first (§1.4). | `standard` |
| **2** | blueprint tolerance: easy ∈ [3,7], medium ∈ [4,8], hard ∈ **[2,6]**; chapters ≥3; ≤4/chapter; Bloom's §6.2 | N is still exactly **15**; hard band still ≥2; Tier-0 unchanged | `relaxed_blueprint` |
| **3** | shorten: N ∈ [10,14], proportions held as close as possible, minimum **2 easy / 3 medium / 2 hard**; chapters ≥3; Bloom's §6.2 | Tier-0 unchanged; ≥1 HOTS item | `short_form` |
| **4** | **FAIL — serve nothing** | see §5.3 | `insufficient` |

Implementation shape: one query per rung is acceptable (max 4 round-trips, only on the degraded path). Rung 0 and Rung 1 differ only in a `WHERE verification_state IN (...)` clause, so they can be a single overfetch partitioned in memory.

### 5.2 Never-degraded guarantees (true at every served rung)

1. All Tier-0 predicates V1-V18.
2. `validateQuestion()` passes.
3. MCQ only.
4. Grade and subject exact match; chapter in-syllabus (S1).
5. `verification_state` not in the failed family.
6. **At least 1 hard-band item and at least 1 HOTS Bloom item.** A form with zero above-median items cannot locate an above-median student — serving one would reproduce the exact bug this spec fixes. If the pool cannot supply these, go to Rung 4.
7. No duplicate question ids.
8. `score_percent = Math.round((correct / total) * 100)` where `total` is the number actually served — **P1, unchanged, at every rung including short-form.**

### 5.3 Rung 4 — the honest stop

Trigger Rung 4 when, after Rung 3, **any** of:
- fewer than **10** valid items, OR
- **0** hard-band (difficulty 3) items, OR
- **0** HOTS-Bloom items, OR
- fewer than **3** distinct chapters.

Behavior:

| # | Rule |
|---|---|
| **F1** | Return **HTTP 200**, not 404. The current 404 + `NO_QUESTIONS` renders as a generic failure. This is a known, explainable content state, not an error. |
| **F2** | **Do NOT insert a `diagnostic_assessments` row.** No half-started session. (Mirrors the mock-test RPC's all-or-nothing contract, `20260722097000`.) |
| **F3** | Response body: `{ success: true, data: { content_insufficient: true, quality_tier: 'insufficient', reason: <enum>, available_count, alternatives: [...] } }` where `reason ∈ 'too_few_items' \| 'no_hard_items' \| 'no_hots_items' \| 'too_few_chapters'`. |
| **F4** | **The student is NEVER handed a dead end.** `alternatives` MUST be non-empty. Build it in this order (§5.4). |
| **F5** | Emit a `diagnostic_content_gap` telemetry event with `{ grade, subject, reason, available_count, band_counts, chapter_count }` — **no student identifiers** (P13). Ops needs this to prioritize content generation; it is the only signal that a grade×subject is unshippable. |
| **F6** | Follow-up for backend/ai-engineer (**out of scope for this wave, flagged so it is not forgotten**): `resolve-next-action.ts` branch 1 must not loop a student back to a diagnostic that is known-unavailable for every allowed subject. Recommended shape: persist a per-student `diagnostic_unavailable` marker on F5 and add it to `LoopAugmentation` so branch 1's predicate degrades to `introduce_new_topic`. **Do not implement without coming back to assessment** — it changes learner-state routing, which is my domain (P14 chain: assessment → ai-engineer, frontend, testing). |

### 5.4 Fallback CTAs (ordered; include all that apply, always ≥1)

1. **Another subject.** Before returning, run one grouped `COUNT(*)` over the student's other unlocked subjects (from `get_available_subjects`) with the Tier-0 predicates, and include any that clear Rung 3's floor. CTA → `/diagnostic?subject=<code>`. Copy: §7.3a.
2. **Guided lesson.** Always available if `cbse_syllabus` has any in-scope chapter for this grade+subject. CTA → `/learn/<subject>/<lowest in-scope chapter>?mode=read&from=diagnostic_unavailable`. Copy: §7.3b.
3. **Foxy.** Always. CTA → `/foxy?subject=<code>&from=diagnostic_unavailable`. Copy: §7.3c.

Rule 3 is unconditional, so `alternatives` is provably non-empty (F4 holds by construction).

---

## 6. Bloom's coverage

Canonical order, spelled exactly: `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`.

### 6.1 Rung 0-1 requirement (15 items)

| Level | Min | Max |
|---|---|---|
| `remember` | 2 | 5 |
| `understand` | 3 | 6 |
| `apply` | 3 | 6 |
| **HOTS** = `analyze` + `evaluate` + `create` combined | **2** | 5 |

Plus: **≥4 distinct Bloom levels present**, and **no single level > 6 of 15 (40%)**.

Rationale: this is the "Standard Test" shape from the CBSE skill (20/30/30/15/5/0) with the HOTS tail collapsed into one bucket, because `analyze`/`evaluate`/`create` tagging in the bank is sparse and inconsistent — requiring each individually would force Rung 4 on almost every subject. The HOTS floor of 2 exists for the same reason as the hard-band floor: **without an above-`apply` item, the diagnostic cannot detect a strong student**, which is precisely the failure being fixed.

### 6.2 Rung 2-3 relaxation

- **≥3 distinct Bloom levels** present.
- **HOTS ≥ 1** (never 0 — this is a §5.2 never-degraded guarantee).
- `remember` ≤ 50% of served items (a diagnostic that is half recall is a vocabulary quiz).

### 6.3 Bloom × difficulty coherence — preference, not filter

Prefer HOTS items with `difficulty >= 2` and `remember` items with `difficulty <= 2`. Enforce as a ranking tie-break only. Bank tagging is inconsistent enough that making this a filter would collapse pools without improving the measurement.

---

## 7. Student-facing copy (P7 — bilingual EN/HI)

CBSE, XP, Bloom's, Foxy, and stream names (Science / Commerce / Humanities) are **not translated**, per the constitution. `{placeholders}` are substituted at render time.

### 7.1 Short-form banner — shown when `quality_tier === 'short_form'`

| | |
|---|---|
| **EN** | `We could only find {count} good questions for this subject right now, so this check is shorter than usual. Your result still counts.` |
| **HI** | `अभी इस विषय के लिए हमें केवल {count} अच्छे प्रश्न मिले, इसलिए यह जाँच सामान्य से छोटी है। आपका परिणाम फिर भी गिना जाएगा।` |

### 7.2 Content-insufficient screen — shown when `content_insufficient === true`

| | |
|---|---|
| **EN headline** | `This subject isn't ready yet` |
| **HI headline** | `यह विषय अभी तैयार नहीं है` |
| **EN body** | `We don't have enough good questions for Class {grade} {subject} to give you an honest starting point. We'd rather tell you than waste your time. Here's what you can do right now:` |
| **HI body** | `कक्षा {grade} {subject} के लिए हमारे पास इतने अच्छे प्रश्न नहीं हैं कि हम आपका सही शुरुआती स्तर बता सकें। आपका समय बर्बाद करने से बेहतर है कि हम आपको सच बता दें। अभी आप यह कर सकते हैं:` |

### 7.3 Fallback CTA labels

| Slot | EN | HI |
|---|---|---|
| **a** other subject | `Take the check in {subject} instead` | `इसके बजाय {subject} की जाँच करें` |
| **b** guided lesson | `Start with a guided lesson` | `गाइडेड पाठ से शुरू करें` |
| **c** Foxy | `Ask Foxy anything` | `Foxy से कुछ भी पूछें` |

### 7.4 Stream not selected (grades 11-12, G4 zero-subject case)

| | |
|---|---|
| **EN headline** | `Pick your stream first` |
| **HI headline** | `पहले अपनी स्ट्रीम चुनें` |
| **EN body** | `Class {grade} subjects depend on your stream. Choose Science, Commerce or Humanities and we'll set up your check.` |
| **HI body** | `कक्षा {grade} के विषय आपकी स्ट्रीम पर निर्भर करते हैं। Science, Commerce या Humanities चुनें, फिर हम आपकी जाँच तैयार कर देंगे।` |
| **EN CTA** | `Choose stream` |
| **HI CTA** | `स्ट्रीम चुनें` |

> **Flag for frontend:** I am not inventing the stream-selection route. Point the CTA at whatever the existing onboarding stream step is; if none exists as a standalone reachable surface, that is a gap to raise, not to paper over with a guessed URL.

### 7.5 Recalibrated result copy — REQUIRED

The blueprint change moves an average student's expected `score_percent` from **95% → 65%**. Every threshold calibrated against the old ceiling is now wrong and MUST move together with the blueprint or students will read a correct placement as a failure.

**7.5a — `recommended_difficulty` in `/api/diagnostic/complete`.** Current: `<40 → easy, <70 → medium, else hard`. Under the old all-easy form this placed essentially everyone at `hard`. New mapping, derived from the §1.2 expected-score curve (50% ↔ θ≈−0.85, 80% ↔ θ≈+0.95):

```
score_percent <  50            → 'easy'
score_percent >= 50 and < 80   → 'medium'
score_percent >= 80            → 'hard'
```

**7.5b — encouragement thresholds on the results screen** (`page.tsx:910-913`, currently 70/40) move to the same **80 / 50** boundaries so the badge, the message, and the recommendation never disagree.

**7.5c — new setup-screen reassurance line** (prevents the lower scores reading as failure):

| | |
|---|---|
| **EN** | `Some of these are meant to be hard — that's how we find your level. Getting them wrong costs you nothing.` |
| **HI** | `इनमें से कुछ प्रश्न जानबूझकर कठिन हैं — इसी से हमें आपका स्तर पता चलता है। गलत होने पर कुछ नहीं घटेगा।` |

---

## 7A. Two correctness defects in `/api/diagnostic/complete` that MUST ship with this

These are in my domain (answer correctness) and are load-bearing for the whole spec — a better selection rule is worthless if the scoring input is untrusted.

| ID | Defect | Required behavior |
|---|---|---|
| **C1** | The route accepts `is_correct` **from the client request body** and writes it straight into `diagnostic_responses.is_correct` and into the `score_percent` numerator. The client can assert any score. | Server MUST re-derive: `is_correct := (selected_answer_index === question_bank.correct_answer_index)` for every response, using the row it already fetches in step 6. A client-sent `is_correct` is ignored entirely. If the bank row is missing, `is_correct := false` and log `diagnostic_answer_unresolvable`. **P1: `score_percent` must be `Math.round((correct/total)*100)` over server-derived correctness.** |
| **C2** | No validity guard on the placement output. | If `total_time_seconds / total_questions < 3`, the responses are still stored and `score_percent` is still computed and shown (this is XP-neutral; there is nothing to reject), but `recommended_difficulty` MUST be forced to `'medium'` and the response MUST carry `placement_confidence: 'low'`. A speed-run produces a meaningless θ; the platform must not act on it. **This is a placement-validity rule, not an anti-cheat change — P3's three checks apply to XP-bearing quiz submission via `submitQuizResults()` and are neither removed nor weakened here.** |

**Note on answer-key exposure:** `/start` returns `correct_answer_index` to the client. That is tolerable for an XP-neutral, non-competitive diagnostic (the only harm is self-inflicted misplacement, and C1 removes the scoring trust). It **must not** be copied into any XP-bearing flow — the quiz path's `quiz_session_shuffles` snapshot exists precisely to prevent that.

---

## 8. Acceptance criteria & test oracles

Testing agent implements these. Each is stated as an assertion, not a scenario.

### 8.1 Blueprint (pure-function oracles — extract the selector into a pure module so these need no DB)

| ID | Oracle |
|---|---|
| **AC-1** | Given a pool with ≥20 items in each band, the selector returns exactly 15 items with band counts `{1: 5, 2: 6, 3: 4}`. |
| **AC-2** | The returned band sequence equals `['E','E','M','M','H','M','E','H','M','M','H','E','M','H','E']` mapped to `[1,1,2,2,3,2,1,3,2,2,3,1,2,3,1]`, positionally, at Rung 0 and Rung 1. |
| **AC-3** | Two invocations with different session seeds over the same ≥20-per-band pool return different item id sequences (anti-determinism), but both satisfy AC-1 and AC-2. |
| **AC-4** | **Information oracle.** A reference implementation of `SE(θ) = 1/√Σ I(θ)` using `cognitive-engine.irtProbCorrect` asserts `SE(+1.5) < 1.0` for the returned form. The current `ORDER BY difficulty ASC` form yields `SE(+1.5) ≈ 2.26` and must fail this assertion — **include the old form as an explicit negative fixture** so a regression cannot silently reintroduce it. |
| **AC-5** | No two adjacent positions are both band 3; positions 1, 2 and 15 are band 1. |

### 8.2 Verification gate

| ID | Oracle |
|---|---|
| **AC-6** | For each of V1-V16, a fixture pool containing exactly one violating row asserts that row is **never** in the output — at Rung 0, 1, 2 **and** 3. Table-driven, 16 cases × 4 rungs. |
| **AC-7** | A row with `verification_state = 'failed'` (and each of `'failed_fix_in_flight'`, `'failed_unfixable'`) is excluded even when it is the *only* item that would let the blueprint fill. The correct outcome is degradation, never inclusion. |
| **AC-8** | A pool of only `legacy_unverified` rows produces `quality_tier === 'standard'` (Rung 1) and 15 items — **not** an empty result. Pins the §2.3 position. |
| **AC-9** | Every returned item passes `validateQuestion()` from `quiz-assembler.ts`. Assert by calling the real function, not a copy. |
| **AC-10** | No duplicate `id` in the returned array (V18). |

### 8.3 Scope

| ID | Oracle |
|---|---|
| **AC-11** | An item whose `chapter_number` is absent from the `cbse_syllabus` fixture for that grade+subject, or has `is_in_scope = false`, is never returned. |
| **AC-12** | At Rung 0-1, `≥5` distinct `chapter_number` values and `≤3` items per chapter. |
| **AC-13** | Passing a `chapter` parameter to `/api/diagnostic/start` returns 400 `CHAPTER_NOT_SUPPORTED`. |

### 8.4 Grade coverage

| ID | Oracle |
|---|---|
| **AC-14** | `POST /api/diagnostic/start` with `grade: '11'` and `grade: '12'` and a stream-valid subject returns 200 with 15 questions. Currently returns 400. |
| **AC-15** | Every grade value crossing the route/page/DB boundary is `typeof === 'string'` and matches `/^(6|7|8|9|10|11|12)$/`. Assert **P5** on the request body, the `diagnostic_assessments` insert, and the response. Integer `11` in the body is rejected. |
| **AC-16** | A grade-11 student with `stream = 'commerce'` requesting `physics` gets the existing 422 `subject_not_allowed` with `reason: 'grade'` — governance unchanged. |
| **AC-17** | A grade-11 student with `stream = NULL` whose `get_available_subjects` returns 0 unlocked subjects gets the §7.4 stream payload, **not** a 400 and **not** an empty diagnostic. |
| **AC-18** | `resolve-next-action` returns `kind: 'cold_start_diagnostic'` for a zero-mastery grade-12 student, and that URL now resolves to a 200 — end-to-end, the branch-1 → route contract holds for all 7 grades. |

### 8.5 Ladder

| ID | Oracle |
|---|---|
| **AC-19** | Table-driven per rung. Pool shaped to satisfy exactly rung N → response `quality_tier` equals that rung's tier and item count/band counts fall inside that rung's tolerance. 5 cases (Rung 0,1,2,3,4). |
| **AC-20** | Rung 3 with 10 items: `score_percent` for 7 correct is `70` (`Math.round(7/10*100)`) — **P1 holds on short forms.** |
| **AC-21** | Rung 4: response is HTTP **200**, `content_insufficient === true`, and **no `diagnostic_assessments` row is inserted** (assert the insert spy was not called). |
| **AC-22** | Rung 4: `alternatives.length >= 1` in every fixture, including the pathological "no other subject, no syllabus chapters" case (Foxy CTA is unconditional). |
| **AC-23** | Rung 4: the `diagnostic_content_gap` telemetry payload matches no `/student_id|email|phone|name/i` key (**P13**). |
| **AC-24** | **Never-degraded set.** Property test: across 500 randomly-shaped pools, every served response (any rung) has ≥1 item with `difficulty === 3`, ≥1 HOTS item, and 0 items violating V1-V18. Any pool that cannot satisfy that returns Rung 4. |

### 8.6 Bloom's

| ID | Oracle |
|---|---|
| **AC-25** | At Rung 0-1: `remember ∈ [2,5]`, `understand ∈ [3,6]`, `apply ∈ [3,6]`, `HOTS ∈ [2,5]`, distinct levels ≥4, max single level ≤6. |
| **AC-26** | At Rung 2-3: distinct levels ≥3, HOTS ≥1, `remember` ≤ 50% of served count. |
| **AC-27** | Every returned `bloom_level` is in `['remember','understand','apply','analyze','evaluate','create']` — exact spelling, and the constant array's **order** is asserted against `cognitive-engine.BLOOM_LEVELS`. |

### 8.7 Complete-route correctness

| ID | Oracle |
|---|---|
| **AC-28** | **C1.** A request whose body claims `is_correct: true` for a response where `selected_answer_index !== question_bank.correct_answer_index` produces `is_correct: false` in `diagnostic_responses` and a `score_percent` computed from the server-derived count. A 15-item body claiming all-correct with all-wrong indices yields `score_percent === 0`. |
| **AC-29** | **C1/P1.** `score_percent === Math.round((serverCorrect / responses.length) * 100)` for a randomized 200-case property test. |
| **AC-30** | **C2.** `total_time / total_questions < 3` forces `recommended_difficulty === 'medium'` and `placement_confidence === 'low'`, regardless of score. |
| **AC-31** | **7.5a.** Boundary table: `49 → 'easy'`, `50 → 'medium'`, `79 → 'medium'`, `80 → 'hard'`. |
| **AC-32** | The diagnostic path awards **zero XP**: assert `atomic_quiz_profile_update` is never called and `students.xp_total` is unchanged across a full start→complete cycle (**P2 untouched**). |

### 8.8 Bilingual (P7)

| ID | Oracle |
|---|---|
| **AC-33** | Every string in §7 has both an EN and an HI variant, the HI variant contains at least one Devanagari codepoint (`/[ऀ-ॿ]/`), and neither variant is empty. Table-driven over the copy constant. |
| **AC-34** | The HI variants of §7.3c and §7.4 contain the literal `Foxy` / `Science` / `Commerce` / `Humanities` untranslated (constitution: technical + CBSE terms not translated). |
| **AC-35** | No student-facing string introduced by this spec is hardcoded in a component — all come from a single exported copy constant. |

---

## 9. Column semantics I could NOT verify — flagged, not asserted

These are guesses or open questions. **Do not treat them as established facts. Resolve before or during implementation.**

| # | Column / fact | What I inferred | Confidence & what would settle it |
|---|---|---|---|
| **1** | `question_bank.difficulty` = `integer DEFAULT 1`, meaning 1=easy / 2=medium / 3=hard | Inferred from `supabase.ts:1424` `diffMap = {easy:1, medium:2, hard:3}` and the `irt_difficulty` proxy seed's `CASE difficulty WHEN 1 THEN -1.0 WHEN 2 THEN 0.0 WHEN 3 THEN 1.0` | **High** (two independent sources). **But:** `DEFAULT 1` means any row inserted without an explicit difficulty silently lands in the easy band. I cannot tell what fraction of the bank is `difficulty=1` *by design* vs *by default* — and if most of it is default-1, the blueprint's medium/hard bands may be unfillable everywhere. **Run the §2.3 census before implementing.** This also fully explains why `ORDER BY difficulty ASC` returned garbage: it is sorting on a default. |
| **2** | `is_verified` (bool, default false) vs `verification_state` (text, default `'legacy_unverified'`) vs `verified_against_ncert` (bool, default false) — three verification-ish columns | Inferred: `verification_state` = the automated NCERT-grounding verifier state machine (it has a `COMMENT ON COLUMN` documenting the state machine and is driven by `/api/super-admin/grounding/verification-queue`); `is_verified` = human/SME review, written by the CMS and internal-admin routes; `verified_against_ncert` = a boolean shadow of the verifier | **Low.** I found no document reconciling the three. This spec gates on `verification_state` and treats `is_verified` as a ranking preference. **If ops/architect says `is_verified` is the authoritative SME gate, §1.4 priority 2 becomes a Rung-0 requirement — come back to assessment before changing it.** |
| **3** | `cbse_syllabus.verified_question_count` (drives `rag_status='ready'` at `>= 40`) | I could **not** determine which `question_bank` predicate feeds this counter — `is_verified = true`? `verification_state = 'verified'`? something else? | **Unknown.** Matters because it is the closest thing the platform has to a per-chapter readiness number and would be the cheapest Rung-4 pre-check. Do not wire the ladder to it until the feeding predicate is confirmed. |
| **4** | No `term` column exists on `cbse_syllabus` or any curriculum table | Verified by grep: the only `term` column in the schema is on `hpc_records` (report cards) | **High / asserted.** Term-scoped diagnostics are not implementable today. §3 depends on this. |
| **5** | `question_bank.layer` (int, default 1) and `diagnostic_assessments.layer_tested` (hardcoded to `1` by the current route) | Semantics unknown to me — possibly a Layer-1/2/3 curriculum-depth model | **Unknown.** This spec does not read or write `layer`. If it is load-bearing for diagnostics, the blueprint may need a layer dimension — flag back to assessment. |
| **6** | `source_type` allow-list excluding `jee_archive`, `neet_archive`, `olympiad`, `pyq` | The baseline `chk_source_type` lists only 5 values; `20260520000004` widened it, and the mock-test RPC comment (`20260722097000`) explicitly names the competition tiers to exclude from a CBSE-board pool | **Medium-high.** Confirm the current CHECK's full value set before writing the `IN (...)` list; do not copy mine blind. |
| **7** | `content_status = 'published'` is the correct student-facing filter | From `question_bank_content_status_check (draft, review, published, archived)` + the CMS publish RPC at baseline:8042 | **High.** But note the current `/start` route does **not** filter on it, so today a `draft` question can reach a student. That is a live P6-adjacent defect independent of everything else here. |
| **8** | Pool sizes per grade × subject × band | Not measurable from the repo | **Unknown — this is the single biggest risk to the spec.** If the census in §2.3 shows most subjects cannot fill 5/6/4 even at Rung 1, the correct response is a content-generation wave (ai-engineer + `bulk-question-gen`), **not** loosening the blueprint. Loosening it back toward the floor reproduces the bug. |

---

## 10. Review chain (P14)

Per `.claude/CLAUDE.md`, this is a **learner-state rules** change authored by assessment. Mandatory downstream reviewers:

| Agent | What they must review |
|---|---|
| **backend** | §1-§6 selection/ladder implementation in `/api/diagnostic/start`; §7A C1+C2 in `/api/diagnostic/complete`; §5.4 alternatives pre-check query |
| **frontend** | §7 copy (all of it), G2/G3 setup-screen changes, short-form banner, content-insufficient screen, stream screen, §7.5b results recalibration |
| **ai-engineer** | §2/§6 gates must match `quiz-generator` validation so generated content can actually satisfy the blueprint; §9 row 8 content-generation wave if the census comes back short |
| **testing** | §8 (35 acceptance criteria) |
| **ops/architect** | §9 rows 2, 3, 6 — column semantics; §2.3 census execution |
| **mobile** | Only if the mobile app calls `/api/diagnostic/*`. Verify; the response contract gains `quality_tier`, `content_insufficient`, `alternatives`, `placement_confidence`. |

**No user approval required**: this changes no P1-P14 invariant. `score_percent` and the XP economy are untouched; P3's checks are neither removed nor weakened (§7A C2 is additive and applies to a non-XP surface); P5 and P6 are *strengthened*.
