# Agent F - QA and Certification Report

Date: 2026-07-10
Mode: Stage 1 read-heavy reconnaissance
Scope guard: no product code changes; only this report was written.

## 1. Scope inspected

Inspected product-journey and release-certification coverage for student, parent, teacher, school-admin, super-admin, content-author/support-staff certification roles, and operator-owned broad-launch gates. Focus areas were:

- Product readiness gate runner and release evidence separation.
- Certification Playwright specs and gating.
- Static/Vitest manifest gates for product surfaces, certification readiness, and live evidence.
- Live readiness evidence bundle and recent execution ledger claims.
- Missing integration/browser coverage and release evidence gaps.

## 2. Files inspected

Core gates and manifests:

- `scripts/product-readiness-release-gate.ts`
- `scripts/certification-readiness-manifest.json`
- `scripts/live-readiness-evidence-manifest.json`
- `scripts/verify-live-readiness-evidence.ts`
- `scripts/product-surface-matrix.json`
- `engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md`
- `artifacts/live-readiness-evidence-2026-07-10.json`

Regression coverage:

- `apps/host/src/__tests__/product-readiness-release-gate.test.ts`
- `apps/host/src/__tests__/certification-readiness-manifest.test.ts`
- `apps/host/src/__tests__/live-readiness-evidence.test.ts`
- `apps/host/src/__tests__/product-surface-matrix.test.ts`
- `apps/host/package.json`

Browser certification:

- `e2e/certification/helpers/cert-gate.ts`
- `e2e/certification/student.spec.ts`
- `e2e/certification/parent.spec.ts`
- `e2e/certification/teacher.spec.ts`
- `e2e/certification/school-admin.spec.ts`
- `e2e/certification/super-admin.spec.ts`
- `e2e/certification/content-author.spec.ts`
- `e2e/certification/support-staff.spec.ts`
- `e2e/certification/payments.spec.ts`
- `docs/audit/2026-07-02-certification/reports/14-risk-register.md`

Workspace safety:

- `git status --short`
- `AGENTS.md`
- Existing target file `engineering-audit/multi-agent/qa-certification-report.md`

## 3. Confirmed findings

| ID | Severity | Finding | Evidence | Certification impact |
|---|---:|---|---|---|
| QA-01 | High | Operator-owned release evidence is not launch-passing. The live evidence verifier fails the current `artifacts/live-readiness-evidence-2026-07-10.json` bundle with only 5/15 gates passing. | `npx tsx scripts/verify-live-readiness-evidence.ts --input=artifacts/live-readiness-evidence-2026-07-10.json` exited 1; failures include certification E2E not run, tenant smoke not run, job-health fail, incident ID not run, historical XP decision missing, XC-3 not run, TSB-4 fail, product sign-off not run. | Broad launch must remain blocked until the bundle verifies pass or approved accepted-risk where allowed. |
| QA-02 | High | Certification browser suite exists but current run evidence is absent. Specs are intentionally gated and `--list` shows 36 tests in 8 files, but the current evidence bundle marks `certification-e2e-live` as `not_run`. | `CERTIFICATION_RUN_ENABLED=true npx playwright test e2e/certification --list` listed 36 tests; live evidence bundle has empty evidence for `certification-e2e-live`. | Browser certification cannot be claimed current for this release candidate. |
| QA-03 | High | Known live product gaps remain in certification scope: teacher `/foxy` access is intentionally RED (`CERT-FE-01`), and content-author/support-staff have no dedicated portal (`CERT-07`). | `teacher.spec.ts` asserts teacher should not remain on `/foxy`; content/support specs assert misroute to `/dashboard`; manifest blockers include `CERT-FE-01` and `CERT-07`. | Release decision needs explicit product/assessment/architect ruling, not just QA rerun. |
| QA-04 | Medium | Payment certification remains second-gated and does not prove real checkout completion. | `payments.spec.ts` requires `CERTIFICATION_PAYMENTS_CONFIRMED_SAFE=true` and stops short of a real Razorpay charge; student/parent specs keep payment rows as `fixme` placeholders. | Payment journey certification is reachability-only until sandbox credentials and a safe target are confirmed. |
| QA-05 | Medium | Product-surface coverage is broad but mostly contract/static, not browser journey proof. | `product-surface-matrix.json` covers 13 surfaces and focused Vitest passed; entries point to unit/API/component tests, not a full user-path E2E for every CTA and role. | Missing browser-level regression coverage remains for parent linked-child data, teacher remediation actions, school-admin import/billing, super-admin provisioning/PII, and student certificate surface. |
| QA-06 | Medium | Repo-owned gate runner is well structured, but recent ledger contains two different gate counts and one timeout note. | Current `--list`/`--dry-run` show 39 repo gates; ledger line says earlier full runner passed 35/35, while later text says monolithic runner exceeded 15-minute timeout and underlying gates were run directly. | Treat direct command evidence as useful, but do not overstate a fresh monolithic gate pass from this Stage 1 pass. |
| QA-07 | Medium | Job-health live proof is explicitly failing. | Current evidence verifier reports `job-health-live: status is fail`; bundle notes `0/13 jobs passed; every registered job is missing a live last-success metric`. | Operational certification for cron/scheduler health remains incomplete. |
| QA-08 | Low | Report target already existed as a pending placeholder, and the worktree is heavily shared/dirty. | `git status --short` showed many modified/untracked files, including the report path and numerous agent folders. | QA report must avoid attributing unrelated changes to this agent. |

## 4. Evidence

Commands run and results:

| Command | CWD | Result |
|---|---|---|
| `Get-Content C:\Users\Bharangpur Primary\.codex\plugins\cache\openai-curated\superpowers\2f1a8948\skills\using-superpowers\SKILL.md` | repo root | Exit 0; workflow skill loaded. |
| `Select-String ...\MEMORY.md -Pattern 'certification|release gate|product-readiness|E2E|ledger|Alfanumrik' -Context 2,2` | repo root | Exit 0; prior product-readiness memory located. |
| `Get-Content ...rollout_summaries\2026-07-09T09-25-47-Ha9g-full_rca_backend_workflows_product_readiness.md -TotalCount 180` | repo root | Exit 0; prior RCA context read. |
| `git status --short` | repo root | Exit 0; many existing modified/untracked files found. |
| `rg --files -g '*cert*' -g '*manifest*' -g '*ledger*' -g '*e2e*' -g '*spec*' -g '*test*' ...` | repo root | Exit 0; located certification specs, manifests, gate tests, and existing report. |
| `Get-Content scripts/product-readiness-release-gate.ts` | repo root | Exit 0; 39 repo gates and 15 operator gates identified in current code. |
| `Get-Content scripts/certification-readiness-manifest.json` | repo root | Exit 0; 7 mission roles and blockers `CERT-17`, `CERT-FE-01`, `CERT-07` confirmed. |
| `Get-Content scripts/live-readiness-evidence-manifest.json` | repo root | Exit 0; 15 broad-launch operator gates confirmed. |
| `Get-Content apps/host/src/__tests__/{product-readiness-release-gate,certification-readiness-manifest,live-readiness-evidence,product-surface-matrix}.test.ts` | repo root | Exit 0; manifest/gate test assertions inspected. |
| `Get-Content e2e/certification/*.spec.ts` and helper | repo root | Exit 0; role journeys, `fixme`, and gating inspected. |
| `npx tsx scripts/product-readiness-release-gate.ts --list` | repo root | Exit 0; printed 39 repo-owned gates and 15 operator-owned gates. |
| `npx tsx scripts/product-readiness-release-gate.ts --dry-run` | repo root | Exit 0; dry-run summary `39/39 repo gates passed`; no commands executed beyond dry-run listing. |
| `$env:CERTIFICATION_RUN_ENABLED='true'; npx playwright test e2e/certification --list` | repo root | Exit 0; listed 36 tests in 8 files; no browser run. |
| `npx tsx scripts/verify-live-readiness-evidence.ts --print-template --release-candidate=RC-QA-READONLY --target-environment=staging --collected-at=2026-07-10T00:00:00.000Z` | repo root | Exit 0; printed 15-gate evidence template with `not_run` placeholders. |
| `npx vitest run src/__tests__/product-readiness-release-gate.test.ts src/__tests__/certification-readiness-manifest.test.ts src/__tests__/live-readiness-evidence.test.ts src/__tests__/product-surface-matrix.test.ts` | `apps/host` | Exit 0; 4 files passed, 14 tests passed, duration 10.86s. |
| `node -e "const p=require('./apps/host/package.json'); console.log(JSON.stringify(p.scripts,null,2))"` | repo root | Exit 0; host scripts inspected. |
| `Get-ChildItem artifacts | Sort-Object LastWriteTime -Descending | Select-Object -First 30 ...` | repo root | Exit 0; recent evidence artifacts listed. |
| `Get-Content artifacts/live-readiness-evidence-2026-07-10.json` | repo root | Exit 0; current evidence bundle read. |
| `npx tsx scripts/verify-live-readiness-evidence.ts --input=artifacts/live-readiness-evidence-2026-07-10.json` | repo root | Exit 1; summary `5/15 gates passed` with 17 failure lines. |

## 5. Risks

| Risk | Current state | Release consequence |
|---|---|---|
| Browser certification not current | Existing specs are ready/listable, but the current live bundle says not run. | Cannot use browser certification as release evidence. |
| Known role/product gaps | Teacher `/foxy` is an intentional red assertion; content-author/support-staff are portal-less. | Either fix, de-scope, or accept with named approval before broad launch. |
| Operator evidence gaps | 10/15 live gates are not passing in current bundle. | Release gate should remain closed. |
| Static-heavy journey coverage | Product surface matrix is useful, but several role journeys are not full browser flows. | Regressions can slip through CTA/API wiring, empty states, and data-dependent flows. |
| Cron job health | Live target lacks registered last-success metrics. | Scheduler readiness and incident response posture are not proven. |
| Historical XP decision | Quantification found impacted rows, but product decision is absent. | Learner trust/leaderboard correction remains unresolved. |

## 6. Dependencies

- Operator target and credentials: `CERTIFICATION_BASE_URL`, `CERTIFICATION_RUN_ID`, optional `CERTIFICATION_BYPASS_SECRET`, and safe payment confirmation.
- Seeded certification accounts and tenant fixtures from `scripts/seed-certification-accounts.ts`.
- Product/assessment/architect decision for `CERT-FE-01`.
- Product decision for `CERT-07` roles: build portals, deprecate roles, or document accepted product gap.
- Operator cron execution with `CRON_SECRET` and target scheduler path.
- Live tenant A/B JWTs and resource IDs for tenant-isolation smoke.
- Evidence bundle files that exist in repo and are fresh enough for `maxEvidenceAgeHours: 168`.
- Approval refs for accepted-risk gates where allowed: historical XP, TSB-4, wireframe/CTA sign-off.

## 7. Recommended action

1. Do not certify broad launch from the current evidence bundle. The verifier result is 5/15 operator gates passed.
2. Run the release process in two layers:
   - Repo layer: rerun `npx tsx scripts/product-readiness-release-gate.ts --dry-run`, then the full runner or direct commands if the monolithic runner times out.
   - Operator layer: fill and verify a live evidence bundle with `npx tsx scripts/verify-live-readiness-evidence.ts --input=<bundle>`.
3. Prioritize live evidence closure:
   - Certification E2E live run with seeded accounts.
   - Tenant isolation live smoke.
   - Cron job-health live metrics.
   - Incident-ID live proof.
   - XC-3 and TSB-4 execution proof.
   - Historical XP product decision.
   - Product sign-off on 13-surface matrix.
4. Convert the highest-risk static-only journeys into browser or integration tests:
   - Parent linked-child dashboard, export, erasure, and notifications with approved guardian link.
   - Teacher class join/remediation/parent notification end-to-end.
   - School-admin roster CSV import, seat enforcement, and billing subscription paths.
   - Super-admin provisioning and PII export notification/audit flow.
   - Student quiz submit through XP/mastery side effects and certificate surface decision.

## 8. Files proposed for modification

No product code modifications were made or are proposed in this Stage 1 report.

Potential future QA artifacts only:

- Add new E2E specs under `e2e/` or expand `e2e/certification/**` after product decisions.
- Add an operator evidence bundle for the actual release candidate under `artifacts/` or a documented release evidence path.
- Update `scripts/certification-readiness-manifest.json` only after role/payment/product decisions change.

## 9. Tests required

Minimum before broad-launch certification:

- `npx tsx scripts/product-readiness-release-gate.ts`
- `CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification`
- Payment journey smoke only after `CERTIFICATION_PAYMENTS_CONFIRMED_SAFE=true` is justified and recorded.
- `LIVE_TENANT_SMOKE_BASE_URL=<target> ... npx tsx scripts/verify-live-tenant-isolation-smoke.ts`
- `npx tsx scripts/verify-job-health-live.ts --input=<rows.json>`
- `npx tsx scripts/verify-incident-id-live.ts --input=<evidence.json>`
- `npx tsx scripts/verify-live-readiness-evidence.ts --input=<release-candidate-evidence-bundle.json>`

Focused checks run in this Stage 1 pass:

- `npx vitest run src/__tests__/product-readiness-release-gate.test.ts src/__tests__/certification-readiness-manifest.test.ts src/__tests__/live-readiness-evidence.test.ts src/__tests__/product-surface-matrix.test.ts` passed 14/14.
- `npx tsx scripts/product-readiness-release-gate.ts --dry-run` passed as a dry-run list only.
- `npx playwright test e2e/certification --list` listed tests only; it did not run browser flows.
- `npx tsx scripts/verify-live-readiness-evidence.ts --input=artifacts/live-readiness-evidence-2026-07-10.json` failed 5/15.

## 10. Confidence level

Confidence: High for Stage 1 reconnaissance conclusions.

Reasoning: inspected current gate code, manifests, specs, ledger, artifacts, and ran focused non-destructive checks. No long build, full release gate, live DB mutation, live browser journey, or real operator gate was executed in this pass, so final launch certification confidence remains low until operator evidence passes.

## 11. Unresolved questions

- What is the exact release candidate ID and target environment for the next certification bundle?
- Has the target environment payment posture been independently confirmed safe enough to set `CERTIFICATION_PAYMENTS_CONFIRMED_SAFE=true`?
- Should teacher `/foxy` access be blocked, allowed, or role-scoped with a separate teacher experience?
- Are `content_author` and `support_staff` launch roles, or should they be deprecated/de-scoped before certification?
- Where should certificate functionality live for the student certification step, or is it out of scope?
- What evidence path will hold product/CEO approvals for historical XP, TSB-4, and wireframe/CTA sign-off?
- When will target cron jobs produce 13/13 live last-success metrics?
- Should the monolithic release gate be optimized/split so it reliably finishes inside operational timeouts?
