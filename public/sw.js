/* Alfanumrik Service Worker – v2 (production) */
var CACHE_VERSION = 2;
var STATIC = 'alfanumrik-static-v' + CACHE_VERSION;
var API = 'alfanumrik-api-v' + CACHE_VERSION;
var CACHE_NAMES = [STATIC, API];

/* Pre-cache essential shell assets */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC).then(function(c) {
      return c.addAll(['/', '/manifest.json']);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* Clean up old caches on activate */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(ks) {
      return Promise.all(
        ks.filter(function(k) {
          return k.startsWith('alfanumrik-') && CACHE_NAMES.indexOf(k) === -1;
        }).map(function(k) {
          return caches.delete(k);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* Detect Supabase API requests by URL pattern (no hardcoded domain) */
function isSupabaseRequest(url) {
  return url.hostname.endsWith('.supabase.co');
}

/* Fetch strategy */
self.addEventListener('fetch', function(e) {
  var u = new URL(e.request.url);

  /* Non-GET: try network, queue for offline sync if Supabase POST */
  if (e.request.method !== 'GET') {
    if (isSupabaseRequest(u) && e.request.method === 'POST') {
      e.respondWith(
        fetch(e.request.clone()).catch(function() {
          return new Response(
            JSON.stringify({ offline: true, queued: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );
    }
    return;
  }

  /* Static assets: cache-first */
  if (/\.(js|css|woff2?|png|jpg|svg|ico|webp)$/i.test(u.pathname)) {
    e.respondWith(
      caches.match(e.request).then(function(r) {
        return r || fetch(e.request).then(function(res) {
          if (res.ok) {
            var clone = res.clone();
            caches.open(STATIC).then(function(c) { c.put(e.request, clone); });
          }
          return res;
        }).catch(function() {
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  /* API/page requests: network-first, cache fallback */
  e.respondWith(
    fetch(e.request).then(function(res) {
      if (res.ok && !isSupabaseRequest(u)) {
        var clone = res.clone();
        caches.open(API).then(function(c) { c.put(e.request, clone); });
      }
      return res;
    }).catch(function() {
      return caches.match(e.request).then(function(r) {
        return r || new Response(
          JSON.stringify({ error: 'Offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      });
    })
  );
});

/* Background sync */
self.addEventListener('sync', function(e) {
  if (e.tag === 'alfanumrik-sync') {
    e.waitUntil(
      self.clients.matchAll().then(function(cls) {
        cls.forEach(function(c) {
          c.postMessage({ type: 'TRIGGER_SYNC' });
        });
      })
    );
  }
});
