# 🔔 Manual: avisos de pago con la app cerrada

La sección **Calendario** te avisa de cada pago **una vez al día durante 3 días antes y el mismo día**. Ejemplo: si un pago vence el **23 de noviembre**, recibes un aviso el **20, 21, 22 y 23**, a las **9:00 a. m.** de tu hora local, hasta que lo marques como **Pagado**.

### Dos niveles

| | Sin configurar nada | Con esta guía |
|---|---|---|
| Aviso al **abrir** la app | ✅ | ✅ |
| Tarjeta "Pagos próximos" en Resumen | ✅ | ✅ |
| Aviso con la app **cerrada** (celular y laptop) | ❌ | ✅ |

Una página web no puede programar avisos por su cuenta: con la app cerrada, alguien tiene que "tocar la puerta" del dispositivo. Ese alguien es una pequeña función en tu proyecto de Supabase que se ejecuta cada hora y envía una notificación **Web Push** a cada dispositivo donde activaste los avisos.

```
pg_cron (cada hora) → función send-reminders → servicio push de Google/Apple/Microsoft → tu celular / laptop
```

**Requisitos:** tener la sincronización funcionando ([SINCRONIZACION.md](SINCRONIZACION.md)) e iniciar sesión en cada dispositivo. Todo cabe en el plan gratuito de Supabase.

---

## Paso 1: Crear las llaves VAPID (1 min)

Son un par de llaves que identifican a tu app ante los servicios de notificaciones. En una terminal (necesitas Node.js):

```bash
npx web-push generate-vapid-keys
```

Verás algo así:

```
Public Key:
BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U

Private Key:
UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
```

Guárdalas. La **pública** va en **dos** lugares: en Supabase (paso 4) y en `config.js` (paso 6). La **privada** va **solo** en Supabase (paso 4). **Nunca** pongas la privada en `config.js` ni en GitHub.

## Paso 2: Crear la tabla de dispositivos (1 min)

Supabase → **SQL Editor** → **New query** → copia la **PARTE 1** de [`supabase/notificaciones.sql`](../supabase/notificaciones.sql) → **Run**.

## Paso 3: Crear la función (3 min)

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: **`send-reminders`** (exactamente así).
3. Borra el código de ejemplo y pega **todo** el contenido de [`supabase/functions/send-reminders/index.ts`](../supabase/functions/send-reminders/index.ts).
4. **Deploy function**.
5. En la función → **Details** (o **Settings**): desactiva **Verify JWT** / **Enforce JWT verification** y guarda. La función se protege con su propio secreto (`CRON_SECRET`), no con la sesión de un usuario.

> Si usas la CLI de Supabase: `supabase functions deploy send-reminders --no-verify-jwt`

## Paso 4: Guardar los secretos (2 min)

Supabase → **Edge Functions** → **Secrets** → agrega:

| Nombre | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | la llave pública del paso 1 |
| `VAPID_PRIVATE_KEY` | la llave privada del paso 1 |
| `VAPID_SUBJECT` | `mailto:` seguido de tu correo, ej. `mailto:yo@ejemplo.com` (los servicios push lo usan para contactarte si hay problemas) |
| `CRON_SECRET` | una contraseña larga inventada, ej. `finanza-2026-xK83jd92LmQ` |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen: Supabase las da automáticamente a las funciones.

## Paso 5: Programar el envío (1 min)

1. Abre la **PARTE 2** de [`supabase/notificaciones.sql`](../supabase/notificaciones.sql).
2. Reemplaza `PEGA-AQUI-TU-CRON-SECRET` por el mismo `CRON_SECRET` del paso 4.
3. Pégala en **SQL Editor** → **Run**.

Desde ahora, la función se ejecuta al minuto 0 de cada hora y avisa a cada dispositivo cuando allí son las 9:00.

## Paso 6: Conectar la app (1 min)

1. En [`js/config.js`](../js/config.js) pega la llave **pública**:
   ```js
   export const VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-...';
   ```
2. Sube el número de versión en [`sw.js`](../sw.js) (ej. `finanza-v5` → `finanza-v6`) y sube los cambios a GitHub.

## Paso 7: Activar en cada dispositivo

En **cada** celular y computador: abre la app → **Calendario** → **Activar notificaciones** → **Permitir**.

La tarjeta debe decir 🟢 **Activadas**. Para probar desde el servidor, ejecuta en el SQL Editor el bloque *"Enviar una notificación de prueba"* que está al final de `notificaciones.sql` (quítale los `--` y pon tu `CRON_SECRET`). Debe llegarte **"🔔 Prueba de Finanza"** a todos tus dispositivos.

---

## Notas por dispositivo

- **Android (Chrome):** funciona con la app cerrada. Si el ahorro de batería es muy agresivo, el aviso puede llegar con unos minutos de retraso.
- **iPhone / iPad:** necesitas **iOS 16.4 o superior** y la app **instalada** (Safari → Compartir → *Agregar a pantalla de inicio*). Desde Safari normal, sin instalar, iOS no permite notificaciones.
- **Laptop (Windows / Mac):** el aviso llega aunque la pestaña esté cerrada, **siempre que el navegador esté abierto o corriendo en segundo plano**. En Chrome/Edge: *Configuración → Sistema → "Seguir ejecutando aplicaciones en segundo plano al cerrar"*. Si la laptop está apagada, el aviso se guarda hasta 12 horas y llega al encenderla.
- Si apagas el dispositivo varios días, solo te llegan los avisos de los días en que estuvo encendido. La tarjeta **Pagos próximos** de la app siempre muestra lo pendiente.

## Preguntas frecuentes

**La tarjeta dice "Solo con la app abierta"** → Falta la llave pública en `config.js` (paso 6), no has iniciado sesión en ese dispositivo, o hay un error. Si dice *"Falta crear la tabla de avisos"*, repite el paso 2.

**No llega la prueba** → Revisa el resultado con `select status_code, content from net._http_response order by created desc limit 5;`
- `401 No autorizado`: el `CRON_SECRET` del SQL no coincide con el del paso 4.
- `Falta configurar el secreto ...`: falta ese secreto en el paso 4.
- `"dispositivos": 0`: ningún dispositivo activó los avisos (paso 7).
- `"enviados": 1` pero no ves nada: revisa que el sistema operativo permita notificaciones del navegador.

**¿Me llega el aviso repetido si tengo la app abierta?** → No. Cada aviso tiene una etiqueta por recordatorio y día; el teléfono y la app la comparten y no lo muestran dos veces.

**¿Puedo cambiar la hora?** → Cambia `SEND_HOUR` en la función (paso 3) **y** en `js/notify.js`, y vuelve a desplegar ambos.

**Mi proyecto de Supabase aparece "Paused"** → Mientras está pausado no se envían avisos. Entra al panel y pulsa **Restore project**.

**¿Cómo desactivo los avisos?** → En un dispositivo: bloquea las notificaciones del sitio en el navegador o cierra sesión. Para todos: ejecuta `select cron.unschedule('finanza-recordatorios');`.
