# Runbook — Model ID Canary

**Owner:** ops. **Detector:** `scripts/check-model-ids.mjs`. **Schedule:** `.github/workflows/model-id-canary.yml`, daily `20 5 * * *` UTC (10:50 IST).
**Alerting:** watched by `.github/workflows/pipeline-alert.yml` — a red run opens a deduped `pipeline-failure` issue and auto-closes it on the next green run.
**Shape:** **two jobs**, one per provider — `probe-anthropic` and `probe-openai` — because this repo's secret layout makes one job impossible. See §6a and §11.

---

## 1. The incident this exists to prevent

2026-08-31. `claude-sonnet-4-20250514` was pinned as Foxy's Sonnet tier. Anthropic **retired** it: the live API answers HTTP 404 `not_found_error` and the id is absent from `GET /v1/models`.

Nothing detected it. `supabase/functions/grounded-answer/claude.ts` classifies 404 as a retriable `server_error`, so every Sonnet-tier request burned a guaranteed-failing round trip and then **silently degraded to OpenAI** — answering students with a model the Foxy prompts, JSON output contract and CBSE pedagogy tree were never calibrated against. It was found by a manual audit, not by the platform.

**Why every existing gate was blind to it:** the breaking change happened *at the provider*. There was no commit, no PR, no push on the day the pin died. `type-check`, `lint`, `npm test` and `npm run build` were green throughout and always would have been, because `'claude-sonnet-4-20250514'` is still a perfectly valid string. Only a **live probe on a schedule** can see an external retirement. That is the entire justification for this workflow being a cron and not a PR gate.

Two more retired ids were still referenced in-repo at the time of writing (`claude-3-opus-20240229`, `claude-3-5-sonnet-20241022`), both confirmed 404. They are dead code today — and they are allowlisted, not deleted, precisely so the next person to revive that code finds a written explanation instead of a 404.

---

## 2. What the canary does

1. **Discovers** model ids from source. It does **not** carry a list. A hardcoded inventory rots exactly the way the pins rotted, and it rots *silently* — a new pin in a new file would never be probed and the canary would keep saying green. The script walks `apps/host/src`, `packages/lib/src`, `packages/ui/src`, `supabase/functions`, `python/services`, `scripts`, `eval`, `mobile/lib`, `agents` and extracts model-id-shaped string literals with a comment-aware tokenizer.
2. **Probes** each id against the provider's free, read-only catalogue endpoint, then confirms any catalogue miss with a per-id `GET`. Never touches a completions endpoint. No token spend.
3. **Classifies**: `ALIVE`, `DEAD`, `ALLOWLISTED`, `UNPROBEABLE`, `NOT-PROBED`.
4. **Reports** every id with its provider, status and every `file:line` that references it.

`UNPROBEABLE` and `NOT-PROBED` are **not** synonyms and the distinction is load-bearing:

| Status | Means | Permanent? |
|---|---|---|
| `UNPROBEABLE` | the provider publishes no free catalogue endpoint (Voyage), so **no run can ever** vouch for this id | yes — a standing gap, §8 |
| `NOT-PROBED` | **this** run was scoped to another provider with `--provider=`, so nobody looked | no — the provider's own scoped job covers it |

Neither ever reads as `ALIVE`. A scoped run's PASS line names its scope and counts what it did not look at, so a log tail can never be mistaken for "everything is fine".

### Reference kinds

| Kind | Meaning | Enforced? |
|---|---|---|
| `code` | the id is the whole of a string literal (or `provider/model`) in non-test source | **yes** |
| `comment` | the id appears only in a comment or a Python docstring | no |
| `prose` | the id appears inside a string literal *containing whitespace* — a log line, an error message, a feature-flag `reason` blurb | no |
| `raw-fallback` | the tokenizer never emitted it but a raw regex pass found it | **yes** |

`comment` exists so that the repair comments in `packages/lib/src/ai/gateway/registry.ts`, `packages/lib/src/grounding-config.ts` and `supabase/functions/grounded-answer/config.ts` — which quote the dead sonnet id **by name** to explain the repair — do not permanently fail the canary they were written to document.

`prose` exists so that `packages/lib/src/flags/protected-flags.ts` naming a model inside a flag description is not treated as a pin.

`raw-fallback` is a deliberate safety net: a tokenizer bug must never make an id **disappear** from the inventory, because a disappeared id is a false green. Over-enforcing is recoverable (allowlist it); under-enforcing is the incident.

---

## 3. Running it

```bash
node scripts/check-model-ids.mjs              # the canary — ALL providers
node scripts/check-model-ids.mjs --verbose    # every reference, not a sample
node scripts/check-model-ids.mjs --no-sweep   # skip the tests/migrations sweep
node scripts/check-model-ids.mjs --json       # JSON on stdout, human report on stderr
node scripts/check-model-ids.mjs --provider=anthropic   # probe ONE provider (what CI runs)
node scripts/check-model-ids.mjs --provider=openai
node scripts/check-model-ids.mjs --inject-dead=<id>   # self-test: prove it bites
```

**Locally, run it unscoped.** `--provider=` exists for CI, where one job can only ever hold one provider's key (§6a). A local run has both keys in `.env.local` and should check both.

### `--provider=` semantics, and why a scoped run cannot manufacture a green

Scoping a checker normally means the un-checked half starts quietly reporting as fine. Four rules stop that here:

1. **Discovery is never scoped.** The whole tree is still walked and every id of every provider is still inventoried, so `MIN_FILES_SCANNED` / `MIN_IDS_DISCOVERED` bite exactly as hard in a scoped run as in a full one. Only the *probing* narrows. Confirmed by the run header: `scanned: 2572 source file(s) / discovered: 25 distinct model id(s)` is identical scoped or not.
2. **An out-of-scope id is stamped `NOT-PROBED`, never `ALIVE`** — its own status, distinct from `UNPROBEABLE` (§2), printed per id.
3. **The verdict line carries the scope.** A scoped run never prints the bare `PASS` string; it prints `PASS (scope: openai) — … 11 id(s) belonging to other providers were NOT PROBED in this run and are NOT covered by this result.`
4. **A scope matching zero enforced ids exits 3, not 0.** A scoped run that probes nothing is vacuous, and a vacuous green is the failure mode this whole script exists to prevent.

Fail-closed is unchanged *inside* a scope: the scoped provider's key missing or rejected, or its catalogue implausibly small, is still exit 3.

Two more guards worth knowing:

* `--provider=<anything but anthropic|openai>` exits **2**. A typo must not silently probe nothing.
* `--provider=openai --inject-dead=<an anthropic id>` exits **2**. The injected id would be `NOT-PROBED` and the one command whose entire job is to prove the canary bites would report that it does not.

**COVERAGE HANDOFF — the one thing to keep reading.** Every probeable provider that has *enforced* (fail-capable) pins needs its own scoped job. Gemini has none today: its ids are `configured: false` and allowlisted, so nothing can fail for them. If that seam is ever activated, each scoped run starts printing a `COVERAGE HANDOFF — enforced (fail-capable) ids exist for: gemini` line, and that is the signal to add a third job. A provider with enforced pins that no job scopes to is checked by **nothing**, and no run anywhere will go red for it.

Locally it reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from `.env.local` (then `.env`); a real environment variable always wins. Keys are never printed.

It is **dependency-free** — `node:fs`, `node:path`, global `fetch`. That is why the workflow has no `npm ci`: an install step would add failure modes (registry outage, lockfile drift) that have nothing to do with whether a model resolves, and every one of them would be indistinguishable from a real alert.

**There is no npm script for it, by choice.** Wiring it into `package.json` would invite someone to chain it into `npm run lint`/CI, where it would fire on PRs with provider secrets it should not have. If a script entry is ever wanted, the exact line for the **root** `package.json` `"scripts"` block is:

```json
"check:model-ids": "node scripts/check-model-ids.mjs",
```

(ops does not own `package.json`; that line has to be added by whoever does.)

---

## 4. Exit codes — and why 1 and 3 are different

| Code | Meaning | What to do |
|---|---|---|
| `0` | every enforced id resolves | nothing |
| `1` | **a pinned id is DEAD** | repin — see §5 |
| `2` | config error (`scripts/model-id-allowlist.json` missing/malformed) | fix the allowlist |
| `3` | **COULD NOT VERIFY** | see §6 |

`3` is a distinct code on purpose. "We could not check" is not "a model died", and **neither one is green**. A canary that quietly passes when it cannot probe is worse than no canary, because it manufactures confidence. Exit 3 fires on: a missing provider key, an auth rejection, an unreachable/erroring provider API, a catalogue that comes back implausibly small, or a discovery pass that scanned almost nothing (`MIN_FILES_SCANNED` / `MIN_IDS_DISCOVERED` vacuity floors).

**Never resolve a 3 by making it green.** Do not disable the schedule, do not loosen the allowlist, do not add `continue-on-error`.

---

## 5. Exit 1 — a pinned model id is DEAD

The output names the id and **every** `file:line` that pins it.

1. Confirm by hand:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://api.anthropic.com/v1/models/<id> \
     -H "x-api-key: $ANTHROPIC_API_KEY" -H 'anthropic-version: 2023-06-01'
   # 404 = gone
   ```
2. Pick a successor **in the same generation** with the same request-shape support (temperature, prefill, vision) so no call sites change.
3. **This is a P12 / model-approval change.** ai-engineer implements, assessment reviews for pedagogical impact, the user approves. A "repair of a dead pin" is still a model change from the student's point of view — the answers change.
4. Repin **every** location the canary listed. The sonnet id lives in at least: `packages/lib/src/ai/gateway/registry.ts`, `supabase/functions/grounded-answer/config.ts` (and bump `MODEL_ROUTE_REV`, which busts the response cache), `supabase/functions/_shared/mol/{generated-matrix,use-cases,telemetry,grader,grader-cron}.ts`, `supabase/functions/_shared/security/quota.ts`, `python/services/ai/mol/{router,cost,grader,grader_cron}.py`, `packages/lib/src/foxy/quality-eval.ts`, `packages/lib/src/ai/validation/synthesis-quality-eval.ts`, `eval/**`. Do not repin from memory — repin from the canary's own reference list.
5. Add the pricing row for the new id (`supabase/migrations/*_model_pricing*.sql`, `_shared/mol/telemetry.ts` `PRICING`, `python/.../cost.py` `PRICING`) or cost telemetry silently records 0.
6. Re-run `node scripts/check-model-ids.mjs` and paste the green output in the PR.

---

## 6. Exit 3 — could not verify

**In CI, the overwhelmingly likely cause on a first run is secret resolution.** §6a is the measured layout; read it before touching anything.

Other exit-3 causes: a provider incident (re-run later; if it persists, check the provider status page), a genuine break in discovery (a vacuity floor fired — check `SCAN_ROOTS` against the real tree after a directory move), or a `--provider=` scope that matched no enforced id (§3).

---

## 6a. Where the provider keys actually live, and why this is two jobs

> **Superseded, 2026-08-31.** This section previously said `ANTHROPIC_API_KEY` was reachable because `mesh-cron.yml` declares `environment: agent-mesh-break-glass`, and that whether a repo-level secret existed "cannot be determined from inside this repo". Both halves were wrong. The first was a stale comment in `mesh-cron.yml` that this runbook and `model-id-canary.yml` then cited as evidence — a false claim laundered into two more files by citation. The second was an assumption; it can be determined, with `gh`. What follows is **measured**, not inferred.

```
[ANTHROPIC_API_KEY]  -> secret ANTHROPIC_API_KEY   ← environment literally NAMED "ANTHROPIC_API_KEY"
[OPENAI_API_KEY]     -> secret OPENAI_API_KEY      ← environment literally NAMED "OPENAI_API_KEY"
```

* There are **21 GitHub Environments** on this repo. Roughly **nine** of them are a secret *name* pasted into the environment-*name* field. The two above are among them.
* **Neither key exists at repo level.** `gh secret list` shows `VOYAGE_API_KEY` and no AI provider key.
* `Production` holds `ANDROID_*` / `GCP_*` / `SUPABASE_*` and **no** AI key.
* `agent-mesh-break-glass` holds **no secrets at all** (see §6b).

**The constraint this creates:** a GitHub Actions **job** can declare exactly **one** `environment:`. So no single job can ever see both provider keys. That is why `model-id-canary.yml` is two jobs — `probe-anthropic` (`environment: ANTHROPIC_API_KEY`) and `probe-openai` (`environment: OPENAI_API_KEY`) — each running the canary scoped with `--provider=`. It is a workaround for a misconfigured secret layout, not a design preference; §11 is the durable fix.

**Two red checks is the better outcome, not a consolation.** One aggregated red says "a model moved". Two separate checks say *which provider* moved before anyone opens a log. Both are in the alert path: `pipeline-alert.yml` watches this workflow by `name:`, and a run concludes `failure` if **either** job fails, so neither provider can fail quietly. The jobs are deliberately independent (no `needs:`), so an Anthropic outage never suppresses the OpenAI check — a skipped check is a silent check.

### The environment trap — check this before assuming the canary is healthy

An environment can neuter a scheduled canary in two ways that the GitHub UI still renders as "configured and enabled":

1. **Required reviewers** park every unattended scheduled run in *Waiting for approval* until it expires (`content-quality-nightly.yml:35-46` records exactly this). The detector goes permanently **silent** while looking healthy — for a canary, silent-and-green is the precise failure being defended against.
2. A **deployment-branch policy** that excludes `main` blocks the run outright.

Neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` (the environments) should carry either. Verify:

```bash
gh api repos/:owner/:repo/environments/ANTHROPIC_API_KEY \
  --jq '{protection_rules, deployment_branch_policy}'
gh api repos/:owner/:repo/environments/OPENAI_API_KEY \
  --jq '{protection_rules, deployment_branch_policy}'
```

`protection_rules` must contain no `required_reviewers` entry. Then dispatch once on `main` and confirm **both jobs reach a terminal state**:

```bash
gh workflow run model-id-canary.yml --ref main
gh run list --workflow=model-id-canary.yml --limit 1
gh run view <run-id> --json jobs --jq '.jobs[] | {name, status, conclusion}'
```

A job sitting in `waiting` is a **failed** canary, not a pending one. Do this after any change to the workflow or to either environment.

---

## 6b. `agent-mesh-break-glass` — do NOT repoint it (finding, 2026-08-31)

`mesh-cron.yml`'s `tick` job declares `environment: agent-mesh-break-glass`, sets `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`, and then guards `test -n "$ANTHROPIC_API_KEY" || exit 1`. That environment holds no secrets, so the key resolves empty and the job fails its own guard.

**It is latent, not firing.** `tick` has `needs: gate` and `if: needs.gate.outputs.enabled == 'true'`, and the Phase-0 `gate` job always writes `enabled=false` and exits 1. `tick` is unreachable today. The bug bites on the first run *after* Phase 0 is lifted.

**The obvious fix — repoint to `environment: ANTHROPIC_API_KEY` — is wrong, and three independent pieces of evidence say so:**

1. **Git history.** PR #713 originally set `environment: ANTHROPIC_API_KEY` and it worked. Commit `b66c25c3` ("ci: contain production delivery paths") deliberately changed it to `agent-mesh-break-glass` in the same diff that added the Phase-0 suspension gate, dropped workflow permissions to `contents: read`, and removed the `eval`-ed `goal_override`. The environment *is* the containment.
2. **The file's own header**, added by that commit: "Restoring it requires a **protected environment**, main-only source enforcement, least-privilege token scope, and a reviewed non-eval argument contract."
3. **It is contractually pinned.** `scripts/verify-devops-policy-contract.ts:200` (`manual-only-containment`) asserts the literal string `environment: agent-mesh-break-glass` in this file. Repointing it fails the `devops-policy-contract` suite.

The stale comment that used to sit above that key — claiming `agent-mesh-break-glass` is what makes the secret resolve — was written for #713's value and left behind by `b66c25c3`. It has been corrected in place.

This job runs with `contents: write` + `pull-requests: write`, a staging service-role credential and an Anthropic key, and it commits and opens PRs. Repointing would make the secret resolve **and** delete the approval gate standing between an autonomous agent and this repo's git history. **The correct fix is an operator action, not a workflow edit:**

```bash
# Put the secret INSIDE the break-glass environment. Both properties then hold:
# the required-env check passes AND break-glass approval still applies.
gh secret set ANTHROPIC_API_KEY --env agent-mesh-break-glass

# Confirm the approval gate survived.
gh api repos/:owner/:repo/environments/agent-mesh-break-glass \
  --jq '{protection_rules, deployment_branch_policy}'
```

Do this before Phase 0 is ever lifted. (`docs/launch-readiness/04_FINDINGS_AND_CONFLICTS.md:960` reached the same conclusion independently: *"Needs owner decision — do not delete."*)

---

## 7. The allowlist

`scripts/model-id-allowlist.json`. An entry means *"this id is knowingly-unreachable configuration and we have decided not to fix it today."* It does **not** mean the id is harmless.

* `reason` is **mandatory and ≥ 20 characters**; the script exits 2 on an unexplained entry. An unexplained allowlist entry is indistinguishable from a silent skip.
* Allowlisted ids are still **probed** and still print their real status. A `DEAD` allowlisted id prints a `::warning::` every run so it stays visible.
* The script prints a *ratchet opportunity* when an allowlisted id is no longer referenced anywhere — delete the entry in that PR.

Current entries and why:

| id | Why allowlisted |
|---|---|
| `gemini-1.5-flash`, `gemini-1.5-pro` | Dormant provider seam. `packages/lib/src/ai/gateway/registry.ts` declares both with `configured: false`, and `chainFromOrder()`/`listModels()` filter on that flag, so the router can never select them. No `GEMINI_API_KEY` is wired. Re-verify the ids *and* their placeholder cost/latency figures before ever flipping `configured` to `true`. |
| `claude-3-opus-20240229`, `claude-3-5-sonnet-20241022` | **Retired at Anthropic — confirmed 404 by live probe.** Two non-routing reference sites each: (1) `python/services/ai/mol/use_cases.py`, whose `USE_CASES` table has **zero importers** anywhere under `python/` — the live routing table is the Deno twin `supabase/functions/_shared/mol/use-cases.ts`, which does not reference either id; (2) `supabase/functions/_shared/mol/telemetry.ts` `PRICING`, a price lookup for historical telemetry rows, which is correct to keep. **Landmine:** reviving the Python `USE_CASES` table without repinning would ship guaranteed-404 fallback rungs. |

---

## 8. Known gaps this canary does *not* close

Written down so nobody mistakes a green run for full coverage.

* **Voyage is UNPROBEABLE.** `voyage-3`, `voyage-large-2-instruct`, `rerank-2` and friends are inventoried and printed every run, but Voyage publishes no free catalogue endpoint, so the canary cannot vouch for them. An embedding/rerank model retiring is a real, currently-undetected risk.
* **`voyage-multimodal`** (`supabase/functions/embed-diagrams/index.ts:582`, a route security profile `modelName`) carries **no version suffix**. It is reported in the "model-ish strings NOT probed" section rather than probed. Voyage's real multimodal model is `voyage-multimodal-3`. Unverified — flagged for ai-engineer.
* **SQL is swept, not enforced.** Migrations are forward-only immutable history, so a pricing row naming a retired model is *correct* there. A column `DEFAULT` naming one is **not** — it stamps every new row with a dead label. See §9.
* **OpenAI 404 is ambiguous.** `GET /v1/models/<id>` returns 404 both for a retired model and for one the key's org is not entitled to. The canary reports `DEAD` either way, which is the right operational answer (the call would fail) but not always the right *cause*.
* **Discovery was cross-checked against a naive repo-wide grep** (an independent enumeration built without the tokenizer). Every model-id-shaped token that grep found in Alfanumrik source is in the canary's inventory or its sweep. The five that are not: `claude-sonnet-4-6-20251022`, `gpt-4o-mini-2024-07-18` and `o3` are sweep-only (tests + migrations, reported there by design); `gpt-4` and `gpt-4-turbo-preview` exist **only** inside `.opencode/node_modules/effect/…`, a vendored third-party dependency, and there is no standalone `'gpt-4'` literal anywhere under the scan roots. Re-run that diff after any change to `providerOf()` or `SCAN_ROOTS`.
* **The two-job split has a coverage edge.** Each job checks exactly one provider. Today that covers every provider with enforced pins (anthropic, openai). A *third* probeable provider gaining enforced pins with no job of its own would be checked by nothing. The script names this in both jobs' logs (`COVERAGE HANDOFF — enforced (fail-capable) ids exist for: …`, §3), which converts the hole from silent to stated — but nothing *forces* someone to add the job. This is the residual cost of the split, and §11 removes it by removing the need to split.
* **This is not in `scripts/job-registry.json`.** That registry is Vercel-cron-only (all 18 entries are `platform: vercel`, `/api/cron/*`), enforced against `vercel.json` by `apps/host/src/__tests__/api/cron-job-registry.test.ts`. A GitHub Actions cron does not belong there — same as `content-quality-nightly`, `e2e-nightly`, `rag-eval` and `edge-auth-sweep`, none of which are listed either. Do not "fix" this.

---

## 9. Standing findings — flagged, not fixed (not ops' files)

Found by the sweep. None is a routing pin, so none fails the canary; all are real and all are outside ops' ownership.

| Finding | Location | Assessment |
|---|---|---|
| `claude-sonnet-4-6-20251022` — **never existed** in any Anthropic catalogue (Sonnet 4.6 carries no date suffix). Live seed row. | `supabase/migrations/20260518000003_model_pricing.sql:19`; fixtures `python/tests/unit/test_providers_anthropic.py:176`, `python/tests/unit/test_eval_harness.py:49` | The migration `20260802180000_…` header states it deliberately **leaves this row's model id in place** and inserts the correct id alongside. So the bad row persists in `model_pricing`. Cosmetic for cost lookup (nothing matches it), misleading to read. architect / backend. |
| `claude-haiku-2024-10-22` — **never existed** (Anthropic uses compact `-YYYYMMDD`, not dashed). Comment only. | `python/services/ai/mol/cost.py:37` | An illustrative example in a regex comment. Harmless, but it teaches the wrong id format. ai-engineer. |
| `'claude-sonnet-4-20250514'` (retired) as a **column DEFAULT** and as `write_foxy_cache(p_model)`'s default | `supabase/migrations/00000000000000_baseline_from_prod.sql:8690, 9622` | Every new cache row is stamped with a dead model label unless the caller passes one. Data-labelling defect, not a routing defect. architect. |
| `'claude-3-haiku-20240307'` (retired) as a `model_used` column DEFAULT | `supabase/migrations/00000000000000_baseline_from_prod.sql:11297` | Same class as above. architect. |
| `'anthropic/claude-sonnet-4'` (undated, **not in the catalogue**) as a `model_used` column DEFAULT | `supabase/migrations/00000000000000_baseline_from_prod.sql:13188` | Same class as above. architect. |
| `o1` / `o3-mini` are **live-routed** primaries for `hard_iit_math`, `physics_derivations`, `numerical_problem_solving` | `supabase/functions/_shared/mol/use-cases.ts:23-41` (imported by `_shared/mol/router.ts`) | Both currently resolve. Noted because they are the only OpenAI-primary rungs left after the 2026-08-26 Claude-primary swap, and they are reasoning models with a different request shape. ai-engineer. |

---

## 10. Change protocol

* **Adding a scan root or changing `providerOf()`** — ops. Re-run the canary and confirm the discovered-id count does not *drop*; a drop means ids stopped being seen, which is the false-green direction.
* **Touching `.github/workflows/model-id-canary.yml` or `pipeline-alert.yml`** — Gate 4.5 applies: **parse** the YAML, do not grep it. Confirm, from the parsed structure: triggers are still exactly `schedule` + `workflow_dispatch` (no `pull_request`, no `pull_request_target`, no `push`); **both** jobs' `if:` is still main-only; each job still declares the `environment:` holding its own key; no job or step has `continue-on-error`; there is still no `npm ci`; and `pipeline-alert.yml`'s watch list still **byte-matches** the canary's `name:` (em dash included) — assert that programmatically, not by eye. Then run the suites that parse `.github/workflows/`: `devops-policy-contract`, `reg-378`, `reg-317`, `critical-path-gate`.
* **Adding or removing a provider job** — ops. The invariant is: *every probeable provider with enforced pins has a job scoped to it.* Verify by running the canary unscoped and reading which providers appear under enforced ids, then diffing that against the set of `--provider=` values across the jobs.
* **Changing `--provider=` semantics in `scripts/check-model-ids.mjs`** — ops, and re-prove all four no-false-green properties in §3 by running them (out-of-scope ids report `NOT-PROBED`; scoped PASS names its scope; missing/rejected key still exits 3; empty scope exits 3).
* **Touching `.github/workflows/mesh-cron.yml`** — read §6b first. `environment: agent-mesh-break-glass` is pinned by `scripts/verify-devops-policy-contract.ts:200`; changing it is a containment decision, not a wiring fix.
* **Repinning a model** — P12. ai-engineer implements, assessment reviews, user approves.

---

## 11. The durable fix — consolidate the secret layout, then delete the split

Everything in §6a and §6b is a **workaround for a misconfigured secret layout**, and both should be deleted once that layout is fixed. Written plainly so nobody mistakes the workaround for the design:

**The misconfiguration.** This repo has 21 GitHub Environments. Roughly **nine** of them are not environments in any meaningful sense — they are secret *names* that were pasted into the environment-*name* field (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and friends). Each ends up holding exactly one secret, named the same as the environment containing it.

**Why that is not merely ugly.** A GitHub Actions **job** can declare only ONE `environment:`. One-secret-per-environment therefore means *one secret per job*. Any workflow that legitimately needs two provider keys in the same job is **impossible to write** — not awkward, impossible. The canary hit this wall and had to be split into two jobs. `mesh-cron` hit an adjacent form of it: its one `environment:` slot is already spent on a break-glass approval gate, so it cannot also use that slot to reach a secret. **Until this is fixed, every future workflow needing both providers hits the same wall**, and each one pays for it with another workaround.

**The fix.** Put the AI provider keys somewhere a job can reach them together — either one shared environment, or repo level.

```bash
# 0. See the real state first. Do not act on this runbook's numbers; re-measure.
gh api repos/:owner/:repo/environments --jq '.environments[].name'
gh secret list                                    # repo-level secrets
gh secret list --env ANTHROPIC_API_KEY            # names only; values are never readable
gh secret list --env OPENAI_API_KEY

# 1a. OPTION A — one shared environment (keeps environment-level scoping and
#     lets you set a main-only deployment-branch policy on it).
gh api -X PUT repos/:owner/:repo/environments/ai-providers
gh secret set ANTHROPIC_API_KEY --env ai-providers
gh secret set OPENAI_API_KEY    --env ai-providers
#     Then confirm NO required reviewers (they would silence the cron — §6a):
gh api repos/:owner/:repo/environments/ai-providers \
  --jq '{protection_rules, deployment_branch_policy}'

# 1b. OPTION B — repo level (simplest; no environment gymnastics, but also no
#     per-environment branch policy on these keys).
gh secret set ANTHROPIC_API_KEY
gh secret set OPENAI_API_KEY

# 2. Collapse the canary back to ONE job: a single `environment: ai-providers`
#    (Option A) or no `environment:` at all (Option B), both keys in one `env:`
#    block, and `node scripts/check-model-ids.mjs --verbose` with no
#    `--provider=`. Keep the main-only `if:`, `permissions: contents: read`,
#    schedule+dispatch triggers, and the no-`npm ci` rule.
#    Then delete §6a and this section, and drop `--provider=` if nothing else
#    uses it.

# 3. Give mesh-cron its key WITHOUT dropping the break-glass gate (§6b).
gh secret set ANTHROPIC_API_KEY --env agent-mesh-break-glass

# 4. Delete the secret-name-shaped environments — LAST, and one at a time.
#    Deleting an environment deletes the secrets inside it. Verify nothing
#    still declares it before each delete:
grep -rn "environment: <NAME>" .github/workflows/
gh api -X DELETE repos/:owner/:repo/environments/ANTHROPIC_API_KEY
gh api -X DELETE repos/:owner/:repo/environments/OPENAI_API_KEY
#    ... and the other ~7 secret-name-shaped ones, same check each time.

# 5. Re-verify. A green canary that no longer probes is the failure mode this
#    whole runbook exists to prevent.
gh workflow run model-id-canary.yml --ref main
gh run view <run-id> --json jobs --jq '.jobs[] | {name, status, conclusion}'
```

**Order matters.** Step 4 destroys secrets. Do not delete an environment until the workflows that referenced it have been merged to `main` pointing somewhere else, and a real dispatched run has gone green against the new location. `gh secret set` cannot read an existing value back — you need the key material to hand before starting.

**Approval.** Steps 1-4 change where production credentials live and (for `agent-mesh-break-glass`) touch a containment control. That is a user/CEO decision, not an autonomous ops one. Steps 0 and 5 are read-only and can be run any time.
