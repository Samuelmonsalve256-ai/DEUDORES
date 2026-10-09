// Pruebas de la funcion de avisos (supabase/functions/deudores-avisos/index.ts):
// cifrado Web Push, firma VAPID y calculo de lo que hay que cobrar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ece = require('http_ece');
const webpush = require('web-push');

const aqui = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dd-')), 'fn.mjs');
fs.copyFileSync(path.join(aqui, '../supabase/functions/deudores-avisos/index.ts'), tmp);
const fn = await import(pathToFileURL(tmp).href);

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

// Cifrado: un receptor independiente (http_ece) descifra el mensaje
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const texto = JSON.stringify({title: '🔴 Cobros para hoy · $1.250.000', body: 'Hoy: Juan $500.000\nAtrasados: Ñandú'});
const cuerpo = await fn.cifrarMensaje(fn.b64url(ua.getPublicKey()), fn.b64url(authSecret), texto);
ok(ece.decrypt(Buffer.from(cuerpo), {version: 'aes128gcm', privateKey: ua, authSecret}).toString('utf8') === texto, 'avisos: el mensaje cifrado se descifra igual (RFC 8291)');

// VAPID
const vapid = await fn.generarClavesVapid();
const auth = await fn.firmaVapid('https://web.push.apple.com/abc', vapid, 'https://samuelmonsalve256-ai.github.io/DEUDORES/');
const m = auth.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
ok(!!m, 'avisos: cabecera vapid t=..., k=...');
const pub = await crypto.webcrypto.subtle.importKey('raw', fn.deB64url(m[4]), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
ok(await crypto.webcrypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, pub, fn.deB64url(m[3]), new TextEncoder().encode(m[1] + '.' + m[2])), 'avisos: firma ES256 valida');
const claims = JSON.parse(Buffer.from(fn.deB64url(m[2])).toString());
ok(claims.aud === 'https://web.push.apple.com' && claims.exp > Date.now() / 1000 && /^https:/.test(claims.sub), 'avisos: JWT con aud, exp y sub');
try { webpush.setVapidDetails('https://samuelmonsalve256-ai.github.io/DEUDORES/', vapid.publica, vapid.privada.d); ok(true, 'avisos: web-push acepta las claves'); }
catch (e) { ok(false, 'avisos: web-push acepta las claves: ' + e.message); }

// Calculo
const hoy = '2026-10-09';
const av = fn.calcularAvisos([
  {nombre: 'JUAN PEREZ GOMEZ', monto: 1000000, cuotas: [{monto: 500000, fecha: '2026-10-01'}, {monto: 500000, fecha: '2026-10-09'}], abonos: [{monto: 200000}]},
  {nombre: 'ANA', monto: 300000, cuotas: [{monto: 300000, fecha: '2026-10-10'}], abonos: []},
  {nombre: 'PAGADO', monto: 100, cuotas: [{monto: 100, fecha: '2026-10-01'}], abonos: [], pagado: true},
  {nombre: 'ARCHIVADO', monto: 100, cuotas: [{monto: 100, fecha: '2026-10-01'}], abonos: [], archivado: true},
  {nombre: 'SIN CUOTAS', monto: 50000, fechaPago: '2026-10-09', abonos: []},
], hoy);
ok(av.atrasados.length === 1 && Math.round(av.atrasados[0].monto) === 300000 && av.atrasados[0].dias === 8, 'avisos: atrasado de Juan (300.000, 8 dias)');
ok(av.deHoy.length === 2 && av.deManana.length === 1, 'avisos: 2 para hoy y 1 para mañana; ignora pagados y archivados');
const msgs = fn.armarMensajes(av, {backup: {frecuencia: 'mensual', ultimo: '2026-09-09'}}, hoy);
ok(msgs.map(x => x.title.slice(0, 2)).join('') === '🔴🟡💾', 'avisos: rojo (cobros), amarillo (mañana), backup');
ok(msgs[0].title.includes('$850.000'), 'avisos: total para cobrar hoy $850.000');
ok(fn.armarMensajes({atrasados: [], deHoy: [], deManana: []}, {backup: {frecuencia: 'mensual', ultimo: '2026-10-01'}}, hoy).length === 0, 'avisos: nada que avisar => no se envia nada');
const sinBackup = fn.armarMensajes({atrasados: [], deHoy: [], deManana: []}, {backup: {frecuencia: 'semanal', ultimo: '2026-10-02'}}, hoy);
ok(sinBackup.length === 1 && sinBackup[0].title.startsWith('💾'), 'avisos: backup semanal cumplido (7 dias) => recordatorio');
const repetido = fn.armarMensajes({atrasados: [], deHoy: [], deManana: []}, {backup: {frecuencia: 'semanal', ultimo: '2026-09-30'}}, hoy);
ok(repetido.length === 0, 'avisos: el recordatorio de backup se repite cada 3 dias, no todos los dias');

console.log(fallos ? '\n' + fallos + ' FALLAS (avisos)' : '\nAVISOS: TODO OK');
process.exit(fallos ? 1 : 0);
