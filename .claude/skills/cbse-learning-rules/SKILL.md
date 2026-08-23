---
name: cbse-learning-rules
description: Grade-subject mappings, Bloom's taxonomy targets, question bank entry checklist, and exam timing reference for CBSE content. Use when adding questions, changing subject lists, or modifying grade-dependent behavior.
user-invocable: false
---

# Skill: CBSE Learning Rules

Concrete rules for curriculum content, question banks, subject codes, and grade-level logic. **Owning agent**: assessment.

## Current live subject scope (server-enforced — verify before quoting elsewhere)

As of migrations `supabase/migrations/20260814000007_subject_catalogue_restrict_math_science.sql` (catalogue layer) and `20260814000008_grade_subject_map_restrict_and_destream.sql` (grade-map layer), the **reachable, server-enforced** CBSE subject catalogue is restricted to a keep-set:

| Grades | Reachable subjects | Notes |
|---|---|---|
| 6-10 | `math`, `science` | Stream is NULL. Other subject codes (English, Hindi, Social Studies, and the out-of-band `informatics_practices`/`health_fitness`/`psychology`/`fine_arts`/`sociology`/`home_science` codes) are outside the current keep-set and are not reachable via `get_available_subjects()` / `enforce_subject_enrollment()` today. |
| 11-12 | `math`, `physics`, `chemistry`, `biology` | De-streamed: rows are stream-`NULL`, so they match every student regardless of `commerce`/`humanities`/`science` stream. There is **deliberately no `science` row at 11-12** — the UI presents physics+chemistry+biology as one "Science" choice grouped with Mathematics. |

**This is the currently-implemented, server-enforced state, not a hypothetical.** `is_active` on `public.subjects` gates *reads* (`get_available_subjects`); `grade_subject_map` gates what's assignable/enrollable. Before assuming any subject outside this keep-set is reachable, re-check both — this restriction can drift, and the migrations' own header text is explicit that the keep-set is declared exactly once and should not be silently widened or narrowed elsewhere.

### Known, currently-open discrepancy — report it, do not silently resolve it

`plan_subject_access` (pricing/plan gating) was **deliberately not updated** alongside the grade-map restriction above (tracked as "M3, on hold" in the migration's own header) because widening it is a pricing change requiring CEO approval. Net effect: a grade 11-12 student on the `free` or `starter` plan can see physics/chemistry/biology exist in the catalogue but is granted only `math`+`science` access — and there is no `science` row at 11-12, so that student is effectively down to `math` alone until the pricing decision is made. Grades 6-10 are unaffected (math+science are both granted on every plan). If a task touches plan/subject access for 11-12, **surface this gap explicitly** rather than "fixing" it as a drive-by — it needs product/pricing sign-off, not a code fix.

## Grade Format Checklist

- [ ] Stored as string: `"6"`, `"7"`, ..., `"12"` — never integer in DB columns, RPCs, API params, or TypeScript types
- [ ] Display: `"Class 6"` (en) / `"कक्षा 6"` (hi)
- [ ] Validation: reject values outside `"6"`-`"12"` range

## Bloom's Taxonomy Levels

| Level | Code | Meaning | Typical Question Stem |
|---|---|---|---|
| 1 | `remember` | Recall facts | "What is...", "Name the...", "Define..." |
| 2 | `understand` | Explain concepts | "Explain why...", "Describe...", "What happens when..." |
| 3 | `apply` | Use in new situations | "Calculate...", "Solve...", "Apply the formula..." |
| 4 | `analyze` | Break down, compare | "Compare and contrast...", "What is the relationship..." |
| 5 | `evaluate` | Judge, justify | "Which approach is better and why...", "Evaluate..." |
| 6 | `create` | Design, construct | "Design an experiment...", "Propose a solution..." |

### Target distribution by exam type

| Exam Type | remember | understand | apply | analyze | evaluate | create |
|---|---|---|---|---|---|---|
| Quick Check | 50% | 40% | 10% | 0% | 0% | 0% |
| Standard Test | 20% | 30% | 30% | 15% | 5% | 0% |
| Challenge | 10% | 15% | 25% | 30% | 15% | 5% |
| Full Exam | 15% | 20% | 25% | 20% | 15% | 5% |

These are targets. If the question bank lacks coverage at a level, serve what's available — do not fabricate a question to hit a target percentage.

## Question Bank Entry Checklist

Before inserting any question:
- [ ] `question_text`: non-empty, no `{{`, `[BLANK]`, `TODO`, `FIXME`
- [ ] `options`: JSON array, exactly 4 elements, all non-empty strings, all distinct
- [ ] `correct_answer_index`: integer, 0 ≤ value ≤ 3
- [ ] `explanation`: non-empty, ≥ 20 characters, educationally useful
- [ ] `difficulty`: one of `easy`, `medium`, `hard`
- [ ] `bloom_level`: one of `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`
- [ ] `grade`: string, `"6"` through `"12"`
- [ ] `subject`: a code within the **current live subject scope above** for that grade — check the keep-set before assuming a subject code is servable

### Difficulty distribution target

30% easy / 50% medium / 20% hard.

## Exam Timing Reference

| Category | Subjects (in current live scope) | Easy | Medium | Hard |
|---|---|---|---|---|
| stem_calc | `math` | 90s | 150s | 210s |
| stem_concept | `science` (6-10), `physics`/`chemistry`/`biology` (11-12) | 75s | 120s | 180s |

Grade multiplier: 6→1.3, 7→1.25, 8→1.2, 9→1.1, 10→1.05, 11-12→1.0. Then +10% buffer, round up to 5 minutes.

**`language` and `humanities` categories** (english, hindi, social_studies, economics, accountancy, business_studies, political_science, history_sr, geography, computer_science, coding) are not part of the current server-enforced reachable catalogue for CBSE (see above). Their timing entries are not restated here to avoid implying they're currently servable — if a task needs to re-expand scope to include them, that is a product/catalogue decision (see the discrepancy note above), not something to infer from an old timing table.

## Content Gap Detection

Run `npx tsx scripts/check-content-gaps.ts` to audit missing subjects/grades in the question bank, chapters below minimum question count, and RAG content chunk coverage. Requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. For the math/science RAG-specific coverage audit, use `rag-math-science-tuning` instead.
