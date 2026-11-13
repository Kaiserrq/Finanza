# 📥 Manual: importar movimientos desde Excel

Con esto cargas muchos movimientos de una vez, por ejemplo tu historial de meses anteriores.

**Dónde:** Ajustes → *Importar desde Excel* → **Importar CSV**

---

## 1. Formato del archivo

La app lee archivos **CSV**. Excel no los usa por defecto, pero puede guardar en ese formato (ver paso 3).

La **primera fila** debe llevar estos títulos. No importan las mayúsculas, las tildes ni el orden de las columnas:

| Columna | ¿Obligatoria? | Qué poner | Ejemplos válidos |
|---|---|---|---|
| **Fecha** | ✅ Sí | Día del movimiento | `05/11/2026` · `5/11/26` · `2026-11-05` |
| **Tipo** | ✅ Sí | Si entró o salió dinero | `Gasto` · `Ingreso` (también `G` / `I`, `Egreso` / `Entrada`) |
| **Categoría** | ✅ Sí | Nombre de la categoría | `Comida`, `Salario`… Si no existe, **se crea sola** |
| **Monto** | ✅ Sí | Valor, sin signo | `45000` · `45.000` · `$ 45.000` · `1.250.000,50` |
| **Nota** | ❌ No | Descripción | `Mercado de la semana` |

También se aceptan otros nombres para los títulos:
- *Fecha*: `Día`
- *Categoría*: `Rubro`
- *Monto*: `Valor`, `Importe` o `Cantidad`
- *Nota*: `Descripción`, `Detalle` o `Concepto`

Las columnas que la app no reconoce se ignoran y te avisa cuáles fueron.

### Ejemplo

| Fecha | Tipo | Categoría | Monto | Nota |
|---|---|---|---|---|
| 01/11/2026 | Ingreso | Salario | 3.500.000 | Nómina noviembre |
| 05/11/2026 | Gasto | Comida | 45.000 | Mercado de la semana |
| 07/11/2026 | Gasto | Transporte | 12.500 | |

> 💡 Lo más fácil es tocar **Descargar plantilla** en la app, abrirla en Excel y llenarla.

---

## 2. ¿Qué pasa si una fila está mal?

**Cada fila se revisa por separado.** Las filas correctas se importan y las que tienen errores **no se guardan**. Al terminar verás un resumen con el **número de fila** (el mismo que ves en Excel) y el motivo del error:

```
✅ 118 movimientos importados.
🆕 Categorías nuevas creadas: Mascotas, Gimnasio.
⏭️ 3 filas omitidas porque ya existían.
⚠️ 2 filas con errores no se importaron:
   Fila 7:  la fecha «31/02/2026» no es válida (usa DD/MM/AAAA o AAAA-MM-DD)
   Fila 15: el tipo «Compra» no se reconoce (escribe Gasto o Ingreso)
```

| Situación | Qué hace la app |
|---|---|
| Fecha imposible (31/02) o con otro formato | ⚠️ Error, la fila no se importa |
| Tipo distinto de Gasto/Ingreso | ⚠️ Error, la fila no se importa |
| Monto vacío, en cero o con letras | ⚠️ Error, la fila no se importa |
| Categoría vacía | ⚠️ Error, la fila no se importa |
| La categoría no existe | 🆕 Se crea automáticamente |
| Fila completamente vacía | Se salta, sin error |
| Movimiento idéntico a uno que ya tienes (mismo día, tipo, categoría, monto y nota) | ⏭️ Se omite para no duplicarlo |
| Falta una columna obligatoria en los títulos | ⛔ No se importa nada y se indica qué columna falta |
| Archivo `.xlsx` en lugar de `.csv` | ⛔ Te pide guardarlo como CSV |

**Para corregir:** arregla las filas indicadas en tu archivo y **vuelve a importar el mismo archivo completo**. Las filas que ya entraron se detectan como repetidas y no se duplican.

**¿Te equivocaste de archivo?** En el resumen aparece el botón **Deshacer importación**, que borra todo lo que acaba de entrar.

---

## 3. Cómo guardar como CSV

- **Excel (Windows/Mac):** Archivo → Guardar como → tipo **CSV UTF-8 (delimitado por comas) (*.csv)**.
- **Google Sheets:** Archivo → Descargar → **Valores separados por comas (.csv)**.
- **Celular:** abre el archivo en Google Sheets o Excel y usa la misma opción.

La app detecta sola si el separador es `;` (Excel en español), `,` o tabulador.

---

## 4. Exportar y respaldos

- **Exportar a Excel:** genera un CSV con el mismo formato, así que lo puedes editar y volver a importar.
- **Exportar respaldo (.json):** copia completa con categorías y presupuestos. Se recupera con **Restaurar respaldo**, que **combina** el respaldo con lo que ya tienes, sin borrar nada.
