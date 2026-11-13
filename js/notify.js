// Notificaciones del sistema (celular / computador).
//
// Hay dos formas de que llegue un aviso:
//  1. Local: al abrir la app (o mientras está abierta) se muestran los avisos del día.
//     Funciona sin configurar nada, pero solo si abres la app.
//  2. Push: un servidor (función de Supabase) los envía cada día a la hora elegida
//     (9:00 a. m. por defecto), aunque la app esté cerrada. Requiere docs/NOTIFICACIONES.md.
//
// Los avisos ya mostrados se anotan en Cache Storage, que comparten la página y el
// service worker, para no repetir el mismo aviso dos veces el mismo día.
import { VAPID_PUBLIC_KEY } from './config.js';

/** 9 → "9:00 a. m.", 13 → "1:00 p. m.", 0 → "12:00 a. m." */
export const hourLabel = (h) => `${h % 12 || 12}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`;

const LOG_CACHE = 'finanza-notified';
const PUSH_KEY = 'finanza:push-endpoint';

export const supported = () => 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const pushConfigured = () => Boolean(VAPID_PUBLIC_KEY);
export const pushSupported = () =>
  pushConfigured() && 'serviceWorker' in navigator && 'PushManager' in window && location.protocol.startsWith('http');

/** Endpoint push guardado en el servidor desde este dispositivo (o null). */
export const pushEndpoint = () => { try { return localStorage.getItem(PUSH_KEY); } catch { return null; } };
const setPushEndpoint = (v) => { try { v ? localStorage.setItem(PUSH_KEY, v) : localStorage.removeItem(PUSH_KEY); } catch {} };

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  return Notification.requestPermission();
}

export async function show(title, options = {}) {
  const opts = { icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', ...options };
  let reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  // La primera vez que se abre la app el service worker puede estar instalándose: se espera un poco.
  if (!reg && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
  }
  // En Android solo funciona a través del service worker.
  if (reg) return reg.showNotification(title, opts);
  new Notification(title, opts);
}

// ---- Registro de avisos ya mostrados ----
const logURL = (tag) => new URL(`__notified/${tag}`, document.baseURI).href;

export async function wasShown(tag) {
  try {
    const c = await caches.open(LOG_CACHE);
    return Boolean(await c.match(logURL(tag)));
  } catch {
    try { return localStorage.getItem('finanza:n:' + tag) === '1'; } catch { return false; }
  }
}

export async function markShown(tag) {
  try {
    const c = await caches.open(LOG_CACHE);
    await c.put(logURL(tag), new Response('1'));
  } catch {
    try { localStorage.setItem('finanza:n:' + tag, '1'); } catch {}
  }
}

/** Borra del registro los avisos de hace más de una semana. */
export async function pruneLog(isOld) {
  try {
    const c = await caches.open(LOG_CACHE);
    for (const req of await c.keys()) {
      const date = req.url.slice(-10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isOld(date)) await c.delete(req);
    }
  } catch {}
}

// ---- Push ----
function b64urlToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

const sameKey = (buf, bytes) => {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((x, i) => x === bytes[i]);
};

/** Suscribe este dispositivo a push y devuelve la suscripción (JSON). */
export async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const key = b64urlToBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  // Si cambiaste las llaves VAPID, la suscripción vieja ya no sirve.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}

export function rememberPush(endpoint) { setPushEndpoint(endpoint); }

export async function unsubscribePush() {
  setPushEndpoint(null);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {}
}
