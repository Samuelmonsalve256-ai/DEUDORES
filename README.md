# Mis Deudores

Control de deudores, cuotas y abonos, con guardado automático en la nube.

Los datos se guardan en la misma cuenta y la misma base de datos (Supabase) que **MotoContable**,
con las mismas protecciones:

- Solo tu cuenta puede leer y escribir tus deudores.
- Cada cambio se guarda solo en la nube, unos segundos después de hacerlo.
- Cada versión anterior (antes de editar, de borrar un abono o de eliminar un deudor) queda guardada
  y se recupera desde el menú **⋮ → Recuperar datos borrados o cambiados**.
- Si no hay internet, todo queda guardado en el dispositivo y se sube cuando vuelve la conexión.
- Si dos dispositivos cambian el mismo deudor a la vez, nada se pierde: la otra versión queda en el historial.

> ⚠️ **Nunca subas a GitHub un archivo de backup** (`mis-deudores-backup-….json`). Este repositorio es
> público y tiene solo el programa, sin datos.

---

## Configuración (una sola vez)

### Paso 1: permitir los deudores en Supabase

1. Entra en <https://supabase.com/dashboard> y abre el proyecto de MotoContable
   (`llyovzgwdqoeunvyczcy`).
2. En el menú izquierdo abre **SQL Editor** y pulsa **New query**.
3. Abre el archivo [`supabase/deudores.sql`](supabase/deudores.sql), copia todo su contenido y pégalo.
4. Pulsa **Run**.
5. Abajo debe aparecer una regla que termina en `'deudores'`. Si sale un error en rojo, detente y guarda el mensaje.

Este archivo **no borra ni cambia ningún dato** de MotoContable ni de Traspasos.

### Paso 2: publicar la app (GitHub Pages)

1. En este repositorio ve a **Settings → Pages**.
2. En **Source** elige **Deploy from a branch**.
3. En **Branch** elige `main` y la carpeta `/ (root)`. Pulsa **Save**.
4. Espera uno o dos minutos. Tu app quedará en:
   **<https://samuelmonsalve256-ai.github.io/DEUDORES/>**

### Paso 3: enlace de "¿Olvidaste tu contraseña?"

1. En Supabase abre **Authentication → URL Configuration**.
2. En **Redirect URLs** pulsa **Add URL** y agrega:
   `https://samuelmonsalve256-ai.github.io/DEUDORES/**`
3. Pulsa **Save**.

---

## Pasar tus deudores actuales a la nube

Tus datos actuales están guardados solo dentro del navegador, en el archivo que abres desde el escritorio.
Hay que sacarlos con un backup y cargarlos en la app nueva:

1. Abre **tu archivo de siempre** (el del escritorio).
2. Pulsa **⋮ → Guardar backup**. Se descarga `mis-deudores-backup-<fecha>.json`.
   Guarda una copia en Google Drive o en tu correo.
3. Abre la app nueva: <https://samuelmonsalve256-ai.github.io/DEUDORES/>
4. Inicia sesión con **la misma cuenta de MotoContable** (correo y contraseña).
5. Pulsa **⋮ → Cargar archivo backup** y elige el archivo del paso 2.
   La app muestra cuántos deudores son nuevos y no borra nada.
6. Pulsa **Cargar**. Arriba debe decir **"Guardado en la nube"** (punto verde).
7. Comprueba que estén todos tus deudores con sus abonos.

Desde ese momento usa siempre el enlace nuevo, en el computador y en el celular.
Ya no necesitas el archivo del escritorio, pero **no lo borres** hasta comprobar que todo está bien.

---

## El indicador de arriba

| Indicador | Qué significa |
|---|---|
| 🟢 **Guardado en la nube** | Todo está a salvo en la nube |
| 🟡 **Guardando…** | Está subiendo tus últimos cambios |
| 🟠 **Sin internet** | Tus cambios quedan en el dispositivo y se suben al volver la conexión |
| 🟠 **Sin sesión** | Los datos están solo en este dispositivo: toca para iniciar sesión |
| 🔴 **Error al guardar** | Toca para reintentar. Tus datos siguen a salvo en el dispositivo |

Al tocar el indicador se sincroniza de inmediato.

## Recuperar algo borrado o cambiado por error

Menú **⋮ → Recuperar datos borrados o cambiados**: muestra las versiones anteriores de cada deudor
(antes de editar, eliminados, etc.). Pulsa **Restaurar** en la que quieras. La versión que reemplazas
también queda guardada, así que puedes deshacerlo.

## Backups adicionales

Aunque todo está en la nube, de vez en cuando (por ejemplo cada mes) usa **⋮ → Guardar backup**
y guarda el archivo en Google Drive. Es una copia extra en tus manos.
