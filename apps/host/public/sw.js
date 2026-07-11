/*
 * Alfanumrik service-worker retirement tombstone.
 *
 * Keep this script at /sw.js while legacy clients may still have the former
 * root-scoped worker installed. Browser update checks replace that worker with
 * this no-fetch tombstone, which removes only its own CacheStorage entries and
 * unregisters itself. Do not add a fetch handler here: pages, APIs, auth, and
 * writes must always use the network/runtime caching rules owned by Next.js.
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
