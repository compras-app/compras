'use strict';
/* ============================================================
   TABLERO (Fase 2, Paso 3)
   ------------------------------------------------------------
   - Secciones (Tanda verde, Cotización, Seguimiento) con sus columnas,
     una al lado de la otra; en el celular se desliza de costado.
   - Tarjeta: título, sitio, urgencia, inicial del responsable (y en
     "Por recibir", si hay que ir a buscarlo o nos lo traen).
   - Filtros: Mis pedidos / Todos (los no admins entran con Mis pedidos),
     y para admins, granja y responsable.
   - Solo los admins mueven (arrastrando, o con la columna de la tarjeta
     abierta), asignan responsable, marcan la entrega y cancelan.
   - Todo cambio va por la bandeja de salida (base.js): se ve al instante,
     se manda cuando hay señal y un reintento no lo repite. Lo que se ve
     es lo último que mandó el servidor MÁS lo que está en la bandeja.
   ============================================================ */

const K_TABLERO = 'compras_tablero';      // lo último que mandó getTablero (para abrir sin señal)
const K_TARJETAS = 'compras_tarjetas';    // tarjetas abiertas hace poco (para verlas sin señal)
const OPS_TABLERO = { moverTarjeta: 1, asignarResponsable: 1, marcarEntrega: 1, cancelarPedido: 1 };
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
    let t = i >= 0 ? lista.splice(i, 1)[0] : (TB.cancelados[ref] ? Object.assign({}, TB.cancelados[ref]) : null);
    if (!t || !enTablero(op.columna)) return;
    t = Object.assign({}, t, { columna: op.columna });
    if (op.entrega !== undefined) t.entrega = op.entrega;
    insertarEn(lista, t, op.despuesDe);
  } else if (i >= 0) {
    if (fn === 'asignarResponsable') lista[i] = Object.assign({}, lista[i], { responsable: args[1] || '' });
    else if (fn === 'marcarEntrega') lista[i] = Object.assign({}, lista[i], { entrega: args[1] || '' });
    else if (fn === 'cancelarPedido') { TB.cancelados[ref] = lista[i]; lista.splice(i, 1); }
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
  TB.filtros = { mios: !admin, sitio: '', resp: '' };   // pedido de Feli: los no admins entran con "Mis pedidos"
  const sitio = $('tb-sitio'), resp = $('tb-resp');
  $('tb-sitio-l').hidden = $('tb-resp-l').hidden = !admin;
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
}
function seVe(t) {
  const f = TB.filtros;
  if (f.mios && t.solicitante !== APP.yo.nombre) return false;
  if (f.sitio && t.sitio !== f.sitio) return false;
  if (f.resp === '-' && t.responsable) return false;
  if (f.resp && f.resp !== '-' && t.responsable !== f.resp) return false;
  return true;
}
$('tb-mios').addEventListener('click', function () { TB.filtros.mios = true; pintarFiltros(); pintarTablero(); });
$('tb-todos').addEventListener('click', function () { TB.filtros.mios = false; pintarFiltros(); pintarTablero(); });
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
  pintarTablero();
  cargarTablero();
  if (location.hash.length > 1 && !TB.abierta) abrirTarjeta(decodeURIComponent(location.hash.slice(1)), true);
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
      '<b>' + esc(c.columna) + '</b><span class="n">' + ts.length + '</span></div>' +
      '<div class="lista" data-columna="' + esc(c.columna) + '">' +
      (ts.length ? ts.map(function (t) { return htmlTarjeta(t, c.columna === colPorRecibir()); }).join('')
                 : '<div class="vacia">Sin pedidos</div>') +
      '</div></div>');
  });
  cont.innerHTML = html.join('');
  cont.scrollLeft = scroll;
  cont.querySelectorAll('.lista').forEach(function (l) { if (listas[l.dataset.columna]) l.scrollTop = listas[l.dataset.columna]; });
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

function htmlTarjeta(t, enPorRecibir) {
  return '<div class="tarjeta" data-ref="' + esc(t.ref) + '" role="button" tabindex="0">' +
    '<div class="t">' + esc(t.titulo || t.ref) + '</div>' +
    '<div class="pie"><span aria-label="' + esc(t.urgencia) + '">' + esc(emojiUrgencia(t.urgencia)) + '</span>' +
    '<span class="sitio">' + esc(t.sitio) + '</span>' +
    (enPorRecibir && t.entrega ? '<span class="entrega">' + esc(ENTREGA_CORTO[t.entrega] || t.entrega) + '</span>' : '') +
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
  if (TB.cargando || !APP.token) return;
  TB.cargando = true;
  if (!TB.datos) pintarTablero();
  const r = await api('getTablero');
  TB.cargando = false;
  if (!r.ok) { if (!TB.datos) pintarTablero(); pintarHace(); return; }   // sin señal: queda lo guardado
  TB.datos = { columnas: r.columnas, tarjetas: r.tarjetas, porRecibir: r.porRecibir, actualizado: r.actualizado };
  guardado.guardarJSON(K_TABLERO, TB.datos);
  if (!TB.arrastre) pintarTablero();
  if (TB.abierta) pintarTarjeta();
}
function pintarHace() {
  const el = $('tb-hace');
  if (el) el.textContent = TB.datos && TB.datos.actualizado ? hace(TB.datos.actualizado) : '';
}
$('tb-refrescar').addEventListener('click', function () { cargarTablero(); });
function tableroALaVista() { return !$('app').hidden && !$('s-tablero').hidden && !document.hidden; }
// Se actualiza solo cada 2 minutos mientras está a la vista, al volver a la app y al volver la señal
setInterval(function () { if (tableroALaVista() && !TB.arrastre) cargarTablero(); }, 120000);
setInterval(pintarHace, 30000);
document.addEventListener('visibilitychange', function () { if (tableroALaVista()) cargarTablero(); });
window.addEventListener('online', function () { if (tableroALaVista()) cargarTablero(); });

/* ---------- Mover (lo usan arrastrar y la tarjeta abierta) ---------- */
async function moverA(ref, destino, despuesDe) {
  const t = buscarEnVista(ref);
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
  bandeja.agregar('moverTarjeta', [ref, op], 'mover la tarjeta');
  pintarTablero();
  if (TB.abierta === ref) pintarTarjeta();
}

/* ---------- Arrastrar (solo admins) ----------
   Celular: mantener apretada la tarjeta medio segundo y arrastrar; al borde
   de la pantalla pasa a la columna de al lado. Compu: arrastrar con el mouse. */
function tocar(e, el, ref) {
  if (e.touches.length !== 1 || TB.arrastre) return;
  const x0 = e.touches[0].clientX, y0 = e.touches[0].clientY;
  let timer = setTimeout(function () {
    timer = null;
    empezarArrastre(el, ref, x0, y0);
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

function conMouse(e, el, ref) {
  if (e.button !== 0 || TB.arrastre) return;
  const x0 = e.clientX, y0 = e.clientY;
  let empezo = false;
  const mover = function (ev) {
    if (!empezo && (Math.abs(ev.clientX - x0) > 5 || Math.abs(ev.clientY - y0) > 5)) { empezo = true; empezarArrastre(el, ref, x0, y0); }
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

function empezarArrastre(el, ref, x, y) {
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
  const tb = $('tablero');
  tb.style.scrollSnapType = 'none';
  TB.arrastre = {
    ref: ref, el: el, fantasma: fantasma, hueco: hueco, dx: x - r.left, dy: y - r.top, x: x, y: y,
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
  const tb = $('tablero');
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
  $('tablero').style.scrollSnapType = '';
  TB.recienArrastrada = true;
  setTimeout(function () { TB.recienArrastrada = false; }, 400);
  const lista = a.hueco.parentNode;
  if (cancelado || !lista) return pintarTablero();
  const destino = lista.dataset.columna;
  const despuesDe = tarjetaAnterior(a.hueco, a.el);
  if (destino === a.origen && despuesDe === a.despuesDeOriginal) return pintarTablero();
  moverA(a.ref, destino, despuesDe);
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
  TB.abierta = ref;
  const g = detallesGuardados()[ref];
  TB.detalle = g ? g.d : null;
  TB.sinDetalle = '';
  pintarTarjeta();
  $('tarjeta-modal').hidden = false;
  $('tarjeta-modal').scrollTop = 0;
  document.body.classList.add('modal-abierto');
  // Con el "atrás" del celular se cierra la tarjeta; y el link #Ref abre la tarjeta (avisos por WhatsApp, Fase 3)
  if (!sinHistoria) history.pushState({ tarjeta: ref }, '', '#' + encodeURIComponent(ref));
  const r = await api('getTarjeta', ref);
  if (TB.abierta !== ref) return;
  if (r.ok) { TB.detalle = { pedido: r.pedido, lineas: r.lineas }; guardarDetalle(ref, TB.detalle); }
  else if (r.sinConexion) TB.sinDetalle = TB.detalle ? '' : 'Hay poca señal: los productos se ven cuando vuelva.';
  else if (!r.sinSesion) TB.sinDetalle = r.error;
  pintarTarjeta();
}

function ocultarTarjeta() {
  TB.abierta = null;
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
  const t = buscarEnVista(ref);
  const d = TB.detalle, p = d ? d.pedido : null;
  const admin = APP.yo.admin;
  const columna = t ? t.columna : (p ? p.columna : '');
  const enTb = !!t;

  const chip = $('tj-columna');
  chip.textContent = (columna || '…') + (admin && enTb ? ' ⌄' : '');
  chip.disabled = !(admin && enTb);
  chip.title = admin && enTb ? 'Mover a otra columna' : '';
  $('tj-titulo').textContent = (t && t.titulo) || (p && p.titulo) || ref;

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
  if (p && p.retiro) dato('Retiró', esc(p.retiro + (p.fechaRetiro ? ' · ' + new Date(p.fechaRetiro).toLocaleDateString('es-AR') : '')));
  $('tj-datos').innerHTML = datos.join('');

  const etiquetas = [];
  if ((t && t.masivo) || (p && p.origen === 'masivo')) etiquetas.push('Pedido masivo');
  if ((t && t.manual) || (p && p.manual)) etiquetas.push('✋ Gestión manual');
  if (!enTb && p && p.columna) etiquetas.push('Finalizado: ' + p.columna);
  $('tj-etiquetas').innerHTML = etiquetas.map(function (e) { return '<span class="etiqueta">' + esc(e) + '</span>'; }).join('');

  $('tj-razon').textContent = p ? (p.razon || '—') : (TB.sinDetalle || 'Cargando…');
  const prods = $('tj-productos');
  if (d && d.lineas) {
    $('tj-prod-t').textContent = 'Productos (' + d.lineas.length + ')';
    prods.innerHTML = d.lineas.map(function (l) {
      const nombre = (l.familia || l.texto) + (l.especificacion ? ' (' + l.especificacion + ')' : '');
      const sub = [];
      // Lo que escribió el encargado, solo si el producto no estaba en el padrón (si lo eligió de la lista, no hace falta)
      if (!l.enPadron && l.familia && l.texto && l.texto.toLowerCase() !== l.familia.toLowerCase()) sub.push('Escribió: "' + l.texto + '"');
      if (l.canal) sub.push('Rubro: ' + l.canal);
      if (l.descripcion) sub.push(l.descripcion);
      const fotos = (l.fotos || []).map(function (u) {
        const id = idDrive(u);
        return id ? '<a href="https://drive.google.com/file/d/' + esc(id) + '/view" data-foto="' + esc(id) + '" aria-label="Ver foto">' +
                    '<img src="https://drive.google.com/thumbnail?id=' + esc(id) + '&sz=w200" alt="Foto" loading="lazy"></a>' : '';
      }).join('');
      return '<div class="producto"><b>' + esc(l.cantidad) + ' × ' + esc(nombre) + '</b>' +
        (l.enPadron ? '' : '<span class="fuera">Fuera del padrón</span>') +
        sub.map(function (s) { return '<div class="sub">' + esc(s) + '</div>'; }).join('') +
        (fotos ? '<div class="fotos">' + fotos + '</div>' : '') + '</div>';
    }).join('');
  } else {
    $('tj-prod-t').textContent = 'Productos';
    prods.innerHTML = '<p class="nota">' + esc(TB.sinDetalle || 'Cargando…') + '</p>';
  }
  $('tj-cancelar').hidden = !(admin && enTb);

  prods.querySelectorAll('[data-foto]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); verFoto(a.dataset.foto); });
  });
  const b = $('tj-resp');
  if (b) b.addEventListener('click', function () { cambiarResponsable(ref); });
  $('tj-datos').querySelectorAll('[data-entrega]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const v = btn.dataset.entrega;
      const actual = (buscarEnVista(ref) || {}).entrega;
      bandeja.agregar('marcarEntrega', [ref, actual === v ? '' : v], 'marcar cómo llega');
      pintarTablero(); pintarTarjeta();
    });
  });
}

$('tj-columna').addEventListener('click', async function () {
  const ref = TB.abierta, t = buscarEnVista(ref);
  if (!t || !APP.yo.admin) return;
  const grupos = [];
  columnasTb().forEach(function (c) {
    let g = grupos.filter(function (x) { return x.titulo === c.seccion; })[0];
    if (!g) { g = { titulo: c.seccion, opciones: [] }; grupos.push(g); }
    g.opciones.push({ texto: c.columna + (c.columna === t.columna ? ' (está acá)' : ''), valor: c.columna });
  });
  const destino = await elegir('Mover a…', '', grupos, t.columna);
  if (!destino) return;
  const donde = await elegir('¿Dónde en "' + destino + '"?', '', [{ opciones: [
    { texto: '⬆ Arriba de todo', valor: 'arriba' }, { texto: '⬇ Abajo de todo', valor: 'abajo' }
  ] }], null);
  if (!donde) return;
  moverA(ref, destino, donde === 'arriba' ? '' : '*');
});

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
  bandeja.agregar('asignarResponsable', [ref, nombre], 'asignar el responsable');
  pintarTablero(); pintarTarjeta();
}

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
  const clave = bandeja.agregar('cancelarPedido', [ref, motivo, t.columna], 'cancelar el pedido');
  cerrarTarjeta();
  pintarTablero();
  avisoConBoton('Pedido cancelado: pasó a Finalizados.', 'Deshacer', function () {
    if (bandeja.pendiente(clave) && !bandeja.enviando) bandeja.quitar(clave);      // todavía no salió: se saca
    else bandeja.agregar('moverTarjeta', [ref, { columna: antes.columna, desde: colCancelado(), despuesDe: antes.despuesDe }], 'deshacer la cancelación');
    pintarTablero();
  });
});

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
