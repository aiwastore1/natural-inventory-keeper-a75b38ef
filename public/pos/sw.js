/* Offline-first service worker: precache the full app shell, cache-first for assets. */
const CACHE = "nc-inventory-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon.svg",
  "./css/variables.css",
  "./css/themes.css",
  "./css/reset.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/forms.css",
  "./css/tables.css",
  "./css/dashboard.css",
  "./css/pos.css",
  "./css/product-modal.css",
  "./css/responsive.css",
  "./data/seed-data.js",
  "./js/app.js",
  "./js/router.js",
  "./js/state.js",
  "./js/i18n.js",
  "./js/database.js",
  "./js/seed.js",
  "./js/jszip.min.js",
  "./js/components/ui.js",
  "./js/modules/domain.js",
  "./js/modules/views.js",
  "./js/modules/pos.js",
  "./js/modules/product-modal.js",
  "./js/modules/variants.js",
  "./js/modules/backup.js",
  "./js/modules/network.js",
  "./js/utils/format.js",
  "./js/utils/csv.js",
  "./js/utils/charts.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((res) => res.ok && caches.open(CACHE).then((c) => c.put(request, res.clone())))
          .catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((res) => {
          if (res.ok && new URL(request.url).origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
