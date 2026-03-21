var CACHE_V = 'alfanumrik-v1';
var STATIC = CACHE_V + '-static';
var API = CACHE_V + '-api';
var SB = 'https://dxipobqngyfpqbbznojz.supabase.co';

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC).then(function(c) {
      return c.addAll(['/', '/manifest.json']);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(ks) {
      return Promise.all(
        ks.filter(function(k) {
          return k.startsWith('alfanumrik-') && k !== STATIC && k !== API;
        }).map(function(k) {
          return caches.delete(k);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET') {
    if (u.origin === SB && e.request.method === 'POST') {
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
  if (/\.(js|css|woff2?|png|jpg|svg|ico|webp)$/i.test(u.pathname)) {
    e.respondWith(
      caches.match(e.request).then(function(r) {
        return r || fetch(e.request).then(function(res) {
          if (res.ok) caches.open(STATIC).then(function(c) { c.put(e.request, res.clone()); });
          return res;
        }).catch(function() {
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }
  e.respondWith(
    fetch(e.request).then(function(res) {
      if (res.ok) caches.open(API).then(function(c) { c.put(e.request, res.clone()); });
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
