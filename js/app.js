import * as store from './storage.js';
import * as sync from './sync.js';
import { analyzeCSV, buildTemplate } from './csv.js';
import {
  setCurrency, money, moneyCompact, parseAmount, todayISO, monthKeyOf, shiftMonth,
  monthName, dayLabel, esc, toast, initTooltips,
} from './ui.js';

// ===== Estado =====
let data = store.load();
let currentMonth = monthKeyOf(todayISO());
let editingId = null;
const $ = (sel) => document.querySelector(sel);
const now = () => Date.now();

// Solo los registros vigentes (los borrados quedan como "lápidas" para sincronizar).
const txs = () => store.alive(data.transactions);
const cats = () => store.alive(data.categories);
const budgetOf = (id) => data.budgets[id]?.amount || 0;

const catById = (id) =>
  data.categories.find((c) => c.id === id) || { id, name: 'Sin categoría', icon: '🏷️', type: 'expense' };

function persist() {
  if (!store.save(data)) toast('No se pudo guardar (almacenamiento lleno o bloqueado)');
  render();
  scheduleSync();
}

function txOfMonth(key) {
  return txs().filter((t) => monthKeyOf(t.date) === key);
}

function sumBy(list, type) {
  return list.reduce((s, t) => (t.type === type ? s + t.amount : s), 0);
}

// Color suave y estable para el ícono de cada categoría.
const TINTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
function tintOf(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

const sortTx = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

// ===== Tema =====
function applyTheme() {
  const t = data.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ===== Render principal =====
function render() {
  setCurrency(data.settings.currency);
  $('#monthLabel').textContent = monthName(currentMonth);
  $('.amount-prefix').textContent = data.settings.currency === 'EUR' ? '€' : '$';
  renderSummary();
  renderTransactions();
  renderBudgets();
  renderSettings();
}

function signedClass(n) {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
}

function renderSummary() {
  const list = txOfMonth(currentMonth);
  const all = txs();
  const inc = sumBy(list, 'income');
  const exp = sumBy(list, 'expense');
  const bal = inc - exp;
  const total = sumBy(all, 'income') - sumBy(all, 'expense');

  $('#statIncome').textContent = money(inc);
  $('#statExpense').textContent = money(exp);
  const balEl = $('#statBalance');
  balEl.textContent = (bal > 0 ? '+' : '') + money(bal);
  balEl.className = 'balance-value ' + signedClass(bal);
  $('#statTotal').textContent = money(total);
  $('#heroMonth').textContent = monthName(currentMonth);

  // Tasa de ahorro: qué parte de los ingresos del mes no se gastó.
  const rate = inc > 0 ? Math.round((bal / inc) * 100) : 0;
  $('#statRate').textContent = inc > 0 ? `${rate}%` : '—';
  $('#rateBar').style.width = `${Math.max(0, Math.min(100, rate))}%`;
  $('#rateHint').textContent =
    inc === 0 ? 'Registra tus ingresos para calcularla'
    : rate >= 20 ? '¡Excelente! Ahorras más del 20%'
    : rate >= 0 ? 'Meta sugerida: ahorrar al menos el 20%'
    : 'Este mes gastas más de lo que ganas';

  renderCategoryChart(list, exp);
  renderTrendChart();

  const recent = [...all].sort(sortTx).slice(0, 5);
  $('#recentList').innerHTML = recent.length
    ? recent.map(txItemHTML).join('')
    : '<li class="empty"><span class="empty-ico">🌱</span>Aún no hay movimientos.<br>Toca <b>+</b> para agregar el primero.</li>';
}

function renderCategoryChart(list, totalExp) {
  const totals = new Map();
  for (const t of list) if (t.type === 'expense') totals.set(t.categoryId, (totals.get(t.categoryId) || 0) + t.amount);
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const el = $('#categoryChart');
  if (!rows.length) {
    el.innerHTML = '<p class="empty"><span class="empty-ico">📊</span>Sin gastos este mes.</p>';
    return;
  }
  const max = rows[0][1];
  el.innerHTML = rows
    .map(([id, amt]) => {
      const c = catById(id);
      const pct = totalExp ? Math.round((amt / totalExp) * 100) : 0;
      const tip = `<b>${esc(c.icon)} ${esc(c.name)}</b>${esc(money(amt))} · ${pct}% del gasto`;
      return `<div class="hbar-row" data-tip="${esc(tip)}">
        <span class="hbar-name">${esc(c.icon)} ${esc(c.name)}</span>
        <span class="hbar-track">
          <span class="hbar-fill" style="width:${(amt / max) * 100}%"></span>
          <span class="hbar-val" style="left:${(amt / max) * 100}%">${esc(moneyCompact(amt))}</span>
        </span>
      </div>`;
    })
    .join('');
}

function renderTrendChart() {
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth, i - 5));
  const series = months.map((m) => {
    const l = txOfMonth(m);
    return { m, inc: sumBy(l, 'income'), exp: sumBy(l, 'expense') };
  });
  const max = Math.max(1, ...series.flatMap((s) => [s.inc, s.exp]));
  $('#trendChart').innerHTML = series
    .map((s) => {
      const tip = `<b>${esc(monthName(s.m))}</b>Ingresos: ${esc(money(s.inc))}<br>Gastos: ${esc(money(s.exp))}<br>Balance: ${esc(money(s.inc - s.exp))}`;
      return `<div class="vbar-col" data-tip="${esc(tip)}">
        <div class="vbar-pair">
          <span class="vbar income" style="height:${(s.inc / max) * 100}%"></span>
          <span class="vbar expense" style="height:${(s.exp / max) * 100}%"></span>
        </div>
        <span class="vbar-label">${esc(monthName(s.m, 'short'))}</span>
      </div>`;
    })
    .join('');
}

function txItemHTML(t) {
  const c = catById(t.categoryId);
  const sign = t.type === 'income' ? '+' : '−';
  const cls = t.type === 'income' ? 'pos' : '';
  const sub = [dayLabel(t.date), t.note].filter(Boolean).join(' · ');
  return `<li class="tx-item" data-id="${esc(t.id)}" tabindex="0">
    <span class="tx-icon" style="--tint:${tintOf(c.id)}">${esc(c.icon)}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(c.name)}</span>
      <span class="tx-sub">${esc(sub)}</span>
    </span>
    <span class="tx-amount ${cls}">${sign}${esc(money(t.amount))}</span>
  </li>`;
}

function renderTransactions() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const type = $('#typeFilter').value;
  const list = txOfMonth(currentMonth)
    .filter((t) => type === 'all' || t.type === type)
    .filter((t) => !q || t.note.toLowerCase().includes(q) || catById(t.categoryId).name.toLowerCase().includes(q))
    .sort(sortTx);

  const el = $('#txGroups');
  if (!list.length) {
    el.innerHTML = `<div class="card"><p class="empty">No hay movimientos en ${esc(monthName(currentMonth))}.</p></div>`;
    return;
  }
  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  el.innerHTML = [...groups.entries()]
    .map(([date, items]) => {
      const net = sumBy(items, 'income') - sumBy(items, 'expense');
      return `<div>
        <div class="group-head"><span>${esc(dayLabel(date))}</span><span>${esc(money(net))}</span></div>
        <div class="card"><ul class="tx-list">${items.map(txItemHTML).join('')}</ul></div>
      </div>`;
    })
    .join('');
}

function renderBudgets() {
  const list = txOfMonth(currentMonth);
  $('#budgetList').innerHTML = cats()
    .filter((c) => c.type === 'expense')
    .map((c) => {
      const spent = list.reduce((s, t) => (t.type === 'expense' && t.categoryId === c.id ? s + t.amount : s), 0);
      const limit = budgetOf(c.id);
      let meter = '';
      let info = `<span>Gastado: ${esc(money(spent))}</span><span class="muted" style="margin:0">Sin límite</span>`;
      if (limit) {
        const ratio = spent / limit;
        const state = ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
        const label = ratio > 1 ? '⛔ Excedido' : ratio >= 0.8 ? '⚠️ Cerca del límite' : '✅ Dentro del presupuesto';
        meter = `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(ratio * 100))}">
          <span class="${state}" style="width:${Math.min(100, ratio * 100)}%"></span></div>`;
        const rest = limit - spent;
        info = `<span>${esc(money(spent))} de ${esc(money(limit))} · <span class="badge">${label}</span></span>
          <span>${rest >= 0 ? 'Quedan ' + esc(money(rest)) : 'Pasado por ' + esc(money(-rest))}</span>`;
      }
      return `<div class="budget-item">
        <div class="budget-top">
          <span>${esc(c.icon)} ${esc(c.name)}</span>
          <input type="text" inputmode="decimal" placeholder="Sin límite" data-budget="${esc(c.id)}"
            value="${limit ? esc(String(limit)) : ''}" aria-label="Presupuesto para ${esc(c.name)}">
        </div>
        ${meter}
        <div class="budget-info">${info}</div>
      </div>`;
    })
    .join('');
}

function renderSettings() {
  $('#currencySelect').value = data.settings.currency;
  $('#themeSelect').value = data.settings.theme;
  $('#categoryAdmin').innerHTML = cats()
    .map((c) => `<span class="chip">${esc(c.icon)} ${esc(c.name)} <small>${c.type === 'income' ? 'ingreso' : 'gasto'}</small>
      <button data-delcat="${esc(c.id)}" aria-label="Eliminar ${esc(c.name)}">×</button></span>`)
    .join('');
}

// ===== Formulario de movimiento =====
const dialog = $('#txDialog');
const form = $('#txForm');

function fillCategoryOptions(type, selected) {
  const opts = cats().filter((c) => c.type === type);
  // Si editas un movimiento cuya categoría fue borrada, se sigue mostrando.
  if (selected && !opts.some((c) => c.id === selected)) opts.push(catById(selected));
  $('#txCategory').innerHTML = opts
    .map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
    .join('');
}

function openTxDialog(tx = null) {
  editingId = tx?.id ?? null;
  const type = tx?.type ?? 'expense';
  form.type.value = type;
  form.dataset.type = type;
  fillCategoryOptions(type, tx?.categoryId);
  $('#txAmount').value = tx ? String(tx.amount) : '';
  // Por defecto: hoy si estás viendo el mes actual; si no, el día 1 del mes visible.
  const defDate = monthKeyOf(todayISO()) === currentMonth ? todayISO() : `${currentMonth}-01`;
  $('#txDate').value = tx?.date ?? defDate;
  $('#txNote').value = tx?.note ?? '';
  $('#txDialogTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#txDelete').hidden = !tx;
  dialog.showModal();
  setTimeout(() => $('#txAmount').focus(), 50);
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'type') {
    fillCategoryOptions(e.target.value);
    form.dataset.type = e.target.value;
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseAmount($('#txAmount').value);
  if (!amount || !Number.isFinite(amount)) {
    toast('Escribe un monto válido');
    $('#txAmount').focus();
    return;
  }
  const tx = {
    type: form.type.value,
    amount,
    categoryId: $('#txCategory').value,
    date: $('#txDate').value || todayISO(),
    note: $('#txNote').value.trim(),
    updatedAt: now(),
  };
  const existing = editingId && data.transactions.find((x) => x.id === editingId);
  if (existing) {
    Object.assign(existing, tx);
    toast('Movimiento actualizado');
  } else {
    data.transactions.push({ id: store.uid(), createdAt: now(), deleted: false, ...tx });
    toast(tx.type === 'income' ? 'Ingreso guardado' : 'Gasto guardado');
  }
  currentMonth = monthKeyOf(tx.date);
  dialog.close();
  persist();
});

$('#txCancel').addEventListener('click', () => dialog.close());
$('#txDelete').addEventListener('click', () => {
  const t = editingId && data.transactions.find((x) => x.id === editingId);
  if (!t || !confirm('¿Eliminar este movimiento?')) return;
  Object.assign(t, { deleted: true, updatedAt: now() });
  dialog.close();
  toast('Movimiento eliminado');
  persist();
});

$('#fab').addEventListener('click', () => openTxDialog());

// Click / Enter sobre un movimiento => editar
function onTxActivate(e) {
  const li = e.target.closest('.tx-item');
  if (!li) return;
  if (e.type === 'keydown' && e.key !== 'Enter') return;
  const tx = txs().find((t) => t.id === li.dataset.id);
  if (tx) openTxDialog(tx);
}
document.addEventListener('click', onTxActivate);
document.addEventListener('keydown', onTxActivate);

// ===== Navegación =====
const TITLES = { resumen: 'Resumen', movimientos: 'Movimientos', presupuestos: 'Presupuestos', ajustes: 'Ajustes' };
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#pageTitle').textContent = TITLES[name];
  $('.month-nav').style.visibility = name === 'ajustes' ? 'hidden' : '';
  $('#fab').hidden = name === 'ajustes';
  window.scrollTo({ top: 0 });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));

$('#prevMonth').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, -1); render(); });
$('#nextMonth').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, 1); render(); });

$('#searchInput').addEventListener('input', renderTransactions);
$('#typeFilter').addEventListener('change', renderTransactions);

// ===== Presupuestos =====
$('#budgetList').addEventListener('change', (e) => {
  const id = e.target.dataset.budget;
  if (!id) return;
  const val = parseAmount(e.target.value);
  data.budgets[id] = { amount: val > 0 ? val : 0, updatedAt: now() };
  persist();
});

// ===== Ajustes =====
$('#currencySelect').addEventListener('change', (e) => {
  Object.assign(data.settings, { currency: e.target.value, updatedAt: now() });
  persist();
});
$('#themeSelect').addEventListener('change', (e) => {
  Object.assign(data.settings, { theme: e.target.value, updatedAt: now() });
  applyTheme();
  persist();
});

$('#categoryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#newCatName').value.trim();
  if (!name) return;
  const type = $('#newCatType').value;
  if (cats().some((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase())) {
    toast('Esa categoría ya existe');
    return;
  }
  data.categories.push({ id: 'c-' + store.uid(), name, type, icon: '🏷️', updatedAt: now(), deleted: false });
  $('#newCatName').value = '';
  toast('Categoría agregada');
  persist();
});

$('#categoryAdmin').addEventListener('click', (e) => {
  const id = e.target.dataset.delcat;
  if (!id) return;
  const c = catById(id);
  if (txs().some((t) => t.categoryId === id)) {
    toast(`"${c.name}" tiene movimientos; no se puede eliminar`);
    return;
  }
  if (cats().filter((x) => x.type === c.type).length <= 1) {
    toast('Debe quedar al menos una categoría de este tipo');
    return;
  }
  if (!confirm(`¿Eliminar la categoría "${c.name}"?`)) return;
  Object.assign(c, { deleted: true, updatedAt: now() });
  if (data.budgets[id]) data.budgets[id] = { amount: 0, updatedAt: now() };
  persist();
});

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#exportBtn').addEventListener('click', () => {
  const backup = { ...data, categories: cats(), transactions: txs() };
  download(`finanza-respaldo-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json');
});

$('#exportCsvBtn').addEventListener('click', () => {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const fmtDate = (iso) => iso.split('-').reverse().join('/');
  const rows = [['Fecha', 'Tipo', 'Categoría', 'Monto', 'Nota']];
  for (const t of [...txs()].sort(sortTx)) {
    rows.push([fmtDate(t.date), t.type === 'income' ? 'Ingreso' : 'Gasto', catById(t.categoryId).name, t.amount, t.note]);
  }
  // ";" y BOM para que Excel en español lo abra bien (y se pueda volver a importar).
  download(`finanza-${todayISO()}.csv`, '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n'), 'text/csv');
});

// ===== Importar =====
const importDialog = $('#importDialog');
let lastImport = null; // ids agregados, para poder deshacer

function showImportResult({ title, lines, errors = [], undo = null }) {
  $('#importTitle').textContent = title;
  const MAX = 40;
  let html = lines.map(([ico, text]) => `<div class="import-line"><span class="ico">${ico}</span><span>${text}</span></div>`).join('');
  if (errors.length) {
    html += `<ul class="import-errors">${errors.slice(0, MAX)
      .map((e) => `<li><b>Fila ${e.row}:</b> ${esc(e.msg)}</li>`).join('')}
      ${errors.length > MAX ? `<li>… y ${errors.length - MAX} filas más con errores.</li>` : ''}</ul>`;
  }
  $('#importBody').innerHTML = html;
  lastImport = undo;
  $('#importUndo').hidden = !undo;
  importDialog.showModal();
}
$('#importClose').addEventListener('click', () => importDialog.close());
$('#importUndo').addEventListener('click', () => {
  if (!lastImport) return;
  const t = now();
  const txIds = new Set(lastImport.txIds);
  const catIds = new Set(lastImport.catIds);
  for (const x of data.transactions) if (txIds.has(x.id)) Object.assign(x, { deleted: true, updatedAt: t });
  for (const c of data.categories) if (catIds.has(c.id)) Object.assign(c, { deleted: true, updatedAt: t });
  lastImport = null;
  importDialog.close();
  toast('Importación deshecha');
  persist();
});

$('#templateBtn').addEventListener('click', () => download('finanza-plantilla.csv', buildTemplate(), 'text/csv'));

$('#importCsvInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (/\.xlsx?$/i.test(file.name)) {
    showImportResult({ title: 'Formato no compatible', lines: [['⚠️', 'Ese archivo es de Excel (.xlsx). Ábrelo en Excel y usa <b>Archivo → Guardar como → CSV UTF-8</b>, luego importa el .csv.']] });
    return;
  }
  const r = analyzeCSV(await file.text(), { categories: cats(), transactions: txs(), uid: store.uid });
  if (r.fatal) {
    showImportResult({ title: 'No se pudo importar', lines: [['⛔', esc(r.fatal)]] });
    return;
  }
  data.categories.push(...r.newCategories);
  data.transactions.push(...r.transactions);
  if (r.transactions.length) persist();

  const n = r.transactions.length;
  const lines = [[n ? '✅' : 'ℹ️', `<b>${n}</b> movimiento${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'}.`]];
  if (r.newCategories.length) lines.push(['🆕', `Categorías nuevas creadas: ${r.newCategories.map((c) => `<b>${esc(c.name)}</b>`).join(', ')}.`]);
  if (r.duplicates) lines.push(['⏭️', `${r.duplicates} fila${r.duplicates === 1 ? '' : 's'} omitida${r.duplicates === 1 ? '' : 's'} porque ya existía${r.duplicates === 1 ? '' : 'n'} (mismo día, tipo, categoría, monto y nota).`]);
  if (r.ignoredColumns.length) lines.push(['ℹ️', `Columnas ignoradas: ${r.ignoredColumns.map(esc).join(', ')}.`]);
  if (r.errors.length) lines.push(['⚠️', `<b>${r.errors.length}</b> fila${r.errors.length === 1 ? '' : 's'} con errores <b>no se importaron</b>. Corrígelas en el archivo y vuelve a importarlo (las que ya entraron no se duplicarán):`]);
  showImportResult({
    title: n ? 'Importación completada' : 'No se importó ningún movimiento',
    lines,
    errors: r.errors,
    undo: n ? { txIds: r.transactions.map((t) => t.id), catIds: r.newCategories.map((c) => c.id) } : null,
  });
});

// Restaurar respaldo .json: se combina con lo que ya tienes (no borra nada).
$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let imported;
  const report = { invalid: 0 };
  try {
    imported = store.normalize(JSON.parse(await file.text()), report);
  } catch {
    showImportResult({ title: 'No se pudo restaurar', lines: [['⛔', 'El archivo no es un respaldo de Finanza válido (debe ser el .json que genera "Exportar respaldo"). Para Excel usa "Importar CSV".']] });
    return;
  }
  const n = imported.transactions.length;
  if (!confirm(`El respaldo tiene ${n} movimientos. Se combinarán con tus datos actuales (no se borra nada). ¿Continuar?`)) return;
  const t = now();
  for (const x of imported.transactions) x.updatedAt = t;
  for (const c of imported.categories) c.updatedAt = t;
  data = store.merge(data, imported);
  applyTheme();
  persist();
  const lines = [['✅', `Respaldo restaurado: <b>${n}</b> movimientos.`]];
  if (report.invalid) lines.push(['⚠️', `${report.invalid} registro${report.invalid === 1 ? '' : 's'} dañado${report.invalid === 1 ? '' : 's'} se omitieron.`]);
  showImportResult({ title: 'Respaldo restaurado', lines });
});

$('#wipeBtn').addEventListener('click', () => {
  const where = user ? 'en TODOS tus dispositivos sincronizados' : 'de este dispositivo';
  if (!confirm(`Esto borrará todos tus movimientos y presupuestos ${where}. ¿Seguro?`)) return;
  const t = now();
  for (const x of data.transactions) if (!x.deleted) Object.assign(x, { deleted: true, updatedAt: t });
  for (const k of Object.keys(data.budgets)) data.budgets[k] = { amount: 0, updatedAt: t };
  persist();
  toast('Datos borrados');
});

// ===== Sincronización en la nube =====
let user = null;
let syncTimer = null;
let syncing = false;
let syncAgain = false;
let lastSyncAt = null;

function setSyncState(state, detail = '') {
  const LABELS = { off: 'Desactivada', signedout: 'Sin sesión', syncing: 'Sincronizando…', ok: 'Sincronizado', offline: 'Sin conexión', error: 'Error' };
  const badge = $('#syncBadge');
  badge.dataset.state = state;
  badge.textContent = LABELS[state];
  $('#syncOff').hidden = state !== 'off';
  $('#authForm').hidden = state !== 'signedout';
  $('#syncOn').hidden = !user;
  if (user) $('#syncEmail').textContent = user.email;
  const time = lastSyncAt ? new Intl.DateTimeFormat('es', { timeStyle: 'short' }).format(lastSyncAt) : null;
  $('#syncDetail').textContent =
    state === 'error' ? `⚠️ ${detail}`
    : state === 'offline' ? 'Sin internet: tus cambios se guardan aquí y se subirán al reconectar.'
    : time ? `Última sincronización: ${time}` : '';
}

function scheduleSync(delay = 1500) {
  if (!user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync() {
  if (!user) return;
  if (!navigator.onLine) { setSyncState('offline'); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSyncState('syncing');
  try {
    const remoteRaw = await sync.pull(user.id);
    const remote = remoteRaw ? store.normalize(remoteRaw) : null;
    const merged = remote ? store.merge(data, remote) : data;
    const localChanged = !store.sameData(merged, data);
    data = merged;
    store.save(data);
    if (!remote || !store.sameData(merged, remote)) await sync.push(user.id, data);
    lastSyncAt = new Date();
    setSyncState('ok');
    if (localChanged) { applyTheme(); render(); }
  } catch (err) {
    setSyncState(navigator.onLine ? 'error' : 'offline', err.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

async function initSync() {
  if (!sync.isConfigured()) { setSyncState('off'); return; }
  try {
    user = await sync.getUser();
    setSyncState(user ? 'ok' : 'signedout');
    await sync.onAuthChange((u) => {
      const changed = u?.id !== user?.id;
      user = u;
      setSyncState(user ? 'ok' : 'signedout');
      if (user && changed) scheduleSync(0);
    });
    if (user) scheduleSync(0);
  } catch {
    // Sin internet al abrir la app: la librería no carga. Se reintenta al reconectar.
    setSyncState('offline');
    window.addEventListener('online', initSync, { once: true });
  }
}

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = e.submitter?.dataset.auth || 'signin';
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const buttons = $('#authForm').querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (mode === 'signup') {
      const r = await sync.signUp(email, password);
      if (r.needsConfirmation) toast('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
      else toast('Cuenta creada y sesión iniciada');
    } else {
      await sync.signIn(email, password);
      toast('Sesión iniciada');
    }
    $('#authPassword').value = '';
  } catch (err) {
    toast(err.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

$('#syncNowBtn').addEventListener('click', () => runSync());
$('#signOutBtn').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión? Tus datos se quedan en este dispositivo, pero dejarán de sincronizarse.')) return;
  await sync.signOut();
  user = null;
  setSyncState('signedout');
});

window.addEventListener('online', () => scheduleSync(0));
window.addEventListener('offline', () => user && setSyncState('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleSync(0);
});
setInterval(() => document.visibilityState === 'visible' && scheduleSync(0), 60_000);

// ===== Instalación como app (PWA) =====
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#installCard').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#installCard').hidden = true;
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ===== Inicio =====
applyTheme();
initTooltips();
render();
const initial = location.hash.slice(1);
if (TITLES[initial]) showView(initial);
initSync();
