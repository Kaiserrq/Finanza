// Utilidades de interfaz: formato, fechas, aviso (toast) y tooltip.

const LOCALES = { COP: 'es-CO', MXN: 'es-MX', PEN: 'es-PE', CLP: 'es-CL', ARS: 'es-AR', USD: 'es-US', EUR: 'es-ES' };
const NO_DECIMALS = new Set(['COP', 'CLP']);
let fmtCache = null;

export function setCurrency(currency) {
  const locale = LOCALES[currency] || 'es';
  const digits = NO_DECIMALS.has(currency) ? 0 : 2;
  fmtCache = {
    full: new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: digits }),
    compact: new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }),
  };
}

export const money = (n) => fmtCache.full.format(n);
export const moneyCompact = (n) => fmtCache.compact.format(n);

/** Convierte texto como "25.000", "25,000.50" o "1.234,5" en número. */
export function parseAmount(text) {
  let s = String(text).replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastDot > -1 || lastComma > -1) {
    const sep = lastDot > -1 ? '.' : ',';
    const parts = s.split(sep);
    // Varias apariciones o grupo final de 3 dígitos => separador de miles.
    if (parts.length > 2 || parts[parts.length - 1].length === 3) s = parts.join('');
    else s = parts.join('.');
  }
  return Math.abs(parseFloat(s));
}

// ---- Fechas (siempre en hora local) ----
export const pad = (n) => String(n).padStart(2, '0');
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthKeyOf = (iso) => iso.slice(0, 7);
export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthName(key, style = 'long') {
  const [y, m] = key.split('-').map(Number);
  const opts = style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' };
  const txt = new Intl.DateTimeFormat('es', opts).format(new Date(y, m - 1, 1)).replace('.', '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const t = todayISO();
  if (iso === t) return 'Hoy';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (iso === `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`) return 'Ayer';
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'short' }).format(date);
}

// ---- Seguridad: escapar texto del usuario antes de insertarlo como HTML ----
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Aviso breve ----
let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2400);
}

// ---- Tooltip: cualquier elemento con data-tip (HTML ya escapado) ----
export function initTooltips() {
  const tip = document.getElementById('tooltip');
  let hideTimer;
  const show = (target, x, y) => {
    tip.innerHTML = target.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, x + 12), window.innerWidth - r.width - 8);
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target.closest('[data-tip]');
    if (t) show(t, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  // En pantallas táctiles: tocar muestra el tooltip unos segundos.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const t = e.target.closest('[data-tip]');
    clearTimeout(hideTimer);
    if (!t) { tip.hidden = true; return; }
    show(t, e.clientX, e.clientY);
    hideTimer = setTimeout(() => (tip.hidden = true), 2500);
  });
  window.addEventListener('scroll', () => (tip.hidden = true), { passive: true });
}
