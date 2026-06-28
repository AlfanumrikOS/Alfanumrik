# 07 — Independent Validation: <workflow name>

> Phase: INDEPENDENT VALIDATION. A different agent (quality, not the builder) verifies.
> Copy to `cycles/<cycle>/<workflow>/07-validation.md`.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Validator squad:** **quality** (independent of builder)
- **Date:** <YYYY-MM-DD>
- **Self-review reference:** `./06-self-review.md`

## Independence statement
<Confirm the validator did not author the implementation.>

## Per-gap independent verdict
| Gap ID | Builder claim | Validator finding | Verdict (PASS/FAIL) |
|---|---|---|---|
| <WF>-G01 | fixed | <re-tested how> | |

## Gate re-run (verified, not trusted)
- [ ] type-check PASS
- [ ] lint PASS
- [ ] test PASS (n/total)
- [ ] build PASS (shared kB, largest page kB)

## Invariant audit (P1–P15)
| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|

## Security audit
- [ ] RLS boundary verified on touched tables (P8)
- [ ] RBAC enforced server-side on touched routes (P9)
- [ ] No PII in responses/logs/exports (P13)

## UX / a11y audit
- [ ] No broken/empty states; keyboard nav; labels; contrast; focus.

## Verdict
**APPROVE / REJECT** — <reason>

## Required fixes before COMPLETE (if REJECT)
1. <…>
