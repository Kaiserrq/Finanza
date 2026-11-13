// Service worker: guarda la app en caché para que funcione sin internet.
// Cambia CACHE_VERSION cada vez que publiques cambios para forzar la actualización.
const CACHE_VERSION = 'finanza-v7';
// Registro de avisos ya mostrados (lo comparte con la app; no se borra al actualizar).
const LOG_CACHE = 'finanza-notified';
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
  './js/reminders.js',
  './js/notify.js',
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
      Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== LOG_CACHE).map((k) => caches.delete(k)))
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

// ===== Notificaciones push (avisos de pago enviados por Supabase) =====
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { body: event.data?.text() }; }
  const tag = p.tag || 'finanza';
  event.waitUntil((async () => {
    await self.registration.showNotification(p.title || 'Finanza', {
      body: p.body || '',
      tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: p.url || './#recordatorios' },
    });
    // Se anota para que la app no muestre el mismo aviso otra vez hoy.
    const log = await caches.open(LOG_CACHE);
    await log.put(new URL('__notified/' + tag, self.registration.scope).href, new Response('1'));
  })());
});

// Al tocar la notificación: abre la app (o la trae al frente) en el calendario.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './#recordatorios', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      win.postMessage({ type: 'open-view', view: 'recordatorios' });
      return win.focus();
    }
    return self.clients.openWindow(url);
  })());
});
