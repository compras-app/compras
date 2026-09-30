'use strict';
/* ============================================================
   TABLERO DE TAREAS DE LOS ADMINS (Fase 2, Paso 4-ter)
   ------------------------------------------------------------
   Otro tablero, solo para admins, para lo que no son compras.
   Columnas: Entrantes → En proceso → En espera → Finalizados (los
   finalizados se ven 7 días y después se borran solos).
   - "+ Agregar tarea" abajo de la primera columna.
   - Se arrastra (lo mismo que el tablero de pedidos) o "Mover a…".
   - La tarjeta abierta usa la ventana de los pedidos (tablero.js):
     comentarios con @, adjuntos e historia son los mismos. Acá se arma
     lo propio de una tarea: datos, descripción, checklists y
     recordatorios por WhatsApp (se pueden repetir).
   Todo va por la bandeja: se ve al instante y sin señal se manda después.
   ============================================================ */

const K_TAREAS = 'compras_tareas';        // lo último que mandó getTareas (para abrir sin señal)
const OPS_TAREA_TABLERO = { crearTarea: 1, moverTarea: 1, editarTarea: 1, borrarTarea: 1, restaurarTarea: 1, agregarRecordatorio: 1, quitarRecordatorio: 1 };
const OPS_TAREA = Object.assign({ agregarItem: 1, tildarItem: 1, editarItem: 1, quitarItem: 1, renombrarLista: 1 }, OPS_TAREA_TABLERO);
const REPETIR_TEXTO = { '': 'No se repite', diario: 'Todos los días', semanal: 'Todas las semanas', mensual: 'Todos los meses' };
const TK = { datos: guardado.leerJSON(K_TAREAS, null), filtros: { mias: false }, cargando: false, nueva: false };

pantalla('tareas', { titulo: 'Tareas', alMostrar: mostrarTareas });

function colsTareas() { return (TK.datos && TK.datos.columnas) || ['Entrantes', 'En proceso', 'En espera', 'Finalizados']; }
function colsTareasMover() { return colsTareas().map(function (c) { return { columna: c, seccion: 'Tareas' }; }); }
function tareasALaVista() { return !$('app').hidden && !$('s-tareas').hidden && !document.hidden; }
function dosDig(n) { return ('0' + n).slice(-2); }
/** "2026-10-03T14:30" en la hora del teléfono. */
function paraInput(d) { return d.getFullYear() + '-' + dosDig(d.getMonth() + 1) + '-' + dosDig(d.getDate()) + 'T' + dosDig(d.getHours()) + ':' + dosDig(d.getMinutes()); }

/** Cuándo, corto: "hoy 14:30", "mañana 9:00", "vie 3/10 14:30". */
function cuandoCorto(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hora = d.getHours() + ':' + dosDig(d.getMinutes());
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const dif = Math.round((dia - hoy) / 86400000);
  if (dif === 0) return 'hoy ' + hora;
  if (dif === 1) return 'mañana ' + hora;
  return ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hora;
}

/* ---------- Lo que se ve: lo del servidor + lo que espera en la bandeja ---------- */
function aplicarOpTarea(lista, fn, args) {
  if (fn === 'crearTarea') {
    const d = args[0] || {};
    if (lista.some(function (x) { return x.ref === d.id; })) return;
    const urg = (APP.config && APP.config.urgencias) || [];
    insertarEn(lista, { ref: d.id, id: d.id, titulo: d.titulo, urgencia: urg[urg.length - 1] || '', responsable: '', columna: colsTareas()[0], recordatorio: '' }, '');
    return;
  }
  const i = lista.findIndex(function (x) { return x.ref === args[0]; });
  if (i < 0) return;
  if (fn === 'moverTarea') {
    const op = args[1] || {};
    const t = Object.assign({}, lista.splice(i, 1)[0], { columna: op.columna });
    insertarEn(lista, t, op.despuesDe);
  } else if (fn === 'editarTarea') {
    const c = args[1] || {}, t = Object.assign({}, lista[i]);
    ['titulo', 'urgencia', 'responsable'].forEach(function (k) { if (c[k] !== undefined) t[k] = c[k]; });
    lista[i] = t;
  } else if (fn === 'borrarTarea') {
    lista.splice(i, 1);
  } else if (fn === 'agregarRecordatorio') {
    const cuando = new Date((args[1] || {}).cuando);
    if (!isNaN(cuando) && (!lista[i].recordatorio || cuando < new Date(lista[i].recordatorio))) lista[i] = Object.assign({}, lista[i], { recordatorio: cuando.toISOString() });
  }
}
function vistaTareas() {
  const l = TK.datos ? TK.datos.tarjetas.slice() : [];
  bandeja.lista().forEach(function (m) { if (OPS_TAREA_TABLERO[m.fn]) aplicarOpTarea(l, m.fn, m.args); });
  return l;
}
function buscarTarea(ref) { return vistaTareas().filter(function (x) { return x.ref === ref; })[0] || null; }

// Cuando un cambio de una tarea sale de la bandeja: se trae de nuevo lo que haga falta
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (!OPS_TAREA[m.fn]) return;
    const ref = m.fn === 'crearTarea' ? (m.args[0] || {}).id : m.args[0];
    if (OPS_TAREA_TABLERO[m.fn] || !r.ok) cargarTareas();
    if (TB.abierta && TB.abierta === ref) traerTarjeta(ref);
  };
})();

/* ---------- Tablero ---------- */
function mostrarTareas() {
  pintarFiltrosTareas();
  pintarTareas();
  cargarTareas();
  const h = decodeURIComponent(location.hash.slice(1));
  if (/^K/.test(h) && !TB.abierta) abrirTarjeta(h, true);        // link de un recordatorio o una mención
}

function pintarFiltrosTareas() {
  $('tk-mias').setAttribute('aria-pressed', String(TK.filtros.mias));
  $('tk-todas').setAttribute('aria-pressed', String(!TK.filtros.mias));
}
$('tk-mias').addEventListener('click', function () { TK.filtros.mias = true; pintarFiltrosTareas(); pintarTareas(); });
$('tk-todas').addEventListener('click', function () { TK.filtros.mias = false; pintarFiltrosTareas(); pintarTareas(); });

const CTX_TAREAS = { tb: function () { return $('tareas-tablero'); }, mover: function (r, d, a) { moverTareaA(r, d, a); }, repintar: function () { pintarTareas(); } };

function htmlTarea(t) {
  return '<div class="tarjeta' + (esUrgente(t.urgencia) ? ' urgente' : '') + '" data-ref="' + esc(t.ref) + '" role="button" tabindex="0">' +
    '<div class="t">' + esc(t.titulo) + '</div>' +
    '<div class="pie"><span aria-label="' + esc(t.urgencia) + '">' + esc(emojiUrgencia(t.urgencia)) + '</span>' +
    '<span class="sitio">' + (t.recordatorio ? '⏰ ' + esc(cuandoCorto(t.recordatorio)) : '') + '</span>' +
    (t.responsable ? '<span class="resp" title="Responsable: ' + esc(t.responsable) + '">' + esc(inicial(t.responsable)) + '</span>' : '') +
    '</div></div>';
}

function pintarTareas() {
  const cont = $('tareas-tablero');
  if (!cont || !APP.yo || !APP.yo.admin) return;
  const cols = colsTareas();
  if (!TK.datos && TK.cargando) { cont.innerHTML = '<div class="vacio" style="margin:16px">Cargando las tareas…</div>'; return; }
  const scroll = cont.scrollLeft, porCol = {};
  cols.forEach(function (c) { porCol[c] = []; });
  vistaTareas().forEach(function (t) {
    if (!porCol[t.columna]) return;
    if (TK.filtros.mias && t.responsable !== APP.yo.nombre) return;
    porCol[t.columna].push(t);
  });
  cont.innerHTML = cols.map(function (c, k) {
    const ts = porCol[c];
    return '<div class="col" data-columna="' + esc(c) + '" data-seccion="Tareas">' +
      '<div class="col-h"><span class="sec">' + (k === 0 ? 'Tareas' : '') + '</span><b>' + esc(c) + '</b><span class="n">' + ts.length + '</span>' +
      (k === cols.length - 1 ? '<small class="nota" style="display:block;font-size:12px">Se borran a los 7 días</small>' : '') + '</div>' +
      '<div class="lista" data-columna="' + esc(c) + '">' +
      (ts.length ? ts.map(htmlTarea).join('') : '<div class="vacia">Sin tareas</div>') +
      (k === 0 ? (TK.nueva
        ? '<div class="nueva-tarea"><textarea id="tk-nueva-t" rows="2" maxlength="200" placeholder="Título de la tarea"></textarea>' +
          '<div class="comentar-b"><button type="button" class="btn" id="tk-nueva-ok">Agregar</button><button type="button" class="icono" id="tk-nueva-x" aria-label="Cancelar">×</button></div></div>'
        : '<button type="button" class="agregar-tarea" id="tk-nueva-b">+ Agregar tarea</button>') : '') +
      '</div></div>';
  }).join('');
  cont.scrollLeft = scroll;
  cont.querySelectorAll('.tarjeta').forEach(function (el) {
    const ref = el.dataset.ref;
    el.addEventListener('click', function (e) {
      if (TB.recienArrastrada) { e.preventDefault(); return; }
      abrirTarjeta(ref);
    });
    el.addEventListener('touchstart', function (e) { tocar(e, el, ref, CTX_TAREAS); }, { passive: true });
    el.addEventListener('mousedown', function (e) { conMouse(e, el, ref, CTX_TAREAS); });
  });
  const b = $('tk-nueva-b');
  if (b) b.addEventListener('click', function () { TK.nueva = true; pintarTareas(); $('tk-nueva-t').focus(); });
  if (TK.nueva) {
    const t = $('tk-nueva-t');
    const listo = function () {
      const titulo = t.value.trim();
      if (!titulo) return;
      bandeja.agregar('crearTarea', [{ id: 'K' + nuevoId(), titulo: titulo }], 'crear la tarea "' + titulo + '"');
      t.value = '';
      pintarTareas();
      $('tk-nueva-t').focus();
    };
    $('tk-nueva-ok').addEventListener('click', listo);
    t.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); listo(); } if (e.key === 'Escape') { TK.nueva = false; pintarTareas(); } });
    $('tk-nueva-x').addEventListener('click', function () { TK.nueva = false; pintarTareas(); });
  }
  pintarHaceTareas();
}

function pintarHaceTareas() {
  const el = $('tk-hace'), b = $('tk-refrescar');
  if (b) b.classList.toggle('girando', !!TK.cargando);
  if (el) el.textContent = TK.cargando ? 'Actualizando…' : (TK.datos && TK.datos.actualizado ? hace(TK.datos.actualizado) : '');
}

async function cargarTareas() {
  if (!APP.token || !APP.yo || !APP.yo.admin) return;
  if (TK.cargando) { TK.otraVez = true; return; }
  TK.cargando = true;
  pintarHaceTareas();
  const r = await api('getTareas');
  TK.cargando = false;
  if (r.ok) {
    TK.datos = { columnas: r.columnas, tarjetas: r.tarjetas.map(function (t) { return Object.assign({ ref: t.id }, t); }), version: r.version, actualizado: r.actualizado };
    guardado.guardarJSON(K_TAREAS, TK.datos);
    if (!TB.arrastre && !TK.nueva) pintarTareas();
    if (TB.abierta && TB.tipo === 'tarea') { pintarTarjeta(); traerTarjeta(TB.abierta); }
  }
  pintarHaceTareas();
  if (TK.otraVez) { TK.otraVez = false; cargarTareas(); }
}
$('tk-refrescar').addEventListener('click', function () { cargarTareas(); });
// Lo que cambian los otros admins se ve en segundos (la misma consulta liviana que el tablero)
setInterval(async function () {
  if (!tareasALaVista() || TB.arrastre || TK.cargando || !TK.datos || !APP.token) return;
  let r;
  try { r = await llamar('versionTablero', [APP.token]); } catch (e) { return; }
  if (r.ok && r.version !== TK.datos.version) cargarTareas();
}, 8000);
setInterval(function () { if (tareasALaVista() && !TB.arrastre) cargarTareas(); }, 120000);
document.addEventListener('visibilitychange', function () { if (tareasALaVista()) cargarTareas(); });

function moverTareaA(ref, destino, despuesDe) {
  const t = buscarTarea(ref);
  if (!t) return pintarTareas();
  bandeja.agregar('moverTarea', [ref, { columna: destino, despuesDe: despuesDe, desde: t.columna }],
                  (destino === t.columna ? 'reordenar "' : 'mover "') + t.titulo + '" a ' + destino);
  pintarTareas();
  if (TB.abierta === ref) pintarTarjeta();
}

async function moverTareaUI(ref) {
  const t = buscarTarea(ref) || (TB.detalle && TB.detalle.tarea);
  if (!t) return;
  const destino = await moverADialogo('Mover la tarea a…', t.columna, '', colsTareasMover());
  if (!destino || destino === t.columna) return;
  moverTareaA(ref, destino, '');
}

/* ---------- La tarjeta de una tarea (en la ventana de tablero.js) ---------- */

/** La tarea con lo que espera en la bandeja encima. */
function tareaVista(ref) {
  const d = TB.detalle;
  if (!d || !d.tarea) return null;
  const t = Object.assign({}, d.tarea);
  const v = buscarTarea(ref);
  if (v) ['titulo', 'urgencia', 'responsable', 'columna'].forEach(function (k) { t[k] = v[k]; });
  bandeja.lista().forEach(function (m) {
    if (m.fn === 'editarTarea' && m.args[0] === ref && (m.args[1] || {}).descripcion !== undefined) t.descripcion = m.args[1].descripcion;
  });
  let items = (d.items || []).map(function (i) { return Object.assign({}, i); });
  let recs = (d.recordatorios || []).map(function (x) { return Object.assign({}, x); });
  bandeja.lista().forEach(function (m) {
    if (!OPS_TAREA[m.fn] || m.args[0] !== ref) return;
    const a = m.args;
    if (m.fn === 'agregarItem' && !items.some(function (i) { return i.id === a[1].id; })) items.push({ id: a[1].id, lista: a[1].lista, texto: a[1].texto, hecho: false, espera: true });
    else if (m.fn === 'tildarItem') items.forEach(function (i) { if (i.id === a[1]) { i.hecho = !!a[2]; i.espera = true; } });
    else if (m.fn === 'editarItem') items.forEach(function (i) { if (i.id === a[1]) { i.texto = a[2]; i.espera = true; } });
    else if (m.fn === 'quitarItem') items = items.filter(function (i) { return i.id !== a[1]; });
    else if (m.fn === 'renombrarLista') items = a[3] ? items.map(function (i) { return i.lista === a[2] ? Object.assign(i, { lista: a[3] }) : i; }) : items.filter(function (i) { return i.lista !== a[2]; });
    else if (m.fn === 'agregarRecordatorio' && !recs.some(function (x) { return x.id === a[1].id; })) recs.push({ id: a[1].id, cuando: new Date(a[1].cuando).toISOString(), repetir: a[1].repetir, texto: a[1].texto, estado: '', espera: true });
    else if (m.fn === 'quitarRecordatorio') recs = recs.filter(function (x) { return x.id !== a[1]; });
  });
  t.items = items;
  t.recordatorios = recs;
  return t;
}

function pintarTareaAbierta() {
  const ref = TB.abierta, t = tareaVista(ref), v = buscarTarea(ref);
  const chip = $('tj-columna');
  const col = t ? t.columna : (v ? v.columna : '…');
  chip.textContent = col + ' ⌄';
  chip.disabled = false;
  $('tj-titulo').textContent = t ? t.titulo : (v ? v.titulo : 'Cargando…');
  $('tj-etiquetas').innerHTML = t && t.borrada ? '<span class="etiqueta">Borrada</span>' : '';
  const datos = [];
  const dato = function (etiqueta, html) { datos.push('<div class="dato"><small>' + esc(etiqueta) + '</small><div class="v">' + html + '</div></div>'); };
  if (t) {
    dato('Urgencia', esc(t.urgencia));
    const resp = t.responsable ? '<span class="resp">' + esc(inicial(t.responsable)) + '</span> ' + esc(t.responsable) : 'Sin responsable';
    dato('Responsable', '<button type="button" class="boton-dato" id="tk-resp">' + resp + ' ⌄</button>');
    dato('La creó', esc(t.creo));
    dato('Creada', esc(fechaLinda(t.fecha)));
  }
  $('tj-datos').innerHTML = datos.join('');
  $('tj-editar').hidden = !t;
  $('tj-editar').textContent = '✏️ Editar tarea';
  $('tj-desc-b').hidden = !t;
  if (t) { $('tj-desc').textContent = t.descripcion || 'Sin descripción.'; $('tj-desc-editar').hidden = false; }
  pintarChecklists(t);
  pintarRecordatorios(t);
  pintarAdjuntos();
  pintarActividad();
  const b = $('tk-resp');
  if (b) b.addEventListener('click', function () { cambiarResponsableTarea(ref); });
}

/* Checklists: uno o varios, con nombre, como en Trello */
function pintarChecklists(t) {
  const cont = $('tj-checklists');
  if (!t) { cont.innerHTML = '<p class="nota">' + esc(TB.sinDetalle || 'Cargando…') + '</p>'; return; }
  const listas = [];
  t.items.forEach(function (i) { if (listas.indexOf(i.lista) === -1) listas.push(i.lista); });
  cont.innerHTML = listas.length ? listas.map(function (nombre) {
    const its = t.items.filter(function (i) { return i.lista === nombre; });
    const hechos = its.filter(function (i) { return i.hecho; }).length;
    return '<div class="checklist">' +
      '<div class="act-h"><h3>☑ ' + esc(nombre) + ' <small class="nota">' + hechos + '/' + its.length + '</small></h3>' +
        '<button type="button" class="btn-chico" data-lista-editar="' + esc(nombre) + '" aria-label="Cambiar el checklist">⋯</button></div>' +
      '<div class="progreso"><span style="width:' + Math.round(its.length ? 100 * hechos / its.length : 0) + '%"></span></div>' +
      its.map(function (i) {
        return '<div class="item' + (i.hecho ? ' hecho' : '') + '">' +
          '<button type="button" class="tilde" data-item="' + esc(i.id) + '" aria-pressed="' + i.hecho + '" aria-label="Hecho">✓</button>' +
          '<span class="txt" data-item-editar="' + esc(i.id) + '">' + esc(i.texto) + (i.espera ? ' <small class="espera">' + (APP.enLinea ? 'Guardando…' : '⏳') + '</small>' : '') + '</span>' +
          '<button type="button" class="icono x-item" data-item-quitar="' + esc(i.id) + '" aria-label="Quitar">×</button></div>';
      }).join('') +
      '<div class="nuevo-item"><input type="text" maxlength="300" placeholder="Agregar un ítem" data-lista="' + esc(nombre) + '">' +
        '<button type="button" class="btn-chico" data-item-agregar="' + esc(nombre) + '">Agregar</button></div></div>';
  }).join('') : '<p class="nota" style="margin:0">Sin checklists. Con "+ Checklist" armás una lista de cosas para tildar.</p>';

  const ref = TB.abierta;
  cont.querySelectorAll('[data-item]').forEach(function (b) {
    b.addEventListener('click', function () {
      const i = t.items.filter(function (x) { return x.id === b.dataset.item; })[0];
      bandeja.agregar('tildarItem', [ref, i.id, !i.hecho], (i.hecho ? 'destildar "' : 'tildar "') + i.texto + '"');
      pintarTarjeta();
    });
  });
  cont.querySelectorAll('[data-item-quitar]').forEach(function (b) {
    b.addEventListener('click', function () {
      const i = t.items.filter(function (x) { return x.id === b.dataset.itemQuitar; })[0];
      bandeja.agregar('quitarItem', [ref, i.id], 'quitar "' + i.texto + '" del checklist');
      pintarTarjeta();
    });
  });
  cont.querySelectorAll('[data-item-editar]').forEach(function (s) {
    s.addEventListener('click', async function () {
      const i = t.items.filter(function (x) { return x.id === s.dataset.itemEditar; })[0];
      const texto = await pedirTexto('Cambiar el ítem', i.texto, 300);
      if (!texto || texto === i.texto) return;
      bandeja.agregar('editarItem', [ref, i.id, texto], 'cambiar "' + i.texto + '"');
      pintarTarjeta();
    });
  });
  const agregar = function (lista, input) {
    const texto = input.value.trim();
    if (!texto) return;
    bandeja.agregar('agregarItem', [ref, { id: 'I' + nuevoId(), lista: lista, texto: texto }], 'agregar "' + texto + '" al checklist');
    pintarTarjeta();
    const otra = $('tj-checklists').querySelector('input[data-lista="' + CSS.escape(lista) + '"]');
    if (otra) otra.focus();
  };
  cont.querySelectorAll('[data-item-agregar]').forEach(function (b) {
    b.addEventListener('click', function () { agregar(b.dataset.itemAgregar, b.previousElementSibling); });
  });
  cont.querySelectorAll('input[data-lista]').forEach(function (inp) {
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); agregar(inp.dataset.lista, inp); } });
  });
  cont.querySelectorAll('[data-lista-editar]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const vieja = b.dataset.listaEditar;
      const cuerpo = document.createElement('div');
      cuerpo.className = 'cuerpo';
      cuerpo.innerHTML = '<label for="dg-lista">Nombre del checklist</label><input type="text" id="dg-lista" maxlength="80">';
      const r = await dialogo({ titulo: 'Checklist "' + vieja + '"', cuerpo: cuerpo,
        botones: [{ texto: 'Guardar', clase: 'btn', valor: function () { return { nombre: $('dg-lista').value.trim() }; } },
                  { texto: 'Borrar el checklist entero', clase: 'btn2', valor: { borrar: true } },
                  { texto: 'Volver', valor: null }],
        alAbrir: function () { $('dg-lista').value = vieja; } });
      if (!r) return;
      if (r.borrar) bandeja.agregar('renombrarLista', [ref, vieja, ''], 'borrar el checklist "' + vieja + '"');
      else if (r.nombre && r.nombre !== vieja) bandeja.agregar('renombrarLista', [ref, vieja, r.nombre], 'cambiar el nombre del checklist "' + vieja + '"');
      pintarTarjeta();
    });
  });
}

$('tk-nuevo-checklist').addEventListener('click', async function () {
  const ref = TB.abierta;
  if (!ref) return;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-lista">Nombre del checklist</label><input type="text" id="dg-lista" maxlength="80" placeholder="Ej: Materiales">' +
    '<label for="dg-item">Primer ítem</label><input type="text" id="dg-item" maxlength="300" placeholder="Ej: Bisagras">';
  const r = await dialogo({ titulo: 'Nuevo checklist', cuerpo: cuerpo,
    botones: [{ texto: 'Crear', clase: 'btn', id: 'dg-ok', valor: function () { return { lista: $('dg-lista').value.trim() || 'Checklist', texto: $('dg-item').value.trim() }; } },
              { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const revisar = function () { $('dg-ok').disabled = !$('dg-item').value.trim(); };
      $('dg-item').addEventListener('input', revisar);
      revisar();
      $('dg-lista').focus();
    } });
  if (!r) return;
  bandeja.agregar('agregarItem', [ref, { id: 'I' + nuevoId(), lista: r.lista, texto: r.texto }], 'crear el checklist "' + r.lista + '"');
  pintarTarjeta();
});

/* Recordatorios por WhatsApp (al responsable; si no hay, a quien creó la tarea) */
function pintarRecordatorios(t) {
  const cont = $('tj-recordatorios');
  if (!t) { cont.innerHTML = ''; return; }
  const pend = t.recordatorios.filter(function (x) { return !x.estado; }).sort(function (a, b) { return new Date(a.cuando) - new Date(b.cuando); });
  const otros = t.recordatorios.filter(function (x) { return x.estado; }).slice(-3);
  const a = t.responsable || t.creo;
  cont.innerHTML = (pend.length || otros.length ? pend.concat(otros).map(function (x) {
    const hecho = x.estado === 'Enviado', sin = x.estado === 'Sin enviar';
    return '<div class="rec' + (x.estado ? ' pasado' : '') + '">' +
      '<span class="rec-c"><b>⏰ ' + esc(cuandoCorto(x.cuando)) + '</b>' +
      (x.repetir ? ' · 🔁 ' + esc(REPETIR_TEXTO[x.repetir] || x.repetir) : '') +
      (x.texto ? '<br>' + esc(x.texto) : '') +
      (hecho ? '<br><small>✓ Se mandó</small>' : sin ? '<br><small>No se pudo mandar (¿tiene teléfono?)</small>' : '') +
      (x.espera ? ' <small class="espera">' + (APP.enLinea ? 'Guardando…' : '⏳') + '</small>' : '') + '</span>' +
      (x.estado ? '' : '<button type="button" class="icono x-item" data-rec-quitar="' + esc(x.id) + '" aria-label="Quitar el recordatorio">×</button>') + '</div>';
  }).join('') : '<p class="nota" style="margin:0">Sin recordatorios.</p>') +
    '<p class="nota" style="margin:6px 0 0">Le llegan por WhatsApp a ' + esc(a || 'el responsable') + (t.responsable ? ' (responsable)' : ' (la creó; no tiene responsable)') + '.</p>';
  cont.querySelectorAll('[data-rec-quitar]').forEach(function (b) {
    b.addEventListener('click', function () {
      bandeja.agregar('quitarRecordatorio', [TB.abierta, b.dataset.recQuitar], 'quitar un recordatorio');
      pintarTarjeta();
    });
  });
}

$('tk-nuevo-rec').addEventListener('click', async function () {
  const ref = TB.abierta;
  if (!ref) return;
  const en1h = new Date(Date.now() + 3600000); en1h.setMinutes(0, 0, 0);
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<div class="fila2" style="grid-template-columns:1fr 1fr"><div class="campo"><label for="dg-dia">Día</label><input type="date" id="dg-dia"></div>' +
    '<div class="campo"><label for="dg-hora">Hora</label><input type="time" id="dg-hora"></div></div>' +
    '<label for="dg-rep">¿Se repite?</label><select id="dg-rep">' + Object.keys(REPETIR_TEXTO).map(function (k) { return '<option value="' + k + '">' + REPETIR_TEXTO[k] + '</option>'; }).join('') + '</select>' +
    '<label for="dg-rtexto">Texto (opcional)</label><input type="text" id="dg-rtexto" maxlength="500" placeholder="Ej: llamar al herrero">' +
    '<p class="nota">Llega por WhatsApp dentro de los 10 minutos de la hora elegida.</p>';
  const r = await dialogo({ titulo: 'Recordatorio', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () { return { cuando: $('dg-dia').value + 'T' + $('dg-hora').value, repetir: $('dg-rep').value, texto: $('dg-rtexto').value.trim() }; } },
              { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const v = paraInput(en1h);
      $('dg-dia').value = v.slice(0, 10);
      $('dg-hora').value = v.slice(11);
      const revisar = function () { $('dg-ok').disabled = !$('dg-dia').value || !$('dg-hora').value; };
      $('dg-dia').addEventListener('input', revisar);
      $('dg-hora').addEventListener('input', revisar);
      revisar();
    } });
  if (!r) return;
  if (new Date(r.cuando) < new Date(Date.now() - 60000) && !r.repetir) return aviso('Esa hora ya pasó: elegí una más adelante.', 'bad');
  bandeja.agregar('agregarRecordatorio', [ref, { id: 'R' + nuevoId(), cuando: r.cuando, repetir: r.repetir, texto: r.texto }], 'agregar un recordatorio para ' + cuandoCorto(r.cuando));
  pintarTarjeta();
  pintarTareas();
});

/* Editar la tarea, la descripción, el responsable, y borrarla */
async function editarTareaUI(ref) {
  const t = tareaVista(ref);
  if (!t) return;
  let urgencia = t.urgencia;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<div class="campo"><label for="eq-titulo">Título</label><input type="text" id="eq-titulo" maxlength="200" autocomplete="off"></div>' +
    '<div class="campo"><label>Urgencia</label><div class="urgencias-el" id="eq-urg"></div></div>';
  const c = await dialogo({ titulo: 'Editar tarea', cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', id: 'dg-ok', valor: function () {
      const c = {}, ti = $('eq-titulo').value.trim();
      if (ti !== t.titulo) c.titulo = ti;
      if (urgencia !== t.urgencia) c.urgencia = urgencia;
      return c;
    } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      $('eq-titulo').value = t.titulo;
      const urg = $('eq-urg');
      const pintarUrg = function () {
        urg.innerHTML = (APP.config.urgencias || []).map(function (u) { return '<button type="button" data-u="' + esc(u) + '" aria-pressed="' + (u === urgencia) + '">' + esc(u) + '</button>'; }).join('');
        urg.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { urgencia = b.dataset.u; pintarUrg(); }); });
      };
      $('eq-titulo').addEventListener('input', function () { $('dg-ok').disabled = !this.value.trim(); });
      pintarUrg();
    } });
  if (!c || !Object.keys(c).length) return;
  bandeja.agregar('editarTarea', [ref, c], 'cambiar la tarea "' + t.titulo + '"');
  pintarTareas();
  pintarTarjeta();
}

async function describirTareaUI(ref) {
  const t = tareaVista(ref);
  if (!t) return;
  const texto = await pedirTexto('Descripción', t.descripcion, 5000, true);
  if (texto === null || texto === t.descripcion) return;
  bandeja.agregar('editarTarea', [ref, { descripcion: texto }], 'cambiar la descripción de "' + t.titulo + '"');
  pintarTarjeta();
}

async function cambiarResponsableTarea(ref) {
  const t = tareaVista(ref);
  if (!t) return;
  const ops = [{ texto: '🙋 Me la quedo (' + APP.yo.nombre + ')', valor: APP.yo.nombre }];
  (APP.config.admins || []).forEach(function (a) { if (a !== APP.yo.nombre) ops.push({ texto: a, valor: a }); });
  ops.push({ texto: 'Sin responsable', valor: '-' });
  const v = await elegir('Responsable', 'Le llegan los recordatorios por WhatsApp.', [{ opciones: ops }], t.responsable || '-');
  if (!v) return;
  const nombre = v === '-' ? '' : v;
  if (nombre === (t.responsable || '')) return;
  bandeja.agregar('editarTarea', [ref, { responsable: nombre }], (nombre ? 'poner a ' + nombre + ' como responsable de "' : 'sacar el responsable de "') + t.titulo + '"');
  pintarTareas();
  pintarTarjeta();
}

$('tj-borrar-tarea').addEventListener('click', async function () {
  const ref = TB.abierta, t = tareaVista(ref);
  if (!t) return;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="dg-motivo">¿Por qué se borra?</label><textarea id="dg-motivo" placeholder="Ej: ya no hace falta"></textarea>';
  const motivo = await dialogo({ titulo: '¿Borrar esta tarea?', texto: '"' + t.titulo + '". Se puede deshacer; a los 7 días se borra del todo.', cuerpo: cuerpo,
    botones: [{ texto: 'Sí, borrar la tarea', clase: 'btn peligro-btn', id: 'dg-ok', valor: function () { return $('dg-motivo').value.trim(); } },
              { texto: 'No, volver', valor: null }],
    alAbrir: function () {
      const ok = $('dg-ok'), m = $('dg-motivo');
      const revisar = function () { ok.disabled = m.value.trim().length < 3; };
      m.addEventListener('input', revisar);
      revisar();
      m.focus();
    } });
  if (!motivo) return;
  const clave = bandeja.agregar('borrarTarea', [ref, motivo], 'borrar la tarea "' + t.titulo + '"');
  cerrarTarjeta();
  pintarTareas();
  avisoConBoton('Tarea borrada.', 'Deshacer', function () {
    if (bandeja.pendiente(clave) && !bandeja.enviando) bandeja.quitar(clave);
    else bandeja.agregar('restaurarTarea', [ref], 'recuperar la tarea "' + t.titulo + '"');
    pintarTareas();
  });
});

/** Un cuadro para escribir un texto. Devuelve el texto (o null si se vuelve). */
function pedirTexto(titulo, actual, max, largo) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = largo ? '<textarea id="dg-texto2" maxlength="' + max + '"></textarea>' : '<input type="text" id="dg-texto2" maxlength="' + max + '">';
  return dialogo({ titulo: titulo, cuerpo: cuerpo,
    botones: [{ texto: 'Guardar', clase: 'btn', valor: function () { return $('dg-texto2').value.trim(); } }, { texto: 'Volver', valor: null }],
    alAbrir: function () { $('dg-texto2').value = actual || ''; $('dg-texto2').focus(); } });
}

/** Un cambio de la historia de una tarea, en palabras. */
function fraseDeTarea(e, d) {
  const a = e.antes, n = e.despues;
  if (e.entidad === 'tarea') {
    if (e.accion === 'crear') return 'creó la tarea';
    switch (e.campo) {
      case 'Columna': return 'la movió de ' + a + ' a ' + n;
      case 'Título': return 'cambió el título a "' + n + '"';
      case 'Descripción': return 'cambió la descripción';
      case 'Urgencia': return 'cambió la urgencia de ' + a + ' a ' + n;
      case 'Responsable': return n ? 'puso a ' + n + ' como responsable' : 'sacó a ' + a + ' de responsable';
      case 'Estado': return n === 'Borrada' ? 'borró la tarea' : 'recuperó la tarea';
    }
    return '';
  }
  if (e.entidad === 'checklist') {
    const i = ((d && d.items) || []).filter(function (x) { return x.id === e.id; })[0];
    const txt = i ? '"' + i.texto + '"' : 'un ítem';
    if (e.accion === 'crear') return 'agregó "' + n + '" al checklist';
    if (e.accion === 'borrar') return 'quitó un ítem del checklist';
    if (e.campo === 'Hecho') return (n === 'SI' ? 'tildó ' : 'destildó ') + txt;
    if (e.campo === 'Texto') return 'cambió un ítem a "' + n + '"';
    if (e.campo === 'Lista') return 'cambió el nombre del checklist a "' + n + '"';
    return '';
  }
  if (e.entidad === 'recordatorio') {
    if (e.accion === 'crear') return 'agregó un recordatorio para el ' + n;
    if (e.campo === 'Estado' && n === 'Borrado') return 'quitó un recordatorio';
    if (e.campo === 'Enviado') return '⏰ mandó el recordatorio por WhatsApp';
    return '';
  }
  return '';
}
