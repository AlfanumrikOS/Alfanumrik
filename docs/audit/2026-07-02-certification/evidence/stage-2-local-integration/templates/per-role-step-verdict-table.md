# Per-Role / Per-Step Verdict Table — Stage 2/3 Fill-In Template

**Purpose:** operator-filled record of live journey verification for one certification run,
mirroring the exact per-role step lists in
`docs/audit/2026-07-02-certification/reports/04-user-journey-certification-report.md`. Copy this
file into the relevant stage's evidence folder (e.g.
`evidence/stage-2-local-integration/test-run-logs/2026-0X-XX-per-role-step-verdicts.md`) and fill
in every blank before treating a stage as complete.

**Verdict legend** (same taxonomy as report 04 — do not invent new values):
`PASS` (worked exactly as designed) · `PARTIAL` (works but with a named gap) · `FAIL` (a step does
not work as designed) · `BLOCKED` (cannot be exercised — no portal/surface exists) ·
`NOT VERIFIED` (not exercised this run).

**Screenshot filename convention:** `<role>-<step-slug>-<verdict-lowercase>.png`, saved under
`evidence/stage-2-local-integration/screenshots/` (or the equivalent `stage-3-staging/screenshots/`
folder for a Stage 3 run). Example: `student-dashboard-pass.png`. Leave the cell blank
(`— none captured —`) rather than deleting the row if no screenshot was taken for a given step.

---

## Run metadata

| Field | Value |
|---|---|
| Fill-in date | __________ |
| Operator name | __________ |
| Stage | Stage 2 (local integration) / Stage 3 (staging) — circle one |
| Target base URL | __________ |
| Certification run ID (full UUID from `scripts/seed-certification-accounts.ts`) | __________ |
| Commit SHA certified against | __________ |
| Cross-reference: test-run cover sheet filename | __________ |

---

## Role: Student

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Subscriptions | __________ | __________ | __________ |
| Dashboard | __________ | __________ | __________ |
| Assessments | __________ | __________ | __________ |
| AI Tutor | __________ | __________ | __________ |
| Reports / Analytics | __________ | __________ | __________ |
| Notifications | __________ | __________ | __________ |
| Payments | __________ | __________ | __________ |
| Certificates | __________ | __________ | __________ |
| Logout | __________ | __________ | __________ |

## Role: Teacher

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Dashboard / Reports / Analytics | __________ | __________ | __________ |
| AI Tutor | __________ | __________ | __________ |
| Notifications | __________ | __________ | __________ |
| Logout | __________ | __________ | __________ |

## Role: Parent

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Dashboard / Reports | __________ | __________ | __________ |
| Payments | __________ | __________ | __________ |
| Logout | __________ | __________ | __________ |

## Role: School Administrator

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Dashboard / Reports / Analytics | __________ | __________ | __________ |
| Notifications | __________ | __________ | __________ |
| Logout | __________ | __________ | __________ |

## Role: Super Administrator

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Dashboard / Reports / Analytics | __________ | __________ | __________ |
| Notifications | __________ | __________ | __________ |
| Logout | __________ | __________ | __________ |

## Role: Content Author

*No dedicated frontend portal exists for this role (Wave 1 finding, CERT-07). Expect
Dashboard = FAIL/BLOCKED with a silent misroute to the student dashboard, and all subsequent
steps BLOCKED. If this run produces a DIFFERENT result, that is a signal the gap may have closed
(or something else changed) — flag it explicitly in the Evidence column, do not silently
overwrite report 04's verdict.*

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Dashboard | __________ | __________ | __________ |
| All subsequent steps | __________ | __________ | __________ |

## Role: Support Staff

*Same structural note as Content Author above — no dedicated frontend portal exists (CERT-07).*

| Step | Verdict | Evidence | Screenshot filename |
|---|---|---|---|
| Registration / Auth / Authz | __________ | __________ | __________ |
| Dashboard | __________ | __________ | __________ |
| All subsequent steps | __________ | __________ | __________ |

---

## Summary (fill in after all rows above are complete)

| Metric | Count |
|---|---|
| Total steps assessed | __________ |
| PASS | __________ |
| PARTIAL | __________ |
| FAIL | __________ |
| BLOCKED | __________ |
| NOT VERIFIED | __________ |
| New defects found this run (list ticket IDs) | __________ |
| Verdicts that DIFFER from report 04's Stage-1 static trace (list + explain) | __________ |

Operator sign-off: __________  Date: __________
