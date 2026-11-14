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
const CT = { datos: null, abierta: null, tarjeta: null, cargando: false, verHist: false, historial: null };
const COLUMNAS_CT = [
  { k: 'precompra', t: 'Pre-compra' }, { k: 'comprado', t: 'Comprado' },
  { k: 'recibido', t: 'Recibido' }, { k: 'factura', t: 'Factura cargada' }     // Feli (31/10): recibido y con la factura cargada en Albor
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
function fechaCt(iso) { return iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) : ''; }

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
  const recep = t.recibido ? '✅ Recibido' + (t.retiro ? ' · retiró ' + t.retiro + (t.fechaRetiro ? ', ' + fechaCt(t.fechaRetiro) : '') : ' · ' + t.columna)
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
                    ok: ' <span class="ct-fac-e ok">✅</span>', sinLeer: ' <span class="ct-fac-e">Sin leer</span>' }[t.factura.estado] || '') +
                 (t.factura.albor && t.factura.albor.estado === 'Cargada' ? ' <span class="ct-fac-e ok">en Albor</span>' : '') +
                 (t.factura.impresa ? ' <span class="ct-imp" title="' + esc(textoImpresa(t.factura.impresa)) + '">🖨️</span>' : '') + '</div>' : '') +
    '<div class="ct-recep">' + esc(recep) + '</div></div>';
}

function pintarContable() {
  const d = CT.datos;
  if (!d) { $('ct-cols').innerHTML = ''; return; }
  armarFiltrosContables();
  $('ct-hist-b').setAttribute('aria-pressed', CT.verHist ? 'true' : 'false');
  $('ct-hist-b').textContent = CT.verHist ? '← Volver al tablero' : '📚 Historial';
  if (CT.verHist) {
    // Historial (Feli, 2/11): lo que pasó 7 días en Factura cargada, con los mismos filtros y el buscador
    const l = (CT.historial || []).filter(pasaFiltrosContables);
    $('ct-cols').innerHTML = '<div class="ct-hist-h"><h3>📚 Historial <span class="n">' + l.length + '</span></h3>' +
      '<small class="nota">Las compras que pasaron 7 días en Factura cargada, y las recibidas sin orden de compra que pasaron 7 días en Recibido.</small></div>' +
      (CT.historial === null ? '<p class="nota">Cargando…</p>' :
       '<div class="ct-hist">' + (l.map(function (t) {
         return htmlTarjetaCt(t).replace(/<\/div>$/, '<div class="ct-hist-f">' + (t.enFactura ? 'Factura cargada desde el ' + esc(fechaCt(t.enFactura))
                                                                                 : 'Recibido sin orden de compra desde el ' + esc(fechaCt(t.sinOrdenDesde))) + '</div></div>');
       }).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>');
  } else {
    $('ct-cols').innerHTML = COLUMNAS_CT.map(function (c) {
      const l = (d[c.k] || []).filter(pasaFiltrosContables);
      return '<div class="ct-col"><h3>' + esc(c.t) + ' <span class="n">' + l.length + '</span></h3>' +
        (l.map(htmlTarjetaCt).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>';
    }).join('');
  }
  document.querySelectorAll('#ct-cols [data-id]').forEach(function (el) {
    const abrirla = function () { abrir('ctarjeta', { id: el.dataset.id }); };
    el.addEventListener('click', abrirla);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrirla(); });
  });
}

['ct-q', 'ct-sitio', 'ct-cuenta', 'ct-sinorden'].forEach(function (id) { $(id).addEventListener(id === 'ct-q' ? 'input' : 'change', pintarContable); });
$('ct-refrescar').addEventListener('click', function () {
  cargarContable();
  if (CT.verHist) cargarHistorialContable();
  if (document.body.dataset.pantalla === 'ctarjeta') cargarTarjetaContable();
});
$('ct-hist-b').addEventListener('click', function () {
  CT.verHist = !CT.verHist;
  pintarContable();
  if (CT.verHist) cargarHistorialContable();
});

async function cargarHistorialContable() {
  const r = await api('getHistorialContable');
  if (!r.ok) { notaAd('ct-estado', r.sinConexion ? '📶 Hace falta señal para ver el Historial.' : r.error); if (CT.historial === null) CT.historial = []; pintarContable(); return; }
  CT.historial = r.historial || [];
  notaAd('ct-estado', '');
  pintarContable();
}

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
    '<dt>Razón</dt><dd>' + esc(p.razon || '—') + '</dd><dt>Pedido</dt><dd>' + esc(p.ref) + ' · ' + esc(fechaCt(p.fecha)) + '</dd></dl></div>';
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
        (c && c.quien ? '<dt>Compró</dt><dd>' + esc(c.quien) + (c.fecha ? ' · ' + esc(fechaCt(c.fecha)) : '') + '</dd>' : '') +
        (c && c.condiciones && c.condiciones.pago ? '<dt>Forma de pago</dt><dd>' + esc(c.condiciones.pago) + '</dd>' : '') +
        '<dt>Recepción</dt><dd>' + esc(t.recibido ? 'Recibido' + (t.retiro ? ' · retiró ' + t.retiro + (t.fechaRetiro ? ', ' + fechaCt(t.fechaRetiro) : '') : ' · ' + t.columna) : 'Todavía no llegó (' + t.columna + ')') + '</dd></dl>' +
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
  if ($('cx-fac-amano')) $('cx-fac-amano').addEventListener('click', marcarFacturaEnAlbor);
  if ($('cx-fac-albor')) $('cx-fac-albor').addEventListener('click', function () { cargarFacturaEnAlbor(r); });
}

/* ---------- Fase 6-bis, Paso 1 (Feli, 30/10): la factura leída por la IA ----------
   La IA la copia; el servidor hace las cuentas y la compara con la compra. Acá se ve lo leído, lo que no
   cierra o no coincide (⛔ no coincide con esta compra / ⚠️ para revisar) y se corrige a mano. */
function htmlFacturaCt(t, l) {
  if (!t.factura) return '<p class="nota">Adjuntá el PDF de la factura: la IA la lee y la compara con la compra. Con la compra recibida y la factura cargada en Albor, la tarjeta pasa a "Factura cargada".</p>' +
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
  const al = t.factura.albor;
  if (al) h += '<div class="cx-fac-r ' + (al.estado === 'Cargada' ? 'ok' : al.estado === 'Probada' ? '' : 'aviso') + '"><b>' +
    (al.estado === 'Cargada' ? '✅ Cargada en Albor' + (al.aMano ? ' (a mano)' : '') + (al.referencia ? ': ' + esc(al.referencia) : '')
     : al.estado === 'Probada' ? '🧪 Se probó en Albor (no se guardó)' : '⚠️ No quedó cargada en Albor') + '</b>' +
    (al.motivo && al.estado !== 'Cargada' ? '<div>' + esc(al.motivo) + '</div>' : '') +
    '<small class="nota">' + esc(al.quien || '') + ' · ' + esc(new Date(al.cuando).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</small></div>';
  if (t.factura.impresa) h += '<p class="nota">' + esc(textoImpresa(t.factura.impresa)) + '</p>';      // Fase 7, Paso 1 (Feli, 13/11)
  return h + '<div class="ad-acciones"><button type="button" class="btn2" data-ver="' + esc(t.factura.archivo) + '">Ver la factura</button>' +
    (f ? '<button type="button" class="btn2" id="cx-fac-corregir">✏️ Corregir</button>' : '') +
    // La que se cargó a mano en Albor (sin orden de compra, o si la extensión no pudo): la marca la persona
    (!al || al.estado !== 'Cargada' ? '<button type="button" class="btn2" id="cx-fac-amano">Ya la cargué en Albor</button>' : '') +
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

/**
 * Fase 6-bis, Paso 2 (Feli, 31/10): "Cargar la factura en Albor" con la extensión, en una compra con su orden de compra y una
 * factura leída que no dice "No coincide". Sin eso (o sin la extensión), abre Albor en un comprobante nuevo para cargarla a mano.
 */
async function cargarFacturaEnAlbor(r) {
  const t = r.tarjeta, l = r.lectura, a = function () { window.open('https://laquimerasa.alboragro.com/1/Comprobantes_Compra/Create', '_blank', 'noopener'); };
  const motivo = !t.factura ? 'Primero adjuntá la factura.'
    : !l ? 'Primero dejá que la IA lea la factura («🤖 Leer la factura»).'
    : l.comparacion && l.comparacion.graves.length ? 'La factura no coincide con esta compra: así no se carga en Albor.'
    : t.entero || !t.numeroOrden ? 'Esta compra no tiene orden de compra en Albor: la factura se carga a mano.'
    : !(await hayExtensionAlbor()) ? 'Para cargarla sola hace falta la compu con la extensión de Albor.' : '';
  if (motivo) {
    const ir = await dialogo({ titulo: 'Cargar la factura en Albor', texto: motivo,
      botones: [{ texto: 'Abrir Albor para cargarla a mano', clase: 'btn2', valor: true }, { texto: 'Volver', valor: null }] });
    if (ir) a();
    return;
  }
  const d = await api('datosFacturaAlbor', t.id);
  if (!d.ok) return aviso(d.sinConexion ? '📶 Hace falta señal para cargar la factura.' : d.error, 'bad');
  OC_ALBOR.abrir('Cargando la factura en Albor');
  // Feli (6/11): la factura va adjunta en Albor; si no se puede traer, la extensión avisa que se adjunte a mano
  if (d.factura.archivo) {
    const f = await apiLenta('verArchivo', d.factura.archivo.id);
    if (f.ok) d.factura.archivoDatos = { nombre: d.factura.archivo.nombre || f.nombre, mime: f.mime || 'application/pdf', datos: f.datos };
  }
  const abandono = new Promise(function (ok) {
    OC_ALBOR.abandonar = function () {
      try { window.AlborExt.api.responder_carga('cancelar'); } catch (e) {}
      ok({ ok: false, cancelado: true, abandonada: true, motivo: 'Cancelaste la carga de la factura. En Albor no se guardó nada.' });
    };
  });
  let x;
  try { x = await Promise.race([window.AlborExt.api.cargar_factura(d.factura), abandono]); }
  catch (e) { x = { ok: false, motivo: String(e && e.message || e) }; }
  const reg = x.ok ? '' : registroAlbor();
  OC_ALBOR.cerrar();
  if (!x.cancelado) await api('facturaEnAlbor', t.id, { ok: !!x.ok, prueba: !!x.prueba, referencia: x.referencia || '', motivo: x.motivo || '' });
  if (x.ok) aviso(x.prueba ? '🧪 Listo: se armó en Albor y no se guardó (es una prueba). Cerrá la pestaña de Albor sin guardar.'
                           : '✅ La factura quedó cargada en Albor' + (x.referencia ? ': ' + x.referencia : '') + (x.ya ? ' (ya estaba).' : '.'));
  else {
    const cuerpo = document.createElement('div');
    cuerpo.className = 'cuerpo';
    cuerpo.innerHTML = '<p>' + esc(x.motivo || 'La factura no quedó cargada.') + '</p>' +
      (reg ? '<details><summary>Lo último que pasó (para mandárselo a Claude)</summary><pre class="oc-albor-reg">' + esc(reg) + '</pre></details>' : '');
    await dialogo({ titulo: x.cancelado ? 'Se canceló la carga' : 'La factura no quedó cargada', cuerpo: cuerpo, botones: [{ texto: 'Entendido', clase: 'btn', valor: true }] });
  }
  cargarTarjetaContable(); cargarContable();
}

/** "Ya la cargué en Albor": la persona la cargó a mano; con la compra recibida, pasa a "Factura cargada". */
async function marcarFacturaEnAlbor() {
  const r = CT.tarjeta;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<div class="campo"><label for="cx-fac-ref">Referencia en Albor <small>(opcional)</small></label>' +
    '<input type="text" id="cx-fac-ref" maxlength="40" autocomplete="off" placeholder="Ej: 2026-COM-6150"></div>';
  const ok = await dialogo({ titulo: '¿Ya está cargada en Albor?', texto: 'Marcala si la cargaste a mano en Albor. Con la compra recibida, pasa a "Factura cargada".', cuerpo: cuerpo,
    botones: [{ texto: 'Sí, ya está cargada', clase: 'btn', valor: function () { return { ref: $('cx-fac-ref').value.trim() }; } }, { texto: 'Volver', valor: null }] });
  if (!ok) return;
  const x = await api('facturaEnAlbor', r.tarjeta.id, { ok: true, aMano: true, referencia: ok.ref, motivo: 'Cargada a mano' });
  if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal.' : x.error, 'bad');
  aviso('Listo: quedó marcada como cargada en Albor.');
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
  const si = await dialogo({ titulo: '¿Sacar la factura?', texto: 'Se saca de la compra (y lo que se anotó de Albor). El PDF queda en sus adjuntos.',
    botones: [{ texto: 'Sí, sacarla', clase: 'btn peligro-btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (!si) return;
  const x = await api('cargarFactura', CT.tarjeta.tarjeta.id, null);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: probá de nuevo en un rato.' : x.error, 'bad');
  aviso('Listo: se sacó la factura.');
  cargarTarjetaContable(); cargarContable();
}

/* ============================================================
   FASE 7, PASO 1: 🖨️ IMPRIMIR FACTURAS (Feli, 13/11; entra en la Fase 6-bis)
   Solo en la compu (con mouse). La lista de las facturas adjuntadas (de todas las columnas y del Historial), con filtros;
   "Imprimir" junta en un solo PDF el original de cada una (las hojas que dicen ORIGINAL, hasta la primera que dice
   DUPLICADO; si no dice ninguna, entera y con aviso), le suma arriba una línea con la orden, el sitio, la cuenta y la
   referencia de Albor, abre la ventana de imprimir y pregunta "¿Se imprimieron bien?": recién ahí las marca Impresa.
   ============================================================ */
pantalla('cimprimir', { titulo: 'Imprimir facturas', tab: 'contabilidad', alMostrar: mostrarImprimir });
const CI = { lista: null, fuera: {} };                 // fuera: las que se destildaron a mano (las demás a la vista van)
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

function hayMouse() { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return false; } }
$('ct-imprimir-b').hidden = !hayMouse();               // Feli (13/11): en el celular el botón no está
$('ct-imprimir-b').addEventListener('click', function () { abrir('cimprimir'); });

async function mostrarImprimir() {
  CI.fuera = {};
  pintarImprimir();
  if (!CI.lista) notaAd('ci-nota', 'Cargando…');
  const r = await api('getFacturasImprimir');
  if (!r.ok) { notaAd('ci-nota', r.sinConexion ? '📶 Hace falta señal para ver las facturas.' : r.error); return; }
  CI.lista = r.facturas;
  notaAd('ci-nota', '');
  const sel = $('ci-prov'), v = sel.value;
  sel.innerHTML = '<option value="">Todos los proveedores</option>' +
    unicosTexto(CI.lista.map(function (f) { return f.proveedor || 'Sin proveedor'; })).map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
  sel.value = v;
  pintarImprimir();
}

function unicosTexto(l) { const out = []; l.forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); }); return out; }
function fechaDia(aaaammdd) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(aaaammdd || ''); return m ? Number(m[3]) + '/' + Number(m[2]) + '/' + m[1] : ''; }

function facturasALaVista() {
  const imp = $('ci-imp').value, desde = $('ci-desde').value, hasta = $('ci-hasta').value, prov = $('ci-prov').value, donde = $('ci-donde').value;
  return (CI.lista || []).filter(function (f) {
    if (imp === 'no' && f.impresa) return false;
    if (imp === 'si' && !f.impresa) return false;
    if (desde && (!f.fecha || f.fecha < desde)) return false;
    if (hasta && (!f.fecha || f.fecha > hasta)) return false;
    if (prov && (f.proveedor || 'Sin proveedor') !== prov) return false;
    return !donde || f.donde === donde;
  });
}

function textoImpresa(i) {
  return i ? '🖨️ Impresa el ' + new Date(i.cuando).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) + ' por ' + i.quien + (i.veces > 1 ? ' (' + i.veces + ' veces)' : '') : '';
}

function pintarImprimir() {
  const l = facturasALaVista(), elegidas = l.filter(function (f) { return !CI.fuera[f.id]; });
  $('ci-todas').checked = l.length > 0 && elegidas.length === l.length;
  $('ci-cuantas').textContent = CI.lista ? elegidas.length + ' de ' + l.length + ' elegidas' : '';
  $('ci-imprimir').textContent = '🖨️ Imprimir' + (elegidas.length ? ' (' + elegidas.length + ')' : '');
  $('ci-imprimir').disabled = !elegidas.length;
  $('ci-lista').innerHTML = !CI.lista ? '' : l.map(function (f) {
    return '<div class="ci-fila"><label><input type="checkbox" data-ci="' + esc(f.id) + '"' + (CI.fuera[f.id] ? '' : ' checked') + '>' +
      '<span><span class="ci-t">' + (f.prueba ? '🧪 ' : '') + '<b>' + esc(f.proveedor || 'Sin proveedor') + '</b> · ' + esc(f.numero ? 'Factura ' + f.numero : f.nombre) +
        (f.fecha ? ' · ' + esc(fechaDia(f.fecha)) : '') + ' · ' + esc(f.orden ? 'OC ' + f.orden : 'Sin orden de compra') + '</span>' +
      '<span class="ci-s">' + esc([f.sitio, f.cuenta, f.donde, f.albor ? 'Albor: ' + f.albor : '', textoImpresa(f.impresa)].filter(Boolean).join(' · ')) + '</span></span></label>' +
      '<button type="button" class="btn2" data-ci-ver="' + esc(f.archivo) + '">Ver</button></div>';
  }).join('') || '<p class="nota">No hay facturas con estos filtros.</p>';
  $('ci-lista').querySelectorAll('[data-ci]').forEach(function (c) {
    c.addEventListener('change', function () { if (c.checked) delete CI.fuera[c.dataset.ci]; else CI.fuera[c.dataset.ci] = 1; pintarImprimir(); });
  });
  $('ci-lista').querySelectorAll('[data-ci-ver]').forEach(function (b) { b.addEventListener('click', function () { verArchivo(b.dataset.ciVer); }); });
}

['ci-imp', 'ci-desde', 'ci-hasta', 'ci-prov', 'ci-donde'].forEach(function (id) { $(id).addEventListener('change', pintarImprimir); });
$('ci-todas').addEventListener('change', function () {
  const marcar = $('ci-todas').checked;
  facturasALaVista().forEach(function (f) { if (marcar) delete CI.fuera[f.id]; else CI.fuera[f.id] = 1; });
  pintarImprimir();
});
$('ci-imprimir').addEventListener('click', imprimirFacturas);

function cargarPdfLib() {
  if (window.PDFLib) return Promise.resolve();
  return new Promise(function (listo, mal) {
    const sc = document.createElement('script');
    sc.src = PDF_LIB;
    sc.onload = function () { listo(); };
    sc.onerror = function () { mal(new Error('Hace falta señal para armar el PDF.')); };
    document.head.appendChild(sc);
  });
}

/** Los bytes de la factura: del depósito de archivos (rápido); si no se puede, por el servidor, como el visor. */
async function bajarFactura(f) {
  if (VISOR.cache[f.archivo]) return VISOR.cache[f.archivo].bytes;
  try {
    const r = await fetch(urlMiniatura(f.archivo));
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  } catch (e) { /* sigue por el servidor */ }
  const x = await apiLenta('verArchivo', f.archivo);
  if (!x.ok) throw new Error(x.error || 'No se pudo abrir');
  const bin = atob(x.datos), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Las hojas del original: desde la primera que dice ORIGINAL hasta antes de la primera que dice DUPLICADO (null: no dice). */
function hojasDelOriginal(textos) {
  const dup = textos.map(function (t) { return /DUPLICADO|TRIPLICADO|CUADRUPLICADO/.test(t); });
  const ini = textos.findIndex(function (t, i) { return /ORIGINAL/.test(t) && !dup[i]; });
  if (ini === -1) return null;
  const out = [];
  for (let i = ini; i < textos.length && !dup[i]; i++) out.push(i);
  return out;
}

async function textosDeHojas(bytes) {
  const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise, out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(tc.items.map(function (x) { return x.str; }).join(' ').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  }
  return out;
}

/** La línea de arriba (Feli, 6/11): orden, sitio, cuenta y referencia de Albor. La letra del PDF solo tiene los caracteres de Windows. */
function lineaDeFactura(f) {
  return [f.orden ? 'OC ' + f.orden : 'Sin orden de compra', f.sitio, f.cuenta, f.albor ? 'Albor: ' + f.albor : '']
    .filter(Boolean).join('  ·  ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

/** Agrega una franja arriba de la hoja (sin tapar nada de la factura) con la línea. Una hoja girada queda sin línea. */
function ponerLinea(pag, fuente, texto) {
  if (pag.getRotation().angle % 360 !== 0) return;
  const cb = pag.getCropBox(), mb = pag.getMediaBox(), alto = 16;
  pag.setMediaBox(mb.x, mb.y, mb.width, Math.max(mb.y + mb.height, cb.y + cb.height + alto) - mb.y);
  pag.setCropBox(cb.x, cb.y, cb.width, cb.height + alto);
  let tam = 7.5;
  while (tam > 5 && fuente.widthOfTextAtSize(texto, tam) > cb.width - 28) tam -= 0.5;
  while (texto.length > 10 && fuente.widthOfTextAtSize(texto, tam) > cb.width - 28) texto = texto.slice(0, -2);
  pag.drawText(texto, { x: cb.x + 14, y: cb.y + cb.height + 5, size: tam, font: fuente, color: window.PDFLib.rgb(0, 0, 0) });
}

/** Suma la factura al PDF. Devuelve {entera} si no se pudo saber cuál es el original. */
async function sumarFactura(doc, fuente, f, bytes) {
  const L = window.PDFLib, linea = lineaDeFactura(f);
  const esPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;   // %PDF
  if (!esPdf) {                                      // una foto: una hoja A4 con la foto entera
    const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    if (!png && !jpg) throw new Error('No es un PDF ni una foto');
    const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const pag = doc.addPage([595, 842]), esc2 = Math.min(567 / img.width, 790 / img.height);
    pag.drawImage(img, { x: (595 - img.width * esc2) / 2, y: 20, width: img.width * esc2, height: img.height * esc2 });
    pag.drawText(linea, { x: 14, y: 826, size: 7.5, font: fuente, color: L.rgb(0, 0, 0) });
    return { entera: true };
  }
  let hojas = null;
  try { hojas = hojasDelOriginal(await textosDeHojas(bytes)); } catch (e) { hojas = null; }
  const src = await L.PDFDocument.load(bytes, { ignoreEncryption: true });
  const indices = hojas || src.getPageIndices();
  const copias = await doc.copyPages(src, indices);
  copias.forEach(function (p, i) { doc.addPage(p); if (i === 0) ponerLinea(p, fuente, linea); });
  return { entera: !hojas };
}

/** Abre la ventana de imprimir con el PDF. En Chrome y Edge, directo; en otro navegador, abre el PDF para imprimirlo desde ahí. */
async function mandarAImprimir(blob) {
  const url = URL.createObjectURL(blob);
  if (!window.chrome) {
    await dialogo({ titulo: 'El PDF está listo', texto: 'Abrilo e imprimilo desde ahí.',
                    botones: [{ texto: 'Abrir el PDF', clase: 'btn', valor: function () { window.open(url, '_blank'); return true; } }] });
    return;
  }
  const viejo = $('ci-marco');
  if (viejo) viejo.remove();
  const fr = document.createElement('iframe');
  fr.id = 'ci-marco';
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  await new Promise(function (listo) {
    fr.onload = function () { setTimeout(function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.open(url, '_blank'); } listo(); }, 300); };
    fr.src = url;
    document.body.appendChild(fr);
  });
}

async function imprimirFacturas() {
  const l = facturasALaVista().filter(function (f) { return !CI.fuera[f.id]; });
  if (!l.length) return;
  const b = $('ci-imprimir');
  b.disabled = true;
  try {
    notaAd('ci-nota', 'Preparando…');
    await Promise.all([cargarPdfLib(), cargarPdfJs()]);
    const doc = await window.PDFLib.PDFDocument.create(), fuente = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);
    const enteras = [], fallaron = [];
    for (let i = 0; i < l.length; i++) {
      notaAd('ci-nota', 'Juntando ' + (i + 1) + ' de ' + l.length + '…');
      try { if ((await sumarFactura(doc, fuente, l[i], await bajarFactura(l[i]))).entera) enteras.push(l[i]); }
      catch (e) { fallaron.push(l[i]); }
    }
    notaAd('ci-nota', '');
    const nombre = function (f) { return (f.proveedor || 'Sin proveedor') + ' ' + (f.numero || f.nombre); };
    if (!doc.getPageCount()) return aviso('No se pudo abrir ninguna de las facturas elegidas. Probá de nuevo en un rato.', 'bad');
    await mandarAImprimir(new Blob([await doc.save()], { type: 'application/pdf' }));
    const salieron = l.filter(function (f) { return fallaron.indexOf(f) === -1; });
    const texto = [salieron.length + (salieron.length === 1 ? ' factura' : ' facturas') + ' en el PDF.',
      enteras.length ? '⚠️ Se imprimieron enteras porque no dicen ORIGINAL: ' + enteras.map(nombre).join(', ') + '.' : '',
      fallaron.length ? 'No se pudieron abrir (no se imprimieron): ' + fallaron.map(nombre).join(', ') + '.' : ''].filter(Boolean).join(' ');
    const si = await dialogo({ titulo: '¿Se imprimieron bien?', texto: texto,
                               botones: [{ texto: 'No', valor: false }, { texto: 'Sí, marcarlas', clase: 'btn', valor: true }] });
    if (!si) return;
    const r = await api('marcarFacturasImpresas', salieron.map(function (f) { return f.id; }));
    if (!r.ok) return aviso(r.sinConexion ? '📶 Poca señal: no se pudieron marcar. Probá «Sí, marcarlas» de nuevo en un rato.' : r.error, 'bad');
    (CI.lista || []).forEach(function (f) {
      if (r.impresas.indexOf(f.id) !== -1) f.impresa = { quien: r.quien, cuando: r.cuando, veces: ((f.impresa && f.impresa.veces) || 0) + 1 };
    });
    CI.fuera = {};
    pintarImprimir();
    aviso('🖨️ ' + r.impresas.length + (r.impresas.length === 1 ? ' factura marcada impresa.' : ' facturas marcadas impresas.'));
  } catch (e) {
    notaAd('ci-nota', '');
    aviso(e.message || 'No se pudo armar el PDF.', 'bad');
  } finally {
    b.disabled = false;
    pintarImprimir();
  }
}

/* ============================================================
   FASE 7, PASO 2 (Feli, 14/11): 📥 FACTURAS, LOS MAILS QUE ENTRAN
   ------------------------------------------------------------
   Los mails con adjuntos de la cuenta de las facturas, del más nuevo al
   más viejo, con sus archivos para verlos acá adentro (todavía sin leer:
   eso es el Paso 3). Arriba, cómo está la conexión con Gmail; conectar,
   la muestra, "en serio" y "Traer ahora" solo los ve Feli (puede).
   ============================================================ */
pantalla('cfacturas', { titulo: 'Facturas', tab: 'cfacturas', alMostrar: mostrarMails });
const MF = { datos: null, cargando: false, textos: {}, abiertos: {}, detalle: {} };

async function mostrarMails() {
  pintarMails();
  await cargarMails();
}

async function cargarMails() {
  if (MF.cargando) return;
  MF.cargando = true;
  if (!MF.datos) notaAd('mf-nota', 'Cargando…');
  const r = await api('getMailsFacturas', { desde: $('mf-desde').value, hasta: $('mf-hasta').value });
  MF.cargando = false;
  if (!r.ok) { notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal para ver los mails.' : r.error); return; }
  MF.datos = r;
  notaAd('mf-nota', '');
  pintarMails();
}

function lunesDeEstaSemana() {
  const d = new Date(), dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tamanoArchivo(b) { return !b ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB'; }
function horaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function htmlEstadoGmail(g, puede) {
  if (!g) return '';
  let h = '';
  if (!g.conectado) {
    h = '<p><b>📧 El Gmail de las facturas todavía no está conectado.</b></p>';
    if (puede) h += g.clavesGoogle ? '<p class="nota">Tocá el botón, entrá con la cuenta de las facturas y tocá «Permitir». Google va a decir que la app no está verificada: tocá «Configuración avanzada» → «Ir a App de compras».</p>' +
                                     '<div class="mf-botones"><button type="button" class="btn" data-mf="conectar">🔗 Conectar el Gmail</button></div>'
                                   : '<p class="nota">Faltan las claves de Google Cloud en Supabase.</p>';
    return h;
  }
  h = '<p><b>📧 Conectado: ' + esc(g.cuenta) + '</b>' + (g.conecto ? ' <span class="nota">(lo conectó ' + esc(g.conecto) + ' el ' + esc(fechaCt(g.conectoCuando)) + ')</span>' : '') + '</p>';
  if (g.sinPermiso) h += '<p class="mf-mal">⚠️ Google sacó el permiso (pasa si cambia la contraseña de la cuenta). Los mails nuevos no entran hasta conectarlo de nuevo.</p>';
  const desde = fechaDia(g.desde);
  h += '<p>' + (g.modo === 'real' ? '✅ <b>En serio</b> desde el ' + esc(desde) + ': cada 10 minutos entran los mails nuevos y quedan en Gmail con la etiqueta «App: leída».'
              : g.modo === 'muestra' ? '🔎 <b>Muestra</b> desde el ' + esc(desde) + ': trae los mails con adjuntos sin tocar nada en Gmail.'
              : '⏸️ <b>Apagado</b>: no entra ningún mail.') + '</p>';
  const u = g.ultima;
  if (u) h += '<p class="nota">Última vuelta: ' + esc(horaCorta(u.cuando)) + (u.error ? ' · ⚠️ ' + esc(u.error)
            : ' · ' + (u.nuevos || 0) + ' nuevo' + (u.nuevos === 1 ? '' : 's') + (u.quedan ? ' · quedan ' + u.quedan + ' para la próxima' : '') + (u.errores ? ' · ' + u.errores + ' con error' : '')) + '</p>';
  if (!puede) return h;
  h += '<div class="mf-botones">';
  if (!g.modo) h += '<label class="ci-fecha">Desde <input type="date" id="mf-muestra-desde" value="' + lunesDeEstaSemana() + '"></label>' +
                    '<button type="button" class="btn" data-mf="muestra">🔎 Traer la muestra</button>';
  else h += '<button type="button" class="btn" data-mf="traer">⬇️ Traer ahora</button>';
  if (g.modo === 'muestra') h += '<button type="button" class="btn2" data-mf="real">✅ Prender en serio</button>';
  if (g.modo) h += '<button type="button" class="btn2" data-mf="apagar">⏸️ Apagar</button>';
  h += '<button type="button" class="link-gris" data-mf="conectar">Conectar de nuevo</button></div>';
  return h;
}

function mailsALaVista() {
  const q = $('mf-q').value.trim().toLowerCase(), ver = $('mf-ver').value;
  return ((MF.datos && MF.datos.mails) || []).filter(function (m) {
    const as = m.adjuntos;
    if (ver === 'revisar' && !as.some(function (a) { return a.papel && !a.revision && !/^(Otro archivo|Imagen del mail)$/.test(a.papel); })) return false;
    if (ver === 'facturas' && !as.some(function (a) { return a.factura; })) return false;
    if (ver === 'avisos' && !as.some(function (a) { return a.error || (a.avisos && a.avisos.length); })) return false;
    if (ver === 'noes' && (!as.length || as.some(function (a) { return a.factura || !a.papel; }))) return false;
    if (ver === 'sinleer' && !as.some(function (a) { return !a.papel; })) return false;
    if (!q) return true;
    if (as.some(function (a) { return a.factura && ((a.factura.numero + ' ' + a.factura.cuit + ' ' + a.factura.emisor + ' ' + (a.ordenCompra || '')).toLowerCase().indexOf(q) !== -1); })) return true;
    return (m.de + ' ' + m.asunto + ' ' + m.adjuntos.map(function (a) { return a.nombre; }).join(' ')).toLowerCase().indexOf(q) !== -1;
  });
}

function htmlMail(m) {
  const adj = m.adjuntos.map(function (a) {
    const ic = /pdf/.test(a.tipo) ? '📄' : /^image\//.test(a.tipo) ? '🖼️' : /zip|compressed/.test(a.tipo) ? '🗜️' : '📎';
    const extra = a.estado ? ' · ⚠️ ' + (a.estado === 'Muy grande' ? 'muy grande, no se guardó' : a.estado.toLowerCase()) : a.repetido ? ' · repetido' : '';
    const chip = a.archivo ? '<button type="button" class="mf-adj" data-ver="' + esc(a.archivo) + '">' + ic + ' ' + esc(a.nombre) + ' <small>' + esc(tamanoArchivo(a.bytes) + extra) + '</small></button>'
                           : '<span class="mf-adj mf-sin">' + ic + ' ' + esc(a.nombre) + ' <small>' + esc(tamanoArchivo(a.bytes) + extra) + '</small></span>';
    const lec = htmlLecturaAdj(a);
    return lec ? '<div class="mf-adjl">' + chip + lec + '</div>' : chip;
  }).join('');
  const abierto = MF.abiertos[m.id], texto = MF.textos[m.id];
  return '<div class="mf-mail" data-id="' + esc(m.id) + '">' +
    '<div class="mf-cab"><span class="mf-de">' + esc(m.de.replace(/\s*<[^>]*>\s*$/, '') || m.de) + '</span><span class="mf-fecha">' + esc(horaCorta(m.fecha)) + '</span></div>' +
    '<div class="mf-asunto">' + esc(m.asunto || '(sin asunto)') + (m.muestra ? ' <span class="mf-marca">muestra</span>' : '') + '</div>' +
    (m.resumen ? '<div class="mf-resumen">' + esc(m.resumen.split('\n').filter(String)[0] || '') + '</div>' : '') +
    (m.noSePudo ? '<p class="mf-mal">⚠️ Este mail no se pudo traer (era muy pesado para el servidor): abrilo en Gmail.</p>' : '') +
    '<div class="mf-adjs">' + (adj || (m.noSePudo ? '' : '<span class="nota">Sin adjuntos guardados</span>')) +
    (m.fotitos ? '<span class="nota">+ ' + m.fotitos + ' imagen' + (m.fotitos === 1 ? '' : 'es') + ' chica' + (m.fotitos === 1 ? '' : 's') + ' (logos o firmas)</span>' : '') + '</div>' +
    (m.texto ? '<button type="button" class="link-gris" data-texto="' + esc(m.id) + '">' + (abierto ? 'Esconder el mail' : 'Ver el mail') + '</button>' : '') +
    (abierto ? '<pre class="mf-texto">' + esc(texto === undefined ? 'Abriendo…' : texto) + '</pre>' : '') +
    '</div>';
}

function pintarMails() {
  const d = MF.datos;
  $('mf-gmail').innerHTML = d ? htmlEstadoGmail(d.gmail, d.puede) + (d.puede && d.gmail.conectado ? htmlBancoMails(d.banco) : '') : '';
  $('mf-gmail').hidden = !d;
  const l = mailsALaVista();
  $('mf-lista').innerHTML = !d ? '' : !l.length ? '<p class="nota">' + (d.mails.length ? 'Ningún mail coincide con la búsqueda.' : 'Todavía no entró ningún mail.') + '</p>'
    : '<p class="nota">' + l.length + ' mail' + (l.length === 1 ? '' : 's') + (d.total > d.mails.length ? ' (los ' + d.mails.length + ' más nuevos de ' + d.total + ')' : '') + '</p>' + l.map(htmlMail).join('');
}

/* ---------- Paso 3 (Feli, 14/11): la lectura de cada adjunto, la prueba y la revisión de Feli ---------- */
const ICONO_PAPEL = { 'Factura': '🧾', 'Nota de crédito': '↩️', 'Nota de débito': '➕', 'Remito': '📦', 'Recibo': '💵', 'Orden de pago': '💸',
                      'Resumen de cuenta': '📋', 'Presupuesto': '📝', 'Otro papel': '📄', 'Otro archivo': '🗂️', 'Imagen del mail': '🖼️' };

function htmlLecturaAdj(a) {
  if (a.leyendo) return '<div class="mf-lec nota">🤖 Leyendo…</div>';
  if (!a.papel) return a.error ? '<div class="mf-lec mf-mal">⚠️ No se pudo leer: ' + esc(a.error) + '</div>' : '';
  const sinIA = /^(Otro archivo|Imagen del mail)$/.test(a.papel), f = a.factura;
  let h = '<div class="mf-lec' + (f ? '' : ' mf-noes') + '"><b>' + (ICONO_PAPEL[a.papel] || '📄') + ' ' + esc(a.papel) + '</b>';
  if (f) {
    h += ' ' + esc((f.letra ? f.letra + ' ' : '') + (f.numero || 'sin número')) + ' · ' + esc(f.emisor || 'sin proveedor') + (f.cuit ? ' · ' + esc(f.cuit) : '') +
         (f.fecha ? ' · ' + esc(f.fecha) : '') + (f.total !== null && f.total !== undefined ? ' · <b>' + esc(dinero(f.total, f.moneda)) + '</b>' : '');
    if (a.ordenCompra) h += ' · OC ' + esc(a.ordenCompra);
    if (a.original && a.paginas > 1) h += '<br><span class="nota">Original: página' + (a.original.paginas.length > 1 ? 's ' : ' ') + esc(a.original.paginas.join(', ')) + ' de ' + a.paginas + '</span>';
    if (f.detalle) h += '<br><button type="button" class="link-gris" data-det="' + esc(a.id) + '">' + (MF.detalle[a.id] ? 'Esconder el detalle' : 'Ver el detalle (' + f.renglones + ' renglón' + (f.renglones === 1 ? '' : 'es') + ', IVA y percepciones)') + '</button>';
    if (f.detalle && MF.detalle[a.id]) h += htmlDetalleFacturaMail(f);
  } else if (!sinIA) h += ' <span class="nota">· no es factura</span>';
  if (a.resumenMail) h += '<br><span class="nota">💬 ' + esc(a.resumenMail) + '</span>';
  (a.avisos || []).forEach(function (x) { h += '<br><span class="mf-aviso">⚠️ ' + esc(x) + '</span>'; });
  if (MF.datos && MF.datos.puede && !sinIA) {
    const rv = a.revision;
    h += '<div class="mf-rev">' + (rv ? '<span>' + (rv.ok ? '✅ Bien' : '❌ Mal' + (rv.nota ? ': ' + esc(rv.nota) : '')) + '</span> <button type="button" class="link-gris" data-rev="' + esc(a.id) + '" data-ok="">Cambiar</button>'
         : '<button type="button" class="btn2" data-rev="' + esc(a.id) + '" data-ok="1">✅ Bien</button><button type="button" class="btn2" data-rev="' + esc(a.id) + '" data-ok="0">❌ Mal</button>') + '</div>';
  }
  return h + '</div>';
}

/** Todo lo que leyó de la factura: los renglones, el neto, el IVA de cada tasa, las percepciones y el total. */
function htmlDetalleFacturaMail(f) {
  const d = f.detalle, m = f.moneda;
  const num = function (n) { return n === null || n === undefined ? '' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 4 }); };
  let h = '<div class="mf-det"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio unit.</th><th>Importe</th><th>IVA</th></tr></thead><tbody>' +
    d.renglones.map(function (r) {
      return '<tr><td>' + esc(r.texto || '') + '</td><td>' + esc(num(r.cant) + (r.unidad ? ' ' + r.unidad : '')) + '</td><td>' + esc(dinero(r.precio, m)) + '</td><td>' + esc(dinero(r.importe, m)) + '</td><td>' +
             esc(r.iva === null || r.iva === undefined ? '' : num(r.iva) + ' %') + '</td></tr>';
    }).join('') + '</tbody></table><div class="mf-det-tot">';
  const fila = function (t, v) { return v === null || v === undefined || v === '' ? '' : '<div><span>' + esc(t) + '</span><b>' + esc(v) + '</b></div>'; };
  h += fila('Neto gravado', dinero(f.neto, m));
  d.ivas.forEach(function (x) { h += fila('IVA ' + (x.tasa === null || x.tasa === undefined ? '' : num(x.tasa) + ' %'), dinero(x.importe, m)); });
  d.percepciones.forEach(function (x) { h += fila(x.nombre || 'Percepción', dinero(x.importe, m)); });
  h += fila('Total', dinero(f.total, m));
  h += '</div><p class="nota">' + [d.cae ? 'CAE ' + d.cae : '', d.vencimiento ? 'Vence el ' + d.vencimiento : '', d.cliente ? 'A nombre de ' + d.cliente + (d.cuitCliente ? ' (' + d.cuitCliente + ')' : '') : '',
                                   m && m !== 'ARS' ? 'Moneda ' + m + (d.cotizacion ? ', cotización ' + num(d.cotizacion) : '') : ''].filter(String).map(esc).join(' · ') + '</p></div>';
  return h;
}

function htmlBancoMails(b) {
  if (!b) return '';
  const pc = b.revisados ? Math.round(b.bien / b.revisados * 100) : null;
  return '<div class="mf-banco"><p><b>🧪 Prueba de lectura</b>: leídos ' + b.conIA + ' de ' + b.tope + ' con la IA' +
    (b.leidos > b.conIA ? ' (y ' + (b.leidos - b.conIA) + ' sin la IA)' : '') + ' · revisados ' + b.revisados +
    (b.revisados ? ' (✅ ' + b.bien + ', ❌ ' + b.mal + ': <b>' + pc + ' % bien</b>)' : '') + ' · costó US$ ' + b.costo.toFixed(2).replace('.', ',') + '</p>' +
    '<p class="nota">La meta: 95 de cada 100 bien. ✅ si están bien qué papel es y, en una factura, el CUIT, la letra, el número, la fecha y el total.</p>' +
    '<div class="mf-botones">' + (b.conIA < b.tope ? '<button type="button" class="btn" data-mf="leer">🤖 Leer la muestra</button>' : '') +
    '<button type="button" class="btn2" data-mf="leersolos">' + (b.leer ? '⏸️ Apagar la lectura de los nuevos' : '🤖 Leer solos los mails nuevos') + '</button>' +
    (b.leer ? '<span class="nota">Los mails nuevos se leen solos.</span>' : '') +
    (b.costoTotal > b.costo ? '<span class="nota">Total gastado en lecturas: US$ ' + b.costoTotal.toFixed(2).replace('.', ',') + '</span>' : '') + '</div></div>';
}

/** Lee la muestra de a un archivo (la página repite) hasta el tope de la prueba. */
async function leerMuestraUI() {
  let n = 0, fallas = 0;
  for (let vuelta = 0; vuelta < 120; vuelta++) {
    notaAd('mf-nota', '🤖 Leyendo la muestra… ' + (n ? n + ' leídos' : ''));
    const r = await apiLenta('leerMailsAhora', { muestra: true });
    if (!r.ok) {
      if (!r.sinConexion && ++fallas <= 3) { await new Promise(function (ok) { setTimeout(ok, 4000); }); continue; }
      notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); break;
    }
    fallas = 0;
    n += r.r.leidas;
    if (MF.datos) MF.datos.banco = r.banco;
    if (vuelta % 3 === 2) { MF.cargando = false; await cargarMails(); }
    if (!r.r.quedan || r.banco.conIA >= r.banco.tope) { notaAd('mf-nota', '✅ Listo: ' + n + ' leídos. Ahora revisalos con ✅ / ❌ (filtro «Para revisar»).'); break; }
  }
  const nota = $('mf-nota').textContent;
  MF.cargando = false;
  await cargarMails();
  notaAd('mf-nota', nota);
}

async function revisarLecturaUI(id, ok) {
  let nota = '';
  if (ok === '') {                                 // "Cambiar": se saca la marca
    const r = await api('revisarLecturaMail', id, null, '');
    if (!r.ok) { notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
    ponerRevision(id, null);
    return;
  }
  if (ok === '0') {
    const campo = document.createElement('input');
    campo.type = 'text'; campo.placeholder = 'Qué está mal (por ejemplo: el total, el número)'; campo.maxLength = 300;
    const v = await dialogo({ titulo: '❌ Lectura mal', texto: '¿Qué leyó mal? (opcional)', cuerpo: campo, alAbrir: function () { campo.focus(); },
      botones: [{ texto: 'Guardar', clase: 'btn', valor: function () { return { nota: campo.value.trim() }; } }, { texto: 'Volver', valor: null }] });
    if (!v) return;
    nota = v.nota;
  }
  const r = await api('revisarLecturaMail', id, ok === '1', nota);
  if (!r.ok) { notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
  ponerRevision(id, r.revision);
}

/** Pone la revisión en lo cargado y recalcula el resumen de la prueba sin volver a pedir todo. */
function ponerRevision(id, rv) {
  const b = MF.datos.banco;
  MF.datos.mails.forEach(function (m) {
    m.adjuntos.forEach(function (a) {
      if (a.id !== id) return;
      if (m.muestra && a.revision) { b.revisados--; if (a.revision.ok) b.bien--; else b.mal--; }
      a.revision = rv;
      if (m.muestra && rv) { b.revisados++; if (rv.ok) b.bien++; else b.mal++; }
    });
  });
  pintarMails();
}

async function verTextoMail(id) {
  MF.abiertos[id] = !MF.abiertos[id];
  pintarMails();
  if (!MF.abiertos[id] || MF.textos[id] !== undefined) return;
  const m = MF.datos.mails.filter(function (x) { return x.id === id; })[0];
  const r = await api('verArchivo', m.texto);
  if (!r.ok) { MF.textos[id] = r.sinConexion ? '📶 Hace falta señal para abrirlo.' : r.error; pintarMails(); return; }
  const bin = atob(r.datos), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  MF.textos[id] = new TextDecoder('utf-8').decode(bytes);
  pintarMails();
}

async function accionGmail(que) {
  if (que === 'conectar') {
    notaAd('mf-nota', 'Abriendo Google…');
    const r = await api('gmailConectar');
    if (!r.ok) { notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
    location.href = r.url;
    return;
  }
  if (que === 'traer') return traerMailsUI();
  if (que === 'leer') return leerMuestraUI();
  if (que === 'leersolos') {
    const prender = !(MF.datos.banco && MF.datos.banco.leer);
    if (prender) {
      const si = await dialogo({ titulo: 'Leer solos los mails nuevos', texto: 'Desde ahora, cada archivo de los mails nuevos lo lee la IA apenas entra ' +
        '(cada uno cuesta 1 o 2 centavos de dólar). Conviene prenderlo cuando la prueba dé bien.',
        botones: [{ texto: '🤖 Prender', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
      if (!si) return;
    }
    const r = await api('gmailLeer', prender);
    if (!r.ok) { notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
    MF.datos.banco.leer = r.leer;
    pintarMails();
    return;
  }
  let modo = '', desde = '';
  if (que === 'muestra') {
    modo = 'muestra'; desde = $('mf-muestra-desde') ? $('mf-muestra-desde').value : '';
  } else if (que === 'real') {
    const si = await dialogo({ titulo: 'Prender en serio', texto: 'Desde ahora, cada 10 minutos entran los mails nuevos con adjuntos y cada uno queda en Gmail con la etiqueta «App: leída» ' +
      '(también los de la muestra). En Gmail no cambia nada más: no se borran, no se mueven y no cambia si están leídos.',
      botones: [{ texto: '✅ Prender', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
    if (!si) return;
    modo = 'real';
  } else if (que === 'apagar') {
    const si = await dialogo({ titulo: 'Apagar', texto: 'Los mails dejan de entrar a la app hasta que lo prendas de nuevo. Lo que ya entró queda.',
      botones: [{ texto: '⏸️ Apagar', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
    if (!si) return;
  }
  notaAd('mf-nota', 'Guardando…');
  const r = await api('gmailModo', modo, desde);
  if (!r.ok) { notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
  MF.datos.gmail = r;
  notaAd('mf-nota', '');
  pintarMails();
  if (modo) await traerMailsUI();
}

/** Trae de a tandas hasta que no quede nada (cada tanda, unos pocos mails: Supabase le da poco trabajo a cada pedido). */
async function traerMailsUI() {
  let total = 0, etiquetados = 0, fallas = 0;
  for (let vuelta = 0; vuelta < 80; vuelta++) {
    notaAd('mf-nota', '⬇️ Trayendo los mails… ' + (total ? total + ' nuevos hasta ahora' : ''));
    const r = await apiLenta('traerMailsAhora');
    if (!r.ok) {
      // Si el servidor se cayó con un mail pesado, se reintenta: a la tercera, ese mail queda "No se pudo traer" y se sigue
      if (!r.sinConexion && ++fallas <= 4) { notaAd('mf-nota', '⬇️ Un mail costó más de la cuenta; sigo en unos segundos…'); await new Promise(function (ok) { setTimeout(ok, 5000); }); continue; }
      notaAd('mf-nota', r.sinConexion ? '📶 Hace falta señal.' : r.error); break;
    }
    fallas = 0;
    if (r.r.ocupado) {                          // el reloj está trayendo: se espera un poco y se sigue
      notaAd('mf-nota', '⬇️ El reloj de la app está trayendo mails; sigo en unos segundos…');
      await new Promise(function (ok) { setTimeout(ok, 15000); });
      continue;
    }
    total += r.r.nuevos; etiquetados += r.r.etiquetados;
    if (MF.datos) MF.datos.gmail = r.gmail;
    if (!r.r.quedan) {
      notaAd('mf-nota', '✅ Listo: ' + total + ' mail' + (total === 1 ? '' : 's') + ' nuevo' + (total === 1 ? '' : 's') +
             (etiquetados ? ' · ' + etiquetados + ' quedaron con la etiqueta en Gmail' : '') + (r.r.errores ? ' · ' + r.r.errores + ' con error (se reintentan solos)' : '') + '.');
      break;
    }
  }
  MF.cargando = false;
  const n = $('mf-nota').textContent;
  await cargarMails();
  notaAd('mf-nota', n);
}

$('mf-q').addEventListener('input', pintarMails);
$('mf-ver').addEventListener('change', pintarMails);
['mf-desde', 'mf-hasta'].forEach(function (id) { $(id).addEventListener('change', cargarMails); });
$('mf-refrescar').addEventListener('click', cargarMails);
$('s-cfacturas').addEventListener('click', function (e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mf) accionGmail(b.dataset.mf);
  else if (b.dataset.ver) verArchivo(b.dataset.ver);
  else if (b.dataset.texto) verTextoMail(b.dataset.texto);
  else if (b.dataset.rev) revisarLecturaUI(b.dataset.rev, b.dataset.ok);
  else if (b.dataset.det) { MF.detalle[b.dataset.det] = !MF.detalle[b.dataset.det]; pintarMails(); }
});
