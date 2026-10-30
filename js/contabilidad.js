'use strict';
/* ============================================================
   FASE 6, PASO 4 (Feli, 28/10): EL APARTADO DE CONTABILIDAD
   ------------------------------------------------------------
   Vive en la misma página que Compras, con ?ap=contabilidad y sus
   propias pestañas (Tablero, Reportes y Ajustes). Lo ven el rol contabilidad y,
   mientras se prueba, los de "Ven lo de la Fase 6".
   - Tablero: Pre-compra, Comprado, Recibido y Factura cargada, armado
     con los datos de Compras (getTableroContable). Se actualiza con el
     canal al instante de siempre (alCambiar 'tablero').
   - Tarjeta abierta: cuenta y centro (✏️ Cambiar), sin orden de compra
     en rojo, la compra con el CUIT y los precios, los productos, los
     presupuestos (el archivo y lo que leyó la IA) y la factura (PDF).
   Todo lo que cambia necesita señal: va directo, no por la bandeja.
   ============================================================ */

const K_CONTABLE = 'compras_contable';      // el último tablero, para abrir sin señal
const CT = { datos: null, abierta: null, tarjeta: null, cargando: false };
const COLUMNAS_CT = [
  { k: 'precompra', t: 'Pre-compra' }, { k: 'comprado', t: 'Comprado' },
  { k: 'recibido', t: 'Recibido' }, { k: 'factura', t: 'Factura cargada' }
];

pantalla('contabilidad', { titulo: 'Contabilidad', tab: 'contabilidad', alMostrar: mostrarContable });
pantalla('ctarjeta', { titulo: 'Tarjeta', tab: 'contabilidad', alMostrar: mostrarTarjetaContable });

/** ¿Esta página está en el apartado de Contabilidad? (lo usa pantallas.js) */
function modoContable() {
  const ap = misApartados(APP.yo);
  return ap.indexOf('contabilidad') !== -1 && (/[?&]ap=contabilidad\b/.test(location.search) || ap.length === 1);
}
// Reportes (vacía por ahora: se arma cuando contabilidad diga qué datos quiere) y Ajustes, con las cuentas
// contables y los bienes de uso (Feli, 29/10). En Contabilidad, esas dos pantallas cuelgan de su pestaña Ajustes.
pantalla('creportes', { titulo: 'Reportes', tab: 'creportes' });
pantalla('cajustes', { titulo: 'Ajustes', tab: 'cajustes' });
if (/[?&]ap=contabilidad\b/.test(location.search)) { PANTALLAS.cuentas.tab = 'cajustes'; PANTALLAS.bienes.tab = 'cajustes'; }
document.querySelectorAll('#s-cajustes [data-ir]').forEach(function (b) { b.addEventListener('click', function () { abrir(b.dataset.ir); }); });

function dinero(n, moneda) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '';
  return (moneda && moneda !== 'ARS' ? moneda + ' ' : '$ ') + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaCorta(iso) { return iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) : ''; }

/* ============================================================
   EL TABLERO
   ============================================================ */
async function mostrarContable() {
  if (!CT.datos) CT.datos = guardado.leerJSON(K_CONTABLE, null);
  if (!CT.datos) notaAd('ct-estado', 'Cargando…');
  pintarContable();
  await cargarContable();
}

async function cargarContable() {
  if (CT.cargando) return;
  CT.cargando = true;
  const r = await api('getTableroContable');
  CT.cargando = false;
  if (!r.ok) { notaAd('ct-estado', r.sinConexion ? '📶 Poca señal: se ve lo último que se cargó. Se actualiza solo cuando vuelva.' : r.error); return; }
  CT.datos = r;
  guardado.guardarJSON(K_CONTABLE, r);
  notaAd('ct-estado', '');
  pintarContable();
}

function armarFiltrosContables() {
  const d = CT.datos;
  const sitios = [];
  (APP.config && APP.config.sitios || []).concat(['Extras']).forEach(function (s) { if (sitios.indexOf(s) === -1) sitios.push(s); });
  const selS = $('ct-sitio'), vs = selS.value;
  selS.innerHTML = '<option value="">Todos los sitios</option>' + sitios.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  selS.value = vs;
  const selC = $('ct-cuenta'), vc = selC.value;
  selC.innerHTML = '<option value="">Todas las cuentas</option><option value="-">Sin cuenta contable</option>' +
    (d.cuentasLista || []).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  selC.value = vc;
}

/** ¿Pasa los filtros? t: un pedido (ref) o una compra (id). */
function pasaFiltrosContables(t) {
  const q = sinTildes($('ct-q').value.trim()), sitio = $('ct-sitio').value, cuenta = $('ct-cuenta').value;
  const cuentas = t.trabajo ? t.cuentas : [t.cuenta.texto];
  if ($('ct-sinorden').checked && !(t.trabajo && t.sinOrden)) return false;
  if (sitio && (t.trabajo ? t.sitios.indexOf(sitio) === -1 : t.sitio !== sitio)) return false;
  if (cuenta === '-' && !cuentas.some(function (c) { return c === 'Sin cuenta contable'; })) return false;
  if (cuenta && cuenta !== '-' && !cuentas.some(function (c) { return c.indexOf(cuenta) === 0; })) return false;
  // Feli (30/10): también por el número de la orden de compra y por la factura (el nombre del archivo)
  return !q || sinTildes([t.titulo, t.proveedor || '', t.cuit || '', cuentas.join(' '), t.ref || t.id, t.solicitante || '',
                          t.numeroOrden || '', (t.factura && t.factura.nombre) || '', (t.factura && t.factura.numero) || ''].join(' ')).indexOf(q) !== -1;
}

function htmlCuentaCt(texto) {
  return '<div class="ct-cuenta' + (texto === 'Sin cuenta contable' ? ' sin' : '') + '">📒 ' + esc(texto) + '</div>';
}

function htmlTarjetaCt(t) {
  const prueba = t.prueba ? '<div class="sobre">🧪 ' + esc(t.prueba === true ? 'PRUEBA' : t.prueba) + '</div>' : '';
  if (!t.trabajo) {
    return '<div class="tarjeta ct-t" data-id="' + esc(t.ref) + '" role="button" tabindex="0">' + prueba +
      '<div class="t">' + esc(t.titulo || t.ref) + '</div>' +
      '<div class="sub-t">' + esc([t.sitio, t.solicitante].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="pie"><span>' + esc(emojiUrgencia(t.urgencia)) + '</span><span class="ct-col-c">' + esc(t.columna) + '</span>' +
      '<span>' + (t.masivo ? 'Pedido masivo: se compra del presupuesto' : t.productos + (t.productos === 1 ? ' producto' : ' productos') + ' sin comprar') + '</span></div></div>';
  }
  const recep = t.recibido ? '✅ Recibido' + (t.retiro ? ' · retiró ' + t.retiro + (t.fechaRetiro ? ', ' + fechaCorta(t.fechaRetiro) : '') : ' · ' + t.columna)
                           : '⏳ ' + t.columna;
  return '<div class="tarjeta ct-t" data-id="' + esc(t.id) + '" role="button" tabindex="0">' + prueba +
    // Paso 5 (Feli, 29/10): el número de la orden arriba de la tarjeta, chiquito; sin número, en rojo (con "pendiente" si se está armando).
    // La cuenta no se ve en el tablero (Feli, 29/10: estaba muy cargado); está en la tarjeta abierta y en el filtro
    (t.numeroOrden ? '<div class="ct-oc">OC ' + esc(t.numeroOrden) + '</div>'
                   : t.sinOrden ? '<div class="ct-orden">' + (t.motivo === 'Orden de compra pendiente' ? '⚠️ Orden de compra pendiente' : 'Sin orden de compra') + '</div>' : '') +
    '<div class="t">' + esc(t.titulo) + '</div>' +
    // Feli (31/10): un pedido que pasó entero a Entregas (sin comprar en la app) no tiene proveedor: quién lo pidió
    (t.entero ? '<div class="sub-t">' + esc(['Pasó entero a Entregas', t.solicitante].filter(Boolean).join(' · ')) + '</div>'
              : '<div class="sub-t">🏪 ' + esc(t.proveedor || 'Sin proveedor') + (t.cuit ? ' · CUIT ' + esc(t.cuit) : '') + '</div>') +
    '<div class="pie"><span>' + esc(t.sitios.join(', ')) + '</span>' + (t.total !== null ? '<span><b>' + esc(dinero(t.total, t.moneda)) + '</b></span>' : '') + '</div>' +
    (t.factura ? '<div class="ct-fac">🧾 ' + esc(t.factura.numero ? 'Factura ' + (t.factura.letra ? t.factura.letra + ' ' : '') + t.factura.numero : t.factura.nombre) +
                 // Fase 6-bis (Feli, 30/10): cómo dio la lectura de la IA
                 ({ grave: ' <span class="ct-fac-e grave">⛔ No coincide</span>', aviso: ' <span class="ct-fac-e aviso">⚠️ Revisar</span>',
                    ok: ' <span class="ct-fac-e ok">✅</span>', sinLeer: ' <span class="ct-fac-e">Sin leer</span>' }[t.factura.estado] || '') + '</div>' : '') +
    '<div class="ct-recep">' + esc(recep) + '</div></div>';
}

function pintarContable() {
  const d = CT.datos;
  if (!d) { $('ct-cols').innerHTML = ''; return; }
  armarFiltrosContables();
  $('ct-cols').innerHTML = COLUMNAS_CT.map(function (c) {
    const l = (d[c.k] || []).filter(pasaFiltrosContables);
    return '<div class="ct-col"><h3>' + esc(c.t) + ' <span class="n">' + l.length + '</span></h3>' +
      (l.map(htmlTarjetaCt).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>';
  }).join('');
  const proc = (d.procesando || []).filter(pasaFiltrosContables);
  $('ct-proc').hidden = !proc.length;
  $('ct-proc-t').textContent = '⚙️ Procesando (' + proc.length + '): todo comprado';
  $('ct-proc-l').innerHTML = proc.map(function (p) {
    return '<button type="button" class="proc-i" data-id="' + esc(p.ref) + '"><b>' + esc(p.titulo || p.ref) + '</b><small>' + esc([p.cuenta.texto, p.sitio, p.solicitante].join(' · ')) + '</small></button>';
  }).join('');
  document.querySelectorAll('#ct-cols [data-id], #ct-proc-l [data-id]').forEach(function (el) {
    const abrirla = function () { abrir('ctarjeta', { id: el.dataset.id }); };
    el.addEventListener('click', abrirla);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrirla(); });
  });
}

['ct-q', 'ct-sitio', 'ct-cuenta', 'ct-sinorden'].forEach(function (id) { $(id).addEventListener(id === 'ct-q' ? 'input' : 'change', pintarContable); });
$('ct-refrescar').addEventListener('click', function () { cargarContable(); if (document.body.dataset.pantalla === 'ctarjeta') cargarTarjetaContable(); });

/* Al instante: cuando cambia algo en Compras (el canal de siempre). Sin canal, pregunta cada 20 s mientras se mira. */
function refrescarContable() {
  const p = document.body.dataset.pantalla;
  if (p === 'contabilidad') cargarContable();
  else if (p === 'ctarjeta') { cargarContable(); cargarTarjetaContable(); }
}
alCambiar(function (c) { if (c.que === 'tablero' || c.que === 'conectado') refrescarContable(); });
setInterval(function () { if (!document.hidden && !tiempoRealVivo()) refrescarContable(); }, 20000);

/* ============================================================
   LA TARJETA ABIERTA
   ============================================================ */
async function mostrarTarjetaContable(datos) {
  if (datos && datos.id && datos.id !== CT.abierta) { CT.abierta = datos.id; CT.tarjeta = null; $('cx-cuerpo').innerHTML = ''; }
  notaAd('cx-estado', CT.tarjeta ? '' : 'Cargando…');
  await cargarTarjetaContable();
}

async function cargarTarjetaContable() {
  const id = CT.abierta;
  if (!id) return;
  const r = await api('getTarjetaContable', id);
  if (CT.abierta !== id) return;
  if (!r.ok) { notaAd('cx-estado', r.sinConexion ? '📶 Hace falta señal para abrir la tarjeta.' : r.error); return; }
  CT.tarjeta = r;
  notaAd('cx-estado', '');
  pintarTarjetaContable();
}

function htmlCuentaPedido(p) {
  return '<div class="cx-cuenta">' + htmlCuentaCt(p.cuenta.texto) +
    (p.cuenta.tipo !== 'bien' ? '<button type="button" class="btn-chico" data-cambiar="' + esc(p.ref) + '">✏️ Cambiar</button>' : '') + '</div>';
}

function htmlPedidoCt(p, conTitulo) {
  return '<div class="caja cx-pedido">' + (conTitulo ? '<h3>' + esc(p.titulo || p.ref) + (p.prueba ? ' · 🧪 ' + esc(p.prueba) : '') + '</h3>' : '') +
    htmlCuentaPedido(p) +
    '<dl class="ad-datos"><dt>Sitio</dt><dd>' + esc(p.sitio || '—') + '</dd><dt>Pidió</dt><dd>' + esc(p.solicitante || '—') + '</dd>' +
    '<dt>Razón</dt><dd>' + esc(p.razon || '—') + '</dd><dt>Pedido</dt><dd>' + esc(p.ref) + ' · ' + esc(fechaCorta(p.fecha)) + '</dd></dl></div>';
}

function htmlPresupuestosCt(l) {
  if (!l || !l.length) return '<p class="nota">No tiene presupuestos cargados.</p>';
  return l.map(function (b) {
    return '<details class="ad-item cx-presup"><summary><span class="ad-nom"><b>' + esc(b.proveedor || 'Proveedor') + '</b>' +
      '<small>' + esc(b.estado) + (b.total !== '' && b.total !== null ? ' · Total ' + esc(dinero(b.total, b.moneda)) : '') + '</small></span></summary>' +
      '<div class="ad-cuerpo">' +
        (b.archivo ? '<button type="button" class="btn2" data-ver="' + esc(b.archivo) + '">📄 Ver el presupuesto</button>' : '') +
        (b.renglones.length ? '<table class="cx-tabla"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead><tbody>' +
          b.renglones.map(function (x) {
            return '<tr><td>' + esc(x.texto) + '</td><td>' + esc(String(x.cantidad === null || x.cantidad === undefined ? '' : x.cantidad)) + (x.unidad ? ' ' + esc(x.unidad) : '') +
              '</td><td>' + esc(dinero(x.precio, b.moneda)) + '</td><td>' + esc(dinero(x.importe, b.moneda)) + '</td></tr>';
          }).join('') + '</tbody></table>' : '') +
        '<dl class="ad-datos">' + (b.subtotal !== '' && b.subtotal !== null ? '<dt>Subtotal</dt><dd>' + esc(dinero(b.subtotal, b.moneda)) + '</dd>' : '') +
          (b.iva !== '' && b.iva !== null ? '<dt>IVA</dt><dd>' + esc(dinero(b.iva, b.moneda)) + '</dd>' : '') +
          (b.condiciones.pago ? '<dt>Forma de pago</dt><dd>' + esc(b.condiciones.pago) + '</dd>' : '') +
          (b.condiciones.entrega ? '<dt>Entrega</dt><dd>' + esc(b.condiciones.entrega) + '</dd>' : '') +
          (b.condiciones.validez ? '<dt>Validez</dt><dd>' + esc(b.condiciones.validez) + '</dd>' : '') + '</dl>' +
      '</div></details>';
  }).join('');
}

/** Las órdenes de compra de un pedido original (Feli, 31/10: quedan también en el pedido). */
function htmlOrdenesCt(l) {
  if (!l || !l.length) return '';
  return '<div class="caja"><h3>📄 Órdenes de compra</h3>' + l.map(function (o) {
    return '<div class="cx-orden-p' + (o.estado === 'Para anular' ? ' anular' : '') + '"><b>' + esc(o.numero ? 'N° ' + o.numero : 'Pendiente') + '</b> · ' + esc(o.proveedor) +
      (o.estado === 'Para anular' ? '<div class="cx-orden-anular">⚠️ ' + esc(o.motivo || 'Se anuló la compra: anulá la orden en Albor.') + '</div>' : '') +
      '<div class="ad-acciones">' + (o.pdfProveedor ? '<button type="button" class="btn2" data-ver="' + esc(o.pdfProveedor) + '">Orden de compra</button>' : '') +
      (o.pdf ? '<button type="button" class="link-gris" data-ver="' + esc(o.pdf) + '">Orden de compra de Albor</button>' : '') + '</div></div>';
  }).join('') + '</div>';
}

function htmlProductosCt(l) {
  return '<ul class="cx-prods">' + l.map(function (x) {
    return '<li><b>' + esc(x.cantidad) + ' × ' + esc(x.nombre) + '</b>' + (x.especificacion ? ' <small>(' + esc(x.especificacion) + ')</small>' : '') +
      (x.comprado ? ' <span class="tag">Comprado</span>' : '') + '</li>';
  }).join('') + '</ul>';
}

function pintarTarjetaContable() {
  const r = CT.tarjeta;
  if (!r) return;
  let h = '';
  if (r.pedido) {
    $('b-titulo').textContent = 'Pedido';
    h += '<h2 class="cx-titulo">' + esc(r.pedido.titulo || r.pedido.ref) + '</h2>' + (r.pedido.prueba ? '<p class="nota">🧪 ' + esc(r.pedido.prueba) + '</p>' : '') +
      htmlPedidoCt(r.pedido, false) +
      '<div class="caja"><h3>Productos</h3>' + htmlProductosCt(r.productos) + '</div>' + htmlOrdenesCt(r.ordenes) +
      '<div class="caja"><h3>Presupuestos</h3>' + htmlPresupuestosCt(r.presupuestos) + '</div>';
  } else {
    const t = r.tarjeta, c = r.compra;
    $('b-titulo').textContent = 'Compra';
    h += '<h2 class="cx-titulo">' + esc(t.titulo) + '</h2>' + (t.prueba ? '<p class="nota">🧪 Compra de un pedido de prueba</p>' : '') +
      (r.orden && r.orden.numero
        ? '<div class="caja cx-oc"><h3>📄 Orden de compra N° ' + esc(r.orden.numero) + '</h3>' +
          // Feli (30/10): "Orden de compra" (la del proveedor) y a su derecha, sin globito, en gris y más chica, la de Albor
          '<div class="ad-acciones">' + (r.orden.pdfProveedor ? '<button type="button" class="btn2" data-ver="' + esc(r.orden.pdfProveedor) + '">Orden de compra</button>' : '') +
          (r.orden.pdf ? '<button type="button" class="link-gris" data-ver="' + esc(r.orden.pdf) + '">Orden de compra de Albor</button>' : '') + '</div></div>'
        : t.sinOrden ? '<div class="caja cx-sinorden"><b>Este pedido no tiene orden de compra</b>' + (t.motivo ? '<small>' + esc(t.motivo) + '</small>' : '') + '</div>' : '') +
      '<div class="caja"><h3>Compra</h3>' + (t.entero ? '<p class="nota">Este pedido pasó entero a Entregas, sin una compra hecha en la app: no tiene proveedor ni precios.</p>' : '') +
        '<dl class="ad-datos">' + (t.entero ? '' : '<dt>Proveedor</dt><dd>' + esc(t.proveedor || '—') + '</dd><dt>CUIT</dt><dd>' + esc(t.cuit || 'No está cargado') + '</dd>') +
        (t.total !== null ? '<dt>Total</dt><dd><b>' + esc(dinero(t.total, t.moneda)) + '</b></dd>' : '') +
        (c && c.quien ? '<dt>Compró</dt><dd>' + esc(c.quien) + (c.fecha ? ' · ' + esc(fechaCorta(c.fecha)) : '') + '</dd>' : '') +
        (c && c.condiciones && c.condiciones.pago ? '<dt>Forma de pago</dt><dd>' + esc(c.condiciones.pago) + '</dd>' : '') +
        '<dt>Recepción</dt><dd>' + esc(t.recibido ? 'Recibido' + (t.retiro ? ' · retiró ' + t.retiro + (t.fechaRetiro ? ', ' + fechaCorta(t.fechaRetiro) : '') : ' · ' + t.columna) : 'Todavía no llegó (' + t.columna + ')') + '</dd></dl>' +
        (c && c.archivo ? '<button type="button" class="btn2" data-ver="' + esc(c.archivo) + '">📄 Ver el presupuesto</button>' : '') +
        (c && c.productos && c.productos.length ? '<table class="cx-tabla"><thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead><tbody>' +
          c.productos.map(function (x) { return '<tr><td>' + esc(x.nombre) + '</td><td>' + esc(x.cantidad) + '</td><td>' + esc(x.total === null ? '' : dinero(x.total, c.moneda)) + '</td></tr>'; }).join('') +
          '</tbody></table>' : htmlProductosCt(r.productos)) +
      '</div>' +
      // La factura (PDF): desde Comprado o Recibido; con ella la tarjeta pasa a Factura cargada
      '<div class="caja"><h3>Factura</h3>' + htmlFacturaCt(t, r.lectura) +
      // Feli (30/10): cargarla en Albor; en Comprado, "anticipadamente". Por ahora abre Albor en un comprobante de compra nuevo
      // (la carga sola llega con la Fase 6-bis)
      '<div class="ad-acciones"><button type="button" class="btn2" id="cx-fac-albor">' +
        (t.recibido ? 'Cargar la factura en Albor' : 'Cargar la factura en Albor anticipadamente') + '</button></div></div>' +
      '<h3 class="cx-sub">' + (r.pedidos.length === 1 ? 'Pedido' : 'Pedidos') + '</h3>' + r.pedidos.map(function (p) { return htmlPedidoCt(p, true); }).join('') +
      htmlOrdenesCt(r.ordenes) +
      '<div class="caja"><h3>Presupuestos</h3>' + htmlPresupuestosCt(r.presupuestos) + '</div>';
  }
  $('cx-cuerpo').innerHTML = h;
  $('cx-cuerpo').querySelectorAll('[data-ver]').forEach(function (b) { b.addEventListener('click', function () { verArchivo(b.dataset.ver); }); });
  $('cx-cuerpo').querySelectorAll('[data-cambiar]').forEach(function (b) { b.addEventListener('click', function () { cambiarCuentaUI(b.dataset.cambiar); }); });
  ['cx-fac-cargar', 'cx-fac-otra'].forEach(function (id) { if ($(id)) $(id).addEventListener('click', function () { $('cx-factura').click(); }); });
  if ($('cx-fac-sacar')) $('cx-fac-sacar').addEventListener('click', sacarFactura);
  if ($('cx-fac-leer')) $('cx-fac-leer').addEventListener('click', function () { leerFacturaUI(r.tarjeta.id); });
  if ($('cx-fac-corregir')) $('cx-fac-corregir').addEventListener('click', corregirFacturaUI);
  if ($('cx-fac-albor')) $('cx-fac-albor').addEventListener('click', function () {
    window.open('https://laquimerasa.alboragro.com/1/Comprobantes_Compra/Create', '_blank', 'noopener');
  });
}

/* ---------- Fase 6-bis, Paso 1 (Feli, 30/10): la factura leída por la IA ----------
   La IA la copia; el servidor hace las cuentas y la compara con la compra. Acá se ve lo leído, lo que no
   cierra o no coincide (⛔ no coincide con esta compra / ⚠️ para revisar) y se corrige a mano. */
function htmlFacturaCt(t, l) {
  if (!t.factura) return '<p class="nota">Adjuntá el PDF de la factura: la IA la lee y la compara con la compra, y la tarjeta pasa a "Factura cargada".</p>' +
    '<button type="button" class="btn" id="cx-fac-cargar">🧾 Adjuntar factura</button>';
  const f = l && l.datos, c = l && l.comparacion, m = f ? f.moneda : 'ARS';
  const li = function (x) { return '<li>' + esc(x) + '</li>'; };
  let h = '<p>🧾 <b>' + esc(f && f.numero ? 'Factura ' + (f.letra ? f.letra + ' ' : '') + 'N° ' + f.numero : t.factura.nombre) + '</b>' +
          (f && f.numero ? ' <small class="nota">' + esc(t.factura.nombre) + '</small>' : '') + '</p>';
  if (!f) h += '<p class="nota">Todavía no se leyó. «Leer la factura» la lee con la IA y la compara con la compra (tarda unos segundos).</p>';
  else {
    if (c.graves.length) h += '<div class="cx-fac-r grave"><b>⛔ No coincide con esta compra</b><ul>' + c.graves.map(li).join('') + '</ul></div>';
    if (f.problemas.length || c.avisos.length) h += '<div class="cx-fac-r aviso"><b>⚠️ Para revisar</b><ul>' + f.problemas.concat(c.avisos).map(li).join('') + '</ul></div>';
    if (!c.graves.length && !c.avisos.length && !f.problemas.length) h += '<div class="cx-fac-r ok"><b>✅ Las cuentas cierran y coincide con la compra.</b></div>';
    h += '<dl class="ad-datos"><dt>Proveedor</dt><dd>' + esc([f.emisor, f.cuit ? 'CUIT ' + f.cuit : ''].filter(Boolean).join(' · ') || '—') + '</dd>' +
      '<dt>Fecha</dt><dd>' + esc(f.fecha || '—') + (f.vencimiento ? ' · vence ' + esc(f.vencimiento) : '') + '</dd>' +
      (f.cae ? '<dt>CAE</dt><dd>' + esc(f.cae) + (f.vtoCae ? ' · vence ' + esc(f.vtoCae) : '') + '</dd>' : '') +
      (f.ordenCompra ? '<dt>Orden que dice</dt><dd>' + esc(f.ordenCompra) + '</dd>' : '') + '</dl>' +
      '<table class="cx-tabla"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>Importe</th></tr></thead><tbody>' +
      f.renglones.map(function (x) {
        return '<tr' + (x.cierra === false ? ' class="cx-mal"' : '') + '><td>' + (x.cierra === false ? '⚠️ ' : '') + esc(x.texto) + '</td><td>' + esc(x.cant === null ? '' : String(x.cant)) +
          '</td><td>' + esc(dinero(x.precio, m)) + '</td><td>' + esc(x.iva === null || x.iva === undefined ? '' : x.iva + ' %') + '</td><td>' + esc(dinero(x.importe, m)) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<dl class="ad-datos cx-totales">' + (f.neto !== null ? '<dt>Neto gravado</dt><dd>' + esc(dinero(f.neto, m)) + '</dd>' : '<dt>Suma</dt><dd>' + esc(dinero(f.suma, m)) + '</dd>') +
        (f.noGravado ? '<dt>No gravado</dt><dd>' + esc(dinero(f.noGravado, m)) + '</dd>' : '') + (f.exento ? '<dt>Exento</dt><dd>' + esc(dinero(f.exento, m)) + '</dd>' : '') +
        f.iva.map(function (x) { return '<dt>IVA ' + esc(x.tasa === null ? '' : x.tasa + ' %') + '</dt><dd>' + esc(dinero(x.importe, m)) + '</dd>'; }).join('') +
        f.percepciones.map(function (x) { return '<dt>' + esc(x.nombre || 'Percepción') + '</dt><dd>' + esc(dinero(x.importe, m)) + '</dd>'; }).join('') +
        '<dt>Total</dt><dd><b>' + esc(dinero(f.total, m)) + '</b></dd>' +
        // Para controlar el IVA (Feli, 31/10): el que se esperaba según el presupuesto de la compra
        (c.iva ? '<dt>IVA según la compra</dt><dd>' + esc(dinero(c.iva.compra, m)) + ' (' + esc(String(c.iva.tasa).replace('.', ',')) + ' %)</dd>' : '') + '</dl>' +
      '<p class="nota">Leída por la IA el ' + esc(new Date(l.cuando).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })) +
        (l.corregida && l.corregida.length ? ' · corregida a mano por ' + esc(l.corregida[l.corregida.length - 1].quien) : '') + '</p>';
  }
  return h + '<div class="ad-acciones"><button type="button" class="btn2" data-ver="' + esc(t.factura.archivo) + '">Ver la factura</button>' +
    (f ? '<button type="button" class="btn2" id="cx-fac-corregir">✏️ Corregir</button>' : '') +
    '<button type="button" class="btn2" id="cx-fac-leer">' + (f ? '🔁 Leer de nuevo' : '🤖 Leer la factura') + '</button>' +
    '<button type="button" class="btn2" id="cx-fac-otra">Reemplazar</button><button type="button" class="btn2 peligro-btn2" id="cx-fac-sacar">Sacar</button></div>';
}

/** La IA lee la factura (hasta 150 s) y el servidor la compara con la compra. */
async function leerFacturaUI(id) {
  aviso('🤖 Leyendo la factura… (tarda unos segundos)');
  const x = await apiLenta('leerFactura', id);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: probá «Leer la factura» en un rato.' : x.error, 'bad');
  const c = x.lectura && x.lectura.comparacion, f = x.lectura && x.lectura.datos;
  aviso(!x.lectura ? 'La factura cambió mientras se leía: probá de nuevo.' : c.graves.length ? '⛔ Leída: no coincide con esta compra. Mirá el detalle.'
        : c.avisos.length || f.problemas.length ? '⚠️ Leída: hay cosas para revisar.' : '✅ Leída: las cuentas cierran y coincide con la compra.', c && c.graves.length ? 'bad' : '');
  cargarTarjetaContable(); cargarContable();
}

/** ✏️ Corregir lo leído: cabecera, cada renglón y los totales. El servidor rehace las cuentas y la comparación. */
async function corregirFacturaUI() {
  const r = CT.tarjeta, f = r && r.lectura && r.lectura.datos;
  if (!f) return;
  const num = function (n) { return n === null || n === undefined ? '' : String(n).replace('.', ','); };
  const campo = function (id, rotulo, valor, ancho) {
    return '<div class="campo"' + (ancho ? ' style="flex:' + ancho + '"' : '') + '><label for="' + id + '">' + rotulo + '</label><input type="text" id="' + id + '" value="' + esc(valor) + '" autocomplete="off"></div>';
  };
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo cx-corregir';
  cuerpo.innerHTML = '<div class="fila-campos">' + campo('cf-letra', 'Letra', f.letra, 1) + campo('cf-numero', 'Número', f.numero, 3) + campo('cf-fecha', 'Fecha', f.fecha, 2) + '</div>' +
    '<div class="fila-campos">' + campo('cf-emisor', 'Proveedor', f.emisor, 3) + campo('cf-cuit', 'CUIT', f.cuit, 2) + '</div>' +
    '<table class="cx-tabla"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>IVA %</th><th>Importe</th></tr></thead><tbody>' +
    f.renglones.map(function (x) {
      return '<tr data-n="' + x.n + '"><td>' + esc(x.texto) + '</td>' + ['cant', 'precio', 'iva', 'importe'].map(function (k) {
        return '<td><input type="text" inputmode="decimal" data-k="' + k + '" value="' + esc(num(x[k])) + '"></td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table>' +
    '<div class="fila-campos">' + campo('cf-neto', 'Neto gravado', num(f.neto), 2) + campo('cf-total', 'Total', num(f.total), 2) + '</div>' +
    '<div class="fila-campos">' + campo('cf-iva-t', 'IVA %', num((f.iva[0] || {}).tasa), 1) + campo('cf-iva', 'IVA', num((f.iva[0] || {}).importe), 2) + '</div>' +
    (f.iva.length > 1 ? '<p class="nota">Tiene más de una tasa de IVA: acá se corrige la primera.</p>' : '') +
    '<p class="nota">Con coma para los decimales (1234,56). Al guardar, la app rehace las cuentas y la compara de nuevo con la compra.</p>';
  const ok = await dialogo({ titulo: 'Corregir la factura', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', valor: function () {
      const v = function (id) { return $(id).value.trim(); };
      const c = { letra: v('cf-letra'), numero: v('cf-numero'), fecha: v('cf-fecha'), emisor: v('cf-emisor'), cuit: v('cf-cuit'), neto: v('cf-neto'), total: v('cf-total'),
                  renglones: [].map.call(cuerpo.querySelectorAll('tr[data-n]'), function (tr) {
                    const o = { n: Number(tr.dataset.n) };
                    tr.querySelectorAll('input').forEach(function (i) { o[i.dataset.k] = i.value.trim(); });
                    return o;
                  }) };
      const iva = [{ tasa: v('cf-iva-t'), importe: v('cf-iva') }].concat(f.iva.slice(1).map(function (x) { return { tasa: num(x.tasa), importe: num(x.importe) }; }));
      c.iva = iva;
      return c;
    } }, { texto: 'Volver', valor: null }] });
  if (!ok) return;
  aviso('Guardando…');
  const x = await api('corregirFactura', r.tarjeta.id, ok);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: esto se hace con señal. Probá de nuevo en un rato.' : x.error, 'bad');
  aviso('Listo: se corrigió y se volvió a comparar.');
  cargarTarjetaContable(); cargarContable();
}

/** ✏️ Cambiar la cuenta y el centro de costos del pedido entero (el sitio sale del centro). */
async function cambiarCuentaUI(ref) {
  const r = CT.tarjeta;
  const p = r.pedido && r.pedido.ref === ref ? r.pedido : (r.pedidos || []).filter(function (x) { return x.ref === ref; })[0];
  if (!p) return;
  let cuenta = p.cuenta.cuenta || '', centro = p.cuenta.centro || '';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<div class="campo"><label for="cc-cuenta">Cuenta contable</label><select id="cc-cuenta"></select></div>' +
    '<div class="campo"><label for="cc-centro">Centro de costos</label><select id="cc-centro"></select><p class="nota" id="cc-sitio"></p></div>';
  const ok = await dialogo({ titulo: 'Cambiar la cuenta de ' + (p.titulo || p.ref), cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () { return { cuenta: cuenta, centro: centro }; } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const pintar = function () {
        $('cc-cuenta').innerHTML = (cuenta ? '' : '<option value="">Elegí la cuenta</option>') +
          r.cuentas.map(function (c) { return '<option value="' + esc(c.codigo) + '">' + esc(c.nombre) + '</option>'; }).join('');
        $('cc-cuenta').value = cuenta;
        const cs = (r.cuentas.filter(function (c) { return c.codigo === cuenta; })[0] || {}).centros || [];
        if (cs.length === 1) centro = cs[0].centro;
        if (!cs.some(function (x) { return x.centro === centro; })) centro = '';
        $('cc-centro').innerHTML = (centro ? '' : '<option value="">Elegí el centro de costos</option>') +
          cs.map(function (x) { return '<option value="' + esc(x.centro) + '">' + esc(x.centro) + '</option>'; }).join('');
        $('cc-centro').value = centro;
        const cc = cs.filter(function (x) { return x.centro === centro; })[0];
        $('cc-sitio').textContent = cc ? 'El pedido queda en ' + cc.sitio + '.' : '';
        $('dg-ok').disabled = !cuenta || !centro;
      };
      $('cc-cuenta').addEventListener('change', function () { cuenta = this.value; centro = ''; pintar(); });
      $('cc-centro').addEventListener('change', function () { centro = this.value; pintar(); });
      pintar();
    } });
  if (!ok) return;
  aviso('Guardando…');
  const x = await api('cambiarCuentaPedido', ref, ok.cuenta, ok.centro);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: esto se hace con señal. Probá de nuevo en un rato.' : x.error, 'bad');
  aviso('Listo: se cambió la cuenta.');
  cargarTarjetaContable(); cargarContable();
}

/** 🧾 Adjuntar factura: solo PDF, hasta 10 MB. */
$('cx-factura').addEventListener('change', async function (e) {
  const f = e.target.files[0];
  e.target.value = '';
  const r = CT.tarjeta;
  if (!f || !r || !r.tarjeta) return;
  if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) return aviso('La factura tiene que ser un PDF.', 'bad');
  if (f.size > 10 * 1024 * 1024) return aviso('El PDF pesa más de 10 MB.', 'bad');
  // Fase 6-bis (Feli, 30/10): el número ya no se escribe: lo lee la IA, junto con todo lo demás
  aviso('Subiendo la factura…');
  const base64 = await new Promise(function (ok, mal) {
    const fr = new FileReader();
    fr.onload = function () { ok(String(fr.result).replace(/^data:[^,]*,/, '')); };
    fr.onerror = mal;
    fr.readAsDataURL(f);
  });
  const id = r.tarjeta.id;
  const x = await apiLenta('cargarFactura', id, { id: 'J' + nuevoId(), nombre: f.name.replace(/\.pdf$/i, ''), base64: base64 });
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: la factura se sube con señal. Probá de nuevo en un rato.' : x.error, 'bad');
  cargarTarjetaContable(); cargarContable();
  await leerFacturaUI(id);
});

async function sacarFactura() {
  const si = await dialogo({ titulo: '¿Sacar la factura?', texto: 'La compra vuelve a su columna (Comprado o Recibido). El PDF queda en sus adjuntos.',
    botones: [{ texto: 'Sí, sacarla', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (!si) return;
  const x = await api('cargarFactura', CT.tarjeta.tarjeta.id, null);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: probá de nuevo en un rato.' : x.error, 'bad');
  aviso('Listo: se sacó la factura.');
  cargarTarjetaContable(); cargarContable();
}
