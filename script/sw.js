/* FocusLab service worker: network first, falls back to cache so the app opens offline too. */
var CACHE = "focuslab-v1";
var SHELL = ["./", "index.html", "style/main.css", "script/main.js",
  "pages/tasks.html", "pages/video.html", "pages/notebook.html", "pages/notebook-app.html", "pages/friends.html"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET" || !r.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(r).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(r, copy); });
    return res;
  }).catch(function () { return caches.match(r).then(function (m) { return m || caches.match("index.html"); }); }));
});
