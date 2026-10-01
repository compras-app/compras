'use strict';
/* ============================================================
   PANTALLAS DE LA APP. Cada paso agrega la suya (tablero, detalle,
   búsqueda, admin) con pantalla(id, {...}) y su <section id="s-id">
   en index.html. Si suma un archivo, va también en ARCHIVOS de sw.js.
   ============================================================ */

// 'tablero' la registra js/tablero.js; 'buscar', js/buscar.js; 'admin' y sus pantallas, js/admin.js
pantalla('cuenta',  { titulo: 'Tu cuenta', tab: '', alMostrar: pantallaCuenta });

/**
 * Después del login (o al abrir con lo guardado): arma la barra y abre el tablero.
 * Apartados (Fase extra): quien no ve Compras va directo a Transferencias (o, si
 * no ve ninguno, a Tu cuenta). Quien ve los dos vuelve al último que abrió. Un
 * link a una tarjeta (#Ref) o a Tu cuenta (#cuenta) se queda acá.
 */
function mostrarApp() {
  const ap = misApartados(APP.yo);
  const transf = ap.indexOf('transferencias') !== -1;
  if (transf && !location.hash && (ap.indexOf('compras') === -1 || guardado.leer(K_APARTADO) === 'transferencias')) {
    return location.replace(APARTADOS.transferencias.url);
  }
  $('login').hidden = true;
  $('app').hidden = false;
  // En la misma ventana: en el iPhone, otra ventana guardaría el pedido en otro lado
  $('t-nuevo').href = FORMULARIO + '?desde=app';
  pintarBarra();
  pintarSinRed();
  if (sinCompras()) ir('cuenta');
  else if (location.hash === '#cuenta') { ir('tablero'); abrir('cuenta'); }
  else ir('tablero');
  mostrarNoAplicados();          // los que quedaron de antes (aunque se haya cerrado la app)
}

/** ¿No ve el apartado Compras? Entonces solo tiene Tu cuenta acá. */
function sinCompras() { return misApartados(APP.yo).indexOf('compras') === -1; }

const NOMBRE_ROL = { admin: 'Administrador', encargado: 'Encargado de granja', empleado: 'Empleado' };

/** La barra según quién sos (se vuelve a pintar si inicioApp trae algo nuevo). */
function pintarBarra() {
  $('b-nombre').textContent = APP.yo.nombre + (APP.yo.prueba ? ' · 🧪 ' + (APP.yo.rol === 'encargado' ? 'encargado' : 'empleado') : '');
  $('b-inicial').textContent = APP.yo.nombre.charAt(0).toUpperCase();
  pintarApartados($('b-apartados'), APP.yo, 'compras');
  if (sinCompras()) $('b-apartados').hidden = true;
  document.querySelector('nav.tabs').hidden = sinCompras();
  $('t-admin').hidden = !APP.yo.admin;
  $('t-tareas').hidden = !APP.yo.admin;             // el tablero de tareas es solo de los admins
}

function pantallaCuenta() {
  $('c-nombre').textContent = APP.yo.nombre;
  $('c-rol').textContent = (NOMBRE_ROL[APP.yo.rol] || 'Empleado') + (APP.yo.prueba ? ' (prueba en este dispositivo)' : '');
  // Apartados: a quien no ve Compras, desde acá se va a lo suyo
  const ap = misApartados(APP.yo);
  $('c-apartados').hidden = !sinCompras();
  $('c-apartados-txt').textContent = ap.length ? 'Lo tuyo está en:' : 'Por ahora no tenés ningún apartado de la app. Si te falta algo, avisale a un administrador.';
  $('c-apartados-lista').innerHTML = '';
  ap.filter(function (id) { return id !== 'compras'; }).forEach(function (id) {
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = APARTADOS[id].url;
    a.textContent = 'Ir a ' + APARTADOS[id].nombre;
    a.addEventListener('click', function () { guardado.guardar(K_APARTADO, id); });
    $('c-apartados-lista').appendChild(a);
  });
  // Probar como encargado o empleado (Feli, provisorio)
  $('b-prueba').hidden = $('b-prueba2').hidden = !APP.yo.adminReal;
  if (APP.yo.prueba) {
    $('b-prueba').textContent = 'Volver a ser administrador en este dispositivo';
    $('b-prueba').dataset.como = '';
    $('b-prueba2').textContent = APP.yo.rol === 'encargado' ? '🧪 Probar como empleado' : '🧪 Probar como encargado de granja';
    $('b-prueba2').dataset.como = APP.yo.rol === 'encargado' ? 'empleado' : 'encargado';
  } else {
    $('b-prueba').textContent = '🧪 Probar como encargado de granja en este dispositivo';
    $('b-prueba').dataset.como = 'encargado';
    $('b-prueba2').textContent = '🧪 Probar como empleado en este dispositivo';
    $('b-prueba2').dataset.como = 'empleado';
  }
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
  const mio = (APP.yo && APP.yo.color) || 'Azul';     // si no eligió, Azul (Feli)
  $('c-aspecto').hidden = !colores.length;          // una versión vieja del servidor todavía no los manda
  // Prueba (Feli, 2026-10-01): ver Compras con el aspecto de Transferencias, solo en este dispositivo
  $('c-prueba-aspecto').hidden = !(APP.yo && APP.yo.adminReal);
  const gral = document.documentElement.dataset.aspecto || '';
  $('c-aspecto-gral').querySelectorAll('button').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.aspecto === gral));
    b.onclick = function () { aspectoGeneral(b.dataset.aspecto); };
  });
  $('c-estilos').innerHTML = ESTILOS.map(function (e) {
    return '<button type="button" class="asp-estilo" data-estilo="' + e.id + '" aria-pressed="' + (e.id === estilo) + '">' +
      '<span class="asp-mini" data-mini="' + e.id + '"><i></i><i></i><i></i></span><b>' + esc(e.nombre) + '</b><small>' + esc(e.nota) + '</small></button>';
  }).join('');
  $('c-colores').innerHTML = colores.map(function (c) {
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
/** '' = como siempre (oscuro); 'programa' = como Transferencias (claro, bordó, letra del sistema). */
function aspectoGeneral(cual) {
  const html = document.documentElement;
  if (cual === 'programa') { html.dataset.aspecto = 'programa'; html.dataset.theme = 'light'; guardado.guardar('compras_aspecto', 'programa'); }
  else { delete html.dataset.aspecto; html.dataset.theme = 'dark'; guardado.borrar('compras_aspecto'); }
  pintarAspecto();
}

function cambiarAspecto(a) {
  const yo = APP.yo;
  const color = a.color || yo.color || 'Azul';
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
// Solo para probar (Feli): este dispositivo como encargado o empleado. Se recarga para armar todo de nuevo.
async function probarComo() {
  this.disabled = true;
  estado('e-cuenta', 'Cambiando…', 'run');
  const r = await api('probarComoEncargado', this.dataset.como || '');
  this.disabled = false;
  if (!r.ok) return estado('e-cuenta', r.sinConexion ? 'Hace falta señal para cambiarlo.' : r.error, 'bad');
  const inicio = guardado.leerJSON(K.inicio, {}) || {};
  inicio.yo = Object.assign(inicio.yo || {}, r.yo);
  guardado.guardarJSON(K.inicio, inicio);
  location.hash = '';
  location.reload();
}
$('b-prueba').addEventListener('click', probarComo);
$('b-prueba2').addEventListener('click', probarComo);

// Pedidos del formulario que quedaron guardados en este teléfono: la app también los manda
PedidosGuardados.alCambiar(function () {
  PedidosGuardados.pendientes().then(function (n) { APP.pedidosPendientes = n; pintarSinRed(); });
});
PedidosGuardados.procesar();
