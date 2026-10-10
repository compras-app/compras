'use strict';
/* ============================================================
   TABLERO (Fase 2, Paso 3)
   ------------------------------------------------------------
   - Secciones (Tanda verde, Cotización, Seguimiento) con sus columnas,
     una al lado de la otra; en el celular se desliza de costado.
   - Tarjeta: título, sitio, urgencia, inicial del responsable (y en
     "Para retirar", si hay que ir a buscarlo o nos lo traen). Las de la
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
     productos (recibido) y, los admins, editarlos y editar el pedido.
   ============================================================ */

const K_TABLERO = 'nueva_tablero';      // lo último que mandó getTablero (para abrir sin señal)
const K_TARJETAS = 'nueva_tarjetas';    // tarjetas abiertas hace poco (para verlas sin señal)
const OPS_TABLERO = { moverTarjeta: 1, asignarResponsable: 1, marcarEntrega: 1, cancelarPedido: 1, editarPedido: 1, cambiarManual: 1 };
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
  cargando: false
};

pantalla('tablero', { titulo: 'Tablero', alMostrar: mostrarTablero });

/* ---------- Columnas ---------- */
function columnasTb() { return (TB.datos && TB.datos.columnas) || []; }
function colEntregado() {
  const seg = columnasTb().filter(function (c) { return c.seccion === 'Entregas' || c.seccion === 'Seguimiento'; });   // "Seguimiento": el nombre de antes (Paso 6)
  return seg.length ? seg[seg.length - 1].columna : '';
}
function colCancelado() {
  const c = ((APP.config && APP.config.columnas) || []).filter(function (x) { return x.seccion === 'Cerrado'; });
  return c.length ? c[0].columna : 'Cancelado';
}
function colPorRecibir() { return (TB.datos && TB.datos.porRecibir) || 'Para retirar'; }
/** Stand by (Paso 2-ter): una columna más, que se ve como franja abajo del tablero. */
function colStandby() { return (TB.datos && TB.datos.standby) || 'Stand by'; }
function enTablero(columna) { return columna === colStandby() || columnasTb().some(function (c) { return c.columna === columna; }); }
function colEntrantes() { const c = columnasTb().filter(function (x) { return x.seccion === 'Cotización'; }); return (c[0] || {}).columna || 'Entrantes'; }
function colTanda() { const c = columnasTb().filter(function (x) { return x.seccion === 'Tanda verde'; }); return (c[0] || {}).columna || ''; }

/* Ordenar cada columna (Paso 2-bis): a mano (el de todos), más nuevo o más viejo primero. Solo en este dispositivo */
const K_ORDEN_COLS = 'nueva_orden_columnas';
const ORDEN_TEXTO = { '': '↕ A mano', nuevo: '↓ Más nuevos', viejo: '↑ Más viejos' };
function ordenDe(columna) { return guardado.leerJSON(K_ORDEN_COLS, {})[columna] || ''; }
function cambiarOrden(columna) {
  const o = guardado.leerJSON(K_ORDEN_COLS, {});
  o[columna] = !o[columna] ? 'nuevo' : o[columna] === 'nuevo' ? 'viejo' : '';
  if (!o[columna]) delete o[columna];
  guardado.guardarJSON(K_ORDEN_COLS, o);
}
function ordenarPorFecha(ts, orden) {
  if (!orden) return ts;
  return ts.slice().sort(function (a, b) {
    const d = new Date(a.fecha || 0) - new Date(b.fecha || 0);
    return orden === 'nuevo' ? -d : d;
  });
}

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
    else if (fn === 'cambiarManual') lista[i] = Object.assign({}, lista[i], { manual: !!args[1] });     // Paso 5
    else if (fn === 'cancelarPedido') { TB.cancelados[ref] = lista[i]; lista.splice(i, 1); }
    else if (fn === 'editarPedido') {
      const c = args[1] || {}, t = Object.assign({}, lista[i]);
      if (c.titulo !== undefined) t.titulo = c.titulo;
      if (c.urgencia !== undefined) t.urgencia = c.urgencia;
      if (c.compartido !== undefined) t.compartido = c.compartido;
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
/** Las opciones de granja y responsable con la lista nueva (al volver a la app: alguien dado de baja ya no sale), sin perder lo elegido. */
function rearmarOpcionesFiltros() {
  if (!APP.yo || !APP.yo.admin || !$('tb-resp')) return;
  $('tb-sitio').innerHTML = '<option value="">Ver todos</option>' + (APP.config.sitios || []).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  $('tb-resp').innerHTML = '<option value="">Ver todos</option><option value="-">Sin responsable</option>' +
    (APP.config.admins || []).map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('');
  if (TB.filtros.resp && TB.filtros.resp !== '-' && (APP.config.admins || []).indexOf(TB.filtros.resp) === -1) TB.filtros.resp = '';
  pintarFiltros();
}
function pintarFiltros() {
  $('tb-mios').setAttribute('aria-pressed', String(TB.filtros.mios));
  $('tb-todos').setAttribute('aria-pressed', String(!TB.filtros.mios));
  $('tb-sitio').value = TB.filtros.sitio;
  $('tb-resp').value = TB.filtros.resp;
  // Paso 6: el botón del bloque de filtros (celular) dice lo que está elegido
  const f = TB.filtros, lo = [f.mios ? 'Mis pedidos' : 'Todos'];
  if (f.sitio) lo.push(f.sitio);
  if (f.resp) lo.push(f.resp === '-' ? 'Sin responsable' : f.resp);
  $('tb-filtros-b').textContent = '⚙︎ Filtros · ' + lo.join(' · ');
}
$('tb-filtros-b').addEventListener('click', function () {
  const h = $('tb-herramientas'), abierto = !h.classList.contains('abiertos');
  h.classList.toggle('abiertos', abierto);
  this.setAttribute('aria-expanded', String(abierto));
});
function seVe(t) {
  const f = TB.filtros;
  if (f.mios && !esMio(t)) return false;
  // Una tarjeta de trabajo puede juntar pedidos de varias granjas (Tanda verde): "G1 - …, G3 - …"
  if (f.sitio && t.sitio !== f.sitio && String(t.sitio || '').split(', ').indexOf(f.sitio) === -1) return false;
  if (f.resp === '-' && t.responsable) return false;
  if (f.resp && f.resp !== '-' && t.responsable !== f.resp) return false;
  return true;
}
/** "Mis pedidos": los que pidió, los masivos que le compartieron (Paso 6) y las tarjetas de trabajo que salieron de los suyos (Fase 3). */
function esMio(t) {
  const yo = APP.yo.nombre;
  return t.solicitante === yo || (t.solicitantes || []).indexOf(yo) !== -1 || (t.compartido || []).indexOf(yo) !== -1;
}
$('tb-mios').addEventListener('click', function () { TB.filtros.mios = true; pintarFiltros(); pintarTablero(); });
$('tb-todos').addEventListener('click', function () { TB.filtros.mios = false; pintarFiltros(); pintarTablero(); });
$('tb-sitio').addEventListener('change', function () { TB.filtros.sitio = this.value; pintarFiltros(); pintarTablero(); });
$('tb-resp').addEventListener('change', function () { TB.filtros.resp = this.value; pintarFiltros(); pintarTablero(); });

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
  if (!h || h === 'cuenta') return;                                       // #cuenta es Tu cuenta, no un pedido
  if (/^K/.test(h)) { if (APP.yo.admin) ir('tareas'); return; }           // link a una tarea: se abre en Tareas
  if (!TB.abierta) abrirPorLink(h);
}

/**
 * Un link #Ref (el WhatsApp de una mención, de "¿Recibiste este pedido?"…): abre la tarjeta y, al cerrarla,
 * el tablero queda sobre ella. Si no es un pedido suyo, el tablero pasa a "Todos" (Feli, 2026-10-05: los
 * encargados arrancan con "Mis pedidos" y si no, al cerrar no la encuentran).
 */
function abrirPorLink(ref) {
  if (TB.filtros && TB.filtros.mios) {
    const t = buscarEnVista(ref);
    if (!t || !esMio(t)) { TB.filtros.mios = false; pintarFiltros(); pintarTablero(); }
  }
  TB.irAlCerrar = ref;
  abrirTarjeta(ref, true);
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
    const orden = ordenDe(c.columna);
    const ts = ordenarPorFecha(porCol[c.columna], orden);
    // Paso 2-bis: "📤 Mandar a Por cotizar" arriba de la Tanda verde (solo admins)
    const tanda = admin && c.columna === colTanda() && ts.some(function (t) { return !t.trabajo; });
    const recordar = tanda ? avisoTanda(ts) : '';
    // Paso 6: entre secciones, una línea del alto de la columna, del color de las otras líneas (Feli, 2026-10-04)
    html.push('<div class="col' + (primera && html.length ? ' nueva-sec' : '') + '" data-columna="' + esc(c.columna) + '" data-seccion="' + esc(c.seccion) + '">' +
      '<div class="col-h"><span class="sec">' + (primera ? esc(c.seccion) : '') + '</span>' +
      '<b>' + esc(c.columna) + '</b><span class="n">' + ts.length + '</span>' +
      '<button type="button" class="col-orden" data-orden-col="' + esc(c.columna) + '" aria-label="Ordenar la columna" title="Ordenar: a mano, más nuevos o más viejos primero (solo en este dispositivo)">' + ORDEN_TEXTO[orden] + '</button>' +
      // Paso 4: sin el 📤, para no confundirlo con "📤 Pedir cotización" (Feli)
      (tanda ? '<button type="button" class="btn-chico si tanda-cot" id="tb-tanda-cot"' + (juntandoTanda() ? ' disabled' : '') + '>' +
        (juntandoTanda() ? 'Juntando la tanda…' : 'Mandar a ' + esc(colPorCotizar())) + '</button>' : '') +
      (recordar ? '<div class="tanda-aviso">' + esc(recordar) + '</div>' : '') + '</div>' +
      '<div class="lista" data-columna="' + esc(c.columna) + '">' +
      (ts.length ? ts.map(function (t) { return htmlTarjeta(t, c.columna === colPorRecibir()); }).join('')
                 : '<div class="vacia">Sin pedidos</div>') +
      '</div></div>');
  });
  cont.innerHTML = html.join('');
  cont.scrollLeft = scroll;
  cont.querySelectorAll('.lista').forEach(function (l) { if (listas[l.dataset.columna]) l.scrollTop = listas[l.dataset.columna]; });
  cont.querySelectorAll('[data-orden-col]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarOrden(b.dataset.ordenCol); pintarTablero(); });
  });
  const bt = $('tb-tanda-cot');
  if (bt) bt.addEventListener('click', mandarTandaACotizar);
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
  pintarProcesando();
  pintarStandby();
  pintarSecciones();
  pintarHace();
}

/* ---------- "Mandar a Por cotizar" de la Tanda verde (Paso 4) ----------
   Junta los productos de todos los pedidos de la tanda en tarjetas de
   seguimiento por rubro, en Por cotizar (mandarTanda, por la bandeja). Los
   originales quedan en Procesando; lo que no se junta (fuera del padrón,
   OTROS, Sin rubro) pasa a Por cotizar en su pedido. No manda nada: al
   terminar, propone pedir la cotización de toda la tanda en una ventana. */
async function mandarTandaACotizar() {
  const tanda = colTanda(), destino = colPorCotizar();
  const ts = vista().filter(function (t) { return t.columna === tanda && !t.trabajo; });
  if (!ts.length || juntandoTanda()) return;
  const si = await dialogo({
    titulo: 'Mandar a ' + destino,
    texto: '¿Juntar ' + (ts.length === 1 ? 'el pedido' : 'los ' + ts.length + ' pedidos') + ' de la ' + tanda + ' en una tarjeta por rubro, en ' + destino +
      '? Los pedidos originales quedan en Procesando. Todavía no se les manda nada a los proveedores.',
    botones: [{ texto: 'Sí, juntarlos', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }]
  });
  if (!si) return;
  bandeja.agregar('mandarTanda', [], 'juntar la ' + tanda + ' y mandarla a ' + destino);
  pintarTablero();
  aviso(APP.enLinea ? 'Juntando la tanda…' : '📶 Poca señal: la tanda se junta sola cuando vuelva.');
}

/** ¿Espera en la bandeja juntar la tanda? */
function juntandoTanda() { return bandeja.lista().some(function (m) { return m.fn === 'mandarTanda'; }); }

/** "⏰ Hace 15 días de la última tanda": cuando ya pasaron los días de Ajustes (dias_tanda). */
function avisoTanda(ts) {
  const t = TB.datos && TB.datos.tanda;
  if (!t || !t.cada) return '';
  let dias = t.dias;
  if (dias === null || dias === undefined) {           // nunca se mandó: desde el pedido más viejo de la tanda
    const viejo = ts.reduce(function (m, x) { const f = new Date(x.fecha).getTime(); return isNaN(f) ? m : Math.min(m, f); }, Date.now());
    dias = Math.floor((Date.now() - viejo) / 86400000);
  }
  return dias >= t.cada ? '⏰ Hace ' + dias + ' días' + (t.dias === null || t.dias === undefined ? ' que espera el pedido más viejo' : ' de la última tanda') : '';
}

// Cuando la tanda se juntó: propone pedir la cotización de todas sus tarjetas juntas (Feli)
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (m.fn !== 'mandarTanda') return;
    cargarTablero();
    if (!r.ok || document.hidden) return;
    const n = (r.tarjetas || []).length, p = (r.pedidos || []).length;
    if (!n) return aviso(p ? 'Ningún producto se pudo juntar por rubro: ' + (p === 1 ? 'el pedido pasó' : 'los ' + p + ' pedidos pasaron') + ' a ' + colPorCotizar() + '.' : 'La tanda ya estaba vacía.');
    if (!APP.yo.admin) return;
    dialogo({
      titulo: '¿Pedir cotización ahora?',
      texto: 'La tanda quedó en ' + (n === 1 ? '1 tarjeta' : n + ' tarjetas') + ' por rubro, en ' + colPorCotizar() + '.' +
        (p ? ' ' + (p === 1 ? 'Un pedido pasó' : p + ' pedidos pasaron') + ' con lo que no se pudo juntar (fuera del padrón, OTROS o Sin rubro).' : '') +
        ' Si no, se pide después desde cada tarjeta.',
      botones: [{ texto: 'Sí, pedir ahora', clase: 'btn', valor: true }, { texto: 'Después', valor: null }]
    }).then(function (ya) { if (ya) abrirPedirCotizacion(r.tarjetas); });
  };
})();

/* ---------- Stand by (Paso 2-ter): plegada, abajo del tablero ----------
   Los pedidos que llevaron 10 días hábiles en Entrantes (o que un admin mandó). */
const K_STANDBY = 'nueva_standby_abierto';
function pintarStandby() {
  const cont = $('tb-standby');
  if (!cont) return;
  cont.hidden = !TB.datos;
  if (!TB.datos) { cont.innerHTML = ''; return; }
  const lista = vista().filter(function (t) { return t.columna === colStandby() && seVe(t); });
  const abierto = guardado.leer(K_STANDBY) === '1';
  cont.innerHTML = '<button type="button" class="proc-h" id="tb-sb-h" aria-expanded="' + abierto + '">' + (abierto ? '▾' : '▸') +
    ' 💤 ' + esc(colStandby()) + ' <span class="n">(' + lista.length + ')</span></button>' +
    (abierto && !lista.length ? '<p class="nota" style="margin:0 0 6px">No hay ninguno. Acá pasan solos los pedidos que llevan 10 días hábiles en ' + esc(colEntrantes()) + '. Se sacan con "Mover a…".</p>' : '') +
    (abierto && lista.length ? '<div class="proc-l">' + lista.map(function (x) {
      return '<button type="button" class="proc-i" data-ref="' + esc(x.ref) + '"><b>' + esc(emojiUrgencia(x.urgencia)) + ' ' + esc(x.sitio) + ' · ' + esc(x.titulo || x.ref) + '</b>' +
        '<small>' + esc(x.solicitante ? 'Pidió ' + x.solicitante : '') + (x.fecha ? ' · cargado el ' + esc(fechaLinda(x.fecha)) : '') + '</small></button>';
    }).join('') + '</div>' : '');
  $('tb-sb-h').addEventListener('click', function () {
    guardado.guardar(K_STANDBY, abierto ? '' : '1');
    pintarStandby();
  });
  cont.querySelectorAll('.proc-i').forEach(function (b) {
    b.addEventListener('click', function (e) { if (TB.recienArrastrada) { e.preventDefault(); return; } abrirTarjeta(b.dataset.ref); });
    // Paso 6: con la franja abierta, una tarjeta de Stand by se arrastra a cualquier columna
    if (APP.yo && APP.yo.admin) {
      b.addEventListener('touchstart', function (e) { tocar(e, b, b.dataset.ref); }, { passive: true });
      b.addEventListener('mousedown', function (e) { conMouse(e, b, b.dataset.ref); });
    }
  });
}

/* ---------- Procesando (Fase 3): plegada, arriba de la Tanda verde ----------
   Los pedidos cuyos productos ya están todos en tarjetas de trabajo. Una
   línea por pedido, con dónde está cada tarjeta. Se toca y abre el pedido. */
const K_PROCESANDO = 'nueva_procesando_abierto';
function pintarProcesando() {
  const cont = $('tb-procesando');
  // Se ve siempre, aunque esté vacía (Feli), así se sabe dónde van a aparecer
  const lista = ((TB.datos && TB.datos.procesando) || []).filter(seVe);
  cont.hidden = !TB.datos;
  if (!TB.datos) { cont.innerHTML = ''; return; }
  const abierto = guardado.leer(K_PROCESANDO) === '1';
  cont.innerHTML = '<button type="button" class="proc-h" id="tb-proc-h" aria-expanded="' + abierto + '">' + (abierto ? '▾' : '▸') +
    ' 📦 Procesando <span class="n">(' + lista.length + ')</span></button>' +
    (abierto && !lista.length ? '<p class="nota" style="margin:0 0 6px">Todavía no hay ninguno. Acá aparecen los pedidos que tienen alguna tarjeta de seguimiento (las que se arman en la Decisión y en la Tanda verde). Si les falta decidir algo, siguen además en su columna.</p>' : '') +
    (abierto && lista.length ? '<div class="proc-l">' + lista.map(function (x) {
      return '<button type="button" class="proc-i" data-ref="' + esc(x.ref) + '"><b>' + esc(emojiUrgencia(x.urgencia)) + ' ' + esc(x.sitio) + ' · ' + esc(x.titulo || x.ref) + '</b>' +
        '<small>' + (x.columna ? '📍 El pedido sigue en ' + esc(x.columna) + ' con lo que falta · ' : '') + esc(x.resumen || '') + '</small></button>';
    }).join('') + '</div>' : '');
  $('tb-proc-h').addEventListener('click', function () {
    guardado.guardar(K_PROCESANDO, abierto ? '' : '1');
    pintarProcesando();
  });
  cont.querySelectorAll('.proc-i').forEach(function (b) { b.addEventListener('click', function () { abrirTarjeta(b.dataset.ref); }); });
}

/* Sin franjas roja ni verde (Feli, 2026-10-04: ensucian la vista): la urgencia es solo el globito de color. */
function htmlTarjeta(t, enPorRecibir) {
  return '<div class="tarjeta" data-ref="' + esc(t.ref) + '" role="button" tabindex="0">' +
    (t.nuevo ? '<div class="nuevo-t">Nuevo</div>' : '') +                       // Feli (2026-10-06): nunca lo abriste
    (t.trabajo ? '<div class="sobre">📋 Tarjeta de seguimiento</div>' : '') +       // Feli: que se note en el tablero
    (t.manual ? '<div class="sobre">✋ Gestión manual</div>' : '') +                                          // Paso 5
    (t.enEntregas ? '<div class="sobre en-entregas">📍 Parte de este pedido está en seguimiento de entrega</div>' : '') +   // Paso 6
    (t.aprobacion === 'Esperando' ? '<div class="sobre">⏳ Esperando aprobación</div>' : '') +
    htmlMarcaRecepcion(t) +                                                        // Fase 4, Paso 1-bis (recepcion.js)
    (t.fueraPadron ? '<div class="sobre fuera-padron">✋ Contiene productos fuera del padrón</div>' : '') +   // Pasos 3 y 4
    '<div class="t">' + esc(t.titulo || t.ref) + '</div>' +
    (t.subtitulo ? '<div class="sub-t">' + esc(t.subtitulo) + '</div>' : '') +          // Feli (2026-10-06): el proveedor o el rubro, aparte
    '<div class="pie"><span aria-label="' + esc(t.urgencia) + '">' + esc(emojiUrgencia(t.urgencia)) + '</span>' +
    '<span class="sitio">' + esc(t.sitio) + '</span>' +
    (enPorRecibir && t.entrega ? '<span class="entrega">' + esc(ENTREGA_CORTO[t.entrega] || t.entrega) + '</span>' : '') +
    (t.paraAprobar && APP.yo && APP.yo.admin ? '<span class="aprobar" title="Cambios para aprobar">⏳ ' + t.paraAprobar + '</span>' : '') +
    (t.responsable ? '<span class="resp" title="Responsable: ' + esc(t.responsable) + '">' + esc(inicial(t.responsable)) + '</span>' : '') +
    '</div>' + (t.standbyEn ? '<div class="sb-aviso">⏰ Pasa a stand by en ' + t.standbyEn + (t.standbyEn === 1 ? ' día' : ' días') + '</div>' : '') +   // Paso 2-ter
    htmlMarcaCotizar(t) + '</div>';                                                // Fase 3: "📤 Pedir cotización" (cotizar.js)
}

/* ---------- Secciones: saltar al principio de cada una ---------- */
function pintarSecciones() {
  const cont = $('tb-secciones');
  const secs = [];
  columnasTb().forEach(function (c) { if (secs.indexOf(c.seccion) === -1) secs.push(c.seccion); });
  if (cont.dataset.secs !== secs.join('|')) {
    cont.dataset.secs = secs.join('|');
    // En el celular se ven como puntitos (css): el nombre queda para el lector de pantalla y al dejar el dedo encima
    cont.innerHTML = secs.map(function (s) { return '<button type="button" role="tab" data-sec="' + esc(s) + '" aria-label="' + esc(s) + '" title="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
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
    TB.datos = { columnas: r.columnas, tarjetas: r.tarjetas, procesando: r.procesando || [], porRecibir: r.porRecibir, version: r.version, actualizado: r.actualizado,
                 standby: r.standby || 'Stand by', tanda: r.tanda || null };
    if (typeof notifSinLeer === 'function' && r.sinLeer !== undefined) notifSinLeer(r.sinLeer);   // notificaciones.js
    guardado.guardarJSON(K_TABLERO, TB.datos);
    if (!TB.arrastre) pintarTablero();
    if (TB.abierta && TB.tipo !== 'tarea') { pintarTarjeta(); traerTarjeta(TB.abierta); }   // ej. un comentario nuevo de otro
    precargarMisTarjetas();
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
// Fase 5: con el canal "al instante" vivo, el aviso trae la versión nueva (v) y no hace falta preguntar.
async function vigilarCambios(v) {
  if (!tableroALaVista() || TB.arrastre || TB.cargando || !TB.datos || !APP.token) return;
  if (v) { if (v !== TB.datos.version) cargarTablero(); return; }
  let r;
  try { r = await llamar('versionTablero', [APP.token]); } catch (e) { return; }
  if (r.ok && r.version !== TB.datos.version) cargarTablero();
}
setInterval(function () { if (!tiempoRealVivo()) vigilarCambios(); }, 8000);
alCambiar(function (c) { if (c.que === 'tablero') vigilarCambios(c.v); else if (c.que === 'conectado') vigilarCambios(); });
conectarTiempoReal();
setInterval(function () { if (tableroALaVista() && !TB.arrastre) cargarTablero(); }, 120000);
setInterval(pintarHace, 30000);
document.addEventListener('visibilitychange', function () { if (tableroALaVista()) cargarTablero(); });
window.addEventListener('online', function () { if (tableroALaVista()) cargarTablero(); });

/* ---------- Mover (lo usan arrastrar y la tarjeta abierta) ---------- */
async function moverA(ref, destino, despuesDe) {
  const t = buscarEnVista(ref) || TB.reabiertos[ref];
  if (!t) return pintarTablero();
  // Una columna ordenada por fecha (Paso 2-bis): dentro de ella no se cambia el orden a mano
  if (destino === t.columna && ordenDe(destino)) {
    aviso('"' + destino + '" está ordenada por fecha: para cambiar el orden a mano, tocá "' + ORDEN_TEXTO[ordenDe(destino)] + '" arriba de la columna hasta que diga "' + ORDEN_TEXTO[''] + '".');
    return pintarTablero();
  }
  const op = { columna: destino, despuesDe: despuesDe, desde: t.columna };
  if (destino !== t.columna && destino === colPorRecibir()) {
    const e = await preguntarEntrega(t.entrega);
    if (!e) return pintarTablero();
    op.entrega = e;
  }
  if (destino !== t.columna && destino === colEntregado()) {
    const d = await preguntarRetiro(t);
    if (!d) return pintarTablero();
    op.retiro = d.retiro;
    op.fechaRetiro = d.fecha;
  }
  const que = TB.reabiertos[ref] && !buscarEnVista(ref) ? 'reabrir "' : destino === t.columna ? 'reordenar "' : 'mover "';
  bandeja.agregar('moverTarjeta', [ref, op], que + t.titulo + '" a ' + destino);
  pintarTablero();
  if (TB.abierta === ref) pintarTarjeta();
  // Feli (2026-10-07): al llegar a Por cotizar ya no pregunta "¿Pedir cotización ahora?": se pide desde la tarjeta abierta
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
    // Paso 6: también se arrastra desde la franja de Stand by (sus líneas no están en una .lista)
    origen: el.closest('.lista') ? el.closest('.lista').dataset.columna : colStandby(), despuesDeOriginal: tarjetaAnterior(hueco, el)
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
  // Paso 6: soltar sobre la franja de Stand by la manda ahí (solo en el tablero de pedidos)
  const sb = a.ctx === CTX_PEDIDOS && bajo && bajo.closest ? bajo.closest('#tb-standby') : null;
  a.sobreStandby = !!sb;
  $('tb-standby').classList.toggle('destino', !!sb);
  if (sb) return;
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
  $('tb-standby').classList.remove('destino');
  if (!cancelado && a.sobreStandby) {
    if (a.origen === colStandby()) return a.ctx.repintar();
    const t = buscarEnVista(a.ref);
    if (t && t.trabajo) { aviso('A Stand by van los pedidos, no las tarjetas de seguimiento.'); return a.ctx.repintar(); }
    return a.ctx.mover(a.ref, colStandby(), '*');
  }
  const lista = a.hueco.parentNode;
  if (cancelado || !lista || !lista.classList.contains('lista')) return a.ctx.repintar();
  const destino = lista.dataset.columna;
  const despuesDe = tarjetaAnterior(a.hueco, a.el);
  if (destino === a.origen && despuesDe === a.despuesDeOriginal) return a.ctx.repintar();
  a.ctx.mover(a.ref, destino, despuesDe);
}

/**
 * Paso 6: un acceso directo (de la tarjeta original a la de seguimiento, o al revés) reemplaza la tarjeta
 * abierta: así la X cierra y el tablero queda sobre la tarjeta a la que se llegó.
 */
function irPorAccesoDirecto(ref) {
  TB.irAlCerrar = ref;
  const habia = !!(history.state && history.state.tarjeta);
  abrirTarjeta(ref, habia);
  if (habia) history.replaceState({ tarjeta: ref }, '', '#' + encodeURIComponent(ref));
}

/**
 * Paso 6: mueve el tablero hasta una tarjeta y la marca un segundo, como si se hubiera ido a mano.
 * Si está en Procesando o en Stand by, abre la franja y marca su línea.
 */
function irATarjeta(ref) {
  if (document.body.dataset.pantalla !== 'tablero') return;
  const sel = '[data-ref="' + (window.CSS && CSS.escape ? CSS.escape(ref) : ref) + '"]';
  let el = $('tablero').querySelector('.tarjeta' + sel);
  if (!el) {
    const enSb = vista().some(function (t) { return t.ref === ref && t.columna === colStandby(); });
    const enProc = ((TB.datos && TB.datos.procesando) || []).some(function (x) { return x.ref === ref; });
    if (enSb) { guardado.guardar(K_STANDBY, '1'); pintarStandby(); el = $('tb-standby').querySelector('.proc-i' + sel); }
    else if (enProc) { guardado.guardar(K_PROCESANDO, '1'); pintarProcesando(); el = $('tb-procesando').querySelector('.proc-i' + sel); }
  }
  if (!el) return;
  const col = el.closest('.col');
  if (col) $('tablero').scrollTo({ left: Math.max(0, col.offsetLeft - 12), behavior: 'smooth' });
  const lista = el.closest('.lista, .proc-l');
  if (lista) lista.scrollTo({ top: Math.max(0, el.offsetTop - lista.offsetTop - 40), behavior: 'smooth' });
  el.classList.add('resaltada');
  setTimeout(function () { el.classList.remove('resaltada'); }, 1600);
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

/**
 * "¿Quién lo retiró?" con botones (Feli, 2026-10-05): primero, ya elegida, la persona que hizo el pedido
 * (en una tarjeta de seguimiento, quienes hicieron sus pedidos); después las demás, y "Otro" para escribir.
 * A esa persona le llega "¿Recibiste este pedido?" (Fase 4, Paso 1-bis).
 */
function preguntarRetiro(t) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  const todos = APP.config.usuarios || [];
  const sugeridos = ((t && (t.solicitantes && t.solicitantes.length ? t.solicitantes : [t.solicitante])) || [])
    .filter(function (n) { return n && todos.indexOf(n) !== -1; });
  const otros = todos.filter(function (n) { return sugeridos.indexOf(n) === -1; });
  const boton = function (n, sub) {
    return '<button type="button" class="choice" data-nombre="' + esc(n) + '">' + esc(n) + (sub ? ' <small>· ' + sub + '</small>' : '') + '</button>';
  };
  cuerpo.innerHTML = '<label>¿Quién lo retiró?</label><p class="nota" style="margin:0 0 6px">Le llega un WhatsApp para que confirme que lo recibió.</p>' +
    '<div class="opciones" id="dg-quien">' + sugeridos.map(function (n) { return boton(n, 'hizo el pedido'); }).join('') +
    (otros.length ? '<h4>Otras personas</h4>' + otros.map(function (n) { return boton(n); }).join('') : '') +
    '<button type="button" class="choice" data-nombre="" id="dg-otro">Otro…</button></div>' +
    '<input type="text" id="dg-retiro" autocomplete="off" placeholder="¿Quién?" hidden style="width:100%;font:inherit;min-height:48px;border:1.5px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--bg);color:var(--fg);margin-top:6px">' +
    '<label for="dg-fecha">¿Cuándo?</label><input type="date" id="dg-fecha" value="' + hoyTexto() + '" max="' + hoyTexto() + '">';
  let elegido = sugeridos[0] || '';
  return dialogo({
    titulo: 'Pasa a "' + colEntregado() + '"', cuerpo: cuerpo,
    botones: [
      { texto: 'Listo', clase: 'btn', id: 'dg-ok', valor: function () {
        const quien = $('dg-retiro').hidden ? elegido : $('dg-retiro').value.trim();
        return { retiro: quien, fecha: $('dg-fecha').value };
      } },
      { texto: 'Volver', valor: null }
    ],
    alAbrir: function () {
      const ok = $('dg-ok'), input = $('dg-retiro');
      const revisar = function () { ok.disabled = input.hidden ? !elegido : !input.value.trim(); };
      const marcar = function () {
        cuerpo.querySelectorAll('#dg-quien .choice').forEach(function (b) {
          b.setAttribute('aria-current', String(input.hidden ? b.dataset.nombre === elegido && !!elegido : b.id === 'dg-otro'));
        });
      };
      cuerpo.querySelectorAll('#dg-quien .choice').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.id === 'dg-otro') { input.hidden = false; input.focus(); }
          else { input.hidden = true; elegido = b.dataset.nombre; }
          marcar(); revisar();
        });
      });
      input.addEventListener('input', revisar);
      marcar(); revisar();
    }
  });
}

/* ---------- Tarjeta abierta ---------- */
/**
 * Fase 5 (parte C del Paso 8): un encargado o empleado abre sus pedidos aunque no haya señal. Con señal, el teléfono
 * guarda de antemano el detalle de sus tarjetas (las que no tiene o tiene de hace más de 15 minutos), de a una y como
 * mucho 8 por vez. Los admins abren muchas distintas: guardan solo las que abren.
 */
let precargando = false;
async function precargarMisTarjetas() {
  if (precargando || !APP.yo || APP.yo.admin || !TB.datos || !APP.enLinea) return;
  precargando = true;
  try {
    const guardadas = detallesGuardados(), limite = Date.now() - 15 * 60000;
    const faltan = (TB.datos.tarjetas || []).filter(function (t) {
      return esMio(t) && !/^W/.test(t.ref) && (!guardadas[t.ref] || guardadas[t.ref].cuando < limite);
    }).slice(0, 8);
    for (const t of faltan) {
      if (TB.abierta === t.ref || !APP.enLinea) continue;
      const r = await api('getTarjeta', t.ref, { historia: false });
      if (!r.ok) break;
      if (TB.abierta === t.ref) continue;           // la abrió mientras tanto: la guarda traerTarjeta
      guardarDetalle(t.ref, { pedido: r.pedido, lineas: r.lineas, comentarios: r.comentarios || [], adjuntos: r.adjuntos || [],
                              trabajo: r.trabajo || null, tarjetas: r.tarjetas || [], partesViejas: r.partesViejas || {},
                              solicitudes: r.solicitudes || [], presupuestos: r.presupuestos || [], compra: r.compra || null });
    }
  } finally { precargando = false; }
}

function detallesGuardados() { return guardado.leerJSON(K_TARJETAS, {}); }
function guardarDetalle(ref, d) {
  const todos = detallesGuardados();
  todos[ref] = { d: d, cuando: Date.now() };
  const refs = Object.keys(todos).sort(function (a, b) { return todos[b].cuando - todos[a].cuando; });
  refs.slice(40).forEach(function (r) { delete todos[r]; });   // las últimas 40
  guardado.guardarJSON(K_TARJETAS, todos);
}

/** "Nuevo" (Feli, 2026-10-06): al abrirla deja de serlo enseguida (el servidor lo anota con getTarjeta). */
function sacarNuevo(ref) {
  [TB.datos, typeof SV !== 'undefined' ? SV.datos : null].forEach(function (d) {
    const t = d && d.tarjetas && d.tarjetas.filter(function (x) { return x.ref === ref && x.nuevo; })[0];
    if (!t) return;
    t.nuevo = false;
    const el = document.querySelector('.tarjeta[data-ref="' + CSS.escape(ref) + '"] .nuevo-t');
    if (el) el.remove();
  });
}

async function abrirTarjeta(ref, sinHistoria) {
  if (!ref) return;
  TB.tipo = /^K/.test(ref) ? 'tarea' : 'pedido';     // las tareas (Paso 4-ter) usan la misma ventana
  if (TB.tipo === 'tarea' && !(APP.yo && APP.yo.admin)) return;
  TB.abierta = ref;
  sacarNuevo(ref);
  const g = detallesGuardados()[ref];
  TB.detalle = g ? g.d : null;
  TB.guardadoDesde = g ? g.cuando : 0;           // Fase 5 (parte C del Paso 8): de cuándo es lo guardado
  TB.viejo = false;
  TB.sinDetalle = '';
  ponerBorrador(ref);
  pintarTarjeta();
  pintarViejo();
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
                   adjuntos: r.adjuntos || [], lineas: [], historia: conHistoria ? r.historia : (antes ? antes.historia : undefined) };
    TB.sinDetalle = '';
    guardarDetalle(ref, TB.detalle);
  } else if (r.ok) {
    const antes = TB.detalle;
    TB.detalle = { pedido: r.pedido, lineas: r.lineas, comentarios: r.comentarios || [], adjuntos: r.adjuntos || [],
                   trabajo: r.trabajo || null, tarjetas: r.tarjetas || [], partesViejas: r.partesViejas || {}, solicitudes: r.solicitudes || [],
                   presupuestos: r.presupuestos || [], compra: r.compra || null,          // Fase 4, Pasos 3 y 5
                   historia: conHistoria ? r.historia : (antes ? antes.historia : undefined) };
    TB.sinDetalle = '';
    guardarDetalle(ref, TB.detalle);
  } else if (r.sinConexion) { TB.sinDetalle = TB.detalle ? '' : 'Hay poca señal: los productos se ven cuando vuelva.'; TB.viejo = !!TB.detalle; }
  else if (!r.sinSesion) TB.sinDetalle = r.error;
  if (r.ok) { TB.viejo = false; TB.guardadoDesde = Date.now(); }
  pintarTarjeta();
  pintarViejo();
  if (TB.traerOtraVez) { TB.traerOtraVez = false; traerTarjeta(ref); }
}

/** Sin señal, la tarjeta muestra lo guardado en el teléfono y dice de cuándo es (se actualiza sola al volver la señal). */
function pintarViejo() {
  let el = $('tj-viejo');
  if (!el) {
    el = document.createElement('p');
    el.id = 'tj-viejo'; el.className = 'nota';
    $('tj-etiquetas').parentNode.insertBefore(el, $('tj-etiquetas'));
  }
  el.hidden = !(TB.abierta && TB.viejo && TB.guardadoDesde);
  if (!el.hidden) el.textContent = '📶 Poca señal: lo que ves es ' + deCuando(TB.guardadoDesde) + '. Se actualiza solo cuando vuelva la señal.';
}
/** "de las 10:40" (hoy), "de ayer a las 10:40" o "del 8/10 a las 10:40". */
function deCuando(ms) {
  const d = new Date(ms), hoy = new Date(), ayer = new Date(Date.now() - 864e5);
  const hora = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === hoy.toDateString()) return 'de las ' + hora;
  if (d.toDateString() === ayer.toDateString()) return 'de ayer a las ' + hora;
  return 'del ' + d.getDate() + '/' + (d.getMonth() + 1) + ' a las ' + hora;
}

function ocultarTarjeta() {
  // Paso 6: si se llegó por un acceso directo, al cerrar el tablero queda sobre esa tarjeta
  const ir = TB.irAlCerrar && TB.irAlCerrar === TB.abierta ? TB.abierta : null;
  TB.irAlCerrar = null;
  if (ir) setTimeout(function () { irATarjeta(ir); }, 60);
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
// Un link #Ref con la app ya abierta (ej. el WhatsApp de una mención): abre esa tarjeta
window.addEventListener('hashchange', function () {
  const ref = decodeURIComponent(location.hash.slice(1));
  if (ref === 'cuenta') { if (APP.token && !$('app').hidden) abrir('cuenta'); return; }
  if (ref && APP.token && !$('app').hidden && TB.abierta !== ref) abrirPorLink(ref);
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

function idDrive(url) { const m = /[?&]id=([\w-]+)/.exec(url) || /\/d\/([\w-]+)/.exec(url) || /\/archivos\/([\w-]+)/.exec(url); return m ? m[1] : ''; }

/** Una tarjeta de trabajo (Fase 3): productos de uno o varios pedidos, que se mueve por su lado. */
function esTrabajo(ref) { return /^W/.test(ref || ''); }
/** ¿La tarjeta abierta es un servicio (Paso 2-ter)? Lo dice el servidor, o el tablero de Servicios si todavía no llegó. */
function esServicioAbierto() {
  const d = TB.detalle;
  if (d && d.pedido) return !!d.pedido.servicio;
  return typeof buscarServicio === 'function' && !!buscarServicio(TB.abierta);
}

function pintarTarjeta() {
  const ref = TB.abierta;
  if (!ref) return;
  bloquesDeTarea(TB.tipo === 'tarea');
  if (TB.tipo === 'tarea') return pintarTareaAbierta();      // tareas.js
  $('tj-prod-b').hidden = false;
  $('tj-desc-t').textContent = 'Descripción';
  if (esServicioAbierto()) return pintarServicioAbierto();   // servicios.js (Paso 2-ter)
  const t = buscarEnVista(ref);
  const d = TB.detalle, p = d ? d.pedido : null;
  const admin = APP.yo.admin;
  const columna = t ? t.columna : (p ? p.columna : '');
  const enTb = !!t;
  const trabajo = esTrabajo(ref);

  const chip = $('tj-columna');
  const puedeMover = admin && enTb;
  chip.textContent = (columna || '…') + (puedeMover ? ' ⌄' : '');
  chip.disabled = !puedeMover;
  chip.title = puedeMover ? 'Mover a…' : '';
  $('tj-titulo').textContent = (t && t.titulo) || (p && p.titulo) || ref;
  const subt = (t && t.subtitulo) || (p && p.subtitulo) || '';                   // tarjetas de seguimiento: el proveedor o el rubro
  $('tj-subtitulo').textContent = subt;
  $('tj-subtitulo').hidden = !subt;

  const responsable = t ? t.responsable : (p ? p.responsable : '');
  const entrega = t ? t.entrega : (p ? p.entrega : '');
  const datos = [];
  const dato = function (etiqueta, html) { datos.push('<div class="dato"><small>' + esc(etiqueta) + '</small><div class="v">' + html + '</div></div>'); };
  dato('Sitio', esc((t && t.sitio) || (p && p.sitio) || ''));
  dato('Urgencia', esc((t && t.urgencia) || (p && p.urgencia) || ''));
  dato('Pidió', esc((p && p.solicitante) || (t && (t.solicitante || (t.solicitantes || []).join(', '))) || ''));
  if (p) dato(trabajo ? 'Armada' : 'Cargado', esc(fechaLinda(p.fecha)));
  // Masivo (Paso 6): con qué encargados se compartió
  if ((t && t.masivo) || (p && p.origen === 'masivo')) {
    const comp = (p ? pedidoConCambios(ref, p).compartido : t.compartido) || [];
    dato('Compartido con', esc(comp.length ? comp.join(', ') : 'Solo los admins'));
  }
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
  if (trabajo) etiquetas.push('📋 Tarjeta de seguimiento');
  if ((t && t.masivo) || (p && p.origen === 'masivo')) etiquetas.push('Pedido masivo');
  if (t ? t.manual : (p && p.manual)) etiquetas.push('✋ Gestión manual');
  if (!enTb && p && p.columna) etiquetas.push((p.columna === 'Procesando' ? '📦 ' : 'Finalizado: ') + p.columna);
  $('tj-etiquetas').innerHTML = etiquetas.map(function (e) { return '<span class="etiqueta">' + esc(e) + '</span>'; }).join('');
  pintarEnlaces(d, trabajo);

  const pv = p ? pedidoConCambios(ref, p) : null;
  $('tj-razon').textContent = pv ? (pv.razon || '—') : (TB.sinDetalle || 'Cargando…');
  $('tj-razon-b').hidden = trabajo || !!(pv && !pv.razon && pv.descripcion);   // masivo libre sin razón: con la descripción alcanza
  $('tj-editar').hidden = !(admin && p) || trabajo;
  // Descripción: la del pedido masivo libre (Paso 6), o la de una tarjeta de trabajo
  $('tj-desc-b').hidden = !(pv && pv.descripcion);
  if (pv && pv.descripcion) {
    $('tj-desc').textContent = pv.descripcion;
    $('tj-desc-editar').hidden = !admin || trabajo;
  }
  const prods = $('tj-productos');
  if (d && d.lineas) {
    const todas = lineasConCambios(ref, d.lineas).filter(function (l) { return l.estado !== 'Rechazado' && l.estado !== 'Retirado'; });
    const ls = todas.filter(vigente);
    const comprados = ls.filter(function (l) { return l.tildado; }).length;
    const esperan = todas.filter(function (l) { return l.estado === 'Para agregar' || l.estado === 'Para quitar'; }).length;
    $('tj-prod-t').textContent = 'Productos (' + ls.length + ')' + (comprados ? ' · ' + comprados + ' recibido' + (comprados > 1 ? 's' : '') : '') +
      (esperan ? ' · ⏳ ' + esperan + ' para aprobar' : '');
    // Los quitados, abajo de todo
    const orden = todas.filter(function (l) { return l.estado !== 'Quitado'; }).concat(todas.filter(function (l) { return l.estado === 'Quitado'; }));
    const mio = ((t && t.solicitante) || (p && p.solicitante)) === APP.yo.nombre;
    // En una tarjeta de trabajo, los productos se tildan; se editan en su pedido
    prods.innerHTML = trabajo ? orden.map(function (l) { return htmlProducto(l, false, false); }).join('')
                              : htmlPorRubro(orden, admin, mio, d.tarjetas || []);
    $('tj-agregar').hidden = !(admin || mio) || !enTb || trabajo;
  } else {
    $('tj-agregar').hidden = true;
    $('tj-prod-t').textContent = 'Productos';
    prods.innerHTML = '<p class="nota">' + esc(TB.sinDetalle || 'Cargando…') + '</p>';
  }
  // Paso 5: pasar a gestión manual o volver a automática (no los masivos, que son siempre manuales)
  const manual = t ? !!t.manual : !!(p && p.manual);
  $('tj-manual').hidden = !(admin && enTb && p && !trabajo && p.origen !== 'masivo' && !p.servicio);
  $('tj-manual').textContent = manual ? '🤖 Volver a automática' : '✋ Pasar a gestión manual';
  $('tj-cancelar').hidden = !(admin && enTb);
  $('tj-cancelar').textContent = trabajo ? 'Cancelar esta tarjeta' : 'Cancelar pedido';
  $('tj-reabrir').hidden = !(admin && !enTb && p && p.volverA);     // Paso 5
  $('tj-reabrir').textContent = trabajo ? '↩️ Reabrir la tarjeta' : '↩️ Reabrir el pedido';
  pintarAdjuntos();
  pintarCotizaciones();                                                    // cotizar.js
  pintarAprobacion();                                                      // Paso 6 (cotizar.js)
  pintarRecepcion();                                                       // Fase 4, Paso 1-bis (recepcion.js)
  pintarHablando();                                                        // Fase 4, Paso 2 (chats.js)
  pintarPresupuestos();                                                    // Fase 4, Paso 3 (presupuestos.js)
  pintarCompra();                                                         // Fase 4, Paso 5 (presupuestos.js)
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
  prods.querySelectorAll('[data-ia]').forEach(function (b) {              // Paso 5
    b.addEventListener('click', function () {
      const l = lineaVista(ref, b.dataset.id);
      if (!l || !l.ia) return;
      if (b.dataset.ia === 'aprobar') return editarProducto(ref, l.id, { familia: l.ia.nombre, especificacion: l.ia.especificacion, canal: l.ia.rubro });
      IA_DESCARTADAS[l.id] = true;
      bandeja.agregar('descartarIA', [ref, l.id], 'descartar lo que propuso la IA para "' + nombreProducto(l) + '"');
      pintarTarjeta();
    });
  });
  prods.querySelectorAll('[data-foto]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); verFoto(a.dataset.foto); });
  });
  prods.querySelectorAll('[data-abrir-ref]').forEach(function (b) {
    b.addEventListener('click', function () { irPorAccesoDirecto(b.dataset.abrirRef); });
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

/**
 * Ida y vuelta (Fase 3): una tarjeta de trabajo dice de qué pedidos viene;
 * un pedido muestra las tarjetas de trabajo que salieron de él.
 */
function pintarEnlaces(d, trabajo) {
  const cont = $('tj-enlaces');
  const ir = function (ref, texto, detalle) {
    return '<button type="button" class="ir" data-abrir-ref="' + esc(ref) + '"><span>' + esc(texto) +
      (detalle ? '<small style="display:block">' + esc(detalle) + '</small>' : '') + '</span>›</button>';
  };
  let html = '';
  if (trabajo && d && d.trabajo && d.trabajo.tanda && d.trabajo.pedidos.length) {
    // Paso 4: una mini tarjeta por pedido de la tanda, con sus productos; abre el pedido original completo
    html = '<small>Pedidos de esta tanda (' + d.trabajo.pedidos.length + ')</small>' +
      d.trabajo.pedidos.map(function (x) {
        const prods = (d.lineas || []).filter(function (l) { return l.ref === x.ref && vigente(l); })
          .map(function (l) { return l.cantidad + 'x ' + nombreProducto(l); }).join(', ');
        return ir(x.ref, x.solicitante + ' · ' + x.sitio, prods);
      }).join('');
  } else if (trabajo && d && d.trabajo && d.trabajo.pedidos.length) {
    html = '<small>Esta tarjeta es una tarjeta de seguimiento ' + (d.trabajo.pedidos.length === 1 ? 'del pedido:' : 'de los pedidos:') + '</small>' +
      d.trabajo.pedidos.map(function (x) { return ir(x.ref, '📦 ' + (x.titulo || x.ref), x.sitio + ' · ' + x.solicitante); }).join('');
  } else if (!trabajo && d && d.tarjetas && d.tarjetas.length) {
    html = '<small>Sus tarjetas de seguimiento</small>' +
      d.tarjetas.map(function (w) { return ir(w.id, '📋 ' + w.nombre + ' · ' + w.estado, w.titulo); }).join('');
  }
  cont.hidden = !html;
  cont.innerHTML = html;
  cont.querySelectorAll('[data-abrir-ref]').forEach(function (b) {
    b.addEventListener('click', function () { irPorAccesoDirecto(b.dataset.abrirRef); });
  });
}

/**
 * Los productos de un pedido agrupados por rubro (o por sus proveedores particulares), solo como lista.
 * Con un solo grupo, como siempre. Si un producto ya está en una tarjeta de trabajo, lo dice y la abre.
 */
function htmlPorRubro(lineas, admin, mio, tarjetas) {
  const deTarjeta = {};
  tarjetas.forEach(function (w) { deTarjeta[w.id] = w; });
  const conTarjeta = function (l) {
    // Fase 4, Paso 5: "Comprado en {proveedor} · En seguimiento de entrega" (abre su tarjeta de seguimiento)
    if (l.compra && l.compra.tarjeta !== TB.abierta) {
      return htmlProducto(l, admin, mio, '<button type="button" class="en-tarjeta comprado" data-abrir-ref="' + esc(l.compra.tarjeta) + '">🛒 Comprado en ' +
        esc(l.compra.proveedor + ' · ' + l.compra.estado) + ' ›</button>');
    }
    const w = l.tarjeta && deTarjeta[l.tarjeta];
    return htmlProducto(l, admin, mio, w ? '<button type="button" class="en-tarjeta" data-abrir-ref="' + esc(w.id) + '">📋 ' +
      esc(w.nombre + ' · ' + w.estado) + ' ›</button>' : '');
  };
  const grupo = function (l) {
    if (l.estado === 'Quitado') return '';
    if ((l.proveedores || []).length) return '🎯 ' + l.proveedores.map(function (x) { return x.nombre; }).join(', ');
    return l.canal || 'Sin rubro';
  };
  const grupos = [], porGrupo = {};
  lineas.forEach(function (l) {
    const g = grupo(l);
    if (!porGrupo[g]) { porGrupo[g] = []; grupos.push(g); }
    porGrupo[g].push(l);
  });
  const conNombre = grupos.filter(String);
  if (conNombre.length <= 1) return lineas.map(conTarjeta).join('');
  return conNombre.map(function (g) {
    return '<div class="parte"><div class="parte-h"><b>' + esc(g) + '</b></div>' + porGrupo[g].map(conTarjeta).join('') + '</div>';
  }).join('') + (porGrupo[''] || []).map(conTarjeta).join('');
}

$('tj-columna').addEventListener('click', async function () {
  const ref = TB.abierta;
  if (!ref) return;
  if (esServicioAbierto()) return moverServicioUI(ref);          // servicios.js: también quien lo pidió
  if (!APP.yo.admin) return;
  if (TB.tipo === 'tarea') return moverTareaUI(ref);
  const t = buscarEnVista(ref);
  if (!t) return;
  // Paso 2-ter: un pedido también va a Stand by (y de ahí vuelve a Entrantes)
  const cols = esTrabajo(ref) ? null : columnasTb().concat([{ columna: colStandby(), seccion: 'Stand by' }]);
  const destino = await moverADialogo(esTrabajo(ref) ? 'Mover la tarjeta a…' : 'Mover el pedido a…', t.columna, '', cols,
                                      t.columna === colStandby() ? colEntrantes() : '');
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
  const trabajo = esTrabajo(ref);
  const destino = await moverADialogo(trabajo ? 'Reabrir la tarjeta' : 'Reabrir el pedido', p.columna, 'Vuelve al tablero, a la columna que elijas. Queda en la historia.', null, p.volverA, 'Reabrir');
  if (!destino) return;
  const pv = pedidoConCambios(ref, p);
  TB.reabiertos[ref] = { ref: ref, titulo: pv.titulo || p.titulo, sitio: p.sitio, urgencia: pv.urgencia || p.urgencia, columna: p.columna,
                         responsable: p.responsable, solicitante: p.solicitante, entrega: p.entrega, masivo: p.origen === 'masivo',
                         paraAprobar: 0, manual: p.manual };
  await moverA(ref, destino, '');
  if (buscarEnVista(ref)) avisoConBoton((trabajo ? 'Tarjeta reabierta' : 'Pedido reabierto') + ': volvió a "' + destino + '".', 'Ver en el tablero', function () { cerrarTarjeta(); ir('tablero'); });
  if (typeof pintarResultados === 'function' && !$('s-buscar').hidden) pintarResultados();
});

/* Gestión manual (Paso 5): la tarjeta funciona como una de Trello */
$('tj-manual').addEventListener('click', async function () {
  const ref = TB.abierta, t = buscarEnVista(ref);
  if (!t || !APP.yo.admin) return;
  const aManual = !t.manual;
  const si = await dialogo({
    titulo: aManual ? '¿Pasar a gestión manual?' : '¿Volver a automática?',
    texto: aManual ? '"' + t.titulo + '" va a funcionar como una tarjeta de Trello: sin "📤 Pedir cotización", no se junta en la Tanda verde, no pasa sola a Stand by y la IA no lo mira. Se mueve, se comenta y se tilda como siempre.'
                   : '"' + t.titulo + '" vuelve a tener "📤 Pedir cotización", la Tanda verde, Stand by y la IA.',
    botones: [{ texto: aManual ? 'Sí, pasar a manual' : 'Sí, volver a automática', clase: 'btn', valor: true }, { texto: 'Volver', valor: null }]
  });
  if (!si) return;
  bandeja.agregar('cambiarManual', [ref, aManual], (aManual ? 'pasar a gestión manual "' : 'volver a automática "') + t.titulo + '"');
  pintarTablero();
  pintarTarjeta();
});

$('tj-cancelar').addEventListener('click', async function () {
  const ref = TB.abierta, t = buscarEnVista(ref);
  if (!t) return;
  if (TB.detalle && TB.detalle.compra && esTrabajo(ref)) return anularCompraUI(ref, t);     // Fase 4, Paso 5 (presupuestos.js)
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-motivo">¿Por qué se cancela?</label><textarea id="dg-motivo" placeholder="Ej: ya no hace falta, se consiguió por otro lado…"></textarea>';
  const trabajo = esTrabajo(ref);
  const motivo = await dialogo({
    titulo: trabajo ? '¿Cancelar esta tarjeta?' : '¿Cancelar este pedido?',
    texto: '"' + t.titulo + '" (' + t.sitio + '). La tarjeta se va a mover a Finalizados. No se borra: se puede recuperar.' +
      (trabajo ? ' El motivo queda también en su pedido.' : ''),
    cuerpo: cuerpo,
    botones: [
      { texto: trabajo ? 'Sí, cancelar la tarjeta' : 'Sí, cancelar el pedido', clase: 'btn peligro-btn', id: 'dg-ok', valor: function () { return $('dg-motivo').value.trim(); } },
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
  avisoConBoton((trabajo ? 'Tarjeta cancelada' : 'Pedido cancelado') + ': pasó a Finalizados.', 'Deshacer', function () {
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
const K_VER_DETALLES = 'nueva_ver_detalles';
const LARGO_COMENTARIO = 2000;
function verDetalles() { return guardado.leer(K_VER_DETALLES) === '1'; }
function nombreDe(usuario) {
  const u = String(usuario || '').replace(/^formulario:\s*/, '');
  return !u || u === 'recordatorios' || u === 'limpieza' || u === 'sistema' || u === 'instalación' ? 'La app' : u;
}

function pintarActividad() {
  const ref = TB.abierta, d = TB.detalle, detalles = verDetalles();
  const bd = $('tj-detalles');
  bd.textContent = detalles ? 'Ocultar detalles' : 'Ver detalles';
  bd.setAttribute('aria-pressed', String(detalles));
  const items = [], ya = {};
  const viejas = (d && d.partesViejas) || {};     // las mini tarjetas de antes (Paso 4-bis): su nombre al lado
  ((d && d.comentarios) || []).forEach(function (c) {
    ya[c.id] = true;
    items.push({ tipo: 'c', fecha: c.fecha, autor: c.autor, texto: c.texto, de: c.parte ? viejas[c.parte] || '' : '' });
  });
  // Los que esperan en la bandeja (sin señal, o saliendo)
  bandeja.lista().forEach(function (m) {
    if (m.fn === 'comentar' && m.args[0] === ref && !ya[m.args[2]]) items.push({ tipo: 'c', fecha: m.creado, autor: APP.yo.nombre, texto: m.args[1], espera: true });
  });
  if (detalles && d && d.historia) d.historia.forEach(function (e) {
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
    '<div class="quien"><b>' + esc(x.autor) + '</b> ' + (x.de ? '<small>· ' + esc(x.de) + '</small> ' : '') +
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
  if (e.entidad === 'pedido' || e.entidad === 'tarjeta') {
    if (e.entidad === 'tarjeta' && e.accion === 'crear') return 'armó esta tarjeta';
    if (e.entidad === 'tarjeta' && e.campo === 'Columna') {
      if (n === colCancelado()) return 'canceló la tarjeta';
      if (a === colCancelado()) return 'la recuperó: volvió a ' + n;
      return 'la movió de ' + a + ' a ' + n;
    }
    if (e.campo === 'Columna' && n === 'Procesando') return 'pasó solo a Procesando: todos sus productos están en tarjetas';
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
      case 'Aprobación': return n === 'Esperando' ? 'lo mandó a aprobar' : n === 'Aprobada' ? 'aprobó la compra' : n === 'No aprobada' ? 'no aprobó la compra' : '';   // Paso 6
      case 'Automático': return String(n).toUpperCase() === 'NO' ? 'lo pasó a gestión manual' : 'lo volvió a automática';   // Paso 5
      case 'Recepción': return n === 'Recibido' ? 'confirmó que lo recibió' : n === 'No recibió' ? 'dijo que no lo recibió o que falta algo' :      // Fase 4, Paso 1-bis
                               n === 'Esperando' ? 'le preguntó a quien lo retiró si lo recibió' : n === 'Sin confirmar' ? 'le recordó que confirme si lo recibió' :
                               n === 'Sin aviso' ? 'no le pudo avisar a quien lo retiró' : '';
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
      case 'Tildado': return (n === 'SI' ? 'marcó como recibido: ' : 'desmarcó como recibido: ') + prod;
      case 'Familia': return a ? 'cambió el nombre de "' + a + '" a "' + n + '"' : 'le puso el nombre "' + n + '" a "' + (l ? l.texto : prod) + '"';
      case 'Canal': return n ? 'cambió el rubro de ' + prod + ' a ' + n : 'le sacó el rubro a ' + prod;
      case 'Especificación': return 'cambió la especificación de ' + prod + ' a "' + n + '"';
      case 'Cantidad': return 'cambió la cantidad de ' + prod + ' de ' + a + ' a ' + n;
      case 'Proveedores particulares': return n ? 'mandó ' + prod + ' solo a ' + n : 'le sacó los proveedores particulares (' + a + ') a ' + prod;
      case 'Tarjeta': {
        const w = ((d && d.tarjetas) || []).filter(function (x) { return x.id === n; })[0];
        return n ? 'pasó ' + prod + ' a la tarjeta ' + (w ? '"' + w.nombre + '"' : n) : 'sacó ' + prod + ' de su tarjeta';
      }
    }
    return 'cambió ' + String(e.campo).toLowerCase() + ' de ' + prod + (n ? ': "' + n + '"' : '');
  }
  if (e.entidad === 'tarea' || e.entidad === 'checklist' || e.entidad === 'recordatorio') return fraseDeTarea(e, d);   // tareas.js
  if (e.entidad === 'parte') {                // las mini tarjetas de antes (Paso 4-bis)
    const nom = ((d && d.partesViejas) || {})[e.id] || 'una parte';
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
  if (e.entidad === 'solicitud') {               // Fase 3: pedidos de cotización
    if (e.accion === 'crear') return 'pidió cotización (' + n + ')';
    if (e.accion === 'reintentar') return 'volvió a mandar el pedido de cotización a ' + n;
    return '';
  }
  if (e.entidad === 'cotizacion') return '';
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
  bandeja.agregar('comentar', [ref, texto, 'C' + nuevoId()], 'comentar en "' + (t.titulo || ref) + '": «' + corto + '»');
  cajaComentario.value = '';
  delete TB.borradores[ref];
  ajustarCaja();
  sugerirMenciones();
  pintarActividad();
}

// Sin señal, el comentario que espera dice "⏳ se manda solo"; con señal, "Enviando…"
function alCambiarLaSenal(hay) {
  if (!TB.abierta) return;
  pintarActividad(); pintarAdjuntos();
  if (hay && TB.viejo) traerTarjeta(TB.abierta);     // Fase 5: volvió la señal, se actualiza sola
}

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
      if (r.noVen && r.noVen.length) aviso(lista(r.noVen) + (r.noVen.length === 1 ? ' no ve' : ' no ven') + ' este pedido masivo: no le mandé el WhatsApp. Si querés, compartiselo desde ✏️ Editar pedido.', 'bad');
      else if (r.sinAviso && r.sinAviso.length) aviso('No le pudo llegar el WhatsApp a ' + lista(r.sinAviso) + '. El comentario quedó guardado igual.', 'bad');
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
const K_PRODUCTOS = 'nueva_productos';     // proveedores, rubros y nombres del padrón (datosProductos)
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
    ['titulo', 'urgencia', 'razon', 'descripcion', 'compartido'].forEach(function (k) { if (c[k] !== undefined) v[k] = c[k]; });
  });
  return v;
}

function vigente(l) { return !l.estado || l.estado === 'Para quitar'; }

/**
 * Paso 5: lo que propone la IA para un producto fuera del padrón (solo admins), con Aprobar (abre el ✏️
 * ya completado) y Descartar. Se va solo cuando el producto tiene nombre.
 */
const IA_DESCARTADAS = {};
function htmlIA(l, admin, activo) {
  const ia = l.ia;
  if (!admin || !ia || !activo || l.familia || l.nuevo || IA_DESCARTADAS[l.id]) return '';
  if (ia.tipo !== 'padron') return '';     // Feli, 2026-10-06: la IA ya no propone productos nuevos
  const txt = '🤖 Este producto es <b>' + esc(ia.nombre) + '</b> del padrón' + (ia.especificacion ? ' · ' + esc(ia.especificacion) : '');
  return '<div class="ia-prop"><div>' + txt + '</div><div class="cambio-b">' +
    '<button type="button" class="btn-chico si" data-ia="aprobar" data-id="' + esc(l.id) + '">Aprobar</button>' +
    '<button type="button" class="btn-chico" data-ia="descartar" data-id="' + esc(l.id) + '">Descartar</button></div></div>';
}

/** extra: html al final del producto (Fase 3: en qué tarjeta de trabajo está). */
function htmlProducto(l, admin, mio, extra) {
  const sub = [];
  // Lo que escribió el encargado, solo si el producto no estaba en el padrón (si lo eligió de la lista, no hace falta)
  if (!l.enPadron && l.familia && l.texto && l.texto.toLowerCase() !== l.familia.toLowerCase()) sub.push(esc('Escribió: "' + l.texto + '"'));
  const provs = l.proveedores || [];
  if (l.noPedido) sub.push('<span class="np">No pedido · lo cotizó ' + esc(l.noPedido) + '</span>');     // Feli, 2026-10-07
  if (provs.length) sub.push('<span class="prov">🎯 Va solo a ' + esc(provs.map(function (x) { return x.nombre; }).join(', ')) + '</span>');
  else if (l.canal) sub.push(esc('Rubro: ' + l.canal));
  else sub.push(esc('Sin rubro'));
  // Pasos 3 y 4: OTROS y Sin rubro no tienen proveedores sugeridos
  if (!provs.length && (!l.canal || l.canal === 'OTROS') && l.estado !== 'Quitado') sub.push('<span class="manual-av">✋ Este producto debe ser gestionado manualmente</span>');
  if (l.descripcion) sub.push(esc(l.descripcion));
  const fotos = (l.fotos || []).map(function (u) {
    const id = idDrive(u);
    return id ? '<a href="#" data-foto="' + esc(id) + '" aria-label="Ver foto">' +
                '<img src="' + esc(urlMiniatura(id, 200)) + '" alt="Foto" loading="lazy"></a>' : '';
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
    '<button type="button" class="tilde" data-id="' + esc(l.id) + '" aria-pressed="' + !!l.tildado + '" aria-label="Recibido" title="' +
      (l.tildado ? 'Recibido (tocá para desmarcar)' : 'Marcar como recibido') + '"' + (activo && !l.nuevo ? '' : ' disabled') + '>✓</button>' +
    '<div class="prod-c"><b>' + esc(l.cantidad) + ' × ' + esc(nombreProducto(l)) + '</b>' +
    (l.tildado && activo ? '<span class="comprado">Recibido</span>' : '') +     // Feli (2026-10-06): el tilde es "Recibido"
    (fuera && e !== 'Quitado' ? '<span class="fuera">Fuera del padrón</span>' : '') +
    (l.espera ? '<span class="espera">' + (APP.enLinea ? 'Guardando…' : '⏳') + '</span>' : '') +
    (nota ? '<div class="cambio">' + nota + '</div>' : '') +
    (e === 'Quitado' ? '' : sub.map(function (x) { return '<div class="sub">' + x + '</div>'; }).join('')) +
    (fotos && e !== 'Quitado' ? '<div class="fotos">' + fotos + '</div>' : '') +
    (botones ? '<div class="cambio-b">' + botones + '</div>' : '') + htmlIA(l, admin, activo) + (extra || '') + '</div>' +
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
  bandeja.agregar('tildarProducto', [ref, id, !l.tildado], (l.tildado ? 'desmarcar "' : 'marcar como recibido "') + nombreProducto(l) + '"');
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
    ['titulo', 'urgencia', 'razon', 'descripcion', 'compartido'].forEach(function (k) { if (c[k] !== undefined) d.pedido[k] = c[k]; });
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

/** pre (Paso 5, "Aprobar" de la IA): {familia, especificacion, canal} para dejar el ✏️ ya completado. */
async function editarProducto(ref, id, pre) {
  const l = lineaVista(ref, id);
  if (!l || !APP.yo.admin) return;
  const datos = await datosProductos();
  const familias = datos ? datos.familias : [], proveedores = datos ? datos.proveedores.slice() : [];
  const canales = datos ? datos.canales.slice() : [];
  if (l.canal && canales.indexOf(l.canal) === -1) canales.push(l.canal);
  if (pre && pre.canal && canales.indexOf(pre.canal) === -1) canales.push(pre.canal);
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
      $('ep-nombre').value = (pre && pre.familia) || inicial.familia;
      $('ep-espec').value = pre && pre.especificacion ? pre.especificacion : inicial.especificacion;
      $('ep-cant').value = inicial.cantidad;
      const sel = $('ep-rubro');
      sel.innerHTML = '<option value="">Sin rubro</option>' + canales.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
      sel.value = pre && pre.canal ? pre.canal : inicial.canal;
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
      revisar();                       // con lo que propuso la IA ya se puede guardar
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

// "🎯 Proveedores para varios" se mudó a la ventana de Pedir cotización (Feli, Fase 3): ver cotizar.js

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
    '<div class="campo"><label for="eq-razon">Razón del pedido</label><textarea id="eq-razon" maxlength="2000"></textarea></div>' +
    (p.origen === 'masivo' ? '<div class="campo"><label>Compartir con</label><p class="nota">Los encargados que elijas lo ven. Sin nadie: solo los admins.</p>' +
      '<div class="pr-rubros" id="eq-compartir"></div></div>' : '');
  const antesComp = (p.compartido || []).slice().sort().join('|');
  const elegidos = {};
  (p.compartido || []).forEach(function (n) { elegidos[n] = true; });
  const c = await dialogo({
    titulo: 'Editar pedido', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      const c = {}, ti = $('eq-titulo').value.trim(), ra = $('eq-razon').value.trim();
      if (ti !== p.titulo) c.titulo = ti;
      if (urgencia !== p.urgencia) c.urgencia = urgencia;
      if (ra !== (p.razon || '')) c.razon = ra;
      if (p.origen === 'masivo') {
        const comp = elegidosLista(elegidos).sort();
        if (comp.join('|') !== antesComp) c.compartido = comp;
      }
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
      // La razón no se puede vaciar si tenía (un masivo puede no tenerla)
      const revisar = function () { $('dg-ok').disabled = !$('eq-titulo').value.trim() || (!!p.razon && !$('eq-razon').value.trim()); };
      $('eq-titulo').addEventListener('input', revisar);
      $('eq-razon').addEventListener('input', revisar);
      pintarUrg();
      if ($('eq-compartir')) pintarChipsEncargados($('eq-compartir'), elegidos);
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
const K_ADJUNTOS = 'nueva_adjuntos';     // los que esperan subir: [{id, ref, nombre, tipo, creado, token, intentos}]
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

/** ref: el pedido (por defecto, el abierto); lo usa también el pedido masivo libre (admin.js). */
async function adjuntar(files, ref) {
  ref = ref || TB.abierta;
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
    l.push({ id: id, ref: ref, nombre: nombre, tipo: esPdf ? 'pdf' : 'foto', creado: new Date().toISOString(), token: APP.token, intentos: 0 });
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
          r = await llamar('subirAdjunto', [p.token || APP.token, p.ref, { id: p.id, nombre: p.nombre, tipo: p.tipo, base64: await blobABase64(g.blob) }],
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
  const lista = ((d && d.adjuntos) || []).filter(function (a) { return !quitando[a.id]; });
  const esperan = adjPendientes().filter(function (p) { return p.ref === ref; });
  $('tj-adj-t').textContent = 'Adjuntos' + (lista.length + esperan.length ? ' (' + (lista.length + esperan.length) + ')' : '');
  const puedeQuitar = function (a) { return APP.yo.admin || a.autor === APP.yo.nombre; };
  const tile = function (a, espera) {
    const foto = a.tipo === 'foto';
    const img = espera ? (foto && ADJ.urls[a.id] ? '<img src="' + esc(ADJ.urls[a.id]) + '" alt="">' : '<span class="pdf">' + (foto ? '🖼️' : '📄') + '</span>')
                       : (foto ? '<img src="' + esc(urlMiniatura(a.idDrive, 240)) + '" alt="" loading="lazy">' : '<span class="pdf">📄</span>');
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
      else verArchivo(a.idDrive);                         // el PDF, adentro de la app (Feli: nunca ir a Drive)
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

$('tj-desc-editar').addEventListener('click', function () {
  if (TB.tipo === 'tarea') return describirTareaUI(TB.abierta);
  describirPedidoUI(TB.abierta);
});

/** La descripción del pedido (la del masivo libre, Paso 6): va por editarPedido. */
async function describirPedidoUI(ref) {
  const d = TB.detalle;
  if (!ref || !d || !d.pedido || !APP.yo.admin) return;
  const p = pedidoConCambios(ref, d.pedido);
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-desc">Descripción</label><textarea id="dg-desc" maxlength="20000" style="min-height:40vh"></textarea>';
  const texto = await dialogo({
    titulo: 'Descripción del pedido', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', valor: function () { return $('dg-desc').value.trim(); } }, { texto: 'Volver', valor: null }],
    alAbrir: function () { $('dg-desc').value = p.descripcion || ''; $('dg-desc').focus(); }
  });
  if (texto === null || texto === undefined || texto === (p.descripcion || '')) return;
  bandeja.agregar('editarPedido', [ref, { descripcion: texto }], 'cambiar la descripción de "' + (p.titulo || ref) + '"');
  pintarTarjeta();
}

/** Muestra los bloques de la ventana que son de un pedido o de una tarea. */
function bloquesDeTarea(tarea) {
  ['tj-razon-b', 'tj-prod-b'].forEach(function (id) { $(id).hidden = tarea; });
  ['tj-check-b', 'tj-rec-b'].forEach(function (id) { $(id).hidden = !tarea; });
  $('tj-borrar-tarea').hidden = !tarea;
  if (!tarea) $('tj-editar').textContent = '✏️ Editar pedido';
  if (tarea) ['tj-cancelar', 'tj-manual', 'tj-reabrir', 'tj-enlaces', 'tj-cot-b', 'tj-aprob-b'].forEach(function (id) { $(id).hidden = true; });
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
  img.src = urlMiniatura(id, 1600);
  $('visor').hidden = false;
}
function cerrarFoto() {
  $('visor').hidden = true;
  $('visor-img').removeAttribute('src');
  $('visor-doc').hidden = true;
  $('visor-doc').innerHTML = '';                       // un video que suena se corta
  VISOR.abierto = '';
}

/* ---------- Ver un archivo adentro de la app (Feli, 2026-10-05: nunca ir a Drive) ----------
   El servidor lo manda (verArchivo: solo si se puede ver) y acá se muestra: el PDF página por página con
   pdf.js (cdnjs, se baja la primera vez), una foto o un video. Lo traído queda en memoria mientras la app está abierta. */
const VISOR = { cache: {}, abierto: '' };
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

function cargarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return new Promise(function (listo, mal) {
    const sc = document.createElement('script');
    sc.src = PDFJS + 'pdf.min.js';
    sc.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; listo(); };
    sc.onerror = function () { mal(new Error('Hace falta señal para abrir el PDF.')); };
    document.head.appendChild(sc);
  });
}

async function verArchivo(idDrive) {
  if (!idDrive) return;
  VISOR.abierto = idDrive;
  $('visor-img').hidden = true;
  $('visor-doc').hidden = true;
  $('visor-doc').innerHTML = '';
  $('visor-carga').hidden = false;
  $('visor-carga').textContent = 'Abriendo…';
  $('visor').hidden = false;
  let a = VISOR.cache[idDrive];
  if (!a) {
    const r = await apiLenta('verArchivo', idDrive);
    if (VISOR.abierto !== idDrive) return;
    if (!r.ok) { $('visor-carga').textContent = r.sinConexion ? '📶 Hace falta señal para abrirlo.' : r.error; return; }
    const bin = atob(r.datos), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    a = { nombre: r.nombre, mime: r.mime || '', bytes: bytes };
    VISOR.cache[idDrive] = a;
  }
  try {
    const mime = a.mime.toLowerCase();
    if (/^image\//.test(mime)) {
      const img = $('visor-img');
      img.onload = function () { $('visor-carga').hidden = true; img.hidden = false; };
      img.src = URL.createObjectURL(new Blob([a.bytes], { type: mime }));
    } else if (/^video\//.test(mime)) {
      $('visor-doc').innerHTML = '<video controls playsinline autoplay src="' + URL.createObjectURL(new Blob([a.bytes], { type: mime })) + '"></video>';
      $('visor-carga').hidden = true;
      $('visor-doc').hidden = false;
    } else if (/pdf/.test(mime) || /\.pdf$/i.test(a.nombre)) {
      $('visor-carga').textContent = 'Abriendo el PDF…';
      await cargarPdfJs();
      const pdf = await window.pdfjsLib.getDocument({ data: a.bytes.slice() }).promise;
      if (VISOR.abierto !== idDrive) return;
      const doc = $('visor-doc');
      doc.innerHTML = '<p class="visor-titulo">' + esc(a.nombre || 'PDF') + ' · ' + pdf.numPages + ' página' + (pdf.numPages === 1 ? '' : 's') + '</p>';
      doc.hidden = false;
      $('visor-carga').hidden = true;
      const ancho = Math.min(doc.clientWidth - 16, 1000), escala = window.devicePixelRatio || 1;
      for (let n = 1; n <= pdf.numPages; n++) {
        if (VISOR.abierto !== idDrive) return;
        const pag = await pdf.getPage(n);
        const v0 = pag.getViewport({ scale: 1 }), v = pag.getViewport({ scale: ancho / v0.width * escala });
        const c = document.createElement('canvas');
        c.width = v.width; c.height = v.height;
        c.style.width = (v.width / escala) + 'px';
        doc.appendChild(c);
        await pag.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      }
    } else {
      $('visor-carga').textContent = 'Este archivo no se puede ver en la app.';
    }
  } catch (e) {
    $('visor-carga').hidden = false;
    $('visor-carga').textContent = e && e.message ? e.message : 'No se pudo abrir.';
  }
}
$('visor-cerrar').addEventListener('click', cerrarFoto);
$('visor').addEventListener('click', function (e) { if (e.target === this || (e.target.id === 'visor-img' && $('visor-doc').hidden)) cerrarFoto(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('visor').hidden) { e.stopImmediatePropagation(); cerrarFoto(); } }, true);
