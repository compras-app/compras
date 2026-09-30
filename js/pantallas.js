'use strict';
/* ============================================================
   PANTALLAS DE LA APP. Cada paso agrega la suya (tablero, detalle,
   búsqueda, admin) con pantalla(id, {...}) y su <section id="s-id">
   en index.html. Si suma un archivo, va también en ARCHIVOS de sw.js.
   ============================================================ */

pantalla('tablero', { titulo: 'Tablero' });
pantalla('buscar',  { titulo: 'Buscar' });
pantalla('admin',   { titulo: 'Administración' });
pantalla('cuenta',  { titulo: 'Tu cuenta', tab: '', alMostrar: pantallaCuenta });

/** Después del login (o al abrir con lo guardado): arma la barra y abre el tablero. */
function mostrarApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('t-nuevo').href = FORMULARIO;
  pintarBarra();
  pintarSinRed();
  ir('tablero');
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
