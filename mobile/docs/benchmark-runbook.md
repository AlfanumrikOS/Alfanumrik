# Alfanumrik Mobile — Physical-Device Benchmark Runbook (Option A gate)

**Artifact under test:** the shipping Flutter app in `mobile/`, version **`1.1.0+2`**
(`pubspec.yaml`), package id **`com.alfanumrik.student`**.

**Why this exists.** We are deciding between:

- **Option A — optimize Flutter** (stay on the current codebase, fix renderer /
  cache / build config), vs
- **Option B — rewrite the hot surfaces natively (Kotlin)**.

This runbook is the **measurement gate** for that decision. It is turnkey for
whoever physically holds the pilot-classroom handset: run every section, record
the numbers in the results table (§7), and apply the decision matrix. The single
most important output is the **A-vs-B tripwire (§5)** — it tells us whether the
jank is structural (→ Option B) or a renderer-config artifact (→ stay on A).

> **Authoring note (2026-07-17).** The harness + drivers in this repo were
> authored WITHOUT a Flutter toolchain or a physical device present. `flutter
> analyze`, `flutter test`, and `flutter drive` were **NOT** run here. They MUST
> be validated in CI and executed on-device per this runbook. Nothing below has
> been executed against real hardware yet — the numbers in §7 are blank on
> purpose.

---

## 1. Device sourcing — use the ACTUAL pilot handset, not a proxy

Do **not** benchmark on a spec-matched phone we picked ourselves, and do **not**
benchmark on an emulator. Renderer behaviour (Impeller vs Skia, Vulkan vs
OpenGLES) and GPU jank are **device-specific**, and the whole point of §5 is to
catch old-GPU structural jank.

1. Ask **Shalabh** which handset models are actually in the pilot classrooms.
2. Buy **two units of the two most common models** (four phones total) so we have
   a spare and can cross-check one reading against another unit of the same model.
3. At least one model MUST be an **older Adreno or Mali GPU** device (typical
   Indian budget phone, 2–4 GB RAM) — that is the device §5 runs the Impeller
   ON/OFF comparison on.
4. Record the exact model, SoC/GPU, Android version, and RAM in §7 for every
   reading. A benchmark without the device identity recorded is not a data point.

---

## 2. Prerequisites & known gaps

### Toolchain
- Flutter 3.16+ / Dart ≥3.2 (`flutter --version`).
- `flutter pub get` succeeds (this branch adds `integration_test` +
  `flutter_driver` as **dev_dependencies** — they never ship in the release AAB;
  see §6 note).
- Android platform-tools on `PATH`: `adb`.
- **bundletool** (`bundletool` on `PATH`, or `java -jar bundletool.jar`) for the
  download-size measurement — https://github.com/google/android/bundletool.
- A USB-debugging-enabled device. Grab its serial once and reuse it:
  ```bash
  adb devices -l           # copy the serial of the physical device
  export DEVICE_ID=<serial-from-that-list>   # NOT an emulator serial
  ```
  (Every `flutter`/`adb` command below uses `-d "$DEVICE_ID"` / `-s
  "$DEVICE_ID"`. There is no hard-coded serial in this doc — you supply the real
  one.)

### Build secrets (dart-defines)
The app reads config via `--dart-define` (see `lib/core/constants/api_constants.dart`).
For profile/release builds on-device export the same vars `build_apk.sh` uses:
```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_ANON_KEY="<anon-key>"
export RAZORPAY_KEY_ID="<rzp-key-id>"          # optional for benchmarking
```
and pass them through on every build command below. These are the **only**
secrets involved; all are already documented in `build_apk.sh`. Do not add new
undocumented secrets.

### Test account
Cold-start (§2.2), PSS (§2.4) and data (§2.5) exercise the **real** app, so you
need a **seeded pilot student account** (grade 6–12, some chapter/quiz history so
the dashboard and chapter list actually populate). The jank drivers (§2.3) do
**not** need an account — they inject synthetic data (see below).

### Known gap — no stable widget keys (recommended, not required)
`chapters_screen.dart` and `quiz_screen.dart` currently expose **no `Key`s** and
no `ListView` `contentType`. The jank drivers work today by targeting real
finders (`find.byType(Scrollable)`, and `find.text('A')` for the quiz option
letter the widget renders via `String.fromCharCode(65 + i)`) — **no fabricated
keys**. For long-term finder robustness it is *recommended* (a small, separate
change) to add:
- a `ValueKey('chapter-${ch.id}')` on each chapter row `GestureDetector`, and
- a `ValueKey('quiz-option-$i')` on each option tile `GestureDetector`.
Until then the drivers rely on widget type + rendered text, which is stable for
the current tree but would break if those texts change.

### Jank harness = network-free, deterministic
The drivers pump the **real** `ChaptersScreen` / `QuizScreen` widgets but
override their Riverpod providers with large in-memory datasets
(`integration_test/support/benchmark_harness.dart`): 60 synthetic chapters and a
20-question in-progress quiz. This measures Flutter's build+raster pipeline for
the shipping widget trees, not the network, and makes runs comparable.

---

## §2 PROTOCOL

Run all five subsections. Budgets are the Option-A pass bar.

### 2.1 Download size per ABI  — budget ≤ 20 MB/ABI (hard ceiling 25); install ≤ 60 MB

Google Play delivers per-device ABIs from the AAB, so measure **download size**
per ABI+SDK from the bundle, not the raw APK on disk.

```bash
cd mobile

# 1. Release App Bundle + Flutter's size analysis (opens a treemap in DevTools).
flutter build appbundle --release --analyze-size \
  --target-platform android-arm64,android-arm,android-x64 \
  --dart-define=SUPABASE_URL="$SUPABASE_URL" \
  --dart-define=SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  --dart-define=RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-}"
# → build/app/outputs/bundle/release/app-release.aab
# → the --analyze-size JSON is written under ~/.flutter-devtools/ ; note the
#   per-ABI code+asset breakdown it prints.

# 2. Turn the AAB into a device-targeted APK set.
bundletool build-apks \
  --bundle=build/app/outputs/bundle/release/app-release.aab \
  --output=build/benchmark/app.apks --overwrite

# 3. DOWNLOAD size per ABI and per SDK level (this is the number that matters).
bundletool get-size total \
  --apks=build/benchmark/app.apks \
  --dimensions=ABI,SDK
```

Record the **arm64-v8a** and **armeabi-v7a** download sizes (the two ABIs Indian
pilot phones use). `get-size total` prints MIN/MAX bytes per dimension — record
MAX. **Fail** the ABI if MAX download > 25 MB; **flag** if > 20 MB. Also record
the installed on-device size (`adb shell pm path com.alfanumrik.student` → `du` the
base+split APKs, or Settings → Apps → Alfanumrik → Storage); **fail** if install
> 60 MB.

### 2.2 Cold start  — budget ≤ 1.8 s cold, ≤ 700 ms warm (median of 10)

Cold start MUST be measured with a **profile (or release) build ON THE PHYSICAL
DEVICE — never an emulator.** `--trace-startup` writes `start_up_info.json` with
the key metric `timeToFirstFrameRasterized` (microseconds).

```bash
cd mobile
# Kill the app so each run is a true COLD start.
adb -s "$DEVICE_ID" shell am force-stop com.alfanumrik.student

flutter run --profile --trace-startup -d "$DEVICE_ID" \
  --dart-define=SUPABASE_URL="$SUPABASE_URL" \
  --dart-define=SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
# On first frame it writes: build/start_up_info.json
# Read timeToFirstFrameRasterized (µs) → ms.
```

- Repeat **10 times**, force-stopping between runs, and take the **median** of
  `timeToFirstFrameRasterized`. (`--trace-startup` re-runs the whole boot;
  `main.dart` does Sentry + Hive + `Supabase.initialize()` before `runApp`, so
  this number includes real init — that is intentional; it is what a student
  feels.)
- **Warm start** (process already resident, Activity re-created): background the
  app (Home), then:
  ```bash
  adb -s "$DEVICE_ID" shell am start -W \
    -n com.alfanumrik.student/com.alfanumrik.student.MainActivity
  ```
  Record `WaitTime` (ms). Median of 10; budget ≤ 700 ms.

> Cross-check `start_up_info.json` against `flutter run`'s console
> "first frame rasterized" line — they should agree within noise.

### 2.3 Jank  — budget < 1% of frames > 16.67 ms (P95), chapter list + quiz scroll

Run each driver on the device in **profile** mode with Skia/GPU tracing on:

```bash
cd mobile

# Chapter list scroll
flutter drive \
  --driver=test_driver/perf_driver.dart \
  --target=integration_test/chapter_list_scroll_perf_test.dart \
  --profile --trace-skia -d "$DEVICE_ID"

# Quiz surface scroll + question paging
flutter drive \
  --driver=test_driver/perf_driver.dart \
  --target=integration_test/quiz_scroll_perf_test.dart \
  --profile --trace-skia -d "$DEVICE_ID"
```

Each run writes, under `mobile/build/benchmark/`:
- `<key>.timeline.json` — raw trace,
- `<key>.timeline_summary.json` — Flutter's averages/percentiles + the
  `frame_build_times` / `frame_rasterizer_times` arrays,
- **`<key>_jank.json`** — the augmented report the driver computes:
  `build_p95_millis`, `raster_p95_millis`, `build_pct_over_budget`,
  `raster_pct_over_budget`, and `verdict` (PASS if **both** build and raster have
  < 1% of frames over 16.67 ms).

Keys are `chapter_list_scroll_timeline` and `quiz_scroll_timeline`. Record the
two `*_pct_over_budget` numbers and the P95s in §7. **Fail** the surface if
either thread has ≥ 1% of frames over budget.

### 2.4 PSS memory  — budget ≤ 180 MB, mid learning-session

While the app is in an active learning session (open a subject → chapter list →
a topic → start a 10-question quiz, i.e. real usage), sample PSS:

```bash
adb -s "$DEVICE_ID" shell dumpsys meminfo com.alfanumrik.student | sed -n '1,25p'
```

Record the **TOTAL PSS** line (KB → MB). Sample 3× across the session and record
the **max**. **Fail** if > 180 MB.

### 2.5 Data / session  — budget ≤ 2 MB post-first-sync, excluding Foxy, 30-min session

Measure the network bytes a **30-minute learning session** costs *after* the
first sync (so we exclude the one-time cold cache fill), and **excluding Foxy**
(do NOT open the AI tutor during the window — LLM streaming is not representative
of baseline sync cost).

```bash
# Resolve the app's UID once.
adb -s "$DEVICE_ID" shell dumpsys package com.alfanumrik.student | grep userId=

# Baseline snapshot, THEN use the app normally for ~30 min (browse chapters,
# take a couple of quizzes; do NOT open Foxy), THEN snapshot again.
adb -s "$DEVICE_ID" shell dumpsys netstats detail | \
  grep -A2 -i "uid=<that-uid>"
```

Record rx+tx delta between the two snapshots (bytes → MB). First launch of the
day includes the cold cache fill — take that as a separate "first-sync" number
and measure the 2 MB budget on the **subsequent** 30-min window. **Fail** if the
post-first-sync 30-min window exceeds 2 MB (Foxy excluded).

> Note for step 5: the 5-min→7-day cache change (§6) should *reduce* this number
> because cold starts stop re-fetching chapters/dashboard every session. Record
> before/after here too.

---

## 5. A-vs-B TRIPWIRE — Impeller ON vs OFF on an OLD GPU  *(first-class section)*

This is the section that decides Option A vs Option B. Run the **§2.3 jank
drivers TWICE on the older Adreno/Mali handset** — once with Impeller (the
default renderer), once forced OFF (Skia) — and compare.

**Renderer default.** On Flutter 3.16+, Android uses **Impeller** where the
device supports Vulkan; older GPUs fall back automatically. To force **Skia
(Impeller OFF)** for the comparison, either pass the CLI flag or set the manifest
meta-data. The manifest meta-data is what actually ships, so it is the
authoritative lever for a "shipped-config" reading:

```bash
# Impeller ON (default) — just run the §2.3 drivers as-is:
flutter drive --driver=test_driver/perf_driver.dart \
  --target=integration_test/chapter_list_scroll_perf_test.dart \
  --profile --trace-skia -d "$DEVICE_ID"
flutter drive --driver=test_driver/perf_driver.dart \
  --target=integration_test/quiz_scroll_perf_test.dart \
  --profile --trace-skia -d "$DEVICE_ID"

# Impeller OFF (Skia) — add --no-enable-impeller to the SAME two commands:
flutter drive --driver=test_driver/perf_driver.dart \
  --target=integration_test/chapter_list_scroll_perf_test.dart \
  --profile --trace-skia --no-enable-impeller -d "$DEVICE_ID"
flutter drive --driver=test_driver/perf_driver.dart \
  --target=integration_test/quiz_scroll_perf_test.dart \
  --profile --trace-skia --no-enable-impeller -d "$DEVICE_ID"
```

Equivalent **shipped-config** toggle (test the artifact the way users get it) —
add inside `<application>` in
`android/app/src/main/AndroidManifest.xml`, build, run the drivers, then REVERT:
```xml
<meta-data
    android:name="io.flutter.embedding.android.EnableImpeller"
    android:value="false" />
```
(There is no Impeller meta-data in the manifest today — it uses the engine
default — so this is a clean, temporary override. Do not commit it.)

Save the four `*_jank.json` files under distinct names, e.g.
`chapter_list_impellerON_jank.json` / `chapter_list_impellerOFF_jank.json`, etc.

### Decision rule (the tripwire)

| Chapter list & quiz jank result | Interpretation | Decision |
|---|---|---|
| Jank **survives BOTH** renderers (≥1% over budget with Impeller AND Skia) | **Structural** — the widget trees / layout cost themselves are too heavy for this GPU | **Hard constraint → reconsider native (Option B)** for the affected surface |
| Jank appears under **only one** renderer, clean under the other | **Renderer-config** issue | **Stay on Flutter (Option A)** — pin the good renderer (manifest meta-data) and file the engine-side issue |
| Clean under **both** | No jank problem | **Stay on Option A**; jank is not the bottleneck — look at cold start / data instead |

Record all four readings in §7. The tripwire verdict is the headline output of
this whole runbook.

---

## 6. TTL-change cold-start delta — before/after hook for step 5

Step 5 changes the client cache TTL from **5 minutes** to a **7-day
version-anchored** cache. Today the TTL lives at
`lib/core/constants/api_constants.dart` → `cacheMaxAge = Duration(minutes: 5)`
(and the Hive `cache_manager`). Because 5 minutes expires between most sessions,
nearly every cold start re-fetches dashboard/chapters over the network — so a big
chunk of cold-start-to-interactive is **network-bound, not renderer-bound.** This
section isolates the two so step 5's win (and any renderer work) don't get
confused.

Measure cold start (§2.2 method, median of 10) in **four** conditions and record
the deltas:

| # | Build | Cache state at launch | What it isolates |
|---|---|---|---|
| B1 | BEFORE (current 5-min TTL) | **Cold/expired** cache (wait >5 min, or clear app storage, since last use) | Renderer + full network cold start |
| B2 | BEFORE (current 5-min TTL) | **Warm** cache (relaunch within 5 min of a prior session) | Renderer + cache-served start |
| A1 | AFTER (7-day version-anchored) | **Cold/expired** (or bumped app version to invalidate) | Renderer + version-check cold start |
| A2 | AFTER (7-day version-anchored) | **Warm** (within TTL, same app version) | Renderer + cache-served start |

Clear storage to force a cold cache:
```bash
adb -s "$DEVICE_ID" shell pm clear com.alfanumrik.student   # wipes cache + login
```
(Re-login needed after `pm clear`. For a warm-cache reading, DON'T clear —
just relaunch.)

Interpretation:
- **`B1 − B2`** = the network-bound cold-start cost the 5-min TTL forces today.
- **`A1 − A2`** ≈ near-zero if the 7-day cache is doing its job (a warm-version
  launch should hit cache, not network).
- **`B1 − A1`** = the cold-start win step 5 delivers.
- Whatever remains in **A2** is the **renderer/init floor** — that is the number
  Option A's renderer work (and §5) must move; the TTL change cannot.

Record all four medians + the three deltas in §7 so step 5 has a clean
before/after and we never attribute a network win to the renderer (or vice
versa).

> **Note on measurement granularity.** `timeToFirstFrameRasterized` captures
> first *frame*, not first *data*. The network-bound cost shows up in
> time-to-**content** (dashboard populated), which is a few frames later. For a
> clean before/after, also capture time-to-content via a screen recording
> (`adb -s "$DEVICE_ID" shell screenrecord /sdcard/cold.mp4`, pull, count frames
> to first populated dashboard). Recommended follow-up for step 5: add a single
> `dart:developer` `Timeline.instantSync('dashboard_data_ready')` marker where
> the dashboard first renders real data, so this becomes a one-line trace read
> instead of a video frame-count.

---

## 7. Results table (fill on-device)

Device: __________ (model / SoC+GPU / Android __ / RAM __ GB) — Impeller default: ______

| Metric | Budget | Reading | Pass? |
|---|---|---|---|
| Download arm64-v8a | ≤20 MB (ceil 25) | | |
| Download armeabi-v7a | ≤20 MB (ceil 25) | | |
| Install size | ≤60 MB | | |
| Cold start (median/10) | ≤1.8 s | | |
| Warm start (median/10) | ≤700 ms | | |
| Chapter list jank (build / raster P95, %>budget) | <1% frames >16.67 ms | | |
| Quiz jank (build / raster P95, %>budget) | <1% frames >16.67 ms | | |
| PSS (max, mid-session) | ≤180 MB | | |
| Data / 30-min (post-first-sync, no Foxy) | ≤2 MB | | |

**§5 Tripwire (old-GPU device):**

| Surface | Impeller ON %>budget | Impeller OFF %>budget | Verdict (structural / renderer-config / clean) |
|---|---|---|---|
| Chapter list | | | |
| Quiz | | | |

**§6 TTL delta (cold start, median/10):**

| B1 (before, cold) | B2 (before, warm) | A1 (after, cold) | A2 (after, warm) | B1−B2 (network cost) | B1−A1 (step-5 win) | A2 (renderer floor) |
|---|---|---|---|---|---|---|
| | | | | | | |

**Option A verdict:** ______  (Option A holds if all §2 budgets pass AND §5 is
not "structural on both renderers".)

---

## 8. CI integration note

- `integration_test` + `flutter_driver` are **dev_dependencies** → **zero** APK /
  method-count impact on the shipping release AAB (they exist only in the
  throwaway `--profile` build `flutter drive` creates).
- `flutter drive` needs a real device/emulator, so the jank drivers run on a
  **self-hosted device runner** or Firebase Test Lab, not the standard hosted CI
  box. Wire them as a nightly/pre-release job that fails if any `*_jank.json`
  `verdict` is `FAIL`, and archives `build/benchmark/**` as an artifact.
- The synthetic-data harness means the jank drivers need **no** backend/secrets —
  only a device. The cold-start / PSS / data sections (§2.2/2.4/2.5) need a
  seeded account and are operator-run, not CI-gated.
- `flutter analyze` / `flutter test` still run on hosted CI as usual; they cover
  the harness Dart for compile-correctness even though they can't drive a device.
