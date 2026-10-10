'use strict';
/* ============================================================
   SERVICIOS (Fase 3, Paso 2-ter)
   ------------------------------------------------------------
   Lo que hay que mandar a arreglar (ej. la motoguadaña). Se pide desde
   el formulario ("Servicio"): el encabezado de siempre, qué servicio,
   observaciones y adjuntos. No se cotiza desde la app: se maneja a mano.
   - Un tablero aparte, como el de Tareas: Entrantes → Por cotizar →
     Decisión → En armado/reparación → Para retirar → Finalizados
     (columnas_servicios, Feli 2026-10-04). En Decisión, "📨 Mandar a aprobar".
   - Filtros como los de Compras: Mis servicios / Todos, granja y responsable.
   - Los admins ven todos; los demás, los suyos. Lo mueven los admins y
     quien lo pidió (arrastrando o con "Mover a…").
   - La tarjeta abierta es la de los pedidos (tablero.js), sin productos:
     comentarios con @, adjuntos e historia, los mismos.
   Mover va por la bandeja (moverTarjeta, como un pedido).
   ============================================================ */

const K_SERVICIOS = 'nueva_servicios';     // lo último que mandó getServicios (para abrir sin señal)
const SV = { datos: guardado.leerJSON(K_SERVICIOS, null), filtros: { mios: false, sitio: '', resp: '' }, cargando: false };

pantalla('servicios', { titulo: 'Servicios', alMostrar: mostrarServicios });

function colsServicios() { return (SV.datos && SV.datos.columnas) || ['Entrantes', 'Por cotizar', 'Decisión', 'En armado/reparación', 'Para retirar', 'Finalizados']; }
function colFinalizadosServ() { const c = colsServicios(); return c[c.length - 1]; }
/** La tercera, como en Compras (Entrantes → Por cotizar → Decisión): ahí se manda a aprobar. */
function colDecisionServicio() { return colsServicios()[2] || 'Decisión'; }
function serviciosALaVista() { return !$('app').hidden && !$('s-servicios').hidden && !document.hidden; }
function puedoMoverServicio(t) { return !!t && (APP.yo.admin || t.solicitante === APP.yo.nombre || (t.compartido || []).indexOf(APP.yo.nombre) !== -1); }

/* ---------- Lo que se ve: lo del servidor + lo que espera en la bandeja ---------- */
function vistaServicios() {
  const l = SV.datos ? SV.datos.tarjetas.slice() : [];
  bandeja.lista().forEach(function (m) {
    if (m.fn !== 'moverTarjeta') return;
    const i = l.findIndex(function (x) { return x.ref === m.args[0]; });
    if (i < 0) return;
    const op = m.args[1] || {};
    if (colsServicios().indexOf(op.columna) === -1) return;
    insertarEn(l, Object.assign({}, l.splice(i, 1)[0], { columna: op.columna }), op.despuesDe);
  });
  return l;
}
function buscarServicio(ref) { return vistaServicios().filter(function (x) { return x.ref === ref; })[0] || null; }

(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (m.fn !== 'moverTarjeta' || !SV.datos || !SV.datos.tarjetas.some(function (x) { return x.ref === m.args[0]; })) return;
    cargarServicios();
    if (TB.abierta === m.args[0]) traerTarjeta(m.args[0]);
  };
})();

/* ---------- Tablero ---------- */
function mostrarServicios() {
  const admin = APP.yo.admin;
  // Los demás ya ven solo los suyos. Granja y responsable, como en Compras (Feli, 2026-10-04)
  $('sv-filtro').hidden = $('sv-sitio-l').hidden = $('sv-resp-l').hidden = !admin;
  if (admin) {
    $('sv-sitio').innerHTML = '<option value="">Ver todos</option>' +
      (APP.config.sitios || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    $('sv-resp').innerHTML = '<option value="">Ver todos</option><option value="-">Sin responsable</option>' +
      (APP.config.admins || []).map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('');
  }
  pintarFiltrosServicios();
  pintarServicios();
  cargarServicios();
}
function pintarFiltrosServicios() {
  $('sv-mios').setAttribute('aria-pressed', String(SV.filtros.mios));
  $('sv-todos').setAttribute('aria-pressed', String(!SV.filtros.mios));
  $('sv-sitio').value = SV.filtros.sitio;
  $('sv-resp').value = SV.filtros.resp;
}
function seVeServicio(t) {
  const f = SV.filtros;
  if (f.mios && t.solicitante !== APP.yo.nombre && (t.compartido || []).indexOf(APP.yo.nombre) === -1) return false;
  if (f.sitio && t.sitio !== f.sitio) return false;
  if (f.resp === '-' && t.responsable) return false;
  if (f.resp && f.resp !== '-' && t.responsable !== f.resp) return false;
  return true;
}
$('sv-sitio').addEventListener('change', function () { SV.filtros.sitio = this.value; pintarServicios(); });
$('sv-resp').addEventListener('change', function () { SV.filtros.resp = this.value; pintarServicios(); });
$('sv-mios').addEventListener('click', function () { SV.filtros.mios = true; pintarFiltrosServicios(); pintarServicios(); });
$('sv-todos').addEventListener('click', function () { SV.filtros.mios = false; pintarFiltrosServicios(); pintarServicios(); });

const CTX_SERVICIOS = { tb: function () { return $('servicios-tablero'); }, mover: function (r, d, a) { moverServicioA(r, d, a); }, repintar: function () { pintarServicios(); } };

function htmlServicio(t) {
  return '<div class="tarjeta" data-ref="' + esc(t.ref) + '" role="button" tabindex="0">' +
    (t.nuevo ? '<div class="nuevo-t">Nuevo</div>' : '') +                       // Feli (2026-10-06): nunca lo abriste
    '<div class="sobre">🔧 Servicio</div>' +
    (t.aprobacion === 'Esperando' ? '<div class="sobre">⏳ Esperando aprobación</div>' : '') +
    '<div class="t">' + esc(t.titulo || t.ref) + '</div>' +
    '<div class="pie"><span aria-label="' + esc(t.urgencia) + '">' + esc(emojiUrgencia(t.urgencia)) + '</span>' +
    '<span class="sitio">' + esc(t.sitio) + '</span>' +
    (t.responsable ? '<span class="resp" title="Responsable: ' + esc(t.responsable) + '">' + esc(inicial(t.responsable)) + '</span>' : '') +
    '</div></div>';
}

function pintarServicios() {
  const cont = $('servicios-tablero');
  if (!cont || !APP.yo) return;
  if (!SV.datos && SV.cargando) { cont.innerHTML = '<div class="vacio" style="margin:16px">Cargando los servicios…</div>'; return; }
  if (!SV.datos) { cont.innerHTML = '<div class="vacio" style="margin:16px">Hay poca señal: los servicios se ven cuando vuelva.</div>'; return; }
  const cols = colsServicios();
  const scroll = cont.scrollLeft, porCol = {};
  cols.forEach(function (c) { porCol[c] = []; });
  vistaServicios().forEach(function (t) {
    if (porCol[t.columna] && seVeServicio(t)) porCol[t.columna].push(t);
  });
  cont.innerHTML = cols.map(function (c, k) {
    const ts = ordenarPorFecha(porCol[c], ordenDe('sv:' + c));
    return '<div class="col" data-columna="' + esc(c) + '" data-seccion="Servicios">' +
      '<div class="col-h"><span class="sec">' + (k === 0 ? 'Servicios' : '') + '</span><b>' + esc(c) + '</b><span class="n">' + ts.length + '</span>' +
      (k === cols.length - 1 ? '<small class="nota" style="display:block;font-size:12px">Se ven 7 días; después, en Buscar</small>' : '') + '</div>' +
      '<div class="lista" data-columna="' + esc(c) + '">' +
      (ts.length ? ts.map(htmlServicio).join('') : '<div class="vacia">Sin servicios</div>') +
      '</div></div>';
  }).join('');
  cont.scrollLeft = scroll;
  cont.querySelectorAll('.tarjeta').forEach(function (el) {
    const ref = el.dataset.ref;
    el.addEventListener('click', function (e) {
      if (TB.recienArrastrada) { e.preventDefault(); return; }
      abrirTarjeta(ref);
    });
    if (puedoMoverServicio(buscarServicio(ref))) {
      el.addEventListener('touchstart', function (e) { tocar(e, el, ref, CTX_SERVICIOS); }, { passive: true });
      el.addEventListener('mousedown', function (e) { conMouse(e, el, ref, CTX_SERVICIOS); });
    }
  });
  pintarHaceServicios();
}

function pintarHaceServicios() {
  const el = $('sv-hace'), b = $('sv-refrescar');
  if (b) b.classList.toggle('girando', !!SV.cargando);
  if (el) el.textContent = SV.cargando ? 'Actualizando…' : (SV.datos && SV.datos.actualizado ? hace(SV.datos.actualizado) : '');
}

async function cargarServicios() {
  if (!APP.token) return;
  if (SV.cargando) { SV.otraVez = true; return; }
  SV.cargando = true;
  pintarHaceServicios();
  const r = await api('getServicios');
  SV.cargando = false;
  if (r.ok) {
    SV.datos = { columnas: r.columnas, tarjetas: r.tarjetas, version: r.version, actualizado: r.actualizado };
    guardado.guardarJSON(K_SERVICIOS, SV.datos);
    if (!TB.arrastre) pintarServicios();
  } else pintarServicios();
  pintarHaceServicios();
  if (SV.otraVez) { SV.otraVez = false; cargarServicios(); }
}
$('sv-refrescar').addEventListener('click', function () { cargarServicios(); });
setInterval(async function () {
  if (!serviciosALaVista() || TB.arrastre || SV.cargando || !SV.datos || !APP.token) return;
  let r;
  try { r = await llamar('versionTablero', [APP.token]); } catch (e) { return; }
  if (r.ok && r.version !== SV.datos.version) cargarServicios();
}, 8000);
document.addEventListener('visibilitychange', function () { if (serviciosALaVista()) cargarServicios(); });

function moverServicioA(ref, destino, despuesDe) {
  const t = buscarServicio(ref);
  if (!t || !puedoMoverServicio(t)) return pintarServicios();
  if (destino === t.columna && ordenDe('sv:' + destino)) return pintarServicios();
  bandeja.agregar('moverTarjeta', [ref, { columna: destino, despuesDe: despuesDe, desde: t.columna }],
                  (destino === t.columna ? 'reordenar "' : 'mover "') + t.titulo + '" a ' + destino);
  pintarServicios();
  if (TB.abierta === ref) pintarTarjeta();
}

async function moverServicioUI(ref) {
  const p = TB.detalle && TB.detalle.pedido;
  const t = buscarServicio(ref) || (p ? { ref: ref, titulo: p.titulo, columna: p.columna, solicitante: p.solicitante, compartido: p.compartido } : null);
  if (!t || !puedoMoverServicio(t)) return;
  const destino = await moverADialogo('Mover el servicio a…', t.columna, '', colsServicios().map(function (c) { return { columna: c, seccion: 'Servicios' }; }));
  if (!destino || destino === t.columna) return;
  if (!buscarServicio(ref)) {         // todavía no está en el tablero guardado: se manda igual
    bandeja.agregar('moverTarjeta', [ref, { columna: destino, despuesDe: '', desde: t.columna }], 'mover "' + t.titulo + '" a ' + destino);
    return pintarTarjeta();
  }
  moverServicioA(ref, destino, '');
}

/* ---------- La tarjeta de un servicio (en la ventana de tablero.js) ---------- */
function pintarServicioAbierto() {
  const ref = TB.abierta, d = TB.detalle, p = d ? d.pedido : null, v = buscarServicio(ref);
  const pv = p ? pedidoConCambios(ref, p) : null;
  let columna = v ? v.columna : (p ? p.columna : '…');
  bandeja.lista().forEach(function (m) { if (m.fn === 'moverTarjeta' && m.args[0] === ref) columna = (m.args[1] || {}).columna || columna; });
  const puede = puedoMoverServicio(v || (p ? { solicitante: p.solicitante, compartido: p.compartido } : null));
  const chip = $('tj-columna');
  chip.textContent = columna + (puede ? ' ⌄' : '');
  chip.disabled = !puede;
  chip.title = puede ? 'Mover a…' : '';
  $('tj-titulo').textContent = (pv && pv.titulo) || (v && v.titulo) || ref;
  const datos = [];
  const dato = function (etiqueta, html) { datos.push('<div class="dato"><small>' + esc(etiqueta) + '</small><div class="v">' + html + '</div></div>'); };
  dato('Sitio', esc((p && p.sitio) || (v && v.sitio) || ''));
  dato('Urgencia', esc((pv && pv.urgencia) || (v && v.urgencia) || ''));
  dato('Pidió', esc((p && p.solicitante) || (v && v.solicitante) || ''));
  if (p) dato('Cargado', esc(fechaLinda(p.fecha)));
  const resp = (p && p.responsable) || (v && v.responsable) || '';
  dato('Responsable', resp ? '<span class="resp">' + esc(inicial(resp)) + '</span> ' + esc(resp) : 'Sin responsable');
  $('tj-datos').innerHTML = datos.join('');
  $('tj-etiquetas').innerHTML = '<span class="etiqueta">🔧 Servicio</span>';
  ['tj-prod-b', 'tj-cot-b', 'tj-enlaces', 'tj-cancelar', 'tj-manual', 'tj-reabrir', 'tj-agregar'].forEach(function (id) { $(id).hidden = true; });
  $('tj-editar').hidden = !(APP.yo.admin && p);
  $('tj-editar').textContent = '✏️ Editar servicio';
  $('tj-razon').textContent = pv ? (pv.razon || '—') : (TB.sinDetalle || 'Cargando…');
  $('tj-razon-b').hidden = false;
  $('tj-desc-t').textContent = 'Observaciones';
  $('tj-desc-b').hidden = !(pv && pv.descripcion);
  if (pv && pv.descripcion) { $('tj-desc').textContent = pv.descripcion; $('tj-desc-editar').hidden = !APP.yo.admin; }
  pintarAprobacion();                              // "📨 Mandar a aprobar", en Decisión (cotizar.js)
  pintarAdjuntos();
  pintarActividad();
}
