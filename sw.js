const CACHE_NAME = "diveatlas-shell-v23";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./samples/bajon-del-rio.uddf",
  "./samples/ss-thistlegorm.uddf",
  "./samples/locations.csv",
  "./icons/logo-192.png",
  "./icons/logo.png",
  "./images/welcome-dashboard.jpg",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
  "./vendor/leaflet.markercluster.js",
  "./vendor/MarkerCluster.css",
  "./vendor/MarkerCluster.Default.css",
  "./vendor/country-coder.js",
  "./vendor/images/layers.png",
  "./vendor/images/layers-2x.png",
  "./vendor/images/marker-icon.png",
  "./vendor/images/marker-icon-2x.png",
  "./vendor/images/marker-shadow.png",
  "./src/app.js",
  "./src/backup.js",
  "./src/config.js",
  "./src/country.js",
  "./src/db.js",
  "./src/importer.js",
  "./src/import-worker.js",
  "./src/map.js",
  "./src/parser.js",
  "./src/profile-chart.js",
  "./src/statistics-chart.js",
  "./src/theme.js",
  "./src/utils.js",
  "./src/view-model.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
