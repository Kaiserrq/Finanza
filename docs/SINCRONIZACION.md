# ☁️ Manual: activar la sincronización (celular ↔ PC)

La app usa **Supabase**, una base de datos en la nube con plan **gratuito** que alcanza de sobra para uso personal (500 MB, y tus datos ocuparán unos pocos KB).

### ¿Por qué no GitHub?
GitHub Pages solo publica archivos (HTML, CSS, JS). **No puede ejecutar una base de datos ni guardar información de los usuarios.** Por eso cada parte va en un lugar distinto:

```
GitHub Pages  →  la app (el código, público)
Supabase      →  tus datos (privados, protegidos con tu cuenta)
```

### ¿Cómo funciona?
- La app **sigue funcionando sin internet**. Todo se guarda primero en el dispositivo.
- Cuando hay conexión, sube tus cambios y baja los de tus otros dispositivos. Esto pasa al abrir la app, unos segundos después de cada cambio y cada minuto mientras está abierta.
- Si registras algo en el celular sin internet y algo en el PC, al reconectar **se combinan, no se pierde nada**. Si editas el **mismo** movimiento en los dos dispositivos, queda la edición más reciente.

---

## Paso 1: Crear el proyecto en Supabase (5 min)

1. Entra a **https://supabase.com** → **Start your project** e inicia sesión. Puedes usar tu cuenta de GitHub.
2. **New project**:
   - **Name:** `finanza`
   - **Database Password:** genera una y guárdala. La app no la usa, pero Supabase la pide.
   - **Region:** la más cercana a ti (por ejemplo *South America (São Paulo)* o *East US*).
   - Plan **Free** → **Create new project**. Tarda 1 o 2 minutos.

## Paso 2: Crear la tabla (1 min)

1. En el menú izquierdo: **SQL Editor** → **New query**.
2. Abre el archivo [`supabase/schema.sql`](../supabase/schema.sql) de este proyecto, copia **todo** su contenido y pégalo.
3. Pulsa **Run**. Debe aparecer *"Success. No rows returned"*.

Esto crea la tabla `finanza_data` y las **reglas de seguridad (RLS)**: cada usuario solo puede ver y modificar sus propios datos.

## Paso 3: Configurar el inicio de sesión (2 min)

1. **Authentication → URL Configuration**:
   - **Site URL:** la dirección de tu app en GitHub Pages, por ejemplo `https://TU-USUARIO.github.io/finanza/`
   - **Redirect URLs:** agrega esa misma dirección y también `http://localhost:8080` (para pruebas en tu PC).
2. *(Opcional, más simple)* **Authentication → Sign In / Providers → Email**: puedes desactivar **Confirm email** para no tener que confirmar el correo. Si lo dejas activado, al crear la cuenta te llegará un correo de confirmación.

## Paso 4: Conectar la app (1 min)

1. En Supabase: **Project Settings → API** (en algunas versiones se llama **API Keys** / **Data API**).
2. Copia:
   - **Project URL**, algo como `https://abcdxyz.supabase.co`
   - **anon public key** o **publishable key**, un texto largo
3. Ábrelas en [`js/config.js`](../js/config.js) y pégalas:

```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

4. Sube el número de versión en [`sw.js`](../sw.js) (por ejemplo `finanza-v3` → `finanza-v4`) y sube los cambios a GitHub.

> 🔐 **¿Es seguro que esa clave quede pública en GitHub?** Sí. Esa clave está hecha para ir en el navegador; lo que protege tus datos son las reglas RLS del paso 2.
> ⛔ **Nunca** pongas la **service_role key** o **secret key**: esa sí da acceso total.

## Paso 5: Usarla

1. **En el PC:** abre la app → **Ajustes → Sincronización** → escribe correo y contraseña → **Crear cuenta**. Si dejaste la confirmación activada, abre el correo, confírmalo y luego **Iniciar sesión**.
2. **En el celular:** abre la app → **Ajustes → Sincronización** → **Iniciar sesión** con el **mismo correo y contraseña**.
3. Listo. El indicador muestra 🟢 *Sincronizado*. Lo que registres en uno aparece en el otro, al instante si la app está abierta o al volver a abrirla.

Si ya tenías datos en los dos dispositivos antes de conectarlos, se combinan y no se pierde ninguno.

---

## Preguntas frecuentes

**Dice "Falta crear la tabla"** → No se ejecutó el paso 2. Repítelo.

**Dice "Debes confirmar tu correo"** → Revisa la bandeja de entrada y el spam, o desactiva *Confirm email* (paso 3.2).

**El enlace del correo de confirmación abre una página que no carga** → Revisa que la *Site URL* del paso 3.1 sea la dirección correcta de tu app.

**Mi proyecto de Supabase aparece "Paused"** → En el plan gratuito, Supabase pausa los proyectos que pasan aproximadamente una semana sin uso. Entra al panel y pulsa **Restore project**. Mientras tanto la app sigue funcionando con los datos del dispositivo y sincroniza cuando se reactive.

**¿Puedo ver mis datos directamente?** → Sí: Supabase → **Table Editor → finanza_data**. Es una fila por usuario con todos tus datos en la columna `data`.

**¿Cómo desactivo la sincronización?** → Ajustes → **Cerrar sesión**. Tus datos se quedan en el dispositivo.
