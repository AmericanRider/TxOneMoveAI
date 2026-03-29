// TxOneMove Service Worker
// Strategie: Network-first mit Fallback auf Cache (immer aktuellste Version wenn online)

const CACHE_NAME = 'txonemove-v1';

// Alle lokalen Ressourcen die gecacht werden sollen
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon/icon-72x72.png',
  './icon/icon-96x96.png',
  './icon/icon-128x128.png',
  './icon/icon-144x144.png',
  './icon/icon-152x152.png',
  './icon/icon-167x167.png',
  './icon/icon-180x180.png',
  './icon/icon-192x192.png',
  './icon/icon-256x256.png',
  './icon/icon-384x384.png',
  './icon/icon-512x512.png',
  './icon/apple-touch-icon.png'
];

// Externe CDN-Ressourcen (Leaflet)
const CDN_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-control-compass/dist/leaflet-compass.min.css',
  'https://unpkg.com/leaflet-control-compass/dist/leaflet-compass.min.js'
];

// ── INSTALL: Pre-Cache alle App-Ressourcen ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Lokale Dateien zuverlässig cachen
      const localPromises = PRECACHE_URLS.map(url =>
        cache.add(url).catch(err => console.warn(`[SW] Pre-cache fehlgeschlagen: ${url}`, err))
      );
      // CDN-Ressourcen cachen (kein CORS-Problem bei GET)
      const cdnPromises = CDN_URLS.map(url =>
        fetch(url, { mode: 'cors' })
          .then(resp => cache.put(url, resp))
          .catch(err => console.warn(`[SW] CDN-Cache fehlgeschlagen: ${url}`, err))
      );
      return Promise.all([...localPromises, ...cdnPromises]);
    }).then(() => {
      console.log('[SW] Install abgeschlossen, Pre-Cache gefüllt');
      return self.skipWaiting(); // Sofort aktivieren
    })
  );
});

// ── ACTIVATE: Alte Caches löschen ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Alter Cache gelöscht:', name);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim()) // Alle Tabs sofort übernehmen
  );
});

// ── FETCH: Network-first Strategie ─────────────────────────────────────────
// Online → holt von Netzwerk, aktualisiert Cache
// Offline → liefert aus Cache
self.addEventListener('fetch', event => {
  // Nur GET-Requests behandeln (keine BLE / WebBluetooth)
  if (event.request.method !== 'GET') return;

  // Map tile requests: Cache-first mit Netzwerk-Fallback (Karte offline nutzen)
  if (event.request.url.includes('tile.openstreetmap.org')) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // Alles andere: Network-first (immer neueste Version wenn online)
  event.respondWith(networkFirst(event.request));
});

// Network-first: versucht Netzwerk, bei Fehler → Cache
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    // Nur erfolgreiche Responses cachen
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Offline → Cache
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    // Absoluter Fallback: index.html (für Navigation)
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    return new Response('Offline – keine Verbindung', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// Cache-first für Map-Kacheln (spart Bandbreite, Karte bleibt offline nutzbar)
async function tileStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── MESSAGE: Manuelles Cache-Update vom Main-Thread ────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
