// @ts-nocheck
// ════════════════════════════════════════════════════════════════════════════
// Mis Deudores · Edge Function "deudores-avisos"
// Envia las notificaciones al iPhone (Web Push), como las de cualquier app.
//
//   accion "clave"  : (con tu sesion) entrega la clave publica para activar avisos.
//   accion "prueba" : (con tu sesion) envia una notificacion de prueba a tus dispositivos.
//   accion "diario" : (la llama Supabase Cron cada hora) a la hora que elegiste en
//                     Ajustes revisa tus prestamos y envia: atrasados y lo que vence hoy,
//                     lo que vence manana, y el recordatorio de backup.
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
export function horaColombia() { return new Date(Date.now() + ZONA_OFFSET_HORAS * 3600e3).getUTCHours(); }
function diasEntre(desde, hasta) {
  return Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / 86400e3);
}
function calcInterest(monto, rate, d1, d2) {
  monto = parseFloat(monto) || 0; rate = parseFloat(rate) || 0;
  if (!rate || !d1 || !d2) return monto;
  const dias = Math.max(0, (new Date(d2).getTime() - new Date(d1).getTime()) / 86400000);
  return Math.round(monto * (1 + (rate / 100) * (dias / 30.4375)) * 100) / 100;
}
function totalDeuda(d) {
  const cuotas = d.cuotas || [];
  const calc = calcInterest(d.monto, d.interes, d.fechaPrestamo, d.fechaPago);
  if (!cuotas.length) return calc;
  const suma = cuotas.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
  return Math.abs(suma - calc) < 1 ? calc : suma;
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

export function armarMensajes(av, ajustes, hoy) {
  const msgs = [];
  const lista = (xs) => xs.slice(0, 4).map(x => x.nombre + ' ' + pesos(x.monto)).join(', ') + (xs.length > 4 ? ' y ' + (xs.length - 4) + ' más' : '');
  if (av.atrasados.length || av.deHoy.length) {
    const partes = [];
    if (av.deHoy.length) partes.push('Hoy: ' + lista(av.deHoy));
    if (av.atrasados.length) partes.push('Atrasados (' + av.atrasados.length + '): ' + pesos(av.atrasados.reduce((s, x) => s + x.monto, 0)) + ' — ' + lista(av.atrasados));
    const total = av.deHoy.concat(av.atrasados).reduce((s, x) => s + x.monto, 0);
    msgs.push({title: '🔴 Cobros para hoy · ' + pesos(total), body: partes.join('\n'), tag: 'dd-cobros', url: URL_APP + '?tab=cobrar'});
  }
  if (av.deManana.length) {
    msgs.push({title: '🟡 Mañana vence' + (av.deManana.length === 1 ? '' : 'n') + ' ' + av.deManana.length + ' cuota' + (av.deManana.length === 1 ? '' : 's'),
               body: lista(av.deManana), tag: 'dd-manana', url: URL_APP + '?tab=cobrar'});
  }
  const bk = (ajustes && ajustes.backup) || {};
  const cada = {semanal: 7, quincenal: 15, mensual: 30}[bk.frecuencia] || 30;
  const desde = bk.ultimo ? diasEntre(String(bk.ultimo).slice(0, 10), hoy) : null;
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
async function config() {
  const filas = await db('dd_push_config?id=eq.1&select=*');
  let c = filas && filas[0];
  if (!c) throw new Error('Falta ejecutar supabase/deudores-2.sql');
  if (!c.vapid_publica || !c.vapid_privada) {
    const k = await generarClavesVapid();
    await db('dd_push_config?id=eq.1', {method: 'PATCH', body: JSON.stringify({vapid_publica: k.publica, vapid_privada: k.privada})});
    c = {...c, vapid_publica: k.publica, vapid_privada: k.privada};
  }
  return c;
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
    const cfg = await config();
    const vapid = {publica: cfg.vapid_publica, privada: cfg.vapid_privada};

    if (accion === 'clave') {
      if (!await usuarioDeToken(req)) return resp({error: 'Inicia sesion'}, 401);
      return resp({publica: vapid.publica});
    }
    if (accion === 'prueba') {
      const u = await usuarioDeToken(req);
      if (!u) return resp({error: 'Inicia sesion'}, 401);
      const n = await enviarAUsuario(u.id, [{title: '✅ Mis Deudores', body: 'Las notificaciones funcionan en este dispositivo. Aquí te llegarán tus cobros del día.', tag: 'dd-prueba', url: URL_APP}], vapid);
      return resp({enviadas: n});
    }
    if (accion === 'diario') {
      if (req.headers.get('x-dd-cron') !== cfg.secreto_cron) return resp({error: 'No autorizado'}, 401);
      const hoy = hoyColombia(), hora = horaColombia();
      const subs = await db('dd_push_suscripciones?select=user_id');
      const usuarios = [...new Set((subs || []).map(s => s.user_id))];
      const resultado = [];
      for (const uid of usuarios) {
        const filas = await db('mc_registros?user_id=eq.' + uid + '&coleccion=in.(deudores,deudores_ajustes)&deleted_at=is.null&select=coleccion,data');
        const prestamos = filas.filter(f => f.coleccion === 'deudores').map(f => f.data);
        const ajustes = (filas.find(f => f.coleccion === 'deudores_ajustes') || {}).data || {};
        const horaUsuario = Number.isInteger(ajustes.avisos && ajustes.avisos.hora) ? ajustes.avisos.hora : 8;
        if (horaUsuario !== hora && !cuerpo.forzar) continue;
        if (ajustes.avisos && ajustes.avisos.activos === false) continue;
        // Una sola vez por dia, aunque el cron se repita
        const marca = await db('dd_push_envios', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=representation'},
          body: JSON.stringify({user_id: uid, fecha: hoy, tipo: 'diario'})});
        if (!marca || !marca.length) continue;
        const msgs = armarMensajes(calcularAvisos(prestamos, hoy), ajustes, hoy);
        resultado.push({usuario: uid, mensajes: msgs.length, enviadas: msgs.length ? await enviarAUsuario(uid, msgs, vapid) : 0});
      }
      return resp({hoy, hora, resultado});
    }
    return resp({error: 'Accion desconocida'}, 400);
  } catch (e) {
    console.log('Error:', e);
    return resp({error: String(e && e.message || e)}, 500);
  }
});
