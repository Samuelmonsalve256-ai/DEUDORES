// Pruebas de punta a punta de Mis Deudores en un navegador real (Chromium),
// con dos "dispositivos" y una nube de Supabase simulada (apoyo/backend.js).
//   cd tests && npm install && npm test
// En este entorno se puede indicar el Chromium con CHROMIUM=/ruta/al/chrome
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { crear } = require('./apoyo/backend');

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const FAKE = fs.readFileSync(path.join(__dirname, 'apoyo/fake-supabase.js'), 'utf8');
const JSPDF = fs.readFileSync(path.join(__dirname, 'node_modules/jspdf/dist/jspdf.umd.min.js'), 'utf8');
const AUTOTABLE = fs.readFileSync(path.join(__dirname, 'node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js'), 'utf8');
const UID = 'user-1';
let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const espera = ms => new Promise(r => setTimeout(r, ms));
const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

async function dispositivo(browser, B, {local = null, movil = false, sesion = false} = {}) {
  const ctx = await browser.newContext(movil ? {...devices['iPhone 13']} : {viewport: {width: 1200, height: 900}, acceptDownloads: true});
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    const json = r => route.fulfill({contentType: 'application/json', body: JSON.stringify(r)});
    if (url.startsWith('http://app.test/')) return route.fulfill({contentType: 'text/html', body: APP});
    if (url.includes('supabase-js')) return route.fulfill({contentType: 'application/javascript', body: FAKE});
    if (url.includes('jspdf-autotable')) return route.fulfill({contentType: 'application/javascript', body: AUTOTABLE});
    if (url.includes('jspdf')) return route.fulfill({contentType: 'application/javascript', body: JSPDF});
    if (url.startsWith('http://fake.test/')) {
      const p = url.slice('http://fake.test/'.length), b = JSON.parse(route.request().postData() || '{}');
      if (p === 'login') return json(b.password === 'clave1234' ? {session: {access_token: 't', user: {id: UID, email: 'samuel@test.co'}}} : {error: 'Invalid login credentials'});
      if (p === 'rpc/mc_push') return json(B.push(b.uid, b.args.p_cambios));
      if (p === 'rpc/mc_pull') return json(B.pull(b.uid, b.args.p_desde, b.args.p_limite));
      if (p === 'rpc/mc_indice') return json(B.indice(b.uid));
      if (p === 'from') return json(B.tabla(b.uid, b.q));
      if (p === 'storage/upload') {
        if (!B.permitidas.includes('deudores_clientes')) return json({error: {message: 'Bucket not found'}});
        if (!b.path.startsWith(b.uid + '/')) return json({error: {message: 'new row violates row-level security policy'}});
        B.fotos.set(b.path, b.b64); return json({data: {path: b.path}});
      }
      if (p === 'storage/url') return json(B.fotos.has(b.path) ? {url: 'data:image/jpeg;base64,' + B.fotos.get(b.path)} : {error: {message: 'Object not found'}});
      if (p.startsWith('functions/')) return json(B.funcion(b.uid, p.slice(10), b.cuerpo));
      return json({error: 'ruta desconocida'});
    }
    return route.fulfill({status: 204, body: ''});
  });
  await ctx.addInitScript(([d, s]) => {
    if (localStorage.getItem('__ok')) return;
    if (d) localStorage.setItem('deudores_v3', d);
    if (s) localStorage.setItem('mc-auth', JSON.stringify({access_token: 't', user: {id: 'user-1', email: 'samuel@test.co'}}));
    localStorage.setItem('dd_ultimo_backup', new Date().toISOString());   // sin recordatorio de backup al abrir
    localStorage.setItem('__ok', '1');
  }, [local ? JSON.stringify(local) : null, sesion]);
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', e => page.errores.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.open = (u) => { window.__abiertos = (window.__abiertos || []).concat([u]); return null; }; });
  await page.goto('http://app.test/index.html');
  return page;
}
async function cerrarResumen(page) {
  if (await page.isVisible('#notif-modal-overlay.open')) { await page.click('.notif-btn-close'); await espera(350); }
}
async function login(page) {
  await page.waitForSelector('#dd-login.open');
  await page.fill('#dd-login-email', 'samuel@test.co');
  await page.fill('#dd-login-pass', 'clave1234');
  await page.click('#dd-login-btn');
}
async function aceptar(page, si = true) {
  await page.waitForSelector('#dd-pregunta.open', {timeout: 5000});
  await page.click(si ? '#dd-pregunta-si' : '#dd-pregunta-no');
  await espera(150);
}
async function guardado(page) {
  await page.waitForFunction(() => ['guardado', 'sin-sql'].includes(document.getElementById('dd-sync').dataset.estado), null, {timeout: 10000});
}
const evalua = (page, fn, arg) => page.evaluate(fn, arg);

// Datos de la version anterior (sin id ni cliente). Juan tiene dos prestamos con la misma cedula.
const legado = [
  {nombre: 'Juan Perez', cedula: '1036123456', telefono: '3001234567', concepto: 'Moto', fechaPrestamo: iso(-60), fechaPago: iso(60), monto: 1200000, interes: 0, freq: 'monthly', diasFreq: 30,
   cuotas: [{monto: 400000, fecha: iso(-30), pagada: false}, {monto: 400000, fecha: iso(0), pagada: false}, {monto: 400000, fecha: iso(30), pagada: false}],
   abonos: [{monto: 400000, fecha: iso(-31), nota: ''}], pagado: false},
  {nombre: 'JUAN PÉREZ', cedula: '1.036.123.456', telefono: '', concepto: 'Repuestos', fechaPrestamo: iso(-10), fechaPago: iso(20), monto: 300000, interes: 0, freq: 'monthly', diasFreq: 30,
   cuotas: [{monto: 300000, fecha: iso(20), pagada: false}], abonos: [], pagado: false},
  {nombre: 'Ana Gómez', cedula: '', telefono: '3109998877', concepto: 'Préstamo', fechaPrestamo: iso(-90), fechaPago: iso(-40), monto: 500000, interes: 0, freq: 'monthly', diasFreq: 30,
   cuotas: [{monto: 500000, fecha: iso(-40), pagada: false}], abonos: [], pagado: false},
  {nombre: 'Pedro Ruiz', cedula: '9', telefono: '', concepto: 'Viejo', fechaPrestamo: iso(-200), fechaPago: iso(-100), monto: 100000, interes: 0, freq: 'monthly', diasFreq: 30,
   cuotas: [{monto: 100000, fecha: iso(-100), pagada: false}], abonos: [{monto: 100000, fecha: iso(-100)}], pagado: true},
];

(async () => {
  const opciones = process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {};
  const browser = await chromium.launch(opciones);
  const B = crear();

  // ── 1. Migracion: los prestamos antiguos se ordenan en clientes ─────────────
  const A = await dispositivo(browser, B, {local: legado});
  await login(A);
  await aceptar(A);           // "Datos unidos con la nube"
  await guardado(A);
  await A.waitForSelector('#notif-modal-overlay.open', {timeout: 6000}).then(() => ok(true, 'al abrir aparece un solo resumen de cobros (no una ventana por deudor)'), () => ok(false, 'resumen de cobros al abrir'));
  ok(/Tienes/.test(await A.locator('#notif-modal-body').innerText()), 'el resumen dice cuantos cobros hay');
  await cerrarResumen(A);
  const cli = await evalua(A, () => clientes.map(c => ({id: c.id, nombre: c.nombre, n: prestamosDe(c.id).length})));
  ok(cli.length === 3, '3.3 migracion: 4 prestamos antiguos quedan en 3 clientes (Juan con 2)');
  ok(cli.some(c => c.n === 2), '3.3 los dos prestamos de Juan (misma cedula escrita distinto) quedan en un solo perfil');
  ok(B.vivos('deudores_clientes').length === 3 && B.vivos('deudores').length === 4, 'nube: 3 clientes y 4 prestamos guardados');
  ok(await A.locator('#list .debtor-card').count() === 3, 'lista: una tarjeta por cliente');
  const primero = await A.locator('#list .debtor-card .debtor-name').first().innerText();
  ok(/Ana/i.test(primero), 'orden por urgencia: Ana (la mas atrasada) va primero');

  // ── 2. Perfil del cliente ───────────────────────────────────────────────────
  const juanId = cli.find(c => c.n === 2).id;
  await evalua(A, id => abrirPerfil(id), juanId);
  await A.waitForSelector('#perfil.open');
  const perfil = await A.locator('#perfil-body').innerText();
  ok(/Prestamos activos \(2\)/i.test(perfil) && /Historial de pagos \(1\)/i.test(perfil), '3.3 perfil: 2 prestamos activos e historial de pagos');
  ok(/debe ahora[\s\S]*\$1\.100\.000/i.test(perfil), '3.3 perfil: debe $1.100.000 entre los dos prestamos');

  // ── 3. Nuevo prestamo para el mismo cliente desde el perfil ─────────────────
  await A.click('.perfil-acciones .btn-add');
  await A.waitForSelector('#overlay.open');
  ok(await A.isVisible('#f-cliente-elegido') && /Juan/i.test(await A.locator('#f-cliente-nombre').innerText()), 'nuevo prestamo desde el perfil: el cliente ya viene elegido');
  await A.fill('#f-concepto', 'Llantas');
  await A.fill('#f-monto', '600000');
  ok(await A.inputValue('#f-monto') === '$ 600.000', '3.5 el monto se muestra con puntos mientras se escribe');
  await A.fill('#f-ncuotas', '3');
  await A.fill('#f-prestamo', '2026-01-31');
  await A.selectOption('#f-freq', 'monthly');
  await A.click('#overlay .btn-save');
  await espera(300);
  const llantas = await evalua(A, () => debtors.find(d => d.concepto === 'Llantas'));
  ok(llantas && llantas.clienteId === juanId, 'el prestamo nuevo queda en el perfil de Juan');
  ok(llantas.cuotas.map(c => c.fecha).join(',') === '2026-02-28,2026-03-31,2026-04-30', '3.6 cuotas mensuales el mismo dia de cada mes (ajustado a fin de mes)');
  ok(llantas.cuotas.reduce((s, c) => s + c.monto, 0) === 600000, 'las cuotas suman exactamente el total');

  // ── 3b. Mismo nombre que un cliente existente: pregunta antes de unirlos ───
  await evalua(A, () => { cerrarPerfil(); openModal(); });
  await A.fill('#f-nombre', 'Ana Gomez');
  await A.fill('#f-concepto', 'Otra Ana');
  await A.fill('#f-monto', '100000');
  await A.click('#overlay .btn-save');
  await A.waitForSelector('#dd-pregunta.open');
  ok(/misma persona/i.test(await A.locator('#dd-pregunta-titulo').innerText()), '3.3 mismo nombre sin cedula: pregunta si es la misma persona');
  await A.click('#dd-pregunta-no');
  await espera(300);
  ok(await evalua(A, () => clientes.filter(c => normalizarTexto(c.nombre) === 'ANA GOMEZ').length) === 2, '3.3 "No, es otra persona": crea un cliente aparte');
  await evalua(A, () => { const i = debtors.findIndex(d => d.concepto === 'Otra Ana'); const cid = debtors[i].clienteId; debtors.splice(i, 1); clientes = clientes.filter(c => c.id !== cid); guardarClientesLocal(); persist(); renderList(); });

  // ── 4. Paquete 1: editar recalcula cuotas y fechas ──────────────────────────
  const idxL = await evalua(A, () => debtors.findIndex(d => d.concepto === 'Llantas'));
  await evalua(A, i => editDebtor(i, {stopPropagation() {}}), idxL);
  await A.fill('#f-concepto', 'Llantas nuevas');
  await A.click('#overlay .btn-save');
  await espera(200);
  let l2 = await evalua(A, i => debtors[i], idxL);
  ok(JSON.stringify(l2.cuotas) === JSON.stringify(llantas.cuotas), '1.x editar solo el concepto deja las cuotas igual');
  await evalua(A, i => editDebtor(i, {stopPropagation() {}}), idxL);
  await A.fill('#f-interes', '10');
  await A.fill('#f-pago', '2026-04-30');
  await A.click('#overlay .btn-save');
  await espera(200);
  l2 = await evalua(A, i => debtors[i], idxL);
  const totalL = l2.cuotas.reduce((s, c) => s + c.monto, 0);
  ok(totalL > 600000 && Math.abs(totalL - 600000 * (1 + 0.1 * (89 / 30.4375))) < 2, '1.1 al subir el interes las cuotas se recalculan (' + totalL + ')');
  await evalua(A, i => editDebtor(i, {stopPropagation() {}}), idxL);
  await A.fill('#f-prestamo', '2026-02-15');
  await A.fill('#f-interes', '0');
  await A.fill('#f-pago', '');
  await A.click('#overlay .btn-save');
  await espera(200);
  l2 = await evalua(A, i => debtors[i], idxL);
  ok(l2.cuotas.map(c => c.fecha).join(',') === '2026-03-15,2026-04-15,2026-05-15', '1.2 al cambiar la fecha del prestamo las fechas de las cuotas cambian');

  // ── 5. Paquete 1.3: cuota manual ────────────────────────────────────────────
  await evalua(A, id => openModal(null, id), juanId);
  await A.fill('#f-concepto', 'Cuota fija');
  await A.fill('#f-monto', '4800000');
  await A.fill('#f-ncuotas', '6');
  await A.check('#f-manual-check');
  await A.fill('#f-mcuota', '900000');
  await A.click('#overlay .btn-save');
  await espera(200);
  const iF = await evalua(A, () => debtors.findIndex(d => d.concepto === 'Cuota fija'));
  ok(await evalua(A, i => totalDeuda(debtors[i]), iF) === 5400000, '1.3 con cuota manual el total es la suma de cuotas (6 x 900.000 = 5.400.000)');
  await evalua(A, i => { debtors[i].abonos.push({id: 'x1', monto: 4800000, fecha: hoyISO(), metodo: 'Efectivo'}); actualizarPagado(debtors[i]); persist(); }, iF);
  const fija = await evalua(A, i => ({pagado: debtors[i].pagado, saldo: resumenDeudor(debtors[i]).saldo}), iF);
  ok(!fija.pagado && fija.saldo === 600000, '1.3 pagar 4.800.000 NO lo marca pagado: aun debe 600.000');
  await evalua(A, i => editDebtor(i, {stopPropagation() {}}), iF);
  ok(await A.isChecked('#f-manual-check') && await A.inputValue('#f-mcuota') === '$ 900.000', '1.1 al editar, la cuota manual se carga solo si se creo asi');
  await A.click('#overlay .btn-cancel');

  // ── 6. Paquete 2: confirmar o cancelar ──────────────────────────────────────
  await evalua(A, id => abrirPerfil(id), juanId);
  const iMoto = await evalua(A, () => debtors.findIndex(d => d.concepto === 'Moto'));
  const abonosAntes = await evalua(A, i => debtors[i].abonos.length, iMoto);
  evalua(A, i => eliminarAbono(i, 0, null), iMoto);
  await aceptar(A, false);
  ok(await evalua(A, i => debtors[i].abonos.length, iMoto) === abonosAntes, '2.1 borrar abono → Cancelar: el abono sigue');
  evalua(A, i => marcarCuotaCompleta(i, 1, null), iMoto);
  await aceptar(A, false);
  ok(await evalua(A, i => debtors[i].abonos.length, iMoto) === abonosAntes, '2.2 marcar cuota → Cancelar: no registra nada');
  evalua(A, i => marcarCuotaCompleta(i, 1, null), iMoto);
  await aceptar(A, true);
  ok(await evalua(A, i => debtors[i].abonos.length, iMoto) === abonosAntes + 1, '2.2 marcar cuota → Confirmar: registra el abono de la cuota');
  evalua(A, i => markPaid(i, null), iMoto);
  await aceptar(A, false);
  ok(!await evalua(A, i => debtors[i].pagado, iMoto), '2.3 marcar pagado → Cancelar: sigue sin pagar');
  evalua(A, i => eliminarAbono(i, debtors[i].abonos.length - 1, null), iMoto);
  await aceptar(A, true);
  ok(await evalua(A, i => debtors[i].abonos.length, iMoto) === abonosAntes, '2.1 borrar abono → Confirmar: se borra');

  // ── 7. Abono con forma de pago, foto y recibo consecutivo ───────────────────
  await evalua(A, i => abrirAbono(i, null), iMoto);
  await A.waitForSelector('#abono-overlay.open');
  await A.click('#ab-atajos button:first-child');
  ok(await A.inputValue('#ab-monto') === '$ 400.000', 'atajo de abono: valor de la cuota');
  await A.selectOption('#ab-metodo', 'Nequi');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await A.setInputFiles('#ab-foto', {name: 'comprobante.png', mimeType: 'image/png', buffer: png});
  await A.click('#ab-guardar');
  await A.waitForFunction(() => { const d = debtors.find(x => x.concepto === 'Moto'); return d.abonos.some(a => a.comprobante); }, null, {timeout: 8000});
  const ab = await evalua(A, i => debtors[i].abonos[debtors[i].abonos.length - 1], iMoto);
  ok(ab.metodo === 'Nequi' && ab.monto === 400000 && /^user-1\//.test(ab.comprobante), '3.1 y 3.2 abono con Nequi y foto guardada en la carpeta privada');
  await evalua(A, i => verReciboAbono(i, debtors[i].abonos.length - 1, null), iMoto);
  ok(await A.locator('#rc-numero').innerText() === 'REC-0001', '4.1 primer recibo: REC-0001');
  const rec = await A.locator('#rc-totales').innerText();
  ok(/Saldo antes de este pago[\s\S]*\$800\.000/.test(rec) && /Nuevo saldo[\s\S]*\$400\.000/.test(rec), '4.2 recibo del abono: saldo antes $800.000 y nuevo saldo $400.000');
  await A.click('.recibo-btn-cerrar');
  await evalua(A, i => verReciboAbono(i, 0, null), iMoto);
  ok(await A.locator('#rc-numero').innerText() === 'REC-0002', '4.1 el siguiente recibo es REC-0002');
  await A.click('.recibo-btn-cerrar');
  await evalua(A, i => verComprobante(i, debtors[i].abonos.length - 1, null), iMoto);
  await A.waitForFunction(() => (document.getElementById('foto-img').src || '').startsWith('data:image'), null, {timeout: 5000});
  ok(true, '3.2 la foto del comprobante se puede ver');
  await evalua(A, () => cerrarFoto());

  // ── 8. Archivar, filtros y orden ────────────────────────────────────────────
  await evalua(A, () => cerrarPerfil());
  const pedroIdx = await evalua(A, () => debtors.findIndex(d => d.concepto === 'Viejo'));
  evalua(A, i => archivarPrestamo(i, true, null), pedroIdx);
  await aceptar(A, true);
  await evalua(A, () => renderList());
  ok(!/Pedro/.test(await A.locator('#list').innerText()), '3.7 un cliente con todo archivado sale de la lista');
  await evalua(A, () => setFilter('archived', document.querySelectorAll('.filter-btn')[4]));
  ok(/Pedro/.test(await A.locator('#list').innerText()), '3.7 y aparece en el filtro "Archivados"');
  await evalua(A, () => setFilter('all', document.querySelectorAll('.filter-btn')[0]));
  await A.selectOption('#orden-lista', 'nombre');
  const nombres = await A.locator('#list .debtor-name').allInnerTexts();
  ok(nombres.join('|') === nombres.slice().sort((a, b) => a.localeCompare(b, 'es')).join('|'), '3.8 ordenar por nombre A-Z');
  await A.selectOption('#orden-lista', 'urgencia');

  // ── 9. Cobrar hoy ───────────────────────────────────────────────────────────
  await evalua(A, () => switchTab('cobrar'));
  const cobrar = await A.locator('#cobrar-body').innerText();
  ok(/atrasados/i.test(cobrar) && /Ana/i.test(cobrar), '3.9 Cobrar: Ana aparece en atrasados');
  if (process.env.DEBUG) console.log(cobrar, await evalua(A, () => itemsPorCobrar(3).map(x => [debtors[x.ri].nombre, x.grupo, x.dl])));
  await A.locator('.cobrar-item.atrasado', {hasText: 'Ana'}).locator('.btn-wa').click();
  const abiertos = await evalua(A, () => window.__abiertos || []);
  ok(abiertos.some(u => u.startsWith('https://wa.me/573109998877?text=')), '3.9 el boton Recordar abre WhatsApp con el mensaje listo');
  await evalua(A, () => renderCobrar());
  ok(/Enviado/.test(await A.locator('.cobrar-item.atrasado', {hasText: 'Ana'}).innerText()), '3.9 queda marcado "Enviado" hoy');
  await evalua(A, () => switchTab('deudores'));

  // ── 10. Ajustes: datos del negocio en la nube y en los mensajes ─────────────
  await evalua(A, () => ddAbrirCuenta());
  await A.fill('#aj-neg-nombre', 'Inversiones Monsalve');
  await A.fill('#aj-neg-resp', 'Samuel');
  await A.fill('#aj-neg-tel', '3005556677');
  await A.click('text=Guardar mis datos');
  await guardado(A);
  await espera(1600); await guardado(A);
  ok(B.vivos('deudores_ajustes').length === 1 && B.vivos('deudores_ajustes')[0].data.negocio.nombre === 'Inversiones Monsalve', '4.6 los datos del negocio se guardan en la nube');
  ok(/Samuel · Inversiones Monsalve · Tel\. 3005556677/.test(await evalua(A, () => firmaMensaje())), '4.6 los mensajes de WhatsApp llevan tu firma');
  await evalua(A, () => ddCerrarCuenta());

  // ── 11. Ocultar montos y PIN ────────────────────────────────────────────────
  await A.click('#btn-ojo');
  ok(await evalua(A, () => document.body.classList.contains('montos-ocultos')), '5.2 el ojo oculta los montos');
  await A.click('#btn-ojo');
  await evalua(A, () => configurarPin());
  for (const t of '2580') await A.click(`.pin-teclado button:text-is("${t}")`);
  await espera(300);
  for (const t of '2580') await A.click(`.pin-teclado button:text-is("${t}")`);
  await espera(500);
  ok(await evalua(A, () => !!(ajustes.pin && ajustes.pin.hash) && !ajustes.pin.hash.includes('2580')), '5.1 PIN guardado (cifrado, no el numero)');
  await guardado(A); await espera(1600); await guardado(A);

  // ── 12. Backup completo y recordatorio ──────────────────────────────────────
  const [descarga] = await Promise.all([A.waitForEvent('download'), evalua(A, () => guardarBackup())]);
  const bk = JSON.parse(fs.readFileSync(await descarga.path(), 'utf8'));
  ok(bk.version === 'deudores_v4' && bk.datos.length === 6 && bk.clientes.length === 3 && !bk.ajustes.pin, '5.4 el backup trae prestamos, clientes y ajustes (sin el PIN)');
  ok(await evalua(A, () => diasDesdeBackup() === 0 && !backupVencido()), '5.4 el backup queda registrado como hecho hoy');
  await evalua(A, () => { ajustes.backup.ultimo = new Date(Date.now() - 40 * 86400e3).toISOString(); localStorage.removeItem('dd_ultimo_backup'); localStorage.removeItem('dd_backup_pospuesto'); });
  ok(await evalua(A, () => backupVencido()), '5.4 con 40 dias sin backup (mensual) ya toca');
  evalua(A, () => revisarBackup());
  await A.waitForSelector('#dd-pregunta.open');
  ok(/Es hora de tu backup/.test(await A.locator('#dd-pregunta-titulo').innerText()), '5.4 aparece el recordatorio de backup');
  await A.click('#dd-pregunta-no');
  await espera(100);
  ok(await evalua(A, () => localStorage.getItem('dd_backup_pospuesto') === hoyISO()), '5.4 "Recordarme manana" lo pospone un dia');

  // ── 13. Estado de cuenta PDF ────────────────────────────────────────────────
  const [pdf] = await Promise.all([A.waitForEvent('download', {timeout: 15000}), evalua(A, id => estadoCuentaPDF(id), juanId)]);
  const bytes = fs.readFileSync(await pdf.path());
  ok(bytes.slice(0, 5).toString() === '%PDF-' && bytes.length > 3000, '4.3 estado de cuenta PDF generado (' + bytes.length + ' bytes, ' + pdf.suggestedFilename() + ')');

  // ── 14. Reporte por periodo ─────────────────────────────────────────────────
  await evalua(A, () => switchTab('analisis'));
  const rep = await A.locator('#rep-cuerpo').innerText();
  const esperado = await evalua(A, () => { const ini = hoyISO().slice(0, 8) + '01'; let t = 0; debtors.forEach(d => (d.abonos || []).forEach(a => { if (a.fecha >= ini && a.fecha <= hoyISO()) t += a.monto; })); return money(t); });
  ok(new RegExp('cobrado[\\s\\S]*' + esperado.replace(/[$.]/g, '\\$&'), 'i').test(rep) && /Nequi/.test(rep), '4.5 reporte del mes: cobrado ' + esperado + ' y por forma de pago');
  await evalua(A, () => switchTab('deudores'));

  // ── 15. Segundo dispositivo (iPhone): ve todo, con PIN ──────────────────────
  const C = await dispositivo(browser, B, {movil: true});
  await login(C);
  await guardado(C);
  await espera(400);
  ok(await evalua(C, () => clientes.length === 3 && debtors.length === 6), 'iPhone: ve los 3 clientes y 6 prestamos');
  ok(await evalua(C, () => ajustes.negocio.nombre === 'Inversiones Monsalve' && !!pinActual()), 'iPhone: recibe los ajustes y el PIN de la nube');
  await C.reload();
  await C.waitForSelector('#pin-lock.open');
  for (const t of '1111') await C.click(`.pin-teclado button:text-is("${t}")`);
  await espera(300);
  ok(/incorrecto/i.test(await C.locator('#pin-msg').innerText()), '5.1 PIN incorrecto: no abre');
  for (const t of '2580') await C.click(`.pin-teclado button:text-is("${t}")`);
  await espera(400);
  ok(!await C.isVisible('#pin-lock.open'), '5.1 PIN correcto: abre la app');
  ok(await evalua(C, () => document.documentElement.scrollWidth <= window.innerWidth), 'iPhone: sin desplazamiento lateral');


  // ── 15b. Dos dispositivos a la vez: borrar, recuperar, conflictos, backup ───
  await evalua(A, () => ddSincronizar('prueba')); await guardado(A);
  const anaIdx = await evalua(C, () => debtors.findIndex(d => /Ana/.test(d.nombre)));
  evalua(C, i => deleteDebtor(i, null), anaIdx);
  await aceptar(C, true);
  await guardado(C);
  await evalua(A, () => ddSincronizar('prueba')); await guardado(A);
  ok(!await evalua(A, () => debtors.some(d => /Ana/.test(d.nombre))), 'sync: el prestamo borrado en el iPhone desaparece en el otro dispositivo');
  ok(await evalua(A, () => clientes.some(c => /Ana/.test(c.nombre))), 'sync: el cliente se queda aunque se borre su prestamo');
  await evalua(A, () => ddAbrirHistorial());
  await A.waitForSelector('.dd-hist-item');
  await A.locator('.dd-hist-item', {hasText: 'Ana'}).first().locator('button').click();
  await aceptar(A, true);
  await guardado(A);
  ok(B.vivos('deudores').some(r => /Ana/.test(r.data.nombre)), 'sync: el prestamo borrado se recupera desde el historial');
  // Conflicto: los dos editan el mismo prestamo sin enterarse
  await evalua(C, () => ddSincronizar('prueba')); await guardado(C);
  await evalua(C, () => { _ddSesion = null; });
  await evalua(A, () => { const d = debtors.find(x => x.concepto === 'Repuestos'); d.concepto = 'Repuestos A'; persist(); });
  await guardado(A); await espera(1500); await guardado(A);
  await evalua(C, () => { const d = debtors.find(x => x.concepto === 'Repuestos'); d.concepto = 'Repuestos C'; persist(); });
  await evalua(C, async () => { _ddSesion = JSON.parse(localStorage.getItem('mc-auth')); await ddSincronizar('prueba'); });
  await guardado(C);
  ok(B.vivos('deudores').some(r => r.data.concepto === 'Repuestos A') && B.hist.some(h => h.motivo === 'conflicto' && h.data.concepto === 'Repuestos C'),
     'sync: en un conflicto gana la nube y la otra version queda en el historial');
  // Cargar un backup de la version anterior no duplica nada
  const tmpBk = path.join(require('os').tmpdir(), 'dd-legado.json');
  fs.writeFileSync(tmpBk, JSON.stringify({version: 'deudores_v3', fecha: new Date().toISOString(), datos: legado.concat([{basura: true}])}));
  const antesN = await evalua(A, () => [debtors.length, clientes.length]);
  await A.setInputFiles('#input-backup', tmpBk);
  await A.waitForSelector('#backup-load-overlay.open');
  ok(/registros dañados/.test(await A.locator('#backup-load-msg').innerText()), 'backup: avisa los registros dañados');
  if (!await A.isDisabled('#backup-load-ok')) await A.click('#backup-load-ok'); else await A.click('#backup-load-overlay .btn-cancel');
  await espera(300);
  const despuesN = await evalua(A, () => [debtors.length, clientes.length]);
  ok(despuesN[1] === antesN[1], 'backup: cargar el backup antiguo no duplica clientes (' + antesN + ' → ' + despuesN + ')');

  // ── 16. Falta el SQL nuevo: los prestamos se siguen guardando ───────────────
  const B2 = crear({conSQLNuevo: false});
  const D = await dispositivo(browser, B2, {local: legado.slice(0, 1)});
  await login(D);
  await aceptar(D);
  if (process.env.DEBUG) { await espera(3000); console.log('D estado', await evalua(D, () => [document.getElementById('dd-sync').dataset.estado, document.getElementById('dd-login-msg').textContent, document.querySelector('#dd-pregunta.open') ? document.getElementById('dd-pregunta-texto').textContent : '', JSON.stringify(_ddSinSQL)]), D.errores); }
  await guardado(D);
  ok(B2.vivos('deudores').length === 1 && B2.vivos('deudores_clientes').length === 0, 'sin el SQL nuevo: el prestamo se guarda en la nube y el cliente queda en el dispositivo');
  ok(await evalua(D, () => document.getElementById('dd-sync').dataset.estado) === 'sin-sql', 'sin el SQL nuevo: el indicador avisa "Falta un paso en Supabase"');
  B2.activarSQLNuevo();
  await evalua(D, () => ddSincronizar('manual'));
  await D.waitForFunction(() => document.getElementById('dd-sync').dataset.estado === 'guardado', null, {timeout: 8000});
  ok(B2.vivos('deudores_clientes').length === 1, 'al ejecutar el SQL nuevo, el cliente sube a la nube solo');

  for (const p of [A, C, D]) ok(p.errores.length === 0, 'sin errores de JavaScript: ' + (p.errores.join(' / ') || 'ninguno'));
  await browser.close();
  console.log(fallos ? `\n${fallos} FALLAS` : '\nAPP: TODO OK');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
