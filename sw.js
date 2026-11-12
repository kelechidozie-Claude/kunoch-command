/* Kunoch Command v4 service worker — app shell only.
   Network-first so a deploy always wins; cache is the offline fallback.
   Calls to Supabase and the adviser are never intercepted or cached. */
var CACHE = 'kc4-4.0.0';
var SHELL = ['./', './index.html', './app.css', './app.js', './pdf.js', './manifest.json', './icon-192.png', './icon-512.png',
  './vendor/supabase.js', './vendor/jspdf.umd.min.js', './brand/insight360-logo.png', './brand/insight360-mark.png',
  './brand/Inter-Regular.ttf', './brand/Inter-SemiBold.ttf'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  if (e.request.method !== 'GET' || url.indexOf(self.location.origin) !== 0) return;
  if (url.indexOf('/legacy/') >= 0) return;
  e.respondWith(fetch(e.request).then(function (r) {
    if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (m) { return m || caches.match('./index.html'); });
  }));
});
