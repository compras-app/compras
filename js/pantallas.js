'use strict';
/* ============================================================
   PANTALLAS DE LA APP. Cada paso agrega la suya (tablero, detalle,
   búsqueda, admin) con pantalla(id, {...}) y su <section id="s-id">
   en index.html. Si suma un archivo, va también en ARCHIVOS de sw.js.
   ============================================================ */

// 'tablero' la registra js/tablero.js
pantalla('buscar',  { titulo: 'Buscar' });
pantalla('admin',   { titulo: 'Administración' });
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
  $('b-nombre').textContent = APP.yo.nombre;
  $('b-inicial').textContent = APP.yo.nombre.charAt(0).toUpperCase();
  $('t-admin').hidden = !APP.yo.admin;
}

function pantallaCuenta() {
  $('c-nombre').textContent = APP.yo.nombre;
  $('c-rol').textContent = APP.yo.admin ? 'Administrador' : 'Usuario';
  $('c-disp').textContent = dispositivo();
  $('c-host').textContent = location.host + (instalada() ? ' (app instalada)' : '');
  $('c-version').textContent = VERSION_APP;
  const err = guardado.leerJSON(K.error, null);
  $('c-error-t').hidden = $('c-error').hidden = !err;
  if (err) $('c-error').textContent = new Date(err.cuando).toLocaleString('es-AR', { hour12: false }) + ' · ' + err.fn + ' · ' + err.detalle;
  const desde = guardado.leer(K.desde);
  $('c-desde').textContent = desde ? new Date(desde).toLocaleString('es-AR', { hour12: false }) : '—';
  estado('e-cuenta', '');
}

document.querySelectorAll('.tabs .tab[data-tab]').forEach(function (t) {
  t.addEventListener('click', function () { ir(t.dataset.tab); });
});
$('b-cuenta').addEventListener('click', function () { abrir('cuenta'); });
$('b-volver').addEventListener('click', volver);
$('b-salir').addEventListener('click', salir);

// Pedidos del formulario que quedaron guardados en este teléfono: la app también los manda
PedidosGuardados.alCambiar(function () {
  PedidosGuardados.pendientes().then(function (n) { APP.pedidosPendientes = n; pintarSinRed(); });
});
PedidosGuardados.procesar();
