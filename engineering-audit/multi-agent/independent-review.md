# Agent H - Independent Reviewer Report

Date: 2026-07-10
Mode: Stage 1 independent review; read-only except this report.

## Scope reviewed

Reviewed the completed Stage 1 reports:

- `architecture-report.md`
- `backend-security-report.md`
- `frontend-report.md`
- `adaptive-intelligence-report.md`
- `foxy-ai-report.md`
- `qa-certification-report.md`
- `platform-readiness-report.md`

Reviewed coordination and evidence files:

- `MASTER_PLAN.md`
- `TASK_LEDGER.md`
- `DEPENDENCY_MAP.md`
- `RELEASE_EVIDENCE.md`
- `artifacts/live-readiness-evidence-2026-07-10.json`

Performed targeted verification against cited files and commands only:

- `npx tsx scripts/verify-live-readiness-evidence.ts --input=artifacts/live-readiness-evidence-2026-07-10.json`
- Count check for `scripts/admin-client-allowlist.json` and `scripts/route-access-manifest.json`
- Targeted `rg` checks for Foxy ownership, student dashboard flag drift, certification blockers, release version source, public `class_code`, and school-admin preflight RPC exposure.

No implementation files were modified.

## Evidence quality assessment

Overall evidence quality is mixed: the reports are strong at static source inspection, manifest inventory, and identifying dependencies, but weak for any claim that depends on live runtime behavior, production deployment state, browser certification, cron execution, RLS behavior under real JWTs, or operator approvals.

High-quality evidence:

- QA and Platform both correctly separate repo-owned checks from operator/live gates.
- The live readiness verifier was rerun by this reviewer and failed with `Summary: 5/15 gates passed`.
- Static source evidence supports the major security concerns: large service-role surface, unverified new SECURITY DEFINER RPC wave, public `class_code`, and global duplicate-email preflight behavior.
- Foxy report provides good layered evidence for `/api/foxy` as the active student-visible safety boundary and identifies that direct Edge streaming is not independently first-paint safe.
- Frontend report fairly labels visual/runtime confidence as only medium because no screenshots or Playwright execution were performed.

Evidence limitations:

- Several reports use terms such as "complete", "production-minded", "active", or "launch-positive" based on source presence and tests, not fresh deployed proof.
- The coordination `TASK_LEDGER.md` still marks A-G reports as `Pending` even though completed reports exist. The ledger is stale and should not be used as current status truth until reconciled.
- Static counts are already drifting during the multi-agent run: Agent A/B report `258` admin-client allowlisted routes, while current files show `scripts/admin-client-allowlist.json` `count: 257` and `257` `serviceRoleUse` routes in `scripts/route-access-manifest.json`.
- QA's browser certification evidence is list-only, not execution evidence.
- Adaptive intelligence and Foxy reports are code-path reviews; neither proves current production flag state, deployed Edge version, DB contents, or live personalization behavior.

## Unsupported claims rejected

Rejected: broad-launch readiness.

- Current live evidence is not passing. The verifier reports certification E2E, Edge secrets smoke, tenant isolation, PII notification, incident ID, XC-3 execution, and wireframe sign-off as `not_run`; job health, historical XP decision, and TSB-4 cutover as `fail`.
- Any launch claim must be downgraded to "repo reconnaissance in progress; operator gates not closed."

Rejected: current browser certification.

- `e2e/certification --list` proves specs are discoverable, not that the product journey passed.
- `artifacts/live-readiness-evidence-2026-07-10.json` explicitly marks `certification-e2e-live` as `not_run`.

Rejected: service-role migration complete.

- Current manifest count is improved but still large: 257 service-role/admin-client routes remain.
- XC-3 migration execution is `not_run` in the live readiness bundle.

Rejected: TSB-4 canonical membership complete.

- TSB-4 live cutover is explicitly `fail` in the evidence bundle.
- Reports correctly identify safer code paths, but retirement/repoint completion still requires live tenant smoke and divergence evidence.

Rejected: cron/job readiness.

- Job-health live proof is explicitly failing: `0/13` registered jobs have live last-success metrics in the captured export.
- Instrumentation presence is not equivalent to scheduler health.

Rejected: DKT is live.

- Agent D found active BKT/IRT/SM-2/adaptive wiring, but no active DKT runtime.
- Product copy or roadmap language should not claim DKT production behavior without a new implementation and runtime proof.

Rejected: frontend polish certified by static route coverage.

- Static component inspection supports design direction, but it does not prove mobile layout, no overlap, accessibility behavior, or absence of sparse screens.
- Cosmetic UI migrations must not be counted as functional readiness unless paired with browser evidence.

Rejected: Foxy safety as complete for all possible callers.

- `/api/foxy` provides the student-visible buffering/screening invariant.
- The Edge streaming pipeline alone is not first-paint safe; any direct streaming caller to `grounded-answer?stream=1` remains a regression risk unless blocked or wrapped.

## Security and regression risks

1. P0 - Live readiness gates are not closed.
   - Evidence: verifier failed 5/15.
   - Regression risk: launching on static pass signals while production jobs, tenant isolation, certification, and operator sign-offs are absent.

2. P0 - Service-role/RLS transition remains incomplete.
   - Evidence: 257 service-role/admin-client route exceptions remain; XC-3 execution gate is `not_run`.
   - Regression risk: app-layer authorization mistakes can still bypass RLS.

3. P0 - TSB-4 membership cutover is not launch-safe yet.
   - Evidence: `tsb4-live-cutover` is `fail`.
   - Regression risk: teacher, parent, and school-admin paths can disagree on membership and tenant boundaries.

4. P1 - New SECURITY DEFINER RPC wave lacks complete central hardening coverage.
   - Evidence: backend report identifies July 10 RPCs beyond the existing three-function DB hardening manifest.
   - Regression risk: PUBLIC grants, missing `search_path`, or callable metadata side channels can land without live verifier coverage.

5. P1 - School-admin preflight can disclose global email existence.
   - Evidence: `school_admin_student_create_preflight` is granted to `authenticated` and performs a global lowercased email check.
   - Regression risk: cross-tenant email enumeration by authenticated users.

6. P1 - Public API exposes `class_code`.
   - Evidence: `apps/host/src/app/api/public/v1/classes/route.ts` selects/returns `class_code`; public spec documents it.
   - Regression risk: leaked scoped API keys can expose join credentials unless product explicitly accepts this.

7. P1 - Release/deploy traceability can produce invalid version metadata.
   - Evidence: workflow reads `require('./package.json').version`; root `package.json` has no version while `apps/host/package.json` is `2.0.0`.
   - Regression risk: `vundefined` tags or ambiguous release bookkeeping.

8. P1 - Vercel health can soft-pass deployment protection.
   - Evidence: Platform report cites all-429 handling when bypass secret is missing.
   - Regression risk: deploy pipeline can appear healthy without proving the application is reachable.

9. P1 - Certification blockers remain product decisions, not QA tasks.
   - Evidence: `CERT-FE-01` teacher `/foxy` and `CERT-07` content/support portal gaps are in the certification manifest and specs.
   - Regression risk: rerunning QA will repeat known red tests unless product scope is clarified.

10. P2 - Stale docs and comments can misdirect implementation.
    - Evidence: `ARCHITECTURE.md` still names `foxy-tutor`; `StudentOSDashboard` comments describe a flag fallback that current page/test code says no longer exists.
    - Regression risk: agents or operators implement against retired paths or nonexistent fallbacks.

## Cross-agent conflicts

- A/B count drift: Architecture and Backend cite 258 service-role routes; current files show 257. Treat all counts as volatile until the orchestrator freezes manifests and reruns inventory.
- Ledger conflict: `TASK_LEDGER.md` says A-G reports are `Pending`; report files are completed. Coordination files need status reconciliation before Stage 2.
- Foxy ownership conflict: `CLAUDE.md` and live files identify `/api/foxy` as active; `ARCHITECTURE.md` still references retired `foxy-tutor`.
- Adaptive ownership conflict: host quiz selection and Edge `quiz-generator` both contain adaptive logic while comments imply deprecated/internal-only ownership. Execution path must be made explicit before changing selection behavior.
- Certification/product conflict: QA tests encode teacher `/foxy` access and content/support missing portals as known reds, not accidental failures. Product, assessment, and architecture must decide scope before QA can certify.
- DevOps evidence conflict: repo gates and dry-runs can look green while live evidence remains red. The execution plan must prevent repo-green from being rebranded as launch-green.
- Frontend readiness conflict: UI reports contain legitimate polish recommendations, but the release-blocking evidence is currently security/runtime/operator proof, not visual refinements.

## Recommended execution plan adjustments

1. Freeze shared manifests before Stage 2 implementation.
   - Single owner for `scripts/admin-client-allowlist.json`, `scripts/route-access-manifest.json`, OpenAPI files, feature/product matrices, Edge manifest, and release gate.
   - Rerun counts after the freeze; do not copy 257/258/364 values across reports without a fresh command.

2. Make the next milestone "evidence closure", not "feature completion".
   - Required first: live readiness bundle moves from 5/15 to passing or explicitly approved accepted-risk where the verifier supports it.
   - Do not let static manifest tests substitute for operator gates.

3. Prioritize security/runtime blockers before cosmetic frontend fixes.
   - XC-3 route batch plus manifest/test synchronization.
   - TSB-4 live tenant smoke and divergence proof.
   - RPC hardening manifest/live verifier expansion.
   - Job-health live investigation.
   - Certification E2E run against the target environment.

4. Split product decisions from engineering tasks.
   - Decide teacher `/foxy` access.
   - Decide content-author/support-staff launch scope.
   - Decide whether public API may expose `class_code`.
   - Decide historical XP clamp/backfill/comms.
   - Decide TSB-4 legacy table retirement criteria.

5. Treat docs/comment fixes as enabling work, not completion proof.
   - Correct stale `foxy-tutor` and student dashboard flag fallback references.
   - These fixes reduce future mistakes but do not close runtime gates.

6. Add direct-abuse and live-negative verification before declaring the RPC migration safer than service-role routes.
   - Route-level tests are not enough; call new RPCs directly as unrelated authenticated users and verify non-disclosure.

7. Require browser and visual evidence for frontend readiness claims.
   - Static component review may prioritize work, but "polished", "mobile-ready", and "certified" require screenshots, Playwright runs, accessibility checks, and seeded data states.

## Required verification before implementation completion

Minimum repo-owned verification:

- `npx tsx scripts/product-readiness-release-gate.ts --list`
- `npx tsx scripts/product-readiness-release-gate.ts --dry-run`
- Full repo gate or direct documented equivalent if the monolithic runner times out.
- `npm run type-check --workspaces --if-present`
- `npm run lint --workspaces --if-present`
- `npm run gen:openapi:check -w apps/host`
- `npm run build -w apps/host`
- `npm run check:bundle-size`
- Manifest tests for route access, admin allowlist, Edge functions, product surface matrix, certification readiness, live readiness evidence, and release gate.

Security-specific verification:

- Admin-client allowlist and route-access manifest regenerated/ratcheted with current route tree.
- XC-3 direct route tests plus direct-RPC negative tests.
- DB function hardening manifest/live verifier covers all new July 10 SECURITY DEFINER RPCs.
- Live/staging grant proof for RPCs: no PUBLIC/anon execute, pinned `search_path`, intended authenticated role only.
- Live tenant-isolation smoke for parent, teacher, school-admin, active/inactive enrollment, and cross-tenant denial.
- Product decision and code/spec update for public `class_code`.
- Fix or constrain `school_admin_student_create_preflight` global email disclosure.

Operator/live verification:

- `npx tsx scripts/verify-live-readiness-evidence.ts --input=<fresh-release-candidate-bundle.json>` passes.
- Certification E2E actually runs against target deployment with seeded accounts.
- Job-health verifier passes with 13/13 live last-success metrics or documented accepted risk.
- Incident-ID live proof passes through real app health with Vercel bypass configured.
- Edge secrets/deploy smoke passes for affected functions.
- Historical XP decision is recorded.
- TSB-4 cutover/repoint/retirement decision has fresh evidence.
- Wireframe/product-surface sign-off is recorded.

Frontend/Foxy/adaptive verification:

- Mobile visual screenshots for student, parent, teacher, school-admin, learn, and Foxy journeys.
- Accessibility checks for heatmap cells, locked nav rows, command header controls, Foxy actions, and role bottom nav.
- Foxy live/staging smoke for signed grounded-answer call, streaming unsafe-output backstop, quota refund, Save to notebook, Report issue, Hindi fallback, and session resume.
- Adaptive state-change trace: answer submission changes mastery/IRT/BKT state and then changes at least one visible next output.
- Cron/projector proof for IRT calibration, adaptive remediation, daily-cron dispatch, and projector-runner.

## Confidence level

High confidence that broad launch is not currently supported by evidence.

High confidence that the main execution blockers are live/operator proof, XC-3 service-role reduction, TSB-4 membership cutover, job health, certification E2E, and RPC hardening.

Medium-high confidence in the static security and architecture findings because they were verified against cited files.

Medium confidence in frontend, Foxy, and adaptive runtime readiness because the Stage 1 evidence is mostly static and test-inspection based, not fresh deployed browser/runtime proof.

Low confidence in any claim that depends on production flags, live DB contents, cron execution, Vercel protection bypass, or external product approvals until the live evidence bundle passes.

## Unresolved questions

- Who owns serialization of shared manifests in Stage 2?
- What exact release candidate ID and target environment should the next evidence bundle use?
- Which live gates, if any, may be accepted-risk, and who is authorized to approve them?
- Is teacher `/foxy` an allowed product surface or a role-gating bug?
- Are `content_author` and `support_staff` launch roles, deprecated roles, or post-launch backlog?
- Is `class_code` intentionally exposed in public v1 classes responses?
- Should `school_admin_student_create_preflight` be callable directly by all authenticated users, or only through a server route?
- Which adaptive quiz path is canonical in production: host library, Edge `quiz-generator`, `/api/v2`, or a transition mix?
- Is DKT a roadmap claim only, or should implementation begin?
- Are the 13 cron routes failing to execute, failing auth, failing DB writes, or writing to a different environment?
- Is root package versioning intentionally absent, or should release workflow read `apps/host/package.json`?
- Has production received the current dirty/untracked migration set, or are reports inspecting code ahead of deployed DB state?
