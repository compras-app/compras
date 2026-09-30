'use strict';
/* ============================================================
   PANTALLAS DE LA APP. Cada paso agrega la suya (tablero, detalle,
   búsqueda, admin) con pantalla(id, {...}) y su <section id="s-id">
   en index.html. Si suma un archivo, va también en ARCHIVOS de sw.js.
   ============================================================ */

// 'tablero' la registra js/tablero.js; 'buscar', js/buscar.js; 'admin' y sus pantallas, js/admin.js
pantalla('cuenta',  { titulo: 'Tu cuenta', tab: '', alMostrar: pantallaCuenta });

/** Después del login (o al abrir con lo guardado): arma la barra y abre el tablero. */
function mostrarApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  // En la misma ventana: en el iPhone, otra ventana guardaría el pedido en otro lado
  $('t-nuevo').href = FORMULARIO + '?desde=app';
  pintarBarra();
  pintarSinRed();
  ir('tablero');
  mostrarNoAplicados();          // los que quedaron de antes (aunque se haya cerrado la app)
}

/** La barra según quién sos (se vuelve a pintar si inicioApp trae algo nuevo). */
function pintarBarra() {
  $('b-nombre').textContent = APP.yo.nombre + (APP.yo.prueba ? ' · 🧪 encargado' : '');
  $('b-inicial').textContent = APP.yo.nombre.charAt(0).toUpperCase();
  $('t-admin').hidden = !APP.yo.admin;
  $('t-tareas').hidden = !APP.yo.admin;             // el tablero de tareas es solo de los admins
}

function pantallaCuenta() {
  $('c-nombre').textContent = APP.yo.nombre;
  $('c-rol').textContent = APP.yo.prueba ? 'Encargado (prueba en este dispositivo)' : APP.yo.admin ? 'Administrador' : 'Usuario';
  $('b-prueba').hidden = !APP.yo.adminReal;
  $('b-prueba').textContent = APP.yo.prueba ? 'Volver a ser administrador en este dispositivo' : '🧪 Probar como encargado en este dispositivo';
  $('c-disp').textContent = dispositivo();
  $('c-host').textContent = location.host + (instalada() ? ' (app instalada)' : '');
  $('c-version').textContent = VERSION_APP;
  const err = guardado.leerJSON(K.error, null);
  $('c-error-t').hidden = $('c-error').hidden = !err;
  if (err) $('c-error').textContent = new Date(err.cuando).toLocaleString('es-AR', { hour12: false }) + ' · ' + err.fn + ' · ' + err.detalle;
  const desde = guardado.leer(K.desde);
  $('c-desde').textContent = desde ? new Date(desde).toLocaleString('es-AR', { hour12: false }) : '—';
  estado('e-cuenta', '');
  pintarAspecto();
}

/* ---------- Cómo se ve la app (Paso 6, Feli): estilo del tablero y color de cada uno ----------
   Se ve al instante y va por la bandeja (sin señal, se guarda cuando vuelve). */
const ESTILOS = [
  { id: 'profundidad', nombre: 'Profundidad', nota: 'Como Trello' },
  { id: 'liso', nombre: 'Liso oscuro', nota: 'Fondo parejo' },
  { id: 'vidrio', nombre: 'Vidrio', nota: 'Columnas transparentes' }
];
function pintarAspecto() {
  const estilo = document.documentElement.dataset.estilo || (APP.yo && APP.yo.estilo) || 'profundidad';
  const colores = (APP.config && APP.config.colores) || [];
  const mio = APP.yo ? APP.yo.color || '' : '';
  $('c-aspecto').hidden = !colores.length;          // una versión vieja del servidor todavía no los manda
  $('c-estilos').innerHTML = ESTILOS.map(function (e) {
    return '<button type="button" class="asp-estilo" data-estilo="' + e.id + '" aria-pressed="' + (e.id === estilo) + '">' +
      '<span class="asp-mini" data-mini="' + e.id + '"><i></i><i></i><i></i></span><b>' + esc(e.nombre) + '</b><small>' + esc(e.nota) + '</small></button>';
  }).join('');
  $('c-colores').innerHTML = '<button type="button" class="asp-color asp-app" data-color="" aria-pressed="' + !mio + '" title="El de la app">' +
      '<span>El de la app</span></button>' +
    colores.map(function (c) {
      return '<button type="button" class="asp-color" data-color="' + esc(c.nombre) + '" aria-pressed="' + (c.nombre === mio) + '" title="' + esc(c.nombre) + '">' +
        '<i style="background:' + esc(c.hex) + '"></i><span>' + esc(c.nombre) + '</span></button>';
    }).join('');
  $('c-estilos').querySelectorAll('[data-estilo]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarAspecto({ estilo: b.dataset.estilo }); });
  });
  $('c-colores').querySelectorAll('[data-color]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarAspecto({ color: b.dataset.color }); });
  });
}
function cambiarAspecto(a) {
  const yo = APP.yo;
  const color = a.color !== undefined ? a.color : (yo.color || '');
  const estilo = a.estilo || document.documentElement.dataset.estilo || yo.estilo || 'profundidad';
  const c = (APP.config.colores || []).filter(function (x) { return x.nombre === color; })[0];
  aplicarAspecto(c ? c.css : null, estilo);
  yo.color = color; yo.estilo = estilo;
  const inicio = guardado.leerJSON(K.inicio, null);
  if (inicio) { inicio.yo = yo; inicio.config.css = c ? c.css : (guardado.leer(K.css) || ''); guardado.guardarJSON(K.inicio, inicio); }
  bandeja.agregar('guardarAspecto', [{ color: color, estilo: estilo }], 'guardar tu color y tu tablero');
  pintarAspecto();
}

document.querySelectorAll('.tabs .tab[data-tab]').forEach(function (t) {
  t.addEventListener('click', function () { ir(t.dataset.tab); });
});
$('b-cuenta').addEventListener('click', function () { abrir('cuenta'); });
$('b-volver').addEventListener('click', volver);
$('b-salir').addEventListener('click', salir);
// Solo para probar (Feli): este dispositivo como encargado. Se recarga para armar todo de nuevo.
$('b-prueba').addEventListener('click', async function () {
  this.disabled = true;
  estado('e-cuenta', 'Cambiando…', 'run');
  const r = await api('probarComoEncargado', !APP.yo.prueba);
  this.disabled = false;
  if (!r.ok) return estado('e-cuenta', r.sinConexion ? 'Hace falta señal para cambiarlo.' : r.error, 'bad');
  const inicio = guardado.leerJSON(K.inicio, {}) || {};
  inicio.yo = r.yo;
  guardado.guardarJSON(K.inicio, inicio);
  location.hash = '';
  location.reload();
});

// Pedidos del formulario que quedaron guardados en este teléfono: la app también los manda
PedidosGuardados.alCambiar(function () {
  PedidosGuardados.pendientes().then(function (n) { APP.pedidosPendientes = n; pintarSinRed(); });
});
PedidosGuardados.procesar();
