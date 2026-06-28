# STATUS: <workflow name>

> One per workflow cycle. Copy to `cycles/<cycle>/<workflow>/STATUS.md`.
> The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Primary invariants:** <P-list>
- **Owner squad:** <agent>
- **Started:** <YYYY-MM-DD>
- **Status:** NOT STARTED | IN PROGRESS | BLOCKED | **COMPLETE**

## Phase progress
| Phase | Artifact | Done |
|---|---|---|
| MAP | `01-map.md` | [ ] |
| IDENTIFY GAPS | `02-gap-analysis.md` | [ ] |
| ROOT CAUSE | `03-root-cause.md` | [ ] |
| DESIGN | `04-solution-design.md` | [ ] |
| IMPLEMENT | `05-implementation.md` | [ ] |
| SELF-REVIEW | `06-self-review.md` | [ ] |
| INDEPENDENT VALIDATION | `07-validation.md` | [ ] |
| REGRESSION | `08-regression.md` | [ ] |

## Completion gate
The workflow is COMPLETE only when ALL are true:

- [ ] **Business goal met** end-to-end for all intended users/roles.
- [ ] **No broken/empty states** — no dead links, dead buttons, placeholder/empty screens on any path.
- [ ] **Accessibility** — keyboard nav, labels, contrast, focus states on touched UI.
- [ ] **Security — RLS (P8)** enforced on every touched data path.
- [ ] **Security — RBAC (P9)** enforced server-side (`authorizeRequest`) on every touched route.
- [ ] **Privacy (P13)** — no PII in logs, Sentry, analytics, or exports.
- [ ] **Invariants P1–P15** upheld; no regression introduced.
- [ ] **type-check** green (`npm run type-check`).
- [ ] **lint** green (`npm run lint`).
- [ ] **test** green (`npm test`).
- [ ] **build** green (`npm run build`), within bundle budgets (P10).
- [ ] **Quality verdict = APPROVE** (independent validation, `07-validation.md`).
- [ ] **P14 review chain complete** for every critical file touched.
- [ ] **Regression sweep green** (`08-regression.md`); new catalog entries filed.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder | | | |
| Quality (independent) | | | APPROVE/REJECT |
| Testing | | | GREEN/NOT GREEN |
| Orchestrator (mark COMPLETE) | | | |
