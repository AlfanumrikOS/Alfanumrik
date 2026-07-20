# Runbook: Mobile CI & Android Toolchain

**Owner:** architect (CI/CD + deployment config)
**Audience:** anyone merging a PR that touches `mobile/**`, and the repo owner deciding branch-protection policy.
**Created:** 2026-06-07 (Phase 2 prevention work, following an RCA of repeated mobile-CI failures).

This runbook exists to prevent a specific, expensive failure mode from recurring: the Flutter app passing every check the team looked at while being **unable to assemble an APK at all**. Read the FALSE-GREEN TRAPS section before you trust any "mobile is green" signal.

---

## 1. Root-Cause Analysis (the incident this runbook encodes)

### Symptom
The `Mobile CI` workflow (`.github/workflows/mobile-ci.yml`) — the **only** thing in the entire pipeline that compiles an Android APK, via `flutter build apk --debug` — appeared to be in place and "passing" after it was added in Wave 2.6. When GitHub Actions billing was later funded and the workflow actually executed for the first time, the very first real APK compile failed and surfaced **two latent native-build bugs at once**.

### Root cause 1 — the APK build never ran (false coverage from a billing block)
The `mobile-ci.yml` workflow was added in Wave 2.6 but **never executed**, because GitHub Actions billing was suspended at the time. Jobs were **rejected at scheduling**: they "completed" in roughly 2 seconds with **zero steps executed**. That is not a pass and not a normal failure — it is "the job was never allowed to start." Because the check appeared in the PR check list, it read as coverage that did not exist.

### Root cause 2 — the checks that *did* run cannot prove the app compiles
`flutter analyze` and `flutter test` do **not** compile the Android/Kotlin native layer. They validate Dart source and run Dart unit tests against the host VM. An app can have zero analyzer issues and a fully green test suite while the Gradle/AGP/Kotlin assembly of an actual APK is broken. So the green `analyze`/`test` steps were a **false green** with respect to "does this ship as an Android app."

### Root cause 3 — there was no local APK signal either
The dev sandbox **cannot** run `flutter build apk`: the Gradle daemon cannot bind its loopback socket in that environment, so any local APK compile dies before it starts. There was therefore no local floor to catch what CI wasn't catching. (See FALSE-GREEN TRAPS (b): CI is the sole APK-build authority.)

### What the first real compile exposed (both now fixed on `main`)
- **A1 — duplicate ABI configuration.** `mobile/android/app/build.gradle` had a manual `splits.abi {}` block that conflicted with the `ndk.abiFilters` that the Flutter Gradle plugin injects. AGP forbids configuring both. **Fixed in PR #957** (commit `9ae088ad`): the manual `splits` block was removed; a comment now documents that ABI splitting is driven by the Flutter CLI (`--split-per-abi` / `flutter build appbundle`), not a manual block.
- **A2 — Kotlin too old for a transitive dependency.** `package_info_plus 9.0.1` (pulled in transitively via `sentry_flutter 8.14.2`) requires Kotlin 2.x, but the Android project was on Kotlin Gradle Plugin 1.9.22. **Fixed in PR #957**: Kotlin Gradle Plugin bumped to **2.1.0** in `mobile/android/settings.gradle`.

### Deeper cause (the lesson)
**The APK-compile path had zero enforcement — CI *or* local — until GitHub Actions was funded.** Two independent gaps (a billing block that silenced the only APK job, plus a sandbox that physically can't run Gradle) lined up so that no signal, anywhere, ever exercised native Android assembly. The bugs weren't introduced all at once; they accumulated invisibly because nothing was compiling the thing that would have caught them. The fix is not just "the two bugs are patched" — it is **never again let the APK-compile path go unenforced**, and never mistake "analyze/test green" or "0-step job" for "the app builds."

### Separate, benign noise (NOT a failure — do not chase it)
"Production Build cancelled" / "E2E neutral" entries in the PR check list during this period were **not** failures. They were `concurrency: cancel-in-progress: true` doing its job: when you push several commits in quick succession, GitHub cancels the in-flight runs of the superseded commits so only the newest commit's run finishes. A cancelled run of an old commit is expected and benign. Distinguish it from a real failure by checking **which commit SHA** the cancelled run belonged to — if it's an older push, it's superseded-run cancellation, not a broken build.

---

## 2. Current Android toolchain versions

Read live from the repo (verify against the files before trusting this table — these are point-in-time):

| Component | Version | Source of truth |
|---|---|---|
| Gradle (wrapper) | **8.4** | `mobile/android/gradle/wrapper/gradle-wrapper.properties` (`distributionUrl=...gradle-8.4-all.zip`) |
| Android Gradle Plugin (AGP) | **8.2.2** | `mobile/android/settings.gradle` (`com.android.application` version) |
| Kotlin Gradle Plugin | **2.1.0** | `mobile/android/settings.gradle` (`org.jetbrains.kotlin.android` version) |
| Flutter (CI pin) | **3.41.9** (stable) | `.github/workflows/mobile-ci.yml` (`flutter-action` `flutter-version`) |
| Dart SDK constraint | `>=3.2.0 <4.0.0` | `mobile/pubspec.yaml` |

**These versions must stay internally consistent.** Gradle ↔ AGP ↔ Kotlin have hard compatibility windows (AGP 8.2.x requires Gradle ≥ 8.2; AGP/Kotlin plugin versions gate which Kotlin language level transitive plugins can demand — root cause A2 above was exactly a Kotlin-too-old mismatch). When a dependency bump (including a **transitive** one, like `package_info_plus` via `sentry_flutter`) demands a newer Kotlin/AGP/Gradle, **bump the toolchain in the same PR** and let `Mobile CI` prove the APK still assembles. Conversely, **bump these before they're dropped** by the ecosystem: do not let them age until a dependency forces an emergency upgrade. A toolchain bump PR is exactly the kind of PR that must show a green `flutter build apk` (Section 4).

---

## 3. FALSE-GREEN TRAPS (read this before trusting any mobile signal)

These three traps are the entire reason this incident happened. Internalize them.

### (a) `flutter analyze` / `flutter test` do NOT prove the app compiles to an APK
They validate Dart and run Dart unit tests on the host VM. They never invoke Gradle, AGP, or the Kotlin compiler, so they cannot catch a broken Android native build (duplicate ABI config, Kotlin-version mismatch, Gradle/AGP incompatibility, missing NDK, manifest merge failure, etc.). **Only `flutter build apk` proves the app compiles.** If a PR is "green" but the green came only from analyze + test, the APK is unproven.

### (b) CI is the SOLE APK-build authority
The dev sandbox **cannot** run `flutter build apk` — the Gradle daemon can't bind its loopback socket there, so a local APK compile fails for environmental reasons unrelated to the code. **Do not** interpret a local Gradle failure as a code defect, and **do not** treat "it builds for me" as meaningful for the APK path (it can't build for anyone locally). The authoritative APK-compile signal lives **only** in the `Mobile CI` GitHub Actions run. There is no local fallback; CI is it.

### (c) The billing-block signature: a ~2s job with 0 steps executed means NEVER RAN
A GitHub Actions job that "completes" in roughly 2 seconds having executed **0 steps** was **rejected at scheduling** (billing suspended, runner quota exhausted, or similar) — it **never ran**. This is **not** a pass, and it is **not** a safe-to-ignore failure. Treat a 0-step "completion" as **zero coverage** for whatever that job was supposed to verify. **Never dismiss a 0-step failure as ignorable noise.** If `Mobile CI` shows up as 0 steps / ~2s, the APK was not built — full stop. (Contrast with the benign superseded-run cancellation in Section 1, which is identified by an *older commit SHA*, not by a 0-step count.)

---

## 4. THE RULE

> **The `Flutter analyze + test + build` check (workflow `Mobile CI`) MUST be green — with all steps actually executed, including `flutter build apk --debug` — on any PR that touches `mobile/**` before that PR merges.**

A green that came from a 0-step "completion" (Trap c) or from analyze/test only (Trap a) does **not** satisfy this rule. The merge gate is the **`flutter build apk` step passing for the PR's head commit.**

Because branch protection / required-status-checks on this repo is **plan-gated** (the repo is private and on a plan where `gh api .../branches/main/protection` returns `403 "Upgrade to GitHub Pro or make this repository public"`), this rule **cannot be mechanically enforced today.** It is therefore enforced **by process** — reviewer and orchestrator discipline — until the repo is on GitHub Pro/Team (or made public). The reviewer of any `mobile/**` PR must open the `Mobile CI` run, confirm the `flutter build apk --debug` step ran and passed for the PR's head SHA, and only then approve.

---

## 5. Recommendation to the repo owner (action required to make THE RULE mechanical)

Today THE RULE is process-only because the platform won't let us require a status check. **Enable branch protection — or a Ruleset — on `main` so the APK build becomes a required, merge-blocking check.** This requires **GitHub Pro or GitHub Team** for a private repo, **or** making the repository public.

When you have Pro/Team (or go public), add a **Ruleset** (Settings → Rules → Rulesets, target branch `main`) — or classic Branch protection (Settings → Branches) — with **"Require status checks to pass before merging"** and add these exact check names as required:

| Check name (exactly as it appears) | Workflow | Why it's required |
|---|---|---|
| `Flutter analyze + test + build` | `Mobile CI` (`.github/workflows/mobile-ci.yml`) | The only APK-compile authority. This is the check this whole runbook is about. |
| `Lint, Type-check & Test` | `CI — Alfanumrik` (`.github/workflows/ci.yml`) | Web type-check + lint + unit tests (blocking gate). |
| `Production Build` | `CI — Alfanumrik` (`.github/workflows/ci.yml`) | Web production build + bundle-size budgets (P10). |

Notes for whoever configures this:
- The check **name** is the job's `name:` field, not the workflow name. `Mobile CI`'s job is named `Flutter analyze + test + build` (see `mobile-ci.yml`); in `ci.yml`, `Lint, Type-check & Test` is the `unit-tests-merge` fan-in job (fans in over the `Lint & Type-check` job — which runs lint/type-check — plus the 4 unit-test shards), and `Production Build` is the build job.
- Also enable **"Require branches to be up to date before merging"** so a green check can't be stale relative to `main`.
- A required status check only appears in the picker **after it has run at least once** on a PR/commit — push a `mobile/**` change first so `Flutter analyze + test + build` is selectable.
- Until this is configured, **Section 4's process enforcement is the only thing standing between a broken APK and `main`.** Do not skip the manual check.

---

## 6. Pipeline hygiene: concurrency & path filters (current state, verified 2026-06-07)

Both workflows are already configured correctly; this section documents *why* so the config isn't "cleaned up" into a regression.

### Concurrency (superseded-run cancellation is intended)
- `mobile-ci.yml`: `concurrency: { group: mobile-ci-${{ github.ref }}, cancel-in-progress: true }`.
- `ci.yml`: `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.

`cancel-in-progress: true` means a new push to a ref cancels the older, now-superseded run on that same ref. This is **deliberate** — it saves runner minutes and avoids a queue of stale runs. A "cancelled" run belonging to an **older commit SHA** is expected noise, **not** a failure (Section 1, "Separate, benign noise"). Keying the group on `github.ref` ensures different PRs/branches do not cancel each other — only newer pushes to the *same* ref cancel older ones. **Do not remove `cancel-in-progress`** to "fix" cancelled runs; that would only pile up stale runs and waste minutes.

### Path filters (mobile-ci.yml triggers on everything that affects the APK)
`mobile-ci.yml` runs on `pull_request` and `push` (to `main`) when any of these change:
```
mobile/**
openapi/v2.json
.github/workflows/mobile-ci.yml
```
`mobile/**` is a **recursive** glob — it covers `mobile/android/**` (the Gradle/AGP/Kotlin native config), `mobile/pubspec.yaml` (dependency versions, incl. the transitive ones that triggered root cause A2), `mobile/lib/**`, and everything else under `mobile/`. Verified 2026-06-07: `mobile/android/app/build.gradle` and `mobile/pubspec.yaml` are tracked under `mobile/` and therefore matched. `openapi/v2.json` is included because the generated `/v2` Dart client is derived from it (a contract change can break the mobile compile without touching `mobile/**` directly). **The filter is correctly scoped — it is not too narrow.** If you ever move Android config out from under `mobile/`, you must widen this filter accordingly, or the APK gate will silently stop running on those changes (a re-run of root cause 1's "the gate didn't run" failure mode).
