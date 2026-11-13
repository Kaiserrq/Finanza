# Finanza 💰

App personal de finanzas: registra ingresos y gastos, ve en qué se va tu dinero y controla presupuestos por categoría.

Es una **PWA** (Progressive Web App): el mismo código funciona como **página web** y como **app instalable** en el celular o en el computador, incluso sin internet.

## Funciones

- Registro de ingresos y gastos con categoría, fecha y nota
- Resumen del mes: ingresos, gastos, balance y saldo total
- Gráfico de gastos por categoría y tendencia de los últimos 6 meses
- Presupuestos mensuales por categoría con alertas
- Categorías personalizables, varias monedas, tema claro/oscuro
- **Sincronización opcional** entre celular y PC con Supabase → [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md)
- **Importar desde Excel (CSV)** con validación fila por fila → [docs/IMPORTAR.md](docs/IMPORTAR.md)
- Respaldo en JSON y exportación a CSV para Excel

## Privacidad

Tus datos se guardan en tu dispositivo (`localStorage`) y **nunca** se suben al repositorio de GitHub. Si activas la sincronización, también se guardan en **tu** proyecto de Supabase, protegidos por tu cuenta (reglas RLS: cada usuario solo ve sus datos).

## Probar en tu computador

Los service workers necesitan un servidor (no basta con abrir el archivo con doble clic):

```bash
# Con Python
python -m http.server 8080
# o con Node
npx serve .
```

Luego abre http://localhost:8080

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `finanza`) y sube estos archivos.
2. En el repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. En un minuto estará en `https://TU-USUARIO.github.io/finanza/`.

Cuando publiques cambios, sube el número de `CACHE_VERSION` en `sw.js` para que las apps instaladas se actualicen.

## Instalar como app

- **Android (Chrome):** abre la URL → menú ⋮ → *Instalar app* (o el botón *Instalar* en Ajustes).
- **iPhone (Safari):** abre la URL → botón Compartir → *Agregar a pantalla de inicio*.
- **Windows/Mac (Chrome o Edge):** ícono de instalar en la barra de direcciones.

## Estructura

```
index.html            Estructura de la app
css/styles.css        Estilos (claro/oscuro, móvil primero)
js/app.js             Lógica y pantallas
js/storage.js         Guardado local y combinación de datos entre dispositivos
js/sync.js            Conexión con Supabase (cuenta y nube)
js/config.js          ⚙️ Aquí van tus claves de Supabase
js/csv.js             Importación desde Excel/CSV
js/ui.js              Formato de moneda, fechas, tooltips
supabase/schema.sql   Tabla y reglas de seguridad para Supabase
docs/                 Manuales (sincronización e importación)
manifest.webmanifest  Hace que sea instalable
sw.js                 Funcionamiento sin conexión
icons/                Íconos de la app
```
