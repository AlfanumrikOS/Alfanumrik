# 06 — Self-Review: <workflow name>

> Phase: SELF-REVIEW. The builder reviews their own work before independent validation.
> Copy to `cycles/<cycle>/<workflow>/06-self-review.md`.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Reviewer (author):** <agent>
- **Date:** <YYYY-MM-DD>
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification
| Gap ID | Fixed? | Evidence (test / manual / screenshot) | Notes |
|---|---|---|---|
| <WF>-G01 | yes/no | | |

## Self-review checklist
- [ ] Every gap in `02-gap-analysis.md` is addressed or explicitly deferred.
- [ ] No broken links / dead buttons / empty-placeholder states remain on touched paths.
- [ ] Loading, empty, and error states handled for touched UI.
- [ ] Bilingual (P7) strings added for any new user-facing text.
- [ ] RLS (P8) + `authorizeRequest` (P9) on every touched data path.
- [ ] No PII in logs / Sentry / analytics (P13).
- [ ] Invariants P1–P15 re-checked for regressions.
- [ ] No `any` in new code; no `console.log`; no weakened assertions.
- [ ] Migrations idempotent; RLS in same file.
- [ ] Feature-flag changes audited.

## Known limitations carried forward
<Honest list of what is NOT covered, for the independent reviewer.>

## Ready for independent validation?
<YES / NO — if NO, what remains.>
