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
      if (p === 'storage/remove') { const borradas = (b.paths || []).filter(x => x.startsWith(b.uid + '/') && B.fotos.delete(x)); return json({data: borradas.map(name => ({name}))}); }
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
  await evalua(A, i => { debtors[i].abonos.push({id: 'x1', monto: 4800000, fecha: hoyISO(), metodo: 'Efectivo', recibo: siguienteNumeroRecibo()}); actualizarPagado(debtors[i]); persist(); }, iF);
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
  const nums = await evalua(A, () => { const t = []; debtors.forEach(d => (d.abonos || []).forEach(a => t.push(a.recibo))); return t; });
  ok(nums.every(n => n > 0) && new Set(nums).size === nums.length, '1.4 cada abono tiene su numero de recibo y ninguno se repite (' + nums.join(',') + ')');
  ok(ab.recibo === Math.max(...nums) && ab.recibo === 5, '1.4 el abono nuevo toma el siguiente numero; el del abono borrado (4) no se reutiliza (' + ab.recibo + ')');
  ok(await evalua(A, () => debtors.find(d => d.concepto === 'Viejo').abonos[0].recibo) === 1, '1.4 los abonos antiguos reciben numero en orden de fecha (el mas viejo: REC-0001)');
  await evalua(A, i => verReciboAbono(i, debtors[i].abonos.length - 1, null), iMoto);
  ok(await A.locator('#rc-numero').innerText() === 'REC-' + String(ab.recibo).padStart(4, '0'), '4.1 el recibo muestra el numero del abono');
  const rec = await A.locator('#rc-totales').innerText();
  ok(/Saldo antes de este pago[\s\S]*\$800\.000/.test(rec) && /Nuevo saldo[\s\S]*\$400\.000/.test(rec), '4.2 recibo del abono: saldo antes $800.000 y nuevo saldo $400.000');
  await A.click('.recibo-btn-cerrar');
  await evalua(A, i => verReciboAbono(i, 0, null), iMoto);
  ok(await A.locator('#rc-numero').innerText() === 'REC-0002', '4.1 el abono antiguo de Juan conserva su numero: REC-0002');
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
  await A.selectOption('#aj-hora', '9');
  await A.selectOption('#aj-hora2', '17');
  await guardado(A); await espera(1600); await guardado(A);
  ok(JSON.stringify(B.vivos('deudores_ajustes')[0].data.avisos.horas) === '[9,17]', '5.5 dos avisos al dia (9 a.m. y 5 p.m.) se guardan en la nube');
  await A.selectOption('#aj-hora2', '');
  ok(await evalua(A, () => JSON.stringify(ajustes.avisos.horas) === '[9]'), '5.5 "Sin segundo aviso" deja uno solo');
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

  // ── 17. Arreglos (parte 1) y funciones nuevas ───────────────────────────────
  const B3 = crear();
  const E = await dispositivo(browser, B3);
  await evalua(E, () => localStorage.setItem('dd_resumen_visto', hoyISO()));
  await login(E);
  await guardado(E);
  await cerrarResumen(E);
  const pngB = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const foto = {name: 'foto.png', mimeType: 'image/png', buffer: pngB};

  // 1.1 Sin fecha limite: el interes se cuenta hasta la ultima cuota (antes quedaba sin interes)
  await evalua(E, () => openModal());
  await E.fill('#f-nombre', 'Carlos Diaz');
  await E.fill('#f-cedula', '80123456');
  await E.fill('#f-concepto', 'Sin limite');
  await E.fill('#f-prestamo', '2026-01-10');
  await E.fill('#f-monto', '1000000');
  await E.fill('#f-interes', '10');
  await E.fill('#f-ncuotas', '3');
  await E.fill('#f-pago', '');
  ok(/hasta la ultima cuota/.test(await E.locator('#cuota-preview').innerText()), '1.1 el formulario avisa que el interes se cuenta hasta la ultima cuota');
  await E.click('#overlay .btn-save');
  await espera(300);
  const esperadoSL = Math.round(1000000 * (1 + 0.1 * (90 / 30.4375)));
  const sl = await evalua(E, () => { const d = debtors.find(x => x.concepto === 'Sin limite'); return {suma: d.cuotas.reduce((s, c) => s + c.monto, 0), enteras: d.cuotas.every(c => Number.isInteger(c.monto)), fp: d.fechaPago, total: totalDeuda(d)}; });
  ok(sl.suma === esperadoSL && sl.total === esperadoSL && sl.fp === '2026-04-10', '1.1 sin fecha limite cobra intereses hasta la ultima cuota (' + sl.suma + ')');
  ok(sl.enteras, 'centavos: las cuotas quedan en pesos enteros');
  const iSL = await evalua(E, () => debtors.findIndex(x => x.concepto === 'Sin limite'));
  await evalua(E, i => editDebtor(i, {stopPropagation() {}}), iSL);
  await E.fill('#f-concepto', 'Sin limite (editado)');
  await E.click('#overlay .btn-save');
  await espera(300);
  ok(await evalua(E, () => totalDeuda(debtors.find(x => x.concepto === 'Sin limite (editado)'))) === esperadoSL, '1.1 editar el prestamo ya no cambia el total');

  // 1.2 Fecha limite antes de la ultima cuota: pregunta, y ya no sale "Vencido" sin deber nada atrasado
  const carlosId = await evalua(E, () => clientes.find(c => c.nombre === 'Carlos Diaz').id);
  await evalua(E, id => openModal(null, id), carlosId);
  await E.fill('#f-concepto', 'Limite corto');
  await E.fill('#f-prestamo', '2026-01-15');
  await E.fill('#f-pago', '2026-02-15');
  await E.fill('#f-monto', '300000');
  await E.fill('#f-ncuotas', '3');
  await E.click('#overlay .btn-save');
  await E.waitForSelector('#dd-pregunta.open');
  ok(/ultima cuota queda despues/i.test(await E.locator('#dd-pregunta-titulo').innerText()), '1.2 si las cuotas pasan de la fecha limite, pregunta');
  await E.click('#dd-pregunta-si');
  await espera(300);
  ok(await evalua(E, () => debtors.find(x => x.concepto === 'Limite corto').fechaPago) === '2026-04-15', '1.2 "Si": la fecha limite queda en la ultima cuota');
  await evalua(E, ([cid, a, b, c, dd]) => {
    debtors.push({id: 'dv', clienteId: cid, nombre: 'Carlos Diaz', cedula: '80123456', telefono: '', concepto: 'Viejo inconsistente', fechaPrestamo: a, fechaPago: b, monto: 300000, interes: 0, freq: 'monthly',
      cuotas: [{monto: 100000, fecha: b}, {monto: 100000, fecha: c}, {monto: 100000, fecha: dd}], abonos: [{id: 'av1', monto: 100000, fecha: iso0(b), metodo: 'Efectivo', recibo: siguienteNumeroRecibo()}], pagado: false});
    function iso0(x) { const p = x.split('-'); const d = new Date(+p[0], p[1] - 1, +p[2] - 1); return toISO(d); }
    persist(); renderList();
  }, [carlosId, iso(-40), iso(-10), iso(20), iso(50)]);
  ok(await evalua(E, () => getStatus(debtors.find(x => x.id === 'dv'))) === 'pending', '1.2 un prestamo al dia con la fecha limite vieja ya no sale "Vencido"');

  // Centavos de cuotas antiguas: pagar los valores redondeados deja todo pagado
  await evalua(E, ([cid, f]) => {
    debtors.push({id: 'dc', clienteId: cid, nombre: 'Carlos Diaz', concepto: 'Centavos', fechaPrestamo: f, fechaPago: f, monto: 1101847.89, interes: 0, freq: 'monthly',
      cuotas: [{monto: 367282.63, fecha: f}, {monto: 367282.63, fecha: f}, {monto: 367282.63, fecha: f}],
      abonos: [{id: 'c1', monto: 367283, fecha: f, recibo: siguienteNumeroRecibo()}, {id: 'c2', monto: 367283, fecha: f, recibo: siguienteNumeroRecibo()}, {id: 'c3', monto: 367282, fecha: f, recibo: siguienteNumeroRecibo()}], pagado: false});
    actualizarPagado(debtors[debtors.length - 1]); persist();
  }, [carlosId, iso(-5)]);
  const cent = await evalua(E, () => { const d = debtors.find(x => x.id === 'dc'); return {pagado: d.pagado, saldo: resumenDeudor(d).saldo, est: allocateCuotas(d).map(c => c.status).join(',')}; });
  ok(cent.pagado && cent.saldo === 0 && cent.est === 'pagada,pagada,pagada', 'centavos: cuotas antiguas con centavos quedan pagadas, sin "parcial" ni saldo de centavos');

  // 1.5 Un prestamo archivado que vuelve a deber sale del archivo
  await evalua(E, () => { const d = debtors.find(x => x.id === 'dc'); d.archivado = true; persist(); });
  evalua(E, () => eliminarAbono(debtors.findIndex(x => x.id === 'dc'), 2, null));
  await aceptar(E, true);
  ok(await evalua(E, () => { const d = debtors.find(x => x.id === 'dc'); return !d.pagado && !d.archivado && d.abonosBorrados.includes('c3'); }), '1.5 al borrar un abono de un prestamo archivado, vuelve a la lista y a Cobrar');

  // 1.6 Analisis: lo cobrado del mes es la suma de los pagos (sin contar dos veces)
  const mes = await evalua(E, () => { const m = getMesActualData(); let t = 0; const ini = hoyISO().slice(0, 8); debtors.forEach(d => (d.abonos || []).forEach(a => { if (a.fecha.slice(0, 8) === ini) t += a.monto; })); return [m.cobrado, t]; });
  ok(mes[0] === mes[1], '1.6 Analisis: cobrado del mes = pagos del mes (' + mes.join(' = ') + ')');

  // 1.9 y 1.10 Fotos: sin internet esperan y se suben solas; al borrar el abono se borra la foto
  await guardado(E);
  const iV = await evalua(E, () => debtors.findIndex(x => x.id === 'dv'));
  await E.context().setOffline(true);
  await evalua(E, i => abrirAbono(i, null), iV);
  await E.fill('#ab-monto', '20000');
  await E.setInputFiles('#ab-foto', foto);
  await E.click('#ab-guardar');
  await E.waitForFunction(() => Object.keys(_fotosPendientes).length === 1, null, {timeout: 5000});
  ok(true, '1.10 sin internet la foto queda guardada en el dispositivo, esperando');
  ok(/&#9203;|⏳/.test(await evalua(E, () => document.getElementById('list') && (perfilAbiertoId() ? '' : '') + filaAbono(debtors.findIndex(x => x.id === 'dv'), debtors.find(x => x.id === 'dv').abonos.length - 1))), '1.10 el abono muestra ⏳ mientras la foto espera internet');
  await E.context().setOffline(false);
  await evalua(E, () => window.dispatchEvent(new Event('online')));
  await E.waitForFunction(() => { const d = debtors.find(x => x.id === 'dv'); return d.abonos[d.abonos.length - 1].comprobante; }, null, {timeout: 10000});
  const rutaFoto = await evalua(E, () => { const d = debtors.find(x => x.id === 'dv'); return d.abonos[d.abonos.length - 1].comprobante; });
  ok(B3.fotos.has(rutaFoto) && !(await evalua(E, () => Object.keys(_fotosPendientes).length)), '1.10 al volver internet la foto se sube sola');
  evalua(E, i => eliminarAbono(i, debtors[i].abonos.length - 1, null), iV);
  await aceptar(E, true);
  await E.waitForFunction(() => !localStorage.getItem('dd_fotos_borrar'), null, {timeout: 5000}).catch(() => {});
  ok(!B3.fotos.has(rutaFoto), '1.9 al borrar el abono, la foto del comprobante se borra de la nube');

  // 1.12 Recibo sin telefono: no aparece "Enviar como texto"
  await evalua(E, () => { const i = debtors.findIndex(x => x.id === 'dv'); verReciboAbono(i, 0, null); });
  ok(!await E.isVisible('#recibo-wa-txt') && await E.isVisible('#recibo-wa-btn'), '1.12 sin telefono se oculta "Enviar como texto"; la imagen si se puede compartir');
  await E.click('.recibo-btn-cerrar');

  // 2.1 y 2.2 Foto de perfil y cedula
  await evalua(E, id => abrirPerfil(id), carlosId);
  await E.waitForSelector('#perfil.open');
  let [chooser] = await Promise.all([E.waitForEvent('filechooser'), E.click('.perfil-foto')]);
  await chooser.setFiles(foto);
  await E.waitForFunction(id => { const c = clientes.find(x => x.id === id); return c.foto && /^data:image\/jpeg/.test(c.fotoMini || ''); }, carlosId, {timeout: 8000});
  const cF = await evalua(E, id => clientes.find(x => x.id === id), carlosId);
  ok(B3.fotos.has(cF.foto) && /clientes\/.+\/perfil\.jpg$/.test(cF.foto), '2.1 la foto de perfil se guarda en la carpeta privada');
  ok(await E.locator('#perfil .perfil-foto img').count() === 1 && await E.locator('#list .avatar-foto img').count() === 1, '2.1 la foto reemplaza las iniciales en el perfil y en la lista');
  [chooser] = await Promise.all([E.waitForEvent('filechooser'), E.locator('.doc-tile').first().click()]);
  await chooser.setFiles(foto);
  await E.waitForFunction(id => clientes.find(x => x.id === id).cedulaFrente, carlosId, {timeout: 8000});
  ok(/cedula-frente\.jpg$/.test(await evalua(E, id => clientes.find(x => x.id === id).cedulaFrente, carlosId)), '2.2 la foto de la cedula (frente) se guarda');
  ok(/Guardada/.test(await E.locator('.doc-tile').first().innerText()), '2.2 en el perfil se ve que la cedula ya esta guardada');
  await E.locator('.doc-tile').first().click();
  await E.waitForFunction(() => (document.getElementById('foto-img').src || '').startsWith('data:image'), null, {timeout: 5000});
  ok(await E.locator('#foto-acciones button').count() === 2, '2.2 al ver la cedula se puede cambiar o borrar');
  const rutaCed = await evalua(E, id => clientes.find(x => x.id === id).cedulaFrente, carlosId);
  await E.locator('#foto-acciones button', {hasText: 'Borrar'}).click();
  await aceptar(E, true);
  await espera(500);
  ok(!await evalua(E, id => clientes.find(x => x.id === id).cedulaFrente, carlosId) && !B3.fotos.has(rutaCed), '2.2 borrar la cedula la quita del perfil y de la nube');

  // 3.1 Calificacion automatica
  await evalua(E, ([a, b]) => {
    const c = crearOBuscarCliente('Luis Mora', '70111222', '3015550000');
    debtors.push({id: 'dl', clienteId: c.id, nombre: c.nombre, cedula: c.cedula, telefono: c.telefono, concepto: 'Atrasado', fechaPrestamo: a, fechaPago: b, monto: 200000, interes: 0, freq: 'monthly',
      cuotas: [{monto: 200000, fecha: b}], abonos: [], pagado: false});
    persist(); renderList();
  }, [iso(-80), iso(-45)]);
  const luisId = await evalua(E, () => clientes.find(c => c.nombre === 'Luis Mora').id);
  await evalua(E, ([a, b, c2]) => {
    const c = crearOBuscarCliente('Maria Rios', '52333444', '');
    debtors.push({id: 'dm', clienteId: c.id, nombre: c.nombre, concepto: 'Puntual', fechaPrestamo: a, fechaPago: c2, monto: 200000, interes: 0, freq: 'monthly',
      cuotas: [{monto: 100000, fecha: b}, {monto: 100000, fecha: c2}], abonos: [{id: 'm1', monto: 100000, fecha: b, recibo: siguienteNumeroRecibo()}, {id: 'm2', monto: 100000, fecha: c2, recibo: siguienteNumeroRecibo()}], pagado: false});
    actualizarPagado(debtors[debtors.length - 1]); persist(); renderList();
  }, [iso(-70), iso(-40), iso(-10)]);
  const mariaId = await evalua(E, () => clientes.find(c => c.nombre === 'Maria Rios').id);
  const calC = await evalua(E, id => calificacionCliente(clientePorId(id)), mariaId);
  const calL = await evalua(E, id => calificacionCliente(clientePorId(id)), luisId);
  ok(calC.estrellas === 5 && /Excelente/.test(calC.etiqueta) && calL.estrellas === 1 && /Mal pagador/.test(calL.etiqueta), '3.1 calificacion: Maria (paga a tiempo) ' + calC.estrellas + '★ (' + calC.etiqueta + '), Luis ' + calL.estrellas + '★ (' + calL.etiqueta + ')');
  ok(/★/.test(await E.locator('.perfil-cal').innerText()), '3.1 la calificacion se ve en el perfil');

  // 3.3 Promesas de pago (compromisos)
  await evalua(E, () => { cerrarPerfil(); switchTab('promesas'); });
  await E.click('text=+ Nueva promesa');
  await E.waitForSelector('#promesa-overlay.open');
  await E.selectOption('#prom-cliente', luisId);
  ok(/Lo vencido/.test(await E.locator('#prom-atajos-monto').innerText()), '3.3 atajos de monto: lo vencido');
  await E.fill('#prom-monto', '50000');
  await E.fill('#prom-nota', 'Le pagan el viernes');
  await E.click('#prom-guardar');
  await espera(300);
  let prom = await evalua(E, id => { const c = clientePorId(id); return {n: (c.promesas || []).length, est: estadoPromesa(c, c.promesas[0]), f: c.promesas[0].fecha}; }, luisId);
  ok(prom.n === 1 && prom.est === 'pendiente' && prom.f === iso(1), '3.3 promesa guardada para manana (por defecto)');
  ok(/Proximas \(1\)/i.test(await E.locator('#promesas-body').innerText()) && /Le pagan el viernes/.test(await E.locator('#promesas-body').innerText()), '3.3 la pestaña Compromisos la muestra en "Proximas" con la nota');
  await guardado(E); await espera(1500); await guardado(E);
  ok(B3.vivos('deudores_clientes').some(r => (r.data.promesas || []).length === 1), '3.3 la promesa se guarda en la nube');
  await evalua(E, ([id, h]) => { const c = clientePorId(id); c.promesas[0].fecha = h; guardarClientesLocal(); persist(); renderList(); }, [luisId, iso(0)]);
  ok(await E.locator('#promesas-badge').innerText() === '1' && /Para hoy \(1\)/i.test(await E.locator('#promesas-body').innerText()), '3.3 el dia de la promesa aparece en "Para hoy" con el numero en la pestaña');
  await evalua(E, () => switchTab('cobrar'));
  ok(/Prometio pagar el/.test(await E.locator('.cobrar-item', {hasText: 'Luis'}).innerText()), '3.3 en Cobrar se ve que Luis prometio pagar');
  await evalua(E, () => { const i = debtors.findIndex(x => x.id === 'dl'); debtors[i].abonos.push({id: 'pl1', monto: 50000, fecha: hoyISO(), creado: new Date().toISOString(), recibo: siguienteNumeroRecibo()}); actualizarPagado(debtors[i]); persist(); renderList(); });
  ok(await evalua(E, id => { const c = clientePorId(id); return estadoPromesa(c, c.promesas[0]); }, luisId) === 'cumplida', '3.3 al registrar el abono, la promesa queda cumplida sola');
  // Una promesa que no cumplio: al darle otra fecha, la anterior queda en el historial
  await evalua(E, ([id, a, b]) => { const c = clientePorId(id); c.promesas.push({id: 'px', fecha: a, desde: b, monto: 80000, prestamoId: '', creado: new Date().toISOString()}); guardarClientesLocal(); persist(); renderList(); }, [luisId, iso(-2), iso(-5)]);
  ok(await evalua(E, id => { const c = clientePorId(id); return estadoPromesa(c, c.promesas[1]); }, luisId) === 'incumplida', '3.3 si pasa la fecha sin pagar: "No cumplio"');
  await evalua(E, id => abrirPromesa(id, 'px'), luisId);
  await E.fill('#prom-fecha', iso(3));
  await E.click('#prom-guardar');
  await espera(200);
  const repr = await evalua(E, id => clientePorId(id).promesas.map(p => p.estado || estadoPromesa(clientePorId(id), p)), luisId);
  ok(repr.join(",") === "cumplida,reprogramada,pendiente", "3.3 nueva fecha: la promesa incumplida queda en el historial y se crea otra (" + repr + ")");
  ok(/promesa/.test(await evalua(E, id => calificacionCliente(clientePorId(id)).detalle, luisId)), '3.1 las promesas sin cumplir bajan la calificacion');

  // 3.5 Lista de "no prestar"
  await evalua(E, id => { switchTab('deudores'); abrirPerfil(id); abrirClienteForm(); }, luisId);
  await E.check('#c-noprestar');
  await E.fill('#c-noprestar-motivo', 'No pago a tiempo');
  await E.click('#cliente-overlay .btn-save');
  await espera(200);
  ok(/No prestar/.test(await E.locator('#perfil-body').innerText()), '3.5 el perfil muestra el aviso de no prestar');
  await evalua(E, () => cerrarPerfil());
  ok(await E.isVisible('#chip-noprestar') && await E.locator('#n-noprestar').innerText() === '1', '3.5 aparece el filtro "No prestar" con 1 cliente');
  await E.click('#chip-noprestar');
  ok((await E.locator('#list .debtor-card').count()) === 1 && /Luis/.test(await E.locator('#list').innerText()), '3.5 el filtro muestra solo la lista de no prestar');
  await evalua(E, () => setFilter('all', document.querySelectorAll('.filter-btn')[0]));
  const nAntes = await evalua(E, () => debtors.length);
  await evalua(E, id => openModal(null, id), luisId);
  ok(/no prestar/i.test(await E.locator('#f-cliente-datos').innerText()), '3.5 al prestarle, el formulario avisa');
  await E.fill('#f-concepto', 'No deberia');
  await E.fill('#f-monto', '100000');
  await E.click('#overlay .btn-save');
  await E.waitForSelector('#dd-pregunta.open');
  ok(/no prestar/i.test(await E.locator('#dd-pregunta-titulo').innerText()), '3.5 pregunta antes de guardar un prestamo nuevo');
  await E.click('#dd-pregunta-no');
  await espera(200);
  ok(await evalua(E, () => debtors.length) === nAntes, '3.5 "No prestar": no se crea el prestamo');
  await evalua(E, () => closeModal());

  // 1.8 Avisos discretos
  await evalua(E, () => ddAbrirCuenta());
  await E.check('#aj-discretos');
  await guardado(E); await espera(1500); await guardado(E);
  ok(B3.vivos('deudores_ajustes')[0].data.avisos.discretos === true, '1.8 avisos discretos guardados en la nube');
  await evalua(E, () => ddCerrarCuenta());

  // 1.13 Ocultar montos: tambien los avisos, el detalle de pagos y las promesas
  await evalua(E, () => { alternarMontos(true); abrirPerfil(clientes.find(c => c.nombre === 'Carlos Diaz').id); });
  ok(await evalua(E, () => ['.perfil-seccion .monto', '.alert-banner', '.cuota-dias-txt'].every(sel => { const el = document.querySelector(sel); return !el || /blur/.test(getComputedStyle(el).filter); })), '1.13 con el ojo, se ocultan tambien los montos del historial y de los avisos');
  await evalua(E, () => { alternarMontos(false); cerrarPerfil(); });

  // 1.3 Dos dispositivos registran abonos al mismo prestamo sin internet: no se pierde ninguno
  const F = await dispositivo(browser, B3);
  await evalua(F, () => localStorage.setItem('dd_resumen_visto', hoyISO()));
  await login(F);
  await guardado(F);
  await cerrarResumen(F);
  await evalua(E, () => ddSincronizar('prueba')); await guardado(E);
  await evalua(F, () => ddSincronizar('prueba')); await guardado(F);
  await evalua(F, () => { _ddSesion = null; });
  await evalua(E, () => { const d = debtors.find(x => x.id === 'dv'); d.abonos.push({id: 'eE', monto: 11000, fecha: hoyISO(), creado: new Date().toISOString(), recibo: siguienteNumeroRecibo()}); actualizarPagado(d); persist(); });
  await guardado(E); await espera(1500); await guardado(E);
  await evalua(F, () => { const d = debtors.find(x => x.id === 'dv'); d.abonos.push({id: 'eF', monto: 22000, fecha: hoyISO(), creado: new Date().toISOString(), recibo: siguienteNumeroRecibo()}); actualizarPagado(d); persist(); });
  await evalua(F, async () => { _ddSesion = JSON.parse(localStorage.getItem('mc-auth')); await ddSincronizar('prueba'); });
  await guardado(F); await espera(1800); await guardado(F);
  const enNube = B3.vivos('deudores').find(r => r.id === 'dv').data.abonos.map(a => a.id);
  ok(enNube.includes('eE') && enNube.includes('eF'), '1.3 los abonos de los dos dispositivos quedan los dos (' + enNube.join(',') + ')');
  const recsDV = B3.vivos('deudores').find(r => r.id === 'dv').data.abonos.map(a => a.recibo);
  await evalua(E, () => ddSincronizar('prueba')); await guardado(E); await espera(1500); await guardado(E);
  const todosRec = await evalua(E, () => { const t = []; debtors.forEach(d => (d.abonos || []).forEach(a => t.push(a.recibo))); return t; });
  ok(new Set(todosRec).size === todosRec.length, '1.4 aunque los dos dispositivos dieron el mismo numero sin internet, los recibos quedan sin repetirse (' + recsDV.join(',') + ')');
  // Borrar en uno mientras el otro esta sin internet: el abono borrado no revive
  await evalua(F, () => ddSincronizar('prueba')); await guardado(F);
  await evalua(F, () => { _ddSesion = null; });
  evalua(E, () => { const i = debtors.findIndex(x => x.id === 'dv'); eliminarAbono(i, debtors[i].abonos.findIndex(a => a.id === 'eE'), null); });
  await aceptar(E, true);
  await guardado(E); await espera(1500); await guardado(E);
  await evalua(F, () => { const d = debtors.find(x => x.id === 'dv'); d.abonos.push({id: 'eG', monto: 5000, fecha: hoyISO(), creado: new Date().toISOString(), recibo: siguienteNumeroRecibo()}); actualizarPagado(d); persist(); });
  await evalua(F, async () => { _ddSesion = JSON.parse(localStorage.getItem('mc-auth')); await ddSincronizar('prueba'); });
  await guardado(F); await espera(1800); await guardado(F);
  const final = B3.vivos('deudores').find(r => r.id === 'dv').data.abonos.map(a => a.id);
  ok(!final.includes('eE') && final.includes('eG') && final.includes('eF'), '1.3 el abono borrado en un dispositivo no revive al unir (' + final.join(',') + ')');

  // 1.11 Un cliente borrado se recupera desde el historial
  await evalua(E, () => ddSincronizar('prueba')); await guardado(E);
  await evalua(E, id => { abrirPerfil(id); }, luisId);
  evalua(E, () => eliminarClienteActual());
  await aceptar(E, true);
  await guardado(E); await espera(1500); await guardado(E);
  ok(!await evalua(E, id => !!clientePorId(id), luisId), '1.11 cliente eliminado');
  await evalua(E, () => ddAbrirHistorial());
  await E.waitForSelector('.dd-hist-item');
  await E.locator('.dd-hist-item', {hasText: 'Cliente'}).filter({hasText: 'Luis'}).first().locator('button').click();
  await aceptar(E, true);
  await espera(300);
  const luisR = await evalua(E, id => clientePorId(id), luisId);
  ok(luisR && luisR.noPrestar && (luisR.promesas || []).length === 3, '1.11 el cliente vuelve con sus datos, su marca de no prestar y sus promesas');

  // 1.14 Cargar un backup: recupera tus datos del negocio y no une clientes solo por el nombre
  const tmpBk2 = path.join(require('os').tmpdir(), 'dd-v4.json');
  fs.writeFileSync(tmpBk2, JSON.stringify({version: 'deudores_v4', fecha: new Date().toISOString(),
    datos: [{id: 'bk1', clienteId: 'c_otro', nombre: 'Carlos Diaz', cedula: '99887766', concepto: 'Del backup', fechaPrestamo: iso(-3), fechaPago: iso(27), monto: 1000, interes: 0, cuotas: [{monto: 1000, fecha: iso(27)}], abonos: [], pagado: false}],
    clientes: [{id: 'c_otro', nombre: 'Carlos Diaz', cedula: '99887766', telefono: ''}],
    ajustes: {negocio: {nombre: 'Negocio Prueba', responsable: 'Samuel', telefono: '300', pie: 'Gracias'}, backup: {frecuencia: 'semanal'}}}));
  const nCli = await evalua(E, () => clientes.length);
  await E.setInputFiles('#input-backup', tmpBk2);
  await E.waitForSelector('#backup-load-overlay.open');
  ok(await E.isVisible('#backup-load-ajustes-wrap') && await E.isChecked('#backup-load-ajustes'), '1.14 ofrece recuperar tus datos del negocio');
  await E.click('#backup-load-ok');
  await espera(300);
  ok(await evalua(E, () => ajustes.negocio.nombre === 'Negocio Prueba' && ajustes.backup.frecuencia === 'semanal'), '1.14 recupera los datos del negocio y la frecuencia del backup');
  ok(await evalua(E, () => clientes.length) === nCli + 1, '1.14 otro "Carlos Diaz" con otra cedula queda como cliente aparte');

  // 3.15 PIN: con el teclado del Mac, 5 intentos y 1 minuto, y Face ID
  await evalua(E, () => configurarPin());
  await E.keyboard.type('1357');
  await espera(300);
  await E.keyboard.type('1357');
  await espera(500);
  ok(await evalua(E, () => !!pinActual()), '3.15 el PIN se puede escribir con el teclado del Mac');
  await guardado(E); await espera(1500); await guardado(E);
  await evalua(F, () => ddSincronizar('prueba')); await guardado(F);
  ok(await evalua(F, () => !!pinActual()), '1.7 el otro dispositivo recibe el PIN');
  await evalua(F, () => bloquearSiHayPin());
  for (let k = 0; k < 5; k++) { await F.keyboard.type('0000'); await espera(250); }
  ok(/Demasiados intentos/.test(await F.locator('#pin-msg').innerText()) && await F.locator('.pin-teclado button:text-is("1")').isDisabled(), '3.15 con 5 intentos fallidos hay que esperar 1 minuto');
  await F.keyboard.type('1357');
  await espera(300);
  ok(await F.isVisible('#pin-lock.open'), '3.15 mientras espera, ni el PIN correcto abre');
  await evalua(F, () => { const x = intentosPin(); x.hasta = Date.now() - 1; guardarIntentosPin(x); revisarBloqueoPin(); });
  await F.keyboard.type('1357');
  await espera(400);
  ok(!await F.isVisible('#pin-lock.open'), '3.15 pasado el minuto, el PIN correcto abre');
  await evalua(F, () => {
    window.PublicKeyCredential = {isUserVerifyingPlatformAuthenticatorAvailable: async () => true};
    Object.defineProperty(navigator, 'credentials', {configurable: true, value: {
      create: async () => ({rawId: new Uint8Array([1, 2, 3, 4]).buffer}),
      get: async () => { window.__bioUsada = true; return {id: 'x'}; }}});
  });
  await evalua(F, () => activarBio());
  ok(await evalua(F, () => bioActiva()), '3.15 Face ID activado en este dispositivo');
  await evalua(F, () => bloquearSiHayPin());
  await F.waitForFunction(() => !document.getElementById('pin-lock').classList.contains('open'), null, {timeout: 4000}).catch(() => {});
  ok(await evalua(F, () => window.__bioUsada === true && !_pinModo), '3.15 al abrir, entra con Face ID');
  // 1.7 Quitar el PIN en un dispositivo lo quita tambien en el otro
  evalua(E, () => quitarPin());
  await aceptar(E, true);
  await guardado(E); await espera(1500); await guardado(E);
  await evalua(F, () => ddSincronizar('prueba')); await guardado(F);
  ok(await evalua(F, () => !pinActual() && !localStorage.getItem('dd_pin_local')), '1.7 al quitar el PIN en un dispositivo, el otro tampoco lo pide');
  for (const p of [E, F]) ok(p.errores.length === 0, 'sin errores de JavaScript (nuevas funciones): ' + (p.errores.join(' / ') || 'ninguno'));

  for (const p of [A, C, D]) ok(p.errores.length === 0, 'sin errores de JavaScript: ' + (p.errores.join(' / ') || 'ninguno'));
  await browser.close();
  console.log(fallos ? `\n${fallos} FALLAS` : '\nAPP: TODO OK');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
