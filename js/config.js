// ============================================================
//  Configuración de la sincronización en la nube (Supabase)
//  Guía paso a paso: docs/SINCRONIZACION.md
// ============================================================
// Pega aquí los datos de tu proyecto (Supabase → Project Settings → API).
// Si los dejas vacíos, la app funciona igual pero solo en este dispositivo.
//
// ¿Es seguro publicarlos en GitHub? Sí: la "anon key" / "publishable key" es
// pública por diseño. Lo que protege tus datos son las reglas RLS que crea
// el archivo supabase/schema.sql (cada usuario solo puede ver su propia fila).
// NUNCA pongas aquí la "service_role key" / "secret key".

export const SUPABASE_URL = 'https://ogmlanpqzfnwewmryyub.supabase.co';      // ej: 'https://abcdefghijk.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_1LX4T9Zmpmxx3-1t-Y_5Nw_NIhUQHOo'; // ej: 'eyJhbGciOi...' o 'sb_publishable_...'

// ============================================================
//  Notificaciones con la app cerrada (Web Push)
//  Guía paso a paso: docs/NOTIFICACIONES.md
// ============================================================
// Llave PÚBLICA VAPID (la privada va solo en los secretos de Supabase).
// Si la dejas vacía, los avisos llegan solo cuando abres la app.
export const VAPID_PUBLIC_KEY = '';
