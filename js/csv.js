// Importación de movimientos desde un archivo CSV (Excel → "Guardar como → CSV").
// Cada fila se valida por separado: las filas con error NO se importan y se
// informan con su número de fila (el mismo que ves en Excel).
import { parseAmount } from './ui.js';

export const TEMPLATE_HEADER = ['Fecha', 'Tipo', 'Categoría', 'Monto', 'Nota'];

/** Texto sin tildes, en minúsculas y sin espacios extra (para comparar nombres). */
export const simplify = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Nombres de columna aceptados (sin tildes ni mayúsculas).
const COLUMN_ALIASES = {
  date: ['fecha', 'dia', 'date'],
  type: ['tipo', 'type', 'movimiento'],
  category: ['categoria', 'category', 'rubro'],
  amount: ['monto', 'valor', 'importe', 'cantidad', 'amount'],
  note: ['nota', 'notas', 'descripcion', 'detalle', 'concepto', 'note'],
};
const REQUIRED = { date: 'Fecha', type: 'Tipo', category: 'Categoría', amount: 'Monto' };

const TYPE_WORDS = {
  expense: ['gasto', 'gastos', 'g', 'egreso', 'egresos', 'salida', 'expense', '-'],
  income: ['ingreso', 'ingresos', 'i', 'entrada', 'income', '+'],
};

/** Lee CSV respetando comillas. Detecta si el separador es ";", "," o tabulador. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];

  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Acepta 2026-11-05, 05/11/2026, 5-11-2026, 05.11.26 … Devuelve AAAA-MM-DD o null. */
export function parseDate(raw) {
  const s = String(raw).trim();
  let y, m, d;
  let r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (r) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) [, d, m, y] = r;
  else return null;
  y = +y < 100 ? 2000 + +y : +y; m = +m; d = +d;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseType(raw) {
  const s = simplify(raw);
  if (TYPE_WORDS.expense.includes(s)) return 'expense';
  if (TYPE_WORDS.income.includes(s)) return 'income';
  return null;
}

/**
 * Analiza el CSV y devuelve qué se puede importar, sin modificar nada.
 * ctx: { categories, transactions } (solo los vigentes) y uid().
 */
export function analyzeCSV(text, ctx) {
  const result = { transactions: [], newCategories: [], duplicates: 0, errors: [], ignoredColumns: [], fatal: null };
  const rows = parseCSV(text);
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerIdx === -1) {
    result.fatal = 'El archivo está vacío.';
    return result;
  }

  // 1) Encabezados
  const header = rows[headerIdx].map(simplify);
  const col = {};
  header.forEach((h, i) => {
    const key = Object.keys(COLUMN_ALIASES).find((k) => COLUMN_ALIASES[k].includes(h));
    if (key && col[key] === undefined) col[key] = i;
    else if (h) result.ignoredColumns.push(rows[headerIdx][i].trim());
  });
  const missing = Object.keys(REQUIRED).filter((k) => col[k] === undefined).map((k) => REQUIRED[k]);
  if (missing.length) {
    result.fatal = `Falta${missing.length > 1 ? 'n' : ''} la${missing.length > 1 ? 's' : ''} columna${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
      `La primera fila debe tener los títulos: ${TEMPLATE_HEADER.join(' ; ')}`;
    return result;
  }

  // 2) Filas
  const catKey = (type, name) => `${type}|${simplify(name)}`;
  const catMap = new Map(ctx.categories.map((c) => [catKey(c.type, c.name), c]));
  const existing = new Set(ctx.transactions.map((t) => `${t.date}|${t.type}|${t.categoryId}|${t.amount}|${simplify(t.note)}`));
  const now = Date.now();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1; // igual que en Excel
    const get = (k) => (col[k] !== undefined ? (r[col[k]] ?? '').trim() : '');
    if (r.every((c) => c.trim() === '')) continue; // fila vacía: se ignora sin error

    const problems = [];
    const date = parseDate(get('date'));
    if (!get('date')) problems.push('la fecha está vacía');
    else if (!date) problems.push(`la fecha «${get('date')}» no es válida (usa DD/MM/AAAA o AAAA-MM-DD)`);

    const type = parseType(get('type'));
    if (!get('type')) problems.push('el tipo está vacío');
    else if (!type) problems.push(`el tipo «${get('type')}» no se reconoce (escribe Gasto o Ingreso)`);

    const catName = get('category').slice(0, 30);
    if (!catName) problems.push('la categoría está vacía');

    const amount = parseAmount(get('amount'));
    if (!get('amount')) problems.push('el monto está vacío');
    else if (!Number.isFinite(amount) || amount === 0) problems.push(`el monto «${get('amount')}» no es un número válido`);

    if (problems.length) {
      result.errors.push({ row: rowNum, msg: problems.join('; ') });
      continue;
    }

    let cat = catMap.get(catKey(type, catName));
    if (!cat) {
      cat = { id: 'c-' + ctx.uid(), name: catName, type, icon: '🏷️', updatedAt: now, deleted: false };
      catMap.set(catKey(type, catName), cat);
      result.newCategories.push(cat);
    }
    const note = get('note').slice(0, 80);
    const key = `${date}|${type}|${cat.id}|${amount}|${simplify(note)}`;
    if (existing.has(key)) {
      result.duplicates++;
      continue;
    }
    result.transactions.push({
      id: ctx.uid(), type, amount, categoryId: cat.id, date, note,
      createdAt: now + i, updatedAt: now, deleted: false,
    });
  }
  return result;
}

export function buildTemplate() {
  const rows = [
    TEMPLATE_HEADER,
    ['05/11/2026', 'Gasto', 'Comida', '45.000', 'Mercado de la semana'],
    ['01/11/2026', 'Ingreso', 'Salario', '3.500.000', 'Nómina noviembre'],
    ['07/11/2026', 'Gasto', 'Transporte', '12.500', ''],
  ];
  return '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
