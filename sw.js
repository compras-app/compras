// Guarda la app en el dispositivo para que abra aunque no haya señal.
// Los archivos de la app salen siempre de lo guardado. Cuando se sube una
// versión nueva, subir-pagina.sh cambia VERSION (una huella de los
// archivos); el navegador lo nota, baja todo de nuevo por detrás y la app
// se recarga sola la próxima vez que se vuelve a ella (js/base.js).
// Lo que va a Google (datos) no pasa por acá: siempre va directo.
// El formulario (pedido/) y Transferencias (transferencias/) también son parte de la app.
const VERSION = 'app-33a428d19e';
const ARCHIVOS = [
  './', './index.html', './css/app.css',
  './js/base.js', './js/login.js', './js/pantallas.js', './js/envio-pedidos.js', './js/tablero.js', './js/cotizar.js', './js/recepcion.js', './js/chats.js', './js/presupuestos.js', './js/cuadro.js', './js/tareas.js', './js/servicios.js', './js/notificaciones.js', './js/buscar.js', './js/admin.js',
  './manifest.webmanifest', './icono-180.png', './icono-192.png', './icono-512.png',
  // El formulario (pedido/)
  './pedido/', './pedido/index.html', './pedido/formulario.css', './pedido/formulario.js',
  './pedido/manifest.webmanifest', './pedido/icono-180.png', './pedido/icono-192.png', './pedido/icono-512.png',
  // Transferencias (Fase extra): el Programa de Compras dentro de la app
  './transferencias/', './transferencias/index.html', './transferencias/albor.js'
];
const FUENTES = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const EN_PRUEBA = self.location.hostname === 'localhost';   // en la compu de Claude: siempre lo último

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf('app-') === 0 && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const RUTAS = ARCHIVOS.map(a => new URL(a, self.location).pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Letra Figtree: se guarda la primera vez que se baja
  if (FUENTES.test(req.url)) {
    e.respondWith(caches.open('fuentes').then(c => c.match(req).then(g => g || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }))));
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin || RUTAS.indexOf(url.pathname) === -1) return;

  if (EN_PRUEBA) {
    e.respondWith(fetch(req).then(r => {
      const copia = r.clone();
      caches.open(VERSION).then(c => c.put(req, copia));
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true, cacheName: VERSION }).then(g => g || fetch(req)));
});
