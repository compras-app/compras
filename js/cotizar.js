'use strict';
/* ============================================================
   PEDIR COTIZACIÓN (Fase 3, Paso 2)
   ------------------------------------------------------------
   - En Por cotizar, cada pedido tiene "📤 Pedir cotización" (uno por
     tarjeta; Feli sacó el de la columna entera): la ventana muestra un
     bloque por rubro con sus productos y "ver cuáles" (solo para mirar).
     "🎯 Proveedores para varios" cambia a quién va un producto, solo
     para esta vez.
   - Enviar va por la bandeja: si justo no hay señal, sale cuando vuelve.
     El número del envío ("Q…") lo arma la app: un reintento no manda dos
     veces. Si el pedido cambió desde que se abrió la ventana, el
     servidor no lo manda y queda en "Cambios que no se aplicaron".
   - En la tarjeta, el bloque Cotizaciones: a quién se le pidió, qué,
     cuándo, con qué código y en qué estado (lo ven todos).
   ============================================================ */

const OPS_COTIZAR = { pedirCotizacion: 1, reintentarCotizacion: 1 };
const OPS_APROBACION = { mandarAprobar: 1, decidirAprobacion: 1 };     // Paso 6
const ESTADO_COT = {
  'Enviando': '⏳ Mandando…', 'En camino': '⏳ En camino', 'Enviado': '✅ Enviado', 'No salió': '⚠️ No se pudo mandar'
};

function colPorCotizar() {
  const c = columnasTb().filter(function (x) { return x.seccion === 'Cotización'; });
  return (c[1] || c[0] || {}).columna || 'Por cotizar';
}
function fechaCorta(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.getDate() + '/' + (d.getMonth() + 1);
}
/**
 * ¿Se le puede pedir cotización desde la app? Un pedido no manual, o una tarjeta de seguimiento
 * de la Tanda verde (Paso 4), en Por cotizar.
 */
function sePuedeCotizar(t) { return !!t && (!t.trabajo || !!t.tanda) && !t.manual && t.columna === colPorCotizar(); }

/** Decisión (Paso 6): en la tarjeta abierta de un pedido también está "📤 Pedir cotización" (en el tablero, no). */
function colDecision() {
  const c = columnasTb().filter(function (x) { return x.seccion === 'Cotización'; });
  return (c[2] || {}).columna || 'Decisión';
}
function sePuedeCotizarAbierta(t) { return sePuedeCotizar(t) || (!!t && !t.trabajo && !t.manual && t.columna === colDecision()); }

/** La marca de la tarjeta en el tablero, en Por cotizar. */
function htmlMarcaCotizar(t) {
  if (!sePuedeCotizar(t)) return '';
  const espera = bandeja.lista().some(function (m) { return m.fn === 'pedirCotizacion' && m.args[0] === t.ref; });
  let txt;
  if (espera) txt = '⏳ Pidiendo cotización…';
  else if (!t.pedidoA) txt = '📤 Pedir cotización';
  else txt = '⏳ Pedido a ' + t.pedidoA + (t.pedidoA === 1 ? ' proveedor' : ' proveedores') + (t.sinPedir ? ' · 📤 ' + t.sinPedir + ' sin pedir' : '');
  const admin = APP.yo && APP.yo.admin;
  return admin ? '<button type="button" class="marca-cot btn-chico si" data-cotizar="' + esc(t.ref) + '">' + esc(txt) + '</button>'
               : '<div class="marca-cot">' + esc(txt) + '</div>';
}

/* ---------- La ventana "Pedir cotización" ----------
   Un bloque por rubro (Feli): "Proveedores de Ferretería (4)", con sus productos
   para tildar o destildar y "ver cuáles" (solo para mirar: de ahí no se cambian).
   Los productos con proveedores particulares van en su propio bloque ("🎯 …").
   "🎯 Proveedores para varios": a los productos que se elijan se los manda a los
   proveedores que se elijan, solo esta vez (no cambia el rubro ni el padrón).
   Paso 4: refs puede ser una lista (las tarjetas de la tanda, después de
   "Mandar a Por cotizar"): una sola ventana, un bloque por tarjeta, y al
   enviar, un pedido de cotización por tarjeta (cada una con su código). */
let pidiendoCotizar = false;
async function abrirPedirCotizacion(refs) {
  if (!APP.yo.admin || pidiendoCotizar) return;
  const varias = Array.isArray(refs);
  pidiendoCotizar = true;
  aviso('📤 Buscando los proveedores…');
  const r0 = await api('datosCotizar', refs);
  pidiendoCotizar = false;
  if (!r0.ok) return aviso(r0.sinConexion ? '📶 Para abrir "Pedir cotización" hace falta señal (tiene que ver a quién ya se le pidió). Probá en un rato.' : r0.error, 'bad');
  const partes = (r0.varios || [r0]).filter(function (x) { return !x.manual && x.productos.length; });
  if (!partes.length) {
    if (r0.manual) return aviso('Es un pedido ✋ manual: se cotiza a mano, por fuera de la app.');
    return aviso(varias ? 'Esas tarjetas no tienen productos para pedir.' : 'Este pedido no tiene productos para pedir.');
  }
  // Todo junto, y cada producto sabe de qué tarjeta es (x.cref)
  const r = { prueba: partes[0].prueba, proveedores: partes[0].proveedores, titulo: partes[0].titulo, sitio: partes[0].sitio, codigo: partes[0].codigo, productos: [] };
  partes.forEach(function (pt) { pt.productos.forEach(function (x) { x.cref = pt.ref; r.productos.push(x); }); });
  const provs = {};
  r.proveedores.forEach(function (p) { provs[p.id] = p; });
  const nombreProv = function (id) { return (provs[id] || {}).nombre || id; };
  const prod = {};
  r.productos.forEach(function (x) { prod[x.id] = x; });
  const puntual = {};             // ID Línea → [proveedores], solo esta vez ("🎯 Proveedores para varios")
  const fuera = {};               // ID Línea → true: destildado (no va en este envío)
  const abiertos = {};            // bloques con "ver cuáles" abierto
  let varios = null;              // el panel de "Proveedores para varios": {lineas: {}, provs: {}, q}
  const provsDe = function (x) { return puntual[x.id] || x.sugeridos; };
  const pendientes = function (x) { return provsDe(x).filter(function (p) { return !x.ya[p] && provs[p] && provs[p].activo !== false; }); };
  const bloqueDe = function (x) {
    const c = varias ? x.cref + '|' : '';          // con varias tarjetas, cada una con sus bloques
    if (puntual[x.id]) return { clave: c + 'u:' + puntual[x.id].slice().sort().join(','), titulo: '🎯 ' + puntual[x.id].map(nombreProv).join(', '), sub: 'Solo esta vez', provs: puntual[x.id], puntual: true };
    if (x.particulares) return { clave: c + 'p:' + x.sugeridos.slice().sort().join(','), titulo: '🎯 ' + x.sugeridos.map(nombreProv).join(', '), sub: 'Proveedores particulares', provs: x.sugeridos };
    return { clave: c + 'r:' + x.rubro, titulo: 'Proveedores de ' + x.rubro, provs: x.sugeridos, rubro: x.rubro };
  };
  const llega = function (p) { return !!provs[p] && (provs[p].telefono || r.prueba.si); };
  /** [{ref, mensajes: [{proveedor, lineas}]}]: un pedido de cotización por tarjeta, un mensaje por proveedor. */
  const envios = function () {
    const porRef = {}, refs = [];
    r.productos.forEach(function (x) {
      if (fuera[x.id]) return;
      pendientes(x).forEach(function (p) {
        if (!llega(p)) return;
        if (!porRef[x.cref]) { porRef[x.cref] = {}; refs.push(x.cref); }
        (porRef[x.cref][p] = porRef[x.cref][p] || []).push(x.id);
      });
    });
    return refs.map(function (ref) {
      return { ref: ref, mensajes: Object.keys(porRef[ref]).map(function (p) { return { proveedor: p, lineas: porRef[ref][p] }; }) };
    });
  };
  const cuantos = function () { return envios().reduce(function (n, e) { return n + e.mensajes.length; }, 0); };
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo cotizar';
  const pintar = function () {
    const bloques = [], porClave = {};
    r.productos.forEach(function (x) {
      const b = bloqueDe(x);
      if (!porClave[b.clave]) { porClave[b.clave] = Object.assign(b, { productos: [] }); bloques.push(porClave[b.clave]); }
      porClave[b.clave].productos.push(x);
    });
    let html = (r.prueba.si ? '<p class="estado warn">🧪 Modo prueba: todos los mensajes le llegan al número de prueba (' + esc(r.prueba.numero) + '), no a los proveedores.</p>' : '') +
      (varias ? '<p class="nota">' + (partes.length === 1 ? '1 tarjeta' : partes.length + ' tarjetas') + ' de la tanda. A cada proveedor le llega un mensaje por tarjeta, con su código y los productos iguales sumados.</p>'
              : '<p class="nota">' + esc(r.titulo) + ' · ' + esc(r.sitio) + (r.codigo ? ' · Código ' + esc(r.codigo) : '') + '</p>');
    let ultimaTarjeta = '';
    html += bloques.map(function (b) {
      // Varias tarjetas: el nombre de cada una arriba de sus bloques
      const cref = b.productos[0].cref, pt = partes.filter(function (x) { return x.ref === cref; })[0];
      const cab = varias && cref !== ultimaTarjeta ? '<h4 class="cot-tarjeta">' + esc(pt.titulo) + (pt.codigo ? ' <small>· ' + esc(pt.codigo) + '</small>' : '') + '</h4>' : '';
      ultimaTarjeta = cref;
      return cab + htmlBloque(b);
    }).join('');
    function htmlBloque(b) {
      const activos = b.provs.filter(function (p) { return provs[p] && provs[p].activo !== false; });
      const sinNadie = !activos.length;
      const k = esc(b.clave);
      return '<div class="cot-bloque">' +
        '<div class="cot-bloque-h"><div><b>' + esc(b.titulo) + '</b>' + (activos.length ? ' <span class="n">(' + activos.length + ')</span>' : '') +
          (b.sub ? '<small class="sub">' + esc(b.sub) + '</small>' : '') + '</div>' +
          (activos.length ? '<button type="button" class="linkbtn" data-ver="' + k + '">' + (abiertos[b.clave] ? 'ocultar' : 'ver cuáles') + '</button>' : '') +
          (b.puntual ? '<button type="button" class="linkbtn" data-deshacer="' + k + '">deshacer</button>' : '') + '</div>' +
        (abiertos[b.clave] ? '<div class="cot-ver">' + activos.map(function (p) {
          return '<div>' + esc(nombreProv(p)) + (provs[p].telefono ? '' : r.prueba.si ? ' <small>(sin teléfono: en modo prueba sale igual)</small>' : ' <small>(sin teléfono: no le llega)</small>') + '</div>';
        }).join('') + '</div>' : '') +
        (sinNadie ? '<p class="estado warn">' + (b.rubro === 'Sin rubro' || b.rubro === 'OTROS' ? '✋ ' + esc(b.rubro) + ': ' + (b.productos.length === 1 ? 'este producto debe' : 'estos productos deben') + ' ser gestionado' + (b.productos.length === 1 ? '' : 's') + ' manualmente. Si igual querés pedirlo desde acá, usá "🎯 Proveedores para varios".'
          : 'No hay proveedores para ' + esc(b.rubro) + '. Usá "🎯 Proveedores para varios".') + '</p>' : '') +
        b.productos.map(function (x) {
          const pend = pendientes(x), ya = Object.keys(x.ya);
          const todo = !pend.length && ya.length;
          const marcado = !fuera[x.id] && pend.length > 0;
          return '<button type="button" class="choice sub-choice" data-linea="' + esc(x.id) + '"' + (pend.length ? '' : ' disabled') +
            ' aria-checked="' + marcado + '"><span class="marca">' + (marcado ? '☑' : '☐') + '</span><span>' + esc(x.cantidad + 'x ' + x.nombre) +
            (x.nota ? ' — ' + esc(x.nota) : '') + (x.fotos.length ? ' 📷' : '') +
            (x.de ? '<small class="sub">' + esc(x.de) + '</small>' : '') +          // Paso 4: de qué pedido de la tanda
            (todo ? '<small class="sub">Ya se le pidió a todos (' + esc(fechaCorta(x.ya[ya[0]])) + ')</small>'
                  : ya.length ? '<small class="sub">Ya se le pidió a ' + ya.length + ': va a los otros ' + pend.length + '</small>' : '') + '</span></button>';
        }).join('') + '</div>';
    }
    // "🎯 Proveedores para varios": elegir productos y proveedores, solo esta vez
    if (!varios) html += '<button type="button" class="btn2" id="cz-varios">🎯 Proveedores para varios</button>';
    else {
      const q = sinTildes(varios.q || '');
      const lista = r.proveedores.filter(function (p) { return p.activo !== false && (!q || sinTildes(p.nombre).indexOf(q) !== -1); }).slice(0, 40);
      html += '<div class="cot-varios"><b>🎯 Proveedores para varios</b><p class="nota" style="margin:4px 0 8px">Solo esta vez: no cambia el rubro ni el padrón.</p>' +
        '<small class="sub">Productos</small>' + r.productos.map(function (x) {
          return '<button type="button" class="choice sub-choice" data-vl="' + esc(x.id) + '" aria-checked="' + !!varios.lineas[x.id] + '"><span class="marca">' +
            (varios.lineas[x.id] ? '☑' : '☐') + '</span><span>' + esc(x.cantidad + 'x ' + x.nombre) + '</span></button>';
        }).join('') +
        '<small class="sub">Proveedores</small><input type="search" id="cz-q" placeholder="Buscar proveedor…" value="' + esc(varios.q || '') + '">' +
        Object.keys(varios.provs).filter(function (p) { return !lista.some(function (x) { return x.id === p; }); }).map(function (p) {
          return '<button type="button" class="choice sub-choice" data-vp="' + esc(p) + '" aria-checked="true"><span class="marca">☑</span><span>' + esc(nombreProv(p)) + '</span></button>';
        }).join('') +
        lista.map(function (p) {
          return '<button type="button" class="choice sub-choice" data-vp="' + esc(p.id) + '" aria-checked="' + !!varios.provs[p.id] + '"><span class="marca">' +
            (varios.provs[p.id] ? '☑' : '☐') + '</span><span>' + esc(p.nombre) + (p.telefono ? '' : ' <small>(sin teléfono)</small>') + '</span></button>';
        }).join('') +
        '<div class="cot-varios-b"><button type="button" class="btn" id="cz-varios-ok">Aplicar</button><button type="button" class="btn2" id="cz-varios-no">Cancelar</button></div></div>';
    }
    cuerpo.innerHTML = html;
    cuerpo.querySelectorAll('[data-linea]').forEach(function (el) {
      el.addEventListener('click', function () { const id = el.dataset.linea; if (fuera[id]) delete fuera[id]; else fuera[id] = true; pintar(); });
    });
    cuerpo.querySelectorAll('[data-ver]').forEach(function (el) {
      el.addEventListener('click', function () { abiertos[el.dataset.ver] = !abiertos[el.dataset.ver]; pintar(); });
    });
    cuerpo.querySelectorAll('[data-deshacer]').forEach(function (el) {
      el.addEventListener('click', function () {
        r.productos.forEach(function (x) { if (bloqueDe(x).clave === el.dataset.deshacer) delete puntual[x.id]; });
        pintar();
      });
    });
    if ($('cz-varios')) $('cz-varios').addEventListener('click', function () { varios = { lineas: {}, provs: {}, q: '' }; pintar(); });
    if (varios) {
      cuerpo.querySelectorAll('[data-vl]').forEach(function (el) {
        el.addEventListener('click', function () { const id = el.dataset.vl; if (varios.lineas[id]) delete varios.lineas[id]; else varios.lineas[id] = true; pintar(); });
      });
      cuerpo.querySelectorAll('[data-vp]').forEach(function (el) {
        el.addEventListener('click', function () { const id = el.dataset.vp; if (varios.provs[id]) delete varios.provs[id]; else varios.provs[id] = true; pintar(); });
      });
      const q = $('cz-q');
      q.addEventListener('input', function () {
        varios.q = q.value;
        const pos = q.selectionStart;
        pintar();
        const q2 = $('cz-q'); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {}
      });
      $('cz-varios-ok').addEventListener('click', function () {
        const ls = Object.keys(varios.lineas), ps = Object.keys(varios.provs);
        if (!ls.length || !ps.length) return aviso('Elegí al menos un producto y un proveedor.', 'bad');
        ls.forEach(function (id) { puntual[id] = ps.slice(); delete fuera[id]; });
        varios = null;
        pintar();
      });
      $('cz-varios-no').addEventListener('click', function () { varios = null; pintar(); });
    }
    const n = cuantos(), ok = $('dg-ok');
    if (ok) {
      ok.disabled = !n || !!varios;
      ok.textContent = !n ? 'Enviar' : varias ? 'Enviar ' + n + (n === 1 ? ' mensaje' : ' mensajes') : 'Enviar a ' + n + (n === 1 ? ' proveedor' : ' proveedores');
    }
  };
  const listo = await dialogo({
    titulo: '📤 Pedir cotización', cuerpo: cuerpo,
    botones: [{ texto: 'Enviar', clase: 'btn', id: 'dg-ok', valor: function () { return envios(); } }, { texto: 'Volver', valor: null }],
    alAbrir: pintar
  });
  if (!listo || !listo.length) return;
  listo.forEach(function (e) {
    const huellas = {};
    r.productos.forEach(function (x) { if (x.cref === e.ref) huellas[x.id] = x.huella; });
    const pt = partes.filter(function (x) { return x.ref === e.ref; })[0] || {};
    const t = buscarEnVista(e.ref) || { titulo: pt.titulo };
    bandeja.agregar('pedirCotizacion', [e.ref, { id: 'Q' + nuevoId(), mensajes: e.mensajes, huellas: huellas }],
      'pedir cotización de "' + (t.titulo || e.ref) + '" a ' + e.mensajes.length + (e.mensajes.length === 1 ? ' proveedor' : ' proveedores'));
  });
  pintarTablero();
  if (listo.some(function (e) { return TB.abierta === e.ref; })) pintarTarjeta();
  aviso(APP.enLinea ? '📤 Mandando el pedido de cotización…' : '📶 Poca señal: el pedido de cotización se manda solo cuando vuelva.');
}

/* ---------- El bloque Cotizaciones de la tarjeta abierta ---------- */
function pintarCotizaciones() {
  const ref = TB.abierta, d = TB.detalle, b = $('tj-cot-b');
  if (!b) return;
  const t = buscarEnVista(ref);
  const lista = (d && d.solicitudes) || [];
  const esperan = bandeja.lista().filter(function (m) { return OPS_COTIZAR[m.fn] && m.args[0] === ref; });
  const puede = APP.yo.admin && sePuedeCotizarAbierta(t);
  const deTanda = (t && t.tanda) || (d && d.trabajo && d.trabajo.tanda);
  b.hidden = TB.tipo === 'tarea' || (esTrabajo(ref) && !deTanda) || (!lista.length && !esperan.length && !puede);
  if (b.hidden) return;
  $('tj-cotizar').hidden = !puede;
  const reintento = {};
  esperan.forEach(function (m) { if (m.fn === 'reintentarCotizacion') reintento[m.args[1]] = true; });
  $('tj-cot').innerHTML =
    esperan.filter(function (m) { return m.fn === 'pedirCotizacion'; }).map(function () {
      return '<div class="cot-fila espera">' + (APP.enLinea ? '⏳ Mandando el pedido de cotización…' : '⏳ El pedido de cotización se manda solo cuando vuelva la señal.') + '</div>';
    }).join('') +
    (lista.length ? lista.map(function (s) {
      const e = reintento[s.id] ? '⏳ Reintentando…' : (ESTADO_COT[s.estado] || s.estado);
      return '<div class="cot-fila' + (s.estado === 'No salió' ? ' mal' : '') + '"><div><b>' + esc(s.nombre) + '</b> <small>· ' + esc(s.codigo) + ' · ' + esc(fechaCorta(s.fecha)) +
        (s.prueba ? ' · 🧪 prueba' : '') + '</small></div>' +
        '<div class="sub">' + esc(s.productos.join(', ')) + '</div>' +
        '<div class="sub">' + esc(e) + (s.notas ? ' · ' + esc(s.notas) : '') + '</div>' +
        (APP.yo.admin && s.estado === 'No salió' && !reintento[s.id] ? '<button type="button" class="btn-chico" data-reintentar="' + esc(s.id) + '">Reintentar</button>' : '') + '</div>';
    }).join('') : (esperan.length ? '' : '<p class="nota" style="margin:0">Todavía no se pidió cotización.</p>'));
  $('tj-cot').querySelectorAll('[data-reintentar]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const s = lista.filter(function (x) { return x.id === btn.dataset.reintentar; })[0];
      bandeja.agregar('reintentarCotizacion', [ref, s.id], 'volver a mandar el pedido de cotización a ' + s.nombre);
      pintarCotizaciones();
    });
  });
}
$('tj-cotizar').addEventListener('click', function () { if (TB.abierta) abrirPedirCotizacion(TB.abierta); });

// Cuando sale de la bandeja: el bloque Cotizaciones y la marca del tablero se actualizan (las dos llevan la ref adelante)
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (!OPS_COTIZAR[m.fn]) return;
    const ref = m.args[0];
    if (r.ok && r.solicitudes) {
      const todos = detallesGuardados();
      if (todos[ref]) { todos[ref].d.solicitudes = r.solicitudes; guardado.guardarJSON(K_TARJETAS, todos); }
      if (TB.abierta === ref && TB.detalle) TB.detalle.solicitudes = r.solicitudes;
    }
    if (r.ok && m.fn === 'pedirCotizacion' && !document.hidden) {
      const n = (r.solicitudes || []).filter(function (s) { return s.estado === 'No salió'; }).length;
      aviso(r.repetido ? 'Ese pedido de cotización ya se había mandado.' : n ? '📤 Pedido de cotización ' + r.codigo + ' mandado. ' + n + ' no se ' + (n === 1 ? 'pudo' : 'pudieron') + ' mandar: mirá la tarjeta.' : '📤 Pedido de cotización ' + r.codigo + ' mandado.');
    }
    cargarTablero();
    if (TB.abierta === ref) { pintarTarjeta(); traerTarjeta(ref); }
  };
})();

/* ---------- Aprobación de la compra (Paso 6) ----------
   "📨 Mandar a aprobar" (admins, en Decisión): un WhatsApp al que aprueba (Admin → Ajustes), con el
   mensaje que se elija y siempre el link a la tarjeta. Mientras espera, al que aprueba le aparecen
   "✅ Aprobar compra" y "❌ No aprobar" (con un motivo). Todo por la bandeja. */
const APROB_DECIDIDA = {};          // ref → {estado, motivo} mientras la decisión espera en la bandeja

function aprobacionVista(ref, p) {
  const a = (p && p.aprobacion) ? Object.assign({}, p.aprobacion) : null;
  if (APROB_DECIDIDA[ref] && a) Object.assign(a, APROB_DECIDIDA[ref], { decidio: APP.yo.nombre });
  return a;
}

function pintarAprobacion() {
  const ref = TB.abierta, d = TB.detalle, b = $('tj-aprob-b');
  if (!b) return;
  const p = d && d.pedido, t = buscarEnVista(ref);
  const esperan = bandeja.lista().filter(function (m) { return m.fn === 'mandarAprobar' && m.args[0] === ref; });
  const columna = t ? t.columna : (p && p.columna);
  const puedeMandar = APP.yo.admin && p && !esTrabajo(ref) && !p.servicio && columna === colDecision();
  const a = aprobacionVista(ref, p);
  b.hidden = TB.tipo === 'tarea' || esTrabajo(ref) || !p || (!a && !esperan.length && !puedeMandar);
  if (b.hidden) return;
  const fecha = function (iso) { return iso ? ' (' + fechaCorta(iso) + ')' : ''; };
  let html = '';
  if (esperan.length) html = '<div class="cot-fila espera">' + (APP.enLinea ? '⏳ Mandando el pedido de aprobación…' : '⏳ El pedido de aprobación se manda solo cuando vuelva la señal.') + '</div>';
  else if (a && a.estado === 'Esperando') {
    html = '<div class="cot-fila"><b>⏳ Esperando aprobación de ' + esc(a.aprueba) + '</b><div class="sub">Lo mandó ' + esc(a.pidio) + esc(fecha(a.fecha)) + '</div>' +
      (a.aprueba === APP.yo.nombre ? '<div class="cambio-b"><button type="button" class="btn-chico si" id="tj-aprob-si">✅ Aprobar compra</button>' +
                                     '<button type="button" class="btn-chico" id="tj-aprob-no">❌ No aprobar</button></div>' : '') + '</div>';
  } else if (a && a.estado === 'Aprobada') html = '<div class="cot-fila"><b>✅ Aprobada por ' + esc(a.decidio) + '</b>' + esc(fecha(a.decidida)) + '</div>';
  else if (a && a.estado === 'No aprobada') html = '<div class="cot-fila mal"><b>❌ No aprobada por ' + esc(a.decidio) + '</b>' + esc(fecha(a.decidida)) + (a.motivo ? '<div class="sub">' + esc(a.motivo) + '</div>' : '') + '</div>';
  else html = '<p class="nota" style="margin:0">Todavía no se mandó a aprobar.</p>';
  $('tj-aprob').innerHTML = html;
  const m = $('tj-aprobar-mandar');
  m.hidden = !puedeMandar || !!esperan.length || !!(a && a.estado === 'Esperando');
  m.textContent = a ? '📨 Volver a mandar a aprobar' : '📨 Mandar a aprobar';
  if ($('tj-aprob-si')) $('tj-aprob-si').addEventListener('click', function () { decidirAprobacionUI(ref, true); });
  if ($('tj-aprob-no')) $('tj-aprob-no').addEventListener('click', function () { decidirAprobacionUI(ref, false); });
}

$('tj-aprobar-mandar').addEventListener('click', async function () {
  const ref = TB.abierta, d = TB.detalle;
  if (!ref || !d || !d.pedido || !APP.yo.admin) return;
  const prods = lineasConCambios(ref, d.lineas || []).filter(function (l) { return vigente(l) && l.estado !== 'Para agregar' && !l.tarjeta; })
    .map(function (l) { return '- ' + l.cantidad + 'x ' + nombreProducto(l); });
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.innerHTML = '<label for="ap-msj">Mensaje</label><textarea id="ap-msj" rows="9"></textarea>' +
    '<p class="nota">Abajo va siempre el link a esta tarjeta. Le llega por WhatsApp a quien aprueba las compras (se elige en Admin → Ajustes).</p>';
  const texto = await dialogo({
    titulo: '📨 Mandar a aprobar', cuerpo: cuerpo,
    botones: [{ texto: 'Mandar', clase: 'btn', id: 'dg-ok', valor: function () { return $('ap-msj').value.trim(); } }, { texto: 'Volver', valor: null }],
    alAbrir: function () {
      const m = $('ap-msj');
      m.value = 'Necesitamos aprobación de la compra de los siguientes productos:\n' + prods.join('\n') + '\n\n' + (d.pedido.titulo || '') + ' · ' + (d.pedido.sitio || '');
      const ok = $('dg-ok');
      const revisar = function () { ok.disabled = m.value.trim().length < 5; };
      m.addEventListener('input', revisar);
      revisar();
    }
  });
  if (!texto) return;
  delete APROB_DECIDIDA[ref];
  bandeja.agregar('mandarAprobar', [ref, { id: 'A' + nuevoId(), texto: texto }], 'mandar a aprobar "' + (d.pedido.titulo || ref) + '"');
  pintarAprobacion();
  aviso(APP.enLinea ? '📨 Mandando el pedido de aprobación…' : '📶 Poca señal: el pedido de aprobación se manda solo cuando vuelva.');
});

async function decidirAprobacionUI(ref, aprobar) {
  let motivo = '';
  if (!aprobar) {
    const cuerpo = document.createElement('div');
    cuerpo.className = 'cuerpo';
    cuerpo.innerHTML = '<label for="ap-motivo">¿Por qué no se aprueba?</label><textarea id="ap-motivo" rows="3"></textarea>';
    motivo = await dialogo({
      titulo: '❌ No aprobar', cuerpo: cuerpo,
      botones: [{ texto: 'No aprobar', clase: 'btn', id: 'dg-ok', valor: function () { return $('ap-motivo').value.trim(); } }, { texto: 'Volver', valor: null }],
      alAbrir: function () {
        const m = $('ap-motivo'), ok = $('dg-ok');
        const revisar = function () { ok.disabled = m.value.trim().length < 3; };
        m.addEventListener('input', revisar);
        revisar();
        m.focus();
      }
    });
    if (!motivo) return;
  }
  APROB_DECIDIDA[ref] = { estado: aprobar ? 'Aprobada' : 'No aprobada', motivo: motivo, decidida: new Date().toISOString() };
  bandeja.agregar('decidirAprobacion', [ref, aprobar, motivo], (aprobar ? 'aprobar' : 'no aprobar') + ' la compra');
  pintarAprobacion();
}

// Cuando sale de la bandeja: la tarjeta queda con lo que dice el servidor
(function () {
  const antes = bandeja.alTerminar;
  bandeja.alTerminar = function (m, r) {
    if (antes) antes(m, r);
    if (!OPS_APROBACION[m.fn]) return;
    const ref = m.args[0];
    delete APROB_DECIDIDA[ref];
    if (r.ok && r.aprobacion) {
      const todos = detallesGuardados();
      if (todos[ref] && todos[ref].d.pedido) { todos[ref].d.pedido.aprobacion = r.aprobacion; guardado.guardarJSON(K_TARJETAS, todos); }
      if (TB.abierta === ref && TB.detalle && TB.detalle.pedido) TB.detalle.pedido.aprobacion = r.aprobacion;
    }
    if (r.ok && m.fn === 'mandarAprobar' && !document.hidden) aviso(r.repetido ? 'Ese pedido de aprobación ya se había mandado.' : '📨 Listo: le llegó el pedido de aprobación a ' + ((r.aprobacion && r.aprobacion.aprueba) || 'quien aprueba') + '.');
    cargarTablero();
    if (TB.abierta === ref) { pintarTarjeta(); traerTarjeta(ref); }
  };
})();
