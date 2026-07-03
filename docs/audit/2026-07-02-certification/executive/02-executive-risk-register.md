# Executive Risk Register

Executive-framed rollup of docs/audit/2026-07-02-certification/reports/14 (full engineering
detail there). This version answers: what could go wrong, who owns it, and does it block release.

| ID | Risk | Business impact if unaddressed | Blocks release? | Owner | Status |
|---|---|---|---|---|---|
| CERT-17 | Deployed staging website may not be pointed at staging credentials | Certification traffic could touch production-shared config; cannot safely test payment/AI/full-login journeys until resolved | YES - blocks all browser-based certification | Human with hosting-dashboard access | OPEN |
| CERT-01 | Suspended/deleted student accounts can still take quizzes and earn XP via the mobile app's default configuration | Undermines the intent of account suspension; no data-confidentiality exposure to other students | Recommended yes, pending Board judgment | Engineering (architect) | Fix identified, not yet applied - awaiting Board risk-acceptance decision or a scheduled fix window |
| CERT-02 | A second, undocumented deployment pipeline has been live for over a week | Incident responders following the documented architecture would miss it | No, but should close before the next incident drill | Ops/Architect | Open, needs a documented decision (intentional or not) |
| CERT-03 | No deployment has a human approval gate | A bad deploy reaches users with no circuit breaker | No, standard practice gap | Ops | Open |
| CERT-04 | An incident runbook contains a factually wrong claim about authentication | Wastes precious time during a real security incident | No | Ops | Open, low effort to fix |
| CERT-05 | Internal documentation undercounts the regression test catalog by 51 entries | Erodes trust in the constitution's other numeric claims | No | Ops | Open, low effort to fix |
| CERT-06 | Whether AI-fallback traffic exposing unredacted student text to a secondary provider is acceptable has no recorded ruling | Undefined risk exposure on a P12/P13-adjacent question | No (not a defect, a pending decision) | **CEO** | Awaiting your ruling |
| CERT-07 | Two RBAC-seeded roles (content author, support staff) have no frontend surface | Anyone assigned these roles cannot use the product | No, product-scope question | Frontend/Product | Open, needs product intent clarified |
| CERT-09 | OAuth-related database tables may not exist in production, silently disabling a route the regression catalog marks high-risk | Dead capability behind a security pin, low urgency | No | Architect | Open, needs one live-schema check |
| CERT-18/19/20 | Environment safety gaps (monitoring mislabeling, no traceability, no clean teardown) | Would have made certification itself unsafe to run | **RESOLVED** | Engineering | CLOSED, independently re-verified |

## Reading this register

Eighteen findings total across the program (Wave 1's 12 Should-Fix items plus this wave's
CERT-17 through CERT-20); three are fully closed, one (CERT-17) is the sole hard blocker on
resuming, and the remainder are real but do not block the certification process itself from
resuming once CERT-17 clears - they are inputs to the Board's eventual release decision, not
gates on doing the work needed to reach that decision.
