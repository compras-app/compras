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
// Fase 7, Paso 5 (Feli, 16/11): el tablero de Pedidos es de facturas (las compras que ya tienen la suya); Pre-compra se sacó
const COLUMNAS_CT = [
  { k: 'comprado', t: 'Compradas' }, { k: 'recibido', t: 'Recibidas' },
  { k: 'factura', t: 'Finalizado' }      // recibida y con la factura cargada en Albor (Feli, 31/10); a los 7 días, al Historial
];

pantalla('contabilidad', { titulo: 'Pedidos', tab: 'contabilidad', alMostrar: mostrarContable });
pantalla('ctarjeta', { titulo: 'Tarjeta', tab: 'contabilidad', alMostrar: mostrarTarjetaContable });

/** ¿Esta página está en el apartado de Contabilidad? (lo usa pantallas.js) */
function modoContable() {
  const ap = misApartados(APP.yo);
  return ap.indexOf('contabilidad') !== -1 && (/[?&]ap=contabilidad\b/.test(location.search) || ap.length === 1);
}
// Reportes (vacía por ahora: se arma cuando contabilidad diga qué datos quiere) y Ajustes, con las cuentas
// contables y los bienes de uso (Feli, 29/10). En Contabilidad, esas dos pantallas cuelgan de su pestaña Ajustes.
pantalla('creportes', { titulo: 'Reportes', tab: 'creportes' });
pantalla('cajustes', { titulo: 'Ajustes', tab: 'cajustes', alMostrar: function () {
  $('caj-mails').hidden = !(APP.yo && APP.yo.admin && APP.yo.pruebasF6);      // Fase 7 (Feli): el Gmail, la lectura y la impresora, solo Feli
} });
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
  const selP = $('ct-prov'), vp = selP.value, provs = [];
  COLUMNAS_CT.forEach(function (c) { (d[c.k] || []).forEach(function (t) { if (t.proveedor && provs.indexOf(t.proveedor) === -1) provs.push(t.proveedor); }); });
  provs.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  selP.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
  selP.value = vp;
}

/** ¿Tiene algo para mirar? La factura no coincide o hay que revisarla, sin leer, sin orden de compra o con la orden pendiente. */
function conAvisosCt(t) {
  return !!(t.sinOrden || (t.factura && t.factura.estado !== 'ok'));
}

/** ¿Pasa los filtros? t: un pedido (ref) o una compra (id). */
function pasaFiltrosContables(t) {
  const q = sinTildes($('ct-q').value.trim()), sitio = $('ct-sitio').value, cuenta = $('ct-cuenta').value;
  const cuentas = t.trabajo ? t.cuentas : [t.cuenta.texto];
  if ($('ct-sinorden').checked && !(t.trabajo && t.sinOrden)) return false;
  if ($('ct-prov').value && t.proveedor !== $('ct-prov').value) return false;
  if ($('ct-avisos').checked && !conAvisosCt(t)) return false;
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
  const recep = t.recibido ? 'Recibido' + (t.retiro ? ' · retiró ' + t.retiro + (t.fechaRetiro ? ', ' + fechaCt(t.fechaRetiro) : '') : ' · ' + t.columna)
                           : '⏳ ' + t.columna;
  const pendiente = t.motivo === 'Orden de compra pendiente';
  return '<div class="tarjeta ct-t' + (pendiente ? ' ct-pend' : '') + '" data-id="' + esc(t.id) + '" role="button" tabindex="0">' + prueba +
    // Paso 5 (Feli, 29/10): el número de la orden arriba de la tarjeta, chiquito. Fase 7, Paso 5 (Feli, 16/11): sin orden, un aviso
    // tranquilo; con la orden pendiente, el recuadro rojo (y no se carga en Albor)
    (t.numeroOrden ? '<div class="ct-oc">OC ' + esc(t.numeroOrden) + '</div>'
                   : pendiente ? '<div class="ct-orden">⚠️ Orden de compra pendiente</div>'
                   : t.sinOrden ? '<div class="ct-sinoc">Sin orden de compra</div>' : '') +
    '<div class="t">' + esc(t.titulo) + '</div>' +
    // Fase 7, Paso 6A (Feli, 21/11): la cuenta ya no va arriba de la tarjeta (se ve debajo de cada producto, al abrirla)
    // Feli (31/10): un pedido que pasó entero a Entregas (sin comprar en la app) no tiene proveedor: quién lo pidió
    (t.entero ? '<div class="sub-t">' + esc(['Pasó entero a Entregas', t.solicitante].filter(Boolean).join(' · ')) + '</div>'
              : '<div class="sub-t">🏪 ' + esc(t.proveedor || 'Sin proveedor') + (t.cuit ? ' · CUIT ' + esc(t.cuit) : '') + '</div>') +
    '<div class="pie"><span>' + esc([t.solicitante, t.sitios.join(', ')].filter(Boolean).join(' · ')) + '</span>' + (t.total !== null ? '<span><b>' + esc(dinero(t.total, t.moneda)) + '</b></span>' : '') + '</div>' +
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
      '<small class="nota">Las compras que pasaron 7 días en Finalizado.</small></div>' +
      (CT.historial === null ? '<p class="nota">Cargando…</p>' :
       '<div class="ct-hist">' + (l.map(function (t) {
         return htmlTarjetaCt(t).replace(/<\/div>$/, '<div class="ct-hist-f">' + (t.enFactura ? 'Finalizado desde el ' + esc(fechaCt(t.enFactura)) : '') + '</div></div>');
       }).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>');
  } else {
    $('ct-cols').innerHTML = COLUMNAS_CT.map(function (c) {
      const l = (d[c.k] || []).filter(pasaFiltrosContables);
      return '<div class="ct-col"><h3>' + esc(c.t) + ' <span class="n">' + l.length + '</span></h3>' +
        // Feli (16/11): arriba de Recibidas, cargar todas en Albor (menos las de orden pendiente)
        (c.k === 'recibido' && l.length ? '<button type="button" class="btn2 ct-albor-todas" id="ct-albor-todas">🧾 Cargar en Albor</button>' : '') +
        (l.map(htmlTarjetaCt).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>';
    }).join('');
    if ($('ct-albor-todas')) $('ct-albor-todas').addEventListener('click', cargarTodasEnAlbor);
  }
  document.querySelectorAll('#ct-cols [data-id]').forEach(function (el) {
    const abrirla = function () { abrir('ctarjeta', { id: el.dataset.id }); };
    el.addEventListener('click', abrirla);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrirla(); });
  });
}

['ct-q', 'ct-sitio', 'ct-cuenta', 'ct-sinorden', 'ct-prov', 'ct-avisos'].forEach(function (id) { $(id).addEventListener(id === 'ct-q' ? 'input' : 'change', pintarContable); });
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
    (p.cuenta && p.cuenta.tipo === 'bien' ? htmlCuentaCt(p.cuenta.texto) : '') +
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
      (x.comprado ? ' <span class="tag">Comprado</span>' : '') + htmlCuentaProd(x.cuenta) + '</li>';
  }).join('') + '</ul>';
}

/* ---------- Fase 7, Paso 6A (Feli, 21/11): la cuenta contable de cada producto, debajo del producto; "✏️ Editar" las cambia ---------- */
function htmlCuentaProd(c) {
  if (!c) return '';
  return '<div class="cx-cta-prod' + (c.tipo === 'sin' ? ' sin' : '') + '">📒 ' + esc(c.texto) + '</div>';
}
function cuentaDeProductoCt(linea) {
  const p = ((CT.tarjeta && CT.tarjeta.productos) || []).filter(function (x) { return x.id === linea; })[0];
  return p ? p.cuenta : null;
}
function botonEditarCuentas() {
  const ps = ((CT.tarjeta && CT.tarjeta.productos) || []).filter(function (x) { return x.cuenta && x.cuenta.tipo !== 'bien'; });
  return ps.length ? '<button type="button" class="btn-chico" data-editar-cuentas="1">✏️ Editar cuentas</button>' : '';
}

/** La cuenta y el centro de cada producto: "Para todos" arriba y una fila por producto. Se guarda solo lo que cambió. */
async function editarCuentasUI() {
  const r = CT.tarjeta, id = r.tarjeta ? r.tarjeta.id : r.pedido.ref;
  const ps = (r.productos || []).filter(function (x) { return x.cuenta && x.cuenta.tipo !== 'bien'; });
  if (!ps.length) return;
  const sel = {};
  ps.forEach(function (x) { sel[x.id] = { cuenta: x.cuenta.cuenta || '', centro: x.cuenta.centro || '' }; });
  const opcCuenta = function (v) {
    return (v ? '' : '<option value="">Elegí la cuenta</option>') + r.cuentas.map(function (c) { return '<option value="' + esc(c.codigo) + '"' + (c.codigo === v ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('');
  };
  const opcCentro = function (cuenta, v) {
    const cs = (r.cuentas.filter(function (c) { return c.codigo === cuenta; })[0] || {}).centros || [];
    return (v && cs.some(function (x) { return x.centro === v; }) ? '' : '<option value="">Elegí el centro</option>') +
      cs.map(function (x) { return '<option value="' + esc(x.centro) + '"' + (x.centro === v ? ' selected' : '') + '>' + esc(x.centro) + '</option>'; }).join('');
  };
  const c = document.createElement('div');
  c.className = 'cuerpo ec-cuentas';
  const pintar = function () {
    c.innerHTML = (ps.length > 1 ? '<div class="ec-fila ec-todos"><b>Para todos</b><select data-tc="cuenta">' + opcCuenta('') + '</select><select data-tc="centro" disabled><option value="">Elegí el centro</option></select>' +
                   '<button type="button" class="btn2" data-tc-aplicar disabled>Aplicar a todos</button></div>' : '') +
      ps.map(function (x) {
        const v = sel[x.id];
        return '<div class="ec-fila"><b>' + esc(x.cantidad + ' × ' + x.nombre) + '</b><select data-ec="' + esc(x.id) + '" data-k="cuenta">' + opcCuenta(v.cuenta) + '</select>' +
               '<select data-ec="' + esc(x.id) + '" data-k="centro">' + opcCentro(v.cuenta, v.centro) + '</select></div>';
      }).join('');
    c.querySelectorAll('[data-ec]').forEach(function (s) {
      s.addEventListener('change', function () {
        const v = sel[s.dataset.ec];
        if (s.dataset.k === 'cuenta') {
          v.cuenta = s.value; v.centro = '';
          const cs = (r.cuentas.filter(function (cu) { return cu.codigo === v.cuenta; })[0] || {}).centros || [];
          if (cs.length === 1) v.centro = cs[0].centro;
          pintar();
        } else v.centro = s.value;
      });
    });
    const tc = c.querySelector('[data-tc="cuenta"]'), tce = c.querySelector('[data-tc="centro"]'), ta = c.querySelector('[data-tc-aplicar]');
    if (tc) {
      tc.addEventListener('change', function () {
        tce.innerHTML = opcCentro(tc.value, '');
        tce.disabled = !tc.value;
        if (tce.options.length === 1 && tce.options[0].value) tce.value = tce.options[0].value;
        ta.disabled = !tc.value || !tce.value;
      });
      tce.addEventListener('change', function () { ta.disabled = !tc.value || !tce.value; });
      ta.addEventListener('click', function () {
        ps.forEach(function (x) { sel[x.id] = { cuenta: tc.value, centro: tce.value }; });
        pintar();
      });
    }
  };
  pintar();
  const ok = await dialogo({ titulo: 'Las cuentas de los productos', cuerpo: c,
    botones: [{ texto: 'Guardar', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (!ok) return;
  const cambios = ps.filter(function (x) { return sel[x.id].cuenta !== (x.cuenta.cuenta || '') || sel[x.id].centro !== (x.cuenta.centro || ''); })
    .map(function (x) { return { linea: x.id, cuenta: sel[x.id].cuenta, centro: sel[x.id].centro }; });
  if (!cambios.length) return aviso('No cambió nada.');
  const falta = cambios.filter(function (x) { return !x.cuenta || !x.centro; });
  if (falta.length) return aviso('A algún producto le falta la cuenta o el centro de costos.', 'bad');
  aviso('Guardando…');
  const x = await api('cambiarCuentaProductos', id, cambios);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal para cambiar las cuentas.' : x.error, 'bad');
  aviso(x.avisoOrden ? 'Listo. Ojo: la orden de compra ya estaba en Albor con las cuentas de antes; cambiala allá si hace falta.' : 'Listo: se cambiaron las cuentas.');
  cargarTarjetaContable(); cargarContable();
}

function pintarTarjetaContable() {
  const r = CT.tarjeta;
  if (!r) return;
  let h = '';
  if (r.pedido) {
    $('b-titulo').textContent = 'Pedido';
    h += '<h2 class="cx-titulo">' + esc(r.pedido.titulo || r.pedido.ref) + '</h2>' + (r.pedido.prueba ? '<p class="nota">🧪 ' + esc(r.pedido.prueba) + '</p>' : '') +
      htmlPedidoCt(r.pedido, false) +
      '<div class="caja"><h3>Productos ' + botonEditarCuentas() + '</h3>' + htmlProductosCt(r.productos) + '</div>' + htmlOrdenesCt(r.ordenes) +
      '<div class="caja"><h3>Presupuestos</h3>' + htmlPresupuestosCt(r.presupuestos) + '</div>';
  } else {
    // Fase 7, Paso 5 (Feli, 16/11): la compra con su factura. Arriba el proveedor, el CUIT y el número; la orden y si coincide;
    // la cuenta, quién la pidió y la granja; las notas; lo comprado al lado de lo facturado; la factura leída y sus botones.
    // Lo que se pidió (los pedidos, los presupuestos) ya no se muestra: solo lo que se compró.
    const t = r.tarjeta, c = r.compra, f = r.lectura && r.lectura.datos;
    $('b-titulo').textContent = 'Compra';
    const fnum = f && f.numero ? 'Factura ' + (f.letra ? f.letra + ' ' : '') + f.numero : t.factura ? t.factura.numero ? 'Factura ' + t.factura.numero : t.factura.nombre : 'Sin factura';
    h += '<h2 class="cx-titulo">' + esc([t.proveedor || (t.entero ? '' : 'Sin proveedor'), t.cuit ? 'CUIT ' + t.cuit : '', fnum].filter(Boolean).join(' · ')) + '</h2>' +
      '<p class="nota">' + esc(t.titulo) + (t.prueba ? ' · 🧪 compra de un pedido de prueba' : '') + '</p>' +
      htmlOrdenPedidoCt(t, r.orden) +
      '<div class="caja cx-imput">' + r.pedidos.map(function (p) {
        return (p.cuenta && p.cuenta.tipo === 'bien' ? htmlCuentaCt(p.cuenta.texto) : '') + '<p class="nota cx-pidio">Pidió <b>' + esc(p.solicitante || '—') + '</b> · ' + esc(p.sitio || '—') + (r.pedidos.length > 1 ? ' · ' + esc(p.titulo || p.ref) : '') + '</p>';
      }).join('') +
        '<p class="nota">' + esc(t.recibido ? 'Recibido' + (t.retiro ? ' · retiró ' + t.retiro + (t.fechaRetiro ? ', ' + fechaCt(t.fechaRetiro) : '') : '') : '⏳ Todavía no llegó (' + t.columna + ')') +
        (c && c.quien ? ' · compró ' + esc(c.quien) + (c.fecha ? ' el ' + esc(fechaCt(c.fecha)) : '') : '') + '</p></div>' +
      htmlNotasCt(r.comentarios, t.id) +
      (t.entero ? '<div class="caja"><h3>Productos ' + botonEditarCuentas() + '</h3><p class="nota">Este pedido pasó entero a Entregas, sin una compra hecha en la app: no tiene proveedor ni precios.</p>' + htmlProductosCt(r.productos) + '</div>'
                : htmlComparadoCt(r.comparado, r.orden, t)) +
      '<div class="caja"><h3>Factura</h3>' + htmlFacturaCt(t, r.lectura) +
      // Feli (30/10): cargarla en Albor; en Compradas, "anticipadamente". Con la orden pendiente no se puede (Feli, 16/11)
      '<div class="ad-acciones"><button type="button" class="btn2" id="cx-fac-albor">' +
        (t.recibido ? 'Cargar la factura en Albor' : 'Cargar en Albor anticipadamente') + '</button></div></div>';
  }
  $('cx-cuerpo').innerHTML = h;
  $('cx-cuerpo').querySelectorAll('[data-ver]').forEach(function (b) { b.addEventListener('click', function () { verArchivo(b.dataset.ver); }); });
  $('cx-cuerpo').querySelectorAll('[data-cambiar]').forEach(function (b) { b.addEventListener('click', function () { cambiarCuentaUI(b.dataset.cambiar); }); });
  $('cx-cuerpo').querySelectorAll('[data-editar-cuentas]').forEach(function (b) { b.addEventListener('click', editarCuentasUI); });
  $('cx-cuerpo').querySelectorAll('[data-nota]').forEach(function (b) { b.addEventListener('click', function () { agregarNotaUI(b, cargarTarjetaContable); }); });
  ['cx-fac-cargar', 'cx-fac-otra'].forEach(function (id) { if ($(id)) $(id).addEventListener('click', function () { $('cx-factura').click(); }); });
  if ($('cx-fac-sacar')) $('cx-fac-sacar').addEventListener('click', sacarFactura);
  if ($('cx-fac-deshacer')) $('cx-fac-deshacer').addEventListener('click', async function () {      // Fase 7, Paso 4
    const si = await dialogo({ titulo: 'No es de esta compra', texto: 'La factura sale de esta compra y pasa al tablero de Facturas, a Entrantes (y el mail vuelve a Recibidos). No se vuelve a pegar sola.',
                               botones: [{ texto: 'Pasarla a Facturas', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
    if (!si) return;
    const idm = $('cx-fac-deshacer').dataset.mail;
    const x = await api('deshacerFacturaMail', idm);
    if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal.' : x.error, 'bad');
    aviso('Listo: la factura pasó a Facturas.');
    cargarContable();
    abrir('cdoc', { id: idm });
  });
  if ($('cx-fac-leer')) $('cx-fac-leer').addEventListener('click', function () { leerFacturaUI(r.tarjeta.id); });
  if ($('cx-fac-corregir')) $('cx-fac-corregir').addEventListener('click', function () { corregirFacturaUI(); });
  if ($('cx-fac-revisada')) $('cx-fac-revisada').addEventListener('click', async function () {
    const x = await api('revisarFacturaCompra', r.tarjeta.id);
    if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal.' : x.error, 'bad');
    aviso('Listo: quedó revisada.');
    cargarTarjetaContable(); cargarContable();
  });
  if ($('cx-fac-amano')) $('cx-fac-amano').addEventListener('click', marcarFacturaEnAlbor);
  if ($('cx-fac-albor')) $('cx-fac-albor').addEventListener('click', function () { cargarFacturaEnAlbor(r); });
}

/** La orden de compra y si la factura coincide (Feli, 16/11). Pendiente: en rojo y no se carga; sin orden: tranquilo. */
function htmlOrdenPedidoCt(t, o) {
  const est = t.factura ? { ok: '✅ La factura coincide', aviso: '⚠️ La factura tiene cosas para revisar', grave: '⛔ La factura no coincide', sinLeer: 'La factura todavía no se leyó' }[t.factura.estado] : 'Todavía no tiene factura';
  if (o && o.numero) return '<div class="caja cx-oc"><h3>📄 Orden de compra N° ' + esc(o.numero) + '</h3><p class="cx-coincide ' + esc(t.factura ? t.factura.estado : '') + '">' + esc(est) + '</p></div>';
  if (t.motivo === 'Orden de compra pendiente')
    return '<div class="caja cx-sinorden"><b>⚠️ Orden de compra pendiente</b><small>Todavía no tiene su número en Albor: la factura no se puede cargar hasta que esté.</small></div>';
  return '<div class="caja cx-sinoc"><b>Sin orden de compra</b>' + (t.motivo ? '<small>' + esc(t.motivo) + '</small>' : '') + '</div>';
}

/** Lo comprado al lado de lo facturado (leído por la IA), producto por producto, con "Ver orden de compra" y "Ver factura" debajo. */
function htmlComparadoCt(cmp, o, t) {
  const verOC = o && (o.pdfProveedor || o.pdf), verFac = t.factura && t.factura.archivo;
  const pies = '<div class="cx-cmp-pie"><div>' + (verOC ? '<button type="button" class="btn2" data-ver="' + esc(verOC) + '">Ver orden de compra</button>' : '') + '</div>' +
               '<div>' + (verFac ? '<button type="button" class="btn2" data-ver="' + esc(verFac) + '">Ver factura</button>' : '') + '</div></div>';
  if (!cmp) return '<div class="caja"><h3>Comprado y facturado ' + botonEditarCuentas() + '</h3><p class="nota">' + (t.factura ? 'Cuando la IA lea la factura, acá se ve lo comprado al lado de lo facturado.' : 'Todavía no tiene factura.') + '</p>' +
                    htmlProductosCt((CT.tarjeta && CT.tarjeta.productos) || []) + pies + '</div>';
  const num = function (n) { return n === null || n === undefined ? '' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 4 }); };
  const lado = function (x, mon, k) {
    if (!x) return '<span class="nota">—</span>';
    return esc(num(x.cant) + (x.unidad ? ' ' + x.unidad : '')) + (x.precio !== null && x.precio !== undefined ? ' × ' + esc(dinero(x.precio, mon)) : '') +
           (x[k] !== null && x[k] !== undefined ? '<br><b>' + esc(dinero(x[k], mon)) + '</b>' : '');
  };
  return '<div class="caja"><h3>Comprado y facturado ' + botonEditarCuentas() + '</h3><div class="cx-cmp-w"><table class="cx-tabla cx-cmp"><thead><tr><th>Producto</th><th>Comprado</th><th>Facturado</th><th></th></tr></thead><tbody>' +
    cmp.filas.map(function (x) {
      return '<tr' + (x.igual ? '' : ' class="cx-mal"') + '><td>' + esc(x.nombre) + (x.facturado && x.comprado && x.facturado.texto && x.facturado.texto !== x.nombre ? '<br><small class="nota">' + esc(x.facturado.texto) + '</small>' : '') +
             (x.linea ? htmlCuentaProd(cuentaDeProductoCt(x.linea)) : '') +
             '</td><td>' + lado(x.comprado, cmp.moneda, 'total') + '</td><td>' + lado(x.facturado, cmp.monedaFactura, 'importe') + '</td><td>' + (x.igual ? '✅' : '⚠️') + '</td></tr>';
    }).join('') +
    '<tr class="cx-cmp-tot"><td>Total sin IVA</td><td><b>' + esc(dinero(cmp.totalCompra, cmp.moneda)) + '</b></td><td><b>' + esc(dinero(cmp.netoFactura, cmp.monedaFactura)) + '</b>' +
      (cmp.totalFactura !== null && cmp.totalFactura !== undefined ? '<br><small class="nota">con IVA ' + esc(dinero(cmp.totalFactura, cmp.monedaFactura)) + '</small>' : '') + '</td><td></td></tr>' +
    '</tbody></table></div>' + pies + '</div>';
}

/* ---------- Las notas (💬), en las tarjetas de Pedidos, de Facturas y en Documentos (Feli, 16/11) ---------- */
function htmlNotasCt(l, id) {
  return '<div class="caja cx-notas"><h3>💬 Notas</h3>' +
    (l === undefined ? '<p class="nota">Cargando las notas…</p>' : !l.length ? '<p class="nota">Todavía no hay notas.</p>' :
     l.map(function (c) {
       return '<div class="cx-nota"><div class="cx-nota-c"><b>' + esc(c.autor) + '</b><small>' + esc(new Date(c.fecha).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</small></div>' +
              '<div class="cx-nota-t">' + esc(c.texto) + '</div></div>';
     }).join('')) +
    '<div class="cx-nota-nueva"><textarea rows="2" maxlength="2000" placeholder="Escribí una nota (con @Nombre le avisás a esa persona)" data-nota-txt="' + esc(id) + '"></textarea>' +
    '<button type="button" class="btn2" data-nota="' + esc(id) + '">💬 Agregar nota</button></div></div>';
}
async function agregarNotaUI(b, despues) {
  const id = b.dataset.nota, campo = b.parentNode.querySelector('textarea'), texto = campo.value.trim();
  if (!texto) return campo.focus();
  b.disabled = true;
  const x = await api('comentarDocumento', id, texto, 'C' + nuevoId());
  b.disabled = false;
  if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal para guardar la nota.' : x.error, 'bad');
  campo.value = '';
  if (x.avisados && x.avisados.length) aviso('💬 Listo. Le avisamos a ' + x.avisados.join(', ') + '.');
  if (despues) despues();
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
    const todo = c.graves.concat(f.problemas, c.avisos);
    if (!todo.length) h += '<div class="cx-fac-r ok"><b>✅ Las cuentas cierran y coincide con la compra.</b></div>';
    // Feli (18/11): revisada, el cartel dice quién la revisó y sigue mostrando lo que se vio, pero sin el amarillo
    else if (l.revisada) h += '<div class="cx-fac-r revisada"><b>✅ Revisado por ' + esc(l.revisada.quien) + ' el ' + esc(fechaCt(l.revisada.cuando)) + '</b><ul>' + todo.map(li).join('') + '</ul></div>';
    else {
      if (c.graves.length) h += '<div class="cx-fac-r grave"><b>⛔ No coincide con esta compra</b><ul>' + c.graves.map(li).join('') + '</ul></div>';
      if (f.problemas.length || c.avisos.length) h += '<div class="cx-fac-r aviso"><b>⚠️ Para revisar</b><ul>' + f.problemas.concat(c.avisos).map(li).join('') + '</ul></div>';
      h += '<div class="ad-acciones"><button type="button" class="btn" id="cx-fac-revisada">✅ Ya lo revisé: está bien</button></div>';
    }
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
  // Fase 7, Paso 4 (Feli, 14/11): llegó por mail y se adjuntó sola (o la eligió una persona en 📥 Facturas)
  if (t.factura.mail) h += '<p class="cx-fac-mail">' + (t.factura.sola ? '🤖 <b>Adjuntada sola</b> desde el mail' + (t.factura.como === 'orden' ? ' (por el número de orden)' : t.factura.como === 'montos' ? ' (coincide en el total y en cada producto)' : '')
                                                                 : '📥 Adjuntada desde el mail') + '</p>';
  return h + '<div class="ad-acciones"><button type="button" class="btn2" data-ver="' + esc(t.factura.archivo) + '">Ver la factura</button>' +
    (f ? '<button type="button" class="btn2" id="cx-fac-corregir">✏️ Corregir</button>' : '') +
    // La que se cargó a mano en Albor (sin orden de compra, o si la extensión no pudo): la marca la persona
    (!al || al.estado !== 'Cargada' ? '<button type="button" class="btn2" id="cx-fac-amano">Ya la cargué en Albor</button>' : '') +
    '<button type="button" class="btn2" id="cx-fac-leer">' + (f ? '🔁 Leer de nuevo' : '🤖 Leer la factura') + '</button>' +
    '<button type="button" class="btn2" id="cx-fac-otra">Reemplazar</button>' +
    (t.factura.mail ? '<button type="button" class="btn2 peligro-btn2" id="cx-fac-deshacer" data-mail="' + esc(t.factura.mail) + '">No es de esta compra (pasa a Facturas)</button>'
                    : '<button type="button" class="btn2 peligro-btn2" id="cx-fac-sacar">Sacar</button>') + '</div>';
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
async function corregirFacturaUI(fDoc, guardarDoc) {
  // Feli (18/11): la misma ventana para una factura del mail (fDoc: la leída; guardarDoc: cómo se guarda)
  const r = CT.tarjeta, f = fDoc && fDoc.renglones ? fDoc : r && r.lectura && r.lectura.datos;
  if (!f) return;
  f.iva = f.iva || [];
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
  if (guardarDoc) return guardarDoc(ok);
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
  if (t.motivo === 'Orden de compra pendiente') {          // Feli (16/11): con la orden pendiente no se carga
    await dialogo({ titulo: 'Cargar la factura en Albor', texto: 'La orden de compra de esta compra está pendiente (todavía no tiene su número en Albor): la factura se carga cuando la orden esté.',
                    botones: [{ texto: 'Entendido', clase: 'btn', valor: true }] });
    return { ok: false, salteada: true };
  }
  const motivo = !t.factura ? 'Primero adjuntá la factura.'
    : !l ? 'Primero dejá que la IA lea la factura («🤖 Leer la factura»).'
    : l.comparacion && l.comparacion.graves.length && !l.revisada ? 'La factura no coincide con esta compra: revisala y tocá «✅ Ya lo revisé» para cargarla igual.'
    : t.entero || !t.numeroOrden ? 'Esta compra no tiene orden de compra en Albor: la factura se carga a mano.'
    : !(await hayExtensionAlbor()) ? 'Para cargarla sola hace falta la compu con la extensión de Albor.' : '';
  if (motivo) {
    const ir = await dialogo({ titulo: 'Cargar la factura en Albor', texto: motivo,
      botones: [{ texto: 'Abrir Albor para cargarla a mano', clase: 'btn2', valor: true }, { texto: 'Volver', valor: null }] });
    if (ir) a();
    return { ok: false, salteada: true };
  }
  const d = await api('datosFacturaAlbor', t.id);
  if (!d.ok) { aviso(d.sinConexion ? '📶 Hace falta señal para cargar la factura.' : d.error, 'bad'); return { ok: false }; }
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
  return x;
}

/**
 * Fase 7, Paso 5 (Feli, 16/11): "🧾 Cargar en Albor" arriba de Recibidas: todas las de la columna (con los filtros de arriba),
 * una detrás de otra, frenando antes de guardar cada una (como la de a una). Salteadas: la orden pendiente (Feli), las sin orden de
 * compra (se cargan a mano hasta el Paso 6), las que no coinciden o no se leyeron, y las ya cargadas.
 */
async function cargarTodasEnAlbor() {
  const l = (CT.datos && CT.datos.recibido || []).filter(pasaFiltrosContables);
  const cargada = function (t) { return t.factura && t.factura.albor && t.factura.albor.estado === 'Cargada'; };
  const va = l.filter(function (t) { return t.numeroOrden && t.factura && ['ok', 'aviso'].indexOf(t.factura.estado) !== -1 && !cargada(t); });
  const n = function (f) { return l.filter(f).length; };
  const pend = n(function (t) { return t.motivo === 'Orden de compra pendiente'; }), sinOC = n(function (t) { return !t.numeroOrden && t.motivo !== 'Orden de compra pendiente'; });
  const mal = n(function (t) { return t.numeroOrden && t.factura && ['grave', 'sinLeer'].indexOf(t.factura.estado) !== -1; }), ya = n(cargada);
  const salteadas = [pend ? pend + ' con la orden de compra pendiente' : '', sinOC ? sinOC + ' sin orden de compra (por ahora se cargan a mano)' : '',
                     mal ? mal + ' que no coinciden o sin leer (revisalas primero)' : '', ya ? ya + ' ya cargadas' : ''].filter(String);
  if (!va.length) return dialogo({ titulo: 'Cargar en Albor', texto: 'No hay facturas para cargar solas.' + (salteadas.length ? ' Quedan afuera: ' + salteadas.join(', ') + '.' : ''),
                                   botones: [{ texto: 'Entendido', clase: 'btn', valor: true }] });
  if (!(await hayExtensionAlbor())) return aviso('Para cargarlas en Albor hace falta la compu con la extensión de Albor.', 'bad');
  const si = await dialogo({ titulo: '🧾 Cargar en Albor', texto: 'Se cargan ' + va.length + (va.length === 1 ? ' factura' : ' facturas') + ', una detrás de otra. ' +
      'En cada una, la carga frena antes de guardar: controlala en Albor y tocá «Guardar» para seguir con la siguiente.' + (salteadas.length ? ' Quedan afuera: ' + salteadas.join(', ') + '.' : ''),
    botones: [{ texto: 'Empezar', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
  if (!si) return;
  let hechas = 0;
  for (let i = 0; i < va.length; i++) {
    aviso('🧾 Factura ' + (i + 1) + ' de ' + va.length + ': ' + (va[i].proveedor || va[i].titulo));
    const r = await api('getTarjetaContable', va[i].id);
    if (!r.ok) { aviso(r.sinConexion ? '📶 Hace falta señal para seguir.' : r.error, 'bad'); break; }
    CT.abierta = va[i].id; CT.tarjeta = r;
    const x = await cargarFacturaEnAlbor(r);
    if (x && x.ok) hechas++;
    if (x && x.cancelado) break;
    if (x && !x.ok && !x.salteada && i < va.length - 1) {
      const seguir = await dialogo({ titulo: '¿Seguir con la siguiente?', texto: 'Quedan ' + (va.length - i - 1) + '.',
                                     botones: [{ texto: 'Seguir', clase: 'btn', valor: true }, { texto: 'Parar acá', valor: null }] });
      if (!seguir) break;
    }
  }
  aviso('Listo: ' + hechas + (hechas === 1 ? ' factura cargada' : ' facturas cargadas') + ' en Albor.');
  cargarContable();
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
  return i ? '🖨️ Impresa' + (i.sola ? ' sola' : '') + ' el ' + new Date(i.cuando).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) +
              (i.sola ? (i.compu ? ' en ' + i.compu : '') : ' por ' + i.quien) + (i.veces > 1 ? ' (' + i.veces + ' veces)' : '') : '';
}

function pintarImprimir() {
  const l = facturasALaVista(), elegidas = l.filter(function (f) { return !CI.fuera[f.id]; });
  $('ci-todas').checked = l.length > 0 && elegidas.length === l.length;
  $('ci-cuantas').textContent = CI.lista ? elegidas.length + ' de ' + l.length + ' elegidas' : '';
  $('ci-imprimir').textContent = '🖨️ Imprimir' + (elegidas.length ? ' (' + elegidas.length + ')' : '');
  $('ci-imprimir').disabled = !elegidas.length;
  $('ci-lista').innerHTML = !CI.lista ? '' : l.map(function (f) {
    return '<div class="ci-fila"><label><input type="checkbox" data-ci="' + esc(f.id) + '"' + (CI.fuera[f.id] ? '' : ' checked') + '>' +
      '<span><span class="ci-t">' + (f.prueba ? '🧪 ' : '') + '<b>' + esc(f.proveedor || 'Sin proveedor') + '</b> · ' + esc(f.numero ? (f.papel || 'Factura') + ' ' + f.numero : f.nombre) +
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
  // Una factura que llegó por mail y todavía no está en una compra (Fase 7): su proveedor y el día que llegó
  const sinCompra = f.donde === 'Mail' ? (f.proveedor || '') + (f.llego ? '  ·  Llegó por mail el ' + new Date(f.llego).toLocaleDateString('es-AR') : '') : '';
  return [f.papel && f.papel !== 'Factura' ? f.papel.toUpperCase() : '', f.orden ? 'OC ' + f.orden : (sinCompra ? '' : 'Sin orden de compra'), sinCompra, f.sitio, f.cuenta, f.albor ? 'Albor: ' + f.albor : '']
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
  // Fase 7: si el PDF no tiene texto (escaneado), las páginas del original que vio la IA al leerla
  if (!hojas && f.paginas && f.paginas.length && f.paginas.every(function (n) { return n >= 1 && n <= src.getPageCount(); }))
    hojas = f.paginas.map(function (n) { return n - 1; });
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
   FASE 7, PASO 5 (Feli, 16/11): 📄 DOCUMENTOS
   ------------------------------------------------------------
   Todo lo que llegó por mail (y lo subido a mano), un documento por fila, en apartados: Facturas, Remitos, Notas de crédito y
   Otros. Cerrada, la fila dice el mail, el título y la fecha; abierta, el proveedor, el CUIT y el número, lo que leyó la IA, las
   notas (💬), "Ver factura" y "Ver en tablero" a la derecha y "Ver mail" a la izquierda. Arriba, solo si algo no anda (el Gmail,
   la impresora). Lo de conectar el Gmail, la lectura, el pegado y la impresora está en Ajustes → 📥 Mails e impresora (cmails).
   ============================================================ */
pantalla('cfacturas', { titulo: 'Documentos', tab: 'cfacturas', alMostrar: mostrarMails });
pantalla('cmails', { titulo: 'Mails e impresora', tab: 'cajustes', alMostrar: mostrarMails });
const MF = { datos: null, cargando: false, textos: {}, abiertos: {}, docs: {}, verMail: {}, sec: 'facturas', ordenes: null, ordAbiertas: {} };
// Feli (18/11): las notas de débito aparte, a la derecha de las de crédito
const SECCIONES_DOC = [{ k: 'facturas', t: 'Facturas' }, { k: 'remitos', t: 'Remitos' }, { k: 'notas', t: 'Notas de crédito' }, { k: 'notasd', t: 'Notas de débito' }, { k: 'otros', t: 'Otros' }, { k: 'ordenes', t: '🛒 Órdenes de compra' }];   // Feli (20/11)
const NOMBRE_COL_FC = { entrantes: 'Entrantes', controlando: 'Controlando', aprobacion: 'Esperando aprobación', lista: 'Lista para cargar', finalizado: 'Finalizado', historial: 'Historial' };

function notaMF(t) { notaAd('mf-nota', t); notaAd('md-nota', t); }

async function mostrarMails() {
  pintarMails();
  await cargarMails();
}

async function cargarMails() {
  if (MF.cargando) return;
  MF.cargando = true;
  if (!MF.datos) notaMF('Cargando…');
  const r = await api('getMailsFacturas', { desde: $('mf-desde').value, hasta: $('mf-hasta').value });
  MF.cargando = false;
  if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal para ver los documentos.' : r.error); return; }
  MF.datos = r;
  notaMF('');
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
function nombreDe(de) { return String(de || '').replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '') || String(de || ''); }

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

/* ---------- La lista ---------- */
function proveedorDoc(d) { return (d.factura && d.factura.emisor) || nombreDe(d.mail && d.mail.de); }
function cargadaDoc(d) { return !!((d.enCompra && d.enCompra.cargada) || (d.tablero && d.tablero.albor && d.tablero.albor.estado === 'Cargada')); }
function conOcDoc(d) { return !!(d.ordenCompra || (d.enCompra && d.enCompra.orden)); }

function docsALaVista() {
  const q = sinTildes($('mf-q').value.trim()), prov = $('md-prov').value, fac = MF.sec === 'facturas';
  const al = $('md-albor').value, oc = $('md-oc').value, co = $('md-compra').value;
  return ((MF.datos && MF.datos.docs) || []).filter(function (d) {
    if (d.seccion !== MF.sec) return false;
    if (prov && proveedorDoc(d) !== prov) return false;
    if (fac && al && cargadaDoc(d) !== (al === 'si')) return false;
    if (fac && oc && conOcDoc(d) !== (oc === 'si')) return false;
    if (fac && co && !!d.enCompra !== (co === 'si')) return false;
    if (!q) return true;
    const f = d.factura || {};
    return sinTildes([f.numero, f.cuit, (f.cuit || '').replace(/\D/g, ''), f.emisor, f.total, dinero(f.total, f.moneda), d.ordenCompra, d.mail.asunto, d.mail.de, d.nombre].join(' ')).indexOf(q) !== -1;
  });
}

function pintarMails() {
  const d = MF.datos;
  if ($('mf-gmail')) $('mf-gmail').innerHTML = d ? htmlEstadoGmail(d.gmail, d.puede) + (d.puede && d.gmail.conectado ? htmlBancoMails(d.banco) + htmlImpresoraSola(d.impresora) : '') : '';
  const pr = (d && d.problemas) || [];
  $('md-problemas').hidden = !pr.length;
  $('md-problemas').innerHTML = pr.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  const docs = d ? d.docs || [] : [];
  $('md-secs').innerHTML = SECCIONES_DOC.map(function (x) {
    const n = x.k === 'ordenes' ? (MF.ordenes ? MF.ordenes.length : '') : docs.filter(function (y) { return y.seccion === x.k; }).length;
    return '<button type="button" class="md-sec' + (MF.sec === x.k ? ' activa' : '') + '" data-sec="' + x.k + '" aria-pressed="' + (MF.sec === x.k) + '">' + esc(x.t) +
           ' <span class="n">' + n + '</span></button>';
  }).join('');
  document.querySelectorAll('#s-cfacturas [data-solo-fac]').forEach(function (el) { el.hidden = MF.sec !== 'facturas'; });
  document.querySelectorAll('#s-cfacturas [data-solo-ord]').forEach(function (el) { el.hidden = MF.sec !== 'ordenes'; });
  document.querySelectorAll('#s-cfacturas [data-no-ord]').forEach(function (el) { el.hidden = MF.sec === 'ordenes'; });
  if (MF.sec === 'ordenes') { pintarOrdenesDoc(); return; }
  const sel = $('md-prov'), v = sel.value, provs = [];
  docs.forEach(function (x) { const p = proveedorDoc(x); if (x.seccion === MF.sec && p && provs.indexOf(p) === -1) provs.push(p); });
  provs.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  sel.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
  sel.value = provs.indexOf(v) !== -1 ? v : '';
  const l = docsALaVista();
  $('mf-lista').innerHTML = !d ? '' : !l.length ? '<p class="nota">' + (docs.length ? 'Nada por acá.' : 'Todavía no entró ningún documento.') + '</p>'
    : '<p class="nota">' + l.length + (l.length === 1 ? ' documento' : ' documentos') + (d.total > d.mostrados ? ' (de los ' + d.mostrados + ' mails más nuevos de ' + d.total + ')' : '') + '</p>' +
      l.map(htmlFilaDoc).join('');
}

function htmlFilaDoc(d) {
  const ab = !!MF.abiertos[d.id], full = MF.docs[d.id];
  return '<div class="md-doc' + (ab ? ' abierto' : '') + '">' +
    '<button type="button" class="md-cab" data-abrir="' + esc(d.id) + '" aria-expanded="' + ab + '">' +
      '<span class="mf-cab"><span class="mf-de">' + esc(nombreDe(d.mail.de)) + '</span><span class="mf-fecha">' + esc(horaCorta(d.mail.fecha)) + '</span></span>' +
      '<span class="mf-asunto">' + esc(d.mail.asunto || d.nombre || '(sin asunto)') + (d.noSePudo ? ' <span class="mf-mal">· no se pudo traer</span>' : '') + '</span>' +
      (d.nombre && !d.noSePudo ? '<span class="md-arch">' + (ICONO_PAPEL[d.papel] || '📎') + ' ' + esc(d.nombre) + '</span>' : '') +
      (d.enCompra ? '<span class="md-enoc">🛒 ' + (d.enCompra.orden ? 'Adjuntada a la OC ' + esc(d.enCompra.orden) : 'Adjuntada a una compra sin orden de compra') + '</span>' : '') + '</button>' +
    (ab ? '<div class="md-cuerpo">' + htmlDocumento(full || d, { lista: true }) + '</div>' : '') + '</div>';
}

/* ---------- Un documento: en la lista (abierto) y en la tarjeta del tablero de Facturas ---------- */
const ICONO_PAPEL = { 'Factura': '🧾', 'Nota de crédito': '↩️', 'Nota de débito': '➕', 'Remito': '📦', 'Recibo': '💵', 'Orden de pago': '💸',
                      'Resumen de cuenta': '📋', 'Presupuesto': '📝', 'Otro papel': '📄', 'Otro archivo': '🗂️', 'Imagen del mail': '🖼️' };
function nombrePapel(d) { return { 'Factura': 'factura', 'Remito': 'remito', 'Nota de crédito': 'nota de crédito', 'Nota de débito': 'nota de débito', 'Presupuesto': 'presupuesto', 'Recibo': 'recibo' }[d.papel] || (d.seccion === 'facturas' ? 'factura' : 'documento'); }
function tituloDoc(d) {
  const f = d.factura;
  if (f) return [f.emisor || 'Sin proveedor', f.cuit ? 'CUIT ' + f.cuit : '', (d.papel || 'Factura') + ' ' + ((f.letra ? f.letra + ' ' : '') + (f.numero || 'sin número'))].filter(String).join(' · ');
  return (ICONO_PAPEL[d.papel] || '📄') + ' ' + (d.papel || 'Documento') + ' · ' + (d.nombre || '');
}
function htmlLugarDoc(d) {
  if (d.enCompra) return '<p class="md-lugar">🛒 ' + (d.enCompra.orden ? 'Adjuntada a la orden de compra <button type="button" class="link-gris md-oc-link" data-irorden="' + esc(d.enCompra.id) + '">' + esc(d.enCompra.orden) + '</button>' : 'Adjuntada a una compra sin orden de compra') +
                         ': <b>' + esc(d.enCompra.titulo || d.enCompra.id) + '</b> (tablero de Pedidos)' + (d.enCompra.cargada ? ' · ✅ cargada en Albor' : '') + '</p>';
  if (d.enFacturas) {
    const t = d.tablero || {};
    return '<p class="md-lugar">🧾 En Facturas: <b>' + esc(NOMBRE_COL_FC[d.columna] || 'Entrantes') + '</b>' + (t.col === 'descartada' ? ' (descartada' + (t.motivo ? ': ' + esc(t.motivo) : '') + ')' : '') +
           (t.albor && t.albor.estado === 'Cargada' ? ' · ✅ cargada en Albor' + (t.albor.referencia ? ' (' + esc(t.albor.referencia) + ')' : '') : '') + '</p>';
  }
  return '';
}
function htmlLecturaDoc(d) {
  if (d.leyendo) return '<p class="nota">🤖 Leyendo…</p>';
  if (!d.papel) return d.error ? '<p class="mf-mal">⚠️ No se pudo leer: ' + esc(d.error) + '</p>' : d.estado ? '<p class="mf-mal">⚠️ ' + esc(d.estado) + '</p>' : '<p class="nota">Todavía no se leyó.</p>';
  const f = d.factura;
  let h = '<div class="md-lec">';
  (d.avisos || []).forEach(function (x) { h += '<p class="mf-aviso">⚠️ ' + esc(x) + '</p>'; });
  if (f) {
    h += '<p>' + [f.fecha ? 'Fecha ' + esc(f.fecha) : '', f.total !== null && f.total !== undefined ? 'Total <b>' + esc(dinero(f.total, f.moneda)) + '</b>' : '',
                  d.ordenCompra ? 'Orden de compra ' + esc(d.ordenCompra) : ''].filter(String).join(' · ') + '</p>';
    if (f.detalle) h += htmlDetalleFacturaMail(f);
    if (d.original && d.paginas > 1) h += '<p class="nota">Original: página' + (d.original.paginas.length > 1 ? 's ' : ' ') + esc(d.original.paginas.join(', ')) + ' de ' + d.paginas + '</p>';
  } else if (!/^(Otro archivo|Imagen del mail)$/.test(d.papel)) h += '<p>' + (ICONO_PAPEL[d.papel] || '📄') + ' ' + esc(d.papel) + '</p>';
  if (d.resumenMail) h += '<p class="nota">💬 En el mail: ' + esc(d.resumenMail) + '</p>';
  if (d.impresa) h += '<p class="nota">🖨️ Impresa' + (d.impresa.sola ? ' sola' : '') + ' el ' + esc(new Date(d.impresa.cuando).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })) +
                      (d.impresa.sola ? (d.impresa.compu ? ' en ' + esc(d.impresa.compu) : '') : ' por ' + esc(d.impresa.quien || '')) + '</p>';
  return h + '</div>';
}

/** Todo lo leído de la factura: los renglones, el neto, el IVA de cada tasa, las percepciones y el total. */
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

/* La compra que la app propuso (o que no coincide): "Sí, es esta" / "No es de ninguna" (Fase 7, Paso 4) */
function htmlCompraCorta(c) {
  return esc(c.titulo || c.id) + (c.proveedor ? ' · ' + esc(c.proveedor) : '') + (c.total !== null && c.total !== undefined ? ' · ' + esc(dinero(c.total, c.moneda)) + ' sin IVA' : '') +
         (c.orden ? ' · OC ' + esc(c.orden) : '') + (c.donde ? ' · ' + esc(c.donde) : '');
}
function htmlPegadoDoc(d) {
  const c = d.compra;
  if (!c || !c.estado) return '';
  if (c.estado === 'no coincide') {
    return '<div class="md-peg"><b>⛔ Dice la orden' + (c.orden ? ' ' + esc(c.orden) : '') + ', pero no coincide con esa compra</b> (' + esc(c.titulo || c.id) + '):' +
      (c.motivos || []).map(function (x) { return '<br><span class="mf-aviso">• ' + esc(x) + '</span>'; }).join('') +
      '<div class="mf-botones"><button type="button" class="btn2" data-peg="elegir" data-adj="' + esc(d.id) + '" data-w="' + esc(c.id) + '">Es de esa compra igual</button></div></div>';
  }
  if (c.estado === 'propuesta') {
    return '<div class="md-peg"><b>❓ ¿Es de alguna de estas compras?</b>' + (c.nota ? ' <span class="nota">' + esc(c.nota) + '</span>' : '') +
      (c.candidatas || []).map(function (x) {
        return '<div class="mf-cand"><span>' + htmlCompraCorta(x) + (x.motivos && x.motivos.length ? '<br><span class="mf-aviso">⚠️ ' + x.motivos.map(esc).join(' · ') + '</span>' : '') + '</span>' +
               '<button type="button" class="btn2" data-peg="elegir" data-adj="' + esc(d.id) + '" data-w="' + esc(x.id) + '">Sí, es esta</button></div>';
      }).join('') +
      '<div class="mf-botones"><button type="button" class="link-gris" data-peg="ninguna" data-adj="' + esc(d.id) + '">No es de ninguna</button></div></div>';
  }
  return '';
}

/** El cuerpo de un documento. op.lista: en Documentos ("Ver en tablero"); op.tablero: la tarjeta de Facturas (las notas primero). */
function htmlDocumento(d, op) {
  op = op || {};
  if (d.noSePudo) return '<p class="mf-mal">⚠️ Este mail no se pudo traer (era muy pesado para el servidor): abrilo en Gmail.</p>' + htmlVerMailDoc(d);
  const notas = htmlNotasCt(d.comentarios, d.notasEn || d.id);
  let h = '<h3 class="md-tit">' + esc(tituloDoc(d)) + '</h3>' + htmlLugarDoc(d);
  if (op.tablero) h += htmlAccionesFactura(d) + notas;
  h += htmlLecturaDoc(d);
  if (op.tablero) h += htmlPegadoDoc(d);
  else h += notas;
  h += htmlArreglarDoc(d);
  h += '<div class="md-pie"><div>' + (d.mail && (d.mail.texto || (d.otros && d.otros.length) || d.mail.resumen) ? '<button type="button" class="link-gris" data-vermail="' + esc(d.id) + '">' + (MF.verMail[d.id] ? 'Esconder el mail' : 'Ver mail') + '</button>' : '') + '</div>' +
       '<div class="md-pie-d">' + (d.archivo ? '<button type="button" class="btn2" data-ver="' + esc(d.archivo) + '">Ver ' + esc(nombrePapel(d)) + '</button>' : '') +
       (op.lista && (d.enCompra || d.enFacturas) ? '<button type="button" class="btn2" data-entablero="' + esc(d.id) + '">Ver en tablero</button>' : '') + '</div></div>';
  return h + (MF.verMail[d.id] ? htmlVerMailDoc(d) : '');
}
/** Feli (18/11): ✏️ Corregir lo leído de una factura del mail (la misma ventana que en Pedidos). */
async function corregirDocUI(id, despues) {
  const d = docPorId(id);
  if (!d || !d.facturaCompleta) return;
  await corregirFacturaUI(JSON.parse(JSON.stringify(d.facturaCompleta)), async function (c) {
    const r = await api('corregirDocumento', id, c);
    if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal.' : r.error, 'bad');
    aviso('Listo: se corrigió.');
    MF.docs[id] = r;
    if (MF.datos) MF.datos.docs = MF.datos.docs.map(function (x) { return x.id === id ? Object.assign({}, x, r) : x; });
    if (despues) despues(r);
  });
}
/** Feli (18/11): si la IA lo leyó mal, "🔁 Leer de nuevo"; si se equivocó de papel, "Es otro documento…" (factura, remito…). */
function htmlArreglarDoc(d) {
  if (d.noSePudo || d.leyendo || d.estado === 'Muy grande') return '';
  const pegado = d.compra && d.compra.estado === 'adjuntada';
  return '<div class="md-arreglar">' + (d.papelAMano ? '<span class="nota">✋ ' + esc(d.papel) + ' (lo dijo ' + esc(d.papelAMano) + ')</span>' : '') +
    (pegado ? '<span class="nota">Está en una compra: para cambiarlo, primero sacala de la compra.</span>' :
     (d.facturaCompleta ? '<button type="button" class="link-gris" data-corregir="' + esc(d.id) + '">✏️ Corregir</button>' : '') +
     '<button type="button" class="link-gris" data-releer="' + esc(d.id) + '">🔁 Leer de nuevo</button>' +
     '<button type="button" class="link-gris" data-papel="' + esc(d.id) + '">Es otro documento…</button>') + '</div>';
}
const PAPELES_ELEGIR = ['Factura', 'Nota de crédito', 'Nota de débito', 'Remito', 'Recibo', 'Resumen de cuenta', 'Presupuesto', 'Orden de pago', 'Otro papel'];
async function releerDocUI(id, conPapel, despues) {
  let papel = '';
  if (conPapel) {
    const d = docPorId(id), c = document.createElement('div');
    c.className = 'cuerpo md-papeles';
    c.innerHTML = PAPELES_ELEGIR.map(function (p) {
      return '<button type="button" class="btn2' + (d && d.papel === p ? ' activa' : '') + '" data-p="' + esc(p) + '">' + (ICONO_PAPEL[p] || '📄') + ' ' + esc(p === 'Otro papel' ? 'Otro' : p) + '</button>';
    }).join('');
    await dialogo({ titulo: '¿Qué documento es?', texto: 'Si es una factura o una nota de crédito o débito y no estaba leída como tal, la IA la lee de nuevo (tarda unos segundos).', cuerpo: c,
      botones: [{ texto: 'Volver', valor: null }],
      alAbrir: function () { c.querySelectorAll('[data-p]').forEach(function (b) { b.addEventListener('click', function () { papel = b.dataset.p; if (cerrarDialogoActual) cerrarDialogoActual(null); }); }); } });
    if (!papel) return;
  }
  aviso('🤖 Leyendo… (tarda unos segundos)');
  const r = await apiLenta('releerDocumento', id, papel);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal.' : r.error, 'bad');
  aviso('Listo: ' + (r.papel ? 'quedó como ' + r.papel.toLowerCase() : 'leído de nuevo') + '.');
  MF.docs[id] = r;
  if (MF.datos) MF.datos.docs = MF.datos.docs.map(function (x) { return x.id === id ? Object.assign({}, x, r) : x; });
  if (despues) despues(r);
}

function htmlVerMailDoc(d) {
  const t = MF.textos[d.mail.id];
  return '<div class="md-mail"><p class="nota">De: ' + esc(d.mail.de) + ' · ' + esc(horaCorta(d.mail.fecha)) + '</p>' +
    '<pre class="mf-texto">' + esc(!d.mail.texto ? d.mail.resumen || '(sin texto)' : t === undefined ? 'Abriendo…' : t) + '</pre>' +
    (d.otros && d.otros.length ? '<div class="mf-adjs">' + d.otros.map(function (x) {
      return x.archivo ? '<button type="button" class="mf-adj" data-ver="' + esc(x.archivo) + '">' + (ICONO_PAPEL[x.papel] || '📎') + ' ' + esc(x.nombre) + '</button>' : '';
    }).join('') + '</div>' : '') + '</div>';
}

async function verMailDoc(id, repintar) {
  MF.verMail[id] = !MF.verMail[id];
  repintar();
  const d = docPorId(id);
  if (!MF.verMail[id] || !d || !d.mail.texto || MF.textos[d.mail.id] !== undefined) return;
  const r = await api('verArchivo', d.mail.texto);
  if (!r.ok) { MF.textos[d.mail.id] = r.sinConexion ? '📶 Hace falta señal para abrirlo.' : r.error; repintar(); return; }
  const bin = atob(r.datos), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  MF.textos[d.mail.id] = new TextDecoder('utf-8').decode(bytes);
  repintar();
}
function docPorId(id) {
  if (CD.d && CD.d.id === id) return CD.d;
  return MF.docs[id] || ((MF.datos && MF.datos.docs) || []).filter(function (x) { return x.id === id; })[0] || null;
}

async function abrirFilaDoc(id) {
  MF.abiertos[id] = !MF.abiertos[id];
  pintarMails();
  const d = docPorId(id);
  if (!MF.abiertos[id] || !d || d.noSePudo) return;
  const r = await api('getDocumento', id);
  if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal para ver las notas.' : r.error); return; }
  MF.docs[id] = r;
  pintarMails();
}

/** "Sí, es esta" / "Es de esa compra igual" / "No es de ninguna" (y después de pegarla, se recarga lo que se esté mirando). */
async function accionPegado(b, despues) {
  const que = b.dataset.peg, id = b.dataset.adj;
  b.disabled = true;
  aviso(que === 'ninguna' ? 'Guardando…' : '🔗 Adjuntando… (la compara con la compra)');
  const r = que === 'ninguna' ? await api('elegirCompraMail', id, '') : await apiLenta('elegirCompraMail', id, b.dataset.w);
  if (!r.ok) { b.disabled = false; return aviso(r.sinConexion ? '📶 Hace falta señal.' : r.error, 'bad'); }
  aviso(que === 'ninguna' ? 'Listo: queda en Facturas.' : 'Listo: la factura quedó en su compra (tablero de Pedidos).');
  if (que !== 'ninguna') return abrir('ctarjeta', { id: b.dataset.w });
  if (despues) despues();
}

$('mf-q').addEventListener('input', pintarMails);
['md-prov', 'md-albor', 'md-oc', 'md-compra'].forEach(function (id) { $(id).addEventListener('change', pintarMails); });
['mf-desde', 'mf-hasta'].forEach(function (id) { $(id).addEventListener('change', cargarMails); });
$('mf-refrescar').addEventListener('click', function () { MF.docs = {}; cargarMails(); if (MF.sec === 'ordenes') cargarOrdenesDoc(); });
$('md-ordfac').addEventListener('change', pintarMails);
$('s-cfacturas').addEventListener('click', function (e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sec) { MF.sec = b.dataset.sec; pintarMails(); if (MF.sec === 'ordenes') cargarOrdenesDoc(); }
  else if (b.dataset.orden) { MF.ordAbiertas[b.dataset.orden] = !MF.ordAbiertas[b.dataset.orden]; pintarOrdenesDoc(); }
  else if (b.dataset.irorden) irAOrden(b.dataset.irorden);
  else if (b.dataset.ordadj) adjuntarFacturaAOrdenUI(b.dataset.ordadj);
  else if (b.dataset.orddes) desadjuntarOrdenUI(b.dataset.orddes);
  else if (b.dataset.ordtar) abrir('ctarjeta', { id: b.dataset.ordtar });
  else if (b.dataset.abrir) abrirFilaDoc(b.dataset.abrir);
  else if (b.dataset.ver) verArchivo(b.dataset.ver);
  else if (b.dataset.vermail) verMailDoc(b.dataset.vermail, pintarMails);
  else if (b.dataset.releer || b.dataset.papel) releerDocUI(b.dataset.releer || b.dataset.papel, !!b.dataset.papel, function () { pintarMails(); });
  else if (b.dataset.corregir) corregirDocUI(b.dataset.corregir, function () { pintarMails(); });
  else if (b.dataset.nota) agregarNotaUI(b, function () { delete MF.docs[b.dataset.nota]; Object.keys(MF.docs).forEach(function (k) { if (MF.docs[k].notasEn === b.dataset.nota) abrirOtraVez(k); }); abrirOtraVez(b.dataset.nota); });
  else if (b.dataset.entablero) {
    const d = docPorId(b.dataset.entablero);
    if (d && d.enCompra) abrir('ctarjeta', { id: d.enCompra.id });
    else abrir('cdoc', { id: b.dataset.entablero });
  }
});
/** Vuelve a pedir un documento abierto en la lista (después de una nota). */
async function abrirOtraVez(id) {
  if (!MF.abiertos[id]) return;
  const r = await api('getDocumento', id);
  if (r.ok) { MF.docs[id] = r; pintarMails(); }
}

/* ---------- Feli (20/11): 🛒 Órdenes de compra (Documentos) ----------
   Una fila por orden: número, proveedor, sitio, razón del pedido y su factura. Abierta: los pedidos, lo comprado y
   "🔗 Adjuntar una factura" (las del tablero de Facturas; pasa a Pedidos) o "Desadjuntar" (vuelve a Facturas). */
async function cargarOrdenesDoc() {
  if (MF.cargandoOrd) return;
  MF.cargandoOrd = true;
  if (!MF.ordenes) notaMF('Cargando las órdenes de compra…');
  const r = await api('getOrdenesDocumentos');
  MF.cargandoOrd = false;
  if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal para ver las órdenes de compra.' : r.error); return; }
  MF.ordenes = r.ordenes;
  notaMF('');
  pintarMails();
}

function textoFacturaOrden(f) {
  return 'Factura ' + ((f.letra ? f.letra + ' ' : '') + (f.numero || f.nombre || ''));
}
function ordenesALaVista() {
  const q = sinTildes($('mf-q').value.trim()), prov = $('md-prov').value, fac = $('md-ordfac').value;
  const desde = $('mf-desde').value, hasta = $('mf-hasta').value;
  return (MF.ordenes || []).filter(function (o) {
    if (prov && o.proveedor !== prov) return false;
    if (fac && !!o.factura !== (fac === 'si')) return false;
    const dia = (o.fecha || '').slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (!q) return true;
    return sinTildes([o.numero, o.proveedor, o.cuit, o.titulo, o.sitios.join(' '), dinero(o.total, o.moneda),
      o.pedidos.map(function (p) { return [p.ref, p.titulo, p.razon, p.solicitante].join(' '); }).join(' '),
      o.productos.map(function (x) { return x.producto + ' ' + x.texto; }).join(' '),
      o.factura ? [o.factura.numero, o.factura.nombre].join(' ') : ''].join(' ')).indexOf(q) !== -1;
  });
}

function pintarOrdenesDoc() {
  const sel = $('md-prov'), v = sel.value, provs = [];
  (MF.ordenes || []).forEach(function (o) { if (o.proveedor && provs.indexOf(o.proveedor) === -1) provs.push(o.proveedor); });
  provs.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  sel.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
  sel.value = provs.indexOf(v) !== -1 ? v : '';
  if (!MF.ordenes) { $('mf-lista').innerHTML = ''; return; }
  const l = ordenesALaVista();
  $('mf-lista').innerHTML = !l.length ? '<p class="nota">' + (MF.ordenes.length ? 'Nada por acá.' : 'Todavía no hay órdenes de compra.') + '</p>'
    : '<p class="nota">' + l.length + (l.length === 1 ? ' orden de compra' : ' órdenes de compra') + '</p>' + l.map(htmlFilaOrden).join('');
}

function razonesCompra(c) {
  return c.pedidos.map(function (p) { return p.razon || p.titulo; }).filter(Boolean).join(' · ');
}
function htmlFilaOrden(o) {
  const ab = !!MF.ordAbiertas[o.id];
  return '<div class="md-doc' + (ab ? ' abierto' : '') + '" id="ord-' + esc(o.id) + '">' +
    '<button type="button" class="md-cab" data-orden="' + esc(o.id) + '" aria-expanded="' + ab + '">' +
      '<span class="mf-cab"><span class="mf-de">' + (o.prueba ? '🧪 ' : '') + esc(o.numero) + ' · ' + esc(o.proveedor || 'Sin proveedor') + '</span><span class="mf-fecha">' + esc(fechaCt(o.fecha)) + '</span></span>' +
      '<span class="mf-asunto">' + esc([o.sitios.join(', '), razonesCompra(o)].filter(Boolean).join(' · ') || o.titulo) + '</span>' +
      '<span class="md-enoc' + (o.factura ? '' : ' sin') + '">' + (o.anulada ? '⛔ Compra anulada · ' : '') +
        (o.factura ? '✅ ' + esc(textoFacturaOrden(o.factura)) + (o.factura.cargada ? ' · cargada en Albor' : '') : '🧾 Sin factura') + '</span></button>' +
    (ab ? '<div class="md-cuerpo">' + htmlOrdenAbierta(o) + '</div>' : '') + '</div>';
}

/** Los pedidos (título, razón, sitio, quién) y lo comprado de una compra: lo usan las órdenes y "Adjuntar a una orden de compra". */
function htmlDetalleCompra(c) {
  let h = '<div class="od-peds">' + c.pedidos.map(function (p) {
    return '<p><b>' + esc(p.titulo || p.ref) + '</b>' + (p.razon ? '<br>Razón: ' + esc(p.razon) : '') +
           '<br><small class="nota">' + esc([p.sitio, p.solicitante ? 'lo pidió ' + p.solicitante : '', p.ref].filter(Boolean).join(' · ')) + '</small></p>';
  }).join('') + '</div>';
  if (c.productos.length) {
    h += '<div class="mf-det od-prod"><table><thead><tr><th>Cant.</th><th>Producto</th><th>Precio unit.</th></tr></thead><tbody>' + c.productos.map(function (x) {
      return '<tr><td>' + esc(x.cantidad) + '</td><td>' + esc(x.producto) + (x.texto && sinTildes(x.texto) !== sinTildes(x.producto) ? '<br><small class="nota">' + esc(x.texto) + '</small>' : '') +
             '</td><td>' + esc(dinero(x.precio, c.moneda)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  if (c.total !== null && c.total !== undefined) h += '<p>Total de la compra: <b>' + esc(dinero(c.total, c.moneda)) + '</b> sin IVA</p>';
  return h;
}

function htmlOrdenAbierta(o) {
  let h = '<h3 class="md-tit">Orden de compra ' + esc(o.numero) + '</h3>' +
          '<p class="md-lugar">' + esc([o.proveedor, o.cuit ? 'CUIT ' + o.cuit : '', o.columna ? 'En Compras: ' + o.columna : ''].filter(Boolean).join(' · ')) + '</p>';
  if (o.anulada) h += '<p class="mf-aviso">⛔ La compra se anuló (la orden está para anular en Albor).</p>';
  h += htmlDetalleCompra(o);
  const f = o.factura;
  if (f) {
    h += '<div class="caja od-fac"><b>✅ ' + esc(textoFacturaOrden(f)) + '</b><small class="nota">' +
         esc(f.mail ? (f.sola ? 'La adjuntó sola la app' : 'La adjuntó ' + (f.quien || 'una persona')) + (/^SUB/.test(f.mail) ? ' (subida a mano)' : ' (llegó por mail)') : 'La adjuntó ' + (f.quien || 'una persona') + ' desde Pedidos') +
         (f.cuando ? ' el ' + esc(fechaCt(f.cuando)) : '') + (f.cargada ? ' · cargada en Albor' : '') + '</small><div class="mf-botones">' +
         (f.archivo ? '<button type="button" class="btn2" data-ver="' + esc(f.archivo) + '">Ver factura</button>' : '') +
         '<button type="button" class="btn2" data-ordtar="' + esc(o.id) + '">Ver en Pedidos</button>' +
         (f.cargada ? '<span class="nota">Ya está cargada en Albor: no se desadjunta.</span>' : '<button type="button" class="btn2 peligro-btn2" data-orddes="' + esc(o.id) + '">Desadjuntar (vuelve a Facturas)</button>') +
         '</div></div>';
  } else if (o.adjuntable) {
    h += '<div class="mf-botones"><button type="button" class="btn" data-ordadj="' + esc(o.id) + '">🔗 Adjuntar una factura</button></div>';
  } else {
    h += '<p class="nota">La compra no está en Entregas (' + esc(o.columna || 'sin columna') + '): no se le puede adjuntar la factura.</p>';
  }
  return h;
}

/** Feli (20/11): un buscador arriba de una lista de un diálogo. Cada elemento lleva en data-q lo que se busca (sin tildes);
    con varias palabras, tienen que estar todas. Los títulos (data-sub) se esconden si su grupo queda vacío. */
function buscadorEnLista(c, placeholder) {
  const q = document.createElement('input');
  q.type = 'search'; q.placeholder = placeholder; q.autocomplete = 'off'; q.className = 'od-buscar';
  const nada = document.createElement('p');
  nada.className = 'nota'; nada.textContent = 'Nada coincide con la búsqueda.'; nada.hidden = true;
  c.prepend(q);
  c.appendChild(nada);
  q.addEventListener('input', function () {
    const ps = sinTildes(q.value.trim()).split(/\s+/).filter(Boolean);
    let alguno = false;
    c.querySelectorAll('[data-q]').forEach(function (el) {
      const t = el.dataset.q, ve = ps.every(function (p) { return t.indexOf(p) !== -1 || t.replace(/[.\s-]/g, '').indexOf(p.replace(/[.\s-]/g, '')) !== -1; });
      el.hidden = !ve;
      if (ve) alguno = true;
    });
    c.querySelectorAll('[data-sub]').forEach(function (el) { el.hidden = !c.querySelector('[data-q][data-grupo="' + el.dataset.sub + '"]:not([hidden])'); });
    nada.hidden = alguno;
  });
  return q;
}

/** Desde una factura (Documentos o el tablero de Facturas): ir a su orden en Documentos → Órdenes de compra, abierta. */
async function irAOrden(wid) {
  MF.sec = 'ordenes';
  MF.ordAbiertas[wid] = true;
  if (!pila.length || pila[pila.length - 1].id !== 'cfacturas') abrir('cfacturas');
  else pintarMails();
  await cargarOrdenesDoc();
  const el = $('ord-' + wid);
  if (el) el.scrollIntoView({ block: 'center' });
}

async function adjuntarFacturaAOrdenUI(wid) {
  notaMF('Buscando las facturas…');
  const r = await api('facturasParaOrden', wid);
  if (!r.ok) return notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error);
  notaMF('');
  const c = document.createElement('div');
  c.className = 'cuerpo fc-compras';
  c.innerHTML = !r.facturas.length ? '<p class="nota">No hay facturas leídas en el tablero de Facturas para adjuntar.</p>' :
    r.facturas.map(function (f) {
      const q = sinTildes([f.numero, f.cuit, (f.cuit || '').replace(/\D/g, ''), f.proveedor, f.total, dinero(f.total, f.moneda), f.neto, dinero(f.neto, f.moneda), f.oc, f.asunto, f.de, f.nombre, f.items, f.fecha].join(' '));
      return '<div class="fc-compra od-elegir" data-q="' + esc(q) + '"><b>' + esc(f.proveedor || 'Sin proveedor') + '</b>' + (f.mismo ? ' <span class="tag">mismo CUIT</span>' : '') +
             (f.oc ? ' <span class="tag">dice OC ' + esc(f.oc) + '</span>' : '') +
             '<small>' + esc(['Factura ' + (f.numero || 'sin número'), f.fecha, f.total !== null ? dinero(f.total, f.moneda) + ' con IVA' : '', f.neto !== null ? dinero(f.neto, f.moneda) + ' neto' : '',
                              'en ' + (NOMBRE_COL_FC[f.columna] || 'Entrantes')].filter(Boolean).join(' · ')) + '</small>' +
             '<div class="mf-botones">' + (f.archivo ? '<button type="button" class="btn2" data-dver="' + esc(f.archivo) + '">Ver</button>' : '') +
             '<button type="button" class="btn" data-dfac="' + esc(f.id) + '">Adjuntar esta</button></div></div>';
    }).join('');
  let elegida = null;
  await dialogo({ titulo: 'Factura para la ' + (r.orden.numero || 'compra') + ' (' + (r.orden.proveedor || '') + (r.orden.total ? ', ' + dinero(r.orden.total, r.orden.moneda) + ' sin IVA' : '') + ')',
    cuerpo: c, botones: [{ texto: 'Volver', valor: null }],
    alAbrir: function () {
      if (r.facturas.length) buscadorEnLista(c, 'Buscar por número, CUIT, monto, proveedor o producto…').focus();
      c.querySelectorAll('[data-dfac]').forEach(function (b) { b.addEventListener('click', function () { elegida = b.dataset.dfac; if (cerrarDialogoActual) cerrarDialogoActual(null); }); });
      c.querySelectorAll('[data-dver]').forEach(function (b) { b.addEventListener('click', function () { verArchivo(b.dataset.dver); }); });
    } });
  if (!elegida) return;
  notaMF('🔗 Adjuntando… (la compara con la compra)');
  const x = await apiLenta('elegirCompraMail', elegida, wid);
  if (!x.ok) return notaMF(x.sinConexion ? '📶 Hace falta señal.' : x.error);
  notaMF('');
  aviso('Listo: la factura quedó en la orden (tablero de Pedidos).' + (x.pegado && x.pegado.avisos && x.pegado.avisos.length ? ' Revisala: ' + x.pegado.avisos.join(' ') : ''));
  MF.docs = {};
  cargarOrdenesDoc();
  cargarMails();
}

async function desadjuntarOrdenUI(wid) {
  const o = (MF.ordenes || []).filter(function (x) { return x.id === wid; })[0];
  if (!o || !o.factura) return;
  if (!(await dialogo({ titulo: 'Desadjuntar la factura', texto: 'La ' + textoFacturaOrden(o.factura) + ' sale de la orden ' + o.numero + ' y vuelve al tablero de Facturas (Entrantes). ¿Seguro?',
      botones: [{ texto: 'Sí, desadjuntar', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] }))) return;
  notaMF('Desadjuntando…');
  const r = await api('desadjuntarFacturaOrden', wid);
  if (!r.ok) return notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error);
  notaMF('');
  aviso('Listo: la factura volvió al tablero de Facturas.' + (r.leer ? ' 🤖 Leyéndola…' : ''));
  MF.docs = {};
  cargarOrdenesDoc();
  cargarMails();
  if (r.leer) {      // la que se había adjuntado a mano en Pedidos: se lee para que se pueda adjuntar a otra
    const x = await apiLenta('leerDocumentoAhora', r.id);
    aviso(x.ok ? 'Listo: la factura volvió al tablero de Facturas y ya se leyó.' : 'La factura volvió al tablero de Facturas; se lee sola en unos minutos.');
    cargarMails();
  }
}

/* ---------- Ajustes → 📥 Mails e impresora (Feli): conectar, la lectura, el pegado y la impresora ---------- */
$('s-cmails').addEventListener('click', function (e) {
  const b = e.target.closest('button');
  if (b && b.dataset.mf) accionGmail(b.dataset.mf);
});

function htmlBancoMails(b) {
  if (!b) return '';
  const pc = b.revisados ? Math.round(b.bien / b.revisados * 100) : null;
  return '<div class="mf-banco"><p><b>🤖 Lectura</b>: leídos ' + b.leidos + ' · la prueba: ' + b.conIA + ' de ' + b.tope + ' con la IA' +
    (b.revisados ? ' (revisados ' + b.revisados + ': <b>' + pc + ' % bien</b>)' : '') + ' · la prueba costó US$ ' + b.costo.toFixed(2).replace('.', ',') + '</p>' +
    '<div class="mf-botones">' + (b.conIA < b.tope ? '<button type="button" class="btn" data-mf="leer">🤖 Leer la muestra</button>' : '') +
    '<button type="button" class="btn2" data-mf="leersolos">' + (b.leer ? '⏸️ Apagar la lectura de los nuevos' : '🤖 Leer solos los mails nuevos') + '</button>' +
    (b.leer ? '<span class="nota">Los mails nuevos se leen solos.</span>' : '') + '</div>' +
    '<p style="margin-top:12px"><b>🔗 Pegar con las compras</b>: ' + (b.pegar ? 'cada factura nueva busca su compra sola.' : 'apagado.') +
    (b.paraPegar ? ' Faltan ' + b.paraPegar + '.' : '') + '</p><div class="mf-botones">' +
    (b.paraPegar ? '<button type="button" class="btn" data-mf="pegar">🔗 Buscar las compras ahora</button>' : '') +
    '<button type="button" class="btn2" data-mf="pegarsolas">' + (b.pegar ? '⏸️ Apagar el pegado solo' : '🔗 Pegar solas las nuevas') + '</button>' +
    (b.costoTotal > b.costo ? '<span class="nota">Total gastado en lecturas: US$ ' + b.costoTotal.toFixed(2).replace('.', ',') + '</span>' : '') + '</div></div>';
}

/** "🔗 Buscar las compras": de a una factura (la página repite). */
async function pegarMailsUI() {
  let n = 0, adj = 0, fallas = 0;
  for (let vuelta = 0; vuelta < 150; vuelta++) {
    notaMF('🔗 Buscando la compra de cada factura… ' + (n ? n + ' hechas' + (adj ? ', ' + adj + ' adjuntadas solas' : '') : ''));
    const r = await apiLenta('pegarMailsAhora');
    if (!r.ok) {
      if (!r.sinConexion && ++fallas <= 3) { await new Promise(function (ok) { setTimeout(ok, 4000); }); continue; }
      notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); break;
    }
    fallas = 0; n += r.r.pegadas; adj += r.r.adjuntadas;
    if (MF.datos) MF.datos.banco = r.banco;
    if (!r.r.quedan) { notaMF('✅ Listo: ' + n + ' facturas miradas, ' + adj + ' adjuntadas solas a su compra.'); break; }
  }
  const nota = $('mf-nota').textContent;
  MF.cargando = false;
  await cargarMails();
  notaMF(nota);
}

/* ---------- Feli (16/11): la cuenta de la impresora, con la llave en su acceso directo ---------- */
function htmlImpresoraSola(e) {
  if (!e) return '';
  const hace = e.ultima ? Math.round((Date.now() - new Date(e.ultima).getTime()) / 60000) : null;
  return '<div class="mf-banco"><p><b>🖨️ Impresora sola</b>: ' +
    (!e.llave ? 'todavía no se armó su acceso directo.' :
     hace === null ? 'el acceso directo está armado; todavía no se conectó.' :
     (hace <= 3 ? '✅ conectada' : '⚠️ sin noticias desde hace ' + (hace < 120 ? hace + ' minutos' : Math.round(hace / 60) + ' horas')) + (e.compu ? ' (' + esc(e.compu) + ')' : '') + '.') + '</p>' +
    '<p class="nota">Entra sola con la llave de su acceso directo (sin código). Si pasa media hora sin conectarse en horario de trabajo, te llega una 🔔 a vos y a contabilidad.</p>' +
    '<div class="mf-botones"><button type="button" class="btn2" data-mf="llaveimp">' + (e.llave ? '🔑 Armar un acceso directo nuevo' : '🖨️ Armar el acceso directo de la impresora') + '</button></div></div>';
}

async function armarAccesoImpresora() {
  const ya = MF.datos && MF.datos.impresora && MF.datos.impresora.llave;
  if (ya) {
    const si = await dialogo({ titulo: 'Un acceso directo nuevo', texto: 'Se arma una llave nueva: el acceso directo que ya está instalado deja de entrar y hay que reemplazarlo por el nuevo.',
                               botones: [{ texto: 'Armar uno nuevo', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
    if (!si) return;
  }
  const r = await api('crearLlaveImpresora');
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal.' : r.error, 'bad');
  const url = location.origin + location.pathname + '?ap=contabilidad&impresora=1#llave=' + r.llave;
  const destino = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\ImpresoraFacturas" --kiosk-printing --app="' + url + '"';
  const caja = document.createElement('div');
  caja.innerHTML = '<p class="nota">Copialo y pegalo en el acceso directo de la compu de la impresora (clic derecho en el escritorio → Nuevo → Acceso directo). Es secreto: no lo mandes por WhatsApp ni lo pegues en otro lado.</p>';
  const t = document.createElement('textarea');
  t.readOnly = true; t.rows = 5; t.value = destino; t.className = 'ip-destino';
  caja.appendChild(t);
  await dialogo({ titulo: '🖨️ El acceso directo de la impresora', cuerpo: caja, alAbrir: function () { t.select(); },
    botones: [{ texto: '📋 Copiar', clase: 'btn', valor: function () {
      try { navigator.clipboard.writeText(destino); } catch (e) { t.select(); document.execCommand('copy'); }
      aviso('📋 Copiado. Pegalo en el acceso directo de la compu de la impresora.');
      return true;
    } }, { texto: 'Cerrar', valor: null }] });
  MF.cargando = false;
  await cargarMails();
}

/** Lee la muestra de a un archivo (la página repite) hasta el tope de la prueba. */
async function leerMuestraUI() {
  let n = 0, fallas = 0;
  for (let vuelta = 0; vuelta < 120; vuelta++) {
    notaMF('🤖 Leyendo la muestra… ' + (n ? n + ' leídos' : ''));
    const r = await apiLenta('leerMailsAhora', { muestra: true });
    if (!r.ok) {
      if (!r.sinConexion && ++fallas <= 3) { await new Promise(function (ok) { setTimeout(ok, 4000); }); continue; }
      notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); break;
    }
    fallas = 0;
    n += r.r.leidas;
    if (MF.datos) MF.datos.banco = r.banco;
    if (vuelta % 3 === 2) { MF.cargando = false; await cargarMails(); }
    if (!r.r.quedan || r.banco.conIA >= r.banco.tope) { notaMF('✅ Listo: ' + n + ' leídos.'); break; }
  }
  const nota = $('mf-nota').textContent;
  MF.cargando = false;
  await cargarMails();
  notaMF(nota);
}

async function accionGmail(que) {
  if (que === 'conectar') {
    notaMF('Abriendo Google…');
    const r = await api('gmailConectar');
    if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
    location.href = r.url;
    return;
  }
  if (que === 'traer') return traerMailsUI();
  if (que === 'leer') return leerMuestraUI();
  if (que === 'pegar') return pegarMailsUI();
  if (que === 'llaveimp') return armarAccesoImpresora();
  if (que === 'pegarsolas') {
    const prender = !(MF.datos.banco && MF.datos.banco.pegar);
    const r = await api('gmailPegar', prender);
    if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
    MF.datos.banco.pegar = r.pegar;
    pintarMails();
    return;
  }
  if (que === 'leersolos') {
    const prender = !(MF.datos.banco && MF.datos.banco.leer);
    if (prender) {
      const si = await dialogo({ titulo: 'Leer solos los mails nuevos', texto: 'Desde ahora, cada archivo de los mails nuevos lo lee la IA apenas entra ' +
        '(cada uno cuesta 1 o 2 centavos de dólar). Conviene prenderlo cuando la prueba dé bien.',
        botones: [{ texto: '🤖 Prender', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] });
      if (!si) return;
    }
    const r = await api('gmailLeer', prender);
    if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
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
  notaMF('Guardando…');
  const r = await api('gmailModo', modo, desde);
  if (!r.ok) { notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); return; }
  MF.datos.gmail = r;
  notaMF('');
  pintarMails();
  if (modo) await traerMailsUI();
}

/** Trae de a tandas hasta que no quede nada (cada tanda, unos pocos mails: Supabase le da poco trabajo a cada pedido). */
async function traerMailsUI() {
  let total = 0, etiquetados = 0, fallas = 0;
  for (let vuelta = 0; vuelta < 80; vuelta++) {
    notaMF('⬇️ Trayendo los mails… ' + (total ? total + ' nuevos hasta ahora' : ''));
    const r = await apiLenta('traerMailsAhora');
    if (!r.ok) {
      // Si el servidor se cayó con un mail pesado, se reintenta: a la tercera, ese mail queda "No se pudo traer" y se sigue
      if (!r.sinConexion && ++fallas <= 4) { notaMF('⬇️ Un mail costó más de la cuenta; sigo en unos segundos…'); await new Promise(function (ok) { setTimeout(ok, 5000); }); continue; }
      notaMF(r.sinConexion ? '📶 Hace falta señal.' : r.error); break;
    }
    fallas = 0;
    if (r.r.ocupado) {                          // el reloj está trayendo: se espera un poco y se sigue
      notaMF('⬇️ El reloj de la app está trayendo mails; sigo en unos segundos…');
      await new Promise(function (ok) { setTimeout(ok, 15000); });
      continue;
    }
    total += r.r.nuevos; etiquetados += r.r.etiquetados;
    if (MF.datos) MF.datos.gmail = r.gmail;
    if (!r.r.quedan) {
      notaMF('✅ Listo: ' + total + ' mail' + (total === 1 ? '' : 's') + ' nuevo' + (total === 1 ? '' : 's') +
             (etiquetados ? ' · ' + etiquetados + ' quedaron con la etiqueta en Gmail' : '') + (r.r.errores ? ' · ' + r.r.errores + ' con error (se reintentan solos)' : '') + '.');
      break;
    }
  }
  MF.cargando = false;
  const n = $('mf-nota').textContent;
  await cargarMails();
  notaMF(n);
}


/* ============================================================
   FASE 7, PASO 5 (Feli, 16/11): 🧾 EL TABLERO DE FACTURAS
   ------------------------------------------------------------
   Las facturas que no quedaron en una compra de la app (servicios, combustible, luz, fletes…): Entrantes → Controlando →
   Esperando aprobación → Lista para cargar → Finalizado (7 días; después, 📚 Historial). La tarjeta se abre como las del
   tablero de Compras (pantalla cdoc): lo de Documentos, las notas bien a la vista y los botones "Mandar a controlar",
   "Mandar a aprobar" (WhatsApp a Adolfo; él aprueba o no desde la misma tarjeta) y "Lista para cargar". "Cargar en Albor"
   (todas las de Lista para cargar) llega con el Paso 6: mientras, "Ya la cargué en Albor" en cada una.
   ============================================================ */
pantalla('cfac', { titulo: 'Facturas', tab: 'cfac', alMostrar: mostrarFacturasT });
pantalla('cdoc', { titulo: 'Factura', tab: 'cfac', alMostrar: mostrarDoc });
const FC = { datos: null, cargando: false, verHist: false, historial: null };
const CD = { id: null, d: null };
const COLS_FC = ['entrantes', 'controlando', 'aprobacion', 'lista', 'finalizado'];

async function mostrarFacturasT() {
  if (!FC.datos) notaAd('fc-estado', 'Cargando…');
  pintarFacturasT();
  await cargarFacturasT();
  if (FC.verHist) cargarHistorialFacturas();
}
async function cargarFacturasT() {
  if (FC.cargando) return;
  FC.cargando = true;
  const r = await api('getTableroFacturas');
  FC.cargando = false;
  if (!r.ok) { notaAd('fc-estado', r.sinConexion ? '📶 Poca señal: se ve lo último que se cargó. Se actualiza solo cuando vuelva.' : r.error); return; }
  FC.datos = r;
  notaAd('fc-estado', '');
  pintarFacturasT();
}
async function cargarHistorialFacturas() {
  const r = await api('getTableroFacturas', true);
  if (!r.ok) { notaAd('fc-estado', r.sinConexion ? '📶 Hace falta señal para ver el Historial.' : r.error); if (FC.historial === null) FC.historial = []; pintarFacturasT(); return; }
  FC.historial = r.historial || [];
  pintarFacturasT();
}

function conAvisosDoc(d) { return !!((d.avisos && d.avisos.length) || d.error || d.repetida || (d.compra && ['propuesta', 'no coincide'].indexOf(d.compra.estado) !== -1)); }
function pasaFiltrosFacturas(d) {
  const q = sinTildes($('fc-q').value.trim()), prov = $('fc-prov').value, f = d.factura || {};
  if (prov && proveedorDoc(d) !== prov) return false;
  if ($('fc-avisos').checked && !conAvisosDoc(d)) return false;
  return !q || sinTildes([f.numero, f.cuit, (f.cuit || '').replace(/\D/g, ''), f.emisor, f.total, dinero(f.total, f.moneda), d.mail.asunto, d.mail.de, d.nombre,
                          d.tablero.ultimaNota ? d.tablero.ultimaNota.texto : ''].join(' ')).indexOf(q) !== -1;
}

function htmlTarjetaFactura(d) {
  const f = d.factura, t = d.tablero || {}, ap = t.aprobacion, n = t.ultimaNota;
  return '<div class="tarjeta ct-t fc-t" data-doc="' + esc(d.id) + '" role="button" tabindex="0">' +
    '<div class="mf-cab"><span class="mf-de">' + esc(nombreDe(d.mail.de)) + '</span><span class="mf-fecha">' + esc(horaCorta(d.mail.fecha)) + '</span></div>' +
    '<div class="t">' + esc(d.mail.asunto || d.nombre) + '</div>' +
    (f ? '<div class="sub-t">' + esc([f.emisor, f.numero ? (f.letra ? f.letra + ' ' : '') + f.numero : ''].filter(Boolean).join(' · ')) +
         (f.total !== null && f.total !== undefined ? ' · <b>' + esc(dinero(f.total, f.moneda)) + '</b>' : '') + '</div>'
       : '<div class="sub-t">' + (d.leyendo || !d.papel ? '🤖 Leyendo…' : esc(d.papel)) + '</div>') +
    (ap && ap.estado === 'Esperando' ? '<div class="fc-marca">⏳ Esperando a ' + esc(ap.aprueba) + '</div>' : '') +
    (ap && ap.estado === 'Aprobada' ? '<div class="fc-marca ok">✅ Aprobada por ' + esc(ap.decidio) + '</div>' : '') +
    (ap && ap.estado === 'No aprobada' && t.col === 'controlando' ? '<div class="fc-marca mal">❌ No aprobada' + (ap.motivo ? ': ' + esc(ap.motivo) : '') + '</div>' : '') +
    (d.compra && d.compra.estado === 'propuesta' ? '<div class="fc-marca">❓ ¿Es de una compra?</div>' : '') +
    (d.compra && d.compra.estado === 'no coincide' ? '<div class="fc-marca">⛔ Dice una orden de compra, pero no coincide</div>' : '') +
    ((d.avisos && d.avisos.length) || d.repetida ? '<div class="fc-marca">⚠️ ' + (d.repetida ? 'Repetida' : d.avisos.length === 1 ? '1 aviso' : d.avisos.length + ' avisos') + '</div>' : '') +
    (n ? '<div class="fc-nota">💬 <b>' + esc(n.autor) + ':</b> ' + esc(n.texto) + (t.notas > 1 ? ' <span class="nota">(+' + (t.notas - 1) + ')</span>' : '') + '</div>' : '') +
    (t.col === 'descartada' ? '<div class="ct-hist-f">🗑️ Descartada' + (t.motivo ? ': ' + esc(t.motivo) : '') + '</div>' :
     FC.verHist && t.desde ? '<div class="ct-hist-f">Finalizado desde el ' + esc(fechaCt(t.desde)) + '</div>' : '') + '</div>';
}

function pintarFacturasT() {
  const d = FC.datos;
  $('fc-hist-b').setAttribute('aria-pressed', FC.verHist ? 'true' : 'false');
  $('fc-hist-b').textContent = FC.verHist ? '← Volver al tablero' : '📚 Historial';
  if (!d) { $('fc-cols').innerHTML = ''; return; }
  const sel = $('fc-prov'), v = sel.value, provs = [];
  COLS_FC.forEach(function (k) { (d[k] || []).forEach(function (x) { const p = proveedorDoc(x); if (p && provs.indexOf(p) === -1) provs.push(p); }); });
  provs.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  sel.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
  sel.value = provs.indexOf(v) !== -1 ? v : '';
  if (FC.verHist) {
    const l = (FC.historial || []).filter(pasaFiltrosFacturas);
    $('fc-cols').innerHTML = '<div class="ct-hist-h"><h3>📚 Historial <span class="n">' + l.length + '</span></h3>' +
      '<small class="nota">Las facturas que pasaron 7 días en Finalizado y las descartadas.</small></div>' +
      (FC.historial === null ? '<p class="nota">Cargando…</p>' : '<div class="ct-hist">' + (l.map(htmlTarjetaFactura).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>');
  } else {
    $('fc-cols').innerHTML = COLS_FC.map(function (k) {
      const l = (d[k] || []).filter(pasaFiltrosFacturas);
      return '<div class="ct-col"><h3>' + esc(NOMBRE_COL_FC[k]) + ' <span class="n">' + l.length + '</span></h3>' +
        (k === 'lista' && l.length ? '<button type="button" class="btn2 ct-albor-todas" id="fc-albor-todas">🧾 Cargar en Albor</button>' : '') +
        (l.map(htmlTarjetaFactura).join('') || '<p class="nota ct-vacia">Nada por acá.</p>') + '</div>';
    }).join('');
    if ($('fc-albor-todas')) $('fc-albor-todas').addEventListener('click', function () {
      dialogo({ titulo: '🧾 Cargar en Albor', texto: 'Cargar en Albor las facturas sin orden de compra llega con el Paso 6 (falta conocer cómo se cargan en Albor). ' +
                'Mientras, cargalas a mano y tocá «Ya la cargué en Albor» en cada una: pasa a Finalizado.', botones: [{ texto: 'Entendido', clase: 'btn', valor: true }] });
    });
  }
  document.querySelectorAll('#fc-cols [data-doc]').forEach(function (el) {
    const abrirla = function () { abrir('cdoc', { id: el.dataset.doc }); };
    el.addEventListener('click', abrirla);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrirla(); });
  });
}

['fc-q', 'fc-prov', 'fc-avisos'].forEach(function (id) { $(id).addEventListener(id === 'fc-q' ? 'input' : 'change', pintarFacturasT); });
$('fc-refrescar').addEventListener('click', function () { cargarFacturasT(); if (FC.verHist) cargarHistorialFacturas(); });
$('fc-hist-b').addEventListener('click', function () { FC.verHist = !FC.verHist; pintarFacturasT(); if (FC.verHist) cargarHistorialFacturas(); });
$('fc-imprimir-b').hidden = !hayMouse();
$('fc-imprimir-b').addEventListener('click', function () { abrir('cimprimir'); });
$('fc-subir-b').addEventListener('click', function () { $('fc-subir').click(); });

/** "＋ Subir factura" (una que llegó en papel o por WhatsApp): PDF o foto, hasta 6 MB. Entra a Entrantes y la IA la lee. */
$('fc-subir').addEventListener('change', async function (e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const tipo = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : '');
  if (!/^application\/pdf$|^image\/(jpeg|png|webp)$/.test(tipo)) return aviso('La factura tiene que ser un PDF o una foto.', 'bad');
  if (f.size > 6 * 1024 * 1024) return aviso('El archivo pesa más de 6 MB.', 'bad');
  aviso('Subiendo la factura…');
  const base64 = await new Promise(function (ok, mal) {
    const fr = new FileReader();
    fr.onload = function () { ok(String(fr.result).replace(/^data:[^,]*,/, '')); };
    fr.onerror = mal;
    fr.readAsDataURL(f);
  });
  const x = await apiLenta('subirFacturaDoc', { id: 'SUB' + nuevoId(), nombre: f.name, tipo: tipo, base64: base64 });
  if (!x.ok) return aviso(x.sinConexion ? '📶 Poca señal: la factura se sube con señal. Probá de nuevo en un rato.' : x.error, 'bad');
  aviso('🤖 Leyendo la factura… (tarda unos segundos)');
  abrir('cdoc', { id: x.id });
  const l = await apiLenta('leerDocumentoAhora', x.id);
  if (l.ok && CD.id === x.id) { CD.d = l; pintarDoc(); }
  aviso(l.ok ? 'Listo: la factura está en Entrantes.' : 'La factura quedó en Entrantes; la IA la lee en un rato.');
  cargarFacturasT();
});

/* ---------- La tarjeta abierta (un documento) ---------- */
async function mostrarDoc(datos) {
  if (datos && datos.id && datos.id !== CD.id) { CD.id = datos.id; CD.d = null; $('cd-cuerpo').innerHTML = ''; }
  notaAd('cd-estado', CD.d ? '' : 'Cargando…');
  await cargarDoc();
}
async function cargarDoc() {
  const id = CD.id;
  if (!id) return;
  const r = await api('getDocumento', id);
  if (CD.id !== id) return;
  if (!r.ok) { notaAd('cd-estado', r.sinConexion ? '📶 Hace falta señal para abrir la factura.' : r.error); return; }
  CD.d = r;
  notaAd('cd-estado', '');
  pintarDoc();
}
function pintarDoc() {
  const d = CD.d;
  if (!d) return;
  $('b-titulo').textContent = d.enFacturas ? 'Factura' : 'Documento';
  $('cd-cuerpo').innerHTML = htmlDocumento(d, { tablero: d.enFacturas, lista: !d.enFacturas });
}

/** Los botones de la tarjeta de Facturas, según la columna (Feli, 16/11). Quien aprueba ve primero "Aprobar" / "No aprobar". */
function htmlAccionesFactura(d) {
  const col = d.columna, ap = d.tablero.aprobacion, b = function (que, txt, clase) { return '<button type="button" class="' + (clase || 'btn2') + '" data-fc="' + que + '">' + txt + '</button>'; };
  let h = '';
  if (ap && ap.estado === 'Esperando') {
    h += '<div class="caja fc-aprob' + (ap.aprueba === APP.yo.nombre ? ' tuya' : '') + '"><b>⏳ Esperando la aprobación de ' + esc(ap.aprueba) + '</b>' +
         '<small class="nota">La mandó ' + esc(ap.pidio) + ' el ' + esc(horaCorta(ap.fecha)) + (ap.nota ? ': «' + esc(ap.nota) + '»' : '') + '</small>' +
         (ap.aprueba === APP.yo.nombre ? '<div class="mf-botones">' + b('aprobar', '✅ Aprobar', 'btn') + b('noaprobar', '❌ No aprobar') + '</div>' : '') + '</div>';
  } else if (ap && ap.estado === 'No aprobada' && col === 'controlando') {
    h += '<div class="caja cx-sinorden"><b>❌ ' + esc(ap.decidio) + ' no la aprobó</b><small>' + esc(ap.motivo || '') + '</small></div>';
  } else if (ap && ap.estado === 'Aprobada' && col !== 'finalizado' && col !== 'historial') {
    h += '<p class="md-lugar">✅ La aprobó ' + esc(ap.decidio) + ' el ' + esc(horaCorta(ap.decidida)) + '.</p>';
  }
  const bs = [];
  if (col === 'entrantes') bs.push(b('controlando', 'Mandar a controlar'), b('aprobar-pedir', 'Mandar a aprobar'), b('lista', 'Lista para cargar'));
  else if (col === 'controlando') bs.push(b('aprobar-pedir', 'Mandar a aprobar'), b('lista', 'Lista para cargar'), b('entrantes', 'Volver a Entrantes', 'link-gris'));
  else if (col === 'aprobacion') bs.push(b('controlando', 'Mandar a controlar'), b('lista', 'Lista para cargar'));
  else if (col === 'lista') bs.push(b('cargada', 'Ya la cargué en Albor', 'btn'), b('controlando', 'Mandar a controlar'), b('aprobar-pedir', 'Mandar a aprobar'));
  else bs.push(b('entrantes', 'Volver a Entrantes'));
  if (col !== 'finalizado' && col !== 'historial') bs.push(b('compra', '🔗 Adjuntar a una orden de compra'), b('descartar', '🗑️ Descartar', 'link-gris'));
  return h + '<div class="mf-botones fc-acciones">' + bs.join('') + '</div>';
}

async function accionFactura(que) {
  const d = CD.d, id = d.id;
  let x;
  if (['controlando', 'lista', 'entrantes'].indexOf(que) !== -1) {
    if (que === 'lista' && d.columna === 'aprobacion' && !(await dialogo({ titulo: 'Lista para cargar', texto: 'Todavía espera la aprobación de ' + d.tablero.aprobacion.aprueba + '. ¿La pasás igual?',
        botones: [{ texto: 'Sí, pasarla', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }] }))) return;
    x = await api('moverFactura', id, que);
  } else if (que === 'aprobar-pedir') {
    const nombre = (FC.datos && FC.datos.aprueba) || d.aprueba || 'quien aprueba';
    const t = document.createElement('textarea');
    t.rows = 3; t.maxLength = 1000; t.placeholder = 'Por ejemplo: es el service del tractor, ¿lo aprobás?'; t.className = 'fc-msj';
    const v = await dialogo({ titulo: 'Mandar a aprobar', texto: 'A ' + nombre + ' le llega un WhatsApp con la factura y el link. Si querés, sumale un mensaje:', cuerpo: t, alAbrir: function () { t.focus(); },
      botones: [{ texto: '📨 Mandar', clase: 'btn', valor: function () { return { nota: t.value.trim() }; } }, { texto: 'Volver', valor: null }] });
    if (!v) return;
    aviso('Mandando…');
    x = await api('mandarAprobarFactura', id, { id: 'A' + nuevoId(), nota: v.nota });
    if (x.ok) aviso('📨 Listo: le llegó a ' + nombre + '.');
  } else if (que === 'aprobar') {
    x = await api('decidirAprobacionFactura', id, true, '');
    if (x.ok) aviso('✅ Aprobada: pasó a Lista para cargar.');
  } else if (que === 'noaprobar') {
    const c = document.createElement('input');
    c.type = 'text'; c.maxLength = 500; c.placeholder = 'Por qué no';
    const v = await dialogo({ titulo: '❌ No aprobar', texto: '¿Por qué no se aprueba? Vuelve a Controlando con el motivo como nota.', cuerpo: c, alAbrir: function () { c.focus(); },
      botones: [{ texto: 'No aprobar', clase: 'btn', valor: function () { return { m: c.value.trim() }; } }, { texto: 'Volver', valor: null }] });
    if (!v) return;
    x = await api('decidirAprobacionFactura', id, false, v.m);
  } else if (que === 'cargada') {
    const c = document.createElement('div');
    c.className = 'cuerpo';
    c.innerHTML = '<div class="campo"><label for="fc-ref">Referencia en Albor <small>(opcional)</small></label><input type="text" id="fc-ref" maxlength="40" autocomplete="off" placeholder="Ej: 2026-COM-6150"></div>';
    const v = await dialogo({ titulo: '¿Ya está cargada en Albor?', texto: 'Pasa a Finalizado (7 días; después, al Historial).', cuerpo: c,
      botones: [{ texto: 'Sí, ya está cargada', clase: 'btn', valor: function () { return { ref: $('fc-ref').value.trim() }; } }, { texto: 'Volver', valor: null }] });
    if (!v) return;
    x = await api('facturaCargadaAMano', id, v.ref);
  } else if (que === 'descartar') {
    const c = document.createElement('input');
    c.type = 'text'; c.maxLength = 500; c.placeholder = 'Por ejemplo: no es nuestra, ya estaba cargada';
    const v = await dialogo({ titulo: '🗑️ Descartar', texto: '¿Por qué se descarta? Va al Historial (desde ahí se puede volver a Entrantes).', cuerpo: c, alAbrir: function () { c.focus(); },
      botones: [{ texto: 'Descartar', clase: 'btn', valor: function () { return { m: c.value.trim() }; } }, { texto: 'Volver', valor: null }] });
    if (!v) return;
    x = await api('descartarFactura', id, v.m);
  } else if (que === 'compra') return elegirCompraDeFactura(d);
  if (!x) return;
  if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal.' : x.error, 'bad');
  cargarDoc();
  cargarFacturasT();
}

/** "Es de una compra…": las compras sin factura (primero las de ese proveedor); al elegir una, la factura pasa a Pedidos. */
async function elegirCompraDeFactura(d) {
  aviso('Buscando las órdenes de compra…');
  const r = await api('comprasParaFactura', d.id);
  if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal.' : r.error, 'bad');
  aviso('');
  // Feli (20/11): cada orden se despliega con lo que se compró y la razón del pedido; al final, las compras sin orden
  const c = document.createElement('div');
  c.className = 'cuerpo fc-compras';
  const una = function (x) {
    const q = sinTildes([x.orden, x.titulo, x.proveedor, x.cuit, (x.cuit || '').replace(/\D/g, ''), x.total, dinero(x.total, x.moneda), x.sitios.join(' '), x.donde,
      x.pedidos.map(function (p) { return [p.ref, p.titulo, p.razon, p.solicitante].join(' '); }).join(' '),
      x.productos.map(function (y) { return y.producto + ' ' + y.texto; }).join(' ')].join(' '));
    return '<details class="od-compra" data-q="' + esc(q) + '" data-grupo="' + (x.sinOrden ? 'sin' : 'con') + '"><summary><b>' + esc(x.orden ? 'OC ' + x.orden : x.titulo || x.id) + ' · ' + esc(x.proveedor || 'Sin proveedor') + '</b>' +
           (x.mismo ? ' <span class="tag">mismo CUIT</span>' : '') +
           '<small>' + esc([x.sitios.join(', '), razonesCompra(x), x.total !== null && x.total !== undefined ? dinero(x.total, x.moneda) + ' sin IVA' : '', x.donde, fechaCt(x.fecha)].filter(Boolean).join(' · ')) + '</small></summary>' +
           htmlDetalleCompra(x) + '<div class="mf-botones"><button type="button" class="btn" data-w="' + esc(x.id) + '">Adjuntar a esta</button></div></details>';
  };
  const con = r.compras.filter(function (x) { return !x.sinOrden; }), sin = r.compras.filter(function (x) { return x.sinOrden; });
  c.innerHTML = !r.compras.length ? '<p class="nota">No hay compras sin factura en Compradas ni en Recibidas.</p>' :
    (con.length ? con.map(una).join('') : '<p class="nota">No hay órdenes de compra sin factura.</p>') +
    (sin.length ? '<p class="od-sub" data-sub="sin">Compras sin orden de compra</p>' + sin.map(una).join('') : '');
  let elegida = null;
  await dialogo({ titulo: '¿A qué orden de compra la adjuntás?', cuerpo: c, botones: [{ texto: 'Volver', valor: null }],
    alAbrir: function () {
      if (r.compras.length) buscadorEnLista(c, 'Buscar por número de orden, proveedor, producto, sitio o razón…').focus();
      c.querySelectorAll('[data-w]').forEach(function (b) { b.addEventListener('click', function () { elegida = b.dataset.w; if (cerrarDialogoActual) cerrarDialogoActual(null); }); });
    } });
  if (!elegida) return;
  aviso('🔗 Adjuntando… (la compara con la compra)');
  const x = await apiLenta('elegirCompraMail', d.id, elegida);
  if (!x.ok) return aviso(x.sinConexion ? '📶 Hace falta señal.' : x.error, 'bad');
  aviso('Listo: la factura quedó en su compra (tablero de Pedidos).');
  MF.ordenes = null;
  cargarFacturasT();
  abrir('ctarjeta', { id: elegida });
}

$('s-cdoc').addEventListener('click', function (e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.fc) accionFactura(b.dataset.fc);
  else if (b.dataset.ver) verArchivo(b.dataset.ver);
  else if (b.dataset.vermail) verMailDoc(b.dataset.vermail, pintarDoc);
  else if (b.dataset.releer || b.dataset.papel) releerDocUI(b.dataset.releer || b.dataset.papel, !!b.dataset.papel, function (r) { CD.d = r; pintarDoc(); cargarFacturasT(); });
  else if (b.dataset.corregir) corregirDocUI(b.dataset.corregir, function (r) { CD.d = r; pintarDoc(); cargarFacturasT(); });
  else if (b.dataset.nota) agregarNotaUI(b, cargarDoc);
  else if (b.dataset.peg) accionPegado(b, function () { cargarDoc(); cargarFacturasT(); });
  else if (b.dataset.entablero) { if (CD.d && CD.d.enCompra) abrir('ctarjeta', { id: CD.d.enCompra.id }); }
  else if (b.dataset.irorden) irAOrden(b.dataset.irorden);
});

/* Al instante: el canal de siempre avisa cuando cambia algo (y sin canal, cada 20 s mientras se mira) */
alCambiar(function (c) {
  if (c.que !== 'tablero' && c.que !== 'conectado') return;
  const p = document.body.dataset.pantalla;
  if (p === 'cfac') cargarFacturasT();
});
// Los mails no avisan por el canal: el tablero de Facturas se pide cada 30 s mientras se mira
setInterval(function () {
  if (document.hidden) return;
  const p = document.body.dataset.pantalla;
  if (p === 'cfac') cargarFacturasT();
}, 30000);


/* ============================================================
   FASE 7, PASO 3-BIS (Feli, 14/11): LA IMPRESORA SOLA
   ------------------------------------------------------------
   En la compu de la impresora, un Chrome aparte abre la app con
   ?ap=contabilidad&impresora=1 y con --kiosk-printing (imprime sin
   preguntar). Cada minuto (y al tocar "Mirar ahora") pregunta qué
   facturas del mail hay para imprimir; cada una: la toma en el servidor
   (si otra compu la tomó, la saltea), arma el PDF con el original y la
   línea de arriba, la imprime y la marca. Lo que falla vuelve a la lista
   (hasta 3 veces). Solo facturas, solo el original.
   ============================================================ */
pantalla('cimpresora', { titulo: 'Impresora de facturas', tab: 'contabilidad', alMostrar: mostrarImpresora });
const K_COMPU_IMPRESORA = 'compras_impresora_compu';
const IP = { reloj: null, ocupada: false, pausada: false, hechas: [], esperan: 0, ultima: null, error: '' };

function nombreCompuImpresora() {
  let n = '';
  try { n = guardado.leer(K_COMPU_IMPRESORA) || ''; } catch (e) { n = ''; }
  return n || 'Compu de la impresora';
}

function mostrarImpresora() {
  pintarImpresora();
  if (!IP.reloj) {
    IP.reloj = setInterval(vueltaImpresora, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) vueltaImpresora(); });
  }
  vueltaImpresora();
}

function pintarImpresora() {
  $('ip-estado').textContent = IP.pausada ? '⏸️ Impresora de facturas: en pausa' : IP.ocupada ? '🖨️ Imprimiendo…' : '🖨️ Impresora de facturas: encendida';
  $('ip-pausa').textContent = IP.pausada ? '▶️ Seguir' : '⏸️ Pausar';
  $('ip-detalle').textContent = [nombreCompuImpresora(), IP.ultima ? 'Miró por última vez a las ' + new Date(IP.ultima).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '',
    IP.esperan ? IP.esperan + (IP.esperan === 1 ? ' factura espera' : ' facturas esperan') + ' que alguien la elija (no se sabe cuál es el original): se imprimen con «🖨️ Imprimir facturas»' : '',
    IP.error].filter(Boolean).join(' · ');
  $('ip-lista').innerHTML = IP.hechas.length ? '<p class="nota">Impresas en esta ventana:</p>' + IP.hechas.slice(0, 50).map(function (h) {
    return '<div class="ip-fila">' + esc(new Date(h.cuando).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })) + ' · ' + (h.ok ? '✅ ' : '⚠️ ') +
           esc((h.proveedor || 'Sin proveedor') + ' ' + (h.numero || h.nombre)) + (h.ok ? (h.entera ? ' (entera: no dice ORIGINAL)' : '') : ': ' + esc(h.error || 'no salió')) + '</div>';
  }).join('') : '<p class="nota">Todavía no imprimió nada en esta ventana.</p>';
}

/** Una vuelta: lo que hay para imprimir, de a una. */
async function vueltaImpresora() {
  if (IP.ocupada || IP.pausada) return;
  IP.ocupada = true;
  try {
    const r = await api('impresoraPendientes', nombreCompuImpresora());
    IP.ultima = Date.now();
    if (!r.ok) { IP.error = r.sinConexion ? '📶 Sin señal: sigue cuando vuelva' : r.error; return; }
    IP.error = ''; IP.esperan = r.esperan;
    for (let i = 0; i < r.listas.length && !IP.pausada; i++) await imprimirUnaSola(r.listas[i]);
  } finally {
    IP.ocupada = false;
    pintarImpresora();
  }
}

async function imprimirUnaSola(f) {
  const compu = nombreCompuImpresora();
  const t = await api('impresoraTomar', f.id, compu);
  if (!t.ok || !t.tomada) return;                  // otra compu la tomó (o ya salió)
  pintarImpresora();
  let ok = false, entera = false, error = '';
  try {
    await Promise.all([cargarPdfLib(), cargarPdfJs()]);
    const doc = await window.PDFLib.PDFDocument.create(), fuente = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);
    entera = (await sumarFactura(doc, fuente, f, await bajarFactura(f))).entera;
    await mandarAImprimir(new Blob([await doc.save()], { type: 'application/pdf' }));
    await new Promise(function (listo) { setTimeout(listo, 4000); });     // que la impresora la tome antes de la siguiente
    ok = true;
  } catch (e) { error = e.message || 'no se pudo armar'; }
  await api('impresoraLista', f.id, compu, ok, error);
  IP.hechas.unshift({ cuando: new Date().toISOString(), ok: ok, entera: entera, error: error, proveedor: f.proveedor, numero: f.numero, nombre: f.nombre });
  pintarImpresora();
}

$('ip-pausa').addEventListener('click', function () { IP.pausada = !IP.pausada; pintarImpresora(); if (!IP.pausada) vueltaImpresora(); });
$('ip-ahora').addEventListener('click', vueltaImpresora);
// Para instalarla (Feli, 14/11): imprime la última factura que llegó por mail, sin marcarla, para ver que sale sola y sin preguntar
$('ip-probar').addEventListener('click', async function () {
  const b = $('ip-probar');
  b.disabled = true;
  try {
    const r = await api('getFacturasImprimir');
    if (!r.ok) return aviso(r.sinConexion ? '📶 Hace falta señal.' : r.error, 'bad');
    const f = r.facturas.filter(function (x) { return x.donde === 'Mail'; }).sort(function (a, c) { return String(c.llego).localeCompare(String(a.llego)); })[0];
    if (!f) return aviso('Todavía no llegó ninguna factura por mail para probar.', 'bad');
    await Promise.all([cargarPdfLib(), cargarPdfJs()]);
    const doc = await window.PDFLib.PDFDocument.create(), fuente = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);
    await sumarFactura(doc, fuente, f, await bajarFactura(f));
    await mandarAImprimir(new Blob([await doc.save()], { type: 'application/pdf' }));
    aviso('🧪 Mandé a imprimir la factura ' + (f.numero || f.nombre) + ' de ' + (f.proveedor || 'un proveedor') + '. Si salió sin abrir ninguna ventana, la impresora está lista. (No queda marcada.)');
  } catch (e) {
    aviso(e.message || 'No se pudo imprimir la prueba.', 'bad');
  } finally { b.disabled = false; }
});
$('ip-compu').addEventListener('click', async function () {
  const campo = document.createElement('input');
  campo.type = 'text'; campo.maxLength = 60; campo.value = nombreCompuImpresora();
  const v = await dialogo({ titulo: 'El nombre de esta compu', texto: 'Queda en cada factura impresa («Impresa sola en …»).', cuerpo: campo,
    alAbrir: function () { campo.select(); }, botones: [{ texto: 'Guardar', clase: 'btn', valor: function () { return campo.value.trim(); } }, { texto: 'Volver', valor: null }] });
  if (v) { try { guardado.guardar(K_COMPU_IMPRESORA, v); } catch (e) { /* queda el de siempre */ } pintarImpresora(); }
});
