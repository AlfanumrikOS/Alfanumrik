# quiz-generator-v2 (archived)

**Archived 2026-04-26.**

Was an unshipped parallel rewrite of `quiz-generator`. No UI, mobile, Edge
Function, or CI workflow ever called it — confirmed by repo-wide caller-grep
on the day of archival. The active path is `supabase/functions/quiz-generator/`.

Phase 4 of the moat plan will rebuild proper IRT calibration into the canonical
`quiz-generator/index.ts`. Restore from git history if needed (the file was
moved here via `git mv`, so `git log --follow` retains the full history).
