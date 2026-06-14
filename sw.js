/*
 * kcalc Service Worker
 * Macht die App als PWA offline-fähig.
 *
 * Strategie:
 *  - Navigationsanfragen: Network-First, Fallback auf gecachte index.html
 *    -> App startet auch ohne Netz.
 *  - Eigene statische Dateien (css/js/img/manifest): Stale-While-Revalidate
 *    -> sofort aus Cache, im Hintergrund aktualisiert.
 *  - CDN-Bibliotheken (jsdelivr, cdnjs, esm.sh): Stale-While-Revalidate
 *    -> beim ersten Online-Besuch gecacht, danach offline verfügbar.
 *  - Sync-/API-/OAuth-Anfragen (rxforge.de, CouchDB, Google): NICHT gecacht,
 *    laufen immer direkt ans Netz und scheitern offline bewusst.
 */

var CACHE_VERSION = 'kcalc-v1.7.1';
var APP_SHELL = [
    './',
    './index.html',
    './css/style.css',
    './css/print.css',
    './js/calc.js',
    './js/chart.js',
    './js/app.js',
    './img/favicon.svg',
    './img/icon-192.png',
    './img/icon-512.png',
    './manifest.json'
];

// Hosts deren Assets zur Laufzeit gecacht werden dürfen (statische Libs).
var RUNTIME_CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'esm.sh'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function (cache) {
            // addAll schlägt fehl wenn EINE Datei nicht lädt -> einzeln & tolerant.
            return Promise.all(APP_SHELL.map(function (url) {
                return cache.add(url).catch(function (err) {
                    console.warn('[sw] Precache übersprungen:', url, err);
                });
            }));
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== CACHE_VERSION) return caches.delete(key);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

function staleWhileRevalidate(request) {
    return caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(request).then(function (cached) {
            var network = fetch(request).then(function (response) {
                // status 200 = normale CORS-Antwort, type 'opaque' = Cross-Origin
                // <script src> ohne CORS (z.B. jsdelivr/cdnjs). Beide cachen, damit
                // alle Libs offline verfügbar sind.
                if (response && (response.status === 200 || response.type === 'opaque')) {
                    cache.put(request, response.clone());
                }
                return response;
            }).catch(function () { return cached; });
            return cached || network;
        });
    });
}

self.addEventListener('fetch', function (event) {
    var request = event.request;

    // Nur GET behandeln; POST/PUT (Sync, OAuth) immer ans Netz durchlassen.
    if (request.method !== 'GET') return;

    var url = new URL(request.url);

    // Navigationsanfragen -> Network-First mit App-Shell-Fallback.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(function () {
                return caches.match('./index.html').then(function (cached) {
                    return cached || caches.match('./');
                });
            })
        );
        return;
    }

    // Eigene Origin: Stale-While-Revalidate.
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // Erlaubte CDN-Libs: Stale-While-Revalidate.
    if (RUNTIME_CDN_HOSTS.indexOf(url.hostname) !== -1) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // Alles andere (Google GSI, rxforge.de, CouchDB ...) unverändert ans Netz.
});

// Erlaubt der Seite, ein sofortiges Update zu erzwingen.
self.addEventListener('message', function (event) {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
