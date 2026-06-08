# Runbook: Mobile Release (Play Store)

Operator runbook for the Alfanumrik Android release pipeline. The release
workflow's guard step points operators here ("see
`docs/runbooks/mobile-release.md`") when secrets are missing, so this document is
the single source of truth for cutting an Android release.

- **Workflow**: `.github/workflows/mobile-release.yml` (`Mobile Release (Play Store)`)
- **Fastlane**: `mobile/android/fastlane/Fastfile` + `mobile/android/fastlane/Appfile`
- **Signing config**: `mobile/android/app/build.gradle`, `mobile/android/key.properties.example`
- **Package name**: `com.alfanumrik.app`
- **Toolchain (Gradle/AGP/Kotlin/Flutter)**: see the companion runbook
  [`docs/runbooks/mobile-ci-and-android-toolchain.md`](./mobile-ci-and-android-toolchain.md)

This is a **publish** pipeline, not a check. It never runs on branch pushes or
PRs (that is `mobile-ci.yml`'s job); it fires only on a manual dispatch or a
`mobile-v*` tag push, and never on untrusted PR code.

---

## 1. Overview

The pipeline produces a signed Android App Bundle and uploads it to the Play
Store **internal** track as a draft:

```
flutter build appbundle --release      # Gradle signs with the upload keystore
        │                              # → mobile/build/app/outputs/bundle/release/app-release.aab
        ▼
bundle exec fastlane internal          # uploads that AAB to the Play Store
                                       #   INTERNAL track, release_status: draft
```

The full workflow sequence (`mobile-release.yml`):

1. **Guard** — fails fast with an actionable error (pointing at this runbook) if
   `ANDROID_KEYSTORE_BASE64` or `PLAY_SERVICE_ACCOUNT_JSON` is unset.
2. **Checkout** + **Set up Flutter** (`3.41.9`, stable — same pin as
   `mobile-ci.yml`).
3. **Regenerate the `/v2` Dart client** (`build_runner` inside
   `mobile/lib/api/v2`) — the generated `*.g.dart` `part` files are gitignored,
   so a clean checkout will not compile until codegen runs. Then `flutter pub
   get` at the app root.
4. **Write `key.properties`** + **decode `upload-keystore.jks`** from secrets
   (runtime-only, gitignored).
5. **Build signed App Bundle** — `flutter build appbundle --release`. Gradle
   reads `key.properties` + `upload-keystore.jks` and signs with the real upload
   key (see signing logic in section 5).
6. **Set up Ruby + bundler** (fastlane), then **write the Play
   service-account JSON** and **upload via fastlane** (the lane is the dispatch
   `track` input, default `internal`).
7. **Upload the AAB as a build artifact** (`app-release-aab`, retained 30 days)
   for traceability/audit.
8. **Clean up signing material** (`if: always()`) — removes `key.properties`,
   `upload-keystore.jks`, and `play-service-account.json` on success or failure.

**Triggers:**

- Push a `mobile-v*` tag → tagged release publish (runs the `internal` lane).
- `workflow_dispatch` from Actions → optional `track` input (default `internal`),
  used as the fastlane lane name to run.

The job runs in the `production` GitHub environment, so any reviewers configured
on that protected environment gate the release. Concurrency group
`mobile-release` is set with `cancel-in-progress: false` so a publish is never
cancelled mid-flight.

---

## 2. One-time setup

Do this once when standing up the release pipeline for a brand-new Play app.

### 2.1 Generate the upload keystore

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias alfanumrik
```

The alias (`alfanumrik`) **must match the `ANDROID_KEY_ALIAS` secret** (it is also
the default `keyAlias` in `mobile/android/key.properties.example`). `keytool`
prompts for the keystore (store) password and the key password — record both;
they become `ANDROID_KEYSTORE_STORE_PASSWORD` and `ANDROID_KEY_PASSWORD`.

> **CRITICAL: keep the original `upload-keystore.jks` safe and backed up.**
> Losing it means you can never update the app again. Store it in a secrets
> manager / offline vault, not in the repo.

### 2.2 Base64-encode the keystore for the secret

The keystore secret holds the base64 of the `.jks` (CI decodes it back to a file
at build time):

```bash
base64 -w0 upload-keystore.jks    # Linux
base64 -i  upload-keystore.jks    # macOS
```

The output (a single line, no newlines) is the value of `ANDROID_KEYSTORE_BASE64`.

### 2.3 Google Play Console + service account

1. In the **Play Console**, create the app with package name
   `com.alfanumrik.app` and accept the developer/distribution agreements.
2. Set up the **internal testing track** (this is the track the `internal` lane
   uploads to).
3. Create a **Google Cloud service account** with the **Google Play Developer
   API enabled** for the linked project.
4. In the Play Console, grant that service account access: **Users &
   permissions → invite the service-account email → grant "Release to testing
   tracks"** (enough for the `internal` lane; grant broader release permissions
   only if you will promote to production via fastlane).
5. Download the service account's **JSON key**. Its contents become the value of
   `PLAY_SERVICE_ACCOUNT_JSON`.

> **First upload caveat:** the **first** AAB for a new Play app must be uploaded
> **by hand in the Play Console UI** — Google requires the first bundle via the
> UI to register the app-signing key. fastlane handles **every subsequent**
> upload. Build the first AAB locally (or download the `app-release-aab`
> artifact from a workflow run) and upload it manually once; after that the
> `internal` lane works.

### 2.4 Add the 5 GitHub secrets to the `production` environment

Add these under **Settings → Environments → `production` → Secrets** (not
repo-wide — the workflow declares `environment: production`, so they must live on
that environment to be visible to the job):

| Secret | What it is |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 of the upload keystore `.jks` (from §2.2). CI decodes it to `upload-keystore.jks`. |
| `ANDROID_KEYSTORE_STORE_PASSWORD` | The keystore (store) password set in §2.1. |
| `ANDROID_KEY_PASSWORD` | The signing-key password set in §2.1. |
| `ANDROID_KEY_ALIAS` | The signing-key alias — must equal the `keytool -alias` value (`alfanumrik`). |
| `PLAY_SERVICE_ACCOUNT_JSON` | The Google Play Developer API service-account JSON (from §2.3). |

The guard step only checks `ANDROID_KEYSTORE_BASE64` and
`PLAY_SERVICE_ACCOUNT_JSON` for presence, but **all five** are required — a
missing password/alias surfaces later as a Gradle signing failure, and a missing
JSON as a fastlane auth failure.

---

## 3. How to cut a release

1. **Bump the version** in `mobile/pubspec.yaml`:

   ```yaml
   version: x.y.z+buildNumber   # e.g. 1.4.0+42
   ```

   The `buildNumber` (the `+N` suffix → Android `versionCode`) **must strictly
   increase on every upload**. Play rejects a bundle whose version code was
   already used.

2. **Commit** the version bump.

3. **Trigger the release** — either path works:

   - **Tag (recommended for releases):**

     ```bash
     git tag mobile-v<x.y.z>
     git push origin mobile-v<x.y.z>
     ```

     The tag runs the `internal` lane.

   - **Manual dispatch:** Actions → **Mobile Release** → **Run workflow** →
     choose the `track` input (the value is used as the fastlane lane name;
     default `internal`).

4. **Monitor the run.** The signed AAB is also saved as the `app-release-aab`
   build artifact (30-day retention) for traceability.

5. **Promote internal → production after QA.** Once the internal build passes
   QA, promote it from the **Play Console UI**, or run the
   `:promote_to_production` fastlane lane (`bundle exec fastlane
   promote_to_production`) which promotes the latest internal release to the
   production track as a **draft** for final manual review + staged rollout in
   the Console.

---

## 4. Troubleshooting

### (a) Release-only crash that does not reproduce in debug

A crash that only appears in the `--release` build (and not in `--debug`) is
almost always **R8 / ProGuard stripping a class** — the release build type has
`minifyEnabled true` + `shrinkResources true` (see `build.gradle`), debug does
not.

Fix:

1. Read the **deobfuscated** stack trace — upload the build's `mapping.txt`
   (emitted under `mobile/build/app/outputs/mapping/release/`) to Play Console
   (or run it through `retrace`) so the obfuscated frames resolve to real class
   names.
2. Add a **targeted `-keep`** rule to `mobile/android/app/proguard-rules.pro`
   for the stripped class/package. **Do NOT disable minification** — that bloats
   the bundle and masks the real issue.
3. Before shipping, **smoke-test the minification-sensitive paths** in a release
   build: **Razorpay checkout**, **Supabase auth**, the **WebView STEM Lab**,
   and **Sentry init** — these use reflection/native bridges most likely to be
   shrunk away.

### (b) "Package not found" / HTTP 403 from fastlane

The service account either lacks Play permission or the Play Developer API is
not enabled. Re-check §2.3: confirm the **Google Play Developer API is enabled**
for the project and the service-account email has **"Release to testing tracks"**
(or broader) granted in **Play Console → Users & permissions**.

### (c) Signing-key mismatch

The keystore/alias used to sign the AAB does not match the app-signing key
registered for the app. Confirm `ANDROID_KEYSTORE_BASE64` is the correct `.jks`
and `ANDROID_KEY_ALIAS` matches the alias inside it (and the one Google
registered on the first manual upload, §2.3).

### (d) "Version code already used"

Play already has a bundle with this `versionCode`. Bump the `+buildNumber` in
`mobile/pubspec.yaml` (see §3.1) and re-cut.

### Toolchain failures (Gradle / AGP / Kotlin)

The release build uses the **same** Gradle / AGP / Kotlin / Flutter toolchain as
CI. For build-graph, ABI-split, or Kotlin-Gradle-plugin errors, see
[`docs/runbooks/mobile-ci-and-android-toolchain.md`](./mobile-ci-and-android-toolchain.md).

---

## 5. Security note

- The 5 secrets live **only in the `production` environment** — never repo-wide,
  never in the codebase.
- The workflow writes them to **runtime-only files** (`key.properties`,
  `upload-keystore.jks`, `play-service-account.json`) that the
  `Clean up signing material` step deletes with `if: always()` (runs on success
  **and** failure). The runner is ephemeral regardless.
- Secrets reach steps only via `env:` mapping; no secret value is ever echoed.
- **Never commit** `key.properties`, any `*.jks`, or the service-account JSON.
  All three are gitignored (`mobile/android/key.properties`,
  `mobile/android/upload-keystore.jks`,
  `mobile/android/play-service-account.json`). Use `key.properties.example` (with
  blank passwords) as the template only.

### Signing fallback (why CI/local builds don't need the keystore)

`mobile/android/app/build.gradle` loads `key.properties` **only if present**.
When it is absent (CI's `flutter build apk --debug`, local dev), the release
build type falls back to **debug signing**, so unsigned release/debug builds
still succeed without a keystore. The Play Store workflow is the only place
`key.properties` + the real `.jks` exist, so it is the only place a real
upload-key-signed bundle is produced.
