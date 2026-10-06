// sw.js — caches the app shell so the app opens instantly / offline. API calls always go to network.
//
// Shell files are always revalidated against the server (cache: 'reload' / 'no-cache') because
// GitHub Pages serves them with max-age=600 — without that, an updated config.js or app.js can
// sit stale in the browser's HTTP cache for 10 minutes even after a new SW version installs.
var CACHE = 'sg-data-v60';
var SHELL = ['./', './index.html', './style.css', './config.js', './app.js', './sheet.js', './defects.js', './phone.js', './home.js', './reports.js', './data.js', './hour.js', './wizard.js', './grid.js', './target.js', './mobile.js', './mpms.js', './mrev.js', './users.js', './staff.js', './pms.js', './report.js', './modules.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
// Phones open from the cache at once (the files are fetched again in the background for the next open; a new version
// also arrives through this SW's install). Computers keep asking the server first, as before.
var PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(self.navigator.userAgent || '');

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // API + POST -> network

  if (PHONE) {
    var net = fetch(new Request(e.request, { cache: 'no-cache' })).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      return res;
    });
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net.catch(function () { return caches.match('./index.html'); });
    }));
    return;
  }
  e.respondWith(
    fetch(new Request(e.request, { cache: 'no-cache' }))
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
