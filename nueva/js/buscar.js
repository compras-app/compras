'use strict';
/* ============================================================
   BUSCAR (Fase 2, Paso 5)
   ------------------------------------------------------------
   - Busca en todos los pedidos, también los terminados (Entregado y
     Cancelado), que ya no están en el tablero: por producto, rubro,
     proveedor particular, granja, quién lo pidió, razón o ref. Sin
     tildes ni mayúsculas. Los comentarios no entran (Feli).
   - "Mis pedidos / De todos" es el mismo filtro del tablero: los
     encargados entran con "Mis pedidos" y vuelve cada vez que se abre
     la app (Feli).
   - Sin escribir nada, muestra los últimos pedidos (con "Terminados",
     el historial).
   - Al tocar un resultado se abre la tarjeta de siempre. Un admin
     reabre un terminado desde ahí ("↩️ Reabrir el pedido", tablero.js).
   - Con poca señal busca en lo que está en el tablero (en curso).
   ============================================================ */

const BU = {
  estado: 'todos',
  tipo: '',           // Paso 2-ter: '' (todo), 'pedidos' o 'servicios'
  compra: '',         // Fase 4, Paso 5: '' (todos), 'si' (le compramos al proveedor buscado) o 'no'
  sitio: '',
  periodo: '',
  resultados: [],
  total: 0,
  pedido: 0,          // número de la última búsqueda (si llega una vieja, se ignora)
  buscando: false,
  local: false,       // resultados del tablero guardado (poca señal)
  armado: false
};

pantalla('buscar', { titulo: 'Buscar', alMostrar: mostrarBuscar });

function mostrarBuscar() {
  if (!TB.filtros) armarFiltros();
  if (!BU.armado) {
    BU.armado = true;
    $('bu-sitio').innerHTML = '<option value="">Todas</option>' +
      ((APP.config && APP.config.sitios) || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  }
  pintarFiltrosBuscar();
  buscarPedidos();
}

function pintarFiltrosBuscar() {
  document.querySelectorAll('#s-buscar [data-estado]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.estado === BU.estado));
  });
  document.querySelectorAll('#bu-tipo [data-tipo]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tipo === BU.tipo)); });
  document.querySelectorAll('#bu-compra [data-compra]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.compra === BU.compra)); });
  $('bu-compra').hidden = !APP.yo.admin;
  $('bu-mios').setAttribute('aria-pressed', String(!!TB.filtros.mios));
  $('bu-todos').setAttribute('aria-pressed', String(!TB.filtros.mios));
  $('bu-sitio').value = BU.sitio;
  $('bu-periodo').value = BU.periodo;
}

function filtrosBuscar(desde) {
  return { q: $('bu-q').value.trim(), estado: BU.estado, tipo: BU.tipo, mios: !!TB.filtros.mios, sitio: BU.sitio, periodo: BU.periodo, desde: desde || 0,
           compra: BU.compra };
}

/** Busca de nuevo (mas = "Ver más": suma los siguientes). */
async function buscarPedidos(mas) {
  if (!APP.token) return;
  const n = ++BU.pedido;
  const f = filtrosBuscar(mas ? BU.resultados.length : 0);
  BU.buscando = true;
  pintarBusqueda();
  const r = await api('buscarPedidos', f);
  if (n !== BU.pedido) return;                 // ya hay otra búsqueda más nueva
  BU.buscando = false;
  if (r.ok) {
    BU.local = false;
    BU.resultados = mas ? BU.resultados.concat(r.resultados) : r.resultados;
    BU.total = r.total;
  } else if (r.sinConexion) {
    BU.local = true;
    BU.resultados = buscarEnTablero(f);
    BU.total = BU.resultados.length;
  } else if (!r.sinSesion) {
    BU.local = false;
    BU.resultados = [];
    BU.total = 0;
    $('bu-estado').textContent = r.error || 'No se pudo buscar. Probá de nuevo en un rato.';
    return pintarResultados();
  }
  pintarBusqueda();
}

/** Con poca señal: lo que está en el tablero guardado (solo en curso; no tiene los productos). */
function buscarEnTablero(f) {
  if (f.estado === 'terminados' || f.tipo === 'servicios') return [];
  const palabras = sinTildes(f.q).split(/[^a-z0-9ñ]+/).filter(String);
  return vista().filter(function (t) {
    if (f.mios && !esMio(t)) return false;
    if (f.sitio && t.sitio !== f.sitio) return false;
    const texto = sinTildes([t.ref, t.titulo, t.sitio, t.solicitante].join(' '));
    return palabras.every(function (w) { return texto.indexOf(w) !== -1; });
  }).map(function (t) {
    return { ref: t.ref, titulo: t.titulo, sitio: t.sitio, urgencia: t.urgencia, columna: t.columna, solicitante: t.solicitante, fecha: '', terminado: false };
  });
}

function pintarBusqueda() {
  const est = $('bu-estado');
  const q = $('bu-q').value.trim();
  if (BU.buscando && !BU.resultados.length) est.textContent = 'Buscando…';
  else if (BU.local) est.textContent = '📶 Poca señal: busco en lo que está en el tablero. Los terminados y los productos se buscan cuando vuelva la señal.';
  else if (!BU.total) est.textContent = q ? 'No encontré pedidos con "' + q + '".' : 'No hay pedidos para mostrar.';
  else est.textContent = (q ? BU.total + (BU.total === 1 ? ' pedido' : ' pedidos') : 'Los últimos pedidos') +
    (BU.total > BU.resultados.length ? ' · se ven ' + BU.resultados.length : '') + (BU.buscando ? ' · buscando…' : '');
  pintarResultados();
}

/** La columna de un resultado, con lo que espera en la bandeja (ej. lo acaban de reabrir). */
function columnaConCambios(x) {
  let col = x.columna;
  bandeja.lista().forEach(function (m) {
    if (m.args[0] !== x.ref) return;
    if (m.fn === 'moverTarjeta') col = (m.args[1] || {}).columna || col;
    else if (m.fn === 'cancelarPedido') col = colCancelado();
  });
  return col;
}

function pintarResultados() {
  const cont = $('bu-resultados');
  const terminadas = [colCancelado(), colEntregado()];
  cont.innerHTML = BU.resultados.map(function (x) {
    const col = columnaConCambios(x);
    const fin = x.servicio ? col === colFinalizadosServ() : terminadas.indexOf(col) !== -1;
    return '<button type="button" class="tarjeta resultado' + (fin ? ' terminado' : '') + '" data-ref="' + esc(x.ref) + '">' +
      '<div class="t">' + (x.servicio ? '🔧 ' : '') + esc(x.titulo || x.ref) + '</div>' +
      // Feli (2026-10-06): por qué apareció, ej. "Radio Electron (proveedor, se le compró)"
      ((x.coincide || []).length ? '<div class="bu-coincide">Se encontró: ' + x.coincide.map(esc).join(' · ') + '</div>' : '') +
      '<div class="pie"><span aria-label="' + esc(x.urgencia) + '">' + esc(emojiUrgencia(x.urgencia)) + '</span>' +
      '<span class="sitio">' + esc(x.sitio) + '</span>' +
      '<span class="bu-col' + (fin ? ' fin' : '') + '">' + esc(col) + '</span>' +
      (x.fecha ? '<span class="bu-fecha">' + esc(new Date(x.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: '2-digit' })) + '</span>' : '') +
      '</div></button>';
  }).join('');
  cont.querySelectorAll('.resultado').forEach(function (b) {
    b.addEventListener('click', function () { abrirTarjeta(b.dataset.ref); });
  });
  $('bu-mas').hidden = BU.local || BU.resultados.length >= BU.total;
}

// Cuando el servidor confirma que se movió o se canceló (ej. se reabrió), el resultado queda con su columna nueva
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (!r.ok || (m.fn !== 'moverTarjeta' && m.fn !== 'cancelarPedido')) return;
    BU.resultados.forEach(function (x) {
      if (x.ref === m.args[0]) x.columna = m.fn === 'cancelarPedido' ? colCancelado() : ((m.args[1] || {}).columna || x.columna);
    });
    if (!$('s-buscar').hidden) pintarResultados();
  };
})();

/* ---------- Qué dispara una búsqueda ---------- */
let esperaBuscar = null;
$('bu-q').addEventListener('input', function () {
  clearTimeout(esperaBuscar);
  esperaBuscar = setTimeout(function () { buscarPedidos(); }, 600);     // cuando deja de escribir
});
$('bu-form').addEventListener('submit', function (e) {
  e.preventDefault();
  clearTimeout(esperaBuscar);
  $('bu-q').blur();                                                     // en el celular, baja el teclado
  buscarPedidos();
});
document.querySelectorAll('#s-buscar [data-estado]').forEach(function (b) {
  b.addEventListener('click', function () { BU.estado = b.dataset.estado; pintarFiltrosBuscar(); buscarPedidos(); });
});
// El mismo "Mis pedidos" del tablero
document.querySelectorAll('#bu-tipo [data-tipo]').forEach(function (b) {
  b.addEventListener('click', function () { BU.tipo = b.dataset.tipo; pintarFiltrosBuscar(); buscarPedidos(); });
});
document.querySelectorAll('#bu-compra [data-compra]').forEach(function (b) {
  b.addEventListener('click', function () {
    BU.compra = b.dataset.compra;
    pintarFiltrosBuscar();
    if (BU.compra && !$('bu-q').value.trim()) return aviso('Escribí el nombre del proveedor en el buscador.');
    buscarPedidos();
  });
});
$('bu-mios').addEventListener('click', function () { TB.filtros.mios = true; pintarFiltros(); pintarFiltrosBuscar(); buscarPedidos(); });
$('bu-todos').addEventListener('click', function () { TB.filtros.mios = false; pintarFiltros(); pintarFiltrosBuscar(); buscarPedidos(); });
$('bu-sitio').addEventListener('change', function () { BU.sitio = this.value; buscarPedidos(); });
$('bu-periodo').addEventListener('change', function () { BU.periodo = this.value; buscarPedidos(); });
$('bu-mas').addEventListener('click', function () { buscarPedidos(true); });
