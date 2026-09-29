// Guarda la página de prueba en el dispositivo para que abra sin señal.
// Lo de esta página sale de lo guardado y se actualiza por detrás cuando hay señal.
// Lo que va a Google (datos) no pasa por acá: siempre va directo.
const VERSION = 'prueba-2';
const ARCHIVOS = ['./', './index.html', './manifest.webmanifest', '../icono-180.png', '../icono-192.png', '../icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf('prueba-') === 0 && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const red = caches.open(VERSION).then(c => fetch(e.request)
    .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
    .catch(() => null));
  e.waitUntil(red);
  e.respondWith(caches.match(e.request, { ignoreSearch: true })
    .then(guardada => guardada || red.then(r => r || new Response('Sin señal', { status: 503 }))));
});
