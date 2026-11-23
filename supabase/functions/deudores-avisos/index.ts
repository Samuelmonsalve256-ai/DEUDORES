// @ts-nocheck
// ════════════════════════════════════════════════════════════════════════════
// Mis Deudores · Edge Function "deudores-avisos"
// Envia las notificaciones al iPhone (Web Push), como las de cualquier app.
//
//   accion "clave"  : (con tu sesion) entrega la clave publica para activar avisos.
//   accion "prueba" : (con tu sesion) envia una notificacion de prueba a tus dispositivos.
//   accion "diario" : (la llama Supabase Cron cada hora) a las horas que elegiste en
//                     Ajustes (1 o 2 veces al dia) revisa tus prestamos y envia: atrasados
//                     y lo que vence hoy, las promesas de pago del dia, lo que vence manana
//                     y (en el primer aviso) el recordatorio de backup. Con "avisos discretos"
//                     no van nombres ni valores (se ven en la pantalla bloqueada).
//                     Si un aviso no se pudo enviar, se reintenta en las 2 horas siguientes.
//                     Ademas, cada 15 dias guarda solo un backup en la nube (carpeta privada
//                     deudores-backups, guarda los 6 ultimos) y avisa que se hizo.
//
// No usa librerias externas: el cifrado de Web Push (RFC 8291) y la firma VAPID
// (RFC 8292) se hacen con WebCrypto. Ver README del repositorio DEUDORES.
// ════════════════════════════════════════════════════════════════════════════

const URL_APP = 'https://samuelmonsalve256-ai.github.io/DEUDORES/';
const ZONA_OFFSET_HORAS = -5;            // Colombia (sin horario de verano)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dd-cron',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Utilidades de bytes ──────────────────────────────────────────────────────
const te = new TextEncoder();
export function b64url(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function unir(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total); let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt, info}, k, bytes * 8));
}

// ── VAPID: claves y firma ────────────────────────────────────────────────────
export async function generarClavesVapid() {
  const par = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const privada = await crypto.subtle.exportKey('jwk', par.privateKey);
  return {publica: b64url(publica), privada};
}
export async function firmaVapid(endpoint, vapid, sub) {
  const aud = new URL(endpoint).origin;
  const cab = b64url(te.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const cuerpo = b64url(te.encode(JSON.stringify({aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub})));
  const clave = await crypto.subtle.importKey('jwk', vapid.privada, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, clave, te.encode(cab + '.' + cuerpo)));
  return 'vapid t=' + cab + '.' + cuerpo + '.' + b64url(firma) + ', k=' + vapid.publica;
}

// ── Cifrado del mensaje (aes128gcm, RFC 8291) ────────────────────────────────
export async function cifrarMensaje(p256dh, authSecret, texto) {
  const uaPublica = deB64url(p256dh), auth = deB64url(authSecret);
  const efimera = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPublica = new Uint8Array(await crypto.subtle.exportKey('raw', efimera.publicKey));
  const uaClave = await crypto.subtle.importKey('raw', uaPublica, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaClave}, efimera.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, unir(te.encode('WebPush: info\0'), uaPublica, asPublica), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const claveAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plano = unir(te.encode(texto), new Uint8Array([2]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, claveAes, plano));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return unir(salt, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

export async function enviarPush(sus, vapid, mensaje) {
  const cuerpo = await cifrarMensaje(sus.p256dh, sus.auth, JSON.stringify(mensaje));
  const r = await fetch(sus.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': 'high',
      'Authorization': await firmaVapid(sus.endpoint, vapid, URL_APP),
    },
    body: cuerpo,
  });
  return r.status;
}

// ── Calculos (los mismos de la app) ──────────────────────────────────────────
function hoyColombia(desfaseDias = 0) {
  const d = new Date(Date.now() + ZONA_OFFSET_HORAS * 3600e3 + desfaseDias * 86400e3);
  return d.toISOString().slice(0, 10);
}
/* Dia en Colombia de una fecha y hora guardada en UTC (un backup a las 8 p.m. sigue siendo de hoy) */
export function fechaColombia(valor) {
  const v = String(valor || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return isNaN(t) ? v.slice(0, 10) : new Date(t + ZONA_OFFSET_HORAS * 3600e3).toISOString().slice(0, 10);
}
export function horaColombia() { return new Date(Date.now() + ZONA_OFFSET_HORAS * 3600e3).getUTCHours(); }
function diasEntre(desde, hasta) {
  return Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / 86400e3);
}
/* Meses completos y dias sueltos entre dos fechas (igual que en la app) */
export function mesesYDias(d1, d2) {
  const a = String(d1).split('-').map(Number), b = String(d2).split('-').map(Number);
  const ini = Date.UTC(a[0], a[1] - 1, a[2]), fin = Date.UTC(b[0], b[1] - 1, b[2]);
  if (!(fin > ini)) return {meses: 0, dias: 0};
  const masMeses = (m) => Date.UTC(a[0], a[1] - 1 + m, Math.min(a[2], new Date(Date.UTC(a[0], a[1] - 1 + m + 1, 0)).getUTCDate()));
  let m = Math.max(0, (b[0] - a[0]) * 12 + (b[1] - a[1]));
  while (m > 0 && masMeses(m) > fin) m--;
  while (masMeses(m + 1) <= fin) m++;
  return {meses: m, dias: Math.round((fin - masMeses(m)) / 86400000)};
}
/* Interes simple mensual en pesos enteros: por meses de calendario (prestamos nuevos)
   o por dias / 30,44 (prestamos antiguos, sin interesModo) */
export function calcInterest(monto, rate, d1, d2, modo) {
  monto = parseFloat(monto) || 0; rate = parseFloat(rate) || 0;
  if (!rate || !d1 || !d2) return Math.round(monto);
  if (modo === 'meses') { const md = mesesYDias(d1, d2); return Math.round(monto * (1 + (rate / 100) * (md.meses + md.dias / 30))); }
  const dias = Math.max(0, (new Date(d2).getTime() - new Date(d1).getTime()) / 86400000);
  return Math.round(monto * (1 + (rate / 100) * (dias / 30.4375)));
}
export function totalDeuda(d) {
  const cuotas = d.cuotas || [];
  const calc = calcInterest(d.monto, d.interes, d.fechaPrestamo, d.fechaPago, d.interesModo);
  if (!cuotas.length) return calc;
  const suma = cuotas.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
  return Math.abs(suma - calc) < 1 ? calc : Math.round(suma);
}
const pesos = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');

/* Lo que hay que cobrar: atrasado, hoy y manana, por prestamo */
export function calcularAvisos(prestamos, hoy) {
  const manana = new Date(Date.parse(hoy + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10);
  const atrasados = [], deHoy = [], deManana = [];
  for (const d of prestamos) {
    if (!d || d.pagado || d.archivado) continue;
    const abonado = (d.abonos || []).reduce((s, a) => s + (parseFloat(a.monto) || 0), 0);
    let disponible = abonado;
    const pendientes = [];
    const cuotas = d.cuotas || [];
    if (cuotas.length) {
      for (const c of cuotas) {
        const m = parseFloat(c.monto) || 0, aplicado = Math.min(disponible, m);
        disponible -= aplicado;
        if (m - aplicado > 0.5 && c.fecha) pendientes.push({fecha: c.fecha, monto: m - aplicado});
      }
    } else if (d.fechaPago) {
      const saldo = totalDeuda(d) - abonado;
      if (saldo > 0.5) pendientes.push({fecha: d.fechaPago, monto: saldo});
    }
    const nombre = String(d.nombre || 'Cliente').split(' ').slice(0, 2).join(' ');
    const atr = pendientes.filter(p => p.fecha < hoy);
    if (atr.length) atrasados.push({nombre, monto: atr.reduce((s, p) => s + p.monto, 0), dias: diasEntre(atr[0].fecha, hoy)});
    const h = pendientes.find(p => p.fecha === hoy);
    if (h) deHoy.push({nombre, monto: h.monto});
    const m = pendientes.find(p => p.fecha === manana);
    if (m) deManana.push({nombre, monto: m.monto});
  }
  atrasados.sort((a, b) => b.dias - a.dias);
  return {atrasados, deHoy, deManana};
}

/* Promesas de pago para hoy que aun no se cumplen (lo que se pago desde que prometio hasta hoy) */
export function promesasDeHoy(clientes, prestamos, hoy) {
  const res = [];
  for (const c of clientes || []) {
    for (const p of (c && c.promesas) || []) {
      if (!p || p.fecha !== hoy || p.estado) continue;   // estado: cumplida, reprogramada o cancelada
      const lista = (prestamos || []).filter(d => d && d.clienteId === c.id && (!p.prestamoId || d.id === p.prestamoId));
      if (lista.length && lista.every(d => d.pagado)) continue;
      const pagado = lista.reduce((s, d) => s + (d.abonos || []).reduce((t, a) =>
        t + (a && a.fecha && a.fecha >= (p.desde || '') && a.fecha <= hoy ? (parseFloat(a.monto) || 0) : 0), 0), 0);
      const monto = parseFloat(p.monto) || 0;
      if (monto > 0 ? pagado >= monto - 0.5 : pagado > 0) continue;
      res.push({nombre: String(c.nombre || 'Cliente').split(' ').slice(0, 2).join(' '), monto: monto > 0 ? monto - pagado : 0});
    }
  }
  return res;
}

/* Horas del dia en que el usuario quiere avisos (1 o 2). Por defecto 8:00 a.m. */
export function horasDeAviso(ajustes) {
  const a = (ajustes && ajustes.avisos) || {};
  let horas = Array.isArray(a.horas) ? a.horas.filter(Number.isInteger) : [];
  if (!horas.length) horas = [Number.isInteger(a.hora) ? a.hora : 8];
  return [...new Set(horas)].sort((x, y) => x - y).slice(0, 2);
}
/* A esta hora, ¿toca aviso? Devuelve null o {tipo, primera} */
export function avisoDeLaHora(ajustes, hora) {
  if (ajustes && ajustes.avisos && ajustes.avisos.activos === false) return null;
  const horas = horasDeAviso(ajustes);
  if (!horas.includes(hora)) return null;
  return {tipo: 'diario-' + hora, primera: hora === horas[0]};
}

/* Avisos que toca enviar a esta hora: el de su hora, o uno de las 2 horas anteriores que
   no se pudo enviar (si no ha llegado la hora del siguiente aviso del dia) */
export function avisosDeLaHora(ajustes, hora) {
  if (ajustes && ajustes.avisos && ajustes.avisos.activos === false) return [];
  const horas = horasDeAviso(ajustes);
  return horas.map((h, i) => ({h, i}))
    .filter(({h, i}) => hora >= h && hora <= h + 2 && !(i + 1 < horas.length && hora >= horas[i + 1]))
    .map(({h, i}) => ({tipo: 'diario-' + h, primera: i === 0}));
}

// ── Backup automatico cada 15 dias ───────────────────────────────────────────
export const BUCKET_BACKUPS = 'deudores-backups';
export const DIAS_ENTRE_BACKUPS = 15;
export const BACKUPS_GUARDADOS = 6;
/* El mismo formato que el backup que se descarga desde la app (sin el PIN) */
export function armarBackup(prestamos, clientes, ajustes, ahoraISO) {
  const aj = JSON.parse(JSON.stringify(ajustes || {}));
  delete aj.pin;
  return {version: 'deudores_v4', fecha: ahoraISO, automatico: true, total: prestamos.length, datos: prestamos, clientes, ajustes: aj};
}
const fechaDeBackup = (nombre) => ((String(nombre).split('/').pop().match(/^backup-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]) || null;
/* ¿Toca hacer backup hoy? (el ultimo fue hace 15 dias o mas, o no hay ninguno) */
export function tocaBackup(nombres, hoy) {
  const fechas = (nombres || []).map(fechaDeBackup).filter(Boolean).sort();
  return !fechas.length || diasEntre(fechas[fechas.length - 1], hoy) >= DIAS_ENTRE_BACKUPS;
}
/* Los backups viejos que sobran (se guardan los 6 mas recientes) */
export function backupsParaBorrar(nombres) {
  const conFecha = (nombres || []).filter(fechaDeBackup).sort((a, b) => fechaDeBackup(b).localeCompare(fechaDeBackup(a)));
  return conFecha.slice(BACKUPS_GUARDADOS);
}

/* Compara dos textos sin revelar por el tiempo cuantas letras coinciden */
export function igualSeguro(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return false;
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

export function armarMensajes(av, ajustes, hoy, opciones = {}) {
  const segunda = opciones.primera === false;
  const discretos = !!(ajustes && ajustes.avisos && ajustes.avisos.discretos);
  const msgs = [];
  const lista = (xs) => xs.slice(0, 4).map(x => x.nombre + (x.monto > 0 ? ' ' + pesos(x.monto) : '')).join(', ') + (xs.length > 4 ? ' y ' + (xs.length - 4) + ' más' : '');
  const n = (k, uno, varios) => k + ' ' + (k === 1 ? uno : varios);
  if (av.atrasados.length || av.deHoy.length) {
    const partes = [];
    const total = av.deHoy.concat(av.atrasados).reduce((s, x) => s + x.monto, 0);
    if (discretos) {
      if (av.deHoy.length) partes.push(n(av.deHoy.length, 'cobro para hoy', 'cobros para hoy'));
      if (av.atrasados.length) partes.push(n(av.atrasados.length, 'atrasado', 'atrasados'));
      msgs.push({title: segunda ? '🔴 Siguen pendientes hoy' : '🔴 Cobros para hoy', body: 'Tienes ' + partes.join(' y ') + '. Toca para verlos.', tag: 'dd-cobros', url: URL_APP + '?tab=cobrar'});
    } else {
      if (av.deHoy.length) partes.push('Hoy: ' + lista(av.deHoy));
      if (av.atrasados.length) partes.push('Atrasados (' + av.atrasados.length + '): ' + pesos(av.atrasados.reduce((s, x) => s + x.monto, 0)) + ' — ' + lista(av.atrasados));
      msgs.push({title: (segunda ? '🔴 Siguen pendientes hoy · ' : '🔴 Cobros para hoy · ') + pesos(total), body: partes.join('\n'), tag: 'dd-cobros', url: URL_APP + '?tab=cobrar'});
    }
  }
  const proms = av.promesas || [];
  if (proms.length) {
    const total = proms.reduce((s, x) => s + x.monto, 0);
    msgs.push(discretos
      ? {title: '🤝 Promesas de pago para hoy', body: 'Tienes ' + n(proms.length, 'cliente que prometió', 'clientes que prometieron') + ' pagarte hoy. Toca para verlos.', tag: 'dd-promesas', url: URL_APP + '?tab=promesas'}
      : {title: '🤝 Promesas de pago para hoy' + (total > 0 ? ' · ' + pesos(total) : ''), body: 'Prometieron pagarte hoy: ' + lista(proms), tag: 'dd-promesas', url: URL_APP + '?tab=promesas'});
  }
  if (av.deManana.length) {
    msgs.push({title: '🟡 Mañana vence' + (av.deManana.length === 1 ? '' : 'n') + ' ' + av.deManana.length + ' cuota' + (av.deManana.length === 1 ? '' : 's'),
               body: discretos ? 'Toca para verlas.' : lista(av.deManana), tag: 'dd-manana', url: URL_APP + '?tab=cobrar'});
  }
  if (segunda) return msgs;   // el recordatorio de backup va solo en el primer aviso del dia
  const bk = (ajustes && ajustes.backup) || {};
  if (bk.frecuencia === 'nunca') return msgs;   // solo el backup automatico
  const cada = {semanal: 7, quincenal: 15, mensual: 30}[bk.frecuencia] || 30;
  const desde = bk.ultimo ? diasEntre(fechaColombia(bk.ultimo), hoy) : null;
  if (desde === null || desde >= cada) {
    if (desde === null || (desde - cada) % 3 === 0) {
      msgs.push({title: '💾 Es hora de tu backup', body: desde === null ? 'Aún no has descargado ningún backup. Toca para hacerlo ahora.' : 'Tu último backup fue hace ' + desde + ' días. Toca para descargarlo y guardarlo en Archivos o Drive.', tag: 'dd-backup', url: URL_APP + '?backup=1'});
    }
  }
  return msgs;
}

// ── Base de datos (con la clave de servicio, solo dentro de Supabase) ────────
const ENV = (k) => (typeof Deno !== 'undefined' ? Deno.env.get(k) : undefined);
const SB_URL = ENV('SUPABASE_URL');
const SB_SERVICE = ENV('SUPABASE_SERVICE_ROLE_KEY');
const SB_ANON = ENV('SUPABASE_ANON_KEY');
async function db(ruta, opciones = {}) {
  const r = await fetch(SB_URL + '/rest/v1/' + ruta, {
    ...opciones,
    headers: {apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json', ...(opciones.headers || {})},
  });
  if (!r.ok) throw new Error('BD ' + r.status + ': ' + await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
class ErrorConocido extends Error {}
async function leerConfig() {
  const filas = await db('dd_push_config?id=eq.1&select=*');
  const c = filas && filas[0];
  if (!c) throw new ErrorConocido('Falta ejecutar supabase/deudores-2.sql');
  return c;
}
async function config() {
  let c = await leerConfig();
  if (!c.vapid_publica || !c.vapid_privada) {
    const k = await generarClavesVapid();
    await db('dd_push_config?id=eq.1', {method: 'PATCH', body: JSON.stringify({vapid_publica: k.publica, vapid_privada: k.privada})});
    c = {...c, vapid_publica: k.publica, vapid_privada: k.privada};
  }
  return c;
}
async function storage(ruta, opciones = {}) {
  const r = await fetch(SB_URL + '/storage/v1/' + ruta, {
    ...opciones,
    headers: {apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, ...(opciones.headers || {})},
  });
  if (!r.ok) throw new Error('Storage ' + r.status + ': ' + await r.text());
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch (e) { return t; }
}
async function marcar(uid, fecha, tipo) {
  const m = await db('dd_push_envios', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=representation'},
    body: JSON.stringify({user_id: uid, fecha, tipo})});
  return !!(m && m.length);
}
async function desmarcar(uid, fecha, tipo) {
  await db('dd_push_envios?user_id=eq.' + uid + '&fecha=eq.' + fecha + '&tipo=eq.' + encodeURIComponent(tipo), {method: 'DELETE'}).catch(() => {});
}
/* Backup automatico de un usuario (una revision al dia). Devuelve el aviso, o null */
async function backupAutomatico(uid, prestamos, clientes, ajustes, hoy) {
  if (!prestamos.length && !clientes.length) return null;
  if (!await marcar(uid, hoy, 'backup-auto')) return null;
  try {
    const lista = await storage('object/list/' + BUCKET_BACKUPS, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prefix: uid + '/', limit: 100, offset: 0, sortBy: {column: 'name', order: 'asc'}})});
    const nombres = (lista || []).map(o => o.name);
    if (!tocaBackup(nombres, hoy)) return null;
    const archivo = 'backup-' + hoy + '.json';
    await storage('object/' + BUCKET_BACKUPS + '/' + uid + '/' + archivo, {method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-upsert': 'true'},
      body: JSON.stringify(armarBackup(prestamos, clientes, ajustes, new Date().toISOString()))});
    const viejos = backupsParaBorrar(nombres.concat([archivo]));
    if (viejos.length) await storage('object/' + BUCKET_BACKUPS, {method: 'DELETE', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prefixes: viejos.map(n => uid + '/' + n.split('/').pop())})}).catch(() => {});
    return {title: '💾 Backup automático guardado',
      body: 'Se guardó una copia de tus ' + prestamos.length + ' préstamos y ' + clientes.length + ' clientes en la nube. La puedes descargar en Ajustes → Backup.',
      tag: 'dd-backup-auto', url: URL_APP + '?ajustes=1'};
  } catch (e) {
    console.log('Backup automatico fallo (se reintenta en la proxima hora):', e);
    await desmarcar(uid, hoy, 'backup-auto');
    return null;
  }
}
async function usuarioDeToken(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(SB_URL + '/auth/v1/user', {headers: {apikey: SB_ANON || SB_SERVICE, Authorization: 'Bearer ' + token}});
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
async function enviarAUsuario(userId, mensajes, vapid) {
  const subs = await db('dd_push_suscripciones?user_id=eq.' + userId + '&select=*');
  let ok = 0;
  for (const s of subs || []) {
    for (const m of mensajes) {
      try {
        const st = await enviarPush(s, vapid, m);
        if (st === 404 || st === 410) { await db('dd_push_suscripciones?endpoint=eq.' + encodeURIComponent(s.endpoint), {method: 'DELETE'}); break; }
        if (st >= 200 && st < 300) ok++;
      } catch (e) { console.log('push fallo', e); }
    }
    await db('dd_push_suscripciones?endpoint=eq.' + encodeURIComponent(s.endpoint), {method: 'PATCH', body: JSON.stringify({ultimo_envio: new Date().toISOString()})}).catch(() => {});
  }
  return ok;
}
const resp = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {...CORS, 'Content-Type': 'application/json'}});

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS});
  try {
    const cuerpo = await req.json().catch(() => ({}));
    const accion = cuerpo.accion;

    // Con tu sesion: primero se revisa quien llama, despues se usa la configuracion
    if (accion === 'clave' || accion === 'prueba') {
      const u = await usuarioDeToken(req);
      if (!u) return resp({error: 'Inicia sesion'}, 401);
      const cfg = await config();
      const vapid = {publica: cfg.vapid_publica, privada: cfg.vapid_privada};
      if (accion === 'clave') return resp({publica: vapid.publica});
      const n = await enviarAUsuario(u.id, [{title: '✅ Mis Deudores', body: 'Las notificaciones funcionan en este dispositivo. Aquí te llegarán tus cobros del día.', tag: 'dd-prueba', url: URL_APP}], vapid);
      return resp({enviadas: n});
    }
    if (accion === 'diario') {
      // Solo Supabase Cron (con la clave secreta guardada en la base de datos)
      const cfg0 = await leerConfig();
      if (!igualSeguro(req.headers.get('x-dd-cron'), cfg0.secreto_cron)) return resp({error: 'No autorizado'}, 401);
      const cfg = await config();
      const vapid = {publica: cfg.vapid_publica, privada: cfg.vapid_privada};
      const hoy = hoyColombia(), hora = horaColombia();
      const subs = await db('dd_push_suscripciones?select=user_id');
      const conAvisos = new Set((subs || []).map(s => s.user_id));
      // Tambien los que tienen prestamos aunque no tengan avisos (para el backup automatico)
      const conDatos = await db('mc_registros?coleccion=eq.deudores&deleted_at=is.null&select=user_id');
      const usuarios = [...new Set([...conAvisos, ...(conDatos || []).map(f => f.user_id)])];
      const resultado = [];
      for (const uid of usuarios) {
        const filas = await db('mc_registros?user_id=eq.' + uid + '&coleccion=in.(deudores,deudores_ajustes,deudores_clientes)&deleted_at=is.null&select=coleccion,data');
        const prestamos = filas.filter(f => f.coleccion === 'deudores').map(f => f.data);
        const clientes = filas.filter(f => f.coleccion === 'deudores_clientes').map(f => f.data);
        const ajustes = (filas.find(f => f.coleccion === 'deudores_ajustes') || {}).data || {};
        // Backup automatico: desde la hora del primer aviso del dia
        if (hora >= horasDeAviso(ajustes)[0]) {
          const aviso = await backupAutomatico(uid, prestamos, clientes, ajustes, hoy);
          if (aviso && conAvisos.has(uid)) await enviarAUsuario(uid, [aviso], vapid);
          if (aviso) resultado.push({usuario: uid, backup: true});
        }
        if (!conAvisos.has(uid)) continue;
        let pendientes = avisosDeLaHora(ajustes, hora);
        if (cuerpo.forzar && !pendientes.length) pendientes = [{tipo: 'diario-' + hora, primera: true}];
        for (const aviso of pendientes) {
          // Cada aviso una sola vez por dia, aunque el cron se repita
          if (!await marcar(uid, hoy, aviso.tipo)) continue;
          const av = calcularAvisos(prestamos, hoy);
          av.promesas = promesasDeHoy(clientes, prestamos, hoy);
          const lista = armarMensajes(av, ajustes, hoy, {primera: aviso.primera});
          const enviadas = lista.length ? await enviarAUsuario(uid, lista, vapid) : 0;
          // Si no llego ninguno, se vuelve a intentar en la proxima hora
          if (lista.length && !enviadas) await desmarcar(uid, hoy, aviso.tipo);
          resultado.push({usuario: uid, aviso: aviso.tipo, mensajes: lista.length, enviadas});
        }
      }
      return resp({hoy, hora, resultado});
    }
    return resp({error: 'Accion desconocida'}, 400);
  } catch (e) {
    // El detalle queda en el registro de Supabase; quien llama solo ve un mensaje general
    console.log('Error:', e);
    return resp({error: e instanceof ErrorConocido ? e.message : 'Error interno. Intentalo de nuevo'}, 500);
  }
});
