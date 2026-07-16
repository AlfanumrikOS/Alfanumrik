# PWA Stale Service Worker Recovery Runbook

**Severity:** SEV-3 (Minor, self-healing) — affects only devices that installed the PWA before 2026-07-11. No data loss, no security impact; fresh browser visits are unaffected.
**Time to respond:** next business day for individual support tickets; escalate per Section 6 if fleet-wide decay stalls.
**On-call:** ops (support script) → frontend/architect (only per escalation criteria in Section 6).
**Scope:** Installed Alfanumrik PWA renders a stale, unstyled, or "desktop-looking" page while the same URL works fine in the normal browser.
**Related:** commit `6ad1c8ff` ("fix: retire unsafe service worker", 2026-07-11), `apps/host/public/sw.js` (retirement tombstone), `packages/lib/src/RegisterSW.tsx` (`ServiceWorkerCleanup` client mount), `apps/host/src/__tests__/service-worker-containment.test.ts` (containment pin).

## 1. Symptom & Triage

### What the student/parent reports
- The installed Alfanumrik app (home-screen icon / PWA) shows an **old version of the app**, a **broken or unstyled page** ("plain text", "desktop-looking view", "buttons don't work"), or generally looks nothing like what they see elsewhere.
- The problem persists across app restarts.
- **Crucially: the same pages work fine in the normal Chrome browser on the same device.**

### The key triage question

> **"Does the same page work if you open alfanumrik.com in the normal Chrome browser (not the installed app)?"**

| Answer | Diagnosis |
|---|---|
| Yes — browser fine, installed app broken | **This runbook.** Legacy service-worker cache. Proceed to Section 3. |
| No — broken in the browser too | **Not this runbook.** This is a live production issue — follow standard incident triage (Sentry, `/super-admin` control room, SRE_RUNBOOK.md). |

### Who is affected
Only devices that installed the PWA (or visited the site with the old service worker) **before 2026-07-11** and have not opened the app online since. New installs and fresh browser visits are never affected.

## 2. Root Cause (confirmed — do not re-investigate)

The legacy service worker (v3, registered at `/sw.js`, caches prefixed `alfanumrik-`) cached JS/CSS **cache-first with no expiry** and pre-cached the `/` shell. Devices carrying that worker can serve a stale app shell indefinitely inside the installed PWA, producing the broken/desktop-looking view. It was retired on **2026-07-11** in commit `6ad1c8ff`.

The deployed remedy (live in production):

1. **Tombstone worker** — `apps/host/public/sw.js` is a no-fetch retirement tombstone: `skipWaiting` → delete all `alfanumrik-*` caches → `clients.claim` → `unregister`. It has **no fetch handler**, so all requests pass through to the network.
2. **Client-side cleanup** — `ServiceWorkerCleanup` (mounted in the shared layout via `packages/lib/src/RegisterSW.tsx`) unregisters any remaining `/sw.js` registration, deletes `alfanumrik-*` caches, and triggers a bounded one-time reload (sessionStorage guard `alfanumrik-sw-retirement-reloaded-v1` — cannot loop).

Git-history verification: `/sw.js` was the **only** registration path ever shipped, and **every** cache name ever shipped starts with `alfanumrik-`, so the cleanup covers all legacy clients.

## 3. Self-Heal Expectation (default answer: no action needed)

Affected devices **fix themselves on the next app open with network access**: the browser's service-worker update check swaps the old worker for the tombstone, caches are purged, and the app reloads clean. This typically completes within one or two app opens.

**If the user can simply close and reopen the app while online, that is the entire fix.** Only walk through the manual steps in Section 4 if the user is blocked right now or the self-heal did not take after a couple of online opens.

## 4. Support Script (bilingual — P7)

Keep technical terms (PWA, Chrome, Clear data, alfanumrik.com) in English in both languages.

### Step 0 — Quickest fix (both languages)

**English:**
> Please close the Alfanumrik app completely, make sure your internet is on, and open the app again. In most cases this fixes it automatically within one or two opens. If it still looks broken, follow the steps below.

**Hindi (हिंदी):**
> कृपया Alfanumrik app को पूरी तरह बंद करें, इंटरनेट चालू है यह सुनिश्चित करें, और app को दोबारा खोलें। ज़्यादातर मामलों में यह एक-दो बार खोलने पर अपने आप ठीक हो जाता है। अगर फिर भी ठीक न दिखे, तो नीचे दिए गए स्टेप्स फॉलो करें।

### Step 1 — Android Chrome: Clear data for alfanumrik.com (primary path)

**English:**
> 1. Open the **Chrome** browser (not the Alfanumrik app).
> 2. Tap the three-dot menu (⋮) at the top right → **Settings**.
> 3. Tap **Site settings** → **Storage** (on some phones: **All sites**, then search).
> 4. Find and tap **alfanumrik.com**.
> 5. Tap **Clear data** (or the delete/bin icon) and confirm.
> 6. Close Chrome and the Alfanumrik app completely, then reopen the Alfanumrik app with internet on.
> 7. Log in again if asked. Your progress, XP, and subscription are safe — they are stored on our servers, not on the phone.

**Hindi (हिंदी):**
> 1. **Chrome** ब्राउज़र खोलें (Alfanumrik app नहीं)।
> 2. ऊपर दाईं ओर तीन-बिंदु मेनू (⋮) पर टैप करें → **Settings**।
> 3. **Site settings** → **Storage** पर टैप करें (कुछ फ़ोनों में: **All sites**, फिर खोजें)।
> 4. **alfanumrik.com** ढूंढें और उस पर टैप करें।
> 5. **Clear data** (या delete आइकन) पर टैप करें और confirm करें।
> 6. Chrome और Alfanumrik app दोनों को पूरी तरह बंद करें, फिर इंटरनेट चालू रखकर Alfanumrik app दोबारा खोलें।
> 7. अगर पूछा जाए तो दोबारा लॉगिन करें। आपकी प्रगति, XP और subscription सुरक्षित हैं — ये हमारे सर्वर पर सेव रहते हैं, फ़ोन पर नहीं।

### Step 2 — Fallback: Uninstall and reinstall the PWA

Use only if Step 1 did not work or the user cannot find the Chrome settings.

**English:**
> 1. Press and hold the **Alfanumrik** icon on your home screen.
> 2. Tap **Uninstall** (or drag it to "Uninstall") and confirm.
> 3. Open **Chrome** and go to **alfanumrik.com**. Check that the site looks correct — it should.
> 4. Tap the three-dot menu (⋮) → **Add to Home screen** / **Install app**.
> 5. Open the freshly installed app and log in. Everything will be up to date.

**Hindi (हिंदी):**
> 1. होम स्क्रीन पर **Alfanumrik** आइकन को दबाकर रखें।
> 2. **Uninstall** पर टैप करें (या आइकन को "Uninstall" पर खींचें) और confirm करें।
> 3. **Chrome** खोलें और **alfanumrik.com** पर जाएं। जांचें कि साइट सही दिख रही है — दिखनी चाहिए।
> 4. तीन-बिंदु मेनू (⋮) पर टैप करें → **Add to Home screen** / **Install app**।
> 5. नए इंस्टॉल किए गए app को खोलें और लॉगिन करें। सब कुछ अप-टू-डेट रहेगा।

### Reassurance to include in every reply

**English:**
> This only affects how the app is displayed on your phone. No progress, scores, XP, or payment information is lost — all of that is stored safely on our servers.

**Hindi (हिंदी):**
> यह समस्या केवल आपके फ़ोन पर app के दिखने के तरीके को प्रभावित करती है। आपकी कोई प्रगति, स्कोर, XP या भुगतान की जानकारी नहीं खोई है — यह सब हमारे सर्वर पर सुरक्षित है।

## 5. Monitoring — Fleet-Wide Recovery via PostHog

`ServiceWorkerCleanup` emits the PII-free PostHog event **`sw_legacy_cleanup`** (exact name — defined in `packages/lib/src/RegisterSW.tsx` and pinned by test / REG-259b). The event is **gated**: it fires **only when there was something to report** — `registrationsFound > 0 || cachesRemoved > 0 || failures > 0`. Healthy all-zero clients (the overwhelming majority) emit **nothing**. There is NO baseline heartbeat: low or zero absolute event volume is the expected steady state, not broken telemetry.

The payload carries exactly **six** numeric properties: `registrationsFound`, `unregisterAttempts`, `registrationsRemoved`, `cachesRemoved`, `reloadsTriggered`, `failures`.

### What recovery looks like
- **Absence of events = healthy fleet.** Clean clients emit no event at all, so total event volume is not a health signal and must not be treated as one.
- Still-affected legacy devices emit an event with `registrationsFound > 0`.
- **Fleet recovery = the daily count of events with `registrationsFound > 0` decays toward ~0 over days**, as legacy devices come online and self-heal.
- **Escalation signal = events with `failures > 0`** (the cleanup found something but could not fully remove it — see Section 6).

### PostHog query (Insights → SQL)
```sql
SELECT
  toStartOfDay(timestamp) AS day,
  countIf(toInt64OrZero(properties.registrationsFound) > 0) AS legacy_devices_seen,
  countIf(toInt64OrZero(properties.registrationsRemoved) > 0) AS healed,
  countIf(toInt64OrZero(properties.failures) > 0) AS with_failures
FROM events
WHERE event = 'sw_legacy_cleanup'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day DESC;
```

Do NOT count total rows as a "cleanup runs" baseline — every row already represents a client that had something to clean (or a failure), so there is no per-pageload denominator. Healthy pattern: `legacy_devices_seen` trends down day over day toward ~0; `healed` roughly tracks it; `with_failures` stays a small fraction of `legacy_devices_seen`. Days with zero rows are the end-state success condition.

## 6. Escalation Criteria

Escalate to **frontend + architect** (via orchestrator) if either holds:

1. **No decay after 14 days:** daily occurrences of `registrationsFound > 0` are flat or rising 14+ days after 2026-07-11 (i.e., from ~2026-07-25 onward) — suggests the tombstone or cleanup is not reaching some client cohort (e.g., a browser/WebView variant that never runs the SW update check).
2. **Failures dominate:** `failures > 0` on a majority of runs that also have `registrationsFound > 0` — the cleanup is finding legacy workers but failing to remove them; the bounded-reload guard means these devices will NOT self-heal and need code investigation.

Also escalate immediately (any single occurrence) if a report shows the **browser** view broken too — that is outside this runbook's scope and indicates a live production issue.

## 7. Prevention

- **The tombstone at `/sw.js` must never regain a `fetch` handler.** Any fetch handler at that path would re-capture legacy clients and could reintroduce indefinite cache-first serving. This is pinned by `apps/host/src/__tests__/service-worker-containment.test.ts` and regression catalog entry **REG-259** in `.claude/regression-catalog.md`.
- Keep `/sw.js` deployed indefinitely (or at minimum for as long as the PostHog decay curve shows legacy devices) — removing the file entirely would strand devices that haven't yet received the tombstone via the browser update check.
- `ServiceWorkerCleanup` must remain mounted in the shared layout so every role and tenant retries best-effort cleanup after hydration.
- Any future service-worker/offline strategy must go through architect review and must not reuse the `/sw.js` path or the `alfanumrik-` cache prefix (both are reserved by the retirement machinery).
