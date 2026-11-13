// =============================================================
//  Finanza: envía los avisos de pago como notificaciones push.
//  Guía paso a paso: docs/NOTIFICACIONES.md
//
//  pg_cron la llama cada hora. A cada dispositivo le llega el aviso
//  a las 9:00 de SU hora local, desde 3 días antes del pago hasta el
//  día del pago (4 avisos), mientras no esté marcado como pagado.
//
//  Parámetros opcionales (para probar):
//    ?modo=ahora   envía los avisos de hoy sin esperar a las 9:00
//    ?modo=prueba  envía una notificación de prueba a todos los dispositivos
// =============================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SEND_HOUR = 9;   // igual que SEND_HOUR en js/notify.js
const DAYS_BEFORE = 3; // igual que DAYS_BEFORE en js/reminders.js
const PAGE = 1000;     // filas por consulta (límite de Supabase)
const BATCH = 25;      // envíos en paralelo

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string; timezone: string };
type Reminder = { id: string; title: string; amount?: number; date: string; note?: string; paid?: boolean; deleted?: boolean };

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta configurar el secreto ${name}`);
  return v;
}

/** Fecha (YYYY-MM-DD) y hora actuales en una zona horaria. */
function localNow(timeZone: string): { date: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch {
    return localNow('UTC'); // zona horaria inválida
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const daysUntil = (iso: string, today: string) => Math.round((toUTC(iso) - toUTC(today)) / 86_400_000);
const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const NO_DECIMALS = new Set(['COP', 'CLP']);
function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: NO_DECIMALS.has(currency) ? 0 : 2,
    }).format(n);
  } catch {
    return String(n);
  }
}

function shortDate(iso: string): string {
  const txt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(toUTC(iso)))
    .replace(/\./g, '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// Mismo texto que alertText() en js/reminders.js
function message(r: Reminder, days: number, currency: string) {
  const title =
    days === 0 ? `🔔 Hoy vence: ${r.title}`
    : days === 1 ? `⏰ Mañana vence: ${r.title}`
    : `💳 En ${days} días vence: ${r.title}`;
  const amount = Number(r.amount) > 0 ? money(Number(r.amount), currency) : '';
  const body = [amount, `Pago: ${shortDate(r.date)}`, r.note].filter(Boolean).join(' · ');
  return { title, body: `${body}\nToca para marcarlo como pagado.` };
}

const chunk = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  try {
    // Solo pg_cron (o tú, para probar) conoce este secreto.
    if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'No autorizado' }, 401);
    const mode = new URL(req.url).searchParams.get('modo');

    webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    // 1. Todos los dispositivos registrados (por páginas).
    const subs: Sub[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('push_subscriptions')
        .select('endpoint,user_id,p256dh,auth,timezone')
        .order('endpoint')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      subs.push(...(data as Sub[]));
      if (!data || data.length < PAGE) break;
    }

    // 2. Qué enviar a cada dispositivo.
    const jobs: { sub: Sub; payload: string }[] = [];
    if (mode === 'prueba') {
      const payload = JSON.stringify({ title: '🔔 Prueba de Finanza', body: 'Las notificaciones desde el servidor funcionan.', tag: 'finanza-test' });
      for (const sub of subs) jobs.push({ sub, payload });
    } else {
      const targets = subs
        .map((sub) => ({ sub, now: localNow(sub.timezone || 'UTC') }))
        .filter((t) => mode === 'ahora' || t.now.hour === SEND_HOUR);

      // Solo se leen los recordatorios y la moneda, no todos los movimientos.
      const byUser = new Map<string, { reminders: Reminder[]; currency: string }>();
      for (const ids of chunk([...new Set(targets.map((t) => t.sub.user_id))], 100)) {
        const { data, error } = await db
          .from('finanza_data')
          .select('user_id, reminders:data->reminders, currency:data->settings->>currency')
          .in('user_id', ids);
        if (error) throw error;
        for (const row of data ?? []) {
          byUser.set(row.user_id, {
            reminders: Array.isArray(row.reminders) ? row.reminders : [],
            currency: typeof row.currency === 'string' ? row.currency : 'COP',
          });
        }
      }

      for (const { sub, now } of targets) {
        const u = byUser.get(sub.user_id);
        if (!u) continue;
        for (const r of u.reminders) {
          if (!r || r.deleted || r.paid || !r.id || !r.title || !isISO(r.date)) continue;
          const days = daysUntil(r.date, now.date);
          if (days < 0 || days > DAYS_BEFORE) continue;
          const { title, body } = message(r, days, u.currency);
          // Misma etiqueta que la app (rem-<id>-<fecha>): nunca se duplica el aviso del día.
          jobs.push({ sub, payload: JSON.stringify({ title, body, tag: `rem-${r.id}-${now.date}`, url: './#recordatorios' }) });
        }
      }
    }

    // 3. Enviar. Los dispositivos que ya no existen (410/404) se borran.
    let sent = 0;
    const failed: string[] = [];
    const dead = new Set<string>();
    for (const group of chunk(jobs, BATCH)) {
      const results = await Promise.allSettled(group.map(({ sub, payload }) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 12 * 3600, urgency: 'high' },
        )));
      results.forEach((res, i) => {
        if (res.status === 'fulfilled') { sent++; return; }
        const code = (res.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.add(group[i].sub.endpoint);
        else failed.push(`${code ?? '?'}: ${String((res.reason as Error)?.message ?? res.reason).slice(0, 120)}`);
      });
    }
    for (const ids of chunk([...dead], 100)) await db.from('push_subscriptions').delete().in('endpoint', ids);

    return json({ dispositivos: subs.length, enviados: sent, fallidos: failed.length, borrados: dead.size, errores: failed.slice(0, 5) });
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
