'use strict';
/* ============================================================
   TABLERO (Fase 2, Paso 3)
   ------------------------------------------------------------
   - Secciones (Tanda verde, Cotización, Seguimiento) con sus columnas,
     una al lado de la otra; en el celular se desliza de costado.
   - Tarjeta: título, sitio, urgencia, inicial del responsable (y en
     "Por recibir", si hay que ir a buscarlo o nos lo traen). Las de la
     urgencia más alta (🔴), pintadas de rojo.
   - Filtros: Mis pedidos / Todos (los no admins entran con Mis pedidos),
     y para admins, granja y responsable.
   - Solo los admins mueven (arrastrando, o con la columna de la tarjeta
     abierta), asignan responsable, marcan la entrega y cancelan.
   - Todo cambio va por la bandeja de salida (base.js): se ve al instante,
     se manda cuando hay señal y un reintento no lo repite. Lo que se ve
     es lo último que mandó el servidor MÁS lo que está en la bandeja.
   - Tarjeta abierta (Paso 4): comentarios con @ (al mencionado le llega
     un WhatsApp) y, con "Ver detalles", la historia del pedido; tildar
     productos (comprado) y, los admins, editarlos y editar el pedido.
   ============================================================ */

const K_TABLERO = 'compras_tablero';      // lo último que mandó getTablero (para abrir sin señal)
const K_TARJETAS = 'compras_tarjetas';    // tarjetas abiertas hace poco (para verlas sin señal)
const OPS_TABLERO = { moverTarjeta: 1, asignarResponsable: 1, marcarEntrega: 1, cancelarPedido: 1, editarPedido: 1 };
const OPS_PARTE = { moverParte: 1, cancelarParte: 1, describirParte: 1, mandarTanda: 1 };   // mini tarjetas (Paso 4-bis)
const OPS_PRODUCTO = { tildarProducto: 1, editarProducto: 1, deshacerProducto: 1, agregarProducto: 1, quitarProducto: 1, resolverCambio: 1, reponerProducto: 1 };      // cambios de un producto (Paso 4)
const ENTREGA_TEXTO = { Retirar: '🏃 Hay que ir a buscarlo', Envío: '🚚 Nos lo traen' };
const ENTREGA_CORTO = { Retirar: '🏃 A buscar', Envío: '🚚 Nos lo traen' };

const TB = {
  datos: guardado.leerJSON(K_TABLERO, null),   // {columnas, tarjetas, porRecibir, actualizado}
  filtros: null,                               // {mios, sitio, resp}: se arman al entrar a la app
  arrastre: null,
  recienArrastrada: false,
  abierta: null,                               // ref de la tarjeta abierta
  detalle: null,                               // getTarjeta de la abierta
  cancelados: {},                              // tarjetas canceladas (para "Deshacer")
  reabiertos: {},                              // terminados que se reabren (Paso 5): la tarjeta hasta que vuelve del servidor
  borradores: {},                              // comentario a medio escribir, por tarjeta
  parte: null,                                 // mini tarjeta abierta adentro de la tarjeta (Paso 4-bis)
  cargando: false
};

pantalla('tablero', { titulo: 'Tablero', alMostrar: mostrarTablero });

/* ---------- Columnas ---------- */
function columnasTb() { return (TB.datos && TB.datos.columnas) || []; }
function colEntregado() {
  const seg = columnasTb().filter(function (c) { return c.seccion === 'Seguimiento'; });
  return seg.length ? seg[seg.length - 1].columna : '';
}
function colCancelado() {
  const c = ((APP.config && APP.config.columnas) || []).filter(function (x) { return x.seccion === 'Cerrado'; });
  return c.length ? c[0].columna : 'Cancelado';
}
function colPorRecibir() { return (TB.datos && TB.datos.porRecibir) || 'Por recibir'; }
function enTablero(columna) { return columnasTb().some(function (c) { return c.columna === columna; }); }

/* ---------- Lo que se ve: lo del servidor + lo que espera en la bandeja ---------- */
function insertarEn(lista, t, despuesDe) {
  const deCol = [];
  lista.forEach(function (x, k) { if (x.columna === t.columna) deCol.push(k); });
  let pos;
  if (!despuesDe) pos = deCol.length ? deCol[0] : lista.length;
  else {
    const k = lista.findIndex(function (x) { return x.ref === despuesDe && x.columna === t.columna; });
    pos = (despuesDe === '*' || k === -1) ? (deCol.length ? deCol[deCol.length - 1] + 1 : lista.length) : k + 1;
  }
  lista.splice(pos, 0, t);
}

/** Aplica un cambio (de la bandeja o ya confirmado) sobre una lista de tarjetas. */
function aplicarOp(lista, fn, args) {
  const ref = args[0];
  const i = lista.findIndex(function (x) { return x.ref === ref; });
  if (fn === 'moverTarjeta') {
    const op = args[1] || {};
    const guardada = TB.cancelados[ref] || TB.reabiertos[ref];
    let t = i >= 0 ? lista.splice(i, 1)[0] : (guardada ? Object.assign({}, guardada) : null);
    if (!t || !enTablero(op.columna)) return;
    t = Object.assign({}, t, { columna: op.columna });
    if (op.entrega !== undefined) t.entrega = op.entrega;
    insertarEn(lista, t, op.despuesDe);
  } else if (i >= 0) {
    if (fn === 'asignarResponsable') lista[i] = Object.assign({}, lista[i], { responsable: args[1] || '' });
    else if (fn === 'marcarEntrega') lista[i] = Object.assign({}, lista[i], { entrega: args[1] || '' });
    else if (fn === 'cancelarPedido') { TB.cancelados[ref] = lista[i]; lista.splice(i, 1); }
    else if (fn === 'editarPedido') {
      const c = args[1] || {}, t = Object.assign({}, lista[i]);
      if (c.titulo !== undefined) t.titulo = c.titulo;
      if (c.urgencia !== undefined) t.urgencia = c.urgencia;
      lista[i] = t;
    }
  }
}

function vista() {
  const l = TB.datos ? TB.datos.tarjetas.slice() : [];
  bandeja.lista().forEach(function (m) { if (OPS_TABLERO[m.fn]) aplicarOp(l, m.fn, m.args); });
  return l;
}
function buscarEnVista(ref) { return vista().filter(function (x) { return x.ref === ref; })[0] || null; }

// Cuando la bandeja manda un cambio del tablero: si salió bien, queda en lo del servidor;
// si no (ej. otro admin la movió antes), se trae el tablero de nuevo.
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (m.fn === 'comentar') return comentarioMandado(m, r);
    if (OPS_PRODUCTO[m.fn]) return productoMandado(m, r);
    if (m.fn === 'quitarAdjunto') return adjuntoQuitado(m, r);
    if (OPS_PARTE[m.fn]) return parteMandada(m, r);
    if (m.fn === 'editarPedido' && r.ok) datosDelPedidoMandados(m.args[0], m.args[1]);
    if (!OPS_TABLERO[m.fn]) return;
    if (r.ok && TB.datos) {
      aplicarOp(TB.datos.tarjetas, m.fn, m.args);
      guardado.guardarJSON(K_TABLERO, TB.datos);
    } else if (!r.ok) {
      cargarTablero();
    }
    if (!TB.arrastre) pintarTablero();
    if (TB.abierta) pintarTarjeta();
  };
})();

/* ---------- Filtros ---------- */
function armarFiltros() {
  const admin = APP.yo.admin;
  TB.filtros = { mios: !admin, sitio: '', resp: '', aprobar: false };   // pedido de Feli: los no admins entran con "Mis pedidos"
  const sitio = $('tb-sitio'), resp = $('tb-resp');
  $('tb-sitio-l').hidden = $('tb-resp-l').hidden = $('tb-aprobar').hidden = !admin;
  if (admin) {
    sitio.innerHTML = '<option value="">Ver todos</option>' +
      (APP.config.sitios || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    resp.innerHTML = '<option value="">Ver todos</option><option value="-">Sin responsable</option>' +
      (APP.config.admins || []).map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('');
  }
  pintarFiltros();
}
function pintarFiltros() {
  $('tb-mios').setAttribute('aria-pressed', String(TB.filtros.mios));
  $('tb-todos').setAttribute('aria-pressed', String(!TB.filtros.mios));
  $('tb-sitio').value = TB.filtros.sitio;
  $('tb-resp').value = TB.filtros.resp;
  $('tb-aprobar').setAttribute('aria-pressed', String(!!TB.filtros.aprobar));
}
function seVe(t) {
  const f = TB.filtros;
  if (f.mios && t.solicitante !== APP.yo.nombre) return false;
  if (f.sitio && t.sitio !== f.sitio) return false;
  if (f.resp === '-' && t.responsable) return false;
  if (f.resp && f.resp !== '-' && t.responsable !== f.resp) return false;
  if (f.aprobar && !t.paraAprobar) return false;
  return true;
}
$('tb-mios').addEventListener('click', function () { TB.filtros.mios = true; pintarFiltros(); pintarTablero(); });
$('tb-todos').addEventListener('click', function () { TB.filtros.mios = false; pintarFiltros(); pintarTablero(); });
$('tb-aprobar').addEventListener('click', function () { TB.filtros.aprobar = !TB.filtros.aprobar; pintarFiltros(); pintarTablero(); });
$('tb-sitio').addEventListener('change', function () { TB.filtros.sitio = this.value; pintarTablero(); });
$('tb-resp').addEventListener('change', function () { TB.filtros.resp = this.value; pintarTablero(); });

/* ---------- Dibujar ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function emojiUrgencia(u) {
  const primera = String(u || '').split(' ')[0];
  return /[☀-➿]|\uD83C|\uD83D|\uD83E/.test(primera) ? primera : String(u || '');
}
function inicial(nombre) { return String(nombre || '').trim().charAt(0).toUpperCase(); }

function mostrarTablero() {
  if (!TB.filtros) armarFiltros();
  subirAdjuntos();
  pintarTablero();
  cargarTablero();
  const h = decodeURIComponent(location.hash.slice(1));
  if (h && /^K/.test(h)) { if (APP.yo.admin) ir('tareas'); return; }     // link a una tarea: se abre en Tareas
  if (h && !TB.abierta) abrirTarjeta(h, true);
}

function pintarTablero() {
  const cont = $('tablero');
  if (!cont) return;
  const cols = columnasTb();
  if (!cols.length) {
    cont.innerHTML = '<div class="vacio" style="margin:16px">' +
      (TB.cargando ? 'Cargando el tablero…' : 'Hay poca señal: el tablero se ve cuando vuelva.') + '</div>';
    pintarSecciones();
    return;
  }
  const scroll = cont.scrollLeft, porCol = {}, listas = {};
  cont.querySelectorAll('.lista').forEach(function (l) { listas[l.dataset.columna] = l.scrollTop; });
  cols.forEach(function (c) { porCol[c.columna] = []; });
  vista().forEach(function (t) { if (porCol[t.columna] && seVe(t)) porCol[t.columna].push(t); });

  const admin = APP.yo && APP.yo.admin;
  const html = [];
  let seccionAnterior = '';
  cols.forEach(function (c) {
    const primera = c.seccion !== seccionAnterior;
    seccionAnterior = c.seccion;
    const ts = porCol[c.columna];
    html.push('<div class="col" data-columna="' + esc(c.columna) + '" data-seccion="' + esc(c.seccion) + '">' +
      '<div class="col-h"><span class="sec">' + (primera ? esc(c.seccion) : '') + '</span>' +
      '<b>' + esc(c.columna) + '</b><span class="n">' + ts.length + '</span>' + (c.seccion === 'Tanda verde' && admin ? htmlTandaCabecera(ts.length) : '') + '</div>' +
      '<div class="lista" data-columna="' + esc(c.columna) + '">' +
      (ts.length ? ts.map(function (t) { return htmlTarjeta(t, c.columna === colPorRecibir()); }).join('')
                 : '<div class="vacia">Sin pedidos</div>') +
      '</div></div>');
  });
  cont.innerHTML = html.join('');
  cont.scrollLeft = scroll;
  cont.querySelectorAll('.lista').forEach(function (l) { if (listas[l.dataset.columna]) l.scrollTop = listas[l.dataset.columna]; });
  const bt = $('tb-mandar-tanda');
  if (bt) bt.addEventListener('click', mandarTandaUI);
  cont.querySelectorAll('.tarjeta').forEach(function (el) {
    const ref = el.dataset.ref;
    el.addEventListener('click', function (e) {
      if (TB.recienArrastrada) { e.preventDefault(); return; }
      abrirTarjeta(ref);
    });
    if (admin) {
      el.addEventListener('touchstart', function (e) { tocar(e, el, ref); }, { passive: true });
      el.addEventListener('mousedown', function (e) { conMouse(e, el, ref); });
    }
  });
  pintarSecciones();
  pintarHace();
}

/** La urgencia más alta (la primera de App_Config, ej. 🔴): la tarjeta se pinta de rojo (pedido de Feli). */
function esUrgente(u) { const l = (APP.config && APP.config.urgencias) || []; return !!u && u === l[0]; }

function htmlTarjeta(t, enPorRecibir) {
  return '<div class="tarjeta' + (esUrgente(t.urgencia) ? ' urgente' : '') + '" data-ref="' + esc(t.ref) + '" role="button" tabindex="0">' +
    '<div class="t">' + esc(t.titulo || t.ref) + '</div>' +
    '<div class="pie"><span aria-label="' + esc(t.urgencia) + '">' + esc(emojiUrgencia(t.urgencia)) + '</span>' +
    '<span class="sitio">' + esc(t.sitio) + '</span>' +
    (enPorRecibir && t.entrega ? '<span class="entrega">' + esc(ENTREGA_CORTO[t.entrega] || t.entrega) + '</span>' : '') +
    (t.paraAprobar && APP.yo && APP.yo.admin ? '<span class="aprobar" title="Cambios para aprobar">⏳ ' + t.paraAprobar + '</span>' : '') +
    (t.responsable ? '<span class="resp" title="Responsable: ' + esc(t.responsable) + '">' + esc(inicial(t.responsable)) + '</span>' : '') +
    '</div></div>';
}

/* ---------- Secciones: saltar al principio de cada una ---------- */
function pintarSecciones() {
  const cont = $('tb-secciones');
  const secs = [];
  columnasTb().forEach(function (c) { if (secs.indexOf(c.seccion) === -1) secs.push(c.seccion); });
  if (cont.dataset.secs !== secs.join('|')) {
    cont.dataset.secs = secs.join('|');
    cont.innerHTML = secs.map(function (s) { return '<button type="button" role="tab" data-sec="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    cont.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        const col = $('tablero').querySelector('.col[data-seccion="' + b.dataset.sec + '"]');
        if (col) $('tablero').scrollTo({ left: col.offsetLeft - 12, behavior: 'smooth' });
      });
    });
  }
  marcarSeccion();
}
function marcarSeccion() {
  const tb = $('tablero');
  let actual = '';
  const cols = tb.querySelectorAll('.col');
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].offsetLeft + cols[i].offsetWidth / 2 >= tb.scrollLeft) { actual = cols[i].dataset.seccion; break; }
  }
  $('tb-secciones').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.sec === actual)); });
}
let marcando = false;
$('tablero').addEventListener('scroll', function () {
  if (marcando) return;
  marcando = true;
  requestAnimationFrame(function () { marcando = false; marcarSeccion(); });
}, { passive: true });

/* ---------- Traer del servidor ---------- */
async function cargarTablero() {
  if (!APP.token) return;
  if (TB.cargando) { TB.otraVez = true; return; }        // ya está trayendo: cuando termine, trae de nuevo
  TB.cargando = true;
  pintarHace();
  if (!TB.datos) pintarTablero();
  const r = await api('getTablero');
  TB.cargando = false;
  if (r.ok) {
    TB.datos = { columnas: r.columnas, tarjetas: r.tarjetas, porRecibir: r.porRecibir, version: r.version, actualizado: r.actualizado, tanda: r.tanda };
    guardado.guardarJSON(K_TABLERO, TB.datos);
    if (!TB.arrastre) pintarTablero();
    if (TB.abierta && TB.tipo !== 'tarea') { pintarTarjeta(); traerTarjeta(TB.abierta); }   // ej. un comentario nuevo de otro
  } else if (!TB.datos) pintarTablero();                  // sin señal: queda lo guardado
  pintarHace();
  if (TB.otraVez) { TB.otraVez = false; cargarTablero(); }
}
function pintarHace() {
  const el = $('tb-hace'), b = $('tb-refrescar');
  if (b) b.classList.toggle('girando', !!TB.cargando);
  if (el) el.textContent = TB.cargando ? 'Actualizando…' : (TB.datos && TB.datos.actualizado ? hace(TB.datos.actualizado) : '');
}
$('tb-refrescar').addEventListener('click', function () { cargarTablero(); });
function tableroALaVista() { return !$('app').hidden && !$('s-tablero').hidden && !document.hidden; }
// Lo que cambian los demás se ve en segundos: cada 8 s se pregunta si algo cambió (consulta
// liviana, no lee la planilla) y solo en ese caso se trae el tablero. Además, al volver a la
// app, al volver la señal, y por las dudas cada 2 minutos.
async function vigilarCambios() {
  if (!tableroALaVista() || TB.arrastre || TB.cargando || !TB.datos || !APP.token) return;
  let r;
  try { r = await llamar('versionTablero', [APP.token]); } catch (e) { return; }
  if (r.ok && r.version !== TB.datos.version) cargarTablero();
}
setInterval(vigilarCambios, 8000);
setInterval(function () { if (tableroALaVista() && !TB.arrastre) cargarTablero(); }, 120000);
setInterval(pintarHace, 30000);
document.addEventListener('visibilitychange', function () { if (tableroALaVista()) cargarTablero(); });
window.addEventListener('online', function () { if (tableroALaVista()) cargarTablero(); });

/* ---------- Mover (lo usan arrastrar y la tarjeta abierta) ---------- */
async function moverA(ref, destino, despuesDe) {
  const t = buscarEnVista(ref) || TB.reabiertos[ref];
  if (!t) return pintarTablero();
  const op = { columna: destino, despuesDe: despuesDe, desde: t.columna };
  if (destino !== t.columna && destino === colPorRecibir()) {
    const e = await preguntarEntrega(t.entrega);
    if (!e) return pintarTablero();
    op.entrega = e;
  }
  if (destino !== t.columna && destino === colEntregado()) {
    const d = await preguntarRetiro();
    if (!d) return pintarTablero();
    op.retiro = d.retiro;
    op.fechaRetiro = d.fecha;
  }
  const que = TB.reabiertos[ref] && !buscarEnVista(ref) ? 'reabrir "' : destino === t.columna ? 'reordenar "' : 'mover "';
  bandeja.agregar('moverTarjeta', [ref, op], que + t.titulo + '" a ' + destino);
  pintarTablero();
  if (TB.abierta === ref) pintarTarjeta();
}

/* ---------- Arrastrar (solo admins) ----------
   Celular: mantener apretada la tarjeta medio segundo y arrastrar; al borde
   de la pantalla pasa a la columna de al lado. Compu: arrastrar con el mouse. */
/** Qué tablero se arrastra: el de pedidos (por defecto) o el de tareas (tareas.js). */
const CTX_PEDIDOS = { tb: function () { return $('tablero'); }, mover: function (r, d, a) { moverA(r, d, a); }, repintar: function () { pintarTablero(); } };

function tocar(e, el, ref, ctx) {
  if (e.touches.length !== 1 || TB.arrastre) return;
  const x0 = e.touches[0].clientX, y0 = e.touches[0].clientY;
  let timer = setTimeout(function () {
    timer = null;
    empezarArrastre(el, ref, x0, y0, ctx);
    if (navigator.vibrate) navigator.vibrate(15);
  }, 400);
  const opciones = { passive: false };
  const mover = function (ev) {
    const p = ev.touches[0];
    if (TB.arrastre) { ev.preventDefault(); seguirArrastre(p.clientX, p.clientY); return; }
    if (timer && (Math.abs(p.clientX - x0) > 8 || Math.abs(p.clientY - y0) > 8)) { clearTimeout(timer); timer = null; }
  };
  const fin = function (ev) {
    if (timer) clearTimeout(timer);
    document.removeEventListener('touchmove', mover, opciones);
    document.removeEventListener('touchend', fin);
    document.removeEventListener('touchcancel', fin);
    if (TB.arrastre) soltarArrastre(ev.type === 'touchcancel');
  };
  document.addEventListener('touchmove', mover, opciones);
  document.addEventListener('touchend', fin);
  document.addEventListener('touchcancel', fin);
}

function conMouse(e, el, ref, ctx) {
  if (e.button !== 0 || TB.arrastre) return;
  const x0 = e.clientX, y0 = e.clientY;
  let empezo = false;
  const mover = function (ev) {
    if (!empezo && (Math.abs(ev.clientX - x0) > 5 || Math.abs(ev.clientY - y0) > 5)) { empezo = true; empezarArrastre(el, ref, x0, y0, ctx); }
    if (empezo) { ev.preventDefault(); seguirArrastre(ev.clientX, ev.clientY); }
  };
  const fin = function () {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', fin);
    if (empezo) soltarArrastre(false);
  };
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', fin);
}

function tarjetaAnterior(nodo, ignorar) {
  let p = nodo.previousElementSibling;
  while (p && !(p.classList.contains('tarjeta') && p !== ignorar)) p = p.previousElementSibling;
  return p ? p.dataset.ref : '';
}

function empezarArrastre(el, ref, x, y, ctx) {
  ctx = ctx || CTX_PEDIDOS;
  const r = el.getBoundingClientRect();
  const fantasma = el.cloneNode(true);
  fantasma.classList.add('arrastrando');
  fantasma.style.width = r.width + 'px';
  fantasma.style.left = r.left + 'px';
  fantasma.style.top = r.top + 'px';
  document.body.appendChild(fantasma);
  const hueco = document.createElement('div');
  hueco.className = 'hueco';
  hueco.style.height = r.height + 'px';
  el.parentNode.insertBefore(hueco, el);
  el.style.display = 'none';
  const tb = ctx.tb();
  tb.style.scrollSnapType = 'none';
  TB.arrastre = {
    ctx: ctx, ref: ref, el: el, fantasma: fantasma, hueco: hueco, dx: x - r.left, dy: y - r.top, x: x, y: y,
    origen: el.closest('.lista').dataset.columna, despuesDeOriginal: tarjetaAnterior(hueco, el)
  };
  document.body.classList.add('con-arrastre');
  requestAnimationFrame(autoDesplazar);
}

function seguirArrastre(x, y) {
  const a = TB.arrastre;
  if (!a) return;
  a.x = x; a.y = y;
  a.fantasma.style.left = (x - a.dx) + 'px';
  a.fantasma.style.top = (y - a.dy) + 'px';
  const bajo = document.elementFromPoint(x, y);
  const col = bajo && bajo.closest ? bajo.closest('.col') : null;
  if (!col) return;
  const lista = col.querySelector('.lista');
  const vacia = lista.querySelector('.vacia');
  if (vacia) vacia.remove();
  let antesDe = null;
  const ts = lista.querySelectorAll('.tarjeta');
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] === a.el) continue;
    const r = ts[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) { antesDe = ts[i]; break; }
  }
  if (antesDe) { if (a.hueco.nextElementSibling !== antesDe) lista.insertBefore(a.hueco, antesDe); }
  else if (a.hueco.parentNode !== lista || a.hueco !== lista.lastElementChild) lista.appendChild(a.hueco);
}

function autoDesplazar() {
  const a = TB.arrastre;
  if (!a) return;
  const tb = a.ctx.tb();
  const b = tb.getBoundingClientRect();
  let movio = false;
  const borde = a.x < b.left + 36 ? -1 : a.x > b.right - 36 ? 1 : 0;
  if (a.salto) {
    // Animación propia (el "smooth" del navegador se corta durante el arrastre)
    const p = Math.min(1, (Date.now() - a.salto.t0) / 280);
    tb.scrollLeft = a.salto.desde + (a.salto.hasta - a.salto.desde) * (1 - Math.pow(1 - p, 3));
    if (p >= 1) a.salto = null;
    movio = true;
  } else if (borde && window.innerWidth < 720) {
    // Celular: de a una columna, con una pausa para ver dónde quedó
    if (Date.now() > (a.proximoSalto || 0)) {
      const cols = Array.prototype.slice.call(tb.querySelectorAll('.col'));
      const actual = cols.findIndex(function (c) { return c.offsetLeft + c.offsetWidth / 2 >= tb.scrollLeft; });
      const destino = cols[Math.max(0, Math.min(cols.length - 1, actual + borde))];
      if (destino) a.salto = { desde: tb.scrollLeft, hasta: Math.max(0, destino.offsetLeft - 12), t0: Date.now() };
      a.proximoSalto = Date.now() + 900;
    }
  } else if (borde) {
    tb.scrollLeft += borde * 9;
    movio = true;
  }
  const lista = a.hueco.parentNode;
  if (lista && lista.classList.contains('lista')) {
    const l = lista.getBoundingClientRect();
    if (a.y < l.top + 36 && lista.scrollTop > 0) { lista.scrollTop -= 10; movio = true; }
    else if (a.y > l.bottom - 36) { lista.scrollTop += 10; movio = true; }
  }
  if (movio) seguirArrastre(a.x, a.y);
  requestAnimationFrame(autoDesplazar);
}

function soltarArrastre(cancelado) {
  const a = TB.arrastre;
  TB.arrastre = null;
  document.body.classList.remove('con-arrastre');
  a.fantasma.remove();
  a.ctx.tb().style.scrollSnapType = '';
  TB.recienArrastrada = true;
  setTimeout(function () { TB.recienArrastrada = false; }, 400);
  const lista = a.hueco.parentNode;
  if (cancelado || !lista) return a.ctx.repintar();
  const destino = lista.dataset.columna;
  const despuesDe = tarjetaAnterior(a.hueco, a.el);
  if (destino === a.origen && despuesDe === a.despuesDeOriginal) return a.ctx.repintar();
  a.ctx.mover(a.ref, destino, despuesDe);
}

/* ---------- Diálogos ---------- */
let cerrarDialogoActual = null;
/**
 * Diálogo simple. opciones: {titulo, texto, cuerpo (elemento), botones:[{texto, valor, clase, id}]}.
 * Devuelve una promesa con el valor del botón (o null si se cierra).
 */
function dialogo(o) {
  if (cerrarDialogoActual) cerrarDialogoActual(null);
  return new Promise(function (ok) {
    $('dg-titulo').textContent = o.titulo || '';
    $('dg-texto').textContent = o.texto || '';
    $('dg-texto').hidden = !o.texto;
    const cuerpo = $('dg-cuerpo');
    cuerpo.innerHTML = '';
    if (o.cuerpo) cuerpo.appendChild(o.cuerpo);
    cuerpo.hidden = !o.cuerpo;
    const bs = $('dg-botones');
    bs.innerHTML = '';
    const cerrar = function (v) {
      cerrarDialogoActual = null;
      $('dialogo').hidden = true;
      document.removeEventListener('keydown', teclas);
      if (!TB.abierta) document.body.classList.remove('modal-abierto');
      ok(v);
    };
    const teclas = function (e) { if (e.key === 'Escape') cerrar(null); };
    (o.botones || []).forEach(function (b) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.clase || 'btn2';
      btn.textContent = b.texto;
      if (b.id) btn.id = b.id;
      btn.addEventListener('click', function () { cerrar(typeof b.valor === 'function' ? b.valor() : b.valor); });
      bs.appendChild(btn);
    });
    cerrarDialogoActual = cerrar;
    $('dialogo').hidden = false;
    document.body.classList.add('modal-abierto');
    document.addEventListener('keydown', teclas);
    if (o.alAbrir) o.alAbrir();
  });
}
$('dialogo').addEventListener('click', function (e) { if (e.target === this && cerrarDialogoActual) cerrarDialogoActual(null); });

/** Lista de opciones para elegir una (columnas, responsables). */
function elegir(titulo, texto, grupos, actual) {
  const cont = document.createElement('div');
  cont.className = 'opciones';
  let resolver = null;
  grupos.forEach(function (g) {
    if (g.titulo) { const h = document.createElement('h4'); h.textContent = g.titulo; cont.appendChild(h); }
    g.opciones.forEach(function (op) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      b.textContent = op.texto;
      if (op.valor === actual) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', function () { resolver(op.valor); });
      cont.appendChild(b);
    });
  });
  const p = dialogo({ titulo: titulo, texto: texto, cuerpo: cont, botones: [{ texto: 'Volver', valor: null }] });
  resolver = function (v) { if (cerrarDialogoActual) cerrarDialogoActual(v); };
  return p;
}

function preguntarEntrega(actual) {
  return elegir('¿Cómo llega?', 'Pasa a "' + colPorRecibir() + '".', [{ opciones: [
    { texto: ENTREGA_TEXTO.Retirar, valor: 'Retirar' },
    { texto: ENTREGA_TEXTO.Envío, valor: 'Envío' }
  ] }], actual);
}

function hoyTexto() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function preguntarRetiro() {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  const nombres = (APP.config.usuarios || []).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  cuerpo.innerHTML = '<label for="dg-retiro">¿Quién lo retiró?</label>' +
    '<input type="text" id="dg-retiro" list="dg-nombres" autocomplete="off" placeholder="Nombre" style="width:100%;font:inherit;min-height:48px;border:1.5px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--bg);color:var(--fg)">' +
    '<datalist id="dg-nombres">' + nombres + '</datalist>' +
    '<label for="dg-fecha">¿Cuándo?</label><input type="date" id="dg-fecha" value="' + hoyTexto() + '" max="' + hoyTexto() + '">';
  return dialogo({
    titulo: 'Pasa a "' + colEntregado() + '"', cuerpo: cuerpo,
    botones: [
      { texto: 'Listo', clase: 'btn', id: 'dg-ok', valor: function () { return { retiro: $('dg-retiro').value.trim(), fecha: $('dg-fecha').value }; } },
      { texto: 'Volver', valor: null }
    ],
    alAbrir: function () {
      const ok = $('dg-ok'), input = $('dg-retiro');
      const revisar = function () { ok.disabled = !input.value.trim(); };
      input.addEventListener('input', revisar);
      revisar();
      input.focus();
    }
  });
}

/* ---------- Tarjeta abierta ---------- */
function detallesGuardados() { return guardado.leerJSON(K_TARJETAS, {}); }
function guardarDetalle(ref, d) {
  const todos = detallesGuardados();
  todos[ref] = { d: d, cuando: Date.now() };
  const refs = Object.keys(todos).sort(function (a, b) { return todos[b].cuando - todos[a].cuando; });
  refs.slice(40).forEach(function (r) { delete todos[r]; });   // las últimas 40
  guardado.guardarJSON(K_TARJETAS, todos);
}

async function abrirTarjeta(ref, sinHistoria) {
  if (!ref) return;
  TB.tipo = /^K/.test(ref) ? 'tarea' : 'pedido';     // las tareas (Paso 4-ter) usan la misma ventana
  if (TB.tipo === 'tarea' && !(APP.yo && APP.yo.admin)) return;
  TB.abierta = ref;
  const g = detallesGuardados()[ref];
  TB.detalle = g ? g.d : null;
  TB.parte = null;
  TB.sinDetalle = '';
  ponerBorrador(ref);
  pintarTarjeta();
  $('tarjeta-modal').hidden = false;
  $('tarjeta-modal').scrollTop = 0;
  document.body.classList.add('modal-abierto');
  // Con el "atrás" del celular se cierra la tarjeta; y el link #Ref abre la tarjeta (avisos por WhatsApp, Fase 3)
  if (!sinHistoria) history.pushState({ tarjeta: ref }, '', '#' + encodeURIComponent(ref));
  await traerTarjeta(ref);
}

/** Trae del servidor la tarjeta abierta (con la historia si "Ver detalles" está prendido). */
async function traerTarjeta(ref) {
  if (TB.trayendo === ref) { TB.traerOtraVez = true; return; }   // cuando termine, trae de nuevo
  TB.trayendo = ref;
  const conHistoria = verDetalles();
  const esTarea = /^K/.test(ref);
  const r = await api(esTarea ? 'getTarea' : 'getTarjeta', ref, { historia: conHistoria });
  TB.trayendo = null;
  if (TB.abierta !== ref) { TB.traerOtraVez = false; return; }
  if (r.ok && esTarea) {
    const antes = TB.detalle;
    TB.detalle = { tarea: r.tarea, items: r.items || [], recordatorios: r.recordatorios || [], comentarios: r.comentarios || [],
                   adjuntos: r.adjuntos || [], lineas: [], partes: [], historia: conHistoria ? r.historia : (antes ? antes.historia : undefined) };
    TB.sinDetalle = '';
    guardarDetalle(ref, TB.detalle);
  } else if (r.ok) {
    const antes = TB.detalle;
    TB.detalle = { pedido: r.pedido, lineas: r.lineas, comentarios: r.comentarios || [], adjuntos: r.adjuntos || [], partes: r.partes || [],
                   historia: conHistoria ? r.historia : (antes ? antes.historia : undefined) };
    TB.sinDetalle = '';
    guardarDetalle(ref, TB.detalle);
  } else if (r.sinConexion) TB.sinDetalle = TB.detalle ? '' : 'Hay poca señal: los productos se ven cuando vuelva.';
  else if (!r.sinSesion) TB.sinDetalle = r.error;
  pintarTarjeta();
  if (TB.traerOtraVez) { TB.traerOtraVez = false; traerTarjeta(ref); }
}

function ocultarTarjeta() {
  TB.abierta = null;
  TB.parte = null;
  TB.detalle = null;
  $('tarjeta-modal').hidden = true;
  document.body.classList.remove('modal-abierto');
}
function cerrarTarjeta() {
  if (history.state && history.state.tarjeta) history.back();   // popstate la oculta
  else {
    ocultarTarjeta();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }
}
window.addEventListener('popstate', function () {
  if (cerrarDialogoActual) cerrarDialogoActual(null);
  if (!$('tarjeta-modal').hidden) ocultarTarjeta();
});
// Un link #Ref con la app ya abierta (ej. el WhatsApp de una mención): abre esa tarjeta
window.addEventListener('hashchange', function () {
  const ref = decodeURIComponent(location.hash.slice(1));
  if (ref && APP.token && !$('app').hidden && TB.abierta !== ref) abrirTarjeta(ref, true);
});
$('tj-cerrar').addEventListener('click', cerrarTarjeta);
$('tarjeta-modal').addEventListener('click', function (e) { if (e.target === this) cerrarTarjeta(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && TB.abierta && !cerrarDialogoActual) cerrarTarjeta(); });

function fechaLinda(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric' }) + ' (' + hace(iso) + ')';
}

function idDrive(url) { const m = /[?&]id=([\w-]+)/.exec(url) || /\/d\/([\w-]+)/.exec(url); return m ? m[1] : ''; }

function pintarTarjeta() {
  const ref = TB.abierta;
  if (!ref) return;
  bloquesDeTarea(TB.tipo === 'tarea');
  if (TB.tipo === 'tarea') return pintarTareaAbierta();      // tareas.js
  const t = buscarEnVista(ref);
  const d = TB.detalle, p = d ? d.pedido : null;
  const admin = APP.yo.admin;
  const columna = t ? t.columna : (p ? p.columna : '');
  const enTb = !!t;

  const pts = d ? partesVista(ref) : [];
  let parte = TB.parte ? pts.filter(function (x) { return x.id === TB.parte; })[0] : null;
  if (TB.parte && d && !parte) TB.parte = null;
  if (TB.parte && !d) parte = null;
  const canceladoEntero = columna === colCancelado();
  const chip = $('tj-columna');
  const colChip = parte ? parte.columna : columna;
  const puedeMover = admin && (parte ? !canceladoEntero && parte.columna !== colCancelado() : enTb);
  chip.textContent = (colChip || '…') + (puedeMover ? ' ⌄' : '');
  chip.disabled = !puedeMover;
  chip.title = puedeMover ? 'Mover a…' : '';
  $('tj-volver').hidden = !parte;
  $('tj-titulo').textContent = parte ? tituloDeParte(d, parte) : ((t && t.titulo) || (p && p.titulo) || ref);

  const responsable = t ? t.responsable : (p ? p.responsable : '');
  const entrega = t ? t.entrega : (p ? p.entrega : '');
  const datos = [];
  const dato = function (etiqueta, html) { datos.push('<div class="dato"><small>' + esc(etiqueta) + '</small><div class="v">' + html + '</div></div>'); };
  dato('Sitio', esc((t && t.sitio) || (p && p.sitio) || ''));
  dato('Urgencia', esc((t && t.urgencia) || (p && p.urgencia) || ''));
  dato('Pidió', esc((t && t.solicitante) || (p && p.solicitante) || ''));
  if (p) dato('Cargado', esc(fechaLinda(p.fecha)));
  const respHtml = responsable ? '<span class="resp">' + esc(inicial(responsable)) + '</span> ' + esc(responsable) : 'Sin responsable';
  dato('Responsable', admin && enTb ? '<button type="button" class="boton-dato" id="tj-resp">' + respHtml + ' ⌄</button>' : respHtml);
  if (columna === colPorRecibir() || entrega) {
    dato('Cómo llega', admin && enTb
      ? ['Retirar', 'Envío'].map(function (e) {
          return '<button type="button" class="boton-dato" data-entrega="' + e + '" aria-pressed="' + (entrega === e) + '">' + esc(ENTREGA_TEXTO[e]) + '</button>';
        }).join(' ')
      : esc(ENTREGA_TEXTO[entrega] || 'Sin definir'));
  }
  if (parte && parte.retiro) dato('Retiró', esc(parte.retiro + (parte.fechaRetiro ? ' · ' + new Date(parte.fechaRetiro).toLocaleDateString('es-AR') : '')));
  else if (!parte && p && p.retiro) dato('Retiró', esc(p.retiro + (p.fechaRetiro ? ' · ' + new Date(p.fechaRetiro).toLocaleDateString('es-AR') : '')));
  $('tj-datos').innerHTML = datos.join('');

  const etiquetas = [];
  if ((t && t.masivo) || (p && p.origen === 'masivo')) etiquetas.push('Pedido masivo');
  if ((t && t.manual) || (p && p.manual)) etiquetas.push('✋ Gestión manual');
  if (!enTb && p && p.columna) etiquetas.push('Finalizado: ' + p.columna);
  if (parte) {
    etiquetas.unshift(parte.nombre);
    if (parte.manual) etiquetas.push('✋ Gestión manual');
    if (parte.columna === colCancelado()) etiquetas.push('Parte cancelada');
    if (parte.tanda) etiquetas.push(textoTanda(parte));
  }
  $('tj-etiquetas').innerHTML = etiquetas.map(function (e) { return '<span class="etiqueta">' + esc(e) + '</span>'; }).join('');

  const pv = p ? pedidoConCambios(ref, p) : null;
  $('tj-razon').textContent = pv ? (pv.razon || '—') : (TB.sinDetalle || 'Cargando…');
  $('tj-editar').hidden = !(admin && p) || !!parte;
  $('tj-desc-b').hidden = !parte;
  if (parte) {
    $('tj-desc').textContent = parte.descripcion || (admin ? 'Sin descripción.' : '—');
    $('tj-desc-editar').hidden = !admin;
  }
  const prods = $('tj-productos');
  if (d && d.lineas) {
    const todas = lineasConCambios(ref, d.lineas).filter(function (l) { return l.estado !== 'Rechazado' && l.estado !== 'Retirado'; });
    const ls = todas.filter(vigente);
    const comprados = ls.filter(function (l) { return l.tildado; }).length;
    const esperan = todas.filter(function (l) { return l.estado === 'Para agregar' || l.estado === 'Para quitar'; }).length;
    $('tj-prod-t').textContent = 'Productos (' + ls.length + ')' + (comprados ? ' · ' + comprados + ' comprado' + (comprados > 1 ? 's' : '') : '') +
      (esperan ? ' · ⏳ ' + esperan + ' para aprobar' : '');
    $('tj-varios').hidden = !(admin && ls.length > 1);
    // Los quitados, abajo de todo
    let orden = todas.filter(function (l) { return l.estado !== 'Quitado'; }).concat(todas.filter(function (l) { return l.estado === 'Quitado'; }));
    const mio = ((t && t.solicitante) || (p && p.solicitante)) === APP.yo.nombre;
    if (parte) orden = orden.filter(function (l) { return l.parte === parte.id; });
    if (!parte && pts.length > 1) prods.innerHTML = htmlPartes(ref, pts, orden, admin, mio, enTb && !canceladoEntero);   // Paso 4-bis
    else prods.innerHTML = orden.map(function (l) { return htmlProducto(l, admin, mio); }).join('');
    $('tj-agregar').hidden = !(admin || mio) || !enTb || !!parte;
    if (parte) $('tj-varios').hidden = true;
  } else {
    $('tj-varios').hidden = $('tj-agregar').hidden = true;
    $('tj-prod-t').textContent = 'Productos';
    prods.innerHTML = '<p class="nota">' + esc(TB.sinDetalle || 'Cargando…') + '</p>';
  }
  $('tj-cancelar').hidden = !(admin && enTb) || !!parte;
  $('tj-reabrir').hidden = !(admin && !enTb && p && p.volverA) || !!parte;     // Paso 5
  $('tj-cancelar-parte').hidden = !(admin && parte && enTb && parte.columna !== colCancelado());
  pintarAdjuntos();
  pintarActividad();

  prods.querySelectorAll('.tilde').forEach(function (b) {
    b.addEventListener('click', function () { tildar(ref, b.dataset.id); });
  });
  prods.querySelectorAll('.editar-prod').forEach(function (b) {
    b.addEventListener('click', function () { editarProducto(ref, b.dataset.id); });
  });
  prods.querySelectorAll('[data-cambio]').forEach(function (b) {
    b.addEventListener('click', function () { cambioDeProducto(ref, b.dataset.id, b.dataset.cambio); });
  });
  prods.querySelectorAll('[data-foto]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); verFoto(a.dataset.foto); });
  });
  prods.querySelectorAll('[data-mover-parte]').forEach(function (b) {
    b.addEventListener('click', function () { moverParteUI(ref, b.dataset.moverParte); });
  });
  prods.querySelectorAll('[data-abrir-parte]').forEach(function (b) {
    b.addEventListener('click', function () { abrirParte(b.dataset.abrirParte); });
  });
  const b = $('tj-resp');
  if (b) b.addEventListener('click', function () { cambiarResponsable(ref); });
  $('tj-datos').querySelectorAll('[data-entrega]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const v = btn.dataset.entrega;
      const actual = (buscarEnVista(ref) || {}).entrega;
      bandeja.agregar('marcarEntrega', [ref, actual === v ? '' : v], 'marcar cómo llega "' + ((buscarEnVista(ref) || {}).titulo || ref) + '"');
      pintarTablero(); pintarTarjeta();
    });
  });
}

$('tj-columna').addEventListener('click', async function () {
  const ref = TB.abierta;
  if (!ref || !APP.yo.admin) return;
  if (TB.tipo === 'tarea') return moverTareaUI(ref);
  if (TB.parte) return moverParteUI(ref, TB.parte);
  const t = buscarEnVista(ref);
  if (!t) return;
  const destino = await moverADialogo('Mover el pedido a…', t.columna, 'Se mueven también sus partes.');
  if (!destino || destino === t.columna) return;
  moverA(ref, destino, '');
});

/** "Mover a…" (Feli): una lista con todas las columnas y la siguiente ya elegida (o la elegida). Devuelve la columna o null. */
function moverADialogo(titulo, actual, nota, columnas, elegida, boton) {
  const cols = columnas || columnasTb();
  const i = cols.findIndex(function (c) { return c.columna === actual; });
  let sig = i === -1 ? cols[0] : cols[Math.min(cols.length - 1, i + 1)];
  // De la Tanda verde, lo que sigue es cotizar (no Entrantes)
  if (i !== -1 && cols[i].seccion === 'Tanda verde') sig = cols.filter(function (c) { return c.seccion === 'Cotización'; })[1] || sig;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  const grupos = [];
  cols.forEach(function (c) {
    let g = grupos.filter(function (x) { return x.s === c.seccion; })[0];
    if (!g) { g = { s: c.seccion, o: [] }; grupos.push(g); }
    g.o.push(c.columna);
  });
  cuerpo.innerHTML = '<label for="dg-col">Columna</label><select id="dg-col">' + grupos.map(function (g) {
    return '<optgroup label="' + esc(g.s) + '">' + g.o.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + (c === actual ? ' (está acá)' : '') + '</option>';
    }).join('') + '</optgroup>';
  }).join('') + '</select>' + (nota ? '<p class="nota">' + esc(nota) + '</p>' : '');
  return dialogo({
    titulo: titulo, texto: actual ? 'Está en "' + actual + '".' : '', cuerpo: cuerpo,
    botones: [{ texto: boton || 'Mover', clase: 'btn', id: 'dg-ok', valor: function () { return $('dg-col').value; } }, { texto: 'Volver', valor: null }],
    alAbrir: function () { $('dg-col').value = elegida || (sig ? sig.columna : actual); }
  });
}

async function cambiarResponsable(ref) {
  const t = buscarEnVista(ref);
  if (!t) return;
  const ops = [];
  if (APP.yo.admin) ops.push({ texto: '🙋 Me lo quedo (' + APP.yo.nombre + ')', valor: APP.yo.nombre });
  (APP.config.admins || []).forEach(function (a) { if (a !== APP.yo.nombre) ops.push({ texto: a, valor: a }); });
  ops.push({ texto: 'Sin responsable', valor: '-' });
  const v = await elegir('Responsable', 'El admin que gestiona el pedido (lo cotiza y lo compra).', [{ opciones: ops }], t.responsable || '-');
  if (!v) return;
  const nombre = v === '-' ? '' : v;
  if (nombre === (t.responsable || '')) return;
  bandeja.agregar('asignarResponsable', [ref, nombre], (nombre ? 'poner a ' + nombre + ' como responsable de "' : 'sacar el responsable de "') + t.titulo + '"');
  pintarTablero(); pintarTarjeta();
}

/** Reabrir un pedido terminado (Paso 5, solo admins): vuelve al tablero, a la columna que se elija. */
$('tj-reabrir').addEventListener('click', async function () {
  const ref = TB.abierta, p = TB.detalle && TB.detalle.pedido;
  if (!ref || !p || !APP.yo.admin || buscarEnVista(ref)) return;
  const destino = await moverADialogo('Reabrir el pedido', p.columna, 'Vuelve al tablero con sus partes, a la columna que elijas. Queda en la historia.', null, p.volverA, 'Reabrir');
  if (!destino) return;
  const pv = pedidoConCambios(ref, p);
  TB.reabiertos[ref] = { ref: ref, titulo: pv.titulo || p.titulo, sitio: p.sitio, urgencia: pv.urgencia || p.urgencia, columna: p.columna,
                         responsable: p.responsable, solicitante: p.solicitante, entrega: p.entrega, masivo: p.origen === 'masivo',
                         paraAprobar: 0, manual: p.manual };
  await moverA(ref, destino, '');
  if (buscarEnVista(ref)) avisoConBoton('Pedido reabierto: volvió a "' + destino + '".', 'Ver en el tablero', function () { cerrarTarjeta(); ir('tablero'); });
  if (typeof pintarResultados === 'function' && !$('s-buscar').hidden) pintarResultados();
});

$('tj-cancelar').addEventListener('click', async function () {
  const ref = TB.abierta, t = buscarEnVista(ref);
  if (!t) return;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-motivo">¿Por qué se cancela?</label><textarea id="dg-motivo" placeholder="Ej: ya no hace falta, se consiguió por otro lado…"></textarea>';
  const motivo = await dialogo({
    titulo: '¿Cancelar este pedido?',
    texto: '"' + t.titulo + '" (' + t.sitio + '). La tarjeta se va a mover a Finalizados. No se borra: se puede recuperar.',
    cuerpo: cuerpo,
    botones: [
      { texto: 'Sí, cancelar el pedido', clase: 'btn peligro-btn', id: 'dg-ok', valor: function () { return $('dg-motivo').value.trim(); } },
      { texto: 'No, volver', valor: null }
    ],
    alAbrir: function () {
      const ok = $('dg-ok'), m = $('dg-motivo');
      const revisar = function () { ok.disabled = m.value.trim().length < 3; };
      m.addEventListener('input', revisar);
      revisar();
      m.focus();
    }
  });
  if (!motivo) return;
  // Para "Deshacer": dónde estaba
  const l = vista().filter(function (x) { return x.columna === t.columna; });
  const k = l.findIndex(function (x) { return x.ref === ref; });
  const antes = { columna: t.columna, despuesDe: k > 0 ? l[k - 1].ref : '' };
  const clave = bandeja.agregar('cancelarPedido', [ref, motivo, t.columna], 'cancelar "' + t.titulo + '"');
  cerrarTarjeta();
  pintarTablero();
  avisoConBoton('Pedido cancelado: pasó a Finalizados.', 'Deshacer', function () {
    if (bandeja.pendiente(clave) && !bandeja.enviando) bandeja.quitar(clave);      // todavía no salió: se saca
    else bandeja.agregar('moverTarjeta', [ref, { columna: antes.columna, desde: colCancelado(), despuesDe: antes.despuesDe }], 'deshacer la cancelación de "' + t.titulo + '"');
    pintarTablero();
  });
});

/* ---------- Comentarios y actividad (Paso 4) ----------
   Del más nuevo al más viejo, como en Trello. "Ver detalles" suma la
   historia del pedido (App_Eventos); queda elegido en el dispositivo.
   El comentario va por la bandeja: sin señal queda con ⏳ y se manda solo.
   Con @ se menciona a alguien: el servidor le manda un WhatsApp. */
const K_VER_DETALLES = 'compras_ver_detalles';
const LARGO_COMENTARIO = 2000;
function verDetalles() { return guardado.leer(K_VER_DETALLES) === '1'; }
function nombreDe(usuario) {
  const u = String(usuario || '').replace(/^formulario:\s*/, '');
  return !u || u === 'recordatorios' || u === 'limpieza' || u === 'sistema' ? 'La app' : u;
}

function pintarActividad() {
  const ref = TB.abierta, d = TB.detalle, detalles = verDetalles();
  const bd = $('tj-detalles');
  bd.textContent = detalles ? 'Ocultar detalles' : 'Ver detalles';
  bd.setAttribute('aria-pressed', String(detalles));
  const items = [], ya = {};
  const aca = TB.parte || '';        // la tarjeta grande muestra lo general; cada mini tarjeta, lo suyo
  ((d && d.comentarios) || []).forEach(function (c) {
    ya[c.id] = true;
    if ((c.parte || '') === aca) items.push({ tipo: 'c', fecha: c.fecha, autor: c.autor, texto: c.texto });
  });
  // Los que esperan en la bandeja (sin señal, o saliendo)
  bandeja.lista().forEach(function (m) {
    if (m.fn === 'comentar' && m.args[0] === ref && !ya[m.args[2]] && (m.args[3] || '') === aca) items.push({ tipo: 'c', fecha: m.creado, autor: APP.yo.nombre, texto: m.args[1], espera: true });
  });
  if (detalles && d && d.historia) d.historia.forEach(function (e) {
    if (aca && !eventoDeParte(e, d, aca)) return;
    const f = fraseEvento(e, d);
    if (f) items.push({ tipo: 'e', fecha: e.fecha, autor: nombreDe(e.usuario), texto: f });
  });
  items.sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  let html = items.map(htmlActividad).join('');
  if (detalles && d && !d.historia) html += '<p class="nota">' + (APP.enLinea ? 'Cargando la historia…' : 'La historia se ve cuando vuelva la señal.') + '</p>';
  else if (!items.length && d) html = '<p class="nota">Todavía no hay comentarios.</p>';
  $('tj-actividad').innerHTML = html;
}

function htmlActividad(x) {
  const av = '<span class="av" aria-hidden="true">' + esc(inicial(x.autor)) + '</span>';
  const cuando = '<small title="' + esc(new Date(x.fecha).toLocaleString('es-AR')) + '">' + esc(hace(x.fecha)) + '</small>';
  if (x.tipo === 'e') return '<div class="act ev">' + av + '<div><b>' + esc(x.autor) + '</b> ' + esc(x.texto) + ' · ' + cuando + '</div></div>';
  return '<div class="act' + (x.espera ? ' espera' : '') + '">' + av + '<div class="act-c">' +
    '<div class="quien"><b>' + esc(x.autor) + '</b> ' +
    (x.espera ? '<small>' + (APP.enLinea ? 'Enviando…' : '⏳ Se manda solo cuando vuelva la señal') + '</small>' : cuando) + '</div>' +
    '<div class="burbuja">' + conMenciones(x.texto) + '</div></div></div>';
}

/** El texto con las menciones (@Nombre de un usuario) resaltadas. El nombre más largo gana. */
function conMenciones(texto) {
  const nombres = (APP.config.usuarios || []).slice().sort(function (a, b) { return b.length - a.length; })
    .map(function (n) { return esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  const h = esc(texto);
  if (!nombres.length) return h;
  return h.replace(new RegExp('@(' + nombres.join('|') + ')(?![0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ])', 'gi'),
                   function (m) { return '<span class="mencion">' + m + '</span>'; });
}

/** Un cambio de la historia, en palabras ("lo movió de Entrantes a Por cotizar"). */
function fraseEvento(e, d) {
  const a = e.antes, n = e.despues;
  if (e.entidad === 'pedido') {
    if (e.accion === 'crear') return 'cargó el pedido' + (/^formulario/.test(n) ? ' desde el formulario' : /^masivo/.test(n) ? ' como pedido masivo' : '');
    switch (e.campo) {
      case 'Columna':
        if (n === colCancelado()) return 'canceló el pedido';
        if (a === colCancelado()) return 'lo recuperó: volvió a ' + n;
        return 'lo movió de ' + a + ' a ' + n;
      case 'Responsable':
        if (!n) return 'sacó a ' + a + ' de responsable';
        return n === nombreDe(e.usuario) ? 'se anotó como responsable' : 'puso a ' + n + ' como responsable';
      case 'Entrega': return n ? 'marcó cómo llega: ' + (ENTREGA_TEXTO[n] || n) : 'borró cómo llega';
      case 'Retiró': return 'anotó que lo retiró ' + n;
      case 'Urgencia': return 'cambió la urgencia de ' + a + ' a ' + n;
      case 'Título': return 'cambió el título a "' + n + '"';
      case 'Razón': return 'cambió la razón del pedido';
    }
  }
  if (e.entidad === 'linea') {
    const l = ((d && d.lineas) || []).filter(function (x) { return x.id === e.id; })[0];
    const prod = l ? nombreProducto(l) : 'un producto';
    if (e.accion === 'crear') return (n === 'pedido de agregar' ? 'pidió agregar ' : 'agregó ') + prod;
    switch (e.campo) {
      case 'Estado':
        if (n === 'Para quitar') return 'pidió quitar ' + prod;
        if (n === 'Quitado') return (a === 'Para quitar' ? 'aprobó quitar ' : 'quitó ') + prod;
        if (n === 'Rechazado') return 'rechazó agregar ' + prod;
        if (n === 'Retirado') return 'retiró su pedido de agregar ' + prod;
        if (a === 'Para agregar') return 'aprobó agregar ' + prod;
        if (a === 'Para quitar') return 'dejó ' + prod + ' en el pedido';
        if (a === 'Quitado') return 'volvió a poner ' + prod;
        return '';
      case 'Tildado': return (n === 'SI' ? 'marcó como comprado: ' : 'desmarcó como comprado: ') + prod;
      case 'Familia': return a ? 'cambió el nombre de "' + a + '" a "' + n + '"' : 'le puso el nombre "' + n + '" a "' + (l ? l.texto : prod) + '"';
      case 'Canal': return n ? 'cambió el rubro de ' + prod + ' a ' + n : 'le sacó el rubro a ' + prod;
      case 'Especificación': return 'cambió la especificación de ' + prod + ' a "' + n + '"';
      case 'Cantidad': return 'cambió la cantidad de ' + prod + ' de ' + a + ' a ' + n;
      case 'Proveedores particulares': return n ? 'mandó ' + prod + ' solo a ' + n : 'le sacó los proveedores particulares (' + a + ') a ' + prod;
    }
    return 'cambió ' + String(e.campo).toLowerCase() + ' de ' + prod + (n ? ': "' + n + '"' : '');
  }
  if (e.entidad === 'tarea' || e.entidad === 'checklist' || e.entidad === 'recordatorio') return fraseDeTarea(e, d);   // tareas.js
  if (e.entidad === 'parte') {
    const pt = ((d && d.partes) || []).filter(function (x) { return x.id === e.id; })[0];
    const nom = pt ? pt.nombre : 'una parte';
    if (e.campo === 'Columna') {
      if (n === colCancelado()) return 'canceló la parte ' + nom;
      if (a === colCancelado()) return 'recuperó la parte ' + nom + ' (' + n + ')';
      return 'movió ' + nom + ' de ' + a + ' a ' + n;
    }
    if (e.campo === 'Descripción') return 'cambió la descripción de ' + nom;
    if (e.campo === 'Tanda') return 'mandó ' + nom + ' a cotizar con la Tanda verde';
    if (e.campo === 'Retiró') return 'anotó que ' + nom + ' lo retiró ' + n;
    if (e.campo === 'Entrega') return n ? 'marcó cómo llega ' + nom + ': ' + (ENTREGA_TEXTO[n] || n) : '';
    return '';
  }
  if (e.entidad === 'adjunto') {
    if (e.accion === 'crear') return 'adjuntó "' + n + '"';
    return e.campo === 'Estado' && n === 'Quitado' ? 'quitó un adjunto' : '';
  }
  if (!e.campo) return '';
  return 'cambió ' + String(e.campo).toLowerCase() + (n ? ' a "' + n + '"' : '');
}

$('tj-detalles').addEventListener('click', function () {
  const v = !verDetalles();
  guardado.guardar(K_VER_DETALLES, v ? '1' : '');
  pintarActividad();
  if (v && TB.abierta) traerTarjeta(TB.abierta);
});

/* Escribir un comentario, con @ para mencionar */
const cajaComentario = $('tj-comentario');
function ajustarCaja() {
  cajaComentario.style.height = 'auto';
  cajaComentario.style.height = Math.min(cajaComentario.scrollHeight + 3, 220) + 'px';
  $('tj-comentar').disabled = !cajaComentario.value.trim();
}
function ponerBorrador(ref) {
  cajaComentario.value = TB.borradores[ref] || '';
  $('tj-menciones').hidden = true;
  ajustarCaja();
}
function sinTildes(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

/** Lo que se está escribiendo después de un "@" (o null si no se está mencionando). */
function mencionEnCurso() {
  const pos = cajaComentario.selectionStart, antes = cajaComentario.value.slice(0, pos);
  const i = antes.lastIndexOf('@');
  if (i === -1 || (i > 0 && !/\s/.test(antes.charAt(i - 1)))) return null;
  const q = antes.slice(i + 1);
  if (q.length > 30 || /\n/.test(q)) return null;
  return { desde: i, hasta: pos, q: sinTildes(q) };
}
function sugerirMenciones() {
  const cont = $('tj-menciones'), m = mencionEnCurso();
  const lista = !m ? [] : (APP.config.usuarios || []).filter(function (n) {
    const s = sinTildes(n);
    return n !== APP.yo.nombre && (s.indexOf(m.q) === 0 || s.indexOf(' ' + m.q) !== -1);
  }).slice(0, 8);
  if (!lista.length) { cont.hidden = true; cont.innerHTML = ''; return; }
  cont.innerHTML = '<span class="nota">Mencionar:</span>' +
    lista.map(function (n) { return '<button type="button" class="mencion-op" data-n="' + esc(n) + '">' + esc(n) + '</button>'; }).join('');
  cont.hidden = false;
  cont.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });   // que no se cierre el teclado
    b.addEventListener('click', function () { ponerMencion(b.dataset.n); });
  });
}
function ponerMencion(nombre) {
  const m = mencionEnCurso();
  if (!m) return;
  const v = cajaComentario.value, texto = '@' + nombre + ' ';
  cajaComentario.value = v.slice(0, m.desde) + texto + v.slice(m.hasta);
  const p = m.desde + texto.length;
  cajaComentario.focus();
  cajaComentario.setSelectionRange(p, p);
  if (TB.abierta) TB.borradores[TB.abierta] = cajaComentario.value;
  ajustarCaja();
  sugerirMenciones();
}
cajaComentario.addEventListener('input', function () {
  if (TB.abierta) TB.borradores[TB.abierta] = this.value;
  ajustarCaja();
  sugerirMenciones();
});
cajaComentario.addEventListener('click', sugerirMenciones);
cajaComentario.addEventListener('keyup', function (e) { if (/^Arrow|Home|End/.test(e.key)) sugerirMenciones(); });
cajaComentario.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviarComentario(); }   // en la compu: Ctrl/Cmd + Enter
});
$('tj-comentar').addEventListener('click', enviarComentario);

function enviarComentario() {
  const ref = TB.abierta, texto = cajaComentario.value.trim();
  if (!ref || !texto) return;
  if (texto.length > LARGO_COMENTARIO) return aviso('El comentario es muy largo (máximo ' + LARGO_COMENTARIO + ' letras).', 'bad');
  const t = buscarEnVista(ref) || (TB.detalle && TB.detalle.pedido) || {};
  const corto = texto.length > 80 ? texto.slice(0, 80) + '…' : texto;
  bandeja.agregar('comentar', [ref, texto, 'C' + nuevoId(), TB.parte || ''], 'comentar en "' + (t.titulo || ref) + '": «' + corto + '»');
  cajaComentario.value = '';
  delete TB.borradores[ref];
  ajustarCaja();
  sugerirMenciones();
  pintarActividad();
}

// Sin señal, el comentario que espera dice "⏳ se manda solo"; con señal, "Enviando…"
function alCambiarLaSenal() { if (TB.abierta) { pintarActividad(); pintarAdjuntos(); } }

/** Respuesta de un comentario que salió de la bandeja. */
function comentarioMandado(m, r) {
  const ref = m.args[0];
  if (r.ok && r.comentario) {
    const poner = function (d) {
      if (d) d.comentarios = (d.comentarios || []).filter(function (c) { return c.id !== r.comentario.id; }).concat([r.comentario]);
    };
    const todos = detallesGuardados();
    if (todos[ref]) { poner(todos[ref].d); guardado.guardarJSON(K_TARJETAS, todos); }
    if (TB.abierta === ref) poner(TB.detalle);
    if (!document.hidden) {
      const lista = function (l) { return l.join(', ').replace(/, ([^,]*)$/, ' y $1'); };
      if (r.sinAviso && r.sinAviso.length) aviso('No le pudo llegar el WhatsApp a ' + lista(r.sinAviso) + '. El comentario quedó guardado igual.', 'bad');
      else if (r.avisados && r.avisados.length) aviso('📲 Le llegó un WhatsApp a ' + lista(r.avisados) + '.');
    }
  }
  if (TB.abierta === ref) pintarActividad();
}

/* ---------- Productos (Paso 4, parte 2) ----------
   Tildar = ya está comprado: pueden todos. Editar un producto (nombre,
   especificación, cantidad, rubro, proveedor particular) y los datos del
   pedido (título, urgencia, razón): solo admins. Todo por la bandeja: se
   ve al instante y sin señal se manda después. Crear un proveedor sí
   necesita señal (se comprueba que el número tenga WhatsApp). */
const K_PRODUCTOS = 'compras_productos';     // proveedores, rubros y nombres del padrón (datosProductos)
function nombreProducto(l) { return (l.familia || l.texto) + (l.especificacion ? ' (' + l.especificacion + ')' : ''); }

/** Los productos con lo que espera en la bandeja encima (como el tablero). */
function lineasConCambios(ref, lineas) {
  const ls = lineas.map(function (l) { return Object.assign({}, l); });
  const datos = TB.datosProd || guardado.leerJSON(K_PRODUCTOS, null);
  bandeja.lista().forEach(function (m) {
    if (!OPS_PRODUCTO[m.fn] || m.args[0] !== ref) return;
    if (m.fn === 'agregarProducto') {
      const a = m.args[1] || {}, f = datos && datos.familias.filter(function (x) { return x[0] === a.familia; })[0];
      ls.push({ id: 'espera-' + m.clave, texto: a.texto || a.familia, familia: f ? f[0] : '', canal: f ? f[1] : '', enPadron: !!f, familiaEnPadron: !!f,
                especificacion: a.especificacion || '', cantidad: String(a.cantidad), descripcion: a.descripcion || '', fotos: [], proveedores: [],
                estado: APP.yo.admin ? '' : 'Para agregar', propuso: APP.yo.nombre, espera: true, nuevo: true });
      return;
    }
    const l = ls.filter(function (x) { return x.id === m.args[1]; })[0];
    if (!l) return;
    l.espera = true;
    if (m.fn === 'tildarProducto') { l.tildado = !!m.args[2]; return; }
    if (m.fn === 'quitarProducto') { l.estado = APP.yo.admin ? 'Quitado' : 'Para quitar'; l.propuso = APP.yo.nombre; return; }
    if (m.fn === 'reponerProducto') { l.estado = ''; return; }
    if (m.fn === 'resolverCambio') {
      if (l.estado === 'Para agregar') l.estado = m.args[2] ? '' : 'Rechazado';
      else if (l.estado === 'Para quitar') l.estado = m.args[2] ? 'Quitado' : '';
      return;
    }
    let c = m.args[2] || {};
    if (m.fn === 'deshacerProducto') { c = (l.deshacer && l.deshacer.antes) || {}; l.deshacer = null; }
    else l.deshacer = null;           // el último cambio pasa a ser este (se ve bien cuando se guarda)
    if (c.especificacion !== undefined) l.especificacion = c.especificacion;
    if (c.cantidad !== undefined) l.cantidad = String(c.cantidad);
    if (c.familia !== undefined) {
      l.familia = c.familia;
      const f = datos && datos.familias.filter(function (x) { return x[0] === c.familia; })[0];
      l.familiaEnPadron = !!f;
      if (f && c.canal === undefined) l.canal = f[1];
    }
    if (c.canal !== undefined) l.canal = c.canal;
    if (c.proveedores !== undefined) {
      l.proveedores = c.proveedores.map(function (id) {
        const pr = datos && datos.proveedores.filter(function (x) { return x.id === id; })[0];
        return { id: id, nombre: pr ? pr.nombre : id };
      });
    }
    if (l.proveedores && l.proveedores.length) l.canal = '';
  });
  return ls;
}

function pedidoConCambios(ref, p) {
  const v = Object.assign({}, p);
  bandeja.lista().forEach(function (m) {
    if (m.fn !== 'editarPedido' || m.args[0] !== ref) return;
    const c = m.args[1] || {};
    ['titulo', 'urgencia', 'razon'].forEach(function (k) { if (c[k] !== undefined) v[k] = c[k]; });
  });
  return v;
}

function vigente(l) { return !l.estado || l.estado === 'Para quitar'; }

function htmlProducto(l, admin, mio) {
  const sub = [];
  // Lo que escribió el encargado, solo si el producto no estaba en el padrón (si lo eligió de la lista, no hace falta)
  if (!l.enPadron && l.familia && l.texto && l.texto.toLowerCase() !== l.familia.toLowerCase()) sub.push(esc('Escribió: "' + l.texto + '"'));
  const provs = l.proveedores || [];
  if (provs.length) sub.push('<span class="prov">🎯 Va solo a ' + esc(provs.map(function (x) { return x.nombre; }).join(', ')) + '</span>');
  else if (l.canal) sub.push(esc('Rubro: ' + l.canal));
  else sub.push(esc('Sin rubro'));
  if (l.descripcion) sub.push(esc(l.descripcion));
  const fotos = (l.fotos || []).map(function (u) {
    const id = idDrive(u);
    return id ? '<a href="https://drive.google.com/file/d/' + esc(id) + '/view" data-foto="' + esc(id) + '" aria-label="Ver foto">' +
                '<img src="https://drive.google.com/thumbnail?id=' + esc(id) + '&sz=w200" alt="Foto" loading="lazy"></a>' : '';
  }).join('');
  const fuera = l.familiaEnPadron === undefined ? !l.enPadron : !l.familiaEnPadron;
  const e = l.estado || '', suyo = l.propuso === APP.yo.nombre;
  const boton = function (texto, cambio, clase) {
    return l.nuevo ? '' : '<button type="button" class="' + (clase || 'btn-chico') + '" data-id="' + esc(l.id) + '" data-cambio="' + cambio + '">' + texto + '</button>';
  };
  // Pedidos de cambio: qué dice y qué botones tiene
  let nota = '', botones = '';
  if (e === 'Para agregar') {
    nota = '⏳ ' + esc(l.propuso) + ' pidió agregarlo: espera aprobación';
    if (admin) botones = boton('Aprobar', 'aprobar', 'btn-chico si') + boton('Rechazar', 'rechazar');
    else if (suyo) botones = boton('Retirar mi pedido', 'retirar');
  } else if (e === 'Para quitar') {
    nota = '⏳ ' + esc(l.propuso) + ' pidió quitarlo: espera aprobación';
    if (admin) botones = boton('Aprobar', 'aprobar', 'btn-chico si') + boton('Rechazar', 'rechazar');
    else if (suyo) botones = boton('Retirar mi pedido', 'retirar');
  } else if (e === 'Quitado') {
    nota = 'Quitado del pedido';
    if (admin) botones = boton('Volver a ponerlo', 'reponer');
  }
  const activo = vigente(l) && e !== 'Para agregar';
  return '<div class="producto' + (l.tildado ? ' tildado' : '') + (e === 'Para agregar' ? ' propuesto' : '') + (e === 'Quitado' ? ' quitado' : '') + '">' +
    '<button type="button" class="tilde" data-id="' + esc(l.id) + '" aria-pressed="' + !!l.tildado + '" aria-label="Comprado" title="' +
      (l.tildado ? 'Comprado (tocá para desmarcar)' : 'Marcar como comprado') + '"' + (activo && !l.nuevo ? '' : ' disabled') + '>✓</button>' +
    '<div class="prod-c"><b>' + esc(l.cantidad) + ' × ' + esc(nombreProducto(l)) + '</b>' +
    (l.tildado && activo ? '<span class="comprado">Comprado</span>' : '') +
    (fuera && e !== 'Quitado' ? '<span class="fuera">Fuera del padrón</span>' : '') +
    (l.espera ? '<span class="espera">' + (APP.enLinea ? 'Guardando…' : '⏳') + '</span>' : '') +
    (nota ? '<div class="cambio">' + nota + '</div>' : '') +
    (e === 'Quitado' ? '' : sub.map(function (x) { return '<div class="sub">' + x + '</div>'; }).join('')) +
    (fotos && e !== 'Quitado' ? '<div class="fotos">' + fotos + '</div>' : '') +
    (botones ? '<div class="cambio-b">' + botones + '</div>' : '') + '</div>' +
    (admin && activo && !l.nuevo ? '<button type="button" class="editar-prod" data-id="' + esc(l.id) + '" aria-label="Editar el producto" title="Editar">✏️</button>'
      : (!admin && mio && e === '' && !l.nuevo ? '<button type="button" class="editar-prod" data-id="' + esc(l.id) + '" data-cambio="quitar" aria-label="Pedir que lo quiten" title="Pedir que lo quiten">✕</button>' : '')) +
    '</div>';
}

/** Botones de los pedidos de cambio: quitar (encargado), aprobar/rechazar (admin), retirar (quien lo pidió). */
async function cambioDeProducto(ref, id, cambio) {
  const l = lineaVista(ref, id);
  if (!l) return;
  const nombre = '"' + nombreProducto(l) + '"';
  if (cambio === 'quitar') {
    const si = await dialogo({ titulo: '¿Pedir que quiten ' + nombre + '?', texto: 'Un admin lo tiene que aprobar. Mientras tanto sigue en el pedido.',
      botones: [{ texto: 'Sí, pedir que lo quiten', clase: 'btn', valor: true }, { texto: 'No, volver', valor: null }] });
    if (!si) return;
    bandeja.agregar('quitarProducto', [ref, id], 'pedir que quiten ' + nombre);
  } else if (cambio === 'aprobar' || cambio === 'rechazar') {
    const que = l.estado === 'Para agregar' ? (cambio === 'aprobar' ? 'aprobar que se agregue ' : 'rechazar que se agregue ')
                                             : (cambio === 'aprobar' ? 'aprobar que se quite ' : 'rechazar que se quite ');
    bandeja.agregar('resolverCambio', [ref, id, cambio === 'aprobar'], que + nombre);
  } else if (cambio === 'reponer') {
    bandeja.agregar('reponerProducto', [ref, id], 'volver a poner ' + nombre);
  } else if (cambio === 'quitarAdmin') {
    const si = await dialogo({ titulo: '¿Quitar ' + nombre + ' del pedido?', texto: 'No se borra: queda tachado y lo podés volver a poner.',
      botones: [{ texto: 'Sí, quitarlo', clase: 'btn peligro-btn', valor: true }, { texto: 'No, volver', valor: null }] });
    if (!si) return;
    bandeja.agregar('quitarProducto', [ref, id], 'quitar ' + nombre);
  } else if (cambio === 'retirar') {
    bandeja.agregar('resolverCambio', [ref, id, false], 'retirar tu pedido sobre ' + nombre);
  }
  pintarTarjeta();
}

/** Agregar un producto: el admin lo agrega directo; el encargado (en un pedido suyo) lo pide y un admin lo aprueba. */
async function agregarProductoAlPedido(ref) {
  const datos = await datosProductos();
  const familias = datos ? datos.familias : [];
  let elegida = null;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML =
    (APP.yo.admin ? '' : '<p class="nota">Un admin lo tiene que aprobar. Hasta entonces se ve en gris.</p>') +
    '<div class="campo"><label for="ap-nombre">Producto</label><input type="text" id="ap-nombre" autocomplete="off" placeholder="Buscalo o escribilo">' +
      '<div class="sugerencias" id="ap-nombres" hidden></div></div>' +
    '<div class="fila2"><div class="campo"><label for="ap-espec">Especificación</label><input type="text" id="ap-espec" autocomplete="off" placeholder="Medida, modelo…"></div>' +
      '<div class="campo"><label for="ap-cant">Cantidad</label><input type="text" id="ap-cant" inputmode="decimal" autocomplete="off"></div></div>' +
    '<div class="campo"><label for="ap-desc">Detalle (opcional)</label><input type="text" id="ap-desc" autocomplete="off" placeholder="Para qué es, marca…"></div>';
  const d = await dialogo({
    titulo: APP.yo.admin ? 'Agregar un producto' : 'Pedir agregar un producto', cuerpo: cuerpo,
    botones: [{ texto: APP.yo.admin ? 'Agregar' : 'Pedir que lo agreguen', clase: 'btn', id: 'dg-ok', valor: function () {
      const texto = $('ap-nombre').value.trim();
      return { familia: elegida && elegida === texto ? elegida : '', texto: texto, especificacion: $('ap-espec').value.trim(),
               cantidad: $('ap-cant').value.trim().replace(',', '.'), descripcion: $('ap-desc').value.trim() };
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const revisar = function () { $('dg-ok').disabled = !$('ap-nombre').value.trim() || !(Number($('ap-cant').value.trim().replace(',', '.')) > 0); };
      ['ap-nombre', 'ap-cant'].forEach(function (i) { $(i).addEventListener('input', revisar); });
      conSugerencias($('ap-nombre'), $('ap-nombres'), function (q) {
        if (!q) return [];
        return familias.filter(function (f) { return coincide(f[0], q); }).slice(0, 8).map(function (f) { return { texto: f[0], valor: f[0] }; });
      }, function (f) { $('ap-nombre').value = f; elegida = f; revisar(); $('ap-espec').focus(); });
      revisar();
      $('ap-nombre').focus();
    }
  });
  if (!d) return;
  bandeja.agregar('agregarProducto', [ref, d], (APP.yo.admin ? 'agregar ' : 'pedir que agreguen ') + '"' + d.texto + '"');
  pintarTarjeta();
}
$('tj-agregar').addEventListener('click', function () { if (TB.abierta) agregarProductoAlPedido(TB.abierta); });

function lineaVista(ref, id) {
  const d = TB.detalle;
  if (!d || !d.lineas) return null;
  return lineasConCambios(ref, d.lineas).filter(function (l) { return l.id === id; })[0] || null;
}

function tildar(ref, id) {
  const l = lineaVista(ref, id);
  if (!l) return;
  bandeja.agregar('tildarProducto', [ref, id, !l.tildado], (l.tildado ? 'desmarcar "' : 'marcar como comprado "') + nombreProducto(l) + '"');
  pintarTarjeta();
}

/** Respuesta de un cambio de producto que salió de la bandeja. */
function productoMandado(m, r) {
  const ref = m.args[0];
  if (r.ok && r.linea) {
    const poner = function (d) {
      if (!d || !d.lineas) return;
      if (d.lineas.some(function (l) { return l.id === r.linea.id; })) d.lineas = d.lineas.map(function (l) { return l.id === r.linea.id ? r.linea : l; });
      else d.lineas = d.lineas.concat([r.linea]);          // agregado
    };
    const todos = detallesGuardados();
    if (todos[ref]) { poner(todos[ref].d); guardado.guardarJSON(K_TARJETAS, todos); }
    if (TB.abierta === ref) poner(TB.detalle);
    if (r.titulo) {                   // cambiar un producto rehace el título (Feli)
      [todos[ref] && todos[ref].d, TB.abierta === ref ? TB.detalle : null].forEach(function (d) { if (d && d.pedido) d.pedido.titulo = r.titulo; });
      guardado.guardarJSON(K_TARJETAS, todos);
      if (TB.datos) {
        TB.datos.tarjetas.forEach(function (t) { if (t.ref === ref) t.titulo = r.titulo; });
        guardado.guardarJSON(K_TABLERO, TB.datos);
        if (!TB.arrastre) pintarTablero();
      }
    }
    if (r.padron && r.padron.length) TB.datosProd = null;     // el padrón cambió: la lista se trae de nuevo la próxima vez
    if (!document.hidden) {
      if (m.fn === 'deshacerProducto') aviso('Deshecho: ' + r.deshecho + (r.padron && r.padron.length ? '. En el padrón: ' + r.padron.join('; ') : '') + '.');
      else if (r.padron && r.padron.length) aviso('También quedó en el padrón: ' + r.padron.join('; ') + '.');
    }
  } else if (!r.ok && TB.abierta === ref) traerTarjeta(ref);
  if (TB.abierta === ref) pintarTarjeta();
}

function datosDelPedidoMandados(ref, c) {
  const poner = function (d) {
    if (!d || !d.pedido) return;
    ['titulo', 'urgencia', 'razon'].forEach(function (k) { if (c[k] !== undefined) d.pedido[k] = c[k]; });
  };
  const todos = detallesGuardados();
  if (todos[ref]) { poner(todos[ref].d); guardado.guardarJSON(K_TARJETAS, todos); }
  if (TB.abierta === ref) poner(TB.detalle);
}

/** Proveedores, rubros y nombres del padrón: se traen una vez por sesión y se guardan (sin señal, lo guardado). */
async function datosProductos() {
  if (TB.datosProd) return TB.datosProd;
  const r = await api('datosProductos');
  if (r.ok) {
    TB.datosProd = { proveedores: r.proveedores, canales: r.canales, familias: r.familias };
    guardado.guardarJSON(K_PRODUCTOS, TB.datosProd);
    return TB.datosProd;
  }
  return guardado.leerJSON(K_PRODUCTOS, null);
}

/** Lista de sugerencias debajo de un cuadro de texto. items(q) → [{texto, sub, valor}] */
function conSugerencias(input, cont, items, alElegir) {
  const pintar = function () {
    const l = items(sinTildes(input.value.trim()));
    cont.innerHTML = '';
    cont.hidden = !l.length;
    l.forEach(function (x) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = x.texto;
      if (x.sub) { const sm = document.createElement('small'); sm.textContent = x.sub; b.appendChild(sm); }
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { alElegir(x.valor); cont.hidden = true; });
      cont.appendChild(b);
    });
  };
  input.addEventListener('input', pintar);
  input.addEventListener('focus', pintar);
  return pintar;
}
function coincide(texto, q) { const s = sinTildes(texto); return !q || s.indexOf(q) === 0 || s.indexOf(' ' + q) !== -1; }

/**
 * Elegir proveedores particulares (uno o varios): buscador, los elegidos
 * con su ×, y crear uno nuevo (necesita señal: se comprueba el WhatsApp).
 * Lo usan "Editar producto" y "Proveedores para varios".
 *   htmlSelectorProv(): el HTML. armarSelectorProv(o): lo pone a andar.
 *   o = {provs (se cambia en el lugar), proveedores, datos, rubro(), alCambiar()}
 */
function htmlSelectorProv() {
  return '<div class="pila" id="sp-el" style="gap:6px"></div>' +
    '<input type="text" id="sp-q" autocomplete="off" placeholder="Buscá un proveedor para sumar">' +
    '<div class="sugerencias" id="sp-sug" hidden></div>' +
    '<button type="button" class="linkbtn" id="sp-nuevo-b" style="align-self:flex-start;padding:4px 0;min-height:36px">+ Crear un proveedor nuevo</button>' +
    '<div class="caja-nuevo" id="sp-nuevo" hidden>' +
      '<input type="text" id="sp-np-nombre" autocomplete="off" placeholder="Nombre del proveedor">' +
      '<input type="tel" id="sp-np-tel" autocomplete="off" placeholder="Teléfono: 5493525415029">' +
      '<p class="nota">Con código de país, sin 0 ni 15: 54 + 9 + código de área + número. Ejemplo: 5493525415029. Se comprueba que tenga WhatsApp.</p>' +
      '<p class="estado" id="sp-np-estado" hidden></p>' +
      '<button type="button" class="btn2" id="sp-np-crear">Crear y sumar</button>' +
    '</div>';
}
function armarSelectorProv(o) {
  const provs = o.provs;
  const pintar = function () {
    const el = $('sp-el');
    el.innerHTML = '';
    provs.forEach(function (x, k) {
      const d = document.createElement('div');
      d.className = 'elegido';
      d.innerHTML = '<span>🎯 ' + esc(x.nombre) + '</span><button type="button" aria-label="Sacar a ' + esc(x.nombre) + '">×</button>';
      d.querySelector('button').addEventListener('click', function () { provs.splice(k, 1); pintar(); });
      el.appendChild(d);
    });
    $('sp-nuevo-b').hidden = !o.datos;
    if (o.alCambiar) o.alCambiar();
  };
  const yaElegido = function (x) { return provs.some(function (y) { return y.id === x.id; }); };
  conSugerencias($('sp-q'), $('sp-sug'), function (q) {
    const rubro = o.rubro ? o.rubro() : '';
    const l2 = q ? o.proveedores.filter(function (x) { return coincide(x.nombre, q); })
                 : o.proveedores.filter(function (x) { return rubro && x.canales.indexOf(rubro) !== -1; });   // sin buscar: los del rubro
    return l2.filter(function (x) { return !yaElegido(x); }).slice(0, 8)
      .map(function (x) { return { texto: x.nombre, sub: x.canales.join(', '), valor: x }; });
  }, function (x) { provs.push({ id: x.id, nombre: x.nombre }); $('sp-q').value = ''; pintar(); });
  $('sp-nuevo-b').addEventListener('click', function () {
    $('sp-nuevo').hidden = false;
    $('sp-np-nombre').value = $('sp-q').value.trim();
    $('sp-np-nombre').focus();
  });
  $('sp-np-crear').addEventListener('click', async function () {
    const b = this, nombre = $('sp-np-nombre').value.trim(), tel = $('sp-np-tel').value.trim();
    if (nombre.length < 2 || !tel) return estado('sp-np-estado', 'Escribí el nombre y el teléfono.', 'bad');
    b.disabled = true;
    estado('sp-np-estado', 'Comprobando el número…', 'run');
    const r = await api('crearProveedor', nombre, tel);
    b.disabled = false;
    if (!r.ok) return estado('sp-np-estado', r.sinConexion ? 'Hay poca señal: para crear un proveedor hace falta señal. Probá en un rato.' : r.error, 'bad');
    estado('sp-np-estado', '');
    o.proveedores.push(r.proveedor);
    if (TB.datosProd && TB.datosProd.proveedores !== o.proveedores) { TB.datosProd.proveedores.push(r.proveedor); guardado.guardarJSON(K_PRODUCTOS, TB.datosProd); }
    provs.push({ id: r.proveedor.id, nombre: r.proveedor.nombre });
    $('sp-np-nombre').value = $('sp-np-tel').value = $('sp-q').value = '';
    $('sp-nuevo').hidden = true;
    pintar();
  });
  pintar();
}

async function editarProducto(ref, id) {
  const l = lineaVista(ref, id);
  if (!l || !APP.yo.admin) return;
  const datos = await datosProductos();
  const familias = datos ? datos.familias : [], proveedores = datos ? datos.proveedores.slice() : [];
  const canales = datos ? datos.canales.slice() : [];
  if (l.canal && canales.indexOf(l.canal) === -1) canales.push(l.canal);
  const provs = (l.proveedores || []).map(function (x) { return { id: x.id, nombre: x.nombre }; });
  const u = l.deshacer;

  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML =
    (u ? '<div class="caja-nuevo"><p class="nota" style="margin:0">Último cambio (' + esc(u.quien) + ', ' + esc(hace(u.cuando)) + '): <b>' + esc(u.resumen) + '</b></p>' +
         '<button type="button" class="btn2" id="ep-deshacer">↩ Deshacer este cambio</button></div>'
       : (l.espera ? '<p class="nota">Hay un cambio guardándose: para deshacerlo, esperá a que se guarde.</p>' : '')) +
    (l.texto ? '<p class="nota">El encargado escribió: «' + esc(l.texto) + '» (eso no se cambia)</p>' : '') +
    (datos ? '' : '<p class="estado warn">Hay poca señal: la lista de nombres y proveedores se ve cuando vuelva. Igual podés cambiar la especificación y la cantidad.</p>') +
    '<div class="campo"><label for="ep-nombre">Nombre del producto</label>' +
      '<input type="text" id="ep-nombre" autocomplete="off" placeholder="Buscá en el padrón o escribilo">' +
      '<div class="sugerencias" id="ep-nombres" hidden></div></div>' +
    '<div class="fila2"><div class="campo"><label for="ep-espec">Especificación</label><input type="text" id="ep-espec" autocomplete="off" placeholder="Medida, modelo…"></div>' +
      '<div class="campo"><label for="ep-cant">Cantidad</label><input type="text" id="ep-cant" inputmode="decimal" autocomplete="off"></div></div>' +
    '<div class="campo"><label for="ep-rubro">Rubro</label><select id="ep-rubro"></select><p class="nota" id="ep-rubro-nota" hidden>Con proveedores particulares va sin rubro: el pedido les llega solo a ellos.</p></div>' +
    '<div class="campo"><label for="sp-q">Proveedores particulares (opcional)</label>' + htmlSelectorProv() + '</div>' +
    '<button type="button" class="peligro" id="ep-quitar" style="margin-top:0;align-self:flex-start">Quitar este producto del pedido</button>' +
    '<p class="nota"><b>Solo en este pedido:</b> cambia este pedido. <b>También en el padrón:</b> además queda para los pedidos que vengan (nombre, rubro y proveedores; la especificación y la cantidad son de este pedido).</p>';

  const inicial = { familia: l.familia || '', especificacion: l.especificacion || '', cantidad: String(l.cantidad || ''), canal: l.canal || '',
                    proveedores: provs.map(function (x) { return x.id; }).join(',') };
  const cambios = function () {
    const c = {};
    const fam = $('ep-nombre').value.trim(), esp = $('ep-espec').value.trim(), cant = $('ep-cant').value.trim().replace(',', '.');
    if (fam && fam !== inicial.familia) c.familia = fam;
    if (esp !== inicial.especificacion) c.especificacion = esp;
    if (cant !== inicial.cantidad.replace(',', '.')) c.cantidad = cant;
    const ids = provs.map(function (x) { return x.id; });
    if (ids.join(',') !== inicial.proveedores) c.proveedores = ids;
    if (!ids.length) {
      const k = $('ep-rubro').value;
      if (k !== inicial.canal) c.canal = k;
    }
    return c;
  };

  const res = await dialogo({
    titulo: 'Editar producto', cuerpo: cuerpo,
    botones: [
      { texto: 'Solo en este pedido', clase: 'btn', id: 'dg-ok', valor: function () { return { c: cambios(), padron: false }; } },
      { texto: 'En este pedido y en el padrón', clase: 'btn2', id: 'dg-padron', valor: function () { return { c: cambios(), padron: true }; } },
      { texto: 'Volver', valor: null }
    ],
    alAbrir: function () {
      $('ep-nombre').value = inicial.familia;
      $('ep-espec').value = inicial.especificacion;
      $('ep-cant').value = inicial.cantidad;
      const sel = $('ep-rubro');
      sel.innerHTML = '<option value="">Sin rubro</option>' + canales.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
      sel.value = inicial.canal;
      const revisar = function () {
        const cant = Number($('ep-cant').value.trim().replace(',', '.'));
        const c = cambios(), nombre = $('ep-nombre').value.trim();
        sel.hidden = provs.length > 0;
        $('ep-rubro-nota').hidden = !provs.length;
        $('dg-ok').disabled = !(cant > 0) || Object.keys(c).length === 0;
        // Al padrón solo va nombre, rubro y proveedores (y hace falta un nombre)
        $('dg-padron').disabled = !(cant > 0) || !nombre || !(c.familia !== undefined || c.canal !== undefined || c.proveedores !== undefined);
      };
      ['ep-nombre', 'ep-espec', 'ep-cant'].forEach(function (i) { $(i).addEventListener('input', revisar); });
      sel.addEventListener('change', revisar);
      conSugerencias($('ep-nombre'), $('ep-nombres'), function (q) {
        if (!q) return [];
        return familias.filter(function (f) { return coincide(f[0], q); }).slice(0, 8)
          .map(function (f) { return { texto: f[0], sub: f[1] ? 'Rubro: ' + f[1] : 'Con proveedores particulares', valor: f }; });
      }, function (f) {
        $('ep-nombre').value = f[0];
        if (f[1] && !Array.prototype.some.call(sel.options, function (o) { return o.value === f[1]; })) sel.insertAdjacentHTML('beforeend', '<option>' + esc(f[1]) + '</option>');
        sel.value = f[1] || '';
        revisar();
      });
      if (u) $('ep-deshacer').addEventListener('click', function () { if (cerrarDialogoActual) cerrarDialogoActual({ deshacer: true }); });
      $('ep-quitar').addEventListener('click', function () { if (cerrarDialogoActual) cerrarDialogoActual({ quitar: true }); });
      armarSelectorProv({ provs: provs, proveedores: proveedores, datos: datos, rubro: function () { return sel.value; }, alCambiar: revisar });
    }
  });
  if (!res) return;
  if (res.quitar) return cambioDeProducto(ref, id, 'quitarAdmin');
  if (res.deshacer) {
    bandeja.agregar('deshacerProducto', [ref, id], 'deshacer el cambio de "' + nombreProducto(l) + '" (' + u.resumen + ')');
    return pintarTarjeta();
  }
  if (!Object.keys(res.c).length) return;
  bandeja.agregar('editarProducto', [ref, id, res.c, { padron: res.padron }],
                  'cambiar "' + nombreProducto(l) + '"' + (res.padron ? ' (también en el padrón)' : ''));
  pintarTarjeta();
}

/** Proveedores particulares para varios productos del pedido a la vez (solo en este pedido). */
async function proveedoresParaVarios(ref) {
  const d = TB.detalle;
  if (!d || !d.lineas || !APP.yo.admin) return;
  const ls = lineasConCambios(ref, d.lineas);
  const datos = await datosProductos();
  const proveedores = datos ? datos.proveedores.slice() : [];
  const elegidos = {}, provs = [];
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML =
    (datos ? '' : '<p class="estado warn">Hay poca señal: la lista de proveedores se ve cuando vuelva.</p>') +
    '<div class="campo"><div style="display:flex;align-items:center;justify-content:space-between"><label>Productos</label>' +
      '<button type="button" class="linkbtn" id="pv-todos" style="padding:4px 0;min-height:36px">Elegir todos</button></div>' +
      '<div class="opciones" id="pv-prods" style="max-height:40vh"></div></div>' +
    '<div class="campo"><label for="sp-q">Proveedores particulares</label>' + htmlSelectorProv() + '</div>' +
    '<p class="nota">Solo en este pedido. Los productos elegidos quedan "🎯 Va solo a…" y sin rubro. Sin ningún proveedor, les saca los que tengan y vuelven a su rubro.</p>';
  const res = await dialogo({
    titulo: 'Proveedores para varios productos', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () { return true; } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const cont = $('pv-prods');
      const revisar = function () {
        const n = Object.keys(elegidos).length;
        $('dg-ok').disabled = !n;
        $('dg-ok').textContent = !n ? 'Guardar' : provs.length ? 'Guardar en ' + n + ' producto' + (n > 1 ? 's' : '') : 'Sacarles los proveedores (' + n + ')';
        $('pv-todos').textContent = n === ls.length ? 'Ninguno' : 'Elegir todos';
      };
      ls.forEach(function (l) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice';
        b.setAttribute('aria-checked', 'false');
        const provTxt = (l.proveedores || []).length ? ' · 🎯 ' + l.proveedores.map(function (x) { return x.nombre; }).join(', ') : (l.canal ? ' · ' + l.canal : '');
        b.innerHTML = '<span aria-hidden="true" class="marca">☐</span><span>' + esc(l.cantidad + ' × ' + nombreProducto(l)) + '<small style="display:block;color:var(--muted);font-weight:400">' + esc(provTxt.replace(/^ · /, '')) + '</small></span>';
        b.addEventListener('click', function () {
          if (elegidos[l.id]) delete elegidos[l.id]; else elegidos[l.id] = l;
          b.setAttribute('aria-checked', String(!!elegidos[l.id]));
          b.querySelector('.marca').textContent = elegidos[l.id] ? '☑' : '☐';
          revisar();
        });
        cont.appendChild(b);
      });
      $('pv-todos').addEventListener('click', function () {
        const todos = Object.keys(elegidos).length !== ls.length;
        cont.querySelectorAll('.choice').forEach(function (b, k) {
          if (todos) elegidos[ls[k].id] = ls[k]; else delete elegidos[ls[k].id];
          b.setAttribute('aria-checked', String(todos));
          b.querySelector('.marca').textContent = todos ? '☑' : '☐';
        });
        revisar();
      });
      armarSelectorProv({ provs: provs, proveedores: proveedores, datos: datos, rubro: function () { return ''; }, alCambiar: revisar });
    }
  });
  if (!res) return;
  const ids = provs.map(function (x) { return x.id; });
  Object.keys(elegidos).forEach(function (id) {
    const l = elegidos[id];
    if ((l.proveedores || []).map(function (x) { return x.id; }).join(',') === ids.join(',')) return;   // ya estaba así
    bandeja.agregar('editarProducto', [ref, id, { proveedores: ids }, { padron: false }], 'cambiar los proveedores de "' + nombreProducto(l) + '"');
  });
  pintarTarjeta();
}

$('tj-varios').addEventListener('click', function () { if (TB.abierta) proveedoresParaVarios(TB.abierta); });

$('tj-editar').addEventListener('click', async function () {
  if (TB.tipo === 'tarea') return editarTareaUI(TB.abierta);
  const ref = TB.abierta, d = TB.detalle;
  if (!ref || !d || !d.pedido || !APP.yo.admin) return;
  const t = buscarEnVista(ref);
  const p = pedidoConCambios(ref, Object.assign({}, d.pedido, t ? { titulo: t.titulo, urgencia: t.urgencia } : {}));
  let urgencia = p.urgencia;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<div class="campo"><label for="eq-titulo">Título</label><input type="text" id="eq-titulo" maxlength="200" autocomplete="off">' +
    '<p class="nota">Cambia solo el título: los productos quedan como están. Si después se cambia un producto, el título se vuelve a armar con los productos.</p></div>' +
    '<div class="campo"><label>Urgencia</label><div class="urgencias-el" id="eq-urg"></div></div>' +
    '<div class="campo"><label for="eq-razon">Razón del pedido</label><textarea id="eq-razon" maxlength="2000"></textarea></div>';
  const c = await dialogo({
    titulo: 'Editar pedido', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      const c = {}, ti = $('eq-titulo').value.trim(), ra = $('eq-razon').value.trim();
      if (ti !== p.titulo) c.titulo = ti;
      if (urgencia !== p.urgencia) c.urgencia = urgencia;
      if (ra !== (p.razon || '')) c.razon = ra;
      return c;
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      $('eq-titulo').value = p.titulo || '';
      $('eq-razon').value = p.razon || '';
      const urg = $('eq-urg');
      const pintarUrg = function () {
        urg.innerHTML = (APP.config.urgencias || []).map(function (u) {
          return '<button type="button" data-u="' + esc(u) + '" aria-pressed="' + (u === urgencia) + '">' + esc(u) + '</button>';
        }).join('');
        urg.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { urgencia = b.dataset.u; pintarUrg(); revisar(); }); });
      };
      const revisar = function () { $('dg-ok').disabled = !$('eq-titulo').value.trim() || !$('eq-razon').value.trim(); };
      $('eq-titulo').addEventListener('input', revisar);
      $('eq-razon').addEventListener('input', revisar);
      pintarUrg();
      revisar();
    }
  });
  if (!c || !Object.keys(c).length) return;
  bandeja.agregar('editarPedido', [ref, c], 'cambiar los datos de "' + (p.titulo || ref) + '"');
  pintarTablero();
  pintarTarjeta();
});

/* ---------- Adjuntos: fotos y PDFs en la tarjeta (Paso 4, parte 4) ----------
   Pueden adjuntar todos. El archivo queda primero en el teléfono
   (IndexedDB, con PedidosGuardados) y se sube solo cuando hay señal, como
   las fotos del formulario: cada uno con su número ("J…"), así un
   reintento no lo sube dos veces. Van a la carpeta del pedido en Drive.
   Quitar: quien lo subió o un admin (el archivo no se borra de Drive). */
const K_ADJUNTOS = 'compras_adjuntos';     // los que esperan subir: [{id, ref, nombre, tipo, creado, token, intentos}]
const ADJUNTO_MAX_MB = 10;
const ADJ = { subiendo: false, urls: {} };  // urls: vista previa de los que esperan (mientras la app está abierta)
function adjPendientes() { return guardado.leerJSON(K_ADJUNTOS, []); }
function guardarAdjPendientes(l) { guardado.guardarJSON(K_ADJUNTOS, l); APP.adjuntosPendientes = l.length; pintarSinRed(); }

function blobABase64(blob) {
  return new Promise(function (ok, bad) {
    const r = new FileReader();
    r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
    r.onerror = bad;
    r.readAsDataURL(blob);
  });
}
// Las fotos se achican en el teléfono antes de subir (máx. 1600 px, JPEG), como en el formulario
function comprimirFoto(file) {
  return new Promise(function (ok, bad) {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = function () {
      const r = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) { URL.revokeObjectURL(u); if (!b) return bad(); ok({ blob: b, nombre: file.name.replace(/\.[^.]+$/, '') + '.jpg' }); }, 'image/jpeg', 0.75);
    };
    img.onerror = function () { URL.revokeObjectURL(u); bad(); };
    img.src = u;
  });
}

async function adjuntar(files) {
  const ref = TB.abierta;
  if (!ref) return;
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    const esPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!esPdf && !/^image\//.test(f.type)) { aviso('"' + f.name + '": solo se pueden adjuntar fotos o PDF.', 'bad'); continue; }
    let blob = f, nombre = f.name;
    if (esPdf) {
      if (f.size > ADJUNTO_MAX_MB * 1024 * 1024) { aviso('"' + f.name + '" pesa más de ' + ADJUNTO_MAX_MB + ' MB.', 'bad'); continue; }
    } else {
      try { const c = await comprimirFoto(f); blob = c.blob; nombre = c.nombre; }
      catch (e) { aviso('No se pudo leer la foto "' + f.name + '".', 'bad'); continue; }
    }
    const id = 'J' + nuevoId();
    try { await PedidosGuardados.guardarFoto(id, blob, nombre); }
    catch (e) { aviso('No se pudo guardar "' + nombre + '" en el teléfono.', 'bad'); continue; }
    ADJ.urls[id] = URL.createObjectURL(blob);
    const l = adjPendientes();
    l.push({ id: id, ref: ref, parte: TB.parte || '', nombre: nombre, tipo: esPdf ? 'pdf' : 'foto', creado: new Date().toISOString(), token: APP.token, intentos: 0 });
    guardarAdjPendientes(l);
  }
  pintarAdjuntos();
  subirAdjuntos();
}

/** Sube lo que espera, del más viejo al más nuevo. Sin señal, para y se reintenta después. */
async function subirAdjuntos() {
  if (ADJ.subiendo || !APP.token) return;
  ADJ.subiendo = true;
  try {
    for (const p of adjPendientes()) {
      const g = await PedidosGuardados.leerFoto(p.id);
      let r;
      if (!g) r = { ok: false, error: 'el archivo ya no estaba en el teléfono' };
      else {
        try {
          r = await llamar('subirAdjunto', [p.token || APP.token, p.ref, { id: p.id, nombre: p.nombre, tipo: p.tipo, parte: p.parte || '', base64: await blobABase64(g.blob) }],
                           p.id, { limiteMs: 180000 });
        } catch (x) {
          if (x.sinRed) break;                                   // sin señal: después
          r = { ok: false, error: 'el servidor no lo aceptó', reintentar: true };
        }
      }
      if (r.sinSesion) { sesionPerdida(r.error); break; }
      if (!r.ok && r.reintentar) {                               // respuesta rara: se reintenta, pero no para siempre
        const l = adjPendientes(), x = l.find(function (y) { return y.id === p.id; });
        if (x && ++x.intentos < 5) { guardarAdjPendientes(l); break; }
      }
      guardarAdjPendientes(adjPendientes().filter(function (x) { return x.id !== p.id; }));
      if (g) PedidosGuardados.borrarFoto(p.id);
      if (r.ok) ponerAdjuntoEnDetalle(p.ref, r.adjunto, false);
      else noAplicado('adjuntar "' + p.nombre + '"', r.error);
      if (TB.abierta === p.ref) pintarAdjuntos();
    }
  } finally {
    ADJ.subiendo = false;
  }
}
setInterval(function () { if (!document.hidden && adjPendientes().length) subirAdjuntos(); }, 15000);
window.addEventListener('online', function () { subirAdjuntos(); });
APP.adjuntosPendientes = adjPendientes().length;

/** Suma (o saca) un adjunto en lo guardado de la tarjeta. */
function ponerAdjuntoEnDetalle(ref, a, sacar) {
  const poner = function (d) {
    if (!d) return;
    d.adjuntos = (d.adjuntos || []).filter(function (x) { return x.id !== (sacar ? a : a.id); });
    if (!sacar) d.adjuntos.push(a);
  };
  const todos = detallesGuardados();
  if (todos[ref]) { poner(todos[ref].d); guardado.guardarJSON(K_TARJETAS, todos); }
  if (TB.abierta === ref) poner(TB.detalle);
}
function adjuntoQuitado(m, r) {
  if (r.ok) ponerAdjuntoEnDetalle(m.args[0], m.args[1], true);
  if (TB.abierta === m.args[0]) pintarAdjuntos();
}

function pintarAdjuntos() {
  const ref = TB.abierta, d = TB.detalle, cont = $('tj-adjuntos');
  if (!ref) return;
  const quitando = {};
  bandeja.lista().forEach(function (m) { if (m.fn === 'quitarAdjunto' && m.args[0] === ref) quitando[m.args[1]] = true; });
  const aca = TB.parte || '';
  const lista = ((d && d.adjuntos) || []).filter(function (a) { return !quitando[a.id] && (a.parte || '') === aca; });
  const esperan = adjPendientes().filter(function (p) { return p.ref === ref && (p.parte || '') === aca; });
  $('tj-adj-t').textContent = 'Adjuntos' + (lista.length + esperan.length ? ' (' + (lista.length + esperan.length) + ')' : '');
  const puedeQuitar = function (a) { return APP.yo.admin || a.autor === APP.yo.nombre; };
  const tile = function (a, espera) {
    const foto = a.tipo === 'foto';
    const img = espera ? (foto && ADJ.urls[a.id] ? '<img src="' + esc(ADJ.urls[a.id]) + '" alt="">' : '<span class="pdf">' + (foto ? '🖼️' : '📄') + '</span>')
                       : (foto ? '<img src="https://drive.google.com/thumbnail?id=' + esc(a.idDrive) + '&sz=w240" alt="" loading="lazy">' : '<span class="pdf">📄</span>');
    return '<div class="adj' + (espera ? ' espera' : '') + '" role="button" tabindex="0" data-adj="' + esc(a.id) + '" title="' + esc(a.nombre) + (a.autor ? ' · ' + esc(a.autor) : '') + '">' +
      img + (foto ? '' : '<span class="n">' + esc(a.nombre) + '</span>') +
      (espera ? '<span class="esp">' + (APP.enLinea ? 'Subiendo…' : '⏳') + '</span>' : '') +
      (espera || puedeQuitar(a) ? '<button type="button" class="x" data-quitar="' + esc(a.id) + '" aria-label="Quitar ' + esc(a.nombre) + '">×</button>' : '') + '</div>';
  };
  cont.innerHTML = lista.map(function (a) { return tile(a, false); }).join('') + esperan.map(function (a) { return tile(a, true); }).join('') ||
    '<p class="nota" style="margin:0">' + (TB.tipo === 'tarea' ? 'Fotos o PDFs de la tarea.' : 'Fotos o PDFs del pedido: remito, presupuesto, foto del repuesto…') + '</p>';
  cont.querySelectorAll('[data-adj]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-quitar]')) return;
      const a = lista.filter(function (x) { return x.id === el.dataset.adj; })[0];
      if (!a) return;                                    // todavía se está subiendo
      if (a.tipo === 'foto') verFoto(a.idDrive);
      else window.open('https://drive.google.com/file/d/' + encodeURIComponent(a.idDrive) + '/view', '_blank');
    });
  });
  cont.querySelectorAll('[data-quitar]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const id = b.dataset.quitar;
      const p = esperan.filter(function (x) { return x.id === id; })[0];
      if (p) {                                           // todavía no subió: se saca del teléfono
        if (ADJ.subiendo) return aviso('Se está subiendo: esperá unos segundos para quitarlo.');
        guardarAdjPendientes(adjPendientes().filter(function (x) { return x.id !== id; }));
        PedidosGuardados.borrarFoto(id);
        return pintarAdjuntos();
      }
      const a = lista.filter(function (x) { return x.id === id; })[0];
      const si = await dialogo({ titulo: '¿Quitar "' + a.nombre + '"?', texto: 'Deja de verse en la tarjeta. El archivo queda guardado en el Drive.',
        botones: [{ texto: 'Sí, quitarlo', clase: 'btn peligro-btn', valor: true }, { texto: 'No, volver', valor: null }] });
      if (!si) return;
      bandeja.agregar('quitarAdjunto', [ref, id], 'quitar el adjunto "' + a.nombre + '"');
      pintarAdjuntos();
    });
  });
}
$('tj-adjuntar-b').addEventListener('click', function () { $('tj-adjuntar').click(); });
$('tj-adjuntar').addEventListener('change', function () {
  const files = Array.prototype.slice.call(this.files || []);
  this.value = '';
  if (files.length) adjuntar(files);
});

/* ---------- Mini tarjetas adentro de la tarjeta (Paso 4-bis, arquitectura de Feli) ----------
   Una por rubro y una por grupo de proveedores particulares. Cada una con
   su estado (una columna), productos, descripción, comentarios y adjuntos;
   se mueve por separado con "Mover a…". La tarjeta grande está en la
   columna de la más atrasada. Con un solo rubro no se muestran. */

/** Las mini tarjetas con lo que espera en la bandeja encima. */
function partesVista(ref) {
  const d = TB.detalle;
  if (!d || !d.partes) return [];
  const pts = d.partes.map(function (x) { return Object.assign({}, x); });
  bandeja.lista().forEach(function (m) {
    if (m.fn === 'mandarTanda') {
      pts.forEach(function (x) { if ((m.args[0] || []).indexOf(x.id) !== -1) { x.columna = (columnasTb().filter(function (c) { return c.seccion === 'Cotización'; })[1] || {}).columna || x.columna; x.espera = true; } });
      return;
    }
    if (!OPS_PARTE[m.fn] || m.args[0] !== ref) return;
    const x = pts.filter(function (y) { return y.id === m.args[1]; })[0];
    if (!x) return;
    x.espera = true;
    if (m.fn === 'moverParte') { x.columna = m.args[2].columna; if (m.args[2].entrega !== undefined) x.entrega = m.args[2].entrega; if (m.args[2].retiro) x.retiro = m.args[2].retiro; }
    else if (m.fn === 'cancelarParte') x.columna = colCancelado();
    else if (m.fn === 'describirParte') x.descripcion = m.args[2];
  });
  return pts;
}

/** El título de una mini tarjeta: sus productos (Feli), como el título de un pedido. */
function tituloDeParte(d, pt) {
  const ls = lineasConCambios(TB.abierta, d.lineas).filter(function (l) { return l.parte === pt.id && vigente(l); }).map(nombreProducto);
  if (!ls.length) return pt.nombre;
  return ls.length <= 3 ? ls.join(', ') : ls.slice(0, 3).join(', ') + ' y ' + (ls.length - 3) + ' más';
}

function textoTanda(pt) {
  const m = /^T(\d{4})(\d{2})(\d{2})/.exec(pt.tanda || '');
  return '📤 Salió en la tanda' + (m ? ' del ' + Number(m[3]) + '/' + Number(m[2]) : '') +
    (pt.tandaCon ? ' con ' + pt.tandaCon + (pt.tandaCon === 1 ? ' pedido más' : ' pedidos más') : '');
}

/** La lista de productos de la tarjeta grande, agrupada en sus mini tarjetas. */
function htmlPartes(ref, pts, lineas, admin, mio, puedeMover) {
  const d = TB.detalle;
  const cancel = colCancelado();
  const ordenadas = pts.filter(function (x) { return x.columna !== cancel; }).concat(pts.filter(function (x) { return x.columna === cancel; }));
  const cuantos = function (lista, id) { return (lista || []).filter(function (x) { return (x.parte || '') === id; }).length; };
  let html = ordenadas.map(function (pt) {
    const ls = lineas.filter(function (l) { return l.parte === pt.id; });
    const cancelada = pt.columna === cancel;
    const nc = cuantos(d.comentarios, pt.id), na = cuantos(d.adjuntos, pt.id);
    return '<div class="parte' + (cancelada ? ' cancelada' : '') + '">' +
      '<div class="parte-h"><b>' + esc(pt.nombre) + '</b>' +
        (puedeMover && admin
          ? '<button type="button" class="col-chip chico" data-mover-parte="' + esc(pt.id) + '">' + esc(pt.columna) + (cancelada ? ' · Recuperar' : '') + ' ⌄</button>'
          : '<span class="col-chip chico">' + esc(pt.columna) + '</span>') +
        (pt.espera ? '<span class="espera">' + (APP.enLinea ? 'Guardando…' : '⏳') + '</span>' : '') +
        '<button type="button" class="btn-chico abrir" data-abrir-parte="' + esc(pt.id) + '">' +
          (nc ? '💬 ' + nc + ' ' : '') + (na ? '📎 ' + na + ' ' : '') + 'Abrir ›</button></div>' +
      (pt.manual ? '<div class="sub">✋ Gestión manual</div>' : '') +
      (pt.tanda ? '<div class="sub">' + esc(textoTanda(pt)) + '</div>' : '') +
      (pt.descripcion ? '<div class="sub">' + esc(pt.descripcion) + '</div>' : '') +
      ls.map(function (l) { return htmlProducto(l, admin, mio); }).join('') + '</div>';
  }).join('');
  const sueltas = lineas.filter(function (l) { return !l.parte || !pts.some(function (x) { return x.id === l.parte; }); });
  if (sueltas.length) html += '<div class="parte"><div class="parte-h"><b>Nuevos</b></div>' + sueltas.map(function (l) { return htmlProducto(l, admin, mio); }).join('') + '</div>';
  return html;
}

function abrirParte(id) {
  TB.parte = id;
  ponerBorrador(TB.abierta);
  pintarTarjeta();
  $('tarjeta-modal').scrollTop = 0;
}
$('tj-volver').addEventListener('click', function () { TB.parte = null; pintarTarjeta(); $('tarjeta-modal').scrollTop = 0; });

/** ¿Este cambio de la historia es de esta mini tarjeta? */
function eventoDeParte(e, d, id) {
  if (e.entidad === 'parte') return e.id === id;
  if (e.entidad === 'linea') return ((d.lineas || []).filter(function (l) { return l.id === e.id; })[0] || {}).parte === id;
  if (e.entidad === 'adjunto') return ((d.adjuntos || []).filter(function (a) { return a.id === e.id; })[0] || {}).parte === id;
  return false;
}

async function moverParteUI(ref, id) {
  const pt = partesVista(ref).filter(function (x) { return x.id === id; })[0];
  if (!pt || !APP.yo.admin) return;
  const cancelada = pt.columna === colCancelado();
  const destino = await moverADialogo((cancelada ? 'Recuperar "' : 'Mover "') + pt.nombre + '" a…', cancelada ? '' : pt.columna, cancelada ? 'Está cancelada.' : '');
  if (!destino || destino === pt.columna) return;
  const op = { columna: destino, desde: pt.columna };
  if (destino === colPorRecibir()) {
    const e = await preguntarEntrega(pt.entrega);
    if (!e) return;
    op.entrega = e;
  }
  if (destino === colEntregado()) {
    const r = await preguntarRetiro();
    if (!r) return;
    op.retiro = r.retiro;
    op.fechaRetiro = r.fecha;
  }
  bandeja.agregar('moverParte', [ref, id, op], (cancelada ? 'recuperar "' : 'mover "') + pt.nombre + '" a ' + destino);
  pintarTarjeta();
}

$('tj-cancelar-parte').addEventListener('click', async function () {
  const ref = TB.abierta, pt = partesVista(ref).filter(function (x) { return x.id === TB.parte; })[0];
  if (!pt) return;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-motivo">¿Por qué se cancela?</label><textarea id="dg-motivo" placeholder="Ej: ya no hace falta, se consiguió por otro lado…"></textarea>';
  const motivo = await dialogo({
    titulo: '¿Cancelar esta parte del pedido?',
    texto: '"' + pt.nombre + '". Las otras partes siguen. No se borra: se puede recuperar.',
    cuerpo: cuerpo,
    botones: [
      { texto: 'Sí, cancelar esta parte', clase: 'btn peligro-btn', id: 'dg-ok', valor: function () { return $('dg-motivo').value.trim(); } },
      { texto: 'No, volver', valor: null }
    ],
    alAbrir: function () {
      const ok = $('dg-ok'), m = $('dg-motivo');
      const revisar = function () { ok.disabled = m.value.trim().length < 3; };
      m.addEventListener('input', revisar);
      revisar();
      m.focus();
    }
  });
  if (!motivo) return;
  const antes = pt.columna;
  const clave = bandeja.agregar('cancelarParte', [ref, pt.id, motivo, antes], 'cancelar la parte "' + pt.nombre + '"');
  TB.parte = null;
  pintarTarjeta();
  avisoConBoton('Parte cancelada.', 'Deshacer', function () {
    if (bandeja.pendiente(clave) && !bandeja.enviando) bandeja.quitar(clave);
    else bandeja.agregar('moverParte', [ref, pt.id, { columna: antes, desde: colCancelado() }], 'deshacer la cancelación de "' + pt.nombre + '"');
    pintarTarjeta();
  });
});

$('tj-desc-editar').addEventListener('click', async function () {
  if (TB.tipo === 'tarea') return describirTareaUI(TB.abierta);
  const ref = TB.abierta, pt = partesVista(ref).filter(function (x) { return x.id === TB.parte; })[0];
  if (!pt) return;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-desc">Descripción</label><textarea id="dg-desc" maxlength="2000"></textarea>';
  const texto = await dialogo({
    titulo: 'Descripción de "' + pt.nombre + '"', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', valor: function () { return $('dg-desc').value.trim(); } }, { texto: 'Volver', valor: null }],
    alAbrir: function () { $('dg-desc').value = pt.descripcion || ''; $('dg-desc').focus(); }
  });
  if (texto === null || texto === undefined || texto === (pt.descripcion || '')) return;
  bandeja.agregar('describirParte', [ref, pt.id, texto], 'cambiar la descripción de "' + pt.nombre + '"');
  pintarTarjeta();
});

/** Respuesta de un cambio de mini tarjeta. */
function parteMandada(m, r) {
  if (r.ok && r.parte) {
    const poner = function (d) { if (d && d.partes) d.partes = d.partes.map(function (x) { return x.id === r.parte.id ? Object.assign({}, x, r.parte) : x; }); };
    const todos = detallesGuardados();
    if (todos[m.args[0]]) { poner(todos[m.args[0]].d); guardado.guardarJSON(K_TARJETAS, todos); }
    if (TB.abierta === m.args[0]) poner(TB.detalle);
  }
  if (m.fn !== 'describirParte') cargarTablero();         // la tarjeta grande puede haber cambiado de columna
  if (TB.abierta && (m.fn === 'mandarTanda' || TB.abierta === m.args[0])) traerTarjeta(TB.abierta);
  if (m.fn === 'mandarTanda' && r.ok && !document.hidden) aviso('📤 ' + r.enviadas + (r.enviadas === 1 ? ' parte pasó' : ' partes pasaron') + ' a ' + r.columna + '.');
}

/* ---------- Tanda verde: "Mandar a cotizar" (solo admins) ---------- */
function htmlTandaCabecera(n) {
  const t = (TB.datos && TB.datos.tanda) || {};
  const aviso = t.dias === null || t.dias === undefined ? '' : t.dias >= (t.cada || 14) && n
    ? '<span class="tanda-aviso">⚠ Hace ' + t.dias + ' días que no se manda</span>' : '<small>Última: ' + (t.dias === 0 ? 'hoy' : 'hace ' + t.dias + (t.dias === 1 ? ' día' : ' días')) + '</small>';
  return '<div class="tanda-b">' + (n ? '<button type="button" class="btn-chico si" id="tb-mandar-tanda">📤 Mandar a cotizar</button>' : '') + aviso + '</div>';
}

async function mandarTandaUI() {
  const r = await api('datosTanda');
  if (!r.ok) return aviso(r.sinConexion ? 'Para armar la tanda hace falta señal. Probá en un rato.' : r.error, 'bad');
  if (!r.grupos.length) return aviso('La Tanda verde está vacía.');
  const elegidas = {};
  r.grupos.forEach(function (g) { g.partes.forEach(function (x) { elegidas[x.id] = true; }); });
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<p class="nota">Agrupado por rubro. Todo marcado: destildá lo que no va. Lo que se manda pasa a Por cotizar y queda anotado como una tanda.</p>' +
    '<div class="opciones" id="tz-lista" style="max-height:55vh"></div>';
  const ids = await dialogo({
    titulo: 'Mandar a cotizar la Tanda verde', cuerpo: cuerpo,
    botones: [{ texto: 'Mandar', clase: 'btn', id: 'dg-ok', valor: function () { return Object.keys(elegidas).filter(function (k) { return elegidas[k]; }); } },
              { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const cont = $('tz-lista');
      const revisar = function () {
        const n = Object.keys(elegidas).filter(function (k) { return elegidas[k]; }).length;
        $('dg-ok').disabled = !n;
        $('dg-ok').textContent = 'Mandar a cotizar (' + n + ')';
        cont.querySelectorAll('[data-g]').forEach(function (b) {
          const g = r.grupos[Number(b.dataset.g)], todas = g.partes.every(function (x) { return elegidas[x.id]; });
          b.setAttribute('aria-checked', String(todas));
          b.querySelector('.marca').textContent = todas ? '☑' : g.partes.some(function (x) { return elegidas[x.id]; }) ? '◩' : '☐';
        });
        cont.querySelectorAll('[data-p]').forEach(function (b) {
          b.setAttribute('aria-checked', String(!!elegidas[b.dataset.p]));
          b.querySelector('.marca').textContent = elegidas[b.dataset.p] ? '☑' : '☐';
        });
      };
      cont.innerHTML = r.grupos.map(function (g, k) {
        return '<h4>' + esc(g.nombre) + '</h4>' +
          '<button type="button" class="choice" data-g="' + k + '"><span class="marca">☑</span><span><b>Todo ' + esc(g.nombre) + '</b> · ' +
            g.partes.length + (g.partes.length === 1 ? ' pedido' : ' pedidos') + '</span></button>' +
          g.partes.map(function (x) {
            return '<button type="button" class="choice sub-choice" data-p="' + esc(x.id) + '"><span class="marca">☑</span><span>' + esc(x.sitio) + ' · ' + esc(x.productos) +
              '<small style="display:block;color:var(--muted);font-weight:400">' + esc(x.solicitante) + '</small></span></button>';
          }).join('');
      }).join('');
      cont.querySelectorAll('[data-g]').forEach(function (b) {
        b.addEventListener('click', function () {
          const g = r.grupos[Number(b.dataset.g)], todas = g.partes.every(function (x) { return elegidas[x.id]; });
          g.partes.forEach(function (x) { elegidas[x.id] = !todas; });
          revisar();
        });
      });
      cont.querySelectorAll('[data-p]').forEach(function (b) {
        b.addEventListener('click', function () { elegidas[b.dataset.p] = !elegidas[b.dataset.p]; revisar(); });
      });
      revisar();
    }
  });
  if (!ids || !ids.length) return;
  bandeja.agregar('mandarTanda', [ids], 'mandar a cotizar la Tanda verde (' + ids.length + (ids.length === 1 ? ' parte)' : ' partes)'));
  if (TB.abierta) pintarTarjeta();
}

/** Muestra los bloques de la ventana que son de un pedido o de una tarea. */
function bloquesDeTarea(tarea) {
  ['tj-razon-b', 'tj-prod-b'].forEach(function (id) { $(id).hidden = tarea; });
  ['tj-check-b', 'tj-rec-b'].forEach(function (id) { $(id).hidden = !tarea; });
  $('tj-borrar-tarea').hidden = !tarea;
  if (!tarea) $('tj-editar').textContent = '✏️ Editar pedido';
  if (tarea) ['tj-cancelar', 'tj-cancelar-parte', 'tj-volver', 'tj-reabrir'].forEach(function (id) { $(id).hidden = true; });
}

/** Aviso abajo con un botón (ej. "Deshacer"), unos segundos. */
function avisoConBoton(texto, boton, accion) {
  const el = $('toast');
  el.className = 'toast aviso-accion';
  el.innerHTML = '';
  const s = document.createElement('span'); s.textContent = texto;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = boton;
  b.addEventListener('click', function () { el.hidden = true; accion(); });
  el.append(s, b);
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(function () { el.hidden = true; }, 8000);
}

/* ---------- Foto en grande, adentro de la app ----------
   Las fotos están guardadas en Google Drive (las sube el formulario). Se
   muestran con la vista previa grande de Drive, sin salir de la app. */
function verFoto(id) {
  const img = $('visor-img');
  $('visor-carga').hidden = false;
  $('visor-carga').textContent = 'Cargando la foto…';
  img.hidden = true;
  img.onload = function () { $('visor-carga').hidden = true; img.hidden = false; };
  img.onerror = function () { $('visor-carga').textContent = 'No se pudo cargar la foto (¿poca señal?).'; };
  img.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1600';
  $('visor').hidden = false;
}
function cerrarFoto() { $('visor').hidden = true; $('visor-img').removeAttribute('src'); }
$('visor-cerrar').addEventListener('click', cerrarFoto);
$('visor').addEventListener('click', function (e) { if (e.target === this || e.target.id === 'visor-img') cerrarFoto(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('visor').hidden) { e.stopImmediatePropagation(); cerrarFoto(); } }, true);
