# CI Reference

What runs on a pull request, which secrets CI needs, how to reproduce each check locally, and how to
diagnose the failures that actually happen. Everything below is derived from the workflow files in
`.github/workflows/` and root `package.json` — if this doc and a workflow disagree, the workflow wins.

Main workflow: `.github/workflows/ci.yml` (`name: CI — Alfanumrik`). Triggers: `push` to
`main`/`master`/`develop`, `pull_request` to `main`/`master` (types `opened, synchronize, reopened, labeled`),
`merge_group` (the merge queue), and `workflow_dispatch`. Concurrency group `ci-${{ github.ref }}`, with
`cancel-in-progress` disabled on `main` and on `merge_group` so neither a deploy polling a specific SHA nor a
queue entry awaiting its checks is ever stranded by a supersede.

## 0. The two tiers (2026-08-19)

`ci.yml` is one workflow running at two tiers. **No check was deleted; several were relocated.**

| Tier | Event | Jobs | Measured wall clock |
|---|---|---|---|
| **PR tier** | `pull_request` | Secret Scanning, Selected-School RPC, Protected Flag Migration Guard, Foxy North-Star Alignment, MOL Matrix Drift Check, Lint & Type-check, **Unit Tests (changed)**, CI Gate | ~2.5–3 min (was 5m24s–7m08s) |
| **Merge-queue tier** | `merge_group` | everything above except `Unit Tests (changed)`, **plus** the 4 unit shards + `Lint, Type-check & Test` (coverage thresholds), Production Build, Edge Function Deno Tests, Integration Tests (live DB), E2E Critical Paths, CI Gate | ~6–7 min, off the author's critical path |
| **Post-merge** | `push` to `main` | same as merge-queue tier minus E2E Critical Paths | unchanged — this is the run `deploy-production.yml` polls for `CI Gate` |

Two rules keep this honest:

1. `ci-gate` classifies **every** job per event as either `required` (must be `success`) or an **expected skip**
   (must be exactly `skipped`). A relocated job that unexpectedly runs, is renamed, or goes missing fails the
   gate loudly. Nothing is silently unchecked.
2. `Unit Tests (changed)` is `vitest --changed <merge-base>`. It is a **subset**, not a substitute — a test
   reached only via a dynamic import is not selected, and coverage thresholds are deliberately not enforced on
   a partial run. The full suite and the thresholds run in the merge queue before the commit can land.

**The merge queue is load-bearing, and its absence fails OPEN — not closed.** `Lint, Type-check & Test` and
`Production Build` are ruleset-required but no longer report on the `pull_request` event: they are *skipped*, and
**GitHub counts a skipped required check as satisfied.** This was observed directly on PR #1572, the change that
introduced this section — with the full suite and the production build both skipped, the PR read **"Ready to
merge"**, green, with no build and no full test run behind it.

The consequence is the opposite of the usual failure mode, and worse:

- With the queue **ON**, the heavy tier runs in the queue and genuinely gates the merge. Correct.
- With the queue **OFF**, PRs merge with those contexts vacuously green. Nothing blocks. Nothing warns.

So "Require merge queue" is not a convenience setting here — it is the only thing standing between a PR and an
unvalidated merge to `main`. It must be enabled immediately after this workflow change lands, and it must never
be disabled without reverting the workflow change in the same action. There is no safe intermediate state, and
the unsafe state is silent.

---

## 1. What CI checks

### Jobs in `ci.yml` (14)

| Job (`name:`) | What it enforces | Blocking? |
|---|---|---|
| **Secret Scanning** | Gitleaks scan (blocking); an advisory regex pass for leaked key shapes (`exit 0` by design); migration safety — every non-`_legacy` migration containing `CREATE TABLE` must also `ENABLE ROW LEVEL SECURITY` (P8) | Yes — **ruleset-required** |
| **Selected-School RPC Migration Integration (local PG17)** | Applies `20260711230713_v3_school_admin_students_selected_scope.sql` to an explicit current-schema fixture on a local PG17 stack; asserts SECURITY DEFINER/`search_path`, EXECUTE grants, legacy-overload retention, the `school_seat:` advisory lock, and cross-school 403/404 fail-closed behavior. Heavy steps are step-level gated on a 4-file diff filter | Yes — via CI Gate |
| **Protected Flag Migration Guard** | A changed migration that enables a flag listed in `packages/lib/src/flags/protected-flags.ts` must carry a `-- CEO-APPROVED-FLAG-FLIP: <flag>` marker (`scripts/check-protected-flag-migrations.mjs`) | Yes — via CI Gate |
| **Foxy North-Star Alignment** | `npm run foxy:analyze` — 10 read-only conformance checks against `docs/trackers/foxy-north-star/tracker.json` and the real tree | Yes — via CI Gate |
| **MOL Matrix Drift Check** | `npm run gen:mol-matrix:check` — the generated Deno `BASE_MATRIX` must match the TS gateway registry | Yes — via CI Gate |
| **Lint & Type-check** (`quality`) | Root `vercel.json` drift guard; AI retry-parity gate; `npm audit` (production criticals blocking, dev-only criticals loud-warn, anti-vacuity floors); dependency license check; `npm run lint`; `npm run type-check`; **Auth & Identity test gate** (P15, fails on 0 passing tests); `type-check:scripts`; `check:script-paths`; Edge Function log PII guard (P13); `withRoute()` adoption ratchet | Yes — via `Lint, Type-check & Test` + CI Gate |
| **Unit Tests (shard N/4)** | Vitest sharded 4× by test file, each emitting a blob report + raw V8 coverage | Yes — via fan-in |
| **Lint, Type-check & Test** (`unit-tests-merge`) | Runs `if: always()` and re-asserts that `quality` + all 4 shards are `success`; merges blob reports and enforces `vitest.config.ts` coverage thresholds against combined coverage | Yes — **ruleset-required** |
| **Edge Function Deno Tests** | Deterministic offline `deno test` over the `DENO_TEST_TARGETS` list, `--allow-read --allow-env` only (no `--allow-net`, so no test can reach the network) | Yes — via CI Gate |
| **Integration Tests (live DB)** | Migration / trigger / view / CHECK-constraint tests against live staging Supabase (`continue-on-error: false`). Missing secrets are a hard `::error::` + exit 1, not a soft skip | Yes — via CI Gate (job skipped on fork PRs / dispatch) |
| **Production Build** | `npm run build`; largest-single-shared-chunk gate vs `SHARED_JS_LIMIT_KB`; authoritative gzipped per-page/shared/middleware P10 gate via `npm run check:bundle-size` (ratchet against `scripts/bundle-baseline.json`); uploads the `nextjs-build` artifact | Yes — **ruleset-required** |
| **E2E Tests** (`e2e`) | Calls the reusable `e2e-suite.yml` with `advisory: true`. Opt-in per PR via the `e2e-full` label; same-repo only. Check context appears as `E2E Tests / E2E Suite` | No — advisory, deliberately **out** of the CI Gate needs list |
| **E2E Critical Paths (blocking)** | `npx playwright test e2e/quiz-happy-path.spec.ts e2e/payment-checkout.spec.ts` against an in-job server (`BASE_URL` deliberately unset), pinning REG-45 (quiz) and REG-46 (payment) | Yes — via CI Gate, on same-repo PRs targeting `main`/`master`/`staging` |
| **CI Gate** (`ci-gate`) | `if: always()`; aggregates the 12 jobs above (all except `e2e` and itself). Per-event matrix: every needed job must be `success`, or **exactly** `skipped` where legitimately unscheduled | Blocking for deploys, **not** for merge — see below |

### Separate workflows that also run on PRs

| Workflow | Uniquely covers |
|---|---|
| `migration-lint.yml` (`Lint migrations`) | SELECT-1 no-op placeholder bodies in `supabase/migrations/**` (`npm run lint:migrations`). No `paths:` filter — always runs |
| `openapi-contract.yml` | OpenAPI drift: regenerates `openapi/v2.json` from the Zod contract and fails if the committed artifact is stale. Paths-filtered to the contract source, generator, artifact and codegen config |
| `peer-deps-guard.yml` (`peer-deps + cold-boot`) | Clean-install peer-dependency resolution: `rm -rf node_modules` → `npm ci` → `check-peer-deps.js` → `node -e "require('./next.config.js')"` — mirrors a cold Vercel boot |
| `codeql-analysis.yml` (`CodeQL Analysis`) | Static taint analysis (`javascript-typescript`, `build-mode: none`) |
| `mobile-ci.yml` | Flutter: regenerate the `/v2` Dart client via `build_runner`, then `flutter analyze` + `test` + `build`. Paths-filtered to `mobile/**` and `openapi/v2.json` |
| `rag-eval.yml` | RAG gold-set retrieval regression eval. Paths-filtered to the retrieval/eval surfaces, plus nightly at 22:00 UTC. `continue-on-error: true` (advisory) |
| `e2e-suite.yml` / `e2e-nightly.yml` | Reusable full ~342-test Playwright suite; nightly against `main` at 21:30 UTC in blocking (`advisory: false`) mode |

**An audit of these workflows found none of them duplicate a check in `ci.yml`.** Each covers a surface
`ci.yml` does not: SQL placeholder bodies, contract artifact drift, cold-install dependency resolution,
static taint analysis, the Flutter app, RAG retrieval quality, and the full E2E suite.

### Merge gating: what is actually required

The live `main-protection` ruleset (id 20528052) requires **exactly four** status contexts:

1. `Secret Scanning`
2. `Lint, Type-check & Test`
3. `Production Build`
4. `CodeQL Analysis`

**`CI Gate` is NOT ruleset-required.** It aggregates 12 jobs and is polled fail-closed by
`deploy-production.yml` and `deploy-staging.yml` before they deploy. The consequence is concrete: a PR can
merge with, say, `integration-tests` or `e2e-critical-paths` red, and that failure then surfaces later as a
**stranded deploy** rather than as a blocked PR.

> **Recommendation (repo-settings change, requires the CEO):** add `CI Gate` to the `main-protection`
> required-contexts list. This is a GitHub ruleset edit, not a workflow edit.
>
> **This became more important on 2026-08-19.** `E2E Critical Paths`, `Integration Tests (live DB)` and
> `Edge Function Deno Tests` now run in the merge queue rather than on the PR. They were never
> ruleset-required and still are not, so today a red one of them blocks nothing. Adding `CI Gate` to the
> required list is the single settings change that makes the merge-queue tier actually gate the merge.

### Names that must never be renamed

Deploy polling and pipeline alerting match these strings **byte-exactly**, including the U+2014 em dash in
`CI — Alfanumrik`. A rename fails open — the watcher silently stops matching.

- The four required contexts: `Secret Scanning`, `Lint, Type-check & Test`, `Production Build`, `CodeQL Analysis`
- `CI Gate`
- `CI — Alfanumrik` (workflow name)
- `E2E Nightly — Alfanumrik` (workflow name, watched by `pipeline-alert.yml`)

---

## 2. Required GitHub secrets

Names only. **Never print, paste, or reconstruct a secret value anywhere — including in a CI log, an issue,
or a doc.**

| Secret | Used by | What breaks if missing |
|---|---|---|
| `STAGING_SUPABASE_URL` | `integration-tests` (ci.yml), `e2e-suite.yml` | Hard fail: `::error::Trusted integration job requires STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY` + exit 1 |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | `integration-tests`, `e2e-suite.yml` | Same hard fail as above |
| `STAGING_SUPABASE_ANON_KEY` | `integration-tests`, `e2e-suite.yml` | Not in the presence check; integration tests run against staging with no anon key and fail at client boot |
| `VOYAGE_API_KEY` | `integration-tests` (RAG eval harness) | Harness degrades to FTS-only and emits an INCONCLUSIVE verdict. Does **not** fail the job |
| `TEST_STUDENT_EMAIL` | `e2e-critical-paths`, `e2e-suite.yml` | Real-auth branches stay behind `test.fixme()`; specs run mocked-only assertions. In `e2e-nightly` (advisory: false) an unprovisioned student reddens the run |
| `TEST_STUDENT_PASSWORD` | `e2e-critical-paths`, `e2e-suite.yml` | Same as above |
| `GITHUB_TOKEN` | `secret-scan` (gitleaks) | Auto-provided by Actions; nothing to configure |

### These are NOT secrets — they are safe CI placeholders

`ci.yml`'s top-level `env:` sets three deliberately fake values so the build and unit tests can boot without
touching a real project:

- `NEXT_PUBLIC_SUPABASE_URL` → a `placeholder.supabase.co` URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → a placeholder JWT-shaped string
- `SUPABASE_SERVICE_ROLE_KEY` → a **different** placeholder JWT-shaped string

The service-role placeholder must stay textually **different** from the anon placeholder: `env.ts`'s
`validateServerEnv()` anti-leak check trips if the two are equal, and the whole test run fails at boot.

**Fork PRs receive no secrets.** `integration-tests` and `e2e-critical-paths` are therefore **expected to be
SKIPPED** on fork PRs, and the CI Gate asserts they are *exactly* `skipped` (not merely non-failing) — so the
check is relocated, never dropped.

---

## 3. Local commands matching CI

Node **22** (`.nvmrc` = `22.23.2`; root `engines` = `>=22.0.0 <23.0.0`). Package manager is **npm** with
`package-lock.json` (`lockfileVersion: 3`); CI always installs via `npm ci` (frozen lockfile).

| CI check | Local command |
|---|---|
| Lint & Type-check → Lint | `npm run lint` |
| Lint & Type-check → Type check | `npm run type-check` |
| Lint & Type-check → Type check (scripts/) | `npm run type-check:scripts` |
| Lint & Type-check → npm script path canary | `npm run check:script-paths` |
| Lint & Type-check → withRoute() ratchet | `npm run check:route-wrapper-ratchet` |
| Unit Tests (4 shards) + coverage merge | `npm test` |
| Integration Tests (live DB) | `npm run test:integration` |
| Production Build | `npm run build` |
| First-load JS budget (P10) | `npm run check:bundle-size` |
| Lint migrations (`migration-lint.yml`) | `npm run lint:migrations` |
| OpenAPI drift (`openapi-contract.yml`) | `npm run gen:openapi:check` |
| MOL Matrix Drift Check | `npm run gen:mol-matrix:check` |
| Foxy North-Star Alignment | `npm run foxy:analyze` |
| E2E Critical Paths / E2E Suite | `npx playwright test` |

Notes:

- `npm run type-check` is `npm run type-check --workspaces --if-present`, so it does **not** cover the
  workspace-less repo-root `scripts/`. That is exactly why `npm run type-check:scripts`
  (`tsc -p tsconfig.scripts.json`) exists as a separate command and a separate CI step.
- `npm run lint` first runs `check:lint-coverage` (every workspace must actually declare a lint script),
  then fans out with `--workspaces --if-present`.
- CI runs the unit suite sharded (`--shard=N/4` with blob reports); locally, plain `npm test` runs the same
  tests unsharded. Coverage thresholds are enforced against the merged result in `Lint, Type-check & Test`.

---

## 4. Troubleshooting

**P10 bundle budget failure (`Production Build`)**
`npm run check:bundle-size` exit **1** = over cap or grown past the ratchet baseline. Exit **2** = a
**vacuous** measurement (zero routes, zero chunk refs, all-zero sizes, or a missing baseline) — CI treats
that as a failure too, on purpose, because a gate that measured nothing has not passed. Caps live in
`scripts/check-bundle-size.mjs` as `CAP_SHARED_KB` / `CAP_PAGE_KB` / `CAP_MIDDLEWARE_KB`; read them with
`grep -nE '^const CAP_' scripts/check-bundle-size.mjs` rather than quoting a remembered number. The shared
total sits close to `CAP_SHARED_KB = 289` — the previous raise (284 → 289, 2026-07-10) came from a CI
measurement of 286.6 kB on a branch with **no production-JS diff at all**, so framework/gzip drift alone can
redden this gate. **Raising a cap requires CEO approval and is not a valid way to make CI green.** Investigate
with `npm run analyze` first.

**`CI Gate` red but every job looks green**
The gate classifies each needed job per event: `required` (must be `success`) or `expectedSkips` (must be
*exactly* `skipped`). A job that reports `skipped` where the gate expected `success` — or `success` where it
expected `skipped` — fails the gate. Read the `EVENT MATRIX` comment inside the `ci-gate` job; the two
conditional jobs are `integration-tests` (required on push and same-repo PRs) and `e2e-critical-paths`
(required only on same-repo PRs).

**`CI Gate` blocked by CANCELLED upstreams only**
The gate prints `CI Gate blocked by CANCELLED upstream(s) only, no genuine failure: …`. This is usually a
supersede from a newer push, not a break. Confirm **both**: (1) the run-level conclusion reads `cancelled`,
not `failure`; (2) a newer CI run exists for the same branch, created moments before the cancellation. If
both hold, read the newer run. If either does not, it was a real cancellation (runner loss, job timeout,
manual cancel) and must be investigated. `Production Build` is the usual victim — its artifact upload lands
after several minutes of build work.

**A required check sits at "Expected" forever / the PR is unmergeable**
Someone renamed a job's `name:` away from a ruleset context string. The ruleset waits for a context that no
longer gets reported, and ruleset checks ignore admin bypass. Restore the exact previous name (see the
never-rename list in section 1). The same failure mode is why `migration-lint.yml` dropped its `paths:`
filter: a paths-filtered required check never reports on out-of-path PRs.

**`npm ci` fails**
The lockfile is out of sync with `package.json`. Run `npm install`, then commit the updated
`package-lock.json`. Do not "fix" it by switching CI to `npm install` — `npm ci` is the integrity check.

**Cache confusion**
CI caches `~/.npm` (npm's download cache) via `setup-node`'s built-in `cache: 'npm'` in
`.github/actions/setup-node-workspace`, and **always** runs `npm ci`. It no longer caches the `node_modules`
directory, and no longer skips installation on a cache hit — the old scheme could restore a corrupt tree
forever, because `npm ci` was the only step that would have detected it. A stale cache is therefore almost
never the cause of a failure; suspect the lockfile instead.

**Integration tests fail on `main`**
Most often a rotated or lapsed `STAGING_SUPABASE_*` secret. This is a hard `::error::` + exit 1 by design —
a silently-degraded run would be indistinguishable from a passing one. Re-provision the repository secret.
If the tests run but assert wrong, suspect staging schema drift; see
`docs/runbooks/staging-schema-drift-resolution.md`.

**Where to look**

```bash
gh run list --workflow=ci.yml --limit 10
gh run view <run-id> --log-failed
gh run view <run-id> --job <job-id> --log
```

The GitHub step summary for each run also carries the security audit table, the bundle-size report, the
coverage totals and the migration-safety verdict — usually enough to diagnose without opening raw logs.
