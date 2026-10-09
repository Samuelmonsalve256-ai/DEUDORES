# Mis Deudores

Control de clientes, préstamos, cuotas y abonos desde el iPhone o el computador, con guardado automático en la nube.

**App:** <https://samuelmonsalve256-ai.github.io/DEUDORES/>

Los datos se guardan en la misma cuenta y la misma base de datos (Supabase) que **MotoContable**:

- Solo tu cuenta puede leer y escribir tus datos.
- Cada cambio se guarda solo en la nube, unos segundos después.
- Cada versión anterior queda guardada y se recupera desde **⋮ → Recuperar datos borrados o cambiados**.
- Sin internet, todo queda en el dispositivo y se sube cuando vuelve la conexión.
- La app abre aunque no haya internet.

> ⚠️ **Nunca subas a GitHub un archivo de backup** (`mis-deudores-backup-….json`). Este repositorio es público y tiene solo el programa, sin datos.

---

## Qué tiene la app

| Pantalla | Para qué sirve |
|---|---|
| **Deudores** | Un cliente por tarjeta, ordenados por urgencia (lo atrasado primero). Filtros: Todos, Vencidos, Al día, Pagados, Archivados. Orden: urgencia, mayor deuda, nombre o más recientes. |
| **Perfil del cliente** | Todo de la persona: datos, llamar o WhatsApp, cuánto debe y cuánto ha pagado, todos sus préstamos (activos, pagados y archivados), historial de pagos y estado de cuenta en PDF. |
| **Cobrar** | Lo atrasado, lo que vence hoy y lo de los próximos 3 días, con el botón **Recordar** (WhatsApp listo) y **+ Abono**. |
| **Análisis** | Totales, reporte por período (cobrado, intereses ganados, por forma de pago, quiénes más pagaron), gráficas y ranking. |
| **⋮ → Ajustes** | Cuenta y nube, notificaciones, backup, PIN y tus datos (para recibos, PDF y mensajes). |

Cada abono guarda la **forma de pago** (efectivo, Nequi, Daviplata, transferencia) y puede llevar la **foto del comprobante**. Cada abono tiene su **recibo con número consecutivo** (REC-0001, REC-0002…).

---

## Configuración

### Paso 1 · Lo básico (ya hecho)

`supabase/deudores.sql`, GitHub Pages y la *Redirect URL* ya están configurados.

### Paso 2 · Perfiles, fotos y notificaciones (`supabase/deudores-2.sql`)

1. Entra en <https://supabase.com/dashboard> y abre el proyecto de MotoContable.
2. Ve a **SQL Editor → New query**.
3. Copia todo el contenido de [`supabase/deudores-2.sql`](supabase/deudores-2.sql), pégalo y pulsa **Run**.
4. Abajo deben aparecer 5 filas: las colecciones (terminan en `'deudores_ajustes'`), la carpeta `deudores-comprobantes` y 3 tablas `dd_push_…`.

Este archivo no borra ni cambia ningún dato. Mientras no lo ejecutes, la app avisa *"Falta un paso en Supabase"*. Tus préstamos se siguen guardando en la nube; los perfiles y los ajustes quedan en el dispositivo y suben solos cuando lo ejecutes.

### Paso 3 · La función de notificaciones (`deudores-avisos`)

1. En Supabase, en el menú izquierdo, abre **Edge Functions**.
2. Pulsa **Deploy a new function** y elige **Via Editor**.
3. En el nombre escribe exactamente: `deudores-avisos`.
4. Borra el código de ejemplo. Copia todo el contenido de [`supabase/functions/deudores-avisos/index.ts`](supabase/functions/deudores-avisos/index.ts) y pégalo.
5. Pulsa **Deploy function**. Deja activada la opción **Verify JWT**, que viene por defecto.

La función crea sola sus claves de seguridad la primera vez. No tienes que copiar ninguna clave.

### Paso 4 · Programar el aviso diario (`supabase/deudores-3-avisos.sql`)

1. **SQL Editor → New query**, pega el contenido de [`supabase/deudores-3-avisos.sql`](supabase/deudores-3-avisos.sql) y pulsa **Run**.
2. Al final debe aparecer la tarea `deudores-avisos` con `active = true`.

Si sale un error con `pg_cron` o `pg_net`, actívalos en **Database → Extensions** (busca `pg_cron` y `pg_net` y actívalos) y vuelve a ejecutar el archivo.

### Paso 5 · Activar las notificaciones en el iPhone

Necesitas iOS 16.4 o superior.

1. Abre la app en **Safari** y toca **Compartir ⬆️ → Agregar a inicio**. Si ya la tenías, bórrala de la pantalla de inicio y vuelve a agregarla.
2. Abre **Mis Deudores desde el ícono** de la pantalla de inicio e inicia sesión.
3. Ve a **⋮ → Ajustes → Notificaciones → Activar notificaciones** y toca **Permitir**.
4. Te llegará una notificación de prueba: *"✅ Mis Deudores · Las notificaciones funcionan…"*.
5. En **Primer aviso del día** elige la hora de la mañana (por defecto 8:00 a. m.).
6. Si quieres un segundo aviso, elige la hora en **Segundo aviso del día** (de 1:00 p. m. a 8:00 p. m.). Déjalo en *Sin segundo aviso* si te basta con uno.

Cada día, a esa hora, te llega como cualquier notificación de una app:

- 🔴 **Cobros para hoy**: lo atrasado y lo que vence hoy, con nombres y valores.
- 🟡 **Mañana vencen…**: lo que vence mañana.
- 💾 **Es hora de tu backup**: cuando toca hacer backup. Se repite cada 3 días hasta que lo hagas.

El segundo aviso (en la tarde) dice 🔴 **Siguen pendientes hoy** y trae solo lo que todavía no se ha pagado. Si ya cobraste todo, no llega. El backup se recuerda solo en el primero.

Al tocarla se abre la app en la pestaña **Cobrar** o en el backup. Las notificaciones llevan el ícono verde **$** de la app y el emoji de color al inicio, para distinguirlas de las demás. iOS no permite cambiar el color de fondo ni el sonido de la notificación de una app web: suena con el sonido normal del iPhone.

> Si cambias el archivo `index.ts` de la función, vuelve a hacer el paso 3: abre **Edge Functions → deudores-avisos → Code**, pega el código nuevo y pulsa **Deploy**.

---

## Backup

- En **⋮ → Ajustes → Backup** eliges cada cuánto te lo recuerda: cada semana, cada 15 días o cada mes.
- Cuando toca, la app te lo pide al abrir y también te llega la notificación 💾.
- En el iPhone, **Descargar backup** abre el menú de compartir. Elige **Guardar en Archivos** (iCloud Drive), tu correo o Google Drive.
- El backup trae préstamos, clientes y ajustes. El PIN no se incluye.
- **Cargar archivo backup** nunca borra nada y no duplica: primero muestra cuántos son nuevos.

## PIN y privacidad

- **⋮ → Ajustes → Seguridad → Poner PIN**: un PIN de 4 números que se pide al abrir la app y al volver después de 1 minuto. Es el mismo en todos tus dispositivos.
- ¿Olvidaste el PIN? Toca **¿Olvidaste tu PIN?** y escribe la contraseña de tu cuenta.
- El botón 👁️ de arriba oculta los montos cuando le muestras la pantalla a alguien.

---

## Pruebas automáticas

En `tests/` hay pruebas que revisan la app completa en un navegador real, con dos dispositivos y una nube simulada. Revisan:

- clientes y perfiles, préstamos, cuotas y abonos;
- confirmaciones, recibos, PDF, reportes, PIN y backup;
- conflictos entre dispositivos, el modo sin internet y el cifrado de las notificaciones.

GitHub las ejecuta solo en cada cambio (pestaña **Actions**). Para correrlas en un computador:

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

Lo que queda para más adelante está en [PENDIENTES.md](PENDIENTES.md).
