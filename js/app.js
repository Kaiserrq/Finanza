import * as store from './storage.js';
import * as sync from './sync.js';
import { analyzeCSV, buildTemplate } from './csv.js';
import * as rem from './reminders.js';
import * as notify from './notify.js';
import {
  setCurrency, money, moneyCompact, parseAmount, todayISO, monthKeyOf, shiftMonth,
  monthName, dayLabel, esc, toast, initTooltips,
} from './ui.js';

// ===== Estado =====
let data = store.load();
let currentMonth = monthKeyOf(todayISO());
let editingId = null;
let currentView = 'resumen';
const $ = (sel) => document.querySelector(sel);
const now = () => Date.now();

// Solo los registros vigentes (los borrados quedan como "lápidas" para sincronizar).
const txs = () => store.alive(data.transactions);
const cats = () => store.alive(data.categories);
const budgetOf = (id) => data.budgets[id]?.amount || 0;
const reminders = () => store.alive(data.reminders);
const remById = (id) => reminders().find((r) => r.id === id);

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
  // En celulares angostos se muestra abreviado ("Nov 2026") para que quepa el título.
  $('#monthLabel').innerHTML = `<span class="ml-long">${esc(monthName(currentMonth))}</span>`
    + `<span class="ml-short">${esc(monthName(currentMonth, 'short'))} ${currentMonth.slice(0, 4)}</span>`;
  $('.amount-prefix').textContent = data.settings.currency === 'EUR' ? '€' : '$';
  renderSummary();
  renderTransactions();
  renderBudgets();
  renderReminders();
  renderSettings();
  renderedDay = todayISO();
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

/** `prefill` rellena un movimiento nuevo (por ejemplo, al pagar un recordatorio). */
function openTxDialog(tx = null, prefill = null) {
  editingId = tx?.id ?? null;
  payingId = null;
  const src = tx ?? prefill;
  const type = src?.type ?? 'expense';
  form.type.value = type;
  form.dataset.type = type;
  fillCategoryOptions(type, src?.categoryId);
  $('#txAmount').value = src?.amount ? String(src.amount) : '';
  // Por defecto: hoy si estás viendo el mes actual; si no, el día 1 del mes visible.
  const defDate = monthKeyOf(todayISO()) === currentMonth ? todayISO() : `${currentMonth}-01`;
  $('#txDate').value = src?.date ?? defDate;
  $('#txNote').value = src?.note ?? '';
  $('#txDialogTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#txDelete').hidden = !tx;
  $('#txPayHint').hidden = true;
  $('#txSkip').hidden = true;
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
    const id = store.uid();
    data.transactions.push({ id, createdAt: now(), deleted: false, ...tx });
    if (payingId) {
      markPaid(payingId, id);
      toast('✅ Pago registrado y gasto guardado');
    } else toast(tx.type === 'income' ? 'Ingreso guardado' : 'Gasto guardado');
  }
  currentMonth = monthKeyOf(tx.date);
  dialog.close();
  persist();
});

$('#txCancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { payingId = null; });
$('#txSkip').addEventListener('click', () => {
  if (!payingId) return;
  markPaid(payingId, '');
  dialog.close();
  toast('Marcado como pagado (sin registrar gasto)');
  persist();
});
$('#txDelete').addEventListener('click', () => {
  const t = editingId && data.transactions.find((x) => x.id === editingId);
  if (!t || !confirm('¿Eliminar este movimiento?')) return;
  Object.assign(t, { deleted: true, updatedAt: now() });
  dialog.close();
  toast('Movimiento eliminado');
  persist();
});

$('#fab').addEventListener('click', () => {
  if (currentView === 'recordatorios') {
    openDay(monthKeyOf(todayISO()) === currentMonth ? todayISO() : `${currentMonth}-01`);
  } else openTxDialog();
});

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
const TITLES = { resumen: 'Resumen', movimientos: 'Movimientos', presupuestos: 'Presupuestos', recordatorios: 'Recordatorios', ajustes: 'Ajustes' };
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#pageTitle').textContent = TITLES[name];
  $('.month-nav').style.visibility = name === 'ajustes' ? 'hidden' : '';
  closePicker();
  $('#fab').hidden = name === 'ajustes';
  $('#fab').setAttribute('aria-label', name === 'recordatorios' ? 'Agregar recordatorio' : 'Agregar movimiento');
  window.scrollTo({ top: 0 });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));

$('#prevMonth').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, -1); render(); });
$('#nextMonth').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, 1); render(); });

// ===== Selector rápido de fecha (flechita junto al mes) =====
const picker = $('#datePicker');
const pad2 = (n) => String(n).padStart(2, '0');
let dp = { y: 0, m: 0 }; // año y mes (1-12) que muestra el selector

function openPicker() {
  const [y, m] = currentMonth.split('-').map(Number);
  dp = { y, m };
  picker.hidden = false;
  $('#pickerBtn').setAttribute('aria-expanded', 'true');
  renderPicker();
}

function closePicker() {
  if (picker.hidden) return;
  picker.hidden = true;
  $('#pickerBtn').setAttribute('aria-expanded', 'false');
}

function renderPicker() {
  const today = todayISO();
  const nowKey = monthKeyOf(today);
  $('#dpYear').textContent = dp.y;
  $('#dpMonths').innerHTML = Array.from({ length: 12 }, (_, i) => {
    const key = `${dp.y}-${pad2(i + 1)}`;
    const cls = ['dp-month'];
    if (key === currentMonth) cls.push('active');
    if (key === nowKey) cls.push('now');
    return `<button type="button" class="${cls.join(' ')}" data-dp-month="${i + 1}">${esc(monthName(key, 'short'))}</button>`;
  }).join('');

  // Días del mes elegido; los que tienen pagos pendientes llevan un punto.
  const pending = new Set(store.alive(data.reminders).filter((r) => !r.paid).map((r) => r.date));
  const offset = (new Date(dp.y, dp.m - 1, 1).getDay() + 6) % 7;
  const total = new Date(dp.y, dp.m, 0).getDate();
  let html = '<span></span>'.repeat(offset);
  for (let d = 1; d <= total; d++) {
    const iso = `${dp.y}-${pad2(dp.m)}-${pad2(d)}`;
    const cls = ['dp-day'];
    if (iso === today) cls.push('today');
    if (pending.has(iso)) cls.push('has');
    html += `<button type="button" class="${cls.join(' ')}" data-dp-day="${iso}">${d}</button>`;
  }
  $('#dpDays').innerHTML = html;
}

$('#pickerBtn').addEventListener('click', () => (picker.hidden ? openPicker() : closePicker()));

picker.addEventListener('click', (e) => {
  const yearBtn = e.target.closest('[data-dp-year]');
  if (yearBtn) {
    dp.y += Number(yearBtn.dataset.dpYear);
    renderPicker();
    return;
  }
  const monthBtn = e.target.closest('[data-dp-month]');
  if (monthBtn) {
    dp.m = Number(monthBtn.dataset.dpMonth);
    currentMonth = `${dp.y}-${pad2(dp.m)}`;
    render();
    renderPicker(); // sigue abierto para poder elegir el día
    return;
  }
  const dayBtn = e.target.closest('[data-dp-day]');
  if (dayBtn) {
    const iso = dayBtn.dataset.dpDay;
    currentMonth = monthKeyOf(iso);
    closePicker();
    render();
    if (currentView === 'recordatorios') openDay(iso);
  }
});

$('#dpToday').addEventListener('click', () => {
  currentMonth = monthKeyOf(todayISO());
  closePicker();
  render();
});

// Se cierra al tocar fuera o con Escape.
document.addEventListener('pointerdown', (e) => {
  if (!picker.hidden && !picker.contains(e.target) && !$('#pickerBtn').contains(e.target)) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !picker.hidden) { closePicker(); $('#pickerBtn').focus(); }
});

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
  const backup = { ...data, categories: cats(), transactions: txs(), reminders: reminders() };
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
  for (const r of imported.reminders) r.updatedAt = t;
  data = store.merge(data, imported);
  applyTheme();
  persist();
  const lines = [['✅', `Respaldo restaurado: <b>${n}</b> movimientos.`]];
  if (report.invalid) lines.push(['⚠️', `${report.invalid} registro${report.invalid === 1 ? '' : 's'} dañado${report.invalid === 1 ? '' : 's'} se omitieron.`]);
  showImportResult({ title: 'Respaldo restaurado', lines });
});

$('#wipeBtn').addEventListener('click', () => {
  const where = user ? 'en TODOS tus dispositivos sincronizados' : 'de este dispositivo';
  if (!confirm(`Esto borrará todos tus movimientos, presupuestos y recordatorios ${where}. ¿Seguro?`)) return;
  const t = now();
  for (const x of data.transactions) if (!x.deleted) Object.assign(x, { deleted: true, updatedAt: t });
  for (const r of data.reminders) if (!r.deleted) Object.assign(r, { deleted: true, updatedAt: t });
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
      if (user && changed) { scheduleSync(0); ensurePush(); }
      renderNotifyCard();
    });
    if (user) { scheduleSync(0); ensurePush(); }
    renderNotifyCard();
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
  const endpoint = notify.pushEndpoint();
  if (endpoint) {
    try { await sync.deletePushSubscription(endpoint); } catch {}
    await notify.unsubscribePush();
  }
  await sync.signOut();
  user = null;
  setSyncState('signedout');
  renderNotifyCard();
});

window.addEventListener('online', () => scheduleSync(0));
window.addEventListener('offline', () => user && setSyncState('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  scheduleSync(0);
  if (renderedDay !== todayISO()) render();
  checkLocalAlerts();
});
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  scheduleSync(0);
  // Si pasó la medianoche con la app abierta, se actualizan los "faltan X días".
  if (renderedDay !== todayISO()) { render(); checkLocalAlerts(); }
}, 60_000);
setInterval(() => checkLocalAlerts(), 30 * 60_000);

// ===== Recordatorios de pago (calendario) =====
let renderedDay = null;
let payingId = null;      // recordatorio que se está pagando desde el formulario de movimiento
let dayDate = null;       // fecha abierta en el panel del día
let editingRemId = null;
let pushState = { ok: false, error: '' };
const dayDialog = $('#dayDialog');

const byDate = (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);

function remItemHTML(r, today) {
  const c = catById(r.categoryId);
  const st = rem.statusOf(r, today);
  const badge = st === 'paid' ? '✓ Pagado' : rem.whenLabel(rem.daysUntil(r.date, today));
  const sub = [rem.shortDate(r.date), r.amount ? money(r.amount) : '', r.repeat === 'monthly' ? '🔁 Cada mes' : '']
    .filter(Boolean).join(' · ');
  const action = r.paid
    ? `<button type="button" class="btn sm" data-unpay="${esc(r.id)}">Deshacer</button>`
    : `<button type="button" class="btn sm primary" data-pay="${esc(r.id)}">Pagado</button>`;
  return `<li class="rem-item ${st}" data-rem="${esc(r.id)}" tabindex="0">
    <span class="tx-icon" style="--tint:${tintOf(c.id)}">${esc(c.icon)}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(r.title)}</span>
      <span class="tx-sub">${esc(sub)}</span>
    </span>
    <span class="rem-side"><span class="rem-badge ${st}">${esc(badge)}</span>${action}</span>
  </li>`;
}

function renderReminders() {
  const today = todayISO();
  const all = reminders();

  // Qué pasa cada día del mes visible: recordatorios y días de aviso.
  const items = new Map();
  const alertDays = new Set();
  for (const r of all) {
    if (!items.has(r.date)) items.set(r.date, []);
    items.get(r.date).push(r);
    if (!r.paid && rem.daysUntil(r.date, today) >= 0) {
      for (let k = 1; k <= rem.DAYS_BEFORE; k++) alertDays.add(rem.addDays(r.date, -k));
    }
  }

  const [y, m] = currentMonth.split('-').map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // la semana empieza el lunes
  const total = new Date(y, m, 0).getDate();
  let html = '<span class="cal-blank"></span>'.repeat(offset);
  for (let d = 1; d <= total; d++) {
    const iso = `${currentMonth}-${String(d).padStart(2, '0')}`;
    const list = (items.get(iso) || []).sort(byDate);
    const states = list.map((r) => rem.statusOf(r, today));
    const cls = ['cal-day'];
    if (iso === today) cls.push('today');
    if (iso < today) cls.push('past');
    if (states.includes('overdue')) cls.push('overdue');
    else if (states.includes('soon')) cls.push('due');
    else if (alertDays.has(iso)) cls.push('alert');
    const chips = list.slice(0, 3)
      .map((r, i) => `<span class="cal-chip ${states[i]}">${esc(r.title)}</span>`).join('');
    const more = list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : '';
    const label = `${rem.longDate(iso)}${list.length ? `, ${list.length} recordatorio${list.length > 1 ? 's' : ''}` : ''}`;
    html += `<button type="button" class="${cls.join(' ')}" data-date="${iso}" aria-label="${esc(label)}">
      <span class="cal-num">${d}</span><span class="cal-items">${chips}${more}</span>
    </button>`;
  }
  $('#calGrid').innerHTML = html;

  // Lista de próximos pagos: todo lo pendiente, lo vencido primero.
  const pending = all.filter((r) => !r.paid).sort(byDate);
  $('#upcomingList').innerHTML = pending.length
    ? pending.slice(0, 12).map((r) => remItemHTML(r, today)).join('')
    : '<li class="empty"><span class="empty-ico">🗓️</span>No tienes pagos pendientes.<br>Toca un día del calendario para crear uno.</li>';

  // Tarjeta en Resumen: lo que vence en los próximos días o ya venció.
  const due = pending.filter((r) => rem.daysUntil(r.date, today) <= rem.DAYS_BEFORE);
  $('#dueCard').hidden = !due.length;
  $('#dueList').innerHTML = due.map((r) => remItemHTML(r, today)).join('');

  if (dayDialog.open) renderDayList();
  renderNotifyCard();
}

// ---- Panel del día ----
function openDay(date, editId = null) {
  dayDate = date;
  $('#dayTitle').textContent = rem.longDate(date);
  renderDayList();
  resetRemForm(editId ? remById(editId) : null);
  if (!dayDialog.open) dayDialog.showModal();
  if (!editId) setTimeout(() => $('#remTitle').focus(), 50);
}

function renderDayList() {
  const list = reminders().filter((r) => r.date === dayDate).sort(byDate);
  $('#dayList').innerHTML = list.map((r) => remItemHTML(r, todayISO())).join('');
  $('#dayList').hidden = !list.length;
}

function resetRemForm(r = null) {
  editingRemId = r?.id ?? null;
  const opts = cats().filter((c) => c.type === 'expense');
  if (r?.categoryId && !opts.some((c) => c.id === r.categoryId)) opts.push(catById(r.categoryId));
  $('#remCategory').innerHTML = opts
    .map((c) => `<option value="${esc(c.id)}" ${c.id === r?.categoryId ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
    .join('');
  if (!r) $('#remCategory').value = opts.find((c) => c.id === 'c-servicios')?.id ?? opts[0]?.id ?? '';
  $('#remTitle').value = r?.title ?? '';
  $('#remAmount').value = r?.amount ? String(r.amount) : '';
  $('#remDate').value = r?.date ?? dayDate;
  $('#remRepeat').value = r?.repeat ?? 'none';
  $('#remNote').value = r?.note ?? '';
  $('#remFormTitle').textContent = r ? 'Editar recordatorio' : 'Nuevo recordatorio';
  $('#remSubmit').textContent = r ? 'Guardar cambios' : 'Guardar';
  $('#remDelete').hidden = !r;
  $('#remNew').hidden = !r;
  updateRemHint();
}

function updateRemHint() {
  const date = $('#remDate').value;
  if (!date) { $('#remHint').textContent = ''; return; }
  const from = rem.addDays(date, -rem.DAYS_BEFORE);
  const fmt = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
  $('#remHint').textContent = `🔔 Te avisaremos una vez al día del ${fmt(from)} al ${fmt(date)} (4 avisos), hasta que lo marques como pagado.`;
}
$('#remDate').addEventListener('input', updateRemHint);

$('#remForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#remTitle').value.trim();
  const date = $('#remDate').value;
  if (!title || !date) return;
  const amountText = $('#remAmount').value.trim();
  const amount = amountText ? parseAmount(amountText) : 0;
  if (amountText && !(amount > 0 && Number.isFinite(amount))) {
    toast('Escribe un monto válido o déjalo vacío');
    $('#remAmount').focus();
    return;
  }
  const fields = {
    title, amount, date,
    categoryId: $('#remCategory').value,
    repeat: $('#remRepeat').value === 'monthly' ? 'monthly' : 'none',
    anchorDay: Number(date.slice(8)),
    note: $('#remNote').value.trim(),
    updatedAt: now(),
  };
  const existing = editingRemId && remById(editingRemId);
  if (existing) {
    Object.assign(existing, fields);
    toast('Recordatorio actualizado');
  } else {
    data.reminders.push({
      id: store.uid(), paid: false, paidAt: 0, txId: '', nextId: '', createdAt: now(), deleted: false, ...fields,
    });
    toast('Recordatorio guardado');
  }
  currentMonth = monthKeyOf(date);
  dayDialog.close();
  persist();
  // Buen momento para pedir permiso: la persona acaba de crear algo que necesita avisos.
  if (notify.permission() === 'default') enableNotifications();
  // Si vence en los próximos 3 días, el aviso de hoy se muestra ya (el servidor solo envía a las 9:00).
  else checkLocalAlerts({ force: true });
});

$('#remDelete').addEventListener('click', () => {
  const r = editingRemId && remById(editingRemId);
  if (!r || !confirm(`¿Eliminar el recordatorio "${r.title}"?`)) return;
  Object.assign(r, { deleted: true, updatedAt: now() });
  toast('Recordatorio eliminado');
  dayDialog.close();
  persist();
});
$('#remNew').addEventListener('click', () => { resetRemForm(); $('#remTitle').focus(); });
$('#dayClose').addEventListener('click', () => dayDialog.close());

// ---- Pagar ----
/** Marca como pagado y, si se repite cada mes, crea el del mes siguiente. No guarda: quien llama hace persist(). */
function markPaid(id, txId) {
  const r = remById(id);
  if (!r) return;
  const t = now();
  Object.assign(r, { paid: true, paidAt: t, txId, updatedAt: t });
  if (r.repeat === 'monthly' && !r.nextId) {
    const next = {
      ...r, id: store.uid(), date: rem.nextMonthly(r.date, r.anchorDay),
      paid: false, paidAt: 0, txId: '', nextId: '', createdAt: t, updatedAt: t,
    };
    data.reminders.push(next);
    r.nextId = next.id;
  }
}

// Al tocar "Pagado" se abre el formulario de gasto ya lleno para que actualices tus cuentas.
function startPayment(id) {
  const r = remById(id);
  if (!r) return;
  if (dayDialog.open) dayDialog.close();
  openTxDialog(null, { type: 'expense', amount: r.amount, categoryId: r.categoryId, date: todayISO(), note: r.title });
  payingId = r.id;
  $('#txDialogTitle').textContent = 'Registrar el pago';
  $('#txPayHint').textContent = `Vas a marcar "${r.title}" como pagado. Revisa el monto y la fecha para registrarlo en tus gastos.`;
  $('#txPayHint').hidden = false;
  $('#txSkip').hidden = false;
}

function undoPayment(id) {
  const r = remById(id);
  if (!r) return;
  const t = now();
  const tx = r.txId && txs().find((x) => x.id === r.txId);
  if (tx && confirm(`¿Eliminar también el gasto de ${money(tx.amount)} que se registró con este pago?`)) {
    Object.assign(tx, { deleted: true, updatedAt: t });
  }
  // Si ya se había creado el del mes siguiente y sigue pendiente, se quita.
  const next = r.nextId && remById(r.nextId);
  if (next && !next.paid) Object.assign(next, { deleted: true, updatedAt: t });
  Object.assign(r, { paid: false, paidAt: 0, txId: '', nextId: '', updatedAt: t });
  toast('Pago desmarcado');
  persist();
}

document.addEventListener('click', (e) => {
  const pay = e.target.closest('[data-pay]');
  if (pay) { startPayment(pay.dataset.pay); return; }
  const unpay = e.target.closest('[data-unpay]');
  if (unpay) { undoPayment(unpay.dataset.unpay); return; }
  const item = e.target.closest('.rem-item');
  if (item) {
    const r = remById(item.dataset.rem);
    if (r) openDay(r.date, r.id);
    return;
  }
  const day = e.target.closest('.cal-day');
  if (day) openDay(day.dataset.date);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches?.('.rem-item')) return;
  const r = remById(e.target.dataset.rem);
  if (r) openDay(r.date, r.id);
});

// ---- Notificaciones ----
function renderNotifyCard() {
  const p = notify.permission();
  let state = 'off', label = 'Desactivadas', text;
  if (p === 'unsupported') {
    label = 'No disponible';
    text = notify.isIOS() && !notify.isStandalone()
      ? 'En iPhone o iPad, primero instala la app (Compartir → Agregar a pantalla de inicio) y ábrela desde el ícono para poder activar los avisos.'
      : 'Este navegador no permite notificaciones. Verás los pagos próximos dentro de la app.';
  } else if (p === 'denied') {
    state = 'error'; label = 'Bloqueadas';
    text = 'Bloqueaste las notificaciones para esta app. Actívalas en la configuración del navegador (ícono 🔒 junto a la dirección) o del celular.';
  } else if (p === 'default') {
    text = 'Activa las notificaciones para recibir un aviso cada día desde 3 días antes de cada pago hasta el día en que vence.';
  } else if (notify.pushEndpoint() && !pushState.error) {
    // Este dispositivo ya quedó registrado en el servidor (se confirma de nuevo al iniciar sesión).
    state = 'ok'; label = 'Activadas';
    text = `Te llegarán en este dispositivo cada día a las ${notify.SEND_HOUR}:00 a. m., aunque la app esté cerrada.`;
  } else {
    state = 'offline'; label = 'Solo con la app abierta';
    text = !notify.pushConfigured()
      ? 'Activadas, pero por ahora solo llegan cuando abres la app. Para recibirlas con la app cerrada, sigue la guía docs/NOTIFICACIONES.md.'
      : !user
        ? 'Activadas, pero solo llegan cuando abres la app. Inicia sesión en Ajustes → Sincronización para recibirlas con la app cerrada.'
        : pushState.error
          ? `Solo llegan cuando abres la app. No se pudo activar el envío desde el servidor: ${pushState.error}`
          : 'Conectando con el servidor de avisos…';
  }
  const badge = $('#notifyBadge');
  badge.dataset.state = state;
  badge.textContent = label;
  $('#notifyText').textContent = text;
  $('#notifyEnableBtn').hidden = p !== 'default';
  $('#notifyTestBtn').hidden = p !== 'granted';
}

async function enableNotifications() {
  const p = await notify.requestPermission();
  if (p === 'granted') {
    toast('🔔 Notificaciones activadas');
    await ensurePush();
    checkLocalAlerts();
  } else if (p === 'denied') toast('Notificaciones bloqueadas');
  renderNotifyCard();
}

/** Registra este dispositivo en el servidor para recibir avisos con la app cerrada. */
async function ensurePush() {
  if (!user || !notify.pushConfigured() || notify.permission() !== 'granted') return;
  if (!notify.pushSupported()) {
    pushState = { ok: false, error: 'este navegador no admite avisos con la app cerrada.' };
    renderNotifyCard();
    return;
  }
  try {
    const sub = await notify.subscribePush();
    await sync.savePushSubscription(user.id, sub, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    notify.rememberPush(sub.endpoint);
    pushState = { ok: true, error: '' };
  } catch (err) {
    notify.rememberPush(null);
    pushState = { ok: false, error: err.message || String(err) };
  }
  renderNotifyCard();
}

/** Muestra los avisos de hoy que aún no se han mostrado en este dispositivo. */
let checking = false;
async function checkLocalAlerts({ force = false } = {}) {
  if (checking || notify.permission() !== 'granted') return;
  // Si el servidor envía los avisos a este dispositivo, se le da prioridad hasta una hora
  // después de la hora de envío, para no duplicarlos.
  if (!force && notify.pushEndpoint() && new Date().getHours() <= notify.SEND_HOUR) return;
  checking = true;
  try {
    const today = todayISO();
    await notify.pruneLog((d) => rem.daysUntil(d, today) < -7);
    for (const r of reminders().filter((x) => rem.isAlertDay(x, today))) {
      const tag = rem.alertTag(r, today);
      if (await notify.wasShown(tag)) continue;
      const { title, body } = rem.alertText(r, rem.daysUntil(r.date, today), r.amount ? money(r.amount) : '');
      await notify.show(title, { body, tag, data: { url: './#recordatorios' } });
      await notify.markShown(tag);
    }
  } catch {
    // Si el sistema no deja mostrar la notificación, la tarjeta de "Pagos próximos" sigue visible.
  } finally {
    checking = false;
  }
}

$('#notifyEnableBtn').addEventListener('click', enableNotifications);
// La prueba es lo único que se puede enviar varias veces: cada una lleva una etiqueta distinta,
// así el sistema la muestra siempre (los avisos reales usan una etiqueta por día y no se repiten).
let testCount = 0;
$('#notifyTestBtn').addEventListener('click', async () => {
  const today = todayISO();
  const next = reminders().filter((r) => !r.paid && rem.daysUntil(r.date, today) >= 0).sort(byDate)[0];
  const sample = next
    ? rem.alertText(next, rem.daysUntil(next.date, today), next.amount ? money(next.amount) : '')
    : { title: '🔔 Prueba de Finanza', body: 'Así se verán los avisos de tus pagos.' };
  const title = `(Prueba) ${sample.title}`;
  const showHere = () => notify.show(title, { body: sample.body, tag: `finanza-test-${Date.now()}-${++testCount}` });
  const btn = $('#notifyTestBtn');
  btn.disabled = true;
  try {
    if (user && notify.pushConfigured()) {
      // Con sesión: el servidor la envía a TODOS los dispositivos de la cuenta (incluido este).
      try {
        const r = await sync.sendTestPush(title, sample.body);
        if (!notify.pushEndpoint()) await showHere(); // este dispositivo no está registrado: se muestra aquí
        toast(`Prueba enviada a ${r.enviados} de ${r.dispositivos} dispositivo${r.dispositivos === 1 ? '' : 's'}`);
      } catch (err) {
        await showHere();
        toast('Solo se mostró aquí. El servidor respondió: ' + err.message);
      }
    } else {
      await showHere();
      toast('Prueba mostrada solo en este dispositivo (inicia sesión para enviarla a todos)');
    }
  } catch (err) {
    toast('No se pudo mostrar: ' + (err.message || err));
  } finally {
    btn.disabled = false;
  }
});

// Al tocar una notificación, el service worker pide abrir el calendario.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open-view' && TITLES[e.data.view]) showView(e.data.view);
});
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (TITLES[v] && v !== currentView) showView(v);
});

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
checkLocalAlerts();
