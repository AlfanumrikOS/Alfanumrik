## Internal-admin secret gate — all routes enforce requireAdminSecret before service-role work (Phase 4 route-coverage) — REG-116

Source: Phase 4 route-coverage — the 13 route handlers under
`src/app/api/internal/admin/**` each gate on `requireAdminSecret(request)` (from
`@/lib/admin-auth`) as the FIRST line of every handler. That gate validates the
`x-admin-secret` request header in constant time against
`process.env.SUPER_ADMIN_SECRET` and returns a 401 `NextResponse` (or 503 when
the secret env var is unset) BEFORE any service-role DB work runs.

The load-bearing safety property (P9): the internal-admin API surface is
service-role-backed (bypasses RLS), so the `x-admin-secret` header is the ONLY
boundary standing between an unauthenticated caller and full admin mutation
power. A handler that reached its `getSupabaseAdmin()` seam before checking the
secret — or that returned 200 on a missing/wrong secret — would be a complete
admin takeover. The test drives the REAL gate (no mock of `requireAdminSecret`)
by toggling the header + env var, and mocks ONLY the service-role data seam so a
removed gate would flip `dbAccess.touched` on the deny path. Pinned across 11
representative routes spanning the distinct route shapes (mutation routes
prioritized over reads).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-116 | `internal_admin_secret_gate_enforced` | For 11 representative `src/app/api/internal/admin/**` handlers (bulk-action POST, users GET+PATCH, users/[id] PATCH, content POST+DELETE, feature-flags POST, schools POST, support PATCH, stats GET, command-center GET): (a) NO `x-admin-secret` header → 401 short-circuit AND the service-role DB seam is never touched; (b) WRONG `x-admin-secret` → 401 AND the DB seam is never touched; (c) `SUPER_ADMIN_SECRET` unset entirely → 503 fail-closed AND the DB seam is never touched; (d) VALID header → the handler proceeds PAST the gate (does NOT return 401/503; reaches the DB seam — proving the deny assertions aren't vacuous). The gate (`requireAdminSecret`) is the REAL code, not mocked. | `src/__tests__/api/internal-admin-secret-gate.test.ts` | E |

### Invariants covered by this section

- P9 (RBAC / admin-secret enforcement) — every service-role-backed internal-admin
  route validates the `x-admin-secret` header before any DB work; a missing/wrong
  secret short-circuits to 401 and an unset `SUPER_ADMIN_SECRET` fails closed to
  503. Extends SG-3..SG-5.

### Catalog total

Pre-Phase-4-route-coverage: 83 entries. Adds REG-116 (internal-admin secret gate —
all routes enforce `requireAdminSecret` before service-role work — P9).

**Total: 84 entries.**

## High-blast-radius mutation-route gate pins (Phase 4 final cluster) — REG-119

Source: Phase 4 coverage close-out. Seven of the highest-blast-radius mutation
routes (privilege elevation, tenant role elevation, abuse-blocklist mutation,
OAuth client-secret issuance, bulk student-PII export, destructive event replay,
dead-letter replay) each ALREADY ship a working auth gate — the coverage scan
confirmed no security hole. The gap was a COVERAGE gap: nothing pinned the gate,
so a future refactor could silently downgrade the tier, drop the level/permission
argument, or move the gate after DB I/O and not turn a single test red.

This entry pins each gate by mocking the auth seam and asserting two things per
route: (a) DENY — the gate's unauthorized response is returned AND the first
DB/service seam is never touched (short-circuit before any I/O), with an
assertion on the EXACT level/permission string the source passes (a downgrade
to a lower tier flips the test); (b) ALLOW — an authorized gate lets the route
proceed PAST the gate to the DB/service seam, proving the deny assertion is
non-vacuous.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-119 | `mutation_gate_pins` | Gate pins for 7 high-blast-radius mutation routes. Each pins the EXACT gate + level/permission per SOURCE and that DENY short-circuits before any DB/service I/O: (1) `POST /api/super-admin/rbac` → `authorizeAdmin('super_admin')` (privilege elevation); (2) `POST /api/school-admin/rbac` → `authorizeSchoolAdmin('institution.manage')` (tenant role elevation); (3) `POST` + `DELETE /api/super-admin/alfabot/denylist` → `authorizeAdmin('super_admin')` (abuse-blocklist mutation); (4) `POST /api/super-admin/oauth-apps` → `authorizeAdmin('support')` (issues OAuth client secrets — see under-leveled-tier observation); (5) `POST /api/school-admin/data-export` → `authorizeSchoolAdmin(<resolved code>)` where the route forwards whatever `schoolAdminPermissionCode({off:'school.export_data', on:'institution.export_reports'})` returns, with NO export/DB work on denial (bulk student PII, P13); (6) `POST /api/super-admin/projectors/replay` → `authorizeAdmin('support')` (destructive event replay — see observation); (7) `POST /api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry` → `authorizeAdmin('support')` (dead-letter replay re-triggers side effects). 15 unit tests. | `src/__tests__/api/super-admin/mutation-gate-pins.test.ts` | U |

### Invariants covered by this section

- P9 RBAC enforcement — pins the exact level/permission tier on seven mutation
  surfaces so a silent tier downgrade or dropped gate argument turns the build red.
- P13 Data privacy — the `school-admin/data-export` pin asserts a denied caller
  triggers zero export/DB work (no bulk student-PII read across the boundary).

### Under-leveled-tier observations (NOT changed here — RBAC policy items for CEO/architect)

These two routes are PINNED AT THEIR CURRENT `support` tier (the pin would flip
red if the tier later changes). They are flagged as possible under-leveling for a
policy review — this entry pins behavior, it does not alter it:

- `super-admin/oauth-apps` POST issues/approves OAuth apps (credential issuance);
  `support` may be under-leveled for a credential-issuing surface.
- `super-admin/projectors/replay` POST performs a destructive single-student
  projection rebuild; `support` may be under-leveled for a destructive op.

## RBAC matrix conformance + Student Pulse cross-role boundary (2026-06-12) — REG-120..REG-122

Source: the RBAC-Conformance + Student-Pulse work
(`docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`).
Two deliverables land here: (1) the additive/idempotent RBAC matrix conformance
guard + its offline test (FOUNDATION step), and (2) the Student Pulse feature —
four role-scoped lenses (`/api/pulse/{me,student/[id],class/[classId],school}`)
that surface derived learner signals. Pulse reads existing learner state and
MUST enforce the same ownership boundaries the RBAC matrix encodes; the highest-
severity failure mode (spec §10) is a Pulse lens leaking ANOTHER student's
derived signals (P8/P13). These three entries pin that boundary, the matrix
floor it rests on, and the signal-derivation math.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-120 | `rbac_matrix_conformance` | The full RBAC matrix is reproducible from a single ADDITIVE, IDEMPOTENT root migration (`20260612123200_rbac_matrix_conformance.sql`). The offline test statically pins the migration covers every one of the 11 roles, every matrix permission code, every role→permission grant, the `institution_admin → teacher` inheritance grant, and all 15 `resource_access_rules` across the 4 ownership patterns (own/linked/assigned/any) — resolved BY name/code never UUID. It also pins the additive guards: `roles` ON CONFLICT (name), `permissions` ON CONFLICT (code), `role_permissions` ON CONFLICT (role_id, permission_id), `resource_access_rules` WHERE NOT EXISTS, and NO DROP/DELETE/TRUNCATE/UPDATE (the conformance artifact is the matrix FLOOR, never a reset; prod's ~84-code superset is left untouched). 254 assertions, deterministic, no DB. Closes the reproducibility gap on fresh DBs (CI live-DB, new staging, DR) where `_legacy/` is skipped. | `src/__tests__/lib/rbac/matrix-conformance.test.ts` | U |
| REG-121 | `pulse_cross_role_boundary` | Student Pulse cross-role data boundary (P8/P13). `canAccessStudent(callerId, studentId)` is THE single data boundary on `/api/pulse/student/[id]` (it encodes own/linked/assigned/institution/admin EXACTLY per the matrix), backed by a defense-in-depth viewing-permission gate. The DENY paths are pinned explicitly: a parent NOT linked to the student → 403 (canAccessStudent false); a teacher NOT assigned → 403; a caller WITH a relationship but WITHOUT any viewing permission → 403; unauthenticated → 401; invalid (non-UUID) id → 400. `/api/pulse/class/[classId]`: a teacher who does not own the class (class_teachers) → 403; a caller who is not an active teacher → 403. `/api/pulse/me`: missing `progress.view_own` → blocked verbatim. EVERY deny is audit-logged via `logAudit(..., status:'denied')` with the precise reason (`no_relationship` / `no_view_permission` / `not_class_owner` / `not_a_teacher`), and — the P13 invariant — NO student payload is returned on ANY deny path (the pulse builder is never invoked; the body carries only `{success:false,error}`, no status/timeline/masterySummary/signals/data). Allow-path controls prove the deny assertions are non-vacuous (and that the single-student builder keys off the TARGET's auth_user_id, the self builder off the CALLER's). E2E mirror confirms the live route returns 401/403 + no payload unauthenticated, and that a 403 surfaces as a SAFE denied/empty UI (no crash, no leaked data). | `src/__tests__/api/pulse/pulse-authorization.test.ts`, `e2e/pulse-rls.spec.ts` | U + E |
| REG-122 | `pulse_signal_derivation` | Student Pulse signal-derivation correctness (P-learner-state). The three pure signals in `signals.ts` are anchored to the EXISTING platform conventions so they cannot silently drift: inactivity verdicts (`ok`/`at_risk`/`broken`/`never`/`unknown`) computed against the UTC-calendar-day streak-reset window (matching daily-cron `resetMissedStreaks`), with freeze-softening and exact day-count boundaries; mastery-cliff (`none`/`flagged`/`unknown`) off the canonical `mastery_changed` payload shape (`{fromMastery, toMastery}`) including the cross-below-0.4 path; at-risk concentration bands (`none`/`low`/`medium`/`high`) on the 0.4 platform at-risk mastery line with exact band boundaries, worst-first ordering, and the `worstBand` rollup. 47 tests, deterministic, no DB. | `src/__tests__/lib/pulse/signals.test.ts` | U |

> **REG-121 Round 2 annotation (2026-06-12, post CEO-approved remediation):**
> the `canAccessStudent()` boundary REG-121 pins was REPAIRED, not relaxed, by
> remediation F1 (architect): the teacher branch now enforces the matrix's
> `assigned` ownership via an inline `teachers → class_teachers ⋈ class_students`
> join (the previously-called `is_teacher_of_student` RPC does not exist in the
> prod baseline, so the old teacher allow-path could never return true), and the
> institution_admin branch now reads `school_admins(auth_user_id, school_id,
> is_active)` (the previously-read `school_memberships` table also does not
> exist). Fail-closed behavior is preserved on every error/absent-row path.
> Matrix-conformance fix pinned by 7 new/updated unit tests in
> `src/__tests__/lib/rbac.test.ts` (`canAccessStudent` describe block: teacher
> assigned via the join / not-assigned / not-an-active-teacher /
> class_teachers-query-error fail-closed; institution_admin matching-school /
> different-school / no-school). Round 2 re-run from the canonical-cased root:
> 358/358 unit tests across the 4-file verification set + 4/4 `e2e/pulse-rls.spec.ts`.
>
> **REG-121 UI addendum (Round 2):** the multi-school 400 from
> `/api/pulse/school` (caller administers >1 school, no `?school_id`) is now
> pinned at the component layer — `src/__tests__/components/pulse/SchoolPulsePanel.test.tsx`
> asserts the no-retry "select a school" state (`role=status`, NO retry button —
> retrying without a school id re-issues the identical 400 forever, the ops-review
> "dead retry loop"), that the non-400 error branch KEEPS its Retry button wired
> to `onRetry` (non-vacuity control), the Hindi copy (P7), and the
> stale-data fall-through (`keepPreviousData`: 400 + cached school ⇒ live summary,
> not the picker prompt).

### Invariants covered by this section

- P8 RLS boundary — Pulse never bypasses RLS from client code; every read goes
  through a server route that uses `supabase-admin` ONLY after `authorizeRequest()`
  + `canAccessStudent()` (REG-121). REG-120 guarantees the matrix those checks
  resolve against is fully present on any fresh DB.
- P9 RBAC enforcement — every Pulse route calls `authorizeRequest(...)` with its
  lens permission; REG-120 pins the full role→permission matrix; REG-121 pins the
  per-route gate + the relationship-without-permission denial.
- P13 Data privacy — REG-121's load-bearing assertion: NO derived student signal
  leaks on any deny path (no payload built, no payload returned), and every denial
  is audited with non-PII metadata only.
- P-learner-state (signal correctness) — REG-122 anchors the signal thresholds to
  the UTC streak-reset window, the 0.4 at-risk line, and the canonical
  `mastery_changed` payload so the derivation cannot drift from the cognitive
  engine / daily-cron conventions.

### RCA (E2E happy-path render assertion)

During E2E authoring the `/progress` "My Pulse" header assertion failed once.
ROOT CAUSE: in the offline/CI environment there is no real Supabase backend, so
the mocked `**/auth/v1/token**` route is never exercised on a cold page load and
AuthContext stays in `isLoading`, rendering `<LoadingFoxy />` on `/progress`
(NOT a redirect, NOT a crash). This is the SAME documented environment limitation
as `e2e/auth-onboarding-p15.spec.ts`, not a product defect. FIX (test-only): the
header-visible assertion is now gated on the page having left the loading state
(`role=status[name=Loading]` not visible); the hard, environment-independent
guarantees (no crash, non-empty body, no leaked payload, and the live-route
401/403-with-no-payload wire check) always run. No production code was changed.

### Catalog total

Pre-Pulse cluster: 88 entries (87 prior + REG-123 Foxy-OS). Adds REG-120 (RBAC
matrix conformance — P8/P9 floor), REG-121 (Pulse cross-role boundary — P8/P13),
REG-122 (Pulse signal derivation — learner-state correctness). **Total catalog:
91 entries (target: 35 — TARGET EXCEEDED).**

## RBAC Conformance + Student Pulse — Round 2 flag-gate pin (2026-06-12) — REG-124

Source: Round 2 verification of the four CEO-approved remediation fixes for the
RBAC-Conformance + Student-Pulse feature (F1 `canAccessStudent` repair — see the
REG-121 Round 2 annotation above; F2+F3-UI SchoolPulsePanel slim-down + flag
gate via `useSchoolPulseFlag`; F3 ops `ff_school_pulse_v1` definition + seed;
F4 `pulse-server.ts` importing `PULSE_THRESHOLDS.at_risk_mastery` from
`signals.ts` — local 0.4 literal removed, already covered by REG-122's
threshold anchoring). This entry pins the F2/F3 kill-switch contract.

> **ID note:** REG-124 is the next free id — REG-123 was taken by the
> renumbered Foxy-OS entry (see its ID note above).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-124 | `school_pulse_flag_gate_default_off` | `ff_school_pulse_v1` gates the School Pulse section of the school-admin Command Center and DEFAULTS OFF at every layer. Hook: `useSchoolPulseFlag()` paints OFF synchronously (no first-paint flash), stays OFF when the flag is absent / explicitly false / `getFeatureFlags` rejects, flips ON only after the async confirm, and requests `school_admin`-scoped flags (mirrors the `useSchoolCommandCenter` flag-gate precedent test-for-test). Behavioral: the REAL `<CommandCenter />` rendered with FULL permissions (`can()` → true, so ONLY the flag gates) — flag OFF/unresolved ⇒ the "School Pulse" section is NOT mounted and ZERO fetches hit `/api/pulse/school`, while the host's own `/api/school-admin/overview` fetch fires (alive-control proving suppression is the flag's doing); flag ON ⇒ the section mounts and `/api/pulse/school` IS fetched (non-vacuity control). Static: `FLAG_DEFAULTS['ff_school_pulse_v1'] === false` under the exact flag name; seed migration `20260619000100_seed_ff_school_pulse_v1.sql` inserts `(is_enabled=false, rollout_percentage=0)` with the column order pinned and `ON CONFLICT (flag_name) DO NOTHING` (idempotent, seeded-visible-but-never-live); CommandCenter source keeps the `pulseEnabled && can('institution.view_analytics')` guard around `<SchoolPulseSection>` with the ONLY `useSchoolPulse(` call site inside the gated section (structural fetch suppression: no mount ⇒ no hook ⇒ no SWR key ⇒ no request, and the code-split SchoolPulsePanel chunk stays off the wire). | `src/__tests__/school-admin/pulse-flag-gate.test.tsx` | U |

### Invariants covered by this section

- OFF-path safety / kill switch — School Pulse cannot reach a school admin (no
  UI, no network, no chunk) until an operator flips the DB flag; the default is
  pinned in code (`FLAG_DEFAULTS`), data (seed migration), and the render guard.
- P10 (bundle, adjacent) — the gate keeps the code-split SchoolPulsePanel chunk
  off the wire while OFF.
- P9 (clarified, NOT covered here) — the flag + `usePermissions` gate is UX
  only; `/api/pulse/school` enforces `institution.view_analytics` + school
  membership server-side regardless (REG-121).

### Catalog total

Pre-Round-2: 91 entries. Adds REG-124 (`ff_school_pulse_v1` flag gate —
OFF-path safety). REG-121 was annotated in place (F1 `canAccessStudent` repair
+ the SchoolPulsePanel 400 no-retry component pin) — an annotation, not a new
entry. **Total catalog: 92 entries (target: 35 — TARGET EXCEEDED).**

**Total: 92 entries.** *(Footer corrected 2026-06-12: it previously read "88
entries" — stale from before the REG-120..122 cluster landed. 91 was already
the correct pre-Round-2 figure per the section totals above; 92 includes
REG-124.)*

## Staging migration sync wall — feature_flags seed shape (2026-06-12) — REG-125

Source: PR #1014 P14 review (`fix/staging-migration-sync-feature-flags`). The
original `20260606000000_phase5_phase6_python_flags.sql` inserted into
`feature_flags(name, description, enabled, metadata) ... ON CONFLICT (name)
DO UPDATE` — but the canonical table (pg_dump prod baseline
`00000000000000_baseline_from_prod.sql` ~line 11212) has NO `name`/`enabled`
columns; the key column is `flag_name` (UNIQUE `feature_flags_flag_name_key`,
~line 15364) with `is_enabled` + `rollout_percentage` + `metadata`. The 42703
("column does not exist") failed the "Sync Migrations to Staging" pipeline at
statement 0 (GitHub run 27425591787 and 5+ predecessors) and walled EVERY
later migration off staging. PR #1014 rewrote the file schema-adaptively
(to_regclass fresh-DB guard, information_schema column detection with
canonical-branch priority, ON CONFLICT (flag_name) DO NOTHING, guarded
WHERE-NOT-EXISTS legacy branch, default-OFF posture); REG-125 turns the
failure mode into a CI-time error and pins the rewrite.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-125 | `feature_flags_insert_shape_conformance` | Repo-wide static scanner over ROOT migrations (the only files `supabase db push` executes; `_legacy/` skipped): every `INSERT INTO feature_flags` carries an explicit column list that includes the canonical `flag_name` column — UNLESS the file is schema-adaptive (executable-SQL detection of `information_schema.columns` + `column_name = 'flag_name'` + `to_regclass('public.feature_flags')`), in which case a guarded legacy-shape branch is permitted but a canonical branch must coexist in the same file. No feature_flags insert may resolve conflicts on the nonexistent `name` column (`ON CONFLICT (name)`) — statement-scoped, so legitimate `ON CONFLICT (name)` on roles/guardians is untouched. Analysis runs on comment-stripped, string-blanked SQL (single-pass tokenizer) so the rewrite's own header comment quoting the broken SQL cannot trip the scanner and `;`/`--` inside description literals cannot truncate a statement; dollar-quoted DO bodies are analyzed, not skipped. Scanner self-test embeds the ORIGINAL broken SQL and asserts it is flagged on all three axes (legacy columns, no adaptive guard, ON CONFLICT (name)) — validated for real: the test fails 8/11 against the pre-PR file. File-specific pins on the rewritten 20260606000000: fresh-DB to_regclass guard; detects BOTH shapes with `IF v_has_flag_name ... ELSIF v_has_name` priority; canonical branch is `ON CONFLICT (flag_name) DO NOTHING` and the file contains NO `DO UPDATE` (the original DO UPDATE would clobber an ops-bumped `metadata.rollout_pct` back to 0 on re-apply — dropped deliberately, must never return); default-OFF posture pinned as "no boolean `true` literal anywhere in executable SQL" + no nonzero `'rollout_pct'` + ≥5× `'enabled', false` and `'kill_switch', false` (4 canonical rows + 1 legacy SELECT); all four `ff_python_{ncert_solver,cme_engine,foxy_tutor,quiz_generator}_v1` flags appear exactly twice (canonical AND legacy branch); legacy branch is `WHERE NOT EXISTS` with no `ON CONFLICT` (no dependence on a unique constraint over `name`). 11 tests, deterministic, no DB. | `src/__tests__/regressions/reg-125-feature-flags-insert-shape.test.ts` | U |

### Invariants covered by this section

- Operational integrity (deploy pipeline) — a wrong-shape feature_flags seed
  is now a PR-CI failure, not a staging-deploy wall that blocks the entire
  migration chain behind it.
- OFF-path safety / P12-adjacent — the four Phase 5/6 Python-cutover flags
  (AI-serving surface) cannot seed live: is_enabled=false,
  rollout_percentage=0, metadata.enabled=false, metadata.kill_switch=false,
  metadata.rollout_pct=0 are all statically pinned, matching the sibling
  ff_python_* seeds (20260603*, 20260609*) and the
  `python-ai-proxy.ts` precedence contract.
- Ops-value preservation — the DO-NOTHING conflict posture guarantees a
  re-applied seed can never reset an ops-bumped rollout_pct (the original
  DO UPDATE could).

## Monitoring data boundary — learning_events / intervention_alerts / system_metrics RLS + CHECK↔TS parity (2026-06-15) — REG-143

Source: monitoring substrate landing (`src/types/monitoring.ts` + three new
tables under `supabase/migrations/20260615122657..659`). The monitoring stack
introduces three tables with three DISTINCT security postures, all of which
carry P8/P9/P13 weight:

- `learning_events` — the student-owned event stream. Students read + insert
  ONLY their own rows (`student_id = auth.uid()` in USING + WITH CHECK), and the
  table is APPEND-ONLY (no UPDATE/DELETE policy → a student's UPDATE/DELETE
  silently affects 0 rows with NO error and the row survives unchanged).
- `intervention_alerts` — the staff-facing at-risk feed. SELECT + UPDATE are
  restricted to teacher/admin/super_admin via a `user_roles × roles` join that
  carries the A1 expired-grant guard `(ur.expires_at IS NULL OR ur.expires_at >
  now())`; students/anon read 0 rows, no error; a lapsed grant
  (`is_active=true` but `expires_at` in the past) does NOT grant access.
- `system_metrics` — platform telemetry. Admin/super_admin READ only; there is
  NO INSERT policy at all (exactly ONE `CREATE POLICY`, FOR SELECT) so the
  service_role (RLS bypass) is the only writer; an authenticated non-admin
  insert is rejected. The `metric_name` empty-string guard is APP-LEVEL in
  `logSystemMetric()` (`src/lib/monitoring/log-event.ts`), NOT a DB constraint.

> **ID note:** REG-142 is the previous entry (Foxy grade-spoof hard block,
> 2026-06-15). REG-143 is the next free id at the time this entry was written.

Each test file runs in TWO layers, mirroring the repo's established RLS-test
pattern. STRUCTURAL assertions read the migration `.sql` text (RLS enabled,
policy predicates present, CHECK lists exact, NOT NULL declared, `DEFAULT now()`
present, indexes present, no `USING (true)`/`WITH CHECK (true)`, append-only =
no `FOR UPDATE`/`FOR DELETE` policy) and run ALWAYS — no database needed,
whitespace/quoting-tolerant via the house normalisation. LIVE assertions are
wrapped in `describe.skipIf(!LIVE_DB)` (`LIVE_DB = process.env.TEST_SUPABASE_URL
!== undefined`) and use real per-role authenticated clients so `auth.uid()` is
the genuine session user; every id is `crypto.randomUUID()` (no hardcoded UUIDs,
no hardcoded `auth.uid()`). Append-only edge case: a blocked UPDATE/DELETE
asserts 0 rows AND NO error (the row is re-SELECTed via service role and proven
unchanged) — it does NOT assert `error !== null`; an INSERT that violates
WITH CHECK / a CHECK constraint DOES assert a non-null error.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-143 | `monitoring_rls_and_check_ts_parity` | **(A) SQL CHECK ↔ TS union parity (both directions):** `learning_events.event_type` CHECK = exactly the 8 values of `LearningEventType`; `intervention_alerts.alert_type` CHECK = exactly the 5 values of `AlertType`; `intervention_alerts.severity` CHECK = exactly `watch`/`act`/`urgent` of `AlertSeverity` (each literal present AND the CHECK-list literal count equals the union arity — a stray or dropped value fails). **(B) learning_events (P8/P13 — student own-row):** student CAN insert/select own rows (`student_id = auth.uid()`); CANNOT insert a foreign `student_id` (WITH CHECK → non-null error); CANNOT select another student's rows (0 rows, no error); anon insert rejected; required NOT NULL columns (`student_id`/`session_id`/`verb`/`event_type`) + `occurred_at DEFAULT now()` (omitted-on-insert → populated). **(C) learning_events append-only:** structurally no `FOR UPDATE`/`FOR DELETE` policy; live student UPDATE and DELETE each affect 0 rows with NO error and the row survives unchanged (service-role re-SELECT). **(D) intervention_alerts (P8/P9):** teacher/admin/super_admin CAN select; student 0 rows no error; anon blocked; teacher CAN update (resolve → `resolved_at`); student UPDATE affects 0 rows (alert unchanged); EXPIRED teacher grant (`expires_at` in past, `is_active=true`) does NOT grant access (0 rows) — the A1 `(expires_at IS NULL OR expires_at > now())` clause is also asserted present on both staff policies; invalid `alert_type`/`severity` insert → error. **(E) system_metrics (P8/P9/P13):** admin/super_admin CAN select; teacher/student 0 rows no error; anon blocked; service-role CAN insert (RLS bypass); authenticated non-admin (incl. the admin-READ user) + plain student INSERT rejected (no INSERT policy — structurally exactly ONE `CREATE POLICY`, FOR SELECT only); the `metric_name` empty/whitespace guard is asserted APP-LEVEL in `logSystemMetric()` (early `return;` before the `system_metrics` insert), noted as an app guard not a DB constraint. | `src/__tests__/monitoring/learning-events-rls.test.ts`, `src/__tests__/monitoring/intervention-alerts-rls.test.ts`, `src/__tests__/monitoring/system-metrics-rls.test.ts` | U (structural always-on) + E (live, skipIf TEST_SUPABASE_URL) |

### Invariants covered by this section

- P8 RLS boundary — REG-143 (learning_events is student-own-row read+insert and
  append-only; intervention_alerts is staff-role-gated with the expired-grant
  guard so a lapsed grant cannot read; system_metrics is admin/super_admin read
  only with no write policy; no policy uses an open `USING (true)`/`WITH CHECK
  (true)` predicate).
- P9 RBAC enforcement — REG-143 (intervention_alerts SELECT/UPDATE and
  system_metrics SELECT resolve role through the `user_roles × roles` join with
  `is_active = true` AND the expired-grant guard; system_metrics has NO INSERT
  policy so writes are service-role-only).
- P13 Data privacy — REG-143 (a student cannot read another student's
  learning_events; students/teachers/anon cannot read intervention_alerts /
  system_metrics; the monitoring CHECK↔TS parity keeps the typed surface from
  drifting away from the DB-enforced value set).
- P5-adjacent (type/contract parity) — REG-143 (the 8 event_type / 5 alert_type
  / 3 severity literals are asserted equal between the SQL CHECK lists and the
  `src/types/monitoring.ts` unions in BOTH directions).

### Catalog total

Pre-REG-143: 110 entries (through the Foxy P12 grade-spoof hard-block,
REG-142). The monitoring data-boundary cluster adds REG-143 (three-table RLS +
append-only + service-role-only-write + CHECK↔TS parity). **Total catalog: 111
entries (target: 35 — TARGET EXCEEDED).**

**Total: 111 entries.**

## Phase 1 academic structure: boards, academic_terms, student_attendance, class_schedule (P8, P9) (2026-06-21) — REG-162..REG-167

Source: migration `20260621000000_phase1_academic_structure_attendance_boards.sql`
— creates 4 new tables (`boards`, `academic_terms`, `student_attendance`,
`class_schedule`), seeds CBSE/ICSE/IB/NIOS board reference data, seeds CBSE
2025-26 Term 1 + Term 2 academic defaults, and establishes RLS policies across
all 4 tables. The `mark_attendance` Edge Function handler validates the input
contract enforced here.

All 6 entries are covered by pure-function unit tests in
`src/__tests__/schema/phase1-academic-structure.test.ts` (56 tests total —
no live DB required; RLS policies represented as TypeScript predicates,
constraint logic represented as pure validators).

> **ID note:** REG-161 is the previous entry (demo-comp server-gated boundary,
> 2026-06-16). REG-162..REG-167 are the next free ids.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-162 | `boards_rls_anon_cannot_insert` | **BOARDS TABLE SCHEMA CONTRACT (P8 — service_role-only writes).** The `boards` reference table has 4 seeded rows (CBSE, ICSE, IB, NIOS) with required fields `id`, `code`, `name`, `name_hi`, `country`, `is_active`, `display_order`, `created_at`. CBSE carries `country='IN'` and `is_active=true`. The `code` column has a UNIQUE constraint — a second CBSE insert is rejected. RLS: authenticated users can SELECT (USING true); no INSERT/UPDATE policy exists for the `authenticated` role — only `service_role` (which bypasses RLS) can write board reference data. Unauthenticated users cannot SELECT. | `src/__tests__/schema/phase1-academic-structure.test.ts` (4 + 3 boards-RLS tests) | U (pure-function unit; no live DB) |
| REG-163 | `student_attendance_rls_three_role_boundary` | **STUDENT_ATTENDANCE RLS — 3-ROLE ACCESS BOUNDARY (P8, P9).** Teacher SELECT: USING `class_id IN (SELECT ct.class_id FROM class_teachers ct JOIN teachers t ON t.id=ct.teacher_id WHERE t.auth_user_id=auth.uid())` — a teacher can only see attendance for classes they teach via `class_teachers`; an empty class list means zero rows visible. Student SELECT: USING `student_id = (SELECT id FROM students WHERE auth_user_id=auth.uid())` — a student sees only their own rows, never another student's. Parent/guardian SELECT: USING `student_id IN (SELECT gsl.student_id FROM guardian_student_links gsl JOIN guardians g ON g.id=gsl.guardian_id WHERE g.auth_user_id=auth.uid() AND gsl.status='approved')` — a parent sees only approved-linked children's rows; a pending link (status≠'approved') grants no access. An unauthenticated caller (no auth.uid()) sees zero rows from all three policies. Also covers the `assignment_submissions` parent SELECT policy that follows the same approved-guardian-link pattern (P8). | `src/__tests__/schema/phase1-academic-structure.test.ts` (7 + 4 parent-submissions-RLS tests + 3 regression-catalog pinning tests) | U (pure-function unit; no live DB) |
| REG-164 | `student_attendance_status_enum_and_unique_constraint` | **STUDENT_ATTENDANCE VALIDATION — STATUS ENUM + UNIQUE CONSTRAINT (P8 schema integrity).** The `status` column accepts exactly four values: `'present'`, `'absent'`, `'late'`, `'excused'`. Values like `'here'`, `'tardy'`, `''`, or `'PRESENT'` (uppercase) are rejected. The `period` column defaults to `'All Day'` when absent or blank. The UNIQUE constraint on `(class_id, student_id, attendance_date, period)` rejects a second insert for the same student in the same class on the same date for the same period; inserting a second row with a different period is NOT a conflict. | `src/__tests__/schema/phase1-academic-structure.test.ts` (5 tests) | U (pure-function unit; no live DB) |
| REG-165 | `mark_attendance_handler_input_validation` | **MARK_ATTENDANCE HANDLER — INPUT VALIDATION CONTRACT (P3 anti-cheat-adjacent, P8).** The `mark_attendance` Edge Function handler rejects: missing `teacher_id` (code `MISSING_TEACHER_ID`), missing `class_id` (code `MISSING_CLASS_ID`), date not matching `/^\d{4}-\d{2}-\d{2}$/` (code `INVALID_DATE_FORMAT`), empty `records` array (code `EMPTY_RECORDS`), `records` array with more than 200 items (code `RECORDS_TOO_LARGE`), any record missing `student_id` (code `MISSING_STUDENT_ID`), any record with a status not in `{present,absent,late,excused}` (code `INVALID_STATUS`). A fully valid batch (teacher_id + class_id + YYYY-MM-DD date + records each with student_id and a valid status) is accepted. Notes are clamped to 200 characters; period strings are trimmed and clamped to 50 characters. | `src/__tests__/schema/phase1-academic-structure.test.ts` (10 + 4 regression-catalog pinning tests) | U (pure-function unit; no live DB) |
| REG-166 | `academic_terms_null_school_id_partial_index` | **ACADEMIC_TERMS PARTIAL INDEX — NO DUPLICATE GLOBAL DEFAULTS (P8 schema integrity).** The migration seeds two platform-wide default terms for CBSE 2025-26: Term 1 (Apr 2025 – Sep 2025, `is_current=false`) and Term 2 (Oct 2025 – Mar 2026, `is_current=true`). Both have `school_id=NULL`. A partial UNIQUE index on `(academic_year, term_number) WHERE school_id IS NULL` prevents duplicate global defaults: inserting a second NULL school_id row with `academic_year='2025-26'` and `term_number=1` conflicts. School-specific terms (school_id not null) with the same year+term do NOT conflict (the partial index does not apply). A NULL school_id row for a different academic year (e.g. `'2026-27'`) does not conflict with the seeded 2025-26 rows. | `src/__tests__/schema/phase1-academic-structure.test.ts` (6 + 1 regression-catalog pinning test) | U (pure-function unit; no live DB) |
| REG-167 | `class_schedule_time_constraints` | **CLASS_SCHEDULE — TIME AND CONSTRAINT CHECKS (P8 schema integrity).** The `class_schedule` table enforces: `end_time > start_time` (equal or reversed times rejected); `effective_until >= effective_from` when both are present (inverted dates rejected); `effective_until=NULL` allowed (means currently active); `day_of_week` is an integer 0–6 inclusive (7 and -1 rejected); `period_number >= 1` (0 and -1 rejected). A fully valid row (day_of_week in 0–6, period_number≥1, end_time>start_time, effective_until=null) is accepted. `effective_until = effective_from` (single-day override) is also accepted. | `src/__tests__/schema/phase1-academic-structure.test.ts` (7 + 1 regression-catalog pinning test) | U (pure-function unit; no live DB) |

### Invariants covered by this section

- P8 RLS boundary — REG-162 (boards: authenticated SELECT, service_role-only
  INSERT, no PII in reference data); REG-163 (student_attendance: teacher
  scope = class_teachers join, student scope = own rows only, parent scope =
  approved guardian_student_links only — three independent deny boundaries);
  REG-164 (status CHECK + UNIQUE index defend against corrupt attendance
  records); REG-165 (mark_attendance handler validates before any DB write,
  preventing injection of oversized or invalid payloads); REG-166 (partial
  index ensures global academic calendar cannot be double-seeded or corrupted
  by an ambiguous upsert); REG-167 (CHECK constraints on time order and
  day-of-week prevent impossible schedule rows that would break timetable
  queries).
- P9 RBAC enforcement — REG-163 (teacher access scoped strictly to
  class_teachers rows; parent access requires approved link, not merely
  any guardian_student_links row; student cannot cross-read peers).

### Catalog total

Pre-REG-162: 129 entries (through quarterly school billing + demo-comp,
REG-161). Phase 1 academic structure adds REG-162..REG-167: boards schema
contract (ref-data RLS), student_attendance 3-role RLS boundary, attendance
status enum + UNIQUE constraint, mark_attendance handler input validation,
academic_terms partial index for global defaults, and class_schedule time
constraints. 6 entries, all covered by 56 pure-function unit tests in a
single new file (no live DB). **Total catalog: 135 entries (target: 35 —
TARGET EXCEEDED).**

**Total: 135 entries.**

## Incident — students RLS infinite recursion + P15 null-student hydration — 2026-07-02

A production incident took down EVERY authenticated client read of `public.students`
(dashboard, `get_mastery_overview`, StreamGate, profile reads) and stranded logged-in
students on a forever-skeleton dashboard. Two independent root causes, two independent fixes,
two regression pins.

**Cause 1 (RLS recursion, P8).** Migration `20260702010000_teacher_assigned_students_rls.sql`
added the policy "Teachers can view students in their classes" ON `public.students` whose
USING clause INLINED a subquery over `public.class_students`
(`id IN (SELECT cs.student_id FROM public.class_students cs JOIN class_teachers … JOIN
teachers …)`). Because that inline subquery reads `class_students` as SECURITY INVOKER,
`class_students`' baseline policy "Students can view own enrollment" — which reads
`public.students` back — re-entered the RLS evaluator and Postgres raised
"infinite recursion detected in policy for relation students". Fix migration
`20260702080000_fix_students_rls_infinite_recursion.sql` DROPped it and recreated it as
`USING ( public.is_teacher_of(id) )` — a SECURITY DEFINER helper whose inner reads bypass RLS,
breaking the cycle. The durable rule: teacher/parent boundaries on `public.students` MUST go
through the SECURITY DEFINER helpers `public.is_teacher_of(id)` / `public.is_guardian_of(id)`,
NEVER an inline subquery over another RLS-protected, student-referencing table.

**Cause 2 (P15 null-student hydration).** With every `students` read failing, the
`get_user_role`-success branch in `src/lib/AuthContext.tsx` hit a `.single()` on the secondary
profile read, which REJECTS with PGRST116 on 0 rows. The throw aborted the role branch; because
the parallel rescue is guarded by `if (!rolesResolved)` (already true), `student` was left
permanently `null` while `isLoggedIn` stayed true → StudentOSDashboard skeletoned forever. The
fix switches the secondary read to `.maybeSingle()`, adds a defensive `auth_user_id` re-read,
and — when both come back null — hydrates `student` from the RPC's OWN `rd.student` payload
(grade normalized via `normalizeGrade` (P5); `onboarding_completed` verbatim so the
`/onboarding` redirect stays correct). A logged-in student is NEVER left with `student === null`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-210 | `students_rls_no_inline_recursive_subquery` | P8: parses the root migration chain (baseline + later root migrations, in timestamp order; `_legacy/` excluded), reduces every CREATE/DROP POLICY ON `public.students` to the FINAL effective set (so `20260702080000` supersedes `20260702010000`), and asserts NO surviving policy inlines a FROM/JOIN over an RLS-protected, student-referencing table (`class_students`, `class_teachers`, `guardian_student_links`/`parent_student_links`/`parent_links`, `teacher_remediation_assignments`) — those boundaries must instead delegate to `is_teacher_of(id)`/`is_guardian_of(id)`. Positive-shape pins: the surviving "Teachers can view students in their classes" policy calls `is_teacher_of(id)`; `students_select_merged` uses helpers only. Detector self-test proves it FLAGS the old recursive policy text and CLEARS the fixed helper form (non-vacuous). Static SQL-text guard, no DB. | `src/__tests__/students-rls-no-recursion.test.ts` | E | P8 |
| REG-211 | `authcontext_p15_null_student_hydration` | P15: mounts the REAL `AuthProvider` (supabase mocked at the module boundary). When `get_user_role` resolves a STUDENT role with an `rd.student` payload BUT both secondary `students` reads (`.maybeSingle()` by id, then defensive re-read by `auth_user_id`) return null/0-rows, the exposed `student` is NON-null (never strands a logged-in student → no forever-skeleton dashboard), carries the RPC grade normalized to bare P5 form (`'Grade 9'`→`'9'`) and `onboarding_completed` VERBATIM (true and false cases). Second branch: when the `auth_user_id` re-read succeeds, `student` hydrates from the FULL row. | `src/__tests__/auth-context-p15-null-student-hydration.test.tsx` | E | P15 |

### Invariants covered by this section

- P8 (RLS boundary) — REG-210 is a SOURCE-level static guard (normal `npm test` lane, sibling
  to REG-200/REG-208/REG-209's TSB-4/AO-10b source pins; NOT the gated live-DB
  `src/__tests__/migrations/**` lane). It pins the INVARIANT (no inline protected-table subquery
  in any active students policy), not just the one fixed file, so any future migration that
  reintroduces the recursion pattern fails PR CI. The cycle is a property of the policy
  DEFINITION and is provable statically; the live-DB proof ("an authenticated student reads
  their own row without a recursion error") is complementary and lives in the integration lane.
- P15 (onboarding integrity) — REG-211 exercises the REAL AuthContext code path (full provider
  render + context probe), not a replicated helper, pinning the `maybeSingle` + RPC-payload
  fallback that guarantees a resolved student role never ends with `student === null`.

### Catalog total

students RLS infinite-recursion fix + P15 null-student hydration fix add REG-210 (P8 static
guard — no active `public.students` policy may inline a subquery over an RLS-protected,
student-referencing table; teacher/parent boundaries go through `is_teacher_of`/`is_guardian_of`)
and REG-211 (P15 — a resolved student role is always hydrated to a non-null `student`, from the
`get_user_role` payload when the secondary profile read returns 0 rows).
**Total catalog: 178 entries (target: 35 — TARGET EXCEEDED).**

---

## XC-3 Phase 0a — Generalized RLS cross-table-recursion guard (2026-07-02)

Source: `docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md` §5 (Phase 0a).

**Why.** REG-210 guards the TSB-4 infinite-recursion class for `public.students` ONLY. The XC-3
audit found the pattern is SYSTEMIC: ~141 of 522 baseline policies (242 across the whole effective
chain after the Phase 0a.1 unquoted-name widening — was 214 under the original quoted-only name
regex) inline a SECURITY-INVOKER cross-table subquery that re-enters another RLS-enabled table —
every one a latent edge that can close a TSB-4-style `students→…→students` cycle the moment a
back-edge is added. We cannot retroactively rewrite all of them now, so Phase 0a FREEZES the
surface: a generalized static guard across ALL tables that fails the moment a NEW or RENAMED policy
adds another inline cross-table subquery. Phase 4 drains the grandfather ledger (inline → SECURITY
DEFINER helper) table by table, ratcheting the count DOWN.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-212 | `rls_no_cross_table_recursion_generalized` | P8: parses the full root migration chain (baseline + root `*.sql` in timestamp order; `_legacy/` excluded), builds `R` = every table with effective `ENABLE ROW LEVEL SECURITY` (≥270), reduces every CREATE/DROP POLICY on EVERY table to the FINAL effective set (DROPs applied in order), and flags a surviving policy as a recursion risk iff its `USING`/`WITH CHECK` inlines a `FROM`/`JOIN` over `b ∈ R, b ≠ policyTable`. EXEMPT: self-references (`b===T`), foreign-schema relations (`auth.`/`vault.`), non-RLS reference tables, and SECURITY DEFINER helper CALLS (`is_teacher_of`/`is_guardian_of`/`is_school_admin_of`/`is_admin`/`get_my_*`/`get_admin_school_id` — no FROM of their own). FREEZE: the detected risk set MUST be a SUBSET of the hardcoded `GRANDFATHERED_INLINE_POLICIES` ledger (242 keys, `"<table>::<name>"`) — fails ONLY on a NEW/RENAMED inline cross-table policy. Plus: no STALE ledger entries (exact mirror of live debt → Phase-4 ratchet), count pinned at 242, the apex `students` carries only the one known grandfathered latent edge (`School admins can view school students`) while the fixed `Teachers can view students in their classes` + `students_select_merged` delegate to helpers and are NOT flagged (and the teacher-policy name is absent from the ledger, so re-adding the inline shape FAILS). Detector self-test (non-vacuous): FLAGS the old recursive TSB-4 text (inline `class_students`/`class_teachers`/`teachers`) and CLEARS the fixed `is_teacher_of(id)` form, a pure `auth.uid()` predicate, a helper-call combo, and a same-table self-ref; FLAGS an inline `guardian_student_links` join. **Phase 0a.1 (XC-3) hardening:** the CREATE/DROP POLICY name matcher now accepts BOTH quoted (`"my policy"`) AND UNQUOTED (`my_policy`) identifiers — the original quoted-only regex was blind to unquoted-name policies (a false negative). The widening surfaced 28 previously-invisible unquoted-name inline policies (214 → 242), ALL on CHILD tables inlining a PARENT boundary table that does not read them back (none a live cycle; verified reaches-self=false for each) — frozen in the Phase 0a.1 block of the ledger. New self-tests prove an UNQUOTED-name recursive policy (`CREATE POLICY teacher_inline ON public.students USING (… FROM public.class_students …)`) is now matched + flagged, quoted names still match (no regression), DROP-by-unquoted-name still reduces the matching CREATE, and unquoted-name case is folded. Static SQL-text guard, no DB. | `src/__tests__/rls-no-cross-table-recursion.test.ts` | E | P8 |

**Reconciliation of `rls-teacher-assigned-students.test.ts` (REG-209).** That file previously pinned
the SHAPE of the SUPERSEDED *recursive* TSB-4 policy (`20260702010000`) — it asserted the inline
`class_students ⋈ class_teachers ⋈ teachers` roster join that `20260702080000` removed, i.e. exactly
the shape we must never ship again. It is rewritten (coverage preserved, not deleted) to pin the
FIXED end-state: across the reduced chain the effective `students` teacher backstop delegates to
`public.is_teacher_of(id)` and inlines NO roster join; `20260702080000` sorts after and supersedes
`20260702010000`; the three TSB-2 boundary outcomes (assigned ⇒ visible, non-assigned ⇒ 0 rows,
inactive enrollment ⇒ 0 rows) survive because they are now carried inside the `is_active`-guarded
`is_teacher_of` helper (baseline definition pinned); and NO surviving `students` policy resurfaces
the inline roster join.

### Invariants covered by this section

- P8 (RLS boundary) — REG-212 generalizes REG-210's students-only intent to ALL RLS-enabled tables.
  It is a SOURCE-level static guard in the normal `npm test` lane (sibling to REG-210). The cycle is
  a property of the policy DEFINITION and is provable statically; the live-DB proof is complementary
  and lives in the integration lane. The guard FREEZES the current 242-policy blast radius (214 +
  the 28 unquoted-name policies surfaced by the Phase 0a.1 name-regex widening) so the
  recursion class cannot grow, and the grandfather ledger is the explicit, reviewable debt list that
  Phase 4 drains.

### Catalog total

XC-3 Phase 0a adds REG-212 (P8 generalized cross-table-recursion freeze — no NEW/RENAMED policy on
ANY table may inline a `FROM`/`JOIN` over a different RLS-enabled table; the current 242 inline
policies — 214 original + 28 surfaced by the Phase 0a.1 unquoted-policy-name widening — are
grandfathered and Phase 4 ratchets the ledger down) and reconciles the stale
`rls-teacher-assigned-students.test.ts` (REG-209) onto the fixed `is_teacher_of(id)` end-state.
**Total catalog: 179 entries (target: 35 — TARGET EXCEEDED).**

---

## XC-3 Phase 0b + 0c — admin-client allowlist freeze + RLS inventory (2026-06-30)

**Why.** Phase 0a froze the RLS *policy-recursion* class. The same XC-3 audit found two more
systemic exposures to freeze before any Phase ≥1 migration: (1) **273 of 362** API `route.ts` files
import the RLS-BYPASSING service-role client `@/lib/supabase-admin` — on those routes RLS is not
exercised on the request path and a single missed `authorizeRequest()` is an unbounded data leak
(P8/P9/P13); and (2) the schema's RLS *inventory* posture (every public table RLS-enabled; only the
two intentional `mass_gen_log`/`school_subscriptions` deny-all tables in the baseline) must not
silently drift. Phase 0b FREEZES the 273-route admin footprint so it can only ratchet DOWN as
Phase 2/3 migrate reads onto `supabase-server`; Phase 0c FREEZES the table-level RLS inventory so no
un-protected or unannounced service-role-only table can be added. Both are source/SQL-text static
guards in the normal `npm test` lane (no live Postgres), consistent with the Phase 0a sibling.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-213 | `api_admin_client_allowlist_freeze` | P8/P9: enumerates every `route.ts` under `src/app/api` and flags any whose source imports a module specifier ending in `supabase-admin` (covers `@/lib/supabase-admin` AND relative `../../lib/supabase-admin` forms). Loads `scripts/admin-client-allowlist.json` (the architect-owned ledger, 273 entries). ASSERTS `detected \ allowlist === ∅` (a NEW admin-importing route absent from the ledger FAILS — author must either use the RLS-scoped `supabase-server` client or, if service-role is genuinely required, add the route + bump `count` in the same PR), `allowlist \ detected === ∅` (no STALE entry — a migrated/removed route must be pruned so the count ratchets DOWN, never drifts), and pins the count at exactly **273**. Robust to `\\`→`/` path-separator drift; ledger self-consistency (`routes.length === count`) also pinned. Static source scan, no runtime/DB. | `src/__tests__/api-admin-client-allowlist.test.ts` + `scripts/admin-client-allowlist.json` | E | P8, P9 |
| REG-214 | `rls_inventory_every_table_protected` | P8: parses the full root migration chain (baseline + root `*.sql` in timestamp order; `_legacy/` excluded) into CREATED (public `CREATE TABLE`, `DROP TABLE` removes), RLS (`ALTER … ENABLE ROW LEVEL SECURITY`, `DISABLE` removes) and POLICIED (≥1 surviving `CREATE POLICY`, quoted pg_dump AND unquoted hand-written names, DROPs applied) sets; views/matviews never match (`CREATE TABLE` only); non-public schemas excluded. ASSERTS `CREATED ⊆ RLS` (every public table created in the chain has RLS enabled — no un-protected table can be added; reports the offending name) and `RLS ⊆ CREATED` (no orphan ENABLE). DENY-ALL freeze (RLS-on, ZERO-policy = service-role-only): the **baseline** deny-all set is EXACTLY `{mass_gen_log, school_subscriptions}` (the two intentional ones the audit found — pinned verbatim); those two remain deny-all in the full chain; and the **full effective-chain** deny-all set equals the reviewed `SERVICE_ROLE_ONLY_TABLES` ledger (36 tables — the 2 audit tables plus the agent/AI/queue/log infra that `20260516020000_tighten_rls_policy_always_true.sql` and post-baseline migrations made service-role-only) EXACTLY, so a NEW RLS-on-but-policy-less table (not in the ledger) FAILS and a table that gains policies (left stale in the ledger) also FAILS. Static SQL-text guard, no DB. | `src/__tests__/rls-inventory.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary) / P9 (RBAC enforcement) — REG-213 freezes the service-role-client blast radius
  (the dominant data path that bypasses RLS) so it can only shrink; REG-214 freezes the table-level
  RLS inventory (universal RLS coverage + the exact service-role-only deny-all set). Both are
  source/SQL-text static guards in the normal `npm test` lane (siblings to REG-210/REG-212). They are
  the enforcement layer Phase 1 (backstop policies) and Phase 2/3 (route migrations) rely on.

### Catalog total

XC-3 Phase 0b + 0c add REG-213 (admin-client allowlist freeze — the 273-route `supabase-admin`
footprint is pinned and may only ratchet DOWN) and REG-214 (RLS inventory — every public table is
RLS-enabled and the deny-all/service-role-only set is frozen: baseline EXACTLY
`{mass_gen_log, school_subscriptions}`, full chain EXACTLY the 36-table reviewed ledger).
**Total catalog: 181 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-216 — XC-3 Phase 1: apex `students` school-admin policy delegates to a SECURITY DEFINER helper (first ledger drain 242 → 241)

**Why.** The XC-3 generalized recursion guard (REG-212) freezes the inline cross-table
RLS surface and forces it to ratchet DOWN, never drift. XC-3 Phase 1 (migration
`20260702090000_xc3_p1_is_school_admin_of_student_helper.sql`) refactors the LAST latent
inline cross-table edge on the apex `public.students` table — the policy
`"School admins can view school students"`, which inlined `FROM public.school_admins`
inside its `USING` (baseline:19906) — to the new SECURITY DEFINER helper
`public.is_school_admin_of_student(uuid)`. This is the binding RS-RULE applied to the apex
table: cross-table authorization must delegate to a SECURITY DEFINER helper (inner reads
bypass RLS) rather than inline a `FROM`/`JOIN` over a different RLS table. After this change
`students` carries ZERO inline cross-table edges, and the grandfather ledger drains for the
FIRST time (242 → 241).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-216 | `rls_students_school_admin_helper_delegation` (within `rls-no-cross-table-recursion.test.ts`) | P8: the apex `students` policy `"School admins can view school students"` no longer inlines `FROM school_admins` — its effective form (migration `20260702090000` supersedes the baseline via DROP+CREATE in the chain reduction) delegates to `public.is_school_admin_of_student(id)`, so the detector flags NO inline cross-table policy on `students` (`detectedRiskKeys()` filtered to `students::` === `[]`). The helper is added to the SECURITY DEFINER roster `H` (`RLS_HELPERS`, length 10 → 11) so a policy CALLING it is recognised as delegating. The grandfather key `students::School admins can view school students` is PRUNED from `GRANDFATHERED_INLINE_POLICIES` (FIRST ratchet-DOWN), and the count pins assert exactly **241** (`GRANDFATHERED_INLINE_POLICIES.size === 241` AND `detectedRiskKeys().length === 241`) — so `detected === allowlist` holds (no stale entry, no new violation). Boundary equivalence: the helper returns `EXISTS` over the SAME join the inline form used (student's `school_id` from `students` ⋈ `school_admins` on `school_id`, caller `auth.uid()` = `sa.auth_user_id`, `sa.is_active = true`) — identical school-scoping + is_active guard + NULL-school_id non-match → no over/under-grant. No recursion: SECURITY DEFINER inner reads of `students` + `school_admins` bypass RLS, so no `students → school_admins → students` cycle can form. Static SQL-text guard, no DB. | `src/__tests__/rls-no-cross-table-recursion.test.ts` + `supabase/migrations/20260702090000_xc3_p1_is_school_admin_of_student_helper.sql` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary) — REG-216 is the FIRST behavioral RLS change of XC-3. It proves the
  apex `students` table is fully helper-delegating (zero inline cross-table edges) and that
  the school-admin SELECT boundary is byte-for-byte the same visible-row set after the
  refactor (same tables, same school-scoping, same `is_active` guard). The SECURITY DEFINER
  helper's inner reads bypass RLS, so the refactor cannot introduce the TSB-4 recursion class
  it removes.
- Ledger ratchet (Phase 4 drain mechanic, exercised early in Phase 1) — the
  `GRANDFATHERED_INLINE_POLICIES` ledger must mirror live debt EXACTLY; pruning the students
  school-admin key in the same change that refactors the policy keeps `detected === allowlist`
  and forces the count DOWN (242 → 241). Re-introducing the old inline shape under this name
  would FAIL the guard (the key is absent from the ledger).

### Catalog total

XC-3 Phase 1 adds REG-216 (apex `students` `"School admins can view school students"` policy
refactored from inline `FROM school_admins` to the SECURITY DEFINER helper
`is_school_admin_of_student(id)`; exact boundary equivalence, no recursion, first grandfather
ledger drain 242 → 241, helper added to set `H`).
**Total catalog: 183 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-217 — XC-3 Phase 2 (batch 1): first student-own read route migrated admin → server, RLS now enforced at the request path (allowlist 273 → 272)

**Why.** XC-3 Phase 0b froze the RLS-bypassing service-role footprint at 273
`route.ts` files (REG-213) and forced it to ratchet DOWN only. Phase 2 begins
DRAINING that ledger by swapping student-own READ routes from the RLS-bypassing
admin client (`@/lib/supabase-admin`) onto the RLS-respecting server client
(`@/lib/supabase-server`), so RLS becomes a real second line of defense behind
`authorizeRequest()`. The risk is the INVERSE of the recent `students`-RLS
production incident: a swap turns a working 200 into an EMPTY/403 if the SELECT
policy does not admit exactly what the route reads. Batch 1 therefore migrates a
single route whose every read is PROVABLY policy-covered:
`src/app/api/student/daily-lab/route.ts`. It keeps `authorizeRequest`
(Bearer-or-cookie) for the auth gate + `studentId`; only the three data reads
move to the cookie-scoped server client (the sole caller, `DailyLabMission.tsx`,
fetches with `credentials: 'include'`). Response shape is byte-identical.

**RLS coverage proof (the gate that prevents a repeat of the dashboard incident).**

| Read | Filter | Admitting SELECT policy (baseline / migration) |
|---|---|---|
| `students` | `id = studentId` | `students_select_merged` — `auth_user_id = auth.uid()` (own row). Post `20260702080000` recursion fix: no `students → class_students → students` cycle. |
| `interactive_simulations` | `is_active = true` (+ grade/widget/quality) | `sim_read_all` — `USING (is_active = true)`, public active-catalog read. |
| `experiment_observations` | `student_id = studentId`, `created_at >= now-14d` | `students_read_own_observations` — `student_id = get_student_id_for_auth()` (migration `20260504195900`). |

`daily-plan` was PROVEN covered too (own `students` + `class_students`
own-enrollment + `classroom_lesson_plans` student-class policy + `topics_read_all`)
but DEFERRED to a later batch: it touches the exact `students`+`class_students`
tables from the recent incident (nested RLS), so it stays out of the FIRST
behavioral batch per the conservative one-incident-adjacent-route rule.
`subjects` and `chapters` were DEFERRED because their reads happen inside
SECURITY DEFINER RPCs (`get_available_subjects`, `available_chapters_for_student_subject_v2`)
that bypass RLS regardless of the client — swapping the client does NOT bring the
read under RLS, so they are out of scope for this defense-in-depth batch.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-217 | `GET /api/student/daily-lab — RLS contract (admin→server migration)` | P8/P9: with the RLS-scoped server client mocked, an authenticated OWNER receives their Daily Lab with the byte-identical response shape (`simulation_id/title/title_hi/subject/emoji/estimated_minutes/bonus_coins=50/completed_today/deeplink/experiment_id`); a request the SELECT policy does NOT admit (mocked `students` read returns no row — RLS deny for a cross-user/forged `studentId`) yields `400 { success:false, error:'Student profile incomplete' }` with NO simulation payload — i.e. the migration fails CLOSED. The admin-client allowlist guard pins the ledger ratchet 273 → 272 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/daily-lab.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — the route's three student-own/public reads now execute on
  the RLS-respecting `supabase-server` client; each is covered by an existing
  SELECT policy (table above), so RLS is a genuine second line of defense behind
  `authorizeRequest`, and a non-owner read fails closed.
- P9 (RBAC enforcement) — `authorizeRequest(request, 'stem.observe', { requireStudentId: true })`
  is unchanged; the permission gate and `studentId` resolution are untouched.
- Ledger ratchet (XC-3 Phase 0b mechanic) — `scripts/admin-client-allowlist.json`
  drains 273 → 272 in the same change that migrates the route, keeping
  `detected === allowlist` and forcing the admin-client count DOWN.

### Catalog total

XC-3 Phase 2 batch 1 adds REG-217 (first student-own read route migrated
admin → server with full per-table RLS-coverage proof; owner-gets-own-data +
cross-user-fails-closed contract; admin-client allowlist ratcheted 273 → 272).
**Total catalog: 184 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-218 — XC-3 Phase 2 (batch 2): student-own read route(s) migrated admin → server; allowlist 272 → 271

**Why.** Continues the Phase 2 ledger DRAIN started by REG-217: swap student-own
READ routes from the RLS-bypassing admin client (`@/lib/supabase-admin`) onto the
RLS-respecting server client (`@/lib/supabase-server`) so RLS becomes a real
second line of defense behind `authorizeRequest()`. The standing risk is the
dashboard-incident class: a swap turns a working 200 into EMPTY/403 if the SELECT
policy does not admit exactly what the route reads, OR if a NON-cookie (mobile
Bearer) caller exists — the server client is cookie-only (`createServerClient` +
`next/headers cookies()`; it never reads the `Authorization` header), so a Bearer
caller would NULL `auth.uid()` at the RLS layer and break. Batch 2 therefore
migrates ONLY routes that are BOTH provably policy-covered AND have no Bearer/mobile
caller. **Net this batch: 1 route migrated** —
`src/app/api/dashboard/reviews-due/route.ts`.

**Migrated: `GET /api/dashboard/reviews-due`** (spaced-repetition due-count CTA).
Single read; `authorizeRequest('progress.view_own', { requireStudentId: true })`
unchanged; response shape `{ success, data:{ dueCount, oldestDueDate, estimatedMinutes } }`
byte-identical. Caller transport verified COOKIE-only: the sole caller
`src/components/dashboard/ReviewsDueCard.tsx` fetches via same-origin SWR `fetch(url)`
(cookies auto-attached); the `mobile/` tree has ZERO `reviews-due` callers (mobile's
only REST callers are `/api/student/daily-plan`, `/api/student/subjects`, `/api/foxy`,
and the generated `/api/v2/*` client). Fail-CLOSED: an RLS deny (no own rows)
degrades the count to 0 — no other student's review state can leak; a query/transport
error maps to 500 with no payload.

**RLS coverage proof (the gate against a 200 → empty regression).**

| Read | Filter | Admitting SELECT policy (baseline) | Transport |
|---|---|---|---|
| `concept_mastery` | `student_id = studentId`, `next_review_date <= today`, `mastery_probability < 0.95`, `next_review_date >= academicYearStart` | `concept_mastery_own` — `USING (student_id = get_my_student_id())` (baseline `00000000000000`). `studentId` is `auth.studentId` from `authorizeRequest` (`SELECT id FROM students WHERE auth_user_id = authUserId`) — always the caller's OWN id, never arbitrary. For the active OWNER, `get_my_student_id()` (`SELECT id FROM students WHERE auth_user_id = auth.uid() AND is_active = true`) resolves the SAME id → result byte-identical to the admin-client version. | cookie (`ReviewsDueCard.tsx`); no mobile caller |

Equivalence note: `authorizeRequest.studentId` lacks the `is_active = true` filter
that `get_my_student_id()` carries — a (non-reachable-from-dashboard) INACTIVE
student would get a fail-CLOSED empty count rather than data, which matches every
other RLS-respecting learner-state read and never crosses students. Not a
200 → 403 regression for any active caller.

**Deferrals (proof-or-defer; every candidate under `src/app/api/{student,learner,pulse,dashboard}/**` enumerated):**

| Route | Reason deferred |
|---|---|
| `src/app/api/student/daily-plan/route.ts` | **Mobile Bearer caller exists.** `mobile/lib/data/repositories/daily_plan_repository.dart` calls `GET /api/student/daily-plan` with `Authorization: Bearer <jwt>` (auth interceptor, `api_client.dart:83`). The cookie-only server client would NULL `auth.uid()` at RLS → `students_select_merged` denies → 404 `student_not_found` for every mobile caller. RLS coverage IS provable (`students_select_merged` own + `class_students` "Students can view own enrollment" + `classroom_lesson_plans` "Students can view classroom lesson plans" + `curriculum_topics` `topics_read_all`), but the caller-transport check fails. DEFER until a Bearer-aware server client (or mobile cutover) lands. |
| `src/app/api/learner/next/route.ts` | NOT a read-route migration: its reads already run on `createSupabaseServerClient()`. The `supabase-admin` import is for the gated service-role WRITE-through (`scheduled_actions` upsert + RLS-locked event-bus publish). Legitimately stays on the ledger. |
| `src/app/api/pulse/me/route.ts` | Routes through the shared `buildSingleStudentPulse()` helper (`src/lib/pulse/pulse-server.ts`) that also backs the CROSS-ROLE pulse routes and is intentionally admin-after-RBAC-gate (REG-121 `canAccessStudent` design); broad multi-table read surface not provable as a single-route swap. DEFER. |
| `src/app/api/pulse/{class/[classId],school,student/[id]}/route.ts` | Cross-role lenses, not student-own; `canAccessStudent` boundary by design. Out of scope. |
| `src/app/api/student/subjects/route.ts`, `src/app/api/student/chapters/route.ts` | Reads happen inside SECURITY DEFINER RPCs (`get_available_subjects`, chapter resolver) that bypass RLS regardless of client — swap is a no-op for RLS. Out of scope (and `subjects` also has a mobile caller). |
| `src/app/api/student/{profile,preferences,scan-upload,shop/purchase,stem-observation,study-plan,exam-simulation,foxy-interaction}` | Not student-own read GETs (PATCH/POST writes or non-read handlers). Out of scope for this read-route batch. |

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-218 | `GET /api/dashboard/reviews-due — RLS contract (admin→server migration)` | P8/P9: with the RLS-scoped server client mocked, an authenticated OWNER receives the byte-identical `{ dueCount, oldestDueDate, estimatedMinutes }` shape (private cache header preserved); an RLS deny (mocked `concept_mastery` read returns no rows for a cross-user/forged `studentId`) degrades to `{ dueCount:0, oldestDueDate:null, estimatedMinutes:2 }` — fails CLOSED, no other student's review state leaks; a query/transport error maps to `500 { success:false }` with NO `data`. The allowlist guard pins the ledger ratchet 272 → 271 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/dashboard-reviews-due.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — `concept_mastery` read now executes on the RLS-respecting
  `supabase-server` client, covered by `concept_mastery_own`; a non-owner read
  fails closed (count 0).
- P9 (RBAC enforcement) — `authorizeRequest(request, 'progress.view_own', { requireStudentId: true })`
  is unchanged; permission gate + `studentId` resolution untouched.
- Ledger ratchet (XC-3 Phase 0b mechanic) — `scripts/admin-client-allowlist.json`
  drains 272 → 271 in the same change, keeping `detected === allowlist`.

### Catalog total

XC-3 Phase 2 batch 2 adds REG-218 (one student-own read route — `dashboard/reviews-due` —
migrated admin → server with per-table RLS-coverage proof + caller-transport check;
`daily-plan` DEFERRED on a confirmed mobile Bearer caller; admin-client allowlist
ratcheted 272 → 271).
**Total catalog: 185 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-219 — XC-3 Phase 2 enabler: Bearer-aware, RLS-respecting route client (unblocks mobile-called migrations)

**Why.** Phase 2 (REG-217/REG-218) drains student-own READ routes off the
RLS-bypassing service-role admin client onto the RLS-respecting cookie client
`createSupabaseServerClient()`. But that client is COOKIE-ONLY: it reads the
Supabase session from `next/headers cookies()` and never inspects the
`Authorization` header. The Flutter app calls many `student/*` routes with
`Authorization: Bearer <jwt>` and NO Supabase cookie (e.g. `/api/student/daily-plan`
via `mobile/lib/data/repositories/daily_plan_repository.dart`), so a cookie-only
swap NULLs `auth.uid()` at RLS → every SELECT policy denies → 404/empty for every
mobile caller. That is exactly why REG-218 DEFERRED `daily-plan`. This entry adds
the ENABLER — a Bearer-aware route client — so those routes can be migrated in a
later batch. **No route is migrated in this change; the allowlist is unchanged.**

**What.** New `src/lib/supabase-route.ts` exports
`createSupabaseRouteClient(request)`:
- **Bearer path** — when the request carries `Authorization: Bearer <jwt>`, builds
  a client with the PUBLIC anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and forwards
  the caller's OWN access token as `global.headers.Authorization`. PostgREST runs
  the query under the caller's identity, so `auth.uid()` resolves and RLS applies
  exactly as on the wire. RLS is ENFORCED, not bypassed — the anon key carries no
  privilege of its own.
- **Cookie path** — no Bearer → delegates verbatim to the existing
  `createSupabaseServerClient()` (anon key + session cookie). Also RLS-scoped.
- **Never service-role.** `SUPABASE_SERVICE_ROLE_KEY` is never read for transport;
  the only key passed to `createClient` is the anon key. A hard pre-build assertion
  throws (fail-closed, builds nothing) if the configured anon key were ever to
  equal the service-role key. The helper does not validate the JWT itself — an
  invalid/expired/forged token is rejected by Supabase Auth + PostgREST + RLS
  (`auth.uid()` stays NULL → deny), so the failure mode is fail-closed.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-219 | `createSupabaseRouteClient — Bearer-aware RLS route client` | P8/P9: (a) a request with `Authorization: Bearer X` builds a client whose `global.headers.Authorization` is `Bearer X` and whose transport key is the ANON key (asserted `!== SERVICE_ROLE_KEY`), with `persistSession/autoRefreshToken=false`, and the cookie delegate is NOT called — so RLS `auth.uid()` resolves under the caller's identity; case-insensitive header match pinned. (b) a request with NO Authorization header (or a non-Bearer scheme, or an empty Bearer token) delegates to `createSupabaseServerClient()` and never calls `createClient`. (c) the service-role key is NEVER passed to `createClient` on any Bearer call; a misconfiguration where the anon key equals the service-role key throws (fail-closed) and builds nothing. Libs mocked at the module boundary to inspect exact args. | `src/__tests__/lib/supabase-route-client.test.ts`, `src/lib/supabase-route.ts` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — the Bearer path is anon-key + caller-JWT, so RLS is the
  active boundary on both paths; the helper cannot return a service-role
  (RLS-bypassing) client (assertion-enforced).
- P9 (RBAC enforcement) — defense in depth: routes still call `authorizeRequest()`
  for RBAC; this client makes RLS a real second line for Bearer callers too.

### Catalog total

XC-3 Phase 2 enabler adds REG-219 (Bearer-aware RLS route client — forwards the
caller's Bearer JWT under the public anon key so RLS `auth.uid()` resolves for
mobile callers, cookie fallback for web, never service-role; no route migrated,
allowlist unchanged).
**Total catalog: 186 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-220 — XC-3 Phase 2 (batch 3 — Bearer batch): `daily-plan` migrated admin → Bearer-aware RLS route client; mobile Bearer caller now RLS-enforced (allowlist 271 → 270)

**Why.** REG-219 shipped the ENABLER (`createSupabaseRouteClient`) but migrated
no route. This batch consumes it: `GET /api/student/daily-plan` was DEFERRED by
REG-218 precisely because it has a mobile Bearer caller
(`mobile/lib/data/repositories/daily_plan_repository.dart` sends
`Authorization: Bearer <jwt>` and NO Supabase cookie), so a cookie-only
`createSupabaseServerClient()` swap would NULL `auth.uid()` at RLS → 404/empty
for every mobile caller. Swapping it onto the Bearer-aware client forwards the
caller's JWT under the public anon key (RLS enforced, never service-role) on the
Bearer path and falls back to the cookie client for web — so RLS becomes a real
second line of defense behind `authorizeRequest('study_plan.view')` on BOTH
transports. This is the first route to use the Bearer-aware client.

**What.** `src/app/api/student/daily-plan/route.ts` swaps its 3 reads from
`supabaseAdmin` (RLS-bypassing service role) to `createSupabaseRouteClient(request)`.
RLS-coverage PROVEN per read (`studentId` is ALWAYS `auth.studentId` — the caller's
own id; the route performs NO writes):
- **students** (`id = studentId`): `students_select_merged` owner branch
  (`auth_user_id = auth.uid()`).
- **class_students** (`student_id = studentId, is_active = true`): "Students can
  view own enrollment" (`student_id ∈ students WHERE auth_user_id = auth.uid()`).
- **classroom_lesson_plans** (`class_id = classId, date = today`): "Students can
  view classroom lesson plans" (`class_id ∈` the caller's own `class_students`
  rows) — `classId` is the caller's own class.
- **curriculum_topics** (embedded `curriculum_topics(id,title)`): `topics_read_all`
  (`USING true` — public catalog).

The `students`+`class_students` nested-read recursion incident is FIXED (migration
`20260702080000` + Phase 1). Caller transport: mobile = Bearer (now RLS-resolved
via the forwarded JWT); web dashboard `DailyPlanCard` = cookie (server-client
fallback). Fail-CLOSED: an RLS deny on the `students` read yields `student=null`
→ `404 { success:false, error:'student_not_found' }`, no plan payload, no 500.
Query set + response envelope (`{ success, data, flagEnabled, intercepted }`)
byte-identical; `authorizeRequest('study_plan.view',{requireStudentId:true})`
unchanged.

**Scan result.** Among mobile Bearer-called student-own reads, `daily-plan` is
the only clean simple-read GET migrated. DEFERRED: `student/subjects`
(RPC-internal — `get_available_subjects` + `ops_events` write), `student/profile`
& `student/preferences` (write routes — POST `students`/`smart_nudges` updates +
RPCs, web cookie), `/api/v2/*` (separate generated `/v2` contract). N = 1.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-220 | `GET /api/student/daily-plan — Bearer-aware RLS contract (admin→route-client migration)` | P8/P9: (a) the route builds its data client from the Bearer-aware `createSupabaseRouteClient`, called exactly once WITH the request (so the caller's `Authorization: Bearer` JWT is forwarded for RLS) — a regression back to `supabase-admin` OR the cookie-only `createSupabaseServerClient()` (which breaks the mobile Bearer caller) fails this. (b) an authenticated OWNER (flag ON, `board_topper`) receives the byte-identical envelope `{ success, data, flagEnabled, intercepted }` (4-item / 45-min plan). (c) an RLS deny on the `students` read (mocked no-row for a cross-user/forged `studentId`) fails CLOSED with `404 { success:false, error:'student_not_found' }` and NO `data` payload. Existing flag-OFF/ON, classroom-sync, 404, and P13 PII-redaction cases re-pointed to the mocked Bearer-aware client. The allowlist guard pins the ledger ratchet 271 → 270 (route pruned from `scripts/admin-client-allowlist.json`, `count` + `EXPECTED_COUNT` decremented; `detected === allowlist`). | `src/__tests__/api/student/daily-plan.test.ts`, `src/__tests__/api-admin-client-allowlist.test.ts`, `scripts/admin-client-allowlist.json` | E | P8, P9 |

### Invariants covered by this section

- P8 (RLS boundary) — the route's reads now run under the caller's identity
  (Bearer JWT or cookie) with RLS enforced; the RLS-bypassing service-role client
  is removed from this path.
- P9 (RBAC enforcement) — defense in depth: `authorizeRequest('study_plan.view')`
  unchanged; RLS is now a real second line for Bearer (mobile) callers too.

### Catalog total

XC-3 Phase 2 batch 3 adds REG-220 (one route — `student/daily-plan` — migrated
admin → Bearer-aware `createSupabaseRouteClient` with per-table RLS-coverage proof,
owner byte-identical + RLS-deny fail-closed + Bearer-aware-client assertion;
mobile Bearer caller now RLS-enforced; admin-client allowlist ratcheted 271 → 270).
**Total catalog: 187 entries (target: 35 — TARGET EXCEEDED).**

---

## Feature-flag RCA repair — "enabled ⇒ effective", app-code column contract, list completeness (2026-07-20) — REG-281..REG-283

Source: feature-flag RCA (branch `Alfanumrik/feature-flags-rca-repair-99efe1`).
Root causes repaired and pinned here:

1. **The 0-rollout landmine.** `feature_flags.rollout_percentage` has a DB
   DEFAULT of 0 and the web evaluator (`packages/lib/src/feature-flags.ts`)
   returns FALSE for `rollout_percentage=0` even when `is_enabled=true`. New
   flags created via the super-admin route inherited the default, and
   toggling a 0%-flag "on" silently kept it OFF for every user — an operator
   saw "enabled" in the UI while production behavior never changed.
2. **App-code column drift (the REG-125 gap).** REG-125 pinned the SEED
   (migration SQL) shape only. App code had the same failure mode live: the
   internal admin route ordered by the nonexistent `name` column (GET 500'd
   for every caller) and the `identity` Edge Function selected the
   nonexistent `target_plans` column, which nulled the whole flags query so
   EVERY user resolved with ALL flags OFF. The identity function also used
   an ad-hoc rollout hash that disagreed with the canonical
   `hashForRollout`, so web and mobile disagreed on N%-rollout membership.
3. **Silent list truncation.** The super-admin GET hard-coded `limit=100`
   while the table holds ~180 rows — flags past the first page were
   invisible in the admin UI, indistinguishable from not existing.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-281 | `feature_flag_enabled_implies_effective_rollout_promotion` | The super-admin feature-flags route can never produce an "enabled but 0%-rollout" dead flag by accident. POST: every insert writes `rollout_percentage` explicitly (validated caller value — including an explicit 0 — else 100), so a new flag never inherits the DB DEFAULT 0. PATCH promotion matrix: enable with previous rollout 0 and no explicit rollout in the body → the route promotes `rollout_percentage` to 100 in the same write; enable with a non-zero previous rollout (deliberate ramp, e.g. 10%) → rollout NOT touched; an explicit `rollout_percentage` in the body (including 0) always wins and suppresses promotion; disable / non-enable updates never promote; unreadable or missing previous state → no promotion. Rollout MEMBERSHIP parity: the identity Edge Function's duplicated Deno `hashForRollout` produces byte-identical buckets (0..99) to the canonical `packages/lib/src/feature-flags.ts` export across a uuid × flag matrix, and the identity source is pinned to the three load-bearing expressions of the canonical algorithm (`` `${userId}:${flagName}` `` seed, `((hash << 5) - hash + str.charCodeAt(i)) \| 0` accumulator, `Math.abs(hash) % 100` bucket) plus its application `hashForRollout(student.id, flag.flag_name) < flag.rollout_percentage` — the pre-repair ad-hoc hash (web/mobile rollout disagreement) cannot silently return. Route flag-name regex `/^[a-z][a-z0-9_]*$/` pinned at the POST/PATCH boundary: real versioned names with digits (`ff_school_pulse_v1`, `ff_foxy_math_format_v2`) accepted; leading digit / uppercase / hyphen / empty → 400 with no DB write and no audit row. | `src/__tests__/api/super-admin/feature-flags-rollout-promotion.test.ts` (promotion matrix + POST + regex), `src/__tests__/lib/feature-flags-rollout-hash-parity.test.ts` (hash parity + identity source pin), `src/__tests__/validation.test.ts` (`featureFlagSchema` regex cases) | E | Operational integrity (flag flips must take effect), P9-adjacent (super_admin-gated mutations — level gate itself pinned by the sibling mutation-gate suite) |
| REG-282 | `feature_flags_app_code_column_contract` | Static-source canary closing the REG-125 gap for APP CODE: every column list used against `feature_flags` in the three call sites — `src/app/api/internal/admin/feature-flags/route.ts` (supabase-js `.select`/`.insert` keys/`.order` targets/PATCH `ALLOWED` allow-list), `supabase/functions/identity/index.ts` (`.from('feature_flags').select(...)`), and `src/app/api/super-admin/feature-flags/route.ts` (PostgREST-URL `select=` tokens + the GET `fields` const) — must be a member of the known live column set {id, flag_name, is_enabled, rollout_percentage, target_grades, description, updated_by, created_at, updated_at, target_institutions, target_roles, target_environments, wave, target_subjects, target_languages, launch_date, metadata}. Specific pre-repair bugs pinned individually: the internal route orders by `flag_name` and never by the nonexistent `name`; its insert carries `flag_name` + explicit `rollout_percentage` and never a `name` key; the identity select includes `flag_name` + `rollout_percentage` and `target_plans` can never come back (the column whose selection nulled the flags query and turned every flag OFF for every user). Extraction is regex-over-source (chain-scoped to `.from('feature_flags')` segments), deterministic, non-vacuous-guarded (minimum column counts), no DB, no network. If a migration adds a feature_flags column, extend the set in the same PR. | `src/__tests__/regressions/feature-flags-app-code-column-contract.test.ts` | E | Operational integrity (42703-class outages become PR-CI failures, not production walls), REG-125 companion (seed shape + app-code shape now both pinned) |
| REG-283 | `admin_flags_list_completeness_no_silent_truncation` | The super-admin feature-flags GET uses query-param pagination instead of a hard cap: default `limit=500` (returns the entire ~180-row table) with `offset=0`; caller-supplied `limit` clamped to 1..1000 (`?limit=5000` → 1000, `?limit=0` → 1); non-numeric limit falls back to 500; `offset` honoured, negative offset falls back to 0; and the pre-repair hard-coded `limit=100` (which silently hid every flag past the first 100 from the admin UI — an invisible flag is indistinguishable from a nonexistent one) is pinned gone from the default request. | `src/__tests__/api/super-admin/feature-flags-rollout-promotion.test.ts` (GET pagination describe) | E | Operational integrity (admin console must show the complete flag inventory), P9-adjacent (GET stays at the `support` level per the sibling mutation-gate pins) |

### Invariants covered by this section

- Operational integrity — a flag an operator enables actually takes effect
  ("enabled ⇒ effective"); a schema/column typo in app code is a PR-CI
  failure, not a silent all-flags-OFF production outage; the admin console
  shows the complete flag inventory.
- Cross-surface consistency — web (`packages/lib`) and mobile (`identity`
  Edge Function) agree on per-user N%-rollout membership via the pinned
  canonical hash.
- P9-adjacent — the level gates on this route are pinned by the sibling
  `feature-flags-mutation-gate` suite; these entries pin the payload/effect
  contracts behind those gates.

### Catalog total

Feature-flag RCA repair adds REG-281 ("enabled ⇒ effective" rollout
promotion + rollout-hash parity + flag-name regex), REG-282 (app-code
feature_flags column contract — the REG-125 companion), REG-283 (admin
flags list completeness — no silent truncation).
**Total catalog: 250 entries (target: 35 — TARGET EXCEEDED).**

---
