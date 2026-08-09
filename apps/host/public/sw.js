/*
 * Alfanumrik service-worker retirement tombstone.
 *
 * ── ALFANUMRIK IS INTENTIONALLY NOT A PWA TODAY ──────────────────────────
 * This is a deliberate product state, not an oversight or a regression.
 * Nothing in the app registers a service worker. This file is the only thing
 * ever served at /sw.js, it has NO fetch handler, and it unregisters itself.
 * Consequently the app is not installable, `beforeinstallprompt` never fires,
 * and there is no HTTP-cache-based offline mode. The manifest
 * (apps/host/public/manifest.json and the route that actually serves it,
 * apps/host/src/app/api/school-config/manifest/route.ts) is deliberately
 * metadata-only — `display: browser`, no orientation, no screenshots — so the
 * product does not advertise an install it cannot deliver.
 *
 * WHY: the legacy v3 worker cached JS/CSS cache-first with no expiry and
 * pre-cached the `/` shell, which served stale/broken app shells to installed
 * PWAs indefinitely (incident 2026-07-16, retired in commit 6ad1c8ff on
 * 2026-07-11). Cache invalidation for an auth'd, multi-tenant, exam-carrying
 * app is a real project, not a drive-by.
 *
 * DO NOT "helpfully" re-add a fetch handler here, and do not re-add
 * install-advertising manifest fields. Both are pinned by tests
 * (src/__tests__/service-worker-containment.test.ts,
 * src/__tests__/pwa-view-integrity.test.ts,
 * src/__tests__/api/school-config/manifest-route.test.ts — REG-259).
 *
 * WHAT REINTRODUCING OFFLINE WOULD TAKE (architect review required):
 *   1. A new worker path — /sw.js and the `alfanumrik-` cache prefix are
 *      reserved by this retirement machinery and must not be reused.
 *   2. A versioned, expiring cache strategy that never serves a stale app
 *      shell, and never caches authenticated API responses or writes.
 *   3. A kill switch (feature flag) and a tested unregister path, so the next
 *      retirement is a flag flip rather than another incident.
 *   4. Reconciliation with the IndexedDB offline work already in the tree —
 *      packages/lib/src/offline/store.ts + packages/ui/src/offline/v2/
 *      (OfflineBoundary, mounted in GlobalAppLayout behind `ff_offline_v2`,
 *      default OFF). That is the app's real offline story; it needs no
 *      service worker.
 *   5. Restoring the manifest install fields in BOTH manifest sources, and
 *      inverting the REG-259 pins back.
 * Runbook: docs/runbooks/pwa-stale-service-worker-recovery.md (section 8).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Keep this script at /sw.js while legacy clients may still have the former
 * root-scoped worker installed — deleting the file would strand devices that
 * have not yet picked up the tombstone via the browser's update check. Browser
 * update checks replace that worker with this no-fetch tombstone, which
 * removes only its own CacheStorage entries and unregisters itself. Pages,
 * APIs, auth, and writes must always use the network/runtime caching rules
 * owned by Next.js.
 */
var ALFANUMRIK_CACHE_PREFIX = 'alfanumrik-';

self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(cacheName) {
              return cacheName.startsWith(ALFANUMRIK_CACHE_PREFIX);
            })
            .map(function(cacheName) {
              return caches.delete(cacheName).catch(function() {
                return false;
              });
            })
        );
      })
      .catch(function() {
        // Client-side cleanup retries deletion on the next hydrated page.
        return undefined;
      })
      .then(function() {
        // Take control away from the retired fetch handler immediately. This
        // tombstone has no fetch listener, so requests pass through normally.
        return self.clients.claim().catch(function() {
          return undefined;
        });
      })
      .then(function() {
        return self.registration.unregister().catch(function() {
          return false;
        });
      })
  );
});
