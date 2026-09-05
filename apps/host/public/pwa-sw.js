/*
 * Alfanumrik installable PWA worker.
 *
 * This worker intentionally provides no HTTP cache or offline fallback. It
 * exists to support installability while preserving network-authoritative
 * authentication, API reads, and writes. Never add CacheStorage without a
 * reviewed expiry, invalidation, and rollback strategy.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-only: do not cache app shells, API responses, or mutations.
  event.respondWith(fetch(event.request));
});
