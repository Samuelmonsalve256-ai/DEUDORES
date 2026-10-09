// Supabase de mentira, en memoria, para las pruebas.
// Emula mc_push / mc_pull / mc_indice / mc_historial (como los SQL de MotoContable),
// la tabla de dispositivos de avisos, la carpeta de comprobantes y la funcion de avisos.
const canon = v => JSON.stringify(v, (k, val) => {
  if (val && typeof val === 'object' && !Array.isArray(val)) { const o = {}; Object.keys(val).sort().forEach(x => { o[x] = val[x]; }); return o; }
  return val;
});
const BASE = ['motos','movimientos','ventas','carros','contactos','metas','config','traspasos','traspasos_borradores','deudores'];
const NUEVAS = ['deudores_clientes','deudores_ajustes'];

function crear({conSQLNuevo = true} = {}) {
  const B = {seq: 0, reg: new Map(), hist: [], permitidas: conSQLNuevo ? BASE.concat(NUEVAS) : BASE.slice(),
             subs: [], fotos: new Map(), invocaciones: []};
  B.activarSQLNuevo = () => { NUEVAS.forEach(c => { if (!B.permitidas.includes(c)) B.permitidas.push(c); }); };
  const key = (u, c, i) => u + '|' + c + '|' + i;
  B.push = (uid, cambios) => {
    if (!uid) return {error: {message: 'Debes iniciar sesión', code: '42501'}};
    const aplicados = [], conflictos = [];
    const copia = new Map([...B.reg].map(([k, v]) => [k, {...v}])), histLen = B.hist.length, seq0 = B.seq;
    try {
      for (const c of cambios) {
        const col = c.coleccion, id = c.id, base = c.base_version == null ? null : Number(c.base_version), borrar = !!c.eliminar, data = c.data, modo = c.modo || 'normal';
        if (!B.permitidas.includes(col)) throw {message: 'new row for relation "mc_registros" violates check constraint "mc_registros_coleccion_check"'};
        const k = key(uid, col, id); const r = B.reg.get(k);
        if (!r) {
          if (borrar) { aplicados.push({coleccion: col, id, version: null, seq: null, eliminado: true, resultado: 'inexistente'}); continue; }
          const n = {uid, coleccion: col, id, data, version: 1, seq: ++B.seq, deleted_at: null, created_at: new Date().toISOString()};
          B.reg.set(k, n); aplicados.push({coleccion: col, id, version: 1, seq: n.seq, eliminado: false, resultado: 'creado'}); continue;
        }
        if ((borrar && r.deleted_at) || (!borrar && !r.deleted_at && canon(r.data) === canon(data))) {
          aplicados.push({coleccion: col, id, version: r.version, seq: r.seq, eliminado: !!r.deleted_at, resultado: 'sin_cambios'}); continue;
        }
        if (modo === 'normal' && base != null && base === r.version) {
          B.hist.push({hist_id: B.hist.length + 1, uid, coleccion: col, id, data: r.data, version: r.version, motivo: (borrar && !r.deleted_at) ? 'eliminacion' : 'edicion', guardado_en: new Date().toISOString()});
          if (!borrar) r.data = data;
          r.deleted_at = borrar ? new Date().toISOString() : null;
          r.version++; r.seq = ++B.seq;
          aplicados.push({coleccion: col, id, version: r.version, seq: r.seq, eliminado: !!r.deleted_at, resultado: borrar ? 'eliminado' : 'actualizado'}); continue;
        }
        B.hist.push({hist_id: B.hist.length + 1, uid, coleccion: col, id, data, version: base, motivo: modo === 'migracion' ? 'migracion' : 'conflicto', guardado_en: new Date().toISOString()});
        conflictos.push({coleccion: col, id, data: r.deleted_at ? null : r.data, version: r.version, seq: r.seq, created_at: r.created_at, eliminado: !!r.deleted_at, motivo: modo === 'migracion' ? 'migracion' : 'conflicto'});
      }
    } catch (e) { B.reg = copia; B.hist.length = histLen; B.seq = seq0; return {error: e}; }
    return {data: {aplicados, conflictos}};
  };
  B.pull = (uid, desde, limite) => {
    const filas = [...B.reg.values()].filter(r => r.uid === uid && r.seq > (desde || 0)).sort((a, b) => a.seq - b.seq).slice(0, limite || 200);
    return {data: filas.map(r => ({coleccion: r.coleccion, id: r.id, data: r.deleted_at ? null : r.data, version: r.version, seq: r.seq, created_at: r.created_at, eliminado: !!r.deleted_at}))};
  };
  B.indice = uid => ({data: [...B.reg.values()].filter(r => r.uid === uid).map(r => ({coleccion: r.coleccion, id: r.id, version: r.version, seq: r.seq, eliminado: !!r.deleted_at}))});
  B.tabla = (uid, q) => {
    if (q.table === 'mc_historial') {
      let h = B.hist.filter(x => x.uid === uid);
      q.filtros.forEach(([c, v]) => { h = h.filter(x => x[c] === v); });
      h = h.slice().sort((a, b) => b.hist_id - a.hist_id);
      if (q.lim) h = h.slice(0, q.lim);
      return {data: h};
    }
    if (q.table === 'dd_push_suscripciones') {
      if (!B.permitidas.includes('deudores_clientes')) return {error: {message: 'relation "dd_push_suscripciones" does not exist'}};
      if (q.op === 'upsert') {
        const fila = {...q.datos, user_id: uid};
        B.subs = B.subs.filter(s => s.endpoint !== fila.endpoint); B.subs.push(fila);
        return {data: [fila]};
      }
      return {data: B.subs.filter(s => s.user_id === uid)};
    }
    return {data: []};
  };
  B.funcion = (uid, nombre, cuerpo) => {
    B.invocaciones.push({nombre, cuerpo});
    if (nombre !== 'deudores-avisos') return {error: {message: 'Function not found'}};
    if (!uid) return {error: {message: 'Inicia sesion'}};
    if (cuerpo.accion === 'clave') return {data: {publica: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'}};
    if (cuerpo.accion === 'prueba') return {data: {enviadas: B.subs.filter(s => s.user_id === uid).length}};
    return {error: {message: 'Accion desconocida'}};
  };
  B.vivos = col => [...B.reg.values()].filter(r => r.coleccion === col && !r.deleted_at);
  return B;
}
module.exports = {crear};
