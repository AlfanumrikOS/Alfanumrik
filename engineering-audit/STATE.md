# Audit Loop — Live State

> This file is the program counter for the continuous engineering-audit loop.
> **To resume:** read "Next action" below and continue from there.

| Field | Value |
|---|---|
| Program status | **ACTIVE** |
| Current cycle | **Cycle 7 — parent-portal DONE (PP-2 link-code filter-injection guard at all 3 sites + Deno twin; PP-1 per-IP brute-force rate limit half; PP-4 profile authz gate; PP-5 unlinked-parent deny pins across all 9 child-data routes; PP-1-consent + PP-3 link-model USER-GATED)** |
| Current workflow | **parent-portal** (dual auth + DPDP; invariants **P8, P13, P15**) — **CYCLE 7 LANDED — auto-fix-safe complete** |
| Current phase | **ALL 8 PHASES WRITTEN** (MAP → … → REGRESSION); independent quality verdict **APPROVE**, P14 chain complete, sweep **GREEN** |
| Last session | **2026-06-29** |
| Next action | **Start Cross-cutting (the final cycle)** — `PRIORITY-BACKLOG.md` rank 8 (invariants **P7, P8, P10, mobile sync**): run MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT for that workflow under `workflows/cross-cutting/`. Scope = bilingual (P7) parity breadth (incl. PP-7), RLS (P8) breadth across all tables (incl. the PP-5 client migration to RLS-scoped reads), bundle budget (P10), mobile-web API contract sync. **Also resume the gated items: PP-1-consent + PP-3 (parent-link consent/link model — USER); SAO-1/SAO-5 (super-admin PII-export tiering — USER); TSB-4 (B2B `class_students`/`class_enrollments` table-drop — USER); FOX-4 (Foxy OpenAI provider governance — USER); SLC-1 (uncapped XP trigger — USER); SLC-4/5 + SLC-8 cutover; + the payments + auth-onboarding open follow-ups** (see below) when their gates unblock. |
| Next workflow | **Cross-cutting (P7 bilingual breadth, P8 RLS breadth, P10 bundle, mobile sync)** (rank 8 — the final cycle) |

## How to resume

> Open this file, read **Next action**. Parent Portal Cycle 7 has landed (auto-fix-safe complete —
> PP-2 added a shared `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) + byte-identical Deno twin applied BEFORE the
> link-code `.or()` filter at all 3 sites; PP-1 added a per-IP brute-force rate limit (5/hour, 429) to the
> legacy Edge `parent_login`; PP-4 gated `PATCH /api/parent/profile` on the already-granted
> `profile.update_own`; PP-5 pinned the unlinked-parent deny (403, no payload) across all 9 child-data
> routes; REG-188/189/190, catalog 157). The PP-1 consent posture (link-code-alone → active, no approval)
> and PP-3 (link-model consolidation) are USER-gated. The next (final) workflow is **Cross-cutting (P7
> bilingual breadth, P8 RLS breadth, P10 bundle, mobile sync) (rank 8)**; begin its MAP phase and write
> artifacts under `workflows/cross-cutting/`. Keep the PP-1-consent/PP-3 gate + the SAO-1/SAO-5 gate + the
> TSB-4 gate + the Foxy FOX-4 gate + the SLC-1 gate + the payments + auth-onboarding follow-ups visible.

## Program-level RISK register (CEO visibility)

> Surfaced here for founder visibility; each item also lives in its cycle ledger.

0. **[Cycle 7] PP-1-consent + PP-3 — USER-gated parent-link consent model (DPDP/child-consent).** The legacy
   Edge `parent_login` action creates an ACTIVE, fully-equivalent guardian link from possession of a link
   code ALONE — no student-approval step, no OTP. `canAccessStudent` / `is_guardian_of()` treat that
   `active` link identically to a student-approved `approved` link, so every downstream child-data boundary
   opens (progress, accuracy, streaks, chats, attendance, reports). Anyone who learns a child's link code (a
   tuition centre, a non-custodial adult, a leaked screenshot) and holds an authenticated account can
   self-attach as a guardian. The Cycle-7 fix added a server-side per-IP brute-force rate limit (5/hour,
   429) to close enumeration — but the CONSENT gap remains by design. The remediation (have `parent_login`
   create `pending` links requiring approval/OTP, OR deprecate it now that `/api/v2/parent/*` is canonical)
   changes the consent/link MODEL → requires **USER APPROVAL**. PP-3 (four parallel link-creation paths +
   two terminal statuses `active`/`approved` → consolidate onto one consent-respecting choke-point) folds
   into the same decision; retiring `parent_login` collapses both. The complementary auto-fix-safe half
   (PP-2 link-code injection guard at all 3 sites + Deno twin; PP-1 rate-limit; PP-4 profile authz gate;
   PP-5 deny pins) landed Cycle 7 (REG-188/189/190). **CEO action:** approve the consent-model correction
   (require approval / deprecate `parent_login`); confirm no unauthorized `parent_login` link-creation in
   audit logs.
1. **[Cycle 6] SAO-1 — USER-gated PII-export tiering (DPDP-relevant access-model decision).** The
   super-admin bulk-export route `/api/super-admin/reports` lets ANY account at the LOWEST `support` admin
   tier download the entire student roster with emails, every parent name+email+**PHONE**, and teacher
   emails (up to 5000 rows, CSV/JSON). The admin-level ladder gates by ACTION-destructiveness, NOT
   READ-data-sensitivity — so the platform's most PII-heavy export sits at its floor. The export IS gated +
   audited; the defect is the POLICY mapping of export-type → required level. This is a DPDP-Act
   minors'-data exposure and a mass-exfiltration vector if one low-tier credential is phished. Raising the
   tier (or splitting a dedicated PII-export permission) changes the admin ACCESS MODEL → requires **USER
   APPROVAL**. SAO-5 (audit-log CSV carries admin_name/admin_email in `details` at `support`) folds into the
   same decision. The complementary ops-owned half (egress redaction SAO-3 + analytics email-drop SAO-2 +
   full-surface gate sweep SAO-7 + bare-name log canary SAO-4) landed Cycle 6. **CEO action:** approve the
   tiering correction / PII-export permission split; confirm no low-tier bulk-export abuse in audit logs.
2. **[Cycle 5] CRITICAL cross-tenant student-PII leak — FOUND & FIXED (TSB-1).** Pre-fix, a teacher with
   `grades_taught` but no class could read (and at one site **write**) names / mastery / XP of **every**
   grade-6–12 student across **ALL schools** via the `teacher-dashboard` Edge Function's tenant-unscoped
   grade fallback on the service-role client (RLS bypassed). For a B2B EdTech selling tenant isolation, this
   is a contract-ending, **DPDP-reportable** exposure. Now `school_id`-scoped + fail-closed at all 8 sites
   (REG-184). Trigger condition was realistic (newly-onboarded teacher; `teacher_create_profile` defaults
   `grades_taught = ARRAY['Grade 9']`). **CEO action:** confirm no exploitation in production logs.
3. **[Cycle 5] TSB-4 — USER-gated table-drop decision.** Teacher↔student membership is modeled in TWO tables
   (`class_students` vs `class_enrollments`) reconciled by a sync trigger — an incomplete migration. Picking a
   canonical table and dropping the other is a schema DROP requiring **USER approval**. Read-consolidation is
   auto-fix-safe; the DROP is the gated decision. **CEO action:** approve/sequence the cutover.
4. **[Cycle 4] FOX-4 — USER-gated AI provider governance.** OpenAI gpt-4o-mini/gpt-4o present in
   `grounded-answer` as a MoL SHADOW comparison (telemetry only; not student-facing today). Provider PRESENCE
   is user-gated per the constitution. **CEO action:** govern or remove.
5. **[Cycle 3] SLC-1 — USER-gated XP economy (P2).** A legacy `quiz_sessions` trigger re-awards XP with no
   daily cap, deduped from the RPC only by a fragile 5-second window — a second uncapped XP writer. Needs
   architect + assessment joint design. **CEO action:** approve consolidation to one capped writer.
6. **[Cycle 2] PAY-2 — USER-gated pricing source.** `create-order` hardcoded `PRICING` can diverge from DB
   `subscription_plans`; dead on web, live only on the (already-broken) mobile path. Any pricing-amount change
   is user-gated.

## Current workflow detail — parent-portal (P8, P13, P15) — CYCLE 7 LANDED (auto-fix-safe complete)

- Scope: the parent journeys — signup/link (4 paths: A1 approve-link consent / A2 link-code+OTP 2FA / A3
  emailed invite / A4 legacy Edge `parent_login`) → dashboard (linked children only) → child drill-down
  (progress/reports/chat/export/erasure scoped to the linked child) → comms (report/WhatsApp/messages/
  encourage). Governed by **P8** (RLS boundary), **P13** (data privacy), **P15** (onboarding integrity);
  P9 cross-check. Boundary helpers: `canAccessStudent` (rbac.ts) + `isGuardianLinkedToStudent`
  (relationship.ts), both enforcing `status IN ('active','approved')`.
- Artifacts: `workflows/parent-portal/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- **Headline:** the portal was built in two eras — a demo/link-code era (Edge `parent-portal`, `active`
  links, English literals, app-only service-role reads) and a consent/RBAC era (`approve-link`, OTP,
  `authorizeRequest`, `is_guardian_of()` RLS). The newer era was added ALONGSIDE the older one, leaving a
  weaker legacy path live (PP-1), duplicated unsafe idioms (PP-2/PP-6), deferred obligations (PP-5/PP-7).
  No parameter-tampering IDOR on the canonical routes. The single highest-leverage fix — retire/replace the
  legacy `parent_login` link-create path + converge link creation on one consent-respecting choke-point
  (collapses PP-1 + PP-3) — changes the consent/link MODEL and is **USER-GATED**.
- Landed (APPROVED, auto-fix-safe security hardening; **no consent/link-model or RBAC change**):
  - **PP-2** (MED, P8/P13) — new shared `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) in `src/lib/sanitize.ts` +
    byte-identical Deno twin `supabase/functions/_shared/link-code.ts`, applied BEFORE the link-code `.or()`
    filter at all 3 sites (request-otp → enumeration-safe `silentSuccess`; accept-invite → 409; Edge
    `parent_login` → 200 no-match). Raw payload can't reach the students query; link-code FORMAT unchanged.
    → **REG-188**.
  - **PP-1** (HIGH — auto-fix-safe HALF) — added a per-IP server-side rate limit (5/hour, `createRateLimiter`)
    to the legacy Edge `parent_login` path BEFORE the DB lookup → 429 + Retry-After; mirrors the hardened OTP
    path. The consent-posture change (link-code-alone → active with NO approval) is deliberately NOT touched
    — USER-GATED (`TODO(PP-1, USER-GATED)` left in code). → **REG-189**.
  - **PP-4** (LOW, P9) — `PATCH /api/parent/profile` now gates on `authorizeRequest('profile.update_own')` (a
    permission ALREADY granted to the parent role — no new RBAC) + self-scoped to `auth.uid()` (no IDOR).
    → **REG-190** (combined with PP-5).
  - **PP-5** (MED, P8/P13 pin) — regression tests pin the unlinked-parent deny (403, no child payload) across
    all 9 child-data routes + the canonical guardian-link boundary. → **REG-190**.
- Gates: type-check **PASS**, lint **0 errors**, **5 new files / 71 new tests; 104/104 target + 404/404 broad
  parent/guardian PASS**, build **PASS**, **no bundle impact**. Quality verdict **APPROVE**; regression sweep
  **GREEN**; catalog 154 → **157** (REG-188/189/190); REG-110/111/117 still green.
- P14 review chain **COMPLETE**: backend (impl PP-2 + PP-1 rate-limit half + PP-4) + testing (PP-5 deny pins
  + the 5-file/71-test suite, coverage GREEN) → quality (independent **APPROVE**); architect noted for the
  gated/RLS follow-ups (PP-5 client migration + PP-1 durable limiter).
- **Open gated / follow-up items (resume these):**
  1. **PP-1 consent posture (HIGH, GATED — USER APPROVAL; DPDP/child-consent):** `parent_login` creates an
     ACTIVE guardian link from a link code ALONE — no approval. The design fix (require approval, or
     deprecate `parent_login` in favor of OTP/approve-link) changes the consent model → CEO decision. **On
     the program RISK register (item 0).**
  2. **PP-3 (MED, GATED — USER APPROVAL):** four parallel link-creation paths + two terminal statuses
     (`active` vs `approved`) — consolidate onto one consent-respecting choke-point. Retiring `parent_login`
     collapses PP-1 + PP-3.
  3. **PP-5 client migration (architect):** migrate parent child-data routes to RLS-scoped clients
     (defense-in-depth) — only the Foxy-chat route is RLS-backed today (`is_guardian_of`).
  4. **PP-6 (LOW, behavior-preserving):** converge `canAccessStudent` vs `isGuardianLinkedToStudent`.
  5. **PP-7 (MED, P7):** server-generated parent insights/tips/glance are English-only — candidate for the
     Cycle 8 cross-cutting bilingual work (server keying + frontend render review).
  6. **PP-1 durable limiter (architect):** the in-memory limiter resets on cold start / isn't cross-instance
     — track an Upstash/DB-backed counter.
  7. **Pre-existing Deno errors** at `parent-portal/index.ts:603/605/629/630` — unrelated; separate cleanup.
- See `workflows/parent-portal/STATUS.md` + `cycles/2026-06-29-parent-portal.md`.

## Current workflow detail — super-admin-observability (P9, P13) — CYCLE 6 LANDED (auto-fix-safe complete)

- Scope: the admin request lifecycle (auth/secret gate → permission check → handler → DB → response) across
  the full super-admin surface (119 `api/super-admin/**` + 2 `api/v1/admin/**` + 13 `api/internal/admin/**`
  routes) + the observability pipeline (logger → `redactPII` → sink; analytics event → redact → backends;
  Sentry `beforeSend` → tunnel; feature-flag evaluation default-OFF). Governed by **P9** (RBAC enforcement)
  and **P13** (data privacy); P10 cross-checked.
- Artifacts: `workflows/super-admin-observability/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- **Headline:** the mechanism layers are sound (gate-before-I/O on every sampled route, constant-time secret
  compare, logger/analytics/Sentry `redactPII`, flag default-OFF + fail-safe). The dominant gap is a single
  POLICY gap — **the admin-level ladder differentiates by ACTION destructiveness, not READ data-sensitivity**
  — so the most PII-heavy export sits at the floor `support` tier (SAO-1, USER-gated).
- Landed (APPROVED, auto-fix-safe P13/P9 hardening; **no RBAC role/permission/tier change**):
  - **SAO-3** (MED, P13) — `src/app/api/super-admin/observability/export/route.ts`: the `context_json` CSV
    cell is now wrapped in the canonical `redactPII` (from `@/lib/ops-events-redactor`) before egress —
    defense-in-depth, header/columns/order unchanged, clean rows = identity transform.
  - **SAO-2** (MED, P13) — `src/app/api/super-admin/analytics/route.ts`: dropped gratuitous `email` from the
    `top_students` projection (select + row type + map) — confirmed zero UI consume sites; data minimization
    at the `support` tier. Frontend removed the two stale `email: string` decls (`learning/page.tsx`,
    `_components/widgets/control-room-types.ts`).
  - **SAO-7** (MED, P9) — `admin-route-auth-gate-sweep.test.ts`: mechanical 100%-surface sweep — all **134**
    admin routes carry a canonical gate token; **207/207** DB-touching handlers gate BEFORE first DB I/O;
    `super-admin/login` is the sole allowlisted self-auth exception. Closes the "only 10/119 sampled" gap.
    → **REG-186**.
  - **SAO-4** (LOW-MED, P13) — `bare-name-log-canary.test.ts`: no `logger.*` call passes a bare
    `name`/`email`/`phone` key (conservative anchor excludes `full_name`/`flag_name`/etc.). → **REG-187**.
- Gates: type-check **PASS**, lint **0 errors**, **6/6 new** (4 SAO-7 + 2 SAO-4) + **351/351** broad
  super-admin/analytics/observability tests **PASS**, build **PASS**, bundle within **P10**. Quality verdict
  **APPROVE**; regression sweep **GREEN**; catalog 152 → **154** (REG-186/187); REG-49/115/116/119 still green.
- P14 review chain (super-admin reporting / monitoring) **COMPLETE**: ops (impl SAO-3/SAO-2 + PII
  definitions) + frontend (trimmed-shape render + stale-type cleanup) → testing (SAO-7 sweep + SAO-4 canary,
  coverage GREEN) + quality (independent **APPROVE**).
- **Open gated / follow-up items (resume these):**
  1. **SAO-1 (HIGH, GATED — USER APPROVAL; DPDP-relevant):** `/api/super-admin/reports` bulk-exports raw
     student name+email + parent name+email+PHONE + teacher email at the LOWEST `support` tier. Raising the
     tier / splitting a PII-export permission is an admin access-model change → CEO decision. **Most
     consequential Cycle-6 finding; on the program RISK register (item 1).**
  2. **SAO-5 (LOW, GATED — folds into SAO-1):** audit-log CSV export carries `admin_name`/`admin_email` in
     `details` at `support` — same tiering decision.
  3. **Export `message`-column free-form redaction (MINOR, ops):** controlled developer-authored template
     scalar today; apply `redactPIIInText` only if a future template interpolates user PII (write-time).
  4. **Periodic manual re-read of highest-risk routes (PROCESS):** SAO-7 guards breadth mechanically; manual
     re-read of the highest-PII-sensitivity routes remains good practice.
  5. **SAO-6 (COMPLIANT-BY-DESIGN):** `ip_address` in admin-only RLS-restricted forensic tables — confirm
     forensic-table RLS remains admin/service-role-only (architect).
- See `workflows/super-admin-observability/STATUS.md` + `cycles/2026-06-29-super-admin-observability.md`.

## Current workflow detail — teacher-school-b2b (P8, P9, P13) — CYCLE 5 LANDED (auto-fix-safe complete)

- Scope: the teacher portal (`src/app/teacher/**`) + school-admin tenant surface (`/api/school-admin/*`) +
  the `teacher-dashboard` Supabase Edge Function (the primary teacher analytics surface) + the Pulse
  cross-role boundary (`/api/pulse/*` → `canAccessStudent`). Governed by **P8** (RLS boundary), **P9** (RBAC
  enforcement), **P13** (data privacy / multi-tenant isolation).
- Artifacts: `workflows/teacher-school-b2b/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- **Headline:** the constitution's "`canAccessStudent` is the single cross-role boundary" is true only for
  `/api/pulse/*`; the higher-traffic `teacher-dashboard` Edge Function used a parallel, looser, **tenant-
  unscoped** grade fallback on the service-role client (RLS bypassed) — TSB-1, a CRITICAL cross-tenant leak.
- Landed (APPROVED, auto-fix-safe security hardening; **no RBAC role/permission change**):
  - **TSB-1** (CRITICAL, P8/P13) — `supabase/functions/teacher-dashboard/index.ts`: all **8** grade-fallback
    query sites (the audit named 2; backend found 8, incl. a cross-tenant WRITE in `handleSetGradeBookCell`)
    now scoped by the teacher's AUTH-DERIVED `school_id` via new helper `resolveTeacherSchoolId`; FAIL-CLOSED
    (empty / 403 / zero) on a null `school_id` (no null-match leak); `teacher_id` is JWT-bound (dispatcher
    overwrites `body.teacher_id`), so no IDOR. → **REG-184**.
  - **TSB-2** (HIGH → reclassified defense-in-depth, P8) — new additive idempotent migration
    `supabase/migrations/20260702010000_teacher_assigned_students_rls.sql`: a named, discoverable teacher
    SELECT policy on `public.students`. **Audit-premise correction:** `students` ALREADY had a teacher
    backstop via `students_select_merged` → `is_teacher_of(id)` (baseline; stricter — adds `is_active`
    guards). The new policy is predicate-IDENTICAL (PERMISSIVE OR-combine → unchanged row set, provably no
    over-grant); its value is discoverability + helper-independence, not closing a hole. → **REG-185**.
  - **TSB-6** (LOW) — replaced the stale per-resource-ownership TODO with an accurate SECURITY NOTE.
  - **TSB-3** (MED) — partial convergence + precise TODO referencing `canAccessStudent`; Path B is now
    tenant-scoped + fail-closed (full convergence needs a shared Next.js/Deno authz module — deferred).
- Gates: type-check **PASS**, lint **0 errors**, **527/527 vitest** (incl. 15 TSB-1 + 10 TSB-2 new), build
  **PASS**, **no bundle impact** (Edge Function + migration only). Quality verdict **APPROVE WITH CONDITIONS**
  → condition **RESOLVED**; sweep **GREEN**; catalog 150 → **152** (REG-184/185); REG-120/121/122/124/128
  still green.
- **Quality condition (RESOLVED):** the migration was first timestamped `20260629000000` (out-of-order, before
  the true latest `20260702000800`). Architect **RENAMED** it to `20260702010000` (sorts last; content
  byte-identical); testing updated the test reference; re-verified.
- P14 review chain (RBAC/RLS boundary) **COMPLETE**: architect (RLS/boundary + TSB-2 migration) + backend
  (TSB-1 Edge Function fix) → testing (coverage GREEN) + quality (independent APPROVE WITH CONDITIONS,
  condition resolved).
- **Open gated / follow-up items (resume these):**
  1. **TSB-4 (Medium, GATED — USER APPROVAL for the DROP):** dual `class_students` vs `class_enrollments`
     join tables (incomplete migration; sync trigger papers over it). Read-consolidation is auto-fix-safe;
     any table DROP requires USER approval. **Surface to CEO.**
  2. **TSB-3 full convergence (ai/architect):** shared cross-runtime authz module so `teacher-dashboard`
     reuses `canAccessStudent` (removing Path B is a product-behavior change).
  3. **TSB-5 (ops/frontend, LOW):** `ff_school_pulse_v1` is a render guard not a data-access guard — a
     one-line clarifying comment on the (separate) pulse routes.
  4. **Pre-existing TS2352** at `teacher-dashboard/index.ts:2704` (untouched join-cast; surfaces under
     `deno check`, not `tsc`) — separate cleanup PR (architect).
  5. **Vacuously-green walker** in the OLD `teacher-dashboard-roster-join.test.ts` — harden separately (testing).
  6. **CI-resilience:** the Deno dependency pre-warm step has no retry (a transient esm.sh 522 red the
     Cycle-4 pipeline) — candidate retry-with-backoff on `deno cache` (ops/architect).
- See `workflows/teacher-school-b2b/STATUS.md` + `cycles/2026-06-29-teacher-school-b2b.md`.

## Current workflow detail — foxy-ai-rag (P12, P8, P13) — CYCLE 4 LANDED (auto-fix-safe complete)

- Scope: the end-to-end Foxy chat turn (`/api/foxy` → `callGroundedAnswer` → `grounded-answer` Deno RAG
  pipeline) + sibling AI Edge Functions (ncert-solver, quiz-generator, cme-engine). Governed by **P12** (AI
  safety), **P8** (RLS on RAG/vector reads), **P13** (no PII to LLM/traces).
- **Live-topology reconciliation (RECORDED):** the constitution's "`/api/foxy` … not yet wired to UI" note
  is **STALE** — `/api/foxy/route.ts` is the LIVE production route; the legacy `foxy-tutor` Edge Function no
  longer exists on disk; `grounded-answer` is the LLM pipeline. Correct on the next constitution
  reconciliation. See `workflows/foxy-ai-rag/01-map.md` §0.
- Artifacts: `workflows/foxy-ai-rag/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED, auto-fix-safe; **no model/provider/prompt-scope change**): **FOX-1** (HIGH, P12 — added
  `screenStudentFacingText` (`src/lib/ai/validation/output-screen.ts`) + byte-identical Deno twin
  (`supabase/functions/grounded-answer/output-screen.ts`); deterministic word-boundary `HARD_BLOCK_PATTERNS`
  that EXCLUDE curriculum collisions; legacy `validateOutput` runs WARN-only; fail-safe; wired into EVERY
  student-facing exit — non-streaming `route.ts`, streaming `_lib/streaming.ts`, Deno `pipeline-stream.ts` →
  REG-182), **FOX-1 refinement** (CS-curriculum exemption — bare `<system>`/`[inst]` PASS, real chat
  templates BLOCK), **FOX-2** (MED — `neutralizeInjectionAttempt` (`src/lib/ai/validation/input-guard.ts`),
  fail-open → REG-183), **FOX-3** (LOW, assessment-approved — widened `VALID_MODES` doubt/homework/explorer;
  safety rails template-independent), **FOX-6** (P13 — prompt-assembly contract test, only scope+UUID).
- Gates: type-check **PASS**, lint **0 errors**, test **305/305 vitest + 3/3 Deno PASS**, build **PASS**,
  bundle within **P10** caps. Quality verdict **APPROVE**; regression sweep **GREEN**; catalog 148 → **150**
  (REG-182/183); existing P12 REG-37/39/50/54/66/67 still green.
- P14 review chain (AI tutor behavior) **COMPLETE**: ai-engineer (impl) → assessment (CBSE-scope /
  age-appropriateness correctness: **APPROVE WITH CONDITIONS**, conditions addressed) + testing (coverage
  GREEN) + quality (independent **APPROVE**).
- **Open gated / follow-up items (resume these):**
  1. **FOX-4 (Medium, GATED — USER APPROVAL):** OpenAI gpt-4o-mini/gpt-4o is present in `grounded-answer` as
     a **MoL SHADOW comparison** (telemetry only; does NOT reach students today — the student-facing answer
     is always the screened Claude output). Provider PRESENCE is user-gated per the constitution. CEO to
     formally approve & govern the shadow usage, or remove it.
  2. **FOX-7 (NEW, MINOR follow-up — ai-engineer):** extend `screenStudentFacingText` to the legacy fallback
     persist path (`_lib/legacy-flow.ts` / `persistLegacyFoxyResponse`). Reachable on `ff_grounded_ai_foxy`-OFF
     / grounded-abstain fallback; currently retains the OLDER substring `validateOutput` guard — consistency
     upgrade, **not an unfiltered hole**.
  3. **Streaming live-view residual (MINOR):** upstream deltas reach the browser before the completion screen;
     persisted record + final frame + every non-streamed consumer always safe; gated by `ff_foxy_streaming`.
     Frontend full-closure (`onAbstain` also clears `structured`) flagged — touches the REG-50-pinned transform.
  4. **Bilingual Hindi profanity-token coverage (MINOR, tracked):** `HARD_BLOCK_PATTERNS` English-oriented;
     bounded (acts on model OUTPUT, not student input).
- See `workflows/foxy-ai-rag/STATUS.md` + `cycles/2026-06-29-foxy-ai-rag.md`.

## Current workflow detail — student-learning-core (P1-P6, P12) — CYCLE 3 LANDED (auto-fix-safe complete)

- Scope: quiz setup → assembly + server-shuffle authority → answering/timing → client+server anti-cheat →
  submit dispatch → server scoring + atomic XP/profile write → results display → progress propagation.
  Governed by invariants **P1** (score), **P2** (XP), **P3** (anti-cheat), **P4** (atomic), **P5** (grade
  string), **P6** (question quality); P12 (AI safety) adjacent.
- Artifacts: `workflows/student-learning-core/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED, auto-fix-safe): **SLC-7** (frontend — wired the dead P6 `isValidQuestion` validator
  into `startQuiz`; `mcqIds` + `displayQuestions` + submitted set all derive from ONE filtered set so
  P1/P4 served-count consistency is preserved; zero-valid → bilingual error; PII-free drop warn),
  **SLC-2** (testing — `xp-sql-literal-parity.test.ts`, P2 earning literals 10/20/50 SQL↔TS across every
  root migration; closes the REG-48 cap-only gap → **REG-181**), **SLC-3** (testing —
  `score-formula-three-way-parity.test.ts`, P1 formula identical across scoring.ts + SQL v1/v2 +
  consume-not-recompute → **REG-180**), **SLC-6** (testing — `quiz-pattern-flag-intended-behavior.test.ts`,
  pins the intended P3 pattern=FLAG / speed+count=REJECT asymmetry; brace-robustness fix), **SLC-8 pin**
  (testing — `quiz-submit-idempotency-contract-pin.test.ts`, current keyless-submit + `reference_id`
  no-double-XP, honest FIXME for the pre-cutover duplicate-row gap).
- Gates: type-check **PASS**, lint **0 errors**, test **40/40 new + ~1678 broad quiz/xp/scoring PASS**,
  build **PASS**, bundle within **P10** caps. Quality verdict **APPROVE** (one MINOR brace nit fixed);
  regression sweep **GREEN**; REG-45/48/51/53 still green; catalog 146 → **148** (REG-180/181).
- P14 review chain (Student Learning Core) **COMPLETE**: assessment (audit) → frontend (impl) + testing
  (coverage GREEN) + quality (independent APPROVE).
- **Open gated / cross-agent items (resume these):**
  1. **SLC-1 (High, GATED — USER APPROVAL)** — legacy `quiz_sessions` AFTER-completion trigger re-awards
     XP (10/20/50) with **no daily cap**, deduped from the RPC only by a fragile 5-second wall-clock window
     — a second uncapped XP writer. DB trigger + P2 economy change. Needs **architect + assessment** joint
     design to consolidate to one capped writer. Do NOT change the cap (200) or the earning literals.
  2. **SLC-4 (Medium, GATED)** — two daily-cap implementations (7-arg IST ledger vs JSONB 6-arg
     `CURRENT_DATE` fallback) + a `score`-vs-`xp_earned` column mismatch. **architect / backend** alignment.
  3. **SLC-5 (Medium, cross-agent)** — server "rejects" flagged submissions by zeroing XP but still records
     the session/counters (vs client true-reject); pollutes mastery analytics; reachable by direct/mobile
     callers. **assessment** defines canonical reject-semantics → **backend** implements.
  4. **SLC-8 cutover (backend / architect)** — flip `ff_server_only_quiz_submit` so all submits route
     through the idempotency-keyed `/api/quiz/submit`. The SLC-8 pin protects the interim state.
  5. **SLC-9 (Low-Med, testing backlog)** — xp-rules branch + cognitive-engine coverage below aspirational
     target. Non-blocking ratchet.
- See `workflows/student-learning-core/STATUS.md` + `cycles/2026-06-29-student-learning-core.md`.

## Current workflow detail — payments-subscriptions (P11) — CYCLE 2 LANDED (auto-fix-safe complete)

- Scope: Razorpay checkout → webhook signature verification → atomic subscription activation →
  reconcile/expired/pre-debit crons → dedupe/idempotency. Governed by invariant **P11** (P9/P13 cross-checks).
- Artifacts: `workflows/payments-subscriptions/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED, auto-fix-safe): **PAY-1** (`subscribe` RBAC gate, 403 before any Razorpay object),
  **PAY-8** (409 when no student row resolves), **PAY-3** (reconcile via atomic
  `atomic_subscription_activation_locked` RPC — no more split-brain), **PAY-7** (missing webhook secret →
  503 retryable; invalid signature unchanged hard-4xx), **PAY-5** (observable dedupe degradation),
  **PAY-4** (architect — `payments-health` registered as 13th Vercel cron `*/10 * * * *`), **PAY-6**
  (testing — verify-HMAC-reject test + extend RBAC pin to `subscribe`).
- Gates: type-check **PASS**, lint **0 errors**, test **236/236** payment suite, build **PASS**,
  `vercel.json` **VALID**. Quality **APPROVE** + architect security **APPROVE**; regression sweep **GREEN**.
- P14 review chain (payment flow) **COMPLETE**: backend (made) → architect (security APPROVE) + testing
  (coverage GREEN) + mobile (downstream review) + frontend (checkout 403/409 SAFE-AS-IS).
- **Open follow-ups (resume these):**
  1. **PAY-2 (Medium, GATED — USER APPROVAL)** — `create-order` hardcoded `PRICING` can diverge from DB
     `subscription_plans`. DEAD on the live web path (web uses `subscribe`); LIVE-referenced only by the
     mobile app, whose flow is already documented-broken. **Do NOT delete unilaterally** (mobile contract
     names it); any pricing-amount change is **user-gated**.
  2. **Mobile repoint** — mobile to repoint `create-order` → `subscribe`, unwrap nested `data`, add 409
     mapping (mobile + backend coordination).
  3. **`docs/product/mobile-web-sync.md` doc fix** — stale; says `create-order` route doesn't exist (it
     exists but is dead on the web path).
  4. **Super-admin stuck-payments display (cosmetic)** — read period from
     `student_subscriptions.current_period_end` since reconcile no longer writes `students.subscription_expiry`.
  5. **REG-178 / REG-179 filing** — testing to file `verify_route_hmac_reject` (P11) and
     `subscribe_rbac_gate_pre_razorpay` (P9/P11) into `.claude/regression-catalog.md` (confirm ids with
     orchestrator if they shift). Catalog 144 → 146 once filed.
  6. **PAY-9 (Low, optional)** — `razorpay_signature` persisted at rest in `payment_history` (verify path).
- See `workflows/payments-subscriptions/STATUS.md` + `cycles/2026-06-29-payments-subscriptions.md`.

## Current workflow detail — auth-onboarding (P15) — CYCLE 1 LANDED (partial)

- Scope: signup → email verification → profile creation → role onboarding → dashboard,
  for all three roles (student / teacher / parent). Governed by invariant **P15**.
- Artifacts: `workflows/auth-onboarding/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED): **AO-4** (bootstrap honours RPC logical-failure → 500, P15 layer-3 fallback engages),
  **AO-8** (auth-form a11y), **AO-1** (executable always-200 Deno test), **AO-2** (honest 3-role E2E,
  `test.fixme`-gated). Gates: type-check/lint/build PASS; test 940/940; Deno 10/10.
- **Cycle-1 follow-ups LANDED 2026-06-29** (type-check PASS, lint 0 errors — see
  `cycles/2026-06-29-auth-onboarding-followups.md`):
  - **AO-5 (assessment, FIXED)** — `src/app/onboarding/page.tsx` stores canonical "9" not "Grade 9" (P5); APPROVE.
  - **AO-7 (backend, FIXED)** — `src/lib/identity/onboarding.ts` `resolveIdentity()` 4× `.single()` → `.maybeSingle()`.
  - **AO-9 (frontend, FIXED)** — `src/lib/AuthContext.tsx` durable per-user once-guard on `signup_complete` (P13/P15 safe).
- **Open follow-ups (resume these):**
  1. **AO-3 (GATED)** — institution_admin provisioning unification; needs **USER APPROVAL** + architect design.
  2. **AO-2 CI fixtures (pending)** — ops/infra to seed 3 per-role staging fixtures + secrets.
  3. **AO-1 CI enforcement** — architect to wire `always-200.test.ts` into `ci.yml` Deno lane.
  4. **REG-177** — testing to file `send_auth_email_always_200` (P15) in `.claude/regression-catalog.md`.
  5. **AO-10 (NEW, grade-coercion / legacy backfill — co-owned assessment + architect)** —
     `src/lib/AuthContext.tsx` (~L423-424) sets `student` from the raw DB row WITHOUT grade coercion, so
     legacy "Grade N" rows still leak the prefixed form until backfilled; `normalize_grade` is misnamed
     (it ADDS the prefix). Needs one-time backfill + rename/read-time coercion.
  6. **RESOLVED — production migration-drift repair** — fixed via **repo-side reconciliation**
     (two no-op placeholder migrations at the ghost version strings `20260628015107` /
     `20260628015237`, per `docs/runbooks/migration-placeholders-audit.md`), merged via **PR #1153**
     through normal authorized CI/CD. The operator-gated `repair-prod-drift` dispatch was correctly
     blocked by the safety classifier and **not needed**. Verification: `deploy-production.yml` run
     **28335566287** SUCCESS — migrations ✅, Edge Functions ✅ (AI agents deploying again), health ✅,
     verification ✅. See `workflows/_incidents/2026-06-28-prod-migration-drift.md` §0.
  7. **AO-6** — backlog (parent phone dropped at signup).
- Mandatory review chain (per `.claude/skills/review-chains/SKILL.md`):
  architect → backend, frontend, testing (E2E for all 3 roles).

## Cycle log

| Cycle | Workflow | Phase reached | Status | Notes |
|---|---|---|---|---|
| 1 | auth-onboarding (P15) | ALL 8 PHASES | **LANDED — partial** | AO-4/8/1/2 + follow-up batch AO-5/7/9 (2026-06-29) landed + APPROVED; AO-3 gated, AO-2 CI fixtures + REG-177 + Deno CI-lane open; NEW AO-10 grade-coercion/backfill; prod migration-drift incident RESOLVED (repo-side reconciliation, PR #1153, deploy 28335566287 green); see `workflows/auth-onboarding/STATUS.md` + `cycles/2026-06-29-auth-onboarding-followups.md` |
| 2 | payments-subscriptions (P11) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | PAY-1/3/4/5/6/7/8 landed + APPROVED (type-check PASS, lint 0, 236/236 payment tests, build PASS, vercel.json VALID; architect security APPROVE; sweep GREEN); REG-178/179 filing in flight; PAY-2 gated to USER (pricing); mobile-repoint + mobile-web-sync.md doc fix + super-admin display open; see `workflows/payments-subscriptions/STATUS.md` + `cycles/2026-06-29-payments-subscriptions.md` |
| 3 | student-learning-core (P1-P6,P12) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | SLC-7 (frontend) + SLC-2/3/6/8-pin (testing) landed + APPROVED (type-check PASS, lint 0, 40/40 new + ~1678 broad tests PASS, build PASS, bundle within P10 caps; quality APPROVE; sweep GREEN); REG-180/181 filed (catalog 146 → 148); SLC-1 USER-GATED, SLC-4/5 + SLC-8 cutover gated/cross-agent, SLC-9 backlog; see `workflows/student-learning-core/STATUS.md` + `cycles/2026-06-29-student-learning-core.md` |
| 4 | foxy-ai-rag (P12,P8,P13) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | FOX-1 (+ Deno twin + injection-pattern refinement) + FOX-2 + FOX-3 + FOX-6 landed + APPROVED (type-check PASS, lint 0, 305/305 vitest + 3/3 Deno PASS, build PASS, bundle within P10 caps; assessment APPROVE WITH CONDITIONS [addressed] + quality APPROVE; sweep GREEN); REG-182/183 filed (catalog 148 → 150); FOX-4 USER-GATED (OpenAI provider governance — MoL shadow, not student-facing), FOX-7-new + streaming-residual + Hindi-tokens follow-ups; live-topology reconciliation recorded (`/api/foxy` is LIVE, `foxy-tutor` Edge Fn gone); see `workflows/foxy-ai-rag/STATUS.md` + `cycles/2026-06-29-foxy-ai-rag.md` |
| 5 | teacher-school-b2b (P8,P9,P13) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | TSB-1 (backend — CRITICAL cross-tenant leak closed at all 8 grade-fallback sites via auth-derived `resolveTeacherSchoolId`, fail-closed) + TSB-2 (architect — teacher RLS backstop on `public.students`, predicate-identical, no over-grant) + TSB-3-partial + TSB-6 landed + APPROVED (type-check PASS, lint 0, 527/527 vitest incl. 15 TSB-1 + 10 TSB-2 new, build PASS, no bundle impact; quality APPROVE WITH CONDITIONS [migration-ordering — RESOLVED via byte-identical rename `20260629000000`→`20260702010000`]; sweep GREEN); REG-184/185 filed (catalog 150 → 152); TSB-4 USER-GATED (table-drop), TSB-3-full + TSB-5 + 3 pre-existing tracked items follow-ups; see `workflows/teacher-school-b2b/STATUS.md` + `cycles/2026-06-29-teacher-school-b2b.md` |
| 6 | super-admin-observability (P9,P13) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | SAO-3 (ops — observability-CSV egress `redactPII`) + SAO-2 (ops+frontend — `top_students.email` drop + stale-type cleanup) + SAO-7 (testing — 134-route full-surface gate sweep, 207/207 gate-before-I/O) + SAO-4 (testing — bare-name log canary) landed + APPROVED (type-check PASS, lint 0, 6/6 new + 351/351 broad PASS, build PASS, bundle within P10; quality independent APPROVE; sweep GREEN); REG-186/187 filed (catalog 152 → 154); SAO-1 USER-GATED (PII-export tiering, DPDP-relevant; on RISK register item 0), SAO-5 folds into SAO-1, message-redaction + periodic-re-read follow-ups, SAO-6 compliant-by-design; see `workflows/super-admin-observability/STATUS.md` + `cycles/2026-06-29-super-admin-observability.md` |
| 7 | parent-portal (P8,P13,P15) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | PP-2 (backend — link-code filter-injection guard at all 3 sites via shared `isValidLinkCode` + byte-identical Deno twin) + PP-1 rate-limit half (backend — per-IP 5/hour brute-force bound on the legacy Edge `parent_login`, 429 + Retry-After, pre-DB) + PP-4 (backend — `PATCH /api/parent/profile` authz gate via already-granted `profile.update_own`, self-scope/no-IDOR) + PP-5 deny pins (testing — unlinked-parent 403/no-payload across all 9 child-data routes) landed + APPROVED (type-check PASS, lint 0, 5 new files/71 new tests, 104/104 target + 404/404 broad PASS, build PASS, no bundle impact; quality independent APPROVE; sweep GREEN); REG-188/189/190 filed (catalog 154 → 157); **PP-1 consent posture + PP-3 USER-GATED (parent-link consent/link model — RISK register item 0)**, PP-5 client-migration + PP-6 + PP-7 + durable-limiter follow-ups; see `workflows/parent-portal/STATUS.md` + `cycles/2026-06-29-parent-portal.md` |
| 8 | cross-cutting (P7,P8,P10,mobile sync) | — | NOT STARTED | next workflow (rank 8 — the final cycle) |

## Backlog pointer

Now active: **Cross-cutting (P7 bilingual breadth, P8 RLS breadth, P10 bundle, mobile sync)** —
`PRIORITY-BACKLOG.md` rank 8 (the FINAL cycle). Promote it to IN PROGRESS in the backlog when its first
phase begins. (Rank 7 Parent Portal is DONE — auto-fix-safe complete; PP-2 link-code filter-injection guard
at all 3 sites + Deno twin + PP-1 per-IP brute-force rate-limit half + PP-4 profile authz gate + PP-5
unlinked-parent deny pins landed (REG-188/189/190, catalog 157); **PP-1 consent posture + PP-3 link-model
USER-gated (parent-link consent model — RISK register item 0)**, with PP-5 client-migration + PP-6 +
PP-7 + durable-limiter follow-ups. Note PP-5 client migration + PP-7 bilingual feed directly into the
Cross-cutting P8/P7 breadth scope.)
