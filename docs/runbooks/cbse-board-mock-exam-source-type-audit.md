# CBSE-Board Mock Exam — `source_type` Isolation & Pre-Rollout Content Audit

**Owner**: backend (query/RPC) + assessment (content coverage judgment).
**Related**: Phase 2.2 of the Master Action Plan — dynamic CBSE-board mock
test assembly, `supabase/migrations/20260722097000_start_mock_test_attempt_rpc.sql`
(`public.start_mock_test_attempt`), seeded papers in
`20260722096200_cbse_board_exam_papers_grade_subject_matrix_seed.sql`.

## Background

`start_mock_test_attempt` assembles a 5-section CBSE-board paper (Sections
A-E, target difficulties 1-5) by pulling from the general `question_bank`
pool, scoped to `subject + grade + difficulty`. The pool also contains
competition-tier content (`source_type IN ('jee_archive', 'neet_archive',
'olympiad', 'pyq')`, added by `20260520000004_jee_neet_schema_unblock.sql`
and seeded by `20260520000006_seed_jee_neet_olympiad_papers.sql`) for the
SAME subject+grade combinations the board RPC serves:

- `math` / grade `'10'` — Olympiad-tagged, difficulty 4-5
- `physics` / `chemistry` / `math` / grade `'12'` — JEE-archive, up to
  difficulty 5
- `biology` / grade `'12'` — NEET-archive

Genuine CBSE-board content for those subject/grade pairs
(`20260520000009_cbse_board_seed.sql`,
`20260520000011_cbse_grades_9_10_11_seed.sql`) is capped at difficulty 1-4
with only 7-8 board-tagged rows per subject. Without a `source_type`
restriction, Section E (target difficulty 5, count 3) had ZERO
board-appropriate candidates for those subject/grade pairs and resolved
exclusively from competition-tier rows on the very first fallback step —
assessment's REJECTED finding against the original Phase 2.2 migration,
fixed in `20260722097000` by adding

```sql
AND source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])
```

to all three fallback-ladder steps (exact difficulty, +/-1, any difficulty).

**Expected, correct consequence of the fix**: Sections D/E for
`physics`/`chemistry`/`math`/`biology` grade `'12'` and `math` grade `'10'`
will now legitimately return `content_insufficient` until real
board-tagged difficulty-4/5 questions are authored for those subject/grade
pairs. This is the honest failure mode, not a bug — do not relax the
difficulty matching or reopen competition-tier `source_type` values to
"fix" it.

## Pre-Rollout Audit Query

Run this against a read replica or via the Supabase SQL editor (service
role) BEFORE enabling `start_mock_test_attempt` for a given subject/grade,
to know in advance which papers will report `content_insufficient` for
Sections D and/or E. It counts board-appropriate rows (per the same
`source_type` allow-list enforced by the RPC) at each of the 5 target
difficulties, plus a dedicated `board_difficulty5_rows` column to flag the
common Section-E failure shape:

```sql
SELECT
  subject,
  grade,
  COUNT(*) FILTER (WHERE difficulty = 1) AS board_difficulty1_rows,
  COUNT(*) FILTER (WHERE difficulty = 2) AS board_difficulty2_rows,
  COUNT(*) FILTER (WHERE difficulty = 3) AS board_difficulty3_rows,
  COUNT(*) FILTER (WHERE difficulty = 4) AS board_difficulty4_rows,
  COUNT(*) FILTER (WHERE difficulty = 5) AS board_difficulty5_rows,
  COUNT(*) AS board_total_rows
FROM public.question_bank
WHERE is_active = true
  AND is_verified = true
  AND source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])
GROUP BY subject, grade
ORDER BY board_difficulty5_rows ASC, board_difficulty4_rows ASC, subject, grade;
```

### How to read the results

- `board_difficulty5_rows = 0` for a subject/grade → Section E (needs 3 at
  difficulty 5, falls back to difficulty 4-6 then any-difficulty, but ALL
  steps are now source_type-scoped) will only succeed if step 2 or step 3
  can top it up from the SAME board-appropriate pool at a different
  difficulty. If `board_total_rows` for that subject/grade is also small
  (roughly less than the sum of all 5 section counts = 39), expect
  `content_insufficient` on Section E and possibly D.
- Cross-reference low-row subject/grade pairs against
  `20260722096200_cbse_board_exam_papers_grade_subject_matrix_seed.sql` to
  see which of the 51 seeded `exam_papers` rows are affected before
  flipping any rollout flag.
- Known-affected combinations as of the 2026-07-21 audit (verify against
  current data with the query above, since content authoring may have
  landed since): `physics`/`chemistry`/`math` grade `'12'`, `biology` grade
  `'12'`, `math` grade `'10'` — see Background above.

## Follow-up

Authoring real CBSE-board difficulty-4/5 content for the affected
subject/grade pairs is a content-team task (assessment-owned), not a
schema/RPC concern. Until that lands, the affected papers correctly show
"not ready" (`content_insufficient: true`) to students rather than
silently serving JEE/NEET/Olympiad questions under a CBSE-board label.
