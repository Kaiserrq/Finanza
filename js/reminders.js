// Recordatorios de pago: cálculos de fechas y textos de los avisos.
// La función de Supabase (supabase/functions/send-reminders) usa las mismas reglas.
import { pad, todayISO } from './ui.js';

/** Días de aviso antes de la fecha de pago (además del propio día). */
export const DAYS_BEFORE = 3;

const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Días que faltan para `iso` (negativo si ya pasó). */
export const daysUntil = (iso, from = todayISO()) => Math.round((toUTC(iso) - toUTC(from)) / 86_400_000);

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86_400_000);

/** Mismo día en el mes siguiente; si no existe (31 en un mes de 30), el último día del mes. */
export function nextMonthly(iso, anchorDay) {
  const [y, m] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m, 1)); // m ya es el mes siguiente (0-indexado)
  const Y = first.getUTCFullYear();
  const M = first.getUTCMonth();
  const last = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
  return `${Y}-${pad(M + 1)}-${pad(Math.min(anchorDay, last))}`;
}

/** paid | overdue (ya pasó) | soon (dentro de los días de aviso) | later */
export function statusOf(r, today = todayISO()) {
  if (r.paid) return 'paid';
  const d = daysUntil(r.date, today);
  if (d < 0) return 'overdue';
  return d <= DAYS_BEFORE ? 'soon' : 'later';
}

/** ¿Hoy toca enviar el aviso de este recordatorio? */
export const isAlertDay = (r, today = todayISO()) => {
  if (r.paid || r.deleted) return false;
  const d = daysUntil(r.date, today);
  return d >= 0 && d <= DAYS_BEFORE;
};

export function whenLabel(days) {
  if (days < -1) return `Venció hace ${-days} días`;
  if (days === -1) return 'Venció ayer';
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

export function shortDate(iso) {
  const txt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(toUTC(iso)))
    .replace(/\./g, '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export function longDate(iso) {
  const txt = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(toUTC(iso)));
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** Texto de la notificación. `amountText` ya viene formateado (o vacío). */
export function alertText(r, days, amountText) {
  const title =
    days === 0 ? `🔔 Hoy vence: ${r.title}`
    : days === 1 ? `⏰ Mañana vence: ${r.title}`
    : `💳 En ${days} días vence: ${r.title}`;
  const body = [amountText, `Pago: ${shortDate(r.date)}`, r.note].filter(Boolean).join(' · ');
  return { title, body: `${body}\nToca para marcarlo como pagado.` };
}

/** Etiqueta única por recordatorio y día: el mismo aviso nunca se repite el mismo día. */
export const alertTag = (r, today) => `rem-${r.id}-${today}`;
