// Capa de datos local (localStorage) + reglas para combinar datos entre dispositivos.
//
// Para poder sincronizar sin perder información:
//  - Cada registro tiene `updatedAt` (cuándo se modificó por última vez).
//  - Al borrar, el registro NO se elimina: se marca `deleted: true` ("lápida"),
//    así el borrado también llega a los demás dispositivos.
//  - Al combinar dos copias, por cada registro gana la versión más reciente.
const KEY = 'finanza:data:v1';

const DEFAULT_CATEGORIES = [
  { id: 'c-comida', name: 'Comida', type: 'expense', icon: '🍽️' },
  { id: 'c-transporte', name: 'Transporte', type: 'expense', icon: '🚌' },
  { id: 'c-vivienda', name: 'Vivienda', type: 'expense', icon: '🏠' },
  { id: 'c-servicios', name: 'Servicios', type: 'expense', icon: '💡' },
  { id: 'c-salud', name: 'Salud', type: 'expense', icon: '🩺' },
  { id: 'c-ocio', name: 'Ocio', type: 'expense', icon: '🎮' },
  { id: 'c-compras', name: 'Compras', type: 'expense', icon: '🛍️' },
  { id: 'c-educacion', name: 'Educación', type: 'expense', icon: '📚' },
  { id: 'c-otros-g', name: 'Otros gastos', type: 'expense', icon: '📦' },
  { id: 'c-salario', name: 'Salario', type: 'income', icon: '💼' },
  { id: 'c-extra', name: 'Ingresos extra', type: 'income', icon: '✨' },
  { id: 'c-otros-i', name: 'Otros ingresos', type: 'income', icon: '💰' },
].map((c) => ({ ...c, updatedAt: 0, deleted: false }));

const CURRENCIES = ['COP', 'MXN', 'PEN', 'CLP', 'ARS', 'USD', 'EUR'];
const THEMES = ['auto', 'light', 'dark'];

/** Hora local (0-23) a la que llegan los avisos de pago si no se ha elegido otra. */
export const DEFAULT_NOTIFY_HOUR = 9;
export const validHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;

export function emptyData() {
  return {
    version: 2,
    settings: { currency: 'COP', theme: 'auto', updatedAt: 0 },
    categories: structuredClone(DEFAULT_CATEGORIES),
    transactions: [],
    budgets: {},
    reminders: [],
    // Va aparte de `settings` (con su propio updatedAt): si una versión vieja de la app sube
    // datos sin este campo, la versión nueva conserva la hora elegida en vez de volver a las 9.
    notify: { hour: DEFAULT_NOTIFY_HOUR, updatedAt: 0 },
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const alive = (list) => list.filter((x) => !x.deleted);

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return normalize(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Valida y completa datos (al cargar, al importar un respaldo o al bajar de la nube).
 * Los registros inválidos se descartan; si pasas `report`, se cuentan en report.invalid.
 */
export function normalize(input, report = { invalid: 0 }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Formato inválido');
  const base = emptyData();

  let categories = [];
  if (Array.isArray(input.categories)) {
    for (const c of input.categories) {
      if (c && c.id && c.name && (c.type === 'expense' || c.type === 'income')) {
        categories.push({
          id: String(c.id),
          name: String(c.name).slice(0, 30),
          type: c.type,
          icon: c.icon ? String(c.icon).slice(0, 8) : '🏷️',
          updatedAt: +c.updatedAt || 0,
          deleted: !!c.deleted,
        });
      } else report.invalid++;
    }
  }
  if (!categories.length) categories = base.categories;

  const transactions = [];
  if (Array.isArray(input.transactions)) {
    for (const t of input.transactions) {
      if (t && t.id && Number.isFinite(+t.amount) && +t.amount !== 0 && isISODate(t.date)) {
        transactions.push({
          id: String(t.id),
          type: t.type === 'income' ? 'income' : 'expense',
          amount: Math.abs(+t.amount),
          categoryId: String(t.categoryId ?? ''),
          date: t.date,
          note: t.note ? String(t.note).slice(0, 80) : '',
          createdAt: +t.createdAt || 0,
          updatedAt: +t.updatedAt || +t.createdAt || 0,
          deleted: !!t.deleted,
        });
      } else report.invalid++;
    }
  }

  // Recordatorios de pago (calendario).
  const reminders = [];
  if (Array.isArray(input.reminders)) {
    for (const r of input.reminders) {
      if (r && r.id && r.title && isISODate(r.date)) {
        const day = Number(r.date.slice(8));
        reminders.push({
          id: String(r.id),
          title: String(r.title).slice(0, 60),
          amount: Number.isFinite(+r.amount) && +r.amount > 0 ? +r.amount : 0,
          categoryId: String(r.categoryId ?? ''),
          date: r.date,
          note: r.note ? String(r.note).slice(0, 120) : '',
          repeat: r.repeat === 'monthly' ? 'monthly' : 'none',
          // Día del mes original, para que "cada mes" vuelva al 31 después de un mes de 30 días.
          anchorDay: Math.min(31, Math.max(1, Math.round(+r.anchorDay) || day)),
          paid: !!r.paid,
          paidAt: +r.paidAt || 0,
          txId: r.txId ? String(r.txId) : '',
          nextId: r.nextId ? String(r.nextId) : '',
          createdAt: +r.createdAt || 0,
          updatedAt: +r.updatedAt || +r.createdAt || 0,
          deleted: !!r.deleted,
        });
      } else report.invalid++;
    }
  }

  const budgets = {};
  if (input.budgets && typeof input.budgets === 'object') {
    for (const [k, v] of Object.entries(input.budgets)) {
      // Versión 1 guardaba solo el número; versión 2 guarda { amount, updatedAt }.
      const amount = typeof v === 'number' ? v : +v?.amount;
      budgets[k] = { amount: amount > 0 ? amount : 0, updatedAt: +v?.updatedAt || 0 };
    }
  }

  const s = input.settings || {};
  const settings = {
    currency: CURRENCIES.includes(s.currency) ? s.currency : base.settings.currency,
    theme: THEMES.includes(s.theme) ? s.theme : base.settings.theme,
    updatedAt: +s.updatedAt || 0,
  };

  // Hora de los avisos de pago (la misma en todos los dispositivos de la cuenta).
  const n = input.notify || {};
  const notify = {
    hour: validHour(n.hour) ? n.hour : DEFAULT_NOTIFY_HOUR,
    updatedAt: +n.updatedAt || 0,
  };

  return { version: 2, settings, categories, transactions, budgets, reminders, notify };
}

// Elige la versión más reciente; si empatan, una regla fija para que todos los dispositivos coincidan.
function newest(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

const byId = (x, y) => (x.id < y.id ? -1 : 1);

function mergeById(listA, listB) {
  const map = new Map();
  for (const x of listA) map.set(x.id, x);
  for (const y of listB) map.set(y.id, newest(map.get(y.id), y));
  return [...map.values()];
}

/** Combina dos copias (ej. la local y la de la nube) sin perder cambios de ninguna. */
export function merge(a, b) {
  const budgets = {};
  for (const k of new Set([...Object.keys(a.budgets), ...Object.keys(b.budgets)])) {
    budgets[k] = newest(a.budgets[k], b.budgets[k]);
  }
  return {
    version: 2,
    settings: newest(a.settings, b.settings),
    categories: mergeById(a.categories, b.categories),
    transactions: mergeById(a.transactions, b.transactions).sort(byId),
    budgets,
    reminders: mergeById(a.reminders, b.reminders).sort(byId),
    notify: newest(a.notify, b.notify),
  };
}

/** Compara dos copias ignorando el orden de los registros. */
export function sameData(a, b) {
  const canon = (d) => JSON.stringify({
    ...d,
    categories: [...d.categories].sort(byId),
    transactions: [...d.transactions].sort(byId),
    reminders: [...d.reminders].sort(byId),
    budgets: Object.fromEntries(Object.entries(d.budgets).sort(([x], [y]) => (x < y ? -1 : 1))),
  });
  return canon(a) === canon(b);
}
