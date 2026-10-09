/* ════════════════════════════════════════════════════════════════════════════
   Mis Deudores · Service worker
   - Abre la app sin internet (con los datos guardados en el dispositivo).
   - Recibe las notificaciones (Web Push) y abre la app al tocarlas.
   ════════════════════════════════════════════════════════════════════════════ */
const VERSION = 'dd-v3';
const BASICOS = ['./', './index.html', './manifest.webmanifest', './icono-180.png', './icono-192.png', './icono-512.png', './insignia-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // La nube (Supabase) nunca se guarda en cache
  if (/supabase\.co$/.test(url.hostname)) return;
  // La app: primero internet (para tener siempre la ultima version), si no hay, la copia guardada
  if (req.mode === 'navigate' || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname))) {
    e.respondWith(fetch(req).then(r => {
      const copia = r.clone();
      if (r.ok) caches.open(VERSION).then(c => c.put('./index.html', copia));
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // Librerias, fuentes e iconos: la copia guardada y se actualiza por detras
  const permitido = url.origin === location.origin || /(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!permitido) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const guardada = await c.match(req);
    const red = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => guardada);
    return guardada || red;
  }));
});

/* ── Notificaciones ─────────────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {title: 'Mis Deudores', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mis Deudores', {
    body: d.body || '',
    icon: './icono-192.png',
    badge: './insignia-96.png',
    tag: d.tag || 'dd',
    renotify: true,
    data: {url: d.url || './'},
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(ventanas => {
    for (const v of ventanas) {
      if (v.url.startsWith(self.registration.scope)) { v.focus(); v.postMessage({tipo: 'abrir', url: destino}); return; }
    }
    return self.clients.openWindow(destino);
  }));
});
