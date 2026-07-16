/* Kunoch Command service worker — app shell caching.
   Network-first so updates always win; cache fallback for offline open.
   API calls (api.anthropic.com) are never cached. */
var CACHE = 'kunoch-v3-2';
var SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.indexOf(self.location.origin) !== 0) return; /* never intercept API or CDN calls */
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (m) { return m || caches.match('./index.html'); });
    })
  );
});
