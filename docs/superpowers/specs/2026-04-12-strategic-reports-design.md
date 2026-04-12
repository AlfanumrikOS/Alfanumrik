# Phase 5: Strategic Reports — Design Spec

**Date:** 2026-04-12
**Status:** Design approved

---

## Context

The Learning Intel page already shows engagement trends, basic retention counts (24h/7d/30d active), subject popularity, and content coverage heatmaps. Two strategic views are missing: cohort-based retention analysis (tracking signup cohorts over time) and Bloom's taxonomy distribution per grade (showing cognitive level progression). Mobile vs web segmentation is not feasible without schema changes (no per-session device tracking) and is deferred.

## Architecture

New "Strategic Reports" tab on the existing `/super-admin/learning` page. No new tables. Two new API routes compute derived metrics from `students`, `quiz_sessions`, and `question_bank`.

### API routes

| Route | Method | Returns |
|---|---|---|
| `/api/super-admin/strategic-reports/cohort-retention` | GET | Weekly/monthly cohort retention grid |
| `/api/super-admin/strategic-reports/bloom-by-grade` | GET | Bloom's level distribution per grade |

### Cohort retention

Params: `interval` (weekly/monthly), `weeks` (default 12)

Computed from `students.created_at` (signup cohort) + `quiz_sessions` activity (presence of any quiz in subsequent intervals). Returns a grid: each row is a signup cohort, each column is an interval offset (W+0, W+1, W+2...), cells contain retention percentage and raw count.

### Bloom's by grade

Params: `grade` (optional filter, default all)

Joins quiz activity with `question_bank.bloom_level`. Groups by `students.grade` and `bloom_level`. Returns counts and percentages per grade per Bloom's level (remember, understand, apply, analyze, evaluate, create).

Note: the join path from quiz sessions to question_bank depends on the actual schema — may go through `quiz_responses` → `question_bank` or through a `question_id` column. The implementer must read the schema to find the correct join.

## Scope

- 1 new tab component on Learning Intel page
- 2 API routes (cohort-retention, bloom-by-grade)
- No new tables
- Tests + regression R52-R53

## Non-goals

- Mobile vs web split (no per-session device tracking — deferred)
- Custom date range picker (use preset intervals)
- CSV export of reports (use existing reports page)
- Caching/materialized views (compute on demand — acceptable at current scale)