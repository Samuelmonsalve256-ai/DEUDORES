// Prueba del modo sin internet: la app se sirve desde un servidor local real (como GitHub Pages),
// se abre una vez con internet y luego se recarga SIN internet.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const tipos = {'.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/DEUDORES\/?/, '/');
  if (p === '/') p = '/index.html';
  const f = path.join(RAIZ, p);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': tipos[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

servidor.listen(0, async () => {
  const puerto = servidor.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  // Con internet: datos guardados en el dispositivo y el service worker se instala
  await page.goto(`http://localhost:${puerto}/DEUDORES/`);
  await page.evaluate(() => {
    localStorage.setItem('deudores_v3', JSON.stringify([{id: 'd1', nombre: 'Cliente Sin Internet', concepto: 'Prueba', monto: 100000, fechaPrestamo: '2026-01-01', fechaPago: '2030-01-01', cuotas: [{monto: 100000, fecha: '2030-01-01'}], abonos: []}]));
  });
  // Nota: la pagina usa "https" para registrar el service worker; localhost tambien es seguro
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(r => !!r.active), null, {timeout: 15000});
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 15000});
  ok(true, '5.3 el service worker queda instalado y controla la app');
  // Sin internet
  await ctx.setOffline(true);
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForSelector('#list', {timeout: 10000});
  await page.waitForTimeout(800);
  ok(/Cliente Sin Internet/i.test(await page.locator('#list').innerText()), '5.3 sin internet la app abre y muestra los datos del dispositivo');
  ok(['sin-nube', 'sin-sesion', 'sin-conexion'].includes(await page.evaluate(() => document.getElementById('dd-sync').dataset.estado)), '5.3 el indicador muestra que no hay conexion');
  ok(errores.length === 0, '5.3 sin errores de JavaScript: ' + (errores.join(' / ') || 'ninguno'));
  await browser.close();
  servidor.close();
  console.log(fallos ? '\n' + fallos + ' FALLAS (sin internet)' : '\nSIN INTERNET: TODO OK');
  process.exit(fallos ? 1 : 0);
});
