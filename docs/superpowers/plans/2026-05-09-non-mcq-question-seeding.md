# Non-MCQ Question Seeding — Plan

**Owner:** Pradeep Sharma (solo)
**Drafted:** 2026-05-09 by Claude (Opus 4.7)
**Status:** Phase 1 in progress

## Problem

`question_bank` holds 8,042 questions today. **All 8,042 are MCQ.** Zero short-answer / long-answer / NCERT-Exercise rows exist. The QuizSetup picker offers all five types (MCQ Only / Short Answer / Long Answer / Mixed / NCERT Exercise) but only MCQ returns content.

CBSE board exams require students to *write* answers — VSA (1m), SA (2-3m), MA (3-4m), LA (5-6m). Without practice surfaces backed by real questions, the platform isn't preparing students for the exam they actually sit.

## What's already built (the gap is narrower than it looks)

| Layer | Status | Notes |
|---|---|---|
| `question_bank` schema for non-MCQ | Ready | Columns: `expected_answer(_hi)`, `answer_rubric` (jsonb), `max_marks`, `cbse_question_type`, `paper_section`, `marks_expected`, `answer_text(_hi)`, `answer_methodology`, `ncert_exercise`, `ncert_page`, `is_ncert`, `verification_state`, `quality_status` |
| `ncert_exercises` table | **687 rows extracted but unused** | Schema includes `question_text`, `answer_text`, `marking_scheme` (jsonb), `marks`, `word_limit`, `bloom_level`, `topic_tag`, `solution_steps`, `foxy_answer`, `diagram_url`. 500 of 687 are subject-grade-mappable. |
| RAG corpus | 16,006 chunks | `rag_content_chunks` covers 750/761 syllabus rows (rag_status='partial') |
| Generation Edge Functions | MCQ-only today | `bulk-question-gen` (1307 lines, admin, Claude+RAG); `extract-ncert-questions` (817 lines); `ncert-question-engine` (473 lines); `generate-answers`; `verify-question-bank`; shared `quiz-oracle` validator |
| Written-answer UI | Ready | `src/components/quiz/ncert/WrittenAnswerInput.tsx` supports SA / MA / LA / HOTS / Numerical / Intext, CBSE marks labels, word count |
| Quiz-serve RPC | Already type-aware | `select_quiz_questions_rag` filters on `qb.question_type_v2 = ANY(p_question_types)` |
| Verification queue | Ready | `verification_state` (legacy_unverified → pending → verified → failed) + `verify-question-bank` Edge Function |
| Bilingual columns | Throughout | `_hi` mirrors English columns |

## Schema constraints that shaped Phase 1

- `chk_question_type_v2` allows only `mcq | assertion_reason | case_based | short_answer | long_answer`. **No `'ncert'` value** — NCERT-source rows must classify under SA or LA based on shape.
- `chk_four_options` requires `jsonb_array_length(options) = 4` for *every* row — broken for non-MCQ. Phase 1 relaxes it to MCQ-only.
- `chk_source_type` allows only `ncert_intext | ncert_exercise | ncert_example | cbse_style | practice`.
- `chk_question_bank_grade_p5` enforces grade as string `"6".."12"` (P5 invariant).

## Phased plan (solo-developer days)

### Phase 1 — Promote `ncert_exercises` → `question_bank` (3 days · in progress)

**Why first:** 500 NCERT exercises already extracted with answers + rubrics + marks. SQL migration alone gives every chapter that has them a working SA/LA quiz today.

- Migration relaxes `chk_four_options` to MCQ-only, then bulk-INSERTs 500 mappable rows.
- Mapping: `vsa | sa | short | fill_blank | numerical (marks≤3)` → `short_answer`; `la | long (marks≥5) | hots | numerical (marks>3)` → `long_answer`. The 7 MCQ rows go in as MCQ (with original options).
- Sets `is_ncert=true`, `source_type='ncert_exercise'`, `verification_state='verified'`, `verified_against_ncert=true` (NCERT is canon).
- Idempotent: `WHERE NOT EXISTS` against `(source_type='ncert_exercise', subject, grade, ncert_exercise)`.
- Skips 187 NULL-subject/grade rows (Phase 1.5 backfill via textbook_id join).

**Out of scope for Phase 1:** the "NCERT Exercise" picker button. Today it filters by `question_type_v2='ncert'`, which doesn't exist. Two paths considered: (a) extend `chk_question_type_v2` enum, (b) add `is_ncert` flag to RPC. Defer to Phase 1.5 — the SA + LA + Mixed pickers immediately render NCERT questions after Phase 1 ships.

### Phase 1.5 — Wire the NCERT button (1 day)

- Extend `select_quiz_questions_rag` to accept optional `p_ncert_only boolean`. When true, AND `qb.is_ncert = true` into the WHERE.
- Update `getQuizQuestionsV2` in `src/lib/supabase.ts` to pass `p_ncert_only = (questionTypes.length === 1 && questionTypes[0] === 'ncert')`.
- Update QuizSetup's NCERT button to send `types: ['short_answer', 'long_answer']` plus the ncert flag.

### Phase 2 — Extend `bulk-question-gen` to non-MCQ (5 days)

- Add `question_type` body param (mcq | short_answer | long_answer).
- Per-type prompt templates under `supabase/functions/bulk-question-gen/prompts/`:
  - **SA**: 1-2 marks, 30-60 word answer, single concept focus, expected_answer + key_points marking scheme.
  - **LA**: 5-6 marks, 150-250 word answer, intro / 4-5 main points / conclusion, expected_answer + per-point rubric.
- Extend `quiz-oracle` validator: non-MCQ shape (expected_answer length, rubric structure, no answer leakage in stem, word-count plausibility).
- Insert with `verification_state='pending'` (Claude-generated needs human review per existing P12 chain).
- Cost: ~$5 total for full coverage (Haiku, ~3.8M output tokens for 5 SA + 3 LA per chapter × 761 chapters).

### Phase 3 — Written-answer LLM grader (4 days)

- New Edge Function `grade-written-answer` (modeled on `grade-experiment-conclusion`).
- Input: `{question_id, student_answer, time_spent}`. Output: `{score, partial_breakdown, feedback_en, feedback_hi, missed_points}`.
- Uses Claude Haiku with structured CBSE-examiner prompt grounded in `expected_answer` + `answer_rubric`.
- New table `student_written_answer_attempts` (mirrors `student_ncert_attempts`).
- XP awarded via existing `atomic_quiz_profile_update` RPC (preserves P3 atomicity invariant).
- Anti-cheat: rate-limit, min length 20 chars, Levenshtein vs question (block copy-paste-the-question).

### Phase 4 — Hindi translation pass (2 days)

- Run existing translation pipeline on rows where `_hi` columns are NULL.
- Bilingual-parity test fixture confirms pairing (P7 invariant).

### Phase 5 — Admin verification UI (3 days)

- Tab in `/super-admin/content` for `verification_state='pending'`.
- One-click verify / reject / edit. Edits flow through audit log.
- Daily cron flags batches pending >7 days.

### Phase 6 — Backfill cron (1 day)

- Daily cron tops up any chapter with <5 SA + <3 LA after verification.
- ops_event per batch with success/cost telemetry.

**Total:** ~19 solo-developer days across ~3-4 calendar weeks.

## Risks + open decisions

1. **Auto-verify NCERT?** Phase 1 marks them `verified` (NCERT is canon). If you want a human gate first, change to `pending`.
2. **Hindi translation cost.** ~5,000 questions × 1k tokens × Haiku ≈ $1.50. Negligible.
3. **Rubric quality.** Claude's LA rubrics can be vague. Phase 3 grader treats rubric as guidance and matches on `expected_answer` key-points.
4. **Answer leakage** in generated questions — Phase 2 validator pre-filters.
5. **Diagram dependence.** `ncert_exercises.diagram_url` exists; Phase 1 INSERT preserves it. UI already supports rendering.
6. **Coverage prioritization.** Don't generate for all grades × subjects at once. Start Grade 9-10 Science + Math (highest engagement, board-exam-adjacent). Expand from there.

## Phase 1 deliverable

Single migration `20260513000000_promote_ncert_exercises_to_question_bank.sql`:

1. `ALTER TABLE question_bank DROP CONSTRAINT chk_four_options`.
2. `ALTER TABLE question_bank ADD CONSTRAINT chk_four_options CHECK (question_type_v2 != 'mcq' OR jsonb_array_length(options) = 4)`.
3. `INSERT INTO question_bank (...) SELECT ... FROM ncert_exercises WHERE subject_code IS NOT NULL AND grade IS NOT NULL AND is_active AND NOT EXISTS (...)`.
4. Audit-log row.

After Phase 1: SA + LA + Mixed pickers return NCERT questions. NCERT picker still empty (Phase 1.5).
