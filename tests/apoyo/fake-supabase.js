// Cliente falso de supabase-js para las pruebas: manda todo a http://fake.test/
(function () {
  async function call(path, body) {
    const r = await fetch('http://fake.test/' + path, {method: 'POST', body: JSON.stringify(body || {})});
    return r.json();
  }
  function getSess() { try { return JSON.parse(localStorage.getItem('mc-auth') || 'null'); } catch (e) { return null; } }
  function blobABase64(blob) {
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  }
  window.supabase = {createClient() {
    const listeners = [];
    const sess = () => { const s = getSess(); return s && s.user.id; };
    const auth = {
      async getSession() { return {data: {session: getSess()}}; },
      onAuthStateChange(cb) { listeners.push(cb); return {data: {subscription: {unsubscribe() {}}}}; },
      async signInWithPassword({email, password}) {
        const r = await call('login', {email, password});
        if (r.error) return {data: {}, error: {message: r.error}};
        localStorage.setItem('mc-auth', JSON.stringify(r.session));
        return {data: {session: r.session}, error: null};
      },
      async signOut() { localStorage.removeItem('mc-auth'); listeners.forEach(l => l('SIGNED_OUT', null)); return {error: null}; },
      async updateUser() { return {error: null}; },
      async resetPasswordForEmail() { return {error: null}; },
    };
    return {
      auth,
      async rpc(name, args) {
        const r = await call('rpc/' + name, {uid: sess(), args});
        return r.error ? {data: null, error: r.error} : {data: r.data, error: null};
      },
      from(table) {
        const q = {table, op: 'select', filtros: [], orden: null, lim: null, datos: null};
        const b = {
          select() { return b; }, eq(c, v) { q.filtros.push([c, v]); return b; }, order(c, o) { q.orden = [c, o]; return b; },
          limit(n) { q.lim = n; return b; }, upsert(d) { q.op = 'upsert'; q.datos = d; return b; }, delete() { q.op = 'delete'; return b; },
          then(res, rej) { return call('from', {uid: sess(), q}).then(r => res(r.error ? {data: null, error: r.error} : {data: r.data, error: null}), rej); }
        };
        return b;
      },
      storage: {from(bucket) { return {
        async upload(path, blob, opts) { const r = await call('storage/upload', {uid: sess(), bucket, path, tipo: opts && opts.contentType, b64: await blobABase64(blob)}); return r.error ? {data: null, error: r.error} : {data: {path}, error: null}; },
        async createSignedUrl(path) { const r = await call('storage/url', {uid: sess(), bucket, path}); return r.error ? {data: null, error: r.error} : {data: {signedUrl: r.url}, error: null}; },
      }; }},
      functions: {async invoke(nombre, opts) { const r = await call('functions/' + nombre, {uid: sess(), cuerpo: (opts && opts.body) || {}}); return r.error ? {data: null, error: r.error} : {data: r.data, error: null}; }},
      channel() { const c = {on() { return c; }, subscribe() { return c; }}; return c; },
      removeChannel() {},
    };
  }};
})();
