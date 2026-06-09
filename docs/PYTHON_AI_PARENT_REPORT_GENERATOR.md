# Python AI - parent-report-generator port

Phase 2 continued - port of `supabase/functions/parent-report-generator/index.ts`
to Python FastAPI on Cloud Run. Bilingual weekly parent report (en/hi).
Default OFF.

## What's ported

- **Auth (auth.py)**: Bearer JWT - guardian lookup via auth_user_id.
  P13 fix preserved (never trust body.parent_id).
- **Models (models.py)**: typed WeeklyStats + WeeklyReport.
- **Stats (stats.py)**: pure computation of 9 aggregate counters from
  the 4 input row sets (quiz, foxy, profile, mastery).
- **Templates (templates.py)**: bilingual (en/hi) builders for period,
  highlights, concerns, suggestion. This is the TS buildFallbackReport
  equivalent and is the Python primary path.
- **Repository (repository.py)**: 1 guardian-link check + 5 reads
  (student name, quiz, foxy, profile, mastery) over the last 7 days.
- **Handler (handler.py)**: 6-step orchestrator with structured logging.

## What's deferred to Phase 2.5

The TS path calls Claude Haiku (lines 250-310) to produce a more
narrative-shaped report and falls back to buildFallbackReport on Claude
failure. The Python port uses the template path always. This means:

- Parents see a structured, deterministic report (same shape, slightly
  more "report-card" cadence than the Claude narrative).
- Behavior is identical to the TS path when Claude is unavailable.
- Phase 2.5 will wire MoL to add the LLM-narrative variant behind a
  separate flag (`ff_python_parent_report_llm_v1`).

## P13 data-privacy

- Logs only counters + student_id UUID. Never the report body, never
  student name in logs (logger.info uses `quizzes_completed` and
  `avg_score` only).
- Quiz responses, foxy chat text, parent-child PII are never fetched.

## REG-102

See `.claude/regression-catalog.md` for the pinned wire-shape +
bilingual-copy contract.
