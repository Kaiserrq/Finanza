// Conexión con Supabase: cuenta de usuario + guardar/leer tus datos en la nube.
// La librería se descarga solo si la sincronización está configurada.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const TABLE = 'finanza_data';
let client = null;

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

async function getClient() {
  if (!isConfigured()) return null;
  if (!client) {
    const { createClient } = await import(LIB_URL);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

// Traduce los errores más comunes de Supabase.
function friendly(error) {
  const m = String(error?.message || error || '');
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Debes confirmar tu correo primero (revisa tu bandeja de entrada o spam).';
  if (/user already registered/i.test(m)) return 'Ese correo ya tiene cuenta. Usa "Iniciar sesión".';
  if (/password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión con el servidor.';
  if (/relation .* does not exist|could not find the table/i.test(m)) return 'Falta crear la tabla: ejecuta supabase/schema.sql en Supabase.';
  return m || 'Error desconocido.';
}

export async function getUser() {
  const c = await getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.user ?? null;
}

export async function onAuthChange(callback) {
  const c = await getClient();
  if (!c) return;
  c.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
}

export async function signIn(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error));
  return data.user;
}

/** Devuelve { user, needsConfirmation }. */
export async function signUp(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(friendly(error));
  return { user: data.user, needsConfirmation: !data.session };
}

export async function signOut() {
  const c = await getClient();
  await c?.auth.signOut();
}

/** Lee tus datos de la nube (o null si aún no hay nada guardado). */
export async function pull(userId) {
  const c = await getClient();
  const { data, error } = await c.from(TABLE).select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(friendly(error));
  return data?.data ?? null;
}

/** Guarda tus datos en la nube. */
export async function push(userId, payload) {
  const c = await getClient();
  const { error } = await c.from(TABLE).upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() });
  if (error) throw new Error(friendly(error));
}

// ---- Notificaciones push: un registro por dispositivo ----
const PUSH_TABLE = 'push_subscriptions';

/** Guarda la suscripción push de este dispositivo y su zona horaria (para avisar a las 9:00 locales). */
export async function savePushSubscription(userId, sub, timezone) {
  const c = await getClient();
  const { error } = await c.from(PUSH_TABLE).upsert(
    {
      endpoint: sub.endpoint,
      user_id: userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      timezone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );
  if (error) {
    const msg = friendly(error);
    throw new Error(msg.startsWith('Falta crear la tabla') ? 'Falta crear la tabla de avisos: ejecuta supabase/notificaciones.sql en Supabase.' : msg);
  }
}

/**
 * Pide al servidor una notificación de prueba para TODOS los dispositivos de tu cuenta.
 * Devuelve { dispositivos, enviados, ... }.
 */
export async function sendTestPush(title, body) {
  const c = await getClient();
  const { data, error } = await c.functions.invoke('send-reminders', { body: { modo: 'prueba', title, body } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context?.json())?.error || msg; } catch {}
    throw new Error(friendly(msg));
  }
  return data;
}

export async function deletePushSubscription(endpoint) {
  const c = await getClient();
  await c?.from(PUSH_TABLE).delete().eq('endpoint', endpoint);
}
