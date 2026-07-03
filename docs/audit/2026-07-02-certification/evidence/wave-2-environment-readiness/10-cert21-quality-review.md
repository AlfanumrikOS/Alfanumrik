# Quality Review - CERT-21 duplicate migration version repair

Verdict: APPROVE (recorded by orchestrator from the quality agent's output; the agent was
blocked from writing this path directly by the bash-guard's protected-path matcher).

## Summary of the quality verdict

- lint:migrations PASS - 352 files scanned, 0 duplicate-version failures; the new version
  20260702151000 is unique. Ordering confirmed: 140000 -> 150000 (p3w1_5 ownership check) ->
  151000 (p3w2_8 flag seed) -> 160000 -> 170000 -> 180000 -> 190000.
- Rename choice CORRECT: version 150000 is already recorded on prod and staging as the
  ownership-check migration (the critical forgery fix, confirmed live), so leaving it at 150000
  keeps recorded history matched and needs no migration-history repair. Renaming the never-
  recorded flag-seed file is exactly what makes it finally apply.
- Both files genuinely idempotent / re-apply-safe: the renamed flag-seed is a to_regclass-guarded
  DO block with four ON CONFLICT DO NOTHING inserts, all target columns confirmed present in the
  baseline (fresh-env apply cannot fail); the unchanged ownership-check is three CREATE OR REPLACE
  FUNCTION with idempotent COMMENT/REVOKE, no bare CREATE/ALTER/DROP.
- No load-bearing references to the old filename anywhere in code, tests, config, or migration
  bookkeeping - only documentation/evidence.
- Repair runbook correct and safe: no migration repair needed in the observed state; staging
  rides the re-sync, prod rides the next production deploy, fresh envs apply in order; the
  conditional repair path is correctly gated to the unobserved case only.
- No BLOCKER or MAJOR findings. One MINOR: the new 151000 file must be git add-ed with the
  staged deletion (addressed at commit). Ready to merge: YES.

Full reasoning is in the quality agent's returned output in the session record.
