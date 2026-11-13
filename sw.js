// Service worker: guarda la app en caché para que funcione sin internet.
// Cambia CACHE_VERSION cada vez que publiques cambios para forzar la actualización.
const CACHE_VERSION = 'finanza-v4';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/ui.js',
  './js/csv.js',
  './js/sync.js',
  './js/config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Red primero (para ver cambios recientes), caché si no hay conexión.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nunca guardar en caché la base de datos ni el inicio de sesión: siempre en vivo.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
      )
  );
});
