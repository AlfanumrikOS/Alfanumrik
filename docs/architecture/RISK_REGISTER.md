# Risk register (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**Method:** risks identified during Phase 1 damage audit
(see [`../stabilization-phase-0-memo.md`](../stabilization-phase-0-memo.md))
plus review of current architecture.

Every entry has: **probability**, **impact**, **evidence**
(file / line / migration / commit), **owner**, **mitigation status**,
**next action**. Generic prose is avoided — if a risk cannot be
pinned to concrete artefacts, it is not in this register.

## Rating scale

- **Probability:** Low (< 10 % in next 90 days) / Med (10-40 %) / High (> 40 %)
- **Impact:** Low (degraded UX) / Med (major feature broken, payment-hold-safe) / High (P-invariant violation, user data loss, revenue loss) / Critical (onboarding broken, payment integrity broken, data breach)

## Open risks

### R1. Pre-existing P10 bundle-budget breach

- **Probability:** N/A — already happening (verified 2026-04-24)
- **Impact:** Med — slow page load on Indian 4G (2-5 Mbps), degraded student UX
- **Evidence:** [`scripts/check-bundle-size.mjs`](../../scripts/check-bundle-size.mjs) reported on this branch: shared JS 168.1 kB (cap 160 kB, **+8.1 kB**); `/foxy` page 331.7 kB (cap 260 kB, **+71.7 kB**); middleware 110.1 kB (under cap). Middleware is fine; shared + page are not. Pre-Option C state was a false-green because the previous `wc -c` check on the Turbopack middleware stub was meaningless.
- **Root cause (hypothesis, not verified):** `/foxy` bundles the cognitive-engine + exam-engine + feedback-engine client-side when it should lazy-load them. Shared JS likely includes Claude SDK types it doesn't need at runtime.
- **Owner:** frontend, quality
- **Mitigation status:** detection in place (this branch, commit `bb3edde`); fix not yet implemented
- **Next action:** dedicated branch `fix/bundle-size-foxy-breach` — dynamic-import the heavy Foxy panels; audit the `vendors-*.js` bundle for unused exports

### R2. 8 pre-existing Foxy regression test failures

- **Probability:** N/A — failing
- **Impact:** Med — regression-catalog claim "35/35 (100%)" in `.claude/CLAUDE.md` is inaccurate until fixed; risk of real regressions slipping through
- **Evidence:**
  - `src/__tests__/adaptive-layer-health.test.ts` — 5 failures (Foxy route wiring: Voyage embeddings, cognitive context system prompt, CBSE scope, off-topic redirect, Hindi/English bilingual)
  - `src/__tests__/regression-academic-chain.test.ts` — 2 failures (Regression #3: `/api/foxy` not calling `match_rag_chunks_ncert`; Regression #4: `/api/student/chapters` soft-fail fallback to legacy table)
  - `src/__tests__/subject-endpoint-validation.test.ts` — 1 failure (`POST /api/foxy` returns 503 instead of 422 for disallowed subject)
- **Owner:** ai-engineer (Foxy route correctness), testing (regression catalog)
- **Mitigation status:** none — pre-existing on `main`, tracked only
- **Next action:** dedicated branch `fix/foxy-regression-tests`; likely small fixes in `/api/foxy/route.ts` routing of disallowed subjects, reinstating `match_rag_chunks_ncert` call, dropping soft-fail fallback in `/api/student/chapters`

### R3. Payment routes do not call `authorizeRequest()`

- **Probability:** N/A — structural gap on main
- **Impact:** Med — P9 says RBAC is server-side enforced via `authorizeRequest()`; payment routes use session auth only (`getAuthedUserFromRequest`) which proves the caller is *a* user, not that they have a permission
- **Evidence:** verified by Phase 1 backend-agent audit. Affected files: all under [`src/app/api/payments/`](../../src/app/api/payments/). Today no user can start a subscription for another user (routes hard-code `user.id` from session into writes), so the practical risk is low — but the P9 gap is real and would become more dangerous once admin-initiated subscriptions are a feature
- **Owner:** architect (define permissions), backend (implement calls)
- **Mitigation status:** accepted; not a regression introduced by this branch
- **Next action:** not urgent. Add `payment.manage` permission definitions in an RBAC migration; call from routes. Track as tech debt.

### R4. `/api/payments/status` throws 500 for free-tier users

- **Probability:** High — any free-tier user hitting the status endpoint
- **Impact:** Low — degraded UX only (status defaults to free elsewhere)
- **Evidence:** [`src/app/api/payments/status/route.ts:46-55`](../../src/app/api/payments/status/route.ts) (on main) uses `.single()` which throws PostgREST error when no row exists. Caught by route's own catch → returns 500 "Failed to fetch status" rather than the free-tier fallback defined at lines 31-42
- **Owner:** backend
- **Mitigation status:** none — pre-existing on main, reverted from this branch (the abandoned branch had touched this route, but not fixed it)
- **Next action:** one-line fix: `.single()` → `.maybeSingle()`. Low-priority but very high ROI.

### R5. `atomic_subscription_activation` RPC exists but is not wired

- **Probability:** Low — only matters if `activate_subscription` primary RPC starts failing
- **Impact:** Med — webhook's two-statement fallback can still split-brain until route is updated
- **Evidence:** new migration [`supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql`](../../supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql) adds the RPC (commit `8d9bd62`); `src/app/api/payments/webhook/route.ts` still uses the two-statement fallback
- **Owner:** backend
- **Mitigation status:** RPC available; route update deferred
- **Next action:** follow-up branch to swap the fallback; behind a feature flag. Requires P14 chain review (backend, architect, testing, mobile).

### R6. Foxy Edge Function / `/api/foxy` split-brain

- **Probability:** High (permanent until deprecation)
- **Impact:** Low today — two contracts remain in sync; risk grows if either drifts further
- **Evidence:** [`supabase/functions/foxy-tutor/index.ts`](../../supabase/functions/foxy-tutor/index.ts) last touched 2026-04-18 (commit `8e51fd8`). [`src/app/api/foxy/route.ts`](../../src/app/api/foxy/route.ts) has advanced significantly (grounded pipeline). Header comment at lines 583-587 acknowledges the drift is intentional until Phase 4 deletion lands
- **Owner:** ai-engineer + mobile
- **Mitigation status:** contracts currently aligned; documented drift
- **Next action:** migrate mobile to `/api/foxy`; then delete `foxy-tutor` Edge Function. Estimated 1 mobile release cycle.

### R7. Zombie circuit breaker in `/api/foxy/route.ts`

- **Probability:** N/A — dead code, not dangerous
- **Impact:** Low — 38 lines of never-called code that will confuse future readers; ESLint `no-unused-vars` warning
- **Evidence:** [`src/app/api/foxy/route.ts:102-139`](../../src/app/api/foxy/route.ts) defines `circuitBreakerState`, `recordApiFailure`, `recordApiSuccess`, `shouldAttemptApiCall`, `TIMEOUT_MS` — grep confirms zero call sites. These were reintroduced by the merge-conflict resolution in commit `f5ce204` on the abandoned branch; the real circuit breaker lives in `supabase/functions/grounded-answer/circuit.ts`
- **Owner:** ai-engineer
- **Mitigation status:** none
- **Next action:** delete the 38 lines in a trivial PR. Can be rolled into the Foxy regression-test fix (R2).

### R8. Implicit DB triggers blur data ownership

- **Probability:** N/A — structural
- **Impact:** Med — makes cross-context flows hard to trace; changes to the trigger definitions can silently break consumers
- **Evidence:** [`supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql`](../../supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql) installs a trigger that fires a free-tier subscription on every new student row. Other migrations add similar cascade triggers. None are catalogued alongside the [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md)
- **Owner:** architect
- **Mitigation status:** none
- **Next action:** one-time audit → catalog triggers in [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md) as "implicit writers". Over time, replace triggers with explicit RPC calls or outbox events (E5).

### R9. Dynamic `SET search_path = public` on every postgres-owned SECDEF function

- **Probability:** N/A until a schema move is attempted
- **Impact:** Critical — any future move of `public.students/teachers/guardians/schools` breaks every SECURITY DEFINER function that touches them, silently
- **Evidence:** [`supabase/migrations/20260408000009_fix_search_path_on_secdef_functions.sql`](../../supabase/migrations/20260408000009_fix_search_path_on_secdef_functions.sql) is a 40-line `DO $$ ... LOOP ... ALTER FUNCTION ... END LOOP` that iterates over `pg_proc WHERE prosecdef = true AND pronamespace = 'public'::regnamespace AND proowner = 'postgres'::regrole`. There is no hard-coded function list — the set is discovered at runtime. Every postgres-owned SECDEF function in `public` is pinned to `search_path = public`. The exact count at migration time was not recorded; the live count grows as new SECDEF functions are added. The abandoned identity extraction attempted a 4-function hotfix and missed the rest.
- **Owner:** architect
- **Mitigation status:** preventive constraint — no active fix. Any proposal to rename or move `students` / `teachers` / `guardians` / `schools` must include a companion migration that either (a) re-runs the same DO-loop post-move, or (b) enumerates every affected function and sets a new `search_path` that includes the new schema.
- **Next action:** no action unless a schema move is proposed. See [`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md) — Phase 0 does not propose any such move.

### R10. RLS policies + SQL bodies reference `students` in ~53 migration files

- **Probability:** N/A until a schema move is attempted
- **Impact:** Critical — same class as R9; blast radius of a rename includes most role/access policies and cross-domain views
- **Evidence:** grep-confirmed as of 2026-04-24:
  - **5 migration files** fully-qualify `FROM public.students` in RLS policy predicates or view definitions. Examples:
    - [`supabase/migrations/20260408000002_foxy_sessions_and_messages.sql`](../../supabase/migrations/20260408000002_foxy_sessions_and_messages.sql) (lines 35, 44, 56, 73, 126, 138, 155)
    - [`supabase/migrations/20260417700000_fix_student_id_rls_policies.sql`](../../supabase/migrations/20260417700000_fix_student_id_rls_policies.sql) (lines 65, 78, 84, 121, 142, 155, 161, 181)
  - **48 additional migration files** reference unqualified `FROM students` that resolves via session-role `search_path`. Fragile — `ALTER ROLE ... SET search_path` does not propagate into SECDEF function bodies (see R9), so the same text means different things in different execution contexts.
  - Similar blast radius exists for `teachers`, `guardians`, and `schools` (not re-grepped per table — assumed comparable).
- **Owner:** architect
- **Mitigation status:** preventive constraint (see R9)
- **Next action:** none unless schema move is proposed. If one is, it must produce a companion migration that rewrites all ~53 files' references in a single transaction.

### R11. Two untracked SQL files physically preserved outside git

- **Probability:** N/A — artefacts, not risks to prod
- **Impact:** Low — if the laptop dies, the files vanish
- **Evidence:** `.claude/quarantine/20260424-option-c/20260322000000_core_schema.sql` (rogue, should stay dead) and `.claude/quarantine/20260424-option-c/20260423151533_fix_identity_bootstrap_function_search_path.sql` (hotfix for extraction that was dropped)
- **Owner:** ops
- **Mitigation status:** physical preservation + gitignored
- **Next action:** 30 days grace; then `rm -rf .claude/quarantine/` if no need arises

### R12. Quarantine git tag exists alongside main

- **Probability:** N/A — teammate-confusion risk
- **Impact:** Low — a teammate could `git checkout quarantine/feat-performance-score-system-pre-option-c-20260424` and mistake it for current work
- **Evidence:** tag exists locally; not yet pushed
- **Owner:** architect
- **Mitigation status:** documented in [`../stabilization-phase-0-memo.md`](../stabilization-phase-0-memo.md)
- **Next action:** if we push this branch, push the tag alongside with an explanatory commit message OR keep it local-only. 30 days grace; then `git tag -d` if unused.

### R13. Schema migration drift from prod (inferred from CLAUDE.md) — **RESOLVED 2026-05-03**

- **Probability:** N/A — closed
- **Impact:** N/A — closed
- **Evidence:** `.claude/CLAUDE.md` previously claimed 265 migrations against a real on-disk count of ~309. The schema-reproducibility workstream (2026-05-02 → 2026-05-03) collapsed the historical chain into a single `00000000000000_baseline_from_prod.sql` derived from `pg_dump`, archived 349 legacy timestamped files under `supabase/migrations/_legacy/timestamped/`, and pre-marked the baseline applied on prod and main-staging via `supabase migration repair`. The constitution's `Database` row in `.claude/CLAUDE.md` and the layer diagram in `docs/architecture/current-state.md` were updated in the same workstream to cite "1 baseline + post-baseline" rather than a stale absolute count. See [`docs/runbooks/2026-05-03-schema-reproducibility-completion.md`](../runbooks/2026-05-03-schema-reproducibility-completion.md) for the completion log and [`docs/runbooks/schema-reproducibility-fix.md`](../runbooks/schema-reproducibility-fix.md) for the operational procedure.
- **Owner:** ops (docs), architect (migration mechanics)
- **Mitigation status:** **CLOSED** — baseline landed on `main`, archived chain skipped on every deploy because Supabase CLI's `db push` only walks the immediate `supabase/migrations/` root.
- **Next action:** none. Future drift between docs and on-disk migration count is structurally prevented because the documented number ("1 baseline + post-baseline") no longer needs reconciliation when new migrations are added.

### R14. Regression-catalog count claim drifts from reality

- **Probability:** N/A — documentation accuracy gap
- **Impact:** Low — but erodes trust in catalog over time
- **Evidence:** Constitution previously claimed "35/35 (100%)". Real catalog count at last reconciliation (2026-05-02) is **26 entries** in `.claude/regression-catalog.md` against an aspirational target of 35. The 35 figure is the *target*, not the current state. The constitution's `Testing` row + per-invariant status table now cite the actual 26-entry count and label 35 as aspirational. Newly added: REG-55 (Foxy structured rendering envelope, 2026-05-02).
- **Owner:** testing
- **Mitigation status:** count claim corrected; aspirational target preserved as a forward-looking goal
- **Next action:** continue promoting tested-only invariants (P7 bilingual UI, P10 bundle budget, P15 onboarding integrity) into catalogued entries to close the 9-entry gap to the aspirational target.

### R15. No server-side enforcement of domain module boundaries

- **Probability:** Med — next agent to edit could regress
- **Impact:** Med — a cross-domain direct DB write is easy to introduce today
- **Evidence:** `src/lib/domains/` exists but there is no lint rule preventing `import { supabaseAdmin }` from, e.g., a quiz component
- **Owner:** architect + quality
- **Mitigation status:** partially — `.claude/hooks/guard.sh` blocks known violations by path
- **Next action:** Phase 0 task — ESLint `no-restricted-imports` rule for domain module discipline

### R16. Sentry cost creep if `tracesSampleRate` ever bumped

- **Probability:** Low — discouraged in code comments
- **Impact:** High if it happens — 10× prod billing spike and free-tier exhaustion
- **Evidence:** commit `4da904f` explicitly holds `tracesSampleRate = 0.1` in prod and adds a comment warning against bumping it; the abandoned branch attempted `tracesSampleRate = 1.0` for all 3 configs
- **Owner:** ops
- **Mitigation status:** comment + PR discipline
- **Next action:** consider adding an ESLint rule or pre-commit check for the literal `1.0` in sentry configs

## Closed risks (resolved by this branch)

| # | What | How |
|---|---|---|
| C1 | 38 MB of committed Playwright test-results | `.gitignore` hardened in commit `00a9d6c`; files never made it onto this branch because we started from main |
| C2 | Bundle-budget check was false-green on Turbopack | Turbopack-compatible checker landed in commit `bb3edde` |
| C3 | Sentry edge/server had no `ignoreErrors` or `beforeSend` | Parity added in commit `4da904f` |
| C4 | `/api/cron/school-operations` was not scheduled | Scheduled nightly 02:00 UTC in commit `840f49f` |
| C5 | Migration tests failed loudly without Supabase env | `hasSupabaseIntegrationEnv()` guard in commit `e159c3f` |
| C6 | `npm run check:bundle-size` referenced a missing file | Fixed in commit `bb3edde` |
| C7 | School admin tiles lacked entry points for api-keys / audit-log / billing | Added in commit `7e68900` |
| C8 | `school-context` AI prompt not re-exported | Added to barrel in commit `134d946` |
| C9 | P11 split-brain had no atomic fallback RPC | `atomic_subscription_activation` added in commit `8d9bd62` (not yet wired — R5) |
| C10 | Identity schema extraction with 17+ latent breaks | Abandoned via Option C; preserved at quarantine tag |
| C11 | 8 generic architecture essays at repo root | Replaced by this evidence-based set |

## Change log

- **2026-04-24 v1** — initial set of 16 open + 11 closed risks. All
  open risks are either (a) pre-existing on main and tracked for
  follow-up, (b) preventive constraints without active mitigation
  need, or (c) documentation gaps. None are blockers for pushing
  this branch.
