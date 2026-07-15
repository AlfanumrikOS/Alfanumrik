# Vendored Upstream: Agent Skills for K-12 Teachers — Eval Rubrics

Everything under `eval/teacher-skills/vendor/` is copied **verbatim** from the
upstream repository and is NOT modified. Do not edit these files — adaptations
live in `eval/teacher-skills/rubrics/` (each adapted file carries its own
Apache-2.0 §4(b) modification notice).

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/anthropics/k12-teacher-skills |
| Commit vendored | `7c03c83db8223b050b6569ffbe14cd94e229396e` |
| Upstream commit date | 2026-07-13 |
| Date vendored | 2026-07-15 |
| License | Apache-2.0 (see `LICENSE` in this directory, copied from upstream root) |
| NOTICE | See `NOTICE` in this directory, copied verbatim from upstream root |

## Files vendored

From `<upstream>/evals/`:

- `k12-lesson-planning/rubrics/shared.csv`
- `k12-lesson-planning/rubrics/math.csv`
- `k12-lesson-planning/rubrics/ela.csv`
- `k12-lesson-planning/rubrics/science.csv`
- `k12-lesson-planning/rubrics/social_studies.csv`
- `k12-lesson-differentiation/rubrics/differentiation.csv`
- `k12-lesson-differentiation/rubrics/clarifying_question.csv`

## Deliberately NOT vendored

- `<upstream>/plugin/skills/*/references/*.md` — these subject reference files
  carry CCSS (Common Core State Standards) text under a separate NOTICE and are
  not needed by this harness.
- Skill scripts, SKILL.md files, and example JSON documents — read upstream
  for schema reference only; nothing copied.

## Attribution (Apache-2.0 §4(d))

Per the upstream NOTICE:

> Agent Skills for K-12 Teachers
> Copyright 2026 Anthropic, PBC
> Copyright 2026 Learning Commons
> Portions of this product were co-developed by Anthropic, PBC
> and Learning Commons under a collaboration agreement.
